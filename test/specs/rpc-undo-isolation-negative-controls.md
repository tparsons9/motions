# RPC undo isolation negative controls

`test/specs/rpc-undo-isolation.e2e.ts` was written before the fix, against the
defect, which is the strongest control available. All five assertions failed on
the unfixed build and all five pass after it, with `rpc-folds-undo.e2e.ts`
(9 passing) unchanged either side.

## Red-first evidence, measured on the unfixed build

| Assertion                                      | Expected                 | Received             |
| ---------------------------------------------- | ------------------------ | -------------------- |
| a freshly activated note has no undo history   | `seq_last` 0             | **4**                |
| undo right after activation does not empty     | `BBBB gamma\nBBBB delta` | **`""`**             |
| previous note text never resurfaces            | second body              | object diff, 2 lines |
| second note intact on disk after an undo burst | second body              | object diff, 3 lines |
| an edit within the current note still undoes   | second body              | object diff          |

The disk assertion is the one that establishes severity rather than mere
incorrectness: the emptied buffer reached `Target.md` through the line-event
mirror, so this was data loss and not a display fault.

The headless reproduction that preceded the spec is narrower than the real
session and understates the defect. Driving `activateDocument()`'s exact call
sequence from a Lua script reports `seq_last = 1`, because changes made without
an intervening `u_sync()` join one undo block; real keystrokes produce separate
blocks and reach 4. Both reproduce the same end state — `u` returns the buffer
to the empty state it had at `nvim_create_buf`.

## Fix boundary

`undolevels` is saved and restored around the reseed. Reading it yields the
`-123456` "use the global value" sentinel when no buffer-local value is set, so
the restore does not pin a buffer-local value; measured directly, a later
`vim.go.undolevels = 500` still reaches the buffer afterwards. Candidate B from
`:help clear-undo` (a dummy change at `undolevels = -1`) also worked but left
`seq_last = 2` and modified buffer content, so it was rejected.

The fifth assertion exists because the obvious over-correction — clearing undo
on every sync rather than on activation — would satisfy the first four and
break ordinary editing. On the unfixed build it also fails, and for the same
reason as the rest: `u` empties the buffer instead of reverting one edit.
