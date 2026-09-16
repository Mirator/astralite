import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { playerCloakGeometry } from '../app/dungeon-cloak.ts';
import { animateCloth } from '../app/dungeon-motion.ts';

test('cloak shoulder seam stays pinned and the hem trails behind the knight at idle, run and dash', () => {
  const geometry=playerCloakGeometry(),mesh=new THREE.Mesh(geometry),positions=geometry.getAttribute('position');
  const seam=Array.from({length:positions.count},(_,i)=>i).filter(i=>positions.getY(i)===0);
  const rest=seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray());
  for(const pitch of [-.1,-.55,-.8]){
    mesh.position.set(0,1.2,.22);mesh.rotation.x=pitch;mesh.updateMatrixWorld();
    for(const time of [0,.3,1,4]){
      animateCloth(mesh,time,.16);
      assert.deepEqual(seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray()),rest);
      for(let i=0;i<positions.count;i++){
        const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y>.1,'cloth must clear the ground');
        assert.ok(point.z>=.219,'cloth must stay behind the body');
      }
    }
  }
  geometry.dispose();(mesh.material as THREE.Material).dispose();
});
