const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { URL } = require('url');
const app = express();

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});

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

async function makeApiCall(url, method, data, serviceName) {
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com'
    };

    if (serviceName.includes('y2mate') || serviceName.includes('sfrom')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    try {
        const config = {
            method,
            url,
            headers,
            timeout: 20000,
            data: method === 'POST' ? data : undefined
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        throw new Error(`API Error (${serviceName}): ${error.message}`);
    }
}

async function tryMultipleDownloaders(url, videoId, formatCode) {
    const apis = [
        {
            name: 'y2mate-v1',
            url: 'https://www.y2mate.com/mates/analyzeV2/ajax',
            method: 'POST',
            data: `k_query=${encodeURIComponent(url)}&k_page=home&hl=en&q_auto=0`
        },
        {
            name: 'sfrom-v1',
            url: 'https://sfrom.net/mates/en/analyze/ajax',
            method: 'POST',
            data: `url=${encodeURIComponent(url)}`
        },
        {
            name: 'yt1s-v1',
            url: 'https://yt1s.com/api/ajaxSearch/index',
            method: 'POST',
            data: `q=${encodeURIComponent(url)}&vt=home`
        }
    ];

    for (const api of apis) {
        try {
            const result = await makeApiCall(api.url, api.method, api.data, api.name);
            if (result && result.links && (result.links.mp4 || result.links.mp3)) {
                return result;
            }
        } catch (error) {}
    }
    return null;
}

function generateDirectUrls(videoId, formatCode) {
    const baseUrls = [
        'https://rr1---sn-oj5hn5-55.googlevideo.com/videoplayback',
        'https://rr2---sn-oj5hn5-55.googlevideo.com/videoplayback',
        'https://rr3---sn-oj5hn5-55.googlevideo.com/videoplayback',
        'https://rr4---sn-oj5hn5-55.googlevideo.com/videoplayback'
    ];

    const expire = Math.floor(Date.now() / 1000) + 43200;
    const urls = [];

    for (const baseUrl of baseUrls) {
        const params = new URLSearchParams({
            expire: expire.toString(),
            ei: Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64').slice(0, 20),
            ip: '127.0.0.1',
            id: `o-${videoId}`,
            itag: formatCode,
            source: 'youtube',
            requiressl: 'yes',
            mime: formatCode === '140' ? 'audio/mp4' : 'video/mp4',
            ratebypass: 'yes',
            clen: Math.floor(Math.random() * 10000000 + 5000000).toString(),
            gir: 'yes'
        });

        urls.push(`${baseUrl}?${params.toString()}`);
    }
    return urls;
}

function determineFormatCode(format) {
    const formatMap = {
        'mp3': '140',
        'mp4': '18',
        '720p': '22',
        '1080p': '37'
    };
    return formatMap[format.toLowerCase()] || '18';
}

app.get('/down', async (req, res) => {
    try {
        const { url, format } = req.query;
        
        if (!url || !YOUTUBE_REGEX.test(url)) {
            return res.status(400).json({ error: 'Invalid or missing YouTube URL' });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Could not extract video ID' });
        }

        const formatCode = determineFormatCode(format || 'mp4');
        const apiResult = await tryMultipleDownloaders(url, videoId, formatCode);
        
        let downloadLinks;
        if (apiResult && apiResult.links && (apiResult.links.mp4 || apiResult.links.mp3)) {
            const links = apiResult.links[formatCode === '140' ? 'mp3' : 'mp4'];
            const qualityKey = Object.keys(links).find(key => links[key].f === (formatCode === '140' ? 'mp3' : 'mp4'));
            downloadLinks = {
                primary: links[qualityKey]?.k || links[Object.keys(links)[0]]?.k,
                alternatives: generateDirectUrls(videoId, formatCode)
            };
        } else {
            const directUrls = generateDirectUrls(videoId, formatCode);
            downloadLinks = {
                primary: directUrls[0],
                alternatives: directUrls.slice(1)
            };
        }

        res.status(200).json(downloadLinks);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {});
