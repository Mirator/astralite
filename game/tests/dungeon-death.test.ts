import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { advanceDeath, startDeath } from '../app/dungeon-death.ts';
import { BESTIARY, ENEMY_KINDS } from '../app/dungeon-bestiary.ts';

for(const kind of ENEMY_KINDS)test(`${kind} death preserves its initial pose, freezes, lands, and stays full size`,()=>{
  const group=new THREE.Group(),rig=new THREE.Group(),limbs=Array.from({length:4},()=>new THREE.Group()),weapon=new THREE.Group(),shield=new THREE.Mesh(new THREE.BoxGeometry(.1,.6,.6));
  // A standard material with a live windup glow, as the game's bodies wear: the default Mesh material has no emissive to clear.
  const glow=new THREE.MeshStandardMaterial({emissive:0xff3010});
  const body=new THREE.Mesh(new THREE.BoxGeometry(.5,1.5,.5),glow);body.position.y=.8;
  const eye=new THREE.Mesh();rig.add(body,weapon,...limbs,eye);limbs[0].add(shield);group.add(rig);
  group.userData={rig,limbs,weapon,shield,eyes:[eye]};group.position.set(2,.03,4);group.rotation.y=.8;group.scale.set(...BESTIARY[kind].look.scale);rig.rotation.x=-.35;
  assert.notEqual(glow.emissive.getHex(),0,'precondition: the body is glowing before it dies');
  const before=rig.quaternion.clone(),scale=group.scale.clone(),death=startDeath(group,kind);
  assert.ok(rig.quaternion.angleTo(before)<.000001);assert.equal(eye.visible,false);
  assert.equal(glow.emissive.getHex(),0,'a corpse kept its windup glow');
  advanceDeath(death,.2);assert.ok(rig.quaternion.angleTo(before)>.02);
  const frozen=rig.quaternion.clone();advanceDeath(death,0);assert.ok(rig.quaternion.angleTo(frozen)<.000001);
  advanceDeath(death,2);assert.equal(death.settled,true);assert.deepEqual(group.scale,scale);
  // Which way it went down, read off the pose: the rig's up axis in the actor's own frame, where forward is -Z.
  const up=new THREE.Vector3(0,1,0).applyQuaternion(rig.quaternion),prone=BESTIARY[kind].look.death.prone;
  assert.ok(prone?up.z<-.9:up.z>.9,`${kind} fell ${up.z<0?'forwards':'backwards'} but should fall ${prone?'forwards':'backwards'}`);
  group.updateMatrixWorld(true);const floor=new THREE.Box3().setFromObject(body);assert.ok(floor.min.y>=.034);
  const weaponDirection=new THREE.Vector3(0,0,-1).transformDirection(weapon.matrixWorld);assert.ok(Math.abs(weaponDirection.y)<.000001,'dropped weapon lies along the floor');
  const landed=rig.quaternion.clone(),position=group.position.clone();advanceDeath(death,1000);
  assert.deepEqual(group.position,position);assert.ok(rig.quaternion.angleTo(landed)<.000001);assert.equal(group.visible,true);
  group.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();(node.material as THREE.Material).dispose();}});
});

test('the bestiary has kinds that fall each way, so the per-kind direction check covers both', () => {
  const prone=ENEMY_KINDS.filter(kind=>BESTIARY[kind].look.death.prone);
  assert.ok(prone.length>0&&prone.length<ENEMY_KINDS.length,`${prone.length} of ${ENEMY_KINDS.length} kinds fall forwards`);
});
