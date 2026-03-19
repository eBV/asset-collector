# Asset Collector

A personal audio/video downloader with a Neo-Kawaii UI. Paste a link, pick MP3 or MP4, click collect. Built with vanilla HTML/CSS/JS on the frontend and Node.js + [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg on the backend.

> **Disclaimer:** This tool is built for personal use with content the author owns or has rights to. It ships with source restrictions that enforce this. If you fork or modify this project to remove those restrictions and use it to download content you do not own or have rights to, you do so entirely at your own risk. The author accepts no liability for any copyright infringement, platform ToS violations, legal claims, or any other damages arising from such use. Downloading third-party content without permission may violate copyright law and platform terms of service.

![Neo-Kawaii dashboard with pink dotted background, split-panel layout — branding on the left, download form on the right](https://raw.githubusercontent.com/eBV/asset-collector/master/preview.png)

---

## What it does

- Accepts a URL from an allowed source (see below)
- Extracts and downloads the audio as **MP3** (default)
- Or toggle to **MP4** to grab the full video
- Runs entirely on your own machine — no third-party conversion service

---

## Allowed sources

This app is gated to content you own. Only these sources will work:

| Handle | Platform | MP3 | MP4 |
|---|---|---|---|
| `jadynviolet` | SoundCloud | ✓ | — |
| `_ebv` | SoundCloud | ✓ | — |
| `@ohnahji` | YouTube | ✓ | ✓ |
| any channel | Twitch | ✓ | ✓ |

Anything outside this list gets blocked before a download is ever attempted.

---

## Requirements

You need three things installed before running the app:

### 1. Node.js
Download from [nodejs.org](https://nodejs.org) (LTS version is fine). This runs the server.

### 2. yt-dlp
The tool that actually fetches video/audio from platforms.

```bash
pip install yt-dlp
```

> Don't have `pip`? Install Python first from [python.org](https://python.org), it comes with pip.

### 3. ffmpeg
Used to convert video to audio (MP3) and merge video+audio streams (MP4).

**Windows (recommended):**
```bash
winget install Gyan.FFmpeg
```

**Mac:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg
```

---

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/eBV/asset-collector.git
cd asset-collector

# 2. Install Node dependencies (just Express)
npm install
```

That's it. No build step, no bundler, no config files.

---

## Running it

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

The server stays running in that terminal window. Close the terminal (or press `Ctrl + C`) to stop it.

---

## How to use it

1. Copy a URL from SoundCloud, YouTube, or Twitch
2. Paste it into the input field
3. Leave the toggle on **MP3** for audio only, or switch to **MP4** for the full video
4. Click **Collect Asset**
5. The file downloads automatically when it's ready (can take 10–60 seconds depending on length)

---

## How it works under the hood

```
Browser  →  Express server  →  yt-dlp  →  ffmpeg  →  temp file  →  streamed back to browser
```

1. The server validates the URL against the allowlist
2. For YouTube links, it runs a quick metadata check (~3s) to confirm the video belongs to `@ohnahji` before doing anything else
3. yt-dlp downloads the best available quality to a temp file
4. ffmpeg converts it (audio extraction for MP3, stream merge for MP4)
5. The file streams back to your browser as a download
6. The temp file is deleted automatically

---

## Project structure

```
asset-collector/
├── index.html    # entire frontend — HTML, CSS, and JS in one file
├── server.js     # Express server + yt-dlp/ffmpeg wiring
├── package.json  # Node dependencies (just Express)
└── Dockerfile    # for deploying to Railway/Render
```

---

## Deploying (optional)

The app needs a real server — **Vercel won't work** (serverless functions time out and can't run yt-dlp). Use [Railway](https://railway.app) instead:

1. Push to GitHub (already done)
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
3. Select this repo — Railway detects the `Dockerfile` automatically
4. Hit **Deploy**, then go to **Settings → Networking → Generate Domain** for a public URL

Railway installs yt-dlp and ffmpeg inside the container for you. No extra config needed.

---

## Troubleshooting

**"yt-dlp not found"**
Run `pip install yt-dlp` and make sure Python's scripts folder is on your PATH.

**"ffmpeg not found"**
After installing ffmpeg, open a new terminal window (PATH changes don't apply to already-open terminals).

**YouTube downloads failing**
YouTube occasionally requires cookies for some content. If you're getting sign-in errors, try updating yt-dlp first: `pip install -U yt-dlp`

**Port 3000 already in use**
Something else is using that port. Change it: `PORT=3001 npm start`
