import {
  CAPTURING,
  expect,
  type Game,
  openSpot,
  roomCentre,
  strikeStance,
  test,
  TILE,
} from './helpers.ts';

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
  'flooded-hall': { calls: 439, triangles: 596_454 },
  junction: { calls: 502, triangles: 1_031_148 },
  // Not one of the two heaviest frames, and here for a different reason: it is
  // the only scene that draws the blade trail, the impact accents and a hit
  // flash at once. Without it, work on how a blow lands is bounded by two
  // frames that contain no blow, and a change can spend draw calls freely in
  // the one place it actually touches.
  'strike-contact': { calls: 447, triangles: 708_588 },
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
};

test.describe('the busiest fight', () => {
  test.use({ seeds: [0x60] });
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
    expect(hall, 'seed 0x60 no longer holds the hall this budget was set on')
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

test.describe('the widest room', () => {
  test.use({ seeds: [0x150] });
  test('a junction branching three ways stays inside its budget', async ({
    game,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const junction = floor.rooms.find(
      (room) =>
        floor.spine.includes(room.id) &&
        floor.edges.filter(([a, b]) => a === room.id || b === room.id).length >=
          4,
    );
    expect(
      junction,
      'seed 0x150 no longer holds the junction this budget was set on',
    ).toBeDefined();
    const centre = roomCentre(floor, junction!.id);
    await game.teleport(centre.x, centre.z);
    await game.step(640);
    await spend(game, 'junction');
  });
});

test.describe('the moment of contact', () => {
  test.use({ seeds: [0x1] });
  test('a landed blow stays inside its budget', async ({ game }) => {
    await game.enter();
    await game.step(120);
    const floor = await game.floor();
    const target = { x: 0, z: 0 };
    const stance = strikeStance(floor, target);
    await game.teleport(stance.x, stance.z);
    await game.page.keyboard.down(stance.key);
    await game.step(16);
    await game.page.keyboard.up(stance.key);
    const blade = (await game.state()).weapon.strikeDamage;
    await game.configureCombat({
      enemies: [
        { index: 0, x: target.x, z: target.z, hp: Math.min(8, blade * 2), cooldown: 10, windup: 0 },
      ],
    });
    await game.act('attack');
    await game.step(130);
    const state = await game.state();
    expect(
      state.player.attackTime,
      'the frame this budget covers is not inside a swing',
    ).toBeGreaterThan(0);
    await spend(game, 'strike-contact');
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
  test('every floor draws with the same small, fixed set of point lights', async ({ game }) => {
    const counts: number[] = [];
    for (const level of [1, 2, 3]) {
      await game.buildFloor(level);
      await game.step(16, true);
      counts.push((await game.state()).render.pointLights);
    }
    expect(counts[0], 'more point lights than the torches, the fill and the anchor pool').toBeLessThanOrEqual(9);
    expect(counts, 'a floor changed the point-light count, which recompiles every lit shader').toEqual([counts[0], counts[0], counts[0]]);
  });

  test('a rebuild reuses the shader programs the last floor compiled instead of recompiling them', async ({ game }) => {
    const programs: number[] = [];
    for (const level of [1, 2, 3, 1]) {
      await game.buildFloor(level);
      await game.step(16, true);
      programs.push((await game.state()).render.programs);
    }
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
    expect((await game.state()).render.quality).toBe(CAPTURING ? 'full' : process.env.GAME_TEST_GL ? 'full' : 'reduced');
  });
});
