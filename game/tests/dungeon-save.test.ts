import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIONS, appendRun, betterRun, bindKey, DEFAULT_BINDS, defaultSettings, META_KEY, parseBest, parseMeta, parseRun, parseRuns, parseSeed, parseSettings, readMeta, readRuns, readSettings, RESERVED, RUN_LOG_CAP, summariseRuns, writeMeta, writeRuns, writeSettings, type Action, type BestRun, type RunEnd, type Settings } from '../app/dungeon-save.ts';
import { freshMeta, PEARL_CAP, type Meta } from '../app/dungeon-meta.ts';

const run = (floor: number, xp: number): BestRun => ({ floor, xp, kills: 0, won: false });
// A plausible death on floor 2, which every history test varies one field of.
const end = (over: Partial<RunEnd> = {}): RunEnd => ({ at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee, arm: 'tideblade', upgrades: {}, pearls: 0, ...over });
const won = (over: Partial<RunEnd> = {}): RunEnd => end({ floor: 3, won: true, cause: null, ...over });

test('the best run is the deepest, with XP only breaking a tie on the same floor', () => {
  assert.equal(betterRun(null, null), null);
  assert.deepEqual(betterRun(null, run(1, 50)), run(1, 50));
  assert.deepEqual(betterRun(run(1, 50), null), run(1, 50));
  // Deeper wins even with less XP; a shallower run never displaces it.
  assert.deepEqual(betterRun(run(1, 900), run(3, 10)), run(3, 10));
  assert.deepEqual(betterRun(run(3, 10), run(1, 900)), run(3, 10));
  assert.deepEqual(betterRun(run(2, 100), run(2, 101)), run(2, 101));
  // A tie is not a new record, so the held run is returned by identity and nothing is rewritten.
  const held = run(2, 100);
  assert.equal(betterRun(held, run(2, 100)), held);
});

test('anything that is not a complete, sane record reads as no record', () => {
  assert.equal(parseBest(null), null);
  assert.equal(parseBest(''), null);
  assert.equal(parseBest('{'), null);
  assert.equal(parseBest('null'), null);
  assert.equal(parseBest('7'), null);
  assert.equal(parseBest('[]'), null);
  assert.equal(parseBest('{"floor":0,"xp":10}'), null);
  assert.equal(parseBest('{"floor":"3","xp":10}'), null);
  assert.equal(parseBest('{"floor":3}'), null);
  assert.equal(parseBest('{"floor":3,"xp":null}'), null);
  assert.equal(parseBest('{"floor":3,"xp":-5}'), null);
  // JSON.parse turns an overflowing literal into Infinity, which must not survive as a score.
  assert.equal(parseBest('{"floor":3,"xp":1e400}'), null);
  assert.deepEqual(parseBest('{"floor":2.9,"xp":75.4,"kills":"x","won":"yes"}'), { floor: 2, xp: 75, kills: 0, won: false });
  assert.deepEqual(parseBest('{"floor":3,"xp":940,"kills":31,"won":true}'), { floor: 3, xp: 940, kills: 31, won: true });
});

test('a stored seed survives only if it is still a whole 32-bit value', () => {
  assert.equal(parseSeed(null), null);
  assert.equal(parseSeed(''), null);
  assert.equal(parseSeed('abc'), null);
  assert.equal(parseSeed('-1'), null);
  assert.equal(parseSeed('1.5'), null);
  assert.equal(parseSeed('4294967296'), null);
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed('4294967295'), 4294967295);
});

test('the history is capped and the run that goes is the oldest', () => {
  const full = Array.from({ length: RUN_LOG_CAP }, (_, i) => end({ at: i + 1 }));
  const rolled = appendRun(full, end({ at: 9999 }));
  assert.equal(rolled.length, RUN_LOG_CAP);
  assert.equal(rolled[0].at, 2);
  assert.equal(rolled[RUN_LOG_CAP - 1].at, 9999);
  assert.equal(appendRun(full.slice(0, 3), end({ at: 9999 })).length, 4);
  // A cell left by a build with a looser cap is trimmed on the way in as well, newest kept.
  const oversized = parseRuns(JSON.stringify(Array.from({ length: RUN_LOG_CAP + 25 }, (_, i) => end({ at: i + 1 }))));
  assert.equal(oversized.length, RUN_LOG_CAP);
  assert.equal(oversized[0].at, 26);
});

