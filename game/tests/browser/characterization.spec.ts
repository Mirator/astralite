import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  canStand,
  expect,
  type Floor,
  type Game,
  type GameWindow,
  type Point,
  type Snapshot,
  strikeStance,
  test,
  TILE,
} from './helpers.ts';

// Characterization (golden-master) traces of the running game, written before the world closure in
// `dungeon-game.tsx` was split up. Each scenario drives real keyboard, mouse, touch-protocol and gamepad
// input under the driver's clock and records what the game reports after every step. The recorded
// trace lives in `golden/characterization.json`; a run compares against it with a small numeric
// tolerance, so a refactor that reorders arithmetic passes and one that changes behaviour does not.
//
// `GAME_TEST_RECORD=1` rewrites the golden file instead of comparing. Only do that for a change that is
// meant to alter behaviour, and say in the commit which trace moved and why.

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden', 'characterization.json');
const RECORDING = process.env.GAME_TEST_RECORD === '1';
/** Absolute and relative slack for a number: well under anything a player or a rule could notice. */
const TOLERANCE = 1e-6;

type Trace = { label: string; value: unknown }[];

const round = (value: unknown): unknown => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return Math.abs(value) < 1e-9 ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  return value;
};

/** Every path at which two recorded values disagree beyond the tolerance. */
const differences = (want: unknown, got: unknown, path: string, out: string[]) => {
  if (out.length > 12) return;
  if (typeof want === 'number' && typeof got === 'number') {
    if (Math.abs(want - got) > TOLERANCE * Math.max(1, Math.abs(want))) out.push(`${path}: want ${want}, got ${got}`);
    return;
  }
  if (Array.isArray(want) && Array.isArray(got)) {
    if (want.length !== got.length) { out.push(`${path}: want length ${want.length}, got ${got.length}`); return; }
    want.forEach((w, i) => differences(w, got[i], `${path}[${i}]`, out));
    return;
  }
  if (want && got && typeof want === 'object' && typeof got === 'object') {
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const key of keys) differences((want as Record<string, unknown>)[key], (got as Record<string, unknown>)[key], `${path}.${key}`, out);
    return;
  }
  if (want !== got) out.push(`${path}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const readGolden = (): Record<string, Trace> => (existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {});

/** Holds one scenario's trace against the golden file, or writes it there under `GAME_TEST_RECORD=1`. */
const settleTrace = (name: string, trace: Trace) => {
  if (RECORDING) {
    const all = readGolden();
    all[name] = trace;
    mkdirSync(dirname(GOLDEN), { recursive: true });
    // One record per line, so a diff of the golden file names the steps that moved.
    const scenarios = Object.entries(all).sort(([a], [b]) => a.localeCompare(b))
      .map(([scenario, steps]) => `${JSON.stringify(scenario)}: [\n${steps.map((step) => '  ' + JSON.stringify(step)).join(',\n')}\n]`);
    writeFileSync(GOLDEN, `{\n${scenarios.join(',\n')}\n}\n`);
    return;
  }
  const want = readGolden()[name];
  expect(want, `no golden trace for "${name}" - record one with GAME_TEST_RECORD=1`).toBeDefined();
  expect(trace.map((entry) => entry.label), `the "${name}" scenario took a different path`).toEqual(want!.map((entry) => entry.label));
  trace.forEach((entry, i) => {
    const out: string[] = [];
    differences(want![i].value, entry.value, '', out);
    expect(out, `"${name}" diverged at step ${i} (${entry.label})`).toEqual([]);
  });
};

/**
 * The gameplay slice of a snapshot: everything input, combat, progression and the floor build decide,
 * and nothing that measures the machine (`buildMs`, the renderer's counters, the audio clock) or is a
 * pure function of the floor seed (the room graph, which `floor.seed` already pins).
 */
/** Fields `render_game_to_text` reports that the shared `Snapshot` type does not spell out. */
type Full = Snapshot & {
  camera: Record<string, number>;
  settings: { shake: number; hitStop: number; filter: string; reduceMotion: boolean; muted: boolean };
  corpses: { kind: string; x: number; z: number; settled: boolean; visible: boolean; cue: boolean; bar: boolean; trails: boolean }[];
  floor: Snapshot['floor'] & { waterfalls: unknown };
};
/** How far from the knight a body is recorded in full. */
const NEAR = 16;
const slice = (s: Full) => ({
  mode: s.mode, building: s.building, boonOffer: s.boonOffer, muted: s.muted, roomName: s.roomName,
  health: s.health, maxHealth: s.maxHealth, rank: s.rank, remaining: s.remaining,
  weapon: s.weapon, boons: s.boons, objective: s.objective, drop: s.drop, experience: s.experience,
  aim: s.aim, camera: s.camera,
  settings: { shake: s.settings.shake, hitStop: s.settings.hitStop, filter: s.settings.filter, reduceMotion: s.settings.reduceMotion, muted: s.settings.muted },
  floor: { level: s.floor.level, seed: s.floor.seed, visited: s.floor.visited, cleared: s.floor.cleared },
  features: s.features,
  player: s.player,
  // Bodies within a screen of the knight in full; the rest of the floor as a checksum, which still moves
  // if a dozing body anywhere wanders, wakes or loses health.
  enemies: s.enemies.filter((e) => Math.hypot(e.x - s.player.x, e.z - s.player.z) < NEAR),
  elsewhere: s.enemies.filter((e) => Math.hypot(e.x - s.player.x, e.z - s.player.z) >= NEAR)
    .reduce((sum, e) => ({ count: sum.count + 1, x: sum.x + e.x, z: sum.z + e.z, hp: sum.hp + e.hp, awake: sum.awake + +e.awake }), { count: 0, x: 0, z: 0, hp: 0, awake: 0 }),
  corpses: s.corpses.map((c) => ({ kind: c.kind, x: c.x, z: c.z, settled: c.settled, visible: c.visible, cue: c.cue, bar: c.bar, trails: c.trails })),
  steps: { contacts: s.effects.footsteps.contacts, skipped: s.effects.footsteps.skipped, kinds: s.effects.footsteps.kinds },
});

class Recorder {
  readonly trace: Trace = [];
  constructor(private readonly game: Game) {}
  async take(label: string) {
    this.trace.push({ label, value: round(slice((await this.game.state()) as Full)) });
  }
  /** Steps the clock in `each` ms increments and records after every one. */
  async run(label: string, ms: number, each = 50) {
    for (let at = each; at <= ms; at += each) {
      await this.game.step(each);
      await this.take(`${label} +${at}ms`);
    }
  }
}

/**
 * `draftBoons` shuffles with `Math.random`, and so does every spark. A scenario that needs the draft's
 * order to be the same every run swaps in a seeded generator for its own duration and puts the real one
 * back before the pooled page is handed on.
 */
const pinRandom = (page: Page) => page.evaluate(() => {
  const w = window as Window & { __realRandom?: () => number };
  w.__realRandom ??= Math.random;
  let state = 0x2f6b1d;
  Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
});
const unpinRandom = (page: Page) => page.evaluate(() => {
  const w = window as Window & { __realRandom?: () => number };
  if (w.__realRandom) { Math.random = w.__realRandom; delete w.__realRandom; }
});

/** A standard-mapping pad the page will read on its next update, or the browser's own list back. */
type FakePad = { axes: number[]; pressed: number[] };
const setPad = (page: Page, pad: FakePad | null) => page.evaluate((next) => {
  const nav = navigator as Navigator & { __realGamepads?: () => (Gamepad | null)[] };
  if (!next) {
    if (nav.__realGamepads) { Object.defineProperty(navigator, 'getGamepads', { value: nav.__realGamepads, configurable: true, writable: true }); delete nav.__realGamepads; }
    return;
  }
  nav.__realGamepads ??= navigator.getGamepads.bind(navigator);
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: next.pressed.includes(i), touched: false, value: next.pressed.includes(i) ? 1 : 0 }));
  const pad = { id: 'characterization pad', index: 0, connected: true, mapping: 'standard', axes: next.axes, buttons, timestamp: 0, hapticActuators: [], vibrationActuator: null };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true, writable: true });
}, pad);

/** The first spawn that is awake from the start, and a legal place to swing at it from. */
const firstWatcher = (floor: Floor) => {
  const index = floor.spawns.findIndex((spawn) => !spawn.ambush && spawn.room !== floor.goal);
  expect(index, 'this floor has no watching guard outside the warden hall').toBeGreaterThanOrEqual(0);
  const spawn = floor.spawns[index];
  const at = { x: spawn.x * TILE, z: spawn.z * TILE };
  return { index, at, stance: strikeStance(floor, at) };
};

/**
 * Takes the clock and restarts the run under it. Until a page's first manual step its real frame loop
 * runs, and `elapsed` - which every flicker, hazard and gait reads - would carry wall-clock time into the
 * trace; a fresh page (the first scenario on a worker, or an isolated one) has not had that step yet.
 * The reset after it puts `elapsed` back to zero with the driver already holding the clock.
 */
const ownClock = async (game: Game) => {
  await game.step(0);
  await game.reset(game.seeds);
};

const swingToward = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await page.keyboard.down('Space');
  await page.keyboard.up(key);
  await page.keyboard.up('Space');
};

test.describe('characterization', () => {
  test('melee: strikes, chains, buffered dashes, held attack and pointer aim', async ({ game, page }) => {
    await ownClock(game);
    await game.enter();
    await game.step(120);
    const rec = new Recorder(game);
    const floor = await game.floor();
    const { stance } = firstWatcher(floor);
    await game.teleport(stance.x, stance.z);
    await rec.take('teleported to stance');
    await rec.run('settle', 200, 100);

    // One swing aimed with a real key, then a second press inside it, which buffers the next beat.
    await swingToward(page, stance.key);
    await rec.run('first swing', 150, 50);
    await page.keyboard.press('Space');
    await rec.run('buffered second beat', 400, 50);
    // A dodge pressed while the blade is live waits for contact to end.
    await page.keyboard.press('Space');
    await game.step(50);
    await page.keyboard.press('ShiftLeft');
    await rec.take('dash pressed mid-swing');
    await rec.run('buffered dash', 600, 50);

    // Held strike keeps swinging; walking between swings turns the knight.
    await page.keyboard.down('Space');
    await rec.run('held strike', 900, 100);
    await page.keyboard.up('Space');
    for (const combo of [['ArrowUp'], ['ArrowUp', 'ArrowRight'], ['KeyS'], ['KeyA', 'KeyS'], ['ArrowLeft']]) {
      for (const key of combo) await page.keyboard.down(key);
      await rec.run(`walk ${combo.join('+')}`, 300, 100);
      for (const key of combo) await page.keyboard.up(key);
    }

    // The mouse: aim at the guard's screen position, hold the left button, then a right-click dash.
    await game.teleport(stance.x, stance.z);
    await game.step(100);
    const box = (await page.locator('canvas').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx + 40, cy - 30);
    await rec.take('pointer moved');
    await page.mouse.down({ button: 'left' });
    await rec.run('mouse held', 600, 100);
    await page.mouse.up({ button: 'left' });
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await rec.run('right-click dash', 400, 100);
    // A key strike hands the aim back to the keys.
    await page.keyboard.press('Space');
    await rec.run('keys reclaim aim', 300, 100);
    await page.mouse.move(box.x - 20, box.y - 20);
    await rec.take('pointer left the canvas');

    // Fight it out from the stance until the guard falls or two seconds pass.
    await game.teleport(stance.x, stance.z);
    await page.keyboard.down(stance.key);
    await game.step(30);
    await page.keyboard.up(stance.key);
    await page.keyboard.down('Space');
    await rec.run('fight', 2000, 100);
    await page.keyboard.up('Space');
    settleTrace('melee', rec.trace);
  });

  test('touch protocol, gamepad and the action events', async ({ game, page }) => {
    await ownClock(game);
    await game.enter();
    await game.step(120);
    const rec = new Recorder(game);
    try {
      await game.act('move:up'); await rec.run('touch move up', 300, 100);
      await game.act('move:right'); await rec.run('touch up+right', 200, 100);
      await game.act('stop:up', 'stop:right'); await rec.run('touch stopped', 200, 100);
      await game.act('stick:0.6,-0.8'); await rec.run('stick planted', 300, 100);
      await game.act('stick:junk'); await rec.run('stick junk releases', 200, 100);
      await game.act('hold-attack'); await rec.run('touch strike held', 700, 100);
      await game.act('release-attack'); await rec.run('touch strike released', 300, 100);
      await game.act('dash'); await rec.run('touch dash', 400, 100);
      await game.act('swap'); await rec.take('swap away from any rack is inert');
      await game.act('attack'); await rec.run('attack event', 400, 100);

      // Pause from the keyboard, then the pad's START; buttons still read while the world is held.
      await page.keyboard.press('Escape'); await rec.take('escape pauses');
      await game.step(200); await rec.take('paused clock');
      await page.keyboard.press('Escape'); await rec.take('escape resumes');
      await page.keyboard.press('KeyM'); await rec.take('mute key');
      await page.keyboard.press('KeyM'); await rec.take('unmute key');

      await setPad(page, { axes: [0.9, 0.1, 0, 0], pressed: [] }); await rec.run('pad left stick', 300, 100);
      await setPad(page, { axes: [0.1, 0.1, 0, 0], pressed: [] }); await rec.run('pad inside deadzone', 200, 100);
      await setPad(page, { axes: [0, 0, -0.2, 0.95], pressed: [] }); await rec.run('pad right stick aims', 200, 100);
      await setPad(page, { axes: [0, 0, -0.2, 0.95], pressed: [0] }); await rec.run('pad A held', 500, 100);
      await setPad(page, { axes: [0.5, -0.7, 0, 0], pressed: [1] }); await rec.run('pad B dash', 300, 100);
      await setPad(page, { axes: [0, 0, 0, 0], pressed: [9] }); await rec.run('pad START pauses', 200, 100);
      await setPad(page, { axes: [0.9, 0, 0, 0], pressed: [] }); await rec.run('paused pad does not steer', 200, 100);
      await setPad(page, { axes: [0, 0, 0, 0], pressed: [9] }); await rec.run('pad START resumes', 200, 100);
      await setPad(page, { axes: [0, 0, 0, 0], pressed: [] }); await rec.run('pad released', 200, 100);
    } finally {
      await setPad(page, null);
    }
    await rec.run('pad unplugged', 200, 100);
    settleTrace('input', rec.trace);
  });

  test('ranged arms, a fire pool and the weapon rack', async ({ game, page }) => {
    await ownClock(game);
    await game.enter();
    await game.step(120);
    const rec = new Recorder(game);
    const floor = await game.floor();
    const { stance } = firstWatcher(floor);

    await game.equip('crossbow');
    await game.teleport(stance.x, stance.z);
    await rec.take('crossbow at stance');
    for (let shot = 0; shot < 3; shot++) {
      await swingToward(page, stance.key);
      await rec.run(`bolt ${shot + 1}`, 500, 100);
    }
    await rec.run('reload', 1200, 200);

    await game.equip('flask');
    await game.teleport(stance.x, stance.z);
    await swingToward(page, stance.key);
    await rec.run('flask thrown', 1600, 100);

    // Walk the rack: stand in its ring, take its arm, and the old one goes down in its place.
    await game.equip('tideblade');
    const before = await game.state();
    const drop = before.drop!;
    await game.teleport(drop.x, drop.z);
    await rec.run('standing on the rack', 200, 100);
    await page.keyboard.press('KeyE');
    await rec.run('swapped', 200, 100);
    await page.keyboard.press('KeyE');
    await rec.run('swapped back', 200, 100);
    settleTrace('ranged', rec.trace);
  });

  test('progression: boon draft, hazards, a shrine and the stair', async ({ game, page }) => {
    await ownClock(game);
    await game.enter();
    await game.step(120);
    const rec = new Recorder(game);
    await pinRandom(page);
    try {
      await game.grantXp(400);
      await rec.take('xp granted');
      await game.takeBoon();
      await rec.take('boon taken');
      while ((await game.state()).boonOffer) { await game.takeBoon(); await rec.take('queued boon taken'); }

      const floor = await game.floor();
      const start = await game.state();
      const hazard = start.features.find((f) => !f.shrine);
      if (hazard) {
        await game.teleport(hazard.x, hazard.z);
        await rec.run('standing on a grate', 4000, 200);
      }
      const shrine = start.features.find((f) => f.shrine);
      if (shrine) {
        await game.configureCombat({ health: 40 });
        await game.teleport(shrine.x + 3, shrine.z);
        await game.step(100);
        await game.teleport(shrine.x, shrine.z);
        await rec.run('at the shrine', 400, 100);
      }

      // The warden hall: every body in it brought to one blow, then struck down from a legal stance.
      const goal = floor.goal;
      const guards = floor.spawns.map((spawn, index) => ({ spawn, index })).filter(({ spawn }) => spawn.room === goal);
      await game.teleport(floor.rooms[goal].x * TILE, floor.rooms[goal].z * TILE);
      await rec.run('entered the warden hall', 300, 100);
      // Spawn indices address the fixture whatever has died since, so every body in the hall is brought to
      // one blow at once, then each one still standing is struck from a legal stance.
      await game.configureCombat({ health: 100, enemies: guards.map(({ index }) => ({ index, hp: 1, cooldown: 2 })) });
      for (let round = 0; round < guards.length; round++) {
        const live = (await game.state()).enemies;
        const enemy = live.find((e) => e.room === goal);
        if (!enemy) break;
        const point: Point = { x: enemy.x, z: enemy.z };
        const others = live.filter((e) => e !== enemy).map((e) => ({ x: e.x, z: e.z }));
        let spot;
        try { spot = strikeStance(floor, point, { avoid: others, clearance: 0.6 }); } catch { spot = strikeStance(floor, point); }
        await game.teleport(spot.x, spot.z);
        await swingToward(page, spot.key);
        await rec.run(`struck warden-hall body ${round}`, 500, 100);
      }
      const { stair } = await game.state();
      await game.teleport(stair.x, stair.z);
      await rec.run('on the stair', 2400, 200);
      if ((await game.state()).mode === 'complete') {
        await game.act('continue');
        await game.built();
        await rec.take('floor 2');
      }
    } finally {
      await unpinRandom(page);
    }
    settleTrace('progression', rec.trace);
  });
});

test.describe('characterization of the floor build', () => {
  // Its own page: the renderer's resource counters are part of what is pinned here, and a pooled page
  // carries whatever an earlier scenario on the same worker happened to allocate.
  test.use({ isolate: true });
  test('every level builds the same scene from the same seed', async ({ game, page }) => {
    await ownClock(game);
    await game.enter();
    await game.step(0);
    const trace: Trace = [];
    for (const [level, seed] of [[1, 0x1], [1, 0x9e3779b9], [2, 0x7], [2, 0x51ed270b], [3, 0xc], [3, 0x2545f491]] as const) {
      await page.evaluate(({ level, seed }) => (window as GameWindow).dungeonTest!.buildFloor(level, seed), { level, seed });
      await game.step(16, true);
      const s = (await game.state()) as Full;
      const extra = await page.evaluate(() => {
        const hooks = (window as GameWindow).dungeonTest!;
        const cutaway = hooks.cutawayDiagnostics!();
        const digest = (hooks as { sceneDigest?: () => unknown }).sceneDigest!();
        return { actors: hooks.actorStats!(), textures: hooks.textureHash!(), cutaway: { meshes: cutaway.registeredMeshCount, materials: cutaway.registeredMaterialCount }, digest };
      });
      const built = await game.floor();
      const walkable = built.tiles.filter((t) => canStand(built.cells, t.x * TILE, t.z * TILE)).length;
      trace.push({
        label: `level ${level} seed ${seed}`,
        value: round({
          render: { geometries: s.render.geometries, textures: s.render.textures, calls: s.render.calls, triangles: s.render.triangles, pointLights: s.render.pointLights, passes: s.render.passes },
          graphics: s.graphics, floor: { level: s.floor.level, seed: s.floor.seed, tiles: s.floor.tiles, bounds: s.floor.bounds, waterfalls: s.floor.waterfalls },
          features: s.features, stair: s.stair, drop: s.drop, enemies: s.enemies, remaining: s.remaining, objective: s.objective,
          player: { x: s.player.x, z: s.player.z }, roomName: s.roomName, mood: s.mood, ...extra, walkable,
        }),
      });
    }
    settleTrace('floor-build', trace);
  });
});
