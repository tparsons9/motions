import { browser, expect } from '@wdio/globals';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getNotices, loadTwoFileWorkspace, setupEditor } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

/**
 * Measures how much of a native-LSP workflow already crosses the RPC bridge
 * with no new bridge code.
 *
 * The server is in-process and lives in the Neovim config fixture
 * (test/fixtures/nvim/lsp-probe.lua), so the suite needs no language-server
 * binary and no network. Registering it at config time is not a convenience:
 * vim.lsp.enable() attaches on FileType and skips buffers whose 'buftype' is
 * already set, and the plugin applies buftype=acwrite immediately after its
 * first `filetype detect`. A config-time enable is therefore the only path
 * that attaches, and it is the path a real user's init.lua takes.
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

interface VirtTextRender {
    nsId: number;
    extmarkId: number;
    row: number;
    text: string;
    groups: string[];
}

interface MarkRender {
    nsId: number;
    text: string;
    groups: string[];
}

interface ActivationProbe {
    filetype: string;
    buftype: string;
    listed: boolean;
}

interface LateEnableOutcome {
    buftype: string;
    attachedByEnable: boolean;
    attachedByExplicitStart: boolean;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/lsp-probe.lua');
const FIXTURE = ['alpha beta gamma', 'delta epsilon', 'pro'].join('\n');
const FIRST_FILE = 'Welcome.md';
const SECOND_FILE = 'Target.md';

const HOVER_BODY = 'VIM_MOTIONS_HOVER_BODY';
const DIAGNOSTIC_MESSAGE = 'VIM_MOTIONS_LSP_DIAGNOSTIC';
const COMPLETION_ITEMS = ['probeAlphaItem', 'probeBetaItem'];

/**
 * macOS reaches `/var` through a firmlink to `/private/var`. Neovim resolves it
 * when naming the buffer and Obsidian's adapter does not, so the two spellings
 * name the same file and an exact string comparison fails on macOS only. A
 * path that does not exist — which is what the relative-path defect produces —
 * resolves to itself and still fails the comparison.
 */
function resolveReal(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

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

async function execLua(chunk: string, args: unknown[] = []): Promise<unknown> {
    return pluginRequest('nvim_exec_lua', [chunk, args]);
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

async function dispatchKeys(...tokens: string[]): Promise<void> {
    await browser.executeObsidian(({ app, obsidian }, sequence: string[]) => {
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
        const named: Record<string, string> = {
            '<Esc>': 'Escape',
            '<CR>': 'Enter',
            '<Tab>': 'Tab',
            '<BS>': 'Backspace',
        };
        for (const token of sequence) {
            const parts = token.startsWith('<') ? [token] : Array.from(token);
            for (const part of parts) {
                const control = /^<C-(.)>$/u.exec(part);
                const key = control ? control[1]! : (named[part] ?? part);
                contentDOM.dispatchEvent(
                    new KeyboardEventConstructor('keydown', {
                        key,
                        ctrlKey: control !== null,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        }
    }, tokens);
}

async function popupItems(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-popupmenu-item',
            ),
        ].map((row) => row.dataset.word ?? ''),
    );
}

async function renderedVirtText(): Promise<VirtTextRender[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-virt-text',
            ),
        ].map((element) => ({
            nsId: Number(element.dataset.nsId),
            extmarkId: Number(element.dataset.extmarkId),
            row: Number(element.dataset.row),
            text: element.textContent ?? '',
            groups: [...element.querySelectorAll<HTMLElement>('span')].flatMap(
                (span) =>
                    [...span.classList].filter((name) =>
                        name.startsWith('vim-hl-'),
                    ),
            ),
        })),
    );
}

async function renderedMarks(): Promise<MarkRender[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-decoration',
            ),
        ]
            .filter(
                (element) =>
                    !element.classList.contains('vim-motions-rpc-virt-text'),
            )
            .map((element) => ({
                nsId: Number(element.dataset.nsId),
                text: element.textContent ?? '',
                groups: [...element.classList].filter((name) =>
                    name.startsWith('vim-hl-'),
                ),
            })),
    );
}

async function renderedFloatLines(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-float-line',
            ),
        ].map((line) => line.textContent ?? ''),
    );
}

async function activateFile(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app, obsidian }, target: string) => {
        let found: import('obsidian').WorkspaceLeaf | null = null;
        app.workspace.iterateAllLeaves((leaf) => {
            const view = leaf.view;
            if (
                view instanceof obsidian.MarkdownView &&
                view.file?.path === target
            )
                found = leaf;
        });
        if (!found) throw new Error(`No open leaf for ${target}`);
        app.workspace.setActiveLeaf(found, { focus: true });
        await Promise.resolve();
    }, path);
    await browser.waitUntil(
        async () =>
            String(await pluginRequest('nvim_buf_get_name', [0])).endsWith(
                path,
            ),
        {
            timeout: 10000,
            interval: 50,
            timeoutMsg: `the mirror buffer to be renamed to ${path}`,
        },
    );
}

