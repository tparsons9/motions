import { browser, expect, $ } from '@wdio/globals';
import { ensureWindowFocused } from '../helpers';
import { obsidianPage } from 'wdio-obsidian-service';
import type { EditorView } from '@codemirror/view';
import type { ExternalEditorHandle } from '../../src/integrations/external-editors';
import type { VimMotionsEditorApi } from '../../src/integrations/editor-api';
import type { VimApi, CmAdapter } from '../../src/types/vim-api';

interface Hosts {
    editors: Array<EditorView & { cm: CmAdapter }>;
    handles: ExternalEditorHandle[];
    container: HTMLElement;
    note: EditorView & { cm: CmAdapter };
}
const config = `
vim.g.mapleader = ' '
vim.opt.whichkey = 'leader'
vim.opt.whichkeydelay = 0
vim.opt.whichkeygrouping = 'grouped'
vim.keymap.set('n', 'j', 'gj')
vim.keymap.set('n', 'k', 'gk')
vim.keymap.set('n', 'I', '0i')
vim.keymap.set('n', 'A', '0a')
vim.keymap.set('n', 'Q', function() vim.api.nvim_set_current_line('shared') end)
vim.keymap.set('n', '<leader>ff', 'l', {desc='Vault files'})
vim.api.nvim_create_autocmd('FileType', {pattern='*', callback=function()
  if vim.bo.filetype == 'markdown' then return end
  local ft = vim.bo.filetype
  vim.b.seen = vim.api.nvim_buf_get_name(0)
  vim.bo.tabstop = ft == 'python' and 4 or 2
  vim.bo.shiftwidth = ft == 'python' and 4 or 2
  vim.bo.expandtab = true
  vim.keymap.set('n', 'Q', function() vim.api.nvim_set_current_line(ft) end, {buffer=true})
  vim.keymap.set('n', '<leader>cf', 'l', {buffer=true,desc='Format code'})
  vim.keymap.set('n', '<leader>ca', 'h', {buffer=true,desc='Quick fix'})
  for _, k in ipairs({'j', 'k', 'I', 'A'}) do
    vim.keymap.set('n', k, k, {buffer=true})
  end
  vim.ob.whichkey.set_group('<leader>c', 'Code', {buffer=true})
end})
`;
async function load(content: string): Promise<void> {
    await browser.executeObsidian(async ({ app }, source: string) => {
        const plugin = (
            app as unknown as {
                plugins: {
                    plugins: Record<
                        string,
                        {
                            settings: {
                                neovimRpcEnabled: boolean;
                                luaConfigPath: string;
                            };
                            loadLuaConfigForTest(): Promise<void>;
                        }
                    >;
                };
            }
        ).plugins.plugins['vim-motions-tparsons9']!;
        plugin.settings.neovimRpcEnabled = false;
        plugin.settings.luaConfigPath = `${app.vault.configDir}.context.lua`;
        await app.vault.adapter.write(plugin.settings.luaConfigPath, source);
        await plugin.loadLuaConfigForTest();
    }, content);
}
async function key(index: number, keys: string[]): Promise<string> {
    await ensureWindowFocused();
    return browser.executeObsidian(
        (_ctx, i: number, pressed: string[]) => {
            const hosts = (window as unknown as { __contextHosts: Hosts })
                .__contextHosts;
            const view = i < 0 ? hosts.note : hosts.editors[i]!;
            view.focus();
            if (pressed.includes('Q'))
                view.dispatch({ selection: { anchor: 0 } });
            const vim = (
                window as unknown as { CodeMirrorAdapter: { Vim: VimApi } }
            ).CodeMirrorAdapter.Vim;
            for (const k of pressed) vim.handleKey(view.cm, k);
            return view.state.doc.line(1).text;
        },
        index,
        keys,
    );
}

