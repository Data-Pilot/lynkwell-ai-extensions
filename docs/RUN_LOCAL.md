# Run LinkWell locally (API + extension)

This guide walks you from zero to a **working local setup**: Node API on your machine and the Chrome extension talking to it.

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | Includes `npm`. Check: `node -v` |
| **Google Chrome** | For loading the unpacked extension |
| **Gemini API key** | [Google AI Studio](https://aistudio.google.com/app/apikey) — key usually starts with `AIza` |
| **Optional: Docker Desktop** | Run the API in a container — see **[RUN_WITH_DOCKER_DESKTOP.md](./RUN_WITH_DOCKER_DESKTOP.md)** (recommended if you skip Node on the host) |

---

## Part 1 — Start the API (`server/`)

All commands below are from the **`server`** folder inside this repo.

### 1. Create environment file

```bash
cd server
cp .env.example .env
```

### 2. Edit `.env`

Set at least:

| Variable | Example / note |
|----------|----------------|
| `GEMINI_API_KEY` | Your AI Studio key |
| `JWT_SECRET` | Random string, 16+ characters (e.g. `openssl rand -hex 32`) |
| `REACHAI_ACTIVATION_CODES` | e.g. `LINKWELL-CHROME` — must match what the extension sends |
| **or** `REACHAI_EXTENSION_SECRET` | 16+ characters; must **exactly match** `REACHAI_MY_EXTENSION_SECRET` in [extension/lib/reach-api-default.js](../extension/lib/reach-api-default.js) |

Optional but recommended for LinkedIn sign-in via your API:

| Variable | Purpose |
|----------|---------|
| `LINKEDIN_CLIENT_ID` | From LinkedIn Developer app |
| `LINKEDIN_CLIENT_SECRET` | From LinkedIn app (server only) |
| `REACHAI_PUBLIC_URL` | Default `http://127.0.0.1:3847` — used to build OAuth callback URL |

Leave `PORT=3847` and `BIND_HOST=127.0.0.1` unless you know you need otherwise.

### 3. Install and run

```bash
npm install
npm start
```

Or:

```bash
chmod +x run.sh
./run.sh
```

For auto-restart on file changes during development:

```bash
npm run dev
```

### 4. Confirm the server is up

Open in a browser:

- [http://127.0.0.1:3847/health](http://127.0.0.1:3847/health) — should return JSON with `"ok": true`.

---

## Part 2 — Point the extension at localhost

### 1. Match URL and secrets

Open [extension/lib/reach-api-default.js](../extension/lib/reach-api-default.js) and verify:

- `REACHAI_MY_API_BASE_URL` is `http://127.0.0.1:3847` (no trailing slash), **or** the same host/port as `PORT` / `BIND_HOST` in `.env`.
- `REACHAI_MY_ACTIVATION_CODE` appears in `REACHAI_ACTIVATION_CODES` on the server **or** the extension secret matches `REACHAI_EXTENSION_SECRET` on both sides.

### 2. Chrome must allow `fetch` to your API

[extension/manifest.json](../extension/manifest.json) already includes:

```json
"http://127.0.0.1:3847/*",
"http://localhost:3847/*"
```

If you change **port** or use **LAN IP**, add a matching `host_permissions` entry.

### 3. Load the extension in Chrome

1. Open **`chrome://extensions`**
2. Turn on **Developer mode**
3. **Load unpacked** → choose the repo’s **`extension`** folder (the one that contains `manifest.json`, not `server/`).

### 4. Use the side panel

1. Click the LinkWell toolbar icon to open the **side panel** (or use the extension’s pinned action).
2. Complete onboarding if prompted (LinkedIn / API). With `REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN` true, the extension often activates against `REACHAI_DEFAULT_API_BASE` automatically when the server and codes/secrets match.
3. Open a LinkedIn **member profile** URL (`https://www.linkedin.com/in/...`) in the **same** window’s active tab.
4. In the panel: pick channel/tone → **Generate with Gemini**.

If you see **“Backend or AI unavailable”**, check the server terminal for errors, `.env` values, and that `/health` still works.

---

## Part 3 — Quick checks when something fails

| Symptom | What to check |
|---------|----------------|
| `Cannot reach your AI API` | Server running? URL matches `reach-api-default.js`? `host_permissions` includes that origin? |
| Activation `401` | Code or extension secret matches server `.env` |
| Gemini `403` / `502` | `GEMINI_API_KEY` is an AI Studio key; model id valid (`GEMINI_MODEL_ID` in `.env`) |
| LinkedIn errors | `LINKEDIN_*` in `.env`, redirect URLs on LinkedIn app match [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) / server README |
| Empty scrape / wrong profile | Active tab must be `/in/...`; try **↻** refresh in the panel |

**Diagnose (needs a JWT first):** after the extension has a session, your server can expose `GET /api/v1/diagnose` (see reference [server/index.js](../server/index.js)) — open with `Authorization: Bearer <token>` or use browser devtools on extension network calls.

---

## Run with Docker Desktop

Use the dedicated guide: **[RUN_WITH_DOCKER_DESKTOP.md](./RUN_WITH_DOCKER_DESKTOP.md)** (install Docker Desktop, `.env`, `docker compose up --build`, extension wiring).

Quick version:

```bash
cd server
cp .env.example .env   # edit .env first
docker compose up --build
```

Health check: [http://127.0.0.1:3847/health](http://127.0.0.1:3847/health).

---

## Repo layout reminder

```
linkedin-ai-extension/
  extension/          ← Load this folder in Chrome (unpacked)
  server/             ← npm start / Docker from here
  docs/               ← This guide and other docs
```

---

## More reading

- [server/README.md](../server/README.md) — troubleshooting and LinkedIn details  
- [LINKWELL_ARCHITECTURE.md](./LINKWELL_ARCHITECTURE.md) — how pieces fit together  
- [PRODUCTION_URL_SWAP.md](./PRODUCTION_URL_SWAP.md) — moving from local to production URL  
- [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) — HTTP contract if you replace the reference server  
