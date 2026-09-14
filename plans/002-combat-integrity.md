# Plan 002: Make attacks, damage mitigation, and boon transitions consistent

> Executor: follow the steps and gates; do not publish. Update your row in `plans/README.md` with test evidence when done.
>
> Drift check from root: `git diff --stat 58500c2..HEAD -- game/app/dungeon-game.tsx game/app/dungeon-combat.ts game/tests/dungeon-combat.test.ts game/tests/browser/combat.spec.ts game/tests/browser/helpers.ts`. Plan 001's helper additions are expected; reconcile those before proceeding. Stop on unexplained differences in the combat excerpts.

## Status

- Priority: P1.
- Effort: M, approximately 1–2 days including the transition fixture.
- Risk: MED — reward and transition ordering must remain explicit.
- Depends on: Plan 001's working portable browser suite.
- Category: bug, tests.
- Planned at: commit `58500c2`, 2026-09-09.

## Why this matters

Enemy attacks respect walls, but player sword contact only checks distance and facing. Salt Ward promises damage reduction but gauntlets bypass it. A kill can synchronously open a boon draft and then continue into enemy simulation in the same update, allowing damage after the game says the world is frozen. These are narrow rule inconsistencies; fixing them should preserve attack timing, movement, rewards, and the current minimal HUD.

## Current state

`game/app/dungeon-game.tsx` owns the simulation in an effect. Its player hit loop at lines 528–536 contains:

```ts
if (gameStatus !== 'playing' || enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
if (delta.length() < 1.8 + reach && delta.normalize().dot(attackFacing) > 0.35 - reach * 0.12) {
  // applies strike damage and rewards
```

Enemy melee at line 590 additionally calls `hasClearPath(floor.cells,enemy.group.position,player.position)`. The existing helper at `game/app/dungeon-floor.ts:184` samples body-width walkability and is already covered in `game/tests/dungeon-floor.test.ts:172`.

The audit reproduced the asymmetry without editing source: create cells x/z=-2…2 except `(0,0)`, place player at world `(-1.07,0.25)` and enemy at `(-0.25,1.07)`, and face the enemy. Both pass `canStand`; distance is 1.159655, so the current sword predicate accepts contact, while `hasClearPath` is false.

Damage paths are split:

```ts
// dungeon-game.tsx:210
if (id === 'ward') guardAgainst *= 0.8;
// :505, gauntlet
hp = Math.max(0,hp-10);
// :565, enemy
hp = Math.max(0,hp-Math.round(enemy.damage*guardAgainst));
```

The boon description at line 33 is `Take 20% less damage`, with no hazard exception. Preserve this stated broad rule by applying mitigation to hazards too; do not quietly narrow the description.

At lines 190–200, `gainXp` sets `choosing=true` through `offerBoon`. It is called inside the kill handler at line 536. `update` checks `choosing` only on entry at line 445, then proceeds into the enemy loop at line 550; `hurtPlayer` at line 564 does not check `choosing`. This path is confirmed by source, but the exact same-tick low-HP outcome still needs a browser regression. `descend()` at line 359 already defers results while choosing, and existing behavior must remain intact.

Use the existing `node:test`/`assert` style from `game/tests/dungeon-floor.test.ts`; use Plan 001's Playwright helpers for real gameplay. Keep pure rule helpers free of React/DOM/Three imports so Node type-stripping can execute them.

## Commands you will need

All package commands run from `game/`.

| Purpose | Command | Expected |
|---|---|---|
| Install if needed | `npm ci` | exit 0 |
| Baseline unit tests | `npm test` | all pass |
| Focused new unit tests | `node --experimental-strip-types --test tests/dungeon-combat.test.ts` | all pass after fix |
| Typecheck | `npm run typecheck` | exit 0; provided by Plan 001 |
| Lint | `npm run lint` | exit 0 |
| Focused browser regressions | `npm run test:browser -- combat.spec.ts` | all pass after fix |
| Full browser regression | `npm run test:browser` | all pass |
| Build | `npm run build` | exit 0; not rerun by advisor |

## Scope

Only modify/create `game/app/dungeon-game.tsx`, `game/app/dungeon-combat.ts`, `game/tests/dungeon-combat.test.ts`, `game/tests/browser/combat.spec.ts`, `game/tests/browser/helpers.ts`, `game/tests/README.md`, and your index row.

Do not change the generator, enemy stats, strike timings (0.38-second total, 0.065–0.175 contact), dash timings, boon costs, loot/XP values, art/CSS, public deployment, or the general runtime architecture. Do not reformat the entire dense game component. The optional test setup hook below must be restricted to development; existing public hooks keep their contracts.

## Git workflow

Branch `codex/002-combat-integrity`. Preserve unrelated/untracked files. Use small logical changes; example title: `Respect attack lanes and freeze combat at boon transitions`. Commit only when requested; no push, merge, or deployment. Do not run concurrently with another agent editing the game component in the same checkout.

## Steps

### Step 1: Capture failing behavior before changing rules

Add a focused pure module exposing a plain-data player-contact predicate and incoming-damage calculation. Initially move the present expressions into those functions without changing outcomes, and call them from the existing runtime so tests exercise production rules rather than copied test formulas. Use explicit object types `{x:number;z:number}` and a normalized horizontal facing vector; preserve strict range/angle comparisons. The contact helper may import `hasClearPath` from `dungeon-floor.ts` once fixed.

