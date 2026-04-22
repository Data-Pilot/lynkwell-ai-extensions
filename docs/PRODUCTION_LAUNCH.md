# Production launch checklist (LynkWell AI)

Use this in order. Your API is already referenced in the repo as **`https://lynkwell-ai-extensions.vercel.app`** in `extension/lib/reach-api-default.js` and `extension/manifest.json` — adjust every hostname below if yours differs.

---

## 1. API on Vercel (or your host)

### 1.1 Environment variables

In **Vercel → Project → Settings → Environment Variables**, set at least:

| Variable | Notes |
|----------|--------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) — server only |
| `JWT_SECRET` | `openssl rand -hex 32` (or similar), **16+ characters**, unique per environment |
| `REACHAI_ACTIVATION_CODES` | Comma-separated invite codes (e.g. `LINKWELL-CHROME`) **or** rely on extension secret below |
| `REACHAI_EXTENSION_SECRET` | **16+ characters**; must match what the extension sends if you use silent activation |

Strongly recommended:

| Variable | Notes |
|----------|--------|
| `GEMINI_MODEL_ID` | e.g. `gemini-2.5-flash` |
| `REACHAI_PUBLIC_URL` | **Exact** public API origin, **no path**, **HTTPS**, e.g. `https://lynkwell-ai-extensions.vercel.app` — required for LinkedIn “login via API” callback URL |
| `LINKEDIN_CLIENT_ID` | LinkedIn app (public id) |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn app secret — **never** in the extension |

Apply to **Production** (and Preview if you use previews with a separate LinkedIn app).

### 1.2 Deploy and smoke-test

1. **Redeploy** after saving env vars.
2. Open **`https://<your-api>/health`** → `{"ok":true,...}`.
3. Open **`https://<your-api>/api/v1/diagnose`** → `has_gemini_key: true`, `jwt_secret_ok: true`, `linkedin_extension_flow_callback_url` matches what you will register on LinkedIn (see step 2).

---

## 2. LinkedIn (if sign-in is enabled)

When **`REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK`** is `true` in `extension/lib/reach-api-default.js`:

1. **`REACHAI_PUBLIC_URL`** on the server must equal your live API base (HTTPS, no trailing slash).
2. Call **`GET https://<your-api>/api/v1/oauth/linkedin/extension-flow/meta`** and copy **`callback_url`**.
3. In **LinkedIn Developer Portal** → your app → **Auth** → **Authorized redirect URLs for your app**, add that **`callback_url` exactly** (character-for-character).

Mismatch is the most common cause of “LinkedIn sign-in failed” in production.

If you use the **classic** Chrome-only redirect (`*.chromiumapp.org/linkedin`), register that URL instead and align **`LINKEDIN_REDIRECT_URI`** / extension flow with [PRODUCTION_URL_SWAP.md](./PRODUCTION_URL_SWAP.md).

---

## 3. Chrome extension configuration

### 3.1 `host_permissions`

In **`extension/manifest.json`**, ensure **`host_permissions`** includes your **production API** origin, for example:

`https://lynkwell-ai-extensions.vercel.app/*`

Reload the extension on **`chrome://extensions`** after any manifest change.

### 3.2 API URL and activation (choose one strategy)

**Option A — Keep `REACHAI_BUILD_PROFILE = 'development'`** (common for a private team build)

- Set **`REACHAI_MY_API_BASE_URL`** to your production API (no trailing slash).
- Set **`REACHAI_MY_ACTIVATION_CODE`** / **`REACHAI_MY_EXTENSION_SECRET`** to match Vercel **`REACHAI_ACTIVATION_CODES`** / **`REACHAI_EXTENSION_SECRET`**.

**Option B — Store-style `production` profile**

- Set **`REACHAI_BUILD_PROFILE = 'production'`**.
- Fill **`REACHAI_PRODUCTION_API_BASE`**, **`REACHAI_PRODUCTION_ACTIVATION_CODE`**, and/or **`REACHAI_PRODUCTION_EXTENSION_SECRET`** (same rules as server).

Do **not** commit real production secrets into a **public** git repo. For Chrome Web Store builds, inject values in a **private** build pipeline or keep using **per-user activation codes** without a global baked-in secret.

**Security note:** Anything in **`reach-api-default.js`** is readable from the packed extension. Treat **`REACHAI_*_EXTENSION_SECRET`** as convenience for trusted users, not a vault. Prefer **activation codes** or server-side controls for wide distribution.

### 3.3 Version and reload

Bump **`version`** in **`extension/manifest.json`** when you ship a new build (Chrome/Web Store and your users can tell builds apart).

---

## 4. Distribution

| Channel | What you do |
|---------|-------------|
| **Internal / team** | **Load unpacked** → select the **`extension/`** folder; share a zip of that folder with matching `reach-api-default.js` if needed. |
| **Chrome Web Store** | Create a developer account, pay the one-time fee, zip **`extension/`** (exclude junk), submit listing, privacy policy URL, permissions justification. |

---

## 5. After users switch URL or you rotate secrets

- **`JWT_SECRET` change** invalidates all old JWTs — users must **activate again** (or re-open panel so activation runs).
- If **`chrome.storage`** still has an old API host or token, use **Disconnect / sign out** in the extension if available, or clear site data for the extension, then activate again. See [PRODUCTION_URL_SWAP.md](./PRODUCTION_URL_SWAP.md) §4.

---

## 6. Final verification

1. **`GET /health`** and **`GET /api/v1/diagnose`** on production.
2. **`POST /api/v1/auth/activate`** with a real code or extension secret → **200** + `access_token`.
3. Extension side panel: **activate** → **LinkedIn** (if required) → open a LinkedIn **`/in/...`** profile → run **Generate** once.

---

## Quick links

| Topic | Doc |
|------|-----|
| URL swap details | [PRODUCTION_URL_SWAP.md](./PRODUCTION_URL_SWAP.md) |
| Run API locally | [RUN_LOCAL.md](./RUN_LOCAL.md) |
| Server env + extension overview | [../server/README.md](../server/README.md) |
| HTTP API contract | [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) |
