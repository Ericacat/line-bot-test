import test from 'node:test';
import assert from 'node:assert/strict';
import { createCostStore, LEDGER_KEY } from '../lib/cost-store.js';
import { RedisHarness } from './redis-harness.js';
const userId = `U${'a'.repeat(32)}`;
const makeStore = (server) => createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: server.fetch });
const event = (id, now) => ({ webhookEventId: id, timestamp: now, source: { userId } });

test('missing ledger fails closed and initialization never resets an existing ledger', async () => {
    const server = new RedisHarness(); const store = makeStore(server);
    await assert.rejects(store.claim(event('initial', server.now)), { code: 'STORE' });
    assert.equal(await store.initialize(), true);
    const context = await store.claim(event('count', server.now));
    await store.reserve('translation', '測試', context);
    assert.equal(await store.initialize(), false);
    assert.equal(server.get(LEDGER_KEY).value.translation, '2');
});

test('concurrent instances reserve at most 1500 per service and survive new application instances', async () => {
    const server = new RedisHarness(); await makeStore(server).initialize();
    const contexts = await Promise.all(Array.from({ length: 20 }, (_, i) => makeStore(server).claim(event(`limit-${i}`, server.now))));
    const results = await Promise.allSettled(contexts.map((context) => makeStore(server).reserve('translation', '字'.repeat(300), context)));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 5);
    for (const item of results.filter((item) => item.status === 'rejected')) assert.equal(item.reason.code, 'DAILY_LIMIT');
    assert.equal(server.get(LEDGER_KEY).value.translation, '1500');
    const speechResults = await Promise.allSettled(contexts.map((context) => makeStore(server).reserve('tts', '字'.repeat(300), context)));
    assert.equal(speechResults.filter((item) => item.status === 'fulfilled').length, 5);
    assert.equal(server.get(LEDGER_KEY).value.tts, '1500');
    const redeployed = makeStore(server);
    const extra = await redeployed.claim(event('after-deploy', server.now));
    await assert.rejects(redeployed.reserve('translation', '字', extra), { code: 'DAILY_LIMIT' });
    await assert.rejects(redeployed.reserve('tts', '字', extra), { code: 'DAILY_LIMIT' });
});

test('only one instance claims a webhook; duplicate reservations cannot call twice', async () => {
    const server = new RedisHarness(); await makeStore(server).initialize();
    const results = await Promise.all(Array.from({ length: 10 }, () => makeStore(server).claim(event('same', server.now))));
    const contexts = results.filter(Boolean); assert.equal(contexts.length, 1);
    const store = makeStore(server);
    await store.reserve('tts', '你好', contexts[0]);
    await assert.rejects(store.reserve('tts', '你好', contexts[0]), { code: 'DUPLICATE' });
    assert.equal(server.get(LEDGER_KEY).value.tts, '2');
});

test('day rollover resets both totals, but expired dedupe records cannot revive old events', async () => {
    const server = new RedisHarness(); const store = makeStore(server); await store.initialize();
    const oldEvent = event('old-event', server.now); const context = await store.claim(oldEvent);
    await store.reserve('translation', '字'.repeat(300), context);
    await store.reserve('tts', '字'.repeat(300), context);
    server.now += 9 * 86400000;
    assert.equal(await store.claim(oldEvent), null);
    const next = await store.claim(event('new-day', server.now));
    await store.reserve('translation', '新', next);
    assert.equal(server.get(LEDGER_KEY).value.translation, '1');
    assert.equal(server.get(LEDGER_KEY).value.tts, '0');
});

test('unavailable, missing and corrupt counters never authorize paid work', async () => {
    const server = new RedisHarness(); const store = makeStore(server); await store.initialize();
    const context = await store.claim(event('failure', server.now));
    server.fail = true;
    await assert.rejects(store.reserve('translation', '字', context), { code: 'STORE' });
    server.fail = false;
    server.get(LEDGER_KEY).value.translation = 'broken';
    await assert.rejects(store.reserve('translation', '字', context), { code: 'STORE' });
    server.data.delete(LEDGER_KEY);
    await assert.rejects(store.reserve('tts', '字', context), { code: 'STORE' });
});

test('missing config, malformed REST results and Unicode oversize fail closed', async () => {
    await assert.rejects(createCostStore({ url: '', token: '' }).claim(event('missing', Date.now())), { code: 'STORE' });
    const store = createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: async () => Response.json({ result: '1' }) });
    await assert.rejects(store.claim(event('malformed', Date.now())), { code: 'STORE' });
    const server = new RedisHarness(); const validStore = makeStore(server); await validStore.initialize();
    const context = await validStore.claim(event('unicode', server.now));
    await assert.rejects(validStore.reserve('tts', '😀'.repeat(301), context), { code: 'TOO_LONG' });
    await validStore.reserve('tts', '😀'.repeat(300), context);
    assert.equal(server.get(LEDGER_KEY).value.tts, '300');
});

test('lost reservation acknowledgement keeps charges reserved and cannot reopen the event', async () => {
    const server = new RedisHarness(); const store = makeStore(server); await store.initialize();
    const originalEvent = event('uncertain-write', server.now);
    const context = await store.claim(originalEvent);
    const uncertainStore = createCostStore({ url: 'https://redis.example.com', token: 'test', fetchImpl: async (_url, request) => {
        server.command(JSON.parse(request.body));
        throw new Error('Response lost after commit');
    } });
    await assert.rejects(uncertainStore.reserve('translation', '你好', context), { code: 'STORE' });
    assert.equal(server.get(LEDGER_KEY).value.translation, '2');
    assert.equal(await makeStore(server).claim(originalEvent), null);
    await assert.rejects(makeStore(server).reserve('translation', '你好', context), { code: 'DUPLICATE' });
});
