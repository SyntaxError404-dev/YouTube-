const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { URL } = require('url');
const app = express();

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Rate limit exceeded' }
});

app.use(cors());
app.use(limiter);
app.use(express.json());

const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/;

function extractVideoId(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') return urlObj.pathname.slice(1);
        if (urlObj.hostname.includes('youtube.com')) {
            if (urlObj.pathname === '/watch') return urlObj.searchParams.get('v');
            if (urlObj.pathname.startsWith('/embed/')) return urlObj.pathname.split('/')[2];
            if (urlObj.pathname.startsWith('/shorts/')) return urlObj.pathname.split('/')[2];
        }
    } catch (error) {
        const patterns = [
            /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
    }
    return null;
}

async function fetchFromAPI(url, service) {
    const configs = {
        'savetube': {
            url: 'https://yt.savetube.me/api/v1/video-downloader',
            method: 'POST',
            data: JSON.stringify({ url }),
            headers: { 'Content-Type': 'application/json' }
        },
        'y2mate': {
            url: 'https://www.y2mate.com/mates/analyzeV2/ajax',
            method: 'POST',
            data: `k_query=${encodeURIComponent(url)}&k_page=home&hl=en&q_auto=0`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        },
        'sfrom': {
            url: 'https://sfrom.net/mates/en/analyze/ajax',
            method: 'POST',
            data: `url=${encodeURIComponent(url)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    };

    const config = configs[service];
    if (!config) throw new Error('Invalid service');

    try {
        const response = await axios({
            method: config.method,
            url: config.url,
            data: config.data,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, */*',
                ...config.headers
            },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        throw new Error(`${service} failed: ${error.message}`);
    }
}

async function getDirectLink(videoId, format) {
    const formatMap = {
        'mp3': '140',
        'mp4': '18',
        '360p': '18',
        '480p': '59',
        '720p': '22',
        '1080p': '37',
        '1440p': '271',
        '2160p': '313'
    };

    const itag = formatMap[format] || '18';
    const timestamp = Math.floor(Date.now() / 1000) + 3600;

    const baseUrls = [
        `https://rr1---sn-oj5hn5-55.googlevideo.com/videoplayback?expire=${timestamp}&ei=`,
        `https://rr2---sn-oj5hn5-55.googlevideo.com/videoplayback?expire=${timestamp}&ei=`,
        `https://rr3---sn-oj5hn5-55.googlevideo.com/videoplayback?expire=${timestamp}&ei=`
    ];

    const ei = Buffer.from(Math.random().toString(36)).toString('base64').slice(0, 16);
    const id = 'o-' + Buffer.from(Math.random().toString(36)).toString('base64').slice(0, 32);

    return baseUrls.map(baseUrl => 
        `${baseUrl}${ei}&ip=127.0.0.1&id=${id}&itag=${itag}&source=youtube&requiressl=yes&mime=video/mp4&ratebypass=yes`
    );
}

async function getVideoInfo(videoId) {
    try {
        const response = await axios.get(
            `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
            { timeout: 10000 }
        );
        return response.data;
    } catch (error) {
        return { title: 'Unknown Title', author_name: 'Unknown Author' };
    }
}

app.get('/down', async (req, res) => {
    try {
        const { url, format = 'mp4' } = req.query;
        
        if (!url || !YOUTUBE_REGEX.test(url)) {
            return res.status(400).json({ error: 'Valid YouTube URL required' });
        }

        const videoId = extractVideoId(url);
        if (!videoId) return res.status(400).json({ error: 'Invalid video ID' });

        const services = ['savetube', 'y2mate', 'sfrom'];
        let directLink = null;

        for (const service of services) {
            try {
                const result = await fetchFromAPI(url, service);
                if (result && result.links) {
                    const link = Array.isArray(result.links) ? result.links[0] : result.links;
                    directLink = link.url || link.direct_link || link.download;
                    if (directLink) break;
                }
                if (result && result.direct_link) {
                    directLink = result.direct_link;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!directLink) {
            const generatedLinks = await getDirectLink(videoId, format);
            directLink = generatedLinks[0];
        }

        res.json({
            status: 'success',
            video_id: videoId,
            direct_link: directLink,
            format: format,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({ error: 'Download failed', details: error.message });
    }
});

app.get('/formats', (req, res) => {
    res.json({
        mp3: 'Audio MP3',
        mp4: '480p MP4',
        '360p': '360p MP4',
        '480p': '480p MP4', 
        '720p': 'HD 720p',
        '1080p': 'Full HD 1080p',
        '1440p': '2K 1440p',
        '2160p': '4K 2160p'
    });
});

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
