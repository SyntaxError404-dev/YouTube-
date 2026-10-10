const express = require('express');
const crypto = require('crypto');
const forge = require('node-forge');

const app = express();
const PORT = process.env.PORT || 3000;

const api = 'https://api.snapwc.com';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const serverPubPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvDU+dR2bSews55172x4L
s/ja+Dxt9ViZcj/nY0YodYo7l4jEKtEiCNV28lpFj3CkP4HKRCjL/jYkQNKGPwVg
gUCGr/jBF1FpDLsqa0kg+dtfkm5Xm9QAyMBeG/jPdl5BEPOVh33A1UkPO/Xw6kSH
rfghOUwBMzRBtXeYuJiYs5sKrf+Wy5sv708TI6G4hAPJG/69W4NNFJi/ipBNxntG
dAoUHpEy4iYsvBgiccE7U0MBDnSHSqBBtIdMMFRHARn/tc+jXaadS0a4YmhTygiN
eAJU4QuqAE25CsvkzIYIVEmlRXVcC0afw76XcwDpKBMVR5bEPzd3tMEfA+R34L1D
fQIDAQAB
-----END PUBLIC KEY-----`;

const serverPub = forge.pki.publicKeyFromPem(serverPubPem);

function genClientKeys() {
  const kp = forge.pki.rsa.generateKeyPair({ bits: 512 });
  return { pub: forge.pki.publicKeyToPem(kp.publicKey), priv: kp.privateKey };
}

function encReq(data, clientPubPem) {
  const aesKeyHex = crypto.randomBytes(16).toString('hex');
  const aesKey = crypto.createHash('sha256').update(aesKeyHex).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    encrypted_key: forge.util.encode64(serverPub.encrypt(aesKeyHex, 'RSAES-PKCS1-V1_5')),
    encrypted_data: Buffer.concat([iv, enc]).toString('base64'),
    client_public_key: clientPubPem
  };
}

function decResp(resp, clientPriv) {
  const aesKeyHex = clientPriv.decrypt(forge.util.decode64(resp.encrypted_key), 'RSAES-PKCS1-V1_5');
  const aesKey = crypto.createHash('sha256').update(aesKeyHex).digest();
  const raw = Buffer.from(resp.encrypted_data, 'base64');
  const dec = crypto.createDecipheriv('aes-256-cbc', aesKey, raw.slice(0, 16));
  return JSON.parse(Buffer.concat([dec.update(raw.slice(16)), dec.final()]).toString('utf8'));
}

function sanitize(name) {
  return (name || 'video')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function snapwc(url) {
  const keys = genClientKeys();
  const hBase = {
    'content-type': 'application/json',
    'user-agent': ua,
    'x-locale': 'en',
    origin: 'https://snapwc.com',
    referer: 'https://snapwc.com/'
  };

  const init = await fetch(`${api}/api.visitor/init`, { method: 'POST', headers: hBase, body: JSON.stringify({}) });
  const jar = init.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const h = { ...hBase, cookie: jar };

  const chk = await (await fetch(`${api}/api.captcha/is_required`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ scenario: 'parser', data: { url } })
  })).json();

  if (chk.status) {
    return { status: 'error', message: 'captcha required, needs solver' };
  }

  const body = encReq({ url }, keys.pub);
  const res = await fetch(`${api}/api.parser/parse`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) return { status: 'error', code: res.status, message: txt.slice(0, 300) };

  let j;
  try { j = JSON.parse(txt); } catch (e) { return { status: 'error', message: 'bad json from upstream' }; }

  const parsed = j.encrypted_data ? decResp(j, keys.priv) : j;
  return { status: 'success', data: parsed };
}

function findBestMp4(payload) {
  const candidates = [];

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

    const url = node.url || node.link || node.download_url || node.downloadUrl;
    const ext = (node.ext || node.extension || node.format || node.type || '').toLowerCase();
    const mime = (node.mime_type || node.mimeType || node.mime || '').toLowerCase();

    if (url && (ext === 'mp4' || mime === 'video/mp4' || mime.startsWith('video/'))) {
      candidates.push({
        url,
        ext: 'mp4',
        quality: node.quality || node.label || node.resolution || node.height || '',
        size: node.size || node.filesize || null,
        raw: node
      });
    }

    for (const k of Object.keys(node)) walk(node[k]);
  };

  walk(payload);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const qa = parseInt(String(a.quality).replace(/\D/g, ''), 10) || 0;
    const qb = parseInt(String(b.quality).replace(/\D/g, ''), 10) || 0;
    return qb - qa;
  });

  return candidates[0];
}

function findTitle(payload) {
  const keys = ['title', 'name', 'video_title', 'filename', 'caption'];
  const seen = new Set();

  const walk = (node) => {
    if (!node || seen.has(node)) return null;
    if (typeof node === 'object') seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const r = walk(item);
        if (r) return r;
      }
      return null;
    }

    if (typeof node !== 'object') return null;

    for (const k of keys) {
      if (typeof node[k] === 'string' && node[k].trim()) return node[k].trim();
    }

    for (const k of Object.keys(node)) {
      const r = walk(node[k]);
      if (r) return r;
    }

    return null;
  };

  return walk(payload) || 'video';
}

app.get('/down', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'missing ?url=' });

  let result;
  try {
    result = await snapwc(url);
  } catch (err) {
    console.log(`snapwc failed: ${err.message}`);
    return res.status(500).json({ status: 'error', message: err.message });
  }

  if (result.status !== 'success') {
    return res.status(500).json(result);
  }

  const best = findBestMp4(result.data);
  if (!best) {
    return res.status(404).json({ status: 'error', message: 'no mp4 stream found', raw: result.data });
  }

  const title = sanitize(findTitle(result.data));
  const filename = `${title}.mp4`;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const upstream = await fetch(best.url, {
      headers: {
        'user-agent': ua,
        'referer': 'https://snapwc.com/',
        'origin': 'https://snapwc.com'
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
  if (!url) return res.status(400).json({ status: 'error', message: 'missing ?url=' });

  try {
    const result = await snapwc(url);
    if (result.status !== 'success') return res.status(500).json(result);
    res.json({ status: 'success', data: result.data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    usage: {
      download: '/down?url=https://youtu.be/VIDEO_ID',
      info: '/info?url=https://youtu.be/VIDEO_ID'
    }
  });
});

app.listen(PORT, () => {
  console.log(`http on ${PORT}`);
});
