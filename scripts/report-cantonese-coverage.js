import { readFile, writeFile } from 'node:fs/promises';
import { findExamples } from '../lib/cantonese-examples.js';
const index = JSON.parse(await readFile(new URL('../data/cantonese-examples.json', import.meta.url), 'utf8'));
const words = JSON.parse(await readFile(new URL('../data/cantonese-common-words.json', import.meta.url), 'utf8'));
const groups = Object.fromEntries(Object.entries(words.groups).map(([group, terms]) => [group,
    terms.map(term => {
        const examples = findExamples(term);
        return { term, matched: examples.length > 0,
            exampleUrls: examples.map(e => `https://www.youtube.com/watch?v=${e.videoId}&t=${Math.floor(e.start)}s`) };
    })]));
const results = Object.values(groups).flat();
const report = { metric: 'literal-subtitle-match-not-audio-verification',
    videos: new Set(index.entries.map(e => e.videoId)).size, subtitles: index.entries.length,
    total: results.length, matched: results.filter(r => r.matched).length,
    missing: results.filter(r => !r.matched).map(r => r.term), groups };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(`字幕字面命中：${report.matched}/${report.total} (${(100 * report.matched / report.total).toFixed(1)}%)`);
for (const [name, rows] of Object.entries(groups)) console.log(`${name}：${rows.filter(r => r.matched).length}/${rows.length}`);
console.log(`尚未命中：${report.missing.join('、')}`);
