import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLLOQUIAL = /[唔佢嘅咗喺啲哋嗰咁冇乜嘢嚟]/u;
const TRAVEL_CAPTION = /唔該|多謝|餐牌|堂食|外賣|辣|甜|熱|凍|少少|食|飲|水|飯|肉|魚|蝦|幾錢|現金|八達通|廁所|酒店|搭車|落車|巴士|港鐵|肚餓|好食/u;
export function subtitleSeconds(value) {
    if (typeof value !== 'string' || !/^\d{2,}:\d{2}:\d{2}(?:[.,]\d+)?$/.test(value)) return NaN;
    const [h, m, s] = value.replace(',', '.').split(':').map(Number);
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : NaN;
}
export function parseSrt(text) {
    const segments = [];
    for (const block of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/u)) {
        const lines = block.split('\n');
        const at = lines.findIndex(line => line.includes('-->'));
        const match = lines[at]?.match(/^(\S+)\s*-->\s*(\S+)(?:\s.*)?$/u);
        if (!match) continue;
        segments.push({ start_time: match[1], end_time: match[2],
            text: lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').trim() });
    }
    return segments;
}
export function buildExampleIndex(documents, catalog) {
    const allowed = new Map(catalog.videos.filter(v => v.availability === 'oembed-available')
        .map(video => [video.videoId, video]));
    const entries = [];
    const seen = new Set();
    for (const document of documents) {
        for (const item of document.rows ?? []) {
            const raw = item?.row;
            const captionRow = raw && typeof raw.caption === 'string' && !raw.json;
            const row = captionRow ? { video_id: raw.video_id, channel_id: raw.uploader_id,
                segments: [{ text: raw.caption, start_time: raw.start, end_time: raw.end }] } : raw?.json;
            const video = allowed.get(row?.video_id);
            if (captionRow && video?.source !== 'youtube-caption-yue') continue;
            if (!captionRow && video?.source === 'youtube-caption-yue') continue;
            if (!video || row.channel_id !== video.config || !/^[\w-]{11}$/.test(row.video_id)) continue;
            for (const segment of Array.isArray(row.segments) ? row.segments : []) {
                if (typeof segment?.text !== 'string') continue;
                const text = segment.text.trim();
                // Candidate filter only: colloquial characters do not prove verbatim accuracy.
                if ([...text].length > 180) continue;
                if (captionRow ? !TRAVEL_CAPTION.test(text) : !COLLOQUIAL.test(text)) continue;
                const start = captionRow ? segment.start_time : subtitleSeconds(segment.start_time);
                const end = captionRow ? segment.end_time : subtitleSeconds(segment.end_time);
                if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
                if (captionRow && end - start > 30) continue;
                if (Number.isFinite(row.full_duration) && end > row.full_duration) continue;
                const key = `${row.video_id}:${start}:${text}`;
                if (seen.has(key)) continue;
                seen.add(key);
                entries.push({ videoId: row.video_id, title: video.title, channel: video.channel,
                    source: video.source, start, end, text });
            }
        }
    }
    entries.sort((a, b) => a.videoId.localeCompare(b.videoId) || a.start - b.start || a.text.localeCompare(b.text));
    if (!entries.length) throw new Error('No colloquial subtitle candidates found');
    return { sources: catalog.sources, checkedOn: catalog.checkedOn,
        review: 'subtitle-candidates-not-audio-verified', entries };
}
async function main() {
    const inputs = process.argv.slice(2);
    if (!inputs.length) throw new Error('Usage: node scripts/import-cantonese-examples.js sample.json [...] [subtitles.srt ...]');
    const catalog = JSON.parse(await readFile(new URL('../data/cantonese-video-sources.json', import.meta.url), 'utf8'));
    const documents = [];
    for (const input of inputs) {
        const text = await readFile(input, 'utf8');
        if (!input.toLowerCase().endsWith('.srt')) {
            documents.push(JSON.parse(text));
            continue;
        }
        const matches = catalog.videos.filter(video => input.includes(video.videoId));
        if (matches.length !== 1) throw new Error(`SRT filename must contain one catalog video ID: ${input}`);
        const video = matches[0];
        documents.push({ rows: [{ row: { json: { video_id: video.videoId, channel_id: video.config,
            segments: parseSrt(text) } } }] });
    }
    const index = buildExampleIndex(documents, catalog);
    await writeFile(new URL('../data/cantonese-examples.json', import.meta.url), JSON.stringify(index, null, 2) + '\n');
    console.log(`Imported ${index.entries.length} subtitle candidates from ${new Set(index.entries.map(e => e.videoId)).size} videos`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
