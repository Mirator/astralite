import assert from 'node:assert/strict';
import test from 'node:test';
import { bossReach, COMMITTED_WINDUP, HIT_COOLDOWN, RECOVERY } from '../app/dungeon-enemy.ts';
import { canStand, cellKey, moveOnFloor, TILE } from '../app/dungeon-floor.ts';
import { awayFrom, blocks, BOSS_BOLT, bossPush, burn, HIT_FLASH, landBlow, type Blow, type Struck } from '../app/dungeon-hits.ts';
import { boltBlow, hurledBlow } from '../app/dungeon-combat.ts';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS, FINAL_BOSS } from '../app/dungeon-bestiary.ts';
import { asReaper, TEST_BOSS } from './fixtures/test-boss.ts';
import { TIDEBLADE, weaponById } from '../app/dungeon-weapon.ts';

// What steel, a bolt and fire each do to the body they land on - the sequence the frame loop used to
// write out inline three times.

/** An open floor of `w` by `h` tiles from the origin. */
const floor = (w: number, h: number) => {
  const cells = new Set<string>();
  for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) cells.add(cellKey(x, z));
  return cells;
};
const body = (kind: Struck['kind'], over: Partial<Struck> = {}): Struck => ({ kind, hp: 10, windup: 0, cooldown: 0, hitFlash: 0, ...over });
const blow = (over: Partial<Blow> = {}): Blow => ({ damage: 3, stagger: false, knockback: 0.4, wardenKnockback: 0.1, ...over });

test('a blow takes its damage, flashes the body, and reports a kill only at zero', () => {
  const cells = floor(5, 5), guard = body('guard', { hp: 4 }), at = { x: 2 * TILE, z: 2 * TILE };
  assert.deepEqual(landBlow(cells, guard, at, blow(), { x: 1, z: 0 }), { broke: false, killed: false, blocked: false });
  assert.equal(guard.hp, 1);
  assert.equal(guard.hitFlash, HIT_FLASH);
  assert.equal(landBlow(cells, guard, at, blow(), { x: 1, z: 0 }).killed, true);
});

test('a blow breaks a committed windup on a guard, and never a warden\'s without stagger', () => {
  const cells = floor(5, 5), wound = COMMITTED_WINDUP + 0.1;
  const guard = body('guard', { windup: wound });
  assert.equal(landBlow(cells, guard, { x: 2 * TILE, z: 2 * TILE }, blow(), { x: 1, z: 0 }).broke, true);
  assert.equal(guard.windup, 0);
  assert.equal(guard.cooldown, HIT_COOLDOWN, 'plain steel buys only the ordinary cooldown');

  const warden = body('warden', { windup: wound });
  assert.equal(landBlow(cells, warden, { x: 2 * TILE, z: 2 * TILE }, blow(), { x: 1, z: 0 }).broke, false);
  assert.equal(warden.windup, wound, 'the committed swing goes on');

  const staggered = body('warden', { windup: wound });
  assert.equal(landBlow(cells, staggered, { x: 2 * TILE, z: 2 * TILE }, blow({ stagger: true }), { x: 1, z: 0 }).broke, true);
  assert.equal(staggered.cooldown, RECOVERY.warden, 'a stagger arm that broke the swing keeps it down');
});

test('an early tell is not broken, and a blow never shortens a cooldown already running', () => {
  const guard = body('guard', { windup: COMMITTED_WINDUP - 0.05, cooldown: 2 });
  assert.equal(landBlow(floor(5, 5), guard, { x: 2 * TILE, z: 2 * TILE }, blow({ stagger: true }), { x: 1, z: 0 }).broke, false);
  assert.equal(guard.windup, COMMITTED_WINDUP - 0.05);
  assert.equal(guard.cooldown, 2);
});

