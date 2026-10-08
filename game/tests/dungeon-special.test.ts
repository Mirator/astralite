import assert from 'node:assert/strict';
import test from 'node:test';
import { canAbortSwing, dragToward, hurledBlow, lineContacts, playerSpeed, specialAvailable, specialGate, specialSpends, swordContacts, vaultLanding, vaultTarget } from '../app/dungeon-combat.ts';
import { chargePose, playerAttackPose, playerSpecialPose } from '../app/dungeon-attack-pose.ts';
import { canStand, cellKey, TILE } from '../app/dungeon-floor.ts';
import { flashpointHits, flyShot, homeStep, laneLength, type Pool, type Shot } from '../app/dungeon-projectile.ts';
import { createRun, resetSpecial, specialReady, spendSpecial, tickRun } from '../app/dungeon-sim.ts';
import { BELL_MAUL, beatOf, chargeLevel, chargeReleases, drawDamage, drawn, KEEP_CROSSBOW, lungeStep, RING_ARC, SALT_SPEAR, specialSwing, TIDEBLADE, TIDEFLASK, TWIN_FANGS, vaultHeight, vaultLanded, vaultStep, WARDENS_CLEAVER, WEAPONS, type Weapon } from '../app/dungeon-weapon.ts';
import { DEFAULT_POLICY, simulateRun } from '../scripts/balance/sim.ts';

// Plan 016 Stage B: the special, as rules. Everything a special follows - its timing, its cooldown, what
// it touches and what it costs - lives in the pure modules, so these run against the same functions the
// keep and the balance batch call.

const openFloor = (half = 10) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
const cells = openFloor();
const north = { x: 0, z: -1 };
const undertow = TIDEBLADE.special!, harpoon = SALT_SPEAR.special!, toll = BELL_MAUL.special!;
const vault = TWIN_FANGS.special!, whirl = WARDENS_CLEAVER.special!, heavyBolt = KEEP_CROSSBOW.special!, flashpoint = TIDEFLASK.special!;

test('every arm carries a special of its own (plan 016 Stage C)', () => {
  assert.deepEqual(Object.values(WEAPONS).map(w => w.special?.id ?? 'none').sort(), ['flashpoint', 'harpoon', 'heavybolt', 'toll', 'undertow', 'vault', 'whirl']);
  assert.equal(new Set(Object.values(WEAPONS).map(w => w.special?.kind)).size, 7, 'seven shapes, one each');
  for (const weapon of Object.values(WEAPONS)) {
    if (!weapon.special) { assert.equal(specialSwing(weapon), weapon, `${weapon.id} has nothing to overlay`); continue; }
    const swing = specialSwing(weapon);
    assert.ok(swing.anticipation > 0 && swing.anticipation < swing.contactEnd && swing.contactEnd < swing.duration, `${weapon.id}'s special is a coherent swing`);
    // The draw has no cooldown to chain through: the quiver it empties is what stops a second one.
    if (!weapon.special.draw) assert.ok(weapon.special.cooldown > swing.duration, `${weapon.id}'s special cannot be chained into itself`);
    assert.equal(swing.chain, undefined, 'a special is never a beat of a string');
  }
});

test('the Undertow Lunge: 0.12s wind, 3.2 units over 0.18s, 1.5x the blade, staggering, no immunity', () => {
  const swing = specialSwing(TIDEBLADE);
  assert.equal(swing.anticipation, 0.12);
  assert.equal(swing.contactEnd, 0.12 + 0.18);
  assert.ok(Math.abs(swing.duration - swing.contactEnd - 0.25) < 1e-9);
  assert.equal(swing.damage, TIDEBLADE.damage * 1.5);
  assert.equal(swing.stagger, true);
  assert.equal(undertow.cooldown, 4);
  // The travel window is the live window, and summed over any frames that span it the lunge covers its
  // distance exactly, whatever the frame rate.
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    let travelled = 0;
    for (let age = dt; age < swing.duration + dt; age += dt) travelled += lungeStep(undertow, swing.anticipation, age, dt);
    assert.ok(Math.abs(travelled - 3.2) < 1e-9, `${dt}: ${travelled}`);
  }
  assert.equal(lungeStep(undertow, swing.anticipation, 0.1, 0.05), 0, 'nothing moves during the wind');
  assert.equal(lungeStep(undertow, swing.anticipation, 0.45, 0.05), 0, 'nor during the recovery');
  // It is a swing, not a second dodge: the knight moves at the special's own speed outside the travel.
  assert.equal(playerSpeed({ dashing: false, attacking: true, weapon: swing }), swing.moveSpeed);
});

