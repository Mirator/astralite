# Plans

Implementation handoffs for the Drowned Keep. Each file is self-contained: read
it fully before starting, run its gates, and record the outcome in the row
below. A plan is not permission to publish — no push, merge or deploy unless
the operator asks.

| Plan | Priority | Status | Evidence |
| --- | --- | --- | --- |
| [001 — Make gameplay verification portable and required](001-verification-baseline.md) | P1 | Done, committed 2026-09-14 on `fix/combat-integration-and-ci` | See below |
| [002 — Make attacks, damage mitigation, and boon transitions consistent](002-combat-integrity.md) | P1 | Done, committed 2026-09-14 on `fix/combat-integration-and-ci` (Salt Ward keeps the later rule: enemy steel only) | See below |

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
