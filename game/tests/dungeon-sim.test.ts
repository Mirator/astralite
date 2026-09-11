import assert from 'node:assert/strict';
import test from 'node:test';
import { BOONS, clearRoomReward, createRun, grantXp, heal, hurt, INVULN, rankCost, resolveKill, takeBoon, tickRun, XP_DEAD_END, XP_PER_ENEMY, type Run } from '../app/dungeon-sim.ts';

// A run with the draft already open, since every boon needs that gate held down.
const drafting = (patch: Partial<Run> = {}): Run => Object.assign(createRun(), { choosing: true, pendingRanks: 1 }, patch);
// Let the invulnerability window lapse without pretending any other time has passed.
const lapse = (run: Run) => tickRun(run, INVULN);

test('a fresh run carries every field the game restores on restart, and nothing else', () => {
  // restart() is `run = createRun()` plus the React setters, so a field added to Run and forgotten here
  // would silently survive a restart. Pinning the shape is what makes that impossible.
  assert.deepEqual(createRun(), {
    hp: 100, maxHp: 100, kills: 0, totalXp: 0,
    rankLevel: 1, rankProgress: 0, pendingRanks: 0, choosing: false,
    strike: 1, dashSpan: 1.35, reach: 0, draught: 0, guardAgainst: 1,
    invuln: 0,
  });
  // Two runs never share structure, or a restart would carry the old run's boons forward.
  const a = createRun(), b = createRun();
  a.strike = 9;
  assert.equal(b.strike, 1);
});

test('the rank ladder gets steeper and banks every rank one award can pay for', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(rankCost), [200, 350, 500, 650, 800]);
  const run = createRun();
  assert.deepEqual(grantXp(run, 199), { xp: 199, ranks: 0, healed: 0 });
  assert.equal(run.rankLevel, 1);
  assert.equal(run.rankProgress, 199);
  // Exactly on the threshold is a rank-up, not a near miss.
  assert.equal(grantXp(run, 1).ranks, 1);
  assert.deepEqual([run.rankLevel, run.rankProgress, run.pendingRanks], [2, 0, 1]);
  // One fat award can owe several boons at once: 350 + 500 paid, 100 left against rank 4's 650.
  assert.equal(grantXp(run, 950).ranks, 2);
  assert.deepEqual([run.rankLevel, run.rankProgress, run.pendingRanks], [4, 100, 3]);
  assert.equal(run.totalXp, 1150);
});

test('XP and healing refuse anything that is not a positive, finite amount', () => {
  const run = createRun();
  for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(grantXp(run, bad), { xp: 0, ranks: 0, healed: 0 });
    assert.equal(heal(run, bad), 0);
  }
  assert.deepEqual([run.totalXp, run.rankProgress, run.hp], [0, 0, 100]);
  // A junk frame delta must not resurrect an expired window, nor freeze a live one.
  run.invuln = INVULN;
  tickRun(run, Number.NaN);
  assert.equal(run.invuln, INVULN);
});

test('healing tops up to the cap and reports only what was actually restored', () => {
  const run = createRun();
  run.hp = 80;
  assert.equal(heal(run, 12), 12);
  assert.equal(heal(run, 30), 8);
  assert.equal(run.hp, 100);
  assert.equal(heal(run, 30), 0);
});

test('every boon lands exactly once, and only while a draft is open', () => {
  // An unsolicited `boon:<id>` event must not hand out a free upgrade.
  const closed = createRun();
  assert.equal(takeBoon(closed, 'edge'), null);
  assert.deepEqual(closed, createRun());
  assert.equal(takeBoon(drafting(), 'nonesuch'), null);

  const edge = drafting();
  assert.equal(takeBoon(edge, 'edge')?.name, 'Whetted Edge');
  assert.equal(edge.strike, 2);
  // Taking one boon spends one pending rank and closes the draft; the game reopens it if more are owed.
  assert.deepEqual([edge.pendingRanks, edge.choosing], [0, false]);

  const vigor = drafting({ hp: 30 });
  takeBoon(vigor, 'vigor');
  assert.deepEqual([vigor.maxHp, vigor.hp], [125, 125]);

  const step = drafting();
  takeBoon(step, 'step');
  assert.equal(step.dashSpan, 1.35 * 0.7);

  const reach = drafting();
  takeBoon(reach, 'reach');
  assert.equal(reach.reach, 0.35);

  const draught = drafting();
  takeBoon(draught, 'draught');
  assert.equal(draught.draught, 6);

  const ward = drafting();
  takeBoon(ward, 'ward');
  assert.equal(ward.guardAgainst, 0.8);
  // Wards stack multiplicatively, so a second one is worth less than the first.
  ward.choosing = true; ward.pendingRanks = 1;
  takeBoon(ward, 'ward');
  assert.ok(Math.abs(ward.guardAgainst - 0.64) < 1e-9);

  // Every offered card has to be an id takeBoon actually implements.
  for (const boon of BOONS) {
    const run = drafting();
    assert.equal(takeBoon(run, boon.id)?.id, boon.id);
    assert.notDeepEqual({ ...run, pendingRanks: 0, choosing: false }, { ...createRun(), pendingRanks: 0, choosing: false });
  }
});

