import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { ALERT_RADIUS, ALERT_STAGGER, BASE_STATS, HIT, HIT_COOLDOWN, hitCooldown, COMMITTED_WINDUP, CROWD_SPACING, decideEnemy, enemyStats, interruptsWindup, LUNGE_SPEED, LUNGE_TIME, nearbyDozers, NOTICE_TIME, PATROL_SPAN, PATROL_SPEED, pursuitStep, RECOVERY, separateCrowd, sweptContact, type CrowdBody, type EnemyView, type Wakeable, type World } from '../app/dungeon-enemy.ts';

// A square of open floor wide enough that nothing in these tests walks off it.
const openFloor = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
// One character per tile, '#' solid; row 0 is z = 0, column 0 is x = 0.
const floorFrom = (rows: string[]) => { const cells = new Set<string>(); rows.forEach((row, z) => row.split('').forEach((c, x) => { if (c !== '#') cells.add(cellKey(x, z)); })); return cells; };
const world = (cells: Set<string>, patch: Partial<World> = {}): World => ({ cells, activeRoom: 1, pathDistance: () => 0, ...patch });
// `notice` defaults to NOTICE_TIME, i.e. already fully alert: most of these tests are about what an
// engaged body does, and the dozing/noticing machinery gets its own tests below with notice: 0.
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'guard', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.5, speed: 2.2, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, ...patch });
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
  });
  // Floor one is exactly the base table, so every browser fixture pinned to floor one still holds.
  for (const kind of ['guard', 'stalker', 'warden'] as const) assert.deepEqual(enemyStats(kind, 1), BASE_STATS[kind]);
  assert.deepEqual([enemyStats('guard', 2).hp, enemyStats('guard', 3).hp], [3 * HIT, 4 * HIT]);
  // A floor-three stair is three wardens; at eight blades each that was a slog, so a warden grows like the rest.
  assert.deepEqual([enemyStats('warden', 2).hp, enemyStats('warden', 3).hp], [5 * HIT, 6 * HIT]);
  assert.deepEqual([1, 2, 3].map(level => enemyStats('guard', level).damage), [12, 14, 16]);
  assert.deepEqual([1, 2, 3].map(level => enemyStats('stalker', level).damage), [8, 9, 10]);
  assert.deepEqual([1, 2, 3].map(level => enemyStats('warden', level).damage), [20, 23, 26]);
  // Tells and speeds hold still so a read learned on floor one stays true.
  for (const level of [2, 3]) for (const kind of ['guard', 'stalker', 'warden'] as const) {
    assert.equal(enemyStats(kind, level).tell, BASE_STATS[kind].tell);
    assert.equal(enemyStats(kind, level).speed, BASE_STATS[kind].speed);
  }
  // Garbage levels fall back to floor one rather than to NaN vitality.
  assert.deepEqual(enemyStats('guard', Number.NaN), BASE_STATS.guard);
  assert.deepEqual(enemyStats('guard', 0), BASE_STATS.guard);
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
