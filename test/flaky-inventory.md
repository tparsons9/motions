# Intermittently failing tests

Every test that fails intermittently is a defect. The only question is where:

- **Test-side** — the test does not control a precondition, so it sometimes
  exercises the buggy path and sometimes does not.
- **Product-side** — the product is nondeterministic, so the same inputs
  sometimes produce the bug.

There is no third category. An environmental condition outside our control
(GPU compositing, runner speed) is still test-side: the test must assert or
skip on that condition explicitly rather than silently vary.

## Rules

1. **No entry may terminate at "flaky."** That word has repeatedly been used
   in this repository as a synonym for "unexplained," which is how `g-` — a
   real bug that broke the feature for every user after any file switch —
   survived for months looking like noise.
2. **Classification requires evidence.** Either a root cause, or a forced
   failure. Record observed values, not "it failed" (see
   `.agents/skills/negative-control/SKILL.md`).
3. **Forcing failure comes before fixing.** You cannot reliably force a
   failure you do not understand, so a forced failure _is_ the proof that the
   mechanism is known. N green runs never prove determinism; the 110/110 green
   run on `0815d5c` was luck, and the same commit failed twice on re-run.
4. **A fix is proven by the forcing probe going green**, not by CI passing
   once.

## Inventory

| Test                                                                       | Platform  | Observed                | Status                                                                                                                                                       |
| -------------------------------------------------------------------------- | --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `g- does not crash at root`                                                | all three | 4 runs                  | **Resolved — product.** Stale `this.undoTree` captured at registration; `activateUndoTreeForFile()` swaps it per note. Fixed in `ff8442a`.                   |
| `zc on callout folds it`                                                   | macOS     | 3/5, then 2/3           | **Resolved — environment.** The CI window starts without OS focus; waiting for it to arrive fixes the suite (0/8 cold failures, 0 skips). 16/16 correlation. |
| `editor:unfold-all clears all folds including custom`                      | macOS     | with the above          | **Resolved — environment.** Same cause.                                                                                                                      |
| `cursor follows cursor movement`                                           | macOS     | 2 of last 3             | **Resolved — environment.** Same unfocused-window cause as the fold pair; `document.hasFocus()` matched the outcome 8/8. No link to #181.                    |
| `]3 should jump to next H3`                                                | macOS     | 3/5                     | Unknown. Candidate: the same toggle race, since `beforeSuite` cycles vim before every spec.                                                                  |
| `the animated cursor picks up a shape change (#181)`                       | macOS     | 1                       | Unknown. Fails on its canvas-paint precondition, not on the scroll defect #181 describes.                                                                    |
| `focuses the expected pane in all four directions`                         | macOS     | 1                       | Unknown.                                                                                                                                                     |
| `"after each" hook — RPC key delegation`                                   | macOS     | 1                       | Unknown.                                                                                                                                                     |
| `"after each" hook — RPC structural navigation`                            | Linux     | 2/5 in CI, ~1/3 locally | Unknown. A cascade, not a cause: the session dies in the preceding test.                                                                                     |
| `matches counted operator-pending heading motion edits`                    | Linux     | 1                       | Unknown.                                                                                                                                                     |
| `matches backward operator-pending heading motion edits`                   | Linux     | 2                       | Unknown. Primary failure in the run whose afterEach then cascades.                                                                                           |
| `matches the fork for operators, visual selections, registers, and counts` | Windows   | 1                       | Unknown.                                                                                                                                                     |
| `which-key shows after space press`                                        | Windows   | 1                       | Unknown. Polls 2000 ms for behaviour gated by `operatorshadowtimeout`'s 1000 ms deferral, so the margin is thin by construction.                             |
| `a config reload closes an open picker instead of leaking it`              | Windows   | 1                       | Unknown. New in `2b6bc75`.                                                                                                                                   |
| `uses the host jumplist for two cross-note older jumps`                    | Windows   | 1                       | Unknown. New in `2b6bc75`; the only failure in its run.                                                                                                      |

