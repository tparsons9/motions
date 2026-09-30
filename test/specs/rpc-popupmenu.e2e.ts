import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import { getNotices, loadSingleFileWorkspace, setupEditor } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

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
    requestNeovim(method: string, args: unknown[]): Promise<unknown>;
}

interface PopupSnapshot {
    count: number;
    grid: number | null;
    row: number | null;
    column: number | null;
    left: number | null;
    top: number | null;
    position: string;
    backgroundColor: string;
    items: string[];
    selected: number;
    selectedBackgroundColor: string;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/init.lua');
const INSERT_FIXTURE = 'alpha alpine beta\nal';
// A completion starting far along a proportional line: terminal-cell
// arithmetic and the real glyph run diverge in proportion to the prefix, so a
// short prefix cannot tell a correct anchor from a grid-cell one.
const WIDE_FIXTURE =
    'alpha alpine beta\nthe quick brown fox jumps over the lazy dog al';

function pidIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
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

async function dispatchKeys(...sequences: string[]): Promise<void> {
    await browser.executeObsidian(({ app, obsidian }, tokens: string[]) => {
        const markdown = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
        );
        const contentDOM = (
            markdown?.editor as unknown as { cm?: { contentDOM?: HTMLElement } }
        )?.cm?.contentDOM;
        if (!contentDOM) throw new Error('No active editor contentDOM');
        const KeyboardEventConstructor =
            contentDOM.ownerDocument.defaultView?.KeyboardEvent;
        if (!KeyboardEventConstructor)
            throw new Error('No KeyboardEvent constructor');
        contentDOM.focus();
        for (const token of tokens) {
            const parts = token.startsWith('<') ? [token] : Array.from(token);
            for (const part of parts) {
                const key =
                    part === '<Esc>'
                        ? 'Escape'
                        : part === '<Tab>'
                          ? 'Tab'
                          : part === '<C-n>'
                            ? 'n'
                            : part;
                contentDOM.dispatchEvent(
                    new KeyboardEventConstructor('keydown', {
                        key,
                        ctrlKey: part === '<C-n>',
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        }
    }, sequences);
}

async function resetFixture(): Promise<void> {
    await dispatchKeys('<Esc>');
    await browser.waitUntil(async () => (await popupSnapshot()).count === 0, {
        timeout: 5000,
        interval: 25,
        timeoutMsg: 'RPC popup menu remained before fixture reset',
    });
    await pluginRequest('nvim_buf_set_lines', [
        0,
        0,
        -1,
        true,
        INSERT_FIXTURE.split('\n'),
    ]);
    await pluginRequest('nvim_win_set_cursor', [0, [2, 2]]);
    await pluginRequest('nvim_exec_lua', [
        'vim.o.wildmenu = true; vim.o.wildoptions = "pum"',
        [],
    ]);
}

async function openWildmenu(): Promise<PopupSnapshot> {
    await dispatchKeys(':se', '<Tab>');
    await browser.waitUntil(
        async () => {
            const popup = await popupSnapshot();
            return popup.count === 1 && popup.grid === -1;
        },
        {
            timeout: 5000,
            interval: 25,
            timeoutMsg:
                'command-line :se<Tab> to emit and render an external wildmenu popup',
        },
    );
    return popupSnapshot();
}

async function popupSnapshot(): Promise<PopupSnapshot> {
    return browser.executeObsidian(() => {
        const popup = document.querySelector<HTMLElement>(
            '.vim-motions-rpc-popupmenu',
        );
        const rows = popup
            ? Array.from(
                  popup.querySelectorAll<HTMLElement>(
                      '.vim-motions-rpc-popupmenu-item',
                  ),
              )
            : [];
        const selected = rows.findIndex((row) =>
            row.classList.contains('is-selected'),
        );
        const popupStyle = popup ? getComputedStyle(popup) : null;
        const selectedStyle =
            selected >= 0 ? getComputedStyle(rows[selected]!) : null;
        return {
            count: document.querySelectorAll('.vim-motions-rpc-popupmenu')
                .length,
            grid: popup ? Number(popup.dataset.grid) : null,
            row: popup ? Number(popup.dataset.row) : null,
            column: popup ? Number(popup.dataset.column) : null,
            left: popup ? Number.parseFloat(popup.style.left) : null,
            top: popup ? Number.parseFloat(popup.style.top) : null,
            position: popupStyle?.position ?? '',
            backgroundColor: popupStyle?.backgroundColor ?? '',
            items: rows.map((row) => row.dataset.word ?? ''),
            selected,
            selectedBackgroundColor:
                selectedStyle?.backgroundColor ?? 'rgba(0, 0, 0, 0)',
        };
    });
}

async function cursorAnchor(): Promise<{
    left: number;
    bottom: number;
    lineHeight: number;
}> {
    return browser.executeObsidian(({ app, obsidian }) => {
        const markdown = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
        );
        const view = (
            markdown?.editor as unknown as {
                cm?: {
                    dom: HTMLElement;
                    defaultLineHeight: number;
                    state: { selection: { main: { head: number } } };
                    coordsAtPos(pos: number): {
                        left: number;
                        bottom: number;
                    } | null;
                };
            }
        ).cm;
        if (!view) throw new Error('No active CM6 view');
        const coords = view.coordsAtPos(view.state.selection.main.head);
        if (!coords) throw new Error('No cursor coordinates');
        const viewRect = view.dom.getBoundingClientRect();
        return {
            left: coords.left - viewRect.left,
            bottom: coords.bottom - viewRect.top,
            lineHeight: view.defaultLineHeight,
        };
    });
}

describe('Neovim RPC popup menu', function () {
    this.timeout(120000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadSingleFileWorkspace();
        await setupEditor(INSERT_FIXTURE, { line: 1, ch: 2 });
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
    });

    beforeEach(async () => resetFixture());

    afterEach(async () => {
        if ((await getRpcState()).connected) await dispatchKeys('<Esc>');
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

    it('renders insert completion anchored at the cursor', async () => {
        await dispatchKeys('i', '<C-n>');
        await browser.waitUntil(
            async () => {
                const popup = await popupSnapshot();
                return popup.count === 1 && popup.items.length >= 2;
            },
            {
                timeout: 5000,
                interval: 25,
                timeoutMsg:
                    'insert-mode <C-n> completion to render at least two popup-menu items',
            },
        );
        const popup = await popupSnapshot();
        if (popup.column === null || popup.row === null)
            throw new Error('Popup menu has no Neovim grid coordinates');
        const cursor = await cursorAnchor();
        await expect(popup.grid).toBe(1);
        await expect(popup.items).toContain('alpha');
        await expect(popup.items).toContain('alpine');
        await expect(popup.selected).toBe(0);
        await expect(popup.position).toBe('absolute');
        await expect(popup.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        await expect(popup.selectedBackgroundColor).not.toBe(
            'rgba(0, 0, 0, 0)',
        );
        await expect(Math.abs(popup.left! - cursor.left)).toBeLessThan(24);
        await expect(Math.abs(popup.top! - cursor.bottom)).toBeLessThan(
            cursor.lineHeight * 1.5,
        );
    });

    it('anchors insert completion at the real cursor, not at a terminal grid cell', async () => {
        await pluginRequest('nvim_buf_set_lines', [
            0,
            0,
            -1,
            true,
            WIDE_FIXTURE.split('\n'),
        ]);
        await pluginRequest('nvim_win_set_cursor', [
            0,
            [2, WIDE_FIXTURE.split('\n')[1]!.length],
        ]);
        await dispatchKeys('a', '<C-n>');
        await browser.waitUntil(
            async () => (await popupSnapshot()).count === 1,
            {
                timeout: 5000,
                interval: 25,
                timeoutMsg: 'insert completion to render a popup menu',
            },
        );
        const popup = await popupSnapshot();
        const cursor = await cursorAnchor();
        if (popup.left === null || popup.top === null)
            throw new Error('Popup menu has no resolved position');

        // The popup belongs to the completion the cursor is sitting in, so it
        // has to track the cursor's measured position. Terminal-cell
        // arithmetic drifts further the longer the preceding text is.
        await expect(Math.abs(popup.left - cursor.left)).toBeLessThan(24);
        await expect(Math.abs(popup.top - cursor.bottom)).toBeLessThan(
            cursor.lineHeight * 1.5,
        );
    });

    it('renders command-line wildmenu completion with its first item selected', async () => {
        const popup = await openWildmenu();
        await expect(popup.items.length).toBeGreaterThan(1);
        await expect(popup.selected).toBe(0);
        await expect(popup.position).toBe('absolute');
        await expect(popup.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        await expect(popup.selectedBackgroundColor).not.toBe(
            'rgba(0, 0, 0, 0)',
        );
    });

    it('advances the highlighted wildmenu row on a second Tab', async () => {
        const first = await openWildmenu();
        await expect(first.selected).toBe(0);
        await dispatchKeys('<Tab>');
        await browser.waitUntil(
            async () => (await popupSnapshot()).selected === 1,
            {
                timeout: 5000,
                interval: 25,
                timeoutMsg:
                    'popupmenu_select to advance the highlighted wildmenu row to index 1',
            },
        );
        const second = await popupSnapshot();
        await expect(second.selected).toBe(1);
        await expect(second.selectedBackgroundColor).not.toBe(
            'rgba(0, 0, 0, 0)',
        );
    });

    it('removes the wildmenu DOM when command-line completion is cancelled', async () => {
        await openWildmenu();
        await dispatchKeys('<Esc>');
        await browser.waitUntil(
            async () => (await popupSnapshot()).count === 0,
            {
                timeout: 5000,
                interval: 25,
                timeoutMsg:
                    'popupmenu_hide to remove the command-line wildmenu DOM after Escape',
            },
        );
        await expect((await popupSnapshot()).count).toBe(0);
    });
});
