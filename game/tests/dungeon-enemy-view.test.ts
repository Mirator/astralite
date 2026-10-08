import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

// dungeon-enemy-view.ts names its siblings without the `.ts` the bundler does not need, and node's type
// stripping resolves nothing it is not told. Nothing in it touches the DOM, so this file lends node the
// one extension it is missing, for app modules only, before loading it.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\/dungeon-[\w-]+$/.test(specifier) && context.parentURL?.includes('/app/')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { poseEnemy, spawnEnemy, THREAT } = await import('../app/dungeon-enemy-view.ts');
const { TILE } = await import('../app/dungeon-floor.ts');
const { ENEMY_KINDS } = await import('../app/dungeon-bestiary.ts');
type EnemyIntent = import('../app/dungeon-enemy.ts').EnemyIntent;

const art = () => ({ telegraph: new THREE.Texture(), lane: new THREE.Texture(), alert: new THREE.SpriteMaterial() });
const winding = (): EnemyIntent => ({ act: 'windup', x: 0, z: 0, cooldown: 0, hitFlash: 0, windup: .3, lunge: 0, aim: { x: 1, z: 0 }, notice: 0, face: null, hit: false, loose: null, raise: false, scatter: false, move: 0, phase: 0, change: 0, phaseChange: false, roam: { still: 0, to: null, walked: 0 }, veil: false, sound: null, distance: 1 });
/** Every lit part of the body as it draws: what the tell has to reach, from the rig's batches to the skull and the shield arm. */
const litParts = (body: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  body.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) found.push(o); });
  return found;
};

const under = (node: THREE.Object3D, ancestor: THREE.Object3D) => { for (let o: THREE.Object3D | null = node; o; o = o.parent) if (o === ancestor) return true; return false; };

test('a windup flashes the whole body of every kind the threat colour, and a body at rest wears none', () => {
  // models.spec.ts reads one mesh each off the rig, the skull and the shield arm of a live body; this
  // holds every lit mesh on the body, so a part the flash forgets cannot hide behind the three it samples.
  for (const kind of ENEMY_KINDS) {
    const enemy = spawnEnemy({ x: 0, z: 0, kind, room: 0, ambush: false }, 0, 1, new THREE.Group(), art(), TILE);
    const parts = litParts(enemy.group);
    assert.ok(parts.length > 0, `the ${kind} has no lit parts to flash`);
    // The three places the browser samples are all in the set, so the set is the body and not a corner of it.
    const joints: Record<string, THREE.Object3D> = { rig: enemy.group.userData.rig, skull: enemy.group.userData.skull, arm: enemy.group.userData.limbs[0] };
    for (const [name, joint] of Object.entries(joints)) assert.ok(parts.some(part => under(part, joint)), `the ${kind}'s ${name} has no lit part`);

    enemy.windup = .3;
    poseEnemy(enemy, winding(), 1 / 60, 1, 1);
    for (const part of parts) {
      const skin = part.material as THREE.MeshStandardMaterial;
      assert.equal(skin.emissive.getHex(), THREAT, `the ${kind}'s ${part.name || part.parent?.name || 'part'} missed the flash`);
      assert.ok(skin.emissiveIntensity > 0, `the ${kind}'s flash is dark`);
    }

    // Out of the tell and never struck, the body is back to its own colour.
    enemy.windup = 0;
    poseEnemy(enemy, { ...winding(), act: 'ready', windup: 0 }, 1 / 60, 2, 2);
    for (const part of parts) assert.equal((part.material as THREE.MeshStandardMaterial).emissive.getHex(), 0x000000, `the ${kind} kept the threat colour after its tell`);
  }
});