Write regressions for the exact blocked-corner fixture, an identical open-floor control, points just inside/outside range and arc, Long Guard reach, and hazard/enemy mitigation with multipliers 1, 0.8, and 0.64. Preserve `Math.round` semantics: hazard damage is 10, 8, and 6 for those multipliers. Do not add a new minimum-damage rule.

**Verify:** run the focused Node command; record that the intended blocked-lane/hazard expectations fail against unchanged rules while open-floor controls pass. `npm run typecheck` and `npm run lint` must still pass. Do not commit an intentionally failing intermediate state as a finished deliverable.

### Step 2: Fix contact and share mitigation

Require the existing `hasClearPath` check after inexpensive range/facing tests. Preserve one-hit-per-swing tracking, knockback, enemy commitment, hitstop, and cleave. Compute effective damage through the pure helper in both enemy and gauntlet branches; retain each source's current effect colors, sounds, invulnerability duration (enemy 0.35, gauntlet 0.65), dash immunity, and death handling.

Avoid a broad combat abstraction. A small shared damage calculation is sufficient; centralize health mutation only if it makes the two existing paths clearer without changing their timing.

**Verify:** focused Node tests, `npm test`, `npm run typecheck`, and `npm run lint` all pass. The blocked-corner case is rejected and the open/Long Guard cases retain current behavior.

### Step 3: Reproduce and fix the boon transition boundary

In `combat.spec.ts`, construct a deterministic encounter with player XP 175, a guard one strike from death, another committed attacker whose windup expires in the same update, and player health 1. Keep a third living enemy in the killed guard's room so room-clear healing does not mask the regression; do not take Grave Draught. Use a fixed valid generated floor and keep all actors off hazards. Put the attacker outside the sword arc while its fixed aim points at the player. Step into the sword contact window in one controlled update.

Prefer existing hooks and legal fixture positioning. If direct timer/HP setup is necessary, add one development-only `dungeonTest.configureCombatFixture` hook inside an `import.meta.env.DEV` guard. Define a narrow typed payload for player HP/XP and existing enemy indices/positions/HP/windup/aim; validate finite values, legal positions and indices, require paused/manual fixture setup, and synchronize changed React health/XP state. It must not accept executable code, arbitrary object paths, or replace combat logic. Do not expose this mutation method in the production build. A test helper must assert that the method is available before using it; disappearance is a failure, not a skip.

First demonstrate the source-predicted bug. Then make the end of player hit/reward resolution an explicit transition boundary: finish all same-swing eligible hits and their exactly-once XP, room clear, and healing bookkeeping, then stop before enemy simulation if choosing or no longer playing. Add equivalent guards inside damaging phases as defense against mid-phase terminal changes. Keep `descend()` waiting until all queued boons are chosen. Do not return halfway through a kill's reward bookkeeping, and do not lose remaining same-swing hits merely because the first kill crosses a rank threshold.

**Verify:** `npm run test:browser -- combat.spec.ts` passes a regression proving the boon remains open, HP remains 1, enemy windup/position freeze during subsequent steps, and a chosen boon resumes play. A lethal hazard must also prevent later combat mutations during that tick. If the predicted bug cannot be reproduced with a valid fixture, stop before changing transition order and report the trace.

### Step 4: Lock down interactions and review play feel

Add browser controls for actual open-lane sword hits, wall-blocked contact, hazard damage with Salt Ward, one hit per enemy per swing, and two eligible kills in one swing crossing the rank threshold. Verify exact XP totals including branch bonus, capped healing, and a final-warden rank-up that resolves all boons then opens results. Check that no damage/death is possible while a draft is visible and that floor results still require an explicit Continue click.

Run the full existing progression/input suite. Review desktop screenshots at blocked contact and boon opening; the fix should not alter the HUD or strike telegraph. Document the small fixture API in the test README if added.

**Verify:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:browser`, and `npm run build` exit 0. From root, `git diff --check` exits 0. If a fixture hook was added, verify through a locally served production export that it is absent while the existing supported hooks remain available.

## Done criteria

- [ ] Production contact helper rejects the exact corner case and preserves open range/arc behavior.
- [ ] Damage tests demonstrate hazard/enemy mitigation and unchanged rounding/immunity rules.
- [ ] Browser regression proves no enemy simulation/damage after boon activation in the same tick.
- [ ] Cleave, kill/branch XP, healing, queued ranks, and final-warden progression pass exact assertions.
- [ ] All baseline gates pass; any fixture mutation hook is development-only.
- [ ] Only scoped files changed; status row records commands and results.

## STOP conditions

Stop if the fixture needs impossible world positions, the race cannot be reproduced, a fix requires changing reward/cleave semantics, gameplay tuning is needed to satisfy tests, or a verification gate fails twice after reasonable repair. Do not hide a failed hypothesis by changing the test's setup until it tests something different. Reconcile changed prerequisite code before applying excerpts mechanically.

## Maintenance notes

Future damage sources must use the same mitigation calculation while retaining explicit source effects. Treat rank-up and results as simulation boundaries, not only React overlays. Test both entry into a frozen mode and subsequent frozen updates: checking only the latter misses this bug. Shared helpers should remain small; this plan does not authorize an engine rewrite.
