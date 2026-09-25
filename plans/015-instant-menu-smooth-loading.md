# Plan 015: Nothing runs until ENTER, and the loading bar never freezes

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `072de75`, 2026-09-25. The baseline below was
> measured on the live site that day. Nothing here is implemented yet.

## Why

The operator's report: opening the site "takes full CPU for some seconds". The
page should come up near-instantly, and entering the keep should show a loading
bar and load smoothly, "no CPU spikes".

### What the page does today

1. The menu paints from the prerendered HTML (PR #49). That part is right; keep it.
2. Two frames after mount, without being asked, `scheduleBoot()`
   (`game/app/dungeon-game.tsx:2364`) raises floor 1 behind the menu through
   `stagedBuild` (`:816`): the generator, the stone textures, `buildFloor`, and
   then a **synchronous** shader warm-up (`renderer.compile` plus the first
   `post.render`, `:837-848`).
3. Once warm, `animate` (`:2320`) draws the whole scene and post chain on every
   display frame behind the menu. It keeps drawing while paused, during the boon
   draft and behind the end screens too, because it only checks
   `built && warmed && !manualTime && !document.hidden`.

### Measured baseline

Measured on the live site at main `072de75`, 2026-09-25, in the Claude desktop
app's embedded Chromium 152 on the operator's machine: Windows 10, GTX 1660
SUPER through ANGLE/D3D11, 12 logical cores, `KHR_parallel_shader_compile`
exposed. The probes were same-origin iframes at 1280x720, DPR 1, with a
`longtask` observer. The pane was hidden, so no animation frame ran. The boot
therefore took its hidden-tab timer path and every stage landed in its own task,
which is what made the stages separable. "Cold" forced a shader-cache miss by
tagging every shader source with a comment. That is the state of every returning
player after a deploy that touched a shader, and of every first visit.

| Main-thread task | Cold cache | Warm cache |
| --- | --- | --- |
| Mount (module evaluation, hydration, effect) | 54 ms | 54 ms |
| Stage 2: flagstone and masonry textures | 136 ms | 125 ms |
| Stage 3: `buildFloor` (matches its own `buildMs.total`) | 219 ms | 175 ms |
| Stage 4: `renderer.compile` and the first frame | **2,734 ms** | 296 ms |
| Load start to keep warm | ~3.4 s | ~1.0 s |

- Floor 1 links **79 shader programs** (158 sources). A frame has 572 draw
  calls, 255k triangles and 6 passes at full quality.
- In `buildMs`, `enemies` (95-117 ms) and `surface` (57-131 ms) are most of
  `buildFloor`.
- The menu backdrop costs **11.1 ms of main-thread time per frame** (median of
  35 frames; `advanceTime(16.7, true)`), or 14.4 ms including a GPU sync. That
  is two-thirds of a core at 60 Hz, before counting the GPU process.
- The menu ships 1.2 MB of JavaScript decoded, 375 KB over the wire, all of it
  eager (the three.js chunk is 627/164 KB). Its cost sits inside the 54 ms mount
  task, so desktop players do not feel it.

Not measured: the GPU process's CPU time. JavaScript cannot see it, so whether
the 2.7 s compile runs on one core or on all twelve is unknown. Also not
measured: the operator's own browser and any phone. Each boot figure comes from
a single run.

### Why it regressed

PR #49 (2026-09-23) moved floor 1 behind the menu when a build was a single
~0.3 s block. Plan 014 (PR #50, 2026-09-24) then added texture generation and
the synchronous warm-up stage, and its art pass raised the program count to 79.
All of that now runs behind the menu. No test budgets idle cost or program
count, so nothing failed.

## Target

| # | Acceptance | Guarded by |
| --- | --- | --- |
| 1 | Before ENTER: no shader compiled, no floor built, no window hooks, no frame loop. | PR-gate test |
| 2 | On ENTER, the veil and its bar are on screen the next frame. Nothing then blocks the main thread for more than 50 ms until the veil lifts. That applies to browsers with `KHR_parallel_shader_compile`; without it, the work runs in bounded slices and the worst slice is reported. | Stage 0 probe, `@nightly` test |
| 3 | From the press to the keep on screen on this machine: about 1 s or less warm. Cold must not be slower than today's ~3.4 s, and Stage D should make it faster. | Stage 0 probe |
| 4 | Programs stay at or under a ceiling that Stage D sets. | PR-gate test |
| 5 | A frozen frame (pause, boon draft, `complete`) is not redrawn. | PR-gate test |

**On "no CPU spikes".** Taken literally, this cannot be done. The keep needs 79
programs compiled, and a cold compile is seconds of CPU on this machine. The
plan delivers three things instead: zero work until the press, no frozen page
during the load, and less to compile (Stage D). If a cold load still pegs every
core after Stage D, its optional throttle trades a flatter curve for a longer
bar. The operator makes that call with the numbers in hand.

**The trade-off this request accepts.** Every first ENTER now waits behind the
bar: about 1 s warm and 3 s cold on this machine. Today a player who lingers on
the menu enters instantly. The live keep behind the menu also goes away
(decision 1).

## Decisions for the operator

1. **Title backdrop: decided (a), 2026-09-25.** Once nothing is built before
   ENTER, the translucent right half of `.intro-screen` has no keep to show
   through it.
   - (a) **Recommended:** a static frame of the keep. Take it as a JPEG with
     Playwright's own screenshot of a fixed seed, about 100-150 KB, in
     `game/public/`, fetched at low priority. The menu must not wait on it.
   - (b) CSS only, reusing the veil's teal fog. Zero bytes, but less atmosphere.
   - (c) Keep it live by building the keep once the menu is idle. Rejected: that
     is today's cost, just paid later.
2. **Compile throttle (Stage D.4).** Decide after the Stage D numbers are in.
3. **Stage E (splitting the engine out of the menu's bundle).** Do it only if
   its trigger fires.

## Repository contract

- Branch `perf/instant-menu` from `072de75`. Work in the main checkout, or in
  one named worktree (`git worktree add`, with a `game/node_modules` junction)
  and its own `GAME_TEST_PORT`. Never use an auto worktree.
- The machine is shared. Run one browser job at a time, run single specs while
  iterating, and prefix local runs with `GAME_TEST_GL=d3d11`. Run the full suite
  once at the end, or leave it to CI if the operator says so.
- Add no new dependencies. Do not reformat `dungeon-game.tsx`: the output of
  `git diff -w --stat` should stay close to `git diff --stat`.
- `dungeonTest.buildFloor` and `dungeonTest.reset` stay synchronous and
  deterministic. No seeded floor may change.
- No commit, push, PR or workflow trigger unless asked. Append an entry to
  `game/progress.md` and update this plan's row in `plans/README.md`.

| Gate | Command (from `game/`) |
| --- | --- |
| Types, lint, node | `npm run typecheck`, `npm run lint`, `npm test` |
| One browser spec | `GAME_TEST_GL=d3d11 npx playwright test tests/browser/<spec>` |
| PR-gate browser suite (end only) | `GAME_TEST_GL=d3d11 npm run test:browser -- --grep-invert "@capture\|@nightly"` |
| Pooled vs isolated oracle (end of Stage A) | the same suite with `GAME_TEST_ISOLATE=1` |
| Pixels (Stage D) | `npm run shots:compare`; see `game/tests/README.md` |
| Build | `npm run build` |

## Stage 0: A probe for before and after

Add `game/scripts/perf/boot.ts`, run as `npm run perf:boot -- --url <url> [--cold]`.
It is a Playwright script, not a test, and nothing in CI runs it: timings on
SwiftShader say nothing about a player's GPU. It should:

- launch Chromium with the launch arguments `playwright.config.ts` uses for
  `GAME_TEST_GL=d3d11`;
- through `addInitScript`, install a `longtask` observer, count
  `compileShader` calls, and with `--cold` tag every `shaderSource` with a
  nonce;
- load the page, idle for 3 s, and record long tasks and compiles (target 1);
- press ENTER, then record every long task until `.loading-veil` detaches, plus
  the wall time (targets 2 and 3);
- read `render_game_to_text()` for `buildMs` and `render.programs`;
- time 60 frames of `advanceTime(16.7, true)`, each followed by a 1-pixel
  `readPixels`;
- print one table.

Before touching anything, run it cold and warm against a production build
(`npm run build`, then `npm start`). If that build cannot be served locally, the
dev server works as long as both sides of a comparison use it. Log the numbers.
The table above is the reference for the live site. The probe also becomes the
operator's regression check for future art changes.

## Stage A: Nothing runs until ENTER

1. Delete the mount-time `scheduleBoot()` at `dungeon-game.tsx:2364`. The press
   path at `:1479` already boots on demand (`enterWhenBuilt`,
   `bootSeed = pinned; scheduleBoot()`). It holds the press behind the veil and
   answers it on the keep, and LAST KEEP's seed becomes floor 1's seed directly,
   with no rebuild. Rewrite the comments that describe building behind the menu
   (`:190`, `:2329-2335`, `:2342-2347`, `:2397-2400`).
2. Register the frame loop at boot rather than at mount (`:2323`). A page that
   never enters must never request an animation frame.
3. Build the backdrop from decision 1(a). Add `scripts/backdrop.ts`
   (`npm run backdrop`), so the image can be regenerated whenever the art
   changes. It boots a fixed seed at `?quality=full` and enters the keep. After
   one `advanceTime(0, true)` draw, it reads the canvas with
   `toDataURL('image/jpeg', ~0.8)` in the same task, so there is no HUD or menu
   in the image. It writes the result to `game/public/`, aiming for about
   100-150 KB.

   Show the image as an `<img>` in the prerendered HTML:
   - Use a document-relative `src` (`./keep-backdrop.jpg`, for the same reason
     as the favicon hrefs in `layout.tsx`).
   - Give it `alt=""`, `aria-hidden`, `decoding="async"` and
     `fetchPriority="low"`.
   - Place it under the intro gradient, on the pre-start menu only, and never
     over the live keep.

   The menu must be usable before the image arrives. The prerendered-HTML test
   asserts that the image is there.
4. Update the harness. `Game.open` (`tests/browser/helpers.ts:532-543`) waits
   for hooks that no longer appear without a press. Add a development-only
   `?boot=eager` that runs today's mount-time boot, and keep it out of
   production the same way `configureCombatFixture` is kept out
   (`process.env.NODE_ENV !== 'production'`). Pass it on every harness `goto`,
   pooled and isolated alike, so the `GAME_TEST_ISOLATE` oracle still holds a
   reset against the same boot. Scenarios that test the boot itself load the
   plain URL.
5. Add tests to `loading.spec.ts`, isolated, on the plain URL:
   - **Idle page.** Hydrate, then idle for 2 s. Assert zero `compileShader`
     calls (counted by an init script), `render_game_to_text` still undefined,
     and no `requestAnimationFrame` calls from the page. If the framework makes
     rAF calls of its own, assert the game's loop some other way.
   - **Press to build.** Replace "a press that beats the build" with "the keep
     is built on the press": press, see the veil and bar, then land in the keep
     with `mode === 'playing'` on floor 1. Keep the held-frames variant, because
     it proves the bar paints before the work starts.
   - **LAST KEEP.** It enters the stored seed with no other build first:
     `__pinnedSeeds.index` stays 0.

Exit: target 1 is met, and the probe shows zero work before the press.

## Stage B: Stop drawing frozen frames

1. In `animate`, draw only when the world advanced or the frame was invalidated.
   While paused, drafting or `complete`, `update` returns before it advances
   `elapsed` (`:1605`), so each of those frames matches the one before. Mark the
   frame dirty on any update that advances time, on resize, context restore and
   visibility return, and on anything that changes the picture while frozen
   (pausing itself, the map, a visual setting). Fix a missed invalidation by
   marking it dirty, never by going back to drawing every frame.
2. Test in isolation, in real time, on a page that has never called
   `advanceTime`: enter, pause, read `render.frames`, wait 500 ms and assert it
   is unchanged. Then resume and assert it advances.

## Stage C: A loading bar that never freezes

**C.1 Shader warm-up without blocking** (this replaces `:829-839`):

1. Call `renderer.compile(scene, camera)` against `post.composer.readBuffer`, as
   today. It should only submit the work: compiling and linking run
   asynchronously in the GPU process, and the wait happens at first use. Confirm
   that by timing it on its own in the probe.
2. On each frame, poll `renderer.info.programs`. A program is done when
   `isReady()` returns true; that reads `COMPLETION_STATUS_KHR` and does not
   block. Call `getUniforms()` and `getAttributes()` on finished programs within
   a budget of about 8 ms per frame, so the first real frame does no reflection
   either. Stop polling when every program is done.
3. Without the extension, `isReady()` always returns true and `getUniforms()`
   blocks until that one program links. The same budgeted loop then force-links
   a few programs per frame instead of all of them at once. Report the worst
   frame, which is bounded by the slowest single program.
4. Make the poll survive a teardown. It reads `renderer.info.programs` only,
   which disposed programs leave, and never touches a material. It also carries
   the build's token, so a superseded build stops polling. This is what
   three.js's `compileAsync` got wrong (`:832-836`): it looked up materials that
   a restart or a pool reset had already disposed, and the veil hung.
5. Draw the first frame as today, and measure how long it takes and how many
   programs it adds (compare `info.programs.length` before and after). The
   shadow-depth variants and the post passes' own materials compile on first
   use, because `renderer.compile` cannot reach them. If that frame is over
   budget, precompile those materials explicitly, for example with
   `renderer.compile(mesh, camera, scene)` on a quad for each pass material.
   Compile each one against the target it renders into (see `:829-831`), and
   poll them the same way.
6. Keep `flameKeeper` and `post.pinPrograms()` working as they do today.

Tests: a pooled `dungeonTest.reset()` issued while a staged build is polling
raises no page error, and the next build completes. After the veil lifts, the
first real frame adds zero programs.

**C.2 Slice the CPU stages to about 10 ms per frame:**

- Give `stagedBuild` a small scheduler: it runs work items until the frame's
  budget is spent, then calls `painted()`, which keeps its hidden-tab and
  manual-time rule.
- Textures (`dungeon-textures.ts:50`, `:144`): turn `flagstoneTextures` and
  `masonryTextures` into generators that yield after each band of rows. The
  getters (`:285-286`) run a generator to completion when called synchronously.
  Every synchronous caller and every output bit stays the same, because the
  PRNG runs in the same order.
- `buildFloor` (`:862`): turn it into a generator that yields at its existing
  `phase()` boundaries, after each enemy in the enemies phase, and after every N
  cells of the surface index. `buildFloor()` runs it to completion
  synchronously, so `dungeonTest.buildFloor`, `reset` and `buildMs` do not
  change.
- While a build is sliced, no frame, input or hook may see a half-built floor.
  `animate` skips `update` and drawing while `building` is true, and
  `render_game_to_text` must stay callable between slices, because the harness
  polls `building` while a build runs.
- Drive the veil's progress by completed work, weighted by the Stage 0 costs,
  instead of by five equal steps. Keep the `VEIL_STAGES` labels.

Tests: a floor built through the sliced path is identical to `buildFloor` for
the same seed. Compare the `render_game_to_text()` `floor` and `graphics`
summaries and hash the texture pixels. The timing check lives in the probe and
in a `@nightly` test that measures the longest task between the press and the
veil lifting; the test skips when `KHR_parallel_shader_compile` is absent.

## Stage D: Compile less

1. Take an inventory. Add a development-only `dungeonTest.programs()` that
   returns each live program's name, material type and a short hash of its
   cache key. Group the programs for floors 1-3 by material and key, and list
   which parameters split materials that are otherwise identical. Put the table
   in `progress.md`.
2. Merge the variants that make no visible difference. The inventory decides
   which ones; these are only candidates: materials that differ by a single
   flag (`vertexColors`, `flatShading`, `side`, a map present or absent, fog,
   instanced or not), `onBeforeCompile` chains built per theme where one set of
   uniforms would do, and `MeshStandardMaterial` on props too small to show its
   lighting model. Every merge must pass `shots:compare` within its noise floor.
3. Add a guard to `frame-budget.spec.ts`, next to "a rebuild reuses the shader
   programs": after floors 1-3, the program count is at or under the new
   ceiling.
4. Optionally, throttle compiles (decision 2). Submit programs in batches with
   `renderer.compile(group, camera, scene)` over groups of objects, and poll
   each batch before starting the next. This caps how many compiles run at once,
   at the cost of a longer bar.

Every shader edit makes the next visit cold for every returning player. Batch
shader changes rather than trickling them out.

Out of scope, noted for the operator: GTAO re-renders the scene every frame to
get normals, and it brings its own programs. Dropping it, or running it at half
resolution, is an art decision.

## Stage E (optional): Keep the engine out of the menu's bundle

Trigger: on a mid-range phone, or under a 4x CPU throttle, the menu's buttons
enable more than ~300 ms after first paint, or the mount task takes more than
100 ms.

If it fires, move the world (the mount effect's body and every three.js import)
into `dungeon-world.ts`. Load that module with `import()` on the press, and
prefetch it with `modulepreload` once the menu is idle. The WebGL context and
the post targets are then created on the press too. This is a large mechanical
move of a deliberately dense file, so land it as its own change, not mixed with
Stages A-D.

## Stop rules

- If `GAME_TEST_ISOLATE=1` disagrees with the pooled path after Stage A, stop: a
  reset no longer matches a boot.
- If C.1 needs three.js internals beyond `renderer.info.programs`,
  `WebGLProgram.isReady()`, `getUniforms()` and `getAttributes()`, stop and
  report. Patching three.js is out of scope.
- If slicing changes a generated floor, a texture bit or a `buildMs` phase name,
  stop. Determinism is a hard constraint.
- If a Stage D merge changes pixels beyond the noise floor, revert that merge.
  Stage D is not an art change.
- If a phase in C.2 cannot be split without changing what it builds, leave it
  whole and report its size.

## Report

- Probe tables, cold and warm, before and after each stage.
- Program count before and after Stage D, with the inventory.
- The worst long task from the press to the keep, with and without the
  extension where that was testable.
- Gate results, including the failure output of anything that failed.
- Anything in this plan that turned out to be wrong.
