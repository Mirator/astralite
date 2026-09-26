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
type EnemyIntent = import('../app/dungeon-enemy.ts').EnemyIntent;

const art = () => ({ telegraph: new THREE.Texture(), lane: new THREE.Texture(), alert: new THREE.SpriteMaterial() });
const winding = (): EnemyIntent => ({ act: 'windup', x: 0, z: 0, cooldown: 0, hitFlash: 0, windup: .3, lunge: 0, aim: { x: 1, z: 0 }, notice: 0, face: null, hit: false, sound: null, distance: 1 });
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
  for (const kind of ['guard', 'stalker', 'warden'] as const) {
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
