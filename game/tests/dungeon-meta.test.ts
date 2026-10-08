import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { affordable, armFacts, armForRun, ARM_ORDER, ARM_PRICES, bank, BUY_HOLD, canTry, holdFill, holdStep, idleHold, newlyAffordable, sameMeta, settleArm, shopItem, type Hold, BOSS_PEARLS, buyArm, buyUpgrade, CHAMBER_PEARLS, chooseArm, ELITE_PEARLS, FLOOR_PEARLS, FLOORS, freshMeta, maxedMeta, pearlsFor, PEARL_CAP, PRICE_TOTAL, rankOf, runStart, UPGRADES, WHET_STRIKE, type Meta } from '../app/dungeon-meta.ts';
import { FLOORS as SIM_FLOORS } from '../scripts/balance/sim.ts';
import { STRIKE_BONUS } from '../app/dungeon-sim.ts';
import { FOUND_WEAPONS } from '../app/dungeon-weapon.ts';

const rich = (patch: Partial<Meta> = {}): Meta => ({ ...freshMeta(), pearls: 5000, ...patch });
const upgrade = (id: string) => UPGRADES.find(u => u.id === id)!;

test('a fresh meta holds nothing, owns the Tideblade only, and carries it', () => {
  assert.deepEqual(freshMeta(), { pearls: 0, upgrades: {}, arms: ['tideblade'], arm: 'tideblade' });
  // Two fresh metas share nothing, so editing one never edits the next.
  const a = freshMeta(); a.arms.push('maul'); a.upgrades.lungs = 1;
  assert.deepEqual(freshMeta(), { pearls: 0, upgrades: {}, arms: ['tideblade'], arm: 'tideblade' });
});

test('every arm but the Tideblade has a price, in one fixed order', () => {
  assert.deepEqual(Object.keys(ARM_PRICES).sort(), [...FOUND_WEAPONS].sort());
  assert.deepEqual(ARM_ORDER, ['tideblade', ...FOUND_WEAPONS]);
  for (const arm of FOUND_WEAPONS) assert.ok(ARM_PRICES[arm as keyof typeof ARM_PRICES] > 0, arm);
});

test('the floor count the earnings rule uses is the one the sim and the game play', () => {
  assert.equal(FLOORS, SIM_FLOORS);
  const source = readFileSync(new URL('../app/dungeon-game.tsx', import.meta.url), 'utf8');
  assert.equal(Number(/^const FLOORS = (\d+);/m.exec(source)?.[1]), FLOORS);
});

// Plan 023 (D1): a run is paid for the fight chambers it cleared, not for the bodies it felled. Waves roughly doubled the kills a floor holds, and a pearl a kill took the 900-pearl shop from about twenty
// runs to about four and a half; a chamber's count is fixed by the floor's layers, so a bigger wave table cannot move the economy again.
test('a run pays CHAMBER_PEARLS a fight chamber cleared, FLOOR_PEARLS a floor behind him and 25 for getting out, whatever its kill count', () => {
  assert.ok(CHAMBER_PEARLS > 0, 'precondition: a chamber pays something, or "whatever the kills" is vacuous');
  assert.equal(pearlsFor({ floor: 1, won: false, kills: 0, chambers: 0 }), 0, 'a floor-1 death in the first chamber has nothing behind it');
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 20, chambers: 4 }), 4 * CHAMBER_PEARLS + FLOOR_PEARLS, 'four chambers and a floor behind him do not pay four chambers\' pearls and a floor\'s');
  assert.equal(pearlsFor({ floor: 3, won: true, kills: 76, chambers: 14 }), 14 * CHAMBER_PEARLS + 3 * FLOOR_PEARLS + 25, 'a win does not pay its chambers, three floors and the escape');
  const few = pearlsFor({ floor: 3, won: false, kills: 10, chambers: 6 }), many = pearlsFor({ floor: 3, won: false, kills: 80, chambers: 6 });
  assert.equal(few, many, 'a run that felled eight times the bodies in the same chambers was paid for them');
  assert.equal(pearlsFor({ floor: 3, won: false, kills: 10, chambers: 7 }) - few, CHAMBER_PEARLS, 'one more chamber is not worth exactly CHAMBER_PEARLS');
  assert.equal(bank(rich({ pearls: 5 }), { floor: 2, won: false, kills: 80, chambers: 4 }).pearls, 5 + 4 * CHAMBER_PEARLS + FLOOR_PEARLS, 'banking pays the kills a wave dealt');
});

