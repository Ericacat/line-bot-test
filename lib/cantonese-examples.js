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
    return selectExamples(matches);
}
function selectExamples(matches) {
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
const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
const STOP_WORDS = new Set(['我哋', '你哋', '佢哋', '呢個', '嗰個', '呢啲', '嗰啲', '呢度', '嗰度',
    '自己', '你們', '我們', '他們', '這個', '那個', '這些', '那些', '這裡', '那裡',
    '可以', '可唔可以', '能夠', '應該', '需要', '要唔要', '唔係', '係咪', '有冇', '沒有', '不是',
    '已經', '而家', '時候', '今日', '聽日', '尋日', '頭先', '一齊', '非常', '一點', '少少',
    '什麼', '乜嘢', '幾多', '多少', '怎樣', '怎麼', '點樣', '點解', '因為', '所以', '但是', '但係',
    '然後', '或者', '如果', '就是', '這樣', '那樣', '一個', '一下', '一些', '大家',
    '影片', '例句', '字幕', '文字', '測試', '命中']);
const commonWords = JSON.parse(readFileSync(new URL('../data/cantonese-common-words.json', import.meta.url), 'utf8'));
const knownKeywords = [...new Set([...Object.values(commonWords.groups).flat(),
    '幾點', '出發', '出門', '食飯', '食嘢', '飲水', '買嘢', '幾多錢', '餐牌', '堂食', '外賣',
    '唔要辣', '唔要糖', '鍵盤', '耳機', '相機', '手機'])];
export function extractExampleKeywords(query) {
    const text = normalize(query);
    // Single words and very short phrases should keep the exact-match behavior.
    if ([...text].length < 4) return [];
    const candidates = new Set(knownKeywords.filter(word => text.includes(word)));
    for (const part of segmenter.segment(text)) if (part.isWordLike) candidates.add(part.segment);
    const words = [...candidates].filter(word => [...word].length >= 2 && [...word].length <= 12
        && word !== text && !STOP_WORDS.has(word)
        && !/^[一二兩三四五六七八九十百千萬\d]+[個件隻杯碗份]?$/u.test(word));
    // Count a longer phrase once, rather than also counting its nested words.
    return words.filter(word => !words.some(other => other !== word && other.includes(word)))
        .sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 8);
}
export function searchExamples(query, entries = dataset.entries) {
    const exact = findExamples(query, entries);
    if (exact.length) return { kind: 'exact', matches: exact };
    const keywords = extractExampleKeywords(query);
    if (!keywords.length) return { kind: 'none', matches: [] };
    const ranked = entries.map(entry => {
        const text = normalize(entry.text);
        const matchedKeywords = keywords.filter(word => text.includes(word));
        return { ...entry, matchedKeywords };
    }).filter(entry => entry.matchedKeywords.length)
        .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length
            || b.matchedKeywords.join('').length - a.matchedKeywords.join('').length
            || normalize(a.text).length - normalize(b.text).length || a.start - b.start);
    // Keep the strongest keyword coverage; avoid filling results with weaker matches.
    const bestCount = ranked[0]?.matchedKeywords.length;
    const matches = selectExamples(ranked.filter(entry => entry.matchedKeywords.length === bestCount));
    return { kind: matches.length ? 'related' : 'none', matches };
}
export function exampleReply(query, result = searchExamples(query)) {
    if (!normalize(query)) return '請輸入想聽的粵語詞句，例如「例句：唔係」或「例句：佢」。';
    const { matches } = result;
    if (!matches.length) return `暫時找不到「${query}」的例句。\n目前只搜尋已收錄影片的字幕；可試較短的粵語詞，例如「唔係」或「佢」。`;
    const lines = matches.map((entry, i) => {
        const at = Math.floor(entry.start);
        const time = `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;
        const matched = result.kind === 'related' ? `相關詞：${entry.matchedKeywords.join('、')}\n` : '';
        return `${i + 1}. ${entry.text}\n${matched}${entry.channel}｜${time}\nhttps://www.youtube.com/watch?v=${entry.videoId}&t=${at}s`;
    });
    const heading = result.kind === 'related'
        ? `「${query}」的相關例句（非完整原句）\n找不到完整句，以下只示範部分詞語；語意和情境可能不同。`
        : `「${query}」的影片例句（試用）`;
    return `${heading}\n字幕未逐句核對發音；連結從該句附近開始播放。\n\n${lines.join('\n\n')}`;
}
