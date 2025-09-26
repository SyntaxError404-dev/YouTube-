const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { pipeline } = require('stream');
const app = express();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: { error: 'Too many requests, try later.' } });

app.use(cors());
app.use(limiter);
app.use(express.json());

const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/;

function determineFormatCode(format) {
    const map = { mp3: '140', mp4: '18', hd: '22' }; // mp4: 18 (medium), hd: 22 (720p)
    return map[format?.toLowerCase()] || '18';
}

app.get('/down', async (req, res) => {
    try {
        const { url, format } = req.query;

        // Validate URL
        if (!url || !YOUTUBE_REGEX.test(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const videoId = ytdl.getURLVideoID(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Could not extract video ID' });
        }

        const info = await ytdl.getInfo(url);
        if (!info.formats || info.formats.length === 0) {
            return res.status(404).json({ error: 'No downloadable formats available' });
        }

        const formatCode = determineFormatCode(format);
        const videoFormat = info.formats.find(f => f.itag === parseInt(formatCode));

        if (!videoFormat) {
            return res.status(400).json({ error: `Format ${format} not available` });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${videoId}.${format}"`);
        res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');

        if (format === 'mp3') {
            // Stream video and convert to MP3
            const stream = ytdl(url, { quality: formatCode });
            pipeline(
                stream,
                ffmpeg()
                    .audioBitrate(128)
                    .toFormat('mp3')
                    .on('error', (err) => {
                        res.status(500).json({ error: 'Conversion failed', details: err.message });
                    }),
                res,
                (err) => {
                    if (err) console.error('Pipeline failed:', err);
                }
            );
        } else {
            // Stream MP4 directly
            const stream = ytdl(url, { quality: formatCode });
            pipeline(
                stream,
                res,
                (err) => {
                    if (err) console.error('Pipeline failed:', err);
                }
            );
        }
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

app.use('*', (req, res) => res.status(405).json({ error: 'Method not allowed. Use GET.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`YouTube Downloader API running on port ${PORT}`));