test('an elite pays ELITE_PEARLS on top of its chamber, and a boss BOSS_PEARLS', () => {
  assert.ok(ELITE_PEARLS > 0, 'precondition: an elite pays something');
  const plain = pearlsFor({ floor: 2, won: false, kills: 30, chambers: 5 });
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 30, chambers: 5, elites: 4 }) - plain, 4 * ELITE_PEARLS);
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 30, chambers: 5, bosses: 1 }) - plain, 10);
});

// Plan 021 (D10): ten pearls for every boss felled, on top of the chambers (a boss's chamber is also a chamber), and a run that dies to a boss still pays for the bosses behind it.
test('every boss felled pays BOSS_PEARLS, however many other bodies fell', () => {
  const chambers = (n: number) => n * CHAMBER_PEARLS;
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 20, chambers: 4, bosses: 1 }), chambers(4) + FLOOR_PEARLS + BOSS_PEARLS, 'a boss on floor one is BOSS_PEARLS, not that for each of the twenty kills');
  assert.equal(pearlsFor({ floor: 3, won: false, kills: 50, chambers: 9, bosses: 2 }), chambers(9) + 2 * FLOOR_PEARLS + 2 * BOSS_PEARLS, 'a death to the last boss pays for the two behind it');
  assert.equal(pearlsFor({ floor: 3, won: true, kills: 76, chambers: 14, bosses: 3 }), chambers(14) + 3 * FLOOR_PEARLS + 25 + 3 * BOSS_PEARLS);
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 20, chambers: 4 }), pearlsFor({ floor: 2, won: false, kills: 20, chambers: 4, bosses: 0 }), 'no boss count is not the same as no bosses');
  assert.equal(bank(rich({ pearls: 5 }), { floor: 2, won: false, kills: 20, chambers: 4, bosses: 1 }).pearls, 5 + chambers(4) + FLOOR_PEARLS + BOSS_PEARLS, 'banking leaves the boss pearls out');
});

test('banking adds exactly what the run paid, to a new meta, and never touches the old one', () => {
  const before = rich({ pearls: 40, upgrades: { lungs: 1 }, arms: ['tideblade', 'maul'], arm: 'maul' });
  const snapshot = JSON.parse(JSON.stringify(before)) as Meta;
  const end = { floor: 2, won: false, kills: 20, chambers: 4 };
  assert.equal(pearlsFor(end), 4 * CHAMBER_PEARLS + FLOOR_PEARLS, 'precondition: the run pays something, or "added exactly" is vacuous');
  const after = bank(before, end);
  assert.equal(after.pearls, 40 + 4 * CHAMBER_PEARLS + FLOOR_PEARLS);
  assert.notEqual(after, before, 'bank returned the meta it was given');
  assert.deepEqual(before, snapshot, 'the input meta was changed');
  assert.deepEqual({ ...after, pearls: 0 }, { ...snapshot, pearls: 0 }, 'banking changed something besides the balance');
  // Nor do the new meta's lists alias the old one's.
  after.arms.push('spear'); after.upgrades.tide = 1;
  assert.deepEqual(before, snapshot);
  assert.equal(bank(rich({ pearls: PEARL_CAP - 1 }), { floor: 3, won: true, kills: 50, chambers: 14 }).pearls, PEARL_CAP);
});

