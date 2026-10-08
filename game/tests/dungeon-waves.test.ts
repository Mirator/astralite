import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { generateFloor, PACK_MIX, TILE, ARRIVAL_CLEAR, type Spawn } from '../app/dungeon-floor.ts';
import { BESTIARY, reserveSize } from '../app/dungeon-bestiary.ts';
import { CHAMBER_CAP, CORPSE_DEPTH, corpseSink, corpsesDue, dealWaves, fitWave, FIRST_WAVE_LAYERS, idleClock, isRanged, rangedKinds, withRanged, springing, calledIn, roomTiles, spotOf, waveDue, waveSpots, WAVE_CAP, WAVE_CLEAR, WAVE_MARK, WAVE_OPENING, WAVE_PAUSE, WAVE_TABLE, wavedFloor, type WaveBody, type WaveClock, type WaveTable } from '../app/dungeon-waves.ts';

type Floor = ReturnType<typeof generateFloor>;
const SEEDS = Array.from({ length: 150 }, (_, i) => i * 7919 + 13);
const LEVELS = [1, 2, 3];

// What plan 022 D2 asks for, written out here so the structure is held to it whatever the shipped table holds at any stage.
const D2: WaveTable = {
  middle: [{ count: [2, 3], mix: PACK_MIX.late }],
  late: [{ count: [2, 3], mix: PACK_MIX.late }, { count: [1, 2], mix: PACK_MIX.late, warden: true }],
  hoard: [{ count: [2, 3], mix: PACK_MIX.hoard }],
};

const waved = (floor: Floor, level: number, table: WaveTable = D2) => dealWaves(floor, floor.seed, level, table);

test('generateFloor deals what it dealt before waves existed, byte for byte, over 900 floors (D5)', () => {
  // Recorded at plan 022's start (main + the plan, 2fa0546), before any of this plan's code existed: the rooms, doors, props, spawns, weapon drop and
  // counts of 300 seeds on each floor. A waves change that reached into the generator, even by one `random()` call, changes every pack after it.
  // Plan 025 Stage G: the bomber takes its share of a pack from the guard's leftover (PACK_MIX), on the same one roll a body, so a floor is the floor plan 022 started from with some guards dealt as bombers: read back as
  // guards, the digest is the recorded one. Anything else that moved - a draw more, a body moved, a kind other than a guard replaced - still changes it.
  const hash = createHash('sha256');
  let floors = 0, bombers = 0;
  for (let i = 1; i <= 300; i++) for (const level of LEVELS) {
    const f = generateFloor(i * 7919 + 13, level), spawns = f.spawns.map(spawn => spawn.kind === 'bomber' ? (bombers++, { ...spawn, kind: 'guard' as const }) : spawn);
    hash.update(JSON.stringify([f.rooms, f.doors, f.props, spawns, f.weaponDrop, f.guardCount, f.goal, f.tiles.length])); floors++;
  }
  assert.equal(floors, 900);
  assert.ok(bombers > 0, 'precondition: the corpus deals bombers, so reading them back as guards is tested');
  assert.equal(hash.digest('hex'), 'b6b554323fefc359b9dced4f12f8116d3c3be644fbeca47f27e4ba4b759dd308', 'generateFloor no longer deals the floors plan 022 started from: a wave rule reached into the generator, or it drew a random number it did not draw before');
});

test('dealWaves keeps every existing spawn where it was and only appends, buried reserves included (D5)', () => {
  let appended = 0, floorsWithReserve = 0, wavedFloors = 0;
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), before = structuredClone(floor.spawns), out = waved(floor, level);
    assert.deepEqual(floor.spawns, before, `seed ${seed} floor ${level}: dealWaves changed the floor's own spawns`);
    assert.deepEqual(out.slice(0, before.length), before, `seed ${seed} floor ${level}: a wave body was dealt among the spawns generateFloor laid, which moves an index and with it every summoner link`);
    const extra = out.slice(before.length);
    appended += extra.length;
    if (extra.length) wavedFloors++;
    // The reserve generateFloor buries (the King's, on floor three) is among the spawns that keep their place: the proof that "after the buried reserves" was tested.
    if (before.some(s => s.buried) && extra.length) floorsWithReserve++;
    for (const spawn of extra) {
      assert.ok((spawn.wave ?? 1) >= 2, `seed ${seed} floor ${level}: an appended ${spawn.kind} is in the first wave`);
      if (spawn.buried) assert.ok(spawn.summoner! >= before.length, `seed ${seed} floor ${level}: a wave's reserve is bound to a body that was not appended`);
    }
    // Every summoner link of the floor's own reserve still names the same caller.
    out.slice(0, before.length).forEach((spawn, i) => assert.equal(spawn.summoner, before[i].summoner));
  }
  assert.ok(appended > 300, `precondition: only ${appended} wave bodies were dealt over 450 floors, so the append-only rule was barely exercised`);
  assert.ok(wavedFloors > 200, `precondition: only ${wavedFloors} of 450 floors were dealt a wave`);
  assert.ok(floorsWithReserve > 30, `precondition: only ${floorsWithReserve} floors held a buried reserve before the waves, so "after the reserves" was not exercised`);
});

