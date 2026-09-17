import { lua, to_luastring } from '../lib/fengari';
import type { lua_State } from '../lib/fengari';
import type { EditorView } from '@codemirror/view';
import {
    diagnosticTarget,
    type LanguageAction,
    type LanguageDiagnostic,
    type LanguageProviderRegistry,
} from '../integrations/language-providers';

/** Neovim's `vim.diagnostic.severity` values. */
const SEVERITY: Record<LanguageDiagnostic['severity'], number> = {
    error: 1,
    warning: 2,
    info: 3,
    hint: 4,
};

export interface LspApiCallbacks {
    /** The editor Lua treats as the current buffer. */
    getEditorView(): EditorView | null;
    getLanguageProviders(): LanguageProviderRegistry | null;
    /** Moves the cursor of the current editor to a document offset. */
    jumpTo(view: EditorView, offset: number): void;
}

interface Context {
    view: EditorView;
    providers: LanguageProviderRegistry;
}

function context(callbacks: LspApiCallbacks): Context | null {
    const view = callbacks.getEditorView();
    const providers = callbacks.getLanguageProviders();
    return view && providers ? { view, providers } : null;
}

function pushDiagnostic(
    L: lua_State,
    view: EditorView,
    item: LanguageDiagnostic,
): void {
    const doc = view.state.doc;
    const from = doc.lineAt(Math.min(item.from, doc.length));
    const to = doc.lineAt(Math.min(item.to, doc.length));
    lua.lua_newtable(L);
    const fields: Array<[string, number | string]> = [
        ['bufnr', 0],
        ['lnum', from.number - 1],
        ['col', Math.min(item.from, doc.length) - from.from],
        ['end_lnum', to.number - 1],
        ['end_col', Math.min(item.to, doc.length) - to.from],
        ['severity', SEVERITY[item.severity] ?? SEVERITY.error],
        ['message', item.message],
        ['source', item.source ?? ''],
    ];
    for (const [key, value] of fields) {
        if (typeof value === 'number') {
            lua.lua_pushinteger(L, value);
        } else {
            lua.lua_pushstring(L, to_luastring(value));
        }
        lua.lua_setfield(L, -2, to_luastring(key));
    }
}

/** Reads `{ count = n }` from an options table, defaulting to `fallback`. */
function readCount(L: lua_State, index: number, fallback: number): number {
    if (!lua.lua_istable(L, index)) return fallback;
    lua.lua_getfield(L, index, to_luastring('count'));
    const isNumber = lua.lua_isnumber(L, -1);
    const value = isNumber ? Math.trunc(lua.lua_tonumber(L, -1)) : 0;
    lua.lua_pop(L, 1);
    return isNumber && value !== 0 ? value : fallback;
}

/**
 * `vim.lsp.buf.*` and `vim.diagnostic.*`, backed by whichever plugin
 * registered a language provider. Without one, each call is a no-op that
 * returns Neovim's empty result, since Obsidian has no language server of
 * its own. There is no `vim.lsp.get_clients`: nothing here is an LSP client,
 * and an empty list would read as "the server is not attached yet".
 */
export function injectLspApi(L: lua_State, callbacks: LspApiCallbacks): void {
    lua.lua_getglobal(L, to_luastring('vim'));
    const vimIndex = lua.lua_gettop(L);

    // --- vim.lsp.buf ---
    lua.lua_newtable(L);
    const lspIndex = lua.lua_gettop(L);
    lua.lua_newtable(L);
    const bufIndex = lua.lua_gettop(L);

    const actions: Array<[string, LanguageAction]> = [
        ['hover', 'hover'],
        ['definition', 'definition'],
        ['declaration', 'definition'],
        ['type_definition', 'definition'],
        ['code_action', 'codeAction'],
        ['format', 'format'],
    ];
    for (const [name, action] of actions) {
        lua.lua_pushjsfunction(L, (state: lua_State) => {
            const ctx = context(callbacks);
            const handled = ctx
                ? ctx.providers.run(
                      action,
                      ctx.view,
                      ctx.view.state.selection.main.head,
                  )
                : false;
            lua.lua_pushboolean(state, handled);
            return 1;
        });
        lua.lua_setfield(L, bufIndex, to_luastring(name));
    }

    lua.lua_pushvalue(L, bufIndex);
    lua.lua_setfield(L, lspIndex, to_luastring('buf'));
    lua.lua_pushvalue(L, lspIndex);
    lua.lua_setfield(L, vimIndex, to_luastring('lsp'));
    lua.lua_pop(L, 2);

    // --- vim.diagnostic ---
    lua.lua_newtable(L);
    const diagIndex = lua.lua_gettop(L);

    lua.lua_pushjsfunction(L, (state: lua_State) => {
        const ctx = context(callbacks);
        lua.lua_newtable(state);
        if (!ctx) return 1;
        const items = ctx.providers.diagnostics(ctx.view);
        for (const [index, item] of items.entries()) {
            pushDiagnostic(state, ctx.view, item);
            lua.lua_rawseti(state, -2, index + 1);
        }
        return 1;
    });
    lua.lua_setfield(L, diagIndex, to_luastring('get'));

    lua.lua_pushjsfunction(L, (state: lua_State) => {
        const ctx = context(callbacks);
        lua.lua_pushinteger(
            state,
            ctx ? ctx.providers.diagnostics(ctx.view).length : 0,
        );
        return 1;
    });
    lua.lua_setfield(L, diagIndex, to_luastring('count'));

    const jump = (
        state: lua_State,
        forward: boolean,
        count: number,
    ): number => {
        const ctx = context(callbacks);
        const target = ctx
            ? diagnosticTarget(
                  ctx.providers.diagnostics(ctx.view),
                  ctx.view.state.selection.main.head,
                  forward,
                  Math.abs(count),
              )
            : null;
        if (!ctx || !target) {
            lua.lua_pushnil(state);
            return 1;
        }
        callbacks.jumpTo(ctx.view, target.from);
        pushDiagnostic(state, ctx.view, target);
        return 1;
    };

    lua.lua_pushjsfunction(L, (state: lua_State) =>
        jump(state, true, readCount(state, 1, 1)),
    );
    lua.lua_setfield(L, diagIndex, to_luastring('goto_next'));
    lua.lua_pushjsfunction(L, (state: lua_State) =>
        jump(state, false, readCount(state, 1, 1)),
    );
    lua.lua_setfield(L, diagIndex, to_luastring('goto_prev'));
    lua.lua_pushjsfunction(L, (state: lua_State) => {
        const count = readCount(state, 1, 1);
        return jump(state, count >= 0, count);
    });
    lua.lua_setfield(L, diagIndex, to_luastring('jump'));

    lua.lua_newtable(L);
    for (const [name, value] of [
        ['ERROR', SEVERITY.error],
        ['WARN', SEVERITY.warning],
        ['INFO', SEVERITY.info],
        ['HINT', SEVERITY.hint],
    ] as const) {
        lua.lua_pushinteger(L, value);
        lua.lua_setfield(L, -2, to_luastring(name));
    }
    lua.lua_setfield(L, diagIndex, to_luastring('severity'));

    lua.lua_pushvalue(L, diagIndex);
    lua.lua_setfield(L, vimIndex, to_luastring('diagnostic'));
    lua.lua_pop(L, 2);
}
