import assert from 'node:assert/strict';
import test from 'node:test';
import { enemyPose } from '../app/dungeon-enemy-pose.ts';
import { LUNGE_TIME, RECOVERY } from '../app/dungeon-enemy.ts';

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
