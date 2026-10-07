// Plan 019: what a run leaves behind. One persistent currency, pearls, a short list of upgrades bought with
// it, and arms unlocked with it. Everything here is a pure function of a `Meta` and, for earning, of a
// finished run's record: the game reads and writes the save and calls in for every number, and the balance
// sim hands `runStart(meta)` to `createRun` to measure a knight who has bought things.
//
// Kept free of React, the DOM and three.js so node can execute it directly.
import type { RunEnd } from './dungeon-save.ts';
import { FOUND_WEAPONS, STARTING_WEAPON, weaponById, type WeaponId } from './dungeon-weapon.ts';
import { DRAFT_SIZE, START_HP } from './dungeon-sim.ts';

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

/** Strike Whetted Start adds, in the quarter-hit grain: a quarter of the blade's worth `STRIKE_BONUS` (a Whetted Edge boon) adds. */
export const WHET_STRIKE = 1;

// Prices (plan 019, operator, 2026-10-02). The whole set costs PRICE_TOTAL = 900 pearls: upgrades 450 (Deep Lungs
// 30 + 50 + 70, Whetted Start 140, Keen Eye 70, Second Tide 90) and arms 450 (50 + 60 + 70 + 80 + 90 + 100). D6 asks
// for about twenty human runs; at the Stage 0 guess of about 45 pearls a run (no human run log existed, so it is a
// guess from the formula and the bots' kills per floor) twenty runs earn 900. Two typical runs (90) buy the Twin
// Fangs and Deep Lungs' first rank together, so an early death always buys something. Whetted Start is one rank and
// the dearest single upgrade on purpose: Stage D's single-upgrade ablation found damage does the most to a bot that
// never dodges (measured on an oversized +4 version; it is +1 now). Re-decide these once a playtest log exists.
// Plan 023 (D2) re-stated the arithmetic: with waves a pearl a kill paid the default bot 200 a run (the shop in 4.5 runs), so a run is paid by chamber and the median run banks 107 for the default bot (the shop in 8.4 runs, D2 asks 7 to 11) and 52 for the weak
// bot, the nearer proxy for a new human (17.3 runs; its median is 52 against the 30 to 55 asked). Prices are unchanged, so no save is devalued.
export const PRICE_TOTAL = 900;
export const UPGRADES: readonly Upgrade[] = [
  { id: 'lungs', name: 'Deep Lungs', detail: `+${LUNGS_HP} max vitality`, ranks: 3, price: held => 30 + held * 20 },
  { id: 'whet', name: 'Whetted Start', detail: 'Begin with a quarter blade more bite on every strike', ranks: 1, price: () => 140 },
  { id: 'eye', name: 'Keen Eye', detail: 'Boon offers show four cards instead of three', ranks: 1, price: () => 70 },
  { id: 'tide', name: 'Second Tide', detail: 'Once a descent, a blow that would kill leaves you on your feet', ranks: 1, price: () => 90 },
];

export type BoughtArm = Exclude<WeaponId, 'tideblade'>;
export const ARM_PRICES: Record<BoughtArm, number> = { fangs: 50, spear: 60, cleaver: 70, maul: 80, crossbow: 90, flask: 100 };

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
 * What a finished run pays: `CHAMBER_PEARLS` for every fight chamber he cleared, `FLOOR_PEARLS` a floor behind him, 25 for getting out. A death on
 * floor 2 has one floor behind it; a win has all of them. Plan 021 (D10): ten more for every boss felled, so a run that dies to the boss on floor 3 still pays for the two behind it.
 * `bosses` and `elites` (plan 022) are optional and read as none when absent: an elite pays `ELITE_PEARLS` on top of its chamber.
 * Plan 023 (D1): it used to pay a pearl a kill, and waves roughly doubled the kills, so the shop that was meant to take about twenty runs took about four and a half.
 * A chamber is the unit a player chooses and its count a run can reach is fixed by the floor's layers, not by how many bodies a wave deals, so a later wave table cannot inflate the economy again.
 * Plan 023 (D2, Stage D): `CHAMBER_PEARLS` 1 and `FLOOR_PEARLS` 5 (it was 15) put the median run at 107 pearls for the default bot and 52 for the weak one, both inside D2's bands; at 2 and 15 the default bot banked 161.
 */
