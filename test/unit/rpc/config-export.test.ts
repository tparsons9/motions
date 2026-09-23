import { describe, expect, it } from 'vitest';
import {
    GENERATED_SENTINEL,
    configFingerprint,
    exportNeovimConfig,
    generateNeovimConfig,
    isGeneratedFile,
    probeModules,
    referencedModules,
    referencedRepos,
    resolveGeneratedConfigPath,
    type ConfigExportSettings,
    type ExportHost,
} from '../../../src/rpc/config-export';

const BASE: ConfigExportSettings = {
    leaderKey: ' ',
    textwidth: 80,
    snippets: false,
    snippetPaths: [],
    surround: false,
    dial: false,
    subwordMotions: false,
    yankRing: false,
    flash: false,
    easyMotion: false,
    replaceWithRegister: false,
};

function host(overrides: Partial<ExportHost> = {}): ExportHost & {
    writes: { path: string; contents: string }[];
} {
    const writes: { path: string; contents: string }[] = [];
    return {
        writes,
        request: async () => '/home/u/.config/nvim',
        readFile: async () => null,
        writeFile: async (path: string, contents: string) => {
            writes.push({ path, contents });
            return true;
        },
        ...overrides,
    };
}

describe('generated Neovim configuration', () => {
    it('emits only the blocks whose feature is enabled', () => {
        const body = generateNeovimConfig({ ...BASE, surround: true });
        expect(body).toContain("pcall(require, 'nvim-surround')");
        expect(body).not.toContain('yanky');
        expect(body).not.toContain('spider');
    });

    it('guards every plugin block so the file is inert when none are installed', () => {
        const body = generateNeovimConfig({
            ...BASE,
            surround: true,
            dial: true,
            subwordMotions: true,
            yankRing: true,
            flash: true,
            easyMotion: true,
            replaceWithRegister: true,
        });
        const requires = [...body.matchAll(/require\(/g)].length;
        const guards = [...body.matchAll(/if pcall\(require, /g)].length;
        expect(guards).toBe(7);
        expect(requires).toBeGreaterThanOrEqual(guards);
        for (const line of body.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('--')) continue;
            expect(trimmed).not.toContain('vim.pack');
        }
    });

    it('never emits an install call, whatever is enabled', () => {
        const body = generateNeovimConfig({
            ...BASE,
            surround: true,
            dial: true,
            subwordMotions: true,
            yankRing: true,
            flash: true,
            easyMotion: true,
            replaceWithRegister: true,
        });
        expect(body).not.toContain('vim.pack.add');
        expect(body).not.toContain('packadd');
        expect(body).not.toContain('git clone');
    });

    it('carries the leader key and textwidth through', () => {
        const body = generateNeovimConfig({
            ...BASE,
            leaderKey: ',',
            textwidth: 100,
        });
        expect(body).toContain("vim.g.mapleader = ','");
        expect(body).toContain('vim.opt.textwidth = 100');
    });

    it('escapes a leader key that would break the Lua string', () => {
        expect(generateNeovimConfig({ ...BASE, leaderKey: "'" })).toContain(
            "vim.g.mapleader = '\\''",
        );
        expect(generateNeovimConfig({ ...BASE, leaderKey: '\\' })).toContain(
            "vim.g.mapleader = '\\\\'",
        );
    });

    it('starts with the sentinel and recognises its own output', () => {
        const body = generateNeovimConfig(BASE);
        expect(body.startsWith(GENERATED_SENTINEL)).toBe(true);
        expect(isGeneratedFile(body)).toBe(true);
        expect(isGeneratedFile('-- my own config\nreturn {}')).toBe(false);
    });

    it('emits the snippet paths it was given, and a way to expand them', () => {
        const body = generateNeovimConfig({
            ...BASE,
            snippets: true,
            snippetPaths: [
                '/home/u/.config/nvim/lua/vim-motions-snippets/global.json',
            ],
        });
        expect(body).toContain("pcall(require, 'luasnip')");
        expect(body).toContain('vim-motions-snippets/global.json');
        expect(body).toContain('load_standalone');
        // Loading without an expansion key is the inert-but-plausible shape,
        // so this asserts the mapping is registered rather than merely that
        // the word appears somewhere in the block.
        expect(body).toContain("vim.keymap.set({ 'i', 's' }, '<Tab>'");
        expect(body).toContain("vim.keymap.set({ 'i', 's' }, '<S-Tab>'");
    });

    // A Windows path is full of backslashes, which a Lua single-quoted string
    // must double. Getting this wrong fails only on Windows, so it is pinned
    // here rather than left to a platform-specific CI shard to discover.
    it('escapes a Windows snippet path so Lua reads it back unchanged', () => {
        const windowsPath =
            'D:\\a\\motions\\lua\\vim-motions-snippets\\global.json';
        const body = generateNeovimConfig({
            ...BASE,
            snippets: true,
            snippetPaths: [windowsPath],
        });
        expect(body).not.toContain(windowsPath);
        const literals = [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(
            (match) => (match[1] ?? '').replace(/\\(.)/g, '$1'),
        );
        expect(literals).toContain(windowsPath);
    });

    it('emits no snippet block when snippets are disabled', () => {
        expect(generateNeovimConfig(BASE)).not.toContain('luasnip');
    });

    it('maps every enabled block to a repository to install from', () => {
        const all: ConfigExportSettings = {
            ...BASE,
            surround: true,
            dial: true,
            subwordMotions: true,
            yankRing: true,
            flash: true,
            easyMotion: true,
            replaceWithRegister: true,
        };
        const repos = referencedRepos(all);
        expect(repos).toHaveLength(6);
        for (const repo of repos)
            expect(repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
        expect(referencedRepos(BASE)).toEqual([]);
    });

    // flash covers two features, so the install list must not ask Neovim for
    // it twice.
    it('deduplicates a repository shared by two features', () => {
        expect(
            referencedRepos({ ...BASE, flash: true, easyMotion: true }),
        ).toEqual(['https://github.com/folke/flash.nvim']);
    });

    it('reports the modules the enabled blocks reference, deduplicated', () => {
        expect(
            referencedModules({ ...BASE, flash: true, easyMotion: true }),
        ).toEqual(['flash']);
        expect(referencedModules(BASE)).toEqual([]);
    });
});

describe('generated configuration fingerprint', () => {
    it('changes when a setting the export uses changes', () => {
        expect(configFingerprint(BASE)).not.toBe(
            configFingerprint({ ...BASE, surround: true }),
        );
        expect(configFingerprint(BASE)).not.toBe(
            configFingerprint({ ...BASE, textwidth: 81 }),
        );
    });

    it('is stable for equal settings', () => {
        expect(configFingerprint(BASE)).toBe(configFingerprint({ ...BASE }));
    });
});

describe('writing the generated configuration', () => {
    it('writes under lua/ so require resolves it', async () => {
        const target = host();
        const outcome = await exportNeovimConfig(target, '', BASE);
        expect(outcome).toEqual({
            status: 'written',
            path: '/home/u/.config/nvim/lua/vim_motions.lua',
        });
        expect(target.writes[0]?.path).toBe(
            '/home/u/.config/nvim/lua/vim_motions.lua',
        );
    });

    it('uses the configured config file directory when one is set', async () => {
        const target = host();
        expect(
            await resolveGeneratedConfigPath(
                target,
                '/home/u/obsidian-nvim/init.lua',
            ),
        ).toBe('/home/u/obsidian-nvim/lua/vim_motions.lua');
    });

    it('overwrites a file it previously generated', async () => {
        const target = host({
            readFile: async () => generateNeovimConfig(BASE),
        });
        const outcome = await exportNeovimConfig(target, '', {
            ...BASE,
            flash: true,
        });
        expect(outcome.status).toBe('written');
        expect(target.writes).toHaveLength(1);
    });

    // The written file and the reference to it must be the same string.
    // Windows opens either spelling, so a mismatch is invisible at runtime.
    it('references a bundled snippet with one separator on Windows', async () => {
        const target = host();
        await exportNeovimConfig(target, 'D:\\cfg\\init.lua', {
            ...BASE,
            snippets: true,
            snippetPaths: ['vim-motions-snippets/global.json'],
        });
        const config = target.writes.find((write) =>
            write.path.endsWith('vim_motions.lua'),
        );
        const bundled = target.writes.find((write) =>
            write.path.endsWith('global.json'),
        );
        expect(bundled?.path).toBe(
            'D:\\cfg\\lua\\vim-motions-snippets\\global.json',
        );
        expect(config?.contents).toContain(
            "'D:\\\\cfg\\\\lua\\\\vim-motions-snippets\\\\global.json'",
        );
        expect(config?.contents).not.toContain('vim-motions-snippets/');
    });

    it('refuses to overwrite a file the user has taken over', async () => {
        const target = host({
            readFile: async () => 'return { my = "own config" }',
        });
        const outcome = await exportNeovimConfig(target, '', BASE);
        expect(outcome).toEqual({
            status: 'foreign',
            path: '/home/u/.config/nvim/lua/vim_motions.lua',
        });
        expect(target.writes).toEqual([]);
    });

    it('reports a failure rather than claiming success', async () => {
        const target = host({ writeFile: async () => false });
        expect((await exportNeovimConfig(target, '', BASE)).status).toBe(
            'failed',
        );
        const unresolvable = host({ request: async () => '' });
        expect((await exportNeovimConfig(unresolvable, '', BASE)).status).toBe(
            'failed',
        );
    });
});

describe('probing which referenced modules are installed', () => {
    it('maps each module to what Neovim reported', async () => {
        const target = host({
            request: async () => ({ flash: true, 'nvim-surround': false }),
        });
        expect(await probeModules(target, ['flash', 'nvim-surround'])).toEqual({
            flash: true,
            'nvim-surround': false,
        });
    });

    it('treats a missing or malformed answer as not installed', async () => {
        const target = host({ request: async () => null });
        expect(await probeModules(target, ['flash'])).toEqual({ flash: false });
    });

    it('asks Neovim nothing when there is nothing to probe', async () => {
        let asked = false;
        const target = host({
            request: async () => {
                asked = true;
                return {};
            },
        });
        expect(await probeModules(target, [])).toEqual({});
        expect(asked).toBe(false);
    });
});
