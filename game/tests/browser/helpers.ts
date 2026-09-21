import {
  type Browser,
  expect,
  test as base,
  type CDPSession,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  canStand,
  cellKey,
  generateFloor,
  hasClearPath,
  TILE,
} from '../../app/dungeon-floor.ts';

export { canStand, expect, hasClearPath, TILE };

/**
 * Whether this run produces the reference frames. They are artefacts for a
 * human to look at: nothing in the suite asserts on a PNG, and every helper
 * that does read pixels — `loudestColour`, `tellAgainstStone` — draws its own
 * frame first, so no check anywhere depends on a capture having happened.
 *
 * Off by default, because the capture is the expensive half of this suite on a
 * software rasteriser and CI threw the images away on every green run: the
 * workflow only uploads them when something failed. `GAME_TEST_CAPTURE=1` asks
 * for them, and the `captures` input on Verify and Deploy asks for them on a
 * runner — which is where the reviewed set has to come from, since the
 * baseline in `output/shots/baseline/` was taken on SwiftShader and a local
 * `GAME_TEST_GL=d3d11` run is a different renderer's output.
 */
export const CAPTURING = process.env.GAME_TEST_CAPTURE === '1';

/**
 * Boot a page per test the way this suite did before pooling, rather than resetting one the worker
 * already has. Twelve of the fifteen seconds a scenario used to cost were that boot - module load, a
 * WebGL context and a first floor - paid eighty-five times for a page every test threw away.
 *
 * The pooled path is the default and the isolated one is kept alive deliberately: it is the oracle. If
 * the two ever disagree, a reset is not returning the page to the state a boot leaves it in, and the
 * nightly `isolated` run on main is what says so before a pull request inherits it.
 */
export const ISOLATED = process.env.GAME_TEST_ISOLATE === '1';

// The same two values playwright.config.ts builds its baseURL from. A context opened here rather
// than by the `context` fixture does not inherit that baseURL, so it is restated rather than guessed.
const HOST = '127.0.0.1';
const PORT = Number(process.env.GAME_TEST_PORT ?? 3000);

/**
 * Fields a reset is allowed to differ from a boot on, as dotted paths, and why. Anything not named
 * here is compared, so this list is the whole of what the guard does not cover: keep it short, keep
 * the reasons, and prefer a narrower path to a broader one. `settings` rather than `settings.sound`
 * would hide `muted`, which is game state and must not drift.
 */
const DRIFTS = [
  // Wall-clock milliseconds the floor build took. A number that measures the machine cannot match.
  'buildMs',
  // The renderer's own counters describe whatever was last drawn, and a reset does not draw.
  // `frame-budget.spec.ts` is what holds these to a ceiling, and it draws its own frame first.
  'render',
  // The AudioContext's own lifecycle. A page that has booted but never started a run has no running
  // context, and one cannot be un-started: the browser gives it out on a gesture and keeps it. This
  // is the hardware's state, not the game's - `muted` and the settings beside it are still compared.
  'settings.sound',
] as const;

/**
 * Below this, a number is zero. Poses and velocities settle by exponential damping, which approaches
 * a rest value without ever arriving: a knight who has stopped moving reports an arm angle of -1e-19
 * where a knight who never moved reports 0. Treating that as a difference would make the guard cry
 * leak on every scenario that moved anything, which is all of them.
 */
const ZERO = 1e-9;

/** The snapshot as the leak guard compares it: drifting fields dropped, damping residue snapped. */
const comparable = (state: Snapshot) => {
  const settle = (value: unknown): unknown => {
    if (typeof value === 'number') return Math.abs(value) < ZERO ? 0 : value;
    if (Array.isArray(value)) return value.map(settle);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, settle(inner)]),
      );
    }
    return value;
  };
  const copy = settle(state) as Record<string, unknown>;
  for (const path of DRIFTS) {
    const steps = path.split('.');
    const leaf = steps.pop()!;
    let node: Record<string, unknown> | undefined = copy;
    for (const step of steps) {
      node = node?.[step] as Record<string, unknown> | undefined;
    }
    if (node) delete node[leaf];
  }
  return JSON.stringify(copy, null, 1);
};

