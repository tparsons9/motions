import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import { getNotices, loadSingleFileWorkspace, setupEditor } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

/**
 * Per-mode cursor shape with the Neovim backend connected and the animated
 * cursor OFF, which is the default and therefore what almost every user sees.
 *
 * The bundled fork draws the visible cursor. While Neovim owns keys the fork's
 * keydown observer returns early, so its own `cm.state.vim` never leaves normal
 * and the shape cannot follow the real mode. The fork's `setExternalCursorMode`
 * override is what closes that, feeding the cursor renderer without touching
 * `cm.state.vim` and redrawing through `requestMeasure` rather than a
 * transaction — both constraints are load-bearing. An earlier host-side attempt
 * that wrote the vim state and dispatched a transaction broke the status bar
 * and the IME composition input; `rpc-lifecycle` and `rpc-ime` are the gate.
 */

interface RpcState {
    connected: boolean;
    pid: number | null;
}

interface RpcPlugin {
    settings: {
        neovimRpcEnabled: boolean;
        neovimBinaryPath: string;
        neovimConfigPath: string;
        animatedCursor: boolean;
    };
    saveSettings(): Promise<void>;
    reloadFeatures(): void;
    getNeovimConnectionState(): RpcState;
    getExternalVimModeState(): string | null;
    requestNeovim(method: string, args: unknown[]): Promise<unknown>;
}

interface CursorRender {
    fatCursors: number;
    shapeClasses: string[];
    caretColor: string;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/init.lua');
const FIXTURE = 'alpha beta gamma\ndelta epsilon';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function pidIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function pluginRequest(
    method: string,
    args: unknown[],
): Promise<unknown> {
    return browser.executeObsidian(
        async ({ app }, rpcMethod: string, rpcArgs: unknown[]) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, RpcPlugin> };
                }
            ).plugins.plugins['vim-motions'];
            if (!plugin) throw new Error('Vim Motions is not loaded');
            return plugin.requestNeovim(rpcMethod, rpcArgs);
        },
        method,
        args,
    );
}

async function setRpcEnabled(enabled: boolean): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, next: boolean, configPath: string) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, RpcPlugin> };
                }
            ).plugins.plugins['vim-motions'];
            if (!plugin) throw new Error('Vim Motions is not loaded');
            plugin.settings.neovimBinaryPath = '';
            plugin.settings.neovimConfigPath = configPath;
            plugin.settings.animatedCursor = false;
            plugin.settings.neovimRpcEnabled = next;
            await plugin.saveSettings();
            plugin.reloadFeatures();
        },
        enabled,
        TEST_CONFIG_PATH,
    );
}

async function getRpcState(): Promise<RpcState> {
    return browser.executeObsidian(({ app }) => {
        const plugin = (
            app as unknown as {
                plugins: { plugins: Record<string, RpcPlugin> };
            }
        ).plugins.plugins['vim-motions'];
        if (!plugin) throw new Error('Vim Motions is not loaded');
        return plugin.getNeovimConnectionState();
    });
}

async function externalMode(): Promise<string | null> {
    return browser.executeObsidian(({ app }) => {
        const plugin = (
            app as unknown as {
                plugins: { plugins: Record<string, RpcPlugin> };
            }
        ).plugins.plugins['vim-motions'];
        if (!plugin) throw new Error('Vim Motions is not loaded');
        return plugin.getExternalVimModeState();
    });
}

async function neovimMode(): Promise<string> {
    const value = (await pluginRequest('nvim_get_mode', [])) as {
        mode?: unknown;
    };
    return typeof value.mode === 'string' ? value.mode : '<none>';
}

async function waitForConnected(): Promise<RpcState> {
    try {
        await browser.waitUntil(async () => (await getRpcState()).connected, {
            timeout: 11000,
            interval: 100,
            timeoutMsg: 'Neovim RPC did not connect',
        });
    } catch {
        throw new Error(
            `Neovim RPC did not connect: ${(await getNotices()).join(' | ')}`,
        );
    }
    return getRpcState();
}

async function focusEditor(): Promise<void> {
    await browser.executeObsidian(({ app, obsidian }) => {
        const markdown = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
        );
        const contentDOM = (
            markdown?.editor as unknown as { cm?: { contentDOM?: HTMLElement } }
        )?.cm?.contentDOM;
        if (!contentDOM) throw new Error('No active editor contentDOM');
        contentDOM.focus();
    });
}

async function dispatchKeys(...tokens: string[]): Promise<void> {
    for (const token of tokens) {
        await browser.keys(token === '<Esc>' ? ['Escape'] : [token]);
    }
}

