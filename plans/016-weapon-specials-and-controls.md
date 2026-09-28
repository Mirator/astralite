# Plan 016: A special for every arm, and the controls it needs

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `8f8dc5a`, 2026-09-27. Nothing here is implemented
> yet. The numbers for the specials are starting design values, not
> measurements.

## Why

The knight has two verbs: strike and dash. The seven arms in
`game/app/dungeon-weapon.ts` differ only in how that one strike behaves (reach,
arc, chain, move speed, ranged). The six boons in `game/app/dungeon-sim.ts` are
all flat numbers. A full three-floor descent pays out about six ranks, and the
draft offers untaken boons first, so a finished run ends holding almost the
whole pool. Every winning build is the same build.

The fix has two halves. This plan is the first: **one** new verb, a special
defined by each arm, and a control layout that has room for it. The second half
(boons that modify strike, dash and special instead of adding numbers) is a
later plan, 017. It is written after this one so the boon pool is not written
twice.

Deliberately **not** added: block/parry (it duplicates the dash as the answer
to a telegraph, and needs enemy AI changes to mean anything), a shared cast
(the crossbow and flask already are the ranged arms), an ultimate with a meter,
and consumables. Each would either duplicate an existing verb or add a
persistent HUD element, which `AGENTS.md` forbids.

### What the input does today

- Keyboard defaults (`DEFAULT_BINDS`, `dungeon-save.ts`): attack `Space`, dash
  `ShiftLeft`/`ShiftRight`, swap `E`, pause `Escape`, mute `M`, fullscreen `F`.
- Mouse (`dungeon-game.tsx:1710-1719`): button 0 strikes (held in its own
  `Mouseattack` slot), button 2 dashes. Hard-coded; the menu says "Only the
  keys above can be rebound".
- Gamepad (`PAD_BUTTONS`, `dungeon-game.tsx:1729`): A attack, B dash, X swap,
  Start pause. Standard mapping only.
- Touch (`dungeon-game.tsx:2786`): `DASH` and a held `STRIKE` button.
- A keyboard attack **or dash** sets `aimDevice = 'keys'`
  (`dungeon-game.tsx:1635`), which hands aim to the keyboard's assisted aim.
- The HUD `ability-row` (`dungeon-game.tsx:2668`) shows a strike icon and a
  dash icon with a cooldown sweep, each with the bound key on a keycap.
- The floor map has no key; it opens from its HUD button or the pause menu.

## Target layout

### Mouse and keyboard (the primary scheme)

| Action | Input | Today |
| --- | --- | --- |
| Move | `WASD` / arrows | unchanged |
| Aim | cursor | unchanged |
| Strike (held keeps striking) | **LMB** | unchanged |
| **Special** | **RMB** | RMB dashed |
| **Dash** | **`Space`**, Shift | Shift |
| Take the arm you stand over | `E` | unchanged |
| **Floor map** | **`Tab`** | no key |
| Pause / Mute / Fullscreen | `Esc` / `M` / `F` | unchanged |

### Keyboard only

| Action | Input |
| --- | --- |
| Strike | **`J`** (was `Space`) |
| Special | **`K`** |
| Dash | **`L`**, `Space`, Shift |

### Gamepad

| Action | Button | Today |
| --- | --- | --- |
| Strike | A (0) | unchanged |
| Dash | B (1) **and RB (5)** | B |
| **Special** | **X (2)** | X took the arm |
| Take the arm | **Y (3)** | none |
| Floor map | **View/Back (8)** | none |
| Pause | Start (9) | unchanged |

RB is a second dash so the thumb can hold A while the index finger dodges.

### Touch

Three buttons in an arc on the right: a large held `STRIKE`, with `DASH` and
`SPECIAL` beside it. Taking an arm stays the on-screen prompt it is today.

### Resulting defaults

```
attack:  ['Mouse0', 'KeyJ']
special: ['Mouse2', 'KeyK']
dash:    ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']   // BIND_CAP is 4
swap:    ['KeyE']
map:     ['Tab']
pause:   ['Escape']   mute: ['KeyM']   fullscreen: ['KeyF']
```

## Decisions (taken by the operator, 2026-09-27)

1. **Keyboard-only strike key: `J`**, with `K`/`L` for special and dash, the
   usual keyboard-brawler cluster. (Keeping `Space` for strike was rejected:
   `Space` would mean strike for one scheme and dash for the other.)
2. **Map key: `Tab`**, swallowed only while playing and unpaused, so focus
   navigation in menus keeps working. If `Tab` interception turns out to fight
   the a11y specs, fall back to `KeyN` and say so in the report.
3. **Stages A and B merge together.** Until Stage C lands, the four arms
   without a special show the special slot as empty, RMB does nothing for them,
   and the controls card says so.
