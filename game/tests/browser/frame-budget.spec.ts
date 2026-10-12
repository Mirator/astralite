import { LIGHT_POOL } from '../../app/dungeon-lights.ts';
import { CAPTURING, enterKeep, expect, type Game, type GameWindow, openSpot, roomCentre, stanceNear, swing, test, TILE, until, WARM_UP } from './helpers.ts';

/**
 * A ceiling on what the staged frames that matter are allowed to cost: the two
 * heaviest, and the one where a blow lands.
 *
 * Wall-clock frame timing is not the measure here and deliberately so: the test
 * browser has no GPU and rasterises in software, where the same frame drawn a
 * hundred times reports a median of 130ms, a mean of 430ms and a 95th
 * percentile of 1900ms. A number with that much spread cannot fail a build
 * honestly. The renderer's own counters can, and they are what actually moves
 * when someone pays for a better-looking frame with more geometry.
 *
 * One correction to an earlier claim here, measured rather than assumed: the
 * counters are NOT identical run to run in every scene. The flooded hall and the
 * contact frame repeat exactly. The junction does not — six repeats gave 498 to
 * 502 draw calls, 343,528 to 343,716 triangles, and even 187 or 188 geometries,
 * because its parapet batches per spatial cell and the knight does not settle on
 * precisely the same spot every run, so a cell drifts in and out of frustum. Its
 * ceiling is therefore the observed maximum of that band: it still catches a
 * regression of more than about four draw calls in that scene, and it does not
 * catch a smaller one. Tighten it by making the scene settle deterministically,
 * not by lowering the number until it flakes.
 *
 * The figures below were measured on the pinned seeds these scenes use. Raising
 * one is a deliberate act: change the number here, in the same commit, and say
 * in `progress.md` what bought it.
 */
