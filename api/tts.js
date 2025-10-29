// api/tts-google.js
// 使用 Google Cloud Text-to-Speech 把 ?text=xxx 轉成粵語 MP3
import { TextEncoder } from 'node:util';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

    const text = (req.query.text || '').toString().trim();
    if (!text) return res.status(400).send('Missing ?text=');

    let saJson;
    try {
        saJson = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
    } catch {
        return res.status(500).send('Bad service account JSON');
    }
    if (!saJson.client_email || !saJson.private_key) {
        return res.status(500).send('Service account not configured');
    }

    try {
        // 1) 用服務帳戶簽 JWT 換 access_token
        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const claim = {
            iss: saJson.client_email,
            sub: saJson.client_email,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
            scope: 'https://www.googleapis.com/auth/cloud-platform'
        };
        const toB64u = (obj) =>
            Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const unsigned = `${toB64u(header)}.${toB64u(claim)}`;

        // Web Crypto 簽名 (Node 18+)
        const keyData = Buffer.from(
            saJson.private_key.replace(/-----\w+ PRIVATE KEY-----/g, '').replace(/\n/g, ''),
            'base64'
        );
        const key = await crypto.subtle.importKey(
            'pkcs8',
            keyData,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
        const jwt = `${unsigned}.${Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;

        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
        });
        if (!tokenResp.ok) throw new Error('token fetch failed');
        const { access_token } = await tokenResp.json();

        // 2) 呼叫 TTS：粵語 yue-HK 女聲 Standard-A（男聲可改 Standard-B）
        const ttsResp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: { languageCode: 'yue-HK', name: 'yue-HK-Standard-A' },
                audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
            })
        });
        if (!ttsResp.ok) throw new Error(`tts ${ttsResp.status}`);
        const data = await ttsResp.json();
        const buf = Buffer.from(data.audioContent, 'base64');

        res.setHeader('Content-Type', 'audio/mpeg'); // MP3
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).send(buf);
    } catch (e) {
        console.error('TTS error:', e);
        return res.status(500).send('TTS error');
    }
}
