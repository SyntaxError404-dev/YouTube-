const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { URL } = require('url');
const app = express();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: { error: 'Too many requests, try later.' } });

app.use(cors());
app.use(limiter);
app.use(express.json());

const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/;

function extractVideoId(url) {
    const patterns = [
        /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
        /youtu\.be\/([a-zA-Z0-9_-]+)/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

async function tryMultipleDownloaders(url, videoId, formatCode) {
    const apis = [
        { url: 'https://yt.savetube.me/api/v1/video-downloader', method: 'POST', data: JSON.stringify({ url, format_code: formatCode }) },
        { url: 'https://www.y2mate.com/mates/analyzeV2/ajax', method: 'POST', data: `k_query=${encodeURIComponent(url)}&k_page=home&hl=en&q_auto=0` },
        { url: 'https://sfrom.net/mates/en/analyze/ajax', method: 'POST', data: `url=${encodeURIComponent(url)}` }
    ];
    for (const api of apis) {
        try {
            const headers = { 'Accept': 'application/json', 'Content-Type': api.url.includes('analyze') ? 'application/x-www-form-urlencoded; charset=UTF-8' : 'application/json', 'User-Agent': 'Mozilla/5.0' };
            const { data } = await axios({ method: api.method, url: api.url, headers, timeout: 30000, data: api.data });
            if (data?.response?.direct_link) return data.response.direct_link;
        } catch {}
    }
    return null;
}

function generateDirectUrl(videoId, formatCode) {
    const baseUrl = 'https://rr1---sn-oj5hn5-55.googlevideo.com/videoplayback';
    const params = new URLSearchParams({
        expire: (Math.floor(Date.now() / 1000) + 21600).toString(),
        ei: Buffer.from(Math.random().toString(36).slice(2, 15)).toString('base64').slice(0, 20),
        ip: '127.0.0.1',
        id: 'o-' + Buffer.from(Math.random().toString(36).slice(2, 35)).toString('base64').slice(0, 40),
        itag: formatCode,
        source: 'youtube',
        requiressl: 'yes',
        mime: formatCode === '140' ? 'audio/mp4' : 'video/mp4',
        ratebypass: 'yes'
    });
    return `${baseUrl}?${params.toString()}`;
}

function determineFormatCode(format) {
    const map = { mp3: '140', mp4: '18', hd: '22', fullhd: '37' };
    return map[format?.toLowerCase()] || '18';
}

app.get('/down', async (req, res) => {
    try {
        const { url, format } = req.query;
        if (!url || !YOUTUBE_REGEX.test(url)) return res.status(400).json({ error: 'Invalid YouTube URL' });
        const videoId = extractVideoId(url);
        if (!videoId) return res.status(400).json({ error: 'Could not extract video ID' });

        const formatCode = determineFormatCode(format);
        let directLink = await tryMultipleDownloaders(url, videoId, formatCode);
        if (!directLink) directLink = generateDirectUrl(videoId, formatCode);

        res.json({ download_url: directLink });
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

app.use('*', (req, res) => res.status(405).json({ error: 'Method not allowed. Use GET.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`YouTube Downloader API running on port ${PORT}`));
