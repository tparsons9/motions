# RPC capability-probe negative controls

Controls for `test/specs/rpc-lsp-capability.e2e.ts` (**8 passing**) and
`test/specs/rpc-native-capability.e2e.ts` (**10 passing**). Every sabotage below
was restored and both specs returned to 8/10 passing, 0 failing, with
`git status --porcelain src/` reporting no modifications.

Each source sabotage was rebuilt with `npm run build:ci-test` before the run.
One intermediate run omitted the rebuild and produced a spurious `:global`
failure from a stale bundle; it is excluded, and control 7 is the rebuilt rerun.

## Source sabotages

1. **`parseVirtualText()` in `src/rpc/decorations.ts` returning `[]`** produced
   **7/8 and 5/10 passing**. `renders LSP diagnostic virtual text` timed out
   waiting for the widget. Both `renders eol virt_text` and `renders inline
virt_text` failed. Most importantly all three `does not render …` cases
   failed at their **positive control**, not at the absence assertion —
   `the virt_text positive control to render, which must happen before any "not
rendered" claim is meaningful` — proving those three cannot pass by accident
   when extmark forwarding is broken outright.

2. **`parseGroup()` in `src/rpc/decorations.ts` returning `null`** produced
   **6/8 passing**. `renders LSP diagnostic virtual text` reported
   `Expected value: "vim-hl-DiagnosticVirtualTextError"`, `Received array: []`.
   `renders LSP diagnostic underline` lost its mark decoration entirely and
   timed out. Text still crossed, so this isolates the highlight group from the
   virtual text itself.

3. **Replacing `nvim_command ['filetype detect']` with a no-op echo in
   `src/rpc/document-sync.ts`** failed the `before` hook, so the whole spec
   reported **1 failing**. The diagnosis printed `"filetype": ""` (was
   `"markdown"`) and `"clientsAnywhere": []`, while still reporting
   `"configLoaded": true` and `"serverRegistered": "function"` — the client did
   not attach because filetype detection stopped, not because the fixture
   server was broken.

4. **`const name = file.path` instead of `adapter.getFullPath(file.path)` in
   `src/rpc/document-sync.ts`** produced **7/8 passing**.
   `mirrors the note under its real absolute vault path` failed with the
   expected value being the vault's own `…/test-vault-XXXX/Welcome.md` and the
   received value being `<repo-root>/Welcome.md` — Neovim resolved the relative
   path against its own cwd, which is the silent wrong-path failure the
   assertion exists to catch. The LSP client still attached, so the two
   assertions are independent.

5. **Early `return` in `NeovimFloatingWindows.render()`
   (`src/rpc/floating-windows.ts`) plus `ext_popupmenu: false` in the
   `nvim_ui_attach` options (`src/rpc/decorations.ts`)** produced **6/8
   passing**. `renders LSP hover as an Obsidian float overlay` and
   `renders server completion items in the Obsidian popup menu` each failed,
   and nothing else did, so neither test is coupled to the other's transport.

6. **Early `return` in `applyLines()` (`src/rpc/document-sync.ts`)** produced
   **9/10 passing**. `mirrors :global buffer edits back into the Obsidian
editor` timed out on `:global deletions to reach CM6 through the line-event
mirror`; the Neovim-side buffer still changed, so the assertion measures the
   mirror rather than Neovim.

## Spec-side controls

7. **Swapping the `virt_lines` probe for a `virt_text` probe** (a field the
   bridge does carry) flipped `does not render virt_lines` to
   `Expected: false`, `Received: true`. The absence assertion therefore
   discriminates between a carried and a dropped field rather than always
   holding.

8. **Inverting the sign-column guard to `toContain('E>')`** reported
   `Expected substring: "E>"`, `Received string: "aa"`. The received value is
   real gutter content, which is what the permanent
   `expect(gutters.length).toBeGreaterThan(0)` self-guard protects: a selector
   matching nothing would otherwise satisfy the absence assertion for free.

9. **Inverting the line-highlight guard to `toBeGreaterThan(0)`** reported
   `Expected: > 0`, `Received: 0`, confirming the
   `.cm-line.vim-hl-ErrorMsg` query is evaluated and returns a real count. The
   permanent `expect(counts.lines).toBeGreaterThan(0)` guard covers the
   zero-rendered-lines case.

10. **Clearing `buftype` before the late `vim.lsp.enable()`** failed the test at
    its own precondition, `Expected: "acwrite"`, `Received: ""` — the test
    verifies the premise it reasons from rather than assuming it.

11. **Inverting `attachedByEnable` to `toBe(true)`** reported `Expected: true`,
    `Received: false`, confirming the assertion is reached and reflects live
    client state. The test's in-body positive control
    (`attachedByExplicitStart`) stays `true` throughout, which is what
    attributes the failure to `buftype` rather than to the fixture server.

12. **Wrong expected values for the four data assertions** each failed against
    real Neovim output: `nvim_eval('1 + 2 * 3')` reported `Expected: 8`,
    `Received: 7`; `system({progpath, '--version'})` reported
    `Expected substring: "SYSTEM_CONTROL_WRONG"`, `Received string: "NVIM
v0.12.5…"`; the quickfix and spell object comparisons failed on the single
    changed field (`text`, `word`). These are assertion inversions rather than
    subject sabotage, because the subject is the RPC channel itself.

## Vacuity finding fixed before controls were run

`detects the markdown filetype before buftype becomes acwrite` originally
created its **own** scratch buffer and re-enacted the plugin's ordering, so it
asserted a fact about Neovim rather than about the plugin and would have kept
passing if `filetype detect` were removed from `activateDocument()` entirely.
Control 3 would not have failed it. It was replaced with
`runs filetype detection on the mirrored buffer and leaves it acwrite`, which
reads the live mirror buffer and does fail under control 3.
