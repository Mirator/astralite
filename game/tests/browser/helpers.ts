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
  HALL_SEED,
  TILE,
} from '../../app/dungeon-floor.ts';
import { BESTIARY, type EnemyKind } from '../../app/dungeon-bestiary.ts';
import { swordContacts } from '../../app/dungeon-combat.ts';

import { DEFAULT_BINDS, isMouseCode, type Action, type Slot } from '../../app/dungeon-save.ts';
import type { Meta } from '../../app/dungeon-meta.ts';

export { canStand, expect, hasClearPath, TILE };

/**
 * Plan 016: scenarios name the action they mean, not the key. What a key does moved once already (Space
 * struck, then dodged), and every spec that spelled the key out had to be found and rewritten by hand.
 * These resolve the default binding for the keyboard scheme - the first default that is not a mouse
 * button - and press it for real, so they exercise the same keydown path a player does.
 */
export const keyFor = (action: Action) => {
  const key = DEFAULT_BINDS[action].find((code) => !isMouseCode(code));
  if (!key) throw new Error(`${action} has no keyboard default`);
  return key;
};
export const press = (page: Page, action: Action) => page.keyboard.press(keyFor(action));
export const hold = (page: Page, action: Action) => page.keyboard.down(keyFor(action));
export const release = (page: Page, action: Action) => page.keyboard.up(keyFor(action));

/**
 * Plan 020, D3: ENTER THE KEEP opens the slot picker, and a slot's card is what enters. `openSlots` is the first press (it waits for the
 * button, then for the picker); `enterKeep` is both. A specification that measures the press itself (the loading ones) takes the
 * second press as its press, since that is the one that starts a build.
 */
export const openSlots = async (page: Page) => {
  const enterButton = page.locator('.intro-screen .primary-action');
  await expect(enterButton).toBeEnabled();
  await enterButton.click({ timeout: WARM_UP });
  await expect(page.locator('.slot-picker')).toBeVisible();
};
export const chooseSlot = (page: Page, slot: Slot = 1) => page.locator(`.slot-choose[data-slot="${slot}"]`).click({ timeout: WARM_UP });
export const enterKeep = async (page: Page, slot: Slot = 1) => {
  await openSlots(page);
  await chooseSlot(page, slot);
};

/**
 * A standard-mapping gamepad the page can read, every button up. The game polls `navigator.getGamepads()`
 * once an update, so a press is a plain write between steps, exactly as a real pad is sampled. `remove`
 * puts the browser's own method back - a pooled page must not carry a phantom pad into the next scenario -
 * and the next update then drops whatever the pad was holding.
 */
export const fakePad = async (page: Page) => {
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  return {
    set: (index: number, pressed: boolean) => page.evaluate(({ index, pressed }) => {
      (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[index] = { pressed, value: +pressed } as { pressed: boolean; value: number };
    }, { index, pressed }),
    remove: () => page.evaluate(() => {
      delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
      delete (window as unknown as { __pad?: unknown }).__pad;
    }),
  };
};

/**
 * How many RGBA texels differ by more than `threshold` summed across R+G+B, between two same-sized
 * frames. Eight levels on any one channel is past dither and compression noise; below that a frame is
 * "the same" for the purposes this counts pixels for.
 */
/**
 * Frames cross from the page as one base64 string rather than an `Array.from` of the RGBA bytes: a
 * plain array of ~3.7 million numbers is serialised element by element by Playwright's protocol, which
 * cost about 15 s per full frame under CI, and the same bytes as base64 take well under one.
 */
const unpackPixels = (base64: string) => new Uint8ClampedArray(Buffer.from(base64, 'base64'));

export const countChangedPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 8) => {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (delta > threshold) changed++;
  }
  return changed;
};

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
 * How long anything that waits for the keep to be *on screen* may take, as opposed to merely built.
 * The window hooks go up the moment floor 1 exists, but the loading veil stays until every shader is
 * linked and a frame has been presented. On a cold shader cache (a fresh profile, which every isolated
 * scenario is) that warm-up measured ~10 s under d3d11 once the point lights were capped, and software
 * rendering on CI is slower still. The veil covering it is the point of the loading screen, so waits
 * that span it get this budget rather than the 25 s default - and so does the wait for the hooks on a
 * fresh page, which lands before the compile but after a module load and a first floor that a sibling
 * worker's software-rasterised frames can starve well past 25 s.
 */
export const WARM_UP = 90_000;

