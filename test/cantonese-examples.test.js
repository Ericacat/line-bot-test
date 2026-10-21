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
