const express = require('express');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

const proxyPool = [
  "http://fjvqcesf:15qp56smk66t@31.59.20.176:6754",
  "http://fjvqcesf:15qp56smk66t@45.38.107.97:6014",
  "http://fjvqcesf:15qp56smk66t@64.137.96.74:6641",
  "http://fjvqcesf:15qp56smk66t@198.23.243.226:6361",
  "http://fjvqcesf:15qp56smk66t@38.154.185.97:6370",
  "http://fjvqcesf:15qp56smk66t@84.247.60.125:6095",
  "http://fjvqcesf:15qp56smk66t@142.111.67.146:5611",
  "http://fjvqcesf:15qp56smk66t@31.58.9.4:6077",
  "http://fjvqcesf:15qp56smk66t@191.96.254.138:6185",
  "http://fjvqcesf:15qp56smk66t@198.46.161.42:5092"
];

const getRandomAgent = () => {
  const proxy = proxyPool[Math.floor(Math.random() * proxyPool.length)];
  return new HttpsProxyAgent(proxy);
};

function extractVideoId(url) {
  if (!url) return null;
  let match = null;
  if (url.includes("youtube.com/shorts/") || url.includes("youtu.be/")) {
    match = /\/([a-zA-Z0-9\-_]{11})/.exec(url);
  } else if (url.includes("youtube.com")) {
    match = /v=([a-zA-Z0-9\-_]{11})/.exec(url);
  } else {
    match = /[a-zA-Z0-9\-_]{11}/.exec(url);
  }
  return match ? match[1] : null;
}

async function scrapeYtmp3(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error('Invalid URL');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Origin': 'https://id.ytmp3.mobi',
    'Referer': 'https://id.ytmp3.mobi/'
  };
  
  const agent = getRandomAgent();

  try {
    const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
    const initRes = await fetch(initUrl, { headers, agent });
    if (!initRes.ok) throw new Error('Init failed');
    const initJson = await initRes.json();
    if (initJson.error > 0) throw new Error(initJson.error);

    let convertUrl = initJson.convertURL;
    let convertRequestUrl = `${convertUrl}&v=${videoId}&f=mp3&_=${Math.random()}`;
    let convertJson;

    while (true) {
      const convertRes = await fetch(convertRequestUrl, { headers, agent });
      if (!convertRes.ok) throw new Error('Convert failed');
      convertJson = await convertRes.json();
      if (convertJson.error > 0) throw new Error(convertJson.error);

      if (convertJson.redirect > 0 && convertJson.redirectURL) {
        convertRequestUrl = `${convertJson.redirectURL}&v=${videoId}&f=mp3&_=${Math.random()}`;
        continue;
      }
      break;
    }

    const progressUrl = convertJson.progressURL;
    const downloadUrl = convertJson.downloadURL;
    let title = convertJson.title || videoId;

    if (!progressUrl) throw new Error('Missing progress URL');

    let progress = 0;
    let pollCount = 0;

    while (progress < 3 && pollCount < 60) {
      await new Promise(r => setTimeout(r, 1000));
      pollCount++;
      const progressRes = await fetch(progressUrl, { headers, agent });
      if (!progressRes.ok) throw new Error('Progress failed');
      const progressJson = await progressRes.json();
      if (progressJson.error > 0) throw new Error(progressJson.error);

      progress = progressJson.progress;
      if (progressJson.title) title = progressJson.title;
    }

    if (progress < 3) throw new Error('Timeout');

    return { status: 'success', title, downloadUrl };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

app.get('/down', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter.' });
  }

  console.log(`[API] Extracting artifact: ${targetUrl}`);

  try {
    const result = await scrapeYtmp3(targetUrl);
    
    if (result.status === 'error') {
      console.error(`[API-ERROR] ${result.message}`);
      return res.status(500).json({ error: result.message });
    }

    console.log(`[API] Payload mapped: ${result.title}. Piping direct to client...`);

    const agent = getRandomAgent();
    const fileStream = await fetch(result.downloadUrl, { 
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!fileStream.ok) {
      throw new Error('Host rejected direct stream request.');
    }

    const safeTitle = result.title.replace(/[^a-zA-Z0-9 -]/g, '');
    
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    fileStream.body.pipe(res);

    fileStream.body.on('error', (err) => {
      console.error(`[STREAM-ERROR] ${err.message}`);
      res.end();
    });

  } catch (err) {
    console.error(`[SYSTEM-ERROR] Pipeline broken: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Extraction failed.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[SYSTEM] Gateway listening on port ${PORT}`);
});
