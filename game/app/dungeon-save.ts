// Between-run memory is a nicety, never a dependency. Storage is absent in a webview, throws in
// Safari private mode and can hold anything a previous version (or a user) left behind, so every
// value that comes back is re-validated and every failure degrades to "nothing remembered".
import { BESTIARY, ENEMY_KINDS, type EnemyKind } from './dungeon-bestiary.ts';
import { ARM_ORDER, freshMeta, PEARL_CAP, UPGRADES, type Meta } from './dungeon-meta.ts';
import { STARTING_WEAPON, type WeaponId } from './dungeon-weapon.ts';

export type BestRun = { floor: number; xp: number; kills: number; won: boolean };

// What one finished run leaves behind, and nothing more: this list is what turns "floor 2 feels too
// hard" into a count. `cause` is why the knight stopped — which kind of guard landed the blow, or the
// keep's own embers — and is null exactly when the run was won. `seed` is floor 1's, so an interesting
// run can be taken again with `restart:<seed>`. Boons are ids, not names: shorter, and they are what
// the `boon:<id>` console hook speaks.
//
// Plan 019 added the last three, because runs on different meta levels are not comparable: `arm` is the arm
// the run was fought with, `upgrades` the ranks held when it began (id to rank, only ids above zero) and
// `pearls` what it paid. A record from before then reads as a Tideblade run on no upgrades that paid nothing.
//
// Plan 021 added `bosses` (how many bosses the run felled; 0 on a record from before) and `bossKinds`, the boss each floor the run reached
// held, in floor order, so a playtest report can say which bosses a run met. A record from before has no `bossKinds` and keeps none.
//
// Plan 022 added `elites`, the elites the run felled (each paid a pearl of its own in `pearls`); a record from before, or a run that felled none, has no `elites` field.
//
// Plan 023 added `chambers`, the fight chambers the run cleared (each paid `CHAMBER_PEARLS`); a record from before has no `chambers` field, and `pearlsFor` reads that as a pearl a kill, as it was paid then.
export type RunCause = EnemyKind | 'hazard';
export type RunEnd = { at: number; floor: number; won: boolean; cause: RunCause | null; seconds: number; rank: number; xp: number; kills: number; boons: string[]; seed: number; arm: WeaponId; upgrades: Meta['upgrades']; pearls: number; bosses: number; bossKinds?: EnemyKind[]; elites?: number; chambers?: number };

// What the player has asked the game to be, as opposed to what one run left behind. Every default here
// reproduces the game exactly as it shipped, so a blank, blocked or corrupt cell is not a different game:
// `volume: 1` is the 0.45 master gain the audio module always used, `reducedMotion: null` means "whatever
// the OS asks for and nothing of our own", and the thumbstick is the touch layout that already exists.
export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'special' | 'dash' | 'swap' | 'map' | 'pause' | 'mute' | 'fullscreen';
export type Binds = Record<Action, string[]>;
export type Settings = { volume: number; muted: boolean; reducedMotion: boolean | null; touchLayout: 'stick' | 'pad'; binds: Binds };

// Order matters: `parseSettings` lets the first action listed keep a code two actions claim, so the three
// combat verbs sit together ahead of everything a stray code could otherwise take them from.
export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'attack', 'special', 'dash', 'swap', 'map', 'pause', 'mute', 'fullscreen'];
// Plan 016: the mouse is the primary scheme (LMB strikes, RMB is the arm's special, Space dodges), and the
// keyboard-only cluster is J/K/L beside it. Mouse buttons are codes in the same table as keys - `Mouse0` is
// the left button, `Mouse1` the middle, `Mouse2` the right - so one binding rule covers both devices.
export const DEFAULT_BINDS: Binds = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], attack: ['Mouse0', 'KeyJ'], special: ['Mouse2', 'KeyK'], dash: ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL'], swap: ['KeyE'], map: ['Tab'], pause: ['Escape'], mute: ['KeyM'], fullscreen: ['KeyF'] };
/**
 * A mouse button's code, as opposed to a key's: the left, middle and right buttons only. The side buttons
 * (`Mouse3`/`Mouse4`) are never bind codes, because Chrome goes Back or Forward on their release and no
 * handler here can stop it: a dodge on M4 would leave the page mid-fight.
 */