test('an upgrade is bought one rank at a time, at the price of the rank it buys', () => {
  const lungs = upgrade('lungs');
  assert.notEqual(lungs.price(0), lungs.price(1), 'precondition: ranks differ in price, or charging the wrong rank cannot show');
  const first = buyUpgrade(rich({ pearls: 1000 }), 'lungs');
  assert.deepEqual([first?.upgrades, first?.pearls], [{ lungs: 1 }, 1000 - lungs.price(0)], 'the first rank was not charged at the first rank\'s price');
  const second = buyUpgrade(first!, 'lungs');
  assert.deepEqual([second?.upgrades, second?.pearls], [{ lungs: 2 }, 1000 - lungs.price(0) - lungs.price(1)], 'the second rank was not charged at the second rank\'s price');
  // Every rank of every upgrade can be had, in turn, and the one after the last cannot.
  let meta: Meta | null = rich({ pearls: PEARL_CAP });
  for (const { id, ranks } of UPGRADES) {
    for (let rank = 1; rank <= ranks; rank++) { meta = buyUpgrade(meta!, id); assert.equal(meta?.upgrades[id], rank, `${id} rank ${rank}`); }
    assert.equal(buyUpgrade(meta!, id), null, `${id} past its last rank`);
  }
});

test('an upgrade is refused for too few pearls, at its top rank, or by an unknown name', () => {
  const lungs = upgrade('lungs');
  assert.equal(buyUpgrade(rich({ pearls: lungs.price(0) - 1 }), 'lungs'), null, 'one pearl short');
  assert.notEqual(buyUpgrade(rich({ pearls: lungs.price(0) }), 'lungs'), null, 'exactly enough must buy');
  assert.equal(buyUpgrade(rich({ upgrades: { lungs: lungs.ranks } }), 'lungs'), null, 'already at the top');
  assert.equal(buyUpgrade(rich(), 'ghost'), null);
  assert.equal(buyUpgrade(rich(), 'toString'), null);
  assert.equal(buyUpgrade(rich(), ''), null);
});

test('buying an arm unlocks it, charges its price and equips nothing', () => {
  const before = rich({ pearls: 1000 });
  const after = buyArm(before, 'maul');
  assert.deepEqual(after?.arms, ['tideblade', 'maul']);
  assert.equal(after?.pearls, 1000 - ARM_PRICES.maul);
  assert.equal(after?.arm, before.arm, 'buying an arm must not equip it');
  assert.deepEqual(before.arms, ['tideblade'], 'the input was changed');
  // Bought out of order, the list still comes back in the table's order.
  assert.deepEqual(buyArm(buyArm(rich(), 'flask')!, 'fangs')?.arms, ['tideblade', 'fangs', 'flask']);
});

test('an arm is refused when owned, when it is the Tideblade, when unknown, or too dear', () => {
  assert.equal(buyArm(rich({ arms: ['tideblade', 'maul'] }), 'maul'), null, 'already owned');
  assert.equal(buyArm(rich(), 'tideblade'), null, 'the Tideblade is never for sale');
  assert.equal(buyArm(rich(), 'lance'), null);
  assert.equal(buyArm(rich(), 'toString'), null);
  assert.equal(buyArm(rich({ pearls: ARM_PRICES.maul - 1 }), 'maul'), null, 'one pearl short');
  assert.notEqual(buyArm(rich({ pearls: ARM_PRICES.maul }), 'maul'), null, 'exactly enough must buy');
});

test('only an owned arm can be chosen', () => {
  const meta = rich({ arms: ['tideblade', 'spear'] });
  assert.equal(chooseArm(meta, 'spear')?.arm, 'spear');
  assert.equal(chooseArm(meta, 'tideblade')?.arm, 'tideblade');
  assert.equal(chooseArm(meta, 'maul'), null, 'an arm not bought');
  assert.equal(chooseArm(meta, 'lance'), null, 'not an arm');
  assert.equal(chooseArm(meta, 'toString'), null);
  assert.equal(meta.arm, 'tideblade', 'the input was changed');
});

test('a run starts with exactly what the ranks held add up to', () => {
  assert.deepEqual(runStart(freshMeta()), { maxHp: 100, strike: 0, draftSize: 3, defiance: 0, arm: 'tideblade' });
  assert.deepEqual(runStart(rich({ upgrades: { lungs: 3, whet: 1, eye: 1, tide: 1 }, arms: ['tideblade', 'spear'], arm: 'spear' })),
    { maxHp: 130, strike: WHET_STRIKE, draftSize: 4, defiance: 1, arm: 'spear' });
  assert.equal(runStart(rich({ upgrades: { lungs: 1 } })).maxHp, 110);
  // A rank past the table's maximum, or an arm not owned, cannot arrive through a hand-built meta either.
  assert.equal(runStart(rich({ upgrades: { lungs: 40 } })).maxHp, 130);
  assert.equal(runStart(rich({ arm: 'maul' })).arm, 'tideblade');
  assert.equal(rankOf({ lungs: 2 }, 'lungs'), 2);
  assert.equal(rankOf({}, 'tide'), 0);
});

