const express = require('express');
const crypto = require('crypto');
const forge = require('node-forge');
const sharp = require('sharp');
const fs = require('fs');
const { execSync } = require('child_process');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const api = 'https://api.snapwc.com';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const serverPubPem = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvDU+dR2bSews55172x4L\ns/ja+Dxt9ViZcj/nY0YodYo7l4jEKtEiCNV28lpFj3CkP4HKRCjL/jYkQNKGPwVg\ngUCGr/jBF1FpDLsqa0kg+dtfkm5Xm9QAyMBeG/jPdl5BEPOVh33A1UkPO/Xw6kSH\nrfghOUwBMzRBtXeYuJiYs5sKrf+Wy5sv708TI6G4hAPJG/69W4NNFJi/ipBNxntG\ndAoUHpEy4iYsvBgiccE7U0MBDnSHSqBBtIdMMFRHARn/tc+jXaadS0a4YmhTygiN\neAJU4QuqAE25CsvkzIYIVEmlRXVcC0afw76XcwDpKBMVR5bEPzd3tMEfA+R34L1D\nfQIDAQAB\n-----END PUBLIC KEY-----`;
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

async function solveCaptcha(imageB64) {
  const raw = Buffer.from(imageB64.replace(/^data:image\/png;base64,/, ''), 'base64');
  const p = `/tmp/snapwc-${Date.now()}-${Math.random()}.png`;
  
  if (!fs.existsSync('/tmp')) fs.mkdirSync('/tmp');
  
  console.log(`[CAPTCHA] Noise reduction engaged. Sending to Tesseract OCR...`);
  await sharp(raw).resize(1200, null, { kernel: 'lanczos3' }).grayscale().normalize().toFile(p);
  const attempts = [];
  
  try {
    attempts.push(execSync(`tesseract ${p} - -l eng --psm 7 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim().replace(/\s+/g, ''));
  } catch (e) {}
  
  try {
    attempts.push(execSync(`tesseract ${p} - -l eng --psm 8 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim().replace(/\s+/g, ''));
  } catch (e) {}
  
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return [...new Set(attempts.filter(x => x.length === 4))];
}

async function snapwc(url, maxAttempts = 15) {
  const keys = genClientKeys();
  const hBase = {
    'content-type': 'application/json',
    'user-agent': ua,
    'x-locale': 'en',
    origin: 'https://snapwc.com',
    referer: 'https://snapwc.com/'
  };

  const init = await fetch(`${api}/api.visitor/init`, { method: 'POST', headers: hBase, body: JSON.stringify({}) });
  
  let jar = '';
  const setCookie = init.headers.get('set-cookie');
  if (setCookie) {
    jar = setCookie.split(';')[0];
  }
  
  const h = { ...hBase, cookie: jar };

  const chk = await (await fetch(`${api}/api.captcha/is_required`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ scenario: 'parser', data: { url } })
  })).json();

  if (chk.status) {
    let solved = false;
    for (let i = 0; i < maxAttempts && !solved; i++) {
      const genRes = await fetch(`${api}/api.captcha/generate`, { method: 'POST', headers: h, body: JSON.stringify({}) });
      if (genRes.status !== 200) break;
      const gen = await genRes.json();
      const codes = await solveCaptcha(gen.captcha_image);
      
      for (const code of codes) {
        const v = await fetch(`${api}/api.captcha/verify`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ captcha_token: gen.captcha_token, captcha_code: code, scenario: 'parser', data: { url } })
        });
        if (v.status === 200) { 
          solved = true; 
          console.log(`[CAPTCHA] Checkmate. Hash cracked: ${code}`);
          break; 
        }
      }
    }
    if (!solved) return { status: 'error', message: 'Visual challenge evasion failed after max retries.' };
  }

  const body = encReq({ url }, keys.pub);
  const res = await fetch(`${api}/api.parser/parse`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) return { status: 'error', code: res.status, message: txt.slice(0, 300) };
  
  const j = JSON.parse(txt);
  const parsed = j.encrypted_data ? decResp(j, keys.priv) : j;
  return { status: 'success', data: parsed };
}

app.get('/down', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  console.log(`[API] Extracting video artifact: ${targetUrl}`);

  try {
    const result = await snapwc(targetUrl);
    
    if (result.status !== 'success' || !result.data) {
      console.error(`[API-ERROR] Extraction failed: ${result.message}`);
      return res.status(500).json({ error: result.message || 'Extraction failed' });
    }

    let downloadUrl = null;
    let title = result.data.title || 'video';

    if (result.data.medias && Array.isArray(result.data.medias)) {
      const mp4s = result.data.medias.filter(m => (m.extension === 'mp4' || m.type === 'video') && m.url);
      if (mp4s.length > 0) {
        downloadUrl = mp4s[0].url;
      } else if (result.data.medias[0] && result.data.medias[0].url) {
        downloadUrl = result.data.medias[0].url;
      }
    } else if (result.data.video_url) {
      downloadUrl = result.data.video_url;
    } else if (result.data.url) {
      downloadUrl = result.data.url;
    }

    if (!downloadUrl) {
      return res.status(500).json({ error: 'No MP4 payload found in the target response.' });
    }

    console.log(`[API] Payload mapped: ${title}. Piping direct to client...`);

    const safeTitle = title.replace(/[^a-zA-Z0-9 -]/g, '');
    const streamRes = await fetch(downloadUrl, {
      headers: { 'User-Agent': ua }
    });

    if (!streamRes.ok) {
      throw new Error('Host rejected the stream transfer.');
    }

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    streamRes.body.pipe(res);

    streamRes.body.on('error', (err) => {
      console.error(`[STREAM-ERROR] Pipeline broken: ${err.message}`);
      res.end();
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[SYSTEM] Extraction Gateway bound to port ${PORT}`);
});
