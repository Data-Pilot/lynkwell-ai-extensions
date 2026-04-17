importScripts('lib/dp-bridge.js', 'lib/storage-manager.js', 'lib/channel-limits.js', 'lib/reach-api-default.js');

// ReachAI — Service worker: all AI calls go to your API (JWT); Gemini stays on the server.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DP_BRIDGE_SNAPSHOT') {
    handleDpBridgeSnapshot(message.payload)
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'ACTIVATE_CLOUD') {
    handleActivateCloud(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'GENERATE_NOTE') {
    handleGenerateNote(message.payload)
      .then((result) => sendResponse({ success: true, text: result.text, subject: result.subject }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'GENERATE_NOTE_AGENT') {
    handleAgentGenerateNote(message.payload)
      .then((result) =>
        sendResponse({
          success: true,
          text: result.text,
          subject: result.subject,
          agentTrace: result.agentTrace || ''
        })
      )
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'GET_RECOMMENDATION') {
    handleGetRecommendation(message.payload)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'CONFIRM_IDENTITY') {
    handleConfirmIdentity(message.payload)
      .then((result) => sendResponse({ success: true, text: result.text }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'LINKEDIN_OAUTH_START') {
    handleLinkedInOAuthStart()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'LINKEDIN_OAUTH_CLEAR') {
    StorageManager.clearLinkedInOAuth()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'ENHANCE_MISSION') {
    handleEnhanceMission(message.payload)
      .then((text) => sendResponse({ success: true, text }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleEnhanceMission(payload) {
  const raw = String(payload?.text || '').trim();
  if (!raw) throw new Error('Add some context first.');
  const prompt = `Rewrite this LinkedIn outreach "context" for clarity and impact. Keep every factual claim; do not invent employers, numbers, or clients. Max 120 words. Conversational but professional. Output ONLY the improved paragraph, no quotes or labels:\n\n${raw.slice(0, 3500)}`;
  return callAi(prompt, 'generate');
}

async function handleDpBridgeSnapshot(payload) {
  const rawC = payload && payload.dp_config;
  const rawL = payload && payload.dp_sent_log;
  const cfg = DpBridge.readDpConfigFromRaw(rawC);
  const sentLog = DpBridge.readSentLogFromRaw(rawL);
  const sess = await StorageManager.getCloudSession();
  const jwtSub = DpBridge.decodeJwtSub(sess && sess.token);
  const mongoMismatch =
    cfg &&
    cfg.mongo_user_id != null &&
    String(cfg.mongo_user_id).trim() &&
    jwtSub &&
    String(cfg.mongo_user_id).trim() !== String(jwtSub).trim();
  if (mongoMismatch) {
    await StorageManager.saveWebBridgeV1({
      updatedAt: Date.now(),
      mongoOk: false,
      config: null,
      effectiveContext: '',
      sentLog: []
    });
    return { ok: true, mongoOk: false };
  }
  const effectiveContext = DpBridge.effectiveContext(cfg || {});
  await StorageManager.saveWebBridgeV1({
    updatedAt: Date.now(),
    mongoOk: true,
    config: cfg || null,
    effectiveContext,
    sentLog
  });
  return { ok: true, mongoOk: true };
}

async function handleActivateCloud(payload) {
  const baseUrl = String(payload?.baseUrl || '').trim().replace(/\/$/, '');
  const code = String(payload?.code || '').trim();
  const extensionSecret = String(payload?.extensionSecret || '').trim();
  if (!baseUrl) throw new Error('API URL is required.');
  if (!code && !extensionSecret) {
    throw new Error(
      'Paste an activation code (e.g. LINKWELL-CHROME) or set REACHAI_EXTENSION_SECRET in lib/reach-api-default.js matching server .env.'
    );
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('API URL must start with http:// or https:// (e.g. http://127.0.0.1:3847).');
  }
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code || undefined, extensionSecret: extensionSecret || undefined })
    });
  } catch (e) {
    throw new Error(
      `Cannot reach ${baseUrl}. Start the API (cd server && npm start), check the URL, and add this host to manifest.json host_permissions if it is not localhost. (${e.message || e})`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Activation failed (${res.status})`);
  const token = data.access_token || data.accessToken;
  if (!token) throw new Error('Server did not return an access token.');
  const aiBase = String(payload?.aiBaseUrl || '').trim().replace(/\/$/, '');
  await StorageManager.saveCloudSession(baseUrl, token, aiBase || baseUrl);
}

async function getConfiguredApiBaseUrl() {
  const bundled =
    typeof REACHAI_DEFAULT_API_BASE !== 'undefined' && REACHAI_DEFAULT_API_BASE
      ? String(REACHAI_DEFAULT_API_BASE).trim().replace(/\/$/, '')
      : '';
  await StorageManager.migrateStaleLocalApiSession(bundled);
  const sess = await StorageManager.getCloudSession();
  if (sess?.baseUrl) return String(sess.baseUrl).trim().replace(/\/$/, '');
  if (bundled) return bundled;
  return '';
}

async function openSidePanelForLastFocusedWindow() {
  try {
    if (!chrome.sidePanel || !chrome.sidePanel.open) return;
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const wid = tabs[0] && tabs[0].windowId;
    if (wid == null) return;
    await chrome.sidePanel.open({ windowId: wid });
  } catch (e) {
    console.warn('[LynkWell] sidePanel.open:', e && e.message);
  }
}

/**
 * LinkedIn OAuth: redirect hits YOUR API (register callback URL on LinkedIn).
 * Issues ReachAI JWT + LinkedIn token without a prior activate session.
 */
async function handleLinkedInOAuthViaApiCallback() {
  const baseUrl = await getConfiguredApiBaseUrl();
  if (!baseUrl) {
    throw new Error(
      'Set your API URL in lib/reach-api-default.js (REACHAI_DEFAULT_API_BASE / REACHAI_MY_API_BASE_URL) so the extension can reach your backend.'
    );
  }
  const chromeDoneUrl = chrome.identity.getRedirectURL('linkedin');
  const startUrl = `${baseUrl}/api/v1/oauth/linkedin/extension-flow/start?chrome_done=${encodeURIComponent(
    chromeDoneUrl
  )}`;

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(url || '');
    });
  });

  if (!responseUrl) throw new Error('Sign-in was cancelled or returned no URL.');

  let finalUrl;
  try {
    finalUrl = new URL(responseUrl);
  } catch {
    throw new Error('Invalid final OAuth URL.');
  }

  const flowErr = finalUrl.searchParams.get('error');
  if (flowErr) {
    const d = finalUrl.searchParams.get('error_description') || '';
    throw new Error(decodeURIComponent(d) || flowErr);
  }

  const handoff = finalUrl.searchParams.get('handoff');
  if (!handoff) {
    throw new Error(
      'Missing handoff. Register the exact callback URL from GET /api/v1/oauth/linkedin/extension-flow/meta on your LinkedIn app, and set REACHAI_PUBLIC_URL (or LINKEDIN_EXT_FLOW_REDIRECT_URI) on the server to match.'
    );
  }

  let ex;
  try {
    ex = await fetch(`${baseUrl}/api/v1/oauth/linkedin/extension-flow/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoff })
    });
  } catch (e) {
    throw new Error(`Cannot reach ${baseUrl} for sign-in exchange. (${e.message || e})`);
  }
  const pack = await ex.json().catch(() => ({}));
  if (!ex.ok) throw new Error(pack.error || `Sign-in exchange failed (${ex.status})`);
  const reachjwt = pack.access_token || pack.accessToken;
  if (!reachjwt) throw new Error('Server did not return access_token.');
  const li = pack.linkedin || {};
  if (!li.access_token) throw new Error('Server did not return LinkedIn access_token.');

  const prev = await StorageManager.getCloudSession();
  const aiFollow =
    prev && prev.aiBaseUrl && String(prev.aiBaseUrl).replace(/\/$/, '') !== baseUrl
      ? String(prev.aiBaseUrl).trim().replace(/\/$/, '')
      : '';
  await StorageManager.saveCloudSession(baseUrl, reachjwt, aiFollow);

  const scopes =
    typeof LINKEDIN_OAUTH_SCOPES !== 'undefined' && LINKEDIN_OAUTH_SCOPES
      ? String(LINKEDIN_OAUTH_SCOPES).trim()
      : 'openid profile email';
  const expiresInSec = Number(li.expires_in) || 5184000;
  await StorageManager.saveLinkedInOAuth({
    accessToken: li.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    scope: li.scope || scopes
  });

  try {
    const ui = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${li.access_token}` }
    });
    if (ui.ok) {
      const j = await ui.json();
      await StorageManager.saveLinkedInProfile({
        sub: j.sub,
        name: j.name,
        email: j.email
      });
    }
  } catch {
    /* optional */
  }

  await openSidePanelForLastFocusedWindow();
}

/**
 * LinkedIn OAuth 2.0 (classic): redirect_uri is *.chromiumapp.org/linkedin.
 * Requires an existing ReachAI JWT (activate first).
 */
async function handleLinkedInOAuthStart() {
  const viaApi =
    typeof REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK !== 'undefined' && REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK;
  if (viaApi) return handleLinkedInOAuthViaApiCallback();

  const sess = await StorageManager.getCloudSession();
  if (!sess?.token) throw new Error('Complete LynkWell AI API setup first (Continue on the setup screen).');
  const clientId =
    typeof LINKEDIN_CLIENT_ID !== 'undefined' && LINKEDIN_CLIENT_ID
      ? String(LINKEDIN_CLIENT_ID).trim()
      : '';
  if (!clientId) throw new Error('Set LINKEDIN_CLIENT_ID in lib/reach-api-default.js (LinkedIn Developer Portal).');
  const redirectUri = chrome.identity.getRedirectURL('linkedin');
  const scopes =
    typeof LINKEDIN_OAUTH_SCOPES !== 'undefined' && LINKEDIN_OAUTH_SCOPES
      ? String(LINKEDIN_OAUTH_SCOPES).trim()
      : 'openid profile email';

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const authUrl =
    'https://www.linkedin.com/oauth/v2/authorization?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state
    }).toString();

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(url || '');
    });
  });

  if (!responseUrl) throw new Error('Sign-in was cancelled or returned no URL.');

  let url;
  try {
    url = new URL(responseUrl);
  } catch {
    throw new Error('Invalid OAuth redirect URL.');
  }
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const desc = url.searchParams.get('error_description') || '';
    throw new Error(`${oauthError}: ${decodeURIComponent(desc)}`);
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) throw new Error('No authorization code in redirect.');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — blocked for CSRF protection. Try again.');
  }

  const tr = await fetch(`${sess.baseUrl}/api/v1/oauth/linkedin/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sess.token}`
    },
    body: JSON.stringify({ code, redirect_uri: redirectUri })
  });
  const data = await tr.json().catch(() => ({}));
  if (!tr.ok) throw new Error(data.error || `Token exchange failed (${tr.status})`);
  if (!data.access_token) throw new Error('Server did not return an access_token.');

  const expiresInSec = Number(data.expires_in) || 5184000;
  await StorageManager.saveLinkedInOAuth({
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    scope: data.scope || scopes
  });

  try {
    const ui = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    if (ui.ok) {
      const j = await ui.json();
      await StorageManager.saveLinkedInProfile({
        sub: j.sub,
        name: j.name,
        email: j.email
      });
    }
  } catch {
    /* optional */
  }

  await openSidePanelForLastFocusedWindow();
}

async function callAi(prompt, usage = 'generate') {
  const sess = await StorageManager.getCloudSession();
  if (!sess?.token) {
    throw new Error(
      'API not connected. Open LynkWell AI setup: API URL + activation code, or configure REACHAI_EXTENSION_SECRET.'
    );
  }
  const aiHost = sess.aiBaseUrl || sess.baseUrl;
  let res;
  try {
    res = await fetch(`${aiHost}/api/v1/ai/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.token}`
      },
      body: JSON.stringify({ usage, prompt })
    });
  } catch (e) {
    throw new Error(
      `Cannot reach your AI API at ${aiHost}. Is it running? Add this host to manifest.json host_permissions if needed. (${e.message || e})`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API error (${res.status})`);
  if (!data.text) throw new Error('Empty response from your API.');
  return String(data.text).trim();
}