test('a lunge cuts what lies on its line, once each, and never through a wall', () => {
  const from = { x: 0, z: 0 }, to = { x: 0, z: -3.2 };
  assert.equal(lineContacts(cells, from, to, { x: 0.5, z: -1.5 }, 0.9), true, 'beside the line, inside the width');
  assert.equal(lineContacts(cells, from, to, { x: 1.2, z: -1.5 }, 0.9), false, 'outside the width');
  assert.equal(lineContacts(cells, from, to, { x: 0, z: -4.5 }, 0.9), false, 'past the end of the line');
  assert.equal(lineContacts(cells, from, to, { x: 0, z: 1.2 }, 0.9), false, 'behind where it started');
  const walled = new Set(cells); walled.delete(cellKey(0, -2)); walled.delete(cellKey(1, -2));
  assert.equal(lineContacts(walled, from, { x: 0, z: -1 }, { x: 0.4, z: -2.6 }, 1.8), false, 'stone stops it');
  // Flat where it started: a body half a width behind the start was never on the path.
  assert.equal(lineContacts(cells, from, to, { x: 0, z: 0.5 }, 0.9), false, 'behind the start, inside the width');
  assert.equal(lineContacts(cells, from, to, { x: 0.5, z: 0.4 }, 0.9), false, 'behind the start and to one side');
});

test('a lunge at a body with its back to a wall still cuts it: the wall check is from the knight', () => {
  // Stone from z = -2.5 tiles north; the face is at -2.5 * TILE. The line's end reaches the width past the
  // knight, and here that point is inside the stone.
  const walled = new Set([...cells].filter(key => Number(key.split(',')[1]) > -3)), face = -2.5 * TILE, width = undertow.lunge!.width;
  const at = (fromWall: number, ahead: number) => {
    const knight = { x: 0, z: face + fromWall }, body = { x: 0, z: knight.z - ahead }, to = { x: 0, z: knight.z - width }, start = { x: 0, z: knight.z + 2 };
    assert.equal(canStand(walled, body.x, body.z), true, 'the body stands on the floor');
    return { hit: lineContacts(walled, start, to, body, width, knight), old: lineContacts(walled, start, to, body, width), end: canStand(walled, to.x, to.z) };
  };
  // 1.10 from the face with the body 0.70 ahead (0.40 off the stone) is the case that used to miss.
  assert.deepEqual(at(1.1, 0.7), { hit: true, old: false, end: false });
  // The reviewer's 1.30 / 0.90: the line's end is 0.40 off the stone there, on the floor, so it always hit.
  assert.deepEqual(at(1.3, 0.9), { hit: true, old: true, end: true });
  // And a wall between the knight and the body still stops it.
  const pillar = new Set(cells); pillar.delete(cellKey(0, -1));
  assert.equal(lineContacts(pillar, { x: 0, z: 1 }, { x: 0, z: -0.3 }, { x: 0, z: -2.2 }, 2, { x: 0, z: 0.6 }), false);
});

