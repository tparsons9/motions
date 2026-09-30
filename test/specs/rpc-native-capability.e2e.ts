import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import { getNotices, loadSingleFileWorkspace, setupEditor } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

/**
 * Pins the decoration bridge's extmark-field boundary and the Neovim-native
 * data that already reaches the host over RPC.
 *
 * `ForwardedExtmark` in src/rpc/decorations.ts carries hl_group, virt_text
 * (overlay/eol/inline) and priority -- and nothing else. The "does not render"
 * cases below are therefore documentation of a real gap, not aspiration: they
 * are what blocks diagnostic signs, diagnostic virtual_lines, code lens and
 * gitsigns from crossing. Each one is paired with a same-namespace,
 * same-position virt_text positive control, so a test cannot pass merely
 * because extmark forwarding broke altogether.
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

interface QuickfixEntry {
    lnum: number;
    col: number;
    text: string;
    type: string;
}

interface SpellFinding {
    word: string;
    kind: string;
    bytePosition: number;
}

const TEST_CONFIG_PATH = resolve('test/fixtures/nvim/init.lua');
const FIXTURE = [
    'alpha beta gamma',
    'drop this line',
    'keep this line',
    'drop that line',
    'final line here',
].join('\n');

const CONTROL_TEXT = 'CONTROL_VIRT';
const PROBE_TEXT = 'PROBE_UNSUPPORTED';

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

async function editorValue(): Promise<string> {
    return browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!view) throw new Error('No active MarkdownView');
        return view.editor.getValue();
    });
}

async function resetFixture(): Promise<void> {
    await execLua(
        `local lines = ...
vim.api.nvim_input('<Esc>')
vim.api.nvim_buf_clear_namespace(0, vim.api.nvim_create_namespace('vim_motions_probe'), 0, -1)
vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
vim.api.nvim_win_set_cursor(0, { 1, 0 })`,
        [FIXTURE.split('\n')],
    );
    await browser.waitUntil(async () => (await editorValue()) === FIXTURE, {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'CM6 did not settle back to the fixture text',
    });
}

/**
 * Sets one virt_text control mark and one probe mark carrying the field under
 * test, in the same namespace on the same line, then forces a redraw so the
 * decoration provider forwards both in a single pass.
 */
async function setProbeMarks(probeOpts: string): Promise<void> {
    await execLua(
        `local control_text, probe_opts_marker = ...
local ns = vim.api.nvim_create_namespace('vim_motions_probe')
vim.api.nvim_buf_clear_namespace(0, ns, 0, -1)
vim.api.nvim_buf_set_extmark(0, ns, 0, 0, {
  virt_text = { { control_text, 'Comment' } },
  virt_text_pos = 'eol',
  priority = 200,
})
vim.api.nvim_buf_set_extmark(0, ns, 0, 0, ${probeOpts})
vim.cmd('redraw')
return probe_opts_marker`,
        [CONTROL_TEXT, PROBE_TEXT],
    );
}

async function renderedVirtTexts(): Promise<string[]> {
    return browser.executeObsidian(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                '.vim-motions-rpc-virt-text',
            ),
        ].map((element) => element.textContent ?? ''),
    );
}

async function waitForControl(): Promise<void> {
    await browser.waitUntil(
        async () =>
            (await renderedVirtTexts()).some((text) =>
                text.includes(CONTROL_TEXT),
            ),
        {
            timeout: 10000,
            interval: 50,
            timeoutMsg:
                'the virt_text positive control to render, which must happen before any "not rendered" claim is meaningful',
        },
    );
}

async function documentText(): Promise<string> {
    return browser.executeObsidian(
        () =>
            document.querySelector<HTMLElement>('.cm-editor')?.textContent ??
            '',
    );
}

