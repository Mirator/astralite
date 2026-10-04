# Plans

Implementation handoffs for the Drowned Keep. Each file is self-contained: read
it fully before starting, run its gates, and record the outcome in the row
below. A plan is not permission to publish — no push, merge or deploy unless
the operator asks.

| Plan | Priority | Status | Evidence |
| --- | --- | --- | --- |
| [001 — Make gameplay verification portable and required](001-verification-baseline.md) | P1 | Done, merged via PR #6 2026-09-14 (`fix/combat-integration-and-ci`) | See below |
| [002 — Make attacks, damage mitigation, and boon transitions consistent](002-combat-integrity.md) | P1 | Done, merged via PR #6 2026-09-14 (`fix/combat-integration-and-ci`) (Salt Ward keeps the later rule: enemy steel only) | See below |
| [003 — Bring the controls up to genre standard](003-controls-and-feel.md) | P2 | Stages A–D done, merged via PR #30 2026-09-21 (`feat/controls-and-feel`) | See the plan's Evidence section |
| [004 — Distinct room floor motifs](004-distinct-room-motifs.md) | P2 | Done, merged via [PR #34](https://github.com/Mirator/astralite/pull/34) 2026-09-22 (CI stability fix in [PR #35](https://github.com/Mirator/astralite/pull/35)) | See the plan's Evidence section, and `game/progress.md` |
| [005 — Theme-specific light-source shapes](005-theme-light-source-shapes.md) | P2 | Done, merged via PR #37 2026-09-22 | See the plan's Evidence section, and `game/progress.md` |
| [006 — Macro-scale paving variation](006-macro-paving-variation.md) | P2 | Done, merged via PR #38 2026-09-22 | See the plan's Evidence section, and `game/progress.md` |
| [007 — Local cutaway for occluded actors](007-local-actor-cutaway.md) | P2 | Done, merged via PR #39 2026-09-22 | See the plan's Evidence section, and `game/progress.md` |
| [008 — Surface feedback at foot contacts](008-surface-footstep-feedback.md) | P3 | Done, merged via PR #40 2026-09-22 | See `game/progress.md` (plan 008 entry: gates, capture paths, visual verdict and its limitation) |
| [009 — Bake the armoury and sharpen what each arm says from above](009-weapon-and-pickup-models.md) | P2 | Done, merged via PR #43 2026-09-23; fangs only partly meet the visual acceptance (better on the rack, unchanged in hand) | See `game/progress.md` (plan 009 entry: counters, per-arm meshes, B0 and sheet paths, per-arm verdict) |
| [010 — Make the knight read from above](010-knight-model.md) | P2 | Done, merged via PR #44 2026-09-23. Partly meets acceptance: head over shoulders clears 8 L* in 5 of 8 facings (plan: 6; the back facings are led by the cape), facing 4's darkest quarter sits 0.2 over its surround (failed before the plan too), and the mantle was removed as invisible | See `game/progress.md` (plan 010 entry: counters, `actorStats`, separation per facing, sheet path, per-claim verdict and deviations) |
| [011 — Three enemies, three silhouettes](011-enemy-models.md) | P2 | Stages A–D done, merged via PR #45 2026-09-23. Knight separation judged against the pre-010 knight. Mesh targets missed for guard (18, target 14) and warden (19, target 16). Stalker silhouette and warden gold edge only partly meet acceptance | See `game/progress.md` (plan 011 entry: per-stage counters, sheets, verdicts, proposed ceilings) |
| [012 — Figures as part lists, and a bench that shows them in seconds](012-figure-modules-and-bench.md) | P2 | Done, all stages (0/A/B/C), merged via PR #47 2026-09-23 | See `game/progress.md` (plan 012 entry: Stage 0 noise floor, per-stage gates, the bake-ordering method, bench timings and final full-suite result) |
| [013 — Bring the knight closer to the turnaround sheet](013-knight-turnaround.md) | P2 | Done, merged via PR #48 2026-09-23. Helm stays pale steel (head-over-shoulders guard), no gold on the lames, no back diamond on the cape | See `game/progress.md` (plan 013 entry: counters, per-facing separation on both renderers, gates, compare sheet) |
| [014 — Reach the reference image's level of detail](014-reference-art.md) | P2 | Done, merged via PR #50 2026-09-24 (`feat/reference-art-visuals`). Performance budgets and pixel tests were out of scope by the operator's call; the reference image itself is not in the repository | See `game/progress.md` ("Plan 014 — toward the reference image") |
| [015 — Nothing runs until ENTER, and the loading bar never freezes](015-instant-menu-smooth-loading.md) | P1 | Stages 0, A, B, C and the review-fix round done, merged via PR #56 2026-09-25 (`perf/instant-menu`, after the menu-first PR #49); Stage D (compile less) not started | See `game/progress.md` (plan 015 entries: probe tables, the half-built-floor and boot/veiled races, post-pass precompile, warm-up split per pass) |
| [016 — A special for every arm, and the controls it needs](016-weapon-specials-and-controls.md) | P2 | Done, merged via PR #73 2026-09-28. Stages A and B done and verified (PR-gate subset 124 passed / 2 skipped, `npm test` 190/190, `balance:check` unchanged; fight-duration balance report and special screenshots recorded). Stage C sketches approved by the operator on 2026-09-28; the four Stage C specials (Vault, Whirl, Heavy Bolt, Flashpoint) are implemented and tested. No `--compare` report for Stage C (operator's call): its `special-*` bands in `bands.json` come from `balance:check` alone. PR #73 review findings fixed. Open: real mouse and pad hand check, three `@nightly` d3d11 failures not yet traced | See `game/progress.md` (plan 016 entries of 2026-09-27 and 2026-09-28) |
| [017 — Chambers and doors: a floor as a chain of sealed rooms](017-chambers-and-doors.md) | P1 | Implemented 2026-09-28 on `claude/room-transition-mechanics-d82tty`. The operator waived Stage 0 and the performance and balance acceptance; D5 (boons from ranks) and D9 (all chambers built up front) were kept. Merged via PR #74 2026-09-29; the dead bridge and corridor code it left was removed by PR #75 the same day. Its stale `@nightly` fixtures were re-staged by PR #81 2026-09-30 | See `game/progress.md` (plan 017 entries) |
| [018 — Bonecaller, pyre and shieldbearer join the descent](018-promote-three-kinds.md) | P2 | Stages 0, A, B, C, D (1-3) and E done, merged via PR #78 2026-09-29. The Stage D operator playtest (step 4) is open. | See the plan's Evidence section, and `game/progress.md` |
| [019 — Death pays, and a descent starts with the arm you chose](019-meta-progression-and-starting-arm.md) | P2 | Stages 0, A, B, C, D, F done on `claude/beautiful-gauss-5o0cw4`. **Stage D:** the stop rule tripped (`weak-meta-max` escapes 100%); the operator chose to price anyway (900 pearls in all) and cut Whetted Start to one rank of +1, which also corrected Stage A's oversized +4 per rank. The difficulty pass is next. **Stage E (the operator's human playtest) is open.** | See the plan's Evidence section, and `game/progress.md` (plan 019 entries of 2026-10-01 and 2026-10-02) |
| [020 — Three save slots, and the Tide Altar as a room](020-save-slots-and-the-altar-hall.md) | P2 | Stages 0, A, B, C, D, E and F done on `claude/beautiful-gauss-5o0cw4` (draft PR #86); the full browser gate is CI's. D2 agreed (legacy save into slot 1); D9 as Hades (the death and win cards have one button, RETURN TO THE ALTAR). **Stage G (the operator's playtest on a real GPU) is open**, and so is the boot-cost stop rule, which is a model on SwiftShader counts until then. | See the plan's Evidence section, and `game/progress.md` (plan 020 entries of 2026-10-02) |
| [021 — A boss at the bottom of every floor](021-bosses.md) | P1 | Decisions settled 2026-10-03: five bosses (a pool of four on floors 1–2, the Bone King on floor 3), boss bar and targets as recommended. Stages 0, A, B, C, D, E, F and G done on `claude/beautiful-gauss-5o0cw4` (draft PR #87); the full browser gate is CI's. D9 is met for the default and weak knights and **not for weak-meta-max** (cannot be, with the weak band); pool fairness is met only vacuously; the crossbow special is shut out of the bosses. **Stage H (the operator's playtest on a real GPU) is open**, and D4, D7 and D9 are re-decided there. | See the plan's Evidence section, and `game/progress.md` (plan 021 entries of 2026-10-03) |
| [022 — Waves, elites and attrition](022-waves-elites-and-attrition.md) | P1 | Planned 2026-10-03 from the operator's playtest of plan 021 ("rooms feel easy and boring, every room feels same"). Stages 0 to F done (2026-10-04), Stage G (the operator's playtest) not: watch and purse fights in 2–3 telegraphed waves from the third chamber on, four elite modifiers from floor 2 (no extra draw call), no heal on clear, Grave Draught 6 -> 5, the Mother and the King re-tuned. **D13 is not met** (stop rule 3: the weak and weak-meta-max targets cannot both hold with the default knight in its band; the length targets need D1 changed) and D11 was already true as built; `game/progress.md` has the tables. | — |
| [023 — Pearls, the crossbow, and rooms that hurt](023-pearls-crossbow-and-dangerous-rooms.md) | P1 | Planned 2026-10-04 after plan 022: pearls paid per fight chamber instead of per kill (waves inflated them to ~4.5 runs for the shop), crossbow bolts ×2 against bosses, waves from the second fight, ordinary enemies press harder (recovery, floor damage, floor-1 elites), bosses re-tuned off the knife-edge. In progress. | — |

## Model sequence — 2026-09-22

Proposed handoffs, not completed work. Order is **009 → 010 → 011**, one at a
time, in the same checkout.

- **009 is a hard dependency for both others.** It adds `dungeon-bake.ts`
  (merge static parts per material), `dungeonTest.actorStats()`, and the
  `models` scenes in `shots.spec.ts`, and captures **B0**, the shared "before"
  for all three plans. The base commit lacks those scenes, so only B0 can serve.
- Each plan pays for its own triangles, mainly by merging parts and dropping
  sub-pixel rounded bevels (108 triangles against a plain box's 12), and must
  come in at or below the previous plan's draw calls. The flooded hall was
  measured at its triangle ceiling, so assume zero headroom there.
- 011 is split into four stages (bake, guard, stalker, warden) that can each
  land on their own. It ends by proposing tighter frame-budget ceilings; it
  does not apply them.
- All three need `shots:compare` (commit `c45664f`, on `feat/shot-compare` at
  planning time).

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