test('a blow shoves along its heading, a warden less, and a wall stops it', () => {
  const cells = floor(5, 5), from = { x: 2 * TILE, z: 2 * TILE };
  const guardAt = { ...from }, wardenAt = { ...from };
  landBlow(cells, body('guard'), guardAt, blow(), { x: 0, z: 1 });
  landBlow(cells, body('warden'), wardenAt, blow(), { x: 0, z: 1 });
  assert.equal(guardAt.x, from.x);
  assert.ok(Math.abs(guardAt.z - from.z - 0.4) < 1e-9);
  assert.ok(Math.abs(wardenAt.z - from.z - 0.1) < 1e-9);

  const pinned = { x: 2 * TILE, z: 4 * TILE };
  landBlow(cells, body('guard'), pinned, blow({ knockback: 5 }), { x: 0, z: 1 });
  assert.ok(canStand(cells, pinned.x, pinned.z), 'the body is still on the floor');
  assert.ok(pinned.z - 4 * TILE < TILE / 2, 'the edge of the floor stopped a shove meant to carry it five units');
});

test('a blade drives a body straight away from the knight, as THREE.Vector3.normalize would', () => {
  const push = awayFrom({ x: 1, z: 1 }, { x: 4, z: -3 });
  const scale = 1 / Math.sqrt(3 * 3 + 0 + -4 * -4);
  assert.deepEqual(push, { x: 3 * scale, z: -4 * scale });
  assert.deepEqual(awayFrom({ x: 2, z: 2 }, { x: 2, z: 2 }), { x: 0, z: 0 }, 'a body on top of the knight is not shoved');
});

test('the real arms carry what a blow reads', () => {
  const maul = weaponById('maul');
  for (const arm of [TIDEBLADE, maul]) {
    const guard = body('guard', { hp: 100 });
    landBlow(floor(5, 5), guard, { x: 2 * TILE, z: 2 * TILE }, { ...arm, damage: arm.damage + 1 }, { x: 1, z: 0 });
    assert.equal(guard.hp, 100 - arm.damage - 1);
  }
  assert.equal(maul.stagger, true, 'the fixture wants a stagger arm');
});

test('fire bites for its damage and flashes, with no stagger and no shove', () => {
  const guard = body('guard', { hp: 2, windup: COMMITTED_WINDUP + 0.2, cooldown: 0.1 });
  assert.equal(burn(guard, 1), false);
  assert.deepEqual(guard, body('guard', { hp: 1, windup: COMMITTED_WINDUP + 0.2, cooldown: 0.1, hitFlash: HIT_FLASH }));
  assert.equal(burn(guard, 1), true);
});

test('a shieldbearer turns a blow aside from the front, and only while its shield is up', () => {
  const cells = floor(5, 5), at = () => ({ x: 2 * TILE, z: 2 * TILE });
  // Facing -z; the knight stands at -z, so his blow drives the body toward +z: head on.
  const facing = { x: 0, z: -1 }, headOn = { x: 0, z: 1 }, fromBehind = { x: 0, z: -1 };
  const shielded = body('shieldbearer', { hp: 12, windup: 0.5 });
  shielded.windup = 0;
  const turned = landBlow(cells, shielded, at(), blow(), headOn, facing);
  assert.deepEqual([turned.blocked, shielded.hp, shielded.hitFlash], [true, 12, 0], 'a frontal blow wounded the shieldbearer');
  // The same blow from behind lands in full.
  const back = body('shieldbearer', { hp: 12 });
  assert.equal(landBlow(cells, back, at(), blow(), fromBehind, facing).blocked, false);
  assert.equal(back.hp, 9);
  // The opening: its own tell, and its recovery from its own swing.
  assert.equal(blocks(body('shieldbearer', { windup: 0.3 }), facing, headOn, false), false, 'the shield stayed up through its own tell');
  assert.equal(blocks(body('shieldbearer', { cooldown: RECOVERY.shieldbearer }), facing, headOn, false), false, 'the shield stayed up while it recovered');
  assert.equal(blocks(body('shieldbearer', { cooldown: HIT_COOLDOWN }), facing, headOn, false), true, 'a plain flinch dropped the shield');
  // A stagger arm breaks the guard, and nothing without a shield ever blocks.
  assert.equal(blocks(body('shieldbearer'), facing, headOn, true), false);
  assert.equal(blocks(body('guard'), facing, headOn, false), false);
  // Off to the side, past the shield's arc, gets through.
  assert.equal(blocks(body('shieldbearer'), facing, { x: 1, z: 0 }, false), false);
  // Without a facing to judge by (the balance sim's bodies carry none) nothing is ever turned aside.
  const blind = body('shieldbearer', { hp: 12 });
  assert.equal(landBlow(cells, blind, at(), blow(), headOn).blocked, false);
});

