# LinkWell extension — backend API contract

This document is for engineers implementing (or re-implementing) a **compatible API** so the LinkWell Chrome extension can use your host instead of the bundled reference server in [server/index.js](../server/index.js).

The extension **never** sends your Gemini (or other model) API key from the client. It only sends **JWT** + **prompt text**; your server calls the model.

---

## Base URL and CORS

- **Base URL**: `https://api.example.com` with **no trailing slash** (extension strips trailing slashes).
- **CORS**: Allow browser requests from the extension origin. The reference server uses `cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] })`. For production you may restrict `origin` to `chrome-extension://YOUR_EXTENSION_ID` if you prefer.
- **HTTPS**: Required for production Chrome Web Store builds and for LinkedIn OAuth redirects in most setups.

---

## Authentication model

1. Extension calls **`POST /api/v1/auth/activate`** (no `Authorization` header) with an activation **code** and/or a long **extension secret**.
2. Server returns **`access_token`** (JWT).
3. All protected routes use **`Authorization: Bearer <access_token>`**.

JWT payload used by the reference server: `{ typ: 'reachai_user', iat: <unix> }`. Your implementation may use any claims as long as **`authMiddleware`** accepts the same token you issue on activate.

**JWT verification** must use the same secret you used to sign. Reference: HS256, `expiresIn` ~30 days.

---

## Endpoints (minimum for AI + optional LinkedIn)

### 1) `POST /api/v1/auth/activate` (public)

**Body (JSON):**

```json
{
  "code": "OPTIONAL_ACTIVATION_CODE",
  "extensionSecret": "OPTIONAL_MIN_16_CHAR_SECRET"
}
```

At least one of `code` or `extensionSecret` must be accepted by your policy.

**Success `200`:**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 2592000
}
```

Either `access_token` or `accessToken` should work; the extension reads **`data.access_token || data.accessToken`**.

**Errors:** `401` invalid credentials, `503` if activation is disabled, `500` if JWT cannot be issued.

---

### 2) `POST /api/v1/ai/complete` (protected)

**Headers:** `Authorization: Bearer <jwt>`  
**Body (JSON):**

| Field | Type | Description |
|-------|------|-------------|
| `usage` | string | One of: `confirm`, `recommend`, `generate`, `generate_structured`, `agent_step`. Unknown values should default to `generate`-like behavior. |
| `prompt` | string | Full prompt from the extension (can be large; reference max **120000** chars). |

**Success `200`:**

```json
{ "text": "<model output string>" }
```

The extension requires **`data.text`** as a non-empty string.

**Errors:** `401` missing/invalid JWT, `400` invalid body, `502` upstream model error (return `{ "error": "human readable" }`).

**Usage semantics** (match reference server for best results):

| `usage` | Intended behavior |
|---------|-------------------|
| `confirm` | Short text, low temperature. |
| `recommend` | **JSON only** response (channel/tone recommendation). Use model JSON mode or strict prompting. |
| `generate` | Plain text message (or connection note). |
| `generate_structured` | **JSON only** with InMail `{ "subject", "body" }`. |
| `agent_step` | **JSON only** for multi-step agent (research, fit, review). |

If you use **Google Gemini** REST `generateContent`, mirror [buildGeminiGenerationConfig](../server/index.js): JSON MIME type for `recommend`, `generate_structured`, and `agent_step`; temperatures as in reference.

---

### 3) Optional: separate “AI host”

On activate, the extension may pass **`aiBaseUrl`** (see [background.js](../extension/background.js) `handleActivateCloud`). Stored session uses:

- `baseUrl` — auth + LinkedIn token exchange (if used)
- `aiBaseUrl` — only for **`POST /api/v1/ai/complete`**

If `aiBaseUrl` is omitted, the extension uses `baseUrl` for AI. Your co-dev can run **one** host for everything by always omitting `aiBaseUrl`.

---

## LinkedIn (optional but supported by extension)

Two integration styles:

### A) Extension-flow OAuth (redirect hits **your API**)

Used when `REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK` is `true` in [reach-api-default.js](../extension/lib/reach-api-default.js).

Implement the same routes as the reference server (paths matter):

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/v1/oauth/linkedin/extension-flow/meta` | JSON `{ "callback_url", "start_url_path" }` for LinkedIn app configuration. |
| `GET` | `/api/v1/oauth/linkedin/extension-flow/start` | Starts OAuth; requires valid `chrome_done` query param (extension callback URL). |
| `GET` | `/api/v1/oauth/linkedin/extension-flow/callback` | LinkedIn redirects here; exchange code; redirect back with `handoff`. |
| `GET` | `/api/v1/oauth/linkedin/extension-flow/complete` | Optional HTML “done” page. |
| `POST` | `/api/v1/oauth/linkedin/extension-flow/exchange` | Body `{ "handoff" }` → JSON with ReachAI JWT + LinkedIn tokens (see reference implementation). |

**Public URL:** Your server must know **`REACHAI_PUBLIC_URL`** (or equivalent) so `callback_url` matches what is registered on **LinkedIn Developer Portal → Auth → Redirect URLs**.

### B) Classic: `POST /api/v1/oauth/linkedin/token` (protected)

Extension obtains a LinkedIn `code` with `redirect_uri` = `chrome.identity.getRedirectURL('linkedin')` and posts:

**Body:** `{ "code": "<linkedin code>", "redirect_uri": "<exact same redirect>" }`  
**Headers:** `Authorization: Bearer <reachai_jwt>`

**Success:** `{ "access_token", "expires_in", "scope" }` — LinkedIn member access token.

Server must validate **`redirect_uri`** against an allowlist (see `isAllowedLinkedInRedirect` in reference: `https://*.chromiumapp.org/linkedin*` or exact `LINKEDIN_REDIRECT_URI` in `.env`).

---

## Diagnostics (recommended)

Reference exposes:

- **`GET /health`** → `{ "ok": true, "service": "..." }`
- **`GET /api/v1/diagnose`** → non-secret flags (Gemini configured, codes count, callback URL, etc.)

Not required for the extension to function, but useful for ops.

---

## Contract checklist for co-developers

- [ ] `POST /api/v1/auth/activate` returns JWT `access_token`
- [ ] `POST /api/v1/ai/complete` accepts Bearer JWT, returns `{ "text" }`
- [ ] `usage` values handled (at minimum `generate`; ideally all five)
- [ ] `recommend` / `generate_structured` / `agent_step` return parseable JSON in `text` when extension expects JSON
- [ ] CORS allows extension requests
- [ ] Prompt size limit documented (reference 120k chars)
- [ ] If LinkedIn via API callback: implement extension-flow routes + stable HTTPS `callback_url`
- [ ] If classic LinkedIn: implement `/oauth/linkedin/token` with redirect allowlist

---

## Reference implementation

Use [server/index.js](../server/index.js) as the source of truth for behavior, status codes, and edge cases. [extension/background.js](../extension/background.js) shows exactly which URLs and bodies are sent.

For architecture context, see [LINKWELL_ARCHITECTURE.md](./LINKWELL_ARCHITECTURE.md).
