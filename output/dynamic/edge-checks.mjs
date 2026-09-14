import {chromium} from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const page=await browser.newPage({viewport:{width:1000,height:700}});
await page.goto('http://localhost:3000');await page.waitForFunction(()=>!!window.render_game_to_text);await page.evaluate(()=>window.advanceTime(0));await page.locator('.primary-action').click();
const result=await page.evaluate(()=>{
 const state=()=>JSON.parse(window.render_game_to_text()),step=ms=>window.advanceTime(ms,false),act=detail=>window.dispatchEvent(new CustomEvent('dungeon-action',{detail}));
 step(16);let s=state();const h=s.features.find(f=>!f.shrine), shrine=s.features.find(f=>f.shrine);
 step(((2.8-h.phase+3.6)%3.6)*1000);window.dungeonTest.teleport(h.x,h.z);act('dash');step(90);const dodged=state();
 step(150);window.dungeonTest.teleport(h.x,h.z);step(16);const burnt=state();
 window.dungeonTest.teleport(shrine.x,shrine.z);step(16);const healed=state();
 step(1000);window.dungeonTest.teleport(h.x,h.z);step(3700);const hurtAgain=state();window.dungeonTest.teleport(shrine.x,shrine.z);step(16);const reused=state();
 return {dodged:dodged.health,burnt:burnt.health,healed:healed.health,hurtAgain:hurtAgain.health,reused:reused.health};
});assert.equal(result.dodged,100);assert.ok(result.burnt<100);assert.equal(result.healed,100);assert.equal(result.hurtAgain,result.reused);console.log(result);
// Fresh shrine approach and real mobile pause UI.
await page.reload();await page.waitForFunction(()=>!!window.render_game_to_text);await page.evaluate(()=>window.advanceTime(0));await page.locator('.primary-action').click();await page.evaluate(()=>{const s=JSON.parse(window.render_game_to_text()),f=s.features.find(f=>f.shrine);window.dungeonTest.teleport(f.x+2.5,f.z+2.5);window.advanceTime(1000);});await page.screenshot({path:'output/dynamic/shrine-ready.png'});
await page.setViewportSize({width:390,height:844});await page.keyboard.press('Escape');await page.locator('summary').click();await page.screenshot({path:'output/dynamic/mobile-menu.png'});await page.locator('.primary-action').click();
// Hazard defeat and restart.
await page.evaluate(()=>{const s=JSON.parse(window.render_game_to_text()),f=s.features.find(f=>!f.shrine);window.dungeonTest.teleport(f.x,f.z);window.advanceTime(60000,false);});assert.equal(await page.evaluate(()=>JSON.parse(window.render_game_to_text()).mode),'lost');await page.locator('.end-card button').click();await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).mode==='ready');assert.equal(await page.evaluate(()=>JSON.parse(window.render_game_to_text()).health),100);
await browser.close();console.log('Dodge immunity, single-use healing, mobile menu, defeat/restart passed.');