test('a table that deals nothing leaves the spawns the same array of the same bodies', () => {
  for (const level of LEVELS) for (const seed of SEEDS.slice(0, 20)) {
    const floor = generateFloor(seed, level);
    assert.deepEqual(dealWaves(floor, seed, level, {}), floor.spawns, `seed ${seed} floor ${level}`);
  }
});

test('later waves stand only in watch and purse chambers past the first two fights, never on the arrival or a door, and keep their distance', () => {
  let checked = 0;
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), out = waved(floor, level), extra = out.slice(floor.spawns.length).filter(s => !s.buried);
    for (const spawn of extra) {
      const room = floor.rooms[spawn.room];
      const where = `seed ${seed} floor ${level} room ${room.id}`;
      assert.equal(room.role, 'path', where);
      assert.equal(room.encounter, 'watch', `${where}: a ${room.encounter} chamber was dealt a wave`);
      assert.ok(room.layer > FIRST_WAVE_LAYERS, `${where}: layer ${room.layer} is the first fight past the gate`);
      assert.ok(spawn.ambush, `${where}: a wave body is not dormant`);
      assert.ok(roomTiles(floor, room.id).some(t => t.x === spawn.x && t.z === spawn.z), `${where}: a wave body stands off its chamber's own floor`);
      assert.ok(Math.hypot(spawn.x - room.entry.x, spawn.z - room.entry.z) >= ARRIVAL_CLEAR, `${where}: a wave body stands on the arrival`);
      assert.ok(floor.doors.filter(d => d.from === room.id).every(d => Math.hypot(d.x - spawn.x, d.z - spawn.z) >= 2.5), `${where}: a wave body stands in a doorway`);
      // 2.2 tiles apart, as the generator keeps a pack; only a pinned warden or a ranged body (plan 024 D4 moved the warden's from 1.2 to a tile's own, 1), in a chamber with no such tile left, stands closer.
      for (const other of extra) if (other !== spawn && other.room === spawn.room) assert.ok(Math.hypot(other.x - spawn.x, other.z - spawn.z) >= (spawn.kind === 'warden' || other.kind === 'warden' || fightsFromRange(spawn.kind, level) || fightsFromRange(other.kind, level) ? 1 : 2.2), `${where}: two wave bodies stand ${Math.hypot(other.x - spawn.x, other.z - spawn.z).toFixed(2)} tiles apart`);
      checked++;
    }
  }
  assert.ok(checked > 300, `precondition: only ${checked} wave bodies were checked`);
});

// Plan 023 (D4): the first fight past the gate (layer 1) stays one wave, the tutorial beat; from the second on (layer 2) a watch fight is dealt waves. The shipped table has no rule for an `opening` pack, so this holds the rule with a table
// that has one for every source: what keeps layer 1 single-wave is `FIRST_WAVE_LAYERS`, not the table.
test('the first fight past the gate is dealt no waves and the second is (plan 023 D4)', () => {
  assert.equal(FIRST_WAVE_LAYERS, 1, 'D4: the first fight is the tutorial beat, and from the second on watch fights take waves');
  const everySource: WaveTable = { ...D2, opening: [{ count: [2, 3], mix: PACK_MIX.opening }] };
  const waves = { 1: 0, 2: 0 };
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), out = dealWaves(floor, seed, level, everySource);
    for (const spawn of out.slice(floor.spawns.length).filter(s => !s.buried)) {
      const layer = floor.rooms[spawn.room].layer;
      if (layer === 1) assert.fail(`seed ${seed} floor ${level}: the first fight past the gate was dealt a wave`);
      if (layer === 2) waves[2]++;
    }
    waves[1] += floor.rooms.filter(room => room.role === 'path' && room.layer === 1 && room.encounter === 'watch').length;
  }
  assert.ok(waves[1] > 100, `precondition: only ${waves[1]} first fights were laid`);
  assert.ok(waves[2] > 100, `the second fight past the gate was dealt ${waves[2]} wave bodies over ${SEEDS.length * LEVELS.length} floors`);
});

test('a source with no rule is dealt one wave: a purse-only table touches no other chamber', () => {
  let purses = 0;
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), out = dealWaves(floor, seed, level, { hoard: D2.hoard });
    for (const spawn of out.slice(floor.spawns.length)) { assert.equal(floor.rooms[spawn.room].reward, 'cache', `seed ${seed} floor ${level}: a chamber that is no purse was dealt a purse's wave`); purses++; }
  }
  assert.ok(purses > 40, `precondition: only ${purses} purse wave bodies were dealt`);
});

