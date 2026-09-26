import { expect, strikeStance, test, type Snapshot } from './helpers.ts';

type Corpse={kind:string;x:number;y:number;z:number;scale:number[];rotation:number;age:number;settled:boolean;visible:boolean;cue:boolean;bar:boolean;trails:boolean};
const corpses=(state:Snapshot)=>(state as Snapshot&{corpses:Corpse[]}).corpses;

// The corpse wiring does not depend on the kind (the per-kind fall itself is tests/dungeon-death.test.ts), so
// the warden runs on every pull request and the other two nightly.
for(const kind of ['guard','stalker','warden'])test(`${kind} falls, persists, freezes on pause and cannot fight or pay rewards twice`,{tag:kind==='warden'?[]:['@nightly']},async({game,page})=>{
  await game.enter();const opening=await game.state(),index=opening.enemies.findIndex(e=>e.kind===kind),floor=await game.floor(),spot={x:0,z:0},stance=strikeStance(floor,spot);
  expect(index).toBeGreaterThanOrEqual(0);await game.teleport(stance.x,stance.z);
  await game.configureCombat({enemies:[{index,x:0,z:0,hp:1,cooldown:10,windup:0}]});
  await page.keyboard.down(stance.key);await game.step(1);await page.keyboard.up(stance.key);await page.keyboard.press('Space');await game.step(240);
  const killed=await game.state(),falling=corpses(killed)[0];expect(falling.kind).toBe(kind);expect(falling.settled).toBe(false);expect(falling.visible).toBe(true);
  expect(falling.cue||falling.bar||falling.trails).toBe(false);expect(killed.enemies).toHaveLength(opening.enemies.length-1);
  await game.capture(`${kind}-falling`);
  await page.keyboard.press('Escape');await game.step(900);expect(corpses(await game.state())[0]).toEqual(falling);
  await page.keyboard.press('Escape');await game.step(1300);const landed=corpses(await game.state())[0];
  expect(landed.settled).toBe(true);expect(landed.scale).toEqual(kind==='warden'?[1.3,1.3,1.3]:kind==='stalker'?[.94,1,.94]:[1,1,1]);expect(Math.abs(landed.rotation)).toBeCloseTo(Math.PI/2,4);
  await game.capture(`${kind}-corpse`);
  await page.keyboard.press('Space');await game.step(500);expect((await game.state()).experience.total).toBe(killed.experience.total);
  await page.keyboard.down(stance.key);await game.step(550);await page.keyboard.up(stance.key);
  expect(Math.hypot((await game.state()).player.x-stance.x,(await game.state()).player.z-stance.z)).toBeGreaterThan(2);
  await game.step(5000);expect(corpses(await game.state())[0]).toEqual(landed);expect((await game.state()).health).toBe(killed.health);
  await game.buildFloor(2);expect(corpses(await game.state())).toEqual([]);
});

test('cloak stays attached while running and dodging, and the guard keeps its shield facing forward',async({game,page})=>{
  await game.enter();
  const cloak=async()=>((await game.state()).player as Snapshot['player']&{cloak:{anchor:number[];pitch:number}}).cloak;
  // The anchor and the shield's tilt are build constants nothing writes at runtime, so they are not asserted.
  // What moves is the cape's pitch: at rest it hangs near -.1, so only a swing well past that shows the dash
  // actually drove it back.
  // Settled first: a running cape already hangs past -.4, so a dash straight out of a run would pass with the
  // dash's own swing deleted. From a standstill, only the dash can carry it there.
  await page.keyboard.down('ArrowDown');await game.step(220);await page.keyboard.up('ArrowDown');await game.step(700);
  expect((await cloak()).pitch,'the cape has not settled before the dash').toBeGreaterThan(-.3);
  await page.keyboard.press('ShiftLeft');await game.step(80);
  expect((await cloak()).pitch,'the cape did not stream back through the dash').toBeLessThan(-.4);await game.capture('attached-cloak-dash');
  await game.step(500);const state=await game.state(),index=state.enemies.findIndex(e=>e.kind==='guard');
  await game.teleport(0,0);await game.configureCombat({enemies:[{index,x:1,z:0,cooldown:0,windup:.5,aim:{x:-1,z:0}}]});
  for(const ms of [32,250,250,400]){
    await game.step(ms);const pose=((await game.state()).enemies[index] as Snapshot['enemies'][number]&{pose:{shieldArm:number;shieldTilt:number}}).pose;
    expect(pose.shieldArm).toBeGreaterThan(-.33);expect(pose.shieldArm).toBeLessThan(-.08);
  }
  await game.capture('shield-recovered');
});
