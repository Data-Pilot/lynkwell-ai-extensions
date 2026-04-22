/**
 * LynkWell AI Cloud API — Gemini on server, JWT for extensions.
 * Run: cp .env.example .env && npm install && npm start
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

/** Pin algorithm to avoid JWT "alg" confusion; all tokens use HS256. */
const JWT_ALG = 'HS256';
const JWT_VERIFY_OPTS = { algorithms: [JWT_ALG] };

const PORT = Number(process.env.PORT) || 3847;
/** Listen address: 127.0.0.1 (default) or 0.0.0.0 so other devices on your LAN can reach the API */
const BIND_HOST = (process.env.BIND_HOST || '127.0.0.1').trim();
/** Strip BOM, whitespace, and wrapping quotes — common when copying from .env or Vercel UI. */
function normalizeGeminiApiKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^["']+|["']+$/g, '');
}
const GEMINI_API_KEY = normalizeGeminiApiKey(process.env.GEMINI_API_KEY);
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const RAW_CODES = (process.env.REACHAI_ACTIVATION_CODES || '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
/** Same value as extension/lib/reach-api-default.js REACHAI_EXTENSION_SECRET (min 16 chars), or use REACHAI_ACTIVATION_CODES only. */
const EXTENSION_SECRET = (process.env.REACHAI_EXTENSION_SECRET || '').trim();

const LINKEDIN_CLIENT_ID = (process.env.LINKEDIN_CLIENT_ID || '').trim();
const LINKEDIN_CLIENT_SECRET = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
/** If set, token exchange must use this exact redirect_uri (recommended for production). */
const LINKEDIN_REDIRECT_URI = (process.env.LINKEDIN_REDIRECT_URI || '').trim();

/** Public base URL (no path) for LinkedIn to redirect to your API, e.g. http://127.0.0.1:3847 or https://api.yourcompany.com */
const REACHAI_PUBLIC_URL = (process.env.REACHAI_PUBLIC_URL || '').trim().replace(/\/$/, '');
/** Optional: full redirect_uri for extension-flow LinkedIn callback (overrides REACHAI_PUBLIC_URL + default path). */
const LINKEDIN_EXT_FLOW_REDIRECT_URI = (process.env.LINKEDIN_EXT_FLOW_REDIRECT_URI || '').trim();

const LINKEDIN_EXT_CALLBACK_PATH = '/api/v1/oauth/linkedin/extension-flow/callback';

const MAX_TOKENS = {
  confirm: 256,
  /** Large KB + profile prompts need headroom; truncation breaks JSON.parse in the extension. */
  recommend: 4096,
  generate: 2048,
  /** InMail JSON { subject, body } — body can be ~1900 chars; need headroom so Gemini does not truncate mid-string */
  generate_structured: 4096,
  /** Extension multi-step agent: research / fit / review JSON */
  agent_step: 4096
};

/** Usage values accepted by POST /api/v1/ai/complete */
const AI_USAGE = new Set(['confirm', 'recommend', 'generate', 'generate_structured', 'agent_step']);

const GEMINI_MODEL_ID_ENV = String(process.env.GEMINI_MODEL_ID || '').trim();
/** Model id is embedded in a URL path — allow only safe characters. */
const GEMINI_MODEL_ID_SAFE = /^[a-zA-Z0-9._-]+$/;
function getGeminiModelId() {
  if (GEMINI_MODEL_ID_ENV && GEMINI_MODEL_ID_SAFE.test(GEMINI_MODEL_ID_ENV)) return GEMINI_MODEL_ID_ENV;
  if (GEMINI_MODEL_ID_ENV && !GEMINI_MODEL_ID_SAFE.test(GEMINI_MODEL_ID_ENV)) {
    console.warn('[reachai-api] GEMINI_MODEL_ID ignored (use letters, digits, . _ - only). Falling back to gemini-2.5-flash.');
  }
  return 'gemini-2.5-flash';
}

function buildGeminiGenerationConfig(usage) {
  const maxOutputTokens = MAX_TOKENS[usage] ?? MAX_TOKENS.generate;
  if (usage === 'confirm') {
    return { temperature: 0.35, maxOutputTokens };
  }
  if (usage === 'recommend') {
    return {
      temperature: 0.35,
      maxOutputTokens,
      responseMimeType: 'application/json'
    };
  }
  if (usage === 'generate_structured') {
    return {
      temperature: 0.65,
      maxOutputTokens,
      responseMimeType: 'application/json'
    };
  }
  if (usage === 'agent_step') {
    return {
      temperature: 0.5,
      maxOutputTokens,
      responseMimeType: 'application/json'
    };
  }
  return { temperature: 0.8, maxOutputTokens };
}

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.warn('[reachai-api] Set JWT_SECRET (16+ chars) in .env');
}
if (!GEMINI_API_KEY) {
  console.warn('[reachai-api] Set GEMINI_API_KEY (Google AI Studio) in server .env — https://aistudio.google.com/app/apikey');
}
if (RAW_CODES.length === 0 && EXTENSION_SECRET.length < 16) {
  console.warn(
    '[reachai-api] Set REACHAI_ACTIVATION_CODES and/or REACHAI_EXTENSION_SECRET (16+ chars) in .env for /auth/activate'
  );
}
if (EXTENSION_SECRET.length > 0 && EXTENSION_SECRET.length < 16) {
  console.warn('[reachai-api] REACHAI_EXTENSION_SECRET should be at least 16 characters.');
}
if (GEMINI_API_KEY && !GEMINI_API_KEY.startsWith('AIza')) {
  console.warn(
    '[reachai-api] GEMINI_API_KEY is set but does not start with "AIza" (typical for https://aistudio.google.com/app/apikey ). ' +
      'The server still calls Google AI Studio; if you get 401/403, create a key in AI Studio.'
  );
}
if (LINKEDIN_CLIENT_ID && !LINKEDIN_CLIENT_SECRET) {
  console.warn('[reachai-api] LINKEDIN_CLIENT_ID set but LINKEDIN_CLIENT_SECRET missing — /oauth/linkedin/token will fail.');
}

