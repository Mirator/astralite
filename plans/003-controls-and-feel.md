# 003 — Bring the controls up to genre standard

Implementation handoff. Read it fully before starting. Five changes, in three
stages, in this order — stage B is a balance change and must not be mixed into
stage A's commits. A plan is not permission to publish: no push, merge or
deploy unless the operator asks.

## Why

The keep is a browser isometric action roguelite whose peers (Hades, Hyper
Light Drifter, Gungeon) all decouple aim from movement, make the dodge a
movement verb, and give the attack button a rhythm. This one does none of the
three. The measurements behind that:

- **Aim is quantised to 8 screen directions** (`moveInput`,
  `game/app/dungeon-game.tsx:1091`), and the swing takes its direction from the
  move input on the frame it starts (`startAttack`, `:1098`). There is no mouse
  path into the playfield and no `getGamepads` call anywhere in `app/`. Worst
  case aim error is 22.5°. The Tideblade's arc (cos 0.35 ≈ ±69°) absorbs it;
  the Keep Crossbow's (cos 0.9 ≈ ±26°, bolt radius 0.62, range 19 × 0.62 = 11.8)
  does not — a worst-aligned target is only struck out to 0.62 / tan 22.5° ≈
  **1.5 units of its 11.8**.
- **The dash barely moves the knight.** 0.18 s at speed 12 is 2.16 units, but a
  threatened walk covers 1.04 in the same window, so the net gain over simply
  walking is **1.12 units** against a guard's 1.55 strike range and a warden's
  2.55. It is an invulnerability blink, not a reposition.
- **Proximity is taxed twice.** `weapon.moveSpeed` already costs mobility
  during a swing; `threatened ? 5.8 : 8.5` (`:1250`) costs it again, for free,
  with no player input involved.
- **Held strike is autofire.** `held('attack')` restarts an identical swing
  (`:1242`), so holding the key is strictly optimal and the input has no shape.

## Decisions taken

Settled with the operator on 2026-09-20, before any code. Do not re-open these
mid-implementation; if the measurements contradict one, stop and say so rather
than quietly picking the other branch.

1. **The aim buff to ranged arms is accepted**, and a weapon revision pass
   follows it (item D1). A2 is no longer gated on the crossbow measurement —
   but the measurement is still taken, because D1 needs a baseline and after
   A2 ships the unaimed numbers can never be collected again.
2. **B2 takes branch (a):** the proximity slow goes, the permanent sprint is
   accepted as-is, and the guard stance is a follow-up only if it reads badly.
3. **Stage B ships as three simultaneous buffs**, with the batch sim as the
   only check on them.

## Stage A — additive input paths

No balance change to the existing inputs. Nothing in stage A alters how a key
already behaves, so it can land before the tuning question is settled.

### A0. One home for the player's motion constants

`scripts/balance/sim.ts:427` duplicates `0.18`, `12`, `5.8` and `8.5` as
literals against `dungeon-game.tsx:1250`. Stage B changes all four and the two
copies will silently diverge, so hoist them first.

- Add to `game/app/dungeon-combat.ts` (it already owns `DASH_BUFFER`, and the
  dash is a combat verb): `DASH_TIME`, `DASH_SPEED`, `DASH_IFRAMES`,
  `WALK_SPEED`, `THREAT_SPEED`, and
  `playerSpeed({ dashing, attacking, threatened, weapon })`.
- Keep it pure — no React, DOM or Three.js — per `AGENTS.md`.
- Both `dungeon-game.tsx` and `scripts/balance/sim.ts` import from it. This
  commit changes no number; behaviour must be identical, and the seeded replay
  in `balance-sim.test.ts` is what proves it.

### A1. `dungeon-aim.ts` — a pure aim module

New file, pure, node-testable, mirroring the `dungeon-combat.ts` precedent.

- `groundAim(ndcX, ndcY, span, aspect, focus, cameraOffset)` → normalised
  ground direction from the player toward a screen point. The camera is
  **orthographic** (`dungeon-game.tsx:544`, frustum rebuilt in `resize` at
  `:1753`), so this is an exact affine inverse, not an approximation. It uses
  the same `screenRight` / `screenDown` basis movement already uses (`:661`),
  so pointer aim becomes a second source of the same quantity rather than a
  second coordinate system.
- `snapAim(facing, bodies, from, reach, maxAngle)` → the direction of the
  nearest-in-angle live body within `reach × 1.3` and within `maxAngle` of
  `facing`, else `facing` unchanged. Callers pass only bodies that already have
  a clear path, so this stays free of `dungeon-floor` geometry.