test('a chamber\'s waves are its own: adding a rule for one kind of fight moves no body of another', () => {
  let compared = 0;
  for (const level of LEVELS) for (const seed of SEEDS.slice(0, 80)) {
    const floor = generateFloor(seed, level), middleOnly = dealWaves(floor, seed, level, { middle: D2.middle }), both = dealWaves(floor, seed, level, { middle: D2.middle, hoard: D2.hoard });
    const middles = (list: Spawn[]) => list.slice(floor.spawns.length).filter(s => !s.buried && floor.rooms[s.room].reward !== 'cache').map(s => JSON.stringify(s));
    assert.deepEqual(middles(both), middles(middleOnly), `seed ${seed} floor ${level}: dealing purse waves moved a middle chamber's bodies`);
    compared += middles(both).length;
  }
  assert.ok(compared > 50, `precondition: only ${compared} bodies were compared`);
});

test('no wave is larger than the wave cap and no chamber larger than the chamber cap (D2)', () => {
  const huge: WaveTable = { middle: [{ count: [6, 8], mix: PACK_MIX.late }], late: [{ count: [4, 5], mix: PACK_MIX.late }, { count: [4, 5], mix: PACK_MIX.late }, { count: [4, 5], mix: PACK_MIX.late, warden: true }] };
  let biggestWave = 0, biggestChamber = 0;
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), out = dealWaves(floor, seed, level, huge);
    const perRoom = new Map<number, Map<number, Spawn[]>>();
    for (const spawn of out) if (!spawn.buried) { const rooms = perRoom.get(spawn.room) ?? new Map<number, Spawn[]>(); rooms.set(spawn.wave ?? 1, [...(rooms.get(spawn.wave ?? 1) ?? []), spawn]); perRoom.set(spawn.room, rooms); }
    for (const [room, waves] of perRoom) {
      let total = 0;
      for (const [wave, bodies] of waves) { total += bodies.length; if (wave > 1) biggestWave = Math.max(biggestWave, bodies.length); assert.ok(wave === 1 || bodies.length <= WAVE_CAP, `seed ${seed} floor ${level} room ${room}: wave ${wave} holds ${bodies.length}, over the cap of ${WAVE_CAP}`); }
      // A chamber over the cap in its first wave alone (a purse of seven) is not this rule's to cut; what it adds never takes it further than the cap.
      const first = waves.get(1)?.length ?? 0;
      if (waves.size > 1) { biggestChamber = Math.max(biggestChamber, total); assert.ok(total <= Math.max(CHAMBER_CAP, first), `seed ${seed} floor ${level} room ${room}: ${total} standing bodies, over the cap of ${CHAMBER_CAP}`); }
    }
  }
  assert.equal(biggestWave, WAVE_CAP, 'precondition: no wave was asked for more than the cap, so the cap was never reached');
  assert.equal(biggestChamber, CHAMBER_CAP, 'precondition: no chamber was asked for more than its cap, so the cap was never reached');
});

