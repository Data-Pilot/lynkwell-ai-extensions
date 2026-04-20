# Run LynkWell AI API with Docker Desktop

**New to this repo?** Start with the shorter **[EASY_SETUP.md](./EASY_SETUP.md)** (install Docker → `server` folder → `docker compose build` → `docker compose up -d` → Chrome extensions).

Use this guide if you want a **fuller** walkthrough: run the **backend API in a container** without Node.js on your Mac or Windows PC (only Docker Desktop).

The Chrome extension still runs in **Google Chrome** on your machine; only the API is inside Docker.

---

## 1. Install and start Docker Desktop

1. Download **Docker Desktop** for your OS:  
   [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Install and **launch Docker Desktop**.
3. Wait until the whale icon shows **Docker is running** (Engine started).

**Tip:** On first launch, accept the service agreement and complete any onboarding. WSL 2 is required on Windows for the default backend; Docker Desktop will prompt you if it is missing.

---

## 2. Clone or open the repo

You need the project folder on disk, for example:

`/Volumes/Data Pilot/linkedin-ai-extension`  
(or your own path — adjust commands below.)

---

## 3. Configure environment variables

Open a terminal (**Terminal** on macOS, **PowerShell** or **cmd** on Windows).

```bash
cd path/to/linkedin-ai-extension/server
cp .env.example .env
```

Edit **`server/.env`** with a text editor. Set at least:

| Variable | Required | Notes |
|----------|----------|--------|
| `GEMINI_API_KEY` | Yes | [Google AI Studio](https://aistudio.google.com/app/apikey) — usually starts with `AIza` |
| `JWT_SECRET` | Yes | 16+ random characters (e.g. `openssl rand -hex 32` on Mac/Linux) |
| `REACHAI_ACTIVATION_CODES` | One of these | e.g. `LINKWELL-CHROME` — must match [extension/lib/reach-api-default.js](../extension/lib/reach-api-default.js) `REACHAI_MY_ACTIVATION_CODE` |
| **or** `REACHAI_EXTENSION_SECRET` | | 16+ chars; must match `REACHAI_MY_EXTENSION_SECRET` in the same JS file |

**LinkedIn (optional):** if you use Sign in with LinkedIn through this API, also set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and keep:

```env
REACHAI_PUBLIC_URL=http://127.0.0.1:3847
```

(When you deploy behind HTTPS, change this to your public API URL and register that callback on LinkedIn.)

**Do not commit `.env`** — it is gitignored.

---

## 4. Build and run with Compose

Stay in the **`server`** directory (where `docker-compose.yml` lives).

```bash
docker compose up --build
```

- First run downloads the Node base image and builds the app image; it may take a few minutes.
- Logs from the API appear in this terminal. Leave it running.

**Run in the background** (detached):

```bash
docker compose up --build -d
```

Stop detached containers:

```bash
docker compose down
```

---

## 5. Verify the API

With the stack running, open a browser:

**Health:** [http://127.0.0.1:3847/health](http://127.0.0.1:3847/health)

You should see JSON similar to:

```json
{"ok":true,"service":"reachai-api"}
```

If the page does not load:

| Check | Action |
|-------|--------|
| Docker Desktop | Engine running? Any error banner? |
| Port **3847** | Another app using it? Change `PORT` in `.env` and the `ports:` mapping in `docker-compose.yml` to match (e.g. `8080:8080` and `PORT=8080`). |
| Firewall | Allow Docker / local connections to `127.0.0.1` |

---

## 6. Point the Chrome extension at the container

1. **`extension/lib/reach-api-default.js`** — set `REACHAI_MY_API_BASE_URL` to the same host/port you published, e.g.  
   `http://127.0.0.1:3847`  
   (no trailing slash.)

2. **`extension/manifest.json`** — under `host_permissions`, ensure you have:

   ```json
   "http://127.0.0.1:3847/*",
   "http://localhost:3847/*"
   ```

   If you changed the port, add that origin too.

3. **Chrome** → `chrome://extensions` → **Developer mode** → **Load unpacked** → select the repo’s **`extension`** folder.

4. Open a LinkedIn profile (`/in/...`) and use the side panel to generate.

---

## 7. Docker Desktop UI (optional)

- **Containers:** you should see a stack named from the folder (e.g. `server-reachai-api-1`). You can **Stop** / **Start** from here.
- **Logs:** select the container → **Logs** tab (same as terminal output from `docker compose up`).
- **Images:** after build, an image built from this `Dockerfile` appears; you can delete unused images from **Docker Desktop → Images** if you need disk space.

---

## 8. Rebuild after code changes

If you edit `server/index.js` or `Dockerfile`:

```bash
cd server
docker compose up --build
```

Compose rebuilds the image when the build context or Dockerfile changed.

---

## 9. What Docker is doing here

- **`server/docker-compose.yml`** — builds the image from **`server/Dockerfile`**, maps host `3847` → container `3847`, injects `.env`, sets `BIND_HOST=0.0.0.0` so the process listens on all interfaces **inside** the container (required for port publishing).
- **`server/Dockerfile`** — Node 20 Alpine, `npm install`, runs `node index.js`.
- **Healthcheck** inside the image hits `http://127.0.0.1:3847/health` inside the container.

---

## Related docs

- [RUN_LOCAL.md](./RUN_LOCAL.md) — same project using **Node on the host** instead of Docker  
- [PRODUCTION_URL_SWAP.md](./PRODUCTION_URL_SWAP.md) — HTTPS and production URL + `host_permissions`  
- [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) — HTTP API contract  