// Raised deliberately on 2026-09-19, by the owner, by 15% on both counts
// against the figures the first baseline measured. Those were: flooded-hall
// 508 / 294,966, junction 399 / 305,337, strike-contact 389 / 205,388, and the
// suite sat exactly on them. A blind review found the largest remaining gap to
// be that nothing in any frame rises above knee height and nothing ever
// occludes the camera, which is why every shadow is an ellipse on an unbroken
// plane — and vertical mass is geometry that the old ceiling had no room for.
// The headroom is for that, and the numbers below are the new ceiling, not a
// target: a change that does not buy vertical structure should still come in at
// the old figures.
//
// Re-baselined again on 2026-09-19, the same day, by the room and corridor
// shrink in dungeon-floor.ts's sizeFor/fits/addRoom (idle time measured at half
// a floor was rooms getting cleared and then walked back over; the fix was to
// make a room cheaper to cross). Every pinned seed in this file changed with
// it, since a smaller room graph is a different floor. flooded-hall and
// strike-contact both came in comfortably under the ceiling above on their new
// seeds - 439 / 198,818 and 385 / 162,059 - which reads as the smaller rooms
// costing less to draw, not as anything about the frames themselves changing.
// junction did not: its new seed measured over the old 459 on draw calls
// alone even though its triangle count fell. The parapet along every border
// tile is batched into one InstancedMesh per 18-unit grid cell (see the
// `parapets` map above), so its draw-call count tracks how many of those
// cells the view touches, not how much wall is in it; a smaller room graph
// fits more rooms and their borders into the same capture radius, spreading
// them over more cells even as the total geometry shrinks.
//
// Unlike the other two, junction is not exactly reproducible run to run - six
// repeats measured calls from 498 to 502 and triangles from 343,528 to
// 343,716, which is something in this scene's own idle animation rather than
// this change (nothing here draws off an un-pinned random draw; it reads as
// small per-frame drift in which tiles the parapet grid batches touch at the
// exact 640ms mark). flooded-hall and strike-contact held their figures exact
// across the same six repeats: 439 / 198,818 and 385 / 162,059. The three
// figures below are the highest this round actually measured for each scene,
// not headroom stacked on top of that.
//
// Triangles tripled on 2026-09-22, by the owner, for the model round (plans
// 009-011: weapons, knight, enemies). The old ceilings were 198,818 / 343,716 /
// 236,196 and the flooded hall sat exactly on its figure, which left the
// characters no room to gain shape. Draw calls are unchanged and remain the
// binding constraint on how many separate parts a figure may be drawn as. This
// is headroom for the characters, not a target for the architecture.
const BUDGET = {
  // Plan 017, measured 2026-09-28 on SwiftShader on the re-staged scenes: flooded hall (seed 0x3) 395 /
  // 282,841, widest chamber (seed 0x6 court) 272 / 265,703, strike contact 271 / 205,308. Strike contact is
  // the one scene staged the same way as before, and its calls fell from 347 (2026-09-26) to 271: nothing of a
  // neighbouring room is in frame any more. The other two are new scenes and compare with nothing; the
  // flooded hall has two doors in frame, and a door is eleven meshes (arch, veil, five bars, sigil, ring),
  // which is what the 375 it read before the doorway alcoves went in rose by. Each call ceiling is the figure
  // measured, so the saving is kept rather than handed back as headroom. The triangle ceilings stay the
  // owner's model-round headroom; the widest chamber takes the junction's.
  // Plan 027, measured 2026-10-12 on SwiftShader: before 395 / 280,801 (Stage 0, main at 4269398, read twice), after
  // 397 / 280,649 (two repeats, identical). The delta is the Relic Seeker's kept cloak, head, satchel and elbow: his batches
  // split across kept groups (31 meshes to 32, +1 scene and +1 shadow call) and a 16-column poncho with fewer
  // triangles than the old torso batches it left (-152). The call ceiling is the figure measured; the triangle
  // ceiling stays the owner's model-round headroom, which the scene is far under. d3d11 read the same 397 / 280,649.
  // Plan 030, measured 2026-10-12 on SwiftShader (two repeats, identical): 412 / 285,011. The Relic Seeker drawn to the
  // sheet: 32 meshes to 40 (teal bands, wrist wraps and the lighter hair tips are batches of their own, the tabard carries
  // the braided rope, the free forearm and the sword forearm each gained a wrap and a band), +8 scene calls and +7 shadow
  // calls (the cowl no longer casts: it blacked itself and the yoke out under the key light). The triangles are his 4,400
  // against 1,808, drawn twice with the shadow pass. The call ceiling is the figure measured.
  'flooded-hall': { calls: 412, triangles: 596_454 },
  // Plan 022 Stage B: the biggest chamber the waves deal (floor three, seed 0x2's hall of ten bodies in waves of 3, 3 and 4), its last wave standing. A dormant wave to come draws nothing (Stage 0: 1, 5 and 9 dormant bodies all drew 201 calls,
  // 209,882 triangles, 56 shadow calls) but a corpse stays drawn and costs a standing body's calls (about 35 a body): with the six dead of the first two waves left in frame this scene read 586 calls / 294,968 triangles, 78 over the 508 above, so the
  // floor takes the dead of the waves before back as the next wave is rung (`corpseSink`: they sink into the paving over the rings' 0.9 s and are no longer drawn), and the frame is the four standing bodies of the last wave with six corpses lying undrawn.
  // Measured 2026-10-03 on SwiftShader, four repeats (`--repeat-each=4`) identical: 439 calls (69 under 508), 255,774 triangles, 152 geometries, 28 textures. Each ceiling is the figure measured; the scene fails below 60% of the calls.
  // The scene used to be drawn 400 ms after the last wave was staged and read 255,930 to 255,958 triangles from run to run (CI saw 255,946 over a ceiling of 255,942): the swings that fell the first two waves are real input, so each run reached
  // the staging on a different frame, and a body still being eased apart (staged 0.7 apart, under the crowd's spacing) or a corpse still sinking sat in a different place and in or out of a culling sphere by a few triangles. It now waits until
  // every body of the chamber and every corpse has stood still for a second, and the counts repeat exactly.
  // Plan 027, measured 2026-10-12 on SwiftShader: before 440 / 253,678 (Stage 0, read once), after 442 / 253,526 (two
  // repeats, identical), the same +2 calls and -152 triangles as the flooded hall, for the same reason. The call ceiling
  // is the figure measured; the triangle ceiling is left where plan 022 set it, above both readings. d3d11 read the
  // same 442 / 253,526.
  // Plan 030, measured 2026-10-12 on SwiftShader (two repeats, identical): 457 / 257,888, the same +15 calls as the flooded
  // hall for the same reason. The triangle ceiling plan 022 set (255,886) is under the new reading by the Relic Seeker's
  // added shape alone, so both ceilings are now the figure measured.
  'wave-chamber': { calls: 457, triangles: 257_888 },
  // Twelve scene ceilings lost their scenes in 7d093d1 and were removed by plan 027; their history is in git and progress.md.
} as const;

