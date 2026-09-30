import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const statePath = '.github/upstream-release.json';
const repository = 'saberzero1/motions';

/** @typedef {{repository: string, tag: string, commit: string, revision: number}} Provenance */

/** @param {string | undefined} tag @param {string | undefined} commit */
function validateBaseline(tag, commit) {
    if (!tag || !/^v?\d+\.\d+\.\d+$/.test(tag))
        throw new Error('Expected a stable numeric upstream release tag');
    if (!commit || !/^[a-f0-9]{40}$/.test(commit))
        throw new Error('Expected the upstream release commit SHA');
}

/** @returns {Provenance | null} */
function readState() {
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    validateBaseline(state.tag, state.commit);
    if (
        state.repository !== repository ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0
    ) {
        throw new Error('Invalid upstream release provenance');
    }
    return state;
}

/** @param {Provenance} state */
function writeState(state) {
    writeFileSync(statePath, `${JSON.stringify(state, null, 4)}\n`);
}

/** @returns {string} */
function readVersion() {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const manifestVersion = JSON.parse(
        readFileSync('manifest.json', 'utf8'),
    ).version;
    if (
        typeof version !== 'string' ||
        !/^\d+\.\d+\.\d+$/.test(version) ||
        version !== manifestVersion
    ) {
        throw new Error(
            'Fork package and manifest versions must match and use numeric x.y.z',
        );
    }
    return version;
}

try {
    const [command, tagOrPrefix, commit] = process.argv.slice(2);
    const state = readState();
    if (command === 'needs-sync' || command === 'sync') {
        validateBaseline(tagOrPrefix, commit);
        const changed = state?.tag !== tagOrPrefix || state?.commit !== commit;
        if (command === 'needs-sync') {
            console.log(String(changed));
        } else {
            writeState({
                repository,
                tag: String(tagOrPrefix),
                commit: String(commit),
                revision: changed ? 0 : (state?.revision ?? 0),
            });
        }
    } else if (command === 'bump') {
        readVersion();
        if (!state)
            throw new Error(
                'Sync an upstream release before creating a fork release',
            );
        if (!Number.isSafeInteger(state.revision + 1))
            throw new Error('Compatibility revision overflow');
        writeState({ ...state, revision: state.revision + 1 });
    } else if (command === 'describe') {
        const version = readVersion();
        if (!state) throw new Error('Missing upstream release provenance');
        if (!tagOrPrefix)
            throw new Error('Expected a release-notes output path prefix');
        const title = `Fork ${version} — upstream ${state.tag}, compatibility revision ${state.revision}`;
        const notes = [
            `Fork version: **${version}**`,
            `Upstream release: [${state.tag}](https://github.com/${repository}/releases/tag/${state.tag})`,
            `Upstream commit: [${state.commit}](https://github.com/${repository}/commit/${state.commit})`,
            `Compatibility revision for this upstream release: **${state.revision}**`,
            '',
            'Original plugin by Emile Bangma; compatibility fork maintained by Tanner Parsons.',
            'This build retains the fork’s compatibility changes. Review the draft and its assets before publishing.',
            '',
        ].join('\n');
        writeFileSync(`${tagOrPrefix}.title`, `${title}\n`);
        writeFileSync(`${tagOrPrefix}.md`, notes);
    } else {
        throw new Error(
            'Use fork-release.mjs needs-sync|sync <tag> <sha>, bump, or describe <output-prefix>',
        );
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
