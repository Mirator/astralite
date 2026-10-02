// Plan 019: what a run leaves behind. One persistent currency, pearls, a short list of upgrades bought with
// it, and arms unlocked with it. Everything here is a pure function of a `Meta` and, for earning, of a
// finished run's record: the game reads and writes the save and calls in for every number, and the balance
// sim hands `runStart(meta)` to `createRun` to measure a knight who has bought things.
//
// Kept free of React, the DOM and three.js so node can execute it directly.
import type { RunEnd } from './dungeon-save.ts';
import { FOUND_WEAPONS, STARTING_WEAPON, type WeaponId } from './dungeon-weapon.ts';
import { DRAFT_SIZE, START_HP, STRIKE_BONUS } from './dungeon-sim.ts';

/**
 * How many floors a descent has. The game and the balance sim each keep their own constant; a node test holds
 * all three together, so a fourth floor cannot pay the old win bonus without somebody noticing.
 */
export const FLOORS = 3;

/** A stored balance is clamped here on the way in, so a hand-edited cell cannot hold an absurd number. */
export const PEARL_CAP = 999_999;

export type UpgradeId = 'lungs' | 'whet' | 'eye' | 'tide';
export type Meta = { pearls: number; upgrades: Partial<Record<UpgradeId, number>>; arms: WeaponId[]; arm: WeaponId };

export type Upgrade = {
  id: UpgradeId; name: string; detail: string;
  /** How many times it can be bought. */
  ranks: number;
  /** What the next rank costs, given how many are already held (0 for the first). */
  price: (held: number) => number;
};

/** Vitality one rank of Deep Lungs adds. */
export const LUNGS_HP = 10;

// PRICES ARE STILL PLACEHOLDERS (plan 019). Stage D was to set them from measured earnings against D6's target of
// about twenty human runs and write the sum and the earning assumption beside this table; it stopped first. The
// plan's stop rule tripped (2026-10-02): the weak bot with everything bought escapes 300 of 300 runs, so the
// upgrades take away the little tension that bot still has, and that is a finding for the operator, not a
// price to tune around. These numbers total 1820 pearls (upgrades 920, arms 900), about 40 runs at the Stage 0
// guess of 45 pearls a run, twice D6's target, and no test pins them. Do not read them as decided.
export const UPGRADES: readonly Upgrade[] = [
  { id: 'lungs', name: 'Deep Lungs', detail: `+${LUNGS_HP} max vitality`, ranks: 3, price: held => 60 + held * 40 },
  { id: 'whet', name: 'Whetted Start', detail: 'Begin with one more blade’s worth of bite on every strike', ranks: 2, price: held => 80 + held * 60 },
  { id: 'eye', name: 'Keen Eye', detail: 'Boon offers show four cards instead of three', ranks: 1, price: () => 150 },
  { id: 'tide', name: 'Second Tide', detail: 'Once a descent, a blow that would kill leaves you on your feet', ranks: 1, price: () => 250 },
];

export type BoughtArm = Exclude<WeaponId, 'tideblade'>;
// Placeholder, like the upgrade prices above.
export const ARM_PRICES: Record<BoughtArm, number> = { fangs: 100, spear: 100, cleaver: 150, maul: 150, crossbow: 200, flask: 200 };

/** Every arm in one fixed order, the Tideblade first: the order `Meta.arms` is always kept in. */
export const ARM_ORDER: readonly WeaponId[] = [STARTING_WEAPON, ...FOUND_WEAPONS];

const upgradeById = (id: string) => UPGRADES.find(upgrade => upgrade.id === id);
const isBoughtArm = (id: string): id is BoughtArm => Object.hasOwn(ARM_PRICES, id);
// Own-key lookup, so a stored `toString` is not a rank, and clamped, so a stray number cannot overbuy.
export const rankOf = (upgrades: Meta['upgrades'], id: UpgradeId) => {
  const upgrade = upgradeById(id), held = Object.hasOwn(upgrades, id) ? upgrades[id] : 0;
  return upgrade && typeof held === 'number' && Number.isFinite(held) ? Math.min(upgrade.ranks, Math.max(0, Math.floor(held))) : 0;
};

