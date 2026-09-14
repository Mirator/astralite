import assert from 'node:assert/strict';
import test from 'node:test';
import { enemyPose } from '../app/dungeon-enemy-pose.ts';
import { LUNGE_TIME, RECOVERY } from '../app/dungeon-enemy.ts';

test('stalker coils during its real tell, extends in flight, and settles after recovery', () => {
  const rest=enemyPose('stalker',0,.58,0,0),coil=enemyPose('stalker',.01,.58,0,0);
  assert.ok(coil.height<rest.height);
  assert.ok(coil.pitch<rest.pitch);
  const flight=enemyPose('stalker',0,.58,RECOVERY.stalker,LUNGE_TIME/2,.1);
  assert.ok(flight.height>rest.height);
  assert.ok(flight.arms>coil.arms);
  assert.equal(flight.trail,true);
  assert.deepEqual(enemyPose('stalker',0,.58,0,0,RECOVERY.stalker),rest);
});

test('guard and warden release continuously on the hit boundary and recover at different speeds', () => {
  const raised=enemyPose('warden',.16,.72,0,0),beforeContact=enemyPose('warden',.001,.72,0,0),contact=enemyPose('warden',0,.72,RECOVERY.warden,0,0);
  assert.ok(raised.weapon>1.5);
  assert.ok(Math.abs(beforeContact.weapon-contact.weapon)<.05);
  assert.ok(contact.weapon<0);
  assert.ok(contact.pitch<0);
  assert.ok(enemyPose('warden',0,.72,0,0,.1).recovery>enemyPose('guard',0,.5,0,0,.1).recovery);
  assert.ok(enemyPose('guard',.16,.5,0,0).weapon>1);
  assert.ok(enemyPose('guard',0,.5,0,0,0).trail);
});

test('spawn cooldowns do not masquerade as attacks; poses are finite at every phase', () => {
  for(const kind of ['guard','stalker','warden'] as const){
    for(const cooldown of [.4,.6,.8])assert.equal(enemyPose(kind,0,.5,cooldown,0).recovery,0);
    for(let frame=0;frame<=120;frame++){
      const age=frame<30?Infinity:Math.max(0,frame/60-.5);
      const pose=enemyPose(kind,Math.max(0,.5-frame/60),.5,Math.max(0,RECOVERY[kind]-(frame/60-.5)),kind==='stalker'&&frame<50?Math.max(0,LUNGE_TIME-(frame-30)/60):0,age);
      assert.ok(Object.values(pose).every(value=>typeof value==='boolean'||Number.isFinite(value)));
    }
  }
});

test('archetypes keep distinct attack silhouettes and trail timing', () => {
  const guard=enemyPose('guard',.16,.5,0,0),warden=enemyPose('warden',.16,.72,0,0);
  assert.ok(Math.abs(guard.weaponYaw)>Math.abs(warden.weaponYaw));
  assert.ok(Math.abs(guard.weaponRoll)>Math.abs(warden.weaponRoll));
  assert.ok(warden.weapon>guard.weapon);
  assert.equal(enemyPose('guard',.2,.5,0,0).trail,false);
  assert.equal(enemyPose('guard',.04,.5,0,0).trail,true);
  assert.equal(enemyPose('guard',0,.5,0,0,0.2).trail,false);
  assert.equal(enemyPose('stalker',0,.58,0,LUNGE_TIME,0).trail,true);
  assert.equal(enemyPose('stalker',0,.58,0,0).trail,false);
});

test('all rig transforms join continuously at release and an early pounce contact', () => {
  const transforms=['pitch','height','weapon','arms','weaponYaw','weaponRoll','bodyYaw'] as const;
  for(const kind of ['guard','stalker','warden'] as const){
    const tell=kind==='warden'?.72:kind==='stalker'?.58:.5;
    const before=enemyPose(kind,.000001,tell,0,0),after=enemyPose(kind,0,tell,RECOVERY[kind],kind==='stalker'?LUNGE_TIME:0,0);
    for(const key of transforms)assert.ok(Math.abs(before[key]-after[key])<.0001,`${kind} ${key} jumped at release`);
    const idle=enemyPose(kind,0,tell,0,0);
    for(const cooldown of [.4,.8,RECOVERY[kind]])assert.deepEqual(enemyPose(kind,0,tell,cooldown,0),idle);
    const settled=enemyPose(kind,0,tell,0,0,2);
    for(const key of transforms)assert.ok(Math.abs(settled[key]-idle[key])<.0001,`${kind} ${key} did not settle`);
  }
  const flying=enemyPose('stalker',0,.58,1.6,.22,.1),hit=enemyPose('stalker',0,.58,1.6,0,.1);
  assert.deepEqual(hit,flying,'ending the damage movement must not snap the visible pounce');
});
