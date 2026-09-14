import assert from 'node:assert/strict';
import test from 'node:test';
import { enemyPose } from '../app/dungeon-enemy-pose.ts';
import { LUNGE_TIME, RECOVERY } from '../app/dungeon-enemy.ts';

test('stalker coils during its real tell, extends in flight, and settles after recovery', () => {
  const rest=enemyPose('stalker',0,.58,0,0),coil=enemyPose('stalker',.01,.58,0,0);
  assert.ok(coil.height<rest.height);
  assert.ok(coil.pitch<rest.pitch);
  const flight=enemyPose('stalker',0,.58,RECOVERY.stalker,LUNGE_TIME/2);
  assert.ok(flight.height>rest.height);
  assert.ok(flight.arms>coil.arms);
  assert.deepEqual(enemyPose('stalker',0,.58,0,0),rest);
});

test('warden weapon releases on the hit boundary and visibly recovers longer than a guard', () => {
  const raised=enemyPose('warden',.001,.72,0,0),contact=enemyPose('warden',0,.72,RECOVERY.warden,0);
  assert.ok(raised.weapon>1.5);
  assert.ok(contact.weapon<0);
  assert.ok(contact.pitch<0);
  assert.ok(enemyPose('warden',0,.72,RECOVERY.warden-.4,0).recovery>0);
  assert.equal(enemyPose('guard',0,.5,RECOVERY.guard-.4,0).recovery,0);
});

test('spawn cooldowns do not masquerade as attacks; poses are finite at every phase', () => {
  for(const kind of ['guard','stalker','warden'] as const){
    for(const cooldown of [.4,.6,.8])assert.equal(enemyPose(kind,0,.5,cooldown,0).recovery,0);
    for(let frame=0;frame<=120;frame++){
      const pose=enemyPose(kind,Math.max(0,.5-frame/60),.5,Math.max(0,RECOVERY[kind]-(frame/60-.5)),0);
      assert.ok(Object.values(pose).every(Number.isFinite));
    }
  }
});
