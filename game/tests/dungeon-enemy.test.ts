import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { landBlow, burn } from '../app/dungeon-hits.ts';
import { BOSS_FLOOR_DAMAGE, damageScale, damageStep, FLOOR_DAMAGE, ORDINARY_DAMAGE, PHASE_CHANGE, RECOVERY_SCALE, recoveryFor, scaledDamage, strikeDamage, type EnemyIntent } from '../app/dungeon-enemy.ts';
import { asReaper, TEST_BOSS, TEST_KING } from './fixtures/test-boss.ts';
import { recordSequence, type Recorded } from './fixtures/enemy-sequence.ts';
import { AIM_LOCK, fallOf, raiseSpot, RAISE_SPREAD, ALERT_RADIUS, ALERT_STAGGER, BASE_STATS, BESTIARY, ENEMY_KINDS, HIT, HIT_COOLDOWN, hitCooldown, COMMITTED_WINDUP, CROWD_SPACING, decideEnemy, enemyStats, interruptsWindup, LUNGE_SPEED, LUNGE_TIME, nearbyDozers, NOTICE_TIME, PATROL_SPAN, PATROL_SPEED, pursuitStep, RECOVERY, separateCrowd, sweptContact, type CrowdBody, type EnemyView, type Wakeable, type World } from '../app/dungeon-enemy.ts';

// A square of open floor wide enough that nothing in these tests walks off it.
const openFloor = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
// One character per tile, '#' solid; row 0 is z = 0, column 0 is x = 0.
const floorFrom = (rows: string[]) => { const cells = new Set<string>(); rows.forEach((row, z) => row.split('').forEach((c, x) => { if (c !== '#') cells.add(cellKey(x, z)); })); return cells; };
const world = (cells: Set<string>, patch: Partial<World> = {}): World => ({ cells, activeRoom: 1, pathDistance: () => 0, ...patch });
// `notice` defaults to NOTICE_TIME, i.e. already fully alert: most of these tests are about what an
// engaged body does, and the dozing/noticing machinery gets its own tests below with notice: 0.
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'guard', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.5, speed: 2.2, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 100, maxHp: 100, move: 0, phase: 0, change: 0, ...patch });
const body = (patch: Partial<CrowdBody> = {}): CrowdBody => ({ x: 0, z: 0, windup: 0, dead: false, ...patch });
const near = (a: number, b: number, slack = 1e-6) => Math.abs(a - b) <= slack;

test('a body too far to matter paces near its post instead of freezing, but still finishes recovering', () => {
  const cells = openFloor();
  // 11 steps away, and the knight is in another room: past the tight cutoff.
  const away = decideEnemy(foe({ cooldown: 1, hitFlash: 0.2, windup: 0.3, room: 2 }), { x: 0.5, z: 0 }, world(cells, { activeRoom: 1, pathDistance: () => 11 }), 0.1);
  assert.equal(away.act, 'dozing');
  // Recovery still runs, or walking back into a hall would hand the player a free swing it never earned.
  assert.equal(near(away.cooldown, 0.9), true);
  assert.equal(near(away.hitFlash, 0.1), true);
  // A commitment already under way is untouched by dozing, same as it was by the old inert freeze.
  assert.equal(away.windup, 0.3);
  assert.equal(away.hit, false);
  assert.equal(away.sound, null);
  // Dozing resets the noticing clock, so a later approach reads as a fresh beat rather than an instant one.
  assert.equal(away.notice, 0);
  // It moved, but only a slow pace's worth - not a chase.
  assert.ok(Math.hypot(away.x, away.z) > 0 && Math.hypot(away.x, away.z) <= PATROL_SPEED * 0.1 + 1e-9);
  // The same body in the knight's own room is inside the generous cutoff and acts (it is handed
  // notice: NOTICE_TIME by `foe`, so it is already alert rather than starting a fresh noticing beat).
  assert.notEqual(decideEnemy(foe({ room: 1, windup: 0.3 }), { x: 0.5, z: 0 }, world(cells, { activeRoom: 1, pathDistance: () => 11 }), 0.1).act, 'dozing');
});

test('a dozing body paces a short line through its own spawn point and turns around at each end', () => {
  const cells = openFloor();
  const w = world(cells, { activeRoom: -1, pathDistance: () => Infinity });
  const anchor = { x: 3, z: -4 };
  // Far enough away, and in no room at all, that nothing but the pace happens.
  let enemy = foe({ x: anchor.x, z: anchor.z, anchor, notice: 0 });
  const along: number[] = [];
  const aims: { x: number; z: number }[] = [];
  for (let i = 0; i < 400; i++) {
    const intent = decideEnemy(enemy, { x: 100, z: 100 }, w, 0.1);
    assert.equal(intent.act, 'dozing');
    assert.equal(intent.notice, 0);
    along.push(Math.hypot(intent.x - anchor.x, intent.z - anchor.z));
    aims.push(intent.aim);
    enemy = { ...enemy, x: intent.x, z: intent.z, aim: intent.aim };
  }
  // Never wanders past PATROL_SPAN from where it spawned, plus at most one frame's overshoot before the
  // next frame turns it around - this is a cheap transform, not a clamp against a precise boundary.
  assert.ok(along.every(d => d <= PATROL_SPAN + PATROL_SPEED * 0.1 + 1e-6));
  // It actually walks both legs rather than sitting at one end - the spread covers most of the span.
  assert.ok(Math.max(...along) > PATROL_SPAN * 0.8);
  // It turns around at least once: the walking direction is not the same for the whole 40 simulated
  // seconds, which is the "turn" the frame is looking for.
  assert.ok(aims.some(a => a.x * aims[0].x + a.z * aims[0].z < 0));
});

test('noticing is a held beat before a body commits, not an instant switch', () => {
  const cells = openFloor();
  const w = world(cells, { activeRoom: 1, pathDistance: () => 0 });
  let enemy = foe({ notice: 0 });
  // Mid-beat: turned to face the knight, standing exactly where it was, not yet acting.
  const first = decideEnemy(enemy, { x: 0, z: 1 }, w, 0.1);
  assert.equal(first.act, 'noticing');
  assert.ok(near(first.notice, 0.1));
  assert.deepEqual([first.x, first.z], [0, 0]);
  // Facing the knight, who is due +z of it; the model's forward is -Z, so that is a half turn.
  assert.equal(near(Math.abs(first.face!), Math.PI), true);
  enemy = { ...enemy, notice: first.notice };
  // Still short of NOTICE_TIME: still noticing.
  const second = decideEnemy(enemy, { x: 0, z: 1 }, w, 0.1);
  assert.equal(second.act, 'noticing');
  assert.ok(second.notice < NOTICE_TIME);
  // Enough beats (NOTICE_TIME is 0.32s; two 0.1s steps are not quite enough) and the clock caps at
  // NOTICE_TIME and the body finally commits, exactly the way a fully alert body would from a standstill.
  enemy = { ...enemy, notice: second.notice };
  let last = second;
  for (let i = 0; i < 5 && last.act === 'noticing'; i++) { last = decideEnemy(enemy, { x: 0, z: 1 }, w, 0.1); enemy = { ...enemy, notice: last.notice }; }
  assert.equal(last.notice, NOTICE_TIME);
  assert.notEqual(last.act, 'noticing');
  assert.notEqual(last.act, 'dozing');
});

test('a beat already under way survives a frame where the knight himself is out of range', () => {
  // Contagion (or a stray frame of flood noise) can hand a body a positive notice before its own
  // distance to the knight would ever have started one; the beat still has to finish rather than being
  // wiped the moment `nearby` reads false.
  const cells = openFloor();
  const w = world(cells, { activeRoom: -1, pathDistance: () => 999 });
  const midBeat = decideEnemy(foe({ notice: 0.05 }), { x: 20, z: 20 }, w, 0.05);
  assert.equal(midBeat.act, 'noticing');
  assert.ok(midBeat.notice > 0.05);
});

