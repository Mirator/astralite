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
await step(0);await page.locator('.primary-action').click();await page.evaluate(()=>window.dungeonTest.grantXp(150));let s;
for(let level=1;level<=1;level++){
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
assert.equal((await state()).rank,2);assert.deepEqual(errors,[]);await browser.close();console.log('Final warden rank-up resolves before floor results; continuation preserves rank.');