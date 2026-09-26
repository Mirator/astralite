# Working in this repository

## Where things are

The application lives in `game/`; there is no root package manifest, so run
every package command from `game/`. `output/` holds playtest artifacts from
past sessions and `plans/` holds implementation plans. Node 22.13 or newer.

## Commands

| Purpose | Command |
| --- | --- |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Node suite (generator, combat rules) | `npm test` |
| Browser suite (real game, Playwright) | `npm run test:browser` — on Windows prefix `GAME_TEST_GL=d3d11` and it is ten times quicker |
| Browser stability | `npm run test:browser -- --repeat-each=3` |
| Browser suite as the PR gate runs it | `npm run test:browser -- --grep-invert "@capture\|@nightly"` — tags explained in `game/tests/README.md` |
| Before/after contact sheet (art changes) | `npm run shots:compare` — `game/tests/README.md` has the options |
| Figure bench (every figure, every facing, one sheet) | `npm run figures` — dev-only `/bench` route, `game/tests/README.md` has the iteration loop |
| Production build | `npm run build` |
| Dev server | `npm run dev` |

The browser suite needs Chromium once per machine
(`npx playwright install chromium`). It starts its own dev server on
`127.0.0.1:3000` and will not adopt one that is already running, so stop yours
first. All four gates run in CI on pull requests and again before deployment;
there they run as parallel jobs, with the browser suite split across three
shards at two workers each, and its Chromium restored from cache.

A worker boots one page and resets it between scenarios rather than loading one
per test, which is where most of the suite's time used to go. Three specs opt
out with `test.use({ isolate: true })` because they assert on what a boot does,
and a scenario that changes context options - a phone viewport, touch, a stored
settings blob - gets its own page automatically. Every pooled scenario ends by
resetting back to the booted state and holding the whole snapshot against it, so
state left behind fails the scenario that left it rather than the next one along.
If you need something reset, reset it in `dungeonTest.reset`; widening `DRIFTS`
in `tests/browser/helpers.ts` hides the problem instead of fixing it.

Four environment variables shape a browser run. Two of them are the difference
between a suite you can iterate on and one you cannot:

| Variable | Effect |
| --- | --- |
| `GAME_TEST_GL=d3d11` | Renders on the machine's actual GPU instead of SwiftShader: **twenty-three minutes becomes two and a half.** Use it for every local run that is not producing reference frames. |
| `GAME_TEST_CAPTURE=1` | Writes the reference frames. Off by default — nothing asserts on a PNG, and drawing them is the expensive half of the suite. Needed only when reviewing the art, and then on SwiftShader, since the baseline in `output/shots/baseline/` came off that renderer. |
| `GAME_TEST_WORKERS` | How many scenarios run at once. One locally; CI sets two. Nothing here measures wall-clock time, so this is a throughput knob, not a correctness one. |
| `GAME_TEST_PORT` | Moves the dev server, so two checkouts can verify at once. |
| `GAME_TEST_ISOLATE=1` | Boots a page per scenario, as the suite did before pooling. This is the oracle: a nightly run on main compares it against the pooled path, and a disagreement means a reset is not restoring something a boot sets. Reach for it when a pooled failure looks like contamination. |

The two combine: `GAME_TEST_GL=d3d11 GAME_TEST_CAPTURE=1 npm run test:browser`
gives you frames quickly, but they are a different renderer's output and are
not comparable with the baseline. A reviewable set comes from the `captures`
input on the Verify and Deploy workflow.

## Input and time hooks

The running game installs `window.render_game_to_text()`,
`window.advanceTime(ms, draw)` and `window.dungeonTest.*` while it is mounted.
They exist for the console and for automated drivers; nothing in the game calls
them. `advanceTime` stops the automatic frame loop on its first call, so a
deterministic test calls `advanceTime(0)` before doing anything else. Prefer
real keyboard, pointer and button input for the behaviour under test; the hooks
are for fixture setup and for reading state back. `game/tests/README.md` is the
reference.

## Conventions

- **Minimal HUD.** Vitality, dash readiness and rank progress sit on screen;
  controls, statistics and the floor map belong in menus. Do not add
  persistent overlays.