test('nearbyDozers wakes the nearest still-dormant neighbours in the same room, never itself or the far side of the keep', () => {
  const bodies: Wakeable[] = [
    { x: 0, z: 0, room: 1, notice: NOTICE_TIME, dead: false }, // 0: the one that just noticed
    { x: 1, z: 0, room: 1, notice: 0, dead: false },           // 1: closest dozer, same room
    { x: 3, z: 0, room: 1, notice: 0, dead: false },           // 2: further dozer, same room
    { x: 0.5, z: 0, room: 1, notice: NOTICE_TIME, dead: false }, // 3: already alert, nothing to catch
    { x: 0.5, z: 0, room: 2, notice: 0, dead: false },         // 4: dormant but a different room
    { x: 0.5, z: 0, room: 1, notice: 0, dead: true },          // 5: dormant but dead
    { x: ALERT_RADIUS + 5, z: 0, room: 1, notice: 0, dead: false }, // 6: dormant, but past the radius
  ];
  assert.deepEqual(nearbyDozers(bodies, 0), [1, 2]);
  // A radius of zero catches nothing but a body standing exactly on the source.
  assert.deepEqual(nearbyDozers(bodies, 0, 0), []);
  // An index with nothing there is simply empty, not a crash.
  assert.deepEqual(nearbyDozers(bodies, 99), []);
  // The stagger constant is what a caller multiplies rank by; pinned so a rebalance is deliberate.
  assert.equal(ALERT_STAGGER, 0.15);
});

test('pursuit takes the orthogonal neighbour nearest the knight, and never a wall', () => {
  // Flood distances shrink toward +z, so that is the step - even though the raw direction is diagonal.
  const w = world(openFloor(), { pathDistance: (x, z) => Math.abs(x) + Math.abs(z - 5) });
  assert.deepEqual(pursuitStep(w, 0, 0), [0, 1]);
  // A wall on the best side is dropped from the list rather than walked into.
  const walled = world(floorFrom(['...', '#.#', '...']), { pathDistance: (x, z) => Math.abs(x - 1) + Math.abs(z - 1) });
  assert.deepEqual(pursuitStep(walled, 1, 0), [1, 1]);
  // Walled in on all four sides: no step exists, and the caller must cope with that rather than crash.
  assert.equal(pursuitStep(world(floorFrom(['.#.', '#.#', '.#.'])), 1, 1), null);
});

test('a guard walks the flood to the knight and stops once it is in his face', () => {
  const w = world(openFloor(), { pathDistance: (x, z) => Math.abs(x) + Math.abs(z - 5) });
  const walk = decideEnemy(foe(), { x: 0, z: 5 * TILE }, w, 0.1);
  assert.equal(walk.act, 'ready');
  // Straight along +z at its own speed, and turned to look down the same axis.
  assert.equal(near(walk.z, 2.2 * 0.1, 1e-9), true);
  assert.equal(walk.x, 0);
  // The model's forward is -Z, so facing down +Z is a half turn; the sign of that turn is not meaningful.
  assert.equal(near(Math.abs(walk.face!), Math.PI, 1e-9), true);
  // Inside hold range with a clear line but still recovering: it stands its ground instead of nuzzling in.
  const held = decideEnemy(foe({ cooldown: 0.5 }), { x: 1, z: 0 }, world(openFloor()), 0.1);
  assert.deepEqual([held.act, held.x, held.z], ['ready', 0, 0]);
  // A warden holds from further out than a guard does.
  const wardenHeld = decideEnemy(foe({ kind: 'warden', speed: 1.65, cooldown: 0.5 }), { x: 1.8, z: 0 }, world(openFloor()), 0.1);
  assert.equal(wardenHeld.x, 0, 'a warden at 1.8 is already close enough');
  assert.ok(decideEnemy(foe({ cooldown: 0.5 }), { x: 1.8, z: 0 }, world(openFloor()), 0.1).x > 0, 'a guard at 1.8 still closes');
});

test('a flinching body turns to the knight but neither swings nor steps', () => {
  const hurtGuard = decideEnemy(foe({ hitFlash: 0.2 }), { x: 1, z: 0 }, world(openFloor()), 0.05);
  assert.deepEqual([hurtGuard.act, hurtGuard.x, hurtGuard.z, hurtGuard.windup, hurtGuard.sound], ['ready', 0, 0, 0, null]);
  assert.equal(near(hurtGuard.face!, Math.atan2(-1, 0), 1e-9), true);
  // The flinch is what blocks it: the same frame with the flash spent starts a windup.
  assert.equal(decideEnemy(foe({ hitFlash: 0.04 }), { x: 1, z: 0 }, world(openFloor()), 0.05).windup, 0.5);
});

test('a windup starts only in range, off cooldown, with a clear line - and aims where the knight was', () => {
  const cells = openFloor();
  const start = decideEnemy(foe(), { x: 0, z: 1 }, world(cells), 0.05);
  assert.deepEqual([start.act, start.windup, start.sound], ['ready', 0.5, 'warn']);
  assert.deepEqual(start.aim, { x: 0, z: 1 });
  // Out of its attack range, still on cooldown, or behind a wall: no commitment, each on its own.
  assert.equal(decideEnemy(foe(), { x: 0, z: 1.6 }, world(cells), 0.05).windup, 0, 'past 1.5 a guard has to walk');
  assert.equal(decideEnemy(foe(), { x: 0, z: 1.4 }, world(cells), 0.05).windup, 0.5, 'at 1.4 it commits before the knight can reach it walking');
  assert.equal(decideEnemy(foe({ cooldown: 0.5 }), { x: 0, z: 1 }, world(cells), 0.05).windup, 0, 'still recovering');
  const blocked = floorFrom(['...', '.#.', '...']);
  assert.equal(decideEnemy(foe({ x: 0, z: 0 }), { x: 0, z: 2 * TILE }, world(blocked, { pathDistance: () => 0 }), 0.05).windup, 0, 'a prop between them is not an opening');
  // A stalker commits from four units out, which is the whole point of the pounce.
  assert.equal(decideEnemy(foe({ kind: 'stalker', tell: 0.58, speed: 3.2 }), { x: 0, z: 4 }, world(cells), 0.05).windup, 0.58);
});

test('a committed swing lands only if the knight is still in front of it when the tell runs out', () => {
  const cells = openFloor();
  const winding = foe({ windup: 0.04, aim: { x: 0, z: 1 } });
  // Mid-tell: counting down, committed, no hit yet.
  const half = decideEnemy(foe({ windup: 0.3, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05);
  assert.deepEqual([half.act, half.hit, near(half.windup, 0.25)], ['windup', false, true]);
  // Tell spent, knight still on the aim line and inside strike range: it connects and the guard recovers.
  const landed = decideEnemy(winding, { x: 0, z: 1 }, world(cells), 0.05);
  assert.deepEqual([landed.act, landed.windup, landed.hit, landed.cooldown], ['windup', 0, true, RECOVERY.guard]);
  // Stepped around the swing: past the 0.45 cone it whiffs, and still pays the full recovery.
  const dodged = decideEnemy(winding, { x: 1, z: 0.3 }, world(cells), 0.05);
  assert.deepEqual([dodged.hit, dodged.cooldown], [false, RECOVERY.guard]);
  // Backed out of strike range, or behind a wall, and it whiffs too.
  assert.equal(decideEnemy(winding, { x: 0, z: 2 }, world(cells), 0.05).hit, false);
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1.3 }, world(floorFrom(['.', '#', '.'])), 0.05).hit, false);
  // A warden's longer reach is the difference: same geometry, one connects and one does not.
  const far = { x: 0, z: 2 };
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), far, world(cells), 0.05).hit, false);
  assert.equal(decideEnemy(foe({ kind: 'warden', tell: 0.72, windup: 0.04, aim: { x: 0, z: 1 } }), far, world(cells), 0.05).hit, true);
});

