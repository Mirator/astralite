# Plan 012: Figures as part lists, and a bench that shows them in seconds

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `6fb6644`, 2026-09-23. Nothing here is implemented
> or runtime-validated yet.

## Why

The figures (knight, guard, stalker, warden) are going to be improved by AI
agents over many small iterations. Two things currently make that slow and
error-prone:

1. **The source is hard to edit precisely.** `makeKnight()` and `makeSkeleton()`
   sit inside `dungeon-game.tsx` (~2,300 lines, deliberately dense one-liners),
   and `knightDetails()` / `enemyDetails()` in `dungeon-characters.ts` are the
   same style. A part is an anonymous `new THREE.Mesh(...)` whose position is
   set three statements later, often after re-parenting arithmetic
   (`part.position.y -= .7`). An agent cannot find "the visor" by name or change
   it without reading the whole function.
2. **There is no fast way to see a figure.** Seeing a change today means a
   `shots:compare` run (~30 s a side) and hand-cropping a 1000x700 frame to find
   a figure about 60 px tall.

This plan fixes both without changing what anything looks like. It is a
refactor plus a test tool: **no figure changes by a single vertex.**

Explicitly out of scope: GLB/Blender loading (that experiment lives on
`exp/blender-models` and is not part of this), any art change, weapons in
`dungeon-armory.ts`, poses, the cloak simulation, death animation, HUD.

## Repository contract

- Worktree: `C:/Users/Miroslav Pavelek/Documents/astralite/.claude/worktrees/figure-bench`
  on branch `feat/figure-bench` (from `main` at `6fb6644`). `game/node_modules`
  is a junction to the main checkout's. Work only here. Run package commands
  from its `game/`.
- Use **`GAME_TEST_PORT=3200`** for every browser run and `--port 3200
  --base-port 3201` for `shots:compare`, so nothing collides with another
  checkout.
- Read `AGENTS.md`, `game/tests/README.md`, and `game/app/dungeon-bake.ts`
  before starting.
- The machine is shared: one browser run at a time, never the full browser
  suite more than once per stage, and prefer single specs
  (`npx playwright test tests/browser/models.spec.ts`). Always prefix browser
  runs with `GAME_TEST_GL=d3d11`.
- No new npm dependency. (`sharp` is present in `node_modules` only
  transitively; do not import it.)
- No commit, push, PR, merge or workflow trigger. Leave the work uncommitted;
  the operator will review and commit.
- Append one entry to `game/progress.md` at the end, and add this plan's row to
  `plans/README.md`. `output/` is read-only.

| Gate | Command (from `game/`) |
| --- | --- |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Node suite | `npm test` |
| One browser spec | `GAME_TEST_GL=d3d11 GAME_TEST_PORT=3200 npx playwright test tests/browser/<spec>` |
| Browser suite (end of plan only) | `GAME_TEST_GL=d3d11 GAME_TEST_PORT=3200 npm run test:browser` |
| Pixel check vs main | `npm run shots:compare -- --base main --port 3200 --base-port 3201 --grep models` |
| Build | `npm run build` |

## Stage 0: Record the noise floor (read-only)

Before editing anything, run the pixel check above on the untouched worktree.
It compares main with an identical tree, so every changed pixel is renderer or
simulation noise (water, embers, torches). Record each `models-*` scene's
changed-pixel count and box in your notes. This is the bar Stages A and B are
held to: **a figure-only refactor may not exceed it in any `models-*` scene by
more than 200 px, and no changed box may overlap a figure.** Open the sheet and
look at the figures. Do not judge by the numbers alone.

## Stage A: Move the builders out, verbatim

Goal: the figure builders become importable by node, with zero behaviour change.

1. Create `game/app/dungeon-knight.ts` exporting `makeKnight()`, moved
   character-for-character from `dungeon-game.tsx` (currently lines ~81-196),
   together with the materials and the `plate` helper it defines.
2. Create `game/app/dungeon-skeleton.ts` exporting `makeSkeleton(kind)` plus
   `BONES` and the `shared` helper it uses (currently ~198 and ~231-351).
   `BONES.cue` and `BONES.bar` are also used by the game loop (~line 1215 and
   1218). Either export `BONES` and import it back, or keep those two entries
   in the game file. Pick whichever needs fewer edits. `THREAT`, `COMMIT` and
   `actorStat` stay in `dungeon-game.tsx`.
3. The new modules import only `three`, `three/addons/*`, and sibling
   `./dungeon-*.ts` modules **with the `.ts` extension** (as
   `dungeon-armory.ts` does), so `node --experimental-strip-types` can load
   them. No React, no DOM. Check that everything they pull in transitively
   (`dungeon-characters.ts`, `dungeon-cloak.ts`, `dungeon-armory.ts`,
   `dungeon-bake.ts`, `dungeon-weapon.ts`) loads in node too. It already does
   for the armoury; see `tests/dungeon-armory.test.ts`.
4. `dungeon-game.tsx` imports them back. Do not reformat anything you did not
   move.