export type Floor = ReturnType<typeof generateFloor>;
export type Point = { x: number; z: number };

export type Snapshot = {
  coordinates: string;
  mode: 'ready' | 'paused' | 'playing' | 'complete' | 'won' | 'lost';
  /** Whether a floor build is pending behind the loading veil. */
  building: boolean;
  boonOffer: boolean;
  muted: boolean;
  roomName: string;
  health: number;
  maxHealth: number;
  rank: number;
  weapon: {
    id: string;
    name: string;
    damage: number;
    reach: number;
    duration: number;
    /** What one clean blow actually takes off, weapon plus boons. */
    strikeDamage: number;
    ranged: boolean;
    quiver: number | null;
    capacity: number | null;
    inFlight: number;
    fires: number;
  };
  boons: {
    strike: number;
    reach: number;
    draught: number;
    dashSpan: number;
    guardAgainst: number;
  };
  /** Dev-only view of who owns the aim and where the cursor is, in NDC. */
  aim: {
    device: 'keys' | 'pointer';
    ndc: { x: number; y: number } | null;
    span: number;
    aspect: number;
    pad: { x: number; z: number } | null;
  };
  remaining: number;
  objective: {
    floor: number;
    floors: number;
    goal: string;
    goalRoom: number;
    halls: number;
    goalDepth: number;
    atStair: boolean;
    stairClear: boolean;
    stairOpen: boolean;
    stairDwell: number;
    deadEndsPlundered: number;
  };
  drop: {
    x: number;
    z: number;
    kind: string;
    radius: number;
    /** Whether the knight is inside the ring, which is all that standing there does. */
    over: boolean;
    /** The arm the swap prompt is currently naming, or null when it is not on screen. */
    offered: string | null;
  } | null;
  stair: { x: number; z: number; radius: number; dwell: number };
  experience: {
    total: number;
    perEnemy: number;
    intoRank: number;
    rankCost: number;
    resetsOnNewRun: boolean;
  };
  render: {
    geometries: number;
    textures: number;
    calls: number;
    triangles: number;
  };
  features: {
    room: number;
    shrine: boolean;
    used: boolean;
    phase: number;
    x: number;
    z: number;
    radius: number;
  }[];
  buildMs: Record<string, number>;
  floor: {
    level: number;
    seed: number;
    tiles: number;
    rooms: Floor['rooms'];
    edges: [number, number][];
    start: number;
    goal: number;
    spine: number[];
    visited: number[];
    cleared: number[];
    bounds: Floor['bounds'];
  };
  /** The lights the chamber is actually being lit with this frame, as `#rrggbb`. */
  mood: {
    theme: 'keep' | 'ruins' | 'flooded';
    fire: string;
    key: string;
    fog: string;
    banner: string;
  };
  /** What the floor's own motif geometry actually attached, not a recomputation of the planner. */
  graphics: {
    motifs: { room: number; theme: 'keep' | 'ruins' | 'flooded' }[];
  };
  player: {
    x: number;
    z: number;
    facing: Point;
    rotation: number;
    velocity: Point;
    attackTime: number;
    attackBuffer: number;
    dashBuffer: number;
    dashTime: number;
    dashCooldown: number;
    /** Which beat of an attack string is running, and what it is worth. */
    chain: {
      beat: number;
      beats: number;
      /** Seconds since the last swing ended, or null when nothing has swung yet. */
      idle: number | null;
      damage: number;
      duration: number;
    };
    swordAngle: number;
    legs: number[];
    locomotion: { speed:number; phase:number; sprint:number; pitch:number; height:number; arm:number; knees:number[] };
  };
  enemies: {
    x: number;
    z: number;
    hp: number;
    kind: 'guard' | 'stalker' | 'warden';
    windup: number;
    lunge: number;
    cooldown: number;
    aim: Point;
    room: number;
    awake: boolean;
  }[];
};

export type CombatFixture = {
  health?: number;
  enemies?: {
    index: number;
    x?: number;
    z?: number;
    hp?: number;
    windup?: number;
    cooldown?: number;
    aim?: Point;
  }[];
};