/**
 * Boot a page per test the way this suite did before pooling, rather than resetting one the worker
 * already has. Twelve of the fifteen seconds a scenario used to cost were that boot - module load, a
 * WebGL context and a first floor - paid eighty-five times for a page every test threw away.
 *
 * The pooled path is the default and the isolated one is kept alive deliberately: it is the oracle. If
 * the two ever disagree, a reset is not returning the page to the state a boot leaves it in. Nothing runs
 * it on a schedule; reach for `GAME_TEST_ISOLATE=1` when a pooled failure looks like contamination.
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
  /** Whether the world stopped on a throw it could not answer and is showing the reload screen. */
  fault: boolean;
  /** Plan 020: the save slot every read and write of progress speaks for, read off the game's closure. */
  slot: Slot;
  /** Plan 020: whether the floor drawn is the Tide Altar's hall (read off the floor that was built), and whether its shop overlay is open. */
  hall: boolean;
  altarOpen: boolean;
  /**
   * Plan 020: what the scene actually placed in the hall, read off the groups it was attached to, or null on any other floor. `inScene` is true when the
   * piece's meshes are children of the floor being drawn; `stair` is whether a stair was built (it must not be).
   */
  hallProps: {
    altar: { x: number; z: number; radius: number; over: boolean; inScene: boolean } | null;
    racks: string[];
    wayDown: { x: number; z: number; radius: number; open: boolean; over: boolean; inScene: boolean; sign: string } | null;
    stair: boolean;
  } | null;
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
  /** Plan 019: what the live run was dealt (arm, vitality, strike, boon cards, revives), read off the run itself. */
  run: { start: { arm: string; maxHp: number; strike: number; draftSize: number; defiance: number }; /** Plan 019 (D9), plan 020 (D7): the run's arm is settled - true on every floor but the hall (and the dev arena). */ armLocked: boolean };
  /** The development arena this page is charting floors as, or null for an ordinary keep. */
  arena: { roster: EnemyKind[]; level: number; /** Plan 022 (D14): the modifier the arena was built with, when it was. */ elite?: 'hasted' | 'armoured' | 'wrathful' | 'volatile' } | null;
  /** The bodies that have fallen and lie where they fell (the snapshot's `enemies` no longer lists them). */
  corpses: { kind: EnemyKind; x: number; y: number; z: number; visible: boolean }[];
  /** Plan 022: the rings a called wave shows, read off the ring meshes: where each is drawn, whether it is showing, the body it is for (its index in the spawn list, the chamber and the wave). */
  waveMarks: { x: number; z: number; visible: boolean; wave: number; room: number; index: number }[];
  /**
   * Plan 021: the live boss body on this floor, or null. `phase` is its place in its `phases`, `move` its slot in the phase's rotation, `unhittable` and `change` the phase change in
   * progress, `attack` the move whose tell last began; `cue` is what its telegraph mesh is drawing, the shape read off the geometry on the mesh, and `bar` whether its own floating
   * health bar shows (it must not: the boss bar replaces it); `surge` is the ring a phase change plays at its feet; `shield` whether the shield mesh on its arm is showing (null for a boss that carries none).
   */
  boss: {
    kind: EnemyKind; hp: number; maxHp: number; phase: number; move: number; unhittable: boolean; change: number; awake: boolean; windup: number;
    attack: 'swing' | 'pounce' | 'volley' | 'sweep' | 'summon' | 'scatter' | 'veil' | null;
    cue: { visible: boolean; shape: 'arc' | 'ring' | 'lane'; scale: number }; bar: boolean; surge: boolean; shield: boolean | null;
  } | null;
  /** Fire a pyre left where it fell, burning the knight. */
  hostilePools: { kind: EnemyKind; x: number; z: number; radius: number; life: number; damage: number; drawn: boolean }[];
  /**
   * Plan 021 Stage C: the rings a boss's scatter has marked and not yet lit (`drawn` is whether the ring mesh is showing, `threat` whether it wears the tell's colour), the arrows the pool is
   * showing, and how many of the six hostile fire rings are showing (lit pools and marks together). Read off the meshes.
   */
  scatterMarks: { x: number; z: number; radius: number; drawn: boolean; threat: boolean }[];
  arrowsDrawn: number;
  hostileRings: number;
  /** Bolts loosed at the knight, still in the air. */
  hostileBolts: { kind: EnemyKind; x: number; z: number; dx: number; dz: number; damage: number }[];
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
    /** Whether the knight stands on the open stair, where the swap key takes him down. */
    onStair: boolean;
  };
  /** Plan 017: the chamber the knight stands in and its ways out. */
  chamber: {
    id: number; layer: number; reward: 'mend' | 'cache' | null; sealed: boolean; crossing: 'out' | 'in' | null;
    /** Plan 022: the wave in play (the last one called), how many waves the chamber holds, and whether the rings of the next one are showing. */
    wave: { at: number; of: number; marked: boolean };
    doors: { id: number; to: number; sign: string; x: number; z: number; radius: number; open: boolean; over: boolean }[];
  };
  /**
   * Plan 019: the racks on the floor, read off the scene. The Tide Gate of floor one holds one for every owned arm but the
   * one in hand; the dev arena has its own; every other floor has none.
   */
  racks: {
    x: number;
    z: number;
    kind: string;
    radius: number;
    /** Whether the knight is inside the ring, which is all that standing there does. */
    over: boolean;
    /** Whether the rack's group is attached to the floor being drawn. */
    inScene: boolean;
    /** The arm the swap prompt is currently naming while the knight stands in this ring, or null when it is not on screen. */
    offered: string | null;
  }[];
  stair: { x: number; z: number; radius: number };
  experience: {
    total: number;
    perEnemy: number;
    /** Plan 021 (D10): what felling a boss pays. */
    perBoss: number;
    intoRank: number;
    rankCost: number;
    resetsOnNewRun: boolean;
  };
  render: {
    geometries: number;
    textures: number;
    calls: number;
    triangles: number;
    /** Frames the post chain has drawn since the mount. Under manual time only `step(ms, true)` moves it. */
    frames: number;
    /** The last frame's shadow-map draws (held to one) and the draw calls they cost. */
    shadow: { draws: number; calls: number };
    /** The post chain's passes in order, by class name. */
    passes: string[];
    /** Point lights in the scene. Fixed by design: the count is compiled into every lit shader. */
    pointLights: number;
    programs: number;
    quality: 'full' | 'reduced';
    /** What the frame is drawn with now: the passes' own flags and the renderer's pixel ratio. `adaptive` is false when `?quality=` pinned it. */
    stage: { ao: boolean; bloom: boolean; pixelRatio: number; buffer: number; adaptive: boolean };
  };
  /** Live effect pools. `footsteps` is plan 008's contact feedback: particles alive, whether the batch
   * is drawn, contacts emitted, phase crossings seen, crossings skipped for want of stone support, per
   * surface emissions, and the last actual support cell/height an emission used. */
  effects: {
    impacts: number;
    /** Plan 016: the Tolling Slam's shockwave - up or not, the radius it stops at, and where its band is now. */
    shock: { active: boolean; radius: number; edge: number };
    /** Live sparks in the pooled batch. */
    sparks: number;
    footsteps: {
      active: number;
      drawn: boolean;
      emitted: number;
      contacts: number;
      skipped: number;
      kinds: Record<'keep' | 'ruins' | 'flooded', number>;
      last: { count: number; side: 0 | 1; kind: 'keep' | 'ruins' | 'flooded'; cell: string; x: number; y: number; z: number } | null;
    };
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
    /** Every colour a brazier halo burns this frame, distinct and sorted: one, `fire`, once a frame has run. */
    halos: string[];
  };
  /** What the floor's own motif geometry actually attached, not a recomputation of the planner. */
  graphics: {
    motifs: { room: number; theme: 'keep' | 'ruins' | 'flooded' }[];
    /** Every brazier's actual attached theme and the height its billboard flame is planted at, read
     * off the live scene - not the design table in `dungeon-flame.ts` recomputed from scratch. */
    flames: {
      theme: 'keep' | 'ruins' | 'flooded';
      y: number;
    }[];
    /** Realized macro paving (plan 006), derived from the actual batches rather than recomputed. */
    paving: { pairs: number; settled: number; surfaceCells: number };
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
    locomotion: { speed:number; phase:number; sprint:number; pitch:number; height:number; arm:number; tabard:number; knees:number[] };
  };
  enemies: {
    x: number;
    z: number;
    hp: number;
    kind: EnemyKind;
    /** A summoner's reserve still underground, and the spawn index that raises it (-1 for none). */
    buried: boolean;
    summoner: number;
    /** Blows its shield has turned aside. */
    blocked: number;
    visible: boolean;
    windup: number;
    /** Plan 024 (D3): the seconds this body still holds before it may begin the tell it is ready to begin (`pressure`, dungeon-enemy.ts); 0 when it is not waiting. */
    held: number;
    lunge: number;
    cooldown: number;
    aim: Point;
    room: number;
    awake: boolean;
    /** Plan 022: 1 for the pack a chamber is dealt, 2 or more for a wave it calls once the one before is down; and the vitality it was built with. */
    wave: number;
    maxHp: number;
    /** Plan 022 (D7, D8): the modifier the body carries, or null; the numbers it was built with and what it wears (the emissive of its first lit skin, and the colour of its eyes), read off the scene. */
    elite: 'hasted' | 'armoured' | 'wrathful' | 'volatile' | null;
    tell: number; speed: number; damage: number;
    wears: { emissive: number; intensity: number; eye: number; frame: number | null };
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

/** Plan 008: one live footstep particle, as `dungeonTest.footstepParticles()` reports it. */
export type FootstepParticle = { x: number; y: number; z: number; ox: number; oy: number; oz: number; width: number; length: number; alpha: number; age: number; life: number; droplet: boolean };

/** Plan 007: one slot's read-only state, as `dungeonTest.cutawayDiagnostics()` reports it. */
export type CutawaySlotDiagnostic = {
  owner: 'player' | EnemyKind | null;
  id: number | 'player' | null;
  strength: number;
  radii: [number, number];
  /** View-space centre, in the units the fragment shader itself compares against. */
  center: { x: number; y: number; z: number };
};
export type CutawayDiagnostics = {
  slots: CutawaySlotDiagnostic[];
  registeredMeshCount: number;
  registeredMaterialCount: number;
  enabled: boolean;
};

export type GameWindow = Window & {
  advanceTime?: (ms: number, draw?: boolean) => void;
  render_game_to_text?: () => string;
  dungeonTest?: {
    teleport: (x: number, z: number) => void;
    equip: (id: string) => void;
    descend: () => void;
    /** The optional seed (plan 015 Stage C.2) lets a test build the same floor synchronously and
     * compare it with one built through the sliced boot/restart path. */
    buildFloor: (level: number, seed?: number) => void;
    /** Plan 020: rebuilds as the Tide Altar's hall, synchronously. */
    buildHall: () => void;
    grantXp: (amount: number) => void;
    reset: (seed?: number) => void;
    /** Plan 019: the stored meta, re-validated; `setMeta` writes one and takes effect at the next run start. */
    meta: (slot?: Slot) => Meta;
    setMeta: (meta: Meta, slot?: Slot) => void;
    configureCombatFixture?: (fixture: CombatFixture) => void;
    /** Read-only target/material state; absent from a production build. */
    cutawayDiagnostics?: () => CutawayDiagnostics;
    /** Same-frame A/B toggle for the cutaway shader; never mutates a target's own state. */
    setCutawayEnabled?: (enabled: boolean) => void;
    /** Plan 008: every live footstep particle's world state; absent from a production build. */
    footstepParticles?: () => FootstepParticle[];
    /** Plan 008: same-frame A/B draw toggle for the footstep batch; never touches a particle. */
    setFootstepsEnabled?: (enabled: boolean) => void;
    /** Plan 009: meshes, triangles and height per figure, off the live scene; absent from a production build. */
    actorStats?: () => ActorStats;
    /** Plan 015 Stage C.2: a checksum of the shared stone textures' actual pixels; absent from a
     * production build. */
    textureHash?: () => { flagstone: number; masonry: number };
    /** Blocks until the GPU process has run everything already submitted; returns the wait in ms. Dev-only. */
    drainGpu?: () => number;
  };
};

/**
 * Plan 009's shared diagnostic for the model round. Counts are visible meshes under the actor, contact
 * pool included; `height` is the world-space bounding-box height of those meshes, pool excluded, and
 * `shadowless` counts those meshes that cast no shadow. `disposedMaterials` is every dispose that has
 * reached one of the knight's run-scoped materials since the mount; it only ever grows.
 */
export type ActorStats = {
  knight: { meshes: number; triangles: number; shadowless: number; height: number; disposedMaterials: number };
  enemies: { kind: EnemyKind; meshes: number; triangles: number; shadowless: number; height: number }[];
  racks: { kind: string; meshes: number; triangles: number }[];
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
/**
 * Plan 021 (D14): the boss every page boots asking for (`?boss=captain`, development only), as it boots with `boot=eager` and `hall=skip`. Floors one and two then hold the Captain
 * whatever `dealBosses` makes of the pinned seeds, so a scenario that needs a known boss does not search seeds for one and the suite does not move when the pool grows.
 * `test.use({ boss: null })` boots without the link, on a page of its own, and meets whatever the run was dealt.
 */
export const DEFAULT_BOSS = 'captain';
/**
 * Plan 022 (D14): whether every page boots asking for the first wave of every chamber and nothing after it (`?waves=off`, development only). Waves change what a chamber holds - a pack is one wave of several, a room does not clear on its
 * last kill - and some fifty scenarios stage a pack by counting what a chamber holds, kill it and expect the doors, the purse and the rank, so the suite boots with the later waves off, like it boots with the Captain, and what the waves do
 * is held by `waves.spec.ts`. `test.use({ waves: null })` boots with them on, on a page of its own: the keep as a player meets it.
 */
export const DEFAULT_WAVES = 'off';

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

/**
 * Installs the pinned-seed `crypto.getRandomValues` interception before a page navigates. `Game.open`
 * calls this for every page it boots; a scenario that drives its own boot on the plain URL instead of
 * going through `Game` (loading.spec.ts's LAST KEEP case, which must not pick up `Game.open`'s
 * `boot=eager`) calls it directly, so there is one way seeds are pinned rather than two that can drift
 * apart. The pinned draws live behind a handle rather than being baked into the closure: a pooled page
 * outlives the seeds of the test it was booted for, and the next scenario has to be able to hand it a
 * different set and rewind the cursor without a reload - see `Game.pin`, which re-points the same handle.
 */
export async function pinSeeds(page: Page, seeds: number[]) {
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
}

export class Game {
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly failedRequests: string[] = [];
  private cdp: CDPSession | null = null;

  private constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly seeds: number[],
    /** Whether this page boots into the Tide Altar's hall (`test.use({ hall: true })`) and not into floor 1 (`?hall=skip`, the default). */
    readonly hall = false,
    /** Plan 021 (D14): the `?boss=` link the page booted with, or null for none. Every page boots with the Captain, so the bosses a floor holds do not depend on the deal. */
    readonly boss: string | null = DEFAULT_BOSS,
    /** Plan 022 (D14): the `?waves=` link the page booted with, or null for none (the later waves are dealt). Every page boots with `off`, so what a chamber holds is its first wave. */
    readonly waves: string | null = DEFAULT_WAVES,
  ) {}

  /**
   * Fresh page, pinned seeds, manual time, error recording. Not yet started.
   *
   * `watch` is false for the one boot a worker's pooled page gets: that page outlives this `Game`,
   * so the listeners belong to the pool, which re-points them at each scenario in turn. Attaching
   * them here too would go on charging a page's whole life to a object nobody holds any more.
   */
  static async open(page: Page, info: TestInfo, seeds: number[], watch = true, hall = false, boss: string | null = DEFAULT_BOSS, waves: string | null = DEFAULT_WAVES) {
    const game = new Game(page, info, seeds, hall, boss, waves);
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
    await pinSeeds(page, seeds);
    // Reference frames stay at full quality: the baseline was drawn with the whole post chain on SwiftShader.
    // `boot=eager` (dev-only, plan 015 Stage A) restores the mount-time boot production dropped: this is a
    // boot, and almost every scenario here wants a floor already built and warm rather than spending itself
    // on a press first. It is passed on every `goto` this helper makes, pooled and isolated alike, so the
    // GAME_TEST_ISOLATE oracle still holds a reset against the same boot. A scenario that tests the boot
    // itself (loading.spec.ts) drives its own `page.goto` on the plain URL instead of going through `Game`.
    // Plan 020 (D11): `hall=skip` keeps today's flow - the boot builds floor 1 and ENTER enters it - for the 138 callers of `game.enter()`. A scenario that is
    // about the hall opts out with `test.use({ hall: true })`, which boots the page the way a player's is: into the Tide Altar's hall.
    await page.goto(`${CAPTURING ? '/?quality=full&' : '/?'}boot=eager${hall ? '' : '&hall=skip'}${boss === null ? '' : `&boss=${boss}`}${waves === null ? '' : `&waves=${waves}`}`);
    // The hooks go up as soon as floor 1 exists, before the cold compile - but a fresh page on CI
    // shares its cores with a sibling worker's software-rasterised frames, and the 25 s default has
    // timed out here on three isolated specs in one run. This is a boot, so it gets the boot's budget.
    await page.waitForFunction(
      () => typeof (window as GameWindow).render_game_to_text === 'function',
      undefined,
      { timeout: WARM_UP },
    );
    // The hook goes up a render before the veil comes down, so a scenario that
    // looked at the screen straight away could catch the tail of the boot wait.
    await page.locator('.loading-veil').waitFor({ state: 'detached', timeout: WARM_UP });
    // Plan 015 Stage C.1: an eager boot never raises the veil at all - it does not go through `veiled`,
    // which is the only thing that ever sets `loading` - so the wait above is a no-op here and this is
    // the one that matters. `building` now covers a boot in progress the same way it covers a restart
    // (see the comment in `boot` on why), and waiting it out here is what keeps this call from handing
    // back a page mid-compile: a `dungeonTest.reset()` issued into that window would find `building`
    // still true and be silently dropped, since only one build may run at a time.
    await page.waitForFunction(
      () => {
        const hook = (window as GameWindow).render_game_to_text;
        return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
      },
      undefined,
      { timeout: WARM_UP },
    );
    // Manual time before anything else: the rAF loop stops on the first call,
    // so every later assertion reads a simulation this test stepped itself.
    await game.step(0);
    // The boot's cold links and warm-up frames are still queued on the GPU when `building` drops.
    await game.settle();
    const first = await game.state();
    expect(
      first.floor.seed,
      hall ? 'the page did not boot into the hall' : 'floor seed did not come from the pinned fixture; the generator entry point changed',
    ).toBe(hall ? HALL_SEED : seeds[0] >>> 0);
    expect(first.hall, `the page ${hall ? 'did not boot into' : 'booted into'} the hall`).toBe(hall);
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
      this.hall ? 'the reset did not rebuild the hall' : 'the reset floor did not come from the pinned fixture',
    ).toBe(this.hall ? HALL_SEED : seeds[0] >>> 0);
  }

  /**
   * A scenario's turn on the worker's page: reset it to this scenario's seeds, and take delivery of
   * whatever the browser complains about while it runs.
   */
  static async adopt(page: Page, info: TestInfo, seeds: number[], pool: Pool) {
    const game = new Game(page, info, seeds);
    pool.sink = game;
    pool.adopted = true;
    // The page is already exactly a fresh boot on the default seeds when the pool has just booted it, or
    // when the last scenario's `prove` reset it to them and held the whole snapshot equal to that boot. A
    // second reset would rebuild the same floor for nothing, so only a page not known to be fresh, or a
    // scenario asking for other seeds, pays for one.
    const known = pool.fresh && seeds.length === DEFAULT_SEEDS.length && seeds.every((seed, i) => seed === DEFAULT_SEEDS[i]);
    pool.fresh = false;
    if (!known) await game.reset(seeds);
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
    // Only now, with the whole snapshot shown equal to a boot, may the next scenario skip its own reset.
    pool.fresh = true;
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

  /**
   * Steps the simulation by `ms` of game time. Drawing is opt-in: it is slow, and a drawn step waits
   * for its own frame to finish on the GPU (see `settle`) so the cost lands here rather than on
   * whichever click comes next.
   */
  async step(ms: number, draw = false) {
    await this.page.evaluate(
      (input: { ms: number; draw: boolean }) => {
        const hook = (window as GameWindow).advanceTime;
        if (!hook) throw new Error('advanceTime is gone');
        hook(input.ms, input.draw);
      },
      { ms, draw },
    );
    if (draw) await this.settle();
  }

  /**
   * Waits until the GPU process has caught up with this page, then for two animation frames.
   *
   * A driver's clock submits work far faster than frames would: one drawn step is ~2 s of SwiftShader
   * time, a rebuild's uploads another one or two, a cold boot's links tens of seconds - and none of it
   * blocks the page, so it queues. The compositor shares that queue, so no animation frame can start
   * until it drains, and every Playwright click waits on two of them for "stable". Undrained, the
   * backlog was billed to the next click, often in the next scenario: on CI that was a Descend or
   * ENTER click timing out at 25 s on a page whose script answered in milliseconds. Draining where
   * the work is submitted keeps every action's budget its own.
   */
  async settle() {
    const drained = this.page.evaluate(
      () =>
        new Promise<number>((done, fail) => {
          const hook = (window as GameWindow).dungeonTest;
          if (!hook?.drainGpu) {
            fail(new Error('dungeonTest.drainGpu is gone'));
            return;
          }
          const waited = hook.drainGpu();
          requestAnimationFrame(() => requestAnimationFrame(() => done(waited)));
        }),
    );
    // Lost the race below, it may still reject when the scenario tears the page down.
    drained.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(
        () => fail(new GameError(`the GPU had not caught up with the page after ${WARM_UP / 1000}s`)),
        WARM_UP,
      );
    });
    try {
      await Promise.race([drained, late]);
    } finally {
      clearTimeout(timer);
    }
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

  /** Plan 019: the meta as the save holds it, read through the game's own hook. Plan 020: of the active slot, or of `slot`. */
  meta(slot?: Slot): Promise<Meta> {
    return this.page.evaluate((forSlot) => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      return hook.meta(forSlot);
    }, slot);
  }

  /** Plan 019: fixture setup. Writes the save the way a purchase would; the next run start reads it. Plan 020: into the active slot, or into `slot`, which stages another one without choosing it. */
  async setMeta(meta: Meta, slot?: Slot) {
    await this.page.evaluate(({ value, forSlot }: { value: Meta; forSlot?: Slot }) => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.setMeta(value, forSlot);
    }, { value: meta, forSlot: slot });
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
    await this.settle();
  }

  /**
   * A single real draw's raw RGBA pixels - the cutaway left exactly as it is, no A/B toggle. For
   * comparing the *same* rendered instant across two calls (a pause, a zero-time redraw), where
   * `cutawayFrames`'s off/on pair would answer a different question.
   */
  async framePixels(): Promise<Uint8ClampedArray> {
    const pixels = await this.page.evaluate(() => {
      const advance = (window as GameWindow).advanceTime;
      if (!advance) throw new Error('advanceTime is gone');
      advance(0, true);
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(gl, 0, 0);
      const pack = (bytes: Uint8ClampedArray) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]); return btoa(bin); };
      return pack(ctx.getImageData(0, 0, copy.width, copy.height).data);
    });
    return unpackPixels(pixels);
  }

  /**
   * Draws a frame, pauses, steps simulation time forward with drawing off, then draws again - all in
   * one evaluated task. A pause and its subsequent draw were originally driven as separate
   * `page.evaluate` round trips (dispatch the action, then read pixels), which occasionally read a
   * transient frame from the real browser's own paint/compositor scheduling in the gap between them -
   * a test-harness race, not a simulation bug, but one only a single synchronous task can rule out for
   * certain. `dungeon-action` is the exact event the pause button and `Game.act` both dispatch.
   */
  async pauseFreezeCheck(pausedMs: number): Promise<{ before: Uint8ClampedArray; after: Uint8ClampedArray }> {
    const result = await this.page.evaluate((ms: number) => {
      const advance = (window as GameWindow).advanceTime;
      if (!advance) throw new Error('advanceTime is gone');
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      const pack = (bytes: Uint8ClampedArray) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]); return btoa(bin); };
      const frame = () => { ctx.clearRect(0, 0, copy.width, copy.height); ctx.drawImage(gl, 0, 0); return pack(ctx.getImageData(0, 0, copy.width, copy.height).data); };
      advance(0, true);
      const before = frame();
      window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'pause' }));
      advance(ms, false);
      advance(0, true);
      const after = frame();
      window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'pause' }));
      return { before, after };
    }, pausedMs);
    return { before: unpackPixels(result.before), after: unpackPixels(result.after) };
  }

  /** Plan 007, development-only: the controller's own target/material state, for test setup and
   * assertions that must not substitute for the pixel evidence `cutawayFrames` below supplies. */
  async cutawayDiagnostics(): Promise<CutawayDiagnostics> {
    return this.page.evaluate(() => {
      const hook = (window as GameWindow).dungeonTest?.cutawayDiagnostics;
      if (!hook) throw new Error('dungeonTest.cutawayDiagnostics is gone');
      return hook();
    });
  }

  /**
   * Draws the identical instant twice, once with the cutaway disabled and once enabled, and returns
   * both frames' raw RGBA pixels plus the canvas size. Both draws happen inside one evaluated task,
   * exactly like `art-direction.spec.ts`'s `tellAgainstStone`: the renderer has no
   * `preserveDrawingBuffer`, so a `drawImage` has to happen in the same task as the draw that produced
   * the framebuffer it copies. Toggling `uCutawayEnabled` never advances the simulation or touches a
   * single target's own fade/position state, so the two frames differ only in whether the shader discards.
   */
  async cutawayFrames(): Promise<{ width: number; height: number; off: Uint8ClampedArray; on: Uint8ClampedArray }> {
    const result = await this.page.evaluate(() => {
      const win = window as GameWindow;
      const setEnabled = win.dungeonTest?.setCutawayEnabled;
      const advance = win.advanceTime;
      if (!setEnabled || !advance) throw new Error('dungeonTest.setCutawayEnabled or advanceTime is gone');
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      const pack = (bytes: Uint8ClampedArray) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]); return btoa(bin); };
      const frame = () => { ctx.clearRect(0, 0, copy.width, copy.height); ctx.drawImage(gl, 0, 0); return pack(ctx.getImageData(0, 0, copy.width, copy.height).data); };
      setEnabled(false); advance(0, true); const off = frame();
      setEnabled(true); advance(0, true); const on = frame();
      setEnabled(true); // restored: the dev fixture defaults enabled
      return { width: copy.width, height: copy.height, off, on };
    });
    return { width: result.width, height: result.height, off: unpackPixels(result.off), on: unpackPixels(result.on) };
  }

  /** Plan 009, development-only: what each figure costs to draw, off the live meshes. */
  async actorStats(): Promise<ActorStats> {
    return this.page.evaluate(() => {
      const hook = (window as GameWindow).dungeonTest?.actorStats;
      if (!hook) throw new Error('dungeonTest.actorStats is gone');
      return hook();
    });
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

  /**
   * Clicks the real entry button, chooses a slot on the picker it opens (plan 020; slot 1 unless told otherwise, which
   * is why the 138 callers did not change) and waits for the intro card to go away.
   */
  async enter(slot: Slot = 1) {
    // A freshly booted page may still be inside its one synchronous warm-up compile, and a click cannot land
    // until the main thread comes back - on SwiftShader that outlasts the default action timeout.
    await enterKeep(this.page, slot);
    // A page whose floor 1 is built but still warming answers the press behind the veil.
    await expect(this.page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
    // Lifting the menu repaints most of the screen, and on a software rasteriser that repaint is
    // the GPU process's to finish before the scenario's first click can see a frame.
    await this.settle();
  }

  /**
   * Plan 020: rebuilds the page as the Tide Altar's hall by hook, synchronously, the way `buildFloor` builds a deeper floor. For a scenario that needs the
   * armoury (it only stands there) but is about something else: the run in hand, its arm and its clocks, carry over. The pooled reset returns the page to floor
   * one, and `hall.spec.ts` is what walks in through the real flow.
   */
  async buildHall() {
    await this.page.evaluate(() => {
      const hook = (window as GameWindow).dungeonTest;
      if (!hook) throw new Error('dungeonTest is gone');
      hook.buildHall();
    });
    await this.step(0);
  }

  /**
   * Plan 020: from the hall, stands the knight at the way down (a teleport, as a door was teleported to before) and takes it with the real swap key, then
   * waits out the veiled build of floor one. The prompt is asserted on the way, so a way down that did not offer itself fails here by name.
   */
  async takeWayDown() {
    const hall = await this.state();
    expect(hall.hall, 'takeWayDown starts in the hall').toBe(true);
    const down = hall.hallProps!.wayDown!;
    await this.teleport(down.x, down.z);
    await this.step(200);
    await expect(this.page.locator('.swap-prompt'), 'the way down does not offer itself').toContainText('take the way down');
    await press(this.page, 'swap');
    await this.built();
    await this.step(16);
    expect((await this.state()).hall, 'the way down led back to the hall').toBe(false);
  }

  /** Plan 020: from the hall, stands the knight at the altar (a teleport) and opens its shop with the real swap key. */
  async openAltar() {
    const altar = (await this.state()).hallProps!.altar!;
    await this.teleport(altar.x, altar.z);
    await this.step(64);
    await press(this.page, 'swap');
    await this.step(16);
    expect((await this.state()).altarOpen, 'the swap key at the altar did not open the shop').toBe(true);
  }

  /**
   * Waits out a floor build deferred behind the loading veil. The veil is raised
   * in the same breath as the action that asks for the build, so `building` is
   * already true by the time a click resolves; what this waits for is the frames
   * the veil needs to paint and the build that happens between them.
   */
  async built() {
    // Under a driver's clock the build yields between stages but waits on no frames, so it is over in
    // a few tasks plus the build itself; the default poll (100, 250, 500, then every second) would
    // then charge most of a second of pure waiting to each of the two resets a pooled scenario makes.
    await expect
      .poll(() => this.state().then((state) => state.building), {
        message: 'the floor build behind the loading veil never finished',
        intervals: [50, 100, 100, 250, 250, 500],
        timeout: WARM_UP,
      })
      .toBe(false);
    // `building` drops when the page is done, not when the GPU is: the new floor's uploads are queued.
    await this.settle();
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
  /** The page is known to be a fresh boot on DEFAULT_SEEDS: just booted, or reset and proven so. */
  fresh = false;
  /** Whether the scenario now holding the page drove it through a `Game`, which proves it at the end. */
  adopted = false;
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
    this.fresh = true;
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
  hall: boolean;
  boss: string | null;
  waves: string | null;
  hasTouch: boolean;
  isMobile: boolean;
  storageState: unknown;
  viewport: { width: number; height: number } | null;
}) =>
  ISOLATED ||
  options.isolate ||
  options.hall ||
  options.boss !== DEFAULT_BOSS ||
  options.waves !== DEFAULT_WAVES ||
  options.hasTouch ||
  options.isMobile ||
  options.storageState !== undefined ||
  options.viewport?.width !== 1000 ||
  options.viewport?.height !== 700;

export const test = base.extend<
  { seeds: number[]; isolate: boolean; hall: boolean; boss: string | null; waves: string | null; game: Game },
  { pool: Pool }
>({
  seeds: [DEFAULT_SEEDS, { option: true }],
  /**
   * Opts a scenario out of the pool. The few that need it say why at their own `test.use`: they assert on
   * what a boot does, or break the page on purpose, so a page that is already booted will not do.
   */
  isolate: [false, { option: true }],
  /**
   * Plan 020 (D11): boots the page into the Tide Altar's hall, as a player's is, instead of past it (`?hall=skip`, which every other scenario gets). Such a
   * scenario has its own page, since the pooled one was booted past the hall and a reset returns it there. The hall, slot, loading and death scenarios are the
   * only coverage of the product's default flow, so they stay on the PR gate.
   */
  hall: [false, { option: true }],
  /** Plan 021 (D14): the `?boss=` link the page boots with; `null` boots with none, and such a scenario has its own page. */
  boss: [DEFAULT_BOSS as string | null, { option: true }],
  /** Plan 022 (D14): the `?waves=` link the page boots with; `null` boots with the later waves dealt, and such a scenario has its own page. */
  waves: [DEFAULT_WAVES as string | null, { option: true }],
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
    { browser, pool, isolate, hall, boss, waves, hasTouch, isMobile, storageState, viewport },
    runTest,
    info,
  ) => {
    if (
      !needsOwnPage({ isolate, hall, boss, waves, hasTouch, isMobile, storageState, viewport })
    ) {
      const pooled = await pool.take(info);
      pool.adopted = false;
      await runTest(pooled);
      // A scenario that drove the pooled page without a `Game` never proved it clean, so the next one must
      // not trust it to be a fresh boot.
      if (!pool.adopted) pool.fresh = false;
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
    { page, pool, seeds, isolate, hall, boss, waves, hasTouch, isMobile, storageState, viewport },
    runTest,
    info,
  ) => {
    const own = needsOwnPage({
      isolate,
      hall,
      boss,
      waves,
      hasTouch,
      isMobile,
      storageState,
      viewport,
    });
    const game = own
      ? await Game.open(page, info, seeds, true, hall, boss, waves)
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

/**
 * Somewhere for the knight to stand with a body one step and a bit behind him: close enough for its own
 * melee, on a clear line. Where the knight faces does not matter, nothing here strikes.
 */
export const blowStance = (floor: Floor, near: Point) => {
  const tiles = floor.tiles
    .map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE }))
    .filter((spot) => Math.hypot(spot.x - near.x, spot.z - near.z) < 16)
    .sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
  for (const player of tiles) {
    if (!canStand(floor.cells, player.x, player.z)) continue;
    for (const name of Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]) {
      const facing = SCREEN_DIRECTIONS[name];
      const behind = { x: player.x - facing.x * 1.2, z: player.z - facing.z * 1.2 };
      if (canStand(floor.cells, behind.x, behind.z) && hasClearPath(floor.cells, behind, player)) return { player, behind };
    }
  }
  throw new Error(`no stance for a blow near (${near.x.toFixed(2)}, ${near.z.toFixed(2)})`);
};

