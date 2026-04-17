# ReachAI — hackathon quick path (Docker)

1. **Gemini key** — In `server/.env`, set `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey). It must start with **`AIza`**.
2. **API (Docker)** — From the **`server/`** folder:
   ```bash
   docker compose up --build
   ```
   Check `http://127.0.0.1:3847/health`. Logs: `docker compose logs -f`. Stop: `Ctrl+C` or `docker compose down`.
3. **Extension** — Chrome → **Extensions** → **Load unpacked** → select the **`extension/`** folder (the one that contains `manifest.json`) → **Reload** after code changes.
4. **First run** — The extension can **auto-connect** to your API from **`extension/lib/reach-api-default.js`** (`REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN`, **`REACHAI_MY_API_BASE_URL`**, and either **`REACHAI_MY_ACTIVATION_CODE`** matching `server/.env` `REACHAI_ACTIVATION_CODES` or a 16+ char **`REACHAI_MY_EXTENSION_SECRET`** matching `REACHAI_EXTENSION_SECRET`). Then **Sign in with LinkedIn** is first. If auto-connect fails, use **Open Knowledge center for API** on that screen. Reload the extension after editing defaults.
5. **LinkedIn redirect URL** — Two modes (see `REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK` in `extension/lib/reach-api-default.js`):
   - **API callback (default `true`, recommended):** Register only the URL from **`GET /api/v1/oauth/linkedin/extension-flow/meta`** (your API path ending in `…/extension-flow/callback`). Set **`REACHAI_PUBLIC_URL`** to match how you open the API (`http://127.0.0.1:3847` vs `http://localhost:3847`). After LinkedIn approves, the server redirects to **`https://<extension-id>.chromiumapp.org/linkedin?handoff=…`** so Chrome can **close the sign-in window** and return to the extension (you do **not** register that chromium URL on LinkedIn).
   - **Chrome-only (`false`):** Register `https://<extension-id>.chromiumapp.org/linkedin` from the copy field (changes if you reload unpacked from another folder).  
   In [LinkedIn Developers](https://www.linkedin.com/developers/apps) → your app (**Client ID** must match the extension) → **Auth** → **Authorized redirect URLs** — paste **exactly**, save, then sign in again. Enable **Sign In with LinkedIn using OpenID Connect** under **Products** if prompted.
6. **Demo** — Open a LinkedIn profile (`https://www.linkedin.com/in/...`) → ReachAI side panel.
7. **Knowledge base + profile** — In **Settings (gear)**: fill **Strategic goal / mission**, **Additional context**, and optional **files** so drafts use *your* story. Scroll the LinkedIn profile so **About** loads, then tap **Rescan** so the AI sees *their* interests.

**If AI fails:** real **`AIza`** key, model **`gemini-2.5-flash`** in `.env`, then `docker compose up --build` again so the container reloads env.

**No Docker?** From `server/`: `npm install && npm start` instead.

---

## Extension: local dev vs production (same repo)

1. **While developing** — In `extension/lib/reach-api-default.js` keep `REACHAI_BUILD_PROFILE = 'development'`. Set **`REACHAI_MY_*`** (URL, activation code or extension secret) so silent activation works; **`REACHAI_LINKEDIN_SIGNIN_REQUIRED`** hides “Continue without LinkedIn” when you want LinkedIn mandatory.

2. **Before a production / Web Store build** — Set `REACHAI_BUILD_PROFILE = 'production'` and fill **`REACHAI_PRODUCTION_API_BASE`** (required; your team’s HTTPS API origin, no trailing slash). Optionally set **`REACHAI_PRODUCTION_AI_API_BASE`** if Gemini runs on another host. Set either **`REACHAI_PRODUCTION_ACTIVATION_CODE`** or a 16+ char **`REACHAI_PRODUCTION_EXTENSION_SECRET`** that matches server `.env` — do **not** ship shared test codes if they grant broad access.

3. **`extension/manifest.json`** — Under `host_permissions`, add every production origin you `fetch` (e.g. `https://api.yourcompany.com/*`). Localhost entries are harmless to leave for internal testers.

4. **After a user has signed in once** — URLs and JWT live in `chrome.storage`; changing the profile in a new build does not overwrite an existing session until they clear storage or you bump logic. For QA, use a fresh Chrome profile or remove the extension and re-add.