type GameWindow = Window & {
  advanceTime?: (ms: number, draw?: boolean) => void;
  render_game_to_text?: () => string;
  dungeonTest?: {
    teleport: (x: number, z: number) => void;
    equip: (id: string) => void;
    descend: () => void;
    buildFloor: (level: number) => void;
    grantXp: (amount: number) => void;
    reset: (seed?: number) => void;
    configureCombatFixture?: (fixture: CombatFixture) => void;
  };
};

// Screen-relative movement basis, mirrored from dungeon-game.tsx so a fixture
// can place the knight where one arrow key aims a strike straight at a target.
const unit = (x: number, z: number): Point => {
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
};
const SCREEN_RIGHT = unit(11.5, -9.2);
const SCREEN_DOWN = unit(9.2, 11.5);

export type ScreenDirection = 'right' | 'left' | 'down' | 'up';

export const SCREEN_DIRECTIONS: Record<ScreenDirection, Point> = {
  right: SCREEN_RIGHT,
  left: { x: -SCREEN_RIGHT.x, z: -SCREEN_RIGHT.z },
  down: SCREEN_DOWN,
  up: { x: -SCREEN_DOWN.x, z: -SCREEN_DOWN.z },
};

export const ARROW_KEYS: Record<ScreenDirection, string> = {
  right: 'ArrowRight',
  left: 'ArrowLeft',
  down: 'ArrowDown',
  up: 'ArrowUp',
};

// Fixed seeds keep every scenario on one known floor. `crypto.getRandomValues`
// is intercepted for the single Uint32Array `buildFloor` draws, so the real
// generator still runs; only its entropy is pinned.
export const DEFAULT_SEEDS = [0x1, 0x7, 0xc];

/** Distance the knight keeps while lining a strike up: inside 1.8, with slack. */
export const STRIKE_STANCE = 1.05;

/** Which arrow key pushes closest to a world direction, in screen space. */
export const keyToward = (direction: Point) => {
  const names = Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[];
  const best = names.sort(
    (a, b) =>
      SCREEN_DIRECTIONS[b].x * direction.x +
      SCREEN_DIRECTIONS[b].z * direction.z -
      (SCREEN_DIRECTIONS[a].x * direction.x +
        SCREEN_DIRECTIONS[a].z * direction.z),
  )[0];
  return { name: best, key: ARROW_KEYS[best] };
};

/**
 * Snapshots drop dead enemies, so an array index stops naming the same skeleton
 * after a kill. Re-acquire by kind and last known position instead, and fail
 * loudly rather than silently latching onto its neighbour across the room.
 */
export const trackEnemy = (
  state: Snapshot,
  kind: Snapshot['enemies'][number]['kind'] | null,
  near: Point,
  tolerance = 4,
) => {
  const found = state.enemies
    .filter((enemy) => kind === null || enemy.kind === kind)
    .map((enemy) => ({
      enemy,
      away: Math.hypot(enemy.x - near.x, enemy.z - near.z),
    }))
    .sort((a, b) => a.away - b.away)[0];
  if (!found || found.away > tolerance) {
    throw new GameError(
      `no living ${kind ?? 'enemy'} within ${tolerance} of ${describe(near)}`,
    );
  }
  return found.enemy;
};

/** Straight-line speed the snapshot reports for the knight. */
export const speedOf = (state: Snapshot) =>
  Math.hypot(state.player.velocity.x, state.player.velocity.z);

export class GameError extends Error {}

const describe = (spot: Point) =>
  `world (${spot.x.toFixed(3)}, ${spot.z.toFixed(3)}) / cell ${cellKey(
    Math.round(spot.x / TILE),
    Math.round(spot.z / TILE),
  )}`;

export class Game {
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly failedRequests: string[] = [];
  private cdp: CDPSession | null = null;