async function handleConfirmIdentity(payload) {
  const { name, headline } = payload;
  const prompt = `You are a helpful AI assistant setting up a LinkedIn outreach tool. 
Look at the user's name and headline, and summarize their professional identity in one engaging sentence starting with "I see you're a...". Do not use quotes.
Name: ${name}
Headline: ${headline}
`;
  const text = await callAi(prompt, 'confirm');
  return { text };
}

function formatTopExperienceForPrompt(profile, expBudget = 3200) {
  const xs = Array.isArray(profile?.experiences) ? profile.experiences : [];
  if (xs.length) {
    const lines = [];
    let budget = expBudget;
    xs.forEach((e, i) => {
      const line = `${i + 1}. ${e.summary || [e.title, e.company, e.dateRange, e.location].filter(Boolean).join(' — ')}`;
      const chunk = line.length > 520 ? `${line.slice(0, 517)}…` : line;
      if (budget <= 0) return;
      lines.push(chunk);
      budget -= chunk.length + 1;
    });
    return `Experience (${xs.length} roles scraped from profile page):\n${lines.join('\n')}`;
  }
  const e = profile && profile.topExperience;
  if (!e || (!e.title && !e.summary && !e.company)) {
    return 'Experience: (not parsed — headline/about still help.)';
  }
  if (e.summary) return `Experience:\n${e.summary}`;
  const parts = [
    e.title && `Title: ${e.title}`,
    e.company && `Company: ${e.company}`,
    e.dateRange && `Dates: ${e.dateRange}`,
    e.location && `Location: ${e.location}`,
    e.description && `Description: ${e.description}`
  ].filter(Boolean);
  return `Experience:\n${parts.join('\n')}`;
}

