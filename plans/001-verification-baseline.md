# Plan 001: Make gameplay verification portable and required

> Executor: read this file completely, follow the steps, and run each gate. This is an implementation handoff, not permission to publish. Update only your status row in `plans/README.md` when finished, unless a coordinator owns the index.
>
> Drift check, from the repository root: `git diff --stat 58500c2..HEAD -- game/package.json game/package-lock.json game/tests game/playwright.config.ts .github/workflows .gitignore README.md AGENTS.md`. Also run `git status --short` and compare the current-state excerpts below. Stop on unexplained behavioral drift.

## Status

- Priority: P1 — prerequisite for the other gameplay plans.
- Effort: M, approximately 1–2 days including stable fixtures.
- Risk: LOW for production behavior; MED for browser-test reliability.
- Depends on: none.
- Category: tests, dx, docs.
- Planned at: commit `58500c2`, 2026-09-09.

## Why this matters

The maintained suite exercises the procedural generator, while combat, keyboard/touch input, boons, and floor completion are only checked through historical scripts. Some scripts import Playwright from the original author's home directory, and the newest scripts are untracked. CI currently lints and builds without running the existing tests. Make a clean checkout capable of catching gameplay regressions before changing the simulation.

## Current state

The repository root contains `game/`, the application, and `output/`, historical playtest artifacts. There is no root package manifest. Use Node >=22.13 and npm; audit verification used Node 22.15.0/npm 10.9.2.

`game/package.json:8` currently contains:

```json
"dev": "vinext dev",
"build": "vinext build",
"start": "wrangler dev --config dist/server/wrangler.json",
"lint": "oxlint",
"test": "node --experimental-strip-types --test tests/*.test.ts",
"format": "oxfmt"
```

`.github/workflows/deploy-pages.yml:33` runs `npm ci`, `npm run lint`, `npm run build`, then `node scripts/pages-relative-paths.mjs dist/client` and uploads the static export. No pull-request verification workflow exists.