// Plan 022 Stage C (D8). An elite's look, held where it is drawn: the idle branch of `poseEnemy` (the one that rewrites the emissive every frame), the eyes, the bar's pip.
test('an elite glows its modifier\'s colour at rest, and its wind-up and a struck flash win over the glow (plan 022 D8)', async () => {
  const { ELITES, ELITE_MODIFIERS } = await import('../app/dungeon-bestiary.ts');
  const { COMMIT, ELITE_GLOW } = await import('../app/dungeon-enemy-view.ts');
  const resting = (): EnemyIntent => ({ ...winding(), act: 'ready', windup: 0 });
  const plain = spawnEnemy({ x: 0, z: 0, kind: 'guard', room: 0, ambush: false }, 0, 1, new THREE.Group(), art(), TILE);
  const plainEye = (plain.group.userData.eyes[0].material as THREE.MeshBasicMaterial).color.getHex();
  poseEnemy(plain, resting(), 1 / 60, 1, 1);
  for (const part of litParts(plain.group)) assert.equal((part.material as THREE.MeshStandardMaterial).emissive.getHex(), 0x000000, 'a plain body glows at rest');
  const eyes = new Set<number>();
  for (const modifier of ELITE_MODIFIERS) {
    const host = new THREE.Group(), enemy = spawnEnemy({ x: 0, z: 0, kind: 'guard', room: 0, ambush: false, elite: modifier }, 0, 1, host, art(), TILE);
    const parts = litParts(enemy.group), glow = ELITES[modifier].glow;
    assert.ok(parts.length > 0, 'precondition: the elite has lit parts to glow');
    assert.equal(enemy.elite, modifier);
    // At rest every lit part wears the modifier's colour, dimly (a tint under the bloom threshold, not a wash).
    poseEnemy(enemy, resting(), 1 / 60, 1, 1);
    for (const part of parts) {
      const skin = part.material as THREE.MeshStandardMaterial;
      assert.equal(skin.emissive.getHex(), glow, `the ${modifier} guard's ${part.name || part.parent?.name || 'part'} does not glow at rest`);
      assert.equal(skin.emissiveIntensity, ELITE_GLOW);
    }
    assert.ok(ELITE_GLOW > 0 && ELITE_GLOW <= 0.1, 'the idle glow is dark or a wash');
    // The wind-up is the threat colour whatever the body is: the tell must win.
    enemy.windup = .3;
    poseEnemy(enemy, winding(), 1 / 60, 2, 2);
    for (const part of parts) assert.equal((part.material as THREE.MeshStandardMaterial).emissive.getHex(), THREAT, `the ${modifier} guard's glow beat its own wind-up`);
    // A struck body flashes the commit colour.
    enemy.windup = 0; enemy.hitFlash = .2;
    poseEnemy(enemy, resting(), 1 / 60, 3, 3);
    for (const part of parts) assert.equal((part.material as THREE.MeshStandardMaterial).emissive.getHex(), COMMIT, `the ${modifier} guard's glow beat the struck flash`);
    // And it glows again once both are over.
    enemy.hitFlash = 0;
    poseEnemy(enemy, resting(), 1 / 60, 4, 4);
    for (const part of parts) assert.equal((part.material as THREE.MeshStandardMaterial).emissive.getHex(), glow, `the ${modifier} guard did not glow again after the flash`);
    // Its eyes burn in the modifier's colour, its own: not the guard's amber, and not another modifier's.
    const eye = (enemy.group.userData.eyes[0].material as THREE.MeshBasicMaterial).color.getHex();
    assert.notEqual(eye, plainEye, `the ${modifier} guard's eyes are a plain guard's`);
    eyes.add(eye);
    // The bar's pip is the frame wearing the modifier's colour (the mesh count against a plain body's is held by the next test).
    const frame = enemy.bar.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    assert.equal(frame.material.color.getHex(), glow, `the ${modifier} guard's bar has no pip`);
    assert.equal((plain.bar.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.getHex(), 0x6b5a3e);
  }
  assert.equal(eyes.size, ELITE_MODIFIERS.length, 'two modifiers share an eye colour');
  // Each body binds its own eye material: tinting one left a plain body, spawned before them, as it was.
  assert.equal((plain.group.userData.eyes[0].material as THREE.MeshBasicMaterial).color.getHex(), plainEye, 'tinting an elite\'s eyes changed a plain body\'s');
});

test('an elite costs the meshes a plain body costs: the same number in its group, whatever the modifier', () => {
  const count = (elite?: 'hasted' | 'armoured' | 'wrathful' | 'volatile') => {
    const host = new THREE.Group();
    spawnEnemy({ x: 0, z: 0, kind: 'warden', room: 0, ambush: false, ...(elite ? { elite } : null) }, 0, 2, host, art(), TILE);
    let meshes = 0; host.traverse(o => { if (o instanceof THREE.Mesh) meshes++; });
    return meshes;
  };
  assert.ok(count() > 5, 'precondition: a body is more than a mesh');
  for (const modifier of ['hasted', 'armoured', 'wrathful', 'volatile'] as const) assert.equal(count(modifier), count(), `a ${modifier} body is made of more meshes than a plain one`);
});