test('the later waves add one body to the last wave on floor two and floor three, and none on floor one (D2)', () => {
  const lone: WaveTable = { middle: [{ count: [2, 2], mix: { stalker: 1 } }], late: [{ count: [2, 2], mix: { stalker: 1 } }] };
  // A chamber with no room left for the last body (a 45-tile crypt) deals one fewer, as the generator's own packs do: the mode is what is held (measured 2026-10-03 over 450 seeds: 90% of floor three's waves are whole, 6% one short, 4% two short).
  const sizes = (level: number) => {
    const counts = new Map<number, number>();
    for (const seed of SEEDS) {
      const floor = generateFloor(seed, level), out = dealWaves(floor, seed, level, lone), byRoom = new Map<number, number>();
      for (const spawn of out.slice(floor.spawns.length)) byRoom.set(spawn.room, (byRoom.get(spawn.room) ?? 0) + 1);
      for (const n of byRoom.values()) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  };
  for (const [level, want] of [[1, 2], [2, 3], [3, 3]] as const) {
    const counts = sizes(level), total = [...counts.values()].reduce((a, b) => a + b, 0);
    assert.ok(total > 100, `precondition: only ${total} waves were dealt on floor ${level}`);
    assert.ok((counts.get(want) ?? 0) / total >= .85, `floor ${level}: ${JSON.stringify([...counts])} - a last wave of two stalkers should stand ${want} (floor one: 2, deeper floors: 3)`);
    assert.ok([...counts.keys()].every(n => n <= want), `floor ${level}: a wave of more than ${want} was dealt`);
  }
});

test('a caller dealt into a wave buries its own reserve after the wave bodies, in its wave', () => {
  let callers = 0;
  for (const seed of SEEDS.concat(SEEDS.map(s => s + 1))) {
    const floor = generateFloor(seed, 3), out = dealWaves(floor, seed, 3, { late: [{ count: [3, 3], mix: { bonecaller: 1 } }], middle: [{ count: [3, 3], mix: { bonecaller: 1 } }] });
    out.forEach((spawn, index) => {
      if (index < floor.spawns.length || spawn.kind !== 'bonecaller') return;
      callers++;
      const reserve = out.map((s, i) => ({ s, i })).filter(({ s }) => s.summoner === index);
      assert.equal(reserve.length, reserveSize('bonecaller'), `seed ${seed}: a wave caller's reserve is the wrong size`);
      assert.ok(reserve.every(({ s, i }) => s.buried && s.kind === BESTIARY.bonecaller.summons!.kind && s.wave === spawn.wave && s.room === spawn.room && i > index && s.x === spawn.x && s.z === spawn.z), `seed ${seed}: a wave caller's reserve is not buried at its feet in its wave`);
    });
    const waveBodies = out.slice(floor.spawns.length), firstBuried = waveBodies.findIndex(s => s.buried);
    if (firstBuried >= 0) assert.ok(waveBodies.slice(firstBuried).every(s => s.buried), `seed ${seed}: a wave body was dealt after a wave reserve began`);
    // One caller to a wave: a second in the same pack is a guard.
    const perWave = new Map<string, number>();
    for (const spawn of waveBodies) if (spawn.kind === 'bonecaller') perWave.set(`${spawn.room}:${spawn.wave}`, (perWave.get(`${spawn.room}:${spawn.wave}`) ?? 0) + 1);
    assert.ok([...perWave.values()].every(n => n === 1), `seed ${seed}: a wave held two callers`);
  }
  assert.ok(callers > 10, `precondition: only ${callers} wave callers were dealt`);
});

test('wavedFloor replaces the spawns and nothing else', () => {
  const floor = generateFloor(7919, 3), out = wavedFloor(floor, 7919, 3, D2);
  assert.deepEqual({ ...out, spawns: 0 }, { ...floor, spawns: 0 });
  assert.ok(out.spawns.length > floor.spawns.length, 'precondition: the floor was dealt a wave');
  assert.equal(out.guardCount, floor.guardCount, 'the count of bodies standing in the first wave is not the waves\' to change');
});

// --- the rule a chamber calls its next wave by -------------------------------------------------------------------------------

const body = (over: Partial<WaveBody> = {}): WaveBody => ({ room: 4, wave: undefined, dead: false, buried: false, awake: true, ...over });
const FRAME = 1 / 60;
/** Runs the rule frame by frame and writes down the frame (in seconds since the last first-wave body fell) each call came on. */
const runRule = (bodies: WaveBody[], frames: number, onFrame?: (second: number) => void) => {
  let clock: WaveClock = idleClock(4);
  const marks: number[] = [], raises: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    onFrame?.(frame * FRAME);
    const step = waveDue(bodies, 4, clock, FRAME);
    clock = step.clock;
    if (step.mark !== null) marks.push(frame * FRAME);
    if (step.raise !== null) { raises.push(frame * FRAME); for (const b of bodies) if (b.room === 4 && b.wave === step.raise) b.awake = true; }
  }
  return { marks, raises };
};

test('a chamber calls its second wave only after the last body of the first has fallen, after the pause and the rings', () => {
  const first = [body(), body()], second = [body({ wave: 2, awake: false }), body({ wave: 2, awake: false })];
  const bodies = [...first, ...second];
  // One body falls at 1 s and the other at 3 s; the rule must say nothing until 3 s, ring after WAVE_PAUSE and raise WAVE_MARK after that.
  const { marks, raises } = runRule(bodies, 60 * 8, second_ => { if (second_ >= 1) first[0].dead = true; if (second_ >= 3) first[1].dead = true; });
  assert.equal(marks.length, 1, 'the rings were called more than once, or never');
  assert.equal(raises.length, 1, 'the wave was raised more than once, or never');
  assert.ok(marks[0] >= 3 + WAVE_PAUSE - 2 * FRAME, `the rings came at ${marks[0].toFixed(2)} s, before the last body fell at 3 s plus the pause`);
  assert.ok(marks[0] <= 3 + WAVE_PAUSE + 2 * FRAME, `the rings came at ${marks[0].toFixed(2)} s, late`);
  assert.ok(raises[0] - marks[0] >= WAVE_MARK - 2 * FRAME && raises[0] - marks[0] <= WAVE_MARK + 2 * FRAME, `the wave stood ${(raises[0] - marks[0]).toFixed(2)} s after its rings, not ${WAVE_MARK}`);
  assert.ok(second.every(b => b.awake), 'the second wave did not stand up');
});

