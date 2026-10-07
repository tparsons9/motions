import { lua, lauxlib, to_luastring, to_jsstring } from '../lib/fengari';
import type { lua_State } from '../lib/fengari';
import { pushLuaAny, readLuaString } from '../lua/api';
import type { VimApiCallbacks } from '../lua/api';
import {
    registerStateCleanup,
    withInstructionGuard,
    CALLBACK_INSTRUCTION_LIMIT,
} from '../lua/engine';
import { getViewApi } from './view-api';
import { viewScopes } from './view-scopes';
import type { MotionsViewActionDef, MotionsViewGroup } from './view-api-types';
import { runCleanups } from '../util/cleanup';

function readValue(L: lua_State, index: number, depth = 0): unknown {
    if (depth > 12) return null;
    if (lua.lua_isstring(L, index) && !lua.lua_isnumber(L, index))
        return readLuaString(L, index);
    if (lua.lua_isnumber(L, index)) return lua.lua_tonumber(L, index);
    if (lua.lua_isboolean(L, index)) return lua.lua_toboolean(L, index);
    if (!lua.lua_istable(L, index)) return null;
    const abs = lua.lua_absindex(L, index);
    const result: Record<string, unknown> = {};
    lua.lua_pushnil(L);
    while (lua.lua_next(L, abs)) {
        // Do not stringify the live numeric iterator key (Lua mutates its type).
        const key =
            lua.lua_type(L, -2) === lua.LUA_TNUMBER
                ? String(lua.lua_tonumber(L, -2))
                : readLuaString(L, -2);
        if (key) result[key] = readValue(L, -1, depth + 1);
        lua.lua_pop(L, 1);
    }
    return result;
}
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}
function modes(L: lua_State, index: number): string[] {
    const value = readValue(L, index);
    return typeof value === 'string'
        ? [value]
        : Object.values(record(value)).filter(
              (v): v is string => typeof v === 'string',
          );
}

let nextOwnerId = 0;

