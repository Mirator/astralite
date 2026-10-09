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
  'flooded-hall': { calls: 396, triangles: 596_454 },
  'widest-chamber': { calls: 274, triangles: 1_031_148 },
  // Not one of the two heaviest frames, and here for a different reason: it is
  // the only scene that draws the blade trail, the impact accents and a hit
  // flash at once. Without it, work on how a blow lands is bounded by two
  // frames that contain no blow, and a change can spend draw calls freely in
  // the one place it actually touches.
  'strike-contact': { calls: 274, triangles: 708_588 },
  // Plan 018: the heaviest chamber the generator can now deal - a late pack with a caller in it, the shieldbearer, the
  // pyre and the warden standing, and the caller's four rattlers raised. Staged in the level-3 arena, and compared like
  // for like with today's heaviest (a floor-three purse, `guard:4,stalker:2,warden:1`: 7 bodies, 486 calls, 286,269
  // triangles), because four guards in the gate alone already read 398 and that measured body count, not the new kinds.
  // Measured 2026-09-29 on d3d11 (whose counters equalled SwiftShader's on the three scenes above): 8 bodies, 508 calls,
  // 286,247 triangles, 184 shadow calls, +4.5% calls on the purse. Each ceiling is the figure measured.
  'caller-chamber': { calls: 509, triangles: 286_423 },
  // Plan 021 Stages B and E: the Captain in the tightest goal chamber floors one and two lay (seed 33 floor two, a 45-tile crypt), framed 5.5 from the boss, held quiet. Stage B took it in floor three's crypt (320 / 246,034, 188 under the 508 above), the
  // only place it stood as the last floor's boss; the Bone King now holds floor three, so the scene moved to the pool bosses' room: 273 calls, 212,078 triangles, 235 under the 508. Measured 2026-10-03 on SwiftShader. Each ceiling is the figure measured.
  'captain-chamber': { calls: 274, triangles: 212_174 },
  // Plan 021 Stage E: the Bone King in the tightest goal chamber floor three can lay (seed 0x86, a 45-tile crypt) with his whole reserve standing (reserveSize: four rattlers), the knight framed 5.5 from him: the worst boss chamber, and the one the 508 above is held to.
  // Measured 2026-10-03 on SwiftShader, twice, identical: 428 calls, 268,012 triangles, 80 calls under the 508 (Stage 0: a reserve of six fits at 491, seven at 520). Each ceiling is the figure measured.
  'king-chamber': { calls: 428, triangles: 268_096 },
  // Plan 021 Stages C and D: the pool bosses in the tightest goal chamber floors one and two lay (seed 33 floor two, a 45-tile crypt), each the boss alone, held quiet, framed 5.5 from it. Measured 2026-10-03 on SwiftShader.
  // The Pyre Mother: 291 calls, 210,062 triangles (the floor-two crypt is cheaper than the floor-three one the Captain's number was taken in), 217 under the 508 above. Each ceiling is the figure measured.
  'mother-chamber': { calls: 292, triangles: 210_158 },
  // The Tide Hound: 253 calls, 210,696 triangles (a leaner figure than the Mother's by calls, a hair heavier by triangles), 255 under the 508 above.
  'hound-chamber': { calls: 254, triangles: 210_792 },
  // The Bastion: 273 calls, 212,962 triangles, 235 under the 508 above. Every pool boss's chamber is under it, with 191 to 255 to spare (Mother 217, Hound 255, Bastion 235, the Captain 235 in the same crypt; the King with his reserve 80).
  'bastion-chamber': { calls: 274, triangles: 213_058 },
  // Plan 022 Stage B: the biggest chamber the waves deal (floor three, seed 0x2's hall of ten bodies in waves of 3, 3 and 4), its last wave standing. A dormant wave to come draws nothing (Stage 0: 1, 5 and 9 dormant bodies all drew 201 calls,
  // 209,882 triangles, 56 shadow calls) but a corpse stays drawn and costs a standing body's calls (about 35 a body): with the six dead of the first two waves left in frame this scene read 586 calls / 294,968 triangles, 78 over the 508 above, so the
  // floor takes the dead of the waves before back as the next wave is rung (`corpseSink`: they sink into the paving over the rings' 0.9 s and are no longer drawn), and the frame is the four standing bodies of the last wave with six corpses lying undrawn.
  // Measured 2026-10-03 on SwiftShader, four repeats (`--repeat-each=4`) identical: 439 calls (69 under 508), 255,774 triangles, 152 geometries, 28 textures. Each ceiling is the figure measured; the scene fails below 60% of the calls.
  // The scene used to be drawn 400 ms after the last wave was staged and read 255,930 to 255,958 triangles from run to run (CI saw 255,946 over a ceiling of 255,942): the swings that fell the first two waves are real input, so each run reached
  // the staging on a different frame, and a body still being eased apart (staged 0.7 apart, under the crowd's spacing) or a corpse still sinking sat in a different place and in or out of a culling sphere by a few triangles. It now waits until
  // every body of the chamber and every corpse has stood still for a second, and the counts repeat exactly.
  'wave-chamber': { calls: 440, triangles: 255_886 },
  // Plan 025 Stage F: the most furnished fight chamber floor one lays (seed 0x3c, room 14, a rotunda ambush: an urn, a crate, a keg, a spike plate, a chest and cover, so
  // every prop mesh there is, six instanced draws), its four bodies sprung, framed from its heart; and the same frame with the chambers plain (`?rooms=plain`), so the
  // difference is what the furniture costs. Measured 2026-10-08 on d3d11 only: furnished 378 calls, 241,267 triangles; plain 371 calls, 240,769 triangles (+7 calls, +498 triangles,
  // 130 under the 508). CI's SwiftShader (run 37769551752, 2026-10-08) read furnished 377 calls, 241,259 triangles and plain 372 calls, 240,777 triangles: the
  // renderers disagree by a call and a few triangles either way, so each call ceiling is the higher of the two readings. The triangles are not
  // fixed from run to run on SwiftShader (three CI runs, 2026-10-08: plain 240,769 / 240,777 / 240,785, furnished 241,259 / 241,263 and
  // d3d11's 241,267; the calls never moved), so each triangle ceiling sits just over the highest reading.
  'furnished-chamber': { calls: 378, triangles: 241_300 },
  'plain-chamber': { calls: 372, triangles: 240_800 },
  // Plan 025 Stage G (D12 b): two bombers mid-throw beside a pyre and a warden on floor two, and the same stand with the two guards the pack mix would otherwise have dealt in their place, so the difference is
  // what the bomber costs: its figure, and its rings (the shared fire rings, already in the scene). Measured 2026-10-08 on d3d11 only: two bombers with one ring drawn 401 calls, 252,093 triangles; two guards
  // 390 calls, 252,753 triangles (+11 calls, about five a bomber and one for the ring; -660 triangles), 107 under the 508. SwiftShader has read the Stage F scenes a call and up to 16 triangles off d3d11 (above), so each ceiling is the d3d11 figure plus that margin until CI reads these.
  'bomber-pair': { calls: 402, triangles: 252_120 },
  'guard-pair': { calls: 391, triangles: 252_780 },
  // Plan 025 Stage B, measured 2026-10-07 on d3d11 against the same scenes on d3d11 at 5045a89, and added to each ceiling above as a
  // delta (d3d11 and SwiftShader disagree by up to 13 calls on some of these scenes, so a d3d11 figure is not a SwiftShader ceiling):
  // every scene +1 call for the chamber's painted sconce pools (one merged mesh a chamber, single pass, only the knight's chamber drawn)
  // and +96 to +192 triangles (16 a disc); the widest chamber +2 and strike contact +3, because they are drawn open and empty, where
  // each door's floating name is a sprite (plan 025 D2 b; labels hide while bodies stand, which is why no fight scene pays for them).
  // The caller chamber goes one over the 508 the other scenes are held under: that is the price of every sconce lighting its floor.
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
test.describe('the full post chain', () => {
  test.use({ isolate: true });
  test.describe.configure({ timeout: 240_000 });
  test('draws the shadow map once a frame and never multisamples a canvas it only copies to', async ({ page }) => {
    await page.goto('/?quality=full&boot=eager');
    await page.waitForFunction(() => {
      const hook = (window as GameWindow).render_game_to_text;
      return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
    }, undefined, { timeout: WARM_UP });
    await page.evaluate(() => (window as GameWindow).advanceTime!(0, false));
    await enterKeep(page);
    await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
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

