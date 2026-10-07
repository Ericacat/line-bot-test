import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookHandler } from '../api/line-webhook.js';
import { createAudioHandler } from '../api/tts.js';
import { createCostStore, LEDGER_KEY } from '../lib/cost-store.js';
import { translateText, createTranslationQuotaGuard } from '../lib/translation.js';
import { createSpeech } from '../lib/speech.js';
import { RedisHarness } from './redis-harness.js';

const userId = `U${'a'.repeat(32)}`;
Object.assign(process.env, { LINE_CHANNEL_SECRET: 'test-secret',
    TRANSLATION_ENABLED: 'true', TTS_ENABLED: 'true', PUBLIC_BASE_URL: 'https://bot.example.com',
    AUDIO_URL_SIGNING_SECRET: 'test-signing-secret-at-least-32-bytes' });
function response() {
    return { code: 0, headers: {}, body: null,
        status(code) { this.code = code; return this; },
        setHeader(key, value) { this.headers[key] = value; },
        send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
}
async function setup() {
    const server = new RedisHarness();
    const store = createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: server.fetch });
    await store.initialize();
    const replies = []; const paid = [];
    const quotaGuard = createTranslationQuotaGuard();
    let translationStatus = 200, speechStatus = 200, resultText = '你食咗飯未？', replyFails = false;
    const fetchImpl = async (url, request) => {
        paid.push({ url, body: JSON.parse(request.body) });
        if (url.includes('translation.googleapis.com')) {
            if (translationStatus !== 200) return Response.json({ error: { message: 'Daily Limit Exceeded' } }, { status: translationStatus });
            return Response.json({ translations: [{ translatedText: JSON.parse(request.body).targetLanguageCode === 'yue' ? resultText : '你吃飯了嗎？' }] });
        }
        assert.equal(url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
        if (speechStatus !== 200) return Response.json({ error: {} }, { status: speechStatus });
        return Response.json({ audioContent: Buffer.from('test-mp3').toString('base64') });
    };
    const deps = { store, reply: async (_token, messages) => { if (replyFails) throw new Error('LINE unavailable'); replies.push(messages); },
        translate: (request, options) => translateText(request, { ...options, quotaGuard, getProject: () => 'test', getToken: async () => 'test', fetchImpl }),
        speech: (text, context, options) => createSpeech(text, context, { ...options, getToken: async () => 'test', fetchImpl }) };
    function makeEvent(text, overrides = {}) {
        return { type: 'message', webhookEventId: `event-${Math.random().toString(16).slice(2)}`, timestamp: server.now,
            replyToken: 'test', source: { type: 'user', userId }, message: { type: 'text', text }, ...overrides };
    }
    async function send(event, handler = createWebhookHandler(deps), validSignature = true) {
        const rawBody = Buffer.from(JSON.stringify({ events: [event] }));
        const req = { method: 'POST', rawBody, headers: { host: 'untrusted.example.com',
            'x-line-signature': validSignature ? createHmac('sha256', 'test-secret').update(rawBody).digest('base64') : 'invalid' } };
        const res = response(); await handler(req, res); return res;
    }
    return { server, store, replies, paid, deps, makeEvent, send,
        setTranslationStatus: (value) => { translationStatus = value; }, setSpeechStatus: (value) => { speechStatus = value; },
        setResult: (value) => { resultText = value; }, failReply: () => { replyFails = true; } };
}