export const isMouseCode = (code: string) => /^Mouse[0-2]$/.test(code);
// Escape belongs to pause and to nothing else, ever. It is the one key guaranteed to open the menu, and a
// player who can hand it to `attack` can bind themselves out of the very screen that would undo it — the ☰
// button is the other way back in, but a keyboard-only player may have no way to reach it.
export const RESERVED = 'Escape';
// Two bindings per action is what most defaults use (WASD beside the arrows); four is the dodge's own list
// (Space, both shifts, L), and a bound so a hand-written cell cannot grow a list long enough to cost a
// keystroke anything measurable.
const BIND_CAP = 4;
// Every KeyboardEvent.code in the standard set is ASCII alphanumeric — 'KeyW', 'Digit1', 'IntlBackslash' —
// and so are the mouse codes this file names (`Mouse0`..`Mouse2`).
const CODE = /^[A-Za-z0-9]{1,24}$/;
/** Whether a code may be bound at all: any key code, and of the mouse's only the three `isMouseCode` names. */
const bindable = (code: string) => CODE.test(code) && (!/^Mouse\d/.test(code) || isMouseCode(code));

// Fresh arrays every time: a parsed set is handed straight to React state and edited from there, and one
// aliased list would let a rebind rewrite the defaults every later reset falls back to.
const freshBinds = (): Binds => Object.fromEntries(ACTIONS.map(a => [a, [...DEFAULT_BINDS[a]]])) as Binds;
export const defaultSettings = (): Settings => ({ volume: 1, muted: false, reducedMotion: null, touchLayout: 'stick', binds: freshBinds() });

// Bind `code` to `action`, or refuse. Refusal is null rather than an unchanged set so a caller can say why
// nothing happened. Whatever held the code loses it; if that would leave it with no key at all — an action
// the player can no longer perform, and cannot see is gone — the two trade instead, and the displaced
// action inherits the key this one just stopped using.
//
// A new code replaces the action's codes on the same device and leaves the other device's alone: moving
// Strike from J to X must not also take it off the left button, or a keyboard rebind would quietly break
// the mouse scheme. Mouse codes are listed first, which is the order the defaults use.
export const bindKey = (binds: Binds, action: Action, code: string): Binds | null => {
  if (!bindable(code) || (code === RESERVED && action !== 'pause')) return null;
  const held = ACTIONS.find(a => a !== action && binds[a].includes(code));
  const same = (c: string) => isMouseCode(c) === isMouseCode(code);
  const displaced = binds[action].filter(same), others = binds[action].filter(c => !same(c));
  const next: Binds = { ...binds, [action]: [...others.slice(0, BIND_CAP - 1), code].sort((a, b) => +isMouseCode(b) - +isMouseCode(a)) };
  // `binds[action]` cannot contain `code` when some other action holds it, so whatever it hands over is a
  // code nothing else is using. It can lack a code on this device at all (an action with only keys, asked
  // for a button), and then the trade is the whole list: the action gives up its keys for the button.
  if (held) {
    const kept = binds[held].filter(c => c !== code);
    if (kept.length) next[held] = kept;
    else if (displaced.length) next[held] = displaced;
    else { next[action] = [code]; next[held] = binds[action]; }
  }
  return next;
};

const SETTINGS_KEY = 'drowned-keep:settings';
// Plan 020: progress belongs to a save slot, the machine's own choices do not. A slot holds four cells (the pearls and
// arms, the deepest run, the last keep's seed and the run log) under `drowned-keep:<slot>:<cell>`; the settings and the
// bindings stay one per device, and so does `drowned-keep:slot`, the slot last played. The pre-slot build wrote the same
// four cells without the slot, and they are only ever read by `migrateLegacy`.
export type Slot = 1 | 2 | 3;
export const SLOTS: readonly Slot[] = [1, 2, 3];
export const SLOT_CELLS = ['meta', 'best', 'seed', 'runs'] as const;
export type SlotCell = typeof SLOT_CELLS[number];
export type SlotCells = Record<SlotCell, string | null>;
export const slotKey = (slot: Slot, name: SlotCell) => `drowned-keep:${slot}:${name}`;
export const legacyKey = (name: SlotCell) => `drowned-keep:${name}`;
const LAST_SLOT_KEY = 'drowned-keep:slot';
const CAUSES: readonly string[] = [...ENEMY_KINDS, 'hazard'];

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

