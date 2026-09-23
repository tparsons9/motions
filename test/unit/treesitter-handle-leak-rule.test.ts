import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const rule = path.resolve('.ast-grep/rules/treesitter-handle-leak.yml');
const cli = path.resolve('node_modules/.bin/ast-grep');

/** Returns the fixture file names the rule reported a match in. */
function scanLeakRule(files: Record<string, string>): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), 'handle-leak-rule-'));
    try {
        mkdirSync(path.join(dir, 'src/treesitter'), { recursive: true });
        for (const [file, text] of Object.entries(files))
            writeFileSync(path.join(dir, 'src/treesitter', file), text);
        let output: string;
        try {
            output = execFileSync(
                cli,
                ['scan', '--rule', rule, '--json=compact', 'src/treesitter'],
                { cwd: dir, encoding: 'utf8' },
            );
        } catch (error) {
            if (
                !(error instanceof Error) ||
                !('stdout' in error) ||
                typeof error.stdout !== 'string'
            )
                throw error;
            output = error.stdout;
        }
        const matches = JSON.parse(output) as Array<{ file: string }>;
        return [...new Set(matches.map((m) => path.basename(m.file)))].sort();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const leaks: Record<string, string> = {
    'const.ts': `export function f(root: Node): void {
    const cursor = root.walk();
    cursor.gotoFirstChild();
}`,
    'let.ts': `export function f(root: Node): void {
    let cursor = root.walk();
    cursor.gotoFirstChild();
}`,
    'var.ts': `export function f(root: Node): void {
    var cursor = root.walk();
    cursor.gotoFirstChild();
}`,
    'reassign.ts': `export function f(a: Node, b: Node): void {
    let cursor = a.walk();
    cursor.gotoFirstChild();
    cursor = b.walk();
    cursor.gotoFirstChild();
}`,
    'discarded.ts': `export function f(root: Node): void {
    root.walk();
}`,
};

const freed: Record<string, string> = {
    'finally.ts': `export function f(root: Node): void {
    const cursor = root.walk();
    try {
        cursor.gotoFirstChild();
    } finally {
        cursor.delete();
    }
}`,
    'let-delete.ts': `export function f(root: Node): void {
    let cursor = root.walk();
    cursor.gotoFirstChild();
    cursor.delete();
}`,
    'var-delete.ts': `export function f(root: Node): void {
    var cursor = root.walk();
    cursor.delete();
}`,
    'reassign-both.ts': `export function f(a: Node, b: Node): void {
    let cursor = a.walk();
    cursor.delete();
    cursor = b.walk();
    cursor.delete();
}`,
};

describe('treesitter-handle-leak ast-grep rule', () => {
    it('fires on every shape that leaks a TreeCursor', () => {
        expect(scanLeakRule(leaks)).toEqual([
            'const.ts',
            'discarded.ts',
            'let.ts',
            'reassign.ts',
            'var.ts',
        ]);
    });

    // The first version of this rule used `stopBy: end` on the discarded-value
    // arm, which matched any expression statement *containing* a `walk()` --
    // including `cursor = b.walk();` in a scope that frees it. That flags
    // correct code, and a blocking gate that does so gets disabled.
    it('stays silent on every shape that frees its cursor', () => {
        expect(scanLeakRule(freed)).toEqual([]);
    });

    it('fires on the defect that actually shipped', () => {
        const shipped = {
            'js-api.ts': `export function getAllNodesOfType(view: EditorView, type: string): Node[] {
    const root = getRootNode(view);
    if (!root) return [];
    const results: Node[] = [];
    const cursor = root.walk();
    let moved = cursor.gotoFirstChild();
    while (moved) {
        collectNodesOfType(cursor, types, results);
        moved = cursor.gotoNextSibling();
    }
    return results;
}`,
        };
        expect(scanLeakRule(shipped)).toEqual(['js-api.ts']);
    });
});