test('an entry is kept only if it still says where and how the run ended', () => {
  assert.equal(parseRun(null), null);
  assert.equal(parseRun('x'), null);
  assert.equal(parseRun(7), null);
  assert.equal(parseRun([]), null);
  assert.equal(parseRun({ floor: 2 }), null);
  assert.equal(parseRun({ ...end(), at: 'now' }), null);
  assert.equal(parseRun({ ...end(), at: -1 }), null);
  assert.equal(parseRun({ ...end(), floor: 0 }), null);
  assert.equal(parseRun({ ...end(), seed: 0x100000000 }), null);
  // JSON.parse turns an overflowing literal into Infinity, which must not survive as a replay seed.
  assert.deepEqual(parseRuns('[{"at":1,"floor":2,"won":false,"cause":"guard","seed":1e400}]'), []);
  // A death filed under nothing, or under a cause this build has never heard of, is not a data point.
  assert.equal(parseRun({ ...end(), cause: null }), null);
  assert.equal(parseRun({ ...end(), cause: 'ghost' }), null);
  // And a win cannot have killed anyone, so a record claiming both is incoherent either way round.
  assert.equal(parseRun({ ...end(), won: true }), null);
  assert.equal(parseRun({ ...won(), won: false }), null);
  // Fields that only colour an entry degrade to a floor rather than sinking it.
  assert.deepEqual(parseRun({ at: 9, floor: 2, won: false, cause: 'warden', seed: 3 }), { at: 9, floor: 2, won: false, cause: 'warden', seconds: 0, rank: 1, xp: 0, kills: 0, boons: [], seed: 3, arm: 'tideblade', upgrades: {}, pearls: 0 });
  assert.deepEqual(parseRun({ ...end(), boons: ['edge', 7, null, 'ward'] })?.boons, ['edge', 'ward']);
  assert.deepEqual(parseRun({ ...end(), boons: 'edge' })?.boons, []);
  assert.deepEqual(parseRun({ ...end(), boons: Array(30).fill('edge') })?.boons.length, 12);
});

test('a corrupt entry is dropped on its own and never takes the rest of the log with it', () => {
  const good = end({ at: 5 }), later = won({ at: 6 });
  const poisoned = [good, { floor: 2 }, null, 7, 'x', [], { ...end(), cause: 'ghost' }, { ...end(), floor: 0 }, later];
  assert.deepEqual(parseRuns(JSON.stringify(poisoned)), [good, later]);
  // Anything that is not a list of runs is not a history — including the record shape of the best run.
  assert.deepEqual(parseRuns(null), []);
  assert.deepEqual(parseRuns(''), []);
  assert.deepEqual(parseRuns('{"floor":3,"xp":940}'), []);
  assert.deepEqual(parseRuns('null'), []);
  assert.deepEqual(parseRuns('7'), []);
  // Truncated JSON cannot be partly recovered, so the cell reads as no history rather than half of one.
  assert.deepEqual(parseRuns('[{"at":1,"floor":'), []);
});

test('the summary counts the descents, the escapes and the floor that takes the most knights', () => {
  assert.deepEqual(summariseRuns([]), { runs: 0, wins: 0, worstFloor: 0, worstFalls: 0 });
  assert.deepEqual(summariseRuns([end({ floor: 1 }), end({ floor: 2 }), end({ floor: 2 }), won()]), { runs: 4, wins: 1, worstFloor: 2, worstFalls: 2 });
  // A floor only ever escaped from is not a floor that kills, however many runs end there.
  assert.deepEqual(summariseRuns([won(), won(), end({ floor: 1 })]), { runs: 3, wins: 2, worstFloor: 1, worstFalls: 1 });
  // A tie goes to the shallower floor whichever order the runs happened to arrive in.
  assert.equal(summariseRuns([end({ floor: 3 }), end({ floor: 1 })]).worstFloor, 1);
  assert.equal(summariseRuns([end({ floor: 1 }), end({ floor: 3 })]).worstFloor, 1);
});

