// The spatial half of a run: whether a body is close enough to care, which way it steps, and whether a
// blow reaches across the gap. Nothing here imports three.js or touches the DOM — dungeon-game.tsx owns
// the THREE.Group, the poses, the sound and the particles, and asks this module for the decision behind
// each of them. Everything works over plain {x, z} points, so a whole fight can be replayed in node
// instead of by hand-driving a browser, which is how every spatial regression here has been caught.
import { BESTIARY, byKind, ELITES, type Archetype, type EliteModifier, type EnemyKind, type EnemyStats, type Move } from './dungeon-bestiary.ts';
import { TILE, canStand, cellKey, hasClearPath, moveOnFloor } from './dungeon-floor.ts';

export { ENEMY_KINDS, BESTIARY, ELITES, type EliteModifier, type EnemyKind, type EnemyStats, type Move } from './dungeon-bestiary.ts';
export type Point = { x: number; z: number };

// A body stops caring about the knight once the walk to him is long enough. The cutoff is generous
// inside the room he stands in — a hall should wake as one — and tight everywhere else, so the floor
// does not simulate a pursuit three rooms away that the player will never see.
export const ACTIVATION = { sameRoom: 22, elsewhere: 10 };
// A body that has just come into range does not act on it instantly: it spends a beat turning to face
// the knight before it commits to anything, which is what makes waking read as an event rather than a
// switch flipping. Short, so it never reads as hesitation once a fight is already under way.
export const NOTICE_TIME = 0.32;
// When one body starts that beat, whichever still-dozing bodies stand within this radius of it, in the
// same room, join in too - nearest first, each ALERT_STAGGER later than the last, so a whole room does
// not snap awake on a single frame. This is the difference between a queue and a fight: see
// `nearbyDozers`, which a caller uses to schedule the stagger across frames.
export const ALERT_RADIUS = 6, ALERT_STAGGER = 0.15;
// A body with nothing to react to does not stand still: it paces this far each way from where it
// spawned, slow enough that nobody mistakes it for a patrol route or a chase.
export const PATROL_SPAN = 1.6, PATROL_SPEED = 0.55;
// The per-kind numbers below live in dungeon-bestiary.ts, one row per kind; these are the same values
// read out by quantity, which is how the rules and the tests have always asked for them.
// How far a committed blow actually reaches, versus how far away the enemy will start winding one up.
// The gap between the two is the telegraph: it commits while you are still walking in.
export const STRIKE_RANGE = byKind(a => a.strikeRange);
// A guard used to commit only from 1.15, inside the knight's own 1.8 reach, so it walked into the arc and
// died before its tell ran out; 1.5 keeps the swing inside STRIKE_RANGE but starts it while the knight is
// still deciding whether to step in.
export const ATTACK_RANGE = byKind(a => a.attackRange);
// Inside this it stands its ground rather than shuffling into the knight's chest.
export const HOLD_RANGE = byKind(a => a.holdRange);
// Recovery after a swing lands or misses. A stalker pays most for its pounce.
// Plan 023 (D5): `RECOVERY_SCALE` is the one dial on how often an ordinary body threatens: its recovery is the bestiary's times this, so 0.7 is a body that swings about four times in the seconds it used to swing three.
// It reaches every ordinary kind and never a boss, whose recovery is part of its design (a boss fight's length is plan 021's and 022's, tuned on its own). The tells are not touched: readability is the one thing not traded.
export const RECOVERY_SCALE = 1;
/** One archetype's recovery: the bestiary's, times `scale` for an ordinary kind and untouched for a boss. `scale` is a parameter so a test can hold the rule at a value the game does not ship. */
export const recoveryFor = (archetype: { boss?: Archetype['boss']; recovery: number }, scale = RECOVERY_SCALE) => archetype.boss ? archetype.recovery : archetype.recovery * scale;
export const RECOVERY = byKind(a => recoveryFor(a));
export const LUNGE_SPEED = 13, LUNGE_TIME = 0.32, LUNGE_CONTACT = 0.85;
// A volley's lane follows the knight until this much of the tell is left, then holds: the bolt goes where
// the lane pointed when it locked. Tracking to the last frame made the bolt a homing coin flip; never
// tracking made it miss anything that walked, which is everything. A quarter second is just over a human
// reaction, so the lock is the cue and a step or a dash after it is the answer.
export const AIM_LOCK = 0.25;
// Bodies hold each other this far apart, corrected gently rather than snapped.
export const CROWD_SPACING = 0.82, CROWD_PUSH_RATE = 3;
// Past this the enemy stops walking straight at the knight and follows the flood instead, which is what
// gets it round a corner; inside it, a straight line is both correct and smoother to watch.
export const DIRECT_STEP = TILE * 1.5;