  private constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly seeds: number[],
  ) {}

  /**
   * Fresh page, pinned seeds, manual time, error recording. Not yet started.
   *
   * `watch` is false for the one boot a worker's pooled page gets: that page outlives this `Game`,
   * so the listeners belong to the pool, which re-points them at each scenario in turn. Attaching
   * them here too would go on charging a page's whole life to a object nobody holds any more.
   */
  static async open(page: Page, info: TestInfo, seeds: number[], watch = true) {
    const game = new Game(page, info, seeds);
    if (watch) {
      page.on('pageerror', (error) => game.pageErrors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') game.consoleErrors.push(message.text());
      });
      page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown';
        // Vite drops in-flight HMR probes when the page navigates; that is not a
        // missing asset and must not fail an otherwise clean run.
        if (failure === 'net::ERR_ABORTED') return;
        game.failedRequests.push(`${request.url()} (${failure})`);
      });
    }
    // The pinned draws live behind a handle rather than being baked into the closure: a pooled page
    // outlives the seeds of the test it was booted for, and the next scenario has to be able to hand it
    // a different set and rewind the cursor without a reload. The isolated path uses the same handle,
    // so there is one way seeds are pinned rather than two that can drift apart.
    await page.addInitScript((pinned: number[]) => {
      const source = crypto;
      const original = source.getRandomValues.bind(source);
      const handle = { values: pinned, index: 0 };
      (window as unknown as { __pinnedSeeds: typeof handle }).__pinnedSeeds = handle;
      // Only the single-word draw `buildFloor` makes is pinned; everything else
      // keeps real entropy, so nothing but the floor seed is stubbed out.
      const pinnedDraw = (array: Parameters<Crypto['getRandomValues']>[0]) => {
        if (array instanceof Uint32Array && array.length === 1 && handle.values.length) {
          array[0] =
            handle.values[Math.min(handle.index++, handle.values.length - 1)] >>> 0;
          return array;
        }
        return original(array);
      };
      Object.defineProperty(source, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: pinnedDraw,
      });
    }, seeds);
    await page.goto('/');
    await page.waitForFunction(
      () => typeof (window as GameWindow).render_game_to_text === 'function',
    );
    // The hook goes up a render before the veil comes down, so a scenario that
    // looked at the screen straight away could catch the tail of the boot wait.
    await page.locator('.loading-veil').waitFor({ state: 'detached' });
    // Manual time before anything else: the rAF loop stops on the first call,
    // so every later assertion reads a simulation this test stepped itself.
    await game.step(0);
    const first = await game.state();
    expect(
      first.floor.seed,
      'floor seed did not come from the pinned fixture; the generator entry point changed',
    ).toBe(seeds[0] >>> 0);
    return game;
  }

  /**
   * Points a pooled page's seed handle at this scenario's draws and rewinds the cursor. The reset
   * below takes no seed on purpose: `buildFloor(1)` without one draws from the handle exactly as the
   * first load did, so floor 2 and floor 3 get the second and third pinned words rather than the
   * first and second. Passing the seed straight to `restart` would skip that draw and quietly shift
   * every later floor by one.
   */
  static pin(page: Page, seeds: number[]) {
    return page.evaluate((values: number[]) => {
      const handle = (window as unknown as {
        __pinnedSeeds?: { values: number[]; index: number };
      }).__pinnedSeeds;
      if (!handle) throw new Error('the pinned seed handle is gone');
      handle.values = values;
      handle.index = 0;
    }, seeds);
  }

  /**
   * Returns a pooled page to the state a fresh one is in, for the price of a floor build rather than
   * a page load. Storage first, because the save is read while floor 1 is built; then the game's own
   * `restart`, which is the path the end screen uses and therefore the one that has to stay correct.
   */
  async reset(seeds: number[]) {
    await this.page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        /* storage blocked: nothing was remembered to begin with */
      }
    });
    await Game.pin(this.page, seeds);
    await this.page.evaluate(() => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.reset();
    });
    await this.built();
    await this.step(0);
    const first = await this.state();
    expect(
      first.floor.seed,
      'the reset floor did not come from the pinned fixture',
    ).toBe(seeds[0] >>> 0);
  }

  /**
   * A scenario's turn on the worker's page: reset it to this scenario's seeds, and take delivery of
   * whatever the browser complains about while it runs.
   */
  static async adopt(page: Page, info: TestInfo, seeds: number[], pool: Pool) {
    const game = new Game(page, info, seeds);
    pool.sink = game;
    await game.reset(seeds);
    return game;
  }

  /**
   * What keeps a pooled page honest, and the reason this suite can stop booting one per test.
   *
   * A reset is only as good as the fields it remembers, and the half of it that does not come from
   * the game's own `restart` is exactly the half that can rot as the game grows. So rather than
   * trusting it, every scenario ends by resetting back to the seeds the worker booted on and holding
   * the whole snapshot against what that boot produced. Anything a scenario leaves behind that the
   * reset does not clear fails the scenario that left it, naming the field - not the innocent one
   * that inherits it three tests later, which is how this repository lost a day to a reused stalker
   * carrying a released pounce across a test boundary.
   */
  async prove(pool: Pool) {
    // A scenario that already failed has a page in whatever state the failure left it; the diff
    // would be noise on top of a real error, and the reset below is still worth doing for the next.
    const clean = this.info.status === this.info.expectedStatus;
    await this.reset(DEFAULT_SEEDS);
    pool.sink = null;
    if (!clean || pool.baseline === null) return;
    expect(
      await this.comparable(),
      'this scenario left state behind that a reset did not clear, so the pooled page no longer ' +
        'matches a freshly booted one. Either reset it in `dungeonTest.reset`, or mark the spec ' +
        '`test.use({ isolate: true })` and say why.',
    ).toBe(pool.baseline);
  }

  /** The snapshot as the leak guard compares it: everything but the fields in `DRIFTS`. */
  async comparable() {
    return comparable(await this.state());
  }

  state(): Promise<Snapshot> {
    return this.page.evaluate(() => {
      const hook = (window as GameWindow).render_game_to_text;
      if (!hook) throw new Error('render_game_to_text is gone');
      return JSON.parse(hook()) as Snapshot;
    });
  }

  /** Steps the simulation by `ms` of game time. Drawing is opt-in: it is slow. */
  async step(ms: number, draw = false) {
    await this.page.evaluate(
      (input: { ms: number; draw: boolean }) => {
        const hook = (window as GameWindow).advanceTime;
        if (!hook) throw new Error('advanceTime is gone');
        hook(input.ms, input.draw);
      },
      { ms, draw },
    );
  }

  /**
   * Dispatches named game actions, the same events the UI buttons send.
   *
   * Several in one call go out in a single evaluate, with no frame between them. That is the only
   * honest way to say "a second press while the veil is up": two separate round-trips race the three
   * animation frames `veiled` waits out, and on a loaded machine the round-trips lose - the veil is
   * already down, the second press is an ordinary restart, and it eats the next pinned seed.
   */
  async act(detail: string, ...more: string[]) {
    await this.page.evaluate(
      (names: string[]) => {
        for (const name of names) {
          window.dispatchEvent(
            new CustomEvent('dungeon-action', { detail: name }),
          );
        }
      },
      [detail, ...more],
    );
  }

  async teleport(x: number, z: number) {
    await this.page.evaluate(
      (spot: Point) => {
        const hook = (window as GameWindow).dungeonTest;
        if (!hook) throw new Error('dungeonTest is gone');
        hook.teleport(spot.x, spot.z);
      },
      { x, z },
    );
  }

  /** Put a named arm in hand without walking a rack down. Fixture setup, like teleport. */
  async equip(id: string) {
    await this.page.evaluate((weapon: string) => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.equip(weapon);
    }, id);
    await this.step(32);
  }

  async grantXp(amount: number) {
    await this.page.evaluate((value: number) => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.grantXp(value);
    }, amount);
  }

  async buildFloor(level: number) {
    await this.page.evaluate((value: number) => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.buildFloor(value);
    }, level);
  }

  /**
   * Development-only fixture hook from plan 002. It is absent in a production
   * build, so a test asserts it exists rather than skipping when it does not.
   */
  async configureCombat(fixture: CombatFixture) {
    const available = await this.page.evaluate(
      () =>
        typeof (window as GameWindow).dungeonTest?.configureCombatFixture ===
        'function',
    );
    expect(
      available,
      'dungeonTest.configureCombatFixture is missing; the dev-only fixture hook was removed',
    ).toBe(true);
    await this.page.evaluate((payload: CombatFixture) => {
      const hook = (window as GameWindow).dungeonTest?.configureCombatFixture;
      if (!hook) throw new Error('configureCombatFixture is gone');
      hook(payload);
    }, fixture);
  }

  /** Clicks the real entry button and waits for the intro card to go away. */
  async enter() {
    const enterButton = this.page.locator('.intro-screen .primary-action');
    await expect(enterButton).toBeEnabled();
    await enterButton.click();
    await expect(this.page.locator('.intro-screen')).toBeHidden();
  }

  /**
   * Waits out a floor build deferred behind the loading veil. The veil is raised
   * in the same breath as the action that asks for the build, so `building` is
   * already true by the time a click resolves; what this waits for is the frames
   * the veil needs to paint and the build that happens between them.
   */
  async built() {
    await expect
      .poll(() => this.state().then((state) => state.building), {
        message: 'the floor build behind the loading veil never finished',
      })
      .toBe(false);
  }

  /** The pure floor behind the live one, for legal fixture positions. */
  async floor(): Promise<Floor> {
    const snapshot = await this.state();
    return generateFloor(snapshot.floor.seed, snapshot.floor.level);
  }

  /** Every boon moves one of these, which is how a test knows one landed. */
  private effects() {
    return this.state().then((state) =>
      JSON.stringify({ boons: state.boons, maxHealth: state.maxHealth }),
    );
  }

  /**
   * Takes a boon by clicking a card that is actually on offer, so the test
   * never depends on the shuffled order the draft happens to produce. A queued
   * rank opens the next draft in the same breath, so this waits for the chosen
   * boon to take effect rather than for the overlay to disappear.
   */
  async takeBoon(reject: string[] = []) {
    const options = this.page.locator('.boon-option');
    await expect(options.first()).toBeVisible();
    const names = await options.locator('strong').allInnerTexts();
    const index = names.findIndex((name) => !reject.includes(name));
    expect(
      index,
      `every offered boon was rejected: offered ${names.join(', ')}`,
    ).toBeGreaterThanOrEqual(0);
    const chosen = names[index];
    const before = await this.effects();
    await options.nth(index).click();
    await expect
      .poll(() => this.effects(), {
        message: `the boon "${chosen}" never took effect`,
      })
      .not.toBe(before);
    return chosen;
  }

  private async session() {
    this.cdp ??= await this.page.context().newCDPSession(this.page);
    return this.cdp;
  }

  /** Raw multi-touch, so two contacts can be held at once like a real thumb pair. */
  async touch(
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    points: { x: number; y: number; id: number }[],
  ) {
    const session = await this.session();
    await session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point) => ({
        x: point.x,
        y: point.y,
        id: point.id,
      })),
    });
  }

  async centreOf(selector: string) {
    const box = await this.page.locator(selector).boundingBox();
    if (!box) throw new GameError(`${selector} has no layout box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /**
   * Draws once, then saves a capture for human review under the test output.
   * A no-op unless this run was asked for the reference frames — see
   * `CAPTURING`. Returns the file it wrote, or null when it wrote nothing.
   */
  async capture(name: string) {
    if (!CAPTURING) return null;
    await this.step(0, true);
    const file = this.info.outputPath(`${name}.png`);
    await this.page.screenshot({ path: file, timeout: 60_000 });
    await this.info.attach(name, { path: file, contentType: 'image/png' });
    return file;
  }

  /** Diagnostics every failure carries: which floor, and what it looked like. */
  async report() {
    const snapshot = await this.state().catch(() => null);
    return [
      `seeds: ${this.seeds.map((seed) => `0x${(seed >>> 0).toString(16)}`).join(', ')}`,
      `snapshot: ${JSON.stringify(snapshot)}`,
    ].join('\n');
  }

  async finish() {
    if (this.info.status !== this.info.expectedStatus) {
      await this.info.attach('game-state', {
        body: await this.report(),
        contentType: 'text/plain',
      });
    }
    const noise = [
      ...this.pageErrors.map((error) => `page error: ${error}`),
      ...this.consoleErrors.map((error) => `console error: ${error}`),
      ...this.failedRequests.map((error) => `failed request: ${error}`),
    ];
    expect(noise, 'the browser reported problems during this scenario').toEqual(
      [],
    );
  }
}

/**
 * One booted page per worker, handed to every scenario that can take it.
 *
 * The page carries the error listeners, because they belong to the page and not to the scenario
 * currently driving it; `sink` is what the fixture re-points at each `Game` so a stray console error
 * is still charged to the test that caused it.
 */
class Pool {
  page: Page | null = null;
  /** Whole-snapshot state a boot leaves behind, which every reset is then held against. */
  baseline: string | null = null;
  sink: {
    pageErrors: string[];
    consoleErrors: string[];
    failedRequests: string[];
  } | null = null;

  constructor(private readonly browser: Browser) {}

  async take(info: TestInfo) {
    if (this.page) return this.page;
    const context = await this.browser.newContext({
      viewport: { width: 1000, height: 700 },
      baseURL: `http://${HOST}:${PORT}`,
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => this.sink?.pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') this.sink?.consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (failure === 'net::ERR_ABORTED') return;
      this.sink?.failedRequests.push(`${request.url()} (${failure})`);
    });
    const game = await Game.open(page, info, DEFAULT_SEEDS, false);
    this.baseline = await game.comparable();
    this.page = page;
    return page;
  }

  async close() {
    await this.page?.context().close();
  }
}