test('the push that opens a boss\'s phase change leaves the knight outside its largest melee reach, from any side and any distance', () => {
  asReaper(TEST_BOSS, () => {
    const cells = floor(24, 24), boss = { kind: 'reaper' as const, x: 12 * TILE, z: 12 * TILE };
    // The reach to clear is the sweep's 3.1, not the swing's 1.9: a pounce and a volley are lanes, not reach.
    assert.equal(bossReach('reaper'), 3.1);
    let pushed = 0;
    for (let side = 0; side < 8; side++) for (const gap of [0, 0.4, 1, 2, 3]) {
      const knight = { x: boss.x + Math.cos(side * Math.PI / 4) * gap, z: boss.z + Math.sin(side * Math.PI / 4) * gap };
      assert.ok(Math.hypot(knight.x - boss.x, knight.z - boss.z) < 3.1, 'precondition: the knight starts inside the reach');
      const push = bossPush(boss, knight), at = { ...knight };
      moveOnFloor(cells, at, push.x, push.z);
      const left = Math.hypot(at.x - boss.x, at.z - boss.z);
      assert.ok(left > 3.1, `a knight ${gap} from the boss on side ${side} was left ${left.toFixed(2)} from it, inside its 3.1 reach`);
      pushed++;
    }
    assert.equal(pushed, 40);
    // Already clear of it: no push at all.
    assert.deepEqual(bossPush(boss, { x: boss.x + 4, z: boss.z }), { x: 0, z: 0 });
    // His back to a wall, he goes as far as the floor lets him and is left standing on it, not in the stone.
    const edge = { x: 23 * TILE, z: 12 * TILE }, wall = { kind: 'reaper' as const, x: 22 * TILE, z: 12 * TILE }, cornered = { ...edge };
    const shove = bossPush(wall, edge);
    assert.ok(shove.x > 0, 'precondition: the push drives him into the wall');
    moveOnFloor(cells, cornered, shove.x, shove.z);
    assert.ok(canStand(cells, cornered.x, cornered.z), 'the push left the knight inside the wall');
    assert.ok(cornered.x < 23.5 * TILE, 'the push carried the knight through the wall');
  });
});

// Plan 023 (D3): the Keep Crossbow works in the chambers and was shut out of the bosses, whose vitality is in the hundreds against about five damage a second of sustained fire. A shot deals BOSS_BOLT times its damage to a boss, and
// nothing else about it changes. The blows are built the way the game and the balance sim build them (`boltBlow`, and `hurledBlow` for a special's shot), so a shot that is not marked as one fails here.
test('a bolt deals BOSS_BOLT times its damage to a boss and its own damage to anything else, and steel is never multiplied (plan 023 D3)', () => {
  assert.ok(BOSS_BOLT >= 2 && BOSS_BOLT <= 4 && Number.isInteger(BOSS_BOLT), `BOSS_BOLT is ${BOSS_BOLT}: D3 allows a whole multiplier from 2 to 4`);
  const crossbow = weaponById('crossbow'), cells = floor(5, 5), at = { x: 2 * TILE, z: 2 * TILE }, from = { x: 1, z: 0 };
  const bosses = [...BOSS_POOL, FINAL_BOSS], ordinary = ENEMY_KINDS.filter(kind => !BESTIARY[kind].boss);
  assert.ok(bosses.length === 5 && bosses.every(kind => BESTIARY[kind].boss), 'precondition: five kinds are bosses');
  assert.ok(ordinary.length === 10 && ordinary.includes('warden'), 'precondition: the rest are ordinary, the warden among them');
  const bolt = boltBlow(crossbow, 9);
  for (const kind of bosses) {
    const struck = body(kind, { hp: 500 });
    assert.equal(landBlow(cells, struck, { ...at }, bolt, from).blocked, false, `precondition: the bolt was not turned aside by a ${kind}`);
    assert.equal(struck.hp, 500 - 9 * BOSS_BOLT, `a bolt on a ${kind} dealt ${500 - struck.hp}, not ${9 * BOSS_BOLT}`);
    const stabbed = body(kind, { hp: 500 });
    landBlow(cells, stabbed, { ...at }, blow({ damage: 9 }), from);
    assert.equal(stabbed.hp, 500 - 9, `a blow of steel on a ${kind} was multiplied`);
  }
  for (const kind of ordinary) {
    const struck = body(kind, { hp: 500 });
    // Face a shielded kind away from the shot, so nothing here is about the shield.
    landBlow(cells, struck, { ...at }, bolt, from, { x: 1, z: 0 });
    assert.equal(struck.hp, 500 - 9, `a bolt on a ${kind} dealt ${500 - struck.hp}, not its own 9: only a boss takes the multiplier`);
  }
});

