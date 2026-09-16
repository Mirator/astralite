import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { advanceDeath, startDeath, type FallenKind } from '../app/dungeon-death.ts';

for(const kind of ['guard','stalker','warden'] as FallenKind[])test(`${kind} death preserves its initial pose, freezes, lands, and stays full size`,()=>{
  const group=new THREE.Group(),rig=new THREE.Group(),limbs=Array.from({length:4},()=>new THREE.Group()),weapon=new THREE.Group(),shield=new THREE.Mesh(new THREE.BoxGeometry(.1,.6,.6));
  const body=new THREE.Mesh(new THREE.BoxGeometry(.5,1.5,.5));body.position.y=.8;
  const eye=new THREE.Mesh();rig.add(body,weapon,...limbs,eye);limbs[0].add(shield);group.add(rig);
  group.userData={rig,limbs,weapon,shield,eyes:[eye]};group.position.set(2,.03,4);group.rotation.y=.8;group.scale.setScalar(kind==='warden'?1.3:1);rig.rotation.x=-.35;
  const before=rig.quaternion.clone(),scale=group.scale.clone(),death=startDeath(group,kind);
  assert.ok(rig.quaternion.angleTo(before)<.000001);assert.equal(eye.visible,false);
  advanceDeath(death,.2);assert.ok(rig.quaternion.angleTo(before)>.02);
  const frozen=rig.quaternion.clone();advanceDeath(death,0);assert.ok(rig.quaternion.angleTo(frozen)<.000001);
  advanceDeath(death,2);assert.equal(death.settled,true);assert.deepEqual(group.scale,scale);
  group.updateMatrixWorld(true);const floor=new THREE.Box3().setFromObject(body);assert.ok(floor.min.y>=.034);
  const weaponDirection=new THREE.Vector3(0,0,-1).transformDirection(weapon.matrixWorld);assert.ok(Math.abs(weaponDirection.y)<.000001,'dropped weapon lies along the floor');
  const landed=rig.quaternion.clone(),position=group.position.clone();advanceDeath(death,1000);
  assert.deepEqual(group.position,position);assert.ok(rig.quaternion.angleTo(landed)<.000001);assert.equal(group.visible,true);
  group.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();(node.material as THREE.Material).dispose();}});
});