/**
 * Sets a swinging body to land a blow on the knight within a few frames, with the knight on `health`.
 * The body is the first on the floor that swings, awake or not (staging a windup wakes it). Returns its
 * kind, so a test can say what the run ought to be blamed on.
 */
export const stageBlow = async (game: Game, health: number) => {
  const floor = await game.floor();
  const opening = await game.state();
  const attacker = opening.enemies.find((enemy) => BESTIARY[enemy.kind].attack === 'swing');
  expect(attacker, 'this floor has no body that swings').toBeDefined();
  const stance = blowStance(floor, { x: attacker!.x, z: attacker!.z });
  await game.teleport(stance.player.x, stance.player.z);
  await game.step(120);
  await game.configureCombat({
    health,
    enemies: [
      {
        index: opening.enemies.indexOf(attacker!),
        x: stance.behind.x,
        z: stance.behind.z,
        windup: 0.0675,
        cooldown: 0,
        aim: { x: stance.player.x - stance.behind.x, z: stance.player.z - stance.behind.z },
      },
    ],
  });
  return { kind: attacker!.kind, stance };
};

/**
 * Plan 020: walks the knight with real arrow keys, a step of game time at a time, until `arrived` says he has. Each step holds the one key that
 * pushes closest toward `target` (the screen basis is not the floor's), so the walk bends round a prop the way a hand would. The keys are let go at
 * the end. It reports whether he arrived, and the caller asserts it, so a walk that never got there fails on the caller's own message.
 */
