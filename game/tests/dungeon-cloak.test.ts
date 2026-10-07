import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';
import { animateCloth } from '../app/dungeon-motion.ts';

// The cape the game ships (`buildCape` in dungeon-knight.ts, reached through the knight), not a copy of it: a
// standalone copy (dungeon-cloak.ts, since deleted) drifted from the real one (shorter, no ragged hem) while this test watched it.
test('cloak shoulder seam stays pinned and the hem trails behind the knight at idle, run and dash', () => {
  const cape=makeKnight().userData.cape as THREE.Mesh,geometry=(cape.geometry as THREE.BufferGeometry).clone(),mesh=new THREE.Mesh(geometry),positions=geometry.getAttribute('position');
  const seam=Array.from({length:positions.count},(_,i)=>i).filter(i=>positions.getY(i)===0);
  assert.equal(seam.length,11,'precondition: the seam is the cape\'s whole top row, or "pinned" checks a few vertices');
  const rest=seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray());
  // The strength dungeon-game.tsx animates it at, with the pitches it holds the cape at for each: upright standing,
  // up to -.65 running (dungeon-run-pose.ts), and damped to -.8 dashing. (The first frames of a dash from a
  // standstill are still near upright at full strength, and the hem pokes about 5 cm forward there; not held here.)
  for(const [strength,pitch] of [[.045,-.1],[.16,-.1],[.16,-.55],[.16,-.8],[.32,-.8]]){
    mesh.position.set(0,1.2,.22);mesh.rotation.x=pitch;mesh.updateMatrixWorld();
    for(const time of [0,.3,1,4]){
      animateCloth(mesh,time,strength);
      assert.deepEqual(seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray()),rest);
      for(let i=0;i<positions.count;i++){
        const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y>.1,'cloth must clear the ground');
        assert.ok(point.z>=.219,'cloth must stay behind the body');
      }
    }
  }
  geometry.dispose();(mesh.material as THREE.Material).dispose();(cape.material as THREE.Material).dispose();cape.geometry.dispose();
});
