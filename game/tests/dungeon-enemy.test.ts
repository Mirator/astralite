import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { ACTIVATION, ATTACK_RANGE, CROWD_SPACING, decideEnemy, HOLD_RANGE, isActive, LUNGE_SPEED, LUNGE_TIME, pursuitStep, RECOVERY, separateCrowd, STRIKE_RANGE, sweptContact, type CrowdBody, type EnemyView, type World } from '../app/dungeon-enemy.ts';

// A square of open floor wide enough that nothing in these tests walks off it.
const openFloor = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
// One character per tile, '#' solid; row 0 is z = 0, column 0 is x = 0.
const floorFrom = (rows: string[]) => { const cells = new Set<string>(); rows.forEach((row, z) => row.split('').forEach((c, x) => { if (c !== '#') cells.add(cellKey(x, z)); })); return cells; };
const world = (cells: Set<string>, patch: Partial<World> = {}): World => ({ cells, activeRoom: 1, pathDistance: () => 0, ...patch });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'guard', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.5, speed: 2.2, aim: { x: 1, z: 0 }, ...patch });
const body = (patch: Partial<CrowdBody> = {}): CrowdBody => ({ x: 0, z: 0, windup: 0, dead: false, ...patch });
const near = (a: number, b: number, slack = 1e-6) => Math.abs(a - b) <= slack;

test('the tuning table is the balance, so a rebalance has to be deliberate', () => {
  // Every number a fight is decided by, in one place. Changing one here should break a design argument,
  // not slip through as an accident of refactoring.
  assert.deepEqual(ACTIVATION, { sameRoom: 22, elsewhere: 10 });
  assert.deepEqual(STRIKE_RANGE, { guard: 1.55, stalker: 1.55, warden: 2.55 });
  assert.deepEqual(ATTACK_RANGE, { guard: 1.15, stalker: 4.2, warden: 2.2 });
  assert.deepEqual(HOLD_RANGE, { guard: 1.15, stalker: 1.15, warden: 2.0 });
  assert.deepEqual(RECOVERY, { guard: 1.25, stalker: 1.7, warden: 1.6 });
  assert.deepEqual([LUNGE_SPEED, LUNGE_TIME, CROWD_SPACING], [13, 0.32, 0.82]);
  // A warden reaches further than a guard both to commit and to connect; a stalker commits from furthest
  // of all because it closes the gap itself.
  assert.ok(ATTACK_RANGE.warden > ATTACK_RANGE.guard && STRIKE_RANGE.warden > STRIKE_RANGE.guard);
  assert.ok(ATTACK_RANGE.stalker > ATTACK_RANGE.warden);
});

test('the activation cutoff is generous in the knight\'s own room and tight everywhere else', () => {
  assert.deepEqual([22, 23].map(d => isActive(d, true)), [true, false]);
  assert.deepEqual([10, 11].map(d => isActive(d, false)), [true, false]);
  // A cell the flood never reached is unreachable, not adjacent.
  assert.equal(isActive(Infinity, true), false);
  assert.equal(isActive(Number.NaN, true), false);
});

test('a body too far to matter does nothing but finish recovering', () => {
  const cells = openFloor();
  // 11 steps away, and the knight is in another room: past the tight cutoff.
  const away = decideEnemy(foe({ cooldown: 1, hitFlash: 0.2, windup: 0.3, room: 2 }), { x: 0.5, z: 0 }, world(cells, { activeRoom: 1, pathDistance: () => 11 }), 0.1);
  assert.equal(away.act, 'inert');
  // Recovery still runs, or walking back into a hall would hand the player a free swing it never earned.
  assert.equal(near(away.cooldown, 0.9), true);
  assert.equal(near(away.hitFlash, 0.1), true);
  // Nothing else moved: same spot, same commitment.
  assert.deepEqual([away.x, away.z, away.windup, away.hit, away.sound], [0, 0, 0.3, false, null]);
  // The same body in the knight's own room is inside the generous cutoff and acts.
  assert.notEqual(decideEnemy(foe({ room: 1, windup: 0.3 }), { x: 0.5, z: 0 }, world(cells, { activeRoom: 1, pathDistance: () => 11 }), 0.1).act, 'inert');
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
  assert.equal(decideEnemy(foe(), { x: 0, z: 1.2 }, world(cells), 0.05).windup, 0, 'past 1.15 a guard has to walk');
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

test('a junk frame delta is dropped rather than subtracted', () => {
  // A hidden tab, a stalled worker or a NaN clock would otherwise poison a cooldown permanently: NaN is
  // never <= 0, so the body could never swing again.
  for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const idle = decideEnemy(foe({ cooldown: 0.5, hitFlash: 0.2 }), { x: 6, z: 0 }, world(openFloor()), dt);
    assert.deepEqual([idle.cooldown, idle.hitFlash, idle.x, idle.z], [0.5, 0.2, 0, 0]);
  }
  assert.deepEqual(separateCrowd(openFloor(), [body({ x: 0, z: 0 }), body({ x: 0.4, z: 0 })], Number.NaN), [{ x: 0, z: 0 }, { x: 0.4, z: 0 }]);
});

test('a guard always walks the tile grid, because its commit range and its hold range are the same number', () => {
  // Current behaviour, pinned rather than fixed. The straight-line step is only taken when the attack
  // line is already clear, and a clear line for a guard means it is inside 1.15 - which is also the range
  // at which it stops walking. So the two conditions can never both hold and a guard only ever steps from
  // tile centre to tile centre. A warden, whose commit range (2.2) is wider than its hold range (2.0),
  // does get the straight-line step in that gap.
  const w = world(openFloor(), { pathDistance: (x, z) => Math.abs(x) + Math.abs(z - 2) });
  const guard = decideEnemy(foe({ cooldown: 0.5 }), { x: 1, z: 1.8 }, w, 0.1);
  assert.equal(guard.x, 0, 'a guard 2.06 away stepped diagonally, so the straight line is live after all');
  assert.ok(guard.z > 0);
  const warden = decideEnemy(foe({ kind: 'warden', speed: 1.65, tell: 0.72, cooldown: 0.5 }), { x: 1, z: 1.8 }, w, 0.1);
  assert.ok(warden.x > 0, 'a warden inside its commit range but outside its hold range walks straight at him');
});