test('the Harpoon: thrown 9 units at 18, pierces one, 2x the spear, drags the first body in, 5s', () => {
  const swing = specialSwing(SALT_SPEAR);
  assert.equal(swing.ranged?.speed, 18);
  assert.equal(swing.ranged?.flight, 0.5);
  assert.equal(swing.ranged?.pierce, 1);
  assert.equal(swing.damage, SALT_SPEAR.damage * 2);
  assert.equal(harpoon.cooldown, 5);
  assert.equal(harpoon.hurl?.bare, 0.5);
  // One flight takes two bodies on the line and stops.
  const shot: Shot = { x: 0, z: 0, dx: 0, dz: -1, speed: 18, life: 0.5, pierce: 1, damage: swing.damage, spent: new Set() };
  const marks = [{ x: 0, z: -3, index: 0 }, { x: 0, z: -5, index: 1 }, { x: 0, z: -7, index: 2 }];
  const struck: number[] = [];
  for (let i = 0; i < 60; i++) { const flight = flyShot(shot, cells, marks, 1 / 60); Object.assign(shot, { x: flight.x, z: flight.z, life: flight.life, pierce: flight.pierce }); struck.push(...flight.hits); if (flight.done) break; }
  assert.deepEqual(struck, [0, 1]);
  // Dragged two units in, never onto the knight, never past him.
  assert.deepEqual(dragToward({ x: 0, z: -5 }, { x: 0, z: 0 }, 2), { x: 0, z: 2 });
  assert.deepEqual(dragToward({ x: 0, z: -2 }, { x: 0, z: 0 }, 2), { x: 0, z: 1 });
  assert.deepEqual(dragToward({ x: 0, z: -0.5 }, { x: 0, z: 0 }, 2), { x: 0, z: 0 });
  // It comes home to wherever the knight has got to, and says so the step it arrives.
  let at = { x: 0, z: -8 }, steps = 0, home = false;
  while (!home && steps < 200) { const step = homeStep(at, { x: 1, z: 0 }, 18, 1 / 60); at = step; home = step.home; steps++; }
  assert.equal(home, true);
  assert.ok(steps <= Math.ceil(Math.hypot(1, 8) / (18 / 60)) + 1);
  assert.deepEqual({ x: at.x, z: at.z }, { x: 1, z: 0 });
});

test('the Tolling Slam: 0.5s to arm, 1s to full, a ring from 2.4 to 3.2 and 1.5x to 2.5x the maul', () => {
  assert.equal(chargeReleases(toll, 0.49), false, 'let go early, it cancels');
  assert.equal(chargeReleases(toll, 0.5), true);
  assert.equal(chargeLevel(toll, 0.3), 0);
  assert.equal(chargeLevel(toll, 0.75), 0.5);
  assert.equal(chargeLevel(toll, 1), 1);
  assert.equal(chargeLevel(toll, 4), 1, 'held past full, it stays full');
  const light = specialSwing(BELL_MAUL, 0), heavy = specialSwing(BELL_MAUL, 1);
  assert.equal(light.reach, 2.4); assert.equal(heavy.reach, 3.2);
  assert.equal(light.damage, Math.round(BELL_MAUL.damage * 1.5)); assert.equal(heavy.damage, Math.round(BELL_MAUL.damage * 2.5));
  assert.equal(heavy.arc, RING_ARC);
  assert.equal(toll.cooldown, 6);
  assert.equal(BELL_MAUL.moveSpeed * (toll.moveScale ?? 1), BELL_MAUL.moveSpeed * 0.5);
  // A ring: behind the knight, beside him and standing on him are all inside it; past the radius is not.
  const from = { x: 0, z: 0 };
  for (const body of [{ x: 0, z: 2 }, { x: -2, z: 0 }, { x: 1.5, z: -1.5 }, { x: 0, z: 0 }]) assert.equal(swordContacts(cells, from, north, body, 0, heavy), true, JSON.stringify(body));
  assert.equal(swordContacts(cells, from, north, { x: 0, z: 2.6 }, 0, light), false);
  assert.equal(swordContacts(cells, from, north, { x: 0, z: 2.6 }, 0, heavy), true);
});

