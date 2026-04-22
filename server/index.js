/**
 * LynkWell AI Cloud API — Gemini on server, JWT for extensions.
 * Run: cp .env.example .env && npm install && npm start
 */
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

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
/** `vertex` (opt-in) | `studio` | empty (default: Studio + GEMINI_API_KEY only). Vertex needs GEMINI_PROVIDER=vertex or GEMINI_USE_VERTEX=1. */
const GEMINI_PROVIDER = String(process.env.GEMINI_PROVIDER || '')
  .trim()
  .toLowerCase();
const GCP_PROJECT_ID = String(process.env.GCP_PROJECT_ID || '').trim();
const GCP_LOCATION = String(process.env.GCP_LOCATION || 'us-central1').trim();
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

function hasVertexServiceAccountEnv() {
  const raw = String(process.env.GCP_SERVICE_ACCOUNT_JSON || '').trim();
  const b64 = String(process.env.GCP_SERVICE_ACCOUNT_JSON_B64 || '').trim();
  return !!(raw || b64);
}

function parseVertexServiceAccount() {
  const b64 = String(process.env.GCP_SERVICE_ACCOUNT_JSON_B64 || '').trim();
  let text = String(process.env.GCP_SERVICE_ACCOUNT_JSON || '')
    .trim()
    .replace(/^["']+|["']+$/g, '');
  if (b64) {
    try {
      text = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return { ok: false, error: 'GCP_SERVICE_ACCOUNT_JSON_B64 is not valid base64' };
    }
  }
  if (!text) return { ok: false, error: 'Set GCP_SERVICE_ACCOUNT_JSON or GCP_SERVICE_ACCOUNT_JSON_B64' };
  try {
    const o = JSON.parse(text);
    if (!o.client_email || !o.private_key) {
      return { ok: false, error: 'Service account JSON must include client_email and private_key' };
    }
    return { ok: true, credentials: o };
  } catch (e) {
    return { ok: false, error: `Invalid service account JSON: ${e.message}` };
  }
}

function useVertexGemini() {
  if (GEMINI_PROVIDER === 'studio') return false;
  const saOk = !!(GCP_PROJECT_ID && hasVertexServiceAccountEnv());
  if (GEMINI_PROVIDER === 'vertex') return saOk;
  const v = String(process.env.GEMINI_USE_VERTEX || '')
    .trim()
    .toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return saOk;
  return false;
}

const GEMINI_MODEL_ID_ENV = String(process.env.GEMINI_MODEL_ID || '').trim();
function getGeminiModelId() {
  if (GEMINI_MODEL_ID_ENV) return GEMINI_MODEL_ID_ENV;
  return useVertexGemini() ? 'gemini-2.0-flash-001' : 'gemini-2.5-flash';
}

let cachedVertexAuthClient = null;

async function getVertexAccessToken() {
  const parsed = parseVertexServiceAccount();
  if (!parsed.ok) throw new Error(parsed.error);
  if (!cachedVertexAuthClient) {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: parsed.credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    cachedVertexAuthClient = await auth.getClient();
  }
  const tr = await cachedVertexAuthClient.getAccessToken();
  const token = tr && typeof tr === 'object' ? tr.token : tr;
  if (!token) throw new Error('Vertex: failed to obtain access token (check service account JSON and IAM).');
  return token;
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
if (!useVertexGemini() && !GEMINI_API_KEY) {
  console.warn(
    '[reachai-api] Set GEMINI_API_KEY (Google AI Studio) or opt into Vertex: GEMINI_PROVIDER=vertex or GEMINI_USE_VERTEX=1 plus GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_JSON[_B64]'
  );
}
if (RAW_CODES.length === 0 && EXTENSION_SECRET.length < 16) {
  console.warn(
    '[reachai-api] Set REACHAI_ACTIVATION_CODES and/or REACHAI_EXTENSION_SECRET (16+ chars) in .env for /auth/activate'
  );
}
if (EXTENSION_SECRET.length > 0 && EXTENSION_SECRET.length < 16) {
  console.warn('[reachai-api] REACHAI_EXTENSION_SECRET should be at least 16 characters.');
}
if (!useVertexGemini() && GEMINI_API_KEY && !GEMINI_API_KEY.startsWith('AIza')) {
  console.warn(
    '[reachai-api] GEMINI_API_KEY is set but does not start with "AIza" (typical for https://aistudio.google.com/app/apikey ). ' +
      'The server still calls Google AI Studio; if you get 401/403, switch to an AI Studio key or use Vertex (GEMINI_PROVIDER=vertex + GCP service account JSON).'
  );
}
const _wantVertexFlag = String(process.env.GEMINI_USE_VERTEX || '')
  .trim()
  .toLowerCase();
const _wantsVertexCfg =
  GEMINI_PROVIDER === 'vertex' || _wantVertexFlag === '1' || _wantVertexFlag === 'true' || _wantVertexFlag === 'yes';
if (_wantsVertexCfg && !GCP_PROJECT_ID) {
  console.warn('[reachai-api] Vertex requested but GCP_PROJECT_ID is missing');
}
if (_wantsVertexCfg && !hasVertexServiceAccountEnv()) {
  console.warn(
    '[reachai-api] Vertex requested (GEMINI_PROVIDER=vertex or GEMINI_USE_VERTEX) but GCP_SERVICE_ACCOUNT_JSON or GCP_SERVICE_ACCOUNT_JSON_B64 is missing'
  );
}
if (useVertexGemini()) {
  console.log('[reachai-api] Gemini: Vertex (GCP service account). GEMINI_API_KEY / AIza not required.');
}
if (LINKEDIN_CLIENT_ID && !LINKEDIN_CLIENT_SECRET) {
  console.warn('[reachai-api] LINKEDIN_CLIENT_ID set but LINKEDIN_CLIENT_SECRET missing — /oauth/linkedin/token will fail.');
}

const app = express();

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
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'reachai-api' });
});