// Ranks keyed by upgrade id, rebuilt from scratch: unknown ids are dropped, each rank is a whole number held
// to [1, ranks] (a rank of zero is absent, so the same purchases always serialise the same way), and the keys
// come out in the table's order whatever order they arrived in.
const parseUpgrades = (value: unknown): Meta['upgrades'] => {
  const out: Meta['upgrades'] = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const stored = value as Record<string, unknown>;
  for (const { id, ranks } of UPGRADES) {
    const rank = Object.hasOwn(stored, id) ? whole(stored[id]) : null;
    if (rank) out[id] = Math.min(ranks, rank);
  }
  return out;
};

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
  // Plan 019 fields. A record from an older build has none of them, and is not thereby damaged.
  const arm = typeof end.arm === 'string' && ARM_ORDER.includes(end.arm as WeaponId) ? end.arm as WeaponId : STARTING_WEAPON;
  // Plan 021 fields: a stored boss list keeps only kinds that are bosses, at most one a floor, and is left out when nothing survives.
  const bossKinds = Array.isArray(end.bossKinds) ? end.bossKinds.filter((kind): kind is EnemyKind => typeof kind === 'string' && (ENEMY_KINDS as readonly string[]).includes(kind) && !!BESTIARY[kind as EnemyKind].boss).slice(0, 3) : [];
  const elites = Math.min(999, whole(end.elites) ?? 0);
  // Plan 023: the fight chambers the run cleared, which a record from before it lacks (and reads as lacking: a stored `0` is a run that cleared none).
  const chambers = whole(end.chambers) === null ? null : Math.min(999, whole(end.chambers) as number);
  return { at, floor, won, cause, seconds: whole(end.seconds) ?? 0, rank: whole(end.rank) || 1, xp: whole(end.xp) ?? 0, kills: whole(end.kills) ?? 0, boons, seed, arm, upgrades: parseUpgrades(end.upgrades), pearls: Math.min(PEARL_CAP, whole(end.pearls) ?? 0), bosses: Math.min(3, whole(end.bosses) ?? 0), ...(bossKinds.length ? { bossKinds } : null), ...(elites ? { elites } : null), ...(chambers !== null ? { chambers } : null) };
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
      const codes = Array.isArray(list) ? [...new Set(list.filter((c): c is string => typeof c === 'string' && bindable(c) && (action === 'pause' || c !== RESERVED) && !seen.has(c)))].slice(0, BIND_CAP) : [];
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

// The meta save (plan 019) is re-validated whole, like the settings: a cell that is not an object is a fresh
// meta, and every field that is, stands on its own. The Tideblade is always owned, whatever the cell says,
// and `arm` falls back to it when the arm it names is not one the player owns.
export const parseMeta = (raw: string | null): Meta => {
  const meta = freshMeta();
  if (!raw) return meta;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return meta; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return meta;
  const stored = data as Record<string, unknown>;
  meta.pearls = Math.min(PEARL_CAP, whole(stored.pearls) ?? 0);
  meta.upgrades = parseUpgrades(stored.upgrades);
  const owned = Array.isArray(stored.arms) ? stored.arms.filter((id): id is string => typeof id === 'string') : [];
  meta.arms = ARM_ORDER.filter(id => id === STARTING_WEAPON || owned.includes(id));
  meta.arm = typeof stored.arm === 'string' && meta.arms.includes(stored.arm as WeaponId) ? stored.arm as WeaponId : STARTING_WEAPON;
  return meta;
};

// The only two places that touch the browser; both swallow everything, including the SecurityError
// thrown merely by naming localStorage when site data is blocked.
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; /* storage blocked */ } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: this run simply is not remembered */ } };

const remove = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage blocked: nothing was kept to erase */ } };

