# RPC popup-menu and mode-status negative controls

Run against Neovim 0.12.5 with `npm run build:ci-test` before each WDIO invocation. Every sabotage was restored after the observed failure.

## M8c: ignore `popupmenu_select`

Removed the `popupmenu_select` dispatcher registration from `NeovimPopupMenuOverlay`. The second-Tab scenario timed out waiting for selected index 1 because row 0 remained highlighted. Result: **3 passing, 1 failing** in `rpc-popupmenu.e2e.ts`.

## M8c: always use command-line anchoring

Forced every `popupmenu_show` event through the `grid === -1` branch. Insert completion had `grid=1`, no command-line element, and therefore rendered with `style.left` unset (`null`) instead of the measured grid anchor (`32px` in that run). Result: **3 passing, 1 failing** in `rpc-popupmenu.e2e.ts`.

## M8d: suppress `msg_showmode`

Suppressed the call to `VimModeTracker.setExternalMode()` in the `msg_showmode` handler. The insert, insert-to-normal, and visual-line scenarios retained the fork's `NORMAL` / `data-vim-mode="normal"` status instead of `INSERT` / `insert` or `V-LINE` / `v-line`; the disconnect scenario also failed at its insert-mode precondition. Result: **7 passing, 4 failing** in `rpc-lifecycle.e2e.ts`.

## Insert-completion anchoring

The insert-completion placement assertion was previously compared against
`expectedGridAnchor()`, a spec-local helper that recomputed the production grid
arithmetic. It therefore held for any anchor the implementation chose and is the
"expected value produced by calling the same code under test" shape from
`.agents/skills/negative-control/SKILL.md`. It passed throughout while the popup
rendered **806.9px** from the cursor. The helper is deleted; both insert cases
now compare against `view.coordsAtPos(view.state.selection.main.head)`.

1. **Before the fix**, the new `anchors insert completion at the real cursor`
   case reported `Expected: < 24`, `Received: 806.931` on a 45-character line,
   while the old grid-anchor case still passed — which is the vacuity being
   demonstrated, not an incidental detail.
2. **After anchoring to the cursor but before the re-anchor**, the same case
   reported `Received: 399.531`. Instrumenting the failure showed `styleTop`
   already exactly equal to `coords.bottom - viewRect.top`, so the vertical
   anchor was correct and only the horizontal lagged: CM6 had not yet applied
   the completed text when `popupmenu_show` was handled (`docTail` read
   `"…lazy dog alpha"` at assertion time, one edit ahead of the anchor).
3. **Scheduling the re-anchor on `requestAnimationFrame`** left the figure at
   `399.531` byte-for-byte, proving a frame is not a synchronisation point for
   the notification stream. Re-anchoring from `NeovimDocumentSync`'s mirror
   observer instead brings it inside tolerance.
4. **Restoring the old grid arithmetic** with the new assertions in place
   reports `Expected: 32`, `Received: 783.453`, so the replacement assertions
   fail against the behaviour they were written to reject.
