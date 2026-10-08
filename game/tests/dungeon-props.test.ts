import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { blastOf, CHEST_PEARLS, fuseStep, KEG_CHAIN, KEG_FUSE, KEG_RADIUS, liveProps, PLATE_REACH, SIP, SPIKE_CYCLE, SPIKE_TELL, SPIKE_UP, spikeBites, spikeState, strikeProp, swingProps } from '../app/dungeon-hits.ts';
import { flyHostile, hostileBolt } from '../app/dungeon-projectile.ts';
import type { Furnishing, PropKind } from '../app/dungeon-furnish.ts';
import { chamberReward, createRun, PURSE_PEARLS, takeDrop } from '../app/dungeon-sim.ts';
import { pearlsFor } from '../app/dungeon-meta.ts';
import { TIDEBLADE } from '../app/dungeon-weapon.ts';

// Plan 025 Stage F (D12 a, c): what a prop does, and what the new doors pay. Pure rules, asked by the game and the balance sim alike.

/** An open floor of tiles round the origin, so nothing but the rule under test decides. */
const open = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
/** Props at world positions (a prop's own tile is `at / TILE`; the rules read `at`). */
const props = (...list: { kind: PropKind; x: number; z: number; phase?: number }[]) => liveProps(list.map((p, id): Furnishing => ({ id, kind: p.kind, x: 0, z: 0, room: 1, drop: null, phase: p.phase ?? 0 })), TILE).map((p, i) => ({ ...p, at: { x: list[i].x, z: list[i].z } }));

test('a keg goes up when its fuse burns out, and its blast hurts the knight and every body inside it, and lights or breaks the props it reaches', () => {
  const [keg, urn, other] = props({ kind: 'keg', x: 0, z: 0 }, { kind: 'urn', x: 1.5, z: 0 }, { kind: 'keg', x: -1.8, z: 0 });
  assert.deepEqual(strikeProp(keg), { broke: false, lit: true });
  assert.deepEqual(strikeProp(keg), { broke: false, lit: false }, 'a lit keg lit again');
  // The fuse is the telegraph: nothing for KEG_FUSE seconds, then it goes up once.
  let t = 0, went = 0, at = -1;
  while (t < 3) { t += 1 / 120; if (fuseStep(keg, 1 / 120)) { went++; at = t; } }
  assert.equal(went, 1, 'the keg went up more than once, or never');
  assert.ok(Math.abs(at - KEG_FUSE) < 1 / 60, `the keg went up after ${at.toFixed(3)} s, not its ${KEG_FUSE} s fuse`);
  const knight = { x: 1.2, z: 0 }, bodies = [{ x: 0, z: 2.0 }, { x: 3, z: 0 }, { x: -2.3, z: 0.1 }];
  const caught = blastOf(keg, knight, bodies, [keg, urn, other]);
  assert.equal(caught.knight, true, 'the blast spared the knight standing 1.2 from it');
  assert.deepEqual(caught.bodies, [0, 2], 'the blast did not catch exactly the bodies inside its radius');
  assert.deepEqual(caught.props, [1, 2], 'the blast did not reach the urn and the other keg beside it');
  assert.equal(blastOf(keg, { x: KEG_RADIUS + .01, z: 0 }, [], []).knight, false, 'the blast reached past its radius');
  // A keg caught in a blast lights on the short fuse.
  assert.deepEqual(strikeProp(other, KEG_CHAIN), { broke: false, lit: true });
  assert.equal(other.fuse, KEG_CHAIN);
});

test('a spike plate telegraphs for SPIKE_TELL before every rise, and bites what stands on it once a rise', () => {
  const [plate] = props({ kind: 'spikes', x: 0, z: 0, phase: 0.37 });
  const dt = 1 / 1000, runs: { state: string; length: number }[] = [];
  for (let t = 0; t < SPIKE_CYCLE * 3; t += dt) {
    const state = spikeState(t, plate.phase);
    if (runs.length && runs[runs.length - 1].state === state) runs[runs.length - 1].length += dt; else runs.push({ state, length: dt });
  }
  const rises = runs.map((run, i) => ({ run, before: runs[i - 1] })).filter(({ run, before }) => run.state === 'up' && before);
  assert.ok(rises.length >= 2, `precondition: ${rises.length} whole rises in three cycles`);
  for (const { run, before } of rises) {
    assert.equal(before.state, 'tell', 'the spikes rose from down, with no telegraph');
    assert.ok(Math.abs(before.length - SPIKE_TELL) < 2 * dt, `the spikes rose with ${before.length.toFixed(3)} s of telegraph, not ${SPIKE_TELL}`);
    assert.ok(Math.abs(run.length - SPIKE_UP) < 2 * dt || run === runs[runs.length - 1], `the spikes stood up ${run.length.toFixed(3)} s`);
  }
  assert.ok(SPIKE_TELL >= 0.5, `a ${SPIKE_TELL} s telegraph is shorter than a guard's tell`);
  // Bites: on the plate while it is up, once a rise for each victim; never off it, never while it is down or telling.
  const firstUp = (() => { for (let t = 0; t < SPIKE_CYCLE; t += dt) if (spikeState(t, plate.phase) === 'up') return t + dt; return -1; })();
  assert.ok(firstUp > 0);
  assert.equal(spikeBites(plate, firstUp - SPIKE_TELL / 2 - dt, -1, 0, 0), false, 'the plate bit during its telegraph');
  assert.equal(spikeBites(plate, firstUp, -1, 0, 0), true, 'the plate did not bite the knight standing on it');
  assert.equal(spikeBites(plate, firstUp + .05, -1, 0, 0), false, 'the plate bit the knight twice in one rise');
  assert.equal(spikeBites(plate, firstUp + .05, 3, PLATE_REACH - .05, 0), true, 'the plate did not bite a body standing on its edge');
  assert.equal(spikeBites(plate, firstUp + .05, 4, PLATE_REACH + .05, 0), false, 'the plate bit a body off it');
  assert.equal(spikeBites(plate, firstUp + SPIKE_CYCLE, -1, 0, 0), true, 'the next rise did not bite again');
});