function formatEducationForPrompt(profile, maxLen = 1600) {
  const ed = Array.isArray(profile?.education) ? profile.education : [];
  if (!ed.length) return 'Education: (none parsed)';
  const lines = ed.map((e, i) => `${i + 1}. ${e.summary || [e.school, e.degree, e.dates].filter(Boolean).join(' — ')}`);
  return `Education:\n${lines.join('\n')}`.slice(0, maxLen);
}

function formatSkillsForPrompt(profile) {
  const sk = Array.isArray(profile?.skills) ? profile.skills : [];
  if (!sk.length) return 'Skills: (none parsed)';
  const joined = sk.join(', ');
  return `Skills (from profile): ${joined.length > 900 ? `${joined.slice(0, 897)}…` : joined}`;
}

function formatCertsForPrompt(profile) {
  const c = Array.isArray(profile?.certifications) ? profile.certifications : [];
  if (!c.length) return '';
  return `Licenses & certifications:\n${c.map((t, i) => `${i + 1}. ${t}`).join('\n')}`.slice(0, 800);
}

function formatLanguagesForPrompt(profile) {
  const lang = Array.isArray(profile?.languages) ? profile.languages : [];
  if (!lang.length) return '';
  return `Languages:\n${lang.join('\n')}`.slice(0, 500);
}

/** When the DOM misses action buttons, infer at least one channel so AI + UI never see all-false. */
function ensureAvailableChannelsOnProfile(profile) {
  const p = profile && typeof profile === 'object' ? { ...profile } : {};
  const ch0 = p.availableChannels || {};
  let connect = !!ch0.connect;
  let message = !!ch0.message;
  let inmail = !!ch0.inmail;
  if (!connect && !message && !inmail) {
    const deg = String(p.degree || '').toLowerCase();
    const open = !!p.isOpenProfile;
    if (deg.includes('1st')) {
      connect = true;
      message = true;
      inmail = open;
    } else {
      connect = true;
      inmail = open;
    }
  }
  p.availableChannels = { connect, message, inmail };
  return p;
}

function formatTargetRichContext(profile, opts) {
  const forRec = !!(opts && opts.forRecommendation);
  const p = profile || {};
  const about = (p.about || '').slice(0, forRec ? 5200 : 3200);
  const loc = p.location || '';
  const url = (p.profileUrl || '').trim();
  const certs = formatCertsForPrompt(p);
  const langs = formatLanguagesForPrompt(p);
  const ws = Array.isArray(p.websites) ? p.websites.filter(Boolean).slice(0, 10).join('\n') : '';
  const vol = (p.volunteerSummary || '').slice(0, 500);
  const hon = (p.honorsSummary || '').slice(0, 500);
  const rec = (p.recommendationsSummary || '').slice(0, 400);
  const contactBlock = [p.contactSummary && `Contact / links (visible): ${p.contactSummary}`, ws && `Websites:\n${ws}`]
    .filter(Boolean)
    .join('\n');
  return `Profile URL: ${url || '(unknown)'}
Name: ${p.name || ''}
Headline (summary line): ${p.headline || ''}
Current position / job title (from top experience if parsed): ${p.currentPosition || '—'}
Company (parsed): ${p.company || '—'}
Industry (if parsed): ${p.industry || '—'}
Profile location: ${loc || 'unknown'}
Followers (if visible): ${p.followers || '—'} | Network size (connections line if visible): ${p.connections || '—'}
${contactBlock ? `${contactBlock}\n` : ''}
About / bio (scraped from visible profile — use for personalization):
${about || '(empty on scrape — use headline + experience + education + skills below)'}

${formatTopExperienceForPrompt(p, forRec ? 4800 : 3200)}

${formatEducationForPrompt(p, forRec ? 2200 : 1600)}

${formatSkillsForPrompt(p)}
${certs ? `\n${certs}\n` : ''}${langs ? `${langs}\n` : ''}
${vol ? `Volunteer (summary):\n${vol}\n` : ''}${hon ? `Honors & awards (summary):\n${hon}\n` : ''}${rec ? `Recommendations (summary):\n${rec}\n` : ''}
Connection degree: ${p.degree || 'unknown'}
Mutual connections: ${p.mutualConnections ?? 0}
Open profile (free InMail / Open Profile badge): ${p.isOpenProfile ? 'Yes' : 'No'}
Profile action buttons detected (from page): Connect=${!!p.availableChannels?.connect}, Message=${!!p.availableChannels?.message}, InMail=${!!p.availableChannels?.inmail}`;
}

/** Rule-based fit % for all three channels (for UI when LinkedIn only exposed one button). */
function shadowChannelScores(profile) {
  return heuristicChannelScores(profile, { connect: true, message: true, inmail: true });
}

/** Strip repeated ``` / ```json wrappers (models often nest them). */
function stripMarkdownCodeFences(s) {
  let t = String(s ?? '').trim();
  for (let n = 0; n < 12; n++) {
    const before = t;
    t = t.replace(/^\s*```(?:json|javascript|js|JSON)?\s*/i, '').trim();
    t = t.replace(/\s*```\s*$/i, '').trim();
    if (t === before) break;
  }
  t = t.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return t;
}

