# LynkWell AI — Server API

Node.js API that holds your **Google AI Studio (Gemini) API key** and issues **JWTs** to the Chrome extension after activation. The extension never receives your Gemini key.

For a full repo walkthrough (Docker option, deeper troubleshooting), see **[../docs/RUN_LOCAL.md](../docs/RUN_LOCAL.md)** and **[../docs/EASY_SETUP.md](../docs/EASY_SETUP.md)**.

---

## Prerequisites

- **Node.js 18+** (`node -v`, `npm -v`)
- **Google AI Studio API key** — [Create a key](https://aistudio.google.com/app/apikey) (often starts with `AIza`)
- **Google Chrome** — to load the unpacked extension from the `extension/` folder

---

## Run the API

All commands are from this **`server/`** directory (where `package.json` lives).

### 1. Create `.env`

```bash
cd server
cp .env.example .env
```

### 2. Edit `.env` (required)

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio key — [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| `JWT_SECRET` | Random string, **16+ characters** (e.g. `openssl rand -hex 32`) |
| **One of** activation paths | **`REACHAI_ACTIVATION_CODES`** (comma-separated, e.g. `LINKWELL-CHROME`) **and/or** **`REACHAI_EXTENSION_SECRET`** (16+ chars) — must match the extension config (see below) |

Common optional variables:

| Variable | Purpose |
|----------|---------|
| `GEMINI_MODEL_ID` | e.g. `gemini-2.5-flash` (default if unset) |
| `PORT` | Default `3847` |
| `BIND_HOST` | `127.0.0.1` (this machine only) or `0.0.0.0` (LAN / Docker) |
| `REACHAI_PUBLIC_URL` | Public base URL **with no path**, e.g. `http://127.0.0.1:3847` — used for LinkedIn OAuth callback when using “login via API” |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn app (server only) — for sign-in flows |

### 3. Install and start

```bash
npm install
npm start
```

Development (auto-restart on file changes):

```bash
npm run dev
```

Alternative: `chmod +x run.sh && ./run.sh`

### 4. Verify

- **Health:** open [http://127.0.0.1:3847/health](http://127.0.0.1:3847/health) — expect `{"ok":true,"service":"reachai-api"}` (use your host/port if you changed them).
- **Diagnose (no auth):** [http://127.0.0.1:3847/api/v1/diagnose](http://127.0.0.1:3847/api/v1/diagnose) — non-secret flags only (e.g. whether Gemini env is set, JWT length OK).

Stop the server with `Ctrl+C`.

---

## Use the Chrome extension

### 1. Point the extension at your API

Open **`extension/lib/reach-api-default.js`** in the repo root (not under `server/`).

For **local API**:

- Set **`REACHAI_MY_API_BASE_URL`** to `http://127.0.0.1:3847` (no trailing slash), **or** uncomment that line and comment out any hosted URL.
- Ensure **`REACHAI_MY_ACTIVATION_CODE`** is listed in server **`REACHAI_ACTIVATION_CODES`**, **or** set **`REACHAI_MY_EXTENSION_SECRET`** to the **same** value as server **`REACHAI_EXTENSION_SECRET`** (both 16+ characters) for silent activation.

`REACHAI_BUILD_PROFILE`: use `'development'` with the `MY_*` fields above; for store builds use `'production'` and fill **`REACHAI_PRODUCTION_*`**.

### 2. Allow Chrome to call your API

**`extension/manifest.json`** must include your API origin in **`host_permissions`**. For default local port you should already see:

- `http://127.0.0.1:3847/*`
- `http://localhost:3847/*`

If you change **port**, use **LAN IP**, or deploy to **HTTPS**, add a matching entry (e.g. `https://your-api.vercel.app/*`).

### 3. Load the extension

1. Open Chrome → **`chrome://extensions`**
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the repo’s **`extension`** folder (the one containing `manifest.json`)

### 4. Day-to-day use

1. **Pin** LynkWell AI and open the **side panel** (toolbar icon → side panel, or your Chrome side panel UI).
2. Complete **onboarding** if shown (API activation + optional LinkedIn). If **`REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN`** is `true` in `reach-api-default.js`, the extension may activate automatically when the server and codes/secrets match.
3. Open a LinkedIn **profile** tab: `https://www.linkedin.com/in/...` (or `/messaging/` where supported).
4. In the panel, choose channel / tone and use **Generate** (or equivalent) — requests go to **`POST /api/v1/ai/complete`** with your JWT.

If the panel reports the API is unreachable, confirm **`npm start`** is running, **`/health`** works in the browser, and **API URL + `host_permissions`** match.

---

## Docker

From **`server/`** with a configured `.env`:

```bash
docker compose up --build
```

Details: **[../docs/RUN_WITH_DOCKER_DESKTOP.md](../docs/RUN_WITH_DOCKER_DESKTOP.md)**.

---

## Deploy (e.g. Vercel)

Set the same variables as in `.env` in the host’s environment (Vercel → Settings → Environment Variables). Set **`REACHAI_PUBLIC_URL`** to your **public HTTPS origin** (no path) so LinkedIn redirect URIs match.

This repo includes **`vercel.json`** rewrites to **`api/index.js`**, which loads **`index.js`**.

---

## API endpoints (summary)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | No | Liveness |
| `GET` | `/api/v1/diagnose` | No | Config sanity (no secrets) |
| `POST` | `/api/v1/auth/activate` | No | Body: `code` and/or `extensionSecret` → LynkWell JWT |
| `POST` | `/api/v1/ai/complete` | `Authorization: Bearer <jwt>` | Body: `usage`, `prompt` → `{ text }` |
| `POST` | `/api/v1/oauth/linkedin/token` | Bearer | Legacy Chrome `redirect_uri` token exchange |
| `GET` | `/api/v1/oauth/linkedin/extension-flow/*` | No | LinkedIn login via your API (production-style HTTPS) |

**`usage`** values for `/api/v1/ai/complete` include: `confirm`, `recommend`, `generate`, `generate_structured`, `agent_step`.

---

## LinkedIn OAuth (optional)

Controlled in the extension by **`REACHAI_ENABLE_LINKEDIN_OAUTH`** and related flags in **`extension/lib/reach-api-default.js`**.

- **`REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK = true`**: LinkedIn redirects to **your API** — register the callback URL from **`GET /api/v1/oauth/linkedin/extension-flow/meta`** on your LinkedIn app; set **`REACHAI_PUBLIC_URL`** on the server.
- **Classic extension redirect**: authorized URL is `chrome.identity.getRedirectURL("linkedin")` (see LinkedIn app settings).

Put **Client ID** in the extension config and **Client ID + Client Secret** in server `.env`. Overview: [LinkedIn OAuth for native clients](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication).

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| `npm` / `node` not found | Install Node 18+; use a new terminal; run from **`server/`** |
| Extension cannot reach API | Server running? URL in `reach-api-default.js` matches? **`host_permissions`** includes that origin? |
| Activation `401` | Code in `REACHAI_ACTIVATION_CODES` or matching **`REACHAI_EXTENSION_SECRET`** (16+ chars both sides) |
| Gemini `401` / `403` / `502` | Valid **AI Studio** key; optional **`GEMINI_MODEL_ID`**; Google error text in server logs |
| LinkedIn errors | **`LINKEDIN_*`** and **`REACHAI_PUBLIC_URL`**; redirect URLs in LinkedIn portal exactly match this server’s callback |
| Port busy | Change **`PORT`** in `.env` and update extension URL + **`manifest.json`** |

---

## Production checklist

- Serve the API over **HTTPS**.
- Use strong **`JWT_SECRET`**; rotate if leaked.
- Prefer **`REACHAI_PRODUCTION_*`** in the extension for release builds — avoid shipping real secrets in **`MY_*`** defaults.
- Add your **production API origin** to **`extension/manifest.json`** `host_permissions`.