`game/tests/dungeon-floor.test.ts:1` is the Node test convention:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFloor, cellKey, hasClearPath, TILE } from '../app/dungeon-floor.ts';
```

`game/app/dungeon-game.tsx:662` already exposes `window.dungeonTest.teleport(x,z)`, `descend()`, `buildFloor(level)`, and `grantXp(amount)`. `advanceTime(ms, draw = true)` stops automatic simulation after its first call; call `advanceTime(0)` before starting a deterministic test. `render_game_to_text()` returns JSON containing mode, health, rank, boons, floor seed, enemies, player, features, objective, and renderer counters. `dungeonTest.descend()` bypasses combat and therefore must not be used to prove that actual floor completion works.

Historical examples, if present: `output/critics/verify.mjs:5–17` covers stalker/warden behavior and map freeze; `output/dynamic/verify.mjs:14–30` covers speed, pause, hazards and shrines; `output/dynamic/boon-transition.mjs` exercises the final-warden rank-up. These are references, not dependencies: they were untracked at audit time and may be absent in another checkout. Their assertions are summarized below so the executor can proceed without them.

The current root README describes old freely branching floors with shortcuts, whereas `game/app/dungeon-floor.ts:64–106` deliberately creates a trunk and optional stubs. Preserve the present game design when correcting the README. Keep controls and statistics in menus; the latest development log explicitly preserves the minimal HUD.

## Commands you will need

Run package commands from `game/`; run Git commands from the root.

| Purpose | Command | Expected |
|---|---|---|
| Clean dependency install, executor only | `npm ci` | exit 0 |
| Existing tests | `npm test` | at least the original 14 tests pass |
| Existing lint | `npm run lint` | exit 0 |
| Existing typecheck | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0, no generated tsbuildinfo |
| Existing build | `npm run build` | exit 0; audit did not rerun this command |
| New typecheck script | `npm run typecheck` | same flags and success as above |
| New browser suite | `npm run test:browser` | all browser tests pass |
| Browser stability | `npm run test:browser -- --repeat-each=3` | all repeats pass without retries |

New commands are deliverables of this plan, not commands that existed at audit time. There is no required formatter pass: avoid reformatting unrelated files.

## Scope

Only modify/create:

- `game/package.json`, `game/package-lock.json` — add a pinned project-local `@playwright/test`, scripts.
- `game/playwright.config.ts`.
- `game/tests/browser/helpers.ts`, `game/tests/browser/gameplay.spec.ts`, `game/tests/browser/progression.spec.ts`.
- `game/tests/README.md`.
- `.github/workflows/verify.yml`, `.github/workflows/deploy-pages.yml`.
- `.gitignore`, root `README.md`, root `AGENTS.md`.
- Your row in `plans/README.md`.

Do not modify gameplay source, existing screenshots, `output/`, deployment targets, `.openai/hosting.json`, or existing generator assertions. A production test-fixture API is not required here. If stable scenarios truly require it, stop and propose the smallest explicit addition rather than editing game source silently.

## Git workflow

Use branch `codex/001-verification-baseline` in an isolated checkout when assigned. Preserve pre-existing untracked `game/tsconfig.tsbuildinfo`, `output/critics/`, and `output/dynamic/`; never clean them. Match imperative commit titles, for example `Make gameplay checks portable and run them in CI`. Commit only if the operator requests commits; do not push, merge, or deploy.

## Steps

### Step 1: Establish the unchanged baseline and local runner

Run the three existing read-only gates. Add project-local Playwright using a version compatible with the locked Node/runtime; inspect its official requirements before selecting a version. Add `typecheck` with incremental output disabled and `test:browser` invoking `playwright test`. Configure one Chromium worker initially, explicit timeouts, no automatic retries, a loopback-only server at `127.0.0.1:3000`, and `webServer.command` based on `npm run dev -- --host 127.0.0.1 --port 3000`. CI must not reuse an unrelated server. Place generated results in ignored `game/test-results/` and `game/playwright-report/`.

Install Chromium with `npx playwright install chromium` locally; use `npx playwright install --with-deps chromium` on Linux CI. Software WebGL flags from the historical scripts are `--use-gl=angle` and `--use-angle=swiftshader`; only use them for the test browser. Add a trivial real-page smoke assertion first.

**Verify:** `npm run typecheck`, `npm test`, `npm run lint`, and `npm run test:browser` all exit 0. `git status --short` contains no new generated artifacts outside ignored directories.

### Step 2: Build deterministic test helpers

Create helpers to wait for the snapshot hook, enter manual time before clicking Enter, read JSON snapshots, dispatch named game actions, step simulation, and start a fresh page per scenario. Record page errors, console errors, and failed asset requests; report them with the failing test's seed and final snapshot. Prefer actual keyboard, pointer, and button input for behavior under test; teleport is allowed for fixture setup.

Pin floor generation from the test environment with `page.addInitScript`: intercept `crypto.getRandomValues` only for a one-element `Uint32Array`, returning a specified fixture seed; delegate every other call to the original bound method. This matches `buildFloor` at `dungeon-game.tsx:291`. Assert that the snapshot reports the requested seed so a changed implementation fails visibly. Do not patch game modules or inject replacement combat logic. Use a deterministic per-level seed sequence if a progression test needs it. Boon tests choose a card actually offered; they must not depend on current `Math.random()` card order.

Use the pure generator to locate legal fixture positions, validate them with `canStand`/`hasClearPath`, and exclude hazard overlap when testing enemy damage. A fixture search must fail with diagnostics if it finds no candidate; never silently skip a test. Await a visible DOM condition after state-changing actions instead of a fixed React sleep.

**Verify:** `npm run test:browser -- --repeat-each=3` passes the smoke test and shows identical floor seeds for each repeated scenario. No code imports a developer-home Playwright installation: `rg -n 'file:///|Miroslav|\.codex/skills' tests/browser playwright.config.ts` returns no matches.

### Step 3: Preserve the important behavior with assertions

Create these independent scenarios, using current behavior as the baseline:

1. Real keyboard movement is screen-relative, release stops movement, stationary dash works, and held Space repeats strikes. Assert positions/timers and a real enemy HP reduction, not only key delivery.
2. Pause and expanded map freeze player/enemy state through manual time; resume works. Blur clears held movement/attack and requires the current manual resume behavior.
3. A committed stalker hits a stationary player; a sideways dodge avoids it; a warden reaches at a distance beyond the guard range. Use legal open-lane fixtures and compare exact health before/after.
4. A gauntlet damages while firing and a dash protects the player. A shrine heals only after damage and cannot be consumed twice. Do not add Salt Ward expectations until Plan 002 fixes that separate discrepancy.
5. A real last-warden kill produces floor results, freezes simulation, and waits for an explicit Continue click. Floors 1 and 2 restore capped 25% vitality on descent; floor 3 requires the final button before victory. Do not substitute `dungeonTest.descend()` for these transitions. `grantXp()` can accelerate boon preparation but cannot replace the final kill.
6. A last-warden rank-up exposes a selectable boon before results; queued ranks resolve one at a time, then results remain reachable. This is the already-supported ordering, distinct from Plan 002's same-tick damage regression.
7. On a touch-enabled 390×844 page, held strike repeats and pointer release/cancel stops it; moving while striking remains possible. Use real touch/CDP events for simultaneous contacts, not only dispatched custom actions. Assert gameplay and review one screenshot.

Keep a few screenshots/traces on failure rather than brittle pixel-perfect golden tests. Record desktop and mobile captures for human review; do not claim they were reviewed without opening them.

**Verify:** `npm run test:browser -- --repeat-each=3` passes all named scenarios, with no skips, browser errors, or retries. Run `npm test` to ensure the generator suite is unchanged.

### Step 4: Require verification and document the workflow

Add a pull-request workflow with read-only repository permissions, Node 22, npm cache, `npm ci`, browser installation, and typecheck/lint/Node/browser gates. Add the same gates before build/upload in the main Pages workflow. Preserve its deployment permission/concurrency model and do not trigger the workflow from the local task. Upload failure reports even when tests fail, but never run deployment after a failed gate.

Update the test README with actual commands, seed fixtures, helper behavior, artifact locations, and coverage limits. Correct root README topology and three-floor/boon/result behavior without promising an exact room-count range. Add a concise root `AGENTS.md`: app location, commands, input/time hooks, minimal-HUD convention, shared resource ownership, generated-output rules, and no deployment unless requested. Do not invent approvals or require broad formatting.

**Verify:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser` all pass. `git diff --check` exits 0. From the root, `rg -n 'npm test|npm run typecheck|npm run test:browser' .github/workflows` shows each gate in both workflows. Report CI as pending until a real run occurs; do not claim a local review validates GitHub execution.

