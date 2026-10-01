import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ARM_ORDER, ARM_PRICES, bank, buyArm, buyUpgrade, chooseArm, FLOORS, freshMeta, pearlsFor, PEARL_CAP, rankOf, runStart, UPGRADES, type Meta } from '../app/dungeon-meta.ts';
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

test('a run pays a pearl a kill, 15 a floor behind him and 25 for getting out', () => {
  // Written out as arithmetic rather than through the function under test.
  assert.equal(pearlsFor({ floor: 1, won: false, kills: 0 }), 0, 'a floor-1 death with no kills has no floor behind it');
  assert.equal(pearlsFor({ floor: 1, won: false, kills: 9 }), 9);
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 20 }), 20 + 15);
  assert.equal(pearlsFor({ floor: 3, won: false, kills: 50 }), 50 + 30, 'a floor-3 death has two floors behind it, not three');
  assert.equal(pearlsFor({ floor: 3, won: true, kills: 76 }), 76 + 45 + 25);
});

test('banking adds exactly what the run paid, to a new meta, and never touches the old one', () => {
  const before = rich({ pearls: 40, upgrades: { lungs: 1 }, arms: ['tideblade', 'maul'], arm: 'maul' });
  const snapshot = JSON.parse(JSON.stringify(before)) as Meta;
  const end = { floor: 2, won: false, kills: 20 };
  assert.equal(pearlsFor(end), 35, 'precondition: the run pays something, or "added exactly" is vacuous');
  const after = bank(before, end);
  assert.equal(after.pearls, 75);
  assert.notEqual(after, before, 'bank returned the meta it was given');
  assert.deepEqual(before, snapshot, 'the input meta was changed');
  assert.deepEqual({ ...after, pearls: 0 }, { ...snapshot, pearls: 0 }, 'banking changed something besides the balance');
  // Nor do the new meta's lists alias the old one's.
  after.arms.push('spear'); after.upgrades.tide = 1;
  assert.deepEqual(before, snapshot);
  assert.equal(bank(rich({ pearls: PEARL_CAP - 1 }), { floor: 3, won: true, kills: 50 }).pearls, PEARL_CAP);
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
  assert.deepEqual(runStart(rich({ upgrades: { lungs: 3, whet: 2, eye: 1, tide: 1 }, arms: ['tideblade', 'spear'], arm: 'spear' })),
    { maxHp: 130, strike: 2 * STRIKE_BONUS, draftSize: 4, defiance: 1, arm: 'spear' });
  assert.equal(runStart(rich({ upgrades: { lungs: 1 } })).maxHp, 110);
  // A rank past the table's maximum, or an arm not owned, cannot arrive through a hand-built meta either.
  assert.equal(runStart(rich({ upgrades: { lungs: 40 } })).maxHp, 130);
  assert.equal(runStart(rich({ arm: 'maul' })).arm, 'tideblade');
  assert.equal(rankOf({ lungs: 2 }, 'lungs'), 2);
  assert.equal(rankOf({}, 'tide'), 0);
});
