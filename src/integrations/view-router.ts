import { tokenizeKeys } from './view-keys';

/**
 * Key-sequence routing for reader vim. A mapping binds an lhs in one or more
 * modes to a named action. Layers merge in precedence order (user over
 * dynamic labels over defaults); the same router logic is used whether or not
 * Motions is installed, so behavior matches across both paths.
 */
import type { MotionsViewMapping, MotionsViewGroup } from './view-api-types';

export type LayerName = 'defaults' | 'labels' | 'user';
const LAYER_ORDER: LayerName[] = ['defaults', 'labels', 'user'];

export type RouteResult = 'consumed' | 'pending' | 'unhandled';

export interface Completion {
    /** The key that continues the current prefix. */
    key: string;
    desc: string;
    isGroup: boolean;
    color?: string;
    detail?: string;
    icon?: string;
}

export interface RouterCallbacks {
    run(mapping: MotionsViewMapping, count: number, keys: string[]): void;
    /** Pending prefix changed ([] when idle). */
    pending(prefix: string[], count: number): void;
}

interface Resolved {
    tokens: string[];
    mapping: MotionsViewMapping;
}

export class ViewRouter {
    private layers: Record<LayerName, MotionsViewMapping[]> = {
        defaults: [],
        labels: [],
        user: [],
    };
    private groupLayers: Record<LayerName, MotionsViewGroup[]> = {
        defaults: [],
        labels: [],
        user: [],
    };
    private removed = new Set<string>();
    private table = new Map<string, Resolved[]>();
    private buffer: string[] = [];
    private countText = '';
    private timer: number | null = null;
    private leader = ' ';

    constructor(
        private callbacks: RouterCallbacks,
        private timeoutMs = 1000,
        private modeOptions: (mode: string) => {
            noCount?: boolean;
            noTimeout?: boolean;
        } = () => ({}),
    ) {}

    setLeader(leader: string) {
        this.leader = leader || ' ';
        this.rebuild();
    }

    setTimeoutMs(ms: number) {
        this.timeoutMs = ms;
    }

    setLayer(
        name: LayerName,
        mappings: MotionsViewMapping[],
        groups: MotionsViewGroup[] = [],
    ) {
        this.layers[name] = mappings;
        this.groupLayers[name] = groups;
        this.rebuild();
    }

    /** User deletion of a default ("<mode>\u0000<lhs>"). */
    setRemoved(keys: Array<{ mode: string; lhs: string }>) {
        this.removed = new Set(
            keys.map(
                (k) =>
                    `${k.mode}\u0000${tokenizeKeys(k.lhs, this.leader).join('')}`,
            ),
        );
        this.rebuild();
    }

    private rebuild() {
        const merged = new Map<string, Resolved>();
        for (const layer of LAYER_ORDER) {
            for (const mapping of this.layers[layer]) {
                const tokens = tokenizeKeys(mapping.lhs, this.leader);
                if (!tokens.length) continue;
                for (const mode of mapping.modes) {
                    const key = `${mode}\u0000${tokens.join('')}`;
                    if (layer !== 'user' && this.removed.has(key)) continue;
                    if (mapping.action === '<nop>' || mapping.action === '') {
                        merged.delete(key);
                        continue;
                    }
                    merged.set(key, { tokens, mapping });
                }
            }
        }
        // The leader opens a menu; a bare leader action must not fire on timeout.
        const leader = tokenizeKeys(this.leader);
        for (const [key, resolved] of merged) {
            if (resolved.tokens.join('') !== leader.join('')) continue;
            const mode = key.slice(0, key.indexOf('\u0000'));
            if (
                [...merged.entries()].some(
                    ([otherKey, other]) =>
                        otherKey.startsWith(`${mode}\u0000`) &&
                        other.tokens.length > leader.length &&
                        leader.every((token, i) => other.tokens[i] === token),
                )
            )
                merged.delete(key);
        }
        this.table.clear();
        for (const [key, resolved] of merged) {
            const mode = key.slice(0, key.indexOf('\u0000'));
            const list = this.table.get(mode) ?? [];
            list.push(resolved);
            this.table.set(mode, list);
        }
    }

    get pendingKeys(): string[] {
        return [...this.buffer];
    }

    get pendingCount(): number {
        return this.countText ? Number.parseInt(this.countText, 10) : 0;
    }

    isIdle(): boolean {
        return !this.buffer.length && !this.countText;
    }

    cancel() {
        this.clearTimer();
        const wasPending = !this.isIdle();
        this.buffer = [];
        this.countText = '';
        if (wasPending) this.callbacks.pending([], 0);
    }