test('plan 026 (D1): the next wave is back on the knight within 1.4 s of the last body falling, opening cooldown included', () => {
  const first = [body()], second = [body({ wave: 2, awake: false })];
  const { marks, raises } = runRule([...first, ...second], 60 * 4, second_ => { if (second_ >= 1) first[0].dead = true; });
  assert.equal(raises.length, 1, 'the wave was never raised, so there is no gap to measure');
  assert.ok(marks[0] >= 1, `the rings came at ${marks[0].toFixed(2)} s, before the last body fell`);
  // The operator found 0.5 + 0.9 + 0.9 = 2.3 s of dead air too slow (2026-10-08); the gap is the rule's own raise plus the cooldown a raised body is given.
  const gap = raises[0] - 1 + WAVE_OPENING;
  assert.ok(gap <= 1.4, `${gap.toFixed(2)} s from the last body falling to the next wave's first possible blow (pause ${WAVE_PAUSE}, rings ${WAVE_MARK}, opening ${WAVE_OPENING})`);
  assert.ok(WAVE_MARK >= 0.5, `the rings show for ${WAVE_MARK} s, too short to read where the wave will stand`);
});

test('a wave is never called by time alone, and the first death of a pack calls nothing', () => {
  const first = [body(), body(), body()], second = [body({ wave: 2, awake: false })];
  const { marks, raises } = runRule([...first, ...second], 60 * 60, second_ => { if (second_ >= 5) first[0].dead = true; if (second_ >= 10) first[1].dead = true; });
  assert.deepEqual([marks, raises], [[], []], 'two bodies of three fell and a minute passed, and the next wave was called');
  assert.equal(second[0].awake, false);
});

test('waves are called one at a time: the third is not called while the second is still down', () => {
  const first = [body()], second = [body({ wave: 2, awake: false })], third = [body({ wave: 3, awake: false })];
  const all = [...first, ...second, ...third];
  first[0].dead = true;
  const log: string[] = [];
  let clock: WaveClock = idleClock(4);
  for (let frame = 0; frame < 60 * 12; frame++) {
    const step = waveDue(all, 4, clock, FRAME);
    clock = step.clock;
    if (step.mark !== null) log.push(`mark ${step.mark}`);
    if (step.raise !== null) { log.push(`raise ${step.raise}`); all.filter(b => b.wave === step.raise).forEach(b => { b.awake = true; }); }
    // The second wave's body falls five seconds after it stands.
    if (frame === 60 * 6) second[0].dead = true;
  }
  assert.deepEqual(log, ['mark 2', 'raise 2', 'mark 3', 'raise 3']);
});

test('a reserve waiting under a standing caller holds the wave; the caller\'s fall releases it', () => {
  const caller = body(), reserve = body({ buried: true, awake: false }), second = body({ wave: 2, awake: false });
  const all = [caller, reserve, second];
  assert.equal(waveDue(all, 4, idleClock(4), 5).mark, null, 'the caller stands and the wave was called');
  // Its other bodies are all down, the reserve is buried, the caller is alive: still not.
  let step = waveDue(all, 4, idleClock(4), 5);
  assert.deepEqual([step.mark, step.raise, step.pending], [null, null, 2]);
  caller.dead = true; reserve.dead = true;
  step = waveDue(all, 4, idleClock(4), 5);
  assert.equal(step.mark, 2, 'the caller fell and its reserve crumbled, and the wave was not called');
});

test('the rule reads only the chamber it is asked about', () => {
  const elsewhere = [body({ room: 9, dead: true }), body({ room: 9, wave: 2, awake: false })];
  const step = waveDue([...elsewhere, body()], 4, idleClock(4), 5);
  assert.deepEqual([step.mark, step.raise, step.pending], [null, null, null], 'a dormant body of another chamber is waited for');
});

test('the knight\'s walking in springs the first wave\'s sleepers and never a later wave', () => {
  const asleep = body({ awake: false }), later = body({ wave: 2, awake: false }), reserve = body({ buried: true, awake: false }), dead = body({ awake: false, dead: true }), other = body({ room: 7, awake: false });
  assert.deepEqual(springing([asleep, later, reserve, dead, other], 4), [asleep]);
  assert.equal(calledIn(later), false, 'a wave not yet called is there to be walked at');
  assert.equal(calledIn({ ...later, awake: true }), true);
  assert.equal(calledIn(asleep), true, 'an ambush body is walked at');
});

// --- where the rings go ----------------------------------------------------------------------------------------------------------

