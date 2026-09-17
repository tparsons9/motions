import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

/**
 * The editor API as a host plugin uses it: a CodeMirror view this suite owns,
 * created the way another plugin would, with no Obsidian editor behind it.
 *
 * The host lives on `window.__vimMotionsHost` so each step can inspect it.
 *
 * Two constraints shape this spec:
 *
 * - CodeMirror reaches plugins through Obsidian's module shim, which the
 *   renderer does not expose to `require()`, so the constructors come from a
 *   live Markdown editor. That is also the point: a host must build on the
 *   same CodeMirror instance Obsidian hands to Vim Motions.
 * - A host editor outside the workspace layout never holds window focus, so
 *   `browser.keys()` would type into the active note instead. Keys go through
 *   the host's own Vim adapter, as `sendVimEscape` does for Markdown views.
 */
const HOST = '__vimMotionsHost';
const SAMPLE = 'def f():\n    return 1\n';

interface HostState {
    doc: string;
    saves: number;
    closes: number;
    attached: boolean;
    isAttached: boolean;
    mode: string;
    modes: string[];
}

async function createHost(): Promise<Record<string, unknown>> {
    return browser.executeObsidian(
        ({ app, obsidian }, key: string, doc: string) => {
            const win = window as unknown as Record<string, unknown>;
            const api = (win.VimMotions as { editor?: unknown } | undefined)
                ?.editor as
                | {
                      apiVersion: number;
                      attach(
                          view: unknown,
                          host: Record<string, unknown>,
                      ): {
                          attached: boolean;
                          detach(): void;
                          getMode(): string;
                          onModeChange(cb: (mode: string) => void): () => void;
                      };
                  }
                | undefined;
            if (!api)
                return { error: 'no editor API: is bundled Vim mode on?' };

            const mdView = app.workspace.getActiveViewOfType(
                obsidian.MarkdownView,
            );
            const sample = (
                mdView?.editor as unknown as { cm?: Record<string, unknown> }
            )?.cm;
            if (!sample)
                return { error: 'no Markdown editor to borrow CM from' };

            const EditorViewCtor = sample.constructor as new (config: {
                parent: HTMLElement;
                state: unknown;
            }) => Record<string, unknown>;
            const EditorStateCtor = (sample.state as { constructor: unknown })
                .constructor as { create(config: { doc: string }): unknown };

            const container = app.workspace.containerEl.createDiv({
                cls: 'vim-motions-e2e-host',
            });
            const editor = new EditorViewCtor({
                parent: container,
                state: EditorStateCtor.create({ doc }),
            });

            const host = {
                editor,
                container,
                saves: 0,
                closes: 0,
                modes: [] as string[],
                handle: null as ReturnType<typeof api.attach> | null,
            };
            host.handle = api.attach(editor, {
                path: 'file:/tmp/e2e/app.py',
                filetype: 'python',
                save: () => {
                    host.saves++;
                    return Promise.resolve();
                },
                close: () => {
                    host.closes++;
                },
            });
            host.handle.onModeChange((mode) => host.modes.push(mode));
            win[key] = host;
            return { apiVersion: api.apiVersion };
        },
        HOST,
        SAMPLE,
    );
}

/** Feeds keys to the host editor through its Vim adapter. */
async function hostKeys(...keys: string[]): Promise<void> {
    await browser.executeObsidian(
        (_ctx, key: string, pressed: string[]) => {
            const host = (window as unknown as Record<string, unknown>)[
                key
            ] as { editor: { cm?: unknown } };
            const Vim = (
                window as unknown as {
                    CodeMirrorAdapter?: {
                        Vim?: {
                            handleKey(
                                cm: unknown,
                                k: string,
                                origin?: string,
                            ): void;
                        };
                    };
                }
            ).CodeMirrorAdapter?.Vim;
            if (!Vim || !host.editor.cm) return;
            for (const k of pressed) Vim.handleKey(host.editor.cm, k, 'user');
        },
        HOST,
        keys,
    );
    await browser.pause(150);
}

/** Runs an ex command in the host editor, bypassing the dialog. */
async function hostEx(command: string): Promise<void> {
    await browser.executeObsidian(
        (_ctx, key: string, input: string) => {
            const host = (window as unknown as Record<string, unknown>)[
                key
            ] as { editor: { cm?: unknown } };
            const Vim = (
                window as unknown as {
                    CodeMirrorAdapter?: {
                        Vim?: { handleEx(cm: unknown, input: string): void };
                    };
                }
            ).CodeMirrorAdapter?.Vim;
            if (Vim && host.editor.cm) Vim.handleEx(host.editor.cm, input);
        },
        HOST,
        command,
    );
    await browser.pause(300);
}