## What "resolved" means for the two product bugs

**`g-`** — defect fixed and guarded. `undo-tree.e2e.ts:168` asserts the live
tree's sequence moves, and its negative control was recorded: the unfixed
build reported `Expected: 19, Received: 20`.

**Vim toggle** — defect fixed, and guarded only at the settings level.
`vim-toggle.e2e.ts` "rapid toggle applies both requests and ends enabled"
fails when the cooldown is un-awaited, so it does catch the mechanism.

Nothing asserts the consequence that actually hurt: that extension-slot
features survive a rapid toggle. An attempt to add one was removed because it
could not be made to fail — with the awaited cooldown reverted it still
passed, since the serialised chain and the deferred callback checks prevent
the drop on their own. A test that cannot fail is worse than none, so it went
rather than staying as decoration.

Closing this properly needs a control that reverts all three parts of
`34168dd` at once, not one of them.

## Fold and canvas hold in production CI

Two consecutive real runs after the focus fixes, `f5d3502` and `80d4918`:
zero macOS failures in either, 99 and 98 jobs green. Every CI shard job is a
cold start, which is the condition that used to break both clusters, so this
is the case they used to fail rather than a warm rehearsal.

Remaining in production: the Linux RPC entries, and one Windows jumplist
failure.

## RPC entries: Neovim exits, and the renderer then hangs

Six cold Linux samples, three failures, and the Node-side process state names
the primary event:

|                               | document                 | Neovim             |
| ----------------------------- | ------------------------ | ------------------ |
| boundaries before the failure | 13-32 chars              | `alive:S`          |
| the failing boundary          | unreadable, session gone | **`dead:no-proc`** |

Two replicas showed it on the same test, `matches counted operator-pending
heading motion edits`. The renderer stall is the consequence, not the cause:
the child exits, and the host is left waiting on a process that is gone.

This is the measurement that browser-side probes could never make. Every
failing replica reported `docLength` and `longtasks` as null, because by the
time `afterEach` ran the session had already died. Reading `/proc` from Node
survives that.

Open and user-relevant: why the child exits. A crash in the companion Lua, an
unhandled RPC message, or the operating system reclaiming it are all live,
and they differ in whether a user can hit them. The 30-second request timeout
added earlier should have rejected the pending call when the stream closed,
so the host's handling of a dead child is worth auditing regardless of the
cause.

## RPC entries: narrowed to a native block

`connectionRetryTimeout` did not fix the stall, but it changed a dead session
with no test name into a clean 180-second abort carrying a stack:

    WebDriverError: The operation was aborted due to timeout on execute/sync
      at getEditorValue (test/helpers.ts:39)
      at forkSnapshots (rpc-structural-nav.e2e.ts:161)

Excluded by measurement since:

- **Document size.** 13 to 32 characters at every test boundary up to the
  failure, so `getValue()` is not walking anything large.
- **A JavaScript long task.** None is ever reported. That is consistent with
  being stuck inside one rather than evidence against it, because a
  `PerformanceObserver` emits a `longtask` entry only once the task finishes —
  reading it as "not JavaScript" would have sent the next round chasing GC and
  IPC for nothing.
- **Neovim being dead.** The child is `alive:S`, sleeping normally, at every
  boundary that reports.

So the renderer stops answering `execute/sync` for 180 seconds with a trivial
document and no completed long task. Browser-side instrumentation returns null
once the session dies, which is precisely when the evidence is wanted, so the
process state is now read from Node and survives.

Local rate is roughly one run in six against four in six on CI, so CI remains
the better sampling ground.

## RPC entries: the connection timeout did not fix them

Six cold Linux samples: four failed. The signature is unchanged --
22 `invalid session id` and 2 `Timed out receiving message from renderer:
30.000`, with no failing test names at all, because the session dies before
any test reports.

