import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { travelLearning, travelLearningReply } from '../lib/travel-learning.js';
import { findExamples } from '../lib/cantonese-examples.js';

test('travel menu lists categories and distinguishes available clips from pending ones', () => {
    assert.equal(travelLearningReply('我要呢個'), null);
    assert.equal(travelLearningReply('旅居學習（中）'), null);
    const menu = travelLearningReply('旅居學習');
    for (const group of travelLearning.groups) assert.ok(menu.includes(group.name));
    const dining = travelLearningReply('旅居學習：點餐');
    assert.match(dining, /堂食｜內用/);
    assert.match(dining, /唔要辣｜不要辣/);
    assert.match(dining, /影片待補/);
    assert.match(travelLearningReply('旅居學習: 指人與位置'), /呢個｜這個/);
    assert.match(travelLearningReply('旅居學習：不存在'), /找不到.*分類/);
});

test('travel coverage uses exact lesson phrases and all displayed links come from actual subtitles', () => {
    const report = JSON.parse(readFileSync(new URL('../data/travel-coverage.json', import.meta.url)));
    const items = report.groups.flatMap(g => g.items);
    assert.equal(report.total, travelLearning.groups.flatMap(g => g.items).length);
    assert.equal(report.matched, items.filter(i => i.matched).length);
    for (const group of report.groups) {
        for (const item of group.items) {
            const matches = findExamples(item.text);
            assert.equal(item.matched, matches.length > 0);
            assert.deepEqual(item.exampleUrls, matches.map(e => `https://www.youtube.com/watch?v=${e.videoId}&t=${Math.floor(e.start)}s`));
            assert.ok(travelLearningReply(`旅居學習：${group.name}`).includes(`${item.text}｜${item.meaning}\n${item.matched ? '有影片例句' : '影片待補'}`));
        }
    }
});
