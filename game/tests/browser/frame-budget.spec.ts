import {
  CAPTURING,
  enterKeep,
  expect,
  type Game,
  type GameWindow,
  hasClearPath,
  laneSpot,
  openSpot,
  roomCentre,
  settleBoss,
  strikeStance,
  test,
  TILE,
  WARM_UP,
} from './helpers.ts';
import { reserveSize } from '../../app/dungeon-bestiary.ts';
import { altarHall } from '../../app/dungeon-floor.ts';
import { ARM_ORDER, freshMeta } from '../../app/dungeon-meta.ts';

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
  'flooded-hall': { calls: 395, triangles: 596_454 },
  'widest-chamber': { calls: 272, triangles: 1_031_148 },
  // Not one of the two heaviest frames, and here for a different reason: it is
  // the only scene that draws the blade trail, the impact accents and a hit
  // flash at once. Without it, work on how a blow lands is bounded by two
  // frames that contain no blow, and a change can spend draw calls freely in
  // the one place it actually touches.
  'strike-contact': { calls: 271, triangles: 708_588 },
  // Plan 018: the heaviest chamber the generator can now deal - a late pack with a caller in it, the shieldbearer, the
  // pyre and the warden standing, and the caller's four rattlers raised. Staged in the level-3 arena, and compared like
  // for like with today's heaviest (a floor-three purse, `guard:4,stalker:2,warden:1`: 7 bodies, 486 calls, 286,269
  // triangles), because four guards in the gate alone already read 398 and that measured body count, not the new kinds.
  // Measured 2026-09-29 on d3d11 (whose counters equalled SwiftShader's on the three scenes above): 8 bodies, 508 calls,
  // 286,247 triangles, 184 shadow calls, +4.5% calls on the purse. Each ceiling is the figure measured.
  'caller-chamber': { calls: 508, triangles: 286_247 },
  // Plan 021 Stages B and E: the Captain in the tightest goal chamber floors one and two lay (seed 33 floor two, a 45-tile crypt), framed 5.5 from the boss, held quiet. Stage B took it in floor three's crypt (320 / 246,034, 188 under the 508 above), the
  // only place it stood as the last floor's boss; the Bone King now holds floor three, so the scene moved to the pool bosses' room: 273 calls, 212,078 triangles, 235 under the 508. Measured 2026-10-03 on SwiftShader. Each ceiling is the figure measured.
  'captain-chamber': { calls: 273, triangles: 212_078 },
  // Plan 021 Stage E: the Bone King in the tightest goal chamber floor three can lay (seed 0x86, a 45-tile crypt) with his whole reserve standing (reserveSize: four rattlers), the knight framed 5.5 from him: the worst boss chamber, and the one the 508 above is held to.
  // Measured 2026-10-03 on SwiftShader, twice, identical: 428 calls, 268,012 triangles, 80 calls under the 508 (Stage 0: a reserve of six fits at 491, seven at 520). Each ceiling is the figure measured.
  'king-chamber': { calls: 427, triangles: 267_984 },
  // Plan 021 Stages C and D: the pool bosses in the tightest goal chamber floors one and two lay (seed 33 floor two, a 45-tile crypt), each the boss alone, held quiet, framed 5.5 from it. Measured 2026-10-03 on SwiftShader.
  // The Pyre Mother: 291 calls, 210,062 triangles (the floor-two crypt is cheaper than the floor-three one the Captain's number was taken in), 217 under the 508 above. Each ceiling is the figure measured.
  'mother-chamber': { calls: 291, triangles: 210_062 },
  // The Tide Hound: 253 calls, 210,696 triangles (a leaner figure than the Mother's by calls, a hair heavier by triangles), 255 under the 508 above.
  'hound-chamber': { calls: 253, triangles: 210_696 },
  // The Bastion: 273 calls, 212,962 triangles, 235 under the 508 above. Every pool boss's chamber is under it, with 191 to 255 to spare (Mother 217, Hound 255, Bastion 235, the Captain 235 in the same crypt; the King with his reserve 80).
  'bastion-chamber': { calls: 273, triangles: 212_962 },
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