test('a stalker converts its tell into a pounce, never into a swing', () => {
  const done = decideEnemy(foe({ kind: 'stalker', tell: 0.58, speed: 3.2, windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(openFloor()), 0.05);
  assert.deepEqual([done.act, done.windup, done.lunge, done.hit, done.sound, done.cooldown], ['windup', 0, LUNGE_TIME, false, 'dash', RECOVERY.stalker]);
  // Late in its recovery a stalker waits rather than trotting in with a pounce it cannot throw.
  const approach = world(openFloor(), { pathDistance: (x, z) => Math.abs(x) + Math.abs(z - 2) });
  assert.equal(decideEnemy(foe({ kind: 'stalker', tell: 0.58, speed: 3.2, cooldown: 1.2 }), { x: 0, z: 3 }, approach, 0.05).z, 0);
  assert.ok(decideEnemy(foe({ kind: 'stalker', tell: 0.58, speed: 3.2, cooldown: 0.5 }), { x: 0, z: 3 }, approach, 0.05).z > 0);
});

test('a pounce travels at 13 a second and ends the moment it connects', () => {
  const cells = openFloor();
  const pouncing = foe({ kind: 'stalker', tell: 0.58, speed: 3.2, lunge: LUNGE_TIME, aim: { x: 0, z: 1 } });
  const miss = decideEnemy(pouncing, { x: 5, z: 5 }, world(cells), 0.02);
  assert.deepEqual([miss.act, miss.hit, near(miss.z, LUNGE_SPEED * 0.02, 1e-9), near(miss.lunge, LUNGE_TIME - 0.02)], ['lunge', false, true, true]);
  // Contact stops the pounce dead, so one leap can never bill the knight twice.
  const hit = decideEnemy(pouncing, { x: 0, z: 0.2 }, world(cells), 0.02);
  assert.deepEqual([hit.act, hit.hit, hit.lunge], ['lunge', true, 0]);
});

test('a pounce cannot tunnel through the knight', () => {
  // 13 u/s at 60fps covers 0.22; at a stutter it covers far more than the 0.85 contact radius, so the
  // whole swept segment is tested. A point test at where it landed is the bug this pins.
  const from = { x: -1, z: 0 }, to = { x: 1, z: 0 }, knight = { x: 0, z: 0 };
  assert.equal(sweptContact(from, to, knight), true);
  assert.equal(Math.hypot(to.x - knight.x, to.z - knight.z) < 0.85, false, 'a test at the landing point would miss');
  // Passing wide is still a miss - the sweep widens the check along the path, not around it.
  assert.equal(sweptContact({ x: -1, z: 1.2 }, { x: 1, z: 1.2 }, knight), false);
  // Behind the start and beyond the end are both clamped onto the segment, never extrapolated.
  assert.equal(sweptContact({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: -3, z: 0 }), false);
  assert.equal(sweptContact({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 4, z: 0 }), false);
  // A body that did not move at all still touches what it is standing on.
  assert.equal(sweptContact(knight, knight, { x: 0.4, z: 0 }), true);
});

test('crowds separate to arm\'s length, and a committed swing is never shoved out of it', () => {
  const cells = openFloor();
  const pair = separateCrowd(cells, [body({ x: 0, z: 0 }), body({ x: 0.4, z: 0 })], 0.1);
  // Two passes at 3 a second close the whole 0.42 gap here, and split it evenly.
  assert.equal(near(Math.hypot(pair[1].x - pair[0].x, pair[1].z - pair[0].z), CROWD_SPACING, 1e-9), true);
  assert.equal(near(pair[0].x, -0.21, 1e-9), true);
  assert.equal(near(pair[1].x, 0.61, 1e-9), true);
  // A body mid-windup carries no weight: it holds its ground and the other one gives way entirely.
  const committed = separateCrowd(cells, [body({ x: 0, z: 0, windup: 0.3 }), body({ x: 0.4, z: 0 })], 0.1);
  assert.deepEqual(committed[0], { x: 0, z: 0 });
  assert.equal(near(committed[1].x, 0.82, 1e-9), true);
  // Both committed: the pair stays overlapped rather than either swing being spoiled.
  assert.deepEqual(separateCrowd(cells, [body({ x: 0, z: 0, windup: 0.3 }), body({ x: 0.4, z: 0, windup: 0.2 })], 0.1), [{ x: 0, z: 0 }, { x: 0.4, z: 0 }]);
  // The dead are scenery, and a frozen frame moves nobody.
  assert.deepEqual(separateCrowd(cells, [body({ x: 0, z: 0 }), body({ x: 0.4, z: 0, dead: true })], 0.1), [{ x: 0, z: 0 }, { x: 0.4, z: 0 }]);
  assert.deepEqual(separateCrowd(cells, [body({ x: 0, z: 0 }), body({ x: 0.4, z: 0 })], 0), [{ x: 0, z: 0 }, { x: 0.4, z: 0 }]);
  // Already apart is left alone.
  assert.deepEqual(separateCrowd(cells, [body({ x: 0, z: 0 }), body({ x: CROWD_SPACING, z: 0 })], 0.1), [{ x: 0, z: 0 }, { x: CROWD_SPACING, z: 0 }]);
});

test('separation picks an axis for bodies standing in exactly the same spot, and never through a wall', () => {
  const stacked = separateCrowd(openFloor(), [body({ x: 0, z: 0 }), body({ x: 0, z: 0 })], 0.1);
  // Without a direction to push along, any axis will do, as long as they stop sharing a silhouette.
  assert.ok(Math.hypot(stacked[1].x - stacked[0].x, stacked[1].z - stacked[0].z) > 0.5);
  // A one-tile corridor running along x: crowding cannot push a body out through the side walls.
  const corridor = floorFrom(['####', '....', '####']);
  const squeezed = separateCrowd(corridor, [body({ x: TILE, z: TILE }), body({ x: TILE, z: TILE + 0.4 })], 0.1);
  for (const point of squeezed) assert.ok(Math.abs(point.z - TILE) < 0.42, `pushed to z ${point.z}, which is inside the wall`);
});

test('a decision never touches what it was handed', () => {
  const aim = Object.freeze({ x: 0, z: 1 });
  const enemy = Object.freeze(foe({ windup: 0.3, aim })) as EnemyView;
  const player = Object.freeze({ x: 0, z: 1 });
  const cells = openFloor();
  // Frozen inputs throw on write in a module, so a mutating implementation fails here rather than
  // corrupting the caller's enemy behind its back.
  for (const dt of [0.016, 0.05]) decideEnemy(enemy, player, world(cells), dt);
  decideEnemy(Object.freeze(foe({ lunge: LUNGE_TIME, aim })) as EnemyView, player, world(cells), 0.02);
  assert.deepEqual(enemy.aim, { x: 0, z: 1 });
  const bodies = [Object.freeze(body({ x: 0, z: 0 })), Object.freeze(body({ x: 0.4, z: 0 }))];
  separateCrowd(cells, bodies, 0.1);
  assert.deepEqual(bodies.map(b => b.x), [0, 0.4]);
});

test('a hit knocks a swing out of a tell only while enough of it is left; a warden never flinches out', () => {
  assert.equal(COMMITTED_WINDUP, 0.3);
  // Early in a guard's 0.5s tell the blow interrupts; once 0.3s or less remain the swing is committed.
  assert.equal(interruptsWindup('guard', 0.45), true);
  assert.equal(interruptsWindup('guard', 0.3), false);
  assert.equal(interruptsWindup('stalker', 0.5), true);
  assert.equal(interruptsWindup('stalker', 0.2), false);
  assert.equal(interruptsWindup('warden', 0.7), false);
  // The old window was 0.18s: a blow two thirds of the way through a tell still cancelled the swing.
  assert.ok(COMMITTED_WINDUP > 0.18);
});

test('bodies grow with the floor: vitality by one blade a floor, damage by fifteen percent', () => {
  // Vitality is quoted in quarter-hits so a weapon table has somewhere to sit between "one blow" and
  // "two blows". The blow counts are what the balance actually is, so they are asserted as blows.
  assert.equal(HIT, 4);
  assert.deepEqual(BASE_STATS, {
    guard: { hp: 2 * HIT, damage: 12, tell: 0.5, speed: 2.2 },
    stalker: { hp: 2 * HIT, damage: 8, tell: 0.58, speed: 3.2 },
    warden: { hp: 4 * HIT, damage: 20, tell: 0.72, speed: 1.65 },
    archer: { hp: 1.5 * HIT, damage: 10, tell: 0.75, speed: 2.3 },
    shieldbearer: { hp: 3 * HIT, damage: 10, tell: 0.6, speed: 1.9 },
    reaper: { hp: 3 * HIT, damage: 18, tell: 1.0, speed: 1.9 },
    pyre: { hp: 1.5 * HIT, damage: 8, tell: 0.5, speed: 2.4 },
    bonecaller: { hp: 2 * HIT, damage: 0, tell: 1.2, speed: 2.2 },
    rattler: { hp: 1 * HIT, damage: 5, tell: 0.38, speed: 3.6 },
    captain: { hp: 72.5 * HIT, damage: 7, tell: 0.8, speed: 1.8 },
    mother: { hp: 37.5 * HIT, damage: 9, tell: 0.8, speed: 2.1 },
    hound: { hp: 65 * HIT, damage: 5, tell: 0.7, speed: 3.0 },
    bastion: { hp: 60 * HIT, damage: 6, tell: 0.7, speed: 1.7 },
    king: { hp: 157.5 * HIT, damage: 0, tell: 0.8, speed: 1.9 },
  });
  // Floor one is the base table, but for an ordinary blow, which costs ORDINARY_DAMAGE times the table's (plan 025 D10; the test below holds that rule).
  for (const kind of ENEMY_KINDS) assert.deepEqual(enemyStats(kind, 1), { ...BASE_STATS[kind], damage: Math.round(BASE_STATS[kind].damage * damageScale(kind)) });
  assert.deepEqual([enemyStats('guard', 2).hp, enemyStats('guard', 3).hp], [3 * HIT, 4 * HIT]);
  // A floor-three stair is three wardens; at eight blades each that was a slog, so a warden grows like the rest.
  assert.deepEqual([enemyStats('warden', 2).hp, enemyStats('warden', 3).hp], [5 * HIT, 6 * HIT]);
  // Written out at the shipped ORDINARY_DAMAGE of 1.5 (the table's 12, 8 and 20 a blow).
  assert.deepEqual([1, 2, 3].map(level => enemyStats('guard', level).damage), [18, 21, 23]);
  assert.deepEqual([1, 2, 3].map(level => enemyStats('stalker', level).damage), [12, 14, 16]);
  assert.deepEqual([1, 2, 3].map(level => enemyStats('warden', level).damage), [30, 35, 39]);
  // Tells and speeds hold still so a read learned on floor one stays true.
  for (const level of [2, 3]) for (const kind of ENEMY_KINDS) {
    assert.equal(enemyStats(kind, level).tell, BASE_STATS[kind].tell);
    assert.equal(enemyStats(kind, level).speed, BASE_STATS[kind].speed);
  }
  // Garbage levels fall back to floor one rather than to NaN vitality.
  assert.deepEqual(enemyStats('guard', Number.NaN), enemyStats('guard', 1));
  assert.deepEqual(enemyStats('guard', 0), enemyStats('guard', 1));
});

test('a warden flinches only for an arm that staggers, and only early in the tell', () => {
  // Ordinary steel never breaks a warden's committed swing; that is the whole reason the heaviest arm
  // in the keep is worth carrying.
  assert.equal(interruptsWindup('warden', 0.6), false);
  assert.equal(interruptsWindup('warden', 0.6, false), false);
  assert.equal(interruptsWindup('warden', 0.6, true), true);
  // Late in the tell it is committed whatever is held: a stagger weapon buys timing, not immunity.
  assert.equal(interruptsWindup('warden', COMMITTED_WINDUP, true), false);
  assert.equal(interruptsWindup('warden', COMMITTED_WINDUP - 0.01, true), false);
  // Guards and stalkers are unchanged by the new argument in either direction.
  for (const kind of ['guard', 'stalker'] as const) {
    assert.equal(interruptsWindup(kind, 0.4), true);
    assert.equal(interruptsWindup(kind, 0.4, true), true);
    assert.equal(interruptsWindup(kind, 0.1, true), false);
  }
});

test('a broken swing costs a recovery, an ordinary blow costs the usual cooldown', () => {
  // Without this a warden whose tell was interrupted wound the same swing up again 0.4s later, and the
  // one arm that can stagger measured identically to a plain sword against the body it exists to answer.
  assert.equal(hitCooldown('warden', true, true), RECOVERY.warden);
  assert.equal(hitCooldown('guard', true, true), RECOVERY.guard);
  // Nothing else moved: a hit that broke nothing, or an arm that does not stagger, pays the old price.
  assert.equal(hitCooldown('warden', false, true), HIT_COOLDOWN);
  assert.equal(hitCooldown('guard', true, false), HIT_COOLDOWN);
  assert.equal(hitCooldown('guard', false, false), HIT_COOLDOWN);
  assert.ok(RECOVERY.warden > HIT_COOLDOWN, 'a stagger has to be worth more than a plain blow');
});

// The archer. Every number is read off the bestiary rather than restated, so these hold the rule, not a tuning.
const archer = (patch: Partial<EnemyView> = {}) => foe({ kind: 'archer', tell: BASE_STATS.archer.tell, speed: BASE_STATS.archer.speed, ...patch });

test('an archer commits from range down a clear line, and not through stone', () => {
  const cells = openFloor();
  const reach = BESTIARY.archer.attackRange;
  assert.ok(reach > BESTIARY.stalker.attackRange, 'an archer that commits no further out than a stalker is not ranged');
  const start = decideEnemy(archer(), { x: 0, z: reach - 0.5 }, world(cells), 0.05);
  assert.deepEqual([start.act, start.windup, start.sound], ['ready', BASE_STATS.archer.tell, 'warn']);
  assert.deepEqual(start.aim, { x: 0, z: 1 });
  assert.equal(decideEnemy(archer(), { x: 0, z: reach + 0.5 }, world(cells), 0.05).windup, 0, 'past its range it has to walk');
  // Same distance, a pillar in the way: no line, no shot.
  const pillar = floorFrom(['.', '.', '#', '.', '.', '.', '.']);
  assert.equal(decideEnemy(archer(), { x: 0, z: 5 * TILE }, world(pillar), 0.05).windup, 0, 'a wall between them is not a line');
});

test("an archer's lane follows the knight until the lock, then holds where it pointed", () => {
  const cells = openFloor(), knight = { x: 3, z: 0 };
  // Early in the tell: the lane swings round onto where the knight has moved to.
  const tracking = decideEnemy(archer({ windup: AIM_LOCK + 0.2, aim: { x: 0, z: 1 } }), knight, world(cells), 0.05);
  assert.equal(tracking.act, 'windup');
  assert.ok(near(tracking.aim.x, 1) && near(tracking.aim.z, 0), `the lane did not follow: ${JSON.stringify(tracking.aim)}`);
  // Inside the lock: the same knight in the same place, and the lane stays on the old line.
  const locked = decideEnemy(archer({ windup: AIM_LOCK - 0.05, aim: { x: 0, z: 1 } }), knight, world(cells), 0.05);
  assert.equal(locked.act, 'windup');
  assert.deepEqual(locked.aim, { x: 0, z: 1 }, 'the lane kept following after the lock');
  // A guard's aim never tracked, lock or no lock: that is what a swing's tell is.
  assert.deepEqual(decideEnemy(foe({ windup: AIM_LOCK + 0.2, aim: { x: 0, z: 1 } }), knight, world(cells), 0.05).aim, { x: 0, z: 1 });
});

test('an archer looses a bolt along the locked lane and never lands a blow of its own', () => {
  const cells = openFloor();
  // Standing right on the line and inside any melee reach: a guard here connects, which is what makes
  // the archer's miss mean something.
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05).hit, true);
  const done = decideEnemy(archer({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05);
  assert.deepEqual([done.act, done.windup, done.hit, done.sound, done.cooldown], ['windup', 0, false, 'slash', RECOVERY.archer]);
  assert.deepEqual(done.loose, { x: 0, z: 1 });
  // Looses down the locked lane even when the knight has since stepped off it: the bolt is what has to find him.
  assert.deepEqual(decideEnemy(archer({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 4, z: 0 }, world(cells), 0.05).loose, { x: 0, z: 1 });
  // Nothing else ever looses, and an archer mid-tell has not loosed yet.
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05).loose, null);
  assert.equal(decideEnemy(archer({ windup: 0.3, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05).loose, null);
});

test('an archer gives ground while it recovers inside its keep-away, and closes from outside it', () => {
  // The flood leads toward +z, where the knight stands, so walking in reads as z going up.
  const cells = openFloor(), close = { x: 0, z: BESTIARY.archer.keepAway - 1.5 }, toward = (z: number) => world(cells, { pathDistance: (x, cz) => Math.abs(x) + Math.abs(cz - z) });
  const backing = decideEnemy(archer({ cooldown: 1 }), close, toward(1), 0.1);
  assert.equal(backing.act, 'ready');
  assert.ok(near(backing.z, -BASE_STATS.archer.speed * 0.1), `it did not back straight away: z ${backing.z}`);
  // A guard in the same spot walks in, so it is the archer's rule and not the geometry.
  assert.ok(decideEnemy(foe({ cooldown: 1 }), close, toward(1), 0.1).z > 0, 'a guard at the same range did not walk in');
  // Recovered and with a line, it shoots from where it stands rather than backing off further.
  assert.equal(decideEnemy(archer(), close, toward(1), 0.1).windup, BASE_STATS.archer.tell);
  // Out past its range it walks in like anything else.
  assert.ok(decideEnemy(archer({ cooldown: 1 }), { x: 0, z: BESTIARY.archer.attackRange + 1 }, toward(4), 0.1).z > 0, 'an archer out of range never closed');
});

test('an archer flinches out of an early tell like a guard, and is frailer than one', () => {
  assert.equal(interruptsWindup('archer', COMMITTED_WINDUP + 0.1), true);
  assert.equal(interruptsWindup('archer', COMMITTED_WINDUP - 0.01), false);
  assert.ok(BASE_STATS.archer.hp < BASE_STATS.guard.hp, 'an archer as tough as a guard has no reason to be reached');
});

// The arena-only kinds. Numbers again come off the bestiary.
const kind = (k: EnemyView['kind'], patch: Partial<EnemyView> = {}) => foe({ kind: k, tell: BASE_STATS[k].tell, speed: BASE_STATS[k].speed, ...patch });

test('a reaper sweeps everything in reach on every side, and nothing past it or behind a wall', () => {
  const cells = openFloor(), reach = BESTIARY.reaper.strikeRange;
  // Aimed at +z, knight directly behind it at -z: a guard would whiff, a sweep does not.
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: -1.2 }, world(cells), 0.05).hit, false, 'precondition: a guard misses behind itself');
  const behind = decideEnemy(kind('reaper', { windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: -(reach - 0.2) }, world(cells), 0.05);
  assert.deepEqual([behind.act, behind.windup, behind.hit, behind.cooldown], ['windup', 0, true, RECOVERY.reaper]);
  assert.equal(decideEnemy(kind('reaper', { windup: 0.04, aim: { x: 0, z: 1 } }), { x: reach + 0.2, z: 0 }, world(cells), 0.05).hit, false, 'a sweep reached past its reach');
  assert.equal(decideEnemy(kind('reaper', { windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 2 * TILE * 0.9 }, world(floorFrom(['.', '#', '.'])), 0.05).hit, false, 'a sweep cut through stone');
  assert.ok(reach > BESTIARY.guard.strikeRange, 'a reaper that reaches no further than a guard is only a guard that spins');
});

test('a bonecaller raises instead of striking, keeps its distance, and a raised body stands between it and the knight', () => {
  const cells = openFloor();
  const called = decideEnemy(kind('bonecaller', { windup: 0.04 }), { x: 0, z: 1 }, world(cells), 0.05);
  assert.deepEqual([called.act, called.raise, called.hit, called.cooldown], ['windup', true, false, RECOVERY.bonecaller]);
  // Nothing else raises, and a caller mid-tell has not raised yet.
  assert.equal(decideEnemy(foe({ windup: 0.04, aim: { x: 0, z: 1 } }), { x: 0, z: 1 }, world(cells), 0.05).raise, false);
  assert.equal(decideEnemy(kind('bonecaller', { windup: 0.5 }), { x: 0, z: 1 }, world(cells), 0.05).raise, false);
  // It starts a call from far off, down a clear line.
  assert.equal(decideEnemy(kind('bonecaller'), { x: 0, z: BESTIARY.bonecaller.attackRange - 0.5 }, world(cells), 0.05).windup, BASE_STATS.bonecaller.tell);
  // Recovering and too close, it backs off.
  assert.ok(decideEnemy(kind('bonecaller', { cooldown: 1 }), { x: 0, z: 2 }, world(cells), 0.1).z < 0, 'a bonecaller stood its ground');
  // Where the pair stands is the next test; walled in toward the knight, it rises on the caller's own spot rather than in stone.
  assert.deepEqual(raiseSpot(floorFrom(['.', '#']), { x: 0, z: 0 }, { x: 0, z: 6 }), { x: 0, z: 0 });
});

test('the two bodies one call raises stand side by side across the line to the knight, not on each other', () => {
  const cells = openFloor(), caller = { x: 0, z: 0 }, knight = { x: 0, z: 6 };
  const [left, right] = [0, 1].map(slot => raiseSpot(cells, caller, knight, slot));
  assert.equal(BESTIARY.bonecaller.summons?.perTell, 2, 'precondition: a call raises two');
  assert.ok(Math.abs(Math.abs(left.x - right.x) - 2 * RAISE_SPREAD) < 1e-9, `the pair stood ${JSON.stringify([left, right])}, not spread across the line`);
  assert.equal(left.z, right.z, 'one of the pair stood nearer the knight than the other');
  for (const at of [left, right]) assert.ok(at.z > 0.5 && at.z < 2, `a raised body stood at ${JSON.stringify(at)}, not between caller and knight`);
  // A side that is stone gives way to the middle of the pace, and that to the caller's own spot.
  const narrow = floorFrom(['#.#', '#.#']), centre = { x: TILE, z: 0 }, ahead = { x: TILE, z: 6 };
  assert.deepEqual(raiseSpot(narrow, centre, ahead, 1), { x: TILE, z: 1.3 }, 'a slot in stone did not fall back to the middle of the pace');
});

test('a raised body cut down while its caller stands goes back into the ground; when the caller falls, everything it called crumbles', () => {
  // Spawn order is what `summoner` counts in: the caller, two it called (one up, one still buried), a guard.
  const roster = () => [
    { summoner: -1, dead: false, buried: false },
    { summoner: 0, dead: false, buried: false },
    { summoner: 0, dead: false, buried: true },
    { summoner: -1, dead: false, buried: false },
  ];
  assert.deepEqual(fallOf(roster(), 1), { reassembles: true, crumble: [] }, 'a raised body died with its caller still standing');
  assert.deepEqual(fallOf(roster(), 0), { reassembles: false, crumble: [1, 2] }, 'the caller fell and left what it called, standing or buried');
  assert.deepEqual(fallOf(roster(), 3), { reassembles: false, crumble: [] }, 'a guard took bodies down with it');
  // With the caller already gone a raised body has nowhere to go back to, and one already down is not crumbled twice.
  const orphaned = roster(); orphaned[0].dead = true;
  assert.deepEqual(fallOf(orphaned, 1), { reassembles: false, crumble: [] }, 'a raised body outlived its caller and still went back into the ground');
  const spent = roster(); spent[1].dead = true;
  assert.deepEqual(fallOf(spent, 0).crumble, [2], 'a body already dead crumbled again');
});

test('the reaper and the rattler are never dealt by the floor generator, on any floor', () => {
  // Plan 018 promoted the shieldbearer, the pyre and the bonecaller; these two stay out. The rattler enters only as a
  // bonecaller's buried reserve (dungeon-floor.test.ts).
  const arenaOnly = ['reaper', 'rattler'] as const;
  for (const k of arenaOnly) assert.equal(BESTIARY[k].firstFloor, Infinity, `${k} can be dealt`);
  // A rattler dies to one blow of a starting blade, which is its whole point.
  assert.ok(BASE_STATS.rattler.hp <= HIT, 'a rattler takes more than one blow');
});

// ---- Plan 021 Stage A: moves and phases. -----------------------------------------------------------------------------------------

// What `tests/fixtures/enemy-sequence.ts` returned for every ordinary kind at 1ae7e92, before an archetype could have moves or phases:
// an FNV digest of every intent over forty seconds of scripted fight, and what the fight held. A record, not a recomputation.
const BEFORE_PLAN_021: Record<string, Omit<Recorded, 'neutral'>> = {
  guard: { kind: 'guard', digest: '92ec2e7b', frames: 2400, windups: 9, hits: 6, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1830, dozing: 200 },
  stalker: { kind: 'stalker', digest: '36a81d56', frames: 2400, windups: 10, hits: 5, looses: 0, raises: 0, lunges: 104, noticing: 40, ready: 1638, dozing: 200 },
  warden: { kind: 'warden', digest: 'fd8f6709', frames: 2400, windups: 7, hits: 5, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1817, dozing: 200 },
  archer: { kind: 'archer', digest: '2460d9ae', frames: 2400, windups: 18, hits: 0, looses: 11, raises: 0, lunges: 0, noticing: 40, ready: 1493, dozing: 200 },
  shieldbearer: { kind: 'shieldbearer', digest: 'c70db169', frames: 2400, windups: 7, hits: 4, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1884, dozing: 200 },
  // Plan 025 D4 (2026-10-07): a body's footprint grows with its scale, and the reaper (1.1) is the one kind the scripted fight walks near a wall, so it stops a
  // hair farther from it. Every count is unchanged; only the digest moved (from bbc7ada5). The warden (1.3) and shieldbearer (1.05) never touch a wall here.
  reaper: { kind: 'reaper', digest: '1e936e7d', frames: 2400, windups: 6, hits: 3, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1733, dozing: 200 },
  pyre: { kind: 'pyre', digest: 'd11fa9eb', frames: 2400, windups: 9, hits: 6, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1829, dozing: 200 },
  bonecaller: { kind: 'bonecaller', digest: 'c280ec6d', frames: 2400, windups: 12, hits: 0, looses: 0, raises: 8, lunges: 0, noticing: 40, ready: 1313, dozing: 200 },
  rattler: { kind: 'rattler', digest: 'ce119782', frames: 2400, windups: 11, hits: 5, looses: 0, raises: 0, lunges: 0, noticing: 40, ready: 1866, dozing: 200 },
};

test('an archetype without moves produces exactly the intents it produced before plan 021, and leaves the boss fields idle', () => {
  // Plan 021 Stage B: a kind with moves is a boss (the Captain), and the recording is of every kind without them.
  const ordinary = ENEMY_KINDS.filter(kind => !BESTIARY[kind].moves);
  for (const kind of ENEMY_KINDS) if (BESTIARY[kind].moves) assert.ok(BESTIARY[kind].boss, `${kind} has moves but is not marked a boss`);
  assert.ok(ordinary.length === 9 && ordinary.length < ENEMY_KINDS.length, 'precondition: the nine kinds that existed before plan 021 are ordinary and a boss is not among them');
  assert.deepEqual(Object.keys(BEFORE_PLAN_021).sort(), [...ordinary].sort(), 'a kind has no recorded sequence');
  for (const kind of ordinary) {
    const got = recordSequence(kind), { neutral, ...rest } = got;
    // The fight has to have made the kind do something, or equal digests prove nothing.
    assert.ok(got.windups >= 6, `${kind}: the scripted fight started only ${got.windups} tells, too few to say anything about its intents`);
    assert.ok(got.hits + got.looses + got.raises >= 3, `${kind}: the scripted fight never saw it hit, loose or raise (${got.hits}, ${got.looses}, ${got.raises})`);
    assert.deepEqual(rest, BEFORE_PLAN_021[kind], `${kind}: its intents over the scripted fight are not what they were before plan 021 (digest, then what the fight held)`);
    assert.equal(neutral, true, `${kind}: an ordinary body's move, phase or change left zero, or it reported a phase change or a scatter`);
  }
});

/** One frame's feedback, as the game does it: what the intent returns is what the next decision is handed. */
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });
const BLOW = { damage: 3, stagger: false, knockback: 0.4, wardenKnockback: 0.1 };
const DT = 1 / 60;
/** Runs a boss on until its tell runs out (windup back to zero on a frame that began with one), returning the intent that spent it. */
const untilSpent = (start: EnemyView, knight: { x: number; z: number }, w: World) => {
  let enemy = start;
  for (let frame = 0; frame < 240; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup > 0 && intent.windup === 0) return { intent, enemy: fed(enemy, intent) };
    enemy = fed(enemy, intent);
  }
  throw new Error('the tell never ran out');
};
/** Runs a boss on, recovering, until it begins its next tell. */
const untilWinding = (start: EnemyView, knight: { x: number; z: number }, w: World) => {
  let enemy = start;
  for (let frame = 0; frame < 600; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) return { intent, enemy: fed(enemy, intent) };
    enemy = fed(enemy, intent);
  }
  throw new Error('no tell began');
};

