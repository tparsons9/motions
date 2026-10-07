import { runCleanups } from '../util/cleanup';
import type { MotionsViewMapping, MotionsViewGroup } from './view-api-types';

type UserLayer = {
    scope: string;
    mappings: MotionsViewMapping[];
    groups: MotionsViewGroup[];
    removed: Array<{ mode: string; lhs: string }>;
};
/** Lua layers exist before host scopes do, so plugin load order is irrelevant. */
export class ViewScopes {
    private users = new Map<symbol, UserLayer[]>();
    private listeners = new Set<() => void>();
    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }
    private changed(): void {
        runCleanups(this.listeners, 'view scope listeners');
    }
    private layer(owner: symbol, scope: string): UserLayer {
        const layers = this.users.get(owner) ?? [];
        this.users.set(owner, layers);
        let layer = layers.find((entry) => entry.scope === scope);
        if (!layer) {
            layer = { scope, mappings: [], groups: [], removed: [] };
            layers.push(layer);
        }
        return layer;
    }
    set(owner: symbol, scope: string, mapping: MotionsViewMapping): void {
        const layer = this.layer(owner, scope);
        for (const mode of mapping.modes) {
            layer.mappings = layer.mappings
                .flatMap((m) =>
                    m.lhs === mapping.lhs
                        ? [{ ...m, modes: m.modes.filter((v) => v !== mode) }]
                        : [m],
                )
                .filter((m) => m.modes.length);
            layer.removed = layer.removed.filter(
                (m) => m.lhs !== mapping.lhs || m.mode !== mode,
            );
        }
        layer.mappings.push(mapping);
        this.changed();
    }
    del(owner: symbol, scope: string, modes: string[], lhs: string): void {
        const layer = this.layer(owner, scope);
        layer.mappings = layer.mappings
            .map((m) =>
                m.lhs === lhs
                    ? {
                          ...m,
                          modes: m.modes.filter(
                              (mode) => !modes.includes(mode),
                          ),
                      }
                    : m,
            )
            .filter((m) => m.modes.length);
        for (const mode of modes) layer.removed.push({ mode, lhs });
        this.changed();
    }
    groups(owner: symbol, scope: string, groups: MotionsViewGroup[]): void {
        this.layer(owner, scope).groups.push(...groups);
        this.changed();
    }
    clear(owner: symbol): void {
        this.users.delete(owner);
        this.changed();
    }
    resolve(scope: string): Omit<UserLayer, 'scope'> {
        const layers = [...this.users.values()]
            .flat()
            .filter((layer) => layer.scope === scope);
        return {
            mappings: layers.flatMap((layer) => layer.mappings),
            groups: layers.flatMap((layer) => layer.groups),
            removed: layers.flatMap((layer) => layer.removed),
        };
    }
}
export const viewScopes = new ViewScopes();