test('a history that is missing, hostile or unwritable costs the log and nothing else', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    delete owner.localStorage;
    assert.deepEqual(readRuns(), []);
    writeRuns([end()]);
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.deepEqual(readRuns(), []);
    writeRuns([end()]);
    // A working store is the reload: what one session wrote is what the next session reads back.
    const cell = new Map<string, string>();
    const store = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    owner.localStorage = store;
    writeRuns([end({ at: 1 }), won({ at: 2 })]);
    assert.deepEqual(readRuns(), [end({ at: 1 }), won({ at: 2 })]);
    // A write refused for quota leaves the last good history readable instead of emptying it.
    owner.localStorage = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); } };
    writeRuns([end({ at: 3 })]);
    assert.deepEqual(readRuns(), [end({ at: 1 }), won({ at: 2 })]);
    owner.localStorage = store;
    // Junk in the cell reads as no history, and the next run written over it starts the log clean.
    cell.set('drowned-keep:runs', '[{"at":1,');
    assert.deepEqual(readRuns(), []);
    cell.set('drowned-keep:runs', '{"floor":2}');
    assert.deepEqual(readRuns(), []);
    writeRuns(appendRun(readRuns(), end({ at: 4 })));
    assert.deepEqual(readRuns(), [end({ at: 4 })]);
    // The cap holds in the cell itself, not only on the way back in: an oversized log handed straight to
    // the writer is trimmed before it is stored, so storage cannot quietly grow past the bound.
    writeRuns(Array.from({ length: RUN_LOG_CAP + 5 }, (_, i) => end({ at: i + 1 })));
    const stored = JSON.parse(cell.get('drowned-keep:runs') ?? '[]') as RunEnd[];
    assert.equal(stored.length, RUN_LOG_CAP);
    assert.equal(stored[0].at, 6);
  } finally {
    if (original) Object.defineProperty(owner, 'localStorage', original); else delete owner.localStorage;
  }
});

// --- Plan 019: what a run leaves behind (the record) and what it buys (the meta save) --------------------
// A record written before the meta existed has no `arm`, `upgrades` or `pearls`. It is a good record: it reads
// as a Tideblade run on no upgrades that paid nothing, and is not dropped.
const PRE_019 = { at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee };

test('a record from before the meta save parses, with the Tideblade, no upgrades and no pearls', () => {
  assert.ok(!('arm' in PRE_019) && !('upgrades' in PRE_019) && !('pearls' in PRE_019), 'precondition: the fixture really lacks the new fields');
  assert.deepEqual(parseRun(PRE_019), { ...PRE_019, arm: 'tideblade', upgrades: {}, pearls: 0 }, 'a pre-019 record was not read as a Tideblade run on no upgrades');
  // And a whole old log keeps every entry, rather than dropping the lot for the missing fields.
  assert.deepEqual(parseRuns(JSON.stringify([PRE_019, { ...PRE_019, at: 2 }])).map(run => run.at), [1_700_000_000_000, 2]);
});

test('the new record fields are kept when sane and defaulted one by one when not', () => {
  const full = parseRun({ ...PRE_019, arm: 'maul', upgrades: { lungs: 2, tide: 1 }, pearls: 77 });
  assert.deepEqual([full?.arm, full?.upgrades, full?.pearls], ['maul', { lungs: 2, tide: 1 }, 77]);
  // An arm this build has not heard of is the Tideblade, not a reason to lose the run.
  assert.equal(parseRun({ ...PRE_019, arm: 'lance' })?.arm, 'tideblade');
  assert.equal(parseRun({ ...PRE_019, arm: 7 })?.arm, 'tideblade');
  assert.equal(parseRun({ ...PRE_019, arm: 'toString' })?.arm, 'tideblade');
  // Ranks are held to the table: unknown ids go, a rank over its maximum is clamped, zero is absent.
  assert.deepEqual(parseRun({ ...PRE_019, upgrades: { lungs: 99, ghost: 1, eye: 0, whet: -1, toString: 2 } })?.upgrades, { lungs: 3 });
  assert.deepEqual(parseRun({ ...PRE_019, upgrades: 'lungs' })?.upgrades, {});
  assert.equal(parseRun({ ...PRE_019, pearls: -5 })?.pearls, 0);
  assert.equal(parseRun({ ...PRE_019, pearls: 12.9 })?.pearls, 12);
  assert.equal(parseRun({ ...PRE_019, pearls: 1e12 })?.pearls, PEARL_CAP);
});

