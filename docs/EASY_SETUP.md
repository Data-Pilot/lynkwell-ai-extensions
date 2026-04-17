# Easy setup — Docker + Chrome extension

Follow these steps **in order**. You need a computer with **Google Chrome** and permission to install **Docker Desktop**.

---

## Step 1 — Install Docker Desktop

1. Open your web browser and go to:  
   **https://www.docker.com/products/docker-desktop/**
2. Download **Docker Desktop** for your system (Windows or Mac).
3. Run the installer and finish all steps.
4. Open **Docker Desktop** from your Start menu or Applications folder.
5. Wait until Docker says it is **running** (no errors on the main screen).

---

## Step 2 — Open the project folder

1. Unzip or clone this project so you have a folder on your computer, for example:  
   `linkedin-ai-extension`
2. Open that folder.
3. Go inside the **`server`** folder.  
   You should see files like `docker-compose.yml`, `.env.example`, and `Dockerfile`.

---

## Step 3 — Set your secret keys (first time only)

1. In the **`server`** folder, find **`.env.example`**.
2. Copy it and rename the copy to **`.env`** (exactly that name).
3. Open **`.env`** in a text editor and fill in at least:
   - **`GEMINI_API_KEY`** — your Google AI key (from Google AI Studio).
   - **`JWT_SECRET`** — any long random password (20 letters or more).
   - **`REACHAI_ACTIVATION_CODES`** — you can keep the example value **`LINKWELL-CHROME`** for testing.

Save the file.

---

## Step 4 — Run Docker in the terminal

1. Open **Terminal** (Mac) or **PowerShell** (Windows).
2. Go to the **server** folder. Example (change the path to match your computer):

   ```bash
   cd Desktop/linkedin-ai-extension/server
   ```

3. Run this command to **build** the API image:

   ```bash
   docker compose build
   ```

4. When that finishes, run this command to **start** the API in the background:

   ```bash
   docker compose up -d
   ```

5. Check that it works: open Chrome and visit:

   **http://127.0.0.1:3847/health**

   You should see a small page with `"ok": true` in the text.

**To stop the API later:** in the same `server` folder, run:

```bash
docker compose down
```

---

## Step 5 — Load the extension in Chrome

1. Open **Google Chrome**.
2. In the address bar, type exactly:

   **chrome://extensions/**

   Press Enter.

3. Turn **Developer mode** **ON** (switch at the top right of the page).
4. Click **Load unpacked**.
5. Choose the **`extension`** folder from this project (not the `server` folder).  
   The `extension` folder must contain `manifest.json`.

---

## Step 6 — Test on LinkedIn

1. Make sure Docker is still running and you did **Step 4** (`docker compose up -d`).
2. In Chrome, go to **LinkedIn** and open someone’s profile. The address should look like:

   **https://www.linkedin.com/in/some-name/**

3. Click the **LynkWell AI** (or puzzle piece) icon in Chrome to open the **side panel**.
4. If the extension asks you to connect to the API, the address should be:

   **http://127.0.0.1:3847**

   (This is already the default in the project for local testing.)
5. Try **Generate** or follow the on-screen steps.

If something fails, read **[RUN_WITH_DOCKER_DESKTOP.md](./RUN_WITH_DOCKER_DESKTOP.md)** for more detail, or **[RUN_LOCAL.md](./RUN_LOCAL.md)** if you prefer to run without Docker.
