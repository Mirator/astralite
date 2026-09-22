# Plans

Implementation handoffs for the Drowned Keep. Each file is self-contained: read
it fully before starting, run its gates, and record the outcome in the row
below. A plan is not permission to publish — no push, merge or deploy unless
the operator asks.

| Plan | Priority | Status | Evidence |
| --- | --- | --- | --- |
| [001 — Make gameplay verification portable and required](001-verification-baseline.md) | P1 | Done, committed 2026-09-14 on `fix/combat-integration-and-ci` | See below |
| [002 — Make attacks, damage mitigation, and boon transitions consistent](002-combat-integrity.md) | P1 | Done, committed 2026-09-14 on `fix/combat-integration-and-ci` (Salt Ward keeps the later rule: enemy steel only) | See below |
| [003 — Bring the controls up to genre standard](003-controls-and-feel.md) | P2 | Stages A–D implemented on `feat/loading-veil`, not committed | See the plan's Evidence section |
| [004 — Distinct room floor motifs](004-distinct-room-motifs.md) | P2 | Done, merged via [PR #34](https://github.com/Mirator/astralite/pull/34) 2026-09-22 (CI stability fix in [PR #35](https://github.com/Mirator/astralite/pull/35)) | See the plan's Evidence section, and `game/progress.md` |
| [005 — Theme-specific light-source shapes](005-theme-light-source-shapes.md) | P2 | TODO | Graphics recommendation 2; planned at `cc6fb85`, 2026-09-21 |
| [006 — Macro-scale paving variation](006-macro-paving-variation.md) | P2 | TODO; depends on 004 | Graphics recommendation 3; planned at `cc6fb85`, 2026-09-21 |
| [007 — Local cutaway for occluded actors](007-local-actor-cutaway.md) | P2 | TODO | Graphics recommendation 4; planned at `cc6fb85`, 2026-09-21 |
| [008 — Surface feedback at foot contacts](008-surface-footstep-feedback.md) | P3 | TODO | Graphics recommendation 5; planned at `cc6fb85`, 2026-09-21 |

## Graphics implementation sequence — 2026-09-21

These five plans are proposed implementation handoffs, not completed work.
Each contains its own source evidence, exact scope, visual dimensions/motion,
integration steps, tests, capture procedure, resource ownership and stop rules.
The supplied numerical values are starting design constraints, not measurements
from a completed prototype. Source was inspected; no new runtime baseline was
executed while writing these documents. Executors establish that baseline first.

Recommended order: **004 → 005 → 006 → 007 → 008**. Execute one at a time in
the integrated checkout: they share `dungeon-game.tsx`, `dungeon-art.ts` and/or
`dungeon-atmosphere.ts`, and all spend the SAME existing render budget.
Do not give each executor an independent allowance on top of that budget.

- **004 → 006 is a hard dependency:** 004 introduces world-space decoration
  reservations; 006 uses them to keep long paving slabs away from room motifs,
  shrines, goals, weapon drops and gauntlets.
- 005 is independently implementable but should follow 004 to keep edits serial.
- 007 follows the geometry work for reliable occlusion captures. It chooses a
  local dithered cutaway, not a permanent through-wall outline, and includes a
  prototype gate before broader integration.
- 008 can be implemented alone; with 006 present it must use realized settled
  surface heights for contact placement. 006 defines a pure `dungeon-surface.ts`
  triangle index with `sampleSurface`; 008 reuses it, or introduces the same
  contract if implemented alone. Its particle budget remains bounded.
- Known changes made by earlier plans are expected drift: preserve their APIs,
  tests and logged results. Unexplained source mismatch requires reconciliation.

For a cheaper executor, dispatch one entire plan file, ask it to follow the
file's scope and verification steps, and require its visual evidence before
marking DONE. No separate conversation context is needed. Passing structural
tests alone is insufficient to accept an art change.

Status vocabulary for 004–008: TODO, IN PROGRESS, DONE, or BLOCKED with a short
reason. A failing pre-existing gate must be reported rather than silently
accepted. Preserve the historical 001–003 entries below.

### Deliberately excluded from this graphics round

- A new renderer, bloom/SSAO stack, downloaded textures or wholesale palette
  changes: not needed for the five requested improvements and outside scope.
- Uniformly shorter walls or a whole-wall transparency effect: removes the
  architectural depth the current art intentionally added.
- New collisions, floor holes, water-wading mechanics or physics debris:
  these are gameplay changes, not the requested presentation work.
- Detailed new banner heraldry and waterfall reconstruction: considered in the
  audit but not among the five selected recommendations; no hidden extra plans.
- General security, balance and dependency audits: not part of these handoffs.
- Cold-review concern that helper `world` bypasses floor cleanup was checked
  and rejected: `addAtmosphere` receives `floorGroup`, then passes that same
  group to `addCarvedArchitecture`. The misleading parameter name does not
  indicate a leak. Plans explicitly preserve this ownership chain.

## 001 — Verification baseline

Implemented at `58500c2` + working tree. Not committed, not pushed, not
deployed.

- Project-local `@playwright/test@1.63.0` pinned in `game/package.json` and the
  lockfile; nothing resolves from a developer home directory
  (`rg 'file:///|Miroslav|\.codex/skills' game/tests/browser game/playwright.config.ts`
  → no matches).
- New scripts: `npm run typecheck` (`tsc --noEmit --incremental false`, so no
  `tsconfig.tsbuildinfo` is produced) and `npm run test:browser`.
- `game/playwright.config.ts`: one Chromium worker, no retries, ANGLE over
  SwiftShader, its own dev server on `127.0.0.1:3000` with
  `reuseExistingServer: false`. Output goes to the ignored `game/test-results/`
  and `game/playwright-report/`.
- `game/tests/browser/helpers.ts` pins the floor seed by intercepting only the
  one-word `crypto.getRandomValues` draw `buildFloor` makes, asserts the
  snapshot reports that seed, enters manual time before the run starts, finds
  legal fixture positions with the pure generator, and fails the test on any
  page error, console error or failed request.
- All seven required scenarios exist across `smoke.spec.ts`, `gameplay.spec.ts`
  and `progression.spec.ts`.
- `.github/workflows/verify.yml` (pull requests, `contents: read` only) and the
  existing Pages workflow both run typecheck, lint, the node suite and the
  browser suite, and upload the Playwright report on failure. They run as
  parallel jobs sharing `.github/actions/setup`; `deploy` needs every one of
  them, so a red gate still keeps the build off Pages.
- Root `README.md` corrected (trunk-plus-stubs topology, three floors, boons,
  results screens, real controls) and a root `AGENTS.md` added.

Gates, all from `game/` on Node 22.15.0 / npm 10.9.2:

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass, no tsbuildinfo written |
| `npm run lint` | pass |
| `npm test` | 21/21 (the original 14 unchanged, plus 7 combat rules from plan 002) |
| `npm run test:browser` | 17/17 |
| `npm run test:browser -- --repeat-each=3` | 51/51, no skips, no retries |
| `npm run test:browser -- --shard=1/2` then `2/2` | 9/9 and 8/8 |
| `npm run build` | pass |
| `git diff --check` | clean |

CI itself is **pending**: the workflows have not run on GitHub. Nothing here
validates GitHub execution, including the cache-hit path.

### CI wall clock

The gates were originally one sequential job that re-downloaded Chromium on
every run. They now run as parallel jobs, Chromium is cached on
`~/.cache/ms-playwright` keyed by the lockfile, and the browser suite is split
across two shards on two runners. Locally the two shards take 1.3 and 1.8
minutes against 2.9 for the whole suite; the runner-side numbers are estimates
until a real run exists.

`fullyParallel: true` was set for sharding granularity only — with one worker
there is no local concurrency, but `--shard` now splits test by test rather
than file by file (an even 9/8 instead of 14/3). Worker count and the no-retry
policy are unchanged.

## 002 — Combat integrity

Implemented on top of 001, same working tree.

- `game/app/dungeon-combat.ts` holds the two rules as plain data functions:
  `swordContacts` (range, then arc, then `hasClearPath`) and `incomingDamage`
  (`Math.round(amount * guardAgainst)`). The running game imports both, so the
  tests exercise production rules rather than copies. No React, DOM or Three.js
  imports, so node's type stripping runs them directly.
- Player sword contact now requires the same clear lane an enemy needs to swing
  through. Knockback, one-hit-per-swing tracking, hitstop, cleave, enemy
  commitment and all timings are untouched.
- The gauntlet routes its damage through `incomingDamage`, so Salt Ward's
  stated "take 20% less damage" now covers hazards. Rounding, per-source
  colours, sounds and invulnerability windows are unchanged.
- The end of player hit and reward resolution is an explicit boundary: every
  eligible same-swing hit and its exactly-once XP, room clear and healing
  resolve first, then the update stops before enemy simulation if a draft is
  open or the run has ended. `hurtPlayer` and the hazard branch carry the same
  guard as defence in depth.
- `dungeonTest.configureCombatFixture` added under a
  `process.env.NODE_ENV !== 'production'` branch, validated and narrow.

Failing-first evidence, recorded before each fix:

| Expectation | Against unchanged rules |
| --- | --- |
| blocked-corner contact rejected (`dungeon-combat.test.ts`) | failed; every open-floor control and all 14 generator tests passed |
| Salt Ward blunts a gauntlet | failed: expected 6, got 10 |
| no enemy attack after a mid-swing draft opens | failed: `mode` was `lost`, not `playing` — the knight died on the tick the game said was frozen |
| nothing moves after a lethal hazard | failed: the witness advanced its windup 0.404 → 0.388 in the killing tick |

All four pass with the fixes; reverting any one of them turns its test red
again (verified by temporarily undoing all three changes and re-running).

The dev-only hook was checked on a **locally served production export**
(`npm run build`, static server over `dist/client`, real Chromium):
`render_game_to_text`, `advanceTime`, `teleport`, `descend`, `buildFloor` and
`grantXp` are all present; `dungeonTest` has exactly those four keys and
`configureCombatFixture` is `undefined`. It does not appear anywhere in
`dist/client`.
