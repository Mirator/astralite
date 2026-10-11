import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';
import { animateCloth } from '../app/dungeon-motion.ts';
import { DASH_CAPE, playerRunPose } from '../app/dungeon-run-pose.ts';

// The cape the game ships (`buildCape` in dungeon-knight.ts, reached through the knight), not a copy of it: a
// standalone copy (dungeon-cloak.ts, since deleted) drifted from the real one (shorter, no ragged hem) while this test watched it.
test('cloak shoulder seam stays pinned and the hem trails behind the knight at idle, run and dash', () => {
  const knight=makeKnight(),cape=knight.userData.cape as THREE.Mesh,anchor=cape.position.clone().add((knight.userData.torso as THREE.Object3D).position),geometry=(cape.geometry as THREE.BufferGeometry).clone(),mesh=new THREE.Mesh(geometry),positions=geometry.getAttribute('position');
  const seam=Array.from({length:positions.count},(_,i)=>i).filter(i=>positions.getY(i)===0);
  assert.equal(seam.length,11,'precondition: the seam is the cape\'s whole top row, or "pinned" checks a few vertices');
  const rest=seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray());
  // The strength dungeon-game.tsx animates it at, with the pitches it holds the cape at for each: upright standing,
  // up to the run pose's highest lift at a sprint (dungeon-run-pose.ts), and damped to DASH_CAPE dashing. Read off
  // the pose rather than restated. A bigger lift only makes "behind the body" easier, so what catches a lift that
  // grows is the point's tip: it must stay below the sash (torso .76, sash -.04 in dungeon-knight.ts' spec), or the
  // short point is standing out behind him. (The first frames of a dash from a standstill are still near upright
  // at full strength, and the hem pokes forward there; not held here.) Four sample times read a little under the
  // sway's true peak (.708 against .712 at DASH_CAPE): dungeon-run-pose.test.ts holds the measured ceiling.
  const SASH=.72,tip=12*11+5;
  assert.equal(tip,Array.from({length:positions.count},(_,i)=>i).reduce((low,i)=>positions.getY(i)<positions.getY(low)?i:low),'precondition: the tip the sash check reads is the point\'s lowest vertex');
  const run=-Math.max(...Array.from({length:64},(_,i)=>playerRunPose(i*Math.PI/32,8.5).cape));
  assert.ok(run<-.1,'precondition: the run pose lifts the cape at all');
  for(const [strength,pitch] of [[.045,-.1],[.16,-.1],[.16,run],[.16,-DASH_CAPE],[.32,-DASH_CAPE]]){
    mesh.position.copy(anchor);mesh.rotation.x=pitch;mesh.updateMatrixWorld();
    for(const time of [0,.3,1,4]){
      animateCloth(mesh,time,strength);
      assert.deepEqual(seam.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i).toArray()),rest);
      for(let i=0;i<positions.count;i++){
        const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y>.1,'cloth must clear the ground');
        assert.ok(point.z>=.219,'cloth must stay behind the body');
      }
      const point=new THREE.Vector3().fromBufferAttribute(positions,tip).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.y<SASH,`at pitch ${pitch.toFixed(2)} the point's tip rose to ${point.y.toFixed(3)}, above the sash`);
    }
  }
  geometry.dispose();(mesh.material as THREE.Material).dispose();(cape.material as THREE.Material).dispose();cape.geometry.dispose();
});
