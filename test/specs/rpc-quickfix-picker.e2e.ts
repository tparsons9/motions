import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import { getNotices, loadTwoFileWorkspace } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

/**
 * Neovim's quickfix list surfaced through the Obsidian picker.
 *
 * `getqflist()` returns structured entries rather than screen cells, so it
 * crosses the bridge without any grid reconstruction. This is the one source
 * that `:grep`, `:vimgrep`, `vim.diagnostic.setqflist()` and LSP reference
 * lists all populate, which is why it is worth a source of its own.
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
    requestNeovim(method: string, args: unknown[]): Promise<unknown>;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/init.lua');
const FIRST_FILE = 'Welcome.md';
const SECOND_FILE = 'Target.md';

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

async function seedQuickfix(): Promise<void> {
    await pluginRequest('nvim_exec_lua', [
        `local dir = ...
vim.fn.setqflist({
  { filename = dir .. '/${FIRST_FILE}', lnum = 2, col = 1, text = 'QF first entry', type = 'E' },
  { filename = dir .. '/${SECOND_FILE}', lnum = 1, col = 1, text = 'QF second entry', type = 'W' },
})`,
        [
            await browser.executeObsidian(({ app, obsidian }) => {
                const adapter = app.vault.adapter;
                if (!(adapter instanceof obsidian.FileSystemAdapter))
                    throw new Error('Vault is not filesystem-backed');
                return adapter.getBasePath();
            }),
        ],
    ]);
}

async function openQuickfixPicker(): Promise<void> {
    await browser.executeObsidian(({ app }) => {
        app.commands.executeCommandById('vim-motions:picker-quickfix');
    });
}

async function pickerLabels(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-picker-item .vim-motions-picker-item-label',
            ),
        ].map((element) => element.textContent ?? ''),
    );
}

async function pickerDescriptions(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-picker-item .vim-motions-picker-item-description',
            ),
        ].map((element) => element.textContent ?? ''),
    );
}

async function closePicker(): Promise<void> {
    await browser.executeObsidian(() => {
        document
            .querySelector<HTMLElement>('.vim-motions-picker')
            ?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                }),
            );
    });
    await browser.waitUntil(
        async () =>
            browser.executeObsidian(
                () => !document.querySelector('.vim-motions-picker'),
            ),
        { timeout: 5000, interval: 50, timeoutMsg: 'picker to close' },
    );
}

describe('Neovim RPC quickfix picker source', function () {
    this.timeout(180000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadTwoFileWorkspace(FIRST_FILE, SECOND_FILE, 'first');
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
    });

    afterEach(async () => {
        if (
            await browser.executeObsidian(
                () => !!document.querySelector('.vim-motions-picker'),
            )
        )
            await closePicker();
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

    it('lists Neovim quickfix entries in the picker', async () => {
        await seedQuickfix();
        await openQuickfixPicker();
        await browser.waitUntil(
            async () => (await pickerLabels()).length >= 2,
            {
                timeout: 10000,
                interval: 50,
                timeoutMsg: 'the quickfix picker to list both seeded entries',
            },
        );
        const labels = await pickerLabels();
        await expect(labels).toContain('QF first entry');
        await expect(labels).toContain('QF second entry');
    });

    it('shows each entry as a vault-relative path and line', async () => {
        await seedQuickfix();
        await openQuickfixPicker();
        await browser.waitUntil(
            async () => (await pickerDescriptions()).length >= 2,
            { timeout: 10000, interval: 50 },
        );
        const descriptions = await pickerDescriptions();
        // Neovim reports absolute paths; an absolute one here would mean the
        // vault-relative conversion silently failed.
        await expect(descriptions).toContain(`${FIRST_FILE}:2`);
        await expect(descriptions).toContain(`${SECOND_FILE}:1`);
        await expect(descriptions.join('|')).not.toContain('/');
    });

    it('lists nothing when the quickfix list is empty', async () => {
        await pluginRequest('nvim_exec_lua', ['vim.fn.setqflist({})', []]);
        await openQuickfixPicker();
        await browser.waitUntil(
            async () =>
                browser.executeObsidian(
                    () => !!document.querySelector('.vim-motions-picker'),
                ),
            { timeout: 5000, interval: 50, timeoutMsg: 'picker to open' },
        );
        await expect(await pickerLabels()).toEqual([]);
    });
});
