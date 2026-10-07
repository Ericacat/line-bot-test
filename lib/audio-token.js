import { createHmac, timingSafeEqual, createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ProtectionError, checkText } from './cost-policy.js';
function secret() {
    const value = process.env.AUDIO_URL_SIGNING_SECRET;
    if (!value || Buffer.byteLength(value) < 32) throw new ProtectionError('CONFIG', '語音網址金鑰尚未設定。');
    return value;
}
function signature(payload) { return createHmac('sha256', secret()).update(payload).digest('hex'); }
export function audioToken(id, expiresAt) {
    const payload = `${id}.${expiresAt}`;
    return `${payload}.${signature(payload)}`;
}
export function verifyAudioToken(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const match = token.match(/^([0-9a-f]{64})\.(\d{13})\.([0-9a-f]{64})$/);
    if (!match) return null;
    const expiresAt = Number(match[2]);
    if (expiresAt <= now || expiresAt > now + 3600000) return null;
    const expected = Buffer.from(signature(`${match[1]}.${match[2]}`), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(match[3], 'hex'))) return null;
    return { id: match[1], expiresAt };
}

// Encrypted, authenticated short-lived requests avoid exposing message text in URLs.
export const SPEECH_URL_TTL_MS = 10 * 60 * 1000;
function requestKey() { return createHash('sha256').update(secret()).digest(); }
export function speechRequestToken(text, now = Date.now()) {
    checkText(text);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', requestKey(), iv);
    cipher.setAAD(Buffer.from('line-bot:speech:v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ text, expiresAt: now + SPEECH_URL_TTL_MS })), cipher.final()]);
    return 's1.' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function verifySpeechRequest(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 1800 || !/^s1\.[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
        const data = Buffer.from(token.slice(3), 'base64url');
        if (data.length < 29) return null;
        const decipher = createDecipheriv('aes-256-gcm', requestKey(), data.subarray(0, 12));
        decipher.setAAD(Buffer.from('line-bot:speech:v1'));
        decipher.setAuthTag(data.subarray(12, 28));
        const request = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
        if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now || request.expiresAt > now + SPEECH_URL_TTL_MS) return null;
        checkText(request.text);
        return request;
    } catch { return null; }
}
