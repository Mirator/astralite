import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://localhost:3000');await page.waitForFunction(()=>!!window.render_game_to_text);
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const step=ms=>page.evaluate(ms=>window.advanceTime(ms,false),ms);
const shot=async path=>{await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path,timeout:60000});};
const act=action=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('dungeon-action',{detail})),action);
const teleport=async(x,z)=>{await page.evaluate(p=>window.dungeonTest.teleport(p.x,p.z),{x,z});await step(16);};
await step(0);await page.locator('.primary-action').click();await step(100);
await page.keyboard.down('ArrowRight');await step(200);await page.keyboard.up('ArrowRight');
assert.ok(Math.hypot((await state()).player.velocity.x,(await state()).player.velocity.z)>8);
await page.keyboard.press('Shift');await step(60);assert.ok((await state()).player.dashTime>0);await step(500);
await shot('output/dynamic/gameplay.png');
await page.keyboard.press('Escape');const paused=await state();await step(1500);assert.deepEqual((await state()).player,paused.player);
await page.locator('summary').click();await shot('output/dynamic/menu.png');await page.getByRole('button',{name:'Sound on',exact:true}).click();assert.equal((await state()).muted,true);await page.locator('.primary-action').click();
let s=await state(),hazard=s.features.find(f=>!f.shrine),shrine=s.features.find(f=>f.shrine);
assert.ok(hazard&&shrine);
// Damage and warning cycle, then a single-use heal.
await teleport(hazard.x,hazard.z);let before=(await state()).health;await step(3700);assert.ok((await state()).health<before,'hazard damages');
await shot('output/dynamic/gauntlet.png');
await teleport(shrine.x,shrine.z);s=await state();assert.equal(s.features.find(f=>f.room===shrine.room).used,true);const healed=s.health;await step(900);assert.equal((await state()).health,healed);await shot('output/dynamic/shrine.png');
// Trigger an ambush by entering its room.
s=await state();const ambush=s.floor.rooms.find(r=>r.encounter==='ambush');assert.ok(s.enemies.some(e=>e.room===ambush.id&&!e.awake));await teleport(ambush.x*1.48,ambush.z*1.48);assert.ok((await state()).enemies.filter(e=>e.room===ambush.id).every(e=>e.awake));await step(600);await shot('output/dynamic/ambush.png');
// Use fixture placement to isolate the real warden combat and normal success transition on all floors.
for(let level=1;level<=3;level++){
  if(level>1)assert.equal((await state()).floor.level,level);
  s=await state();const goal=s.floor.goal;
  await teleport(s.floor.rooms[goal].x*1.48,s.floor.rooms[goal].z*1.48);
  for(let i=0;i<100;i++){
    s=await state();if(s.boonOffer){await page.locator('.boon-option').first().click();continue;}
    if(s.mode==='complete')break;
    assert.equal(s.mode,'playing',`combat floor ${level}`);
    const e=s.enemies.find(e=>e.room===goal);if(!e){await step(30);continue;}
    await teleport(e.x-.85,e.z+.68);await page.keyboard.down('ArrowRight');await step(16);await page.keyboard.up('ArrowRight');await act('attack');await step(220);
  }
  s=await state();assert.equal(s.mode,'complete');assert.equal(s.floor.level,level);assert.equal(s.objective.stairClear,true);
  const frozen=JSON.stringify(s);await page.keyboard.down('Space');await step(5000);await page.keyboard.up('Space');assert.equal(JSON.stringify(await state()),frozen,'success freezes simulation and keeps floor');
  await page.screenshot({path:`output/dynamic/success-${level}.png`});
  await page.locator('.success-screen button').click();await step(16);
  assert.equal((await state()).mode,level===3?'won':'playing');
}
await shot('output/dynamic/victory.png');
await page.reload();await page.waitForFunction(()=>!!window.render_game_to_text);await step(0);await page.setViewportSize({width:390,height:844});await page.locator('.primary-action').click();await step(16);await shot('output/dynamic/mobile.png');
await act('hold-attack');await step(100);assert.ok((await state()).player.attackTime>0);await act('release-attack');await step(500);assert.equal((await state()).player.attackTime,0);
assert.deepEqual(errors,[]);fs.writeFileSync('output/dynamic/verification.json',JSON.stringify({checks:['fast travel','dash','pause freeze','menu sound','hazard damage','shrine single use','ambush activation','three real warden fights','success freeze each floor','explicit continuation','final victory','mobile attack release'],errors},null,2));await browser.close();console.log('All dynamic gameplay checks passed.');