/**
 * Options this project varies per scenario. A pooled context cannot change any of them mid-life -
 * `hasTouch` and `isMobile` are fixed when the context opens, and a stored settings blob is read on
 * load - so a scenario that changes one gets its own page, exactly as every scenario used to.
 */
const needsOwnPage = (options: {
  isolate: boolean;
  hasTouch: boolean;
  isMobile: boolean;
  storageState: unknown;
  viewport: { width: number; height: number } | null;
}) =>
  ISOLATED ||
  options.isolate ||
  options.hasTouch ||
  options.isMobile ||
  options.storageState !== undefined ||
  options.viewport?.width !== 1000 ||
  options.viewport?.height !== 700;

export const test = base.extend<
  { seeds: number[]; isolate: boolean; game: Game },
  { pool: Pool }
>({
  seeds: [DEFAULT_SEEDS, { option: true }],
  /**
   * Opts a scenario out of the pool. Three specs need it and say why at their own `test.use`: they
   * assert on what a boot does, so a page that is already booted is not the thing under test.
   */
  isolate: [false, { option: true }],
  pool: [
    async ({ browser }, runWorker) => {
      const pool = new Pool(browser);
      await runWorker(pool);
      await pool.close();
    },
    { scope: 'worker' },
  ],
  // Overridden rather than added: specs destructure `{ game, page }` and drive the page directly, so
  // the two have to be the same object. A scenario that needs its own gets a context built here from
  // the options it asked for; the rest are handed the worker's.
  page: async (
    { browser, pool, isolate, hasTouch, isMobile, storageState, viewport },
    runTest,
    info,
  ) => {
    if (
      !needsOwnPage({ isolate, hasTouch, isMobile, storageState, viewport })
    ) {
      await runTest(await pool.take(info));
      return;
    }
    const context = await browser.newContext({
      viewport: viewport ?? undefined,
      hasTouch,
      isMobile,
      storageState,
      baseURL: `http://${HOST}:${PORT}`,
    });
    const own = await context.newPage();
    await runTest(own);
    await context.close();
  },
  // Named `runTest`, not `use`: a bare `use` reads as a React hook to the linter.
  game: async (
    { page, pool, seeds, isolate, hasTouch, isMobile, storageState, viewport },
    runTest,
    info,
  ) => {
    const own = needsOwnPage({
      isolate,
      hasTouch,
      isMobile,
      storageState,
      viewport,
    });
    const game = own
      ? await Game.open(page, info, seeds)
      : await Game.adopt(page, info, seeds, pool);
    await runTest(game);
    if (!own) await game.prove(pool);
    await game.finish();
  },
});

