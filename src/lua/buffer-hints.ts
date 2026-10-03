import type { LuaKeymap } from './api';
import {
    normalizeVimKey,
    type WhichKeyConfig,
    type WhichKeyLabelInfo,
} from '../ui/which-key';

interface Label extends WhichKeyLabelInfo {
    key: string;
    mode?: string;
}
/** Labels are metadata, never registrations in the shared leader registry. */
export class BufferHints {
    private groups = new Map<string, Label[]>();
    private labels = new Map<string, Label[]>();

    set(path: string, group: boolean, label: Label): void {
        const store = group ? this.groups : this.labels;
        const entries = store.get(path) ?? [];
        store.set(path, [
            ...entries.filter(
                (entry) => entry.key !== label.key || entry.mode !== label.mode,
            ),
            label,
        ]);
    }

    release(path: string): void {
        this.groups.delete(path);
        this.labels.delete(path);
    }
    clear(): void {
        this.groups.clear();
        this.labels.clear();
    }

    compose(
        base: WhichKeyConfig,
        path: string | null,
        maps: readonly LuaKeymap[],
        mode: string,
    ): WhichKeyConfig {
        const result = {
            ...base,
            leaderBindings: [...base.leaderBindings],
            groupLabels: new Map(base.groupLabels),
            commandLabels: new Map(base.commandLabels),
        };
        const leader = normalizeVimKey(base.leaderKey);
        for (const map of maps) {
            if (map.mode && map.mode !== mode) continue;
            const key = normalizeVimKey(map.lhs);
            // A local mapping must never inherit a description of the shadowed action.
            result.commandLabels.delete(key);
            if (map.desc) result.commandLabels.set(key, { label: map.desc });
            if (key.startsWith(leader) && key.length > leader.length) {
                const suffix = key.slice(leader.length);
                result.leaderBindings = result.leaderBindings.filter(
                    (binding) => normalizeVimKey(binding.key) !== suffix,
                );
                result.leaderBindings.push({
                    key: suffix,
                    command: map.desc ?? map.rhs ?? 'Lua callback',
                    source: 'user',
                });
            }
        }
        for (const [store, target] of [
            [this.groups, result.groupLabels],
            [this.labels, result.commandLabels],
        ] as const) {
            for (const label of (path ? store.get(path) : []) ?? []) {
                if (!label.mode || label.mode === mode)
                    target.set(normalizeVimKey(label.key), label);
            }
        }
        return result;
    }
}