// A blow that lands early in a tell knocks the swing out of a guard or a stalker; once this little of the
// tell is left the body is committed and finishes it. Wardens (any `steadfast` kind) never flinch out of a swing. The window used
// to be 0.18s, so a blow landing two thirds of the way through a tell still cancelled it. This is not what
// keeps a lone guard from ever connecting against a held strike key: that is the 0.2s flinch plus the 0.4s
// cooldown every hit refreshes against a 0.38s swing, which is deliberate - a guard is pressure in a group
// and while the knight moves, not a duel.
export const COMMITTED_WINDUP = 0.3;
// `stagger` is the one weapon property that is a rule rather than a number: ordinary steel never breaks
// a warden's committed swing, and the two heaviest arms in the keep are the only answer to the body
// that deals most of the knight's damage. Everything else is unchanged, so a guard and a stalker still
// flinch out of a tell early and never late, whatever is held.
export const interruptsWindup = (kind: EnemyKind, windup: number, stagger = false) =>
  (stagger || !BESTIARY[kind].steadfast) && windup > COMMITTED_WINDUP;

/** Every landed blow refreshes at least this much of the body's cooldown. */
export const HIT_COOLDOWN = 0.4;
/**
 * How long a body is off its feet after a blow. A swing a stagger weapon actually broke has to be
 * recovered from rather than merely restarted: at HIT_COOLDOWN a warden whose 0.72s tell was
 * interrupted simply wound the same swing up again 0.4s later, and the Bell Maul measured identically
 * to a plain sword against the one body it exists to answer. Ordinary steel breaking a guard's tell
 * still buys only the 0.4s it always did, so nothing but a stagger weapon changed.
 */
export const hitCooldown = (kind: EnemyKind, broke: boolean, stagger: boolean) =>
  broke && stagger ? RECOVERY[kind] : HIT_COOLDOWN;

// The numbers a body is made of, by kind and by floor. Only counts used to grow with depth; a floor-three
// guard was byte-for-byte a floor-one guard while the knight's boons only ever went up, so the run got
// easier as it went. Vitality grows by one per floor, damage by `FLOOR_DAMAGE` (fifteen percent through plan 022), and
// tells and speeds hold still so a learned read stays true all the way down.
// Vitality is quoted in quarter-hits of a starting blade rather than in whole ones. A guard used to
// hold 2 and the sword used to deal 1, so a weapon was either as strong as the sword or twice as
// strong, with nothing between: there is no "a fifth harder" at that grain, and five melee arms cannot
// be told apart by damage without it. Every number below is the old one times HIT, so the same swings
// still kill in the same number of blows; what changed is that a gap now exists to tune inside.
export const HIT = 4;
export const BASE_STATS: Record<EnemyKind, EnemyStats> = byKind(a => a.stats);
const floorsDeeper = (level: number) => Math.max(0, Math.floor(Number.isFinite(level) ? level : 1) - 1);
/**
 * Plan 023 (D5): how much more an ordinary body's blow costs for every floor down (a share of the floor-one damage). Fifteen percent through plan 022; a dial now, because damage carried from chamber to chamber is what makes a chamber cost something.
 * A boss keeps its own step (`BOSS_FLOOR_DAMAGE`): the bosses are tuned by their move rows, and a floor-two boss is meant to hit as it did.
 */
export const FLOOR_DAMAGE = 0.15;
export const BOSS_FLOOR_DAMAGE = 0.15;
/** A floor-one blow's damage on this floor: `step` more for every floor down (a boss's by default), rounded. */
export const scaledDamage = (base: number, level: number, step = BOSS_FLOOR_DAMAGE) => Math.round(base * (1 + step * floorsDeeper(level)));
/** The share of floor-one damage a kind's blow gains for every floor down: an ordinary kind's `FLOOR_DAMAGE`, a boss's own `BOSS_FLOOR_DAMAGE`. The steps are parameters so a test can hold the rule at values the game does not ship. */
export const damageStep = (kind: EnemyKind, ordinary = FLOOR_DAMAGE, boss = BOSS_FLOOR_DAMAGE) => BESTIARY[kind].boss ? boss : ordinary;
export const enemyStats = (kind: EnemyKind, level: number): EnemyStats => {
  const base = BASE_STATS[kind], deeper = floorsDeeper(level);
  return { hp: base.hp + deeper * HIT, damage: scaledDamage(base.damage, level, damageStep(kind)), tell: base.tell, speed: base.speed };
};

/**
 * Plan 022 (D7): what an elite body is made of: its kind's stats on this floor (`enemyStats`) with the modifier's multipliers on top, so every caller that scales a body - the game's `spawnEnemy`, the balance sim - applies a modifier the same way.
 * Vitality stays in the quarter-hit grain and damage stays whole, rounded as `scaledDamage` rounds; `tell` and `speed` are what `decideEnemy` is fed (`EnemyView`). No modifier is the plain body.
 */
export const eliteStats = (kind: EnemyKind, level: number, modifier?: EliteModifier): EnemyStats => {
  const base = enemyStats(kind, level);
  if (!modifier) return base;
  const m = ELITES[modifier];
  return { hp: Math.round(base.hp * m.hp), damage: Math.round(base.damage * m.damage), tell: base.tell * m.tell, speed: base.speed * m.speed };
};