export const walkUntil = async (game: Game, page: Page, target: Point, arrived: (state: Snapshot) => boolean, steps = 160) => {
  let held: string | null = null, done = false;
  try {
    for (let i = 0; i < steps && !done; i++) {
      const state = await game.state();
      if (arrived(state)) { done = true; break; }
      const { key } = keyToward({ x: target.x - state.player.x, z: target.z - state.player.z });
      if (key !== held) {
        if (held) await page.keyboard.up(held);
        await page.keyboard.down(key);
        held = key;
      }
      await game.step(32);
    }
  } finally {
    if (held) await page.keyboard.up(held);
  }
  await game.step(16);
  return done || arrived(await game.state());
};

/**
 * Plan 020: records whether the loading veil appeared, and what it said, from now until read. A veil is up for a handful of frames and a second
 * round-trip to ask about it is a race a busy runner loses, so the page watches for it and the test asks afterwards.
 */
export const watchVeil = (page: Page) => page.evaluate(() => {
  const watched = window as unknown as { veilSeen?: string | null; veilObserver?: MutationObserver };
  watched.veilObserver?.disconnect();
  watched.veilSeen = null;
  watched.veilObserver = new MutationObserver(() => {
    const veil = document.querySelector('.loading-veil');
    if (veil && !watched.veilSeen) watched.veilSeen = veil.textContent;
  });
  watched.veilObserver.observe(document.body, { childList: true, subtree: true });
});
export const veilSeen = (page: Page) => page.evaluate(() => {
  const watched = window as unknown as { veilSeen?: string | null; veilObserver?: MutationObserver };
  watched.veilObserver?.disconnect();
  return watched.veilSeen ?? null;
});