test('signed webhook performs both directions; audio downloads never synthesize again', async () => {
    const h = await setup();
    await h.send(h.makeEvent('粵語：你吃飯了嗎？'));
    const messages = h.replies.at(-1);
    assert.match(messages[0].text, /^粵語翻譯：你食咗飯未？\n粵拼：/);
    const url = new URL(messages[1].originalContentUrl);
    assert.equal(url.origin, 'https://bot.example.com'); assert.equal(url.searchParams.has('text'), false);
    assert.equal(h.paid[1].body.input.text, '你食咗飯未？');
    assert.equal(h.paid[1].body.voice.name, 'yue-HK-Standard-A');
    const downloads = createAudioHandler({ store: h.store });
    for (let i = 0; i < 3; i++) {
        const res = response(); await downloads({ method: 'GET', query: { token: url.searchParams.get('token') } }, res);
        assert.equal(res.code, 200); assert.equal(res.body.toString(), 'test-mp3');
    }
    assert.equal(h.paid.length, 2);
    await h.send(h.makeEvent('中文：你食咗飯未？'));
    assert.deepEqual(h.replies.at(-1), [{ type: 'text', text: '中文翻譯：你吃飯了嗎？' }]);
    await h.send(h.makeEvent('你好'));
    assert.match(h.replies.at(-1)[0].text, /^你好\n粵拼：/);
    assert.equal(h.paid.length, 4);
});

test('bad signatures, stale IDs and oversized input never call paid APIs', async () => {
    const h = await setup();
    assert.equal((await h.send(h.makeEvent('你好'), undefined, false)).code, 401);
    await h.send(h.makeEvent('你好', { timestamp: Date.now() - 11 * 60000 }));
    await h.send(h.makeEvent('你好', { webhookEventId: undefined }));
    await h.send(h.makeEvent('😀'.repeat(301)));
    assert.equal(h.paid.length, 0); assert.match(h.replies.at(-1)[0].text, /300/);
    const readsBefore = h.server.calls.length;
    const res = response(); await createAudioHandler({ store: h.store })({ method: 'GET', query: { text: '你好' } }, res);
    assert.equal(res.code, 403); assert.equal(h.server.calls.length, readsBefore);
});

test('concurrent duplicate webhooks and a new handler synthesize only once', async () => {
    const h = await setup(); const event = h.makeEvent('粵語：你好');
    await Promise.all(Array.from({ length: 8 }, () => h.send(event)));
    await h.send({ ...event, deliveryContext: { isRedelivery: true } }, createWebhookHandler(h.deps));
    assert.equal(h.paid.length, 2); assert.equal(h.replies.length, 1);
});

test('storage failures before claims and reservations block paid API calls', async () => {
    const h = await setup(); h.server.fail = true;
    assert.equal((await h.send(h.makeEvent('粵語：你好'))).code, 200);
    assert.equal(h.paid.length, 0); assert.match(h.replies.at(-1)[0].text, /用量記錄/);
    h.server.fail = false;
    const brokenStore = { ...h.store, reserve: async () => { throw new Error('Uncertain counter'); } };
    await h.send(h.makeEvent('粵語：你好'), createWebhookHandler({ ...h.deps, store: brokenStore }));
    await h.send(h.makeEvent('你好'), createWebhookHandler({ ...h.deps, store: brokenStore }));
    assert.equal(h.paid.length, 0);
});

test('API and reply failures consume reserved amounts and never retry on redelivery', async () => {
    const h = await setup(); h.setTranslationStatus(429);
    const translation = h.makeEvent('粵語：你好'); await h.send(translation); await h.send(translation);
    assert.equal(h.paid.length, 1); assert.equal(h.server.get(LEDGER_KEY).value.translation, '2');
    h.setSpeechStatus(500); const speech = h.makeEvent('你好'); await h.send(speech); await h.send(speech);
    assert.equal(h.paid.length, 2); assert.equal(h.server.get(LEDGER_KEY).value.tts, '2');
    h.setSpeechStatus(200); h.failReply(); const failedReply = h.makeEvent('你好');
    await h.send(failedReply); await h.send(failedReply); assert.equal(h.paid.length, 3);
});