## Test plan and done criteria

- [ ] Original 14 Node tests still pass; no baseline assertions weakened.
- [ ] All seven browser scenarios above exist; repeat run passes without skips/retries.
- [ ] Browser tools resolve from this project's lockfile, not a home directory.
- [ ] Typecheck does not generate `tsconfig.tsbuildinfo`.
- [ ] Both workflows gate relevant changes, and Pages upload follows all checks.
- [ ] README and AGENTS describe current code and exact commands.
- [ ] `git diff --check` passes; only scoped files changed; status row updated with validation evidence.

## STOP conditions

Stop if fixture selection remains unstable after two reasonable attempts, a baseline scenario fails in the unchanged game, WebGL cannot initialize on the test host, the runner requires unsupported Node versions, or implementation needs gameplay/source changes. Report the smallest reproducible case and seed. Do not mark a flaky test skipped to get a green suite, lower generator correctness thresholds, or fix separate gameplay bugs in this plan.

## Maintenance notes

Keep simulation time and wall-clock UI waits separate. Snapshot enemy arrays currently omit dead enemies, so an array index is not a stable identity after a kill; fixture helpers must match by recorded attributes or reacquire the target. Test hooks are intentional in this local single-player game. New gameplay plans should add regressions here before architectural extraction. If performance timing becomes unreliable on shared CI, report that separately instead of mixing threshold changes into this baseline.
