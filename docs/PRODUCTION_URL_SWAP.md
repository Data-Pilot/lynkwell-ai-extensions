# Pointing LinkWell at production (API URL swap)

Use this checklist when your co-developer’s API is live and you want the extension to use **production** instead of local dev.

---

## 1) Chrome `host_permissions` (required)

The extension can only call origins listed in [extension/manifest.json](../extension/manifest.json) under **`host_permissions`**.

Add your production API origin, for example:

```json
"https://api.yourcompany.com/*"
```

Remove or keep localhost entries depending on whether you still need local testing from the same build.

**Reload** the extension on `chrome://extensions` after every manifest change.

---

## 2) Default API URL in the bundle

Edit [extension/lib/reach-api-default.js](../extension/lib/reach-api-default.js).

### Option A — Development profile (typical while iterating)

Set **`REACHAI_MY_API_BASE_URL`** to your prod URL (no trailing slash):

```javascript
var REACHAI_MY_API_BASE_URL = 'https://api.yourcompany.com';
```

If AI lives on the **same** host, leave **`REACHAI_MY_AI_API_BASE_URL`** as `''`.

Set **`REACHAI_MY_ACTIVATION_CODE`** and/or **`REACHAI_MY_EXTENSION_SECRET`** to match your production server’s `.env` (`REACHAI_ACTIVATION_CODES`, `REACHAI_EXTENSION_SECRET`).

### Option B — Store / “production” profile

Set:

```javascript
var REACHAI_BUILD_PROFILE = 'production';
var REACHAI_PRODUCTION_API_BASE = 'https://api.yourcompany.com';
var REACHAI_PRODUCTION_AI_API_BASE = ''; // or separate AI host
var REACHAI_PRODUCTION_ACTIVATION_CODE = '...';
var REACHAI_PRODUCTION_EXTENSION_SECRET = '...';
```

With `production`, the `REACHAI_MY_*` values are ignored for the compiled defaults.

---

## 3) LinkedIn OAuth callback URL

If you use **login via API callback** (`REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK = true`):

1. On the **server**, set **`REACHAI_PUBLIC_URL`** (or `LINKEDIN_EXT_FLOW_REDIRECT_URI`) so it equals your public API base, e.g. `https://api.yourcompany.com`.
2. In **LinkedIn Developer Portal** → your app → **Auth** → **Authorized redirect URLs**, add the exact URL returned by  
   `GET https://api.yourcompany.com/api/v1/oauth/linkedin/extension-flow/meta`  
   under `callback_url`.

Mismatch here is the #1 cause of “LinkedIn sign-in failed” in production.

---

## 4) First-run session (optional note)

After users activate once, **`chrome.storage`** may still hold an old JWT tied to another host. If you switch API URLs:

- Use **Disconnect API** in the extension (if shown), or  
- Clear extension storage for LinkWell in Chrome, then open the panel again so **`ACTIVATE_CLOUD`** runs against the new base URL.

---

## 5) Verify

1. `GET https://api.yourcompany.com/health` (or `/api/v1/diagnose` if implemented) from a browser or curl.  
2. Open the side panel → confirm header shows connected / no API-unavailable screen.  
3. Generate a short draft on a LinkedIn `/in/…` profile.

---

## Quick reference

| What | Where |
|------|--------|
| Allowed fetch origins | [extension/manifest.json](../extension/manifest.json) `host_permissions` |
| Default API + secrets | [extension/lib/reach-api-default.js](../extension/lib/reach-api-default.js) |
| JWT + AI request paths | [extension/background.js](../extension/background.js) `handleActivateCloud`, `callAi` |
| Full API contract | [docs/BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) |
