import { verifyAudioToken, verifySpeechRequest } from '../lib/audio-token.js';

import { synthesizeSpeech, speechEnabled } from '../lib/speech.js';

// Best-effort cache: shares concurrent downloads within this instance, including failures.
// It is not a durable counter or a cross-instance exactly-once guarantee.
export function createSpeechCache({ now = Date.now, maxEntries = 32 } = {}) {
    const entries = new Map();
    return async (token, request, synthesize) => {
        for (const [key, entry] of entries) if (entry.expiresAt <= now()) entries.delete(key);
        if (!entries.has(token)) {
            if (entries.size >= maxEntries) throw new Error('Speech cache full');
            const pending = Promise.resolve().then(() => synthesize(request.text));
            entries.set(token, { expiresAt: request.expiresAt, pending });
        }
        return entries.get(token).pending;
    };
}
const sharedSpeechCache = createSpeechCache();
export function createAudioHandler({ store, synthesize = synthesizeSpeech, speechCache = sharedSpeechCache } = {}) {
    return async function handler(req, res) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
        try {
            if (!speechEnabled()) return res.status(403).send('Audio disabled');
            if (!store) {
                const request = verifySpeechRequest(req.query?.token);
                if (!request) return res.status(403).send('Invalid audio token');
                const audio = await speechCache(req.query.token, request, synthesize);
                res.setHeader('Content-Type', 'audio/mpeg');
                return res.status(200).send(audio);
            }
            const verified = verifyAudioToken(req.query?.token);
            if (!verified) return res.status(403).send('Invalid audio token');
            const data = await store.readAudio(verified.id);
            if (!data || data.expiresAt !== verified.expiresAt || data.expiresAt <= Date.now()) return res.status(404).send('Audio expired');
            if (typeof data.audio !== 'string' || data.audio.length > 1398104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio)) throw new Error('Invalid saved audio');
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.status(200).send(Buffer.from(data.audio, 'base64'));
        } catch {
            return res.status(503).send('Audio unavailable');
        }
    };
}
export default createAudioHandler();