// --- The meta save -------------------------------------------------------------------------------
const stored = (meta: unknown) => JSON.stringify(meta);
const BOUGHT: Meta = { pearls: 140, upgrades: { lungs: 2, tide: 1 }, arms: ['tideblade', 'spear', 'maul'], arm: 'maul' };

test('a sane meta survives a write and a read unchanged', () => {
  assert.deepEqual(parseMeta(stored(BOUGHT)), BOUGHT);
  assert.deepEqual(parseMeta(stored(freshMeta())), freshMeta());
});

test('anything unreadable is a fresh meta, and nothing is shared between two of them', () => {
  for (const raw of [null, '', '   ', '{', 'null', '7', '"x"', '[]', '[{"pearls":50}]']) assert.deepEqual(parseMeta(raw), freshMeta(), String(raw));
  const a = parseMeta(null), b = parseMeta(null);
  a.arms.push('maul'); a.upgrades.lungs = 3;
  assert.deepEqual(b, freshMeta(), 'a fresh meta aliased another one\'s arrays');
});

test('a meta field that is wrong costs that field and leaves the rest', () => {
  const pearls = (value: unknown) => parseMeta(stored({ ...BOUGHT, pearls: value })).pearls;
  assert.equal(pearls(-30), 0);
  assert.equal(pearls('lots'), 0);
  assert.equal(pearls(40.7), 40);
  assert.equal(pearls(1e12), PEARL_CAP);
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, pearls: -30 })).upgrades, BOUGHT.upgrades);
  // A rank over its maximum is held to it; an unknown id is dropped; a stray number is not a rank.
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, upgrades: { lungs: 9, whet: 2, ghost: 4, eye: -1 } })).upgrades, { lungs: 3, whet: 1 });
  // An unknown arm is dropped and the known ones stay, in the table's order, once each.
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, arms: ['maul', 'lance', 'spear', 'maul', 7, 'tideblade'] })).arms, ['tideblade', 'spear', 'maul'], 'unknown or repeated arms were not cleaned');
  // The Tideblade is owned whatever the cell says, including a cell that lists nothing.
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, arms: ['maul'], arm: 'maul' })).arms, ['tideblade', 'maul'], 'the Tideblade must always be owned (missing from a list)');
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, arms: [], arm: 'tideblade' })).arms, ['tideblade'], 'the Tideblade must always be owned (empty list)');
  assert.deepEqual(parseMeta(stored({ ...BOUGHT, arms: 'maul' })).arms, ['tideblade'], 'the Tideblade must always be owned (list is not a list)');
  // An arm in hand that is not owned, or not an arm, falls back to the Tideblade.
  assert.equal(parseMeta(stored({ ...BOUGHT, arm: 'crossbow' })).arm, 'tideblade');
  assert.equal(parseMeta(stored({ ...BOUGHT, arm: 'lance' })).arm, 'tideblade');
  assert.equal(parseMeta(stored({ ...BOUGHT, arm: 3 })).arm, 'tideblade');
  assert.equal(parseMeta(stored({ ...BOUGHT, arm: 'spear' })).arm, 'spear');
});

test('the meta save is read and written through storage that may be absent, hostile or full', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    delete owner.localStorage;
    assert.deepEqual(readMeta(), freshMeta());
    writeMeta(BOUGHT);
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.deepEqual(readMeta(), freshMeta());
    writeMeta(BOUGHT);
    const cell = new Map<string, string>();
    owner.localStorage = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    writeMeta(BOUGHT);
    assert.equal(META_KEY, 'drowned-keep:meta');
    assert.ok(cell.has(META_KEY), 'precondition: the meta was written under its own key');
    assert.deepEqual(readMeta(), BOUGHT);
  } finally {
    if (original) Object.defineProperty(owner, 'localStorage', original); else delete owner.localStorage;
  }
});

// --- Settings ---------------------------------------------------------------
// The bar every case below is held to: whatever the store says, the game that comes out has to be the game
// that shipped unless the player asked for something else, and no field may take another down with it.
const shipped = () => ({ volume: 1, muted: false, reducedMotion: null, touchLayout: 'stick', binds: DEFAULT_BINDS });

