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
| Production build | `npm run build` |
| Dev server | `npm run dev` |

The browser suite needs Chromium once per machine
(`npx playwright install chromium`). It starts its own dev server on
`127.0.0.1:3000` and will not adopt one that is already running, so stop yours
first. All four gates run in CI on pull requests and again before deployment;
there they run as parallel jobs, with the browser suite split across six shards
at two workers each, and its Chromium restored from cache.

Four environment variables shape a browser run. Two of them are the difference
between a suite you can iterate on and one you cannot:

| Variable | Effect |
| --- | --- |
| `GAME_TEST_GL=d3d11` | Renders on the machine's actual GPU instead of SwiftShader: **twenty-three minutes becomes two and a half.** Use it for every local run that is not producing reference frames. |
| `GAME_TEST_CAPTURE=1` | Writes the reference frames. Off by default — nothing asserts on a PNG, and drawing them is the expensive half of the suite. Needed only when reviewing the art, and then on SwiftShader, since the baseline in `output/shots/baseline/` came off that renderer. |
| `GAME_TEST_WORKERS` | How many scenarios run at once. One locally; CI sets two. Nothing here measures wall-clock time, so this is a throughput knob, not a correctness one. |
| `GAME_TEST_PORT` | Moves the dev server, so two checkouts can verify at once. |

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
- **Keep pure rules pure.** `dungeon-floor.ts` and `dungeon-combat.ts` must
  stay free of React, DOM and Three.js imports so node's type stripping can
  execute them directly in tests.
- **Add regressions alongside behaviour changes.** A gameplay fix without a
  test in `tests/` or `tests/browser/` is not finished.

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
