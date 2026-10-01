// One rounding rule for every blow that lands, shared with the game's contact test so a node test and the
// running keep agree on the number.
import { incomingDamage } from './dungeon-combat.ts';
import type { Reward as ChamberReward } from './dungeon-floor.ts';
import type { RunStart } from './dungeon-meta.ts';

// The numeric half of a run: vitality, experience, rank, boons and the rules that decide whether a hit
// lands. Nothing here knows about three.js, the DOM or a clock — dungeon-game.tsx owns the world and
// calls in for every number an outcome depends on, so these rules can be tested in node instead of by
// hand-driving a browser, which is how every combat regression in this project has been caught so far.
export type Boon = { id: string; name: string; detail: string };

export const BOONS: Boon[] = [
  { id: 'edge', name: 'Whetted Edge', detail: 'One more blade’s worth of bite on every strike' },
  { id: 'vigor', name: 'Tidal Vigor', detail: '+25 max vitality, filled now' },
  { id: 'step', name: 'Quick Step', detail: 'Evasion recovers 30% faster' },
  { id: 'reach', name: 'Long Guard', detail: 'Longer, wider strike arc' },
  { id: 'draught', name: 'Grave Draught', detail: '+6 vitality per guard felled' },
  { id: 'ward', name: 'Salt Ward', detail: 'Take 20% less damage from enemy blows' },
];

// One more starting-blade's worth of damage, in the quarter-hit grain dungeon-enemy quotes vitality in.
export const STRIKE_BONUS = 4;
export const XP_PER_ENEMY = 25;
// What a cleared chamber pays (plan 017). Every clear tops the knight up; the door he chose decides the
// rest: a purse of experience, or a real heal in place of the top-up. These are the dead end's old 60 XP
// and 30 vitality, split so each door offers one of them rather than both.
export const XP_CACHE = 60;
export const MEND = 30;
export const TOP_UP = 12;
// Each rank costs more than the last, so a full three-floor descent pays out five or six boons.
export const rankCost = (rank: number) => 200 + (rank - 1) * 150;

// One window, every source. This used to be the hurt visual's own timer, which made the ember hazard's
// longer flash (0.65s) buy more immunity than a melee hit's (0.35s): eating a 10-damage tick shielded
// you from a warden's 20-damage swing, so taking the weak hit protected you from the strong one. The
// visuals still differ per source; what can actually land does not.
export const INVULN = 0.35;

// What a descent starts with before anything bought between runs (plan 019): the numbers `createRun()` has
// always dealt, named so `runStart` in dungeon-meta.ts adds to the same ones.
export const START_HP = 100;
export const DRAFT_SIZE = 3;
// Second Tide leaves the knight on this share of his maximum vitality.
export const DEFIANCE_SHARE = 0.4;

export type Run = {
  hp: number; maxHp: number; kills: number; totalXp: number;
  rankLevel: number; rankProgress: number; pendingRanks: number; choosing: boolean;
  // Boon-derived modifiers. `guardAgainst` and `dashSpan` are multipliers, the rest are additive.
  // `strike` is a bonus on top of whatever the knight is holding, not the damage itself: the weapon
  // supplies the base and the boons add to it.
  strike: number; dashSpan: number; reach: number; draught: number; guardAgainst: number;
  // Boon ids already taken this run, in order. The draft reads it so a card is never offered again while
  // an untaken one exists.
  taken: string[];
  // Seconds of gameplay immunity left. Purely a gate on damage; the hurt filter and the shake are the
  // renderer's business and run on their own timers.
  invuln: number;
  // Plan 016: seconds until the held arm's special can be used again. The sim owns it rather than the game
  // loop so the node suite and the balance batch read the same clock the keep does.
  specialCooldown: number;
  // Plan 019. Cards a boon offer shows (`draftBoons(run, rng, run.draftSize)`); revives left (Second Tide);
  // and a flag `hurt` raises when one was just spent, which the game reads to draw the moment and clears.
  draftSize: number; defiance: number; defied: boolean;
};

// With no argument this is the run the game has always started. `start` carries what was bought between runs;
// `arm` is the game's to equip and means nothing here.
export const createRun = (start?: RunStart): Run => ({
  hp: start?.maxHp ?? START_HP, maxHp: start?.maxHp ?? START_HP, kills: 0, totalXp: 0,
  rankLevel: 1, rankProgress: 0, pendingRanks: 0, choosing: false,
  strike: start?.strike ?? 0, dashSpan: 0.8, reach: 0, draught: 0, guardAgainst: 1,
  invuln: 0, taken: [], specialCooldown: 0,
  draftSize: start?.draftSize ?? DRAFT_SIZE, defiance: start?.defiance ?? 0, defied: false,
});

// Fisher-Yates over a copy. The draft used to be `sort(() => Math.random() - 0.5)`, which is not a shuffle:
// measured over 300k draws some three-card offers came up seven times as often as others.
const shuffle = <T,>(items: readonly T[], random: () => number) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

// Three cards, new ones first. With six boons and five or six picks a run, drawing from the whole pool
// every time meant a typical run still missed a boon it was never shown and, once four were held, one
// offer in five was nothing but repeats. Stacking stays legal: once the untaken cards run out the
// remaining slots are filled from the taken ones, so a late rank still offers something.
export const draftBoons = (run: Run, random: () => number = Math.random, size = 3): Boon[] => {
  const held = new Set(run.taken);
  const fresh = shuffle(BOONS.filter(b => !held.has(b.id)), random);
  const repeats = shuffle(BOONS.filter(b => held.has(b.id)), random);
  return [...fresh, ...repeats].slice(0, Math.min(size, BOONS.length));
};

