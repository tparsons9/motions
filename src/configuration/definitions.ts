import { additionalDefinitions } from './definition-surface';
/** Versioned, deliberately bounded configuration surface; not a Neovim compatibility claim. */
const core = {
    version: '1.0.0',
    text: `---@meta
---@class MotionsMapOptions
---@field desc? string
---@field buffer? boolean|integer
---@field expr? boolean Function callbacks only; string expressions require unavailable Vimscript evaluation.
---@field remap? boolean
---@field silent? boolean
---@class MotionsOptions
---@field scrolloff integer
---@field number boolean
---@field relativenumber boolean
---@field shiftwidth integer
---@field softtabstop integer
---@field tabstop integer
---@field expandtab boolean
---@field filetype string
---@field buftype string
---@field commentstring string
---@field textwidth integer
---@field timeoutlen integer
---@field clipboard string
---@field insertmodeescape string
---@field insertmodeescapetimeout integer
---@field textobjects boolean
---@field yankring boolean
---@field replacewithregister boolean
---@field easymotion boolean
---@field pickerleadermappings boolean
---@field flashjump boolean
---@class MotionsVim
---@field g table<string, any>
---@field b table<string, any>
---@field v table<string, any>
---@field opt MotionsOptions
---@field o MotionsOptions
---@field go MotionsOptions
---@field bo MotionsOptions
---@field wo table<string, any>
---@field env table<string, string> Sandboxed environment.
vim = {}
---@class MotionsKeymap
vim.keymap = {}
---@param mode string|string[]
---@param lhs string
---@param rhs string|fun():string?
---@param opts? MotionsMapOptions
function vim.keymap.set(mode, lhs, rhs, opts) end
---@param mode string|string[]
---@param lhs string
---@param opts? MotionsMapOptions
function vim.keymap.del(mode, lhs, opts) end
---@param command string
function vim.cmd(command) end
---@param callback fun()
function vim.schedule(callback) end
---@param callback fun()
---@param milliseconds number
function vim.defer_fn(callback, milliseconds) end
---@param message string
---@param level? integer
function vim.notify(message, level) end
---@param value any
---@return string
function vim.inspect(value) end
---@param value any
---@return any
function vim.deepcopy(value) end
---@param text string
---@return string
function vim.trim(text) end
---@param text string
---@param separator string
---@param options? table
---@return string[]
function vim.split(text, separator, options) end
---@class MotionsApi
vim.api = {}
---@param event string|string[]
---@param opts table
---@return integer
function vim.api.nvim_create_autocmd(event, opts) end
---@param name string
---@param opts table
---@return integer
function vim.api.nvim_create_augroup(name, opts) end
---@param buffer integer Current buffer only.
---@param start integer
---@param finish integer
---@param strict boolean
---@return string[]
function vim.api.nvim_buf_get_lines(buffer, start, finish, strict) end
---@param buffer integer Current buffer only.
---@param start integer
---@param finish integer
---@param strict boolean
---@param lines string[]
function vim.api.nvim_buf_set_lines(buffer, start, finish, strict, lines) end
---@param mode string
---@return table[]
function vim.api.nvim_get_keymap(mode) end
---@param buffer integer
---@param mode string
---@return table[]
function vim.api.nvim_buf_get_keymap(buffer, mode) end
---@param mode string
---@param lhs string
---@param rhs string
---@param opts? MotionsMapOptions
function vim.api.nvim_set_keymap(mode, lhs, rhs, opts) end
---@param buffer integer
---@param mode string
---@param lhs string
---@param rhs string
---@param opts? MotionsMapOptions
function vim.api.nvim_buf_set_keymap(buffer, mode, lhs, rhs, opts) end
---@return integer
function vim.api.nvim_get_current_buf() end
---@param window integer Current window only.
---@return integer[]
function vim.api.nvim_win_get_cursor(window) end
---@param window integer Current window only.
---@param position integer[] One-based line, zero-based byte column; interior bytes normalize.
function vim.api.nvim_win_set_cursor(window, position) end
vim.lsp = { buf = {} }
---Delegated to a registered language provider, such as CCC.
function vim.lsp.buf.hover() end
function vim.lsp.buf.definition() end
function vim.lsp.buf.signature_help() end
function vim.lsp.buf.code_action() end
function vim.lsp.buf.format() end
vim.diagnostic = {}
function vim.diagnostic.goto_next() end
function vim.diagnostic.goto_prev() end
vim.json = {}
---@param value any
---@return string
function vim.json.encode(value) end
---@param text string
---@return any
function vim.json.decode(text) end
vim.obsidian = { keymap = {}, leader = {}, whichkey = {}, fs = {} }
---@param command string Obsidian command ID.
function vim.obsidian.run_command(command) end
---@param lhs string
---@param rhs string
---@param opts? table
function vim.obsidian.keymap.set(lhs, rhs, opts) end
---@param lhs string
function vim.obsidian.keymap.del(lhs) end
---@param ... any
function vim.obsidian.leader.add(...) end
---@param ... any
function vim.obsidian.whichkey.add(...) end
---@param ... any
function vim.obsidian.whichkey.set_group(...) end
---@param source string
---@param opts? table
function vim.obsidian.pick(source, opts) end
---@param path string
---@return string
function vim.obsidian.fs.read(path) end
vim.ob = vim.obsidian
---Additional Motions APIs are documented in configuration/lua-config.md.
---These definitions cover the common configuration surface; absence here is not proof of runtime absence.
`,
};

export const definitions = {
    version: core.version,
    text: core.text + additionalDefinitions(core.text),
};
