import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildNeovimSpawnArgs } from '../../../src/rpc/neovim-connection';

// The M0 policy determination rests on one hard constraint: pluginAutoFetch
// may never feed the real Neovim runtime. It fetches third-party Lua from
// GitHub into the vault's lua/ tree for the sandboxed fengari VM. If any of
// that reached the spawned Neovim -- most plausibly as a runtimepath entry --
// the plugin would be installing executable dependencies for a real runtime,
// which the Obsidian Developer Policies list under "Not allowed".
//
// The design plan carries this as risk R-5 and requires a test asserting it
// cannot happen, rather than an argument that it does not.

const REPO_ROOT = resolve(__dirname, '../../..');
const RPC_DIR = join(REPO_ROOT, 'src/rpc');
const PLUGIN_STORE = join(REPO_ROOT, 'src/lua/plugin-store.ts');

const FETCH_MODULES = ['plugin-fetch', 'plugin-store', 'module-snapshot'];

function rpcSourceFiles(): string[] {
    return readdirSync(RPC_DIR).filter(
        (name) => name.endsWith('.ts') || name.endsWith('.lua'),
    );
}

// Read the store's own on-disk paths rather than restating them, so renaming
// the staging directory cannot quietly retire this assertion.
function fetchStorePathLiterals(): string[] {
    const source = readFileSync(PLUGIN_STORE, 'utf8');
    const literals = [...source.matchAll(/'(lua\/[^']+)'/g)]
        .map((match) => match[1])
        .filter((value): value is string => value !== undefined);
    expect(literals.length).toBeGreaterThan(0);
    return literals;
}

describe('pluginAutoFetch cannot feed the real Neovim runtime (R-5)', () => {
    it('spawns with no path at all when no config is set', () => {
        expect(buildNeovimSpawnArgs(null)).toEqual(['--embed', '--headless']);
    });

    // A full argv equality is the lock: any element appended to the spawn --
    // a second --cmd, an extra runtimepath entry, a --packpath -- fails here
    // whether or not the author thought about pluginAutoFetch.
    it('builds the entire argv from the configured path alone', () => {
        expect(
            buildNeovimSpawnArgs('/home/u/.config/obsidian-nvim/init.lua'),
        ).toEqual([
            '--embed',
            '--headless',
            '--clean',
            '--cmd',
            'lua vim.opt.runtimepath:prepend("/home/u/.config/obsidian-nvim")',
            '--cmd',
            "lua vim.opt.packpath:append(vim.fs.joinpath(vim.fn.stdpath('data'), 'site'))",
            '-u',
            '/home/u/.config/obsidian-nvim/init.lua',
        ]);
    });

    // The packpath entry above is the one path in the argv not derived from
    // the user's configured file. It resolves inside Neovim's own data
    // directory, which is what keeps it clear of the fetch store; asserting
    // that is what makes the argv addition reviewable rather than a silently
    // bumped expectation.
    it('restores packages only from Neovim its own data directory', () => {
        const packpath = buildNeovimSpawnArgs(
            '/home/u/.config/obsidian-nvim/init.lua',
        ).filter((argument) => argument.includes('packpath'));
        expect(packpath).toHaveLength(1);
        expect(packpath[0]).toContain("vim.fn.stdpath('data')");
        expect(packpath[0]).not.toContain('/');
    });

    it('names no fetch-store path for any configured config path', () => {
        const forbidden = fetchStorePathLiterals();
        for (const configPath of [
            '/home/u/.config/obsidian-nvim/init.lua',
            '/home/u/vault/nvim/init.lua',
            '/home/u/vault/init.lua',
        ]) {
            const argv = buildNeovimSpawnArgs(configPath).join(' ');
            for (const path of forbidden) {
                expect(argv).not.toContain(path);
            }
        }
    });

    it('gives the RPC subsystem no import path to the fetch store', () => {
        const offenders: string[] = [];
        for (const name of rpcSourceFiles()) {
            const source = readFileSync(join(RPC_DIR, name), 'utf8');
            for (const module of FETCH_MODULES) {
                if (source.includes(`lua/${module}`)) {
                    offenders.push(`${name} -> ${module}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('names no fetch-store path anywhere in the RPC subsystem', () => {
        const forbidden = fetchStorePathLiterals();
        const offenders: string[] = [];
        for (const name of rpcSourceFiles()) {
            const source = readFileSync(join(RPC_DIR, name), 'utf8');
            for (const path of forbidden) {
                if (source.includes(path)) offenders.push(`${name} -> ${path}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
