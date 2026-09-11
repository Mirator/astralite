// The numeric half of a run: vitality, experience, rank, boons and the rules that decide whether a hit
// lands. Nothing here knows about three.js, the DOM or a clock — dungeon-game.tsx owns the world and
// calls in for every number an outcome depends on, so these rules can be tested in node instead of by
// hand-driving a browser, which is how every combat regression in this project has been caught so far.
export type Boon = { id: string; name: string; detail: string };

export const BOONS: Boon[] = [
  { id: 'edge', name: 'Whetted Edge', detail: '+1 damage on every strike' },
  { id: 'vigor', name: 'Tidal Vigor', detail: '+25 max vitality, filled now' },
  { id: 'step', name: 'Quick Step', detail: 'Evasion recovers 30% faster' },
  { id: 'reach', name: 'Long Guard', detail: 'Longer, wider strike arc' },
  { id: 'draught', name: 'Grave Draught', detail: '+6 vitality per guard felled' },
  { id: 'ward', name: 'Salt Ward', detail: 'Take 20% less damage' },
];

export const XP_PER_ENEMY = 25;
export const XP_DEAD_END = 60;
// Each rank costs more than the last, so a full three-floor descent pays out five or six boons.
export const rankCost = (rank: number) => 200 + (rank - 1) * 150;

// One window, every source. This used to be the hurt visual's own timer, which made the ember hazard's
// longer flash (0.65s) buy more immunity than a melee hit's (0.35s): eating a 10-damage tick shielded
// you from a warden's 20-damage swing, so taking the weak hit protected you from the strong one. The
// visuals still differ per source; what can actually land does not.
export const INVULN = 0.35;

export type Run = {
  hp: number; maxHp: number; kills: number; totalXp: number;
  rankLevel: number; rankProgress: number; pendingRanks: number; choosing: boolean;
  // Boon-derived modifiers. `guardAgainst` and `dashSpan` are multipliers, the rest are additive.
  strike: number; dashSpan: number; reach: number; draught: number; guardAgainst: number;
  // Seconds of gameplay immunity left. Purely a gate on damage; the hurt filter and the shake are the
  // renderer's business and run on their own timers.
  invuln: number;
};

export const createRun = (): Run => ({
  hp: 100, maxHp: 100, kills: 0, totalXp: 0,
  rankLevel: 1, rankProgress: 0, pendingRanks: 0, choosing: false,
  strike: 1, dashSpan: 1.35, reach: 0, draught: 0, guardAgainst: 1,
  invuln: 0,
});

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
  const dealt = Math.max(0, Math.round(options.warded ? raw * run.guardAgainst : raw));
  run.hp = Math.max(0, run.hp - dealt);
  run.invuln = INVULN;
  return dealt;
};

export const tickRun = (run: Run, dt: number) => { run.invuln = Math.max(0, run.invuln - amount(dt)); };

// Only legal while a draft is open, which is what stops a stray `boon:<id>` event from handing out free
// upgrades. Returns the boon so the caller can name it; null means nothing was applied.
export const takeBoon = (run: Run, id: string): Boon | null => {
  const boon = BOONS.find(b => b.id === id);
  if (!run.choosing || !boon) return null;
  if (id === 'edge') run.strike += 1;
  if (id === 'vigor') { run.maxHp += 25; run.hp = run.maxHp; }
  if (id === 'step') run.dashSpan *= 0.7;
  if (id === 'reach') run.reach += 0.35;
  if (id === 'draught') run.draught += 6;
  if (id === 'ward') run.guardAgainst *= 0.8;
  run.pendingRanks = Math.max(0, run.pendingRanks - 1); run.choosing = false;
  return boon;
};

export const resolveKill = (run: Run): Reward => {
  run.kills += 1;
  const { ranks } = grantXp(run, XP_PER_ENEMY);
  return { xp: XP_PER_ENEMY, ranks, healed: heal(run, run.draught) };
};

// Detours are optional, so they pay: a dead end gives XP and a real heal, while the trunk only tops you
// up enough to keep walking.
export const clearRoomReward = (run: Run, detour: boolean): Reward => {
  const xp = detour ? XP_DEAD_END : 0;
  const ranks = detour ? grantXp(run, xp).ranks : 0;
  return { xp, ranks, healed: heal(run, detour ? 30 : 12) };
};
