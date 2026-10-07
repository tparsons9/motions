import { registerViewKeyTarget } from './view-key-targets';
import type {
    MotionsViewApi,
    MotionsViewScopeDef,
    MotionsViewScope,
    MotionsViewInstance,
    MotionsViewActionDef,
    MotionsViewMapping,
    MotionsViewGroup,
    MotionsActionContext,
    MotionsBufferContext,
} from './view-api-types';
import { ViewRouter } from './view-router';
import { tokenizeKeys } from './view-keys';
import { viewScopes } from './view-scopes';
import { ViewWhichKey } from './view-which-key';
import { runCleanups } from '../util/cleanup';

export interface ViewApiHooks {
    leader(): string;
    timeout(): number;
    hints(): {
        enabled: boolean;
        delay: number;
        order: 'which-key' | 'groups-first';
    };
    setMode(mode: string | null, label?: string): void;
    globalMappings(modes: string[]): MotionsViewMapping[];
    runGlobal(key: string, count: number): void;
}

export class ViewApi implements MotionsViewApi {
    readonly apiVersion = 1 as const;
    private actions = new Map<string, MotionsViewActionDef>();
    private contexts = new Map<
        string,
        (path: string) => MotionsBufferContext | null
    >();
    private scopes = new Map<string, MotionsViewScope>();
    private active: MotionsActionContext | null = null;
    constructor(private hooks: ViewApiHooks) {}
    getLeaderKey(): string {
        return this.hooks.leader();
    }
    registerAction(def: MotionsViewActionDef): () => void {
        this.actions.set(def.id, def);
        return () => {
            if (this.actions.get(def.id) === def) this.actions.delete(def.id);
        };
    }
    listActions(prefix = ''): Array<{ id: string; desc: string }> {
        return [...this.actions.values()]
            .filter((a) => a.id.startsWith(prefix))
            .map(({ id, desc }) => ({ id, desc }));
    }
    async runAction(
        id: string,
        args: Record<string, unknown> = {},
    ): Promise<unknown> {
        const action = this.actions.get(id);
        if (!action) throw new Error(`Unknown view action: ${id}`);
        return action.run(
            args,
            this.active ?? {
                count: 0,
                mode: '',
                keys: [],
                scope: '',
                instance: null,
            },
        );
    }
    registerBufferContext(
        name: string,
        resolve: (path: string) => MotionsBufferContext | null,
    ): () => void {
        this.contexts.set(name, resolve);
        return () => {
            if (this.contexts.get(name) === resolve) this.contexts.delete(name);
        };
    }
    context(name: string, path: string): MotionsBufferContext | null {
        return this.contexts.get(name)?.(path) ?? null;
    }
    registerScope(def: MotionsViewScopeDef): MotionsViewScope {
        this.scopes.get(def.id)?.dispose();
        const instances = new Set<MotionsViewInstance>();
        const scope: MotionsViewScope = {
            attach: (options) => {
                const containerEl = options.containerEl;
                const isFocused = () => options.isFocused();
                let mode = def.defaultMode;
                let focused = isFocused();
                let detached = false;
                const dynamic = new Map<
                    string,
                    {
                        mappings: MotionsViewMapping[];
                        groups: MotionsViewGroup[];
                    }
                >();
                const overlay = new ViewWhichKey(containerEl);
                const releaseKeyTarget = registerViewKeyTarget(containerEl);
                const modeDef = () => def.modes.find((m) => m.id === mode);
                const display = () => {
                    const hints = this.hooks.hints();
                    if (
                        !focused ||
                        !hints.enabled ||
                        (!router.pendingKeys.length &&
                            modeDef()?.whichKey !== 'immediate')
                    ) {
                        overlay.hide();
                        return;
                    }
                    overlay.show(
                        `${def.name} · ${modeDef()?.label ?? mode}${router.pendingKeys.length ? ` · ${router.pendingKeys.join('')}` : ''}`,
                        router.completions(mode),
                        modeDef()?.whichKey === 'immediate' ? 0 : hints.delay,
                        hints.order,
                    );
                };
                const router = new ViewRouter(
                    {
                        pending: display,
                        run: (mapping, count, keys) => {
                            this.active = {
                                scope: def.id,
                                instance,
                                mode,
                                count,
                                keys,
                            };
                            if (mapping.action.startsWith('view.global:'))
                                this.hooks.runGlobal(
                                    mapping.action.slice(12),
                                    count,
                                );
                            else {
                                try {
                                    this.actions
                                        .get(mapping.action)
                                        ?.run(mapping.args ?? {}, this.active);
                                } catch (error) {
                                    console.error(
                                        'Vim Motions: view action failed',
                                        error,
                                    );
                                }
                            }
                            display();
                        },
                    },
                    this.hooks.timeout(),
                    (id) => def.modes.find((m) => m.id === id) ?? {},
                );
                const refresh = () => {
                    router.cancel();
                    router.setLeader(this.hooks.leader());
                    router.setTimeoutMs(this.hooks.timeout());
                    router.setLayer(
                        'defaults',
                        [
                            ...(def.fallthroughGlobal
                                ? this.hooks
                                      .globalMappings(
                                          def.modes
                                              .filter(
                                                  (m) =>
                                                      m.fallthroughGlobal !==
                                                      false,
                                              )
                                              .map((m) => m.id),
                                      )
                                      .flatMap((mapping) => {
                                          // ZotFlow: scope actions own their prefixes;
                                          // global continuations must not delay them.
                                          const tokens = tokenizeKeys(
                                              mapping.lhs,
                                              this.hooks.leader(),
                                          );
                                          const modes = mapping.modes.filter(
                                              (id) =>
                                                  !def.mappings.some(
                                                      (local) => {
                                                          if (
                                                              !local.modes.includes(
                                                                  id,
                                                              )
                                                          )
                                                              return false;
                                                          const prefix =
                                                              tokenizeKeys(
                                                                  local.lhs,
                                                                  this.hooks.leader(),
                                                              );
                                                          return (
                                                              prefix.length <=
                                                                  tokens.length &&
                                                              prefix.every(
                                                                  (key, i) =>
                                                                      key ===
                                                                      tokens[i],
                                                              )
                                                          );
                                                      },
                                                  ),
                                          );
                                          return modes.length
                                              ? [{ ...mapping, modes }]
                                              : [];
                                      })
                                : []),
                            ...def.mappings,
                        ],
                        def.groups,
                    );
                    router.setLayer(
                        'labels',
                        [...dynamic.values()].flatMap((l) => l.mappings),
                        [...dynamic.values()].flatMap((l) => l.groups),
                    );
                    const user = viewScopes.resolve(def.id);
                    router.setRemoved(user.removed);
                    router.setLayer('user', user.mappings, user.groups);
                    display();
                };
                const unsubscribe = viewScopes.subscribe(refresh);
                const instance: MotionsViewInstance = {
                    get mode() {
                        return mode;
                    },
                    handleKey: (token) => {
                        if (detached) return 'unhandled';
                        // ZotFlow: forwarding an iframe key is proof of focus.
                        instance.setFocused(true);
                        if (
                            token === '?' &&
                            (router.pendingKeys.length ||
                                modeDef()?.whichKey === 'immediate')
                        ) {
                            overlay.toggleDetails();
                            display();
                            return 'consumed';
                        }
                        router.setTimeoutMs(this.hooks.timeout());
                        return router.handle(token, mode);
                    },
                    setMode: (id, label) => {
                        router.cancel();
                        mode = id;
                        if (focused)
                            this.hooks.setMode(id, label ?? modeDef()?.label);
                        display();
                    },
                    setLayer: (name, mappings, groups = []) => {
                        dynamic.set(name, { mappings, groups });
                        refresh();
                    },
                    cancel: () => {
                        router.cancel();
                        overlay.hide();
                    },
                    setFocused: (value) => {
                        focused = value;
                        if (value) {
                            this.active = {
                                scope: def.id,
                                instance,
                                mode,
                                count: 0,
                                keys: [],
                            };
                            this.hooks.setMode(mode, modeDef()?.label);
                            display();
                        } else {
                            router.cancel();
                            overlay.hide();
                            if (this.active?.instance === instance) {
                                this.active = null;
                                this.hooks.setMode(null);
                            }
                        }
                    },
                    detach: () => {
                        if (detached) return;
                        detached = true;
                        instance.setFocused(false);
                        unsubscribe();
                        releaseKeyTarget();
                        router.dispose();
                        overlay.destroy();
                        instances.delete(instance);
                    },
                };
                instances.add(instance);
                refresh();
                instance.setFocused(focused);
                return instance;
            },
            dispose: () => {
                runCleanups(
                    [...instances].map((instance) => () => instance.detach()),
                    'view scope',
                );
                if (this.scopes.get(def.id) === scope)
                    this.scopes.delete(def.id);
            },
        };
        this.scopes.set(def.id, scope);
        return scope;
    }
    dispose(): void {
        runCleanups(
            [...this.scopes.values()].map((scope) => () => scope.dispose()),
            'view API',
        );
        this.actions.clear();
        this.contexts.clear();
    }
}

let installed: ViewApi | null = null;
export function getViewApi(): ViewApi | null {
    return installed;
}
export function installViewApi(hooks: ViewApiHooks): void {
    uninstallViewApi();
    installed = new ViewApi(hooks);
    const win = window as unknown as { VimMotions?: Record<string, unknown> };
    win.VimMotions ??= {};
    win.VimMotions.view = installed;
    window.dispatchEvent(new CustomEvent('vim-motions:view-api-ready'));
}
export function uninstallViewApi(): void {
    if (!installed) return;
    const api = installed;
    installed = null;
    const win = window as unknown as { VimMotions?: Record<string, unknown> };
    if (win.VimMotions?.view === api) delete win.VimMotions.view;
    window.dispatchEvent(new CustomEvent('vim-motions:view-api-unload'));
    api.dispose();
}
