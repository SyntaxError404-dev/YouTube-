const express = require('express');
const { ProxyAgent } = require('undici');
const { scrapeYtmp3, extractVideoId } = require('./scraper');
const { nextProxy } = require('./proxies');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/down', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url parameter' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ status: 'error', message: 'Invalid YouTube URL' });

  try {
    const result = await scrapeYtmp3(url, 'mp3');
    if (result.status !== 'success' || !result.downloadUrl) {
      return res.status(500).json({ status: 'error', message: result.message || 'Conversion failed' });
    }

    const audioAgent = new ProxyAgent(nextProxy());

    const audioRes = await fetch(result.downloadUrl, {
      dispatcher: audioAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://id.ytmp3.mobi/'
      }
    });

    if (!audioRes.ok) {
      await audioAgent.close();
      return res.status(502).json({ status: 'error', message: 'Failed to fetch audio' });
    }

    const safeTitle = (result.title || videoId).replace(/[^\w\s\-]/g, '').trim().slice(0, 80) || videoId;
    const fileName = `${safeTitle}.mp3`;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Proxy-Used', result.proxy || 'unknown');

    const buffer = Buffer.from(await audioRes.arrayBuffer());
    await audioAgent.close();

    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/proxies', (_req, res) => {
  const { allProxies } = require('./proxies');
  res.json({ count: allProxies().length, proxies: allProxies().map(p => p.split('@')[1]) });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use((_req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;