test('no ring lands within the clearance of the knight, and no two bodies are raised on one another (D4)', () => {
  let moved = 0, checked = 0;
  for (const level of LEVELS) for (const seed of SEEDS.slice(0, 40)) {
    const floor = generateFloor(seed, level), out = waved(floor, level);
    const wave = out.slice(floor.spawns.length).filter(s => !s.buried);
    for (const room of floor.rooms) {
      const mine = wave.filter(s => s.room === room.id && s.wave === 2);
      if (!mine.length) continue;
      const open = roomTiles(floor, room.id).map(t => ({ x: t.x * TILE, z: t.z * TILE })), spots = mine.map(spotOf);
      // The knight stands on the first body's tile and, in a second pass, a tile away from it: the worst places for a ring to be.
      for (const knight of [spots[0], { x: spots[0].x + TILE, z: spots[0].z }, { x: room.x * TILE, z: room.z * TILE }]) {
        const placed = waveSpots(open, spots, knight);
        assert.equal(placed.length, spots.length);
        placed.forEach((at, i) => {
          checked++;
          if (Math.hypot(spots[i].x - knight.x, spots[i].z - knight.z) < WAVE_CLEAR) moved++;
          assert.ok(Math.hypot(at.x - knight.x, at.z - knight.z) >= WAVE_CLEAR, `seed ${seed} floor ${level} room ${room.id}: a ring stands ${Math.hypot(at.x - knight.x, at.z - knight.z).toFixed(2)} from the knight`);
          assert.ok(open.some(tile => tile.x === at.x && tile.z === at.z), `seed ${seed}: a ring left the chamber's floor`);
          placed.forEach((other, j) => { if (j !== i) assert.ok(Math.hypot(other.x - at.x, other.z - at.z) >= 1.5 - 1e-9, `seed ${seed}: two rings share a spot`); });
        });
      }
    }
  }
  assert.ok(checked > 200, `precondition: only ${checked} rings were checked`);
  assert.ok(moved > 30, `precondition: only ${moved} rings began within ${WAVE_CLEAR} of the knight, so the clearance was barely exercised`);
});

test('a ring already clear of the knight stays where it was dealt', () => {
  const open = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * TILE, z: Math.floor(i / 6) * TILE }));
  const spots = [open[0], open[29]], knight = { x: open[14].x, z: open[14].z };
  assert.ok(spots.every(s => Math.hypot(s.x - knight.x, s.z - knight.z) >= WAVE_CLEAR), 'precondition: both spots are clear');
  assert.deepEqual(waveSpots(open, spots, knight), spots);
});

test('the shipped table is the one the plan decided (D2), and deals what it says over 450 floors', () => {
  assert.deepEqual(WAVE_TABLE, D2, 'the shipped table is not D2: middle fights a second wave of 2-3 from the late mix; late fights a second of 2-3 and a third of 1-2 with a warden; purse chambers a second of 2-3 from the hoard mix');
  let middle = 0, late = 0, purse = 0;
  for (const level of LEVELS) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), out = dealWaves(floor, seed, level), dealt = out.slice(floor.spawns.length).filter(s => !s.buried);
    assert.deepEqual(dealWaves(floor, seed, level), out, 'the same floor dealt twice differs');
    const waves = new Map<number, Set<number>>();
    for (const spawn of dealt) waves.set(spawn.room, new Set([...(waves.get(spawn.room) ?? []), spawn.wave!]));
    for (const [room, set] of waves) {
      const seen = [...set].sort((a, b) => a - b);
      assert.deepEqual(seen, seen.length === 2 ? [2, 3] : [2], `seed ${seed} floor ${level} room ${room}: waves ${seen.join(', ')} - a chamber is dealt wave 2, or waves 2 and 3`);
      // Plan 024 D4: a chamber with one tile left for the third wave stands the ranged body the wave is owed and not the warden (progress.md counts how often).
      if (seen.length === 2) { late++; const third = dealt.filter(s => s.room === room && s.wave === 3); assert.ok(third.some(s => s.kind === 'warden') || (third.length === 1 && third[0].kind === 'archer' || third.length === 1 && third[0].kind === 'pyre'), `seed ${seed} floor ${level} room ${room}: a third wave without its warden`); }
      else if (floor.rooms[room].reward === 'cache') purse++; else middle++;
    }
    for (const spawn of dealt) assert.ok(floor.rooms[spawn.room].encounter === 'watch' && floor.rooms[spawn.room].layer > FIRST_WAVE_LAYERS, `seed ${seed}: a wave in an ambush, a gauntlet, a shrine, the stair hall or the first fight`);
  }
  assert.ok(middle > 30 && late > 30 && purse > 30, `precondition: ${middle} middle, ${late} late and ${purse} purse chambers were dealt waves`);
});

