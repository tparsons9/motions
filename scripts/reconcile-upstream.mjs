import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const metadata = [
    'package.json',
    'package-lock.json',
    'manifest.json',
    'versions.json',
];
const vimDependency = 'https://github.com/saberzero1/codemirror-vim.git';

/** @param {string[]} args */
function git(args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge independent JSON fields; overlapping non-release edits require review.
 * Undefined represents a deleted or absent field.
 * @param {unknown} base
 * @param {unknown} ours
 * @param {unknown} theirs
 * @param {string} path
 * @returns {unknown}
 */
function merge(base, ours, theirs, path) {
    if (isDeepStrictEqual(ours, theirs)) return ours;
    if (isDeepStrictEqual(base, ours)) return theirs;
    if (isDeepStrictEqual(base, theirs)) return ours;
    if (
        isObject(ours) &&
        isObject(theirs) &&
        (base === undefined || isObject(base))
    ) {
        const ancestor = base ?? {};
        return Object.fromEntries(
            [
                ...new Set([
                    ...Object.keys(ancestor),
                    ...Object.keys(ours),
                    ...Object.keys(theirs),
                ]),
            ]
                .map((key) => [
                    key,
                    merge(
                        ancestor[key],
                        ours[key],
                        theirs[key],
                        `${path}.${key}`,
                    ),
                ])
                .filter(([, value]) => value !== undefined),
        );
    }
    throw new Error(`Manual review required: ${path}`);
}

/** @param {string} ref @param {string} file */
function read(ref, file) {
    const value = JSON.parse(git(['show', `${ref}:${file}`]));
    if (!isObject(value))
        throw new Error(`Expected JSON object: ${ref}:${file}`);
    return value;
}

try {
    const upstream = process.argv[2] ?? 'upstream/master';
    const base = git(['merge-base', 'HEAD', upstream]);
    const conflicts = git(['diff', '--name-only', '--diff-filter=U', '-z'])
        .split('\0')
        .filter(Boolean);
    const sourceConflicts = conflicts.filter(
        (file) => !metadata.includes(file),
    );
    if (sourceConflicts.length) {
        throw new Error(
            `Manual review required for source conflicts:\n${sourceConflicts.join('\n')}`,
        );
    }

    const oursPackage = read('HEAD', 'package.json');
    const oursManifest = read('HEAD', 'manifest.json');
    if (oursPackage.version !== oursManifest.version) {
        throw new Error(
            'Fork package.json and manifest.json versions disagree',
        );
    }
    // Calculate everything before writing, so a field conflict never partially resolves files.
    const resolved = new Map();
    for (const file of ['package.json', 'manifest.json']) {
        const ancestor = read(base, file);
        const ours = read('HEAD', file);
        const theirs = read(upstream, file);
        for (const value of [ancestor, ours, theirs]) {
            delete value.version;
            if (file === 'package.json' && isObject(value.dependencies)) {
                delete value.dependencies['@replit/codemirror-vim'];
            }
        }
        const result = merge(ancestor, ours, theirs, file);
        if (!isObject(result))
            throw new Error(`Expected merged object: ${file}`);
        result.version = oursPackage.version;
        if (file === 'package.json') {
            const dependencies = isObject(result.dependencies)
                ? result.dependencies
                : {};
            dependencies['@replit/codemirror-vim'] = vimDependency;
            result.dependencies = dependencies;
        }
        resolved.set(file, result);
    }
    // Keep the fork's release history on duplicate versions, import new upstream entries.
    resolved.set('versions.json', {
        ...read(upstream, 'versions.json'),
        ...read('HEAD', 'versions.json'),
        [String(oursPackage.version)]:
            resolved.get('manifest.json').minAppVersion,
    });
    for (const [file, value] of resolved) {
        writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`);
    }
    // Seed npm's regeneration with the fork lock to preserve pinned resolutions.
    execFileSync('git', ['checkout', 'HEAD', '--', 'package-lock.json']);
    git(['add', ...metadata]);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