test('a special keeps the strike commitment: a dodge only cancels it before contact or after', () => {
  for (const weapon of Object.values(WEAPONS)) {
    const swing = specialSwing(weapon), at = (age: number) => swing.duration - age;
    assert.equal(canAbortSwing(at(swing.anticipation * 0.5), swing), true, `${weapon.id}: the wind gives way`);
    assert.equal(canAbortSwing(at((swing.anticipation + swing.contactEnd) / 2), swing), false, `${weapon.id}: contact does not`);
    assert.equal(canAbortSwing(at(swing.contactEnd + 0.01), swing), true, `${weapon.id}: the recovery does`);
    // The pose goes live on exactly the window combat scores against.
    const kind = weapon.special!.kind;
    assert.equal(playerSpecialPose(swing.anticipation - 0.005, swing, kind).active, false);
    assert.equal(playerSpecialPose(swing.anticipation + 0.005, swing, kind).active, true);
    assert.equal(playerSpecialPose(swing.contactEnd + 0.005, swing, kind).active, false);
    assert.equal(playerSpecialPose(swing.duration + 0.01, swing, kind).active, false);
  }
  assert.equal(playerSpecialPose(0.2, specialSwing(SALT_SPEAR), 'throw').trail, false, 'a thrown arm draws no ribbon');
  assert.deepEqual(chargePose(Number.NaN), chargePose(0));
});

test('a special cannot start over a live strike, over itself, or while it cools down', () => {
  const base = { weapon: TIDEBLADE, ready: true, attackTime: 0, swing: TIDEBLADE, dashTime: 0, specialLive: false, busy: false };
  assert.equal(specialGate(base), 'start');
  // A strike in contact: it waits, the way a dodge does, rather than cutting the blow short.
  const strike = beatOf(TIDEBLADE, 0), live = strike.duration - (strike.anticipation + strike.contactEnd) / 2;
  assert.equal(specialGate({ ...base, attackTime: live, swing: strike }), 'wait');
  // In the strike's wind-up or recovery it cancels the strike and goes.
  assert.equal(specialGate({ ...base, attackTime: strike.duration - 0.01, swing: strike }), 'start');
  assert.equal(specialGate({ ...base, attackTime: 0.05, swing: strike }), 'start');
  assert.equal(specialGate({ ...base, dashTime: 0.1 }), 'wait', 'a dodge in progress finishes first');
  assert.equal(specialGate({ ...base, specialLive: true, attackTime: 0.3, swing: specialSwing(TIDEBLADE) }), 'refuse', 'never over itself');
  assert.equal(specialGate({ ...base, ready: false }), 'refuse');
  assert.equal(specialGate({ ...base, busy: true }), 'refuse', 'not while charging or while the spear is out');
  const plain: Weapon = { ...WEAPONS.cleaver, special: undefined };
  assert.equal(specialGate({ ...base, weapon: plain, swing: plain }), 'refuse', 'an arm with no special');
});

test('a held special waits out a whole strike: a tap on it is never a free cancel of a Maul or Crossbow swing', () => {
  for (const weapon of [BELL_MAUL, KEEP_CROSSBOW]) {
    const strike = beatOf(weapon, 0), base = { weapon, ready: true, attackTime: 0, swing: strike, dashTime: 0, specialLive: false, busy: false };
    assert.equal(specialGate(base), 'start', `${weapon.id}: idle, it goes`);
    assert.equal(specialGate({ ...base, attackTime: strike.duration - 0.01 }), 'wait', `${weapon.id}: in the wind-up it waits`);
    assert.equal(specialGate({ ...base, attackTime: strike.duration - (strike.anticipation + strike.contactEnd) / 2 }), 'wait', `${weapon.id}: in contact it waits`);
    assert.equal(specialGate({ ...base, attackTime: 0.02 }), 'wait', `${weapon.id}: in the recovery it waits`);
    assert.equal(canAbortSwing(0.02, strike), true, 'where a dodge or a pressed special would cut it');
  }
});

test('a Flashpoint whose fire went out before contact spends nothing; every other special spends', () => {
  assert.equal(specialSpends(flashpoint, { pools: 0 }), false);
  assert.equal(specialSpends(flashpoint, { pools: 2 }), true);
  for (const special of [undertow, harpoon, toll, vault, whirl, heavyBolt]) assert.equal(specialSpends(special, { pools: 0 }), true, special.id);
});