export const CHAMBER_PEARLS = 1;
export const FLOOR_PEARLS = 5;
export const BOSS_PEARLS = 10;
/** Plan 022 (D9): an elite pays a pearl of its own, on top of its chamber's. */
export const ELITE_PEARLS = 1;
export const pearlsFor = (end: Pick<RunEnd, 'floor' | 'won' | 'kills' | 'chambers'> & Partial<Pick<RunEnd, 'bosses' | 'elites'>>) => {
  const floorsCompleted = end.won ? FLOORS : Math.max(0, end.floor - 1);
  const fought = CHAMBER_PEARLS * Math.max(0, end.chambers) + FLOOR_PEARLS * floorsCompleted;
  return fought + (end.won ? 25 : 0) + BOSS_PEARLS * Math.max(0, end.bosses ?? 0) + ELITE_PEARLS * Math.max(0, end.elites ?? 0);
};

/** A new `Meta` with the run's earnings added. Never touches its input. */
export const bank = (meta: Meta, end: Pick<RunEnd, 'floor' | 'won' | 'kills' | 'chambers'> & Partial<Pick<RunEnd, 'bosses' | 'elites'>>): Meta =>
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
  strike: WHET_STRIKE * rankOf(meta.upgrades, 'whet'),
  draftSize: DRAFT_SIZE + rankOf(meta.upgrades, 'eye'),
  defiance: rankOf(meta.upgrades, 'tide'),
  arm: meta.arms.includes(meta.arm) ? meta.arm : STARTING_WEAPON,
});

// Plan 025 (D8): the hall is the shop. Every arm stands on its rack from the start, a locked one as a silhouette with its price on a plaque; standing
// there the swap key takes it into the knight's hand to try (in the hall only), and holding the key buys it. The four upgrades are shrines bought the
// same way. What follows is every rule that decides something; the hall only draws it and answers the key.

/** Seconds the swap key is held, on one press, to buy. */
export const BUY_HOLD = 0.6;

/**
 * One press of the swap key, followed frame by frame. `target` is what that press is buying (null when nothing under it can be bought), `time` how long
 * it has been held on that target, `down` whether the key was down last frame, and `spent` whether this press has already bought, or wandered off
 * the target it started on: either way it buys nothing more until the key comes up. A purchase is one press, never a held key that keeps buying ranks.
 */
export type Hold = { target: string | null; time: number; down: boolean; spent: boolean };
export const idleHold = (): Hold => ({ target: null, time: 0, down: false, spent: false });

/** The hold one frame on, and whether it buys this frame. A press that starts off a target, or moves to another, is spent until released. */
export const holdStep = (hold: Hold, down: boolean, target: string | null, dt: number): { hold: Hold; buys: boolean } => {
  if (!down) return { hold: idleHold(), buys: false };
  if (!hold.down) return { hold: { target, time: 0, down: true, spent: target === null }, buys: false };
  if (hold.spent) return { hold: { ...hold, time: hold.target === target ? hold.time : 0, target: hold.target === target ? target : null }, buys: false };
  if (target !== hold.target) return { hold: { target: null, time: 0, down: true, spent: true }, buys: false };
  const time = hold.time + Math.max(0, dt), buys = time >= BUY_HOLD;
  return { hold: { target, time: buys ? BUY_HOLD : time, down: true, spent: buys }, buys };
};

/** How full the ring is, 0 to 1. */
export const holdFill = (hold: Hold) => hold.target === null ? 0 : Math.min(1, hold.time / BUY_HOLD);

/** One thing the hall sells, as its rack, shrine and list show it: the price of what is next (null when there is nothing next), and whether it is affordable. */
export type ShopItem = { kind: 'arm' | 'upgrade'; id: string; name: string; price: number | null; held: number; ranks: number; affordable: boolean; short: number };