4. **Special readiness: a third icon in the existing `ability-row`**, with the
   same conic sweep the dash icon uses, plus a sound and a glint on the blade
   when it comes back. This extends a row that already exists; it is not a new
   overlay.
5. **No settings migration.** There are no active players, so a stored blob
   from an older build gets no special treatment and no notice. Anyone testing
   with an old blob resets it from the settings card (or clears
   `drowned-keep:settings`).

## Repository contract

- Branch `feat/weapon-specials` from `8f8dc5a`. Work in the main checkout, or
  in one named worktree (`git worktree add`, with a `game/node_modules`
  junction) and its own `GAME_TEST_PORT`. Never use an auto worktree.
- The machine is shared. Run one browser job at a time and single specs while
  iterating, and prefix local runs with `GAME_TEST_GL=d3d11`. Run the PR-gate
  suite once at the end of each stage.
- `dungeon-weapon.ts`, `dungeon-combat.ts` and `dungeon-sim.ts` stay free of
  React, DOM and Three.js imports. Every rule a special follows (timing,
  cooldown, contact, damage) lives there and is tested in node.
- Add no dependencies. Do not reformat `dungeon-game.tsx`: `git diff -w --stat`
  should stay close to `git diff --stat`.
- Do not widen `DRIFTS` in `tests/browser/helpers.ts`. Anything a special
  leaves behind (projectile, cooldown, charge) is reset in `dungeonTest.reset`.
- No seeded floor may change. Specials change combat, not generation.
- No commit, push, PR or workflow trigger unless asked. Append an entry to
  `game/progress.md` and update this plan's row in `plans/README.md`.

| Gate | Command (from `game/`) |
| --- | --- |
| Types, lint, node | `npm run typecheck`, `npm run lint`, `npm test` |
| One browser spec | `GAME_TEST_GL=d3d11 npx playwright test tests/browser/<spec>` |
| PR-gate browser suite | the PR-gate command in `AGENTS.md`, prefixed with `GAME_TEST_GL=d3d11` (the regex is `@capture` or `@nightly`, joined by a single unescaped pipe) |
| Balance | `npm run balance:check`; `npm run balance -- --compare` for the report |
| Build | `npm run build` |

## Stage 0: Baseline

1. Run `npm run balance -- --compare` and `npm run balance -- --compare --kite`
   and keep both tables. They are the "before" for Stage B's balance check.
2. Run the PR-gate browser suite once and record its pass count and time.
3. List every browser spec that presses `Space` meaning "strike"
   (`grep -rn "Space" tests/browser`; 11 specs at planning time, including
   `a11y`, `aim`, `chain`, `combat`, `slash`, `progression`, `ranged`). Stage A
   rewrites them.

## Stage A: The controls

Stage A changes no combat numbers. `special` exists as an action, but
`requestSpecial()` does nothing unless the held arm has a `special` (none does
yet).

### A1. Mouse buttons are bind codes

- Treat mouse buttons as codes in the same `binds` table: `Mouse0` (left),
  `Mouse2` (right), and `Mouse1` (middle) allowed as well. They already pass
  `CODE`.
- `pointerDown`/`pointerUp` turn a button into its code and go through the same
  `does(action)` path as `keyDown`. The `Mouseattack` slot becomes `keys.add`
  / `keys.delete` of the code itself, so holding LMB keeps striking exactly as
  it does now, and so does holding `J`.
- Rebinding: while `capturing` is set, a mouse button on the settings card
  binds that code, as a key does. Button 0 on the card's own buttons must still
  click them. Capture from `pointerdown` on a dedicated capture surface, not on
  the whole card.
- `keyLabel` names `Mouse0/1/2` as `LMB`/`MMB`/`RMB`. The `ability-row`
  keycap shows the bind for the device used last: a mouse code when
  `aimDevice === 'pointer'`, otherwise the first keyboard code. Today it shows
  the first bind, which would label a keyboard player's strike "LMB".
- Delete "Only the keys above can be rebound" from the controls card.

### A2. New actions and defaults

- Add `special` and `map` to `Action`, `ACTIONS`, `ACTION_LABELS` and the
  controls card. Order in `ACTIONS` matters for `parseSettings`' first-claim
  rule: keep `attack, special, dash` adjacent and before `swap`.
- New `DEFAULT_BINDS` as listed above.
- `map` opens and closes the floor map through the existing `'map'` path
  (`dungeon-game.tsx:1672`). `Tab` gets `preventDefault` only while the game is
  playing and unpaused. Anywhere else it moves focus as usual.

### A3. A keyboard dash does not claim aim

`keyDown` sets `aimDevice = 'keys'` on attack or dash. With the dash on
`Space`, a mouse player who dodges would lose pointer aim until the cursor
moves. Change the rule: only a keyboard **strike or special** claims aim. The
dash direction is unchanged (`moveInput()`, else `facing`). Regression in
`aim.spec.ts`: with the cursor to the knight's left and no movement key held,
`Space` dashes left and the next LMB still aims at the cursor.