test('a boss\'s rotation advances when a move is spent and not when it is interrupted', () => {
  asReaper(TEST_BOSS, () => {
    const cells = openFloor(), w = world(cells), knight = { x: 1.2, z: 0 };
    const boss = foe({ kind: 'reaper', hp: 40, maxHp: 40, tell: 99 });
    // The first move, the swing, begins: its own tell (the view's is nonsense a boss must ignore), and the rotation still on it.
    const first = decideEnemy(boss, knight, w, DT);
    assert.equal(first.windup, 0.5, 'the first move did not begin, or did not use its own tell');
    assert.equal(first.move, 0, 'a move began and the rotation had already moved on');
    // Spent: the rotation is on the sweep, and the sweep is what comes next - with its own tell, once the recovery is over.
    const spent = untilSpent(fed(boss, first), knight, w);
    assert.equal(spent.intent.move, 1, 'the swing was spent and the rotation did not advance');
    const second = untilWinding(spent.enemy, knight, w);
    assert.equal(second.intent.windup, 0.9, 'the move after the swing was not the sweep');
    assert.equal(second.intent.move, 1);
    // Interrupted with a real blow: the tell is broken (the precondition), and the sweep is tried again, not the move after it.
    const struck = { kind: 'reaper' as const, hp: 40, windup: second.enemy.windup, cooldown: second.enemy.cooldown, hitFlash: 0 };
    assert.equal(landBlow(cells, { ...struck }, { x: 0, z: 0 }, BLOW, { x: 1, z: 0 }).broke, false, 'precondition: ordinary steel does not break a boss\'s tell, so it takes an arm that staggers');
    assert.equal(landBlow(cells, struck, { x: 0, z: 0 }, { ...BLOW, stagger: true }, { x: 1, z: 0 }).broke, true, 'the blow did not break the tell, so nothing was interrupted');
    const broken = { ...second.enemy, windup: struck.windup, cooldown: struck.cooldown, hitFlash: struck.hitFlash };
    assert.equal(broken.windup, 0);
    const again = untilWinding(broken, knight, w);
    assert.equal(again.intent.windup, 0.9, 'an interrupted sweep was followed by a different move');
    assert.equal(again.intent.move, 1, 'an interrupted move advanced the rotation');
  });
});