5. **Fingerprint test.** Create `game/tests/dungeon-figures.test.ts`. It builds
   the knight and each enemy kind in node and reduces each figure to a stable
   JSON fingerprint. Walk the tree in child order and, for every node, record:
   - its path (child indices, plus `name` where set);
   - its type;
   - position, quaternion and scale, rounded to 1e-4;
   - `visible`;
   - `userData` keys, but not their values.

   For every mesh, also record:
   - material type, `color` hex and `emissive` hex (and `side` / `flatShading`);
   - vertex count and index count;
   - the geometry bounding box rounded to 1e-4;
   - the sum of all positions rounded to 1e-3.

   Compare the result with `game/tests/fixtures/figure-fingerprints.json`. When
   `UPDATE_FIGURE_FINGERPRINTS=1` is set, the test writes that file instead of
   comparing. On a mismatch it must print which figure and which path differ,
   not just "not equal". Generate the fixture from the Stage A code: it is the
   frozen truth for Stage B.
   - The bake keeps a module-level cache keyed by `cacheKey`. Build each figure
     twice in the test and assert that both fingerprints are equal, so the
     cached path is covered too.
   - If a builder draws random numbers (check for `Math.random`), stub it
     deterministically in the test and say so in a comment.

Gates: types, lint, node suite, `tests/browser/models.spec.ts`, and the pixel
check held to the Stage 0 bar.

## Stage B: Part lists

Goal: every part of every figure is a named entry in a data table that an agent
can find and edit in isolation. **The fingerprint must stay byte-identical to
the Stage A fixture.** Do not regenerate the fixture in this stage. If you
think you must, stop and report why.

1. Add a small spec format and builder in `game/app/dungeon-figure-spec.ts`
   (three.js only). Keep it this narrow; do not grow a general scene-graph
   language:

   ```ts
   type V3 = [number, number, number];
   type Shape =
     | { box: V3 } | { cylinder: [rTop: number, rBottom: number, height: number, segments: number] }
     | { cone: [r: number, height: number, segments: number] } | { dodeca: [r: number, detail?: number] }
     | { sphere: [r: number, w: number, h: number] } | { torus: [R: number, r: number, radial: number, tubular: number, arc?: number] }
     | { plate: { outline: [number, number][]; depth: number } }
     | { geometry: THREE.BufferGeometry }; // escape hatch: BONES entries, the cloak, anything already shared
   type Part = { name: string; shape: Shape; material: string; at?: V3; rot?: V3 | [...V3, THREE.EulerOrder]; scale?: number | V3; hidden?: boolean; parts?: Part[] };
   type Node = { name: string; at?: V3; rot?: V3 | [...V3, THREE.EulerOrder]; scale?: number | V3; parts: (Part | Node)[] };
   export function buildSpec(spec: Node, palette: Record<string, THREE.Material>): { root: THREE.Group; byName: Record<string, THREE.Object3D> };
   ```

   A `Part` becomes a `THREE.Mesh` and a `Node` becomes a `THREE.Group`. Both
   get `.name` set from the spec. Names must be unique within a figure;
   `buildSpec` throws on a duplicate. Construct geometries exactly as the
   current code does (same constructor, same arguments, same bevel settings for
   `plate`), or the fingerprint will catch it.
2. Rewrite `makeKnight()` as `KNIGHT_SPEC` (a const, or a function if it needs
   the materials) plus a thin builder. Rewrite `makeSkeleton(kind)` as
   `skeletonSpec(kind)` using plain conditionals for the three kinds, plus a
   thin builder. Fold `knightDetails()` and `enemyDetails()` from
   `dungeon-characters.ts` into those specs. Delete them from
   `dungeon-characters.ts` once nothing calls them; `contactShadow` stays
   there.
3. Things that stay imperative code, after `buildSpec`:
   - `bakeStatic` calls and their keep lists;
   - `userData` wiring (`legs`, `knee`, `boot`, `sword`, `armed`, `armoury`,
     `rig`, `eyes`, `limbs`, ...);
   - the boot-to-sole swap;
   - shadow flags;
   - `contactShadow`;
   - `makeWeapon`.

   They look joints up through `byName` instead of holding local variables.
   Leave a one-line comment at each saying what it is for.
4. Keep the part order the current code produces. The bake batches by material
   in traversal order, so reordering parts changes vertex order. If the only
   mismatch left is ordering inside a merged batch, fix the order. Do not sort
   inside the fingerprint to hide it.
5. Preserve the existing explanatory comments. Move each one next to the spec
   entry it explains. They carry measured design decisions, such as why the
   warden's bone is L47. Losing them is a regression.
6. Style: the new files may use normal formatting, one part per line, because
   being easy to edit is the point of this stage. Do not touch the style of
   `dungeon-game.tsx` beyond the import lines and the removed builders.

Gates: types, lint, node suite (fingerprint unchanged), `models.spec.ts`,
`cutaway`/`footstep` specs if they read figure internals (grep
`tests/browser` for `userData`, `boot`, `knee`, `sword`, `eyes`), and the pixel
check held to the Stage 0 bar.

## Stage C: The figure bench

