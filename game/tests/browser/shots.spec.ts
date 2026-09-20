import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  canStand,
  expect,
  Game,
  openSpot,
  type Point,
  roomCentre,
  speedOf,
  strikeStance,
  test,
  TILE,
} from './helpers.ts';

/**
 * Eight reference frames of the keep, one per scene the art has to keep working.
 * Every one pins its own seed, teleports the knight to a spot the pinned floor
 * derives, and advances the clock by a stated number of milliseconds before it
 * draws. Nothing here polls until a frame looks right — a shot that needed a
 * retry to land would not be a baseline.
 *
 * The PNGs land under `test-results/` as Playwright attachments; the reviewed
 * copies live in `output/shots/baseline/`.
 */

/** What every scene gets before its first frame: torches lit, water moving. */
const SETTLE = 640;

/**
 * Fonts arrive after hydration and the HUD is text. A capture taken before they
 * land is a different image from every capture taken after, which would read as
 * a rendering change rather than as a race.
 */
const shot = async (game: Game, name: string) => {
  await game.page.evaluate(() => document.fonts.ready.then(() => undefined));
  await game.capture(name);
  const r = (await game.state()).render;
  console.log(`COST ${name} calls=${r.calls} triangles=${r.triangles} geometries=${r.geometries} textures=${r.textures}`);
};

/** Lowest-ranked match wins, so the same floor always yields the same spot. */
const firstBy = <T>(items: T[], rank: (item: T) => number) =>
  items
    .map((item) => ({ item, key: rank(item) }))
    .sort((a, b) => a.key - b.key)[0]?.item;

test.describe('flooded hall', () => {
  test.use({ seeds: [0x60] });
  test('a torchlit flooded hall with three guards closing', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
    // An ambush hall is hidden until it springs, and springing it throws sparks;
    // this scene wants a watch that is already on its feet.
    const hall = floor.rooms.find(
      (room) =>
        room.theme === 'flooded' &&
        room.encounter !== 'ambush' &&
        floor.spawns.filter((s) => s.room === room.id && s.kind === 'guard')
          .length >= 3 &&
        braziers.filter((brazier) => brazier.room === room.id).length >= 2,
    );
    expect(
      hall,
      'seed 0x60 no longer holds a torchlit flooded hall with three guards',
    ).toBeDefined();
    const pack = floor.spawns
      .filter((spawn) => spawn.room === hall!.id)
      .map((spawn) => ({ x: spawn.x * TILE, z: spawn.z * TILE }));
    const stand = openSpot(floor, roomCentre(floor, hall!.id), {
      radius: 10,
      avoid: pack,
      clearance: 5.5,
    });
    await game.teleport(stand.x, stand.z);
    // Long enough for the watch to break stance and come on, short of the first
    // blow: a landed hit tints the canvas and throws sparks.
    await game.step(900);
    const state = await game.state();
    const closing = state.enemies.filter(
      (enemy) =>
        enemy.room === hall!.id &&
        enemy.awake &&
        Math.hypot(enemy.x - stand.x, enemy.z - stand.z) < 9,
    );
    expect(closing.length, 'the watch never closed').toBeGreaterThanOrEqual(3);
    expect(state.health, 'a guard landed a blow before the frame').toBe(
      state.maxHealth,
    );
    await shot(game, 'flooded-hall-guards-closing');
  });
});

test.describe('warden chamber', () => {
  test.use({ seeds: [0x1] });
  test('the warden chamber with the stair still sealed', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const goal = floor.rooms[floor.goal];
    await game.teleport(goal.x * TILE, goal.z * TILE);
    await game.step(SETTLE);
    const state = await game.state();
    expect(state.objective.atStair).toBe(true);
    expect(state.objective.stairClear, 'the wardens are already down').toBe(
      false,
    );
    expect(state.objective.stairOpen, 'the seal already lifted').toBe(false);
    await shot(game, 'sealed-warden-chamber');
  });
});

test.describe('bridge', () => {
  test.use({ seeds: [0x1] });
  test('the middle of a plank bridge over open water', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const planks = floor.tiles.filter(
      (tile) => tile.wood && canStand(floor.cells, tile.x * TILE, tile.z * TILE),
    );
    // Deepest into the span, so the frame is bridge rather than shoreline.
    const middle = firstBy(
      planks,
      (tile) =>
        -planks.filter(
          (other) =>
            Math.abs(other.x - tile.x) <= 3 && Math.abs(other.z - tile.z) <= 3,
        ).length *
          1e6 +
        tile.x * 1e3 +
        tile.z,
    );
    expect(middle, 'seed 0x1 no longer lays a plank bridge').toBeDefined();
    await game.teleport(middle!.x * TILE, middle!.z * TILE);
    await game.step(SETTLE);
    await shot(game, 'bridge-over-water');
  });
});

