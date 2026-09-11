// Between-run memory is a nicety, never a dependency. Storage is absent in a webview, throws in
// Safari private mode and can hold anything a previous version (or a user) left behind, so every
// value that comes back is re-validated and every failure degrades to "nothing remembered".
export type BestRun = { floor: number; xp: number; kills: number; won: boolean };

const BEST_KEY = 'drowned-keep:best', SEED_KEY = 'drowned-keep:seed';

// Deeper always wins; XP only settles a tie on the same floor. Returns the winner by identity, so a
// caller can tell "nothing changed" from "a new record" without comparing fields.
export const betterRun = (a: BestRun | null, b: BestRun | null): BestRun | null =>
  !b ? a : !a ? b : b.floor > a.floor || (b.floor === a.floor && b.xp > a.xp) ? b : a;

const whole = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

// Anything that is not a complete, sane record counts as no record at all.
export const parseBest = (raw: string | null): BestRun | null => {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const run = data as Record<string, unknown>;
  const floor = whole(run.floor), xp = whole(run.xp);
  if (!floor || xp === null) return null;
  return { floor, xp, kills: whole(run.kills) ?? 0, won: run.won === true };
};

export const parseSeed = (raw: string | null): number | null => {
  // Number('') and Number(' ') are both 0, so a blank cell has to be rejected before the conversion.
  const seed = raw?.trim() ? Number(raw) : NaN;
  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null;
};

// The only two places that touch the browser; both swallow everything, including the SecurityError
// thrown merely by naming localStorage when site data is blocked.
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; /* storage blocked */ } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: this run simply is not remembered */ } };

export const readBest = () => parseBest(read(BEST_KEY));
export const writeBest = (run: BestRun) => write(BEST_KEY, JSON.stringify(run));
export const readSeed = () => parseSeed(read(SEED_KEY));
export const writeSeed = (seed: number) => write(SEED_KEY, String(seed >>> 0));
