import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { translateText, parseTranslation, createTranslationQuotaGuard } from '../lib/translation.js';
import { createWebhookHandler } from '../api/line-webhook.js';
import { createAudioHandler } from '../api/tts.js';
import { createEventGuard } from '../lib/event-guard.js';

Object.assign(process.env, { LINE_CHANNEL_SECRET: 'native-test-secret', TRANSLATION_ENABLED: 'true',
    TRANSLATION_QUOTA_CONFIRMED: 'true', TTS_ENABLED: 'true' });
function response() {
    return { code: 0, headers: {}, body: null, status(value) { this.code = value; return this; },
        setHeader(key, value) { this.headers[key] = value; },
        json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
}
async function send(handler, event, valid = true) {
    const rawBody = Buffer.from(JSON.stringify({ events: [event] }));
    const req = { method: 'POST', rawBody, headers: { 'x-line-signature': valid
        ? createHmac('sha256', 'native-test-secret').update(rawBody).digest('base64') : 'invalid' } };
    const res = response(); await handler(req, res); return res;
}
function event(id, text, overrides = {}) {
    return { type: 'message', webhookEventId: id, timestamp: Date.now(), replyToken: 'reply',
        message: { type: 'text', text }, ...overrides };
}
function setup() {
    const requests = [], replies = [];
    const quotaGuard = createTranslationQuotaGuard();
    let status = 200;
    const deps = { eventGuard: createEventGuard(), reply: async (_token, value) => { replies.push(value); },
        speech: async () => ({ type: 'audio', originalContentUrl: 'https://bot.example.com/api/tts?token=test', duration: 1200 }),
        translate: (request, options) => translateText(request, { ...options, quotaGuard,
            getProject: () => 'native-project', getToken: async () => 'test-token',
            fetchImpl: async (url, requestOptions) => {
                requests.push({ url, body: JSON.parse(requestOptions.body) });
                return status === 200 ? Response.json({ translations: [{ translatedText: '你食咗飯未？' }] })
                    : Response.json({ error: { message: 'Daily Limit Exceeded' } }, { status });
            } }),
    };
    return { deps, requests, replies, setStatus: (value) => { status = value; } };
}

test('default native flow translates both directions and retains Cantonese audio without storage', async () => {
    const h = setup(); const handler = createWebhookHandler(h.deps);
    await send(handler, event('native-yue', '粵語：你吃飯了嗎？'));
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].body.model, /\/models\/general\/nmt$/);
    assert.match(h.replies[0][0].text, /粵語翻譯：.*\n粵拼：/);
    assert.equal(h.replies[0][1].type, 'audio');
    assert.equal(h.replies[0].length, 2);
    await send(handler, event('native-zh', '中文：你食咗飯未？'));
    assert.equal(h.requests[1].body.targetLanguageCode, 'zh-TW');
    assert.equal(h.replies[1].length, 1);
    await send(handler, event('native-normal', '你好'));
    assert.equal(h.requests.length, 2); assert.match(h.replies[2][0].text, /^你好\n粵拼：/);
    const res = response(); await createAudioHandler()({ method: 'GET', query: { text: '你好' } }, res);
    assert.equal(res.code, 403);
});

test('quota configuration must be confirmed before authentication or Google calls', async () => {
    let calls = 0;
    await assert.rejects(translateText(parseTranslation('中文：你好'), { enabled: true, quotaConfirmed: false,
        getToken: async () => { calls++; }, fetchImpl: async () => { calls++; } }), { code: 'QUOTA_CONFIG' });
    assert.equal(calls, 0);
});

test('daily quota error is reported once and blocks subsequent local calls without retrying', async () => {
    const h = setup(); h.setStatus(403); const handler = createWebhookHandler(h.deps);
    await send(handler, event('native-limit-first', '中文：你好'));
    await send(handler, event('native-limit-next', '中文：你好'));
    assert.equal(h.requests.length, 1);
    for (const reply of h.replies) assert.match(reply[0].text, /今日翻譯額度已用完/);
});

test('duplicate/redelivered, stale, oversized and invalidly signed events cannot restart calls', async () => {
    const h = setup(); const handler = createWebhookHandler(h.deps);
    const same = event('native-duplicate', '中文：你好');
    await Promise.all(Array.from({ length: 5 }, () => send(handler, same)));
    await send(createWebhookHandler(h.deps), same);
    await send(handler, event('native-redelivery', '中文：你好', { deliveryContext: { isRedelivery: true } }));
    await send(handler, event('native-stale', '中文：你好', { timestamp: Date.now() - 11 * 60000 }));
    await send(handler, event('native-big', '😀'.repeat(301)));
    assert.equal((await send(handler, event('native-bad-signature', '中文：你好'), false)).code, 401);
    assert.equal(h.requests.length, 1);
});

test('daily exhaustion uses Pacific midnight and is only a process-local optimization', () => {
    let now = new Date('2026-10-08T06:59:00Z');
    const guard = createTranslationQuotaGuard({ now: () => now });
    guard.exhaust('project'); assert.throws(() => guard.assertAvailable('project'), { code: 'QUOTA' });
    now = new Date('2026-10-08T07:01:00Z');
    assert.doesNotThrow(() => guard.assertAvailable('project'));
    // A new instance rechecks Google; it does not reset Google's actual quota.
    const freshInstance = createTranslationQuotaGuard({ now: () => now });
    assert.doesNotThrow(() => freshInstance.assertAvailable('project'));
});

test('event cache refuses overflow instead of evicting a fresh claim', () => {
    const guard = createEventGuard({ maxEntries: 1 });
    assert.ok(guard.claim(event('first', '你好')));
    assert.throws(() => guard.claim(event('second', '你好')), { code: 'BUSY' });
    assert.equal(guard.claim(event('first', '你好')), null);
});