/** Draws the staged frame, then holds its counters against the ceiling. */
const spend = async (game: Game, scene: keyof typeof BUDGET) => {
  await game.step(0, true);
  const { calls, triangles, geometries, textures } = (await game.state()).render;
  console.log(
    `BUDGET ${scene} calls=${calls}/${BUDGET[scene].calls} triangles=${triangles}/${BUDGET[scene].triangles} geometries=${geometries} textures=${textures}`,
  );
  expect(
    calls,
    `${scene} draws more often than the budget allows; say what bought it and raise the number deliberately`,
  ).toBeLessThanOrEqual(BUDGET[scene].calls);
  expect(
    triangles,
    `${scene} pushes more triangles than the budget allows; say what bought it and raise the number deliberately`,
  ).toBeLessThanOrEqual(BUDGET[scene].triangles);
  // And a floor under each: a ceiling alone passes a frame that drew nothing, or a scene whose pack never
  // came into view. Every staged scene measured at 73-84% of its call budget and 30-42% of its triangles.
  expect(calls, `${scene} drew far fewer calls than it was measured at; the scene is not the one this budget was set on`).toBeGreaterThanOrEqual(BUDGET[scene].calls * 0.6);
  expect(triangles, `${scene} drew far fewer triangles than it was measured at`).toBeGreaterThanOrEqual(BUDGET[scene].triangles * 0.2);
};

