import { readFileSync } from 'node:fs';

const [, , logPath, label] = process.argv;

let text = '';
try {
    text = logPath ? readFileSync(logPath, 'utf8') : '';
} catch {
    text = '';
}

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

const lines = text
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));

/** @type {string[]} */
const titles = [];
for (const line of lines) {
    const title = /^\s*✖\s+(.*\S)\s*$/.exec(line)?.[1];
    if (title && !titles.includes(title)) {
        titles.push(title);
    }
}

/** @type {Map<string, string>} */
const errors = new Map();
for (let i = 0; i < lines.length; i++) {
    const title = /^\s*\d+\)\s+(.*\S)\s*$/.exec(lines[i] ?? '')?.[1];
    if (!title) continue;
    // A bare `expect(received).toBe(expected)` names no values: the actual ones
    // sit on later Expected:/Received: lines. Reporting only the first Error
    // line produced a summary row that could not say what differed.
    let message = '';
    /** @type {string[]} */
    const values = [];
    for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
        const line = lines[j] ?? '';
        const detail =
            /^\s*(Error|AssertionError|TimeoutError)\b[:\s](.*)$/.exec(line);
        if (detail && !message) {
            message = `${detail[1]}: ${(detail[2] ?? '').trim()}`;
        }
        const value =
            /^\s*(Expected|Received|Number of calls)\s*:\s*(.*\S)\s*$/.exec(
                line,
            );
        if (value && values.length < 4) {
            values.push(`${value[1]}: ${value[2]}`);
        }
    }
    if (!message && values.length === 0) continue;
    errors.set(
        title,
        [message, ...values].filter(Boolean).join(' · ').slice(0, 400),
    );
}

const heading = `### E2E failures — ${label ?? 'unknown shard'}`;
const out = [heading, ''];

if (titles.length === 0 && errors.size === 0) {
    // A session-level abort (ChromeDriver timeout, renderer loss, EPERM) kills
    // the run before any test reports, so there is no failing title to list.
    // Falling back to the log tail keeps the summary useful instead of blank.
    const tail = lines.filter((line) => line.trim() !== '').slice(-15);
    out.push(
        'No individual test failures were reported — the run aborted before or',
        'between tests. Last lines of output:',
        '',
        '```',
        ...tail,
        '```',
        '',
    );
    process.stdout.write(out.join('\n'));
    process.exit(0);
}

out.push('| Test | Error |', '| --- | --- |');

const named = titles.length > 0 ? titles : [...errors.keys()];
for (const title of named) {
    const key = [...errors.keys()].find(
        (candidate) => candidate === title || candidate.endsWith(title),
    );
    const detail = (key ? errors.get(key) : '') ?? '';
    const cell = detail.replace(/\|/g, '\\|');
    out.push(`| \`${title.replace(/\|/g, '\\|')}\` | ${cell} |`);
}

out.push('');
process.stdout.write(out.join('\n'));