test('a boss skips a move the knight is out of range of for the next that fits, and skips none when he is in range', () => {
  asReaper(TEST_BOSS, () => {
    const cells = openFloor(), boss = foe({ kind: 'reaper', hp: 40, maxHp: 40 });
    const w = (knightX: number) => world(cells, { pathDistance: (x, z) => Math.abs(x - Math.round(knightX / TILE)) + Math.abs(z) });
    // In range of the swing (reach 1.8): the swing, the first of the rotation.
    const near = decideEnemy(boss, { x: 1.2, z: 0 }, w(1.2), DT);
    assert.equal(near.windup, 0.5, 'in range of the first move it did not begin the first move');
    assert.equal(near.move, 0);
    // 2.5 out: past the swing's 1.8, inside the sweep's 2.8. The swing is skipped for the sweep, and the rotation carries on after it.
    const mid = decideEnemy(boss, { x: 2.5, z: 0 }, w(2.5), DT);
    assert.equal(mid.windup, 0.9, 'out of the swing\'s range and inside the sweep\'s, it did not begin the sweep');
    assert.equal(mid.move, 1);
    const spent = untilSpent(fed(boss, mid), { x: 2.5, z: 0 }, w(2.5));
    assert.equal(spent.intent.move, 0, 'after the move it skipped to, the rotation did not carry on from that one');
    // Past every move's reach: nothing begins, and it closes on him instead.
    const far = decideEnemy(boss, { x: 6, z: 0 }, w(6), DT);
    assert.equal(far.windup, 0, 'a move began from outside every move\'s range');
    assert.ok(far.x > boss.x, 'out of range of every move it did not close in');
  });
});

