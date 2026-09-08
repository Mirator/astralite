import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://localhost:3000');await page.waitForFunction(()=>!!window.render_game_to_text);
await page.evaluate(()=>window.advanceTime(0));await page.locator('.primary-action').click();
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const step=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
await step(100);const start=await state();
await page.keyboard.down('ArrowRight');await step(180);await page.keyboard.up('ArrowRight');const moved=await state();assert.ok(Math.hypot(moved.player.x-start.player.x,moved.player.z-start.player.z)>.3);
await page.keyboard.press('Shift');await step(80);assert.ok((await state()).player.dashTime>0);await page.screenshot({path:'output/immersion/dash.png'});
await step(600);await page.keyboard.press('Escape');const paused=await state();await step(1000);assert.deepEqual((await state()).player,paused.player);await page.keyboard.press('Escape');
await page.screenshot({path:'output/immersion/keep.png'});
// Fixture placement isolates a strike against an actual guard; input and combat resolution are unchanged.
const enemy=(await state()).enemies.find(e=>e.kind==='guard'&&e.awake);
assert.ok(enemy);
await page.evaluate(e=>{window.dungeonTest.teleport(e.x-.8,e.z+.64);window.advanceTime(0);},enemy);await step(650);
await page.keyboard.down('ArrowRight');await step(20);await page.keyboard.up('ArrowRight');
await page.keyboard.down('Space');await step(100);await page.screenshot({path:'output/immersion/strike.png'});await step(1000);await page.keyboard.up('Space');
assert.ok((await state()).experience.total>=25,'actual combat awards XP');
const falls=(await state()).floor.waterfalls;
if(falls.length){await page.evaluate(p=>{window.dungeonTest.teleport(p.x-1.5,p.z-1.5);window.advanceTime(0);},falls[0]);await step(800);await page.screenshot({path:'output/immersion/waterfall.png'});await step(450);await page.screenshot({path:'output/immersion/waterfall-motion.png'});}
await page.evaluate(()=>window.dungeonTest.grantXp(200));await page.waitForSelector('.boon-option');assert.equal((await state()).boonOffer,true);await page.locator('.boon-option').first().click();assert.equal((await state()).boonOffer,false);
const resources=[];
for(let i=0;i<3;i++){await page.evaluate(()=>window.dungeonTest.descend());await step(10);resources.push((await state()).render);}
assert.equal((await state()).floor.level,3);assert.ok(Math.max(...resources.map(r=>r.textures))-Math.min(...resources.map(r=>r.textures))<=1,'textures released on rebuild');
await page.setViewportSize({width:390,height:844});await step(16);await page.screenshot({path:'output/immersion/mobile.png'});
const strikeBox=await page.locator('.touch-actions .strike').boundingBox();await page.mouse.move(strikeBox.x+strikeBox.width/2,strikeBox.y+strikeBox.height/2);await page.mouse.down();await step(100);assert.ok((await state()).player.attackTime>0);await page.mouse.up();await step(500);assert.equal((await state()).player.attackTime,0);
assert.deepEqual(errors,[]);fs.writeFileSync('output/immersion/verification.json',JSON.stringify({checks:['movement','dash','pause freeze','guard kill and XP','waterfall motion','boon selection','floor rebuild disposal','mobile held strike release'],resources,errors},null,2));
console.log(JSON.stringify({resources,errors}));await browser.close();