Tests in `game/tests/dungeon-aim.test.ts`: screen centre maps to zero, the four
screen axes map onto the movement basis, aspect and span changes do not rotate
the result, and the snap refuses a body outside the cone.

### A2. Mouse aim

- `pointermove` on `renderer.domElement`, stored as the latest NDC pair;
  `pointerleave` and `blur` clear it (`clearInput`, `:1170`, is the hook).
- In `startAttack`, when a mouse aim is live and the pointer was the last
  device used, `facing` comes from `groundAim` instead of `moveInput()`. WASD
  still moves; LMB strikes; the dash keeps taking its direction from **move
  input**, as Hades does — a dash toward the cursor makes retreating
  impossible to express.
- Bind LMB to `attack` and RMB to `dash` only while a pointer is the active
  device, and suppress `contextmenu` on the canvas. Keyboard bindings are
  untouched and the bind card stays keyboard-only.
- **Last device wins:** a key press clears the pointer aim, a pointer move
  clears the keyboard's claim. Never blend the two.
- Do not regress touch: `.touch-stick` and `.touch-actions` sit above the
  canvas at `z-index: 5` with `touch-action: none`, so gate the listener on
  `pointerType === 'mouse'`.

### A3. Gamepad, and the aim snap

- Poll `navigator.getGamepads()` once per frame at the top of `update`, before
  `moveInput()`. Accept only `mapping === 'standard'`; anything else is ignored
  rather than mis-bound.
- Left stick → the existing `stick` vector (radial deadzone 0.25). It is
  already a unit vector on the movement basis, so nothing downstream changes.
- Right stick → aim when displaced past the deadzone, falling back to the left
  stick at rest. That is the twin-stick path, and it reuses A2's aim slot.
- Buttons: 0 attack (held, via the touch STRIKE button's existing
  `Touchattack` slot), 1 dash, 2 swap, 9 pause. Edge-detected against the
  previous frame.
- **Aim snap** (`snapAim`, 35°) applies at swing start for keyboard and pad,
  and **not** for mouse — the mouse player already aimed. Snap at swing start
  only, never continuously; a continuous snap makes walking feel magnetic.
- Out of scope: a rebinding UI for the pad. `bindKey` and the card are built on
  `KeyboardEvent.code` (`dungeon-save.ts:23`) and a pad section is separate
  work. Say so on the card rather than leaving it unexplained.

