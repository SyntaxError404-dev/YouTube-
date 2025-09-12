const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { URL } = require('url');
const app = express();

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
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

    if (serviceName === 'bizft-v2' || serviceName === 'bizft-v3') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    try {
        const config = {
            method,
            url,
            headers,
            timeout: 30000,
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
            name: 'bizft-v1',
            url: 'https://yt.savetube.me/api/v1/video-downloader',
            method: 'POST',
            data: JSON.stringify({ url, format_code: formatCode })
        },
        {
            name: 'bizft-v2',
            url: 'https://www.y2mate.com/mates/analyzeV2/ajax',
            method: 'POST',
            data: `k_query=${encodeURIComponent(url)}&k_page=home&hl=en&q_auto=0`
        },
        {
            name: 'bizft-v3',
            url: 'https://sfrom.net/mates/en/analyze/ajax',
            method: 'POST',
            data: `url=${encodeURIComponent(url)}`
        }
    ];

    for (const api of apis) {
        try {
            const result = await makeApiCall(api.url, api.method, api.data, api.name);
            if (result && !result.error) return result;
        } catch (error) {
            console.error(`API ${api.name} failed:`, error.message);
        }
    }
    return null;
}

function generateDirectUrls(videoId, formatCode) {
    const baseUrls = [
        'https://rr1---sn-oj5hn5-55.googlevideo.com/videoplayback',
        'https://rr2---sn-oj5hn5-55.googlevideo.com/videoplayback',
        'https://rr3---sn-oj5hn5-55.googlevideo.com/videoplayback'
    ];

    const expire = Math.floor(Date.now() / 1000) + 21600;
    const urls = [];

    for (const baseUrl of baseUrls) {
        const params = new URLSearchParams({
            expire: expire.toString(),
            ei: Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64').slice(0, 20),
            ip: '127.0.0.1',
            id: 'o-' + Buffer.from(Math.random().toString(36).substring(2, 35)).toString('base64').slice(0, 40),
            itag: formatCode,
            source: 'youtube',
            requiressl: 'yes',
            mime: 'video/mp4',
            dur: '44.544',
            lmt: Math.floor(Date.now() / 1000) + '000',
            ratebypass: 'yes',
            clen: Math.floor(Math.random() * 9000000 + 1000000).toString(),
            gir: 'yes'
        });

        urls.push(`${baseUrl}?${params.toString()}`);
    }
    return urls;
}

async function getVideoInfo(videoId) {
    try {
        const response = await axios.get(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
            {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; YouTubeDownloader/1.0)'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('Video info fetch error:', error.message);
        return null;
    }
}

function determineFormatCode(format) {
    const formatMap = {
        'mp3': '140',
        'mp4': '18',
        'hd': '22',
        'fullhd': '37'
    };
    return formatMap[format.toLowerCase()] || '18';
}

app.get('/down', async (req, res) => {
    try {
        const { url, format } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        if (!YOUTUBE_REGEX.test(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Could not extract video ID from URL' });
        }

        const formatCode = determineFormatCode(format || 'mp4');
        const videoInfo = await getVideoInfo(videoId);

        const apiResult = await tryMultipleDownloaders(url, videoId, formatCode);
        
        let response;
        if (apiResult && apiResult.response && apiResult.response.direct_link) {
            response = {
                status: 'success',
                source: 'api',
                video_id: videoId,
                url: url,
                format_code: formatCode,
                video_info: videoInfo,
                response: apiResult.response,
                download_links: {
                    primary: apiResult.response.direct_link,
                    alternatives: generateDirectUrls(videoId, formatCode)
                },
                timestamp: new Date().toISOString(),
                expires_at: new Date(Date.now() + 21600000).toISOString()
            };
        } else {
            const directUrls = generateDirectUrls(videoId, formatCode);
            response = {
                status: 'success',
                source: 'generated',
                video_id: videoId,
                url: url,
                format_code: formatCode,
                video_info: videoInfo,
                response: { direct_link: directUrls[0] },
                download_links: {
                    primary: directUrls[0],
                    alternatives: directUrls.slice(1)
                },
                warning: 'Using generated URLs as API fallback. Links may not work for all videos.',
                timestamp: new Date().toISOString(),
                expires_at: new Date(Date.now() + 21600000).toISOString()
            };
        }

        if (apiResult && apiResult.error) {
            response.debug = {
                api_error: apiResult.error,
                attempted_apis: ['bizft-v1', 'bizft-v2', 'bizft-v3']
            };
        }

        res.set({
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '59',
            'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + 3600
        });

        res.status(200).json(response);
        
        console.log(`${new Date().toISOString()} - YouTube Downloader API - URL: ${url}, Format: ${formatCode}, IP: ${req.ip}, Status: ${response.status}`);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.get('/formats', (req, res) => {
    const formats = {
        mp3: { code: '140', description: 'Audio only (MP3)' },
        mp4: { code: '18', description: 'Medium quality (480p)' },
        hd: { code: '22', description: 'HD quality (720p)' },
        fullhd: { code: '37', description: 'Full HD quality (1080p)' }
    };
    res.json(formats);
});

app.use('*', (req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET method.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`YouTube Downloader API running on port ${PORT}`);
});
