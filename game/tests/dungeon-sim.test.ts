import assert from 'node:assert/strict';
import test from 'node:test';
import { BOONS, createRun, draftBoons, dwellStep, grantXp, hurt, INVULN, rankCost, resolveKill, STRIKE_BONUS, takeBoon, tickRun, XP_PER_ENEMY, type Run } from '../app/dungeon-sim.ts';

// A run with the draft already open, since every boon needs that gate held down.
const drafting = (patch: Partial<Run> = {}): Run => Object.assign(createRun(), { choosing: true, pendingRanks: 1 }, patch);
// Let the invulnerability window lapse without pretending any other time has passed.
const lapse = (run: Run) => tickRun(run, INVULN);

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

test('every boon lands exactly once, and only while a draft is open', () => {
  // An unsolicited `boon:<id>` event must not hand out a free upgrade.
  const closed = createRun();
  assert.equal(takeBoon(closed, 'edge'), null);
  assert.deepEqual(closed, createRun());
  assert.equal(takeBoon(drafting(), 'nonesuch'), null);

  const edge = drafting();
  assert.equal(takeBoon(edge, 'edge')?.name, 'Whetted Edge');
  // `strike` is the bonus on top of the held weapon, not the damage: a fresh run carries none.
  assert.equal(edge.strike, STRIKE_BONUS);
  assert.deepEqual(edge.taken, ['edge']);
  // Taking one boon spends one pending rank and closes the draft; the game reopens it if more are owed.
  assert.deepEqual([edge.pendingRanks, edge.choosing], [0, false]);

  const vigor = drafting({ hp: 30 });
  takeBoon(vigor, 'vigor');
  assert.deepEqual([vigor.maxHp, vigor.hp], [125, 125]);

  const step = drafting();
  takeBoon(step, 'step');
  assert.equal(step.dashSpan, 0.8 * 0.7);

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

// A small deterministic generator, so a draft test never flakes and never depends on Math.random.
const lcg = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

test('a draft offers three distinct cards and never repeats a held boon while an untaken one exists', () => {
  const run = createRun();
  for (let trial = 0; trial < 500; trial++) {
    const offer = draftBoons(run, lcg(trial));
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer.map(b => b.id)).size, 3, 'a card appeared twice in one offer');
  }
  // Four held, two untaken: both untaken cards are always in the offer, and the third is a repeat.
  run.taken = ['edge', 'vigor', 'step', 'reach'];
  for (let trial = 0; trial < 200; trial++) {
    const ids = draftBoons(run, lcg(trial)).map(b => b.id);
    assert.ok(ids.includes('draught') && ids.includes('ward'), `untaken cards missing from ${ids.join(",")}`);
    assert.ok(run.taken.includes(ids[2]), 'the filler must come from the taken cards');
  }
  // Everything held: stacking is still offered rather than an empty draft.
  run.taken = BOONS.map(b => b.id);
  assert.equal(draftBoons(run, lcg(1)).length, 3);
  // Taking a card removes it from the next draft, so a full run sees every boon before any repeat.
  const fresh = createRun();
  const seen = new Set<string>();
  for (let pick = 0; pick < BOONS.length; pick++) {
    fresh.choosing = true; fresh.pendingRanks = 1;
    const [card] = draftBoons(fresh, lcg(pick + 7));
    assert.ok(!seen.has(card.id), `${card.id} was offered again before the pool was exhausted`);
    seen.add(card.id); takeBoon(fresh, card.id);
  }
  assert.equal(seen.size, BOONS.length);
});

test('the draft shuffle is uniform: every card is equally likely to be offered', () => {
  const random = lcg(2026), counts = new Map<string, number>(), draws = 60000;
  for (let i = 0; i < draws; i++) for (const boon of draftBoons(createRun(), random)) counts.set(boon.id, (counts.get(boon.id) ?? 0) + 1);
  // Each of six cards should appear in half of all drafts (3 of 6 per draw). The old comparator shuffle put
  // some cards in an offer far more often than others; a fair shuffle lands within a couple of percent.
  for (const boon of BOONS) {
    const share = (counts.get(boon.id) ?? 0) / draws;
    assert.ok(Math.abs(share - 0.5) < 0.02, `${boon.id} offered in ${(share * 100).toFixed(1)}% of drafts`);
  }
});

test('a dwell fills by standing, drains twice as fast, and a dash never counts', () => {
  // The stair runs on this: a floor must never end because the knight ran across the way down.
  assert.equal(dwellStep(0, 1, true, false, 0.25), 0.25);
  assert.equal(dwellStep(0.9, 1, true, false, 0.5), 1, 'never past the cap');
  assert.ok(Math.abs(dwellStep(0.6, 1, false, false, 0.1) - 0.4) < 1e-9, 'stepping off drains double');
  assert.equal(dwellStep(0.1, 1, false, false, 0.5), 0, 'never below nothing');
  assert.equal(dwellStep(0.5, 1, true, true, 0.25), 0, 'a dash across it does not count');
  // Junk frame deltas are dropped rather than subtracted, as everywhere else in this module.
  assert.equal(dwellStep(0.4, 1, true, false, Number.NaN), 0.4);
  assert.equal(dwellStep(0.4, 1, true, false, -1), 0.4);
});
