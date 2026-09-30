import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const script = fileURLToPath(
    new URL('./reconcile-upstream.mjs', import.meta.url),
);
const metadata = [
    'package.json',
    'manifest.json',
    'versions.json',
    'package-lock.json',
];

/** @param {import('node:test').TestContext} t @param {'metadata' | 'source' | 'field' | 'clean' | 'docs' | 'attribution'} kind */
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
    write('manifest.json', {
        version: '0.1.0',
        minAppVersion: '1.8.7',
        ...(kind === 'attribution'
            ? {
                  author: 'Original author',
                  authorUrl: 'https://example.com/upstream',
              }
            : {}),
    });
    write('versions.json', { '0.1.0': '1.8.7' });
    write('package-lock.json', { version: '0.1.0' });
    writeFileSync(join(cwd, 'connector.ts'), 'base\n');
    for (const file of ['AGENTS.md', 'CHANGELOG.md'])
        writeFileSync(join(cwd, file), 'base docs\n');
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
    write('manifest.json', {
        version: '1.0.0',
        minAppVersion: '1.8.7',
        ...(kind === 'attribution'
            ? {
                  author: 'Original author; fork maintainer',
                  authorUrl: 'https://example.com/fork',
              }
            : {}),
    });
    write('versions.json', { '0.1.0': '1.8.7', '1.0.0': '1.8.7' });
    write('package-lock.json', { version: '1.0.0', fork: true });
    writeFileSync(join(cwd, 'connector.ts'), 'stable connector\n');
    if (kind === 'docs')
        for (const file of ['AGENTS.md', 'CHANGELOG.md'])
            writeFileSync(join(cwd, file), 'fork docs\n');
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
            ...(kind === 'attribution'
                ? {
                      author: 'Updated upstream author',
                      authorUrl: 'https://example.com/new-upstream',
                  }
                : {}),
        });
        write('versions.json', { '0.1.0': '1.9.0', '0.2.0': '1.9.0' });
        write('package-lock.json', { version: '0.2.0' });
        if (kind === 'docs')
            for (const file of ['AGENTS.md', 'CHANGELOG.md'])
                writeFileSync(join(cwd, file), 'upstream docs\n');
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

for (const operation of ['list', 'create', 'edit']) {
    test(`keeps conflict reporting actionable when GitHub denies issue ${operation}`, (t) => {
        const cwd = mkdtempSync(join(tmpdir(), 'motions-sync-report-'));
        t.after(() => rmSync(cwd, { recursive: true, force: true }));
        const summary = join(cwd, 'summary.md');
        writeFileSync(summary, '');
        writeFileSync(
            join(cwd, 'sync-conflicts.txt'),
            'Manual review required for source conflicts:\nAGENTS.md\nCHANGELOG.md\n',
        );
        writeFileSync(
            join(cwd, 'gh'),
            `#!/bin/bash
printf '%s\\n' "$GH_REPO" > "$RUNNER_TEMP/gh-repo.txt"
if [ "$2" = "list" ] && [ "${operation}" != "list" ]; then
    if [ "${operation}" = "edit" ]; then echo 7; fi
    exit 0
fi
echo 'GraphQL: Resource not accessible by integration' >&2
exit 1
`,
            { mode: 0o755 },
        );
        /** @type {{jobs: {sync: {env?: {GH_REPO?: string}, steps: Array<{name?: string, run?: string}>}}}} */
        const workflow = YAML.parse(
            readFileSync(
                new URL(
                    '../.github/workflows/sync-upstream.yml',
                    import.meta.url,
                ),
                'utf8',
            ),
        );
        const step = workflow.jobs.sync.steps.find(
            (entry) => entry.name === 'Flag conflicts for manual review',
        );
        if (!step?.run) throw new Error('Conflict reporting step missing');
        const result = spawnSync('bash', ['-e', '-c', step.run], {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${cwd}:${process.env.PATH}`,
                RUNNER_TEMP: cwd,
                GITHUB_STEP_SUMMARY: summary,
                GH_REPO:
                    workflow.jobs.sync.env?.GH_REPO?.replace(
                        '${{ github.repository }}',
                        'tparsons9/motions',
                    ) ?? '',
            },
        });
        assert.deepEqual(
            {
                status: result.status,
                repository: readFileSync(
                    join(cwd, 'gh-repo.txt'),
                    'utf8',
                ).trim(),
                summaryHasConflicts: readFileSync(summary, 'utf8').includes(
                    'AGENTS.md\nCHANGELOG.md',
                ),
                warned: result.stdout.includes('::warning::'),
            },
            {
                status: 0,
                repository: 'tparsons9/motions',
                summaryHasConflicts: true,
                warned: true,
            },
        );
    });
}

test('takes upstream AGENTS.md and CHANGELOG.md while preserving fork connector and version', (t) => {
    const { cwd, git, result } = fixture(t, 'docs');
    assert.deepEqual(
        {
            status: result.status,
            agents: readFileSync(join(cwd, 'AGENTS.md'), 'utf8'),
            changelog: readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'),
            connector: readFileSync(join(cwd, 'connector.ts'), 'utf8'),
            version: JSON.parse(
                result.status === 0
                    ? readFileSync(join(cwd, 'package.json'), 'utf8')
                    : git('show', 'HEAD:package.json'),
            ).version,
            unresolved: git('diff', '--name-only', '--diff-filter=U'),
        },
        {
            status: 0,
            agents: 'upstream docs\n',
            changelog: 'upstream docs\n',
            connector: 'stable connector\n',
            version: '1.0.0',
            unresolved: '',
        },
    );
});

test('retains fork maintainer attribution when upstream author fields change', (t) => {
    const { cwd, git, result } = fixture(t, 'attribution');
    const manifest = JSON.parse(
        result.status === 0
            ? readFileSync(join(cwd, 'manifest.json'), 'utf8')
            : git('show', 'HEAD:manifest.json'),
    );
    assert.deepEqual(
        {
            status: result.status,
            author: manifest.author,
            authorUrl: manifest.authorUrl,
            minAppVersion: manifest.minAppVersion,
        },
        {
            status: 0,
            author: 'Original author; fork maintainer',
            authorUrl: 'https://example.com/fork',
            minAppVersion: '1.9.0',
        },
    );
});