const app = express();
if (process.env.VERCEL) {
  app.set('trust proxy', 1);
}

/** Simple fixed-window rate limiter (per Node instance; helps against casual abuse). */
function createRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();
  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { resetAt: now + windowMs, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000) || 1;
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    return next();
  };
}

function rateLimitClientKey(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (xf) return `ip:${xf}`;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

const activateRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyFn: rateLimitClientKey
});
const handoffExchangeRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyFn: rateLimitClientKey
});
const aiCompleteRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyFn: (req) => {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) return rateLimitClientKey(req);
    const h = crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32);
    return `jwt:${h}`;
  }
});

/** LinkedIn redirect_uri must match Developer Portal exactly — never send localhost from Vercel by mistake. */
function getEffectivePublicBase() {
  if (REACHAI_PUBLIC_URL) return REACHAI_PUBLIC_URL.replace(/\/$/, '');
  const vu = String(process.env.VERCEL_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (vu) return `https://${vu}`;
  return '';
}

function getExtensionFlowCallbackUrl() {
  const full = LINKEDIN_EXT_FLOW_REDIRECT_URI.replace(/\/$/, '');
  if (full) return full;
  const base = getEffectivePublicBase() || `http://127.0.0.1:${PORT}`;
  return `${base.replace(/\/$/, '')}${LINKEDIN_EXT_CALLBACK_PATH}`;
}

/** Only allow https://*.chromiumapp.org/linkedin — extension passes this so Chrome can close launchWebAuthFlow. */
function parseSafeChromeDoneParam(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    decoded = s;
  }
  try {
    const u = new URL(decoded);
    if (u.protocol !== 'https:') return null;
    if (!u.hostname.endsWith('.chromiumapp.org')) return null;
    if (!u.pathname.startsWith('/linkedin')) return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function redirectExtensionOAuthTerminal(res, queryString, chromeDone) {
  if (chromeDone) {
    try {
      const u = new URL(chromeDone);
      const incoming = new URLSearchParams(queryString.replace(/^\?/, ''));
      incoming.forEach((value, name) => u.searchParams.set(name, value));
      return res.redirect(302, u.toString());
    } catch {
      /* fall through */
    }
  }
  try {
    const u = new URL(getExtensionFlowCallbackUrl());
    u.pathname = '/api/v1/oauth/linkedin/extension-flow/complete';
    u.search = queryString.replace(/^\?/, '');
    u.hash = '';
    return res.redirect(302, u.toString());
  } catch {
    return res.status(500).type('text').send('Invalid REACHAI_PUBLIC_URL or LINKEDIN_EXT_FLOW_REDIRECT_URI in .env.');
  }
}

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

/** OWASP-style baseline headers (TLS/HSTS depend on your reverse host, e.g. Vercel HTTPS). */
function securityHeadersMiddleware(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (process.env.VERCEL || String(process.env.NODE_ENV).toLowerCase() === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "script-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
    "font-src https://fonts.gstatic.com",
    "connect-src 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  return next();
}
app.use(securityHeadersMiddleware);

app.use(express.json({ limit: '2mb' }));

const API_LANDING_HTML = path.join(__dirname, 'public', 'api-landing.html');
const SECURITY_HTML_PATH = path.join(__dirname, 'public', 'security.html');

app.get('/', (_req, res) => {
  try {
    const html = fs.readFileSync(API_LANDING_HTML, 'utf8');
    return res.type('html').send(html);
  } catch {
    return res
      .type('html')
      .send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LynkWell AI API</title></head><body style="font-family:system-ui;margin:2rem"><h1>LynkWell AI API</h1><p><a href="/health">/health</a> · <a href="/api/v1/diagnose">/api/v1/diagnose</a></p></body></html>'
      );
  }
});

app.get('/security', (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const html = fs.readFileSync(SECURITY_HTML_PATH, 'utf8');
    return res.type('html').send(html);
  } catch {
    return res.status(404).type('text').send('Not found');
  }
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false,
    setHeaders(res, filePath) {
      if (String(filePath).endsWith('.png')) res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'reachai-api' });
});

