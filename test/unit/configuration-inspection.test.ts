import { readFileSync } from 'node:fs';
import { definitions } from '../../src/configuration/definitions';
import { injectPackageAndRequire } from '../../src/lua/package';
import { LuaModuleSnapshot } from '../../src/lua/module-snapshot';
import { AutocmdManager } from '../../src/lua/autocmd';
import { describe, it, expect, vi } from 'vitest';
import { lua, lauxlib, lualib, to_luastring } from '../../src/lib/fengari';
import {
    bindConfiguration,
    compileNamed,
    mappingSource,
} from '../../src/configuration/source';
import {
    ConfigurationTracker,
    observeMappings,
} from '../../src/configuration/tracker';
import { createConfigurationApi } from '../../src/configuration/inspect';
import type { MappingSource } from '../../src/configuration/types';
import type { VimApiCallbacks } from '../../src/lua/api';
import type { App } from 'obsidian';
import type { VimApi } from '../../src/types/vim-api';

describe('configuration observation', () => {
    it('captures the calling file and line from real Lua without changing execution', () => {
        const state = lauxlib.luaL_newstate()!;
        lualib.luaL_openlibs(state);
        const tracker = new ConfigurationTracker();
        tracker.begin();
        bindConfiguration(state, tracker);
        let source: MappingSource | undefined;
        lua.lua_pushjsfunction(state, (current) => {
            source = mappingSource(current);
            return 0;
        });
        lua.lua_setglobal(state, to_luastring('capture'));
        const text =
            '-- unicode λ\nlocal function setup()\n capture()\nend\nsetup()';
        expect(
            compileNamed(state, to_luastring(text), '@/config/lua/keys.lua'),
        ).toBe(lua.LUA_OK);
        expect(lua.lua_pcall(state, 0, 0, 0)).toBe(lua.LUA_OK);
        expect(source).toEqual({ path: '/config/lua/keys.lua', line: 3 });
        expect(tracker.state().sources).toEqual([
            { path: '/config/lua/keys.lua', text },
        ]);
        lua.lua_close(state);
    });
    it('tracks replacement and deletion independently by mode and buffer', () => {
        const tracker = new ConfigurationTracker();
        tracker.begin();
        const callbacks: VimApiCallbacks = {
            autocmdManager: new AutocmdManager(null),
            onSettingOverride: vi.fn(),
            handleExCommand: vi.fn(),
            getVaultName: () => 'test',
            onKeymap: vi.fn(),
            onKeymapDel: vi.fn(),
            onBufferKeymap: vi.fn(),
            onBufferKeymapDel: vi.fn(),
        };
        const observed = observeMappings(callbacks, tracker);
        const map = {
            mode: 'normal' as const,
            lhs: ' x',
            rhs: 'dd',
            noremap: true,
        };
        observed.onKeymap(map);
        observed.onKeymap({ ...map, rhs: 'yy' });
        observed.onBufferKeymap?.('file.lua', map);
        observed.onKeymap({ ...map, mode: 'insert' });
        expect(callbacks.onKeymap).toHaveBeenCalledTimes(3);
        expect(tracker.records('file.lua')).toHaveLength(3);
        expect(tracker.records()[0]?.findings[0]).toMatch(/Replaces/);
        observed.onKeymapDel({ mode: 'normal', lhs: ' x' });
        expect(tracker.records('file.lua')).toHaveLength(2);
        tracker.begin();
        tracker.complete('syntax error');
        expect(tracker.records()).toEqual([]);
        expect(tracker.state().status).toContain('syntax error');
    });
    it('does not turn observer failures into mapping failures and disposes listeners', async () => {
        const tracker = new ConfigurationTracker();
        const listener = vi.fn();
        tracker.subscribe(listener);
        const callbacks: VimApiCallbacks = {
            autocmdManager: new AutocmdManager(null),
            onSettingOverride: vi.fn(),
            handleExCommand: vi.fn(),
            getVaultName: () => 'test',
            onKeymap: vi.fn(),
            onKeymapDel: vi.fn(),
        };
        vi.spyOn(tracker, 'set').mockImplementation(() => {
            throw new Error('observer failed');
        });
        expect(() =>
            observeMappings(callbacks, tracker).onKeymap({
                mode: 'normal',
                lhs: 'x',
                rhs: 'y',
                noremap: true,
            }),
        ).not.toThrow();
        expect(callbacks.onKeymap).toHaveBeenCalledOnce();
        tracker.begin();
        const unsubscribe = tracker.subscribe(() => {});
        unsubscribe();
        tracker.dispose();
        await Promise.resolve();
        expect(listener).toHaveBeenCalledOnce();
    });
    it('compares actual host shortcuts, respects unbinding, and never writes to the engine', () => {
        const app = {
            commands: {
                commands: { close: { name: 'Close' }, find: { name: 'Find' } },
            },
            hotkeyManager: {
                defaultKeys: {
                    close: [{ modifiers: ['Ctrl'], key: 'w' }],
                    find: [{ modifiers: ['Ctrl'], key: 'f' }],
                },
                customKeys: {
                    close: [{ modifiers: ['Ctrl'], key: 'q' }],
                    find: [],
                },
            },
        } as unknown as App;
        const getKeymap = vi.fn((mode: string) =>
            mode === 'normal'
                ? [
                      {
                          keys: '<C-w>',
                          type: 'action',
                          context: mode,
                          action: 'window',
                      },
                      {
                          keys: '<C-f>',
                          type: 'action',
                          context: mode,
                          action: 'page',
                      },
                  ]
                : [],
        );
        const tracker = new ConfigurationTracker();
        tracker.set({
            mode: 'normal',
            lhs: '<C-w>',
            rhs: 'dd',
            noremap: true,
            source: { path: 'old.lua', line: 1 },
        });
        const api = createConfigurationApi(app, tracker, {
            backend: () => 'bundled',
            vim: () => ({ getKeymap }) as unknown as VimApi,
            buffers: () => null,
            workspace: () => null,
        });
        const snapshot = api.snapshot();
        expect(snapshot.mappings).toHaveLength(2);
        expect(snapshot.mappings[0]?.path).toBeUndefined();
        expect(snapshot.mappings[0]?.action).toBe('window');
        expect(
            snapshot.mappings.every((map) => map.findings.length === 0),
        ).toBe(true);
        expect(getKeymap).toHaveBeenCalledTimes(4);
    });
});