test('the maxed meta has bought everything there is: nothing is left to buy and the run starts at the top of every rank', () => {
  const all = maxedMeta();
  // Observed from the table's side: every upgrade refuses another rank and every arm refuses a second purchase,
  // so an upgrade or an arm the maxed meta forgot would be bought here and fail.
  const rich = { ...all, pearls: PEARL_CAP };
  for (const { id } of UPGRADES) assert.equal(buyUpgrade(rich, id), null, `${id} still had a rank to buy`);
  for (const arm of FOUND_WEAPONS) assert.equal(buyArm(rich, arm), null, `${arm} was not owned`);
  assert.equal(all.arms.length, 1 + FOUND_WEAPONS.length, 'precondition: the Tideblade and every other arm');
  assert.deepEqual(runStart(all), { maxHp: 130, strike: WHET_STRIKE, draftSize: 4, defiance: 1, arm: 'tideblade' });
  assert.equal(all.pearls, 0, 'a maxed knight carries no pearls');
  // Two calls share nothing.
  maxedMeta().arms.pop();
  assert.equal(maxedMeta().arms.length, all.arms.length);
});

// Plan 019 Stage D (2026-10-02): the whole set is priced against about twenty human runs at the Stage 0 guess of 45
// pearls a run. The arithmetic is written beside the table in dungeon-meta.ts; a price changed here without the
// comment and PRICE_TOTAL changing with it fails.
test('everything costs PRICE_TOTAL, and two typical runs buy an arm and a rank', () => {
  const upgrades = UPGRADES.reduce((sum, upgrade) => sum + Array.from({ length: upgrade.ranks }, (_, held) => upgrade.price(held)).reduce((a, b) => a + b, 0), 0);
  const arms = Object.values(ARM_PRICES).reduce((a, b) => a + b, 0);
  assert.equal(upgrades + arms, PRICE_TOTAL, `the table sums to ${upgrades} + ${arms}, not the ${PRICE_TOTAL} its comment explains`);
  assert.equal(PRICE_TOTAL, 900, 'PRICE_TOTAL moved; update the arithmetic beside the table');
  const twoRuns = 2 * 45, cheapestArm = Math.min(...Object.values(ARM_PRICES)), cheapestRank = Math.min(...UPGRADES.map(upgrade => upgrade.price(0)));
  assert.ok(cheapestArm + cheapestRank <= twoRuns, `two typical runs (${twoRuns}) no longer buy the cheapest arm (${cheapestArm}) and rank (${cheapestRank})`);
  assert.equal(UPGRADES.find(upgrade => upgrade.id === 'whet')?.ranks, 1, 'Whetted Start was cut to one rank (operator, 2026-10-02)');
  assert.ok(WHET_STRIKE < STRIKE_BONUS, 'Whetted Start must add less than a Whetted Edge boon');
});

// Plan 025 (D8): the hall is the shop. Holding the swap key buys; these are the rules the hall answers the key with.
// A hold stepped at 60 frames a second for `seconds` on one target, the key down throughout; the number of purchases it made.
const holdFor = (seconds: number, target: string | null = 'upgrade:lungs', from: Hold = idleHold()) => {
  let hold = from, buys = 0;
  for (let t = 0; t < seconds; t += 1 / 60) { const step = holdStep(hold, true, target, 1 / 60); hold = step.hold; if (step.buys) buys++; }
  return { hold, buys };
};