describe('Neovim RPC native capability boundary', function () {
    this.timeout(180000);
    let spawnedPid: number | null = null;

    before(async function () {
        requireRpcPrerequisites(this);
        await loadSingleFileWorkspace();
        await setupEditor(FIXTURE, { line: 0, ch: 0 });
        await setRpcEnabled(true);
        spawnedPid = (await waitForConnected()).pid;
    });

    beforeEach(async () => resetFixture());

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

    describe('extmark fields the bridge carries', () => {
        it('renders eol virt_text with its highlight group', async () => {
            await setProbeMarks(`{
  virt_text = { { probe_opts_marker, 'ErrorMsg' } },
  virt_text_pos = 'eol',
  priority = 100,
}`);
            await waitForControl();
            const texts = await renderedVirtTexts();
            await expect(texts.some((t) => t.includes(PROBE_TEXT))).toBe(true);
        });

        it('renders inline virt_text', async () => {
            await setProbeMarks(`{
  virt_text = { { probe_opts_marker, 'ErrorMsg' } },
  virt_text_pos = 'inline',
  priority = 100,
}`);
            await waitForControl();
            const texts = await renderedVirtTexts();
            await expect(texts.some((t) => t.includes(PROBE_TEXT))).toBe(true);
        });
    });

    describe('extmark fields the bridge now carries', () => {
        it('renders virt_lines below the line, for diagnostic virtual_lines and code lens', async () => {
            await setProbeMarks(`{
  virt_lines = { { { probe_opts_marker, 'ErrorMsg' } } },
  priority = 100,
}`);
            await waitForControl();
            await browser.waitUntil(
                async () =>
                    browser.executeObsidian(() =>
                        [
                            ...document.querySelectorAll<HTMLElement>(
                                '.vim-motions-rpc-virt-lines',
                            ),
                        ].some((element) =>
                            (element.textContent ?? '').includes(
                                'PROBE_UNSUPPORTED',
                            ),
                        ),
                    ),
                {
                    timeout: 10000,
                    interval: 50,
                    timeoutMsg:
                        'a virt_lines block widget to render below the line',
                },
            );
            const rendered = await browser.executeObsidian(() =>
                [
                    ...document.querySelectorAll<HTMLElement>(
                        '.vim-motions-rpc-virt-lines',
                    ),
                ].map((element) => element.textContent ?? ''),
            );
            await expect(rendered.join('|')).toContain(PROBE_TEXT);
        });

        it('renders sign_text in the sign gutter, for diagnostic signs and gitsigns', async () => {
            await setProbeMarks(`{
  sign_text = 'E>',
  sign_hl_group = 'ErrorMsg',
  priority = 100,
}`);
            await waitForControl();
            await browser.waitUntil(
                async () =>
                    browser.executeObsidian(() =>
                        [
                            ...document.querySelectorAll<HTMLElement>(
                                '.cm-gutter, .vim-motions-sign-gutter',
                            ),
                        ]
                            .map((element) => element.textContent ?? '')
                            .join('|')
                            .includes('E>'),
                    ),
                {
                    timeout: 10000,
                    interval: 50,
                    timeoutMsg: 'sign_text to reach the sign gutter',
                },
            );
            const gutters = await browser.executeObsidian(() =>
                [
                    ...document.querySelectorAll<HTMLElement>(
                        '.cm-gutter, .vim-motions-sign-gutter',
                    ),
                ].map((element) => element.textContent ?? ''),
            );
            await expect(gutters.length).toBeGreaterThan(0);
            await expect(gutters.join('|')).toContain('E>');
        });

        it('renders line_hl_group across the whole line', async () => {
            await setProbeMarks(`{
  line_hl_group = 'ErrorMsg',
  priority = 100,
}`);
            await waitForControl();
            await browser.waitUntil(
                async () =>
                    browser.executeObsidian(
                        () =>
                            document.querySelectorAll(
                                '.cm-line.vim-hl-ErrorMsg',
                            ).length > 0,
                    ),
                {
                    timeout: 10000,
                    interval: 50,
                    timeoutMsg: 'line_hl_group to reach the rendered line',
                },
            );
            const counts = await browser.executeObsidian(() => ({
                lines: document.querySelectorAll('.cm-line').length,
                highlighted: document.querySelectorAll(
                    '.cm-line.vim-hl-ErrorMsg',
                ).length,
            }));
            await expect(counts.lines).toBeGreaterThan(0);
            await expect(counts.highlighted).toBeGreaterThan(0);
        });
    });

    describe('Neovim-native data already reachable over RPC', () => {
        it('exposes quickfix entries as structured data for a picker source', async () => {
            const entries = (await execLua(
                `vim.fn.setqflist({
  { filename = 'alpha.md', lnum = 3, col = 1, text = 'QF_ENTRY_ONE', type = 'E' },
  { filename = 'beta.md', lnum = 7, col = 2, text = 'QF_ENTRY_TWO', type = 'W' },
})
local out = {}
for index, item in ipairs(vim.fn.getqflist()) do
  out[index] = { lnum = item.lnum, col = item.col, text = item.text, type = item.type }
end
return out`,
            )) as QuickfixEntry[];
            await expect(entries).toHaveLength(2);
            await expect(entries[0]).toEqual({
                lnum: 3,
                col: 1,
                text: 'QF_ENTRY_ONE',
                type: 'E',
            });
            await expect(entries[1]?.text).toBe('QF_ENTRY_TWO');
        });

        it('exposes spell findings as byte-positioned structured data', async () => {
            const findings = (await execLua(
                `local out = {}
for index, finding in ipairs(vim.spell.check('the quik brown fox')) do
  out[index] = { word = finding[1], kind = finding[2], bytePosition = finding[3] }
end
return out`,
            )) as SpellFinding[];
            await expect(findings).toHaveLength(1);
            await expect(findings[0]).toEqual({
                word: 'quik',
                kind: 'bad',
                bytePosition: 5,
            });
        });

        it('evaluates Vimscript expressions the bundled engine cannot', async () => {
            const numeric = await pluginRequest('nvim_eval', ['1 + 2 * 3']);
            const stringly = await pluginRequest('nvim_eval', [
                'toupper("vimscript") . "-" . string(len("abcd"))',
            ]);
            await expect(numeric).toBe(7);
            await expect(stringly).toBe('VIMSCRIPT-4');
        });

        it('runs an external process through system()', async () => {
            const output = (await execLua(
                `return vim.fn.system({ vim.v.progpath, '--version' })`,
            )) as string;
            const shellError = await pluginRequest('nvim_eval', [
                'v:shell_error',
            ]);
            await expect(output).toContain('NVIM');
            await expect(shellError).toBe(0);
        });

        it('mirrors :global buffer edits back into the Obsidian editor', async () => {
            await execLua(`vim.cmd('g/^drop/d')`);
            const expected = [
                'alpha beta gamma',
                'keep this line',
                'final line here',
            ].join('\n');
            await browser.waitUntil(
                async () => (await editorValue()) === expected,
                {
                    timeout: 10000,
                    interval: 50,
                    timeoutMsg:
                        ':global deletions to reach CM6 through the line-event mirror',
                },
            );
            await expect(await editorValue()).toBe(expected);
        });
    });
});