test('crossing a threshold changes phase once, cancels what the boss was doing, and nothing hurts it for the change', () => {
  asReaper(TEST_BOSS, () => {
    const cells = openFloor(), w = world(cells), knight = { x: 1.2, z: 0 };
    const winding = foe({ kind: 'reaper', hp: 40, maxHp: 40, windup: 0.3, cooldown: 0 });
    // The threshold is what changed the phase: a boss of 21 in 40 goes on winding its swing, one of 19 does not.
    const above = decideEnemy({ ...winding, hp: 21 }, knight, w, DT);
    assert.equal(above.phaseChange, false);
    assert.ok(above.windup > 0, 'above the threshold the boss dropped its tell');
    const change = decideEnemy({ ...winding, hp: 19 }, knight, w, DT);
    assert.equal(change.phaseChange, true, 'a boss below half its vitality did not change phase');
    assert.equal(change.windup, 0, 'the change left the swing it was winding up');
    assert.equal(change.hit, false);
    assert.deepEqual([change.phase, change.move, change.change], [1, 0, PHASE_CHANGE]);
    // A blow meant for it: it would land (the precondition, on a body with no change running), and in the change it lands nothing.
    const blowOn = (over: { change: number }) => { const struck = { kind: 'reaper' as const, hp: 19, windup: 0, cooldown: 0, hitFlash: 0, ...over }; return { struck, result: landBlow(cells, struck, { x: 0, z: 0 }, BLOW, { x: 1, z: 0 }) }; };
    const control = blowOn({ change: 0 });
    assert.equal(control.struck.hp, 16, 'the control blow did not land, so a boss that took nothing proves nothing');
    // The change runs its second, with the boss still, facing him, and the phase changing exactly once.
    let enemy = fed({ ...winding, hp: 19 }, change), frames = 0, changes = 0, immune = 0;
    while (enemy.change > 0) {
      const hit = blowOn({ change: enemy.change });
      assert.equal(hit.struck.hp, 19, `a blow took ${19 - hit.struck.hp} off a boss in the middle of a phase change`);
      assert.equal(hit.result.broke || hit.result.killed, false);
      const fire = { kind: 'reaper' as const, hp: 19, windup: 0, cooldown: 0, hitFlash: 0, change: enemy.change };
      assert.equal(burn(fire, 4), false); assert.equal(fire.hp, 19, 'fire burned a boss in the middle of a phase change');
      if (hit.result.immune) immune++;
      const intent = decideEnemy(enemy, knight, w, DT);
      if (intent.phaseChange) changes++;
      // The frame the change runs out is the boss's own again; every frame before it, it is still and committed to nothing.
      if (intent.change > 0) {
        assert.equal(intent.windup, 0, 'the boss began a move in the middle of its phase change');
        assert.equal(intent.hit || intent.loose !== null, false);
        assert.deepEqual([intent.x, intent.z], [0, 0], 'the boss moved in the middle of its phase change');
      }
      enemy = fed({ ...enemy, hp: 19 }, intent); frames++;
      assert.ok(frames < 120, 'the change never ended');
    }
    assert.ok(immune > 0, 'no blow was refused for being in the change');
    assert.equal(changes, 0, 'the phase changed again during the change');
    assert.ok(Math.abs(frames * DT - PHASE_CHANGE) < 2 * DT, `the change ran ${(frames * DT).toFixed(3)}s, not ${PHASE_CHANGE}s`);
    // Over, it is hittable again, and it carries on in the new phase, which has no threshold left to cross.
    const after = blowOn({ change: enemy.change });
    assert.equal(after.struck.hp, 16, 'the boss was still untouchable after its change');
    const next = untilWinding(enemy, knight, w);
    assert.equal(next.intent.phase, 1);
    assert.equal(next.intent.phaseChange, false);
  });
});

