import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GitHub-Flavoured Markdown accepts a **single** tilde as a strikethrough
 * delimiter, not only a doubled one. Prose that writes an approximation as
 * `~25` is therefore invisible until a second bare tilde appears on the same
 * line, at which point the renderer strikes through everything between them.
 *
 * That shipped: an Unreleased changelog entry reading "failed on its ~25-row
 * macOS and ~27-row Windows runners" rendered "25-row macOS and " struck
 * through on the docs site, and seven more lines across the published files had
 * the same defect. A single bare tilde is left alone, because one delimiter
 * with no partner renders literally.
 */

const ROOT = join(__dirname, '..', '..');
const PUBLISHED = ['CHANGELOG.md', 'KNOWN_LIMITATIONS.md', 'README.md'];

function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return markdownFiles(full);
        return entry.endsWith('.md') ? [full] : [];
    });
}

/** Tildes the renderer can pair: outside code spans, not `~~`, not escaped. */
function pairableTildes(line: string): number {
    const withoutCode = line.replace(/`[^`]*`/gu, '').replace(/\\~/gu, '');
    return (withoutCode.match(/(?<!~)~(?!~)/gu) ?? []).length;
}

describe('published markdown', () => {
    const files = [
        ...PUBLISHED.map((name) => join(ROOT, name)),
        ...markdownFiles(join(ROOT, 'docs')),
    ];

    it('reads the published files', () => {
        // Guards the scan: an empty file list would make the check vacuous.
        expect(files.length).toBeGreaterThan(10);
    });

    it('has no line where bare tildes pair into accidental strikethrough', () => {
        const offenders = files.flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .flatMap((line, index) =>
                    pairableTildes(line) >= 2
                        ? [`${file.slice(ROOT.length + 1)}:${index + 1}`]
                        : [],
                ),
        );
        expect(offenders).toEqual([]);
    });
});