// Every reader and writer of progress names the slot it speaks for. (Stage A of plan 020: the game still passes slot 1
// everywhere, until the slot picker of Stage B chooses one.)
export const readBest = (slot: Slot) => parseBest(read(slotKey(slot, 'best')));
export const writeBest = (slot: Slot, run: BestRun) => write(slotKey(slot, 'best'), JSON.stringify(run));
export const readSeed = (slot: Slot) => parseSeed(read(slotKey(slot, 'seed')));
export const writeSeed = (slot: Slot, seed: number) => write(slotKey(slot, 'seed'), String(seed >>> 0));
export const readRuns = (slot: Slot) => parseRuns(read(slotKey(slot, 'runs')));
// Trimmed again here rather than trusting the caller: `write` swallows a quota error, and a silently
// dropped write is exactly how a log would stop growing without anyone noticing.
export const writeRuns = (slot: Slot, log: RunEnd[]) => write(slotKey(slot, 'runs'), JSON.stringify(log.slice(-RUN_LOG_CAP)));
export const readMeta = (slot: Slot) => parseMeta(read(slotKey(slot, 'meta')));
export const writeMeta = (slot: Slot, meta: Meta) => write(slotKey(slot, 'meta'), JSON.stringify(meta));
export const readSettings = () => parseSettings(read(SETTINGS_KEY));
export const writeSettings = (settings: Settings) => write(SETTINGS_KEY, JSON.stringify(settings));

// The slot last played, a device's choice like the volume. Anything but 1, 2 or 3 is no choice at all.
export const parseSlot = (raw: string | null): Slot | null => { const slot = raw === null ? NaN : Number(raw); return slot === 1 || slot === 2 || slot === 3 ? slot : null; };
export const readSlot = () => parseSlot(read(LAST_SLOT_KEY));
export const writeSlot = (slot: Slot) => write(LAST_SLOT_KEY, String(slot));

/** A slot's four cells exactly as stored, unparsed: what the picker summarises and what migration copies. */
export const readCells = (slot: Slot): SlotCells => ({ meta: read(slotKey(slot, 'meta')), best: read(slotKey(slot, 'best')), seed: read(slotKey(slot, 'seed')), runs: read(slotKey(slot, 'runs')) });
export const readLegacyCells = (): SlotCells => ({ meta: read(legacyKey('meta')), best: read(legacyKey('best')), seed: read(legacyKey('seed')), runs: read(legacyKey('runs')) });

/** A slot is empty when none of its cells has ever been written. A cell that is there but unreadable still counts as a slot somebody played, so it is never copied over or shown as new. */
export const cellsEmpty = (cells: SlotCells) => SLOT_CELLS.every(name => cells[name] === null);

/**
 * What the picker shows for one slot, read off its four cells: the pearls and arms of the meta, the deepest floor of the
 * best run (0 before any), and the runs in the log. Each field is re-validated like any other read, so a damaged cell
 * shows as the zero it reads as.
 */
export const summariseSlot = (cells: SlotCells) => {
  const meta = parseMeta(cells.meta);
  return { empty: cellsEmpty(cells), pearls: meta.pearls, best: parseBest(cells.best)?.floor ?? 0, runs: parseRuns(cells.runs).length, arms: meta.arms.length };
};
export const slotSummary = (slot: Slot) => summariseSlot(readCells(slot));

/** Forget one slot: its four cells and nothing else, so the other slots, the settings and the slot last played stay. The legacy cells are left alone as well. */
export const eraseSlot = (slot: Slot) => { for (const name of SLOT_CELLS) remove(slotKey(slot, name)); };

/**
 * The writes that bring a pre-slot save into slot 1 (plan 020, D2): each legacy cell that exists, copied verbatim under
 * its slot-1 key, and none at all when slot 1 holds anything - a slot somebody has already played is never overwritten,
 * so running this on every boot is safe. It deletes nothing; the legacy cells stay, which is what makes a rollback safe.
 * Pure: the game reads the cells, calls this, and applies what comes back (`migrateStored`).
 */
export const migrateLegacy = (legacy: SlotCells, slot1: SlotCells): { key: string; value: string }[] => {
  const writes: { key: string; value: string }[] = [];
  if (!cellsEmpty(slot1)) return writes;
  for (const name of SLOT_CELLS) { const value = legacy[name]; if (value !== null) writes.push({ key: slotKey(1, name), value }); }
  return writes;
};
/** `migrateLegacy` against the real store; returns how many cells it wrote. */
export const migrateStored = () => { const writes = migrateLegacy(readLegacyCells(), readCells(1)); for (const { key, value } of writes) write(key, value); return writes.length; };
