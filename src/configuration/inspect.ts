import { Platform, type App } from 'obsidian';
import type { VimApi } from '../types/vim-api';
import type { BufferKeymapManager } from '../lua/buffer';
import type { GlobalMappingRegistry } from '../workspace/global-mapping-registry';
import { normalizeKeys, type ConfigurationTracker } from './tracker';
import { definitions } from './definitions';
import type { ConfigurationApi, MappingRecord } from './types';

interface InspectionHooks {
    backend(): string;
    vim(): VimApi | null;
    buffers(): BufferKeymapManager | null;
    workspace(): GlobalMappingRegistry | null;
}
interface Hotkey {
    modifiers: string[];
    key: string;
}
/** Capability-checked internal adapter; unavailable hotkeys are reported, never guessed. */
function hostHotkeys(app: App): { name: string; keys: string }[] | null {
    const host = app as App & {
        commands?: {
            commands?: Record<string, { name: string; hotkeys?: Hotkey[] }>;
        };
        hotkeyManager?: {
            customKeys?: Record<string, Hotkey[]>;
            defaultKeys?: Record<string, Hotkey[]>;
        };
    };
    const commands = host.commands?.commands,
        manager = host.hotkeyManager;
    if (!commands || !manager?.customKeys || !manager.defaultKeys) return null;
    const mac = Platform.isMacOS || Platform.isIosApp;
    const result: { name: string; keys: string }[] = [];
    for (const [id, command] of Object.entries(commands)) {
        const hotkeys =
            manager.customKeys[id] ??
            manager.defaultKeys[id] ??
            command.hotkeys ??
            [];
        for (const hotkey of hotkeys) {
            const modifiers = new Set(
                hotkey.modifiers.map((m) =>
                    m === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : m,
                ),
            );
            const prefix = [
                ['Ctrl', 'C'],
                ['Alt', 'A'],
                ['Meta', 'M'],
                ['Shift', 'S'],
            ]
                .filter(([m]) => modifiers.has(m!))
                .map(([, m]) => m)
                .join('-');
            const key =
                (
                    {
                        ' ': 'Space',
                        Enter: 'CR',
                        Escape: 'Esc',
                        Backspace: 'BS',
                        Delete: 'Del',
                    } as Record<string, string>
                )[hotkey.key] ?? hotkey.key;
            result.push({
                name: command.name,
                keys: normalizeKeys(
                    prefix
                        ? `<${prefix}-${key}>`
                        : key.length > 1
                          ? `<${key}>`
                          : key,
                ),
            });
        }
    }
    return result;
}
export function annotateMappings(
    mappings: MappingRecord[],
    hotkeys: { name: string; keys: string }[] | null,
): MappingRecord[] {
    for (const mapping of mappings) {
        if (
            mapping.scope === 'global' &&
            mappings.some(
                (other) =>
                    other.scope === 'buffer' &&
                    other.keys === mapping.keys &&
                    other.mode === mapping.mode,
            )
        )
            mapping.findings.push('Shadowed by buffer-local mapping');
        if (
            mappings.some(
                (other) =>
                    other !== mapping &&
                    other.mode === mapping.mode &&
                    other.keys.startsWith(mapping.keys) &&
                    other.keys !== mapping.keys,
            )
        )
            mapping.findings.push(
                'Prefix overlap; resolution depends on timeout and context',
            );
        for (const hotkey of hotkeys ?? [])
            if (mapping.keys.startsWith(hotkey.keys))
                mapping.findings.push(
                    `Potential Obsidian shortcut overlap: ${hotkey.name}`,
                );
    }
    return mappings;
}
export function createConfigurationApi(
    app: App,
    tracker: ConfigurationTracker,
    hooks: InspectionHooks,
): ConfigurationApi {
    return Object.freeze({
        apiVersion: 1 as const,
        definitions: () => ({ ...definitions }),
        subscribe: (callback: () => void) => tracker.subscribe(callback),
        snapshot(buffer?: string) {
            const backend = hooks.backend();
            if (tracker.closed)
                return {
                    ...tracker.state(),
                    backend: 'unavailable',
                    mappings: [],
                };
            if (backend !== 'bundled')
                return {
                    ...tracker.state(),
                    backend,
                    status: 'Mapping inspection requires bundled Motions',
                    mappings: [],
                };
            const vim = hooks.vim(),
                buffers = hooks.buffers();
            const observed = tracker.records(buffer),
                mappings: MappingRecord[] = [];
            const collect = () => {
                for (const mode of [
                    'normal',
                    'insert',
                    'visual',
                    'operatorPending',
                ]) {
                    for (const map of vim?.getKeymap(mode) ?? []) {
                        if (map.context && map.context !== mode) continue;
                        const keys = normalizeKeys(map.keys);
                        if (
                            mappings.some(
                                (item) =>
                                    item.keys === keys && item.mode === mode,
                            )
                        )
                            continue;
                        const overlay = buffers
                            ?.getMaps(buffers.getActiveBuffer())
                            .find(
                                (item) =>
                                    item.mode === mode &&
                                    normalizeKeys(item.lhs) === keys,
                            );
                        if (overlay && buffers?.getActiveBuffer() !== buffer)
                            continue;
                        const known = observed.find(
                            (item) =>
                                !item.buffer &&
                                item.mode === mode &&
                                item.keys === keys,
                        );
                        const action =
                            map.toKeys ??
                            map.action ??
                            map.motion ??
                            map.operator ??
                            map.type;
                        const matches =
                            known &&
                            (known.action === action ||
                                (known.action === 'Lua callback' &&
                                    String(action).startsWith('lua-action-')));
                        mappings.push(
                            (matches ? known : undefined) ?? {
                                keys,
                                mode,
                                scope: 'global',
                                action:
                                    map.toKeys ??
                                    map.action ??
                                    map.motion ??
                                    map.operator ??
                                    map.type,
                                origin: 'Engine or Vimrc',
                                findings: [],
                            },
                        );
                    }
                }
            };
            // Reading the shared table must not suspend/reapply overlays: that mutates editing state.
            collect();
            for (const map of buffers?.getMaps(buffer ?? null) ?? []) {
                const keys = normalizeKeys(map.lhs),
                    known = observed.find(
                        (item) =>
                            item.buffer === buffer &&
                            item.mode === map.mode &&
                            item.keys === keys,
                    );
                const index = mappings.findIndex(
                    (item) => item.keys === keys && item.mode === map.mode,
                );
                if (buffers?.getActiveBuffer() === buffer && index >= 0)
                    mappings.splice(index, 1);
                const shared = observed.find(
                    (item) =>
                        !item.buffer &&
                        item.mode === map.mode &&
                        item.keys === keys,
                );
                if (
                    shared &&
                    !mappings.some(
                        (item) =>
                            item.keys === keys &&
                            item.mode === map.mode &&
                            item.scope === 'global',
                    )
                )
                    mappings.push(shared);
                mappings.push(
                    known ?? {
                        keys,
                        mode: map.mode,
                        scope: 'buffer',
                        buffer,
                        action: map.rhs ?? 'Lua callback',
                        origin: 'Lua',
                        findings: [],
                    },
                );
            }
            for (const entry of hooks.workspace()?.getAllEntries() ?? []) {
                const known = observed.find(
                    (item) =>
                        item.mode === 'workspace' &&
                        item.keys === normalizeKeys(entry.keys),
                );
                mappings.push({
                    keys: normalizeKeys(entry.keys),
                    mode: 'workspace',
                    scope: entry.gate,
                    action:
                        entry.action.type === 'obcommand'
                            ? entry.action.commandId
                            : entry.action.type === 'ex'
                              ? entry.action.command
                              : (entry.name ?? 'Built-in action'),
                    description: entry.label,
                    origin: known?.origin ?? entry.source,
                    path: known?.path,
                    line: known?.line,
                    findings: known?.findings ?? [],
                });
            }
            const hotkeys = hostHotkeys(app),
                state = tracker.state();
            return {
                ...state,
                backend,
                status:
                    state.status +
                    (hotkeys
                        ? ''
                        : ' · Obsidian shortcut inspection unavailable'),
                mappings: annotateMappings(mappings.slice(0, 5000), hotkeys),
                truncated: state.truncated || mappings.length > 5000,
            };
        },
    });
}
