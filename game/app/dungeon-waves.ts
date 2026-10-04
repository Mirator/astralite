import { BESTIARY, ELITE_MODIFIERS, elitesFor, reserveSize, type EliteModifier, type EnemyKind } from './dungeon-bestiary.ts';
import { ARRIVAL_CLEAR, carves, drawKind, oneCaller, PACK_MIX, packSource, TILE, type Floor, type PackMix, type PackSource, type Spawn } from './dungeon-floor.ts';

// Waves (plan 022): a chamber that fights in waves is dealt its first wave by `generateFloor` exactly as it always was (the pack it has always held),
// and its later waves by `dealWaves` here, which `generateFloor` never calls. A later wave stands in the chamber from the first frame, dormant and
// unseen like an ambush body, and is called when every body before it is down: `waveDue` (below) is the one rule, and the game and the balance sim
// both ask it, because a wave rule copied into the world closure and into the sim is a rule that drifts.
//
// HOW TO CHANGE THE WAVES. Every number is in this file; no other file knows how many waves a chamber has.
//   - `WAVE_TABLE` says, per kind of pack (`PackSource`, the rule `roster` deals by), which waves follow the first: each rule is how many bodies it draws
//     (`count`, inclusive) and which mix they are drawn from (`PACK_MIX`, one roll per body, as the generator rolls), and `warden` pins a warden to the
//     end of that wave. The rules are listed in order: the first is wave 2, the next wave 3. A source with no entry is dealt one wave. Add a source
//     here and nothing else has to know; add a third rule and `Spawn.wave` reaches 4 and the rest follows.
//   - `LAST_WAVE_EXTRA` is how many bodies a deeper floor adds to a chamber's last wave (floor two and three).
//   - `WAVE_CAP` (bodies in one dealt wave) and `CHAMBER_CAP` (every standing body of a chamber, wave one included) bound what the table may ask for; they exist
//     for the frame budget (`tests/browser/frame-budget.spec.ts`, the `wave-chamber` scene is held to them) and for how much of a chamber is readable.
//   - `WAVE_PAUSE` is the breath after the last body of a wave falls, `WAVE_MARK` how long the rings show on the floor before the bodies stand.
//   - A chamber with `layer <= FIRST_WAVE_LAYERS` is never dealt later waves: the first fight past the gate is the tutorial beat (plan 023 D4; it was the first two).
// ELITES (plan 022 Stage C) are dealt here too, by `dealElites`, after the waves, from a second stream of their own (`eliteStream`): `ELITE_RATE` is the share of a floor's eligible bodies (`eliteKind`, dungeon-bestiary.ts) that carry a modifier,
// `ELITE_PER_WAVE` the most one wave of one chamber may hold, and floor one deals none. What a modifier does is the bestiary's `ELITES`; this file only says who gets one. A chamber's rolls are per body in spawn order and always draw the same two numbers
// whether or not the body is eligible, so a rate change moves who is elite and never which kind a body is, and no wave rule moves an elite's draw.
// After a change: `npm test` (tests/dungeon-waves.test.ts holds every cap and the append-only rule), `npm run balance:check` and re-measure the bands.
// The hash stream is per chamber (`stream`), so adding a rule to one source moves no other source's bodies.

/** Seconds between the last body of a wave falling and its successor's rings appearing. */
export const WAVE_PAUSE = 0.5;
/** Seconds the rings show on the floor before the bodies stand. */
export const WAVE_MARK = 0.9;
/** A ring is never put within this of the knight (world units): a body is never raised on him. */
export const WAVE_CLEAR = 2.5;
/** The most bodies one dealt wave may hold, and the most standing bodies one chamber may hold in all its waves. */
export const WAVE_CAP = 5;
export const CHAMBER_CAP = 10;
/** Chambers this deep or shallower fight in one wave. Plan 023 (D4): the first fight past the gate only (the tutorial beat); it was the first two through plan 022, and 54% of watch chambers sit in layers one and two, so the median fight could not move while they stayed single-wave. */
export const FIRST_WAVE_LAYERS = 1;
/** Bodies added to a chamber's last wave on floor two and floor three. */
export const LAST_WAVE_EXTRA = 1;
/** Tiles between two bodies the dealer stands in one chamber, as the generator keeps its own pack. */
const WAVE_SPACING = 2.2;
/** World units two relocated spots keep apart (a tile and a bit): bodies are never raised on one another. */
const SPOT_APART = 1.5;
/** Tiles a pinned warden keeps from the bodies already standing when its chamber has no tile left at `WAVE_SPACING`: one body's width. */
const PINNED_SPACING = 1.2;
/** Placement attempts per body, as the generator's own. */
const TRIES = 40;

