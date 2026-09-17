import {
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

export type Floor = ReturnType<typeof generateFloor>;
export type Point = { x: number; z: number };

export type Snapshot = {
  coordinates: string;
  mode: 'ready' | 'paused' | 'playing' | 'complete' | 'won' | 'lost';
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
  };
  boons: {
    strike: number;
    reach: number;
    draught: number;
    dashSpan: number;
    guardAgainst: number;
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
    dwell: number;
    takes: number;
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

  /** Fresh page, pinned seeds, manual time, error recording. Not yet started. */
  static async open(page: Page, info: TestInfo, seeds: number[]) {
    const game = new Game(page, info, seeds);
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
    await page.addInitScript((pinned: number[]) => {
      const source = crypto;
      const original = source.getRandomValues.bind(source);
      let index = 0;
      // Only the single-word draw `buildFloor` makes is pinned; everything else
      // keeps real entropy, so nothing but the floor seed is stubbed out.
      const pinnedDraw = (array: Parameters<Crypto['getRandomValues']>[0]) => {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = pinned[Math.min(index++, pinned.length - 1)] >>> 0;
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

  /** Dispatches one named game action, the same event the UI buttons send. */
  async act(detail: string) {
    await this.page.evaluate(
      (name) =>
        window.dispatchEvent(
          new CustomEvent('dungeon-action', { detail: name }),
        ),
      detail,
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

  /** Draws once, then saves a capture for human review under the test output. */
  async capture(name: string) {
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

export const test = base.extend<{ seeds: number[]; game: Game }>({
  seeds: [DEFAULT_SEEDS, { option: true }],
  // Named `runTest`, not `use`: a bare `use` reads as a React hook to the linter.
  game: async ({ page, seeds }, runTest, info) => {
    const game = await Game.open(page, info, seeds);
    await runTest(game);
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