test('a hit opens the same invulnerability window whatever dealt it', () => {
  // The bug: hazards used to set a 0.65s timer and melee a 0.35s one, and both gated damage, so eating a
  // 10-damage ember tick made you immune to a warden's 20-damage swing for nearly twice as long.
  const burned = createRun();
  assert.equal(hurt(burned, 10), 10);
  assert.equal(burned.invuln, INVULN);
  const cut = createRun();
  assert.equal(hurt(cut, 8, { warded: true }), 8);
  assert.equal(cut.invuln, INVULN);
  assert.equal(burned.invuln, cut.invuln);

  // Inside the window nothing lands, and a refused hit neither damages nor extends the window.
  tickRun(burned, INVULN - 0.01);
  assert.equal(hurt(burned, 20, { warded: true }), 0);
  assert.equal(burned.hp, 90);
  assert.ok(burned.invuln > 0 && burned.invuln < INVULN);

  // ...and the moment it lapses, the warden's swing lands in full.
  lapse(burned);
  assert.equal(burned.invuln, 0);
  assert.equal(hurt(burned, 20, { warded: true }), 20);
  assert.equal(burned.hp, 70);
});

test('dashing refuses a hit outright and does not spend the window', () => {
  const run = createRun();
  assert.equal(hurt(run, 20, { dashing: true, warded: true }), 0);
  assert.deepEqual([run.hp, run.invuln], [100, 0]);
  // Dash cover ends with the dash, not with a timer of its own.
  assert.equal(hurt(run, 20, { warded: true }), 20);
});

test('a Salt Ward softens enemy steel but not the embers of the keep itself', () => {
  const run = createRun();
  run.guardAgainst = 0.8;
  // 20 * 0.8 = 16, and 12 * 0.8 = 9.6 rounds to 10 — the same rounding the unmodified game used.
  assert.equal(hurt(run, 20, { warded: true }), 16);
  lapse(run);
  assert.equal(hurt(run, 12, { warded: true }), 10);
  lapse(run);
  // A hazard tick is unwarded, so it stays a flat 10 however many wards are held.
  assert.equal(hurt(run, 10), 10);
  assert.equal(run.hp, 64);
});

test('vitality stops at zero and a fallen knight takes no further hits', () => {
  const run = createRun();
  run.hp = 8;
  assert.equal(hurt(run, 20, { warded: true }), 20);
  assert.equal(run.hp, 0);
  lapse(run);
  assert.equal(hurt(run, 20, { warded: true }), 0);
  assert.equal(run.hp, 0);
});

test('a felled guard pays 25 XP and, with Grave Draught, vitality with it', () => {
  const run = createRun();
  run.hp = 50;
  assert.deepEqual(resolveKill(run), { xp: XP_PER_ENEMY, ranks: 0, healed: 0 });
  assert.deepEqual([run.kills, run.totalXp, run.hp], [1, 25, 50]);
  run.draught = 6;
  assert.deepEqual(resolveKill(run), { xp: 25, ranks: 0, healed: 6 });
  assert.deepEqual([run.kills, run.totalXp, run.hp], [2, 50, 56]);
  // Eight kills is 200 XP, exactly rank 2, and the boon it owes is banked rather than dropped.
  for (let i = 0; i < 6; i++) resolveKill(run);
  assert.deepEqual([run.kills, run.totalXp, run.rankLevel, run.pendingRanks], [8, 200, 2, 1]);
});