test.describe('the busiest fight', () => {
  test.use({ seeds: [0x3] });
  test('a flooded hall with the watch closing stays inside its budget', async ({
    game,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const hall = floor.rooms.find(
      (room) =>
        room.theme === 'flooded' &&
        room.encounter !== 'ambush' &&
        floor.spawns.filter((s) => s.room === room.id && s.kind === 'guard')
          .length >= 3,
    );
    expect(hall, 'seed 0x3 no longer holds the hall this budget was set on')
      .toBeDefined();
    const pack = floor.spawns
      .filter((spawn) => spawn.room === hall!.id)
      .map((spawn) => ({ x: spawn.x * TILE, z: spawn.z * TILE }));
    const stand = openSpot(floor, roomCentre(floor, hall!.id), {
      radius: 10,
      avoid: pack,
      clearance: 5.5,
    });
    await game.teleport(stand.x, stand.z);
    await game.step(900);
    await spend(game, 'flooded-hall');
  });
});

/**
 * three.js compiles the number of point lights into every lit shader and unrolls its light loop once per
 * light. When the art pass gave every sconce and lantern its own light, each program grew dozens of times
 * over (a 44 s cold compile for 57 programs under d3d11), every lit pixel paid for all of them, and a floor
 * with a different sconce count recompiled everything on the way down. The atmosphere now lays out light
 * anchors and a fixed pool is lent to the nearest: the count is the same small number on every floor.
 */
test.describe('the light budget', () => {
  test.use({ seeds: [0x60] });
  // One walk down and back for both claims: each rebuild is the expensive part, and both are read off the
  // same drawn frame after it.
  test('every floor draws with the same fixed set of point lights, and a rebuild reuses the programs the last one compiled', async ({ game }) => {
    const lights: number[] = [], programs: number[] = [];
    for (const level of [1, 2, 3, 1]) {
      await game.buildFloor(level);
      await game.step(16, true);
      const { render } = await game.state();
      lights.push(render.pointLights);
      programs.push(render.programs);
    }
    // Plan 026 (D4): the pool is LIGHT_POOL (24, every source of the most crowded chamber) plus the knight's fill. The count, not its size, is what this guards.
    expect(lights[0], 'more point lights than the pool and the fill').toBeLessThanOrEqual(LIGHT_POOL + 1);
    expect(lights, 'a floor changed the point-light count, which recompiles every lit shader').toEqual([lights[0], lights[0], lights[0], lights[0]]);
    // three.js destroys a program when its last material is disposed, and every rebuild disposes the old
    // floor's materials - so without pinning the count dips after each rebuild and the same programs compile
    // again, seconds of stall per floor under software GL.
    for (let i = 1; i < programs.length; i++) expect(programs[i], `rebuild ${i} dropped compiled programs: ${programs.join(' -> ')}`).toBeGreaterThanOrEqual(programs[i - 1]);
    // And a floor already seen compiles nothing: a cache key that changes per build (a texture uuid in
    // it, once) makes a new program on every rebuild, and pinning would then keep every one of them.
    expect(programs[3], `building floor 1 again compiled new programs: ${programs.join(' -> ')}`).toBe(programs[2]);
  });

  test('a software rasteriser draws the reduced post chain, a GPU the full one', async ({ game }) => {
    await game.step(16, true);
    // Only `d3d11` selects a GPU (playwright.config.ts); any other value, a typo included, is still SwiftShader.
    expect((await game.state()).render.quality).toBe(CAPTURING ? 'full' : process.env.GAME_TEST_GL === 'd3d11' ? 'full' : 'reduced');
  });
});

// The full post chain is where GTAO runs its own render of the scene, which is what used to draw the
// moon's shadow map a second time every frame. Software GL gets the reduced chain with GTAO off, so this
// scenario asks for full quality explicitly and needs a page of its own to do it.
//
// That page is a fresh boot that ends up under a driver's clock, which is exactly what three checks that
// lost their own pages in PR #99 (robustness.spec.ts, and loading.spec.ts's boot race) need, so they ride
// on it rather than paying for two more boots: a reset landing while the boot is still polling its
// programs (the 2026-09-25 wedge, fixed by `boot` claiming `building`); a GPU context lost and handed back
// (the world pauses, and the restored context draws the keep rather than a black frame); and, last because
// it ends the page, a throw under the driver clock (one report, the fault screen, no further steps).
// Not restored: the throw under real animation frames and the throw out of a floor build (robustness.spec.ts
// at baacc07); both share `fail` with the driver-clock path checked here.
test.describe('the full post chain', () => {
  test.use({ isolate: true });
  test.describe.configure({ timeout: 300_000 });
  test('draws the shadow map once a frame, never multisamples a canvas it only copies to, and survives a mid-boot reset, a lost GPU context and a fault', async ({ page }) => {
    const pageErrors: string[] = [], consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto('/?quality=full&boot=eager');
    // As early as the hooks allow - they go up as soon as the floor exists, well before its programs are
    // linked - so the reset lands inside the boot's async window. That is read in the same task as the
    // reset: one that landed after the boot finished would pass everything below without running the race.
    // It is read off `world-ready` (set once the boot's programs are warm), not off `building`, which is the
    // very flag the fix sets: with the fix gone, `building` reads false mid-boot and would blame the timing.
    await page.waitForFunction(() => typeof (window as GameWindow).render_game_to_text === 'function', undefined, { timeout: WARM_UP });
    const inWindow = await page.evaluate(() => {
      const booting = !document.querySelector('.game-shell.world-ready');
      (window as GameWindow).dungeonTest!.reset();
      return booting;
    });
    expect(inWindow, 'the reset landed after the boot had finished, so the race was never run').toBe(true);
    // The interrupted boot still has to land, and the real press below has to be answered: before `boot`
    // claimed `building`, the reset started a second build that superseded the boot's, and every press
    // after it waited on `enterWhenBuilt` for good.
    await page.waitForFunction(() => {
      const hook = (window as GameWindow).render_game_to_text;
      return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
    }, undefined, { timeout: WARM_UP });
    await page.evaluate(() => (window as GameWindow).advanceTime!(0, false));
    await enterKeep(page);
    await expect(page.locator('.intro-screen'), 'the press after a mid-boot reset was never answered').toBeHidden({ timeout: WARM_UP });
    const frame = await page.evaluate(() => {
      (window as GameWindow).advanceTime!(16, true);
      const canvas = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const state = JSON.parse((window as GameWindow).render_game_to_text!()) as { render: { quality: string; passes: string[]; shadow: { draws: number; calls: number }; stage: { ao: boolean; bloom: boolean; adaptive: boolean } } };
      return { ...state.render, antialias: canvas.getContext('webgl2')!.getContextAttributes()!.antialias };
    });
    expect(frame.quality).toBe('full');
    // `?quality=` pins the level: the governor is off, so a software rasteriser's slow frames never step this page down.
    expect(frame.stage, 'a pinned quality left the governor on, or the passes off').toMatchObject({ ao: true, bloom: true, adaptive: false });
    expect(frame.passes, 'GTAO is in the chain, so the scene is rendered twice a frame').toContain('GTAOPass');
    expect(frame.shadow.draws, 'the shadow map is drawn by the scene pass and not again by GTAO').toBe(1);
    expect(frame.shadow.calls, 'and that one draw still covers the casters').toBeGreaterThan(0);
    // The scene is drawn into the composer's own targets, so the canvas only ever receives the last
    // full-screen pass: a multisampled one bought a resolve per frame and not one smoothed edge.
    expect(frame.antialias).toBe(false);

    // A lost GPU context: three.js restores the context, but only the game can stop the world, or the
    // knight fights on behind a frozen picture.
    const brightness = () => page.evaluate(() => {
      (window as GameWindow).advanceTime!(0, true);
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(gl, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return sum / (pixels.length / 4);
    });
    const mode = async () => (JSON.parse(await page.evaluate(() => (window as GameWindow).render_game_to_text!())) as { mode: string; fault: boolean });
    const before = await brightness();
    expect(before, 'the keep was on screen to begin with').toBeGreaterThan(10);
    await page.evaluate(() => {
      const gl = (document.querySelector('.game-canvas canvas') as HTMLCanvasElement).getContext('webgl2')!;
      const lose = gl.getExtension('WEBGL_lose_context')!;
      (window as Window & { __lose?: WEBGL_lose_context }).__lose = lose;
      lose.loseContext();
    });
    await expect(page.locator('.display-notice'), 'the loss is said on screen').toBeVisible();
    expect((await mode()).mode, 'and the world is held rather than fought behind a frozen image').toBe('paused');
    await page.evaluate(() => (window as Window & { __lose?: WEBGL_lose_context }).__lose!.restoreContext());
    await expect(page.locator('.display-notice'), 'the notice lifts when the display comes back').toBeHidden();
    expect((await mode()).mode, 'and the player chooses when to step back in').toBe('paused');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as GameWindow).advanceTime!(200, false));
    expect((await mode()).mode).toBe('playing');
    // Every texture, target and program is rebuilt on the new context, or the frame comes back black.
    expect(await brightness(), 'the restored context draws the keep, not a black frame').toBeGreaterThan(before * 0.6);

    // Last, because it ends the page: a throw from the first line of the world's tick (`update` polls the
    // pads before any other input). The driver that stepped into it is told, the screen says so, the fault is
    // reported once and never escapes, and a stopped world refuses to be stepped again.
    await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { throw new Error('planted fault'); } }));
    await expect(page.evaluate(() => (window as GameWindow).advanceTime!(16, false)), 'the driver fails where the throw happened').rejects.toThrow(/planted fault/);
    await expect(page.locator('.fault-screen')).toBeVisible();
    await expect(page.locator('.fault-screen').getByRole('button', { name: 'RELOAD' })).toBeVisible();
    await expect(page.evaluate(() => (window as GameWindow).advanceTime!(16, false))).rejects.toThrow(/the keep has stopped/);
    expect((await mode()).fault).toBe(true);
    expect(consoleErrors.filter((line) => line.includes('The keep stopped')), 'the fault is reported once').toHaveLength(1);
    expect(pageErrors, 'and nothing on this page escaped as an uncaught error').toEqual([]);
  });
});

