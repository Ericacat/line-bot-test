import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExampleQuery, findExamples, exampleReply } from '../lib/cantonese-examples.js';

test('example command accepts either colon and leaves ordinary/translation messages alone', () => {
    assert.equal(parseExampleQuery('例句：唔係'), '唔係');
    assert.equal(parseExampleQuery('例句: 佢 '), '佢');
    assert.equal(parseExampleQuery('例句：'), '');
    assert.equal(parseExampleQuery('粵語：例句'), null);
    assert.equal(parseExampleQuery('我想睇例句'), null);
});

test('search matches subtitles, prefers video variety and never fabricates missing results', () => {
    const entry = (videoId, text, start = 12.8) => ({ videoId, text, start });
    const entries = [entry('aaaaaaaaaaa', '唔係呀'), entry('aaaaaaaaaaa', '唔係'),
        entry('bbbbbbbbbbb', '唔係咁樣'), entry('ccccccccccc', '唔係呢個')];
    const found = findExamples('唔 係！', entries);
    assert.equal(found.length, 3);
    assert.equal(new Set(found.map(e => e.videoId)).size, 3);
    assert.equal(found[0].text, '唔係');
    assert.deepEqual(findExamples('沒有命中', entries), []);
    assert.deepEqual(findExamples('！？', entries), []);
    assert.match(exampleReply('沒有命中'), /暫時找不到/);
    assert.match(exampleReply(''), /請輸入/);
});

test('bundled candidates contain valid original video times and playable timestamp links', () => {
    const data = JSON.parse(readFileSync(new URL('../data/cantonese-examples.json', import.meta.url)));
    assert.ok(data.entries.length > 0);
    for (const entry of data.entries) {
        assert.match(entry.videoId, /^[\w-]{11}$/);
        assert.ok(entry.start >= 0 && entry.end > entry.start);
    }
    const found = findExamples('唔係');
    assert.ok(found.length > 0);
    const reply = exampleReply('唔係');
    assert.match(reply, /未逐句核對/);
    for (const entry of found) {
        assert.ok(reply.includes(`https://www.youtube.com/watch?v=${entry.videoId}&t=${Math.floor(entry.start)}s`));
    }
});


test('expanded index and coverage report refer to checked sources and real search results', () => {
    const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url)));
    const index = read('cantonese-examples.json');
    const catalog = read('cantonese-video-sources.json');
    const coverage = read('cantonese-coverage.json');
    const sources = new Map(catalog.videos.map(v => [v.videoId, v]));
    for (const entry of index.entries) {
        const video = sources.get(entry.videoId);
        assert.equal(video?.availability, 'oembed-available');
        assert.equal(entry.channel, video.channel);
    }
    assert.equal(coverage.videos, new Set(index.entries.map(e => e.videoId)).size);
    assert.equal(coverage.subtitles, index.entries.length);
    const rows = Object.values(coverage.groups).flat();
    assert.equal(rows.length, coverage.total);
    assert.equal(rows.filter(row => row.matched).length, coverage.matched);
    for (const row of rows) assert.equal(row.matched, findExamples(row.term).length > 0);
});

test('related search prefers the full sentence, otherwise ranks real keyword coverage and labels partial matches', async () => {
    const { searchExamples, extractExampleKeywords } = await import('../lib/cantonese-examples.js');
    const entry = (videoId, text) => ({ videoId, text, start: 12.8, channel: '測試頻道' });
    const query = '你幾點出發呀';
    const exact = entry('aaaaaaaaaaa', query);
    const strong = entry('bbbbbbbbbbb', '我聽日幾點先可以出發');
    const weak = entry('ccccccccccc', '我哋準備出發');
    const exactResult = searchExamples(query, [weak, strong, exact]);
    assert.equal(exactResult.kind, 'exact');
    assert.deepEqual(exactResult.matches, [exact]);
    const related = searchExamples(query, [weak, strong]);
    assert.equal(related.kind, 'related');
    assert.equal(related.matches.length, 1);
    assert.equal(related.matches[0].videoId, strong.videoId);
    assert.ok(related.matches[0].matchedKeywords.includes('出發'));
    assert.ok(related.matches[0].matchedKeywords.includes('幾點'));
    const reply = exampleReply(query, related);
    assert.match(reply, /相關例句（非完整原句）/);
    assert.ok(reply.includes(strong.text));
    assert.ok(reply.includes('相關詞：'));
    assert.match(reply, /&t=12s/);
    assert.deepEqual(extractExampleKeywords('呢個係乜嘢'), []);
    assert.equal(searchExamples('你幾點出發呀', [entry('ddddddddddd', '你我佢')]).kind, 'none');
    assert.equal(searchExamples('出發', [entry('eeeeeeeeeee', '出去玩')]).kind, 'none');
});
