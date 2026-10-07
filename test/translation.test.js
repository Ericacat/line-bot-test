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
    await assert.rejects(translateText(parseTranslation('粵語：'), { ...options, fetchImpl }), { code: 'EMPTY' });
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