export type WaveRule = { count: readonly [number, number]; mix: PackMix; warden?: boolean };
export type WaveTable = Partial<Record<PackSource, readonly WaveRule[]>>;

/**
 * Plan 022 D2 (hypotheses until Stage E has tuned them). Wave one is today's pack and is not in this table. A middle fight gets a second wave from the
 * `late` mix; a late fight a second from `late` and a third of one or two with a warden; a purse chamber (`hoard`) a second wave from the hoard's own mix.
 */
export const WAVE_TABLE: WaveTable = {
  middle: [{ count: [2, 3], mix: PACK_MIX.late }],
  late: [{ count: [2, 3], mix: PACK_MIX.late }, { count: [1, 2], mix: PACK_MIX.late, warden: true }],
  hoard: [{ count: [2, 3], mix: PACK_MIX.hoard }],
};

/**
 * The bodies of one wave once the caps are applied: at most `space` of them, and when the rule pins a warden to the wave it is the drawn bodies that go, never the warden. The warden
 * is listed first, so it is also the first to be stood in a chamber that has no room left for the rest.
 */
export const fitWave = (drawn: readonly EnemyKind[], warden: boolean, space: number): EnemyKind[] => {
  if (space <= 0) return [];
  return [...(warden ? ['warden' as const] : []), ...drawn.slice(0, Math.max(0, space - (warden ? 1 : 0)))];
};

