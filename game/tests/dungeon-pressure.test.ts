// Plan 024 Stage B (D3): pressure. Two bodies of a room that are ready to begin a tell do not end them together: the second holds back until
// its tell would end PRESSURE_GAP after the first's. The rule is dungeon-enemy.ts's `pressure` / `pressed`; these tests drive it the way the game and the
// balance sim drive it (decideEnemy, then pressed, then feed the intent back), and read what the bodies did - the frame a tell began, the frame it ran out -
// rather than what the rule says it should have done.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey } from '../app/dungeon-floor.ts';
import { BESTIARY, decideEnemy, enemyStats, NOTICE_TIME, PRESSURE_GAP, PRESSURE_WINDOW, pressed, pressure, type EnemyKind, type EnemyView, type Pressed, type World } from '../app/dungeon-enemy.ts';
import { INVULN } from '../app/dungeon-sim.ts';

const DT = 1 / 60;
const cells = (() => { const set = new Set<string>(); for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) set.add(cellKey(x, z)); return set; })();
const world = (activeRoom = 1): World => ({ cells, activeRoom, pathDistance: (x, z) => Math.abs(x) + Math.abs(z) });
const KNIGHT = { x: 0, z: 0 };

type Slot = { kind: EnemyKind; at: { x: number; z: number }; room?: number; cooldown?: number };
type Tell = { body: number; began: number; ended: number };
type Run = { tells: Tell[]; heldFrames: number[]; shortest: Record<number, number> };

/** A room of bodies around a knight who stands still, stepped the way the game steps them: decideEnemy, `pressed`, then the intent fed back. */
const fight = (slots: readonly Slot[], seconds: number, hook?: (frame: number) => void): Run => {
  const bodies: (EnemyView & { held: number })[] = slots.map(s => ({ kind: s.kind, x: s.at.x, z: s.at.z, room: s.room ?? 1, cooldown: s.cooldown ?? 0, hitFlash: 0, windup: 0, lunge: 0, tell: enemyStats(s.kind, 1).tell, speed: enemyStats(s.kind, 1).speed, aim: { x: 1, z: 0 }, anchor: { x: s.at.x, z: s.at.z }, notice: NOTICE_TIME, hp: 100, maxHp: 100, move: 0, phase: 0, change: 0, held: 0 }));
  const tells: Tell[] = [], open = new Map<number, number>(), heldFrames = Array<number>(slots.length).fill(0), shortest: Record<number, number> = {};
  for (let frame = 0; frame < Math.round(seconds / DT); frame++) {
    hook?.(frame);
    bodies.forEach((view, i) => {
      const roster = (): Pressed[] => bodies.map(b => ({ kind: b.kind, room: b.room, dead: false, windup: b.windup, held: b.held, tell: b.tell }));
      const decided = pressed(view, decideEnemy(view, KNIGHT, world(), DT), i, roster, DT);
      const intent = decided.intent;
      if (view.windup <= 0 && intent.windup > 0) open.set(i, frame);
      if (view.windup > 0 && intent.windup <= 0 && open.has(i)) { tells.push({ body: i, began: open.get(i)!, ended: frame }); open.delete(i); }
      if (decided.held > 0) heldFrames[i]++;
      bodies[i] = { ...view, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, held: decided.held };
    });
  }
  for (const tell of tells) shortest[tell.body] = Math.min(shortest[tell.body] ?? Infinity, (tell.ended - tell.began) * DT);
  return { tells: tells.sort((a, b) => a.ended - b.ended), heldFrames, shortest };
};

const guards = (count: number): Slot[] => Array.from({ length: count }, (_, i) => ({ kind: 'guard' as const, at: { x: 1.2 * Math.cos(i * 2.1), z: 1.2 * Math.sin(i * 2.1) } }));

test('the gap is inside the window the operator approved, and the window is wider than the knight\'s invulnerability', () => {
  assert.ok(PRESSURE_GAP >= PRESSURE_WINDOW.min && PRESSURE_GAP <= PRESSURE_WINDOW.max, `the gap ${PRESSURE_GAP} is outside ${PRESSURE_WINDOW.min} to ${PRESSURE_WINDOW.max}`);
  assert.deepEqual([PRESSURE_WINDOW.min, PRESSURE_WINDOW.max], [0.4, 0.6]);
  assert.ok(PRESSURE_WINDOW.min > INVULN, `a second blow ${PRESSURE_WINDOW.min} s behind the first must fall after the ${INVULN} s the first one leaves the knight untouchable`);
});

