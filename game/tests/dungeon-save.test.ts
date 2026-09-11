import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIONS, appendRun, betterRun, bindKey, DEFAULT_BINDS, defaultSettings, parseBest, parseRun, parseRuns, parseSeed, parseSettings, readBest, readRuns, readSeed, readSettings, RESERVED, RUN_LOG_CAP, summariseRuns, writeBest, writeRuns, writeSeed, writeSettings, type Action, type BestRun, type RunEnd, type Settings } from '../app/dungeon-save.ts';

const run = (floor: number, xp: number): BestRun => ({ floor, xp, kills: 0, won: false });
// A plausible death on floor 2, which every history test varies one field of.
const end = (over: Partial<RunEnd> = {}): RunEnd => ({ at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee, ...over });
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

test('a finished run lands at the end of the history and comes back unchanged', () => {
  assert.deepEqual(appendRun([], end()), [end()]);
  const first = end({ at: 1 }), second = won({ at: 2 });
  assert.deepEqual(appendRun([first], second), [first, second]);
  // The caller's list is never mutated, so a stale snapshot can never silently grow a phantom entry.
  const held = [first];
  appendRun(held, second);
  assert.deepEqual(held, [first]);
  // Through the exact JSON a browser would be holding: every field survives, which is the whole point
  // of writing one down — a run recorded in one session has to still be there in the next.
  assert.deepEqual(parseRuns(JSON.stringify([first, second])), [first, second]);
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
  assert.deepEqual(parseRun({ at: 9, floor: 2, won: false, cause: 'warden', seed: 3 }), { at: 9, floor: 2, won: false, cause: 'warden', seconds: 0, rank: 1, xp: 0, kills: 0, boons: [], seed: 3 });
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

test('storage that is missing or throws is indistinguishable from an empty one', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    // No storage object at all: naming it throws a ReferenceError, which must not escape.
    delete owner.localStorage;
    assert.equal(readBest(), null);
    assert.equal(readSeed(), null);
    writeBest({ floor: 3, xp: 900, kills: 20, won: true });
    writeSeed(1234);
    // Storage present but hostile, as in a private window with site data blocked.
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.equal(readBest(), null);
    assert.equal(readSeed(), null);
    writeBest({ floor: 3, xp: 900, kills: 20, won: true });
    writeSeed(1234);
    // A working store round-trips, and a corrupt value there still reads as absent.
    const cell = new Map<string, string>();
    owner.localStorage = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    writeBest({ floor: 2, xp: 310, kills: 9, won: false });
    writeSeed(0xdeadbeef);
    assert.deepEqual(readBest(), { floor: 2, xp: 310, kills: 9, won: false });
    assert.equal(readSeed(), 0xdeadbeef);
    cell.set('drowned-keep:best', '{"floor":');
    assert.equal(readBest(), null);
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
  assert.deepEqual(defaultSettings().binds.dash, ['ShiftLeft', 'ShiftRight']);
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
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyJ"]}}').binds.attack, ['KeyJ']);
  // An action the blob says nothing about keeps its defaults rather than becoming unusable.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyJ"]}}').binds.dash, ['ShiftLeft', 'ShiftRight']);
  // Non-strings, impossible codes and duplicates within one action are dropped, and the list is capped.
  assert.deepEqual(parseSettings('{"binds":{"attack":["KeyJ",7,null,"Key J","KeyJ","KeyK"]}}').binds.attack, ['KeyJ', 'KeyK']);
  assert.deepEqual(parseSettings(`{"binds":{"up":${JSON.stringify(['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'])}}}`).binds.up.length, 4);
  // One key firing two actions is precisely what the conflict rule exists to prevent, so it cannot arrive
  // through a hand-written cell either: the first action listed keeps it, the second loses it.
  const shared = parseSettings('{"binds":{"up":["KeyJ"],"attack":["KeyJ"]}}');
  assert.deepEqual(shared.binds.up, ['KeyJ']);
  assert.deepEqual(shared.binds.attack, ['Space']);
  // Escape smuggled onto another action is stripped wherever it appears, whatever the blob claims.
  assert.deepEqual(parseSettings('{"binds":{"attack":["Escape","KeyJ"]}}').binds.attack, ['KeyJ']);
  assert.deepEqual(parseSettings('{"binds":{"attack":["Escape"]}}').binds.attack, ['Space']);
  assert.deepEqual(parseSettings('{"binds":{"pause":["Escape","KeyP"]}}').binds.pause, ['Escape', 'KeyP']);
  // An action emptied by the blob falls back to its defaults rather than silently disappearing.
  assert.deepEqual(parseSettings('{"binds":{"dash":[]}}').binds.dash, ['ShiftLeft', 'ShiftRight']);
  assert.deepEqual(parseSettings('{"binds":{"dash":["nope!"]}}').binds.dash, ['ShiftLeft', 'ShiftRight']);
  // And when the fallback itself has been claimed, the whole set goes back to defaults: an action nobody
  // can perform, on a card that shows no sign of it, is worse than a lost customisation.
  const stolen = parseSettings('{"binds":{"up":["Space"],"left":["ShiftLeft"],"right":["ShiftRight"]}}');
  assert.deepEqual(stolen.binds, DEFAULT_BINDS);
});

test('binding a key takes it from whatever held it, and trades rather than disabling it', () => {
  const binds = defaultSettings().binds;
  // The plain case: an action drops its old keys entirely and answers to the new one alone.
  const rebound = bindKey(binds, 'attack', 'KeyJ');
  assert.deepEqual(rebound?.attack, ['KeyJ']);
  assert.deepEqual(rebound?.up, ['KeyW', 'ArrowUp']);
  // Taking a key from an action that has another one left simply costs that action the key.
  const stolen = bindKey(binds, 'attack', 'ArrowUp');
  assert.deepEqual(stolen?.attack, ['ArrowUp']);
  assert.deepEqual(stolen?.up, ['KeyW']);
  // Taking an action's last key would leave it unusable and invisible, so the two trade instead: dash had
  // only the shifts, so it inherits the key attack just stopped using.
  const traded = bindKey(binds, 'attack', 'ShiftLeft');
  assert.deepEqual(traded?.attack, ['ShiftLeft']);
  assert.deepEqual(traded?.dash, ['ShiftRight']);
  const swapped = bindKey({ ...binds, dash: ['ShiftLeft'] }, 'attack', 'ShiftLeft');
  assert.deepEqual(swapped?.attack, ['ShiftLeft']);
  assert.deepEqual(swapped?.dash, ['Space']);
  // Whatever the trade, no key ends up answering for two actions and no action ends up with none.
  for (const [action, code] of [['attack', 'ShiftLeft'], ['up', 'KeyS'], ['mute', 'KeyF'], ['dash', 'KeyW']] as [Action, string][]) {
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
  // Nothing that is not a key code gets through either: a blank, a legend, or a whole word.
  for (const code of ['', ' ', 'w', 'Key W', 'Key-W', '{}', 'A'.repeat(25)]) if (!/^[A-Za-z0-9]{1,24}$/.test(code)) assert.equal(bindKey(binds, 'attack', code), null);
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