test('a hold buys once it has run BUY_HOLD on one target, never on the press, and only once a press', () => {
  assert.equal(BUY_HOLD, 0.6, 'the plan asks for a 0.6 s hold');
  const first = holdStep(idleHold(), true, 'upgrade:lungs', 1 / 60);
  assert.equal(first.buys, false, 'the press itself bought');
  const short = holdFor(BUY_HOLD - 0.05);
  assert.equal(short.buys, 0, 'a hold short of BUY_HOLD bought');
  assert.ok(holdFill(short.hold) > 0.8 && holdFill(short.hold) < 1, `precondition: the ring was nearly full (${holdFill(short.hold)}), so the refusal is about time and not a hold that never ran`);
  assert.equal(holdFor(BUY_HOLD + 0.05).buys, 1, 'a hold past BUY_HOLD did not buy');
  // Held on for three times as long, on an upgrade with ranks to spare: still one purchase, and the ring stays full until the key comes up.
  const long = holdFor(BUY_HOLD * 3);
  assert.equal(long.buys, 1, 'a long hold bought more than once');
  assert.equal(holdFill(long.hold), 1);
  const released = holdStep(long.hold, false, 'upgrade:lungs', 1 / 60);
  assert.deepEqual([released.buys, holdFill(released.hold)], [false, 0], 'letting go bought, or left the ring filled');
  assert.equal(holdFor(BUY_HOLD + 0.05, 'upgrade:lungs', released.hold).buys, 1, 'a fresh press after the release did not buy again');
});

test('a hold that starts on nothing, or leaves its target, is spent until the key comes up', () => {
  // Pressed on bare floor, then walked onto a shrine with the key still down: nothing is bought by arriving.
  let hold = holdStep(idleHold(), true, null, 1 / 60).hold;
  assert.equal(holdFor(BUY_HOLD * 2, 'upgrade:lungs', hold).buys, 0, 'walking onto a shrine with the key held bought');
  // Halfway on one shrine, then onto another: the second does not inherit the first's time, nor start its own.
  hold = holdFor(BUY_HOLD / 2, 'upgrade:lungs').hold;
  assert.ok(holdFill(hold) > 0.4, 'precondition: the first hold was under way');
  assert.equal(holdFor(BUY_HOLD * 2, 'upgrade:eye', hold).buys, 0, 'moving to another target mid-hold bought it');
  // Released between, it buys.
  assert.equal(holdFor(BUY_HOLD + 0.05, 'upgrade:eye', holdStep(hold, false, null, 1 / 60).hold).buys, 1);
});

test('a shop item names its next price and whether it is affordable; too few pearls is short by the difference, and a top rank has no price', () => {
  const lungs = upgrade('lungs');
  assert.deepEqual(shopItem(rich({ pearls: lungs.price(0) - 1 }), 'upgrade', 'lungs'), { kind: 'upgrade', id: 'lungs', name: 'Deep Lungs', price: lungs.price(0), held: 0, ranks: 3, affordable: false, short: 1 });
  const second = shopItem(rich({ pearls: lungs.price(1), upgrades: { lungs: 1 } }), 'upgrade', 'lungs');
  assert.deepEqual([second?.price, second?.affordable], [lungs.price(1), true], 'the second rank is not priced as the second rank, or exactly enough for it is not affordable');
  // The rank cap: at the top there is nothing to price, whatever the purse.
  assert.deepEqual(shopItem(rich({ upgrades: { lungs: 3 } }), 'upgrade', 'lungs'), { kind: 'upgrade', id: 'lungs', name: 'Deep Lungs', price: null, held: 3, ranks: 3, affordable: false, short: 0 }, 'at the top rank there is still a price');
  assert.equal(shopItem(rich({ upgrades: { tide: 1 } }), 'upgrade', 'tide')?.price, null);
  assert.deepEqual(shopItem(rich({ pearls: 10 }), 'arm', 'maul'), { kind: 'arm', id: 'maul', name: 'Bell Maul', price: ARM_PRICES.maul, held: 0, ranks: 1, affordable: false, short: ARM_PRICES.maul - 10 });
  assert.equal(shopItem(rich({ arms: ['tideblade', 'maul'] }), 'arm', 'maul')?.price, null, 'an owned arm still has a price');
  assert.equal(shopItem(rich(), 'arm', 'tideblade')?.price, null, 'the Tideblade has a price');
  assert.equal(shopItem(rich(), 'arm', 'lance'), null);
  assert.equal(shopItem(rich(), 'upgrade', 'toString'), null);
});