// Plan 021: a boss is an archetype with a list of moves for each phase (dungeon-bestiary.ts `Move`) and the shares of its
// vitality at which a later phase begins. The rotation inside a phase is fixed - no random draw - so a fight is a pattern to
// learn and a seed replays it. These read the live table, not a snapshot: a test stands a boss in for a kind that is never dealt.
/** Seconds a boss stands still and unhittable while it changes phase, and the ring it plays at its feet lasts. */
export const PHASE_CHANGE = 1.0;
/** How far outside its own melee reach the knight is left by the push that opens a phase change (`bossPush`, dungeon-hits.ts). */
export const BOSS_PUSH_MARGIN = 0.6;
/** The move a body is in the middle of, by its phase and its place in that phase's rotation; null for an ordinary kind. */
export const moveOf = (kind: EnemyKind, phase: number, move: number): Move | null => {
  const table = BESTIARY[kind].moves;
  return table ? table[Math.min(Math.max(0, phase), table.length - 1)]?.[move] ?? null : null;
};
/** What one landed blow costs the knight on this floor: the move's own damage for a boss, the kind's for everything else. */
export const strikeDamage = (kind: EnemyKind, level: number, phase = 0, move = 0) => {
  const doing = moveOf(kind, phase, move);
  return doing ? scaledDamage(doing.damage, level) : enemyStats(kind, level).damage;
};
/** The farthest a boss strikes on foot, over every phase: what the knight has to be pushed beyond. A pounce and a volley are not reach, they are lanes. */
export const bossReach = (kind: EnemyKind) => {
  const reaches = (BESTIARY[kind].moves ?? []).flat().filter(move => move.attack === 'swing' || move.attack === 'sweep').map(move => move.strikeRange);
  return reaches.length ? Math.max(...reaches) : BESTIARY[kind].strikeRange;
};

/**
 * The most enemy arrows a boss can have in the air at once (plan 021): its widest fan, times how many volleys can overlap in flight. Two volleys are released at least one tell plus the boss's recovery
 * apart, and a bolt lives `flight` seconds, so that is how many are in the air together. It has to fit `ARROW_POOL` (dungeon-projectile.ts): a thirteenth arrow is silently never drawn. Zero for a body with no volley.
 */
export const volleyDemand = (kind: EnemyKind) => {
  const volleys = (BESTIARY[kind].moves ?? []).flat().filter(move => move.attack === 'volley' && move.bolt);
  if (!volleys.length) return 0;
  const gap = Math.min(...volleys.map(move => move.tell)) + RECOVERY[kind];
  return Math.max(...volleys.map(move => (move.bolt!.fan?.count ?? 1) * Math.ceil(move.bolt!.flight / gap)));
};

// Everything a decision reads off an enemy. The renderer's Enemy also carries a THREE.Group, a health
// bar, a telegraph mesh and a gait phase; none of that decides anything.
// `anchor` is fixed at spawn and never returned by an intent - it is the post a dozing body paces
// around, not something a frame changes. `notice` is the one piece of memory the noticing beat needs:
// 0 while dozing, climbing to NOTICE_TIME once something has its attention, pinned there once alert.
// Plan 021: `hp` and `maxHp` are what a boss's phase is read from; `move` is its place in the current phase's rotation (the
// move it is doing, or the next it will try), `phase` the phase it is in, and `change` the seconds of a phase change still to
// run. They are fed back each frame like `windup`, and an ordinary kind never reads them: they leave as they came in.
export type EnemyView = { kind: EnemyKind; x: number; z: number; room: number; cooldown: number; hitFlash: number; windup: number; lunge: number; tell: number; speed: number; aim: Point; anchor: Point; notice: number; hp: number; maxHp: number; move: number; phase: number; change: number };

export type World = {
  cells: Set<string>;
  // The room the knight stands in; -1 in a corridor, which no enemy claims, so corridor-standing keeps
  // every body on the tight cutoff.
  activeRoom: number;
  // Steps along walkable floor from the knight to that cell. Anything the flood never reached must read
  // back as Infinity — see isActive for what a missing value means.
  pathDistance: (cellX: number, cellZ: number) => number;
};

