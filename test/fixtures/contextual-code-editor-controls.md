# Contextual editor regression controls

The tests use the bundled Vim engine; the Obsidian fixture explicitly disables the Neovim backend.

## Negative controls observed

Temporary source mutations were removed after observing these failures:

| Mutation                                                            | Assertion that failed                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Register a first local mapping by unconditionally unmapping its lhs | The engine stack contained only `local`, losing the underlying `global` mapping.                              |
| Ignore focused/scoped editors in `LuaEditorContext.current()`       | Focus returned `note.md` instead of `file:/repo/app.py`; nested background callback paths were all `note.md`. |
| Apply an empty local-option compartment                             | Two code panes retained tab widths `[8, 8, 8]` instead of `[4, 4, 8]`; reload retained 8 instead of 2.        |
| Make `BufferHints.set()` a no-op                                    | The active label was `Find code` instead of the explicitly configured `Project files`.                        |
| Remove the signature-help dispatch entry                            | The Lua result was `nil` instead of `true`, with no provider dispatch.                                        |

With the implementation restored, the full unit suite passed: 152 files, 3,425 tests passed, 102 skipped. One concurrent run exceeded the existing five-second TypeScript compiler-test timeout; rerunning the suite alone passed without modifying that test or its timeout.

Additional cleanup controls made `detach`, `clear`, and hint `release` no-ops. Detach left widths `[4, 4]` instead of `[8, 4]`; clear retained the two-space indent instead of the host tab; released hints still displayed `Code` instead of `Shared`.

A rebuilt Obsidian control disabled mapping activation and contextual hint composition. All four new runtime tests failed on behavioral assertions: code callbacks returned `shared` instead of `python`; wrapped-line `j` stayed on document line 1 instead of line 2; `I` landed at column 0 instead of 2; `A` landed at offset 1 instead of 152; the popup omitted `Code`. The source was restored and rebuilt before the positive run.

## Runtime coverage

`test/specs/contextual-code-editor.e2e.ts` exercises native Markdown plus background-attached Python, TypeScript and external Markdown editors in real Obsidian. It checks focus switching and shared callback restoration, indentation, standard j/k/I/A, shared-path pane retention, file changes, contextual Code hints, and reload removal of local callbacks/maps. The existing external-editor E2E suite covers editing, mode reporting, gutters, host save/close, reload and detach. Registry and language-provider unit tests cover destroyed editors, registry teardown, provider dispatch and fallback behavior.

The unit suites additionally check scoped exception cleanup, local option cleanup and queued-write cancellation, local/global map deletion and restoration, mode-specific hints, and rejection of a local mapping when no buffer exists.
