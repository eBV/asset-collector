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

// ── Serve the frontend ────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── /convert?url=ENCODED_URL&format=mp3|mp4 ──────────────────────────────────
app.get('/convert', (req, res) => {
    const url    = (req.query.url    || '').trim();
    const format = (req.query.format || 'mp3').toLowerCase();

    if (!url) return res.status(400).json({ error: 'Missing url parameter.' });
    if (format !== 'mp3' && format !== 'mp4') {
        return res.status(400).json({ error: 'format must be mp3 or mp4.' });
    }

    // Basic allowlist
    let parsed;
    try { parsed = new URL(url); } catch {
        return res.status(400).json({ error: 'Invalid URL.' });
    }
    const allowed   = ['youtube.com', 'youtu.be', 'soundcloud.com', 'twitch.tv'];
    const host      = parsed.hostname.replace(/^www\./, '');
    const isSoundCloud = host === 'soundcloud.com' || host.endsWith('.soundcloud.com');

    if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        return res.status(400).json({ error: `Unsupported host: ${host}` });
    }
    if (format === 'mp4' && isSoundCloud) {
        return res.status(400).json({ error: 'SoundCloud is audio-only — use MP3.' });
    }

    // Temp file paths
    const id          = crypto.randomBytes(8).toString('hex');
    const outTemplate = path.join(os.tmpdir(), `rip_${id}.%(ext)s`);
    const outFile     = path.join(os.tmpdir(), `rip_${id}.${format}`);

    // yt-dlp args differ by format
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
            res.status(500).json({
                error: 'yt-dlp not found. Run: pip install yt-dlp  (and install ffmpeg)'
            });
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
                    : `Conversion failed. Check the URL and try again.`;
                res.status(500).json({ error: msg });
            }
            cleanUp(id);
            return;
        }

        if (!fs.existsSync(outFile)) {
            if (!res.headersSent) res.status(500).json({ error: 'Output file missing.' });
            return;
        }

        const safeName   = title.replace(/[^\w\s\-().]/g, '').trim() || format;
        const mimeType   = format === 'mp4' ? 'video/mp4' : 'audio/mpeg';
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
