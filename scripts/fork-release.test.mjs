import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./fork-release.mjs', import.meta.url));
const initial = {
    repository: 'saberzero1/motions',
    tag: '1.3.1',
    commit: 'a'.repeat(40),
    revision: 3,
};

/** @param {import('node:test').TestContext} t */
function fixture(t) {
    const cwd = mkdtempSync(join(tmpdir(), 'motions-fork-release-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    mkdirSync(join(cwd, '.github'));
    writeFileSync(
        join(cwd, '.github/upstream-release.json'),
        JSON.stringify(initial),
    );
    for (const file of ['package.json', 'manifest.json'])
        writeFileSync(join(cwd, file), JSON.stringify({ version: '1.0.2' }));
    /** @param {...string} args */
    const run = (...args) =>
        spawnSync(process.execPath, [script, ...args], {
            cwd,
            encoding: 'utf8',
        });
    const state = () =>
        JSON.parse(
            readFileSync(join(cwd, '.github/upstream-release.json'), 'utf8'),
        );
    return { cwd, run, state };
}

test('a new stable upstream baseline resets the compatibility revision', (t) => {
    const { run, state } = fixture(t);
    const result = run('sync', '1.4.0', 'b'.repeat(40));
    assert.deepEqual(
        { status: result.status, state: state() },
        {
            status: 0,
            state: {
                repository: 'saberzero1/motions',
                tag: '1.4.0',
                commit: 'b'.repeat(40),
                revision: 0,
            },
        },
    );
});

test('resyncing the same release retains compatibility revisions', (t) => {
    const { run, state } = fixture(t);
    const result = run('sync', initial.tag, initial.commit);
    assert.deepEqual(
        { status: result.status, state: state() },
        { status: 0, state: initial },
    );
});

test('a fork release increments its revision without replacing the baseline', (t) => {
    const { run, state } = fixture(t);
    const result = run('bump');
    assert.deepEqual(
        { status: result.status, state: state() },
        { status: 0, state: { ...initial, revision: 4 } },
    );
});

test('provenance changes trigger sync even when the release commit was already merged', (t) => {
    const { run } = fixture(t);
    const same = run('needs-sync', initial.tag, initial.commit);
    const changed = run('needs-sync', '1.4.0', 'b'.repeat(40));
    assert.deepEqual(
        [
            same.status,
            same.stdout.trim(),
            changed.status,
            changed.stdout.trim(),
        ],
        [0, 'false', 0, 'true'],
    );
});

test('release title and notes describe the exact recorded baseline', (t) => {
    const { cwd, run } = fixture(t);
    const result = run('describe', join(cwd, 'notes'));
    assert.deepEqual(
        {
            status: result.status,
            title: readFileSync(join(cwd, 'notes.title'), 'utf8'),
            notes: readFileSync(join(cwd, 'notes.md'), 'utf8'),
        },
        {
            status: 0,
            title: 'Fork 1.0.2 — upstream 1.3.1, compatibility revision 3\n',
            notes: `Fork version: **1.0.2**\nUpstream release: [1.3.1](https://github.com/saberzero1/motions/releases/tag/1.3.1)\nUpstream commit: [${initial.commit}](https://github.com/saberzero1/motions/commit/${initial.commit})\nCompatibility revision for this upstream release: **3**\n\nOriginal plugin by Emile Bangma; compatibility fork maintained by Tanner Parsons.\nThis build retains the fork’s compatibility changes. Review the draft and its assets before publishing.\n`,
        },
    );
});

test('rejects a prerelease baseline and an invalid commit without changing provenance', (t) => {
    const { run, state } = fixture(t);
    const prerelease = run('sync', '1.4.0-beta.1', 'b'.repeat(40));
    const badCommit = run('sync', '1.4.0', 'master');
    assert.deepEqual(
        { statuses: [prerelease.status, badCommit.status], state: state() },
        { statuses: [1, 1], state: initial },
    );
});

test('rejects suffixed fork versions before incrementing the revision', (t) => {
    const { cwd, run, state } = fixture(t);
    for (const file of ['package.json', 'manifest.json'])
        writeFileSync(
            join(cwd, file),
            JSON.stringify({ version: '1.0.2-fork.1' }),
        );
    const result = run('bump');
    assert.deepEqual(
        { status: result.status, state: state() },
        { status: 1, state: initial },
    );
});