function parseJsonObjectFromModelText(raw) {
  if (raw == null) throw new Error('empty');
  let s = stripMarkdownCodeFences(raw);
  const tryParse = (chunk) => JSON.parse(chunk);
  try {
    return tryParse(s);
  } catch {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      return tryParse(s.slice(i, j + 1));
    }
    throw new Error('no json object');
  }
}

/** InMail / mistaken JSON output: subject + body. Returns null if not parseable. */
function tryParseInMailPayload(rawText) {
  try {
    const parsed = parseJsonObjectFromModelText(rawText);
    let subject = String(parsed.subject ?? parsed.Subject ?? parsed.email_subject ?? '').trim();
    let body = String(
      parsed.body ?? parsed.Body ?? parsed.message ?? parsed.text ?? parsed.content ?? ''
    ).trim();
    if (!body && parsed.email_body) body = String(parsed.email_body).trim();
    if (parsed.data && typeof parsed.data === 'object') {
      const d = parsed.data;
      if (!subject) subject = String(d.subject ?? d.Subject ?? '').trim();
      if (!body) body = String(d.body ?? d.Body ?? d.message ?? d.text ?? '').trim();
    }
    if (!body) return null;
    return { subject, body };
  } catch {
    return null;
  }
}

function heuristicBestChannelFromScores(scores, ch) {
  const pairs = [];
  if (ch.connect && scores.connection != null) pairs.push(['connection', scores.connection]);
  if (ch.message && scores.message != null) pairs.push(['message', scores.message]);
  if (ch.inmail && scores.inmail != null) pairs.push(['inmail', scores.inmail]);
  pairs.sort((a, b) => b[1] - a[1]);
  if (pairs.length) return pairs[0][0];
  if (ch.message) return 'message';
  if (ch.connect) return 'connection';
  if (ch.inmail) return 'inmail';
  return 'connection';
}

function heuristicChannelScores(profile, ch) {
  const deg = String(profile?.degree || '').toLowerCase();
  const open = !!profile?.isOpenProfile;
  const mutual = Number(profile?.mutualConnections) || 0;
  const hasAbout = String(profile?.about || '').trim().length > 100;
  let msg = 44;
  let conn = 48;
  let inm = 46;
  if (deg.includes('1st')) {
    msg += 36;
    conn += 12;
    inm += 6;
  } else if (deg.includes('2nd')) {
    msg -= 18;
    conn += 26;
    inm += 20;
  } else {
    conn += 24;
    inm += 22;
    msg -= 22;
  }
  if (open) inm += 14;
  if (mutual > 0) {
    conn += Math.min(14, 4 + mutual / 4);
    msg += Math.min(10, mutual / 6);
  }
  if (hasAbout) {
    inm += 6;
    conn += 4;
  }
  const clip = (n) => Math.max(22, Math.min(96, Math.round(n)));
  return {
    inmail: ch.inmail ? clip(inm) : null,
    connection: ch.connect ? clip(conn) : null,
    message: ch.message ? clip(msg) : null
  };
}

function mergeAiChannelScores(parsed, profile, ch) {
  const h = heuristicChannelScores(profile, ch);
  const raw = parsed && parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
  const read = (key, altKeys) => {
    for (const k of [key, ...altKeys]) {
      if (raw[k] == null) continue;
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n >= 1 && n <= 100) return Math.round(n);
    }
    return null;
  };
  return {
    inmail: ch.inmail ? read('inmail', ['InMail', 'inMail']) ?? h.inmail : null,
    connection: ch.connect ? read('connection', ['Connection', 'connect']) ?? h.connection : null,
    message: ch.message ? read('message', ['Message', 'dm', 'DM']) ?? h.message : null
  };
}

const ALLOWED_AI_TONES = new Set(['professional', 'casual', 'direct']);

function fallbackAgentDeepWhenParseFails(profile, ch, scores) {
  const channel = heuristicBestChannelFromScores(scores, ch);
  const deg = String(profile?.degree || '').toLowerCase();
  let recommendedTone = 'professional';
  let toneRationale =
    'Offline rules: prioritize clarity and respect; the model reply did not parse as JSON so tone is inferred from relationship + channel.';
  let agentPick =
    'Retry for a full agent JSON reply—meanwhile we ranked channels with built-in signals (degree, mutuals, About, Open Profile).';
  if (channel === 'message' && deg.includes('1st')) {
    recommendedTone = 'casual';
    toneRationale =
      'First-degree DMs usually work better warm and specific—casual fits that social distance.';
    agentPick =
      'Best pairing: message + casual tone—you share a 1st-degree link, so lean human and concrete.';
  } else if (channel === 'inmail') {
    recommendedTone = 'professional';
    toneRationale = 'InMail is skimmed like email—professional, tight, and proof-led usually wins.';
    agentPick = 'Best pairing: InMail + professional tone for a paid slot that must earn a reply.';
  } else if (channel === 'connection') {
    recommendedTone = deg.includes('1st') ? 'casual' : 'professional';
    toneRationale = deg.includes('1st')
      ? 'On Connect even with a 1st tie, keep the note short and friendly—slightly casual can feel personal.'
      : 'Cold or weak tie: a crisp professional connect note reduces friction.';
    agentPick =
      deg.includes('1st') && ch.connect
        ? 'Connect note + easygoing tone: bounded ask, still sounds like a peer.'
        : 'Connect + professional tone is the default bridge when DM/InMail are not the strongest detected path.';
  }
  if (!ALLOWED_AI_TONES.has(recommendedTone)) recommendedTone = 'professional';
  const targetAnalysis =
    '• JSON parse failed—scores use offline rules (degree, mutuals, About, Open Profile).\n• Reload the profile page and reopen the panel, or check the recommend call in your API logs.';
  return {
    targetAnalysis,
    recommendedTone,
    toneRationale,
    agentPick,
    channelPlans: { inmail: null, connection: null, message: null }
  };
}

function normalizeOneChannelPlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const whenToUse = String(raw.whenToUse || raw.summary || raw.fit || raw.useWhen || '').trim();
  const toneTip = String(raw.toneTip || raw.tone || '').trim();
  const avoid = String(raw.avoid || raw.pitfall || '').trim();
  if (!whenToUse && !toneTip && !avoid) return null;
  return {
    whenToUse: whenToUse.slice(0, 140),
    toneTip: toneTip.slice(0, 120),
    avoid: avoid.slice(0, 120)
  };
}