**Balance note for A2/A3.** Real aim makes the narrow-arc weapons strictly
better, and the Keep Crossbow goes from near-unusable at range to possibly
dominant — it already outranges every body in the keep and outruns the fastest
(stalker 3.2 against the knight's 8.5). Per decision 1 this is accepted and A2
is not gated on it, but **run the batch sim per weapon before A2 lands and
again after**: once aim ships, the pre-aim numbers cannot be collected again,
and D1 has nothing to re-tune against without them. Record both in Evidence.

### A4. Do not pre-compensate

Ship A2 and A3 with every weapon number unchanged. The temptation is to shrink
the quiver in the same commit and keep the descent times flat — resist it. That
mixes the input change and the balance change into one measurement, and D1 then
cannot tell which of the two moved the numbers.

## Stage B — the dash, and the proximity tax

One commit, one rebalance, one measurement. Items 3 and 4 are a single change:
enemy tells (guard 0.5 s, stalker 0.58 s, warden 0.72 s) were tuned against
today's dash, and moving one without the other measures nothing.

### B1. The dash becomes a reposition (the Hades model)

The constraint that sets the numbers: **a dash should take you out of the
attack you dodged.** Net displacement over a walk must clear a warden's
`STRIKE_RANGE` of 2.55 (`dungeon-enemy.ts:29`).

`net = DASH_TIME × (DASH_SPEED − WALK_SPEED)`, and with the proximity tax gone
`WALK_SPEED` is 8.5 throughout.

| | Now | Proposed |
| --- | --- | --- |
| `DASH_TIME` | 0.18 s | **0.24 s** |
| `DASH_SPEED` | 12 | **19** |
| Gross distance | 2.16 | **4.56** |
| Net over a walk | 1.12 | **2.52** ≈ warden reach ✓ |
| i-frames | whole dash | **first 0.14 s**, tail vulnerable |
| `dashSpan` (cooldown) | 1.35 s | **0.6 s** |
| i-frame uptime | 13% | 23% |

Quick Step still multiplies `dashSpan` by 0.7 (`dungeon-sim.ts`), giving 0.42 s,
and becomes a real mobility boon rather than an i-frame-uptime boon.

Mechanical changes:

- `hurt(run, …, { dashing })` currently passes `dashTime > 0`
  (`dungeon-game.tsx:1449` and `:1338`, and the same in the sim). It becomes
  `dashTime > DASH_TIME - DASH_IFRAMES`, so the 0.10 s tail can be punished.
- The tail is locked: no attack, no turn. `startAttack` already refuses while
  `dashTime > 0` (`:1099`), so the lock falls out of the existing guard.
- `canAbortSwing` and `DASH_BUFFER` (0.4 s) are unchanged — the buffer is
  deliberately longer than the contact window, and the contact window has not
  moved.

**This is a large net buff.** If the batch sim says so, the levers in order are
`dashSpan`, then `DASH_IFRAMES`, then enemy `RECOVERY`. **Do not claw back the
displacement** — that is the thing being fixed.

### B2. Drop the proximity tax

Delete `threatened` from the speed expression at `:1250` (and its twin at
`scripts/balance/sim.ts:427`, which A0 will already have collapsed into one
place). `weapon.moveSpeed` keeps carrying the cost of committing to a swing;
heavy arms already move at 1.4–1.8 mid-swing, which is where the pressure
belongs.

**Known consequence, and a decision for the operator.** `playerRunPose` blends
its `sprint` term as `(speed − 5.8) / 2.7` (`dungeon-run-pose.ts:6`), so 5.8 is
the walk and 8.5 the full sprint. Today the knight visibly drops to a walk near
enemies, and that gait *is* the danger tell. At a flat 8.5 he sprints
permanently and the tell is gone.

- **(a) Accept it.** Zero cost. Ship B and look at it. **← taken, decision 2.**
- **(b) A real guard stance.** Add a `stance` input to `playerRunPose` —
  shorter stride, sword up, no change to speed — blended on `threatened`. Costs
  pose work and churns `dungeon-run-pose.test.ts` and the pixel-diff spec.
  Follow-up only, and only if the permanent sprint reads badly in play.

The obvious cheap fix — feeding the pose a lower speed than the knight actually
travels — is wrong and must not be attempted: phase follows distance travelled,
so a walk cycle at 8.5 will read as skating.

### B3. Measurement, before and after

`scripts/balance/main.ts` over a fixed seed batch, per weapon, recording
descent time, death rate and cause. Record both tables in this file under
Evidence. A stage B that ships without a before/after table has not been
verified — the browser suite cannot see a balance change.

## Stage C — attack chains

Largest change, lands last, melee only.

- Add an optional `chain` to `Weapon`: an array of beats, each carrying its own
  `duration`, `anticipation`, `contactEnd`, `damage` multiplier, `arc` bonus and
  `moveSpeed`. **Absent means today's single repeating swing**, so six of the
  seven arms are untouched by the type change and the crossbow and flask never
  get one.
- Chain state: a beat index plus a window (~0.25 s after a swing ends). A strike
  inside the window advances the beat; outside it, reset to beat 1. Holding the
  key walks the chain and loops, as Hades does — the third beat's longer
  recovery is the rhythm.
- Beat 3 commits: longer `contactEnd`. `canAbortSwing` already refuses a dash
  inside contact, so the cost falls out of the existing rule.
- Pose: `playerAttackPose(age, weapon, beat)`. `BACK` and `FINISH` are already
  pinned (`dungeon-attack-pose.ts`), so beat 2 is the mirrored sweep
  (+1.2 → −1.6) and beat 3 an overhead. Presentation only; combat still owns
  the clock.
- **Scope: Tideblade and Twin Fangs only.** Cleaver and Maul stay single-beat —
  they are already slow committed swings and a chain on top is a different
  weapon. Revisit once the first two are in.

## Stage D — the weapon revision pass

Follows A and B, per decision 1. This is the bill for aim and for the dash, and
it is a real stage with its own gates, not a cleanup.

### D1. Re-tune against measured aim

Inputs: the four batch-sim tables A2 and B3 leave in Evidence (pre-aim,
post-aim, pre-dash, post-dash), per weapon.

What is expected to be out of line, and the lever for each:

- **Keep Crossbow.** The one with a structural problem: 11.8 units of range
  against a keep whose fastest body moves at 3.2 and whose knight moves at 8.5.
  Before aim, quantisation was doing the balancing. Levers, in order:
  `ranged.capacity` (4), `ranged.refill` (1.8 s), then `moveSpeed` (1.4) — the
  comment on `Weapon.ranged` already names `moveSpeed` and `contactEnd` as what
  pays for range, so lean on those before touching `damage`.
- **Salt Spear** (arc 0.78 ≈ ±39°, reach 2.6). Second-largest gainer from aim.
  Likely fine, but it is the one to check after the crossbow.
- **Tideflask.** `burst` denies a place rather than hitting a body, so aim
  matters less than for the bolt. Expect little movement; confirm, don't assume.
- **Cleaver and Maul** (arc 0 and 0.05, ±90° and ±87°). Aim cannot help a
  half-circle. If these got *relatively* worse against the ranged arms, that is
  a real finding and the fix belongs here rather than in a nerf to the winners.

**Do not re-tune on stage B's dash numbers and stage A's aim numbers at the
same time** if both moved a weapon. Attribute first, then change one thing.

Success is descent times clustered the way `balance-sim`'s baseline describes,
not equal — the arms are meant to differ.

### D2. Revisit what the dash cost

Stage B gives the same 2.52-unit reposition to every arm, which is worth most
to the slowest. Check whether the Cleaver and Maul's committed swings still
cost anything now that the dash can leave a bad commitment behind, and whether
`stagger` is still the draw it was. If the heavy arms have quietly become safe,
the lever is their `contactEnd`, not the dash.

## Gates

All from `game/`, Node 22.15.0 or newer, per `AGENTS.md`. Every stage runs all
of them. Stages A, B and D additionally run the batch sim — A to capture the
pre-aim baseline D1 depends on, B to check the buff, D to confirm the re-tune.

| Command | Required |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` | all pass, including the new `dungeon-aim.test.ts` |
| `npm run test:browser` | all pass |
| `npm run test:browser -- --repeat-each=3` | no flakes |
| `npm run build` | pass |
| `scripts/balance/main.ts` | stages A, B and D — four tables into Evidence |

## Regressions to add

`AGENTS.md`: a gameplay change without a test is not finished.

| Change | Test |
| --- | --- |
| A1 | `tests/dungeon-aim.test.ts` — axes, aspect invariance, snap cone |
| A2 | `tests/browser/aim.spec.ts` — a mouse move left of the knight then a strike hits a body placed left while he walks right; a key press clears the pointer claim |
| A3 | node test over the pad-state reducer (pure); a browser test is not worth a synthetic `getGamepads` shim |
| B1 | `combat.spec.ts` — a hit lands in the dash tail and not in the head; one dash clears 2.5 units |
| B2 | the speed is 8.5 with an awake body inside 10 units |
| C | `dungeon-attack-pose.test.ts` — beat 2 mirrors beat 1; `combat.spec.ts` — the chain advances inside the window and resets outside it |
| D | `dungeon-weapon.test.ts` — the existing invariants (`moveSpeed < 8.5`, and the per-arm assertions) must still hold against every changed number; no new assertion on descent time, which belongs in Evidence, not the suite |

Existing tests that need updating, not deleting: `sprint.spec.ts` (gait, B2),
`dungeon-run-pose.test.ts` (5.8/8.5 as walk/run, B2), `gameplay.spec.ts:103`
and `combat.spec.ts:634` (dash timings, B1), `dungeon-sim.test.ts:83`
(`dashSpan`, B1).

## Risks

- **A2 is a balance change wearing an input change's clothes.** Accepted
  (decision 1), deferred to D1. The live risk is now procedural: if the
  pre-aim batch is not captured before A2 merges, D1 loses its baseline
  permanently. Capture it first, in its own commit if need be.
- **B is a large buff** (decision 3). Three of its four numbers move in the
  player's favour at once. The vulnerable dash tail is the only thing paying
  for it, and the batch sim is the only instrument that will notice if it does
  not.
- **A and B both land before D.** Between them the game is knowingly
  mistuned — playable and measurable, but not balanced. Do not cut D, and do
  not deploy from a tree that has A or B without it.
- **C is the only item that can be cut** without leaving the others incoherent.
  A, B and D stand on their own.

## Evidence

### The simulator could not measure aim, and now can

Found while capturing the A2 baseline: `scripts/balance/sim.ts` set
`attackFacing = toward`, the exact unit vector to the target, on every swing.
The navigator has **always aimed perfectly**. It never modelled the eight-way
quantisation that A2 exists to remove, so as written it could not see the
change at all, and the "pre-aim baseline" the plan asked for would have been
the post-aim world under another name.

Fixed by adding `policy.quantise` (the `--quantise` flag), which routes every
aim through `eightWay` from the new `dungeon-aim.ts`. **Default is off**, so
every balance number this repository has recorded still means what it said;
on, it reproduces what a keyboard-only player actually played.

### A2/A3 — what aim is worth

60 runs an arm, reaction 0.22s, dodge 0.8, exploring. Identical seeds and
policy; the only difference is whether the aim is quantised.

| weapon | escaped 8-way → pointer | median run | hit rate |
| --- | --- | --- | --- |
| Tideblade | 100% → 100% | 4.5m → 4.5m | — |
| Twin Fangs | 100% → 100% | 4.5m → 4.5m | — |
| Salt Spear | 100% → 100% | 4.5m → 4.4m | — |
| Warden's Cleaver | 100% → 100% | 5.1m → 5.0m | — |
| Bell Maul | 100% → 100% | 4.7m → 4.7m | — |
| Tideflask | 96.7% → 100% | 6.3m → 5.6m | 60.0% → 80.8% |
| **Keep Crossbow** | **61.7% → 99.0%** | **8.6m → 6.1m** | **58.7% → 90.0%** |

Two things this settles.

**The five melee arms do not move at all.** Predicted from the arcs — the
Tideblade's ±69° absorbs a 22.5° error and the ±90° of the Cleaver cannot
even notice one — and now measured. Aim is not a melee change.

A third table settles the dominance question the plan raised. With `--kite`,
the strategy of backing away and shooting forever: crossbow 15.0% escaped,
**0.0% died**, 9.6m — the remaining 85% time out. Kiting with a pointer is not
a dominant strategy, it is a stall. Nothing to price in.

**The crossbow prediction was wrong in an important way.** The plan expected
it to become "possibly dominant". It does not: at 6.1m it remains the slowest
arm in the keep against 4.4–5.1 for everything else. What aim actually buys it
is survival — 38.3% of runs died holding it with keyboard aim, and 1.0% with a
pointer. It goes from unusable to viable, not to dominant. D1's brief changes
accordingly: the question is no longer "how much do we take off the crossbow"
but "is a safe, slow arm what we want it to be".

### B — the buff landed, and the instrument was saturated

First measurement of stage B, same 60-run batch and the default policy
(reaction 0.22s, dodge 0.8):

| weapon | HP at stair, before → after | warden share of damage |
| --- | --- | --- |
| Tideblade | 82% → **100%** | 71.6% → **3.8%** |
| Twin Fangs | 80% → **100%** | 70.6% → **0.7%** |
| Salt Spear | 100% → 100% | 38.1% → 1.3% |
| Warden's Cleaver | 100% → 100% | 20.1% → 2.0% |
| Bell Maul | 100% → 100% | 24.0% → **0.0%** |

Median run times did not move (4.4–5.1m before and after). So stage B did not
make the keep faster; it made it **unlosable**. The knight now reaches every
stair at full vitality having taken almost nothing, which is precisely the risk
decision 3 accepted and the reason the batch was a gate rather than a nicety.

Two caveats on reading this table, both of which matter:

1. **At dodge 0.8 the instrument is near its ceiling.** Five of the seven arms
   already arrived at 100% before stage B, so for those the column can only
   stay flat and says nothing. Only the Tideblade and the Twin Fangs had any
   headroom to lose, and both spent it.
2. **A share is not an amount.** "Warden damage 3.8%" partly reflects that
   total damage taken collapsed, so the denominator went with it.

A second batch at a clumsier policy is what the tuning has to be read off,
because that is where the numbers still have room to move.

### B — tuned, and the limit of the instrument

Second pass, 40 runs an arm at a clumsier policy (reaction 0.3s, dodge 0.35),
the same dash before and after:

| weapon | median run, before → after | warden share |
| --- | --- | --- |
| Tideblade | 5.3m → **4.5m** | 44.3% → 7.4% |
| Twin Fangs | 5.2m → **4.5m** | 66.4% → 6.9% |
| Salt Spear | 5.1m → **4.2m** | 4.7% → 4.2% |
| Warden's Cleaver | 5.7m → **4.9m** | 10.3% → 3.0% |
| Bell Maul | 5.5m → **4.6m** | 4.2% → 2.0% |
| Keep Crossbow | 6.6m → 6.1m | 5.6% → 12.0% |
| Tideflask | 6.1m → 5.5m | 4.5% → 5.2% |

Every arm 0.6–0.9 minutes faster. That is the mobility arriving as pace, and it
is the effect stage B was for.

The warden collapse was too much, so the correction went in the order the plan
set: cooldown 0.6 → **0.8s**, immunity 0.14 → **0.1s**, distance untouched.
That is 12.5% immunity uptime against the old dash's 13% — the same defensive
value, bought with a dash covering two and a half times the ground.

**The correction barely registered**: Tideblade's warden share went 7.4% → 5.1%,
the wrong way, and inside the noise. That is the finding. The navigator escapes
100% and dies 0% of runs before the change and after it, at every policy tried,
so it is not being hit enough for an immunity window to matter. It does not time
i-frames; it rolls `nerve()` at a readable tell.

**So the batch cannot price this change, and further tuning against it would be
trusting it past what it can see.** The numbers it does produce — pace, and the
composition of damage — moved clearly and in the intended direction. The dash
settings stand on the uptime-parity argument, which is reasoning, not
measurement, and the playtest is the real check. Said plainly so that nobody
later reads 0.1/0.8 as a measured optimum.

## Stage D — findings

### D1 — the data does not support a weapon change

Final tree, 40 runs an arm, reaction 0.3s / dodge 0.35:

| weapon | median run | warden share | in reach | hit rate |
| --- | --- | --- | --- | --- |
| Salt Spear | 4.2m | 1.6% | 28.9% | — |
| Twin Fangs | 4.4m | 6.6% | 34.2% | — |
| Tideblade | 4.5m | 5.1% | 32.0% | — |
| Bell Maul | 4.6m | 3.1% | 26.6% | — |
| Warden's Cleaver | 5.0m | 5.5% | 30.3% | — |
| Tideflask | 5.5m | 5.0% | 4.6% | 81.3% |
| Keep Crossbow | 6.1m | **13.1%** | 4.8% | 89.0% |

The spread is 4.2–6.1m against 4.4–6.6m before any of this, so no arm has
escaped the pack. **The crossbow in particular needs nothing**: it is the
slowest arm in the keep and now takes the largest share of its damage from
wardens of anything on the table. The plan expected to be taking something off
it. Taking something off the slowest arm because a prediction said it would be
strong, when the measurement says it is not, would be exactly the unsupported
tuning A4 exists to prevent. No change made.

### D2 — the heavy arms did not become safe

Cleaver 10.3% → 5.5% and Maul 4.2% → 3.1% of damage from wardens, on pace of
5.0m and 4.6m. Both were already low before stage B because reach and stagger
were already doing that job; neither has run away. `contactEnd` untouched.

### What D is actually waiting on

Both findings rest on an instrument that cannot kill its own knight. D is
therefore **provisional**: it says nothing in the batch justifies a change, not
that the arms are balanced for a human. Re-open it after real play.

### Playtest — mostly a failed instrument, one real finding

Two agents were sent through the running game. **Neither could play it.** Both
failed at sustained keyboard movement through browser automation; one reached
the second room in twenty minutes, the other never left the starting sanctuary
and reported code it had read instead of play it had done. Their verdicts on
combat feel, dodge distance, chain rhythm and difficulty are therefore worth
nothing and are not recorded here. **The central question stage B raised — is
the keep too easy now — remains unanswered by anything.**

What survived, and what came of it:

| reported | verdict |
| --- | --- |
| The controls card never mentions the mouse or the pad | **Real. Fixed.** |
| "−1 / 15 explored" in the pause card | **Not a bug.** The card renders `halls · 1 / 12 explored`; the character before the 1 is U+00B7, read as a minus. Confirmed by dumping the codepoints. |
| Rebinding is broken: "cannot be bound." | **Not a bug.** The automation dispatches keydown with an empty `code`. Driven with `code: 'KeyQ'`, Up rebinds to Q immediately. |
| Controls text wording is confusing | Not acted on. Subjective, and the "key / alt" form is conventional. |

A caution for whoever reads this next: the "rebinding is broken" line was
briefly believed and reported as reproduced, because the first attempt clicked
a **collapsed `<details>`** — `read_page` returns the contents of a closed
disclosure, so the refs existed and the clicks hit nothing. Expand the panel
before driving it.

Two gaps this exposed, neither closed here:

1. **There is no browser test for rebinding at all.** `bindKey` is covered as a
   pure function in `dungeon-save.test.ts`; nothing drives the card. That is
   why a false report about it could not be dismissed in seconds.
2. **Automated agents cannot playtest this game.** Anything that depends on
   sustained movement needs either a human or a scripted driver built on the
   existing `advanceTime` hooks.