/** A pure hash of the floor's seed, the level and a chamber, with its own mixing: a stream no other part of the keep draws from. */
const stream = (seed: number, level: number, room: number) => {
  let h = (Math.imul(seed >>> 0 ^ 0x77617665, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b) ^ Math.imul(room + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b) >>> 0; h = Math.imul(h ^ h >>> 13, 0xc2b2ae35) >>> 0; h = (h ^ h >>> 16) >>> 0;
  let state = h;
  return () => { state = state + 0x6d2b79f5 >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};

/** Plan 022 D7: the share of a floor's eligible bodies that are elite, by floor (floor one deals none), and the most one wave of one chamber holds. */
export const ELITE_RATE: Readonly<Record<number, number>> = { 1: 0, 2: 0.15, 3: 0.25 };
export const ELITE_PER_WAVE: Readonly<Record<number, number>> = { 1: 0, 2: 1, 3: 2 };

/** The elite stream of a chamber: the wave stream's own mixing with another salt, so no wave rule and no table row moves who is elite. */
const eliteStream = (seed: number, level: number, room: number) => {
  let h = (Math.imul(seed >>> 0 ^ 0x656c6974, 0x9e3779b1) ^ Math.imul(level + 1, 0x27d4eb2f) ^ Math.imul(room + 1, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b) >>> 0; h = Math.imul(h ^ h >>> 13, 0xc2b2ae35) >>> 0; h = (h ^ h >>> 16) >>> 0;
  let state = h;
  return () => { state = state + 0x6d2b79f5 >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};

/**
 * The spawns with elites dealt (plan 022 D7): every standing body (never a buried reserve) of an eligible kind rolls its floor's `ELITE_RATE`, in spawn order within its chamber, and a roll that wins carries a modifier drawn from
 * `elitesFor(kind)` unless its wave already holds `ELITE_PER_WAVE`. Pure, a copy: the input is untouched, and a spawn that is not elite comes back as the very same object. `rate` and `perWave` are parameters so a test can deal a floor the game does not.
 */
export const dealElites = (spawns: readonly Spawn[], seed: number, level: number, rate = ELITE_RATE[level] ?? 0, perWave = ELITE_PER_WAVE[level] ?? 0): Spawn[] => {
  const out = [...spawns], streams = new Map<number, () => number>(), held = new Map<string, number>();
  spawns.forEach((spawn, i) => {
    if (spawn.buried || !(rate > 0)) return;
    if (!streams.has(spawn.room)) streams.set(spawn.room, eliteStream(seed, level, spawn.room));
    const random = streams.get(spawn.room)!, roll = random(), pick = random(), allowed = elitesFor(spawn.kind), wave = `${spawn.room}:${spawn.wave ?? 1}`;
    if (!allowed.length || roll >= rate || (held.get(wave) ?? 0) >= perWave) return;
    held.set(wave, (held.get(wave) ?? 0) + 1);
    out[i] = { ...spawn, elite: allowed[Math.min(allowed.length - 1, Math.floor(pick * allowed.length))] };
  });
  return out;
};

/** Plan 022 D14 (`?elite=<modifier>`, development only): every standing body that can carry `modifier` carries it, whatever the floor's rate. An arena roster is dealt through this; a campaign floor never is. */
export const allElite = (spawns: readonly Spawn[], modifier: EliteModifier): Spawn[] =>
  spawns.map(spawn => !spawn.buried && elitesFor(spawn.kind).includes(modifier) ? { ...spawn, elite: modifier } : spawn);

/** `?elite=` read: one of the four modifiers by name, or nothing. */
export const parseElite = (text: string | null): EliteModifier | null => (ELITE_MODIFIERS as readonly string[]).includes(text ?? '') ? text as EliteModifier : null;

/** The tiles of a chamber's own floor: not a prop's hole, not the alcove a door is cut into (the same rule `gateRacks` reads). */
export const roomTiles = (floor: Pick<Floor, 'rooms' | 'tiles'>, id: number) => {
  const room = floor.rooms[id];
  return floor.tiles.filter(t => t.room === id && Math.abs(t.x - room.x) <= room.halfX && Math.abs(t.z - room.z) <= room.halfZ && carves(room, t.x - room.x, t.z - room.z));
};

/**
 * The floor's spawns with every chamber's later waves appended after **all** of them (the buried reserves `generateFloor` laid included), so no existing
 * spawn moves and no `summoner` index changes. A wave body is `ambush` (dormant and unseen until called) with `wave` 2 or more; a bonecaller dealt into
 * a wave buries its reserve after the wave bodies, wearing its caller's wave. `table` is a parameter so a test can deal a table the game does not.
 */
export const dealWaves = (floor: Pick<Floor, 'rooms' | 'tiles' | 'doors' | 'spawns' | 'goal' | 'weaponDrop'>, seed: number, level: number, table: WaveTable = WAVE_TABLE): Spawn[] => {
  const spawns: Spawn[] = [...floor.spawns], dealt: Spawn[] = [], goalLayer = floor.rooms[floor.goal].layer;
  for (const room of floor.rooms) {
    if (room.role !== 'path' || room.layer <= FIRST_WAVE_LAYERS) continue;
    // The former arm chamber was dealt as a non-hoard (`roster`); its source is read the same way.
    const rules = table[packSource(room.id === floor.weaponDrop.room ? { ...room, reward: null } : room, level, goalLayer)];
    if (!rules?.length) continue;
    const random = stream(seed, level, room.id), int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
    const entry = room.entry, doors = floor.doors.filter(d => d.from === room.id);
    const open = roomTiles(floor, room.id).filter(t => Math.hypot(t.x - entry.x, t.z - entry.z) >= ARRIVAL_CLEAR && doors.every(d => Math.hypot(d.x - t.x, d.z - t.z) >= 2.5));
    const here = floor.spawns.filter(s => s.room === room.id && !s.buried);
    let standing = here.length;
    // A wave whose bodies could not be placed (a crowded chamber) is not dealt, and the waves after it close up: a chamber's waves are always 2, then 3.
    let called = 0;
    rules.forEach((rule, i) => {
      const last = i === rules.length - 1, space = Math.min(WAVE_CAP, CHAMBER_CAP - standing);
      if (space <= 0) return;
      const wanted = int(rule.count[0], rule.count[1]) + (last && level >= 2 ? LAST_WAVE_EXTRA : 0);
      const pack = oneCaller(Array.from({ length: wanted }, () => drawKind(rule.mix, level, random())));
      const kinds = fitWave(pack, !!rule.warden, space);
      let placed = 0;
      for (const kind of kinds) {
        const neighbours = () => [...here, ...dealt].filter(other => other.room === room.id);
        let at: { x: number; z: number } | undefined;
        for (let tries = 0; tries < TRIES && !at; tries++) {
          const t = open[int(0, open.length - 1)];
          if (!neighbours().some(other => Math.hypot(other.x - t.x, other.z - t.z) < WAVE_SPACING)) at = t;
        }
        // A pinned warden is never lost to a crowded chamber: failing the spacing, it takes the open tile farthest from everything standing, so long as it is not on top of it.
        if (!at && rule.warden && kind === 'warden') {
          const gap = (t: { x: number; z: number }) => Math.min(...neighbours().map(other => Math.hypot(other.x - t.x, other.z - t.z)), Infinity);
          const best = [...open].sort((a, b) => gap(b) - gap(a))[0];
          if (best && gap(best) >= PINNED_SPACING) at = best;
        }
        if (at) { dealt.push({ x: at.x, z: at.z, kind, room: room.id, ambush: true, wave: called + 2 }); standing++; placed++; }
      }
      if (placed) called++;
    });
  }
  const first = spawns.length;
  spawns.push(...dealt);
  // A caller dealt into a wave buries its reserve after every wave body, as `buryReserves` does for the first wave, and the reserve is called with it.
  dealt.forEach((caller, n) => {
    const summons = BESTIARY[caller.kind].summons;
    if (summons) for (let k = 0; k < reserveSize(caller.kind); k++) spawns.push({ x: caller.x, z: caller.z, kind: summons.kind, room: caller.room, ambush: false, buried: true, summoner: first + n, wave: caller.wave });
  });
  return spawns;
};

/** The floor with its later waves and its elites dealt: `generateFloor`'s own output, with `spawns` replaced and nothing else touched. */
export const wavedFloor = <F extends Pick<Floor, 'rooms' | 'tiles' | 'doors' | 'spawns' | 'goal' | 'weaponDrop'>>(floor: F, seed: number, level: number, table: WaveTable = WAVE_TABLE): F => ({ ...floor, spawns: dealElites(dealWaves(floor, seed, level, table), seed, level) });

/** How far a felled wave's corpses sink (world units) in the `WAVE_MARK` that the next wave's rings show: under the paving, out of sight. */
export const CORPSE_DEPTH = 1.4;
/**
 * The corpses the floor takes back when a chamber marks its next wave: every fallen body of that chamber from an earlier wave. A chamber's corpses stay drawn for the life of the floor
 * otherwise, and a corpse costs a standing body's draw calls (about 35 a body), which is what the ten-body chamber cap would spend (plan 022 Stage B: 586 calls against the 508 ceiling).
 * Draw only: no rule of the fight reads it, and the balance sim never asks.
 */
export const corpsesDue = <B extends { room: number; wave?: number; dead: boolean }>(bodies: readonly B[], room: number, wave: number): B[] => bodies.filter(b => b.room === room && b.dead && (b.wave ?? 1) < wave);
/** How deep a corpse has sunk `age` seconds after its wave's rings appeared (eased in), and whether it is gone (no longer drawn) - once the rings have shown for `WAVE_MARK`. */
export const corpseSink = (age: number): { depth: number; gone: boolean } => {
  const t = Math.min(1, Math.max(0, age / WAVE_MARK));
  return { depth: CORPSE_DEPTH * t * t, gone: t >= 1 };
};

/** What `waveDue` reads of a body: where it is, which wave it belongs to (absent is the first), and whether it is down, buried or standing. */
export type WaveBody = { room: number; wave?: number; dead: boolean; buried: boolean; awake: boolean };
/** The wave clock of the chamber the knight is in: the seconds every earlier wave has been down, and the seconds the rings have shown (null: not yet showing). */
export type WaveClock = { room: number; quiet: number; marked: number | null };
export const idleClock = (room = -1): WaveClock => ({ room, quiet: 0, marked: null });
/**
 * What the wave rule says this frame: the clock to keep, the wave whose rings should appear now (`mark`, on the one frame the pause runs out), the wave whose
 * bodies should stand now (`raise`, on the one frame the rings have shown for `WAVE_MARK`), and the wave being waited for (`pending`, null once none is left).
 */
export type WaveStep = { clock: WaveClock; mark: number | null; raise: number | null; pending: number | null };

/**
 * The one rule (D3): the next wave of a chamber is called when **every** body of every earlier wave is down - dead, not buried and not dormant: a reserve
 * that waits under a standing caller is not down - then, after `WAVE_PAUSE`, its rings show, and when they have shown for `WAVE_MARK` it stands. Never
 * by time alone, and never on the first death. `bodies` is every body of the floor; only the chamber `room` is read.
 */
export const waveDue = (bodies: readonly WaveBody[], room: number, clock: WaveClock, dt: number): WaveStep => {
  const here = bodies.filter(b => b.room === room), waveOf = (b: WaveBody) => b.wave ?? 1;
  const dormant = here.filter(b => waveOf(b) > 1 && !b.awake && !b.dead && !b.buried).map(waveOf);
  if (!dormant.length) return { clock: idleClock(room), mark: null, raise: null, pending: null };
  const pending = Math.min(...dormant);
  const held = clock.room === room ? clock : idleClock(room);
  if (here.some(b => waveOf(b) < pending && !b.dead)) return { clock: idleClock(room), mark: null, raise: null, pending };
  if (held.marked === null) {
    const quiet = held.quiet + dt;
    return quiet >= WAVE_PAUSE ? { clock: { room, quiet, marked: 0 }, mark: pending, raise: null, pending } : { clock: { room, quiet, marked: null }, mark: null, raise: null, pending };
  }
  const marked = held.marked + dt;
  return marked >= WAVE_MARK ? { clock: idleClock(room), mark: null, raise: pending, pending } : { clock: { ...held, marked }, mark: null, raise: null, pending };
};

/**
 * The bodies the knight's walking into a chamber springs: dormant, standing, not buried and never a later wave - those are called by `waveDue` alone, or
 * a chamber's second wave would stand up on the knight's first step. The game's ambush spring and the balance sim's both read this one filter.
 */
export const springing = <B extends WaveBody>(bodies: readonly B[], room: number): B[] => bodies.filter(b => b.room === room && !b.awake && !b.dead && !b.buried && (b.wave ?? 1) <= 1);
/** Whether a body is there to be walked at or fought: standing, or dormant in the first wave (an ambush). A later wave not yet called is not. */
export const calledIn = (b: WaveBody) => b.awake || (b.wave ?? 1) <= 1;

type Point = { x: number; z: number };
/**
 * Where each body of a wave stands, in world units (D4): a spot within `clear` of the knight when the rings appear moves to the nearest of the chamber's open tiles
 * (`open`, world units) beyond it that no other spot holds, the `raiseSpot` rule; a spot already clear stays where it was dealt. A chamber with no such tile leaves the
 * spot on the open tile farthest from the knight. Results are in the order of `spots`.
 */
export const waveSpots = (open: readonly Point[], spots: readonly Point[], knight: Point, clear = WAVE_CLEAR): Point[] => {
  const far = (p: Point) => Math.hypot(p.x - knight.x, p.z - knight.z) >= clear;
  const placed: (Point | null)[] = spots.map(spot => far(spot) ? { x: spot.x, z: spot.z } : null);
  const taken = (p: Point) => placed.some(other => other && Math.hypot(other.x - p.x, other.z - p.z) < SPOT_APART);
  return placed.map((spot, i) => {
    if (spot) return spot;
    const candidates = open.filter(p => far(p) && !taken(p)).sort((a, b) => Math.hypot(a.x - spots[i].x, a.z - spots[i].z) - Math.hypot(b.x - spots[i].x, b.z - spots[i].z));
    const at = candidates[0] ?? [...open].sort((a, b) => Math.hypot(b.x - knight.x, b.z - knight.z) - Math.hypot(a.x - knight.x, a.z - knight.z))[0] ?? spots[i];
    placed[i] = { x: at.x, z: at.z };
    return placed[i]!;
  });
};

/** A wave body's tile in world units. */
export const spotOf = (spawn: Pick<Spawn, 'x' | 'z'>): Point => ({ x: spawn.x * TILE, z: spawn.z * TILE });