test('nothing remembered is the game exactly as it shipped', () => {
  for (const raw of [null, '', '   ', '{', 'null', '7', '"x"', '[]', '[{"volume":0}]']) assert.deepEqual(parseSettings(raw), shipped());
  // The 0.45 master gain and today's keys are the defaults, so a first-ever visit is byte-identical to the
  // build before this one existed — which is the whole promise of adding settings rather than changing the game.
  assert.equal(defaultSettings().volume, 1);
  assert.equal(defaultSettings().reducedMotion, null);
  assert.deepEqual(defaultSettings().binds.up, ['KeyW', 'ArrowUp']);
  assert.deepEqual(defaultSettings().binds.dash, ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  // Fresh arrays every call: a rebind edits what parse handed back, and one aliased list would rewrite the
  // defaults that every later "reset keys" falls back to.
  const first = defaultSettings();
  first.binds.up.push('KeyZ');
  assert.deepEqual(defaultSettings().binds.up, ['KeyW', 'ArrowUp']);
  assert.deepEqual(parseSettings(null).binds.up, ['KeyW', 'ArrowUp']);
});

test('a partial or hostile settings blob costs that field and nothing else', () => {
  // A blob from a build that had no slider yet keeps the choices it did have.
  assert.deepEqual(parseSettings('{"muted":true}'), { ...shipped(), muted: true });
  // Out of range is clamped rather than dropped: the intent is legible, only the number is not.
  assert.equal(parseSettings('{"volume":2}').volume, 1);
  assert.equal(parseSettings('{"volume":-3}').volume, 0);
  assert.equal(parseSettings('{"volume":0.25}').volume, 0.25);
  // Anything that is not a finite number is no answer at all, so the master gain stays where it was. The
  // negative overflow is the one that matters: clamping alone would read it as a deliberate silence.
  for (const raw of ['{"volume":"0.5"}', '{"volume":null}', '{"volume":1e400}', '{"volume":-1e400}', '{"volume":{}}']) assert.equal(parseSettings(raw).volume, 1);
  // Reduced motion has three states and the third is "ask the OS", so only a real boolean overrides it.
  assert.equal(parseSettings('{"reducedMotion":true}').reducedMotion, true);
  assert.equal(parseSettings('{"reducedMotion":false}').reducedMotion, false);
  for (const raw of ['{"reducedMotion":null}', '{"reducedMotion":"yes"}', '{"reducedMotion":1}']) assert.equal(parseSettings(raw).reducedMotion, null);
  assert.equal(parseSettings('{"touchLayout":"pad"}').touchLayout, 'pad');
  for (const raw of ['{"touchLayout":"dpad"}', '{"touchLayout":7}']) assert.equal(parseSettings(raw).touchLayout, 'stick');
  // Muting is the one field with no third state, so only an explicit true silences a returning player.
  for (const raw of ['{"muted":"true"}', '{"muted":1}']) assert.equal(parseSettings(raw).muted, false);
  // A junk key set costs the keys and leaves the rest of the card alone.
  assert.deepEqual(parseSettings('{"volume":0.5,"binds":"wasd"}'), { ...shipped(), volume: 0.5 });
  assert.deepEqual(parseSettings('{"volume":0.5,"binds":[]}'), { ...shipped(), volume: 0.5 });
});

test('a stored key set is honoured only while it leaves every action reachable', () => {
  // What a rebind actually writes: one action moved, the rest as they were.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyX"]}}').binds.attack, ['KeyX']);
  // An action the blob says nothing about keeps its defaults rather than becoming unusable.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyX"]}}').binds.dash, ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  // Non-strings, impossible codes and duplicates within one action are dropped, and the list is capped.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyJ",7,null,"Key J","KeyJ","KeyK"]}}').binds.attack, ['KeyJ', 'KeyK']);
  assert.deepEqual(parseSettings(`{"binds":{"up":${JSON.stringify(['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'])}}}`).binds.up.length, 4);
  // One key firing two actions is precisely what the conflict rule exists to prevent, so it cannot arrive
  // through a hand-written cell either: the first action listed keeps it, the second loses it.
  const shared = parseSettings('{"binds":{"up":["KeyJ"],"attack":["KeyJ"]}}');
  assert.deepEqual(shared.binds.up, ['KeyJ']);
  // Attack falls back to its defaults minus the J the earlier action kept, which still leaves the button.
  assert.deepEqual(shared.binds.attack, ['Mouse0']);
  // Escape smuggled onto another action is stripped wherever it appears, whatever the blob claims.
  assert.deepEqual(parseSettings('{"binds":{"attack":["Escape","KeyJ"]}}').binds.attack, ['KeyJ']);
  assert.deepEqual(parseSettings('{"binds":{"attack":["Escape"]}}').binds.attack, ['Mouse0', 'KeyJ']);
  assert.deepEqual(parseSettings('{"binds":{"pause":["Escape","KeyP"]}}').binds.pause, ['Escape', 'KeyP']);
  // An action emptied by the blob falls back to its defaults rather than silently disappearing.
  assert.deepEqual(parseSettings('{"binds":{"dash":[]}}').binds.dash, ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  assert.deepEqual(parseSettings('{"binds":{"dash":["nope!"]}}').binds.dash, ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  // A fallback that is only partly claimed keeps what is left of it.
  assert.deepEqual(parseSettings('{"binds":{"up":["Space"],"left":["ShiftLeft"],"right":["ShiftRight"]}}').binds.dash, ['KeyL']);
  // And when the fallback itself has been claimed, the whole set goes back to defaults: an action nobody
  // can perform, on a card that shows no sign of it, is worse than a lost customisation.
  const stolen = parseSettings('{"binds":{"up":["Space","KeyL"],"left":["ShiftLeft"],"right":["ShiftRight"]}}');
  assert.deepEqual(stolen.binds, DEFAULT_BINDS);
});

test('binding a key takes it from whatever held it, and trades rather than disabling it', () => {
  const binds = defaultSettings().binds;
  // The plain case: an action drops its old keys entirely and answers to the new one alone - on the
  // keyboard. The button it also answers to is another device and stays where it was.
  const rebound = bindKey(binds, 'attack', 'KeyX');
  assert.deepEqual(rebound?.attack, ['Mouse0', 'KeyX']);
  assert.deepEqual(rebound?.up, ['KeyW', 'ArrowUp']);
  // Taking a key from an action that has another one left simply costs that action the key.
  const stolen = bindKey(binds, 'attack', 'ArrowUp');
  assert.deepEqual(stolen?.attack, ['Mouse0', 'ArrowUp']);
  assert.deepEqual(stolen?.up, ['KeyW']);
  const shift = bindKey(binds, 'attack', 'ShiftLeft');
  assert.deepEqual(shift?.attack, ['Mouse0', 'ShiftLeft']);
  assert.deepEqual(shift?.dash, ['Space', 'ShiftRight', 'KeyL']);
  // Taking an action's last key would leave it unusable and invisible, so the two trade instead: swap had
  // only E, so it inherits the key attack just stopped using.
  const traded = bindKey(binds, 'attack', 'KeyE');
  assert.deepEqual(traded?.attack, ['Mouse0', 'KeyE']);
  assert.deepEqual(traded?.swap, ['KeyJ']);
  const swapped = bindKey({ ...binds, dash: ['ShiftLeft'] }, 'attack', 'ShiftLeft');
  assert.deepEqual(swapped?.attack, ['Mouse0', 'ShiftLeft']);
  assert.deepEqual(swapped?.dash, ['KeyJ']);
  // Whatever the trade, no key ends up answering for two actions and no action ends up with none.
  for (const [action, code] of [['attack', 'ShiftLeft'], ['up', 'KeyS'], ['mute', 'KeyF'], ['dash', 'KeyW'], ['swap', 'Mouse0'], ['map', 'Mouse2'], ['special', 'Mouse0'], ['attack', 'KeyK'], ['dash', 'Mouse1']] as [Action, string][]) {
    const next = bindKey(binds, action, code);
    assert.ok(next, `${action}/${code} was refused`);
    const all = ACTIONS.flatMap(a => next[a]);
    assert.equal(new Set(all).size, all.length, `${code} answers twice`);
    assert.ok(ACTIONS.every(a => next[a].length > 0), `${action}/${code} left an action unreachable`);
  }
  // Rebinding to a key the action already holds is a no-op in meaning, and never empties anything.
  assert.deepEqual(bindKey(binds, 'up', 'KeyW')?.up, ['KeyW']);
  // The set handed in is never mutated, so a refused or abandoned rebind cannot half-apply.
  assert.deepEqual(binds, DEFAULT_BINDS);
});

test('plan 016: a blank blob is the mouse-and-keyboard layout, buttons included', () => {
  const binds = parseSettings(null).binds;
  assert.deepEqual(binds.attack, ['Mouse0', 'KeyJ']);
  assert.deepEqual(binds.special, ['Mouse2', 'KeyK']);
  assert.deepEqual(binds.dash, ['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  assert.deepEqual(binds.swap, ['KeyE']);
  assert.deepEqual(binds.map, ['Tab']);
  assert.deepEqual(binds, DEFAULT_BINDS);
  // Strike, special and dodge sit together ahead of everything a stray code could take them from.
  assert.deepEqual(ACTIONS.slice(ACTIONS.indexOf('attack'), ACTIONS.indexOf('attack') + 3), ['attack', 'special', 'dash']);
  assert.ok(ACTIONS.indexOf('dash') < ACTIONS.indexOf('swap'));
  // Every default is a legal code, and none of them answers for two actions.
  const all = ACTIONS.flatMap(a => DEFAULT_BINDS[a]);
  assert.equal(new Set(all).size, all.length);
  assert.ok(ACTIONS.every(a => DEFAULT_BINDS[a].length > 0 && DEFAULT_BINDS[a].length <= 4));
});

test('the side mouse buttons are never bind codes: Chrome goes Back and Forward on their release', () => {
  for (const code of ['Mouse3', 'Mouse4', 'Mouse5', 'Mouse12']) {
    assert.equal(bindKey(defaultSettings().binds, 'dash', code), null, `${code} is refused`);
    const read = parseSettings(JSON.stringify({ binds: { dash: [code, 'Space'], map: [code] } })).binds;
    assert.deepEqual(read.dash, ['Space'], `${code} is stripped from a stored blob`);
    assert.deepEqual(read.map, DEFAULT_BINDS.map, 'and an action left with nothing gets its defaults');
  }
  assert.ok(bindKey(defaultSettings().binds, 'dash', 'Mouse1'), 'the middle button is still a code');
});

test('plan 016: mouse buttons are codes like keys, round-trip through a blob and trade like keys', () => {
  const blob = JSON.stringify({ binds: { attack: ['Mouse0', 'KeyJ'], special: ['Mouse2'], swap: ['Mouse1'] } });
  const read = parseSettings(blob).binds;
  assert.deepEqual(read.attack, ['Mouse0', 'KeyJ']);
  assert.deepEqual(read.special, ['Mouse2']);
  assert.deepEqual(read.swap, ['Mouse1']);
  assert.deepEqual(parseSettings(JSON.stringify({ binds: read })).binds, read);
  const binds = defaultSettings().binds;
  // A button replaces the action's buttons and leaves its keys alone, and costs the action it came from.
  const moved = bindKey(binds, 'special', 'Mouse0');
  assert.deepEqual(moved?.special, ['Mouse0', 'KeyK']);
  assert.deepEqual(moved?.attack, ['KeyJ']);
  // The dodge has a full list, so a button pushes out its last key rather than growing past the cap.
  const dodge = bindKey(binds, 'dash', 'Mouse1');
  assert.deepEqual(dodge?.dash, ['Mouse1', 'Space', 'ShiftLeft', 'ShiftRight']);
  // Taking a button from an action that has nothing else trades: it inherits the button this one gave up.
  const lone = { ...binds, attack: ['Mouse0'] };
  const traded = bindKey(lone, 'special', 'Mouse0');
  assert.deepEqual(traded?.special, ['Mouse0', 'KeyK']);
  assert.deepEqual(traded?.attack, ['Mouse2']);
  // And when this action has no button to give up, the trade is its whole list.
  const whole = bindKey(lone, 'swap', 'Mouse0');
  assert.deepEqual(whole?.swap, ['Mouse0']);
  assert.deepEqual(whole?.attack, ['KeyE']);
  for (const next of [moved, dodge, traded, whole]) {
    assert.ok(next);
    const all = ACTIONS.flatMap(a => next[a]);
    assert.equal(new Set(all).size, all.length);
    assert.ok(ACTIONS.every(a => next[a].length > 0));
  }
});

test('plan 016: a blob from before special and map fills them from the defaults it has not claimed', () => {
  // The whole of what the previous build wrote for an untouched card. No migration (decision 5): the
  // strike stays on Space because the blob says so, and the two new actions come from the defaults.
  const old = JSON.stringify({ binds: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], attack: ['Space'], dash: ['ShiftLeft', 'ShiftRight'], swap: ['KeyE'], pause: ['Escape'], mute: ['KeyM'], fullscreen: ['KeyF'] } });
  const binds = parseSettings(old).binds;
  assert.deepEqual(binds.attack, ['Space']);
  assert.deepEqual(binds.special, ['Mouse2', 'KeyK']);
  assert.deepEqual(binds.dash, ['ShiftLeft', 'ShiftRight']);
  assert.deepEqual(binds.map, ['Tab']);
  // An earlier action that took one of a new action's defaults keeps it, and the new action keeps the rest.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyK"]}}').binds.special, ['Mouse2']);
  assert.deepEqual(parseSettings('{"binds":{"up":["Mouse2"]}}').binds.special, ['KeyK']);
  // One that took all of them would leave the new action empty, so the set goes back to defaults entire.
  assert.deepEqual(parseSettings('{"binds":{"up":["Tab"]}}').binds, DEFAULT_BINDS);
  assert.deepEqual(parseSettings('{"binds":{"up":["Mouse2"],"attack":["KeyK"]}}').binds, DEFAULT_BINDS);
  for (const raw of [old, '{"binds":{"attack":["KeyK"]}}', '{"binds":{"up":["Tab"]}}']) {
    const parsed = parseSettings(raw).binds;
    const all = ACTIONS.flatMap(a => parsed[a]);
    assert.equal(new Set(all).size, all.length, raw);
    assert.ok(ACTIONS.every(a => parsed[a].length > 0), raw);
  }
});

test('nothing can bind away the one key that opens the menu', () => {
  const binds = defaultSettings().binds;
  // Escape on anything but pause is refused outright rather than quietly ignored, so the card can say why.
  for (const action of ACTIONS.filter(a => a !== 'pause')) assert.equal(bindKey(binds, action, RESERVED), null);
  assert.deepEqual(bindKey(binds, 'pause', RESERVED)?.pause, [RESERVED]);
  // Moving pause elsewhere is allowed — Escape still opens the menu, because the game answers it whether or
  // not it is bound — but it must not leave Escape loose for another action to claim.
  const moved = bindKey(binds, 'pause', 'KeyP');
  assert.deepEqual(moved?.pause, ['KeyP']);
  assert.equal(bindKey(moved!, 'attack', RESERVED), null);
  // Nothing shaped unlike a key code gets through either: a blank, spaces or punctuation, or a run too long
  // to be one. (The check is on shape, not against the list of real codes.)
  for (const code of ['', ' ', 'Key W', 'Key-W', '{}', 'A'.repeat(25)]) assert.equal(bindKey(binds, 'attack', code), null, JSON.stringify(code));
});

test('settings survive a reload, and a store that will not have them costs only the customisation', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    // No storage object at all: naming it throws, and the game still has to come up playable.
    delete owner.localStorage;
    assert.deepEqual(readSettings(), shipped());
    writeSettings({ ...shipped(), volume: 0.3 } as Settings);
    // Present but hostile, as in a private window with site data blocked.
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.deepEqual(readSettings(), shipped());
    writeSettings({ ...shipped(), muted: true } as Settings);
    // A working store is the reload: what the card wrote is what the next visit plays with.
    const cell = new Map<string, string>();
    owner.localStorage = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    const chosen: Settings = { volume: 0.4, muted: true, reducedMotion: true, touchLayout: 'pad', binds: bindKey(defaultSettings().binds, 'attack', 'KeyJ')! };
    writeSettings(chosen);
    assert.deepEqual(readSettings(), chosen);
    // Settings live in their own cell, so remembering them cannot cost the run history or the record.
    assert.equal(cell.has('drowned-keep:settings'), true);
    assert.equal(cell.has('drowned-keep:runs'), false);
    // Junk in the cell reads as the shipped game rather than crashing the only screen that could fix it.
    cell.set('drowned-keep:settings', '{"volume":');
    assert.deepEqual(readSettings(), shipped());
    cell.set('drowned-keep:settings', '{"volume":0.2,"binds":{"up":"KeyW"}}');
    assert.deepEqual(readSettings(), { ...shipped(), volume: 0.2 });
  } finally {
    if (original) Object.defineProperty(owner, 'localStorage', original); else delete owner.localStorage;
  }
});
