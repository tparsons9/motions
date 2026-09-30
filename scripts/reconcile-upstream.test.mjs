import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
    new URL('./reconcile-upstream.mjs', import.meta.url),
);
const metadata = [
    'package.json',
    'manifest.json',
    'versions.json',
    'package-lock.json',
];

/** @param {import('node:test').TestContext} t @param {'metadata' | 'source' | 'field' | 'clean'} kind */
function fixture(t, kind) {
    const cwd = mkdtempSync(join(tmpdir(), 'motions-sync-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    /** @param {...string} args */
    const git = (...args) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    /** @param {string} file @param {unknown} value */
    const write = (file, value) =>
        writeFileSync(join(cwd, file), `${JSON.stringify(value, null, 4)}\n`);
    git('init', '-b', 'fork');
    git('config', 'user.name', 'Sync Test');
    git('config', 'user.email', 'sync@example.invalid');
    write('package.json', {
        version: '0.1.0',
        dependencies: { '@replit/codemirror-vim': '^6', shared: '1' },
    });
    write('manifest.json', { version: '0.1.0', minAppVersion: '1.8.7' });
    write('versions.json', { '0.1.0': '1.8.7' });
    write('package-lock.json', { version: '0.1.0' });
    writeFileSync(join(cwd, 'connector.ts'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('branch', 'upstream');
    write('package.json', {
        version: '1.0.0',
        dependencies: {
            '@replit/codemirror-vim':
                'https://github.com/saberzero1/codemirror-vim.git',
            shared: kind === 'field' ? 'fork' : '1',
            connector: '2',
        },
    });
    write('manifest.json', { version: '1.0.0', minAppVersion: '1.8.7' });
    write('versions.json', { '0.1.0': '1.8.7', '1.0.0': '1.8.7' });
    write('package-lock.json', { version: '1.0.0', fork: true });
    writeFileSync(join(cwd, 'connector.ts'), 'stable connector\n');
    git('add', '.');
    git('commit', '-m', 'connector and fork release');
    git('switch', 'upstream');
    if (kind === 'clean') {
        writeFileSync(join(cwd, 'upstream.ts'), 'new upstream source\n');
    } else {
        write('package.json', {
            version: '0.2.0',
            dependencies: {
                '@replit/codemirror-vim': '^7',
                shared: kind === 'field' ? 'upstream' : '3',
                added: '4',
            },
        });
        write('manifest.json', {
            version: '0.2.0',
            minAppVersion: '1.9.0',
            description: 'upstream improvement',
        });
        write('versions.json', { '0.1.0': '1.9.0', '0.2.0': '1.9.0' });
        write('package-lock.json', { version: '0.2.0' });
        if (kind === 'source')
            writeFileSync(join(cwd, 'connector.ts'), 'upstream connector\n');
    }
    git('add', '.');
    git('commit', '-m', 'upstream changes');
    git('switch', 'fork');
    spawnSync('git', ['merge', '--no-commit', '--no-ff', 'upstream'], { cwd });
    const result = spawnSync(process.execPath, [script, 'upstream'], {
        cwd,
        encoding: 'utf8',
    });
    return { cwd, git, result };
}

test('reconciles release conflicts while preserving connector and independent upstream changes', (t) => {
    const { cwd, result } = fixture(t, 'metadata');
    /** @param {string} file */
    const json = (file) => JSON.parse(readFileSync(join(cwd, file), 'utf8'));
    assert.deepEqual(
        {
            status: result.status,
            package: json('package.json'),
            manifest: json('manifest.json'),
            versions: json('versions.json'),
            lock: json('package-lock.json'),
            connector: readFileSync(join(cwd, 'connector.ts'), 'utf8'),
        },
        {
            status: 0,
            package: {
                version: '1.0.0',
                dependencies: {
                    '@replit/codemirror-vim':
                        'https://github.com/saberzero1/codemirror-vim.git',
                    shared: '3',
                    added: '4',
                    connector: '2',
                },
            },
            manifest: {
                version: '1.0.0',
                minAppVersion: '1.9.0',
                description: 'upstream improvement',
            },
            versions: { '0.1.0': '1.8.7', '0.2.0': '1.9.0', '1.0.0': '1.9.0' },
            lock: { version: '1.0.0', fork: true },
            connector: 'stable connector\n',
        },
    );
});

/** @type {['source' | 'field', string][]} */
const conflictCases = [
    ['source', 'Manual review required for source conflicts:\nconnector.ts'],
    ['field', 'Manual review required: package.json.dependencies.shared'],
];
for (const [kind, message] of conflictCases) {
    test(`rejects ${kind} conflicts without modifying metadata`, (t) => {
        const { cwd, git, result } = fixture(t, kind);
        // Compare with the still-unresolved merge state recreated by Git.
        const actual = metadata.map((file) =>
            readFileSync(join(cwd, file), 'utf8'),
        );
        git('merge', '--abort');
        spawnSync('git', ['merge', '--no-commit', '--no-ff', 'upstream'], {
            cwd,
        });
        const expected = metadata.map((file) =>
            readFileSync(join(cwd, file), 'utf8'),
        );
        assert.deepEqual(
            {
                status: result.status,
                message: result.stderr.trim(),
                metadata: actual,
            },
            { status: 1, message, metadata: expected },
        );
    });
}

test('also preserves fork metadata when Git merges cleanly', (t) => {
    const { cwd, git, result } = fixture(t, 'clean');
    assert.deepEqual(
        {
            status: result.status,
            version: JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
                .version,
            connector: readFileSync(join(cwd, 'connector.ts'), 'utf8'),
            upstream: readFileSync(join(cwd, 'upstream.ts'), 'utf8'),
            unresolved: git('diff', '--name-only', '--diff-filter=U'),
        },
        {
            status: 0,
            version: '1.0.0',
            connector: 'stable connector\n',
            upstream: 'new upstream source\n',
            unresolved: '',
        },
    );
});