test('a special shot lands the blow of the special that loosed it, and only the harpoon itself drags', () => {
  const bolt = hurledBlow(heavyBolt, { harpoon: false, damage: 36 }, { free: true, steadfast: false });
  assert.deepEqual(bolt, { drags: false, blow: { damage: 36, stagger: true, knockback: heavyBolt.swing.knockback, wardenKnockback: heavyBolt.swing.wardenKnockback, bolt: true } });
  // A heavy bolt still in the air once the spear is thrown takes nothing of the spear's: not its drag.
  assert.equal(hurledBlow(heavyBolt, { harpoon: false, damage: 36 }, { free: true, steadfast: false }).drags, false);
  const spear = hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: true, steadfast: false });
  assert.deepEqual(spear, { drags: true, blow: { damage: 6, stagger: true, knockback: 0, wardenKnockback: 0, bolt: false } });
  assert.equal(hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: false, steadfast: false }).drags, false, 'one drag a throw');
  assert.equal(hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: true, steadfast: true }).drags, false, 'a warden only staggers');
});

test('the cooldown starts at contact, runs on the run clock, and a swap hands over the clock of the arm taken up', () => {
  const run = createRun();
  assert.equal(run.specialCooldown, 0);
  assert.equal(specialReady(run), true);
  // Pressing it and dodging out of the wind-up spends nothing: the game only calls this on the first live frame.
  tickRun(run, 1);
  assert.equal(specialReady(run), true);
  spendSpecial(run, undertow.cooldown);
  assert.equal(specialReady(run), false);
  tickRun(run, 3.9);
  assert.equal(specialReady(run), false);
  tickRun(run, 0.1);
  assert.equal(specialReady(run), true);
  spendSpecial(run, harpoon.cooldown);
  resetSpecial(run);
  assert.equal(specialReady(run), true, 'a new arm arrives ready');
  // An arm taken back off the rack brings back what it had left: swap, swap back is no way round it.
  resetSpecial(run, 2.5);
  assert.equal(run.specialCooldown, 2.5);
  resetSpecial(run, Number.NaN);
  assert.equal(run.specialCooldown, 0, 'nonsense kept is a fresh arm');
  // Nonsense time never runs it backwards.
  spendSpecial(run, toll.cooldown); tickRun(run, Number.NaN); tickRun(run, -5);
  assert.equal(run.specialCooldown, toll.cooldown);
});

test('the balance batch only fires specials under the special policy, and then does', () => {
  // Existing policies are the proof that Stage B moved nothing else: they never touch the special.
  // Seed 4 (plan 024 Stage E: a King that hits 1.4 times as hard beats the Tideblade knight on seed 2; plan 025 Stage D: with Stage A's body radius and the Mother moving, seed 3's knight dies).
  const plain = simulateRun(0x4, { ...DEFAULT_POLICY, weapon: TIDEBLADE });
  const armed = simulateRun(0x4, { ...DEFAULT_POLICY, weapon: TIDEBLADE, special: true });
  assert.equal(plain.outcome, 'escaped');
  assert.equal(armed.outcome, 'escaped');
  assert.notDeepEqual(plain.floors.map(f => f.seconds), armed.floors.map(f => f.seconds), 'the lunge changed how the fights went');
  // Same seed, same keep: specials change combat, never generation.
  assert.deepEqual(plain.floors.map(f => f.spawns), armed.floors.map(f => f.spawns));
});

test('a strike with the spear out is bare-handed, and a plain strike is untouched by all of this', () => {
  assert.deepEqual(playerAttackPose(0.1, TIDEBLADE), playerAttackPose(0.1, { ...TIDEBLADE, special: undefined }));
  assert.equal(SALT_SPEAR.damage * (harpoon.hurl?.bare ?? 1), 1.5);
});

// --- Stage C --------------------------------------------------------------------------------------------

