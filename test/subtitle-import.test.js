import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleIndex, parseSrt } from '../scripts/import-cantonese-examples.js';
const catalog = { sources: { test: 'https://example.com/subtitles' }, checkedOn: '2026-10-21',
    videos: [{ videoId: 'aaaaaaaaaaa', config: 'channel', channel: '來源頻道', title: '來源標題',
        source: 'test', availability: 'oembed-available' }] };
const segment = (text, start = '00:01:02.500', end = '00:01:03.000') => ({ text, start_time: start, end_time: end });
const document = (segments, overrides = {}) => ({ rows: [{ row: { json: {
    video_id: 'aaaaaaaaaaa', channel_id: 'channel', full_duration: 200, clip_start: 60, segments, ...overrides } } }] });

test('subtitle import preserves original timestamps, removes duplicates and uses checked channel attribution', () => {
    const row = document([segment('佢喺呢度')]);
    const index = buildExampleIndex([row, row], catalog);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].start, 62.5); // Already original-video time; do not add clip_start.
    assert.equal(index.entries[0].channel, '來源頻道');
    assert.equal(index.entries[0].source, 'test');
});

test('subtitle import excludes unlisted videos, wrong channels, invalid times and non-colloquial lines', () => {
    const docs = [document([segment('佢喺呢度'), segment('書面中文'), segment('唔係', '00:60:00', '01:01:00'),
        segment('唔係', '00:01:04', '00:01:03'), segment('唔係', '00:04:00', '00:04:02'),
        segment('佢'.repeat(181)), { text: null }]),
    document([segment('唔係')], { video_id: 'bbbbbbbbbbb' }),
    document([segment('唔係')], { channel_id: 'wrong-channel' })];
    const index = buildExampleIndex(docs, catalog);
    assert.deepEqual(index.entries.map(e => e.text), ['佢喺呢度']);
    assert.throws(() => buildExampleIndex(docs, { ...catalog, videos: [] }), /No colloquial/);
});

test('SRT import supports comma milliseconds, CRLF, BOM and multi-line captions', () => {
    const segments = parseSrt('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n<i>佢喺</i>\r\n呢度\r\n\r\n');
    const index = buildExampleIndex([document(segments)], catalog);
    assert.equal(index.entries[0].text, '佢喺 呢度');
    assert.equal(index.entries[0].start, 1.25);
    assert.equal(index.entries[0].end, 3.5);
});

test('numeric caption timestamps use original seconds and the original caption, not ASR rewriting', () => {
    const verified = { ...catalog, videos: [{ ...catalog.videos[0], source: 'youtube-caption-yue', config: '@food' }] };
    const row = { video_id: 'aaaaaaaaaaa', uploader_id: '@food', caption: '好似好好食咯',
        start: 523.5, end: 525.5, sensevoice_caption: 'wrong text' };
    const docs = [{ rows: [{ row }, { row: { ...row, uploader_id: '@wrong' } },
        { row: { ...row, start: '523.5' } }, { row: { ...row, end: 600 } },
        { row: { ...row, caption: '非旅居主題' } }] }];
    const result = buildExampleIndex(docs, verified);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].text, '好似好好食咯');
    assert.equal(result.entries[0].start, 523.5);
});