test('a blow that takes a boss across two thresholds enters each phase in turn and skips none', () => {
  asReaper(TEST_KING, () => {
    const cells = openFloor(), w = world(cells), knight = { x: 1.2, z: 0 };
    // From full vitality to a tenth in one blow: below both the 60% and the 25%.
    let enemy = foe({ kind: 'reaper', hp: 10, maxHp: 100, windup: 0.3 });
    const entered: { frame: number; phase: number }[] = [];
    for (let frame = 0; frame < 300; frame++) {
      const intent = decideEnemy(enemy, knight, w, DT);
      if (intent.phaseChange) entered.push({ frame, phase: intent.phase });
      enemy = fed({ ...enemy, hp: 10 }, intent);
    }
    assert.ok(entered.length > 0, 'a boss below both thresholds never changed phase');
    assert.equal(entered[0].phase, 1, `the first change entered phase ${entered[0].phase}: it skipped phase 1`);
    assert.deepEqual(entered.map(e => e.phase), [1, 2], 'the phases were not entered one after the other, once each');
    assert.ok(entered[1].frame - entered[0].frame >= PHASE_CHANGE / DT - 2, 'the second change began inside the first');
    assert.equal(enemy.phase, 2);
  });
});

test('a boss\'s blow costs what its move says, scaled by the floor as an ordinary body\'s is; everything else costs what it always did', () => {
  asReaper(TEST_BOSS, () => {
    // The sweep (slot 1 of phase 0) is 14 at the first floor and fifteen percent more for each floor below it.
    assert.equal(strikeDamage('reaper', 1, 0, 1), 14);
    assert.equal(strikeDamage('reaper', 3, 0, 1), 18, 'a boss\'s move did not grow with the floor');
    assert.equal(strikeDamage('reaper', 3, 1, 1), 13, 'the phase was not read: phase 1\'s second move is the pounce');
  });
  for (const kind of ENEMY_KINDS) for (const level of [1, 2, 3]) assert.equal(strikeDamage(kind, level), enemyStats(kind, level).damage, `${kind} on floor ${level}`);
});

