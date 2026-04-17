# ReachAI Cloud API

**Simplest install (Docker + Chrome):** see [../docs/EASY_SETUP.md](../docs/EASY_SETUP.md).

Product-style backend: **Gemini API key lives only here** (in `.env`). The extension gets a **JWT** via **`REACHAI_EXTENSION_SECRET`** (optional; matches `extension/lib/reach-api-default.js` if set) or **activation codes** in `.env`.

## Why it might not run on your machine

Typical causes when `npm start` “does nothing” or the extension cannot reach the API:

1. **Node/npm not installed or not on PATH** — install Node 18+ and open a **new** terminal so `node -v` works.
2. **Wrong folder** — run commands from the **`server/`** directory (where `package.json` lives), not the repo root.
3. **Missing or invalid `.env`** — you need `GEMINI_API_KEY`, `JWT_SECRET`, and either `REACHAI_EXTENSION_SECRET` (default in `.env.example`) or `REACHAI_ACTIVATION_CODES` (see `.env.example`). Without them the server may reject activation.
4. **Gemini key shape** — the REST API used here expects a Google **AI Studio** key (usually starts with `AIza`). Other key types often return 403 from Google; use `GET /api/v1/diagnose` (with a valid JWT) to sanity-check.
5. **Port in use** — another app may be using `3847`; change `PORT` in `.env` and update the extension URL + `extension/manifest.json` if needed.
6. **Firewall / VPN** — can block localhost or outbound calls to Google.

If you prefer not to install Node globally, use **Docker** below: only Docker Desktop (or Engine) is required.

## Deploy on your system (local)

1. **Install Node.js 18+** from [nodejs.org](https://nodejs.org/) (includes `npm`).

2. **Create env file**

   ```bash
   cd server
   cp .env.example .env
   ```

3. **Edit `.env`** — set at least these (see comments inside `.env.example`):

   | Variable | What it is |
   |----------|------------|
   | `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/app/apikey) |
   | `JWT_SECRET` | Long random string; generate e.g. `openssl rand -hex 32` |
   | `REACHAI_EXTENSION_SECRET` | Optional; matches `extension/lib/reach-api-default.js` if set; or use activation codes only |
   | `REACHAI_ACTIVATION_CODES` | Optional alternative: comma-separated invite codes instead of / in addition to the extension secret |

4. **Start the API**

   ```bash
   npm install
   npm start
   ```

   Or: `chmod +x run.sh && ./run.sh`

5. **Health check:** open `http://127.0.0.1:3847/health` — you should see `{"ok":true,...}`.

## Docker (build image and run)

Step-by-step with **Docker Desktop**: see [../docs/RUN_WITH_DOCKER_DESKTOP.md](../docs/RUN_WITH_DOCKER_DESKTOP.md).

From the **`server/`** directory, with a configured `.env` next to `docker-compose.yml`:

```bash
cd server
docker compose up --build
```

Or build and run the image manually:

```bash
cd server
docker build -t reachai-api .
docker run --rm -p 3847:3847 --env-file .env -e BIND_HOST=0.0.0.0 reachai-api
```

Then open `http://127.0.0.1:3847/health` and in the extension set **API base URL** to `http://127.0.0.1:3847` (or your deployed URL + matching `host_permissions`).

**Deploy to a VPS / cloud:** push your code, set the same environment variables as in `.env` on the host (or use the platform’s secret store), run the container with `-p 3847:3847` (or put **HTTPS** reverse proxy in front). Add your **public API origin** to `extension/manifest.json` under `host_permissions` so `fetch` is allowed.

Default listen: **`127.0.0.1:3847`** (this Mac only). To allow another device on your Wi‑Fi, set in `.env`:

`BIND_HOST=0.0.0.0`

Then in the extension use your computer’s LAN IP, e.g. `http://192.168.1.50:3847`, and add that origin to `extension/manifest.json` under `host_permissions`.

## Extension

1. In ReachAI setup, set **API base URL** to your server (localhost for dev).
2. Local dev: copy `.env.example` → `.env` — use **`REACHAI_ACTIVATION_CODES`** (e.g. `LINKWELL-CHROME`) matching the extension’s **development** defaults in `extension/lib/reach-api-default.js` (`REACHAI_BUILD_PROFILE = 'development'`), or set a 16+ char **`REACHAI_EXTENSION_SECRET`** in both places for code-less activation. For production extension bundles, use `REACHAI_BUILD_PROFILE = 'production'` and `REACHAI_PRODUCTION_*` in that same file.
3. Complete name / role / mission and **Get Started**.

## Production

- Serve over **HTTPS**.
- Add your API origin to `extension/manifest.json` under `host_permissions` (Chrome requires an explicit host for `fetch`).
- Rotate `JWT_SECRET` and activation codes if leaked.

## LinkedIn OAuth (extension)

LinkedIn native sign-in is controlled by **`REACHAI_ENABLE_LINKEDIN_OAUTH`** in `extension/lib/reach-api-default.js`. Set to `false` if you only want API + on-page flows first; when `true`, ensure `identity` and `https://api.linkedin.com/*` are in `extension/manifest.json` (already typical for this project).

Official overview: [Authenticate with OAuth 2.0 for native clients](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication?context=linkedin%2Fcontext&tabs=Windows%2Ccurl).

1. Create a LinkedIn app and enable **Sign In with LinkedIn using OpenID Connect**.
2. Set **Authorized redirect URL** to the exact string shown in the extension (Settings): `chrome.identity.getRedirectURL("linkedin")` → `https://<extension-id>.chromiumapp.org/linkedin`.
3. Put **Client ID** in `extension/lib/reach-api-default.js` (`LINKEDIN_CLIENT_ID`) and **Client ID + Client Secret** in server `.env` (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`). Optionally set `LINKEDIN_REDIRECT_URI` to that exact URL for production.
4. User completes ReachAI setup first, then **Sign in with LinkedIn** in Settings. The extension verifies OAuth `state`, then your server exchanges the `code` for an access token (secret never leaves the server). Email comes from OpenID `userinfo` when the `email` scope is granted.

## Endpoints

- `POST /api/v1/auth/activate` — body `{ "code": "..." }` → `{ "access_token", "token_type", "expires_in" }`
- `POST /api/v1/ai/complete` — header `Authorization: Bearer <token>`, body `{ "usage": "confirm"|"recommend"|"generate", "prompt": "..." }` → `{ "text": "..." }`
- `POST /api/v1/oauth/linkedin/token` — header `Authorization: Bearer <reachai-jwt>`, body `{ "code": "<linkedin auth code>", "redirect_uri": "<same as auth request>" }` → `{ "access_token", "expires_in", "scope" }`