function extractDeepRecommendation(parsed, ch) {
  const targetAnalysis = String(parsed?.targetAnalysis || parsed?.analysis || '').trim().slice(0, 420);
  let recommendedTone = String(parsed?.recommendedTone || parsed?.tone || '').toLowerCase().trim();
  if (!ALLOWED_AI_TONES.has(recommendedTone)) recommendedTone = '';
  const toneRationale = String(parsed?.toneRationale || parsed?.toneWhy || '').trim().slice(0, 120);
  const agentPick = String(
    parsed?.agentPick || parsed?.channelTonePick || parsed?.bestPairing || parsed?.agentSummary || ''
  )
    .trim()
    .slice(0, 160);
  const plansRaw = parsed?.channelPlans || parsed?.perChannelGuidance || parsed?.guidance || {};
  const channelPlans = {
    inmail: ch.inmail ? normalizeOneChannelPlan(plansRaw.inmail || plansRaw.InMail) : null,
    connection: ch.connect ? normalizeOneChannelPlan(plansRaw.connection || plansRaw.Connect) : null,
    message: ch.message ? normalizeOneChannelPlan(plansRaw.message || plansRaw.dm || plansRaw.DM) : null
  };
  return { targetAnalysis, recommendedTone, toneRationale, agentPick, channelPlans };
}

function emptyDeepRecommendation() {
  return {
    targetAnalysis: '',
    recommendedTone: '',
    toneRationale: '',
    agentPick: '',
    channelPlans: { inmail: null, connection: null, message: null }
  };
}

async function handleGetRecommendation(payload) {
  let { profile, identity } = payload;
  profile = ensureAvailableChannelsOnProfile(profile);
  if (!identity || !identity.role) {
    throw new Error('Missing profile setup. Open LynkWell AI and complete your name and role.');
  }
  const settings = await StorageManager.getSettings();
  const missionExcerpt = settings.mission ? String(settings.mission).trim().slice(0, 800) : '';
  const webT = await StorageManager.getWebBridgeTone();
  const webToneLine = webT
    ? `\nCOMMAND CENTER (WEB) PREFERRED TONE: ${webT} — align recommendedTone unless clearly wrong for this target.\n`
    : '';
  const kbFull = await StorageManager.getFullContext(identity);
  const kbExcerpt = String(kbFull || '')
    .trim()
    .slice(0, 12000);
  const ch = profile.availableChannels || {};
  const channelsLine = `Available UI actions on this profile page: connect=${!!ch.connect}, message=${!!ch.message}, inmail=${!!ch.inmail}. You MUST set "channel" to one of these that is true. If only connect is true, use "connection".`;

  const hasKbRec = await StorageManager.hasKnowledgeBaseContent();
  const kbBlock = hasKbRec
    ? `══ SENDER KNOWLEDGE BASE (mission + uploaded files + notes) — EQUAL WEIGHT TO LINKEDIN TARGET ══
You MUST use this block for channel scores, tone, and "reason". Ignoring it when it is non-empty is a failure.
${kbExcerpt}

`
    : kbExcerpt.length > 24
      ? `══ SENDER CONTEXT (name/role; add mission/files/notes in Edit Settings for richer picks) ══
${kbExcerpt}

`
      : `══ SENDER KNOWLEDGE BASE ══
No mission, files, or notes saved yet — infer fit only from sender name/role below plus the target.

`;

  const prompt = `${kbBlock}${webToneLine}
You are LynkWell's autonomous LinkedIn outreach AGENT.

You receive TWO primary signals — treat them as **equally important**:
• (A) SENDER KNOWLEDGE BASE / context (at the very top of this prompt): who the user is, who they sell to, ICP, proof, taboos.
• (B) TARGET LinkedIn profile (later in this prompt): who the member is, seniority, industry, relationship, hooks.

Your job: recommend ONE best channel AND ONE best tone for the first touch — as a coordinated pair. **Do not** decide from LinkedIn alone when (A) is non-empty.

${channelsLine}

WORKFLOW (think through all steps — output only the JSON, no prose outside it):
0) KB FIRST: If the KB block above is non-empty, extract 2–4 anchors (ICP, offer, vertical, tone guardrails). These MUST influence scores and the final channel — not optional context.
1) TARGET DEPTH: Infer seniority, function, industry momentum, geo, voice (headline + About keywords), credibility signals (followers, open profile, recommendations), and 1–2 concrete hooks worth referencing.
2) RELATIONSHIP: Use connection degree, mutual count, and which UI actions exist — cold vs warm paths.
3) SENDER–TARGET FIT (KB ∩ TARGET): Where does the KB overlap the target's world (pain, initiative, shared domain, same vertical)? If KB implies one ecosystem and the target implies a poor fit for a generic connect, **down-rank** connection unless the story still wins on merit.
3b) NO DEGREE-ONLY DEFAULTS: Do **not** pick "connection" as the best channel **only** because the relationship is 2nd or 3rd degree. Prefer **message** when it is true and the story is peer / warm / same-world. Prefer **inmail** when it is true and the narrative fits (e.g. open profile, strong value prop). Choose **connection** when it is still the best story (credible tie, only option, or clear bridge) — justify from **profile + KB content**, never from degree alone.
4) PER CHANNEL: For EACH channel that is TRUE in the availability line, fill channelPlans with **three very short phrases** (not paragraphs): whenToUse (why/when that channel fits *this* target), toneTip (tone for that channel here), avoid (one pitfall). **Max ~12 words each.** If a channel is false in availability, its plan must be null.
5) JOINT DECISION: Pick the single best "channel" (connection | message | inmail) AND matching recommendedTone (professional | casual | direct) so they fit together (e.g. cold InMail often professional; warm DM to peer may be casual).
6) SCORES: Integer 22–96 per TRUE channel. Higher = stronger expected reply / fit for this pair. **Down-rank** a channel when sender/target context makes it a weak or awkward choice even if LinkedIn exposes the button.
7) agentPick: ONE line (max **140 chars**): name the chosen channel (Connect / DM / InMail) + tone + the single strongest reason tied to **this profile**.
8) BREVITY (critical): No long prose anywhere. Use **newline-separated bullet lines** where specified. Each bullet line starts with "• " (bullet + space). Stay profile-specific (headline, role, About keywords, degree, open profile).

Tone meanings for the model: professional = 💼 polished, credible, low-risk; casual = ☕ human, warm, conversational; direct = ⚡ brief, CTA-first, minimal fluff.

SENDER (structured — cross-check with KB block above):
Name: ${identity.name || ''}
Role: ${identity.role}
Strategic goal (may overlap KB): ${missionExcerpt || '(not set — infer from KB + role)'}

TARGET (scraped live — use all sections):
${formatTargetRichContext(profile, { forRecommendation: true })}

Scoring must reflect **KB + target + relationship together**. Unavailable channels: null in scores AND null in channelPlans.

Output ONLY valid JSON (no markdown, no trailing commentary):
{
  "channel": "connection" | "message" | "inmail",
  "reason": "string: EXACTLY 3 lines separated by newline characters. Each line MUST start with the bullet dot • then a space, max 72 chars per line. Line1: why THIS channel (Connect vs DM vs InMail) wins on this page—if only one LinkedIn action is available, say so in one short bullet. Line2: one KB/mission/sender anchor (or role if KB empty) plus one concrete target fact (headline, About, or role). Line3: one opener angle tied to their profile.",
  "scores": { "inmail": number | null, "connection": number | null, "message": number | null },
  "targetAnalysis": "string: EXACTLY 2 or 3 lines separated by newlines; each line starts with • then space, max 68 chars per line—profile hooks only, do not repeat reason.",
  "recommendedTone": "professional" | "casual" | "direct",
  "toneRationale": "string: ONE line, max 90 characters (optional leading • )",
  "agentPick": "string, ≤140 chars: channel + tone + profile-tied reason",
  "channelPlans": {
    "inmail": { "whenToUse": "≤12 words", "toneTip": "≤12 words", "avoid": "≤12 words" } | null,
    "connection": { "whenToUse": "≤12 words", "toneTip": "≤12 words", "avoid": "≤12 words" } | null,
    "message": { "whenToUse": "≤12 words", "toneTip": "≤12 words", "avoid": "≤12 words" } | null
  }
}`;

  const shadowScores = shadowChannelScores(profile);
  const jsonText = await callAi(prompt, 'recommend');
  try {
    const parsed = parseJsonObjectFromModelText(jsonText);
    const allowed = [];
    if (ch.connect) allowed.push('connection');
    if (ch.message) allowed.push('message');
    if (ch.inmail) allowed.push('inmail');
    if (!allowed.length) {
      const scores0 = heuristicChannelScores(profile, ch);
      const empty0 = emptyDeepRecommendation();
      return {
        channel: 'connection',
        reason: 'Inferred outreach options from profile context.',
        scores: scores0,
        shadowScores,
        ...empty0
      };
    }
    const scores = mergeAiChannelScores(parsed, profile, ch);
    const deep = extractDeepRecommendation(parsed, ch);
    const reason = String(parsed.reason || '').trim().slice(0, 520) || 'Recommended channel.';
    if (allowed.length && !allowed.includes(parsed.channel)) {
      return {
        channel: allowed[0],
        reason: 'Adjusted to match actions available on this profile.',
        scores,
        shadowScores,
        ...deep
      };
    }
    return { channel: parsed.channel, reason, scores, shadowScores, ...deep };
  } catch (e) {
    console.error('Failed to parse recommendation JSON', e && e.message, jsonText?.slice?.(0, 500));
    const scores = heuristicChannelScores(profile, ch);
    const fb = fallbackAgentDeepWhenParseFails(profile, ch, scores);
    const reason =
      'Agent reply was not valid JSON (extra prose, markdown, or a truncated API response). Rule-based scores are shown; retry after the profile fully loads.';
    return {
      channel: heuristicBestChannelFromScores(scores, ch),
      reason,
      scores,
      shadowScores,
      ...fb
    };
  }
}

