'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const os       = require('os');
const fs       = require('fs');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// winget installs ffmpeg into user PATH but that only takes effect in new login
// sessions. Inject it here so yt-dlp can find it immediately without a restart.
const FFMPEG_BIN = 'C:/Users/burnt/AppData/Local/Microsoft/WinGet/Packages/' +
    'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin';
if (!process.env.PATH.includes('ffmpeg')) {
    process.env.PATH = FFMPEG_BIN + ';' + process.env.PATH;
}

// ── Ownership allowlist ───────────────────────────────────────────────────────
// SoundCloud: matched by URL path prefix (fast, no extra request)
const SC_ALLOWED_PATHS = ['/jadynviolet', '/_ebv'];

// YouTube: matched by channel name returned from yt-dlp metadata (async, ~3 s)
const YT_ALLOWED_CHANNELS = ['ohnahji'];

// Twitch: all URLs accepted — platform is open-access
const TWITCH_OPEN = true;

// Returns { ok: true } or { ok: false, error: string }
function checkSoundCloud(parsed) {
    const p = parsed.pathname.toLowerCase().replace(/\/$/, '');
    const allowed = SC_ALLOWED_PATHS.some(prefix => p === prefix || p.startsWith(prefix + '/'));
    return allowed
        ? { ok: true }
        : { ok: false, error: 'Only soundcloud.com/jadynviolet and soundcloud.com/_ebv are allowed.' };
}

function checkYouTube(url) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            check.kill();
            resolve({ ok: false, error: 'Could not verify YouTube channel (timeout).' });
        }, 20_000);

        const check = spawn('yt-dlp', [
            '-s',                        // simulate — no download
            '--no-playlist',
            '--no-warnings',
            '--print', '%(channel)s',    // just the channel name
            url,
        ]);

        let out = '';
        check.stdout.on('data', d => { out += d.toString(); });
        check.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                resolve({ ok: false, error: 'Could not verify YouTube channel.' });
                return;
            }
            const channel = out.trim().toLowerCase();
            const allowed = YT_ALLOWED_CHANNELS.some(c => channel.includes(c));
            resolve(allowed
                ? { ok: true }
                : { ok: false, error: `Only videos from @ohnahji are allowed.` }
            );
        });
        check.on('error', () => {
            clearTimeout(timer);
            resolve({ ok: false, error: 'yt-dlp not found.' });
        });
    });
}

// ── Serve the frontend ────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── /convert?url=ENCODED_URL&format=mp3|mp4 ──────────────────────────────────
app.get('/convert', async (req, res) => {
    const url    = (req.query.url    || '').trim();
    const format = (req.query.format || 'mp3').toLowerCase();

    if (!url) return res.status(400).json({ error: 'Missing url parameter.' });
    if (format !== 'mp3' && format !== 'mp4') {
        return res.status(400).json({ error: 'format must be mp3 or mp4.' });
    }

    let parsed;
    try { parsed = new URL(url); } catch {
        return res.status(400).json({ error: 'Invalid URL.' });
    }

    const host         = parsed.hostname.replace(/^www\./, '');
    const isSoundCloud = host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
    const isYouTube    = host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    const isTwitch     = host === 'twitch.tv'   || host.endsWith('.twitch.tv');

    if (!isSoundCloud && !isYouTube && !isTwitch) {
        return res.status(400).json({ error: `Unsupported platform: ${host}` });
    }
    if (format === 'mp4' && isSoundCloud) {
        return res.status(400).json({ error: 'SoundCloud is audio-only — use MP3.' });
    }

    // ── Ownership gate ────────────────────────────────────────────────────────
    let ownership;
    if (isSoundCloud) {
        ownership = checkSoundCloud(parsed);
    } else if (isYouTube) {
        ownership = await checkYouTube(url);
    } else {
        ownership = { ok: TWITCH_OPEN };
    }

    if (!ownership.ok) {
        return res.status(403).json({ error: ownership.error });
    }

    // ── Download + convert ────────────────────────────────────────────────────
    const id          = crypto.randomBytes(8).toString('hex');
    const outTemplate = path.join(os.tmpdir(), `rip_${id}.%(ext)s`);
    const outFile     = path.join(os.tmpdir(), `rip_${id}.${format}`);

    const args = format === 'mp4'
        ? [
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--no-warnings',
            '--print', 'after_move:title',
            '-o', outTemplate,
            url,
          ]
        : [
            '--extract-audio',
            '--audio-format',  'mp3',
            '--audio-quality', '0',
            '--no-playlist',
            '--no-warnings',
            '--print', 'after_move:title',
            '-o', outTemplate,
            url,
          ];

    console.log(`[convert:${format}] ${url}`);
    const ytdlp = spawn('yt-dlp', args);

    let title  = format === 'mp4' ? 'video' : 'audio';
    let errBuf = '';

    ytdlp.stdout.on('data', d => {
        const line = d.toString().trim();
        if (line) title = line;
    });

    ytdlp.stderr.on('data', d => {
        errBuf += d.toString();
        process.stderr.write('[yt-dlp] ' + d);
    });

    ytdlp.on('error', err => {
        console.error('spawn error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'yt-dlp not found. Run: pip install yt-dlp' });
        }
    });

    ytdlp.on('close', code => {
        if (code !== 0) {
            console.error('[yt-dlp] exited', code);
            if (!res.headersSent) {
                const msg = errBuf.includes('Sign in')
                    ? 'This video requires sign-in — try another URL.'
                    : errBuf.includes('not available')
                    ? 'Video not available in this region.'
                    : 'Conversion failed. Check the URL and try again.';
                res.status(500).json({ error: msg });
            }
            cleanUp(id);
            return;
        }

        if (!fs.existsSync(outFile)) {
            if (!res.headersSent) res.status(500).json({ error: 'Output file missing.' });
            return;
        }

        const safeName = title.replace(/[^\w\s\-().]/g, '').trim() || format;
        const mimeType = format === 'mp4' ? 'video/mp4' : 'audio/mpeg';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${format}"`);

        const stream = fs.createReadStream(outFile);
        stream.pipe(res);

        const done = () => cleanUp(id);
        stream.on('close', done);
        stream.on('error', err => {
            console.error('read stream error:', err);
            done();
        });
        res.on('close', done);
    });
});

// Clean up every temp file that belongs to this request id
function cleanUp(id) {
    try {
        fs.readdirSync(os.tmpdir())
            .filter(f => f.startsWith(`rip_${id}`))
            .forEach(f => fs.unlink(path.join(os.tmpdir(), f), () => {}));
    } catch { /* ignore */ }
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n  Asset Collector → http://localhost:${PORT}\n`);
});