test.describe('shrine', () => {
  test.use({ seeds: [0x1] });
  test('a sanctuary shrine still unspent', async ({ game }) => {
    await game.enter();
    const shrine = (await game.state()).features.find(
      (feature) => feature.shrine,
    );
    expect(shrine, 'seed 0x1 no longer holds a shrine').toBeDefined();
    await game.teleport(shrine!.x, shrine!.z);
    await game.step(SETTLE);
    const state = await game.state();
    // A shrine heals, it is not a pickup: at full vitality standing on it leaves
    // the crystal lit, which is the state this frame is the reference for.
    expect(state.health).toBe(state.maxHealth);
    expect(
      state.features.find((feature) => feature.shrine)!.used,
      'the shrine spent itself',
    ).toBe(false);
    await shot(game, 'unused-sanctuary-shrine');
  });
});

test.describe('gauntlet', () => {
  test.use({ seeds: [0x1] });
  test('an ember gauntlet mid-flare', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const rings = (await game.state()).features.filter(
      (feature) => !feature.shrine,
    );
    expect(rings.length, 'seed 0x1 no longer holds a gauntlet').toBeGreaterThan(
      0,
    );
    // Clear of every grate: a burn tints the canvas and costs vitality, and this
    // frame is about the flare rather than about taking it.
    const stand = openSpot(floor, roomCentre(floor, rings[0].room), {
      radius: 10,
      avoid: rings,
      clearance: 3.2,
    });
    await game.teleport(stand.x, stand.z);
    // A gauntlet room this size puts every spawn within closing distance of any
    // stand point, so the pair of stalkers it always holds (see generateFloor's
    // roster) would land a hit during the wait below well before the flare does.
    // This frame is a study of the fire, not of the fight, so the same
    // fixture the strike scenes use to freeze a dummy keeps these two off the
    // clock instead.
    const stalkers = (await game.state()).enemies
      .map((enemy, index) => ({ ...enemy, index }))
      .filter((enemy) => enemy.room === rings[0].room);
    if (stalkers.length) {
      await game.configureCombat({
        enemies: stalkers.map((enemy) => ({ index: enemy.index, cooldown: 999 })),
      });
    }
    await game.step(SETTLE);
    // The grates burn through the last second of a 3.6s cycle, off a clock that
    // started at mount rather than at the teleport, so the wait is computed once
    // from the phase the snapshot reports and then taken in a single step.
    const phase = (await game.state()).features.find(
      (feature) => !feature.shrine,
    )!.phase;
    const intoFlare = (((2.85 - phase) % 3.6) + 3.6) % 3.6;
    await game.step(Math.round(intoFlare * 1000));
    const state = await game.state();
    expect(
      state.features.find((feature) => !feature.shrine)!.phase,
      'the step missed the flare',
    ).toBeGreaterThan(2.6);
    expect(state.health, 'the knight stood in the fire').toBe(state.maxHealth);
    await shot(game, 'gauntlet-embers-live');
  });
});

test.describe('strike', () => {
  test.use({ seeds: [0x1] });
  test('the contact frame of a strike', async ({ game, page }) => {
    await game.enter();
    await game.step(120);
    const floor = await game.floor();
    const target = { x: 0, z: 0 };
    const stance = strikeStance(floor, target);
    await game.teleport(stance.x, stance.z);
    await page.keyboard.down(stance.key);
    await game.step(16);
    await page.keyboard.up(stance.key);
    // Two blades of vitality so the body is still standing in the frame, and a
    // long cooldown so nothing swings back into it.
    const blade = (await game.state()).weapon.strikeDamage;
    await game.configureCombat({
      enemies: [
        {
          index: 0,
          x: target.x,
          z: target.z,
          hp: blade * 2,
          cooldown: 10,
          windup: 0,
        },
      ],
    });
    await page.keyboard.press('Space');
    // 65ms of anticipation, then the blade is live until 175ms into a 380ms
    // swing — plus the 35ms of hit-stop the landed blow buys, which the wall
    // clock pays for and the swing does not.
    await game.step(130);
    const state = await game.state();
    expect(state.enemies[0].hp, 'the blade never landed').toBe(blade);
    const age = state.weapon.duration - state.player.attackTime;
    expect(age, 'the frame is not inside the cut').toBeGreaterThan(0.065);
    expect(age, 'the frame is not inside the cut').toBeLessThanOrEqual(0.175);
    await shot(game, 'strike-contact');
  });
});