`connectionRetryTimeout` addresses the HTTP client's patience. The 30-second
limit in the message is ChromeDriver waiting on the renderer, which that
setting does not govern, so the change could not have helped and the quiet
runs since it landed were normal CI happening not to sample the case.

A renderer that stops responding for thirty seconds is a main-thread block.
If it is our main thread it is a user-visible freeze, so this one is not
dismissible as environment until that is settled.

## UI-lifecycle entries: not reproduced, and three replicas were harness noise

Eight Windows replicas: five ran and all five passed; three died in setup on
`EPERM`, which `e2e.yml` retries and the stress workflow did not, so they
looked like spec failures. The retry is now in both.

Focus was reported on every run rather than only on failures. Locally these
specs show `hasFocus` true with `cm-focused` false and the body as active
element, which is expected since neither puts a cursor in an editor -- so the
discriminator that resolved the fold and canvas clusters does not transfer
here, and applying that fix blind could have passed for the wrong reason.

## Canvas entries: resolved

Focusing the window after the spec's own reload cleared them: eight cold
macOS starts, eight passes, no skips, `document.hasFocus()` true on every one.
Against four and five failures in eight before, each failure unfocused.

Placement was what took two attempts. `beforeSuite` runs before the spec calls
`reloadObsidian`, and the reload discards the focus, so the global wait left
five of eight still failing. The call has to come after the spec's own load,
which is what the fold specs were already doing.

|                                    | cold failures | focus on failures           |
| ---------------------------------- | ------------- | --------------------------- |
| before                             | 4/8, then 5/8 | `hasFocus` false every time |
| focus wait in beforeSuite          | 5/8           | false every time            |
| focus wait after the spec's reload | 0/8           | n/a, all true               |

## Canvas entries: the same unfocused window

Eight cold macOS starts with the environment reported unconditionally:

| replicas      | result | reducedMotion | hasFocus |
| ------------- | ------ | ------------- | -------- |
| 1, 3, 4, 6, 7 | fail   | true          | false    |
| 2, 5, 8       | pass   | true          | true     |

`prefers-reduced-motion: reduce` is active on every macOS replica, passing and
failing alike, so it is incidental. On failure data alone it looked like the
cause, because the give-up diagnostic only ran when the test failed; the
passing rows are what excluded it. `document.hasFocus()` matched the outcome
8 times out of 8.

The failing canvas is present, 1024x676 with a matching client rect, display
block and opacity 1 — it exists, is sized and visible, and is never drawn on.

An earlier note here claimed the canvas specs pass while unfocused and used
that to exclude focus for this cluster. That came from a single run in which
only the fold specs happened to fail, and it was wrong.

The focus wait therefore moved from the fold spec to `beforeSuite`, so every
spec gets it rather than the one cluster that was investigated first.

## Fold pair: an unfocused CI window

`document.hasFocus()` matched the outcome 16 times out of 16 across two runs
of eight cold macOS starts:

|            | hasFocus | cm-focused | callout                      | placeholders | result |
| ---------- | -------- | ---------- | ---------------------------- | ------------ | ------ |
| 9 replicas | true     | present    | editable lines               | 1            | pass   |
| 7 replicas | false    | absent     | `.cm-embed-block.cm-callout` | 0            | fail   |

Without OS focus CodeMirror never registers focus, Live Preview keeps the
callout rendered as a widget, nothing can fold inside it, and the document
content is correct throughout — which is why eleven hypotheses looking for a
macOS-versus-Linux behavioural difference found nothing.

Waiting for focus fixes it. `editor.focus()` cannot raise a window and
`Page.bringToFront` addresses the renderer rather than the OS window, so
neither helped. But focus does arrive on a cold start, just not immediately:
`ensureWindowFocused` retries for five seconds, and the suite then runs in the
focused state the assertions need. The skip is a fallback that should rarely
fire.

Measured across eight cold macOS starts per configuration:

