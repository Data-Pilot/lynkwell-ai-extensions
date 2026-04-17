# Deploy the LynkWell API (`server/`) on Vercel

The ReachAI Express app lives under **`server/`**. Vercel runs it as one serverless function via **`server/api/index.js`**, which loads **`server/index.js`**.

## Option A — Vercel dashboard (fastest)

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. **Import** [Data-Pilot/lynkwell-ai-extensions](https://github.com/Data-Pilot/lynkwell-ai-extensions) (or your fork).
3. Under **Configure Project**:
   - **Root Directory**: set to **`server`** (Required — do not leave blank).
   - Framework Preset: **Other** (or “Express” if shown).
4. **Environment Variables** — add the same names as `server/.env.example` (values from your local `.env`, never commit `.env`):

   | Variable | Notes |
   |----------|--------|
   | `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/app/apikey) |
   | `JWT_SECRET` | 16+ random characters |
   | `REACHAI_ACTIVATION_CODES` | e.g. `LINKWELL-CHROME` |
   | `REACHAI_EXTENSION_SECRET` | Optional; min 16 chars if used |
   | `REACHAI_PUBLIC_URL` | **Your Vercel URL**, e.g. `https://your-project.vercel.app` (no trailing slash) |
   | `LINKEDIN_CLIENT_ID` / `LINKEDIN_REDIRECT_URI` | If you use LinkedIn OAuth |

5. Click **Deploy**. After the first deploy, copy the production URL and set **`REACHAI_PUBLIC_URL`** to that URL, then **Redeploy** so LinkedIn callback URLs match.

6. **LinkedIn Developer app**: add the OAuth redirect URL shown by `GET /api/v1/oauth/linkedin/extension-flow/meta` (or built from `REACHAI_PUBLIC_URL` + `/api/v1/oauth/linkedin/extension-flow/callback`).

7. **Health check**: open `https://<your-deployment>/health` — expect `{"ok":true,"service":"reachai-api"}`.

## Option B — Vercel CLI (on your machine)

```bash
cd server
npm install
npx vercel login
npx vercel link    # create or link project
npx vercel env pull   # optional: pull env to .env.local
npx vercel --prod
```

Set **`REACHAI_PUBLIC_URL`** in the Vercel project settings to your production hostname.

## Option C — GitHub Actions (deploy without sharing tokens in chat)

We **cannot** deploy to your Vercel account from here (no access to your login or tokens). You can still get **one-click deploys from GitHub** by adding secrets only inside **GitHub** (never paste `VERCEL_TOKEN` into AI chats or issues).

1. **Create a Vercel project** for this API (dashboard import with Root Directory **`server`**, or `cd server && npx vercel link`).
2. In Vercel: **Project → Settings → Environment Variables** — add the same variables as Option A.
3. Create a token: [vercel.com/account/tokens](https://vercel.com/account/tokens).
4. In GitHub: **Repo → Settings → Secrets and variables → Actions → New repository secret**:
   - `VERCEL_TOKEN` — the token from step 3  
   - `VERCEL_ORG_ID` — **Team / Personal account** settings in Vercel, or from `server/.vercel/project.json` after `vercel link`  
   - `VERCEL_PROJECT_ID` — **Project → Settings → General → Project ID**
5. Push to `main` (or open **Actions → Deploy API to Vercel → Run workflow**).

The workflow file is **`.github/workflows/deploy-vercel-api.yml`**.

## Extension / clients

Point **`REACHAI_MY_API_BASE_URL`** (or production equivalent in `extension/lib/reach-api-default.js`) to `https://<your-deployment>.vercel.app` with no trailing slash.

## Limits

- `vercel.json` sets **`maxDuration`: 60** seconds for `api/index.js` (upgrade plan if you need longer AI calls).
- Cold starts apply; OAuth state is **JWT-based** (no in-memory maps) so extension-flow works on serverless.