test('two ready guards: the second tell ends 0.4 to 0.6 s after the first', () => {
  const run = fight(guards(2), 3);
  // The precondition that makes the gap mean something: both guards began a tell together, and one of them was held to make the gap.
  const first = run.tells.find(t => t.body === 0 || t.body === 1)!, second = run.tells.filter(t => t.body !== first.body)[0];
  assert.ok(first && second, `both guards should have run a tell in 3 s (${run.tells.length} tells)`);
  assert.ok(run.heldFrames[0] + run.heldFrames[1] > 0, 'neither guard was held, so there was nothing for the pressure to do');
  const gap = (second.ended - first.ended) * DT;
  assert.ok(gap >= PRESSURE_WINDOW.min - 1e-9 && gap <= PRESSURE_WINDOW.max + 1e-9, `the second tell ended ${gap.toFixed(3)} s after the first: it should end ${PRESSURE_WINDOW.min} to ${PRESSURE_WINDOW.max} s after (two guards ready together, ${run.heldFrames[1] + run.heldFrames[0]} frames held)`);
});

test('a second body that becomes ready while the first is mid-tell lines up after it, whatever the first\'s remaining tell', () => {
  // Guard 1's cooldown runs out 0.1, 0.2, 0.3 and 0.4 s after guard 0 begins: it is ready with 0.4, 0.3, 0.2, 0.1 s of guard 0's tell left.
  for (const lag of [0.1, 0.2, 0.3, 0.4]) {
    const run = fight([{ ...guards(2)[0], cooldown: 0 }, { ...guards(2)[1], cooldown: lag }], 1.5);
    const a = run.tells.find(t => t.body === 0)!, b = run.tells.find(t => t.body === 1)!;
    assert.ok(a && b, `lag ${lag}: both guards should have run a tell`);
    const gap = (b.ended - a.ended) * DT;
    assert.ok(gap >= PRESSURE_WINDOW.min - 1e-9 && gap <= PRESSURE_WINDOW.max + 1e-9, `guard 1 ready ${lag} s after guard 0 began: its tell ended ${gap.toFixed(3)} s after guard 0's, should be ${PRESSURE_WINDOW.min} to ${PRESSURE_WINDOW.max}`);
  }
});

test('three or more ready bodies never end their tells within 0.35 s of each other', () => {
  // Three guards; a guard, a warden and a stalker; four guards and a rattler (the shortest tell in the bestiary): each room is asked for 30 s of fighting.
  const rooms: Slot[][] = [
    guards(3),
    [{ kind: 'guard', at: { x: 1.2, z: 0 } }, { kind: 'warden', at: { x: -1.6, z: 0 } }, { kind: 'stalker', at: { x: 0, z: 1.1 } }],
    [...guards(4), { kind: 'rattler', at: { x: 0, z: -1 } }],
  ];
  for (const slots of rooms) {
    const run = fight(slots, 30), ends = run.tells.map(t => t.ended * DT);
    const label = slots.map(s => s.kind).join('+');
    assert.ok(ends.length >= slots.length * 3, `${label}: ${ends.length} tells in 30 s, expected at least ${slots.length * 3}`);
    assert.ok(run.heldFrames.some(frames => frames > 0), `${label}: nobody was held`);
    for (let i = 0; i + 2 < ends.length; i++) assert.ok(ends[i + 2] - ends[i] >= INVULN, `${label}: three tells ended within ${(ends[i + 2] - ends[i]).toFixed(3)} s of each other (at ${ends[i].toFixed(2)}, ${ends[i + 1].toFixed(2)}, ${ends[i + 2].toFixed(2)} s); the knight is only untouchable for ${INVULN} s`);
  }
});

test('no tell is shorter than its kind\'s: a hold delays the start, it never shortens the tell', () => {
  const slots: Slot[] = [{ kind: 'guard', at: { x: 1.2, z: 0 } }, { kind: 'warden', at: { x: -1.6, z: 0 } }, { kind: 'stalker', at: { x: 0, z: 1.1 } }, { kind: 'pyre', at: { x: 0, z: -1.1 } }, { kind: 'rattler', at: { x: 0.9, z: 0.9 } }];
  const run = fight(slots, 30);
  assert.ok(run.heldFrames.some(frames => frames > 0), 'nobody was held');
  slots.forEach((slot, i) => {
    assert.ok(run.tells.filter(t => t.body === i).length >= 2, `${slot.kind} ran fewer than two tells in 30 s`);
    // A tell begins with `tell` seconds on the clock and loses one frame's worth a frame: it cannot end in fewer frames than that.
    assert.ok(run.shortest[i] >= enemyStats(slot.kind, 1).tell - 1e-9, `a ${slot.kind} tell ran ${run.shortest[i].toFixed(3)} s, shorter than its ${enemyStats(slot.kind, 1).tell} s`);
  });
});

