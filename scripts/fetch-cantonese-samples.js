import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Offline maintenance only. curl uses the system HTTPS certificate configuration.
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/fetch-cantonese-samples.js /tmp/cantonese-samples');
const plan = JSON.parse(await readFile(new URL('../data/cantonese-sample-plan.json', import.meta.url), 'utf8'));
await mkdir(directory, { recursive: true });
const run = promisify(execFile);
for (const snapshot of plan.snapshots) {
    const url = new URL(snapshot.url);
    if (url.origin !== 'https://datasets-server.huggingface.co' || basename(snapshot.fileName) !== snapshot.fileName) {
        throw new Error('Invalid sample plan');
    }
    const target = join(directory, snapshot.fileName);
    try { await access(target); continue; } catch { /* Fetch missing responses only. */ }
    // Stop on errors, including HTTP 429. Rerunning resumes already saved responses.
    await run('curl', ['--silent', '--show-error', '--fail', '--location', '--max-time', '30',
        url.href, '--output', target + '.part']);
    const document = JSON.parse(await readFile(target + '.part', 'utf8'));
    if (!Array.isArray(document.rows)) throw new Error(`Invalid sample: ${snapshot.fileName}`);
    await rename(target + '.part', target);
    console.log(`Saved ${snapshot.fileName}`);
    await setTimeout(1500);
}
console.log('Samples saved. Review source changes before rebuilding and publishing the index.');
