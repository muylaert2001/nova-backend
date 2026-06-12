# NOVA Setup Guide
## Full backend + desktop tray app installation

---

## What you're setting up

```
Your Devices  ──→  NOVA Tray App  ──→  NOVA Backend (Railway)  ──→  Gmail / Spotify / Slack / Outlook
                   (always-on,            (OAuth server,
                    wake word)             your credentials)
```

---

## PART 1 — Deploy the Backend to Railway

### Step 1: Install Git and create a GitHub account
- Download Git: https://git-scm.com/downloads
- Create free GitHub account: https://github.com

### Step 2: Push the backend to GitHub
Open a terminal in the `nova-backend` folder and run:
```bash
git init
git add .
git commit -m "NOVA backend initial commit"
```
Then create a new repository on GitHub (name it `nova-backend`), and run:
```bash
git remote add origin https://github.com/YOUR_USERNAME/nova-backend.git
git push -u origin main
```

### Step 3: Deploy to Railway
1. Go to https://railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `nova-backend` repository
4. Railway auto-detects Node.js and deploys it
5. Go to **Settings → Domains** → click **Generate Domain**
6. Copy your Railway URL — it looks like: `https://nova-backend-production.up.railway.app`

### Step 4: Add your environment variables on Railway
In Railway, go to your project → **Variables** tab, and add each variable from `.env.example`.
You'll fill these in as you connect each service below.

---

## PART 2 — Connect Your Accounts

### Google (Gmail + Google Calendar) — 5 minutes

1. Go to https://console.cloud.google.com
2. Click **Create Project** → name it "NOVA"
3. Go to **APIs & Services → Enable APIs**:
   - Search and enable **Gmail API**
   - Search and enable **Google Calendar API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: add `https://YOUR-RAILWAY-URL/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**
8. Add to Railway Variables:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=https://YOUR-RAILWAY-URL/auth/google/callback
   ```
9. Connect: visit `https://YOUR-RAILWAY-URL/auth/google/connect` in your browser

---

### Spotify — 3 minutes

1. Go to https://developer.spotify.com/dashboard
2. Click **Create App** → name it "NOVA"
3. Add Redirect URI: `https://YOUR-RAILWAY-URL/auth/spotify/callback`
4. Copy **Client ID** and **Client Secret**
5. Add to Railway Variables:
   ```
   SPOTIFY_CLIENT_ID=your-client-id
   SPOTIFY_CLIENT_SECRET=your-client-secret
   SPOTIFY_REDIRECT_URI=https://YOUR-RAILWAY-URL/auth/spotify/callback
   ```
6. Connect: visit `https://YOUR-RAILWAY-URL/auth/spotify/connect`

---

### Slack — 5 minutes

1. Go to https://api.slack.com/apps → **Create New App → From scratch**
2. Name it "NOVA", select your workspace
3. Go to **OAuth & Permissions → Redirect URLs** → add `https://YOUR-RAILWAY-URL/auth/slack/callback`
4. Under **Scopes → Bot Token Scopes**, add: `channels:read`, `channels:history`, `chat:write`, `users:read`
5. Go to **Basic Information** → copy **Client ID** and **Client Secret**
6. Add to Railway Variables:
   ```
   SLACK_CLIENT_ID=your-client-id
   SLACK_CLIENT_SECRET=your-client-secret
   SLACK_REDIRECT_URI=https://YOUR-RAILWAY-URL/auth/slack/callback
   ```
7. Connect: visit `https://YOUR-RAILWAY-URL/auth/slack/connect`

---

### Microsoft Outlook / Teams — 5 minutes

1. Go to https://portal.azure.com
2. Search **Azure Active Directory → App registrations → New registration**
3. Name: "NOVA", Supported account types: **Personal Microsoft accounts**
4. Redirect URI: `https://YOUR-RAILWAY-URL/auth/microsoft/callback`
5. Go to **Certificates & secrets → New client secret** → copy the value immediately
6. Copy **Application (client) ID** from the Overview page
7. Add to Railway Variables:
   ```
   MICROSOFT_CLIENT_ID=your-client-id
   MICROSOFT_CLIENT_SECRET=your-client-secret
   MICROSOFT_REDIRECT_URI=https://YOUR-RAILWAY-URL/auth/microsoft/callback
   ```
8. Connect: visit `https://YOUR-RAILWAY-URL/auth/microsoft/connect`

---

## PART 3 — Install the Desktop Tray App

### Prerequisites
Install Node.js from https://nodejs.org (LTS version)

### Step 1: Install dependencies
Open a terminal in the `nova-tray` folder:
```bash
npm install
```

### Step 2: Add your backend URL
Edit `nova-tray/src/nova.html` and replace `YOUR_BACKEND_URL` with your Railway URL.

### Step 3: Run NOVA
```bash
npm start
```
NOVA will appear in your system tray (bottom-right on Windows, top-right on Mac).

### Step 4: Build an installer (optional)
To create a proper installable app:
```bash
# Windows
npm run build-win

# Mac
npm run build-mac

# Linux
npm run build-linux
```
The installer will be in the `dist/` folder.

---

## PART 4 — Set NOVA to start on login

### Windows
1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `nova-tray.exe` in that folder

### Mac
1. Go to System Preferences → Users & Groups → Login Items
2. Click `+` and add the NOVA app

### Linux
Add to your desktop environment's startup applications, or add to `~/.bashrc`:
```bash
/path/to/nova-tray/nova-tray &
```

---

## Using NOVA

| Action | How |
|--------|-----|
| Open NOVA | Click tray icon |
| Wake word | Say "Hey NOVA" or "OK NOVA" |
| Toggle wake word | Right-click tray → Wake Word |
| Check Gmail | Say "Hey NOVA, check my emails" |
| Play music | Say "Hey NOVA, play [song name] on Spotify" |
| Calendar | Say "Hey NOVA, what's on my calendar today?" |
| Add to NOVA later | Just ask me in Claude and I'll add the feature |

---

## Adding features later

Your data (tasks, memories, chat history) lives in Anthropic's storage and is never affected by updates.

To add a new feature, service, or agent:
1. Come back to Claude and describe what you want
2. I'll provide updated code for the relevant file(s)
3. Copy the updated file into your project
4. Push to GitHub — Railway auto-redeploys in ~60 seconds
5. Restart the tray app

Nothing is lost. Everything builds on top of what's already there.

---

## Troubleshooting

**"Not connected to Google"** — Visit `https://YOUR-RAILWAY-URL/auth/google/connect` again

**Wake word not working** — Browser must have microphone permission. On desktop tray app, check your OS microphone privacy settings.

**Railway app sleeping** — Free tier sleeps after inactivity. Upgrade to Railway Hobby ($5/mo) for always-on, or use Render's free tier with a keep-alive ping.

**NOVA doesn't hear me** — Make sure your microphone is set as default input device in your OS sound settings.