    private clearTimer() {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private candidates(
        mode: string,
        prefix: string[],
    ): { exact: Resolved | null; partial: Resolved[] } {
        let exact: Resolved | null = null;
        const partial: Resolved[] = [];
        for (const resolved of this.table.get(mode) ?? []) {
            const t = resolved.tokens;
            if (t.length < prefix.length) continue;
            let match = true;
            for (let i = 0; i < prefix.length; i++) {
                if (t[i] !== prefix[i]) {
                    match = false;
                    break;
                }
            }
            if (!match) continue;
            if (t.length === prefix.length) exact = resolved;
            else partial.push(resolved);
        }
        return { exact, partial };
    }

    hasMapping(mode: string, token: string): boolean {
        const { exact, partial } = this.candidates(mode, [token]);
        return !!exact || partial.length > 0;
    }

    /** Route one key in a mode. */
    handle(token: string, mode: string): RouteResult {
        this.clearTimer();

        // Counts: 1-9 start a count, 0-9 continue it, unless the key is mapped
        // at the start of a sequence and no count has begun ("0" is a motion).
        if (
            !this.buffer.length &&
            !this.modeOptions(mode).noCount &&
            /^\d$/.test(token)
        ) {
            if (
                this.countText ||
                (token !== '0' && !this.hasMapping(mode, token))
            ) {
                this.countText += token;
                this.callbacks.pending([], this.pendingCount);
                return 'consumed';
            }
        }

        const prefix = [...this.buffer, token];
        const { exact, partial } = this.candidates(mode, prefix);

        if (exact && !partial.length) {
            this.fire(exact, prefix);
            return 'consumed';
        }
        if (partial.length) {
            this.buffer = prefix;
            this.callbacks.pending(this.pendingKeys, this.pendingCount);
            if (exact && !this.modeOptions(mode).noTimeout) {
                this.timer = window.setTimeout(() => {
                    this.timer = null;
                    this.fire(exact, prefix);
                }, this.timeoutMs);
            } else if (!this.modeOptions(mode).noTimeout) {
                this.timer = window.setTimeout(() => {
                    this.timer = null;
                    this.cancel();
                }, this.timeoutMs);
            }
            return 'pending';
        }

        // No match: a dangling prefix is swallowed (Vim discards it); a
        // single unmapped key is left to the reader.
        const hadPrefix = this.buffer.length > 0 || this.countText !== '';
        if (this.buffer.length) {
            // A longer sequence failed, but its prefix may itself be a full match.
            const prior = this.candidates(mode, this.buffer).exact;
            if (prior) {
                const keys = [...this.buffer];
                this.fire(prior, keys);
                return this.handle(token, mode);
            }
        }
        this.cancel();
        return hadPrefix ? 'consumed' : 'unhandled';
    }

    private fire(resolved: Resolved, keys: string[]) {
        const count = this.pendingCount;
        this.buffer = [];
        this.countText = '';
        this.callbacks.pending([], 0);
        this.callbacks.run(resolved.mapping, count, keys);
    }

    /** Continuations of a prefix in a mode, for which-key. */
    completions(mode: string, prefix: string[] = this.buffer): Completion[] {
        const out = new Map<string, Completion>();
        for (const resolved of this.table.get(mode) ?? []) {
            const t = resolved.tokens;
            if (t.length <= prefix.length) continue;
            if (prefix.some((p, i) => t[i] !== p)) continue;
            const key = t[prefix.length]!;
            const isGroup = t.length > prefix.length + 1;
            const existing = out.get(key);
            if (!isGroup) {
                out.set(key, {
                    key,
                    desc: resolved.mapping.desc ?? resolved.mapping.action,
                    isGroup: existing?.isGroup ?? false,
                    color: resolved.mapping.color,
                    detail: resolved.mapping.detail,
                    icon: resolved.mapping.icon,
                });
            } else if (!existing) {
                out.set(key, { key, desc: '', isGroup: true });
            } else {
                existing.isGroup = true;
            }
        }
        // Group labels describe prefixes.
        for (const layer of LAYER_ORDER) {
            for (const group of this.groupLayers[layer]) {
                if (!group.modes.includes(mode)) continue;
                const t = tokenizeKeys(group.lhs, this.leader);
                if (
                    t.length !== prefix.length + 1 ||
                    prefix.some((p, i) => t[i] !== p)
                )
                    continue;
                const entry = out.get(t[prefix.length]!);
                if (!entry) continue;
                entry.isGroup = true;
                entry.desc = group.label;
                entry.color = group.color ?? entry.color;
                entry.detail = group.detail ?? entry.detail;
                entry.icon = group.icon ?? entry.icon;
            }
        }
        for (const entry of out.values()) {
            if (entry.isGroup && !entry.desc) entry.desc = '+more';
        }
        return [...out.values()];
    }

    dispose() {
        this.clearTimer();
    }
}
