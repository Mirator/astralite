import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { generateFloor, PACK_MIX, TILE, ARRIVAL_CLEAR, type Spawn } from '../app/dungeon-floor.ts';
import { BESTIARY, reserveSize } from '../app/dungeon-bestiary.ts';
import { CHAMBER_CAP, dealWaves, fitWave, FIRST_WAVE_LAYERS, idleClock, springing, calledIn, roomTiles, spotOf, waveDue, waveSpots, WAVE_CAP, WAVE_CLEAR, WAVE_MARK, WAVE_PAUSE, WAVE_TABLE, wavedFloor, type WaveBody, type WaveClock, type WaveTable } from '../app/dungeon-waves.ts';

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
  const hash = createHash('sha256');
  let floors = 0;
  for (let i = 1; i <= 300; i++) for (const level of LEVELS) {
    const f = generateFloor(i * 7919 + 13, level);
    hash.update(JSON.stringify([f.rooms, f.doors, f.props, f.spawns, f.weaponDrop, f.guardCount, f.goal, f.tiles.length])); floors++;
  }
  assert.equal(floors, 900);
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
      assert.ok(room.layer > FIRST_WAVE_LAYERS, `${where}: layer ${room.layer} is one of the first two fights`);
      assert.ok(spawn.ambush, `${where}: a wave body is not dormant`);
      assert.ok(roomTiles(floor, room.id).some(t => t.x === spawn.x && t.z === spawn.z), `${where}: a wave body stands off its chamber's own floor`);
      assert.ok(Math.hypot(spawn.x - room.entry.x, spawn.z - room.entry.z) >= ARRIVAL_CLEAR, `${where}: a wave body stands on the arrival`);
      assert.ok(floor.doors.filter(d => d.from === room.id).every(d => Math.hypot(d.x - spawn.x, d.z - spawn.z) >= 2.5), `${where}: a wave body stands in a doorway`);
      // 2.2 tiles apart, as the generator keeps a pack; only a pinned warden, in a chamber with no such tile left, stands closer (1.2).
      for (const other of extra) if (other !== spawn && other.room === spawn.room) assert.ok(Math.hypot(other.x - spawn.x, other.z - spawn.z) >= (spawn.kind === 'warden' || other.kind === 'warden' ? 1.2 : 2.2), `${where}: two wave bodies stand ${Math.hypot(other.x - spawn.x, other.z - spawn.z).toFixed(2)} tiles apart`);
      checked++;
    }
  }
  assert.ok(checked > 300, `precondition: only ${checked} wave bodies were checked`);
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
  // One body falls at 1 s and the other at 3 s; the rule must say nothing until 3 s, ring at 3.5 s and raise at 4.4 s.
  const { marks, raises } = runRule(bodies, 60 * 8, second_ => { if (second_ >= 1) first[0].dead = true; if (second_ >= 3) first[1].dead = true; });
  assert.equal(marks.length, 1, 'the rings were called more than once, or never');
  assert.equal(raises.length, 1, 'the wave was raised more than once, or never');
  assert.ok(marks[0] >= 3 + WAVE_PAUSE - 2 * FRAME, `the rings came at ${marks[0].toFixed(2)} s, before the last body fell at 3 s plus the pause`);
  assert.ok(marks[0] <= 3 + WAVE_PAUSE + 2 * FRAME, `the rings came at ${marks[0].toFixed(2)} s, late`);
  assert.ok(raises[0] - marks[0] >= WAVE_MARK - 2 * FRAME && raises[0] - marks[0] <= WAVE_MARK + 2 * FRAME, `the wave stood ${(raises[0] - marks[0]).toFixed(2)} s after its rings, not ${WAVE_MARK}`);
  assert.ok(second.every(b => b.awake), 'the second wave did not stand up');
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
      if (seen.length === 2) { late++; assert.ok(dealt.some(s => s.room === room && s.wave === 3 && s.kind === 'warden'), `seed ${seed} floor ${level} room ${room}: a third wave without its warden`); }
      else if (floor.rooms[room].reward === 'cache') purse++; else middle++;
    }
    for (const spawn of dealt) assert.ok(floor.rooms[spawn.room].encounter === 'watch' && floor.rooms[spawn.room].layer > 2, `seed ${seed}: a wave in an ambush, a gauntlet, a shrine, the stair hall or one of the first two fights`);
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
