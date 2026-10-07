import type { LuaKeymap, LuaGlobalKeymap, VimApiCallbacks } from '../lua/api';
import type { ConfigurationSnapshot, MappingRecord } from './types';
export const normalizeKeys = (keys: string): string =>
    keys
        .replace(/ /g, '<Space>')
        .replace(/<([^>]+)>/g, (_, key: string) => `<${key.toLowerCase()}>`);
/** Observes registrations only. It never installs, removes, or executes a mapping. */
export class ConfigurationTracker {
    generation = 0;
    status = 'Configuration has not loaded';
    truncated = false;
    private maps = new Map<string, MappingRecord>();
    private sources = new Map<string, string>();
    private listeners = new Set<() => void>();
    private queued = false;
    private disposed = false;
    get closed(): boolean {
        return this.disposed;
    }
    release(buffer: string): void {
        for (const [key, map] of this.maps)
            if (map.buffer === buffer) this.maps.delete(key);
        this.changed();
    }
    begin(): void {
        this.generation++;
        this.maps.clear();
        this.sources.clear();
        this.truncated = false;
        this.status = 'Loading configuration';
        this.changed();
    }
    complete(error?: string): void {
        this.status = error
            ? `Configuration failed: ${error}`
            : 'Loaded configuration';
        this.changed();
    }
    source(path: string, text: string): void {
        if (this.sources.has(path)) return;
        if (
            this.sources.size >= 128 ||
            [...this.sources.values()].reduce((n, s) => n + s.length, 0) +
                text.length >
                2 * 1024 * 1024
        ) {
            this.truncated = true;
            return;
        }
        this.sources.set(path, text);
    }
    set(map: LuaKeymap, buffer?: string): void {
        const key = `${buffer ?? ''}:${map.mode}:${normalizeKeys(map.lhs)}`;
        if (!this.maps.has(key) && this.maps.size >= 5000) {
            this.truncated = true;
            return;
        }
        const previous = this.maps.get(key);
        this.maps.set(key, {
            keys: normalizeKeys(map.lhs),
            mode: map.mode,
            scope: buffer ? 'buffer' : 'global',
            buffer,
            action: map.isFn ? 'Lua callback' : (map.rhs ?? ''),
            description: map.desc,
            origin: 'Lua',
            ...map.source,
            findings: previous
                ? [
                      `Replaces earlier mapping${previous.path ? ` at ${previous.path}:${previous.line ?? 1}` : ''}`,
                  ]
                : [],
        });
        this.changed();
    }
    workspace(map: LuaGlobalKeymap): void {
        const key = `workspace:${normalizeKeys(map.lhs)}`;
        if (!this.maps.has(key) && this.maps.size >= 5000) {
            this.truncated = true;
            return;
        }
        const previous = this.maps.get(key);
        this.maps.set(key, {
            keys: normalizeKeys(map.lhs),
            mode: 'workspace',
            scope: 'workspace',
            action: map.rhs,
            description: map.desc,
            origin: 'Lua',
            ...map.source,
            findings: previous ? ['Replaces earlier workspace mapping'] : [],
        });
        this.changed();
    }
    removeWorkspace(lhs: string): void {
        this.maps.delete(`workspace:${normalizeKeys(lhs)}`);
        this.changed();
    }
    delete(mode: string, lhs: string, buffer?: string): void {
        this.maps.delete(`${buffer ?? ''}:${mode}:${normalizeKeys(lhs)}`);
        this.changed();
    }
    records(buffer?: string): MappingRecord[] {
        return [...this.maps.values()]
            .filter((m) => !m.buffer || m.buffer === buffer)
            .map((m) => ({ ...m, findings: [...m.findings] }));
    }
    state(): Pick<
        ConfigurationSnapshot,
        'generation' | 'status' | 'sources' | 'truncated'
    > {
        return {
            generation: this.generation,
            status: this.status,
            sources: [...this.sources].map(([path, text]) => ({ path, text })),
            truncated: this.truncated,
        };
    }
    subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    changed(): void {
        if (this.queued || this.disposed) return;
        this.queued = true;
        queueMicrotask(() => {
            this.queued = false;
            if (!this.disposed)
                for (const listener of this.listeners) {
                    try {
                        listener();
                    } catch {
                        /* Inspection cannot affect execution. */
                    }
                }
        });
    }
    dispose(): void {
        this.disposed = true;
        this.status = 'Motions configuration API unloaded';
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                /* Unloading must remain safe. */
            }
        }
        this.listeners.clear();
        this.sources.clear();
        this.maps.clear();
    }
}
export function observeMappings(
    callbacks: VimApiCallbacks,
    tracker?: ConfigurationTracker,
): VimApiCallbacks {
    if (!tracker) return callbacks;
    const generation = tracker.generation;
    const observe = (fn: () => void) => {
        try {
            if (!tracker.closed && tracker.generation === generation) fn();
        } catch {
            /* Observation must never change Lua behavior. */
        }
    };
    return {
        ...callbacks,
        onGlobalKeymap: (map) => {
            callbacks.onGlobalKeymap?.(map);
            observe(() => tracker.workspace(map));
        },
        onGlobalKeymapDel: (lhs) => {
            callbacks.onGlobalKeymapDel?.(lhs);
            observe(() => tracker.removeWorkspace(lhs));
        },
        onKeymap: (map) => {
            callbacks.onKeymap(map);
            observe(() => tracker.set(map));
        },
        onKeymapDel: (map) => {
            callbacks.onKeymapDel(map);
            observe(() => tracker.delete(map.mode, map.lhs));
        },
        onBufferKeymap: (file, map) => {
            callbacks.onBufferKeymap?.(file, map);
            observe(() => tracker.set(map, file));
        },
        onBufferKeymapDel: (file, mode, lhs) => {
            callbacks.onBufferKeymapDel?.(file, mode, lhs);
            observe(() => tracker.delete(mode, lhs, file));
        },
    };
}