describe('Contextual external code editor', () => {
    before(async () => {
        await browser.reloadObsidian({ vault: 'test-vault' });
        await obsidianPage.openFile('Welcome.md');
        await load(config);
        await ensureWindowFocused();
        const state = await browser.executeObsidian(({ app, obsidian }) => {
            const api = (
                window as unknown as {
                    VimMotions: { editor: VimMotionsEditorApi };
                }
            ).VimMotions.editor;
            const markdown = app.workspace.getActiveViewOfType(
                obsidian.MarkdownView,
            )!;
            markdown.editor.setValue('note\nnext');
            const note = markdown.editor.cm as EditorView & { cm: CmAdapter };
            note.focus();
            const container = markdown.contentEl.createDiv();
            const View = note.constructor as typeof EditorView;
            const State = note.state.constructor as unknown as {
                create(config: {
                    doc: string;
                    extensions?: unknown[];
                }): EditorView['state'];
            };
            const editors = ['app.py', 'app.ts', 'README.md'].map(
                () =>
                    new View({
                        parent: container,
                        state: State.create({
                            doc: 'sample\nnext',
                            extensions: [View.lineWrapping],
                        }),
                    }),
            ) as Hosts['editors'];
            const handles = editors.map((view, index) =>
                api.attach(view, {
                    path: `file:/context/${['app.py', 'app.ts', 'README.md'][index]}`,
                    filetype: ['python', 'typescript', 'markdown'][index]!,
                }),
            );
            (window as unknown as { __contextHosts: Hosts }).__contextHosts = {
                editors,
                handles,
                container,
                note,
            };
            return {
                noteFocused: note.hasFocus,
                attached: handles.map((handle) => handle.attached),
            };
        });
        await expect(state).toEqual({
            noteFocused: true,
            attached: [true, true, true],
        });
    });
    after(async () => {
        await browser.executeObsidian(async ({ app }) => {
            const win = window as unknown as { __contextHosts?: Hosts };
            const hosts = win.__contextHosts;
            hosts?.handles.forEach((handle) => handle.detach());
            hosts?.editors.forEach((view) => view.destroy());
            hosts?.container.remove();
            delete win.__contextHosts;
            await app.vault.adapter.remove(
                `${app.vault.configDir}.context.lua`,
            );
        });
    });
    it('configures background attachments and restores shared callbacks on focus switching', async () => {
        await expect(await key(-1, ['Q'])).toBe('shared');
        await expect(await key(0, ['Q'])).toBe('python');
        await expect(await key(1, ['Q'])).toBe('typescript');
        await expect(await key(2, ['Q'])).toBe('shared');
        await expect(await key(-1, ['Q'])).toBe('shared');
        const widths = await browser.executeObsidian(() =>
            (
                window as unknown as { __contextHosts: Hosts }
            ).__contextHosts.editors
                .slice(0, 2)
                .map((view) => view.state.tabSize),
        );
        await expect(widths).toEqual([4, 2]);
    });
    it('keeps standard line motions and I/A inside the code buffer', async () => {
        await key(0, ['<Esc>']);
        await browser.executeObsidian(() => {
            const view = (window as unknown as { __contextHosts: Hosts })
                .__contextHosts.editors[0]!;
            view.dom.style.width = '120px';
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: '  ' + 'word '.repeat(30) + '\n  second line',
                },
                selection: { anchor: 0 },
            });
        });
        await browser.waitUntil(() =>
            browser.executeObsidian(() => {
                const view = (window as unknown as { __contextHosts: Hosts })
                    .__contextHosts.editors[0]!;
                return view.lineBlockAt(0).height > view.defaultLineHeight * 2;
            }),
        );
        const positions = await browser.executeObsidian(() => {
            const view = (window as unknown as { __contextHosts: Hosts })
                .__contextHosts.editors[0]!;
            const vim = (
                window as unknown as { CodeMirrorAdapter: { Vim: VimApi } }
            ).CodeMirrorAdapter.Vim;
            vim.handleKey(view.cm, 'j');
            const down = view.state.doc.lineAt(
                view.state.selection.main.head,
            ).number;
            vim.handleKey(view.cm, 'k');
            const up = view.state.doc.lineAt(
                view.state.selection.main.head,
            ).number;
            vim.handleKey(view.cm, 'I');
            const first = view.state.selection.main.head;
            vim.handleKey(view.cm, '<Esc>');
            vim.handleKey(view.cm, 'A');
            const end = view.state.selection.main.head;
            vim.handleKey(view.cm, '<Esc>');
            return { down, up, first, end };
        });
        await expect(positions).toEqual({ down: 2, up: 1, first: 2, end: 152 });
    });
    it('retains a shared path until its last pane closes and reconfigures changed files', async () => {
        await key(-1, ['<Esc>']);
        await browser.executeObsidian(() => {
            const hosts = (window as unknown as { __contextHosts: Hosts })
                .__contextHosts;
            const api = (
                window as unknown as {
                    VimMotions: { editor: VimMotionsEditorApi };
                }
            ).VimMotions.editor;
            hosts.handles[2] = api.attach(hosts.editors[2]!, {
                path: 'file:/context/app.py',
                filetype: 'python',
            });
        });
        await expect(await key(2, ['Q'])).toBe('python');
        await browser.executeObsidian(() => {
            const hosts = (window as unknown as { __contextHosts: Hosts })
                .__contextHosts;
            const api = (
                window as unknown as {
                    VimMotions: { editor: VimMotionsEditorApi };
                }
            ).VimMotions.editor;
            hosts.handles[2] = api.attach(hosts.editors[2]!, {
                path: 'file:/context/README.md',
                filetype: 'markdown',
            });
        });
        await expect(await key(2, ['Q'])).toBe('shared');
        await expect(await key(0, ['Q'])).toBe('python');
    });
    it('shows Code hints only in code and refreshes them after reload', async () => {
        await key(0, ['<Esc>']);
        await browser.keys(' ');
        await browser.waitUntil(() =>
            $('.vim-motions-which-key').isDisplayed(),
        );
        await expect(await $('.vim-motions-which-key').getText()).toContain(
            'Code',
        );
        await key(-1, ['<Esc>']);
        await browser.keys(' ');
        await browser.pause(100);
        const text = await browser.executeObsidian(
            () =>
                document.querySelector('.vim-motions-which-key')?.textContent ??
                '',
        );
        await expect(text).not.toContain('Code');
        await key(0, ['<Esc>']);
        await load(
            "vim.keymap.set('n', 'Q', function() vim.api.nvim_set_current_line('reloaded') end)",
        );
        await expect(await key(0, ['Q'])).toBe('reloaded');
        await expect(await key(1, ['Q'])).toBe('reloaded');
        const local = await browser.executeObsidian(() => {
            const vim = (
                window as unknown as { CodeMirrorAdapter: { Vim: VimApi } }
            ).CodeMirrorAdapter.Vim;
            return vim
                .getKeymap('normal')
                .filter((map) => map.keys === '<Space>cf').length;
        });
        await expect(local).toBe(0);
    });
});
