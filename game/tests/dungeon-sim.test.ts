import assert from 'node:assert/strict';
import test from 'node:test';
import { freshMeta, runStart, type Meta } from '../app/dungeon-meta.ts';
import { BOONS, chamberReward, createRun, DRAFT_SIZE, draftBoons, grantXp, hurt, INVULN, rankCost, resolveKill, STRIKE_BONUS, takeBoon, tickRun, MEND, TOP_UP, XP_CACHE, XP_PER_ENEMY, type Run } from '../app/dungeon-sim.ts';

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


test('a chamber pays what its door showed, and every clear tops the knight up', () => {
  // The purse door is experience plus the top-up; the mend door is a real heal instead of it.
  const cache = createRun();
  cache.hp = 40;
  assert.deepEqual(chamberReward(cache, 'cache'), { xp: XP_CACHE, ranks: 0, healed: TOP_UP });
  assert.deepEqual([cache.totalXp, cache.hp], [60, 52]);

  const mend = createRun();
  mend.hp = 40;
  assert.deepEqual(chamberReward(mend, 'mend'), { xp: 0, ranks: 0, healed: MEND });
  assert.deepEqual([mend.totalXp, mend.hp], [0, 70]);

  // An arm's chamber, a shrine and the stair hall pay the top-up alone.
  for (const reward of ['arm', null] as const) {
    const plain = createRun();
    plain.hp = 40;
    assert.deepEqual(chamberReward(plain, reward), { xp: 0, ranks: 0, healed: TOP_UP }, String(reward));
  }

  // Nothing overfills: the heal reported is what was actually restored, up to the cap and no further.
  const nearly = createRun();
  nearly.hp = 90;
  assert.deepEqual(chamberReward(nearly, 'mend'), { xp: 0, ranks: 0, healed: 10 });
  assert.equal(nearly.hp, nearly.maxHp);
  const full = createRun();
  assert.deepEqual(chamberReward(full, 'cache'), { xp: XP_CACHE, ranks: 0, healed: 0 });

  // A purse counts toward the ladder like any other experience: one that crosses a rank says so.
  const brink = createRun();
  grantXp(brink, 150);
  assert.equal(chamberReward(brink, 'cache').ranks, 1);
  assert.deepEqual([brink.rankLevel, brink.pendingRanks], [2, 1]);
});

// --- Plan 019: a run that starts with what was bought -----------------------------------------------------
const bought = (upgrades: Meta['upgrades']): Meta => ({ ...freshMeta(), upgrades });

test('createRun() with no argument is exactly the run the game always started', () => {
  // A literal on purpose: `createRun(runStart(freshMeta()))` would agree with itself whatever it dealt.
  const today = {
    hp: 100, maxHp: 100, kills: 0, totalXp: 0,
    rankLevel: 1, rankProgress: 0, pendingRanks: 0, choosing: false,
    strike: 0, dashSpan: 0.8, reach: 0, draught: 0, guardAgainst: 1,
    invuln: 0, taken: [], specialCooldown: 0,
    draftSize: 3, defiance: 0, defied: false,
  };
  assert.deepEqual(createRun(), today, 'createRun() with no argument no longer deals the run the game always started');
  // A fresh save buys nothing, so it must start the same run.
  assert.deepEqual(createRun(runStart(freshMeta())), today, 'a fresh save no longer starts the same run');
  assert.equal(DRAFT_SIZE, 3);
});

test('each rank of Deep Lungs raises the maximum and starts the knight on a full bar', () => {
  for (const [rank, maxHp] of [[1, 110], [2, 120], [3, 130]] as const) {
    const run = createRun(runStart(bought({ lungs: rank })));
    assert.equal(run.maxHp, maxHp, `rank ${rank}`);
    assert.equal(run.hp, maxHp, `rank ${rank} began wounded`);
  }
});

test('Whetted Start, Keen Eye and Second Tide each reach the run, and nothing else moves', () => {
  const run = createRun(runStart(bought({ whet: 2, eye: 1, tide: 1 })));
  assert.deepEqual([run.strike, run.draftSize, run.defiance], [2 * STRIKE_BONUS, 4, 1]);
  assert.deepEqual({ ...run, strike: 0, draftSize: 3, defiance: 0 }, createRun(), 'a purchase changed a number it was not for');
});

test('Second Tide turns the one blow that would kill into a stand at 40% of the bar, once', () => {
  const run = createRun(runStart(bought({ lungs: 1, tide: 1 })));
  run.hp = 30;
  assert.equal(run.maxHp, 110);
  // Precondition: the blow really is lethal, or "the knight lived" proves nothing about Second Tide.
  assert.ok(40 >= run.hp, 'the blow must be enough to kill');
  assert.equal(hurt(run, 40), 40, 'the blow still reports what it dealt');
  assert.equal(run.hp, 44);
  assert.equal(run.defied, true);
  assert.equal(run.defiance, 0, 'the revive was not spent');
  // The same blow again, with the window lapsed: nothing is left to catch him.
  lapse(run);
  run.hp = 30;
  assert.ok(40 >= run.hp, 'the second blow must be lethal too');
  hurt(run, 40);
  assert.equal(run.hp, 0);
});

test('a blow that does not kill is not defied, and the revive is kept', () => {
  const run = createRun(runStart(bought({ tide: 1 })));
  hurt(run, 20);
  assert.deepEqual([run.hp, run.defied, run.defiance], [80, false, 1]);
  // Exactly lethal counts as lethal.
  lapse(run);
  run.hp = 20;
  hurt(run, 20);
  assert.deepEqual([run.hp, run.defied, run.defiance], [40, true, 0]);
});

test('the window after a defied blow is the ordinary one', () => {
  const run = createRun(runStart(bought({ tide: 1 })));
  run.hp = 5;
  hurt(run, 50);
  assert.equal(run.defied, true, 'precondition: Second Tide fired');
  assert.equal(run.invuln, INVULN);
  // And inside it a second blow is refused, as for any other hit.
  assert.equal(hurt(run, 50), 0);
  assert.equal(run.hp, 40);
});

test('Keen Eye offers four distinct cards while fewer than four boons are held', () => {
  const run = createRun(runStart(bought({ eye: 1 })));
  assert.equal(run.draftSize, 4, 'precondition: Keen Eye reached the run');
  run.taken = ['edge'];
  assert.ok(run.taken.length < 4);
  for (let trial = 0; trial < 200; trial++) {
    const offer = draftBoons(run, lcg(trial), run.draftSize);
    assert.equal(offer.length, 4);
    assert.equal(new Set(offer.map(b => b.id)).size, 4, 'a card appeared twice in one offer');
  }
  // The default stays three.
  assert.equal(draftBoons(createRun(), lcg(1), createRun().draftSize).length, 3);
});