function fallbackResearchMemo(profile) {
  const headline = String(profile?.headline || '').trim() || '—';
  const name = String(profile?.name || 'This member').trim();
  return {
    personSummary: `${name} — ${headline}`.slice(0, 620),
    angles: [
      `Headline anchor: ${headline.slice(0, 160)}`,
      'Find one credible overlap between their visible work and your positioning (from KB).'
    ],
    risks: ['Do not invent employers, shared history, or DMs not visible in the scrape.'],
    factsToCite: headline !== '—' ? [headline.slice(0, 200)] : [],
    kbHooks: []
  };
}

function fallbackFitBlock() {
  return {
    fitScore: 72,
    fitRationale: 'Pipeline fallback — lean on concrete profile facts and KB themes.',
    draftDirectives: [
      'Open with one specific target fact and one KB-aligned value line.',
      'Single CTA matched to the selected channel.',
      'Match the selected tone throughout.'
    ]
  };
}

async function composeNoteGenerationPrompt(payload, extraBlock) {
  let { channel, tone, profile, identity, outreach } = payload;
  profile = ensureAvailableChannelsOnProfile(profile);
  if (!identity || !identity.name) {
    throw new Error('Missing profile setup. Open LynkWell AI and complete your name and role.');
  }
  const wbTone = await StorageManager.getWebBridgeTone();
  if (wbTone) tone = wbTone;
  outreach = outreach && typeof outreach === 'object' ? outreach : {};
  const mode = outreach.mode === 'bridge' ? 'bridge' : 'intro';
  const hasPrior = !!outreach.hasPriorSend;
  const priorTs =
    typeof outreach.priorSentAt === 'number' && outreach.priorSentAt > 0
      ? new Date(outreach.priorSentAt).toISOString()
      : 'none';
  const pathCh = String(outreach.pathChannel || channel || 'connection').toLowerCase();
  const pathLabel =
    pathCh === 'message' ? 'Message' : pathCh === 'inmail' ? 'InMail' : 'Connection request';

  const contextText = await StorageManager.getFullContext(identity);
  const kbTrim = (contextText || '').trim();
  const hasKb = await StorageManager.hasKnowledgeBaseContent();
  const knowledgeBlock = hasKb
    ? `YOUR KNOWLEDGE BASE (mission, uploaded files, additional notes — you MUST tie the draft to this when relevant; quote themes or vocabulary, not long passages):\n${contextText}`
    : kbTrim.length > 40
      ? `SENDER CONTEXT (name/role — add mission, files, and notes via Edit Settings in the extension for stronger positioning):\n${contextText}`
      : `YOUR KNOWLEDGE BASE: Add your mission, uploaded documents, and additional notes under **Edit Settings** so drafts match how you sell and who you help. For this message, still write a highly specific note using the TARGET section below plus sender name/role. Reference at least TWO concrete facts from the target (headline, about, experience, location, or mutuals). Avoid generic openers without a specific follow-up.`;

  const positiveExamples = await StorageManager.getPositiveExamples(channel, tone, 5);
  const negativeExamples = await StorageManager.getNegativeExamples(channel, tone, 5);

  const L =
    typeof REACH_CHANNEL_LIMITS !== 'undefined'
      ? REACH_CHANNEL_LIMITS
      : { connection: 300, message: 800, inmailCombined: 2000 };
  let constraints = '';
  if (channel === 'connection') {
    constraints = `Max ${L.connection} characters (LinkedIn connection note cap). No subject line. One hook + clear connect ask.`;
  } else if (channel === 'inmail') {
    constraints = `JSON with "subject" (short, punchy, under ~${L.inmailSubjectHint} chars) and "body". Subject + body combined must stay under ${L.inmailCombined} characters total. Value proposition + clear CTA.`;
  } else {
    constraints = `Conversational 1st-degree DM: aim 400–${L.message} characters (stay under ${L.message}). Specific inquiry or follow-up, clear CTA. No subject line.`;
  }

  let examplesStr = '';
  if (positiveExamples.length > 0) {
    examplesStr += 'MESSAGES THIS USER LIKED (match this style):\n';
    positiveExamples.forEach((ex, i) => (examplesStr += `${i + 1}. ${ex.generatedText}\n`));
  }
  if (negativeExamples.length > 0) {
    examplesStr +=
      '\nMESSAGES THIS USER DISLIKED (thumbs-down — do not reuse their wording; infer what felt wrong: too salesy, too long, too generic, wrong tone, etc.):\n';
    negativeExamples.forEach((ex, i) => (examplesStr += `${i + 1}. ${ex.generatedText}\n`));
  }

  const negCorrectionBlock =
    negativeExamples.length > 0
      ? `
USER FEEDBACK — NOT HELPFUL: The drafts above were rejected. This NEW message must read clearly better to a skeptical reader:
- Prefer plain, concrete language over jargon, buzzwords, or "AI polish".
- Shorter sentences; one primary ask; easy to skim on mobile.
- Keep every personalization fact accurate; do not invent rapport.
- Stay on TONE=${tone}: if professional → credible and human, not stiff; if casual → natural, not try-hard; if direct → brief and respectful, not cold or robotic.
`
      : '';

  const outreachBlock = `LINKEDIN CONTEXT (Chrome extension only — local history, not CRM):
- Thread style: ${
    mode === 'bridge'
      ? 'Follow-up — the user previously saved a send for this same /in/ profile in the extension. Write like a natural LinkedIn follow-up (DM, InMail, or connect thread). Do not sound like a first cold ping unless the chosen channel clearly needs a fresh angle.'
      : 'First save — no prior send saved in the extension for this profile URL. Write a clear first LinkedIn touch for this relationship (degree + channel shown on the page).'
  }
- Saved send in extension before: ${hasPrior ? 'yes' : 'no'}
- Last saved send time (ISO, or none): ${priorTs}
- Channel selected in the extension (from AI recommendation or user): ${pathLabel} (${channel})

`;

  const agentSection = String(extraBlock || '').trim();

  const prompt = `You are a LinkedIn outreach expert who writes genuine, human-sounding messages.

${agentSection ? `${agentSection}\n\n` : ''}Read the **first** block below (knowledge base / sender context) before the target — when it is substantive, your angle and vocabulary must align with it; still ground every line in the TARGET section.

${knowledgeBlock}

${outreachBlock}TASK: Write a ${channel === 'connection' ? 'Connection Request' : channel === 'inmail' ? 'InMail' : 'Direct Message'} for LinkedIn.
CONSTRAINTS: ${constraints}
TONE: ${tone === 'professional' ? 'Formal, value-driven, industry-relevant' : tone === 'casual' ? 'Warm, human, relatable' : 'Direct, brief, CTA-first'}

RULES (non-negotiable):
1) Use the TARGET block below: cite or clearly allude to at least TWO specific facts from their headline, About, any listed experience roles, education, skills, certifications, languages, location, or mutuals — not vague compliments.
2) When the knowledge base at the top is non-empty, connect your angle to it (what they sell, who they help, mission, or uploaded doc themes). When it is sparse, still stay specific to the target only.
3) Write in first person as the sender. No subject line unless InMail JSON requires it.
4) If the sender’s KB implies a specific vertical or motion (e.g. tech ecosystem, founder, agency) and a generic “connect” angle would feel mismatched to the target’s headline/About, do **not** lean on vague flattery — be specific or acknowledge the gap honestly in the copy for the **channel the user already selected** in the extension.

${examplesStr ? '\n' + examplesStr : ''}${negCorrectionBlock}

FROM SENDER (structured):
Name: ${identity.name}
Role: ${identity.role}

TO TARGET (scraped from their LinkedIn profile — this is your primary personalization source):
${formatTargetRichContext(profile)}
Primary company / employer line (if parsed): ${profile.company || '—'}

${channel === 'inmail'
  ? "OUTPUT INSTRUCTION: Output ONLY a valid JSON object strictly with two keys: 'subject' and 'body'. Do not output markdown blocks or extra text."
  : 'OUTPUT INSTRUCTION: Output ONLY the message text. No quotes, no markdown blocks, no extra labels.'}`;

  const aiUsage = channel === 'inmail' ? 'generate_structured' : 'generate';
  return { prompt, aiUsage, channel };
}