test('the Vault: 3s, twice the knives, over the nearest body in the aim and down behind it', () => {
  const swing = specialSwing(TWIN_FANGS), hop = vault.vault!;
  assert.equal(vault.cooldown, 3);
  assert.equal(swing.damage, TWIN_FANGS.damage * 2);
  assert.equal(vault.kind, 'vault');
  // The hop sits inside the live window, and the backstab has live time left after it.
  assert.ok(swing.anticipation + hop.time < swing.contactEnd);
  const from = { x: 0, z: 0 };
  // Nearest in the aim wins; one behind him or off the cone is not a candidate, nor one past the range.
  const bodies = [{ x: 0, z: 2.5 }, { x: 0, z: -2.4 }, { x: 0.3, z: -1.6 }, { x: 2, z: -0.3 }, { x: 0, z: -3.5 }];
  assert.equal(vaultTarget(cells, from, north, bodies, hop.range, hop.cone), 2);
  assert.equal(vaultTarget(cells, from, north, [bodies[0], bodies[3], bodies[4]], hop.range, hop.cone), -1);
  const walled = new Set(cells); walled.delete(cellKey(0, -1));
  assert.equal(vaultTarget(walled, from, north, [{ x: 0, z: -2.4 }], hop.range, hop.cone), -1, 'not through stone');
  // It lands `over` past the body, on the line from the knight through it, and that is where the stab reaches.
  const path = vaultLanding(cells, from, north, { x: 0, z: -2 }, hop.over, hop.hop);
  assert.ok(Math.abs(path.z - -(2 + hop.over)) < 1e-9 && Math.abs(path.x) < 1e-9, JSON.stringify(path));
  assert.ok(Math.abs(path.distance - (2 + hop.over)) < 1e-9);
  // Past the body by less than the knives reach, so a body that steps half a unit after him is still in it.
  assert.ok(hop.over + 0.5 < TWIN_FANGS.reach);
  assert.equal(swordContacts(cells, path, { x: 0, z: 1 }, { x: 0, z: -2 }, 0, swing), true, 'turned round on landing, the body is in reach');
  // No body: a plain hop down the aim.
  const bare = vaultLanding(cells, from, north, null, hop.over, hop.hop);
  assert.ok(Math.abs(bare.distance - hop.hop) < 1e-9 && Math.abs(bare.z + hop.hop) < 1e-9);
});

test('a vault at a wall or a prop stops against it and never lands inside it', () => {
  const hop = vault.vault!, from = { x: 0, z: 0 };
  // A prop is a cell taken out of the floor, exactly as a wall is (dungeon-floor removes both).
  for (const blocked of [cellKey(0, -1), cellKey(0, -2)]) {
    const walled = new Set(cells); walled.delete(blocked);
    for (const target of [null, { x: 0, z: -0.8 }]) {
      const path = vaultLanding(walled, from, north, target, hop.over, hop.hop);
      assert.ok(canStand(walled, path.x, path.z), `${blocked} ${JSON.stringify(target)}: lands on floor`);
      assert.ok(path.distance < hop.hop, 'and short of where it was going');
      for (let along = 0; along <= path.distance; along += 0.05) assert.ok(canStand(walled, from.x + path.dir.x * along, from.z + path.dir.z * along), 'the whole path is walkable');
    }
  }
  // Boxed in, it goes nowhere rather than somewhere wrong.
  const boxed = new Set([cellKey(0, 0)]);
  const stuck = vaultLanding(boxed, from, north, null, hop.over, hop.hop);
  assert.ok(stuck.distance < TILE / 2 && canStand(boxed, stuck.x, stuck.z), JSON.stringify(stuck));
});

test('the vault travels its path exactly, in the air, and only strikes once it is down', () => {
  const swing = specialSwing(TWIN_FANGS), hop = vault.vault!;
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    let travelled = 0;
    for (let age = dt; age < swing.duration + dt; age += dt) travelled += vaultStep(vault, swing.anticipation, 2.7, age, dt);
    assert.ok(Math.abs(travelled - 2.7) < 1e-9, `${dt}: ${travelled}`);
  }
  assert.equal(vaultStep(vault, swing.anticipation, 2.7, swing.anticipation * 0.9, 0.01), 0, 'nothing moves in the crouch');
  assert.equal(vaultLanded(vault, swing.anticipation, swing.anticipation + hop.time * 0.5), false);
  assert.equal(vaultLanded(vault, swing.anticipation, swing.anticipation + hop.time), true);
  assert.ok(vaultHeight(vault, swing.anticipation, swing.anticipation + hop.time / 2) > 0.8, 'up at mid-hop');
  assert.equal(vaultHeight(vault, swing.anticipation, swing.anticipation + hop.time), 0, 'and down on landing');
  // The crouch gives way to a dodge; takeoff is the commitment.
  assert.equal(canAbortSwing(swing.duration - swing.anticipation * 0.5, swing), true);
  assert.equal(canAbortSwing(swing.duration - (swing.anticipation + hop.time / 2), swing), false);
  // The ribbon waits for the landing.
  assert.equal(playerSpecialPose(swing.anticipation + hop.time * 0.4, swing, 'vault').trail, false);
  assert.equal(playerSpecialPose(swing.contactEnd - 0.01, swing, 'vault').trail, true);
});