// What the enemy should do this frame. The caller applies it: it owns the body, the animation and the
// damage call. `act` says which branch ran, because each drives a different set of poses:
//   dozing   — has not noticed the knight. Paces near `anchor`; `notice` reads 0.
//   noticing — has just noticed: turned to `face` him and holding, a beat before it commits to anything.
//   lunge    — mid-pounce. Already moved; the trailing walk/idle animation is skipped for it.
//   windup   — committed to a swing, weapon rising. `hit` on the frame the tell runs out, or `loose` for
//              a volley, which the caller turns into a bolt (dungeon-projectile.ts) rather than a hit.
//   ready    — on guard: turned to `face`, and stepped if it had room to.
export type EnemyIntent = {
  act: 'dozing' | 'noticing' | 'lunge' | 'windup' | 'ready';
  x: number; z: number;
  cooldown: number; hitFlash: number; windup: number; lunge: number;
  aim: Point;
  // 0 while dozing, otherwise the noticing clock - see EnemyView. The caller feeds this straight back in
  // next frame, exactly like windup or cooldown.
  notice: number;
  // Yaw to turn the body to, or null to leave it as it is (a lunging or winding body is committed).
  face: number | null;
  // This frame's blow connects. The caller decides what the knight's invulnerability makes of it.
  hit: boolean;
  // A volley let go this frame, along this heading; null on every other frame and for every other attack.
  loose: Point | null;
  // A `summon` tell ran out this frame: the caller raises the next `perTell` of the body's buried reserve,
  // as many of them as are left.
  raise: boolean;
  // Plan 021. A `scatter` tell ran out this frame: the caller turns the rings it marked into fire pools.
  scatter: boolean;
  // The rotation slot, the phase and the change clock to feed back (EnemyView). `phaseChange` is true on the one frame a
  // threshold is crossed: the windup and the lunge are already cancelled, `phase` is the new one and `change` is PHASE_CHANGE.
  // While `change` runs the body is still, and the caller keeps it unhittable (`Struck.change`, dungeon-hits.ts).
  move: number; phase: number; change: number;
  phaseChange: boolean;
  sound: 'warn' | 'dash' | 'slash' | null;
  // Range to the knight before this frame's movement, which is what the gait and the poses read.
  // Not computed for a dozing body, which nothing looks at again this frame.
  distance: number;
};

export type CrowdBody = { x: number; z: number; windup: number; dead: boolean };

// The shape `nearbyDozers` needs from a body: where it is, which room it claims, whether it has already
// started noticing, and whether it is still around to notice anything at all.
export type Wakeable = { x: number; z: number; room: number; notice: number; dead: boolean };

