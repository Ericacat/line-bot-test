import { readFile, writeFile } from 'node:fs/promises';

// Accept saved Hugging Face first-rows/rows responses; never download audio.
const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error('Usage: node scripts/import-cantonese-examples.js sample.json [...]');
const seen = new Set();
const entries = [];
function seconds(value) {
    if (typeof value !== 'string' || !/^\d{2,}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return NaN;
    const [h, m, s] = value.split(':').map(Number);
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : NaN;
}
for (const input of inputs) {
    const data = JSON.parse(await readFile(input, 'utf8'));
    for (const item of data.rows) {
        const row = item.row.json;
        if (row.channel_id !== 'maviskuku' || !/^[\w-]{11}$/.test(row.video_id)) continue;
        for (const segment of row.segments) {
            const text = segment.text.trim();
            // Candidate filter only: colloquial characters do not prove verbatim accuracy.
            if (!/[唔佢嘅咗喺啲哋嗰咁冇乜嘢嚟]/u.test(text) || text.length > 180) continue;
            const start = seconds(segment.start_time);
            const end = seconds(segment.end_time);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
            const key = `${row.video_id}:${start}:${text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ videoId: row.video_id, title: row.title, channel: 'Maviskuku 雞蛋妹',
                start, end, text });
        }
    }
}
entries.sort((a, b) => a.videoId.localeCompare(b.videoId) || a.start - b.start);
if (!entries.length) throw new Error('No colloquial subtitle candidates found');
const output = { source: 'https://huggingface.co/datasets/OrcinusOrca/YouTube-Cantonese',
    config: 'maviskuku', review: 'subtitle-candidates-not-audio-verified', entries };
await writeFile(new URL('../data/cantonese-examples.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(`Imported ${entries.length} subtitle candidates from ${new Set(entries.map(e => e.videoId)).size} videos`);