export const freshMeta = (): Meta => ({ pearls: 0, upgrades: {}, arms: [STARTING_WEAPON], arm: STARTING_WEAPON });

/**
 * Everything bought: every upgrade at its top rank and every arm owned, still holding the Tideblade, with no
 * pearls left. Read off `UPGRADES` and `ARM_ORDER`, so a fifth upgrade or a rank added later is bought here
 * too. The balance bands' `meta-max` policies name this rather than carrying a blob that could go stale.
 */
export const maxedMeta = (): Meta =>
  ({ pearls: 0, upgrades: Object.fromEntries(UPGRADES.map(upgrade => [upgrade.id, upgrade.ranks])), arms: [...ARM_ORDER], arm: STARTING_WEAPON });

/**
 * What a finished run pays (D3): a pearl a kill, 15 a floor behind him, 25 for getting out. A death on
 * floor 2 has one floor behind it; a win has all of them. Rattlers never count as kills, so they never pay.
 */
export const pearlsFor = (end: Pick<RunEnd, 'floor' | 'won' | 'kills'>) => {
  const floorsCompleted = end.won ? FLOORS : Math.max(0, end.floor - 1);
  return Math.max(0, end.kills) + 15 * floorsCompleted + (end.won ? 25 : 0);
};

/** A new `Meta` with the run's earnings added. Never touches its input. */
export const bank = (meta: Meta, end: Pick<RunEnd, 'floor' | 'won' | 'kills'>): Meta =>
  ({ ...meta, pearls: Math.min(PEARL_CAP, meta.pearls + pearlsFor(end)), upgrades: { ...meta.upgrades }, arms: [...meta.arms] });

/** The next rank, or null when it cannot be had: unknown id, already at the top, or too few pearls. */
export const buyUpgrade = (meta: Meta, id: string): Meta | null => {
  const upgrade = upgradeById(id);
  if (!upgrade) return null;
  const held = rankOf(meta.upgrades, upgrade.id), price = upgrade.price(held);
  if (held >= upgrade.ranks || meta.pearls < price) return null;
  return { ...meta, pearls: meta.pearls - price, upgrades: { ...meta.upgrades, [upgrade.id]: held + 1 }, arms: [...meta.arms] };
};

/** Unlocks an arm. It does not equip it (D5): `arm` is untouched. Null for the Tideblade, an owned arm, an unknown id or too few pearls. */
export const buyArm = (meta: Meta, id: string): Meta | null => {
  if (!isBoughtArm(id) || meta.arms.includes(id) || meta.pearls < ARM_PRICES[id]) return null;
  return { ...meta, pearls: meta.pearls - ARM_PRICES[id], upgrades: { ...meta.upgrades }, arms: ARM_ORDER.filter(arm => arm === id || meta.arms.includes(arm)) };
};

/** Picks the arm a run starts holding. Legal only for an owned arm. */
export const chooseArm = (meta: Meta, id: string): Meta | null =>
  ARM_ORDER.includes(id as WeaponId) && meta.arms.includes(id as WeaponId) ? { ...meta, arm: id as WeaponId, upgrades: { ...meta.upgrades }, arms: [...meta.arms] } : null;

/** What a run starts with, in `Run` terms. `createRun` consumes everything but `arm`, which the game equips. */
export type RunStart = { maxHp: number; strike: number; draftSize: number; defiance: number; arm: WeaponId };

export const runStart = (meta: Meta): RunStart => ({
  maxHp: START_HP + LUNGS_HP * rankOf(meta.upgrades, 'lungs'),
  strike: STRIKE_BONUS * rankOf(meta.upgrades, 'whet'),
  draftSize: DRAFT_SIZE + rankOf(meta.upgrades, 'eye'),
  defiance: rankOf(meta.upgrades, 'tide'),
  arm: meta.arms.includes(meta.arm) ? meta.arm : STARTING_WEAPON,
});
