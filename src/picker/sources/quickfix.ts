import { FileSystemAdapter, type App } from 'obsidian';
import type { PickerItem, PickerSource } from '../types';
import { navigateWithJump } from '../../workspace/navigate';
import { readLinesAroundPosition } from './preview-utils';

/**
 * Neovim's quickfix list as a picker source.
 *
 * The list is plain structured data — `getqflist()` returns entries, not screen
 * cells — so it crosses the bridge without any of the grid reconstruction the
 * rest of Neovim's UI would need. This is what `:grep`, `:vimgrep`,
 * `vim.diagnostic.setqflist()` and LSP reference lists all populate.
 */

interface QuickfixEntry {
    filename: string;
    lnum: number;
    col: number;
    text: string;
    type: string;
    valid: number;
}

interface QuickfixData {
    path: string | null;
    line: number;
    column: number;
}

const QUICKFIX_LUA = `
local out = {}
for index, item in ipairs(vim.fn.getqflist()) do
  local name = ''
  if item.bufnr and item.bufnr > 0 and vim.api.nvim_buf_is_valid(item.bufnr) then
    name = vim.api.nvim_buf_get_name(item.bufnr)
  end
  out[index] = {
    filename = name,
    lnum = item.lnum or 0,
    col = item.col or 0,
    text = item.text or '',
    type = item.type or '',
    valid = item.valid or 0,
  }
end
return out
`;

const SEVERITY: Record<string, string> = {
    E: 'Errors',
    W: 'Warnings',
    I: 'Info',
    N: 'Notes',
};

/**
 * macOS reaches `/var` through a firmlink to `/private/var`, and the two sides
 * disagree about which spelling to use: Obsidian reports the vault base
 * unresolved while Neovim resolves it when naming a buffer. Normalising both
 * ends is what stops every quickfix entry on macOS rendering as an absolute
 * path and refusing to open.
 */
function stripPrivate(path: string): string {
    const normalized = path.replace(/\\/gu, '/').replace(/\/+$/u, '');
    return normalized.startsWith('/private/')
        ? normalized.slice('/private'.length)
        : normalized;
}

/**
 * Neovim reports absolute paths; Obsidian navigates by vault-relative ones, and
 * an entry outside the vault has no vault path at all rather than a wrong one.
 */
export function vaultRelative(
    basePath: string,
    absolute: string,
): string | null {
    if (!absolute || !basePath) return null;
    const prefix = `${stripPrivate(basePath)}/`;
    const normalized = stripPrivate(absolute);
    return normalized.startsWith(prefix)
        ? normalized.slice(prefix.length)
        : null;
}

function vaultBasePath(app: App): string | null {
    const adapter = app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

export function createQuickfixSource(
    requestNeovim: (method: string, args: unknown[]) => Promise<unknown>,
    isConnected: () => boolean,
): PickerSource {
    return {
        name: 'quickfix',
        placeholder: 'Jump to quickfix entry…',
        displayName: 'Quickfix list',
        icon: 'list-checks',
        description: "Navigate Neovim's quickfix list",
        priority: 12,
        async items(app: App) {
            if (!isConnected()) return [];
            const entries = (await requestNeovim('nvim_exec_lua', [
                QUICKFIX_LUA,
                [],
            ])) as QuickfixEntry[];
            const basePath = vaultBasePath(app);
            return entries.map((entry, index): PickerItem => {
                const path = basePath
                    ? vaultRelative(basePath, entry.filename)
                    : null;
                const where = path ?? entry.filename;
                const position = entry.lnum > 0 ? `:${entry.lnum}` : '';
                return {
                    id: `quickfix:${index}`,
                    label: entry.text.trim() || where || `Entry ${index + 1}`,
                    description: where ? `${where}${position}` : position,
                    filterValue: `${entry.text} ${where}`,
                    group: SEVERITY[entry.type] ?? 'Entries',
                    data: {
                        path,
                        line: Math.max(0, entry.lnum - 1),
                        column: Math.max(0, entry.col - 1),
                    } satisfies QuickfixData,
                };
            });
        },
        onSelect(item, app) {
            const { path, line, column } = item.data as QuickfixData;
            if (!path) return;
            void navigateWithJump(app, path, '', { line, ch: column });
        },
        async preview(item, app) {
            const { path, line } = item.data as QuickfixData;
            if (!path) return null;
            return readLinesAroundPosition(app, path, line);
        },
    };
}
