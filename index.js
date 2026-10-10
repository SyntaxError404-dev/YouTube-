const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = 'https://app-tts.voiser.ai';

const VOICES = {
  Gadis: '173',
  Ardi: '174',
  Siti: '404',
  Dimas: '405',
  Tuti: '488',
  Jajang: '489',
  Abbi: '540',
  Bella: '541',
  Hollie: '542',
  Maisie: '543',
  Mia: '544',
  Olivia: '545',
  Alfie: '546',
  Elliot: '547',
  Ethan: '548',
  Noah: '549',
  Meryem: '218',
  Ibrahim: '219',
  Aoi: '779',
  Daichi: '780',
  Mayu: '781',
  Naoki: '782',
  Shiori: '783',
  Nanami: '178',
  Keita: '179',
  BongJin: '785',
  GookMin: '786',
  Hyunsu: '787',
  JiMin: '788',
  SeoHyeon: '789',
  SoonBok: '790',
  YuJin: '791',
  SunHi: '180',
  InJoon: '181',
  Algenib: '817',
  Despina: '824',
  Enceladus: '825',
  Ava: '663',
  Marcello: '695',
  William: '713',
  Ash: '706',
  Sage: '709'
};

const VOICE_LOOKUP = {};
for (const [name, id] of Object.entries(VOICES)) {
  VOICE_LOOKUP[name.toLowerCase()] = id;
  VOICE_LOOKUP[id] = id;
}

const VALID_MOODS = ['neutral', 'happy', 'sad', 'angry', 'excited', 'calm', 'serious'];

function sanitize(name) {
  return (name || 'tts')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function randomRevenuecatId() {
  return 'rc_anon_' + crypto.randomBytes(8).toString('hex');
}

async function voiserTTS(text, voiceId, opts = {}) {
  const revenuecatId = randomRevenuecatId();

  const registerRes = await axios.post(`${BASE_URL}/members`, {
    mac: null,
    platform: 'android',
    revenuecatId,
    fcmToken: ''
  }, {
    headers: {
      'User-Agent': 'Neo/1.0',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const memberCode = registerRes.data && registerRes.data.memberCode;
  if (!memberCode) throw new Error('member registration failed');

  const generateRes = await axios.post(`${BASE_URL}/tts`, {
    memberCode,
    text,
    voiceId: String(voiceId),
    pitch: String(opts.pitch || '0'),
    speed: String(opts.speed || '1.0'),
    mood: opts.mood || 'neutral',
    instruction: opts.instruction || '',
    hasEmotionTag: false,
    lang: opts.lang || 'tr'
  }, {
    headers: {
      'User-Agent': 'Dart/3.0 (dart:io)',
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  if (!generateRes.data || generateRes.data.status !== '1' || !generateRes.data.file) {
    throw new Error('tts generation failed');
  }

  return {
    audioUrl: generateRes.data.file,
    id: generateRes.data.id
  };
}

app.get('/tts', async (req, res) => {
  const text = req.query.text;
  const voiceRaw = (req.query.voice || 'Gadis').toString();
  const pitch = req.query.pitch;
  const speed = req.query.speed;
  const mood = req.query.mood;
  const lang = req.query.lang;

  if (!text) return res.status(400).json({ status: 'error', message: 'missing ?text=' });

  const voiceId = VOICE_LOOKUP[voiceRaw.toLowerCase()];
  if (!voiceId) {
    return res.status(400).json({
      status: 'error',
      message: `unknown voice "${voiceRaw}". use /voices to list available.`
    });
  }

  if (mood && !VALID_MOODS.includes(mood)) {
    return res.status(400).json({
      status: 'error',
      message: `unknown mood "${mood}". valid: ${VALID_MOODS.join(', ')}`
    });
  }

  let result;
  try {
    result = await voiserTTS(text, voiceId, { pitch, speed, mood, lang });
  } catch (err) {
    console.log(`tts failed: ${err.message}`);
    return res.status(500).json({ status: 'error', message: err.message });
  }

  const filename = `${sanitize(text.slice(0, 40))}-${sanitize(voiceRaw)}.mp3`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const upstream = await axios.get(result.audioUrl, {
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const len = upstream.headers['content-length'];
    if (len) res.setHeader('Content-Length', len);

    upstream.data.pipe(res);

    upstream.data.on('error', (err) => {
      console.log(`stream error: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    res.on('close', () => {
      try { upstream.data.destroy(); } catch (e) {}
    });
  } catch (err) {
    console.log(`audio fetch failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: err.message });
    else res.end();
  }
});

app.get('/tts-json', async (req, res) => {
  const text = req.query.text;
  const voiceRaw = (req.query.voice || 'Gadis').toString();
  const pitch = req.query.pitch;
  const speed = req.query.speed;
  const mood = req.query.mood;
  const lang = req.query.lang;

  if (!text) return res.status(400).json({ status: 'error', message: 'missing ?text=' });

  const voiceId = VOICE_LOOKUP[voiceRaw.toLowerCase()];
  if (!voiceId) return res.status(400).json({ status: 'error', message: 'unknown voice' });

  try {
    const result = await voiserTTS(text, voiceId, { pitch, speed, mood, lang });
    res.json({ status: 'success', audio_url: result.audioUrl, id: result.id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/voices', (req, res) => {
  const groups = {
    indonesian: ['Gadis', 'Ardi', 'Siti', 'Dimas', 'Tuti', 'Jajang'],
    english: ['Abbi', 'Bella', 'Hollie', 'Maisie', 'Mia', 'Olivia', 'Alfie', 'Elliot', 'Ethan', 'Noah'],
    turkish: ['Meryem', 'Ibrahim'],
    japanese: ['Aoi', 'Daichi', 'Mayu', 'Naoki', 'Shiori', 'Nanami', 'Keita'],
    korean: ['BongJin', 'GookMin', 'Hyunsu', 'JiMin', 'SeoHyeon', 'SoonBok', 'YuJin', 'SunHi', 'InJoon'],
    multilingual: ['Algenib', 'Despina', 'Enceladus', 'Ava', 'Marcello', 'William', 'Ash', 'Sage']
  };

  res.json({
    status: 'success',
    voices: groups,
    moods: VALID_MOODS,
    params: {
      voice: 'name or id',
      pitch: 'number, default 0',
      speed: 'number, default 1.0',
      mood: 'see moods list',
      lang: 'language code, default tr'
    }
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    usage: {
      download: '/tts?text=hello world&voice=Gadis',
      json: '/tts-json?text=hello world&voice=Abbi',
      voices: '/voices'
    },
    example_with_all_params: '/tts?text=hello&voice=Abbi&pitch=2&speed=1.2&mood=happy&lang=en'
  });
});

app.listen(PORT, () => {
  console.log(`http on ${PORT}`);
  console.log(`${Object.keys(VOICES).length} voices loaded`);
});