// Plan 022 Stage B: the heaviest chamber the waves deal. D2 caps a wave at five bodies and a chamber at ten, and Stage 0 measured that a dormant body costs nothing (the wave to come is not drawn), but a dead one stays in the scene as a corpse until the floor takes it back (when the next wave is rung). So the worst frame is the last wave of the biggest chamber standing: floor three, seed 0x2's room 9, a hall of
// ten bodies in three waves (3, 3 and 4 with a warden at the head of the first and the last). The first two waves are felled with real blows, the third is called by the chamber itself (rings, then bodies), and the frame is drawn with the
// whole of it in view, the third wave held quiet. The dead of the first two have been taken back by the floor when the third was rung.
test.describe('the biggest chamber the waves deal, at its last wave', () => {
  test.use({ waves: null, seeds: [0x1, 0x2] });
  test('a floor-three hall of ten bodies, the last wave standing over the two before it, stays inside its budget', async ({ game, page }) => {
    test.slow();
    await game.enter();
    await game.buildFloor(3);
    await game.step(0);
    const floor = await game.floor(), opening = await game.state();
    expect(floor.seed, 'the page was not handed the seed this scenario is staged on: pick another seed').toBe(0x2);
    const bodies = (state: typeof opening, room: number, wave: number) => state.enemies.map((e, index) => ({ e, index })).filter(({ e }) => e.room === room && e.wave === wave && !e.buried);
    const room = floor.rooms.find((r) => [1, 2, 3].map((wave) => bodies(opening, r.id, wave).length).join() === '3,3,4');
    expect(room, 'seed 0x2 floor three no longer holds a chamber of three waves of 3, 3 and 4: pick another seed').toBeDefined();
    const waves = [1, 2, 3].map((wave) => bodies(opening, room!.id, wave));
    await game.teleport(room!.entry.x * TILE, room!.entry.z * TILE);
    await game.step(200);
    const stance = stanceNear(floor, { x: room!.x * TILE, z: room!.z * TILE }, 5, 4);
    await game.teleport(stance.x, stance.z);
    await game.step(50);
    const stage = async (wave: typeof waves[number], extra: { cooldown: number; windup: number }) =>
      game.configureCombat({ health: opening.maxHealth, enemies: wave.map(({ index }, i) => ({ index, x: stance.slots[i].x, z: stance.slots[i].z, hp: 1, ...extra, aim: { x: -stance.facing.x, z: -stance.facing.z } })) });
    for (const [n, wave] of [[1, waves[0]], [2, waves[1]]] as const) {
      await stage(wave, { cooldown: 30, windup: 0.3 });
      await game.step(16);
      await swing(page, stance.key);
      await game.step(220);
      const felled = await game.state();
      expect(felled.enemies.filter((e) => e.room === room!.id && !e.buried && e.wave <= n && e.awake), `wave ${n} survived the blow`).toHaveLength(0);
      // Floor three deals elites, which pay double experience (plan 022 D9): felling the wave can cross a rank, and the card the knight is then offered freezes the world, so the next wave is never called. He takes it, with the real key.
      if (felled.boonOffer) { await game.takeBoon(); await game.step(50); }
      await until(game, `wave ${n + 1} standing`, (s) => bodies(s, room!.id, n + 1).every(({ e }) => e.awake), 4000);
    }
    // The last wave stands and is held quiet; the two before it lie where they fell.
    await stage(waves[2], { cooldown: 999, windup: 0 });
    // Wait until the frame has stopped changing: the swings above are real input, so each run reaches this point on a slightly different frame, and a body still being eased apart by the crowd's spacing (staged 0.7 apart, under CROWD_SPACING) or a corpse still sinking sits at a different place
    // in each run and so in or out of a culling sphere by a few triangles (255,930 to 255,958 in four runs). Held until every standing body and every corpse has stood still for a second, as the King's chamber waits for the reserve.
    const placed = (s: typeof opening) => JSON.stringify([s.enemies.filter((e) => e.room === room!.id).map((e) => [e.x, e.z, e.visible]), s.corpses.map((c) => [c.y, c.visible]), s.waveMarks.length]);
    let still = 0, before = '';
    for (let waited = 0; waited < 10_000 && still < 10; waited += 100) {
      await game.step(100);
      const now = placed(await game.state());
      still = now === before ? still + 1 : 0; before = now;
    }
    expect(still, 'the last wave and the corpses never came to rest in ten seconds').toBeGreaterThanOrEqual(10);
    const state = await game.state();
    expect(state.corpses, 'the two waves before lie dead: six corpses').toHaveLength(6);
    expect(state.corpses.filter((c) => c.visible), 'a corpse of the waves before is still drawn: the floor takes them back as the next wave is rung').toHaveLength(0);
    expect(bodies(state, room!.id, 3).every(({ e }) => e.awake && e.visible), 'the last wave is not all standing in view').toBe(true);
    expect(state.enemies.filter((e) => e.room === room!.id && !e.buried), 'the chamber holds more than its last wave').toHaveLength(4);
    expect(state.health, 'the knight fell before the frame was drawn').toBeGreaterThan(0);
    await spend(game, 'wave-chamber');
  });
});

