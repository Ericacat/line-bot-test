import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, synthesizeSpeech } from '../lib/speech.js';
import { speechRequestToken, verifySpeechRequest } from '../lib/audio-token.js';
import { createAudioHandler, createSpeechCache } from '../api/tts.js';
Object.assign(process.env, { TTS_ENABLED: 'true', PUBLIC_BASE_URL: 'https://bot.example.com',
    AUDIO_URL_SIGNING_SECRET: 'test-secret-with-at-least-32-bytes-long' });
function response() { return { code: 0, headers: {}, status(code) { this.code = code; return this; },
    setHeader(key, value) { this.headers[key] = value; }, send(body) { this.body = body; return this; } }; }

test('no-storage speech issues encrypted authorized URLs without calling Google', async () => {
    let calls = 0;
    const message = await createSpeech('你好', {}, { getToken: async () => { calls++; } });
    const token = new URL(message.originalContentUrl).searchParams.get('token');
    assert.equal(calls, 0); assert.equal(message.type, 'audio');
    assert.equal(verifySpeechRequest(token).text, '你好');
    assert.equal(message.originalContentUrl.includes('你好'), false);
    const emoji = speechRequestToken('😀'.repeat(300));
    assert.ok(emoji.length <= 1800); assert.ok(verifySpeechRequest(emoji));
    await assert.rejects(createSpeech('字'.repeat(301), {}), { code: 'TOO_LONG' });
});

test('concurrent downloads share synthesis; text, tampered and expired URLs never synthesize', async () => {
    let calls = 0;
    const token = speechRequestToken('你好');
    const handler = createAudioHandler({ speechCache: createSpeechCache(), synthesize: async () => {
        calls++; return Buffer.from('mp3');
    } });
    const results = await Promise.all(Array.from({ length: 5 }, async () => {
        const res = response(); await handler({ method: 'GET', query: { token } }, res); return res;
    }));
    assert.equal(calls, 1);
    for (const res of results) { assert.equal(res.code, 200); assert.equal(res.body.toString(), 'mp3'); }
    for (const query of [{ text: '你好' }, { token: token.slice(0, 10) + 'A' + token.slice(11) },
        { token: speechRequestToken('你好', Date.now() - 600001) }]) {
        const res = response(); await handler({ method: 'GET', query }, res); assert.equal(res.code, 403);
    }
    assert.equal(calls, 1);
});

test('Google failures are cached locally and never automatically retried', async () => {
    let calls = 0;
    const handler = createAudioHandler({ speechCache: createSpeechCache(), synthesize: (text) => synthesizeSpeech(text, {
        getToken: async () => 'token', fetchImpl: async (_url, options) => {
            calls++; assert.equal(JSON.parse(options.body).voice.name, 'yue-HK-Standard-A');
            return Response.json({}, { status: 429 });
        }
    }) });
    const token = speechRequestToken('你好');
    for (let i = 0; i < 2; i++) {
        const res = response(); await handler({ method: 'GET', query: { token } }, res); assert.equal(res.code, 503);
    }
    assert.equal(calls, 1);
});

test('single-call limits, disable switch and cache overflow stop synthesis', async () => {
    let calls = 0;
    const deps = { getToken: async () => { calls++; }, fetchImpl: async () => { calls++; } };
    await assert.rejects(synthesizeSpeech('字'.repeat(301), deps), { code: 'TOO_LONG' });
    const handler = createAudioHandler({ speechCache: createSpeechCache({ maxEntries: 0 }), synthesize: async () => { calls++; } });
    const token = speechRequestToken('你好'); const full = response();
    await handler({ method: 'GET', query: { token } }, full); assert.equal(full.code, 503);
    process.env.TTS_ENABLED = 'false';
    try {
        const res = response(); await createAudioHandler()({ method: 'GET', query: { token } }, res);
        assert.equal(res.code, 403);
        await assert.rejects(synthesizeSpeech('你好', deps), { code: 'DISABLED' });
    } finally { process.env.TTS_ENABLED = 'true'; }
    assert.equal(calls, 0);
});