test('what is affordable follows the purse, and a bank names only what it newly put in reach', () => {
  assert.deepEqual(affordable(freshMeta()), [], 'an empty purse affords something');
  const lungs = upgrade('lungs').price(0);
  assert.deepEqual(affordable(rich({ pearls: lungs })), ['upgrade:lungs'], `${lungs} pearls afford exactly the first rank of Deep Lungs`);
  assert.deepEqual(affordable(rich({ pearls: ARM_PRICES.fangs })), ['arm:fangs', 'upgrade:lungs']);
  assert.deepEqual(newlyAffordable(rich({ pearls: lungs }), rich({ pearls: ARM_PRICES.fangs })), ['arm:fangs'], 'the bank named what was already in reach');
  assert.deepEqual(newlyAffordable(rich({ pearls: ARM_PRICES.fangs }), rich({ pearls: ARM_PRICES.fangs + 1 })), [], 'a pearl more made nothing new affordable');
});

test('a tried arm is not owned: trying is the hall\'s alone, and the way down settles an owned arm, never the one tried', () => {
  assert.equal(canTry('maul', true), true);
  assert.equal(canTry('maul', false), false, 'an arm can be tried outside the hall');
  assert.equal(canTry('lance', true), false);
  const meta = rich({ arms: ['tideblade', 'spear'], arm: 'tideblade' });
  // He set the spear down to try the maul: the run takes the spear, the arm he owns and last held.
  assert.equal(armForRun(meta, 'maul', 'spear'), 'spear', 'the run takes the arm tried');
  assert.equal(armForRun(meta, 'spear', 'tideblade'), 'spear', 'an owned arm in hand is not the one taken');
  assert.equal(armForRun(meta, 'maul', 'cleaver'), 'tideblade', 'with nothing owned to fall back on, the save\'s own arm');
  const settled = settleArm(meta, 'maul', 'spear');
  assert.equal(settled.arm, 'spear', 'the way down wrote the arm tried');
  assert.deepEqual(settled.arms, ['tideblade', 'spear'], 'carrying the maul down made it owned');
  assert.equal(settled.pearls, meta.pearls, 'settling the arm spent pearls');
  assert.deepEqual(meta.arms, ['tideblade', 'spear'], 'the input was changed');
});

test('the card at a rack reads its arm: damage in blows, reach, swings a second, and the special', () => {
  assert.deepEqual(armFacts('tideblade'), { name: 'Tideblade', detail: 'The blade you came in with. Even in every way.', damage: 1, reach: 1.8, speed: 2.6, ranged: false, special: { name: 'Undertow Lunge', detail: 'The Tideblade lunges along your aim and cuts everything on the line.' } });
  // A ranged arm's reach is how far its shot flies, not the notch it leaves from.
  assert.deepEqual([armFacts('crossbow').reach, armFacts('crossbow').ranged], [11.8, true]);
  assert.ok(armFacts('maul').damage > armFacts('tideblade').damage, 'precondition: the arms differ, or a card that showed the Tideblade for all would pass');
});

// Plan 025: the hall's purchase and the altar's list check what was written by reading it back. The save keeps upgrades in the table's order, so a string
// comparison called a working save a failed one whenever Second Tide was bought before Deep Lungs.
test('two saves holding the same things are the same save, whatever order their upgrades were bought in', () => {
  const read = rich({ upgrades: { lungs: 1, tide: 1 }, arms: ['tideblade', 'maul'] }), bought = rich({ upgrades: { tide: 1, lungs: 1 }, arms: ['tideblade', 'maul'] });
  assert.notEqual(JSON.stringify(read), JSON.stringify(bought), 'precondition: the two are spelled differently');
  assert.equal(sameMeta(read, bought), true, 'the same ranks in another order are not the same save');
  assert.equal(sameMeta(read, { ...bought, upgrades: { tide: 1, lungs: 2 } }), false, 'a rank more is the same save');
  assert.equal(sameMeta(read, { ...bought, pearls: bought.pearls - 1 }), false, 'a pearl less is the same save');
  assert.equal(sameMeta(read, { ...bought, arms: ['tideblade'] }), false, 'an arm less is the same save');
  assert.equal(sameMeta(read, { ...bought, arm: 'maul' }), false, 'another arm in hand is the same save');
});
