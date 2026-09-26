import { canStand, expect, hasClearPath, SCREEN_DIRECTIONS, strikeStance, test, trackEnemy, type Snapshot } from './helpers.ts';
import { generateFloor } from '../../app/dungeon-floor.ts';

type PlayerPose = { bodyYaw:number; trail:boolean; trailTriangles:number };
type EnemyPose = { weapon:number; weaponYaw:number; pitch:number; height:number; attackAge:number|null; trails:number; cue:boolean };
const playerPose=(state:Snapshot)=>(state.player as Snapshot['player']&{pose:PlayerPose}).pose;
const enemyPose=(enemy:Snapshot['enemies'][number])=>(enemy as typeof enemy&{pose:EnemyPose}).pose;

test('impact accents come from real hits, freeze with pause, and expire without changing damage',async({game,page})=>{
  const active=async()=>((await game.state()) as Snapshot&{effects:{impacts:number}}).effects.impacts;
  await game.enter();await page.keyboard.press('Space');await game.step(450);
  expect(await active()).toBe(0);
  const floor=await game.floor(),spot={x:0,z:0},stance=strikeStance(floor,spot);
  await game.teleport(stance.x,stance.z);
  await page.keyboard.down(stance.key);await game.step(1);await page.keyboard.up(stance.key);
  // Two blades' worth, so the body survives the blow being measured: vitality is quoted in
  // quarter-hits, and a fixture pinned to a literal 2 would simply die and take the accent with it.
  const blade=(await game.state()).weapon.strikeDamage;
  await game.configureCombat({enemies:[{index:0,x:spot.x,z:spot.z,hp:blade*2,cooldown:10,windup:0}]});
  await page.keyboard.press('Space');await game.step(100);
  expect((await game.state()).enemies[0].hp).toBe(blade);expect(await active()).toBe(1);
  await game.capture('knight-impact');
  await page.keyboard.press('Escape');await game.step(500);expect(await active()).toBe(1);
  await page.keyboard.press('Escape');await game.step(350);expect(await active()).toBe(0);
  expect((await game.state()).enemies[0].hp).toBe(blade);
});

// One knight, four cuts: the trail's rules do not depend on which way he faces, so the four keys share one
// boot and one reset rather than paying for four. Each cut is checked to point where its key did, which the
// four separate copies never asserted.
test('the player blade trail follows every cut and expires after a miss',async({game,page})=>{
  await game.enter();await game.step(120);
  for(const [key,screen] of [['ArrowRight','right'],['ArrowLeft','left'],['ArrowUp','up'],['ArrowDown','down']] as const){
    await page.keyboard.down(key);await game.step(16);await page.keyboard.up(key);
    await page.keyboard.press('Space');await game.step(40);
    const anticipation=await game.state();
    const aim=SCREEN_DIRECTIONS[screen];
    expect(anticipation.player.facing.x*aim.x+anticipation.player.facing.z*aim.z,`the ${key} cut does not face its key`).toBeGreaterThan(.99);
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
    // Past the string's link window, so the next key opens a fresh cut rather than the next beat.
    await game.step(400);
  }
});

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
    const withIndex=initial.enemies.map((enemy,index)=>({...enemy,index}));
    const candidates=withIndex.filter(e=>e.kind===kind&&e.awake).flatMap(enemy=>Array.from({length:16},(_,i)=>({enemy,spot:{x:enemy.x+Math.cos(i*Math.PI/8)*distance,z:enemy.z+Math.sin(i*Math.PI/8)*distance}}))).filter(({enemy,spot})=>canStand(floor.cells,spot.x,spot.z)&&hasClearPath(floor.cells,enemy,spot));
    expect(candidates.length).toBeGreaterThan(0);const {enemy,spot}=candidates[0];
    await game.teleport(spot.x,spot.z);
    // Rooms are half the size they used to be, so a bystander can now close the distance while this
    // test waits on the chosen enemy's own windup. Park every other body's cooldown out of reach so
    // only the one under test can ever land a blow, rather than trusting room size to keep the rest away.
    const bystanders=withIndex.filter(e=>e.index!==enemy.index);
    if(bystanders.length)await game.configureCombat({enemies:bystanders.map(e=>({index:e.index,cooldown:999}))});
    let current:Snapshot['enemies'][number]=enemy;
    for(let i=0;i<100;i++){await game.step(16);current=trackEnemy(await game.state(),kind,current);if(current.windup>0)break;}
    expect(current.windup).toBeGreaterThan(.15);const health=(await game.state()).health;
    await game.step(current.windup*1000-40);current=trackEnemy(await game.state(),kind,current);
    expect((await game.state()).health).toBe(health);
    // The silhouette of the tell, read off a real encounter (these used to be a second, identically
    // staged test per kind in polish.spec.ts): the blade raised, or the stalker coiled.
    if(kind==='stalker')expect(enemyPose(current).pitch,'the stalker is not coiled at the end of its tell').toBeLessThan(-.5);
    else expect(enemyPose(current).weapon,`the ${kind} blade is not raised at the end of its tell`).toBeGreaterThan(1);
    if(kind!=='stalker')expect(enemyPose(current).trails).toBe(1);
    await game.capture(`${kind}-cut-before-contact`);
    await game.step(current.windup*1000+1);current=trackEnemy(await game.state(),kind,current);
    expect(enemyPose(current).attackAge).not.toBeNull();
    if(kind!=='stalker'){
      expect((await game.state()).health).toBe(health-(kind==='warden'?20:12));
      expect(enemyPose(current).weapon).toBeLessThan(0);
      expect(enemyPose(current).trails).toBe(1);
    }else{
      expect(current.lunge,'the stalker did not pounce on release').toBeGreaterThan(0);
      await game.step(96);current=trackEnemy(await game.state(),kind,current);
      expect(enemyPose(current).trails).toBe(2);expect(enemyPose(current).cue).toBe(false);
    }
    await game.capture(`${kind}-cut-contact`);
    await game.step(350);current=trackEnemy(await game.state(),kind,current);
    expect(enemyPose(current).trails).toBe(0);
  });
}