function runNoteGenerationParse(channel, rawStr) {
  const s = String(rawStr ?? '').trim();
  if (channel === 'inmail') {
    const mail = tryParseInMailPayload(s);
    if (mail) return { text: mail.body, subject: mail.subject };
    console.error('[LynkWell] InMail JSON parse failed; first 500 chars:', s.slice(0, 500));
    return { text: s, subject: '' };
  }

  const looksLikeInMailJson =
    /```(?:json)?/i.test(s) ||
    (/^\s*\{/.test(s) && /"body"\s*:/.test(s)) ||
    (/^\s*\{/.test(s) && /"subject"\s*:/.test(s));
  if (looksLikeInMailJson) {
    const mail = tryParseInMailPayload(s);
    if (mail && mail.body) return { text: mail.body, subject: mail.subject || '' };
    try {
      const o = parseJsonObjectFromModelText(s);
      const lone = String(o.body || o.message || o.text || o.content || '').trim();
      if (lone) return { text: lone };
    } catch {
      /* fall through */
    }
  }

  return { text: s };
}

function emitGenerateProgress(data) {
  try {
    chrome.runtime.sendMessage({ type: 'LINKWELL_GENERATE_PROGRESS', ...data }, () => void chrome.runtime.lastError);
  } catch (_) {
    /* no extension page listening */
  }
}

async function handleGenerateNote(payload) {
  const { prompt, aiUsage, channel } = await composeNoteGenerationPrompt(payload, '');
  const rawStr = String((await callAi(prompt, aiUsage)) ?? '').trim();
  return runNoteGenerationParse(channel, rawStr);
}

async function handleAgentGenerateNote(payload) {
  const runId = String(payload?.agentRunId || '').trim() || `gen-${Date.now()}`;
  const emit = (step, label, detail) =>
    emitGenerateProgress({ runId, step, label, detail: detail || '' });

  let { channel, tone, profile, identity } = payload;
  profile = ensureAvailableChannelsOnProfile(profile);
  if (!identity || !identity.name) {
    throw new Error('Missing profile setup. Open LynkWell AI and complete your name and role.');
  }

  emit(1, 'Researching target…', 'Profile + knowledge base');

  const contextText = await StorageManager.getFullContext(identity);
  const kbForAgent = String(contextText || '').trim().slice(0, 8000);
  const profileBlock = formatTargetRichContext(profile);

  const researchPrompt = `You are a senior GTM researcher preparing one LinkedIn touch.
OUTPUT ONLY valid JSON (no markdown) with this exact structure:
{
  "personSummary": "3-5 sentences: who they are professionally, what they likely optimize for",
  "angles": ["3-6 strings — concrete opener angles, each tied to a visible profile fact"],
  "risks": ["2-5 strings — assumptions or topics to avoid"],
  "factsToCite": ["4-10 short strings — literal facts from the scrape worth referencing"],
  "kbHooks": ["0-6 strings — how sender knowledge intersects this person; empty array if KB is thin"]
}

SENDER KNOWLEDGE (mission + files + notes):
${kbForAgent || '(none saved yet)'}

TARGET PROFILE:
${profileBlock}
`;

  let researchObj;
  try {
    researchObj = parseJsonObjectFromModelText(await callAi(researchPrompt, 'agent_step'));
  } catch (e) {
    console.warn('[LynkWell] agent research failed', e && e.message);
    researchObj = null;
  }
  if (!researchObj || typeof researchObj !== 'object' || !String(researchObj.personSummary || '').trim()) {
    researchObj = fallbackResearchMemo(profile);
  }
  ['angles', 'risks', 'factsToCite', 'kbHooks'].forEach((k) => {
    if (!Array.isArray(researchObj[k])) researchObj[k] = [];
  });

  emit(2, 'Scoring fit…', `${channel} · ${tone}`);

  const fitPrompt = `Score one outbound LinkedIn touch before it is written.
OUTPUT ONLY valid JSON:
{
  "fitScore": 0-100 integer,
  "fitRationale": "2-3 sentences mixing sender KB and target research",
  "draftDirectives": ["3-5 imperative bullets for the writer"]
}

SELECTED_CHANNEL: ${channel}
SELECTED_TONE: ${tone}

SENDER_KB:
${kbForAgent.slice(0, 6000)}

RESEARCH_JSON:
${JSON.stringify(researchObj).slice(0, 7000)}
`;

  let fitObj;
  try {
    fitObj = parseJsonObjectFromModelText(await callAi(fitPrompt, 'agent_step'));
  } catch (e) {
    console.warn('[LynkWell] agent fit failed', e && e.message);
    fitObj = null;
  }
  if (!fitObj || typeof fitObj !== 'object') fitObj = fallbackFitBlock();
  if (!Array.isArray(fitObj.draftDirectives)) fitObj.draftDirectives = fallbackFitBlock().draftDirectives;
  const fs0 = Number(fitObj.fitScore);
  fitObj.fitScore = Number.isFinite(fs0) ? Math.max(0, Math.min(100, Math.round(fs0))) : 72;

  emit(3, 'Drafting message…', 'Research + fit applied');

  const agentInject = `STEP 1 — RESEARCH (JSON — use internally; do not paste JSON labels into the outbound message):
${JSON.stringify(researchObj).slice(0, 7500)}

STEP 2 — FIT (JSON):
${JSON.stringify(fitObj).slice(0, 3500)}
`;

  const { prompt: draftPrompt, aiUsage } = await composeNoteGenerationPrompt(payload, agentInject);
  const draftRaw = String((await callAi(draftPrompt, aiUsage)) ?? '').trim();
  let draft = runNoteGenerationParse(channel, draftRaw);

  emit(4, 'Self-check…', 'Accuracy + tone pass');

  let reviewIssues = [];
  try {
    const reviewPrompt = `You are a strict LinkedIn outreach editor. Channel is fixed to ${channel}; tone target is ${tone}.
Revise the draft only if it improves clarity, specificity, or safety. Do not change the outreach channel type.

OUTPUT ONLY valid JSON:
{
  "passed": true,
  "issues": ["0-5 short strings"],
  "finalBody": "message body after edits",
  "finalSubject": "InMail subject line or empty string if not InMail"
}

RULES: finalBody must still reflect at least TWO items from factsToCite (paraphrase ok). No markdown in final fields.

factsToCite:
${JSON.stringify((researchObj.factsToCite || []).slice(0, 14))}

CURRENT_BODY:
${String(draft.text || '').slice(0, 6000)}

CURRENT_SUBJECT:
${String(draft.subject || '').slice(0, 400)}
`;
    const rev = parseJsonObjectFromModelText(await callAi(reviewPrompt, 'agent_step'));
    const fb = String(rev.finalBody || '').trim();
    const fsj = String(rev.finalSubject || '').trim();
    if (Array.isArray(rev.issues)) reviewIssues = rev.issues.map((x) => String(x || '').trim()).filter(Boolean);
    if (fb) {
      draft =
        channel === 'inmail'
          ? { text: fb, subject: fsj || draft.subject || '' }
          : { text: fb, subject: '' };
    }
  } catch (e) {
    console.warn('[LynkWell] agent review failed', e && e.message);
  }

  emit(5, 'Almost done…', '');

  const agentTrace = `Deep agent · fit ${fitObj.fitScore}/100${
    reviewIssues.length ? ` · ${reviewIssues.length} polish note${reviewIssues.length === 1 ? '' : 's'}` : ' · review clean'
  }`;
  return { ...draft, agentTrace };
}
