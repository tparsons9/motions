---
title: Editor provider API
description: Attach Vim to editors another plugin owns, and provide language features to Vim
tags:
    - development
    - reference
---

# Editor provider API

Obsidian's `registerEditorExtension()` only reaches editors Obsidian itself creates, so a plugin that builds its own CodeMirror 6 view — a code file, a console, a diff pane — gets no Vim. This API attaches Vim Motions to such a view and keeps it in step with configuration reloads.

The same API lets a plugin provide language features, so `gd`, `K`, `]d`/`[d` and the Lua `vim.lsp.buf`/`vim.diagnostic` functions work where that plugin understands the code.

It is available only in **bundled fork mode**, meaning Vim Motions provides Vim itself. With Obsidian's built-in Vim key bindings enabled, Vim Motions sets up no extension slot and `editorApi` is absent.

## Quick start

```typescript
import type { EditorView } from '@codemirror/view';

const attach = (view: EditorView) => {
    const api = (window as any).VimMotions?.editor;
    if (!api || api.apiVersion !== 1) return;

    const handle = api.attach(view, {
        path: 'file:/repo/app.py', // vault path, or file: plus an absolute path
        filetype: 'python',
        save: () => myPlugin.save(),
        close: () => leaf.detach(),
    });

    this.register(() => handle.detach());
};

// Attach after creating the view, and again whenever Vim Motions reloads.
this.registerEvent(
    this.app.workspace.on('vim-motions:editor-api-ready' as any, () =>
        attach(view),
    ),
);
this.registerEvent(
    this.app.workspace.on('vim-motions:editor-api-unload' as any, () =>
        restoreMyGutter(),
    ),
);
```

`window.VimMotions.editor` and `app.plugins.plugins['vim-motions'].editorApi` are the same object.

## Events

| Event                           | Meaning                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `vim-motions:editor-api-ready`  | The API is installed. Attach, and re-attach editors opened while it was gone. |
| `vim-motions:editor-api-unload` | Vim is being torn down. Drop handles and restore anything Vim replaced.       |

Check for the API at load time too: your plugin may load after Vim Motions, so the ready event has already fired.

## `attach(view, host)`

`host` describes the editor:

| Field      | Required | Purpose                                                                                                                                                                                                                                             |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`     | yes      | Vault-relative path, or `file:` plus an absolute path for files outside the vault.                                                                                                                                                                  |
| `filetype` | yes      | Neovim filetype (`python`, `r`, …). Drives `vim.bo.filetype`, `FileType` and `commentstring`.                                                                                                                                                       |
| `save`     | no       | Runs for `:w`, `:wq`, `:x` and `:update`, between `BufWritePre` and `BufWritePost`.                                                                                                                                                                 |
| `close`    | no       | Runs for `:q`, `:wq`, `:x`, `:bd` and `:tabclose`. Without it, Obsidian closes the leaf, but only while your editor is inside the active one; elsewhere the command reports that the editor cannot be closed rather than closing an unrelated note. |

The returned handle:

```typescript
interface ExternalEditorHandle {
    readonly attached: boolean;
    detach(): void;
    getMode():
        'normal' | 'insert' | 'visual' | 'replace' | 'select' | 'vreplace';
    onModeChange(callback: (mode: string) => void): () => void;
}
```

Detaching removes Vim and its decorations from the view and reports a final `normal` mode. Destroying the view detaches automatically, but calling `detach()` yourself is cheaper and clearer.

## What an attached editor gets

Vim itself, plus `scrolloff`, yank highlighting, extmarks and decoration providers, IM and composition tracking, mode autocommands, the sign, mark, status and line-number columns, `cursorline`, the animated cursor and the fold column. Which-key and the status-bar mode indicator follow focus.

Markdown-specific features stay out: table navigation, Markdown folding, the Markdown treesitter bridge, snippets, and the undo tree and change list, which belong to the active note. See [[known-limitations]].

**Line numbers.** Vim Motions installs its own gutter, honouring `number`, `relativenumber` and `numberwidth`. Remove your own line numbers while attached — put them in a `Compartment` and reconfigure it to `[]` — or the view shows two gutters.

## Language providers

```typescript
const dispose = api.registerLanguageProvider({
    id: 'my-plugin',
    matches: (view, pos) => isCode(view, pos),
    hover: (view, pos) => showHover(view, pos),
    definition: (view, pos) => goToDefinition(view, pos),
    codeAction: (view, pos) => quickFix(view, pos),
    format: (view, pos) => format(view, pos),
    diagnostics: (view) => myDiagnostics(view), // { from, to, severity, message, source? }
});
```

Every method is optional. `matches` decides where the provider applies, so a provider can cover fenced code blocks in a note as well as its own editors.

Unimplemented `vim.lsp`/`vim.diagnostic` functions keep Neovim-compatible warn-once behaviour: calling one logs a line and returns a no-op instead of failing, so an existing configuration keeps running.

This drives `gd`, `<C-]>` and `K`, which fall back to Markdown link navigation where no provider matches; `]d`/`[d`, which wrap around the document; and the Lua functions `vim.lsp.buf.hover`, `.definition`, `.declaration`, `.type_definition`, `.code_action` and `.format`, plus `vim.diagnostic.get`, `.count`, `.goto_next`, `.goto_prev`, `.jump` and `.severity`. There is no `vim.lsp.get_clients`: nothing here is an LSP client.

The newest provider whose `matches` returns true and which implements the method wins. Registering the same `id` again replaces the earlier provider. Exceptions and rejected promises are caught, logged and shown in a notice.

## Other methods

- `isAttached(view)` — whether Vim Motions is attached to that view.
- `onModeChange(view, callback)` — mode changes in **any** Vim editor, including Obsidian's own. Useful for behaviour tied to leaving insert mode, such as dismissing an inline suggestion.
- `recordJump(view)` — records the cursor in the jump list before your plugin moves it, so `<C-o>` comes back. Editors outside the vault are skipped, since the jump list stores vault paths.

## Limits

- Bundled fork mode only.
- `path` is informational: marks, harpoon and the jump list still key on vault paths, so `file:` editors do not take part.
- One host per view. Attaching again replaces the previous handle.