test('a swing breaks the urn in its arc and pays what it held, lights the keg it reaches, and leaves an urn behind the knight standing', () => {
  const cells = open();
  const list = props({ kind: 'urn', x: 0, z: 1.0 }, { kind: 'urn', x: 0, z: -1.0 }, { kind: 'keg', x: .5, z: .9 }, { kind: 'cover', x: -.4, z: .9 }, { kind: 'urn', x: 0, z: TIDEBLADE.reach + .3 });
  const facing = { x: 0, z: 1 }, from = { x: 0, z: 0 };
  const struck = swingProps(cells, from, facing, 0, TIDEBLADE, list);
  assert.ok(struck.includes(0), 'the urn in front of the knight was not reached');
  assert.ok(!struck.includes(1), 'an urn behind the knight broke');
  assert.ok(struck.includes(2), 'the keg in the arc was not reached');
  assert.ok(!struck.includes(3), 'cover was struck as if it broke');
  assert.ok(!struck.includes(4), 'an urn past the blade\'s reach broke');
  for (const index of struck) strikeProp(list[index]);
  assert.equal(list[0].broken, true);
  assert.ok(list[2].fuse > 0 && !list[2].broken, 'the keg broke instead of lighting');
  assert.deepEqual(swingProps(cells, from, facing, 0, TIDEBLADE, list), [], 'a second swing found the broken urn or the lit keg again');
  // A wall between the knight and the urn stops the blade, as it stops it for a body.
  const walled = open(); walled.delete(cellKey(0, 1));
  assert.deepEqual(swingProps(walled, from, facing, 0, TIDEBLADE, props({ kind: 'urn', x: 0, z: TILE * 1.2 })), [], 'the blade broke an urn through stone');
  // What a broken prop pays.
  const run = createRun(); run.hp = 50;
  assert.deepEqual(takeDrop(run, 'urn', 'sip'), { xp: 0, ranks: 0, healed: SIP, pearls: 0 });
  assert.deepEqual(takeDrop(run, 'crate', 'pearl'), { xp: 0, ranks: 0, healed: 0, pearls: 1 });
  assert.deepEqual(takeDrop(run, 'chest', 'pearl'), { xp: 0, ranks: 0, healed: 0, pearls: CHEST_PEARLS });
  assert.deepEqual(takeDrop(run, 'urn', null), { xp: 0, ranks: 0, healed: 0, pearls: 0 });
  assert.equal(run.found, 1 + CHEST_PEARLS);
  assert.equal(run.hp, 50 + SIP);
});

test('cover stops a bolt: it takes its tile out of the walkable floor, which is all a bolt flies over', () => {
  const cells = open(), knight = { x: 0, z: 4 * TILE };
  const bolt = () => hostileBolt({ x: 0, z: 0 }, { x: 0, z: 1 }, { speed: 9, flight: 1.5 }, 10);
  const fly = (floor: Set<string>) => { const shot = bolt(); for (let i = 0; i < 400; i++) { const f = flyHostile(shot, floor, knight, false, 1 / 60); shot.x = f.x; shot.z = f.z; shot.life = f.life; shot.pierce = f.pierce; if (f.hit) return 'hit'; if (f.done) return 'stopped'; } return 'flying'; };
  assert.equal(fly(cells), 'hit', 'precondition: on open floor the bolt reaches the knight');
  const covered = open(); covered.delete(cellKey(0, 2));
  assert.equal(fly(covered), 'stopped', 'a bolt flew through a cover block');
});

test('the new doors pay: a Boon door one boon card, a Pearls door a purse banked at the run\'s end, an arm door nothing of its own', () => {
  const boon = createRun(), xp = boon.totalXp;
  const paid = chamberReward(boon, 'boon');
  assert.equal(paid.ranks, 1); assert.equal(boon.pendingRanks, 1, 'a Boon door did not owe a card'); assert.equal(boon.totalXp, xp, 'a Boon door paid experience');
  const purse = createRun();
  assert.equal(chamberReward(purse, 'pearls').pearls, PURSE_PEARLS); assert.equal(purse.found, PURSE_PEARLS);
  assert.equal(pearlsFor({ floor: 2, won: false, kills: 3, chambers: 4, found: purse.found }) - pearlsFor({ floor: 2, won: false, kills: 3, chambers: 4 }), PURSE_PEARLS, 'the found pearls were not banked');
  const arm = createRun(); arm.hp = 40;
  assert.deepEqual(chamberReward(arm, 'arm'), { xp: 0, ranks: 0, healed: 0 });
  assert.equal(arm.pendingRanks + arm.found + arm.totalXp, 0);
});