### A4. Saved settings

No migration and no version marker (decision 5). `parseSettings` keeps its
existing rules, which already fill `special` and `map` from the defaults when a
blob lacks them and never put one code on two actions.

Node tests in `tests/dungeon-save.test.ts`:

- a blank blob parses to the new defaults, mouse codes included;
- `Mouse0`/`Mouse2` survive a round trip and can be rebound with `bindKey`
  (including the trade rule when a mouse code is taken from another action);
- a blob that lacks `special` and `map` gets them from the defaults, minus any
  code an earlier action already holds, and no action ends up empty;
- existing assertions that encode `Space` as the strike default are updated in
  the same change, not deleted.

### A5. Gamepad and touch

- `PAD_BUTTONS` becomes `[[0,'attack'],[1,'dash'],[5,'dash'],[2,'special'],[3,'swap'],[8,'map'],[9,'pause']]`.
  Two buttons share `dash`. Give each button its own slot key
  (`Pad${index}`), not `Pad${action}`, so releasing B while RB is held does not
  drop the held dash. Button 8 must also answer while paused, like Start does,
  so the map closes from the pad.
- Touch: add a `SPECIAL` button with the `DASH` button's handlers, dispatching
  `special`. It stays in the layout when the arm has no special, but disabled
  and dimmed, so the layout does not jump when arms are swapped.
- Controls card text: "A strikes, B or RB dodges, X special, Y takes the arm".

### A6. Tests use actions, not keys

Add `press(page, action)` / `hold(page, action)` / `release(page, action)` to
`tests/browser/helpers.ts`. They resolve the default bind (keyboard scheme) and
press it. Rewrite the Stage 0 list to use them. Keep `a11y.spec.ts`'s
assertion that `Space` on a focused card does not click it, now framed as
"the dash key". Add a `controls.spec.ts` covering: RMB with no special is
inert, `Tab` opens the map only while playing, pad button 8 opens and closes
it, and a mouse rebind.

**Stage A done when:** every gate passes, the rewritten specs pass
`--repeat-each=3`, and a manual check on a real mouse and a real pad (if one is
available; say so if not) confirms the layout.

## Stage B: The special, and three arms

### B1. The rule, pure

- `Weapon` gains an optional `special`. Reuse the fields a swing already has
  (`duration`, `anticipation`, `contactEnd`, `damage`, `knockback`,
  `stagger`, optional `ranged`/`burst`) plus:
  `cooldown` (seconds), `kind: 'lunge' | 'throw' | 'charge'`, and for `charge`,
  `chargeMin`/`chargeMax`.
- The special is a swing that runs on the same timeline as a strike. It shares
  `canAbortSwing` (the dash cancels it only before contact or after
  `contactEnd`), one-hit-per-swing tracking and `swordContacts` (or the
  projectile path for `throw`). It cannot start while a strike is live, and a
  strike cannot start while it is live. A buffered special waits the way a
  buffered dash does.
- The cooldown starts at contact, not on the press, so a special cancelled
  during anticipation costs nothing. The sim owns the cooldown
  (`run.specialCooldown`, ticked in `tickRun`) so node tests and the balance
  sim see the same number. It resets on swapping arms, so a swap is never a
  way to dodge a cooldown and never a punishment.
- Node tests in `tests/dungeon-weapon.test.ts` / `dungeon-combat.test.ts`:
  timing windows, cooldown start and reset, cancel-before-contact costs
  nothing, a special cannot overlap a strike.

### B2. The first three arms (starting values)

| Arm | Special | Starting values |
| --- | --- | --- |
| Tideblade | **Undertow Lunge**: a thrust that carries the knight forward along the aim and cuts everything on the line once | 0.12 s anticipation; 3.2 units over 0.18 s; 1.5× the arm's damage; stagger; 0.25 s recovery; cooldown 4 s. The knight takes no i-frames during it: it is an attack, not a second dash |
| Salt Spear | **Harpoon**: the spear is thrown along the aim and returns to hand. The first guard or stalker it hits is dragged 2 units towards the knight; wardens are only staggered | reuse `dungeon-projectile.ts`; speed 18, flight 0.5 s, pierce 1, 2× damage; the knight strikes bare-handed (0.5× damage) until it returns; cooldown 5 s |
| Bell Maul | **Tolling Slam**: hold to charge, release to slam; a ring of force around the knight | charge 0.5 s (min) to 1.0 s (full); radius 2.4 → 3.2; damage 1.5× → 2.5×; knockback on all, stagger on wardens; move speed while charging = the maul's `moveSpeed` × 0.5; releasing before `chargeMin` cancels at no cost; cooldown 6 s |