/** Resets the host document so each test starts from a known state. */
async function setDoc(text: string): Promise<void> {
    await browser.executeObsidian(
        (_ctx, key: string, doc: string) => {
            const host = (window as unknown as Record<string, unknown>)[
                key
            ] as {
                editor: {
                    state: { doc: { length: number } };
                    dispatch(spec: unknown): void;
                };
            };
            host.editor.dispatch({
                changes: {
                    from: 0,
                    to: host.editor.state.doc.length,
                    insert: doc,
                },
                selection: { anchor: 0 },
            });
        },
        HOST,
        text,
    );
}

async function hostState(): Promise<HostState> {
    return browser.executeObsidian((_ctx, key: string) => {
        const host = (window as unknown as Record<string, unknown>)[key] as {
            editor: { state: { doc: { toString(): string } } };
            saves: number;
            closes: number;
            modes: string[];
            handle: { attached: boolean; getMode(): string };
        };
        const api = (
            window as unknown as {
                VimMotions?: {
                    editor?: { isAttached(view: unknown): boolean };
                };
            }
        ).VimMotions?.editor;
        return {
            doc: host.editor.state.doc.toString(),
            saves: host.saves,
            closes: host.closes,
            attached: host.handle.attached,
            isAttached: api?.isAttached(host.editor) ?? false,
            mode: host.handle.getMode(),
            modes: [...host.modes],
        };
    }, HOST);
}

async function hostGutters(): Promise<string[]> {
    return browser.executeObsidian((_ctx, key: string) => {
        const host = (window as unknown as Record<string, unknown>)[key] as {
            editor: { dom: HTMLElement };
        };
        return Array.from(host.editor.dom.querySelectorAll('.cm-gutter')).map(
            (el) => el.className,
        );
    }, HOST);
}

describe('Editor provider API', function () {
    before(async function () {
        await browser.reloadObsidian({ vault: 'test-vault' });
        await obsidianPage.openFile('Welcome.md');
        await browser.pause(300);
        const created = await createHost();
        expect(created.error).toBe(undefined);
        expect(created.apiVersion).toBe(1);
        await browser.pause(300);
    });

    after(async function () {
        await browser.executeObsidian((_ctx, key: string) => {
            const win = window as unknown as Record<string, unknown>;
            const host = win[key] as
                | {
                      editor: { destroy(): void };
                      container: HTMLElement;
                      handle: { attached: boolean; detach(): void };
                  }
                | undefined;
            if (host?.handle.attached) host.handle.detach();
            host?.editor.destroy();
            host?.container.remove();
            delete win[key];
        }, HOST);
    });

    it('edits the host editor with Vim', async function () {
        await setDoc(SAMPLE);
        await hostKeys('<Esc>', 'd', 'd');

        const state = await hostState();
        expect(state.attached).toBe(true);
        expect(state.isAttached).toBe(true);
        expect(state.doc).toBe('    return 1\n');
    });

    it('reports insert and normal mode to the host', async function () {
        await hostKeys('i');
        expect((await hostState()).mode).toBe('insert');

        await hostKeys('<Esc>');
        const state = await hostState();
        expect(state.mode).toBe('normal');
        expect(state.modes).toContain('insert');
        expect(state.modes).toContain('normal');
    });

    it('draws its own line numbers when relativenumber is set', async function () {
        const hasVimGutter = (names: string[]) =>
            names.some((name) => name.includes('vim-motions-line-numbers'));
        expect(hasVimGutter(await hostGutters())).toBe(false);

        await hostEx('set relativenumber');
        const withNumbers = await hostGutters();
        await hostEx('set norelativenumber');

        expect(hasVimGutter(withNumbers)).toBe(true);
        expect(hasVimGutter(await hostGutters())).toBe(false);
    });

    it('routes :w and :q to the host', async function () {
        await hostEx('w');
        expect((await hostState()).saves).toBe(1);

        await hostEx('q');
        expect((await hostState()).closes).toBe(1);
    });

    it('keeps Vim attached across a configuration reload', async function () {
        await browser.executeObsidian(({ app }) => {
            (
                app as unknown as {
                    commands: { executeCommandById(id: string): void };
                }
            ).commands.executeCommandById('vim-motions:reload-configuration');
        });
        await browser.pause(1000);

        await setDoc('one\ntwo\n');
        await hostKeys('<Esc>', 'd', 'd');

        const state = await hostState();
        expect(state.attached).toBe(true);
        expect(state.doc).toBe('two\n');
    });

    it('detaches on request, leaving the editor usable', async function () {
        await browser.executeObsidian((_ctx, key: string) => {
            const host = (window as unknown as Record<string, unknown>)[
                key
            ] as { handle: { detach(): void } };
            host.handle.detach();
        }, HOST);
        await browser.pause(200);

        const detached = await hostState();
        expect(detached.attached).toBe(false);
        expect(detached.isAttached).toBe(false);

        await setDoc('after detach');
        await hostKeys('d', 'd');
        expect((await hostState()).doc).toBe('after detach');
    });
});
