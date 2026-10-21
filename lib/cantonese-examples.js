import { readFileSync } from 'node:fs';
const dataset = JSON.parse(readFileSync(new URL('../data/cantonese-examples.json', import.meta.url), 'utf8'));
const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
export function parseExampleQuery(text) {
    const match = text.match(/^例句\s*[:：]([\s\S]*)$/u);
    return match ? match[1].trim() : null;
}
export function findExamples(query, entries = dataset.entries) {
    const needle = normalize(query);
    if (!needle) return [];
    const matches = entries.filter(entry => normalize(entry.text).includes(needle))
        .sort((a, b) => normalize(a.text).length - normalize(b.text).length || a.start - b.start);
    const selected = [];
    const videos = new Set();
    // Prefer different videos, then fill with distinct lines from the same video.
    for (const entry of matches) {
        if (videos.has(entry.videoId)) continue;
        selected.push(entry); videos.add(entry.videoId);
        if (selected.length === 3) return selected;
    }
    for (const entry of matches) {
        if (selected.includes(entry)) continue;
        selected.push(entry);
        if (selected.length === 3) break;
    }
    return selected;
}
export function exampleReply(query) {
    if (!normalize(query)) return '請輸入想聽的粵語詞句，例如「例句：唔係」或「例句：佢」。';
    const matches = findExamples(query);
    if (!matches.length) return `暫時找不到「${query}」的例句。\n目前試用資料只有雞蛋妹部分影片；可試較短的粵語詞，例如「唔係」或「佢」。`;
    const lines = matches.map((entry, i) => {
        const at = Math.floor(entry.start);
        const time = `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;
        return `${i + 1}. ${entry.text}\n${entry.channel}｜${time}\nhttps://www.youtube.com/watch?v=${entry.videoId}&t=${at}s`;
    });
    return `「${query}」的影片例句（試用）\n字幕命中，未逐句核對發音；連結從該句附近開始播放。\n\n${lines.join('\n\n')}`;
}