/** How many floor seeds the page has drawn from the pinned handle (`pinSeeds`): a build that took none left it where it was. */
export const pinnedDraws = (page: Page) => page.evaluate(() => (window as unknown as { __pinnedSeeds: { index: number } }).__pinnedSeeds.index);

/**
 * Plan 021: waits out every phase change a boss is in or about to enter, with the clock stepped by hand. A boss left under a threshold (a fixture's `hp: 1`) changes
 * phase, one at a time, before it can be struck, and a blow in that window lands nothing: so a scenario that stages a boss one blow from death settles it first, and swings
 * after. Returns the boss as it stands once it has held still and hittable for two reads in a row, or throws - a boss that never settles is a finding, not a timeout.
 */
export const settleBoss = async (game: Game) => {
  let calm = 0;
  for (let waited = 0; waited < 8000; waited += 50) {
    await game.step(50);
    const boss = (await game.state()).boss;
    if (!boss) throw new GameError('there is no boss to settle');
    calm = boss.unhittable ? 0 : calm + 1;
    if (calm >= 2) return boss;
  }
  throw new GameError('the boss was still changing phase after eight seconds');
};

// Plan 022: striking a staged pack with real input, shared by the wave scenarios (waves.spec.ts, frame-budget.spec.ts).
const STANCE_DIRECTIONS = Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[];
const tilesWithin = (floor: Floor, near: Point, radius: number) =>
  floor.tiles.map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE })).filter((spot) => Math.hypot(spot.x - near.x, spot.z - near.z) < radius).sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));

