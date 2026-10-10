const { ProxyAgent } = require('undici');
const { nextProxy } = require('./proxies');

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

async function fetchWithProxy(url, options, agent) {
  const merged = { ...options, dispatcher: agent };
  return fetch(url, merged);
}

async function scrapeWithProxy(youtubeUrl, format, proxyUrl) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const lowerFormat = format.toLowerCase();
  if (lowerFormat !== 'mp3' && lowerFormat !== 'mp4') {
    throw new Error('Invalid format');
  }

  const agent = new ProxyAgent(proxyUrl);

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

  const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
  const initRes = await fetchWithProxy(initUrl, { headers }, agent);
  if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
  const initJson = await initRes.json();
  if (initJson.error > 0) throw new Error(`Init error: ${initJson.error}`);

  let convertRequestUrl = `${initJson.convertURL}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
  let convertJson;

  while (true) {
    const convertRes = await fetchWithProxy(convertRequestUrl, { headers }, agent);
    if (!convertRes.ok) throw new Error(`Convert failed: ${convertRes.status}`);
    convertJson = await convertRes.json();
    if (convertJson.error > 0) throw new Error(`Convert error: ${convertJson.error}`);

    if (convertJson.redirect > 0 && convertJson.redirectURL) {
      convertRequestUrl = `${convertJson.redirectURL}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
      continue;
    }
    break;
  }

  const progressUrl = convertJson.progressURL;
  const downloadUrl = convertJson.downloadURL;
  let title = convertJson.title || '';

  if (!progressUrl) throw new Error('Missing progress URL');

  let progress = 0;
  let pollCount = 0;

  while (progress < 3 && pollCount < 60) {
    await new Promise(r => setTimeout(r, 1000));
    pollCount++;

    const progressRes = await fetchWithProxy(progressUrl, { headers }, agent);
    if (!progressRes.ok) throw new Error(`Progress failed: ${progressRes.status}`);
    const progressJson = await progressRes.json();
    if (progressJson.error > 0) throw new Error(`Progress error: ${progressJson.error}`);

    progress = progressJson.progress;
    if (progressJson.title) title = progressJson.title;
  }

  if (progress < 3) throw new Error('Conversion timed out');

  await agent.close();

  return { status: 'success', videoId, title, format: lowerFormat, downloadUrl, proxy: proxyUrl.split('@')[1] };
}

async function scrapeYtmp3(youtubeUrl, format = 'mp3') {
  const attempts = 3;
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    const proxyUrl = nextProxy();
    try {
      return await scrapeWithProxy(youtubeUrl, format, proxyUrl);
    } catch (err) {
      lastError = err;
    }
  }

  return { status: 'error', message: lastError ? lastError.message : 'All proxies failed' };
}

module.exports = { scrapeYtmp3, extractVideoId };