async function lspEvents(): Promise<string[]> {
    return (await execLua('return _G.vim_motions_lsp_events')) as string[];
}

async function attachedClients(): Promise<string[]> {
    return (await execLua(
        `local names = {}
for _, client in ipairs(vim.lsp.get_clients({ bufnr = vim.api.nvim_get_current_buf() })) do
  names[#names + 1] = client.name
end
return names`,
    )) as string[];
}

/**
 * Reports why attachment did not happen. A bare waitUntil timeout says only
 * "no client", which is indistinguishable between a wrong buffer, a rejected
 * config and a server that never answered `initialize`.
 */
async function attachDiagnosis(): Promise<unknown> {
    return execLua(
        `local buf = vim.api.nvim_get_current_buf()
local all = {}
for _, client in ipairs(vim.lsp.get_clients()) do all[#all + 1] = client.name end
return {
  bufferName = vim.api.nvim_buf_get_name(buf),
  filetype = vim.bo[buf].filetype,
  buftype = vim.bo[buf].buftype,
  configLoaded = vim.g.vim_motions_test_config == true,
  serverRegistered = type(vim.g.vim_motions_lsp_server),
  clientsAnywhere = all,
}`,
    );
}

describe('Neovim RPC native LSP capability', function () {
    this.timeout(180000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadTwoFileWorkspace(FIRST_FILE, SECOND_FILE, 'first');
        await setupEditor(FIXTURE, { line: 0, ch: 0 });
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
        try {
            await browser.waitUntil(
                async () => (await attachedClients()).length > 0,
                { timeout: 20000, interval: 100 },
            );
        } catch {
            throw new Error(
                `the in-process LSP client did not attach to the mirror buffer: ${JSON.stringify(
                    await attachDiagnosis(),
                )} | notices: ${(await getNotices()).join(' | ')}`,
            );
        }
    });

    afterEach(async () => {
        if (!(await getRpcState()).connected) return;
        await dispatchKeys('<Esc>');
        await execLua(
            `for _, win in ipairs(vim.api.nvim_list_wins()) do
  if vim.api.nvim_win_get_config(win).relative ~= '' then
    pcall(vim.api.nvim_win_close, win, true)
  end
end`,
        );
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

    it('mirrors the note under its real absolute vault path', async () => {
        const bufferName = (await pluginRequest(
            'nvim_buf_get_name',
            [0],
        )) as string;
        const vaultPath = await browser.executeObsidian(({ app, obsidian }) => {
            const view = app.workspace.getActiveViewOfType(
                obsidian.MarkdownView,
            );
            const file = view?.file;
            const adapter = app.vault.adapter;
            if (!file || !(adapter instanceof obsidian.FileSystemAdapter))
                throw new Error('No filesystem-backed active Markdown file');
            return adapter.getFullPath(file.path);
        });
        // A synthetic or relative name is what would break LSP root
        // resolution, so assert the whole path rather than a suffix.
        await expect(resolveReal(bufferName)).toBe(resolveReal(vaultPath));
        await expect(bufferName.endsWith('.md')).toBe(true);
    });

    it('runs filetype detection on the mirrored buffer and leaves it acwrite', async () => {
        const probe = (await execLua(
            `local buf = vim.api.nvim_get_current_buf()
return {
  filetype = vim.bo[buf].filetype,
  buftype = vim.bo[buf].buftype,
  listed = vim.bo[buf].buflisted,
}`,
        )) as ActivationProbe;
        // Read off the live mirror buffer rather than re-enacting the ordering
        // on a scratch buffer: a re-enactment would keep passing if the plugin
        // stopped detecting filetype at all, which is the whole risk here.
        await expect(probe.filetype).toBe('markdown');
        await expect(probe.buftype).toBe('acwrite');
    });

    it('attaches a config-time vim.lsp.enable() client to the mirrored buffer', async () => {
        const names = await attachedClients();
        await expect(names).toContain('vimmotionsprobe');
    });

    it('renders server completion items in the Obsidian popup menu', async () => {
        await execLua(
            `vim.lsp.completion.enable(
  true,
  vim.lsp.get_clients({ bufnr = vim.api.nvim_get_current_buf() })[1].id,
  vim.api.nvim_get_current_buf(),
  { autotrigger = false }
)
vim.api.nvim_win_set_cursor(0, { 3, 3 })`,
        );
        await dispatchKeys('a', '<C-x>', '<C-o>');
        await browser.waitUntil(
            async () => (await popupItems()).includes(COMPLETION_ITEMS[0]!),
            {
                timeout: 20000,
                interval: 50,
                timeoutMsg:
                    'LSP-sourced completion items to reach the external popup menu',
            },
        );
        const items = await popupItems();
        // Both labels, so this cannot pass on a stray keyword completion that
        // happens to match one of them.
        await expect(items).toContain(COMPLETION_ITEMS[0]);
        await expect(items).toContain(COMPLETION_ITEMS[1]);
    });

    it('renders LSP hover as an Obsidian float overlay', async () => {
        await execLua('vim.api.nvim_win_set_cursor(0, { 1, 0 })');
        await execLua('vim.lsp.buf.hover()');
        await browser.waitUntil(
            async () =>
                (await renderedFloatLines()).some((line) =>
                    line.includes(HOVER_BODY),
                ),
            {
                timeout: 20000,
                interval: 50,
                timeoutMsg:
                    'the LSP hover float to render its server markdown in CM6',
            },
        );
        const lines = await renderedFloatLines();
        await expect(lines.some((line) => line.includes(HOVER_BODY))).toBe(
            true,
        );
    });

    it('renders LSP diagnostic virtual text as a CM6 widget', async () => {
        await browser.waitUntil(
            async () =>
                (await renderedVirtText()).some((mark) =>
                    mark.text.includes(DIAGNOSTIC_MESSAGE),
                ),
            {
                timeout: 20000,
                interval: 50,
                timeoutMsg:
                    'diagnostic virtual text to render as an RPC virt-text widget',
            },
        );
        const widget = (await renderedVirtText()).find((mark) =>
            mark.text.includes(DIAGNOSTIC_MESSAGE),
        );
        if (!widget) throw new Error('No diagnostic virt-text widget rendered');
        await expect(widget.row).toBe(0);
        // Neovim's own highlight group has to survive the crossing, otherwise
        // the text renders unstyled and severity becomes invisible.
        await expect(widget.groups).toContain(
            'vim-hl-DiagnosticVirtualTextError',
        );
    });

    it('renders LSP diagnostic underline as a CM6 mark decoration', async () => {
        await browser.waitUntil(
            async () =>
                (await renderedMarks()).some((mark) =>
                    mark.groups.includes('vim-hl-DiagnosticUnderlineError'),
                ),
            {
                timeout: 20000,
                interval: 50,
                timeoutMsg:
                    'diagnostic underline to render as an RPC mark decoration',
            },
        );
        const underline = (await renderedMarks()).find((mark) =>
            mark.groups.includes('vim-hl-DiagnosticUnderlineError'),
        );
        if (!underline) throw new Error('No diagnostic underline rendered');
        // The server reported characters 0-5 of line 1.
        await expect(underline.text).toBe('alpha');
    });

    it('re-opens the LSP document when the mirrored note changes', async () => {
        await activateFile(FIRST_FILE);
        await execLua('_G.vim_motions_lsp_events = {}');
        await activateFile(SECOND_FILE);
        await browser.waitUntil(async () => (await lspEvents()).length >= 2, {
            timeout: 10000,
            interval: 50,
            timeoutMsg:
                'the server to observe a document lifecycle for the note switch',
        });
        const events = await lspEvents();
        // One buffer is renamed rather than reopened, so without an explicit
        // pair the server keeps attributing edits to the previous note.
        await expect(
            events.some(
                (event) =>
                    event.startsWith('textDocument/didClose') &&
                    event.endsWith(FIRST_FILE),
            ),
        ).toBe(true);
        await expect(
            events.some(
                (event) =>
                    event.startsWith('textDocument/didOpen') &&
                    event.endsWith(SECOND_FILE),
            ),
        ).toBe(true);
    });

    it('keeps a client attached to the mirror after switching notes', async () => {
        await activateFile(FIRST_FILE);
        await activateFile(SECOND_FILE);
        await expect(await attachedClients()).toContain('vimmotionsprobe');
    });

    it('attaches a late vim.lsp.enable() on the next note activation', async () => {
        await activateFile(FIRST_FILE);
        await execLua(
            `vim.lsp.config('vimmotionslate', {
  cmd = vim.g.vim_motions_lsp_server,
  filetypes = { 'markdown' },
  root_dir = function(bufnr, on_dir)
    on_dir(vim.fs.dirname(vim.api.nvim_buf_get_name(bufnr)))
  end,
})
vim.lsp.enable('vimmotionslate')`,
        );
        // A bare `filetype detect` cannot attach it: Neovim skips a buffer
        // whose buftype is already set, and the mirror is acwrite between
        // activations. An activation clears buftype first, so this is the path
        // that has to work.
        await execLua('vim.cmd("filetype detect")');
        await expect(await attachedClients()).not.toContain('vimmotionslate');
        await activateFile(SECOND_FILE);
        await browser.waitUntil(
            async () => (await attachedClients()).includes('vimmotionslate'),
            {
                timeout: 10000,
                interval: 50,
                timeoutMsg:
                    'a late vim.lsp.enable() to attach on the next activation',
            },
        );
        await expect(await attachedClients()).toContain('vimmotionslate');
        await execLua(
            `vim.lsp.enable('vimmotionslate', false)
for _, client in ipairs(vim.lsp.get_clients({ name = 'vimmotionslate' })) do
  pcall(vim.lsp.stop_client, client.id, true)
end`,
        );
    });
});