test.describe('dark corridor', () => {
  test.use({ seeds: [0x128] });
  test('a corridor with no brazier in view', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
    const corridor = floor.tiles
      .filter(
        (tile) =>
          tile.room < 0 && canStand(floor.cells, tile.x * TILE, tile.z * TILE),
      )
      .map((tile) => ({
        tile,
        away: Math.min(
          ...braziers.map(
            (brazier) =>
              Math.hypot(brazier.x - tile.x, brazier.z - tile.z) * TILE,
          ),
        ),
      }));
    const darkest = firstBy(
      corridor,
      ({ tile, away }) => -away * 1e6 + tile.x * 1e3 + tile.z,
    );
    // The view is orthographic and roughly 20 by 14 world units across, so a
    // brazier further than half that frame's own diagonal (hypot(20,14)/2 =
    // ~12.2) off the teleported spot cannot be casting into it. 24 was the
    // margin the old, roughly-twice-as-large rooms happened to clear for free;
    // rooms this size (see sizeFor in dungeon-floor.ts) no longer carry a
    // corridor that isolated, so the bar is 18 - still half again the real
    // geometric minimum, not the frame's edge.
    expect(
      darkest?.away ?? 0,
      'seed 0x128 has no unlit run left',
    ).toBeGreaterThan(18);
    await game.teleport(darkest!.tile.x * TILE, darkest!.tile.z * TILE);
    await game.step(SETTLE);
    await shot(game, 'dark-corridor');
  });
});

test.describe('junction', () => {
  test.use({ seeds: [0x150] });
  test('a wide junction where three ways branch off the trunk', async ({
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
      'seed 0x150 no longer branches three ways off one chamber',
    ).toBeDefined();
    const centre = roomCentre(floor, junction!.id);
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    await shot(game, 'wide-branching-junction');
  });
});

/**
 * Two frame sequences, one per verb. A still says whether the keep looks
 * expensive; only a strip of consecutive frames says whether a swing has
 * anticipation, a contact and a recovery, or whether it is a pose that
 * teleports. Both step at 16ms — one displayed frame at 60Hz — so the strip is
 * what a player actually sees rather than a summary of it.
 *
 * Each frame also records the simulation clock beside it, so a reviewer can say
 * *which* frame is thin rather than only that the swing is.
 */
const SEQUENCE_STEP = 16;

/**
 * The clock beside the frames, written next to them rather than only into the
 * report: a reviewer comparing two runs needs the numbers on disk.
 */
const writeLog = async (game: Game, name: string, log: FrameNote[]) => {
  const file = game.info.outputPath(`${name}.json`);
  await writeFile(file, JSON.stringify(log, null, 1));
  await game.info.attach(`${name}.json`, {
    path: file,
    contentType: 'application/json',
  });
};

type FrameNote = {
  index: number;
  ms: number;
  attackTime: number;
  dashTime: number;
  swordAngle: number;
  speed: number;
  x: number;
  z: number;
  enemyHp: number[];
};

/** One frame of a sequence: draw, save, and note what the clock said. */
const frame = async (
  game: Game,
  name: string,
  index: number,
): Promise<FrameNote> => {
  await game.capture(`${name}-${String(index).padStart(2, '0')}`);
  const s = await game.state();
  return {
    index,
    ms: index * SEQUENCE_STEP,
    attackTime: +s.player.attackTime.toFixed(4),
    dashTime: +s.player.dashTime.toFixed(4),
    swordAngle: +s.player.swordAngle.toFixed(4),
    speed: +Math.hypot(s.player.velocity.x, s.player.velocity.z).toFixed(3),
    x: +s.player.x.toFixed(3),
    z: +s.player.z.toFixed(3),
    enemyHp: s.enemies.map((e) => e.hp),
  };
};

/**
 * Settle the knight onto an exact spot with an exact facing, so two runs of the
 * same sequence start from the same pixel. Tapping a movement key sets the
 * facing but also nudges him, and whether that nudge lands before or after the
 * next step is a race with the wall clock — so the teleport is repeated after
 * the tap to erase the drift, and the camera is then given long enough to
 * converge on the spot rather than on wherever the nudge left him.
 */