test('a dead end pays XP and a real heal; the trunk only tops you up', () => {
  const detour = createRun();
  detour.hp = 40;
  assert.deepEqual(clearRoomReward(detour, true), { xp: XP_DEAD_END, ranks: 0, healed: 30 });
  assert.deepEqual([detour.totalXp, detour.hp], [60, 70]);

  const trunk = createRun();
  trunk.hp = 40;
  assert.deepEqual(clearRoomReward(trunk, false), { xp: 0, ranks: 0, healed: 12 });
  assert.deepEqual([trunk.totalXp, trunk.hp], [0, 52]);

  // Neither reward overfills, and the trunk never quietly pays XP.
  const full = createRun();
  assert.deepEqual(clearRoomReward(full, false), { xp: 0, ranks: 0, healed: 0 });
  assert.equal(full.totalXp, 0);
});

// The ember rings fire for one second out of every 3.6, and used to be throttled by the very timer that
// granted invulnerability. This walks the same cadence dungeon-game.tsx drives, with the per-ring burn
// flag that replaced the timer, and pins the tick count — the window is shorter than a flare, so without
// the flag a standing knight would burn twice per flare instead of once.
const standInFlare = (seconds: number, dt = 1 / 60, offset = 0) => {
  const run = createRun();
  run.maxHp = run.hp = 10_000;
  let burned = false, wasFiring = false, flares = 0, ticks = 0;
  const at: number[] = [];
  for (let step = 1; step * dt <= seconds; step++) {
    const t = step * dt, firing = (t + offset) % 3.6 > 2.6;
    if (firing && !wasFiring) flares++;
    wasFiring = firing;
    if (!firing) burned = false;
    else if (!burned && hurt(run, 10)) { burned = true; ticks++; at.push(+t.toFixed(3)); }
    tickRun(run, dt);
  }
  return { ticks, flares, at, hp: run.hp };
};

test('a knight standing in a firing ring burns once per flare, not twice', () => {
  // 36 seconds is ten whole flare periods when the ring is unoffset.
  const ten = standInFlare(36);
  assert.deepEqual([ten.ticks, ten.flares], [10, 10]);
  assert.equal(ten.hp, 10_000 - 100);
  // Every tick is a flare period apart — never the 0.65s double tap the shared timer used to allow.
  const gaps = ten.at.slice(1).map((t, i) => t - ten.at[i]);
  for (const gap of gaps) assert.ok(Math.abs(gap - 3.6) < 0.05, `tick gap ${gap}s is not one flare period`);
  // One tick per flare holds whatever the frame rate and wherever the ring sits in its cycle, so a slow
  // frame or an unlucky room offset cannot turn a flare into two burns.
  for (const dt of [1 / 30, 1 / 120, 0.04]) { const r = standInFlare(36, dt); assert.equal(r.ticks, r.flares); assert.ok(r.flares >= 10); }
  for (const offset of [0.7, 1.4, 2.1, 2.8, 3.5]) { const r = standInFlare(36, 1 / 60, offset); assert.equal(r.ticks, r.flares); assert.ok(r.flares >= 10); }
});

test('a sword landing just before a flare still leaves the ring exactly one tick', () => {
  // A melee hit opens the window 0.1s before the ring lights up, so the burn is refused and then lands
  // once the window lapses — the flare still costs exactly one tick, not two.
  const run = createRun();
  let burned = false, ticks = 0;
  const at: number[] = [];
  for (let step = 1; step * (1 / 60) <= 3.6; step++) {
    const t = step / 60, firing = t % 3.6 > 2.6;
    if (Math.abs(t - 2.5) < 1 / 120) hurt(run, 20, { warded: true });
    if (!firing) burned = false;
    else if (!burned && hurt(run, 10)) { burned = true; ticks++; at.push(+t.toFixed(3)); }
    tickRun(run, 1 / 60);
  }
  assert.equal(ticks, 1);
  // The burn waits out the window instead of being lost with it.
  assert.ok(at[0] > 2.83 && at[0] < 2.9, `burn landed at ${at[0]}s`);
  assert.equal(run.hp, 100 - 20 - 10);
});
