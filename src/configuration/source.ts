import { lua, lauxlib, to_luastring, to_jsstring } from '../lib/fengari';
import type { lua_State } from '../lib/fengari';
import type { ConfigurationTracker } from './tracker';
import type { MappingSource } from './types';
const trackers = new WeakMap<object, ConfigurationTracker>();
export function bindConfiguration(
    L: lua_State,
    tracker?: ConfigurationTracker,
): void {
    if (tracker) trackers.set(L.l_G, tracker);
}
export function compileNamed(
    L: lua_State,
    bytes: Uint8Array,
    name?: string,
): number {
    try {
        if (name?.startsWith('@'))
            trackers.get(L.l_G)?.source(name.slice(1), to_jsstring(bytes));
    } catch {
        /* Source observation cannot change compilation. */
    }
    return lauxlib.luaL_loadbuffer(
        L,
        bytes,
        bytes.length,
        name ? to_luastring(name) : bytes,
    );
}
export function mappingSource(L: lua_State): MappingSource | undefined {
    try {
        const debug = new lua.lua_Debug();
        for (let depth = 1; depth < 12; depth++) {
            if (!lua.lua_getstack(L, depth, debug)) break;
            lua.lua_getinfo(L, to_luastring('Sl'), debug);
            const source = debug.source ? to_jsstring(debug.source) : '';
            if (source.startsWith('@') && debug.currentline > 0)
                return { path: source.slice(1), line: debug.currentline };
        }
    } catch {
        /* Generated or stripped chunks may not have source locations. */
    }
    return undefined;
}
