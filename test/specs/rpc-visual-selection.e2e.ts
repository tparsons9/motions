import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import { getNotices, loadSingleFileWorkspace, setupEditor } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

/**
 * Neovim's visual selection mirrored into CM6.
 *
 * The bridge used to send a caret and nothing else — `vim_motions_cursor`
 * carries `(buf, row, col)` and `syncCursor()` dispatched `selection: {anchor}`
 * — so CM6's selection was empty in every visual mode and Obsidian had nothing
 * to paint. Neovim's charwise and linewise selections are inclusive of the head
 * character, CM6 ranges are not, so every assertion here pins the converted
 * boundary rather than the raw coordinates.
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
    };
    saveSettings(): Promise<void>;
    reloadFeatures(): void;
    getNeovimConnectionState(): RpcState;
    getExternalVimModeState(): string | null;
    requestNeovim(method: string, args: unknown[]): Promise<unknown>;
}

interface Cm6Selection {
    ranges: { from: number; to: number }[];
    main: { anchor: number; head: number; from: number; to: number };
    empty: boolean;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/init.lua');
const LINE_ONE = 'alpha beta gamma';
const FIXTURE = [LINE_ONE, 'delta epsilon zeta', 'third line here'].join('\n');

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

async function selectedText(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-visual',
            ),
        ].map((span) => span.textContent ?? ''),
    );
}

async function cm6SelectionIsCaret(): Promise<boolean> {
    return browser.executeObsidian(({ app, obsidian }) => {
        const markdown = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
        );
        const view = (
            markdown?.editor as unknown as {
                cm?: {
                    state: {
                        selection: { main: { from: number; to: number } };
                    };
                };
            }
        ).cm;
        if (!view) throw new Error('No active CM6 view');
        const main = view.state.selection.main;
        return main.from === main.to;
    });
}

async function waitForSelectedText(): Promise<string[]> {
    await browser.waitUntil(async () => (await selectedText()).length > 0, {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'a rendered visual selection to appear in CM6',
    });
    return selectedText();
}

async function neovimMode(): Promise<string> {
    const value = (await pluginRequest('nvim_get_mode', [])) as {
        mode?: unknown;
    };
    return typeof value.mode === 'string' ? value.mode : '<none>';
}

async function waitForExternalMode(expected: string): Promise<void> {
    try {
        await browser.waitUntil(
            async () => (await externalMode()) === expected,
            { timeout: 10000, interval: 50 },
        );
    } catch {
        throw new Error(
            `expected the plugin to publish ${expected} mode, but it published ${String(
                await externalMode(),
            )} while Neovim itself reported "${await neovimMode()}"`,
        );
    }
}

async function resetToNormal(): Promise<void> {
    await pluginRequest('nvim_input', ['<Esc>']);
    await pluginRequest('nvim_exec_lua', [
        'vim.api.nvim_buf_set_lines(0, 0, -1, false, ...)',
        [FIXTURE.split('\n')],
    ]);
    await pluginRequest('nvim_win_set_cursor', [0, [1, 0]]);
    await focusEditor();
}

describe('Neovim RPC visual-mode selection', function () {
    this.timeout(180000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadSingleFileWorkspace();
        await setupEditor(FIXTURE, { line: 0, ch: 0 });
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
    });

    beforeEach(async () => resetToNormal());

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

    it('leaves visual mode when Escape is pressed', async () => {
        await dispatchKeys('v');
        await waitForExternalMode('visual');
        await dispatchKeys('<Esc>');
        await waitForExternalMode('normal');
        await expect(await neovimMode()).toBe('n');
    });

    it('keeps the CM6 selection a caret while visual mode is active', async () => {
        await dispatchKeys('v', 'l', 'l');
        await waitForExternalMode('visual');
        await waitForSelectedText();
        // A real CM6 selection makes Obsidian consume Escape before the RPC
        // delegation listener sees it, so visual mode becomes unexitable.
        await expect(await cm6SelectionIsCaret()).toBe(true);
    });

    it('renders a forward charwise selection inclusive of the head character', async () => {
        await dispatchKeys('v', 'l', 'l');
        await waitForExternalMode('visual');
        await expect(await waitForSelectedText()).toEqual(['alp']);
    });

    it('renders a backward charwise selection', async () => {
        await pluginRequest('nvim_win_set_cursor', [0, [1, 4]]);
        await dispatchKeys('v', 'h', 'h');
        await waitForExternalMode('visual');
        await expect(await waitForSelectedText()).toEqual(['pha']);
    });

    it('renders a linewise selection as the whole line', async () => {
        await dispatchKeys('V');
        await waitForExternalMode('visual line');
        await expect(await waitForSelectedText()).toEqual([LINE_ONE]);
    });

    it('extends a linewise selection across lines', async () => {
        await dispatchKeys('V', 'j');
        await waitForExternalMode('visual line');
        await expect(await waitForSelectedText()).toEqual([
            LINE_ONE,
            'delta epsilon zeta',
        ]);
    });

    it('renders a blockwise selection as one range per row', async () => {
        await dispatchKeys('l');
        await browser.keys(['Control', 'v']);
        await dispatchKeys('j', 'l');
        await waitForExternalMode('visual block');
        await expect(await waitForSelectedText()).toEqual(['lp', 'el']);
    });

    it('clears the rendered selection when visual mode exits', async () => {
        await dispatchKeys('v', 'l', 'l');
        await waitForExternalMode('visual');
        await waitForSelectedText();
        await dispatchKeys('<Esc>');
        await waitForExternalMode('normal');
        await browser.waitUntil(
            async () => (await selectedText()).length === 0,
            {
                timeout: 5000,
                interval: 50,
                timeoutMsg:
                    'the rendered visual selection to clear when visual mode exits',
            },
        );
        await expect(await selectedText()).toEqual([]);
    });
});