|                        | cold failures | suites skipped                                   |
| ---------------------- | ------------- | ------------------------------------------------ |
| no guard               | 2/8, then 5/8 | —                                                |
| focus sampled once     | —             | 6/8, over-skipping suites that would have passed |
| focus awaited up to 5s | 0/8           | 0/8                                              |

Sampling focus once was itself a defect of the same family as a vacuous
assertion: it reported safety that had never been established, disabling six
suites to absorb a failure rate of two to five in eight.

A user's window is focused while they type in it, so this describes the
runner and not the plugin. **The canvas entries are not explained by it**:
both canvas specs ran on the unfocused replicas and passed.

## Fold pair: cause identified, fix not yet found

Live Preview renders a callout as a `.cm-embed-block.cm-callout` widget and
unrenders it to editable lines only once the cursor is inside. On a cold start
the cursor placement had not taken effect when the fold was attempted, so the
callout was still a widget, no placeholder could render inside it, and `zc`
produced nothing.

Measured, cold versus warm on the same runner and commit:

|                           | cold (fail)                          | warm (pass)                                 |
| ------------------------- | ------------------------------------ | ------------------------------------------- |
| callout / embed elements  | 1 / 1                                | 0 / 0                                       |
| third `.cm-content` child | `div.cm-embed-block.cm-callout[125]` | `div.cm-line…HyperMD-callout…cm-active[24]` |
| `.cm-foldPlaceholder`     | 0                                    | 1                                           |

The obvious fix does not work. Waiting for `.cm-embed-block.cm-callout` to
disappear before folding **times out on a cold start**, turning two failures
into four: `callout line is foldable` and `callout fold placeholder contains
callout type` were passing only because `foldable()` returns a range for a
widget-rendered region, so they were passing vacuously in exactly the state
that breaks the other two. The wait was reverted rather than left on master.

So the callout never becomes editable on a cold start, which means the cursor
never lands inside it — `setupEditor`'s cursor placement is not taking effect
there. That is the next thing to measure: the cursor position and editor focus
immediately after `setupEditor` on a cold iteration, not the callout markup
that follows from them.

`waitUntilFoldable` cannot see this: `foldable()` is a state query and returns
a range while the region is still a widget, so the precondition it checked was
not the precondition the assertion needed. `waitUntilCalloutEditable` waits for
the widget to clear.

Reproduced locally on demand, which no earlier hypothesis managed: placing the
cursor outside the callout gives `embed=1` and the widget element, placing it
inside gives `embed=0` and three `HyperMD-quote-1` lines. That is the cold
state on demand, and it also proves the new wait is not a no-op.

Classified **test-side**: a real user folds a callout with the cursor on it,
which unrenders the widget first.

## The fold pair fails on a cold start, and renders differently when it does

Two stress runs, and both failed on **iteration 1**:

|                       | iter 1 (fail) | iters 2-8 (pass) |
| --------------------- | ------------- | ---------------- |
| `.cm-foldPlaceholder` | 0             | 1                |
| `.cm-line` count      | 4             | 5                |
| content height        | 563           | 490              |
| editor height         | 598           | 598              |
| `getMode()`           | source        | source           |
| `directFoldEffect`    | stuck         | stuck            |

The fold reaches state either way. What differs is rendering: on the cold
iteration the callout occupies fewer line elements and more vertical space,
which is a decorated block rather than plain lines, and no fold placeholder
appears. Mode is `source` in both, so this is not reading view.

**This invalidates how the stress tool's rates should be read.** A shard job
in `e2e.yml` runs wdio exactly once, so every real CI job is iteration 1. A
stress run of N iterations contains one cold start and N-1 warm ones, which
is why the same spec measures ~7% under stress and ~60% in CI. Stress
underestimates any cold-start failure by roughly a factor of N.

Refuted along the way: state accumulation within the spec (`foldable` stays
true after all eight tests), and every earlier platform-difference
hypothesis, since the discriminator is warm-versus-cold on one runner rather
than macOS-versus-Linux.