async function waitForExternalMode(expected: string): Promise<void> {
    try {
        await browser.waitUntil(
            async () => (await externalMode()) === expected,
            { timeout: 10000, interval: 50 },
        );
    } catch {
        // Reporting both makes a stale published mode distinguishable from a
        // key that never reached Neovim; they need different fixes.
        throw new Error(
            `expected the plugin to publish ${expected} mode, but it published ${String(
                await externalMode(),
            )} while Neovim itself reported "${await neovimMode()}"`,
        );
    }
}

/**
 * What the user actually sees. The fork draws a fat cursor for every shape
 * except an insert `bar`, where `measureCursor` returns null and the native
 * caret is revealed by setting `caret-color` instead — so "insert cursor" is
 * the absence of a fat cursor plus a non-transparent caret, not a bar element.
 */
async function cursorRender(): Promise<CursorRender> {
    return browser.executeObsidian(({ app, obsidian }) => {
        const markdown = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
        );
        const contentDOM = (
            markdown?.editor as unknown as { cm?: { contentDOM?: HTMLElement } }
        )?.cm?.contentDOM;
        const cursors = [
            ...document.querySelectorAll<HTMLElement>('.cm-fat-cursor'),
        ];
        return {
            fatCursors: cursors.length,
            shapeClasses: cursors.flatMap((cursor) =>
                [...cursor.classList].filter(
                    (name) =>
                        name.startsWith('cm-cursor-') &&
                        name !== 'cm-cursor-primary' &&
                        name !== 'cm-cursor-secondary',
                ),
            ),
            caretColor: contentDOM
                ? getComputedStyle(contentDOM).caretColor
                : '<no contentDOM>',
        };
    });
}

describe('Neovim RPC per-mode cursor shape', function () {
    this.timeout(180000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadSingleFileWorkspace();
        await setupEditor(FIXTURE, { line: 0, ch: 0 });
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
    });

    beforeEach(async () => {
        await focusEditor();
        await dispatchKeys('<Esc>');
        await waitForExternalMode('normal');
    });

    after(async () => {
        await setRpcEnabled(false);
        if (spawnedPid !== null) {
            await browser.waitUntil(async () => !pidIsAlive(spawnedPid!), {
                timeout: 5000,
                interval: 100,
                timeoutMsg: `Neovim PID ${spawnedPid} survived teardown`,
            });
        }
    });

    it('renders the block cursor while Neovim is in normal mode', async () => {
        const render = await cursorRender();
        await expect(render.fatCursors).toBeGreaterThan(0);
        await expect(render.shapeClasses).toEqual([]);
        await expect(render.caretColor).toBe(TRANSPARENT);
    });

    it('shows the insert caret once Neovim enters insert mode', async () => {
        await dispatchKeys('i');
        await waitForExternalMode('insert');
        await browser.waitUntil(
            async () => (await cursorRender()).caretColor !== TRANSPARENT,
            {
                timeout: 5000,
                interval: 50,
                timeoutMsg:
                    'the insert caret to become visible while Neovim is in insert mode',
            },
        );
        const render = await cursorRender();
        await expect(render.caretColor).not.toBe(TRANSPARENT);
        await expect(render.fatCursors).toBe(0);
    });

    it('returns to the block cursor when Neovim leaves insert mode', async () => {
        await dispatchKeys('i');
        await waitForExternalMode('insert');
        await dispatchKeys('<Esc>');
        await waitForExternalMode('normal');
        await browser.waitUntil(
            async () => (await cursorRender()).fatCursors > 0,
            {
                timeout: 5000,
                interval: 50,
                timeoutMsg:
                    'the rendered cursor to return to the normal block shape',
            },
        );
        const render = await cursorRender();
        await expect(render.fatCursors).toBeGreaterThan(0);
        await expect(render.shapeClasses).toEqual([]);
        await expect(render.caretColor).toBe(TRANSPARENT);
    });

    it('keeps a block cursor and no insert caret in visual mode', async () => {
        await dispatchKeys('v');
        await waitForExternalMode('visual');
        const render = await cursorRender();
        await expect(render.fatCursors).toBeGreaterThan(0);
        await expect(render.caretColor).toBe(TRANSPARENT);
    });

    it('restores the block cursor when the backend disconnects', async () => {
        await dispatchKeys('i');
        await waitForExternalMode('insert');
        await expect((await cursorRender()).caretColor).not.toBe(TRANSPARENT);
        await setRpcEnabled(false);
        await browser.waitUntil(async () => (await externalMode()) === null, {
            timeout: 10000,
            interval: 50,
            timeoutMsg: 'the backend to clear its published mode on disconnect',
        });
        await browser.waitUntil(
            async () => (await cursorRender()).fatCursors > 0,
            {
                timeout: 5000,
                interval: 50,
                timeoutMsg:
                    'the block cursor to come back once the backend disconnects',
            },
        );
        const render = await cursorRender();
        await expect(render.fatCursors).toBeGreaterThan(0);
        await expect(render.shapeClasses).toEqual([]);
        await expect(render.caretColor).toBe(TRANSPARENT);
    });
});
