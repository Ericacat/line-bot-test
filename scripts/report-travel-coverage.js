import { writeFile } from 'node:fs/promises';
import { travelLearning } from '../lib/travel-learning.js';
import { findExamples } from '../lib/cantonese-examples.js';
const groups = travelLearning.groups.map(group => ({ name: group.name,
    items: group.items.map(item => {
        const examples = findExamples(item.text);
        return { ...item, matched: examples.length > 0,
            exampleUrls: examples.map(e => `https://www.youtube.com/watch?v=${e.videoId}&t=${Math.floor(e.start)}s`) };
    }) }));
const items = groups.flatMap(g => g.items);
const report = { metric: 'literal-subtitle-match-not-audio-verification', total: items.length,
    matched: items.filter(i => i.matched).length, missing: items.filter(i => !i.matched).map(i => i.text), groups };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(`旅居詞句字幕命中：${report.matched}/${report.total}`);
for (const group of groups) console.log(`${group.name}：${group.items.filter(i => i.matched).length}/${group.items.length}`);
console.log(`影片待補：${report.missing.join('、')}`);