/** Quick config check (no secrets returned). */
app.get('/api/v1/diagnose', (_req, res) => {
  const vertex = useVertexGemini();
  res.json({
    ok: true,
    port: PORT,
    bind: BIND_HOST,
    gemini_provider: vertex ? 'vertex' : 'google_ai_studio',
    gemini_provider_explicit: GEMINI_PROVIDER || 'studio_default',
    gemini_use_vertex_env: _wantsVertexCfg,
    has_gemini_key: !!GEMINI_API_KEY,
    gemini_key_looks_like_ai_studio: !!GEMINI_API_KEY && GEMINI_API_KEY.startsWith('AIza'),
    gemini_key_length: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
    vertex_project_configured: !!GCP_PROJECT_ID,
    vertex_service_account_configured: hasVertexServiceAccountEnv(),
    activation_codes_configured: RAW_CODES.length,
    extension_secret_configured: EXTENSION_SECRET.length >= 16,
    jwt_secret_ok: JWT_SECRET.length >= 16,
    linkedin_oauth_ready: !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET),
    gemini_model: getGeminiModelId(),
    gcp_location: GCP_LOCATION,
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
      { expiresIn: '10m', algorithm: 'HS256' }
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
      oauthSt = jwt.verify(stateKey, JWT_SECRET);
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
      { expiresIn: '3m', algorithm: 'HS256' }
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

app.post('/api/v1/oauth/linkedin/extension-flow/exchange', (req, res) => {
  const handoff = String(req.body?.handoff || '').trim();
  if (!handoff) return res.status(400).json({ error: 'Missing handoff.' });
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    return res.status(500).json({ error: 'Server JWT not configured.' });
  }
  let row;
  try {
    row = jwt.verify(handoff, JWT_SECRET);
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
    expiresIn: '30d'
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

app.post('/api/v1/auth/activate', (req, res) => {
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
  if (hasCodes && code && RAW_CODES.includes(code)) authorized = true;
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
    expiresIn: '30d'
  });
  return res.json({ access_token: token, token_type: 'Bearer', expires_in: 30 * 24 * 3600 });
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return res.status(401).json({ error: 'Missing Bearer token.' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfigured.' });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
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
        ' For Generative Language API use an API key from https://aistudio.google.com/app/apikey (typically starts with AIza), or configure Vertex (GCP).';
    }
    return { ok: false, status: response.status, text: detail + hint };
  }
  const data = await response.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) return { ok: false, status: 502, text: 'Empty model response' };
  return { ok: true, text: String(out).trim().replace(/^["'](.*)["']$/, '$1') };
}

async function callVertexGemini(prompt, generationConfig) {
  if (!GCP_PROJECT_ID) {
    return { ok: false, status: 503, text: 'Vertex requires GCP_PROJECT_ID in server .env' };
  }
  const sa = parseVertexServiceAccount();
  if (!sa.ok) return { ok: false, status: 503, text: sa.error };
  let token;
  try {
    token = await getVertexAccessToken();
  } catch (e) {
    return { ok: false, status: 503, text: `Vertex auth: ${e.message || e}` };
  }
  const url = `https://${encodeURIComponent(GCP_LOCATION)}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(GCP_PROJECT_ID)}/locations/${encodeURIComponent(GCP_LOCATION)}/publishers/google/models/${encodeURIComponent(getGeminiModelId())}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  if (!response.ok) {
    const raw = await response.text();
    const detail = parseGeminiErrorResponse(raw);
    let hint = '';
    if (response.status === 404) {
      hint += ` Check GEMINI_MODEL_ID (Vertex often uses a suffix, e.g. gemini-2.0-flash-001). Region: ${GCP_LOCATION}.`;
    }
    if (response.status === 403) {
      hint += ' Grant the service account Vertex AI User (roles/aiplatform.user).';
    }
    return { ok: false, status: response.status, text: detail + hint };
  }
  const data = await response.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) return { ok: false, status: 502, text: 'Empty model response (Vertex)' };
  return { ok: true, text: String(out).trim().replace(/^["'](.*)["']$/, '$1') };
}

async function callGemini(prompt, usage = 'generate') {
  const generationConfig = buildGeminiGenerationConfig(
    AI_USAGE.has(usage) ? usage : 'generate'
  );
  if (useVertexGemini()) {
    return callVertexGemini(prompt, generationConfig);
  }
  if (!GEMINI_API_KEY) {
    return {
      ok: false,
      status: 503,
      text:
        'GEMINI_API_KEY missing in server .env (default: Google AI Studio). For Vertex instead, set GEMINI_PROVIDER=vertex or GEMINI_USE_VERTEX=1 plus GCP_PROJECT_ID and service account JSON.'
    };
  }
  return callGoogleAiStudioGemini(prompt, generationConfig);
}

/** Extension sends the final prompt (same strings as your service worker). Server only holds the API key. */
app.post('/api/v1/ai/complete', authMiddleware, async (req, res) => {
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
    if (!useVertexGemini()) {
      console.log('[reachai-api] Gemini: Google AI Studio via GEMINI_API_KEY (default). Vertex: GEMINI_PROVIDER=vertex or GEMINI_USE_VERTEX=1 + GCP_* .');
    }
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
