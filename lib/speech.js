import { randomBytes } from 'node:crypto';
import { googleAccessToken } from './google-auth.js';
import { checkText, ProtectionError } from './cost-policy.js';
import { AUDIO_TTL } from './cost-store.js';
import { audioToken, speechRequestToken } from './audio-token.js';
export const TTS_VOICE = 'yue-HK-Standard-A';
const MAX_AUDIO_BYTES = 1024 * 1024;
export function publicOrigin() {
    try {
        const url = new URL(process.env.PUBLIC_BASE_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
        return url.origin;
    } catch { throw new ProtectionError('CONFIG', '公開網址尚未設定。'); }
}
export async function createSpeech(text, context, { store, getToken = googleAccessToken, fetchImpl = fetch } = {}) {
    checkText(text);
    if (process.env.TTS_ENABLED !== 'true') throw new ProtectionError('DISABLED', '語音功能尚未啟用。');
    const origin = publicOrigin();
    if (!store) {
        const token = speechRequestToken(text);
        return { type: 'audio', originalContentUrl: `${origin}/api/tts?token=${token}`,
            duration: Math.min(120000, Math.max(1200, [...text].length * 300)) };
    }
    const id = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUDIO_TTL * 1000;
    const token = audioToken(id, expiresAt); // Validate configuration before calling Google.
    await store.reserve('tts', text, context);
    const buffer = await synthesizeSpeech(text, { getToken, fetchImpl });
    await store.saveAudio(id, { expiresAt, audio: buffer.toString('base64') });
    return { type: 'audio', originalContentUrl: `${origin}/api/tts?token=${token}`,
        duration: Math.min(120000, Math.max(1200, [...text].length * 300)) };
}

// No retries or alternate provider. Each actual synthesis is at most 300 characters.
export async function synthesizeSpeech(text, { getToken = googleAccessToken, fetchImpl = fetch } = {}) {
    checkText(text);
    if (process.env.TTS_ENABLED !== 'true') throw new ProtectionError('DISABLED', '語音功能尚未啟用。');
    const accessToken = await getToken();
    const response = await fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: 'yue-HK', name: TTS_VOICE },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 } }),
        signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw new ProtectionError('TTS', '語音服務暫時無法使用，不會自動重試。');
    const data = await response.json();
    if (typeof data.audioContent !== 'string' || !data.audioContent || data.audioContent.length > MAX_AUDIO_BYTES * 4 / 3 + 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audioContent)) throw new Error('Invalid speech response');
    const buffer = Buffer.from(data.audioContent, 'base64');
    if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new Error('Invalid audio size');
    return buffer;
}