/**
 * Where to stand so that holding one arrow key aims a strike straight down an
 * unobstructed lane at `target`. Throws with every rejected candidate rather
 * than letting a caller quietly skip the scenario.
 */
export function strikeStance(
  floor: Floor,
  target: Point,
  options: { distance?: number; avoid?: Point[]; clearance?: number } = {},
) {
  const distance = options.distance ?? STRIKE_STANCE;
  const avoid = options.avoid ?? [];
  const clearance = options.clearance ?? 2.6;
  const rejected: string[] = [];
  for (const name of Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]) {
    const direction = SCREEN_DIRECTIONS[name];
    const spot = {
      x: target.x - direction.x * distance,
      z: target.z - direction.z * distance,
    };
    if (!canStand(floor.cells, spot.x, spot.z)) {
      rejected.push(`${name}: ${describe(spot)} is not walkable`);
      continue;
    }
    if (!hasClearPath(floor.cells, spot, target)) {
      rejected.push(
        `${name}: ${describe(spot)} has no clear lane to the target`,
      );
      continue;
    }
    const near = avoid.find(
      (other) => Math.hypot(other.x - spot.x, other.z - spot.z) < clearance,
    );
    if (near) {
      rejected.push(`${name}: ${describe(spot)} sits on ${describe(near)}`);
      continue;
    }
    return { ...spot, direction: name, key: ARROW_KEYS[name] };
  }
  throw new GameError(
    `no legal strike stance around ${describe(target)}\n${rejected.join('\n')}`,
  );
}