The remaining question is what the callout is decorated with on a cold start.
The next probe should capture the callout element's own markup and computed
box in both states rather than aggregate counts.

## Next hypothesis for the fold pair: state within the spec

Run `35025641995` failed the fold pair again with a payload identical to every
previous one. Comparing it against the always-on probe in the same file is the
part that had not been done:

- the `before()` hook reports `directFoldEffect: "stuck"` — folding works
- `zc on callout folds it` (test 4 of 8) and `editor:unfold-all` (8 of 8)
  produce no fold at all

Folding therefore works at the start of the spec and stops working later in
the same file, on the same runner, in the same process. That is state
accumulating across tests, not a property of the platform — and it is
consistent with every refuted hypothesis so far, all of which looked for a
macOS-versus-Linux difference.

A probe must record foldability after **each** test in `fold-providers`, on a
runner where it fails, and find the first test after which it stops. All eight
pass locally, so this needs CI or a forced local equivalent of whatever that
test leaves behind.

## Canvas entries are intermittent, confirmed

`cursor follows cursor movement` passed on macOS in `35008278154` and failed
on macOS in `35025641995`, with no code change between them affecting it. It
is intermittent on that runner rather than impossible there.

## RPC entries after the connection timeout

Two consecutive runs (`35008278154`, `35025641995`) contain no RPC failures,
against three of five before `9fda566`. Encouraging and far from proven; the
prior green run `0815d5c` was followed by two red ones on the same commit.

## Runner capability, measured

|                    | Linux       | macOS    | Windows     |
| ------------------ | ----------- | -------- | ----------- |
| cores              | 4           | 3        | 4           |
| device memory      | 8 GB        | 8 GB     | 8 GB        |
| WebGL              | SwiftShader | **none** | SwiftShader |
| `directFoldEffect` | stuck       | stuck    | stuck       |

macOS is the only runner with no WebGL context, and the only one where the
canvas entries fail. That is suggestive, but it is **not** a capability wall:
`9fda566` added `canvasPaintSupported`, which skips a canvas spec when 2D
paint and readback are unavailable, and across 36 macOS jobs in run
`35008278154` it never fired. Both canvas tests ran and passed there.

So the canvas entries are intermittent on macOS, not impossible on macOS, and
"a runner artifact that cannot affect real users" is **not** established.

Note the guard checks an offscreen 2D readback, which is weaker than what the
feature needs (an onscreen composited canvas). It not firing rules out the
strongest form of incapability, not every form.

Fold works on all three runners, so no graphics explanation applies to it.

## Do the entries share a cause?

Two structural factors were checked and neither discriminates:

- **Position in the spec file.** Spread evenly (4/8, 8/8, 4/7, 11/16, 2/2,
  11/29, 10/14, 5/14, 1/1, 2/12, 7/10, 24/29), so this is not per-spec setup
  hitting the first tests.
- **Synchronisation style.** `zc on callout folds it` has seven `browser.pause`
  calls and four `waitUntil`s and fails; `which-key`, the operator-pending pair
  and the jumplist entry have none of either and fail too.

What does partition cleanly is the subsystem each one waits on, and it
correlates with platform:

| Cluster         | Entries                                        | Asserts on                                  | Platform         |
| --------------- | ---------------------------------------------- | ------------------------------------------- | ---------------- |
| Rendering/paint | fold pair, animated cursor pair                | CM6 decorations, canvas pixels              | all macOS        |
| RPC lifecycle   | structural-nav pair, text-objects, bridge pair | cross-process parity; two are hook failures | Linux-dominant   |
| UI lifecycle    | which-key, picker leak, pane focus             | transient overlay, modal, focus             | Windows-dominant |

Every entry asserts on state an asynchronous subsystem must produce in
reaction to an event, never on synchronous in-memory state. That is necessary
but not sufficient — most passing e2e tests do the same.

The clustering argues against a single root cause. Treat the three groups as
three investigations, and force each at the conditions its own cluster runs
under.