test('the Heavy Bolt is multiplied by BOSS_BOLT on a boss as well, and the same bolt on a warden is not (plan 023 D3)', () => {
  const heavy = weaponById('crossbow').special!, cells = floor(5, 5), at = { x: 2 * TILE, z: 2 * TILE }, from = { x: 1, z: 0 };
  const special = hurledBlow(heavy, { harpoon: false, damage: 36 }, { free: true, steadfast: true }).blow;
  const boss = body('king', { hp: 650 }), warden = body('warden', { hp: 650 });
  landBlow(cells, boss, { ...at }, special, from); landBlow(cells, warden, { ...at }, special, from);
  assert.equal(boss.hp, 650 - 36 * BOSS_BOLT, 'the Heavy Bolt was not multiplied on the Bone King');
  assert.equal(warden.hp, 650 - 36, 'the Heavy Bolt was multiplied on a warden');
});

// D3 is the crossbow's: "bolts deal x2 damage to bosses ... nothing else about the crossbow changes", and no other arm changes at all. The flask and the thrown spear fly shots too and are not multiplied.
test('only a crossbow bolt is multiplied: a thrown flask and the thrown spear are not (plan 023 D3)', () => {
  const cells = floor(5, 5), at = { x: 2 * TILE, z: 2 * TILE }, from = { x: 1, z: 0 };
  const flask = weaponById('flask'), harpoon = weaponById('spear').special!;
  assert.ok(flask.ranged && harpoon.swing.ranged, 'precondition: the flask and the harpoon are shots');
  const struck = (blowOf: Blow) => { const boss = body('mother', { hp: 500 }); landBlow(cells, boss, { ...at }, blowOf, from); return 500 - boss.hp; };
  assert.equal(struck(boltBlow(flask, 6)), 6, 'a flask\'s shot was multiplied on a boss');
  assert.equal(struck(hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: true, steadfast: true }).blow), 6, 'the thrown spear was multiplied on a boss');
  assert.equal(struck(boltBlow(weaponById('crossbow'), 6)), 6 * BOSS_BOLT, 'precondition: the same damage from the crossbow is multiplied');
  assert.deepEqual([weaponById('crossbow').bolt, weaponById('crossbow').special!.swing.bolt, flask.bolt, harpoon.swing.bolt], [true, true, undefined, undefined], 'the bolt flag is on the crossbow and its Heavy Bolt and nowhere else');
});

test('a boss changing phase still takes nothing from a shot, multiplied or not (plan 023 D3)', () => {
  const boss = body('captain', { hp: 500, change: 0.5 });
  assert.deepEqual(landBlow(floor(5, 5), boss, { x: 2 * TILE, z: 2 * TILE }, boltBlow(weaponById('crossbow'), 9), { x: 1, z: 0 }), { broke: false, killed: false, blocked: false, immune: true });
  assert.equal(boss.hp, 500, 'a shot wounded a boss mid phase change');
});
