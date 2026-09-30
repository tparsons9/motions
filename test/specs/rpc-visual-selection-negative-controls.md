# RPC visual-selection negative controls

`test/specs/rpc-visual-selection.e2e.ts` (**8 passing**) was written red-first.

## Red-first evidence

Before the fix, 5 of the 5 original assertions failed at
`CM6 to receive a non-empty selection in visual mode`: the bridge sent a caret
and nothing else, so CM6's selection was empty in every visual mode and there
was nothing for Obsidian to paint.

## Control: the feature disabled

Returning `null` from `visualKind()` produced **1 passing, 7 failing**. The one
that stays green is `leaves visual mode when Escape is pressed`, which is
pre-existing behaviour the spec exists to protect rather than to introduce — see
below for why it is in this file at all.

## The rejected first implementation, and why the Escape test exists

The obvious implementation mirrors Neovim's range into CM6's own
`EditorSelection`. It renders correctly and it **breaks Escape**: with a
non-empty selection in the editor, Obsidian consumes the Escape keydown before
the RPC delegation listener on `contentDOM` sees it, so visual mode can be
entered and never left.

Measured, with the selection-based implementation in place:

| Step                                                     | Neovim mode |
| -------------------------------------------------------- | ----------- |
| `v`                                                      | `v`         |
| `<Esc>`                                                  | **`v`**     |
| `document.getSelection().removeAllRanges()` then `<Esc>` | **`v`**     |

Clearing the DOM range did not help, which rules out the rendered range and
points at CM6's selection state. Disabling the feature entirely restored
`n` after `<Esc>`, which is what attributes the regression to the selection
mirroring rather than to anything pre-existing. Focus was `cm-content`
throughout and identical before and after, so it is not focus theft.

The shipped implementation renders the range as a decoration instead and leaves
CM6's selection a caret. `keeps the CM6 selection a caret while visual mode is
active` and `leaves visual mode when Escape is pressed` are both in the spec to
stop that being "simplified" back into a real selection; the first fails
immediately under such a change, the second fails the moment Escape stops being
delivered.

## Coverage note

`renders a backward charwise selection` and
`renders a forward charwise selection inclusive of the head character` are
separate cases because Neovim's selection includes the character under the head
while a CM6 range excludes its `to`: the end that gets extended differs by
direction, and a single-direction test passes with the extension applied to the
wrong end.
