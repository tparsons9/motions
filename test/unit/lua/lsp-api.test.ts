import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    lua,
    lauxlib,
    to_jsstring,
    to_luastring,
} from '../../../src/lib/fengari';
import { createSandboxedState, destroyState } from '../../../src/lua/engine';
import { injectLspApi } from '../../../src/lua/lsp-api';
import {
    LanguageProviderRegistry,
    type LanguageDiagnostic,
} from '../../../src/integrations/language-providers';

type LuaState = ReturnType<typeof createSandboxedState>;

const diagnostics: LanguageDiagnostic[] = [
    { from: 3, to: 5, severity: 'error', message: 'bad name', source: 'ruff' },
    { from: 6, to: 7, severity: 'warning', message: 'unused' },
];

function setup(options: { withProvider?: boolean; head?: number } = {}) {
    const L = createSandboxedState();
    // `vim` is the namespace the API attaches to; the stdlib is not needed here.
    lua.lua_newtable(L);
    lua.lua_setglobal(L, to_luastring('vim'));

    const registry = new LanguageProviderRegistry();
    const calls: string[] = [];
    if (options.withProvider !== false) {
        registry.register({
            id: 'host',
            matches: () => true,
            hover: () => void calls.push('hover'),
            definition: () => void calls.push('definition'),
            codeAction: () => void calls.push('codeAction'),
            format: () => void calls.push('format'),
            diagnostics: () => diagnostics,
        });
    }
    const view = {
        state: EditorState.create({
            doc: 'aa\nbb\ncc\n',
            selection: { anchor: options.head ?? 0 },
        }),
    } as EditorView;
    const jumped: number[] = [];
    injectLspApi(L, {
        getEditorView: () => view,
        getLanguageProviders: () => registry,
        jumpTo: (_view, offset) => jumped.push(offset),
    });
    return { L, calls, jumped };
}

function evalLua(L: LuaState, source: string): unknown {
    const status = lauxlib.luaL_dostring(L, to_luastring(`return ${source}`));
    expect(status).toBe(lua.LUA_OK);
    if (lua.lua_isboolean(L, -1)) return lua.lua_toboolean(L, -1);
    if (lua.lua_isnumber(L, -1)) return lua.lua_tonumber(L, -1);
    if (lua.lua_isstring(L, -1)) {
        const raw = lua.lua_tolstring(L, -1);
        return raw ? to_jsstring(raw) : null;
    }
    if (lua.lua_isnil(L, -1)) return null;
    return undefined;
}

describe('vim.lsp and vim.diagnostic', () => {
    it('routes vim.lsp.buf calls to the provider', () => {
        const { L, calls } = setup();

        expect(evalLua(L, 'vim.lsp.buf.hover()')).toBe(true);
        evalLua(L, 'vim.lsp.buf.definition()');
        evalLua(L, 'vim.lsp.buf.type_definition()');
        evalLua(L, 'vim.lsp.buf.code_action()');
        evalLua(L, 'vim.lsp.buf.format()');

        expect(calls).toEqual([
            'hover',
            'definition',
            'definition',
            'codeAction',
            'format',
        ]);
        destroyState(L);
    });

    it('reports when nothing handles the call', () => {
        const { L } = setup({ withProvider: false });
        expect(evalLua(L, 'vim.lsp.buf.hover()')).toBe(false);
        expect(evalLua(L, 'vim.diagnostic.count()')).toBe(0);
        expect(evalLua(L, '#vim.diagnostic.get()')).toBe(0);
        expect(evalLua(L, 'vim.diagnostic.goto_next()')).toBeNull();
        destroyState(L);
    });

    it('exposes diagnostics as Neovim-shaped entries', () => {
        const { L } = setup();

        expect(evalLua(L, '#vim.diagnostic.get()')).toBe(2);
        expect(evalLua(L, 'vim.diagnostic.get()[1].message')).toBe('bad name');
        expect(evalLua(L, 'vim.diagnostic.get()[1].lnum')).toBe(1);
        expect(evalLua(L, 'vim.diagnostic.get()[1].col')).toBe(0);
        expect(evalLua(L, 'vim.diagnostic.get()[1].end_lnum')).toBe(1);
        expect(evalLua(L, 'vim.diagnostic.get()[1].end_col')).toBe(2);
        expect(evalLua(L, 'vim.diagnostic.get()[1].source')).toBe('ruff');
        expect(evalLua(L, 'vim.diagnostic.get()[1].severity')).toBe(
            evalLua(L, 'vim.diagnostic.severity.ERROR'),
        );
        expect(evalLua(L, 'vim.diagnostic.get()[2].severity')).toBe(
            evalLua(L, 'vim.diagnostic.severity.WARN'),
        );
        destroyState(L);
    });

    it('jumps forward, backward and by count', () => {
        const { L, jumped } = setup();

        expect(evalLua(L, 'vim.diagnostic.goto_next().message')).toBe(
            'bad name',
        );
        expect(
            evalLua(L, 'vim.diagnostic.goto_next({ count = 2 }).message'),
        ).toBe('unused');
        evalLua(L, 'vim.diagnostic.goto_prev()');
        evalLua(L, 'vim.diagnostic.jump({ count = -1 })');

        // Cursor stays at offset 0, so forward finds 3 then 6, backward wraps to 6.
        expect(jumped).toEqual([3, 6, 6, 6]);
        destroyState(L);
    });

    it('leaves other vim namespaces alone', () => {
        const { L } = setup();
        expect(evalLua(L, 'type(vim.lsp.buf)')).toBe('table');
        expect(evalLua(L, 'vim.lsp.get_clients')).toBeNull();
        destroyState(L);
    });
});
