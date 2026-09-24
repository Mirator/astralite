import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { weaponTrail } from '../app/dungeon-weapon-trail.ts';

test('blade trail follows the real weapon through parent rotation and translation', () => {
  const trail = weaponTrail(0xffffff), actor = new THREE.Group(), sword = new THREE.Group();
  actor.position.set(4, 1, -2); actor.rotation.y = .8; actor.add(sword); sword.position.set(.44, 1, 0);
  const inner = new THREE.Vector3(0, 0, -.4), outer = new THREE.Vector3(0, 0, -1.18);
  trail.update(.016, true, sword, inner, outer); sword.rotation.y = 1;
  trail.update(.016, true, sword, inner, outer);
  // Plan 014 round 9 (lever 1): the trail is a fixed-length spline over the recorded tip history now
  // (see dungeon-weapon-trail.ts), not one quad per raw sample - so there is no single vertex that is
  // the weapon's exact current position any more, the way the newest sample's own tip vertex used to
  // be: the ribbon has real thickness at its head end too (the blade's own width), not a zero-width
  // point there. What still has to hold is that the ribbon's leading edge - the last pair of
  // vertices' own midpoint - tracks the weapon, which is the actual invariant a caller depends on.
  const tip = outer.clone().applyMatrix4(sword.matrixWorld), positions = trail.mesh.geometry.getAttribute('position');
  const head = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 2)
    .add(new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1)).multiplyScalar(.5);
  assert.ok(head.distanceTo(tip) < .0001);
  assert.equal(trail.mesh.visible, true);
  trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
});

test('trails expire on misses, freeze on redraw, clear on cancel, and reuse geometry', () => {
  const trail = weaponTrail(0xffffff), sword = new THREE.Group(), inner = new THREE.Vector3(0, 0, -.4), outer = new THREE.Vector3(0, 0, -1);
  const geometry = trail.mesh.geometry;
  for (let swing = 0; swing < 50; swing++) {
    trail.update(.016, true, sword, inner, outer); sword.rotation.y += .2;
    trail.update(.016, true, sword, inner, outer);
    const count = geometry.drawRange.count;
    trail.update(0, true, sword, inner, outer); assert.equal(geometry.drawRange.count, count);
    trail.update(.11, false, sword, inner, outer); assert.equal(trail.mesh.visible, false);
    assert.equal(trail.mesh.geometry, geometry);
  }
  trail.clear(); assert.equal(geometry.drawRange.count, 0); assert.equal(trail.mesh.visible, false);
  geometry.dispose(); trail.mesh.material.dispose();
});

// Plan 014 round A: the bright cutting edge (uv.y = 1) has to be the crescent's outer rim, away from
// the wielder, whichever way the blade sweeps - it used to land on whichever side the sweep's own
// tangent happened to put it, so half of all swings drew their hot edge on the inside of the arc.
test('the trail puts its bright rim on the side away from the wielder, for either sweep direction', () => {
  for (const direction of [1, -1]) {
    const trail = weaponTrail(0xffffff, .3, 1, 2.4), sword = new THREE.Group();
    const inner = new THREE.Vector3(0, 0, -.4), outer = new THREE.Vector3(0, 0, -1.2);
    for (let i = 0; i < 6; i++) { sword.rotation.y = direction * i * .25; sword.updateMatrixWorld(true); trail.update(.016, true, sword, inner, outer); }
    const positions = trail.mesh.geometry.getAttribute('position'), uvs = trail.mesh.geometry.getAttribute('uv');
    let checked = 0;
    for (let v = 2; v < positions.count; v += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, v), b = new THREE.Vector3().fromBufferAttribute(positions, v + 1);
      if (a.distanceTo(b) < 1e-4) continue;
      const rim = uvs.getY(v + 1) === 1 ? b : a, body = rim === b ? a : b;
      assert.ok(Math.hypot(rim.x, rim.z) > Math.hypot(body.x, body.z), `sweep ${direction}: vertex pair ${v / 2} has its rim nearer the wielder than its body`);
      checked++;
    }
    assert.ok(checked > 10, 'the trail laid down too few vertex pairs to check');
    trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
  }
});