Goal: one command renders every figure from eight facings on one sheet in a few
seconds, so an agent can edit, look, and edit again.

1. **Page.** Add a dev-only route that renders a bench and nothing else. First
   confirm how this app routes (`game/app/page.tsx`, `layout.tsx`, vinext);
   `app/bench/page.tsx` plus a client component is the expected shape. It must
   not ship: in a production build the route returns not-found (or is absent).
   Verify that with `npm run build` and report how. The bench:
   - Uses one `WebGLRenderer` with the game's output settings (`SRGBColorSpace`,
     `ACESFilmicToneMapping`, exposure 1.15 — `dungeon-game.tsx` ~617), the
     game's hemisphere and moon light values (~624-630) with the moon casting
     shadows, and an orthographic camera looking along the game's
     `CAMERA_OFFSET` (`dungeon-aim.ts`) so the view angle matches play. Zoom so
     a figure fills about 80% of a cell's height.
   - Stands each figure on a flat square of the paving colour (0x607574), so
     contrast reads roughly as in game. It is an approximation for iteration;
     say so in a comment. The in-game `shots:compare` stays the judge.
   - Draws a grid in a single canvas using `setViewport`/`setScissor`. Rows are
     knight (Tideblade), guard, stalker, warden. Columns are the eight facings
     used by `models-knight-strip`: clockwise on screen from facing the lens,
     45° apart. Cells are 200x240 CSS px at device scale 1, with a thin label
     row naming figure and facing, drawn in a DOM overlay rather than in WebGL.
   - Takes URL parameters, parsed defensively. All are optional:
     - `figures=knight,guard`;
     - `weapon=<WeaponId>` (default Tideblade), which also accepts `all` to
       draw the knight once per arm as extra rows;
     - `zoom=<n>`;
     - `bg=paving|grey`.
   - Sets `window.__bench = 'ready'` once the frame is drawn. Nothing animates.
     It renders once, deterministically.
   - Builds figures only through `makeKnight` / `makeSkeleton`, never a copy, so
     it always shows the real models.
2. **Command.** Add `npm run figures` (a node script under `game/scripts/`,
   `--experimental-strip-types` like `shots:compare`). It starts the dev server
   on `GAME_TEST_PORT` (default 3200), or reuses one already listening there,
   and drives Chromium through `@playwright/test`'s library API, which is
   already a dependency. It opens `/bench` with any flags passed through
   (`npm run figures -- --figures knight --weapon all`), waits for `__bench`,
   and screenshots the canvas. It writes:
   - `outputs/figures/latest.png`, after moving any previous `latest.png` to
     `previous.png`;
   - a timestamped copy under `outputs/figures/<timestamp>.png`.

   It prints all three paths and the wall time. `outputs/` is already ignored;
   confirm that. Honour `GAME_TEST_GL=d3d11` the same way the browser suite
   does; read `playwright.config.ts` for how it passes the GL flag.
   **Target: under 15 s warm, under 40 s including a cold dev-server start, on
   d3d11.** Report the measured times.
3. **Regression spec.** Add `tests/browser/bench.spec.ts` to the browser suite.
   It opens `/bench` (not the pooled game page; opt out of pooling as the other
   isolate specs do if the fixture requires it) and asserts that every cell
   contains figure pixels. Read the canvas back in the page and count pixels
   that differ from that cell's background by more than a small threshold,
   then require a minimum per cell. It also asserts `__bench === 'ready'`
   within a timeout. It must add under 5 s to the suite. It writes no PNG
   unless `GAME_TEST_CAPTURE=1`.
4. **Docs.**
   - Add a "Figures" section to `game/tests/README.md` describing the iteration
     loop: find the part by name in the spec, edit it, run `npm run figures`,
     compare `previous.png` with `latest.png`, run `npm test` (the fingerprint
     fails on purpose), run `UPDATE_FIGURE_FINGERPRINTS=1 npm test` once the
     change is intended, and judge the final change in game with
     `shots:compare --grep models`.
   - Add `npm run figures` to the command table in `AGENTS.md`, with one
     sentence.

Gates: types, lint, node suite, `bench.spec.ts`, `npm run build` (with the
route excluded), then the full browser suite once, then `npm run figures`
twice (cold and warm) with times reported.

## Stop rules

- If Stage A's pixel check exceeds the Stage 0 bar, or a changed box touches a
  figure, stop and report. A verbatim move cannot change pixels, so something
  else is wrong.
- If Stage B cannot reach an identical fingerprint for a figure after a
  reasonable effort, leave that figure imperative (Stage A form). Finish the
  others and report exactly which parts resisted and why. Do not loosen the
  fingerprint.
- If the dev-only route cannot be excluded from production cleanly, stop
  before Stage C.3 and report the options you found.

## Report

End with a short report:

- files added and changed;
- the Stage 0 noise floor and Stage A/B pixel results per `models-*` scene;
- fingerprint status per figure;
- bench timings (cold and warm);
- the path of one `latest.png`;
- gate results with the failure output of anything that failed;
- anything in this plan that turned out wrong.
