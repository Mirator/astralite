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

// What the player has asked the game to be, as opposed to what one run left behind. Every default here
// reproduces the game exactly as it shipped, so a blank, blocked or corrupt cell is not a different game:
// `volume: 1` is the 0.45 master gain the audio module always used, `reducedMotion: null` means "whatever
// the OS asks for and nothing of our own", and the thumbstick is the touch layout that already exists.
export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'dash' | 'pause' | 'mute' | 'fullscreen';
export type Binds = Record<Action, string[]>;
export type Settings = { volume: number; muted: boolean; reducedMotion: boolean | null; touchLayout: 'stick' | 'pad'; binds: Binds };

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'attack', 'dash', 'pause', 'mute', 'fullscreen'];
export const DEFAULT_BINDS: Binds = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], attack: ['Space'], dash: ['ShiftLeft', 'ShiftRight'], pause: ['Escape'], mute: ['KeyM'], fullscreen: ['KeyF'] };
// Escape belongs to pause and to nothing else, ever. It is the one key guaranteed to open the menu, and a
// player who can hand it to `attack` can bind themselves out of the very screen that would undo it — the ☰
// button is the other way back in, but a keyboard-only player may have no way to reach it.
export const RESERVED = 'Escape';
// Two bindings per action is what the defaults use (WASD beside the arrows); four is room to spare, and a
// bound so a hand-written cell cannot grow a list long enough to cost a keystroke anything measurable.
const BIND_CAP = 4;
// Every KeyboardEvent.code in the standard set is ASCII alphanumeric — 'KeyW', 'Digit1', 'IntlBackslash'.
const CODE = /^[A-Za-z0-9]{1,24}$/;

// Fresh arrays every time: a parsed set is handed straight to React state and edited from there, and one
// aliased list would let a rebind rewrite the defaults every later reset falls back to.
const freshBinds = (): Binds => Object.fromEntries(ACTIONS.map(a => [a, [...DEFAULT_BINDS[a]]])) as Binds;
export const defaultSettings = (): Settings => ({ volume: 1, muted: false, reducedMotion: null, touchLayout: 'stick', binds: freshBinds() });

// Bind `code` to `action`, or refuse. Refusal is null rather than an unchanged set so a caller can say why
// nothing happened. Whatever held the code loses it; if that would leave it with no key at all — an action
// the player can no longer perform, and cannot see is gone — the two trade instead, and the displaced
// action inherits the key this one just stopped using.
export const bindKey = (binds: Binds, action: Action, code: string): Binds | null => {
  if (!CODE.test(code) || (code === RESERVED && action !== 'pause')) return null;
  const held = ACTIONS.find(a => a !== action && binds[a].includes(code));
  const next: Binds = { ...binds, [action]: [code] };
  // `binds[action]` cannot be empty and cannot contain `code` when some other action holds it, so the
  // trade always hands over at least one key that nothing else is using.
  if (held) { const kept = binds[held].filter(c => c !== code); next[held] = kept.length ? kept : binds[action]; }
  return next;
};

const BEST_KEY = 'drowned-keep:best', SEED_KEY = 'drowned-keep:seed', RUNS_KEY = 'drowned-keep:runs', SETTINGS_KEY = 'drowned-keep:settings';
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

// Unlike a run record, a settings blob is never all-or-nothing: each field stands on its own, so a blob
// written by a build that had no volume slider yet, or one field somebody hand-edited into nonsense, costs
// that field and leaves the rest of the player's choices alone.
export const parseSettings = (raw: string | null): Settings => {
  const settings = defaultSettings();
  if (!raw) return settings;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return settings; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return settings;
  const stored = data as Record<string, unknown>;
  // NaN and Infinity both survive a JSON round trip through a hand-edited cell and would silence the game.
  if (typeof stored.volume === 'number' && Number.isFinite(stored.volume)) settings.volume = Math.min(1, Math.max(0, stored.volume));
  settings.muted = stored.muted === true;
  // Three states, and the third is "ask the OS" — so only a real boolean counts as an explicit override.
  if (typeof stored.reducedMotion === 'boolean') settings.reducedMotion = stored.reducedMotion;
  if (stored.touchLayout === 'pad' || stored.touchLayout === 'stick') settings.touchLayout = stored.touchLayout;
  const binds = stored.binds;
  if (binds && typeof binds === 'object' && !Array.isArray(binds)) {
    const seen = new Set<string>();
    for (const action of ACTIONS) {
      const list = (binds as Record<string, unknown>)[action];
      // A code already claimed by an earlier action is dropped rather than honoured twice: one key firing
      // two actions is exactly what the conflict rule exists to prevent, and it must not arrive by the back
      // door of a hand-written cell. Reserved keys are stripped here too, not only when a bind is made.
      const codes = Array.isArray(list) ? [...new Set(list.filter((c): c is string => typeof c === 'string' && CODE.test(c) && (action === 'pause' || c !== RESERVED) && !seen.has(c)))].slice(0, BIND_CAP) : [];
      // An action left with nothing is one the player cannot perform and cannot see is missing, so it keeps
      // its defaults — minus anything an earlier action already took, the one way defaults can collide.
      settings.binds[action] = codes.length ? codes : DEFAULT_BINDS[action].filter(c => !seen.has(c));
      settings.binds[action].forEach(c => seen.add(c));
    }
    // Even that fallback comes up empty if the stored set claimed an action's every default. An unreachable
    // action is worse than a lost customisation, so a set that cannot be made whole goes back to defaults entire.
    if (ACTIONS.some(a => !settings.binds[a].length)) settings.binds = freshBinds();
  }
  return settings;
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
export const readSettings = () => parseSettings(read(SETTINGS_KEY));
export const writeSettings = (settings: Settings) => write(SETTINGS_KEY, JSON.stringify(settings));