/** Quick config check (no secrets returned). */
app.get('/api/v1/diagnose', (_req, res) => {
  res.json({
    ok: true,
    port: PORT,
    bind: BIND_HOST,
    gemini_provider: 'google_ai_studio',
    gemini: 'google_generative_language',
    has_gemini_key: !!GEMINI_API_KEY,
    gemini_key_looks_like_ai_studio: !!GEMINI_API_KEY && GEMINI_API_KEY.startsWith('AIza'),
    activation_codes_configured: RAW_CODES.length,
    extension_secret_configured: EXTENSION_SECRET.length >= 16,
    jwt_secret_ok: JWT_SECRET.length >= 16,
    linkedin_oauth_ready: !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET),
    gemini_model: getGeminiModelId(),
    linkedin_extension_flow_callback_url: getExtensionFlowCallbackUrl(),
    reachai_public_url_configured: !!REACHAI_PUBLIC_URL,
    vercel_url_fallback: !!(process.env.VERCEL && !REACHAI_PUBLIC_URL && process.env.VERCEL_URL)
  });
});

/** Public: URL to register on LinkedIn when using extension “login via API callback” mode. */
app.get('/api/v1/oauth/linkedin/extension-flow/meta', (_req, res) => {
  res.json({
    callback_url: getExtensionFlowCallbackUrl(),
    start_url_path: '/api/v1/oauth/linkedin/extension-flow/start'
  });
});

/**
 * LinkedIn OAuth where redirect_uri is THIS API (best for production HTTPS).
 * 1) Extension opens launchWebAuthFlow(start) → 302 LinkedIn → user approves → 302 callback here → exchange → JWT + handoff → 302 “complete” page.
 * 2) Extension POST /exchange with handoff → JSON (LynkWell AI JWT + LinkedIn token).
 *
 * Pass ?chrome_done=<encodeURIComponent(https://…chromiumapp.org/linkedin)> so the final
 * redirect lands on Chrome’s extension URL — otherwise launchWebAuthFlow may not close.
 */
app.get('/api/v1/oauth/linkedin/extension-flow/start', (req, res) => {
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(503).type('text').send('LinkedIn is not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in .env).');
  }
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    return res.status(500).type('text').send('Set JWT_SECRET (16+ chars) in .env.');
  }
  const chromeDone = parseSafeChromeDoneParam(req.query.chrome_done);
  if (!chromeDone) {
    return res
      .status(400)
      .type('text')
      .send(
        'Missing or invalid chrome_done. The extension must open this URL with ?chrome_done=<encodeURIComponent(chrome.identity.getRedirectURL("linkedin"))>. Rebuild/restart the API and reload the Chrome extension.'
      );
  }
  let state;
  try {
    state = jwt.sign(
      { typ: 'reachai_li_oauth', v: 1, cd: chromeDone, jti: crypto.randomBytes(12).toString('hex') },
      JWT_SECRET,
      { expiresIn: '10m', algorithm: JWT_ALG }
    );
  } catch (e) {
    return res.status(500).type('text').send('Could not create OAuth state (check JWT_SECRET).');
  }
  const redirectUri = getExtensionFlowCallbackUrl();
  const scope = 'openid profile email';
  const auth =
    'https://www.linkedin.com/oauth/v2/authorization?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      scope,
      state
    }).toString();
  return res.redirect(302, auth);
});