test('when a cap bites, the warden pinned to a wave stays and the drawn bodies are what is cut', () => {
  assert.deepEqual(fitWave(['stalker', 'guard', 'archer'], true, 2), ['warden', 'stalker'], 'a warden pinned to a wave of three, with room for two');
  assert.deepEqual(fitWave(['stalker', 'guard', 'archer'], true, 1), ['warden'], 'with room for one, only the warden');
  assert.deepEqual(fitWave(['stalker', 'guard', 'archer'], false, 2), ['stalker', 'guard']);
  assert.deepEqual(fitWave(['stalker'], true, 5), ['warden', 'stalker'], 'a wave inside the cap is whole');
  assert.deepEqual(fitWave(['stalker'], true, 0), [], 'a chamber with no room is dealt nothing, the warden included');
});

test('the floor takes back the dead of the waves before, and only those, over the rings\' WAVE_MARK', () => {
  const fallen = body({ dead: true }), earlier = body({ dead: true, wave: 2 }), later = body({ dead: true, wave: 3 }), standing = body({ wave: 1 }), elsewhere = body({ dead: true, room: 9 });
  assert.deepEqual(corpsesDue([fallen, earlier, later, standing, elsewhere], 4, 3), [fallen, earlier], 'the corpses due when wave 3 is rung are the chamber\'s fallen of waves 1 and 2');
  assert.deepEqual(corpsesDue([fallen, earlier, later], 4, 2), [fallen], 'wave 2 being rung takes only wave 1\'s');
  assert.deepEqual(corpsesDue([fallen], 4, 1), [], 'nothing is taken before a second wave');
  assert.deepEqual(corpseSink(0), { depth: 0, gone: false });
  let last = 0;
  for (let age = 0; age < WAVE_MARK; age += 0.05) { const { depth, gone } = corpseSink(age); assert.ok(depth >= last && !gone, `a corpse is gone or rising ${age.toFixed(2)} s into the rings`); last = depth; }
  assert.ok(last > CORPSE_DEPTH * 0.7, `a corpse has only sunk ${last} by the end of the rings`);
  assert.deepEqual(corpseSink(WAVE_MARK), { depth: CORPSE_DEPTH, gone: true }, 'a corpse is not gone, and as deep as the floor takes it, when the wave stands');
  assert.equal(corpseSink(WAVE_MARK + 5).gone, true);
});

// Plan 024 Stage C (D4): every wave after the first holds a body that fights from range. Written out here from the plan, not read back from `withRanged`: an archer on any floor, a pyre from floor two. 1,000 seeds on each floor.
const RANGED_SEEDS = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13);
const wavesOf = (floor: Floor, out: Spawn[]) => {
  const byWave = new Map<string, Spawn[]>();
  for (const spawn of out.slice(floor.spawns.length)) if (!spawn.buried) byWave.set(`${spawn.room}:${spawn.wave}`, [...(byWave.get(`${spawn.room}:${spawn.wave}`) ?? []), spawn]);
  return byWave;
};
const fightsFromRange = (kind: string, level: number) => kind === 'archer' || (kind === 'pyre' && level >= 2);

test('every wave after the first deals at least one ranged body, from floor one, over 1,000 seeds a floor (plan 024 D4)', () => {
  for (const level of LEVELS) {
    let waves = 0, bare = 0, archers = 0, pyres = 0;
    for (const seed of RANGED_SEEDS) {
      const floor = generateFloor(seed, level), out = waved(floor, level, WAVE_TABLE), without = dealWaves(floor, seed, level, WAVE_TABLE, false);
      for (const [wave, bodies] of wavesOf(floor, out)) {
        waves++;
        assert.ok(bodies.some(b => fightsFromRange(b.kind, level)), `seed ${seed} floor ${level} wave ${wave}: ${bodies.map(b => b.kind).join(', ')} - not one fights from range`);
        archers += bodies.filter(b => b.kind === 'archer').length; pyres += bodies.filter(b => b.kind === 'pyre').length;
      }
      // The precondition that makes "every wave has one" mean something: without the rule, the same floor deals waves that hold none.
      for (const bodies of wavesOf(floor, without).values()) if (!bodies.some(b => fightsFromRange(b.kind, level))) bare++;
    }
    assert.ok(waves > 500, `precondition: only ${waves} later waves were dealt over 1,000 floors of floor ${level}`);
    assert.ok(bare > waves * 0.2, `precondition: only ${bare} of ${waves} waves lack a ranged body without the rule on floor ${level}: the rule changes too little for the test to bind it`);
    assert.ok(archers > 0, `floor ${level} dealt no archer in a later wave`);
    if (level === 1) assert.equal(pyres, 0, 'a pyre was dealt in a later wave on floor one, where the rule asks an archer');
    else assert.ok(pyres > 0, `floor ${level} dealt no pyre in a later wave: the rule may use one from floor two`);
  }
});

