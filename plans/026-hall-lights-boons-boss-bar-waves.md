# Plan 026: The hall, every light on, safe boon picks, a bigger boss bar, quicker waves

Operator request, 2026-10-08. Decisions settled the same day (answers to the plan's questions) are marked **Settled**.
One stage per PR, in the order below (cheapest and least coupled first). Every stage follows AGENTS.md "Writing tests
that can fail": plant the named bug and record it in the commit.

## Findings (what the code does today)

| # | Item | Today | Where |
| --- | --- | --- | --- |
| 1 | Altar room | The hall is **floor 1's gate room reused**: `altarHall()` runs `generateFloor(HALL_SEED, 1)`, keeps room 0, deletes every door but one and backfills the rest as alcoves. Its walls, floor motif, props and sconces are whatever floor 1's gate rolled. The altar itself is the sanctuary shrine's disc and crystal (`dungeon-floor-scene.ts:336`). Nothing makes it read as a sanctuary. | `dungeon-floor.ts:495`, `dungeon-floor-scene.ts`, `dungeon-hall.ts` |
| 2 | Lights | A fixed pool of `LIGHT_POOL = 8` point lights goes to the knight's chamber by priority (braziers, open doors, sconces nearest the heart, bounces). Plan 025 Stage B measured 78% of chambers with more than 8 sources (max 23). Past 8, a sconce shows a flame and a painted floor disc and throws no real light. That is the "only partially" the operator sees, in the hall and elsewhere. | `dungeon-lights.ts`, `dungeon-game.tsx:654`, `:2587-2600` |
| 3 | Boon picks | The draft card opens the moment a kill grants a rank. Its buttons are plain `onClick` and live on the first frame, so a click already in flight (attack spam) lands on whatever option is under the cursor. | `dungeon-game.tsx:420-436` (`offerBoon`), `:3094-3096` |
| 4 | Boss bar | Desktop: `width: min(640px, calc(100% - 700px))`, track 18px, name 20px. At 1280 wide the bar is 580px. Under 900px: 10px track, 15px name. | `globals.css:523-530` |
| 5 | Waves | The next wave is called only once every earlier body is down (`waveDue`). Then: `WAVE_PAUSE` 0.5 s, then rings for `WAVE_MARK` 0.9 s, then the bodies stand with `cooldown >= .9`. About 2.3 s of dead air before the first blow can come. | `dungeon-waves.ts:28-30`, `dungeon-game.tsx:2318-2326` |

## Decisions

| ID | Item | Decision |
| --- | --- | --- |
| D1 | Waves | **Settled: shorter timers, same rule.** `WAVE_PAUSE` 0.5 → 0.15, `WAVE_MARK` 0.9 → 0.6, the raised body's opening cooldown 0.9 → 0.6 (lift it to a named constant `WAVE_OPENING` in `dungeon-waves.ts` so the sim and the game read one number). Dead air goes from ~2.3 s to ~1.35 s. No overlap of waves. |
| D2 | Boon guard | **Settled: a confirm step.** The first click or key on an option *selects* it (highlight, name repeated on a TAKE button); a second activation of the same option, or TAKE, takes it. Clicking a different option moves the selection. Keyboard: arrows or 1–3 select, Enter/Space confirm. Pad: as keyboard. Plus one guard against the very first selection: input that was already held when the card opened (a pointer or key down before `openedAt`) does nothing until released. Without it, a held attack button still pre-selects. Rule lives in a pure module (`dungeon-input.ts` or a new `dungeon-draft.ts`): `draftPress(state, option, pressedAt) -> { state, take }`. |
| D3 | Boss bar | Desktop (≥ 900px): `width: min(960px, calc(100% - 420px))`, track 18 → 28px, name 20 → 26px, phase ticks 3 → 4px, plus a numeric "hp / max" right-aligned in the track at 13px. Phone (< 900px): track 10 → 14px, name 15 → 17px. Check it still clears the title and options at 1280 and 1024. **Assumption: the operator means desktop first.** |
| D4 | Lights | **Settled: every source in the knight's chamber gets a real light; frame-budget tests may be relaxed.** See Stage C. |
| D5 | Altar room | **Open (the operator's answer: "it is not about the altar itself, but about the room - make it differently").** Proposal below; needs a yes or a correction before Stage D starts. |

### D5 proposal: a hand-built sanctuary, not a reused gate

Stop deriving the hall from `generateFloor`. `altarHall()` returns a fixed, authored floor:

- **Shape**: a symmetric cross or apse-ended nave, about 13 × 11 tiles, the altar on a raised dais at the far (north, away
  from the camera) end, the one door (the way down) at the near end, so the knight walks *toward* the altar on entry.
- **Floor**: a dedicated motif. A central runner of dark slabs from door to dais, with an inlaid tide-ring pattern in the
  paving around the dais (`dungeon-floor-motifs.ts` gets a `sanctuary` motif; no generator stream).
- **Walls and dressing**: pillars in two rows flanking the nave (furniture pieces we already bake, placed from a fixed
  table rather than `furnishFloor`); banners or drowned tapestries between them; a basin of glowing water on the dais
  under the crystal.
- **Racks and shrines**: along the nave aisles, between the pillars, instead of wherever `gateRacks`/`hallShrines` find
  space. That gives the shop a readable left (arms) / right (upgrades) split.
- **Lights**: two braziers flanking the dais, a sconce on each pillar. With Stage C every one is a real light.
- **Theme**: a fixed palette (cool tide teal walls, warm gold fire) rather than floor 1's rolled theme.

Cost: medium-large. It is new authored geometry, a new motif, and re-placing the racks and shrines. Risk: the hall's
browser tests (`hall*.spec.ts`, the racks and shrines snapshot) pin positions off today's layout and will need
re-staging; the boot-cost note from plan 020 (the hall builds on every return) must be re-measured.

## Stages

### Stage A — Waves and the boss bar (D1, D3)

1. `dungeon-waves.ts`: the three constants; `dungeon-game.tsx:2324` reads `WAVE_OPENING`.
2. `scripts/balance`: run `npm run balance:check`. Shorter dead air means less free regen time and a faster, harder
   room, so expect damage-per-chamber to rise slightly. Update `bands.json` only if a band moves, and record the before
   and after in progress.md.
3. `globals.css` per D3; `boss-bar` gets the numeric readout.
- **Node**: `tests/dungeon-waves.test.ts` asserts `waveDue` marks after exactly `WAVE_PAUSE` and raises after
  `WAVE_MARK` (plant: restore 0.5, and watch it fail on the step count).
- **Browser**: an existing boss scenario reads the bar's rendered height and width at 1280×720 (≥ 26px, ≥ 800px;
  measured values written beside the bounds) and at a phone viewport (`@nightly`, since the gate already covers the
  bar once).

### Stage B — Boon confirm step (D2)

1. Pure rule `draftPress` + node tests: first press selects, second press on the same option takes, a press on another
   option re-selects, a press whose button went down before `openedAt` is ignored, and Enter with nothing selected does
   nothing.
2. Card: `aria-pressed` on the selected option, a TAKE button (disabled until something is selected), and a hint line
   ("Click again to take"). Number keys 1–3 select.
- **Plants**: make the first press take. The node test and the browser test must both fail with their own message.
- **Browser**: real pointer. Hold the mouse down while a kill grants a rank, release, and assert `boonOffer` is still
  true and nothing is taken. Then click, click, and assert taken. Keyboard: 2, Enter.

### Stage C — Every light on (D4)

1. **Measure first** (d3d11 and SwiftShader): the largest chamber source count over the generator corpus, including the
   hall and open doors. Plan 025 counted 23 sources; doors can add up to about 3. Set
   `LIGHT_POOL = max measured` (likely 24–26). It stays a fixed count, because three.js compiles the light count into
   every lit shader and a changing count recompiles everything.
2. `chamberLights` keeps its signature. With the pool at the max it returns every source of the chamber. Keep the
   priority order anyway: a future chamber over the max degrades gracefully instead of crashing.
3. Keep `litDisc` painted pools? **Recommend keeping them.** They are free and still sell the light at the edge of
   `distance`. Re-tune their strength if the floor now double-counts (real light + disc = blown out).
4. The warm-up/precompile (plan 015) must compile with the new count, or the first frame on a floor stalls. Check
   `dungeon-warmup.ts`.
5. `frame-budget.spec.ts`: re-measure on CI SwiftShader. Relax ceilings to the new measured values (per the operator)
   and write the numbers and date beside them. Do not delete the test.
- **Node**: `dungeon-lights.test.ts`'s corpus loop now asserts every chamber's sources are all lit (`lit.length ===
  mine.length`). Plant: `LIGHT_POOL = 8`, and watch it fail naming the crowded chamber.
- **Browser**: in a crowded chamber, every sconce of the chamber has a light with intensity > 0 (read from the pool, not
  from `chamberLights`).
- **Risk, stated plainly**: forward rendering pays per light per lit fragment. Going from 8 (+fill +moon) to ~25 point
  lights roughly triples per-fragment lighting cost. On a discrete GPU this is likely fine. On an integrated GPU or a
  laptop on battery it may drop below 60 fps, and SwiftShader CI will get much slower (the browser suite already takes
  about 23 min there). Mitigations if it hurts: give each sconce light a short `distance` (3–4 units) so it is cheaper
  to cull in the shader, or add a quality setting that caps the pool at 8 (the shader count is set at boot, so a quality
  change means a reload). **Not doing**: clustered or deferred lighting. It is a renderer rewrite.

### Stage D — The sanctuary (D5, after the operator confirms)

1. `altarHall()` builds the authored layout (pure, in `dungeon-floor.ts`, node-testable: one door, the altar on the
   dais, racks on the west aisle, shrines on the east, every rack and shrine reachable by `hasClearPath`).
2. Scene: dais, basin, pillars, banners, the `sanctuary` motif; fixed palette.
3. Lights per Stage C; the hall must show every light lit.
4. Re-stage the hall's browser fixtures; contact sheet via `npm run shots:compare` for the operator's review.
- **Node**: layout invariants above. Plant: a rack moved inside a pillar fails the reachability check.
- **Browser**: the snapshot's `hall.altar` stands on the dais tile; entry spawns the knight at the door facing it.

## Out of scope

Clustered/deferred lighting; wave overlap (rejected for D1); redesigning the altar's purchase flow (plan 025 D8 stands).

## Open questions

1. D5: is the sanctuary proposal what "make the room differently" means, or did you mean something else (bigger, darker,
   a different theme, no shop clutter)?
2. D3: is ~960px × 28px the right ballpark, or do you want it even larger (full-width band)?
