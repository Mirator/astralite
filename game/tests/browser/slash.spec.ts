import { canStand, expect, hasClearPath, test, trackEnemy, type Snapshot } from './helpers.ts';
import { generateFloor } from '../../app/dungeon-floor.ts';

type PlayerPose = { bodyYaw:number; trail:boolean; trailTriangles:number };
type EnemyPose = { weapon:number; weaponYaw:number; pitch:number; height:number; attackAge:number|null; trails:number; cue:boolean };
const playerPose=(state:Snapshot)=>(state.player as Snapshot['player']&{pose:PlayerPose}).pose;
const enemyPose=(enemy:Snapshot['enemies'][number])=>(enemy as typeof enemy&{pose:EnemyPose}).pose;

for(const key of ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown']){
  test(`player blade trail follows the ${key} cut and expires after a miss`,async({game,page})=>{
    await game.enter();await game.step(120);
    await page.keyboard.down(key);await game.step(16);await page.keyboard.up(key);
    await page.keyboard.press('Space');await game.step(40);
    const anticipation=await game.state();
    expect(anticipation.player.swordAngle).toBeLessThan(0);
    expect(playerPose(anticipation).trail).toBe(false);
    await game.step(90);const contact=await game.state();
    expect(contact.player.swordAngle).toBeGreaterThan(anticipation.player.swordAngle);
    expect(playerPose(contact).trail).toBe(true);
    expect(playerPose(contact).trailTriangles).toBeGreaterThan(0);
    expect(contact.health).toBe(100);
    await game.capture(`player-cut-${key}`);
    await game.step(280);const recovered=await game.state();
    expect(recovered.player.attackTime).toBe(0);expect(recovered.player.swordAngle).toBe(0);
    expect(playerPose(recovered).trail).toBe(false);expect(playerPose(recovered).bodyYaw).toBe(0);
  });
}

test('pause freezes a slash, dodge clears it, and held strikes settle on release',async({game,page})=>{
  await game.enter();await game.step(120);await page.keyboard.press('Space');await game.step(130);
  const swinging=await game.state();expect(playerPose(swinging).trail).toBe(true);
  await page.keyboard.press('Escape');await game.step(500);
  expect(playerPose(await game.state())).toEqual(playerPose(swinging));
  expect((await game.state()).player.attackTime).toBe(swinging.player.attackTime);
  // The blade is live (0.13s in, contact ends at 0.175s), so the dodge waits for contact to end rather than
  // cutting it short; it then fires into the recovery instead of waiting for the whole swing.
  await page.keyboard.press('Escape');await page.keyboard.press('ShiftLeft');await game.step(16);
  const waiting=await game.state();expect(waiting.player.dashTime).toBe(0);expect(waiting.player.attackTime).toBeGreaterThan(0);expect(waiting.player.dashBuffer).toBeGreaterThan(0);
  await game.step(64);const dashed=await game.state();expect(dashed.player.dashTime).toBeGreaterThan(0);expect(dashed.player.attackTime).toBe(0);expect(dashed.player.dashBuffer).toBe(0);
  expect(playerPose(dashed).trail).toBe(false);expect(dashed.player.swordAngle).toBe(0);
  await game.step(250);await page.keyboard.down('Space');await game.step(900);
  expect((await game.state()).player.attackTime).toBeGreaterThan(0);
  await page.keyboard.up('Space');await game.step(500);
  expect(playerPose(await game.state()).trail).toBe(false);
  expect((await game.state()).player.attackTime).toBe(0);
});

for(const kind of ['guard','stalker','warden'] as const){
  test(`${kind} release has a weapon trail and keeps the existing damage boundary`,async({game})=>{
    await game.enter();await game.step(120);
    const initial=await game.state(),floor=generateFloor(initial.floor.seed,initial.floor.level),distance=kind==='stalker'?3:kind==='warden'?1.8:1;
    const candidates=initial.enemies.filter(e=>e.kind===kind&&e.awake).flatMap(enemy=>Array.from({length:16},(_,i)=>({enemy,spot:{x:enemy.x+Math.cos(i*Math.PI/8)*distance,z:enemy.z+Math.sin(i*Math.PI/8)*distance}}))).filter(({enemy,spot})=>canStand(floor.cells,spot.x,spot.z)&&hasClearPath(floor.cells,enemy,spot));
    expect(candidates.length).toBeGreaterThan(0);const {enemy,spot}=candidates[0];
    await game.teleport(spot.x,spot.z);let current=enemy;
    for(let i=0;i<100;i++){await game.step(16);current=trackEnemy(await game.state(),kind,current);if(current.windup>0)break;}
    expect(current.windup).toBeGreaterThan(.15);const health=(await game.state()).health;
    await game.step(current.windup*1000-40);current=trackEnemy(await game.state(),kind,current);
    expect((await game.state()).health).toBe(health);
    if(kind!=='stalker')expect(enemyPose(current).trails).toBe(1);
    await game.capture(`${kind}-cut-before-contact`);
    await game.step(current.windup*1000+1);current=trackEnemy(await game.state(),kind,current);
    expect(enemyPose(current).attackAge).not.toBeNull();
    if(kind!=='stalker'){
      expect((await game.state()).health).toBe(health-(kind==='warden'?20:12));
      expect(enemyPose(current).weapon).toBeLessThan(0);
      expect(enemyPose(current).trails).toBe(1);
    }else{
      await game.step(96);current=trackEnemy(await game.state(),kind,current);
      expect(enemyPose(current).trails).toBe(2);expect(enemyPose(current).cue).toBe(false);
    }
    await game.capture(`${kind}-cut-contact`);
    await game.step(350);current=trackEnemy(await game.state(),kind,current);
    expect(enemyPose(current).trails).toBe(0);
  });
}