/**
 * A walkable spot exactly `distance` from `target` with an unobstructed lane
 * back to it, searched around the full circle. Enemy reach tests need arbitrary
 * ranges and angles, which the four screen directions cannot always supply.
 */
export function laneSpot(
  floor: Floor,
  target: Point,
  distance: number,
  options: { avoid?: Point[]; clearance?: number; steps?: number } = {},
) {
  const avoid = options.avoid ?? [];
  const clearance = options.clearance ?? 3;
  const steps = options.steps ?? 24;
  const rejected: string[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const spot = {
      x: target.x + Math.cos(angle) * distance,
      z: target.z + Math.sin(angle) * distance,
    };
    if (!canStand(floor.cells, spot.x, spot.z)) continue;
    if (!hasClearPath(floor.cells, spot, target)) continue;
    const near = avoid.find(
      (other) => Math.hypot(other.x - spot.x, other.z - spot.z) < clearance,
    );
    if (near) {
      rejected.push(`${describe(spot)} sits on ${describe(near)}`);
      continue;
    }
    // Room to sidestep matters for dodge fixtures, so demand a little slack.
    const open = [0.5, -0.5].some((side) =>
      canStand(
        floor.cells,
        spot.x + Math.cos(angle + Math.PI / 2) * side * 3,
        spot.z + Math.sin(angle + Math.PI / 2) * side * 3,
      ),
    );
    if (!open) {
      rejected.push(`${describe(spot)} has no sidestep room`);
      continue;
    }
    return spot;
  }
  throw new GameError(
    `no clear lane at ${distance} from ${describe(target)}\n${rejected.join('\n') || 'every angle was blocked or unwalkable'}`,
  );
}

