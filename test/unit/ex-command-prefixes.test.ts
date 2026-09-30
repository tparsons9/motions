import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `Vim.defineEx(name, prefix, fn)` throws when `prefix` is not a prefix of
 * `name`, and nothing catches it: the throw aborts the registration function,
 * so every ex command declared after the bad one is silently never registered.
 *
 * That shipped once — `defineEx('quickfix', 'qf', …)` took `:recent`, `:grep`
 * and `:livegrep` down with it, and the symptom was eleven failing picker
 * tests rather than anything naming the offending command. The registrations
 * are static literals, so the relation is checkable without running them.
 */

const SOURCE_ROOT = join(__dirname, '..', '..', 'src');
const DEFINE_EX = /\bdefineEx\(\s*'([^']*)'\s*,\s*'([^']*)'/gu;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return full.endsWith('.ts') ? [full] : [];
    });
}

describe('defineEx registrations', () => {
    const calls = sourceFiles(SOURCE_ROOT).flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return [...text.matchAll(DEFINE_EX)].map((match) => ({
            file: file.slice(SOURCE_ROOT.length + 1),
            name: match[1] ?? '',
            prefix: match[2] ?? '',
        }));
    });

    it('finds the statically declared ex commands', () => {
        // Guards the scan itself: a regex that matched nothing would make every
        // assertion below vacuously true.
        expect(calls.length).toBeGreaterThan(20);
    });

    it('declares every short form as a prefix of its command name', () => {
        const invalid = calls
            .filter(
                ({ name, prefix }) => prefix !== '' && !name.startsWith(prefix),
            )
            .map(
                ({ file, name, prefix }) => `${file}: '${prefix}' of '${name}'`,
            );
        expect(invalid).toEqual([]);
    });

    it('declares no empty command names', () => {
        expect(calls.filter(({ name }) => name === '')).toEqual([]);
    });
});