## Two runs of one commit share no failures

`2b6bc75` was run twice with no code change between them:

| Run A                                                                   | Run B                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `"after each" hook — RPC structural navigation` (Linux)                 | —                                                                 |
| `matches backward operator-pending heading motion edits` (Linux)        | —                                                                 |
| `zc on callout folds it` (macOS)                                        | —                                                                 |
| `editor:unfold-all clears all folds including custom` (macOS)           | —                                                                 |
| `a config reload closes an open picker instead of leaking it` (Windows) | —                                                                 |
| —                                                                       | `uses the host jumplist for two cross-note older jumps` (Windows) |

The sets are disjoint. Whatever selects the failures on a given run, it is not
the commit, so a single green run says nothing and a single red one identifies
only which test drew the short straw that time.

Measured across the five runs containing `34168dd`: the fold pair failed in
three and the RPC structural-nav pair in three, both matching their pre-fix
rates. That is the basis for saying the toggle fix did not touch them.

## Shard numbers do not identify specs

`e2e (macos-latest, shard 3)` reported `cursor follows cursor movement`, but
that test is defined in `animated-cursor.e2e.ts`, which the same round-robin
places in shard 1; shard 3 holds `animated-cursor-scroll.e2e.ts`, which does
not define it. Recomputing the discover job's distribution locally therefore
does **not** reliably reproduce the mapping a given run used.

Read the failing test name from the job log or the step summary. Do not infer
the spec from the shard index, and do not infer a root cause from the spec you
think the shard contains — that is how the #181 attribution above was made.

## Fold providers lost by the vim-mode toggle

Refuted first, so they are not re-tested:

| Hypothesis                       | Measurement                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Key delivery                     | `viaCommand: true, foldedAfterCommand: false` — folding fails through Obsidian's own `editor:toggle-fold` too |
| Degenerate provider range        | `range {from:39,to:88}`, `degenerate: false`                                                                  |
| Viewport too small to parse      | `viewport {from:0,to:106}` over a 106-character document, `viewportCoversLine: true`                          |
| Fold applied but not detected    | `foldedRanges: []`, `placeholders: 0`                                                                         |
| CM6 folding unavailable on macOS | `directFoldEffect: "stuck"` on all three platforms                                                            |
| Obsidian version                 | 1.13.7 on macOS and Linux alike                                                                               |
| Window size                      | 8/8 folds at 1024x676 (macOS CI), 1274x984 (Linux CI), 2538x1380                                              |
| Runner slowness                  | 40/40 folds at CPU throttle 1x, 4x, 8x, 16x, 32x                                                              |

Forced by replaying what `wdio.conf.mts` does before **every** spec — disable
vim, pause, enable vim, pause:

```
pause 800ms -> 6/6 folded (FFFFFF)
pause 200ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause  50ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause   0ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
```

`foldableMisses` equals the failure count exactly: when it fails,
`foldable()` returns null, so `zc` correctly folds nothing. Isolating the
toggle from the editing:

```
baselineFoldable: true -> afterEachCycle: "FFFFFFFF" -> afterSettle3s: false
```

Folding does not recover. A user who toggles vim mode loses folding until
Obsidian reloads.

### Mechanism, as far as it is established

```
disable0 -> vimEnabled false
enable0  -> false            <- fails when it follows a real disable
settled0 -> false, foldable false
disable1 -> false (no-op)
enable1  -> true,  foldable true   <- succeeds when it follows a no-op
```

`enableVim` fails only when it follows a _real_ disable, so `disableVim()`
resolves before its teardown has finished: there is un-awaited async work
continuing past the returned promise, and the enable races it.

Two fixes were attempted and **both proven insufficient**, so neither shipped:

1. Serialising toggles through a promise chain — `FFFFFFFF`, unchanged.
   Serialising on a promise that settles too early cannot help.