// Bodies a freshly-noticing one should pull in too, nearest first, so a caller can stagger the actual
// kick by ALERT_STAGGER seconds a rank rather than waking a whole room in the same frame - a watch that
// turns together, not a flashbang. Only counts bodies still fully dormant in the same room: one already
// noticing, already alert, or standing in a different room, has nothing left to catch or no business
// joining a fight it cannot see.
export function nearbyDozers(bodies: readonly Wakeable[], sourceIndex: number, radius = ALERT_RADIUS): number[] {
  const source = bodies[sourceIndex];
  if (!source) return [];
  return bodies
    .map((body, index) => ({ index, distance: Math.hypot(body.x - source.x, body.z - source.z) }))
    .filter(({ index, distance }) => index !== sourceIndex && !bodies[index].dead && bodies[index].notice <= 0 && bodies[index].room === source.room && distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .map(({ index }) => index);
}

// Frame deltas arrive from rAF, from the manual stepper and from a tab that was hidden for a minute, so
// a junk one is dropped rather than subtracted: a single NaN would otherwise make every cooldown NaN
// and freeze that body's cooldown gate open forever.
const step = (dt: number) => Number.isFinite(dt) && dt > 0 ? dt : 0;
// THREE's normalize divides by `length || 1`, so a zero vector normalizes to zero rather than to NaN.
const unit = (x: number, z: number, length: number): Point => ({ x: x / (length || 1), z: z / (length || 1) });

// A cell the flood never reached is unreachable, not adjacent: anything non-finite reads as far away.
export const isActive = (pathDistance: number, sameRoom: boolean) =>
  (Number.isFinite(pathDistance) ? pathDistance : Infinity) <= (sameRoom ? ACTIVATION.sameRoom : ACTIVATION.elsewhere);

// The four orthogonal neighbours, nearest-to-the-knight first, walls dropped. The candidate order is
// the tiebreak, so a body crossing an open hall leans the same way every frame instead of shivering
// between two equally good steps. Null when the body is walled in on all four sides.
export function pursuitStep(world: World, cellX: number, cellZ: number): [number, number] | null {
  const open = ([[cellX + 1, cellZ], [cellX - 1, cellZ], [cellX, cellZ + 1], [cellX, cellZ - 1]] as [number, number][]).filter(([x, z]) => world.cells.has(cellKey(x, z)));
  return open.sort((a, b) => world.pathDistance(a[0], a[1]) - world.pathDistance(b[0], b[1]))[0] ?? null;
}

// A 13 u/s pounce covers most of a tile in one frame, so contact is tested against the whole segment it
// swept. Testing only where it landed let a stalker pass clean through the knight and stop behind him.
export function sweptContact(from: Point, to: Point, target: Point, radius = LUNGE_CONTACT) {
  const travelX = to.x - from.x, travelZ = to.z - from.z, towardX = target.x - from.x, towardZ = target.z - from.z;
  const fraction = Math.min(1, Math.max(0, (towardX * travelX + towardZ * travelZ) / Math.max(0.0001, travelX * travelX + travelZ * travelZ)));
  return Math.hypot(from.x + travelX * fraction - target.x, from.z + travelZ * fraction - target.z) < radius;
}

// Resolve a crowd so bodies do not stack into one silhouette. Two short passes keep the correction
// gentle; a body mid-windup carries no weight, because shoving a guard out of its own committed swing
// reads as the swing missing for no reason the player can see. Returns fresh points, in input order.
// The game hands it every body on the floor, corpses and the dormant waves included, so the dead are dropped
// before the pairing rather than inside it, and a pair already a spacing apart on either axis is passed over
// without a square root: on a late floor most pairs are bodies in other rooms.
export function separateCrowd(cells: Set<string>, bodies: readonly CrowdBody[], dt: number): Point[] {
  const moved = bodies.map(body => ({ x: body.x, z: body.z }));
  if (!(step(dt) > 0)) return moved;
  const live: number[] = [];
  for (let i = 0; i < bodies.length; i++) if (!bodies[i].dead) live.push(i);
  for (let pass = 0; pass < 2; pass++) for (let p = 0; p < live.length; p++) for (let q = p + 1; q < live.length; q++) {
    const i = live[p], j = live[q], a = moved[i], b = moved[j];
    let dx = b.x - a.x, dz = b.z - a.z;
    if (dx >= CROWD_SPACING || dx <= -CROWD_SPACING || dz >= CROWD_SPACING || dz <= -CROWD_SPACING) continue;
    const distance = Math.hypot(dx, dz);
    if (distance >= CROWD_SPACING) continue;
    // Two bodies exactly on top of each other have no direction to separate along; any axis will do.
    if (distance < 0.001) { dx = 1; dz = 0; } else { dx /= distance; dz /= distance; }
    const weightA = bodies[i].windup > 0 ? 0 : 1, weightB = bodies[j].windup > 0 ? 0 : 1, total = weightA + weightB;
    if (!total) continue;
    const push = Math.min(CROWD_SPACING - distance, dt * CROWD_PUSH_RATE);
    moveOnFloor(cells, a, -dx * push * weightA / total, -dz * push * weightA / total);
    moveOnFloor(cells, b, dx * push * weightB / total, dz * push * weightB / total);
  }
  return moved;
}

// A per-body direction rather than a per-frame random draw, so a seed replays the same pace and two
// guards standing apart do not swing in lockstep. Classic hash-the-coordinates noise: cheap, and stable
// for the life of the body since `anchor` never moves.
const patrolHeading = (anchor: Point): Point => {
  const seed = Math.sin(anchor.x * 12.9898 + anchor.z * 78.233) * 43758.5453;
  const angle = (seed - Math.floor(seed)) * Math.PI * 2;
  return { x: Math.sin(angle), z: Math.cos(angle) };
};

// A body with nobody to react to is not an AI, just a transform and a phase: it paces a short line
// through its own spawn point and turns around at each end. `aim` carries the direction it is currently
// walking in while dozing - attack aim and patrol heading are never both live, so the field is free to
// double up rather than adding one more piece of state every caller has to thread through.
function dozeIntent(enemy: EnemyView, world: World, dt: number, rest: Omit<EnemyIntent, 'act' | 'distance'>): EnemyIntent {
  const heading = patrolHeading(enemy.anchor);
  const forward = !(enemy.aim.x || enemy.aim.z) || enemy.aim.x * heading.x + enemy.aim.z * heading.z >= 0;
  let dirX = forward ? heading.x : -heading.x, dirZ = forward ? heading.z : -heading.z;
  const along = (enemy.x - enemy.anchor.x) * heading.x + (enemy.z - enemy.anchor.z) * heading.z;
  // Turn around the instant either post is reached, rather than drifting past it.
  if (forward && along >= PATROL_SPAN) { dirX = -heading.x; dirZ = -heading.z; }
  else if (!forward && along <= -PATROL_SPAN) { dirX = heading.x; dirZ = heading.z; }
  const landed = { x: enemy.x, z: enemy.z };
  moveOnFloor(world.cells, landed, dirX * PATROL_SPEED * dt, dirZ * PATROL_SPEED * dt);
  return { ...rest, act: 'dozing', notice: 0, x: landed.x, z: landed.z, aim: { x: dirX, z: dirZ }, face: Math.atan2(-dirX, -dirZ), distance: 0 };
}

/** Half the gap between two bodies raised by the same tell. */
export const RAISE_SPREAD = 0.7;

/**
 * Where a raised body stands: a pace from its caller toward the knight, so the fight grows between them
 * and not behind the caller. The bodies one tell raises stand side by side across that line, `slot` 0 on
 * one side and 1 on the other, rather than on top of each other; a slot whose spot is stone falls back
 * to the centre of the pace, and that to the caller's own spot.
 */
export function raiseSpot(cells: Set<string>, caller: Point, knight: Point, slot = 0): Point {
  const toward = unit(knight.x - caller.x, knight.z - caller.z, Math.hypot(knight.x - caller.x, knight.z - caller.z));
  const side = slot % 2 ? -RAISE_SPREAD : RAISE_SPREAD;
  for (const at of [
    { x: caller.x + toward.x * 1.3 - toward.z * side, z: caller.z + toward.z * 1.3 + toward.x * side },
    { x: caller.x + toward.x * 1.3, z: caller.z + toward.z * 1.3 },
  ]) if (canStand(cells, at.x, at.z)) return at;
  return { x: caller.x, z: caller.z };
}

/** What `fallOf` needs of each body: whose reserve it belongs to (-1 for none), and where it stands. */
export type Bound = { summoner: number; dead: boolean; buried: boolean };

/**
 * What one body's fall does to the roster. A body a summoner raised, cut down while that summoner still
 * stands, `reassembles`: it goes back into the reserve to be raised again, and is not a kill. Any other
 * fall is a death, and every body the fallen one called - standing or still buried - `crumble`s with it.
 * Indices are into `bodies`, which is the spawn order `summoner` counts in.
 */
export function fallOf(bodies: readonly Bound[], index: number): { reassembles: boolean; crumble: number[] } {
  const caller = bodies[index].summoner;
  if (caller >= 0 && bodies[caller] && !bodies[caller].dead) return { reassembles: true, crumble: [] };
  const crumble = bodies.flatMap((body, at) => at !== index && body.summoner === index && !body.dead ? [at] : []);
  return { reassembles: false, crumble };
}

/**
 * The first move at or after `from` in the rotation whose reach the knight is inside, or -1 when none is: a move he is too
 * far for is skipped for the next that fits, and one that fits is never skipped. A boss that finds none closes in.
 */
const pickMove = (moves: readonly Move[], from: number, distance: number) => {
  // A `chain` move follows the pounce before it and nothing else: it is taken when it is the one the rotation stands on, and never skipped to.
  for (let k = 0; k < moves.length; k++) { const at = (from + k) % moves.length; if (distance <= moves[at].attackRange && !(k > 0 && moves[at].chain)) return at; }
  return -1;
};

// One enemy, one frame. Assumes the caller has already dropped the asleep and the dying — those two are
// visual states the renderer resolves, and neither ticks a cooldown.
export function decideEnemy(enemy: EnemyView, player: Point, world: World, frameDt: number): EnemyIntent {
  const dt = step(frameDt);
  // A boss's moves for the phase it is in, and the slot it is on; null for every ordinary kind, which takes the path it always took.
  const archetype = BESTIARY[enemy.kind], table = archetype.moves;
  const moves = table ? table[Math.min(Math.max(0, enemy.phase), table.length - 1)] : null, slot = moves ? enemy.move % moves.length : 0;
  // Ticked before the activation cutoff, so a body that has been standing in a far room still comes out
  // of its recovery: reaching it must not hand the player a free swing it never earned.
  const hitFlash = Math.max(0, enemy.hitFlash - dt), cooldown = enemy.cooldown - dt;
  const change = table ? Math.max(0, enemy.change - dt) : enemy.change;
  const rest = { x: enemy.x, z: enemy.z, cooldown, hitFlash, windup: enemy.windup, lunge: enemy.lunge, aim: { x: enemy.aim.x, z: enemy.aim.z }, notice: enemy.notice, face: null, hit: false, loose: null, raise: false, scatter: false, move: enemy.move, phase: enemy.phase, change, phaseChange: false, sound: null } satisfies Omit<EnemyIntent, 'act' | 'distance'>;
  const cellX = Math.round(enemy.x / TILE), cellZ = Math.round(enemy.z / TILE);
  const nearby = isActive(world.pathDistance(cellX, cellZ), enemy.room === world.activeRoom);
  // A beat already under way - its own or one caught from a neighbour - runs to completion even on a
  // frame where the knight himself is still outside this body's own cutoff; see `nearbyDozers`.
  const midNotice = enemy.notice > 0 && enemy.notice < NOTICE_TIME;
  if (!nearby && !midNotice) return dozeIntent(enemy, world, dt, rest);

  if (enemy.notice < NOTICE_TIME) {
    const notice = Math.min(NOTICE_TIME, enemy.notice + dt);
    const toX = player.x - enemy.x, toZ = player.z - enemy.z;
    return { ...rest, act: 'noticing', notice, face: Math.atan2(-toX, -toZ), distance: Math.hypot(toX, toZ) };
  }
  // Fully noticed already, but the knight has since moved out of range and nothing is holding the beat
  // open: settle back into the pace rather than standing there alert forever.
  if (!nearby) return dozeIntent(enemy, world, dt, rest);

  const toX = player.x - enemy.x, toZ = player.z - enemy.z, distance = Math.hypot(toX, toZ);

  if (moves) {
    // Plan 021 D3. A phase change stands the boss still and facing him with nothing committed, for PHASE_CHANGE seconds; the
    // caller keeps it unhittable and pushes the knight out of its reach (`bossPush`). One change at a time, whatever a single
    // blow took off it: crossing two thresholds at once enters the first phase, and the second is entered when that change is over.
    const turned = Math.atan2(-toX, -toZ);
    if (change > 0) return { ...rest, act: 'ready', face: turned, windup: 0, lunge: 0, distance };
    const below = archetype.phases?.[enemy.phase];
    if (below !== undefined && enemy.hp < below * enemy.maxHp) return { ...rest, act: 'ready', face: turned, windup: 0, lunge: 0, move: 0, phase: enemy.phase + 1, change: PHASE_CHANGE, phaseChange: true, distance };
  }

  if (enemy.lunge > 0) {
    const landed = { x: enemy.x, z: enemy.z };
    moveOnFloor(world.cells, landed, enemy.aim.x * LUNGE_SPEED * dt, enemy.aim.z * LUNGE_SPEED * dt);
    // Connecting ends the pounce outright, so one leap can never bill the knight twice.
    const hit = sweptContact(enemy, landed, player), lunge = hit ? 0 : Math.max(0, enemy.lunge - dt);
    // A pounce is a boss's move done when the leap is over, not when its tell ran out: that is when the rotation moves on.
    return { ...rest, act: 'lunge', x: landed.x, z: landed.z, lunge, hit, distance, ...(moves && lunge === 0 ? { move: (slot + 1) % moves.length } : null) };
  }

  if (enemy.windup > 0) {
    const doing = moves ? moves[slot] : null, attack = doing?.attack ?? archetype.attack, strike = doing?.strikeRange ?? STRIKE_RANGE[enemy.kind];
    const pounce = attack === 'pounce', volley = attack === 'volley';
    const windup = Math.max(0, enemy.windup - dt);
    // A volley's lane is still following the knight until the lock; a swing's aim was fixed when it began.
    const aim = volley && windup > AIM_LOCK ? unit(toX, toZ, distance) : rest.aim;
    if (windup > 0) return { ...rest, act: 'windup', windup, aim, distance };
    // The blow is spent here and the boss's rotation moves on - except a pounce, whose leap is still to come (above).
    // A move the next one is chained to has no recovery: the pounce's leap hands straight to it (`Move.chain`).
    const chained = !!moves && !!moves[(slot + 1) % moves.length].chain;
    const recovered = { ...rest, act: 'windup' as const, windup: 0, aim, cooldown: chained ? 0 : RECOVERY[enemy.kind], distance, ...(moves && !pounce ? { move: (slot + 1) % moves.length } : null) };
    if (attack === 'summon') return { ...recovered, raise: true, sound: 'warn' };
    if (attack === 'scatter') return { ...recovered, scatter: true, sound: 'warn' };
    // A sweep has no aim to step around: everything within reach, on every side, that no wall shelters.
    if (attack === 'sweep') return { ...recovered, hit: distance < strike && hasClearPath(world.cells, enemy, player), sound: 'slash' };
    // The tell has run out and the swing is committed: it is tested against where the knight is *now*,
    // along the direction it aimed at when it started, which is what makes stepping around it work.
    const aimed = (toX * aim.x + toZ * aim.z) / (distance || 1);
    const hit = attack === 'swing' && distance < strike && hasClearPath(world.cells, enemy, player) && aimed > 0.45;
    return { ...recovered, lunge: pounce ? LUNGE_TIME : enemy.lunge, hit, loose: volley ? aim : null, sound: pounce ? 'dash' : volley ? 'slash' : null };
  }

  // On guard. Turning is free and happens even while flinching, so a hit never leaves a body facing the
  // wrong way once it recovers.
  const face = Math.atan2(-toX, -toZ);
  if (hitFlash > 0) return { ...rest, act: 'ready', face, distance };
  // A boss reaches for the next move in its rotation that the knight is within range of; anything else, the one attack it has.
  const pick = moves ? pickMove(moves, slot, distance) : -1;
  const clearAttackLine = moves ? pick >= 0 && hasClearPath(world.cells, enemy, player) : distance <= ATTACK_RANGE[enemy.kind] && hasClearPath(world.cells, enemy, player);
  if (clearAttackLine && cooldown <= 0) {
    return { ...rest, act: 'ready', face, windup: moves ? moves[pick].tell : enemy.tell, aim: unit(toX, toZ, distance), sound: 'warn', distance, ...(moves ? { move: pick } : null) };
  }
  // A body that fights at range gives ground while it recovers, rather than standing to be cut down. It
  // backs straight away and lets the walls stop it: a cornered archer is the knight's reward for closing.
  const keepAway = BESTIARY[enemy.kind].keepAway;
  if (distance < keepAway) {
    const away = unit(-toX, -toZ, distance), landed = { x: enemy.x, z: enemy.z };
    moveOnFloor(world.cells, landed, away.x * enemy.speed * dt, away.z * enemy.speed * dt);
    return { ...rest, act: 'ready', face, x: landed.x, z: landed.z, distance };
  }
  // Hold position when already in place with a clear line, and let a stalker stand still late in its
  // recovery rather than trotting in with a swing it cannot throw yet.
  if (!(distance > HOLD_RANGE[enemy.kind] || !clearAttackLine)) return { ...rest, act: 'ready', face, distance };
  const advanceBelow = BESTIARY[enemy.kind].advanceBelow;
  if (Number.isFinite(advanceBelow) && !(cooldown < advanceBelow)) return { ...rest, act: 'ready', face, distance };

  let dirX = toX, dirZ = toZ;
  if (distance > DIRECT_STEP || !clearAttackLine) {
    const next = pursuitStep(world, cellX, cellZ);
    if (next) { dirX = next[0] * TILE - enemy.x; dirZ = next[1] * TILE - enemy.z; }
  }
  const direction = unit(dirX, dirZ, Math.hypot(dirX, dirZ));
  const landed = { x: enemy.x, z: enemy.z };
  moveOnFloor(world.cells, landed, direction.x * enemy.speed * dt, direction.z * enemy.speed * dt);
  return { ...rest, act: 'ready', face, x: landed.x, z: landed.z, distance };
}

// Plan 024 (D3): pressure. Left alone, the bodies of a chamber threaten one at a time: each starts its tell when its own cooldown runs out, and a knight with one dash per 0.8 s answers every one. Two bodies ready to begin are
// therefore not allowed to end their tells together: the later one holds back until its tell would END `PRESSURE_GAP` seconds after the last tell already running (or already held) in its room. You dodge the first, and the second is
// already coming, inside the knight's dash cooldown, so one dash per threat stops being the answer and where he stands starts to matter.
// Every blow keeps its full tell: a hold delays the START of a tell, never shortens one (a held body shows nothing at all, so there is no half tell to misread). No randomness, so a seed replays it.
// A boss is outside the rule: its fight is its move rows, tuned on their own (plan 021, like `RECOVERY_SCALE`). A tell that already ends more than the gap after the last one is not delayed.
/** Seconds between one tell's end and the next's, for two bodies of a room that were ready together. The window it must stay in is `PRESSURE_WINDOW`; the knight's invulnerability after a hit (`INVULN`, 0.35 s) must fit under the lower end. */
export const PRESSURE_GAP = 0.5;
export const PRESSURE_WINDOW = { min: 0.4, max: 0.6 } as const;
/** What `pressure` reads of a body: the kind (a boss is exempt), the room it claims, whether it is out of the fight, the tell it is running, the hold it is serving and the tell it would run. */
export type Pressed = { kind: EnemyKind; room: number; dead: boolean; windup: number; held: number; tell: number };
/**
 * The seconds body `index` must still hold before it may begin the tell it is ready to begin; 0 means it begins this frame. A body already holding counts that hold down by `dt` (so it begins on the frame it reaches 0, within one frame of
 * its time); a body not yet holding looks at its room - the tell a body is running ends in `windup` seconds, and a held body's would end in `held + tell` - and lines its own end up `gap` after the latest of those, so an empty room holds
 * nothing and a lone body is never slowed. Held bodies count as scheduled, which is what keeps three bodies ready together from landing within `INVULN` of each other: each is placed after the one before.
 */
export function pressure(bodies: readonly Pressed[], index: number, dt: number, gap = PRESSURE_GAP): number {
  const self = bodies[index];
  if (!self || BESTIARY[self.kind].boss) return 0;
  if (self.held > 0) return Math.max(0, self.held - step(dt));
  let latest = 0;
  bodies.forEach((other, at) => {
    if (at === index || other.dead || other.room !== self.room || BESTIARY[other.kind].boss) return;
    latest = Math.max(latest, other.windup > 0 ? other.windup : other.held > 0 ? other.held + other.tell : 0);
  });
  return latest > 0 ? Math.max(0, latest + gap - self.tell) : 0;
}

/**
 * `decideEnemy`'s intent with pressure applied: a body that began a tell this frame (it was not winding, the intent winds) may be told to hold instead, in which case the tell does not start - no windup, no warning sound, the aim it had -
 * and `held` is what to feed back next frame (0 for a body that is not waiting). Any other intent passes through unchanged. `roster` is asked for only when a tell begins, so the common frame builds nothing; the game and the balance sim both call this
 * with their own bodies as they stand when this one is decided.
 */
export function pressed(view: EnemyView, intent: EnemyIntent, index: number, roster: () => readonly Pressed[], dt: number): { intent: EnemyIntent; held: number } {
  if (!(view.windup <= 0 && intent.windup > 0 && intent.act === 'ready')) return { intent, held: 0 };
  const held = pressure(roster(), index, dt);
  return held > 0 ? { intent: { ...intent, windup: 0, sound: null, aim: { x: view.aim.x, z: view.aim.z } }, held } : { intent, held: 0 };
}
