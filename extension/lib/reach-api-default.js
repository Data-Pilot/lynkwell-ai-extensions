/**
 * LynkWell AI → your backend (Auth + optional separate AI host).
 *
 * Saved session in chrome.storage overrides these defaults after the user activates once.
 *
 * Paths: POST /api/v1/auth/activate, /api/v1/oauth/linkedin/token, /api/v1/ai/complete,
 *       GET /api/v1/oauth/linkedin/extension-flow/* (when REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK)
 */

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ONE PLACE — your API base URLs (no trailing slash)                      ║
// ║  Default: Vercel API (no trailing slash). For local API use               ║
// ║  http://127.0.0.1:3847 and add that origin to extension/manifest.json.   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
var REACHAI_MY_API_BASE_URL = 'https://lynkwell-ai-extensions.vercel.app';
// var REACHAI_MY_API_BASE_URL = 'http://127.0.0.1:3847';
// Command Center (dp_config bridge) stays on outreach-tool-nine-omega unless you change manifest + dp-bridge.
var REACHAI_MY_AI_API_BASE_URL = '';
/** Must match one entry in server .env REACHAI_ACTIVATION_CODES (comma-separated). */
var REACHAI_MY_ACTIVATION_CODE = 'LINKWELL-CHROME';
/** Same string as server .env REACHAI_EXTENSION_SECRET (min 16 chars) for silent API login; '' if code-only. */
var REACHAI_MY_EXTENSION_SECRET = 'reachai-local-dev-only-secret';

/** When Knowledge center (setup) is removed: fallback sender fields if LinkedIn name/email not yet loaded. */
var REACHAI_DEFAULT_SENDER_NAME = '';
var REACHAI_DEFAULT_SENDER_ROLE = 'Professional';

/** When true, extension calls /auth/activate in the background so LinkedIn can be first. */
var REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN = true;

/** When true (and LinkedIn OAuth is on), user cannot skip LinkedIn — must sign in. */
var REACHAI_LINKEDIN_SIGNIN_REQUIRED = true;

/** 'development' uses MY_* URLs above. 'production' uses REACHAI_PRODUCTION_* below for store builds. */
var REACHAI_BUILD_PROFILE = 'development';

/**
 * Production only — when REACHAI_BUILD_PROFILE === 'production', these replace MY_*.
 * See docs/PRODUCTION_LAUNCH.md before shipping; do not commit real secrets to a public repo.
 */
var REACHAI_PRODUCTION_API_BASE = '';
var REACHAI_PRODUCTION_AI_API_BASE = '';
var REACHAI_PRODUCTION_ACTIVATION_CODE = '';
var REACHAI_PRODUCTION_EXTENSION_SECRET = '';

var REACHAI_DEFAULT_API_BASE;
var REACHAI_DEFAULT_AI_API_BASE;
var REACHAI_EXTENSION_SECRET;
var REACHAI_DEFAULT_ACTIVATION_CODE;

if (REACHAI_BUILD_PROFILE === 'production') {
  REACHAI_DEFAULT_API_BASE = String(REACHAI_PRODUCTION_API_BASE || '')
    .trim()
    .replace(/\/$/, '');
  REACHAI_DEFAULT_AI_API_BASE = String(REACHAI_PRODUCTION_AI_API_BASE || '')
    .trim()
    .replace(/\/$/, '');
  REACHAI_EXTENSION_SECRET = String(REACHAI_PRODUCTION_EXTENSION_SECRET || '').trim();
  REACHAI_DEFAULT_ACTIVATION_CODE = String(REACHAI_PRODUCTION_ACTIVATION_CODE || '').trim();
} else {
  REACHAI_DEFAULT_API_BASE = String(REACHAI_MY_API_BASE_URL || 'http://127.0.0.1:3847')
    .trim()
    .replace(/\/$/, '');
  REACHAI_DEFAULT_AI_API_BASE = String(REACHAI_MY_AI_API_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  REACHAI_EXTENSION_SECRET = String(REACHAI_MY_EXTENSION_SECRET || '').trim();
  REACHAI_DEFAULT_ACTIVATION_CODE = String(REACHAI_MY_ACTIVATION_CODE || '').trim();
}

/** LinkedIn Developer Portal → Client ID (public). */
var LINKEDIN_CLIENT_ID = '773zvp4ctrs7bh';

var LINKEDIN_OAUTH_SCOPES = 'openid profile email';

/**
 * true = LinkedIn redirects to YOUR API (set REACHAI_PUBLIC_URL on server; register callback on LinkedIn).
 * false = classic Chrome flow (*.chromiumapp.org/linkedin) — needs LynkWell AI JWT before LinkedIn.
 */
var REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK = true;

/**
 * Only for local debugging: show “copy redirect URL” instructions on the LinkedIn screen and in Settings.
 * Keep false for production — callback URLs are configured on your server and LinkedIn Developer app, not in-extension.
 */
var REACHAI_SHOW_LINKEDIN_REDIRECT_HELPER = false;

var REACHAI_ENABLE_LINKEDIN_OAUTH = true;

/** One click on InMail / Connect / DM runs AI draft immediately (no extra Generate tap). */
var REACHAI_AUTO_DRAFT_ON_CHANNEL_CLICK = true;

/**
 * After a fresh scrape + channel recommendation, auto-run draft when the member URL is new
 * (visibility/focus rescan uses false — no double-gen on the same tab).
 */
var REACHAI_AUTO_DRAFT_AFTER_NEW_PROFILE = true;