const settle = async (game: Game, page: Page, at: Point, key: string) => {
  await game.teleport(at.x, at.z);
  await page.keyboard.down(key);
  await game.step(32);
  await page.keyboard.up(key);
  await game.step(200);
  await game.teleport(at.x, at.z);
  await game.step(500);
  const state = await game.state();
  expect(state.player.x, 'the knight did not settle on the mark').toBeCloseTo(at.x, 3);
  expect(state.player.z, 'the knight did not settle on the mark').toBeCloseTo(at.z, 3);
  expect(speedOf(state), 'the knight was still moving at frame zero').toBeLessThan(0.01);
};

test.describe('strike sequence', () => {
  test.use({ seeds: [0x1] });
  // A 380ms swing plus the hit-stop a landed blow adds, with two frames of
  // stillness in front of it so the strip shows what the knight left as well as
  // what he did. The strip is thirty-two frames rather than the thirty it held
  // when hit-stop was 35ms: the freeze is charged to the wall clock and not to
  // the swing, and it rounds up to whole frames, so 70ms of it costs five of
  // them. Thirty frames no longer reached the knight's guard, which is a strip
  // that ends mid-swing rather than a swing that failed. Frames 00-29 are at the
  // same clock they always were. The swing is triggered through the action event
  // rather than the Space key: a real keypress races the stepped clock and lands
  // a frame either side of it, which shifts the whole strip. The keyboard path
  // has its own coverage.
  test('every frame of one full strike', async ({ game, page }) => {
    // Thirty-two screenshots of a software-rasterised WebGL canvas, and the
    // default 120s was sized for thirty of them on an idle machine. It is the
    // number of frames that costs the time, not anything the frames contain.
    test.slow();
    await game.enter();
    await game.step(120);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const floor = await game.floor();
    const target = { x: 0, z: 0 };
    const stance = strikeStance(floor, target);
    await settle(game, page, stance, stance.key);
    // Enough vitality to stay standing through the whole strip, and a cooldown
    // long enough that nothing swings back into a frame of it. The fixture caps
    // vitality at eight, which is still more than one blade takes off.
    const blade = (await game.state()).weapon.strikeDamage;
    const stock = Math.min(8, blade * 3);
    expect(stock, 'one blade would fell the target inside the strip')
      .toBeGreaterThan(blade);
    await game.configureCombat({
      enemies: [
        { index: 0, x: target.x, z: target.z, hp: stock, cooldown: 10, windup: 0 },
      ],
    });
    await game.step(32);
    const log: FrameNote[] = [];
    log.push(await frame(game, 'strike-seq', 0));
    log.push(await frame(game, 'strike-seq', 1));
    await game.act('attack');
    for (let i = 2; i < 32; i++) {
      await game.step(SEQUENCE_STEP);
      log.push(await frame(game, 'strike-seq', i));
    }
    // The strip is only a reference if the swing actually ran inside it: the
    // blade has to have gone out, landed, and come back to rest.
    expect(Math.max(...log.map((f) => f.attackTime)), 'no swing in the strip')
      .toBeGreaterThan(0.2);
    expect(log[log.length - 1].attackTime, 'the strip ends mid-swing').toBe(0);
    expect(log[0].enemyHp[0], 'the target was already wounded').toBe(stock);
    expect(
      log[log.length - 1].enemyHp[0],
      'the blade never landed inside the strip',
    ).toBeLessThan(stock);
    await writeLog(game, 'strike-seq', log);
  });
});

test.describe('dash sequence', () => {
  test.use({ seeds: [0x1] });
  // 180ms of dash and the same again of recovery, which is where a dash either
  // reads as a movement or as a cut. Triggered through the action event for the
  // same reason the strike is.
  test('every frame of one full dash', async ({ game, page }) => {
    await game.enter();
    await game.step(120);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const floor = await game.floor();
    const target = { x: 0, z: 0 };
    const stance = strikeStance(floor, target, { distance: 4.2 });
    await settle(game, page, stance, stance.key);
    const log: FrameNote[] = [];
    log.push(await frame(game, 'dash-seq', 0));
    log.push(await frame(game, 'dash-seq', 1));
    await game.act('dash');
    for (let i = 2; i < 24; i++) {
      await game.step(SEQUENCE_STEP);
      log.push(await frame(game, 'dash-seq', i));
    }
    expect(Math.max(...log.map((f) => f.dashTime)), 'no dash in the strip')
      .toBeGreaterThan(0.1);
    expect(log[log.length - 1].dashTime, 'the strip ends mid-dash').toBe(0);
    const travel = Math.hypot(
      log[log.length - 1].x - log[0].x,
      log[log.length - 1].z - log[0].z,
    );
    expect(travel, 'the knight never left the spot').toBeGreaterThan(1.5);
    await writeLog(game, 'dash-seq', log);
  });
});