test('the ranged rule trades melee bodies for ranged ones and adds few bodies and no warden loss worth the name (plan 024 D4)', () => {
  for (const level of LEVELS) {
    let on = 0, off = 0, wardensOn = 0, wardensOff = 0, rangedOn = 0, rangedOff = 0, melee = 0, meleeOff = 0;
    for (const seed of RANGED_SEEDS.slice(0, 300)) {
      const floor = generateFloor(seed, level), a = waved(floor, level, WAVE_TABLE), b = dealWaves(floor, seed, level, WAVE_TABLE, false);
      assert.deepEqual(a.slice(0, floor.spawns.length), floor.spawns, `seed ${seed} floor ${level}: the rule touched a spawn generateFloor laid`);
      const later = (spawns: Spawn[]) => spawns.slice(floor.spawns.length).filter(s => !s.buried);
      on += later(a).length; off += later(b).length;
      wardensOn += later(a).filter(s => s.kind === 'warden').length; wardensOff += later(b).filter(s => s.kind === 'warden').length;
      rangedOn += later(a).filter(s => fightsFromRange(s.kind, level)).length; rangedOff += later(b).filter(s => fightsFromRange(s.kind, level)).length;
      melee += later(a).filter(s => !fightsFromRange(s.kind, level) && s.kind !== 'warden').length; meleeOff += later(b).filter(s => !fightsFromRange(s.kind, level) && s.kind !== 'warden').length;
    }
    // Measured 2026-10-05 over 300 floors a level (later-wave bodies, rule on against off): floor 1 2667 against 2602, floor 2 7203 against 6979, floor 3 9538 against 9009; wardens 195 / 502 / 1434 against 198 / 512 / 1478; ranged 1127 / 2790 / 3929 against 0 / 1292 / 1522.
    assert.ok(on >= off && on <= off * 1.1, `floor ${level}: ${on} later-wave bodies with the rule against ${off} without: it should add a few (bounds 1.0 to 1.1 times)`);
    assert.ok(wardensOn >= wardensOff * 0.95, `floor ${level}: ${wardensOn} wardens with the rule against ${wardensOff} without: it took too many`);
    assert.ok(rangedOn > rangedOff + 100, `floor ${level}: ${rangedOn} ranged bodies with the rule against ${rangedOff} without: the rule dealt too few`);
    assert.ok(melee < meleeOff, `floor ${level}: ${melee} melee bodies with the rule against ${meleeOff} without: the ranged ones should have come out of them`);
  }
});

test('withRanged: a wave that holds one is whole, a wave that holds none gets one, the warden stays, and the stream moves the same either way', () => {
  const draws = (kinds: string[], level: number, pinned: boolean, rolls = [0.3, 0.6]) => {
    let asked = 0;
    const out = withRanged(kinds as never, level, () => rolls[asked++ % rolls.length], pinned);
    return { out, asked };
  };
  assert.deepEqual(draws(['guard', 'archer', 'stalker'], 1, false), { out: ['guard', 'archer', 'stalker'], asked: 2 }, 'a wave with an archer is untouched, and still draws twice');
  assert.deepEqual(draws(['guard', 'pyre'], 2, false), { out: ['guard', 'pyre'], asked: 2 }, 'a pyre is ranged on floor two');
  assert.equal(draws(['guard', 'pyre'], 1, false).out.filter(k => k === 'pyre').length, 0, 'precondition: a pyre does not count on floor one, so the wave is changed');
  assert.ok(draws(['guard', 'pyre'], 1, false).out.includes('archer'), 'a pyre is not ranged on floor one: the wave needs its archer');
  const bare = draws(['guard', 'guard', 'stalker'], 1, false);
  assert.equal(bare.asked, 2);
  assert.equal(bare.out.filter(k => k === 'archer').length, 1, 'a bare wave gets exactly one archer on floor one');
  assert.equal(bare.out.filter(k => k !== 'archer').length, 2, 'and loses exactly one body for it');
  for (const roll of [0, 0.3, 0.6, 0.99]) assert.notEqual(draws(['warden', 'guard', 'stalker'], 2, true, [roll, roll]).out[0], 'archer', 'the pinned warden at the head of the wave was replaced');
  assert.equal(draws(['warden', 'guard', 'stalker'], 2, true, [0, 0]).out[0], 'warden');
  assert.deepEqual(draws(['warden'], 2, true), { out: ['warden'], asked: 2 }, 'a wave with room for nothing but its warden keeps it: the rule never takes the pinned warden (the chamber cap that would leave a wave that bare is not reached in 3,000 floors, above)');
  assert.deepEqual(draws([], 2, false), { out: [], asked: 2 });
  assert.deepEqual([...rangedKinds(1)], ['archer']);
  assert.deepEqual([...rangedKinds(3)], ['archer', 'pyre']);
  assert.equal(isRanged('archer', 1), true);
  assert.equal(isRanged('pyre', 1), false);
  assert.equal(isRanged('guard', 3), false);
});
