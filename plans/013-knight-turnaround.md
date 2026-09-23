# Plan 013: Bring the knight closer to the turnaround sheet

> A record, not an executor brief: this was done in one session against `51d25b5` (main), 2026-09-23,
> and written up afterwards so the `Plan 013` references in `game/app/dungeon-knight.ts` point somewhere.

## Goal

Move the player knight towards the eight-facing turnaround in
[`docs/reference/knight-turnaround.webp`](../docs/reference/knight-turnaround.webp): blackened plate
edged in gold, a great helm with a crimson plume, big domed pauldrons, a gold-rimmed breastplate with a
diamond, a mail skirt behind a crimson tabard, armoured legs, and a long gold-bordered cape.

## Constraints it was held to (none were loosened)

| Guard | Where | Limit |
| --- | --- | --- |
| Meshes after the bake | `tests/browser/models.spec.ts` | <= 32 |
| Triangles | same | <= 4987 (3990 x 1.25) |
| Height | same | 1.8243 +/- 0.08 (he was already at 1.9015) |
| Rest pose, cape anchor `[0, .5, .22]` and pitch `-.1` | same | exact |
| Darkest quarter under the floor, brightest over it, at every facing (facing 4: within +2) | same, eight facings | as written |
| Median head-over-shoulders delta | same | >= 17.7 |
| Knight's separation from each enemy | same, cast | >= plan 011's value less one (knight-guard >= 10.48) |

The height rule decides the proportions: nothing could get taller, so the helm went from 1.15 to 1.05 and
the plume lies back instead of standing up, and that paid for legs 0.06 longer.

## What changed

- **Helm**: an eight-sided bucket with a low dome, not a tapered cone; gold bars above and below the eye
  slit and a gold nose bar (the sheet's gold cross). Plume: three feathers down a brass ridge, each
  laid further back, and one splayed out each side, in their own brighter crimson material.
- **Shoulders**: iron hemisphere domes with a thin brass rim and a front boss, over two plain iron lames.
  The hidden plan-010 pauldrons stay hidden (the bake tests rely on an invisible part).
- **Chest**: a brass copy of the breastplate outline behind the iron one, so it shows as a gold edge; a
  brass diamond at the centre; the red collar is iron now.
- **Waist**: a mail cylinder (new `mail` material) under the belt; iron tassets on the hips; a diamond
  buckle.
- **Tabard**: a new kept joint `tabard` on the torso (brass back, crimson front, gold diamond at the
  point), baked on its own. `dungeon-game.tsx` swings it forward to 0.85x the leading hip's pitch every
  frame, so a running thigh does not come through rigid plate; `render_game_to_text` reports it as
  `player.locomotion.tabard`.
- **Legs**: 0.03 longer thigh and shin; iron shin and sabaton, steel knee and toe caps, brass bands. Each
  knee is three materials instead of five, which is where the new meshes came from.
- **Free arm**: an iron gauntlet instead of the leather fist (four materials, not five).
- **Cape**: 0.98 to 1.02 long with a ragged hem (every other hem vertex pulled up 0.07); the old gold
  centre seam is gone, the gold border stays.

## Tried and taken out

| Tried | Cost | Outcome |
| --- | --- | --- |
| Cape 1.1 long, flaring 0.2 | facing 4's darkest quarter 29.1 against 26.7: the cape covered the dark legs | back to 1.02 / 0.15 |
| Two more feathers trailing behind the helm | covered the helm's steel from behind; the median delta fell to 14.7 | removed |
| Plume in the tabard's red | head too dark in the top third; knight-guard 10.14 | own crimson material |
| Tabard 0.26 wide | knight-guard 10.04 against 10.48 | widened to 0.32 |
| Steel elbow cop, gold lame edges | facing 6's shoulders too bright, median 17.5 | removed |

## Evidence

See `game/progress.md` (plan 013 entry).