test('a held body shows nothing: no windup, no warning, and its aim is the one it had', () => {
  const view: EnemyView = { kind: 'guard', x: 1.2, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.5, speed: 2.2, aim: { x: 0, z: 1 }, anchor: { x: 1.2, z: 0 }, notice: NOTICE_TIME, hp: 100, maxHp: 100, move: 0, phase: 0, change: 0 };
  const other: Pressed = { kind: 'guard', room: 1, dead: false, windup: 0.4, held: 0, tell: 0.5 };
  const begins = decideEnemy(view, KNIGHT, world(), DT);
  assert.ok(begins.windup > 0 && begins.sound === 'warn', 'the precondition: this guard begins a tell and warns');
  const held = pressed(view, begins, 0, () => [{ kind: 'guard', room: 1, dead: false, windup: 0, held: 0, tell: 0.5 }, other], DT);
  assert.ok(held.held > 0, 'the guard was not held');
  assert.equal(held.intent.windup, 0);
  assert.equal(held.intent.sound, null);
  assert.deepEqual(held.intent.aim, { x: 0, z: 1 });
  // Any intent that is not the start of a tell is handed back as it came, and asks for no roster.
  const walking = decideEnemy({ ...view, cooldown: 1 }, KNIGHT, world(), DT);
  const untouched = pressed({ ...view, cooldown: 1 }, walking, 0, () => { throw new Error('the roster is only built when a tell begins'); }, DT);
  assert.equal(untouched.intent, walking);
  assert.equal(untouched.held, 0);
});

test('the numbers: a tell is lined up after the last one in its room, and never when it already is', () => {
  const body = (patch: Partial<Pressed> = {}): Pressed => ({ kind: 'guard', room: 1, dead: false, windup: 0, held: 0, tell: 0.5, ...patch });
  // A guard with 0.4 s of tell left: another guard (0.5 s tell) must wait 0.4 + 0.5 - 0.5.
  assert.ok(Math.abs(pressure([body({ windup: 0.4 }), body()], 1, DT) - 0.4) < 1e-9);
  // A warden (0.72 s) behind a guard with 0.1 s left already ends 0.62 s after it: no hold.
  assert.equal(pressure([body({ windup: 0.1 }), body({ kind: 'warden', tell: 0.72 })], 1, DT), 0, 'a tell already ending more than the gap after the last was delayed');
  // A held body counts as scheduled: its tell would end 0.3 + 0.5 from now, so the third lines up 0.5 after that.
  assert.ok(Math.abs(pressure([body({ held: 0.3 }), body({ windup: 0.1 }), body()], 2, DT) - (0.8 + PRESSURE_GAP - 0.5)) < 1e-9);
  // Bodies in another room, dead bodies and a boss are not a reason to wait; a lone body is never slowed.
  assert.equal(pressure([body({ windup: 0.4, room: 2 }), body()], 1, DT), 0, 'a tell in another room held this body');
  assert.equal(pressure([body({ windup: 0.4, dead: true }), body()], 1, DT), 0, 'a dead body held this one');
  assert.equal(pressure([body({ kind: 'captain', windup: 0.4, tell: 0.8 }), body()], 1, DT), 0, 'a boss\'s tell held an ordinary body');
  assert.equal(pressure([body()], 0, DT), 0, 'a lone body was held');
  // A boss is not held either, whoever else is mid-tell.
  assert.equal(pressure([body({ windup: 0.4 }), body({ kind: 'captain', tell: 0.8 })], 1, DT), 0, 'a boss was held');
  assert.ok(BESTIARY.captain.boss, 'the captain stands in for a boss');
  // A hold counts down by the frame and is gone when it reaches zero, not before.
  assert.ok(Math.abs(pressure([body({ held: 0.2 })], 0, DT) - (0.2 - DT)) < 1e-9);
  assert.equal(pressure([body({ held: DT / 2 })], 0, DT), 0, 'a hold shorter than a frame did not end');
});

test('a replay of the same room is identical, and a body out of reach is not held for a tell it cannot begin', () => {
  const slots = guards(2);
  const run = fight(slots, 2);
  const again = fight(slots, 2);
  assert.deepEqual(again.tells, run.tells);
  assert.deepEqual(again.heldFrames, run.heldFrames);
  const view: EnemyView = { kind: 'guard', x: 6, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.5, speed: 2.2, aim: { x: 1, z: 0 }, anchor: { x: 6, z: 0 }, notice: NOTICE_TIME, hp: 100, maxHp: 100, move: 0, phase: 0, change: 0 };
  const away = pressed({ ...view }, decideEnemy(view, KNIGHT, world(), DT), 0, () => [], DT);
  assert.equal(away.held, 0, 'a guard out of range was holding for a tell it could not begin');
});