// Amounts arrive from the game loop, from the console hooks and from a boon's own maths, so nothing is
// trusted: a NaN frame delta or a negative grant would otherwise corrupt the run permanently.
const amount = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

// What a single reward is worth, so the caller can drive the HUD, the XP ticker and the boon draft
// without re-deriving any of it. `ranks` is how many rank-ups this reward caused, not the new rank.
export type Reward = { xp: number; ranks: number; healed: number };

// Never overfills, never subtracts. Returns what was actually restored, which is also the caller's cue
// to refresh the health readout.
export const heal = (run: Run, value: number) => {
  const before = run.hp;
  run.hp = Math.min(run.maxHp, run.hp + amount(value));
  return run.hp - before;
};

// Every rank the ladder can afford is banked at once, so one fat XP award can owe several boons.
export const grantXp = (run: Run, value: number): Reward => {
  const xp = amount(value);
  if (!xp) return { xp: 0, ranks: 0, healed: 0 };
  run.totalXp += xp; run.rankProgress += xp;
  let ranks = 0;
  while (run.rankProgress >= rankCost(run.rankLevel)) { run.rankProgress -= rankCost(run.rankLevel); run.rankLevel++; run.pendingRanks++; ranks++; }
  return { xp, ranks, healed: 0 };
};

// A refused hit returns 0, so the caller can tell "nothing happened" from "0 damage got through" and
// skip the flash, the shake and the sound. `warded` marks the sources a Salt Ward reduces — enemy
// steel does, the keep's own embers do not.
export const hurt = (run: Run, value: number, options: { dashing?: boolean; warded?: boolean } = {}) => {
  if (run.hp <= 0 || run.invuln > 0 || options.dashing) return 0;
  const raw = amount(value);
  if (!raw) return 0;
  const dealt = Math.max(0, incomingDamage(raw, options.warded ? run.guardAgainst : 1));
  // Second Tide (plan 019): the blow that would have been the last leaves him on his feet instead, once. The
  // window after it is the ordinary one, so he is no safer for having been saved. Every caller ends the run on
  // `hp === 0`, and a defied blow leaves more than that.
  if (dealt >= run.hp && run.defiance > 0) { run.hp = Math.round(DEFIANCE_SHARE * run.maxHp); run.defiance--; run.defied = true; }
  else run.hp = Math.max(0, run.hp - dealt);
  run.invuln = INVULN;
  return dealt;
};

export const tickRun = (run: Run, dt: number) => {
  run.invuln = Math.max(0, run.invuln - amount(dt));
  run.specialCooldown = Math.max(0, run.specialCooldown - amount(dt));
};

// A special's cooldown starts at contact, not on the press, so one cancelled in its anticipation - by a
// dodge, or a charge let go too early - costs nothing. The caller says when contact came.
// A cooldown ticked down in frame-sized steps can land a rounding error above zero; that is ready.
export const specialReady = (run: Run) => run.specialCooldown <= 1e-9;
export const spendSpecial = (run: Run, cooldown: number) => { run.specialCooldown = Math.max(run.specialCooldown, amount(cooldown)); };
// Taking up another arm hands over that arm's clock: a fresh one found on a floor arrives ready, and one taken
// back off the rack where it was set down brings back whatever it had left (`kept`, frozen while it lay
// there). So a swap is never a way round a cooldown - swap, swap back is the same arm, still cooling - and
// never a punishment either, since the other arm's special is its own.
export const resetSpecial = (run: Run, kept = 0) => { run.specialCooldown = amount(kept); };

// Only legal while a draft is open, which is what stops a stray `boon:<id>` event from handing out free
// upgrades. Returns the boon so the caller can name it; null means nothing was applied.
export const takeBoon = (run: Run, id: string): Boon | null => {
  const boon = BOONS.find(b => b.id === id);
  if (!run.choosing || !boon) return null;
  if (id === 'edge') run.strike += STRIKE_BONUS;
  if (id === 'vigor') { run.maxHp += 25; run.hp = run.maxHp; }
  if (id === 'step') run.dashSpan *= 0.7;
  if (id === 'reach') run.reach += 0.35;
  if (id === 'draught') run.draught += 6;
  if (id === 'ward') run.guardAgainst *= 0.8;
  run.taken.push(id);
  run.pendingRanks = Math.max(0, run.pendingRanks - 1); run.choosing = false;
  return boon;
};

export const resolveKill = (run: Run): Reward => {
  run.kills += 1;
  const { ranks } = grantXp(run, XP_PER_ENEMY);
  return { xp: XP_PER_ENEMY, ranks, healed: heal(run, run.draught) };
};

// One payout per chamber, whatever brought its last body down. `arm` pays only the top-up: the rack
// standing in that chamber is what the door promised.
export const chamberReward = (run: Run, reward: ChamberReward | null): Reward => {
  const xp = reward === 'cache' ? XP_CACHE : 0;
  const ranks = xp ? grantXp(run, xp).ranks : 0;
  return { xp, ranks, healed: heal(run, reward === 'mend' ? MEND : TOP_UP) };
};

// The way down. A cleared stair opens but only offers, like a rack: it takes the knight when he stands
// within this of its heart and answers with the `swap` key, so a floor ends on a choice he made and never
// because he ran across the stair mid-swing.
export const STAIR_RADIUS = 1.25;

// A shade wider than the stair, because an arm on a rack is a thing the knight walks up to rather than
// stands on. The rack only offers, and the swap waits on the `swap` key, so taking the wrong arm is a
// decision rather than a place the knight stood too long.
export const PICKUP_RADIUS = 1.4;

// How close the knight stands to a door's ring to be offered it (plan 017): the stair's own reach, since
// a door is taken the same way, with the swap key, once the chamber behind him is clear.
export const DOOR_RADIUS = STAIR_RADIUS;