export const shopItem = (meta: Meta, kind: 'arm' | 'upgrade', id: string): ShopItem | null => {
  if (kind === 'arm') {
    if (!ARM_ORDER.includes(id as WeaponId)) return null;
    const owned = meta.arms.includes(id as WeaponId), price = owned || !isBoughtArm(id) ? null : ARM_PRICES[id];
    return { kind, id, name: weaponById(id).name, price, held: owned ? 1 : 0, ranks: 1, affordable: price !== null && meta.pearls >= price, short: price === null ? 0 : Math.max(0, price - meta.pearls) };
  }
  const upgrade = upgradeById(id);
  if (!upgrade) return null;
  const held = rankOf(meta.upgrades, upgrade.id), price = held >= upgrade.ranks ? null : upgrade.price(held);
  return { kind, id, name: upgrade.name, price, held, ranks: upgrade.ranks, affordable: price !== null && meta.pearls >= price, short: price === null ? 0 : Math.max(0, price - meta.pearls) };
};

/** Buys the next of an item, through the same refusals as the list: null when owned, at its top rank, unknown, or too dear. */
export const buyItem = (meta: Meta, kind: 'arm' | 'upgrade', id: string): Meta | null => kind === 'arm' ? buyArm(meta, id) : buyUpgrade(meta, id);

/** Every item that could be bought right now, as `kind:id`, in the table's order. */
export const affordable = (meta: Meta): string[] => [
  ...ARM_ORDER.map(id => shopItem(meta, 'arm', id)!).filter(item => item.affordable).map(item => `arm:${item.id}`),
  ...UPGRADES.map(upgrade => shopItem(meta, 'upgrade', upgrade.id)!).filter(item => item.affordable).map(item => `upgrade:${item.id}`),
];

/** What a bank made affordable that was not before it: the hall's pearl counter pulses when this is not empty. */
export const newlyAffordable = (before: Meta, after: Meta): string[] => { const had = new Set(affordable(before)); return affordable(after).filter(key => !had.has(key)); };

/** Whether an arm can be taken off its rack to try: any arm there is, and only in the hall. Trying never changes the save. */
export const canTry = (id: string, inHall: boolean) => inHall && ARM_ORDER.includes(id as WeaponId);

/**
 * The arm a run takes down: the one in hand if it is owned, else the owned arm he last held (the one he set down to try another), else the save's own.
 * A tried arm is never owned by being carried, so walking down with one starts the run with what he owns.
 */
export const armForRun = (meta: Meta, inHand: WeaponId, lastOwned: WeaponId): WeaponId =>
  meta.arms.includes(inHand) ? inHand : meta.arms.includes(lastOwned) ? lastOwned : meta.arms.includes(meta.arm) ? meta.arm : STARTING_WEAPON;

/** The save the way down writes: `armForRun` chosen. It never adds an arm to what is owned. */
export const settleArm = (meta: Meta, inHand: WeaponId, lastOwned: WeaponId): Meta =>
  chooseArm(meta, armForRun(meta, inHand, lastOwned)) ?? { ...meta, upgrades: { ...meta.upgrades }, arms: [...meta.arms] };

/**
 * What the card at a rack says: damage in blows of the Tideblade's first cut (the quarter-hit grain over four), reach in world units (a ranged arm's is
 * how far its shot flies), swings a second off its swing's length, and its special.
 */
export const armFacts = (id: WeaponId) => {
  const weapon = weaponById(id), reach = weapon.ranged ? weapon.ranged.speed * weapon.ranged.flight : weapon.reach;
  return { name: weapon.name, detail: weapon.detail, damage: +(weapon.damage / 4).toFixed(2), reach: +reach.toFixed(1), speed: +(1 / weapon.duration).toFixed(1), ranged: !!weapon.ranged, special: weapon.special ? { name: weapon.special.name, detail: weapon.special.detail } : null };
};

/**
 * Whether two saves hold the same things: the purse, the arm, the arms owned and every rank. Not their JSON: the save keeps upgrades in the table's order
 * whatever order they were bought in, so a purchase checked against what was read back by its string (as the altar's list once was) reported a save that
 * had worked as one that had failed, for anyone who bought Second Tide before Deep Lungs.
 */
export const sameMeta = (a: Meta, b: Meta) =>
  a.pearls === b.pearls && a.arm === b.arm && ARM_ORDER.every(id => a.arms.includes(id) === b.arms.includes(id)) && UPGRADES.every(({ id }) => rankOf(a.upgrades, id) === rankOf(b.upgrades, id));