2. Deferring the `settings.vimEnabled` check out of the command callbacks —
   `FFFFFFFF`, unchanged. It does fix a real secondary defect
   (`enable-vim-mode` reads the flag synchronously, so with a disable pending
   the enable was never queued at all), but not this.

### The toggle defect is real but is not this cause

`34168dd` fixed a genuine, user-facing bug: a rapid disable/enable left Vim
off and every extension-slot feature unregistered until Obsidian reloaded.
Forced deterministically before the fix, `TTTTTTTT` after it.

It did **not** fix the fold failures. `zc on callout folds it` and
`editor:unfold-all` failed again in `953c8e6` and `4b688c6`, both of which
contain the fix, at roughly the pre-fix rate.

The error was an inference, not a measurement. The forced reproduction used a
**0 ms** gap between disable and enable; at the **800 ms** gap `wdio.conf.mts`
actually uses, the _unfixed_ code folded 6/6. Claiming CI was affected
required assuming a slow macOS runner makes 800 ms behave like 0 ms, which
was never measured and is now refuted.

The fold cause is therefore still unknown, and this is the eleventh refuted
hypothesis for it. Anything proposed next must be forced at the gap CI
actually uses.

### Toggle fix detail (`34168dd`)

Both `disableVim` and `enableVim` cleared `toggleInProgress` from a 500 ms
timer armed in `finally`, so the returned promise resolved while the flag was
still set. The opposite toggle, arriving inside that window, hit its own guard
and was discarded with nothing to retry it.

Three changes were needed, and each was individually insufficient:

1. **Await the cooldown** before clearing the flag, so the promise reflects
   completion. The chain alone still resolved into the window.
2. **Serialise toggles** through a promise chain, so the next starts after the
   previous finishes.
3. **Defer the `settings.vimEnabled` check** out of the command callbacks.
   Reading it synchronously made `enable-vim-mode` skip queueing a toggle whose
   predecessor had not yet updated the flag, so the guard was never reached.

The probe now reports `afterEachCycle: "TTTTTTTT"` with `vimEnabled: true`.

`vim-toggle.e2e.ts`'s `rapid toggle is debounced` asserted `vimEnabled` false
after a rapid disable/enable — the dropped request, encoded as intent. It now
asserts the state that was asked for. This is a deliberate behaviour change:
a rapid double toggle applies both halves instead of swallowing the second. If
the debounce was guarding against real thrash, the better design is coalescing
(record the desired end state, apply once) rather than applying both.

### Every extension-slot feature was exposed

`setupVimSubsystems()` nests the per-feature slots inside the one the toggle
emptied — `animatedCursorSlot` (`src/main.ts:2831`), `undoTreeSlot` (:2746)
and the three snippet slots (:2785-2787). A dropped enable therefore took all
of them down together, not folding alone.

That makes one mechanism a candidate for several entries above, including
both animated-cursor entries, whose CI signature is a canvas that never
paints. **Not yet confirmed by measurement.** Two probe attempts failed on their own
preconditions rather than on the subject:

1. `setPluginSetting` stores the value without reloading features, giving
   `canvases: 0` at baseline. Use `setPluginSettingAndReload`.
2. With that fixed, `canvases: 1` but `painted: false` _at baseline_, before
   any toggling — the canvas is sampled once after 500 ms, while the real
   assertion polls up to 5.4 s (`pollPaintedCursor`). A single sample is too
   early to mean anything.

A valid probe must reuse the spec's own polling helper rather than a
point-in-time read. Until then this remains a source-level observation.

### Why this may not be only about folding

`wdio.conf.mts` cycles vim mode before every spec, and `AGENTS.md` records
that `animatedCursor`, `enableSnippets`, `snippetTriggerMode` and
`enableUndoTree` all shipped broken for want of a runtime slot. Any
extension-slot feature is exposed to the same teardown race, so this one cause
may account for several macOS entries above. Test them against this lever
before investigating them separately — `34168dd` may already have cleared
some of them, which the next CI run will show.
