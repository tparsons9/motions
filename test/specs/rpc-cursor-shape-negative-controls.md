# RPC per-mode cursor shape negative controls

Controls for `test/specs/rpc-cursor-shape.e2e.ts` (**5 passing**). Each sabotage
was restored and the spec returned to 5 passing, 0 failing.

1. **Cutting the `setExternalCursorMode(mode)` forward in `setExternalVimMode`**
   produced **3/5 passing**. `shows the insert caret once Neovim enters insert
mode` and `restores the block cursor when the backend disconnects` both
   failed at `Expected: not "rgba(0, 0, 0, 0)"` — the caret stays transparent
   because the fork's own vim state never leaves normal. The three block-cursor
   cases stayed green, which is the point: they describe the unfixed behaviour
   and cannot distinguish a fix from its absence on their own.

2. **The fork's own suite is unchanged.** `npm test` in `~/Repos/codemirror-vim`
   reports **1883 passing, 1 failing** both with and without the change, the
   single failure being `vim_increment_octal` (`Expected 001 to be equal to
000`), which is pre-existing and unrelated. Verified by stashing
   `src/block-cursor.ts` and `src/index.ts` and re-running.

## Rejected approach, kept because the failure is not obvious

Writing `insertMode`/`visualMode`/`overwrite` into `cm.state.vim` from the host
and dispatching a transaction to force a redraw **works for the cursor** and was
green on this spec. It was rejected on measurement:

| Spec                   | With the host hook    | Without it |
| ---------------------- | --------------------- | ---------- |
| `rpc-ime.e2e.ts`       | 2 passing, 3 failing  | 5 passing  |
| `rpc-lifecycle.e2e.ts` | 11 passing, 2 failing | 13 passing |

`cm.state.vim` is shared with the status bar and the mode tracker, and the
dispatched transaction disturbs the RPC composition input. Neither spec is
obviously cursor-related, so both are the standing gate for cursor work.

The same hook also broke `Escape` from insert mode, which was briefly mistaken
for an independent defect in key delegation. It was not: with the hook removed,
a probe driving `i` then `Escape` through real WebDriver keys reports Neovim
mode `n`, focus never leaves `cm-content`, and the composition input never takes
focus. The round-trip assertion in this spec covers it.
