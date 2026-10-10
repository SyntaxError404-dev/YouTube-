const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

const PROXY_LIST = (process.env.PROXY_LIST || `http://fjvqcesf:15qp56smk66t@31.59.20.176:6754,http://fjvqcesf:15qp56smk66t@45.38.107.97:6014,http://fjvqcesf:15qp56smk66t@64.137.96.74:6641,http://fjvqcesf:15qp56smk66t@198.23.243.226:6361,http://fjvqcesf:15qp56smk66t@38.154.185.97:6370,http://fjvqcesf:15qp56smk66t@84.247.60.125:6095,http://fjvqcesf:15qp56smk66t@142.111.67.146:5611,http://fjvqcesf:15qp56smk66t@31.58.9.4:6077,http://fjvqcesf:15qp56smk66t@191.96.254.138:6185,http://fjvqcesf:15qp56smk66t@198.46.161.42:5092`)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let proxyIdx = 0;

function nextAgent() {
  if (!PROXY_LIST.length) return null;
  const url = PROXY_LIST[proxyIdx % PROXY_LIST.length];
  proxyIdx++;
  try {
    return new HttpsProxyAgent(url);
  } catch (e) {
    return null;
  }
}

function extractVideoId(url) {
  if (!url) return null;
  let match = null;
  if (url.includes('youtube.com/shorts/') || url.includes('youtu.be/')) {
    match = /\/([a-zA-Z0-9\-_]{11})/.exec(url);
  } else if (url.includes('youtube.com')) {
    match = /v=([a-zA-Z0-9\-_]{11})/.exec(url);
  } else {
    match = /[a-zA-Z0-9\-_]{11}/.exec(url);
  }
  return match ? match[1] : null;
}

function sanitize(name) {
  return (name || 'audio')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function fetchJson(url, headers, agent) {
  const opts = { headers };
  if (agent) opts.agent = agent;
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

async function scrapeYtmp3(youtubeUrl, format = 'mp3') {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error('invalid youtube url');
  const lowerFormat = format.toLowerCase();
  if (lowerFormat !== 'mp3' && lowerFormat !== 'mp4') throw new Error('invalid format');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://id.ytmp3.mobi',
    'Referer': 'https://id.ytmp3.mobi/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site'
  };

  const agent = nextAgent();

  const initJson = await fetchJson(
    `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`,
    headers,
    agent
  );
  if (initJson.error > 0) throw new Error(`init error ${initJson.error}`);

  let convertRequestUrl = `${initJson.convertURL}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
  let convertJson;

  while (true) {
    convertJson = await fetchJson(convertRequestUrl, headers, agent);
    if (convertJson.error > 0) throw new Error(`convert error ${convertJson.error}`);
    if (convertJson.redirect > 0 && convertJson.redirectURL) {
      convertRequestUrl = `${convertJson.redirectURL}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
      continue;
    }
    break;
  }

  const progressUrl = convertJson.progressURL;
  let downloadUrl = convertJson.downloadURL;
  let title = convertJson.title || '';

  if (!progressUrl) throw new Error('missing progress url');

  let progress = 0;
  let polls = 0;
  while (progress < 3 && polls < 90) {
    await new Promise(r => setTimeout(r, 1000));
    polls++;
    const progressJson = await fetchJson(progressUrl, headers, agent);
    if (progressJson.error > 0) throw new Error(`progress error ${progressJson.error}`);
    progress = progressJson.progress;
    if (progressJson.title) title = progressJson.title;
    if (progressJson.downloadURL) downloadUrl = progressJson.downloadURL;
  }

  if (progress < 3) throw new Error('conversion timeout');
  if (!downloadUrl) throw new Error('no download url');

  return { videoId, title, format: lowerFormat, downloadUrl };
}

app.get('/down', async (req, res) => {
  const url = req.query.url;
  const format = (req.query.format || 'mp3').toLowerCase();

  if (!url) return res.status(400).json({ status: 'error', message: 'missing ?url=' });
  if (format !== 'mp3' && format !== 'mp4') {
    return res.status(400).json({ status: 'error', message: 'format must be mp3 or mp4' });
  }

  let data;
  try {
    data = await scrapeYtmp3(url, format);
  } catch (err) {
    console.log(`scrape failed: ${err.message}`);
    return res.status(500).json({ status: 'error', message: err.message });
  }

  const filename = `${sanitize(data.title)}.${format}`;

  res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const upstream = await fetch(data.downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://id.ytmp3.mobi/',
        'Origin': 'https://id.ytmp3.mobi'
      }
    });

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ status: 'error', message: `upstream ${upstream.status}` });
    }

    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise(r => res.once('drain', r));
        }
      }
      res.end();
    };

    pump().catch(() => res.end());

    res.on('close', () => {
      try { reader.cancel(); } catch (e) {}
    });
  } catch (err) {
    console.log(`stream failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: err.message });
    else res.end();
  }
});

app.get('/info', async (req, res) => {
  const url = req.query.url;
  const format = (req.query.format || 'mp3').toLowerCase();
  if (!url) return res.status(400).json({ status: 'error', message: 'missing ?url=' });

  try {
    const data = await scrapeYtmp3(url, format);
    res.json({
      status: 'success',
      videoId: data.videoId,
      title: data.title,
      format: data.format,
      downloadUrl: data.downloadUrl
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    usage: {
      download: '/down?url=https://youtu.be/VIDEO_ID',
      mp4: '/down?url=https://youtu.be/VIDEO_ID&format=mp4',
      info: '/info?url=https://youtu.be/VIDEO_ID'
    },
    proxies_loaded: PROXY_LIST.length
  });
});

app.listen(PORT, () => {
  console.log(`http on ${PORT}`);
  console.log(`proxies: ${PROXY_LIST.length}`);
});