/** Function refs, queued mappings and action registrations share the Lua state's lifetime. */
export function injectViewLuaApi(
    L: lua_State,
    vimIndex: number,
    callbacks: VimApiCallbacks,
): void {
    const ownerId = ++nextOwnerId;
    const owner = Symbol('view Lua config');
    const refs = new Set<number>();
    const actions = new Map<string, MotionsViewActionDef>();
    let disposers: Array<() => void> = [];
    const bind = () => {
        runCleanups(disposers, 'Lua view actions');
        disposers = [];
        const api = getViewApi();
        if (api)
            for (const def of actions.values())
                disposers.push(api.registerAction(def));
    };
    window.addEventListener?.('vim-motions:view-api-ready', bind);
    registerStateCleanup(L, () => {
        window.removeEventListener?.('vim-motions:view-api-ready', bind);
        viewScopes.clear(owner);
        runCleanups(disposers, 'Lua view actions');
        for (const ref of refs)
            lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
        refs.clear();
        actions.clear();
    });
    lua.lua_getfield(L, vimIndex, to_luastring('ob'));
    const ob = lua.lua_gettop(L);
    const fn = (
        table: number,
        name: string,
        callback: (state: lua_State) => number,
    ) => {
        lua.lua_pushjsfunction(L, callback);
        lua.lua_setfield(L, table, to_luastring(name));
    };
    lua.lua_newtable(L);
    const view = lua.lua_gettop(L);
    lua.lua_newtable(L);
    const keymap = lua.lua_gettop(L);
    fn(keymap, 'set', (state) => {
        const scope = readLuaString(state, 1);
        const modeList = modes(state, 2);
        const lhs = readLuaString(state, 3);
        if (!scope || !lhs || !modeList.length)
            return lauxlib.luaL_error(
                state,
                to_luastring('view.keymap.set requires scope, modes and lhs'),
            );
        const options = record(readValue(state, 5));
        let action = readLuaString(state, 4);
        if (lua.lua_isfunction(state, 4)) {
            lua.lua_pushvalue(state, 4);
            const ref = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
            refs.add(ref);
            action = `view.lua:${ownerId}:${ref}:${actions.size}`;
            actions.set(action, {
                id: action,
                desc: typeof options.desc === 'string' ? options.desc : lhs,
                run: (args, ctx) => {
                    const top = lua.lua_gettop(L);
                    try {
                        withInstructionGuard(
                            L,
                            CALLBACK_INSTRUCTION_LIMIT,
                            () => {
                                lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
                                pushLuaAny(L, args);
                                pushLuaAny(L, {
                                    count: ctx.count,
                                    mode: ctx.mode,
                                    scope: ctx.scope,
                                });
                                if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK)
                                    throw new Error(
                                        to_jsstring(
                                            lua.lua_tolstring(L, -1) ??
                                                to_luastring(
                                                    'View callback failed',
                                                ),
                                        ),
                                    );
                                return 0;
                            },
                        );
                    } finally {
                        lua.lua_settop(L, top);
                    }
                },
            });
            bind();
        }
        if (!action)
            return lauxlib.luaL_error(
                state,
                to_luastring(
                    'view.keymap.set requires an action id or function',
                ),
            );
        viewScopes.set(owner, scope, {
            modes: modeList,
            lhs,
            action,
            args: record(options.args),
            desc: typeof options.desc === 'string' ? options.desc : undefined,
            color:
                typeof options.color === 'string' ? options.color : undefined,
            detail:
                typeof options.detail === 'string' ? options.detail : undefined,
            icon: typeof options.icon === 'string' ? options.icon : undefined,
        });
        return 0;
    });
    fn(keymap, 'del', (state) => {
        viewScopes.del(
            owner,
            readLuaString(state, 1) ?? '',
            modes(state, 2),
            readLuaString(state, 3) ?? '',
        );
        return 0;
    });
    lua.lua_setfield(L, view, to_luastring('keymap'));
    lua.lua_newtable(L);
    fn(lua.lua_gettop(L), 'add', (state) => {
        const scope = readLuaString(state, 1) ?? '';
        const groups: MotionsViewGroup[] = Object.values(
            record(readValue(state, 2)),
        ).map((value) => {
            const g = record(value);
            return {
                lhs: typeof g['1'] === 'string' ? g['1'] : '',
                modes:
                    typeof g.mode === 'string'
                        ? [g.mode]
                        : Object.values(record(g.mode)).filter(
                              (v): v is string => typeof v === 'string',
                          ),
                label: typeof g.group === 'string' ? g.group : '',
                color: typeof g.color === 'string' ? g.color : undefined,
                detail: typeof g.detail === 'string' ? g.detail : undefined,
            };
        });
        viewScopes.groups(owner, scope, groups);
        return 0;
    });
    lua.lua_setfield(L, view, to_luastring('whichkey'));
    lua.lua_setfield(L, ob, to_luastring('view'));
    lua.lua_newtable(L);
    const actionTable = lua.lua_gettop(L);
    fn(actionTable, 'run', (state) => {
        const api = getViewApi();
        if (api)
            void api
                .runAction(
                    readLuaString(state, 1) ?? '',
                    record(readValue(state, 2)),
                )
                .catch((error: unknown) =>
                    console.error('Vim Motions: action failed', error),
                );
        return 0;
    });
    fn(actionTable, 'list', (state) => {
        pushLuaAny(
            state,
            getViewApi()?.listActions(readLuaString(state, 1) ?? '') ?? [],
        );
        return 1;
    });
    lua.lua_setfield(L, ob, to_luastring('actions'));
    fn(ob, 'context', (state) => {
        pushLuaAny(
            state,
            getViewApi()?.context(
                readLuaString(state, 1) ?? '',
                callbacks.getActiveFilePath?.() ?? '',
            ) ?? null,
        );
        return 1;
    });
    lua.lua_pop(L, 1);
}
