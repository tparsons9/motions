import { describe, expect, it, vi } from 'vitest';
import { lauxlib, lua, to_luastring } from '../../../src/lib/fengari';
import { AutocmdManager } from '../../../src/lua/autocmd';
import { injectVimApi } from '../../../src/lua/api';
import { createSandboxedState, destroyState } from '../../../src/lua/engine';

describe('buffer configuration API', () => {
    it('keeps scoped labels out of global callbacks and rejects missing buffers', () => {
        const L = createSandboxedState();
        let path: string | null = 'file:/repo/app.py';
        const local = vi.fn(),
            shared = vi.fn(),
            map = vi.fn();
        injectVimApi(L, {
            autocmdManager: new AutocmdManager(L),
            onSettingOverride() {},
            handleExCommand() {},
            getVaultName: () => 'vault',
            onKeymap: map,
            onKeymapDel() {},
            getLeaderKey: () => ' ',
            getActiveFilePath: () => path,
            onBufferWhichKeyLabel: local,
            onWhichKeyGroupLabel: shared,
            onWhichKeyCommandLabel: shared,
        });
        expect(
            lauxlib.luaL_dostring(
                L,
                to_luastring(`
            vim.ob.whichkey.set_group('<leader>c', 'Code', {buffer=true, mode='n'})
            vim.ob.whichkey.add({{'<leader>cf', desc='Format', buffer=0}})
        `),
            ),
        ).toBe(lua.LUA_OK);
        expect(
            local.mock.calls.map((call) => [call[0], call[1], call[2].label]),
        ).toEqual([
            ['file:/repo/app.py', true, 'Code'],
            ['file:/repo/app.py', false, 'Format'],
        ]);
        expect(shared).not.toHaveBeenCalled();
        path = null;
        expect(
            lauxlib.luaL_dostring(
                L,
                to_luastring(`vim.keymap.set('n', 'x', 'j', {buffer=true})`),
            ),
        ).not.toBe(lua.LUA_OK);
        expect(map).not.toHaveBeenCalled();
        destroyState(L);
    });
});