// Plan 017: the junction this scene was, a trunk room with three corridors out of it and its neighbours'
// walls in frame, no longer exists - chambers are islands and nothing else is ever in view. Its successor
// is the largest footprint the generator lays, a full-size court, framed from its heart.
test.describe('the widest room', () => {
  test.use({ seeds: [0x6] });
  test('the widest chamber, framed from its heart, stays inside its budget', async ({
    game,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const court = floor.rooms.find((room) => room.role === 'path' && room.shape === 'court' && room.halfX >= 8 && room.halfZ >= 7);
    expect(court, 'seed 0x6 no longer holds the full-size court this budget was set on').toBeDefined();
    const centre = roomCentre(floor, court!.id);
    await game.teleport(centre.x, centre.z);
    await game.step(640);
    await spend(game, 'widest-chamber');
  });
});

// Plan 019 Stage C: the armoury holds a rack for every owned arm but the one in hand, so with the whole armoury bought it stands six
// at once: seven slots, but one arm is always in the knight's hand. The operator accepted what that costs on 2026-10-01, with no remedy
// (Stage 0's stop rule had tripped: seed 0x1's gate drew 236 calls with the old single rack and 310 with seven racks staged by hand,
// shadow calls 61 to 92; the cost was chosen over merging or instancing the rack parts). This replaces that stop rule with a bound from
// both sides: the room bare and with all six racks, so a rack that stopped being drawn, or a part added to one, moves a number and has
// to be argued for.
// Plan 020 moved the armoury from floor one's Tide Gate to the Tide Altar's hall, so the bound is the hall's: HALL_SEED's room with its
// altar (the shrine's disc and crystal) at its heart, which is what the first screen of every attempt draws. Plan 020 Stage 0 had
// measured the old gate at the same stand (seed 0x1: bare 224 calls, 198,092 triangles, 56 shadow calls; six racks 298, 203,164, 87) and
// the hall with the stair's heart standing in for the altar (bare 221 / 115,129 / 69; six racks 294 / 120,197 / 100), the -1.3% on calls
// that cleared the 10% stop rule.
// Measured 2026-10-02 on SwiftShader at the stand below in the hall (HALL_SEED 2063), identical on repeat:
//   bare hall  218 calls, 114,629 triangles, 69 shadow calls;
//   six racks  289 calls, 119,695 triangles, 100 shadow calls (+71 calls, +33%; +5,066 triangles, +4.4%; +31 shadow calls, +45%).
// Against the old gate's 298 / 203,164 / 87 that is -3.0% on calls and -41% on triangles (the hall is one room, the gate was one room of a
// floor's many islands), and 13 more shadow calls than the gate: the altar's disc and crystal, and two braziers where the gate had none lit.
// Each ceiling is the figure measured (counts are deterministic: three.js's own tally of a fixed scene); each floor is 95% of it.
const ARMOURY = { empty: { calls: 218, triangles: 114_629, shadowCalls: 69 }, full: { calls: 289, triangles: 119_695, shadowCalls: 100 } };
test.describe('the Tide Altar\'s hall with the whole armoury bought', () => {
  test('six racks stand in the hall, and their cost stays where it was measured', async ({ game }) => {
    const drawn = async () => {
      const floor = altarHall();
      const racks = (await game.state()).racks;
      const stand = openSpot(floor, roomCentre(floor, 0), { radius: 4, avoid: racks, clearance: 1.6 });
      await game.teleport(stand.x, stand.z);
      await game.step(640);
      await game.step(0, true);
      const { render } = await game.state();
      return { racks: racks.length, calls: render.calls, triangles: render.triangles, shadowCalls: render.shadow.calls };
    };
    await game.setMeta({ ...freshMeta(), arms: [...ARM_ORDER], arm: 'tideblade' });
    await game.enter();
    await game.buildHall();
    expect((await game.state()).hall, 'precondition: the scene drawn is the hall').toBe(true);
    const full = await drawn();
    // A bare hall from the same stand: the difference is the racks and nothing else.
    await game.setMeta(freshMeta());
    await game.buildHall();
    await game.step(0);
    const empty = await drawn();
    console.log(`ARMOURY empty=${JSON.stringify(empty)} full=${JSON.stringify(full)}`);
    expect(empty.racks, 'the bare hall stood a rack').toBe(0);
    expect(full.racks, 'the armoury is not six racks: seven arms, one in hand').toBe(6);
    for (const [name, got, want] of [['empty', empty, ARMOURY.empty], ['full', full, ARMOURY.full]] as const) {
      expect(got.calls, `${name} hall draws more often than measured; say what bought it and raise the number deliberately`).toBeLessThanOrEqual(want.calls);
      expect(got.calls, `${name} hall draws far fewer calls than it was measured at`).toBeGreaterThanOrEqual(want.calls * 0.95);
      expect(got.triangles, `${name} hall pushes more triangles than measured`).toBeLessThanOrEqual(want.triangles);
      expect(got.triangles, `${name} hall pushes far fewer triangles than measured`).toBeGreaterThanOrEqual(want.triangles * 0.95);
      expect(got.shadowCalls, `${name} hall casts more shadow draws than measured`).toBeLessThanOrEqual(want.shadowCalls);
      expect(got.shadowCalls, `${name} hall casts far fewer shadow draws than measured`).toBeGreaterThanOrEqual(want.shadowCalls * 0.95);
    }
    // And the racks themselves are what was added: some draw calls and some triangles, and not the order of a second hall.
    expect(full.calls - empty.calls, 'six racks added no draw calls, so they are not being drawn').toBeGreaterThan(20);
    expect(full.triangles - empty.triangles, 'six racks added no triangles').toBeGreaterThan(1000);
    expect(full.calls, 'six racks cost more than half again the bare hall').toBeLessThan(empty.calls * 1.5);
  });
});

test.describe('the busiest chamber plan 018 deals', () => {
  test('a caller with four rattlers standing beside a shieldbearer, a pyre and a warden stays inside its budget', async ({ game, page }) => {
    await page.evaluate(() => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(['bonecaller', 'shieldbearer', 'pyre', 'warden'], 3));
    await game.enter();
    // Only the caller acts: the others hold their swings so the knight lives to see the second call land.
    await game.configureCombat({ enemies: [1, 2, 3].map((index) => ({ index, cooldown: 999, windup: 0 })) });
    let state = await game.state();
    for (let t = 0; t < 20_000 && state.enemies.filter((e) => e.kind === 'rattler' && !e.buried).length < 4; t += 50) {
      await game.step(50);
      state = await game.state();
    }
    // The precondition: two summon tells landed, so the whole reserve stands and none is buried.
    expect(state.enemies.filter((e) => e.kind === 'rattler' && !e.buried), 'two calls have not raised all four rattlers').toHaveLength(4);
    expect(state.enemies.filter((e) => e.buried), 'a body is still buried').toHaveLength(0);
    expect(state.enemies.filter((e) => e.kind !== 'rattler').map((e) => e.kind).sort()).toEqual(['bonecaller', 'pyre', 'shieldbearer', 'warden']);
    expect(state.health, 'the knight fell before the frame was drawn').toBeGreaterThan(0);
    await spend(game, 'caller-chamber');
  });
});

// Plan 021 Stage E: the Bone King's stair hall with his reserve standing - the worst boss chamber, and the one the 508 ceiling above is held against (Stage 0: a reserve of six fits under it, seven does not; his is sized
// from his move list, `reserveSize`). The worst goal chamber the generator lays (a 45-tile crypt: seed 0x86 on floor three, which the Stage 0 frame measurement found the dearest of six). The reserve is stood up by the
// King himself, in the real game: one blow from death he is in his last phase, where he summons on every second move, and with the knight beyond every other move's reach (a bolt reaches 7, a summon 9) summoning is
// all he does. He is kept on his spot (a fixture, like a teleport) and the knight alive; the rattlers are held quiet. Then the knight is framed 5.5 from him, as the other boss scenes are, and the frame is drawn.
test.describe('the stair hall with the Bone King and his reserve', () => {
  test.use({ seeds: [0x1, 0x86] });
  test('the King standing in the worst goal chamber with every rattler he called stays inside its budget', async ({ game }) => {
    test.slow();
    await game.enter();
    await game.buildFloor(3);
    await game.step(0);
    const floor = await game.floor();
    expect(floor.seed, 'the page was not handed the seed this scenario is staged on: pick another seed').toBe(0x86);
    const goal = floor.rooms[floor.goal], opening = await game.state();
    expect(goal.shape, 'the goal chamber of this seed is no longer the tight crypt this budget was set on: pick another seed').toBe('crypt');
    const kingAt = opening.enemies.findIndex((e) => e.kind === 'king' && e.room === floor.goal);
    expect(kingAt, 'the goal chamber holds no King').toBeGreaterThanOrEqual(0);
    const reserve = opening.enemies.map((e, index) => ({ e, index })).filter(({ e }) => e.kind === 'rattler' && e.buried && e.summoner === kingAt).map(({ index }) => index);
    expect(reserve.length, 'the King is not buried with the reserve his move list sizes').toBe(reserveSize('king'));
    // Where he stands and where the knight stands while he calls: on the chamber's own tiles, a clear lane between them, past the bolt's reach of 7 and inside the summon's 9.
    const tiles = floor.tiles.filter((t) => t.room === floor.goal).map((t) => ({ x: t.x * TILE, z: t.z * TILE }));
    let pair: { home: { x: number; z: number }; far: { x: number; z: number } } | null = null;
    for (const home of tiles) for (const far of tiles) {
      const gap = Math.hypot(home.x - far.x, home.z - far.z);
      if (!pair && gap > 7.6 && gap < 8.8 && hasClearPath(floor.cells, home, far)) pair = { home, far };
    }
    expect(pair, 'no two tiles of the goal chamber are 7.6 to 8.8 apart on a clear lane: pick another seed for this scenario').not.toBeNull();
    const { home, far } = pair!;
    await game.configureCombat({ enemies: [...reserve.map((index) => ({ index, cooldown: 999, windup: 0 })), { index: kingAt, x: home.x, z: home.z, hp: 1 }] });
    await game.teleport(far.x, far.z);
    // He has to notice the knight before he can change phase: the changes begin a beat after the knight comes into the room.
    await game.step(600);
    await settleBoss(game);
    let state = await game.state();
    expect(state.boss?.phase, 'one blow from death he is not in his last phase').toBe(2);
    const standing = (s: typeof state) => s.enemies.filter((e) => e.kind === 'rattler' && !e.buried).length;
    for (let t = 0; t < 40_000 && standing(state) < reserve.length; t += 100) {
      await game.configureCombat({ health: state.maxHealth, enemies: [{ index: kingAt, x: home.x, z: home.z }] });
      await game.step(100);
      state = await game.state();
    }
    // The precondition: he called the whole reserve himself, so every rattler stands and none is left in the ground.
    expect(state.enemies.filter((e) => e.kind === 'rattler' && !e.buried), 'the King did not stand his whole reserve up').toHaveLength(reserve.length);
    expect(state.enemies.filter((e) => e.buried && e.room === floor.goal), 'a body of the stair hall is still buried').toHaveLength(0);
    await game.configureCombat({ health: state.maxHealth, enemies: [{ index: kingAt, x: home.x, z: home.z, cooldown: 999, windup: 0 }] });
    const spot = laneSpot(floor, home, 5.5);
    await game.teleport(spot.x, spot.z);
    // The held rattlers still walk to the knight, and every mesh is culled by where it stands: the frame is drawn once they have all arrived and stopped (two reads a fifth of a second apart agree to a hundredth),
    // so it is the same frame on every run and machine. CI read 16 triangles more than a first local run when this was a fixed 400 ms.
    const places = async () => (await game.state()).enemies.filter((e) => e.kind === 'rattler' && !e.buried).map((e) => `${e.x.toFixed(2)},${e.z.toFixed(2)}`).join(' ');
    let before = '';
    for (let t = 0; t < 12_000; t += 200) {
      await game.step(200);
      const now = await places();
      if (now === before) break;
      before = now;
    }
    expect(await places(), 'the reserve was still moving when the frame was to be drawn').toBe(before);
    state = await game.state();
    expect(state.boss?.kind, 'the boss is not the King').toBe('king');
    expect(state.enemies.filter((e) => e.kind === 'rattler' && !e.buried), 'a rattler fell before the frame was drawn').toHaveLength(reserve.length);
    expect(state.health, 'the knight fell before the frame was drawn').toBeGreaterThan(0);
    await spend(game, 'king-chamber');
  });
});

// Plan 021 Stages C and D: the pool bosses' stair halls, each in the tightest goal chamber floors one and two can lay (seed 33 floor two, a 45-tile crypt; the Captain's is in it too, now that the Bone King holds floor three). `?boss=` puts the boss on the floor, so no scene searches seeds for one. The boss alone, held quiet, framed 5.5 from it.
const POOL_SCENES = [['captain', 'captain-chamber'], ['mother', 'mother-chamber'], ['hound', 'hound-chamber'], ['bastion', 'bastion-chamber']] as const;
for (const [kind, scene] of POOL_SCENES) {
  test.describe(`the stair hall with the ${kind}`, () => {
    test.use({ seeds: [0x1, 33], boss: kind });
    test(`the ${kind} standing in a 45-tile goal chamber stays inside its budget`, async ({ game }) => {
      await game.enter();
      await game.buildFloor(2);
      await game.step(0);
      const floor = await game.floor();
      expect(floor.seed, 'the page was not handed the seed this scenario is staged on: pick another seed').toBe(33);
      const goal = floor.rooms[floor.goal], opening = await game.state();
      expect(goal.shape, 'the goal chamber of this seed is no longer the tight crypt this budget was set on: pick another seed').toBe('crypt');
      expect(floor.tiles.filter((t) => t.room === floor.goal).length, 'the goal chamber is no longer the 45-tile one this budget was set on').toBe(45);
      const bossAt = opening.enemies.findIndex((e) => e.kind === kind && e.room === floor.goal);
      expect(bossAt, `the goal chamber holds no ${kind}`).toBeGreaterThanOrEqual(0);
      await game.configureCombat({ enemies: [{ index: bossAt, cooldown: 999, windup: 0 }] });
      const spot = laneSpot(floor, opening.enemies[bossAt], 5.5);
      await game.teleport(spot.x, spot.z);
      await game.step(400);
      const state = await game.state();
      expect(state.boss?.kind, `the boss is not the ${kind}`).toBe(kind);
      expect(state.enemies.filter((e) => !e.buried).map((e) => e.room === floor.goal), 'more than the stair hall\'s boss is in the staged chamber').toContain(true);
      expect(state.health, 'the knight fell before the frame was drawn').toBeGreaterThan(0);
      await spend(game, scene);
    });
  });
}

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
    // A swing that missed would put a cheaper frame under this budget than the one it is named for.
    expect(state.enemies[0].hp, 'the blow this frame is budgeted for never landed').toBeLessThan(Math.min(8, blade * 2));
    await spend(game, 'strike-contact');
  });

  test('the sparks of a blow are one draw however many of them fly', async ({ game }) => {
    // Each spark was its own mesh, so the frame a blow landed on drew one more call per spark - the
    // most expensive frame in the game paying for grit - and every one was drawn again by GTAO.
    await game.enter();
    await game.step(120);
    const floor = await game.floor();
    const target = { x: 0, z: 0 };
    const stance = strikeStance(floor, target);
    await game.teleport(stance.x, stance.z);
    await game.page.keyboard.down(stance.key);
    await game.step(16);
    await game.page.keyboard.up(stance.key);
    await game.configureCombat({ enemies: [{ index: 0, x: target.x, z: target.z, hp: 1, cooldown: 10, windup: 0 }] });
    await game.step(0, true);
    const before = (await game.state()).render.calls;
    await game.act('attack');
    await game.step(130, true);
    const hit = await game.state();
    expect(hit.effects.sparks, 'the blow threw its sparks, blood mist and bone dust').toBeGreaterThan(25);
    expect(hit.render.calls - before, `${hit.effects.sparks} sparks, a trail, a bar and a splat`).toBeLessThan(15);
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
  test('every floor draws with the same small, fixed set of point lights, and a rebuild reuses the programs the last one compiled', async ({ game }) => {
    const lights: number[] = [], programs: number[] = [];
    for (const level of [1, 2, 3, 1]) {
      await game.buildFloor(level);
      await game.step(16, true);
      const { render } = await game.state();
      lights.push(render.pointLights);
      programs.push(render.programs);
    }
    expect(lights[0], 'more point lights than the torches, the fill and the anchor pool').toBeLessThanOrEqual(9);
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
      const state = JSON.parse((window as GameWindow).render_game_to_text!()) as { render: { quality: string; passes: string[]; shadow: { draws: number; calls: number } } };
      return { ...state.render, antialias: canvas.getContext('webgl2')!.getContextAttributes()!.antialias };
    });
    expect(frame.quality).toBe('full');
    expect(frame.passes, 'GTAO is in the chain, so the scene is rendered twice a frame').toContain('GTAOPass');
    expect(frame.shadow.draws, 'the shadow map is drawn by the scene pass and not again by GTAO').toBe(1);
    expect(frame.shadow.calls, 'and that one draw still covers the casters').toBeGreaterThan(0);
    // The scene is drawn into the composer's own targets, so the canvas only ever receives the last
    // full-screen pass: a multisampled one bought a resolve per frame and not one smoothed edge.
    expect(frame.antialias).toBe(false);
  });
});