test('the Whirl: all the way round, slower than a strike, shoving everything it takes, 5s', () => {
  const swing = specialSwing(WARDENS_CLEAVER);
  assert.equal(whirl.cooldown, 5);
  assert.equal(swing.arc, RING_ARC);
  assert.ok(swing.duration > WARDENS_CLEAVER.duration && swing.anticipation > WARDENS_CLEAVER.anticipation, 'slower than a strike');
  assert.ok(swing.knockback >= WARDENS_CLEAVER.knockback && swing.wardenKnockback > WARDENS_CLEAVER.wardenKnockback, 'knockback on all');
  assert.equal(swing.stagger, false, 'still staggers nothing');
  const from = { x: 0, z: 0 };
  for (const body of [{ x: 0, z: -2 }, { x: 0, z: 2 }, { x: -2, z: 0 }, { x: 1.4, z: 1.4 }, { x: 0, z: 0 }]) assert.equal(swordContacts(cells, from, north, body, 0, swing), true, JSON.stringify(body));
  assert.equal(swordContacts(cells, from, north, { x: 0, z: 2.3 }, 0, swing), false, 'past the reach');
  // A whole turn: the recovery ends facing the way it started, a revolution on.
  const end = playerSpecialPose(swing.duration - 1e-4, swing, 'whirl');
  assert.ok(Math.abs(end.bodyYaw - Math.PI * 2) < 0.01, String(end.bodyYaw));
  assert.ok(playerSpecialPose(swing.contactEnd - 0.01, swing, 'whirl').bodyYaw > Math.PI * 1.5, 'most of the turn is inside the live window');
});

test('the Heavy Bolt: the quiver gates it, a full draw fires, a bolt for every bolt spent, through everything', () => {
  const swing = specialSwing(KEEP_CROSSBOW);
  assert.equal(heavyBolt.cooldown, 0);
  assert.equal(heavyBolt.draw, true);
  // Gated by the quiver alone: a dry crossbow cannot draw, and a cooldown means nothing to it.
  assert.equal(specialAvailable(heavyBolt, { cooled: true, quiver: 0, out: false }), false);
  assert.equal(specialAvailable(heavyBolt, { cooled: false, quiver: 1, out: false }), true);
  assert.equal(specialAvailable(whirl, { cooled: false, quiver: 4, out: false }), false, 'every other special waits on its cooldown');
  assert.equal(specialAvailable(harpoon, { cooled: true, quiver: 0, out: true }), false, 'nothing is ready with the arm out of the hand');
  assert.equal(specialAvailable(undefined, { cooled: true, quiver: 4, out: false }), false);
  // Only a full draw fires; let go before it and it cancels.
  assert.equal(drawn(heavyBolt, 0.69), false);
  assert.equal(drawn(heavyBolt, 0.7), true);
  assert.equal(chargeReleases(heavyBolt, 0.69), false);
  assert.equal(drawDamage(KEEP_CROSSBOW, 4), KEEP_CROSSBOW.damage * 4);
  assert.equal(drawDamage(KEEP_CROSSBOW, 1), KEEP_CROSSBOW.damage);
  assert.equal(drawDamage(KEEP_CROSSBOW, 0), 0);
  assert.equal(drawDamage(TIDEBLADE, 4), 0, 'not an arm that draws');
  // One bolt through six bodies in a row, each once, until stone stops it.
  // Stone across the whole floor five tiles north (z -6.66 to -8.14); the last body stands behind it.
  const walled = new Set(cells); for (let x = -10; x <= 10; x++) walled.delete(cellKey(x, -5));
  const shot: Shot = { x: 0, z: 0, dx: 0, dz: -1, speed: swing.ranged!.speed, life: swing.ranged!.flight, pierce: swing.ranged!.pierce, damage: drawDamage(KEEP_CROSSBOW, 4), spent: new Set() };
  const marks = [1, 2, 3, 4, 5, 6, 9].map((d, index) => ({ x: 0, z: -d, index }));
  const struck: number[] = [];
  let flight = flyShot(shot, walled, marks, 1 / 60);
  for (let i = 0; i < 90; i++) { Object.assign(shot, { x: flight.x, z: flight.z, life: flight.life, pierce: flight.pierce }); struck.push(...flight.hits); if (flight.done) break; flight = flyShot(shot, walled, marks, 1 / 60); }
  assert.deepEqual(struck, [0, 1, 2, 3, 4, 5], 'everything on its line up to the wall, and nothing behind it');
  assert.equal(flight.struck, true);
  // The line on the floor stops where the bolt does.
  const lane = laneLength(walled, { x: 0, z: 0 }, 0, -1, swing.ranged!.speed * swing.ranged!.flight);
  assert.ok(lane > TILE * 4.5 - 0.4 && lane < TILE * 4.5, String(lane));
  assert.equal(laneLength(cells, { x: 0, z: 0 }, 0, 1, 5), 5, 'open floor: the full range');
  // Drawn is its own pose, not the maul's.
  assert.notDeepEqual(chargePose(1, 'draw'), chargePose(1));
});