app.get('/api/v1/oauth/linkedin/extension-flow/callback', async (req, res) => {
  const qErr = String(req.query.error || '').trim();
  const stateKey = String(req.query.state || '').trim();
  let oauthSt = null;
  if (stateKey && JWT_SECRET.length >= 16) {
    try {
      oauthSt = jwt.verify(stateKey, JWT_SECRET, JWT_VERIFY_OPTS);
    } catch {
      oauthSt = null;
    }
  }
  const stateOk =
    oauthSt && oauthSt.typ === 'reachai_li_oauth' && oauthSt.v === 1 && typeof oauthSt.cd === 'string';
  const chromeDone = stateOk ? parseSafeChromeDoneParam(oauthSt.cd) || null : null;

  const finishErr = (qs) => redirectExtensionOAuthTerminal(res, qs, chromeDone);

  if (qErr) {
    const desc = String(req.query.error_description || '').trim();
    return finishErr(`error=${encodeURIComponent(qErr)}&error_description=${encodeURIComponent(desc)}`);
  }

  const code = String(req.query.code || '').trim();
  if (!code || !stateOk) {
    return finishErr(
      `error=invalid_state&error_description=${encodeURIComponent('Missing code, unknown state, or expired OAuth state. Try Sign in again.')}`
    );
  }

  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET || !JWT_SECRET || JWT_SECRET.length < 16) {
    return finishErr(`error=server_config&error_description=${encodeURIComponent('Server LinkedIn or JWT not configured.')}`);
  }

  const redirectUri = getExtensionFlowCallbackUrl();
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: LINKEDIN_CLIENT_ID,
    client_secret: LINKEDIN_CLIENT_SECRET
  });

  let lr;
  try {
    lr = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
  } catch (e) {
    return finishErr(`error=linkedin_network&error_description=${encodeURIComponent(e.message || String(e))}`);
  }

  const liData = await lr.json().catch(() => ({}));
  if (!lr.ok) {
    const msg = liData.error_description || liData.error || `LinkedIn HTTP ${lr.status}`;
    return finishErr(`error=linkedin_token&error_description=${encodeURIComponent(String(msg))}`);
  }
  if (!liData.access_token) {
    return finishErr(`error=linkedin_token&error_description=${encodeURIComponent('LinkedIn response missing access_token.')}`);
  }

  const liExpiresIn = Number(liData.expires_in) || 5184000;
  const liExpiresAt = Date.now() + liExpiresIn * 1000;
  let handoff;
  try {
    handoff = jwt.sign(
      {
        typ: 'reachai_li_handoff',
        v: 1,
        la: liData.access_token,
        liExp: liExpiresAt,
        sc: String(liData.scope || '')
      },
      JWT_SECRET,
      { expiresIn: '3m', algorithm: JWT_ALG }
    );
  } catch (e) {
    return finishErr(
      `error=handoff&error_description=${encodeURIComponent(e.message || 'Could not create handoff token.')}`
    );
  }

  return redirectExtensionOAuthTerminal(
    res,
    `handoff=${encodeURIComponent(handoff)}`,
    chromeDone
  );
});