test('oversized translation output is not synthesized; audio access expires', async () => {
    const h = await setup(); h.setResult('字'.repeat(301));
    await h.send(h.makeEvent('粵語：你好')); assert.equal(h.paid.length, 1);
    assert.equal(h.replies.at(-1).length, 1); assert.match(h.replies.at(-1)[0].text, /300/);
    await h.send(h.makeEvent('你好'));
    const token = new URL(h.replies.at(-1)[1].originalContentUrl).searchParams.get('token');
    const handler = createAudioHandler({ store: h.store });
    const invalid = response(); await handler({ method: 'GET', query: { token: token.slice(0, -1) + (token.endsWith('0') ? '1' : '0') } }, invalid);
    assert.equal(invalid.code, 403);
    h.server.now += 3600001;
    const expired = response(); await handler({ method: 'GET', query: { token } }, expired); assert.equal(expired.code, 404);
    assert.equal(h.paid.length, 2);
});

test('disabled feature switches cannot trigger paid API calls', async () => {
    const h = await setup();
    process.env.TRANSLATION_ENABLED = 'false'; process.env.TTS_ENABLED = 'false';
    try {
        await h.send(h.makeEvent('粵語：你好')); await h.send(h.makeEvent('你好'));
        assert.equal(h.paid.length, 0);
        const res = response(); await createAudioHandler({ store: h.store })({ method: 'GET', query: { text: '你好' } }, res);
        assert.equal(res.code, 403);
    } finally { process.env.TRANSLATION_ENABLED = 'true'; process.env.TTS_ENABLED = 'true'; }
});

test('all LINE users and group events use the existing speech flow without a whitelist', async () => {
    const h = await setup();
    for (const source of [{ type: 'user', userId }, { type: 'user', userId: `U${'b'.repeat(32)}` }, { type: 'group', groupId: 'test-group' }]) {
        await h.send(h.makeEvent('你好', { source }));
    }
    assert.equal(h.paid.length, 3);
    assert.equal(h.replies.length, 3);
    assert.equal(h.server.get(LEDGER_KEY).value.tts, '6');
});

test('translation cap is shared across users and redeployed handlers at exactly 1500 characters', async () => {
    const h = await setup();
    for (let i = 0; i < 5; i++) {
        const store = createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: h.server.fetch });
        await h.send(h.makeEvent(`中文：${'字'.repeat(297)}`, { source: { userId: `U${String(i).repeat(32)}` } }),
            createWebhookHandler({ ...h.deps, store }));
    }
    await h.send(h.makeEvent(`中文：${'字'.repeat(15)}`));
    assert.equal(h.paid.length, 6);
    assert.equal(h.server.get(LEDGER_KEY).value.translation, '1500');
    const redeployed = createWebhookHandler({ ...h.deps,
        store: createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: h.server.fetch }) });
    await h.send(h.makeEvent('中文：字', { source: { userId: `U${'f'.repeat(32)}` } }), redeployed);
    assert.equal(h.paid.length, 6);
    assert.match(h.replies.at(-1)[0].text, /翻譯已達 1,500/);
    // Translation exhaustion does not spend or block the separate speech quota.
    await h.send(h.makeEvent('你好'), redeployed);
    assert.equal(h.paid.length, 7);
    assert.equal(h.server.get(LEDGER_KEY).value.tts, '2');
});

test('speech cap is shared across users and redeployed handlers; reaching it never calls Google again', async () => {
    const h = await setup();
    for (let i = 0; i < 5; i++) {
        const store = createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: h.server.fetch });
        await h.send(h.makeEvent('字'.repeat(300), { source: { userId: `U${String(i).repeat(32)}` } }),
            createWebhookHandler({ ...h.deps, store }));
    }
    assert.equal(h.paid.length, 5);
    assert.equal(h.server.get(LEDGER_KEY).value.tts, '1500');
    await h.send(h.makeEvent('字', { source: { userId: `U${'f'.repeat(32)}` } }));
    assert.equal(h.paid.length, 5);
    assert.equal(h.replies.at(-1).length, 1);
    assert.match(h.replies.at(-1)[0].text, /語音已達 1,500/);
    // The independent translation quota remains usable.
    await h.send(h.makeEvent('中文：你好'));
    assert.equal(h.paid.length, 6);
    assert.equal(h.server.get(LEDGER_KEY).value.translation, '2');
});