test('the Flashpoint: every pool at once, each body once, and nothing to detonate costs nothing', () => {
  const swing = specialSwing(TIDEFLASK);
  assert.equal(flashpoint.cooldown, 4);
  assert.equal(swing.damage, 12);
  assert.equal(swing.ranged, undefined, 'it throws nothing');
  const base = { weapon: TIDEFLASK, ready: true, attackTime: 0, swing: TIDEFLASK, dashTime: 0, specialLive: false, busy: false };
  assert.equal(specialGate({ ...base, pools: 0 }), 'refuse', 'no pool, no detonation, no cooldown');
  assert.equal(specialGate(base), 'refuse');
  assert.equal(specialGate({ ...base, pools: 2 }), 'start');
  const burn = (x: number, z: number, life = 1): Pool => ({ x, z, radius: TIDEFLASK.burst!.radius, life, damage: 8, interval: 0.5, timer: 0 });
  const marks = [{ x: 0, z: 0, index: 0 }, { x: 1, z: 0, index: 1 }, { x: 5, z: 0, index: 2 }, { x: 9, z: 0, index: 3 }, { x: 20, z: 0, index: 4 }];
  // Two pools overlap the first two bodies: they are caught once each. A spent pool catches nothing.
  assert.deepEqual(flashpointHits([burn(0, 0), burn(1.5, 0), burn(5.5, 0), burn(9, 0, 0)], marks), [0, 1, 2]);
  assert.deepEqual(flashpointHits([], marks), []);
});

test('the balance batch fires every Stage C special under the special policy, and never otherwise', () => {
  // Seed 4 (plan 024 Stage B moved it from 0x2, where the Twin Fangs' armed run fell on floor one and the two runs no longer saw the same floors): all four arms, plain and armed, reach floor three on it.
  for (const weapon of [TWIN_FANGS, WARDENS_CLEAVER, KEEP_CROSSBOW, TIDEFLASK]) {
    const plain = simulateRun(0x4, { ...DEFAULT_POLICY, weapon });
    const armed = simulateRun(0x4, { ...DEFAULT_POLICY, weapon, special: true });
    assert.equal(plain.floors.reduce((sum, f) => sum + f.specials, 0), 0, `${weapon.id}: off means off`);
    assert.ok(armed.floors.reduce((sum, f) => sum + f.specials, 0) > 0, `${weapon.id}: the bot used it`);
    assert.deepEqual(plain.floors.map(f => f.spawns), armed.floors.map(f => f.spawns), 'the same keep');
  }
});