app.get('/api/v1/oauth/linkedin/extension-flow/complete', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed in</title></head><body>
<p>LinkedIn sign-in finished. This tab should close automatically — return to the LynkWell AI side panel.</p>
<p style="color:#666;font-size:14px">If you still see this page, reload the extension and run <strong>docker compose up --build</strong> so the API has the latest OAuth code (chrome_done redirect).</p>
<script>try { window.close(); } catch (e) {}</script>
</body></html>`);
});

app.post('/api/v1/oauth/linkedin/extension-flow/exchange', handoffExchangeRateLimit, (req, res) => {
  const handoff = String(req.body?.handoff || '').trim();
  if (!handoff) return res.status(400).json({ error: 'Missing handoff.' });
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    return res.status(500).json({ error: 'Server JWT not configured.' });
  }
  let row;
  try {
    row = jwt.verify(handoff, JWT_SECRET, JWT_VERIFY_OPTS);
  } catch {
    return res.status(400).json({ error: 'Invalid or expired handoff. Try Sign in with LinkedIn again.' });
  }
  if (!row || row.typ !== 'reachai_li_handoff' || row.v !== 1 || typeof row.la !== 'string') {
    return res.status(400).json({ error: 'Invalid handoff payload.' });
  }
  const liExpiresAt = Number(row.liExp) || 0;
  if (liExpiresAt < Date.now()) {
    return res.status(400).json({ error: 'LinkedIn token expired. Sign in again.' });
  }
  const reachaiJwt = jwt.sign({ typ: 'reachai_user', iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, {
    expiresIn: '30d',
    algorithm: JWT_ALG
  });
  const liExpiresIn = Math.max(60, Math.floor((liExpiresAt - Date.now()) / 1000));
  return res.json({
    access_token: reachaiJwt,
    token_type: 'Bearer',
    expires_in: 30 * 24 * 3600,
    linkedin: {
      access_token: row.la,
      expires_in: liExpiresIn,
      scope: String(row.sc || '')
    }
  });
});

function isAllowedLinkedInRedirect(uri) {
  const u = String(uri || '').trim();
  if (!u) return false;
  try {
    if (u === getExtensionFlowCallbackUrl()) return true;
  } catch {
    /* ignore */
  }
  if (LINKEDIN_REDIRECT_URI) return u === LINKEDIN_REDIRECT_URI;
  try {
    const x = new URL(u);
    return (
      x.protocol === 'https:' &&
      x.hostname.endsWith('.chromiumapp.org') &&
      x.pathname.startsWith('/linkedin')
    );
  } catch {
    return false;
  }
}

function extensionSecretMatches(provided) {
  if (!provided || EXTENSION_SECRET.length < 16) return false;
  try {
    const a = Buffer.from(EXTENSION_SECRET, 'utf8');
    const b = Buffer.from(String(provided), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function activationCodeMatches(provided) {
  const p = String(provided || '');
  if (!p) return false;
  for (const c of RAW_CODES) {
    if (c.length !== p.length) continue;
    try {
      const a = Buffer.from(c, 'utf8');
      const b = Buffer.from(p, 'utf8');
      if (a.length !== b.length) continue;
      if (crypto.timingSafeEqual(a, b)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

app.post('/api/v1/auth/activate', activateRateLimit, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const extensionSecret = String(req.body?.extensionSecret || '').trim();
  const hasCodes = RAW_CODES.length > 0;
  const hasExtSecret = EXTENSION_SECRET.length >= 16;

  if (!hasCodes && !hasExtSecret) {
    return res.status(503).json({
      error:
        'Server has no REACHAI_ACTIVATION_CODES or REACHAI_EXTENSION_SECRET (16+ chars). Set at least one in .env.'
    });
  }

  let authorized = false;
  if (hasCodes && code && activationCodeMatches(code)) authorized = true;
  if (!authorized && hasExtSecret && extensionSecretMatches(extensionSecret)) authorized = true;

  if (!authorized) {
    return res.status(401).json({
      error: 'Invalid activation. Use a valid code or extension secret matching the server .env.'
    });
  }
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    return res.status(500).json({
      error: 'Set JWT_SECRET in .env to a random string at least 16 characters (e.g. openssl rand -hex 32).'
    });
  }
  const token = jwt.sign({ typ: 'reachai_user', iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, {
    expiresIn: '30d',
    algorithm: JWT_ALG
  });
  return res.json({ access_token: token, token_type: 'Bearer', expires_in: 30 * 24 * 3600 });
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return res.status(401).json({ error: 'Missing Bearer token.' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfigured.' });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET, JWT_VERIFY_OPTS);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/** Exchange LinkedIn authorization code (extension must send same redirect_uri as in the auth request). */
app.post('/api/v1/oauth/linkedin/token', authMiddleware, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const redirect_uri = String(req.body?.redirect_uri || '').trim();
  if (!code || !redirect_uri) {
    return res.status(400).json({ error: 'Missing code or redirect_uri.' });
  }
  if (!isAllowedLinkedInRedirect(redirect_uri)) {
    return res.status(400).json({
      error:
        'redirect_uri not allowed. Set LINKEDIN_REDIRECT_URI in server .env to the exact URL from chrome.identity.getRedirectURL("linkedin"), or leave it unset to allow https://*.chromiumapp.org/linkedin* in development.'
    });
  }
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'Server missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in .env.'
    });
  }
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect_uri,
    client_id: LINKEDIN_CLIENT_ID,
    client_secret: LINKEDIN_CLIENT_SECRET
  });
  let lr;
  try {
    lr = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
  } catch (e) {
    return res.status(502).json({ error: `LinkedIn token request failed: ${e.message || e}` });
  }
  const data = await lr.json().catch(() => ({}));
  if (!lr.ok) {
    return res.status(401).json({
      error: data.error_description || data.error || `LinkedIn token error (${lr.status})`
    });
  }
  if (!data.access_token) {
    return res.status(502).json({ error: 'LinkedIn response missing access_token.' });
  }
  return res.json({
    access_token: data.access_token,
    expires_in: data.expires_in,
    scope: data.scope || ''
  });
});

function parseGeminiErrorResponse(text) {
  let detail = text.slice(0, 800);
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message || j?.error?.status || j?.message;
    if (msg) detail = String(msg);
  } catch {
    /* keep raw slice */
  }
  return detail;
}

async function callGoogleAiStudioGemini(prompt, generationConfig) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModelId()}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  if (!response.ok) {
    const raw = await response.text();
    const detail = parseGeminiErrorResponse(raw);
    let hint = '';
    if (response.status === 400 || response.status === 403) {
      hint =
        ' For Generative Language API use an API key from https://aistudio.google.com/app/apikey (typically starts with AIza).';
    }
    return { ok: false, status: response.status, text: detail + hint };
  }
  const data = await response.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) return { ok: false, status: 502, text: 'Empty model response' };
  return { ok: true, text: String(out).trim().replace(/^["'](.*)["']$/, '$1') };
}

async function callGemini(prompt, usage = 'generate') {
  const generationConfig = buildGeminiGenerationConfig(
    AI_USAGE.has(usage) ? usage : 'generate'
  );
  if (!GEMINI_API_KEY) {
    return {
      ok: false,
      status: 503,
      text: 'GEMINI_API_KEY missing in server .env — https://aistudio.google.com/app/apikey'
    };
  }
  return callGoogleAiStudioGemini(prompt, generationConfig);
}

/** Extension sends the final prompt (same strings as your service worker). Server only holds the API key. */
app.post('/api/v1/ai/complete', authMiddleware, aiCompleteRateLimit, async (req, res) => {
  const usage = AI_USAGE.has(req.body?.usage) ? req.body.usage : 'generate';
  const prompt = String(req.body?.prompt || '');
  if (!prompt || prompt.length > 120000) {
    return res.status(400).json({ error: 'Invalid prompt.' });
  }
  try {
    const r = await callGemini(prompt, usage);
    if (!r.ok) {
      const http =
        r.status === 503 || r.status === 401 || r.status === 400 ? r.status : r.status === 429 ? 429 : 502;
      return res.status(http).json({ error: r.text || 'Gemini error', geminiStatus: r.status });
    }
    return res.json({ text: r.text });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  app.listen(PORT, BIND_HOST, () => {
    console.log(`[reachai-api] Listening on http://${BIND_HOST}:${PORT}`);
    console.log('[reachai-api] Gemini: Google AI Studio (GEMINI_API_KEY) → generativelanguage.googleapis.com');
    console.log('[reachai-api] POST /api/v1/auth/activate  body: { "code": "..." }');
    console.log('[reachai-api] POST /api/v1/ai/complete   Authorization: Bearer <jwt>');
    console.log('[reachai-api] POST /api/v1/oauth/linkedin/token  Authorization: Bearer <jwt>  body: { code, redirect_uri }');
    console.log(
      '[reachai-api] LinkedIn extension-flow callback (register on LinkedIn):',
      getExtensionFlowCallbackUrl()
    );
  });
}

module.exports = app;