- **Match the surrounding code.** `dungeon-game.tsx` is deliberately dense.
  Edit it in place; do not reformat it, and do not run a repository-wide
  formatter pass as part of an unrelated change.
- **Keep pure rules pure.** `dungeon-floor.ts`, `dungeon-combat.ts`,
  `dungeon-player.ts`, `dungeon-input.ts`, `dungeon-fixture.ts`, `dungeon-nearest.ts` and `dungeon-hits.ts` must stay
  free of React, DOM and Three.js imports so node's type stripping can execute
  them directly in tests. A rule that decides something belongs in one of them
  (or a sibling like `dungeon-sim.ts`), not in the world closure.
- **Add regressions alongside behaviour changes.** A gameplay fix without a
  test in `tests/` or `tests/browser/` is not finished, and the test has to
  fail without the fix (see "Writing tests that can fail" below).

## Writing tests that can fail

A September 2026 audit found about twenty tests that passed with the behaviour they named deleted, one that
had skipped on every run for months, and a pruning that replaced fast node tests with slower browser tests
that could not fail. These rules are what it took to fix them; follow them for every test you add or change.

- **Prove it fails.** Before a test counts as done, plant the bug it names (temporarily, then restore) and
  watch it fail with its own message, not some other assertion's. Say in the commit or PR which bug you
  planted. A test that passes with the feature removed is worse than no test: it reports coverage that
  is not there. If a planted bug survives, either the test is weak or your bug was not a real break (the
  blur's `clearInput` is redundant with the pause's `keys.clear()`). Find out which.
- **Assert the precondition.** Check that the thing that makes the assertion meaningful actually happened:
  the pounce fired before "the dodge evaded it", the blow landed before the budget frame is measured, the
  race window was hit, the cape had settled before the dash moved it, the knight stood in the enemies'
  room. An outcome that also holds when nothing happened proves nothing.
- **No silent skips and no conditional expects.** A pinned seed that no longer stages the fixture is a
  failure that says "pick another seed", never `test.skip` at runtime. No `if (x) expect(...)`, no loop over
  a list that can be empty without a length check first.
- **Observe, don't recompute.** A snapshot or diagnostic field must report what the game did (what the
  scene placed, what was drawn, which material a mesh wears), not what a planner or the same formula says it
  should have done. Comparing the planner with itself, or build-time data with itself, cannot fail.
  `graphics` in the snapshot is build output; per-frame state belongs elsewhere (`mood.halos`).
- **Test the rule where it lives.** A decision belongs in a pure module with a node test in `tests/`; the
  browser suite checks that the running game is wired to it: real keyboard, pointer and touch, drawing,
  boot. Do not delete a node test because a browser test also touches the behaviour; the node test is
  faster, more direct and easier to make fail. Only remove a test when you can name what else catches the
  same regression at the same level, and say so in a comment where it was.
- **Bound both sides, from measurements.** A ceiling alone passes an empty frame. Set thresholds from
  measured values and write the measurement, renderer and date beside them. Before loosening a threshold to
  get green, show the failure is not a real bug (the flooded fire check was loosened fourteen minutes before
  the halo bug it was flagging was found and fixed).
- **Isolate what a pixel test measures.** Difference two frames that differ only in the thing under test,
  and remove confounds (the telegraph test hides the enemy's body, which flashes the same red). Log the
  numbers so a failure can be read without re-running it.
- **One story per page.** A pooled reset costs a floor rebuild; stepping the clock is nearly free. Merge
  scenarios that share their setup instead of paying for the setup twice. An expensive repeat of a path the
  gate already covers once (a phone aspect, the other enemy kinds) can be `@nightly`; say why in a comment.

## Shared and generated files

`game/progress.md` is the shared development log; append to it rather than
rewriting earlier entries. `output/` is a record of past sessions — read it,
do not rewrite it. Generated output (`dist/`, `.next/`, `.vinext/`,
`test-results/`, `playwright-report/`, `tsconfig.tsbuildinfo`) is ignored and
must not be committed; `npm run typecheck` disables incremental output for
exactly that reason.

## Publishing

Do not deploy, push, merge or trigger a workflow unless the task explicitly
asks for it. Committing is likewise opt-in.