/**
 * A walkable spot within `radius` of `centre` that keeps `clearance` from every
 * point in `avoid`. Used to park the knight clear of hazards and packs.
 */
export function openSpot(
  floor: Floor,
  centre: Point,
  options: { radius?: number; avoid?: Point[]; clearance?: number } = {},
) {
  const radius = options.radius ?? 14;
  const avoid = options.avoid ?? [];
  const clearance = options.clearance ?? 3;
  const candidates = floor.tiles
    .map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE }))
    .filter(
      (spot) => Math.hypot(spot.x - centre.x, spot.z - centre.z) <= radius,
    )
    .filter((spot) => canStand(floor.cells, spot.x, spot.z))
    .filter((spot) =>
      avoid.every(
        (other) => Math.hypot(other.x - spot.x, other.z - spot.z) >= clearance,
      ),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - centre.x, a.z - centre.z) -
        Math.hypot(b.x - centre.x, b.z - centre.z),
    );
  if (!candidates.length) {
    throw new GameError(
      `no walkable spot within ${radius} of ${describe(centre)} clear of ${avoid.length} obstacles`,
    );
  }
  return candidates[0];
}

/** World centre of a room, in the units the snapshot reports. */
export const roomCentre = (floor: Floor, id: number): Point => ({
  x: floor.rooms[id].x * TILE,
  z: floor.rooms[id].z * TILE,
});
