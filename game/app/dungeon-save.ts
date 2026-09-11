// Between-run memory is a nicety, never a dependency. Storage is absent in a webview, throws in
// Safari private mode and can hold anything a previous version (or a user) left behind, so every
// value that comes back is re-validated and every failure degrades to "nothing remembered".
export type BestRun = { floor: number; xp: number; kills: number; won: boolean };

// What one finished run leaves behind, and nothing more: this list is what turns "floor 2 feels too
// hard" into a count. `cause` is why the knight stopped — which kind of guard landed the blow, or the
// keep's own embers — and is null exactly when the run was won. `seed` is floor 1's, so an interesting
// run can be taken again with `restart:<seed>`. Boons are ids, not names: shorter, and they are what
// the `boon:<id>` console hook speaks.
export type RunCause = 'guard' | 'stalker' | 'warden' | 'hazard';
export type RunEnd = { at: number; floor: number; won: boolean; cause: RunCause | null; seconds: number; rank: number; xp: number; kills: number; boons: string[]; seed: number };

const BEST_KEY = 'drowned-keep:best', SEED_KEY = 'drowned-keep:seed', RUNS_KEY = 'drowned-keep:runs';
const CAUSES = ['guard', 'stalker', 'warden', 'hazard'];

// An entry is ~150 bytes of JSON, so the whole log is ~15 KB — a few hundred times under the smallest
// localStorage quota in the wild (5 MB), and small enough that a quota error here is only ever somebody
// else's data filling the origin. A hundred runs is also roughly a fortnight of playtesting at a few
// minutes a run, which is the window a balance question is actually asked over: older runs describe a
// build that no longer exists, so the oldest are the ones to drop.
export const RUN_LOG_CAP = 100;

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

// One bad entry costs that entry, never the log: a run written by an older build, or a cell somebody
// hand-edited, must not throw away every other run already recorded. A death with no recognisable cause
// is dropped rather than filed under a guess — the cause distribution is the whole reason this exists,
// so an invented one is worse than a missing row.
export const parseRun = (value: unknown): RunEnd | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const end = value as Record<string, unknown>;
  const at = whole(end.at), floor = whole(end.floor), seed = whole(end.seed), won = end.won === true;
  if (at === null || !floor || seed === null || seed > 0xffffffff) return null;
  const cause = typeof end.cause === 'string' && CAUSES.includes(end.cause) ? end.cause as RunCause : null;
  if (won ? cause !== null : cause === null) return null;
  // A stored boon list is capped on the way in too, so a hand-grown array cannot bloat the log.
  const boons = Array.isArray(end.boons) ? end.boons.filter((id): id is string => typeof id === 'string').slice(0, 12) : [];
  return { at, floor, won, cause, seconds: whole(end.seconds) ?? 0, rank: whole(end.rank) || 1, xp: whole(end.xp) ?? 0, kills: whole(end.kills) ?? 0, boons, seed };
};

// A log that is not a list is not a log. A list keeps exactly the entries that survive re-validation,
// and is trimmed on the way in as well as out so a cell written by a longer-capped build still fits.
export const parseRuns = (raw: string | null): RunEnd[] => {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  return data.map(parseRun).filter((end): end is RunEnd => end !== null).slice(-RUN_LOG_CAP);
};

// Newest last, oldest dropped. Pure, so the cap can be tested without a browser.
export const appendRun = (log: RunEnd[], end: RunEnd): RunEnd[] => [...log, end].slice(-RUN_LOG_CAP);

// One line's worth of the log: how many runs, how many got out, and which floor has taken the most
// knights — the question the log was added to answer. Ties go to the shallower floor, both to keep the
// answer independent of insertion order and because a shallow floor killing as often is the worse sign.
export const summariseRuns = (log: RunEnd[]) => {
  const falls = new Map<number, number>();
  for (const end of log) if (!end.won) falls.set(end.floor, (falls.get(end.floor) ?? 0) + 1);
  let worstFloor = 0, worstFalls = 0;
  for (const [floor, count] of falls) if (count > worstFalls || (count === worstFalls && floor < worstFloor)) { worstFloor = floor; worstFalls = count; }
  return { runs: log.length, wins: log.reduce((n, end) => n + +end.won, 0), worstFloor, worstFalls };
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
export const readRuns = () => parseRuns(read(RUNS_KEY));
// Trimmed again here rather than trusting the caller: `write` swallows a quota error, and a silently
// dropped write is exactly how a log would stop growing without anyone noticing.
export const writeRuns = (log: RunEnd[]) => write(RUNS_KEY, JSON.stringify(log.slice(-RUN_LOG_CAP)));