/** One real swing, aimed with a real arrow key. */
export const swing = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await hold(page, 'attack');
  await page.keyboard.up(key);
  await release(page, 'attack');
};

/** Somewhere within `within` of `near` to stand with `count` bodies abreast inside the arc, 0.7 apart (a stalker's body is wider than that, so they are staged mid-windup, which crowd separation leaves alone), each slot checked against the production contact rule. */
export const stanceNear = (floor: Floor, near: Point, within: number, count: number) => {
  for (const player of tilesWithin(floor, near, within)) {
    if (!canStand(floor.cells, player.x, player.z)) continue;
    for (const name of STANCE_DIRECTIONS) {
      const facing = SCREEN_DIRECTIONS[name], across = { x: -facing.z, z: facing.x }, slots: Point[] = [];
      for (let i = 0; i < count; i++) {
        const lateral = (i - (count - 1) / 2) * 0.7, spot = { x: player.x + facing.x * 1.05 + across.x * lateral, z: player.z + facing.z * 1.05 + across.z * lateral };
        if (!canStand(floor.cells, spot.x, spot.z) || !swordContacts(floor.cells, player, facing, spot, 0)) break;
        slots.push(spot);
      }
      if (slots.length === count) return { ...player, facing, slots, key: ARROW_KEYS[name] };
    }
  }
  throw new Error(`no stance within ${within} of (${near.x.toFixed(2)}, ${near.z.toFixed(2)}) fits ${count} bodies in the arc`);
};

/** Steps the clock by hand until `done` reads true of the snapshot, or throws naming what never happened. */
export const until = async (game: Game, what: string, done: (s: Snapshot) => boolean, maxMs = 3000, stepMs = 50) => {
  let state = await game.state();
  for (let t = 0; t < maxMs && !done(state); t += stepMs) { await game.step(stepMs); state = await game.state(); }
  expect(done(state), `${what} did not happen within ${maxMs} ms`).toBe(true);
  return state;
};