// Plan 023 (D5): the two dials on how hard an ordinary body presses. Each is held at values the game does not ship, so the rule is held whatever the tuning says.
test('the recovery scale reaches every ordinary kind and never a boss (plan 023 D5)', () => {
  const bosses = ENEMY_KINDS.filter(kind => BESTIARY[kind].boss), ordinary = ENEMY_KINDS.filter(kind => !BESTIARY[kind].boss);
  assert.ok(bosses.length === 5 && ordinary.length === 9, 'precondition: five bosses and nine ordinary kinds');
  for (const kind of ordinary) assert.equal(recoveryFor(BESTIARY[kind], 0.5), BESTIARY[kind].recovery * 0.5, `a ${kind} was not made to recover at half the time`);
  for (const kind of bosses) assert.equal(recoveryFor(BESTIARY[kind], 0.5), BESTIARY[kind].recovery, `the scale reached the ${kind}, a boss`);
  // And the table the rules read is that rule at the shipped scale, kind by kind.
  assert.ok(RECOVERY_SCALE >= 0.7 && RECOVERY_SCALE <= 1, `RECOVERY_SCALE is ${RECOVERY_SCALE}: D5 allows 0.7 to 1`);
  for (const kind of ENEMY_KINDS) assert.equal(RECOVERY[kind], recoveryFor(BESTIARY[kind], RECOVERY_SCALE), `${kind}: RECOVERY is not the rule at the shipped scale`);
  for (const kind of bosses) assert.equal(RECOVERY[kind], BESTIARY[kind].recovery, `${kind}: a boss's recovery moved`);
});

test('floor damage scales an ordinary kind by FLOOR_DAMAGE and a boss by its own step, and a floor-three guard costs what it says (plan 023 D5)', () => {
  assert.equal(damageStep('guard', 0.3, 0.1), 0.3, 'an ordinary kind did not take the floor-damage step');
  assert.equal(damageStep('king', 0.3, 0.1), 0.1, 'a boss took the ordinary step');
  assert.ok(FLOOR_DAMAGE >= 0.15 && FLOOR_DAMAGE <= 0.3, `FLOOR_DAMAGE is ${FLOOR_DAMAGE}: D5 allows +15% to +30% a floor`);
  assert.equal(BOSS_FLOOR_DAMAGE, 0.15, 'a boss keeps its own step');
  // Written out: the guard's floor-one damage, two floors down.
  const base = BASE_STATS.guard.damage * ORDINARY_DAMAGE;
  assert.equal(enemyStats('guard', 1).damage, base);
  assert.equal(enemyStats('guard', 3).damage, Math.round(base * (1 + 2 * FLOOR_DAMAGE)), 'a floor-three guard does not cost two steps more');
  assert.ok(enemyStats('guard', 3).damage > base, 'precondition: the floors scale damage at all');
  assert.equal(scaledDamage(20, 3, 0.25), 30, 'the step is a share of the floor-one damage for each floor down');
  for (const kind of ENEMY_KINDS.filter(kind => BESTIARY[kind].boss && BASE_STATS[kind].damage > 0)) assert.equal(enemyStats(kind, 3).damage, scaledDamage(BASE_STATS[kind].damage, 3, BOSS_FLOOR_DAMAGE), `${kind}: a boss's stat damage moved with the ordinary step`);
});

// Plan 025 (D10): ordinary bodies hit harder by one dial, and no boss does.
test('an ordinary guard\'s swing deals ORDINARY_DAMAGE times the table\'s blow and a boss\'s swing deals its move row (plan 025 D10)', () => {
  const bosses = ENEMY_KINDS.filter(kind => BESTIARY[kind].boss), ordinary = ENEMY_KINDS.filter(kind => !BESTIARY[kind].boss);
  assert.ok(bosses.length === 5 && ordinary.length === 9, 'precondition: five bosses and nine ordinary kinds');
  assert.ok(ORDINARY_DAMAGE > 1, `precondition: ORDINARY_DAMAGE is ${ORDINARY_DAMAGE}, so a boss left alone is not the same as a boss scaled`);
  assert.ok(ORDINARY_DAMAGE >= 1.25 && ORDINARY_DAMAGE <= 1.5, `ORDINARY_DAMAGE is ${ORDINARY_DAMAGE}: D10 starts at 1.5 and steps toward 1.25`);
  // The rule, held at a scale the game does not ship.
  for (const kind of ordinary) assert.equal(damageScale(kind, 2), 2, `a ${kind} did not take the ordinary damage scale`);
  for (const kind of bosses) assert.equal(damageScale(kind, 2), 1, `the ordinary damage scale reached the ${kind}, a boss`);
  // Written out rather than through `scaledDamage`, so a scale slipped into the shared rounding cannot agree with itself: the blow, times the scale, times the floor step, rounded once.
  const ordinaryBlow = (damage: number, level: number) => Math.round(damage * ORDINARY_DAMAGE * (1 + FLOOR_DAMAGE * (level - 1)));
  const bossBlow = (damage: number, level: number) => Math.round(damage * (1 + BOSS_FLOOR_DAMAGE * (level - 1)));
  // A guard's swing, as the game and the sim read it (`strikeDamage` and `enemyStats`, which `eliteStats` builds on), on every floor.
  assert.equal(BESTIARY.guard.attack, 'swing', 'precondition: a guard swings');
  for (const level of [1, 2, 3]) {
    const swing = strikeDamage('guard', level), table = Math.round(BASE_STATS.guard.damage * (1 + FLOOR_DAMAGE * (level - 1)));
    assert.equal(swing, ordinaryBlow(BASE_STATS.guard.damage, level), `a floor-${level} guard's swing is ${swing}, not ${ORDINARY_DAMAGE} times the table's blow`);
    assert.ok(swing > table, `a floor-${level} guard's swing (${swing}) is no harder than the table's ${table}`);
  }
  for (const kind of ordinary) for (const level of [1, 2, 3]) assert.equal(enemyStats(kind, level).damage, ordinaryBlow(BASE_STATS[kind].damage, level), `a floor-${level} ${kind} is not scaled`);
  // A boss's swing is its move row, floor-scaled and nothing more; so is its stat damage.
  let swings = 0;
  for (const kind of bosses) {
    for (const level of [1, 2, 3]) {
      assert.equal(enemyStats(kind, level).damage, bossBlow(BASE_STATS[kind].damage, level), `the ${kind}'s stat damage took the ordinary damage scale on floor ${level}`);
      (BESTIARY[kind].moves ?? []).forEach((phase, p) => phase.forEach((move, m) => {
        if (move.attack !== 'swing' || move.damage <= 0) return;
        swings++;
        assert.equal(strikeDamage(kind, level, p, m), bossBlow(move.damage, level), `the ${kind}'s swing (phase ${p}, move ${m}) took the ordinary damage scale on floor ${level}`);
      }));
    }
  }
  assert.ok(swings >= 3 * 3, `precondition: the bosses' move rows hold swings to check (found ${swings / 3} a floor)`);
});