These are design starting points. Tune them in B4, not by feel alone.

### B3. Presentation

- Poses in `dungeon-attack-pose.ts`, trails in `dungeon-weapon-trail.ts`,
  one sound each in `dungeon-audio.ts`. The Harpoon uses the existing
  projectile mesh path. A charging Maul needs a visible charge (pose plus a
  growing ring on the floor, the same ring language the flask's burst uses).
- Readiness cue per decision 4: the `ability-row` special icon with the dash
  icon's sweep, a glint on the held arm and a sound when the cooldown ends. The
  icon is empty for an arm without a special.
- Snapshot: `render_game_to_text()` gains
  `player.special: { id, ready, cooldown, charging, charge } | null` and
  `weapon.special` (the arm's numbers). Every existing key stays.
- Frame budget: the charge ring and the Harpoon must fit
  `frame-budget.spec.ts`'s current ceilings. Do not raise them.

### B4. Balance

- Teach `scripts/balance/sim.ts` the special: a policy flag `--special` that
  fires it whenever it is ready and at least two bodies (the lunge: one) are in
  its reach. Existing policies (`default`, `weak`) do **not** use it, so
  `npm run balance:check` must pass unchanged. That proves Stage B did not
  move the rest of the game.
- Add a `special` policy to `bands.json` with its own measured values and
  loose bands, in the same PR.
- Report `npm run balance -- --compare --special` against the Stage 0 table.
  The target is **fight duration**, not descent length: the seconds from a
  room's first contact (one of its woken bodies within reach of the knight)
  to the room holding nothing alive, as the `fight` and `fight/run` columns
  of `--compare` report it (`FloorReport.fights` in `scripts/balance/sim.ts`).
  Report it per arm with specials off and on. (Changed by the operator on
  2026-09-28: the original "10-25% shorter median descent" was the wrong
  metric, because roughly 40% of a descent is walking that no special can
  shorten.) The special must not move any floor's death rate for the `weak`
  policy by more than one band. A special that makes its arm the obvious best
  is a tuning failure; retune in a follow-up and say so in the report, not by
  feel in this stage.

### B5. Browser regressions

`tests/browser/special.spec.ts`, real input only (RMB, `K`, pad X, touch
SPECIAL). The hooks are only for fixture setup:

- each of the three specials hits a fixture enemy and deals its damage exactly
  once per use;
- the cooldown blocks a second use, and the icon and snapshot agree;
- the dash cancels during anticipation at no cooldown cost, and cannot cancel
  during contact;
- the Harpoon returns, and swapping arms mid-flight neither loses the spear nor
  leaves a projectile behind (`dungeonTest.reset` must clear it);
- a Maul charge released early costs nothing; a charge interrupted by a boon
  draft or pause resumes or cancels without a stuck state;
- a special mid-swing when the last warden falls does not break the stair or
  results flow (mirror the existing last-warden boon deferral test).

**Stage B done when:** every gate passes, `special.spec.ts` passes
`--repeat-each=3`, the balance report is in `game/progress.md`, and a
screenshot of each special mid-contact is inspected.

## Stage C: The other four arms (sketch, confirm before building)

The operator approves these, or replaces them, before any code:

| Arm | Sketch |
| --- | --- |
| Twin Fangs | **Vault**: a short hop over the nearest body in the aim direction, landing behind it with a backstab worth 2×. Cooldown 3 s |
| Warden's Cleaver | **Whirl**: a full 360° cut, slower than a strike, knockback on all. Cooldown 5 s |
| Keep Crossbow | **Heavy Bolt**: hold to draw; a full draw fires one bolt that pierces everything and spends the whole quiver. Cooldown 0, gated by the quiver instead |
| Tideflask | **Flashpoint**: detonates every burning pool the knight has thrown, for burst damage, and ends them. Cooldown 4 s |

Same B1 rule, same B3-B5 gates per arm. Stage C can land arm by arm.

## Stop rules

- Stop and report if the new defaults cannot satisfy every A4 test. Never ship
  a default or parse rule that can leave an action with no key.
- Stop if `npm run balance:check` fails on an existing policy after Stage B:
  something other than the special moved.
- Stop if a special cannot fit the frame budget without raising a ceiling.
- Stop if a pooled browser failure looks like contamination; confirm it with
  `GAME_TEST_ISOLATE=1` before touching `DRIFTS`, and fix the reset instead.
- Do not start Stage C until the operator approves the Stage C sketches.

## Report

Record in `game/progress.md`, per stage:

- the gates and their results, with pass counts;
- for Stage A: the A4 test list, and whether a real mouse and pad were
  checked;
- for Stage B: the final values of each special, the before/after
  `--compare` tables, the `special` policy bands, and the screenshots
  inspected;
- anything deferred, and why.

Then set this plan's row in `plans/README.md`.
