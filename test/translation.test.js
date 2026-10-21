import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranslation, translateText, createTranslationQuotaGuard } from '../lib/translation.js';
const options = { enabled: true, context: {}, store: { reserve: async () => {} },
    getProject: () => 'test-project', getToken: async () => 'test-token' };

test('both translation directions use NMT only after successful reservation', async () => {
    for (const [input, source, target] of [['粵語：你好', 'zh-TW', 'yue'], ['中文: 你食咗飯未？', 'yue', 'zh-TW']]) {
        const order = [];
        await translateText(parseTranslation(input), { ...options,
            store: { reserve: async (service, text) => { assert.equal(service, 'translation'); assert.equal(text, parseTranslation(input).text); order.push('reserve'); } },
            getToken: async () => { order.push('token'); return 'test'; },
            fetchImpl: async (url, request) => {
                order.push('translate'); assert.match(url, /^https:\/\/translation.googleapis.com\/v3\//);
                const body = JSON.parse(request.body);
                assert.equal(body.sourceLanguageCode, source); assert.equal(body.targetLanguageCode, target);
                assert.equal(body.mimeType, 'text/plain'); assert.match(body.model, /\/models\/general\/nmt$/);
                assert.equal(request.redirect, 'error');
                return Response.json({ translations: [{ translatedText: '翻譯結果' }] });
            },
        });
        assert.deepEqual(order, ['reserve', 'token', 'translate']);
    }
    assert.equal(parseTranslation('你好'), null);
});

test('disabled, empty and oversized input never contact Google', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('Unexpected network'); };
    await assert.rejects(translateText(parseTranslation('粵語：你好'), { ...options, enabled: false, fetchImpl }), { code: 'DISABLED' });
    await assert.rejects(translateText(parseTranslation('翻譯：'), { ...options, fetchImpl }), { code: 'EMPTY' });
    await assert.rejects(translateText(parseTranslation(`粵語：${'😀'.repeat(301)}`), { ...options, fetchImpl }), { code: 'TOO_LONG' });
    assert.equal(calls, 0);
});

test('reservation failure blocks authentication and translation', async () => {
    let calls = 0;
    await assert.rejects(translateText(parseTranslation('粵語：你好'), { ...options,
        store: { reserve: async () => { throw new Error('Counter failed'); } },
        getToken: async () => { calls++; }, fetchImpl: async () => { calls++; },
    }), /Counter failed/);
    assert.equal(calls, 0);
});

test('300 Unicode code points accepted and API errors never retry', async () => {
    assert.equal(await translateText(parseTranslation(`粵語：${'😀'.repeat(300)}`), { ...options,
        fetchImpl: async () => Response.json({ translations: [{ translatedText: '😀' }] }),
    }), '😀');
    for (const [status, message, code] of [[403, 'Daily Limit Exceeded', 'QUOTA'], [429, 'Resource exhausted', 'QUOTA'], [403, 'Permission denied', undefined]]) {
        let calls = 0;
        await assert.rejects(translateText(parseTranslation('粵語：你好'), { ...options, quotaGuard: createTranslationQuotaGuard(),
            fetchImpl: async () => { calls++; return Response.json({ error: { message } }, { status }); },
        }), (error) => error.code === code);
        assert.equal(calls, 1);
    }
});


test('unified translation infers Cantonese cues, defaults shared phrases to Cantonese and honors overrides', () => {
    for (const input of ['翻譯：這個多少錢？', '翻譯: 你好', '翻譯：我們的關係很好', '翻譯：食物很好吃']) {
        const request = parseTranslation(input);
        assert.equal(request.source, 'zh-TW');
        assert.equal(request.target, 'yue');
    }
    for (const input of ['翻譯：你食咗飯未？', '翻譯: 佢喺邊度', '翻譯：幾多錢', '翻譯：你食飯未', '翻譯：係']) {
        assert.equal(parseTranslation(input).source, 'yue');
        assert.equal(parseTranslation(input).target, 'zh-TW');
    }
    assert.equal(parseTranslation('粵語：你食咗飯未？').target, 'yue');
    assert.equal(parseTranslation('中文：你好').target, 'zh-TW');
    assert.equal(parseTranslation('翻譯這個多少錢'), null);
    assert.equal(parseTranslation('翻譯：').text, '');
});


test('food sentences with colloquial 食 route to Chinese without misclassifying standard Chinese food terms', () => {
    for (const text of ['我泥到香港一定要食蛋撻', '我來到香港一定要食蛋撻', '我想食雞肉', '食蛋挞', '你想食牛肉嗎']) {
        assert.equal(parseTranslation(`翻譯：${text}`).target, 'zh-TW', text);
    }
    for (const text of ['我想買食物', '我要食物', '食品很好吃', '我想去食堂', '我想食用這個產品', '食材很新鮮']) {
        assert.equal(parseTranslation(`翻譯：${text}`).target, 'yue', text);
    }
});