it('observes workspace mappings and discards callbacks from old configuration generations', () => {
    const tracker = new ConfigurationTracker();
    tracker.begin();
    const callbacks: VimApiCallbacks = {
        autocmdManager: new AutocmdManager(null),
        onSettingOverride: vi.fn(),
        handleExCommand: vi.fn(),
        getVaultName: () => 'test',
        onKeymap: vi.fn(),
        onKeymapDel: vi.fn(),
        onGlobalKeymap: vi.fn(),
        onGlobalKeymapDel: vi.fn(),
    };
    const observer = observeMappings(callbacks, tracker);
    observer.onGlobalKeymap?.({
        lhs: ' x',
        rhs: ':tabnext',
        source: { path: 'init.lua', line: 4 },
    });
    expect(tracker.records()[0]).toMatchObject({
        mode: 'workspace',
        path: 'init.lua',
        line: 4,
    });
    observer.onGlobalKeymapDel?.(' x');
    expect(tracker.records()).toHaveLength(0);
    tracker.begin();
    observer.onKeymap({ mode: 'normal', lhs: 'x', rhs: 'y', noremap: true });
    expect(callbacks.onKeymap).toHaveBeenCalledOnce();
    expect(tracker.records()).toHaveLength(0);
});

it('preserves required module names through the sandboxed loader', async () => {
    const state = lauxlib.luaL_newstate()!;
    lualib.luaL_openlibs(state);
    const tracker = new ConfigurationTracker();
    tracker.begin();
    bindConfiguration(state, tracker);
    const snapshot = new LuaModuleSnapshot();
    await snapshot.rebuild(
        {
            list: () =>
                Promise.resolve({
                    files: ['/config/lua/keys.lua'],
                    folders: [],
                }),
            read: () => Promise.resolve('-- module\ncapture()\nreturn {}'),
        },
        ['/config/lua'],
    );
    let source: MappingSource | undefined;
    lua.lua_pushjsfunction(state, (current) => {
        source = mappingSource(current);
        return 0;
    });
    lua.lua_setglobal(state, to_luastring('capture'));
    injectPackageAndRequire(state, '', { snapshot, roots: ['/config/lua'] });
    expect(
        compileNamed(
            state,
            to_luastring('require("keys")'),
            '@/config/init.lua',
        ),
    ).toBe(lua.LUA_OK);
    expect(lua.lua_pcall(state, 0, 0, 0)).toBe(lua.LUA_OK);
    expect(source).toEqual({ path: '/config/lua/keys.lua', line: 2 });
    expect(tracker.state().sources.map((item) => item.path)).toContain(
        '/config/lua/keys.lua',
    );
    lua.lua_close(state);
});
it('keeps definition names aligned with the audited API registry and marks compatibility stubs', () => {
    const api = readFileSync(
        new URL('../../src/lua/api.ts', import.meta.url),
        'utf8',
    );
    const supported = new Set(
        [
            ...api
                .match(
                    /const SUPPORTED_NVIM_API_FUNCTIONS = new Set<string>\(\[([\s\S]*?)\]\)/,
                )![1]!
                .matchAll(/'(nvim_\w+)'/g),
        ].map((match) => match[1]),
    );
    const known = [
        ...api
            .match(
                /const KNOWN_NVIM_API_FUNCTIONS = new Set<string>\(\[([\s\S]*?)\]\)/,
            )![1]!
            .matchAll(/'(nvim_\w+)'/g),
    ].map((match) => match[1]!);
    for (const name of known) {
        expect(definitions.text, name).toContain(`function vim.api.${name}(`);
    }
    for (const name of known.filter((name) => !supported.has(name))) {
        expect(definitions.text, name).toContain(
            `---@deprecated Unsupported in bundled Motions; compatibility stub only.\n---@param ... any\n---@return any\nfunction vim.api.${name}(`,
        );
    }
});
