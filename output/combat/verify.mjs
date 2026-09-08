import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='output/combat/verify'; fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1000,height:700}}); const errors=[];
page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const step=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
async function reset(){await page.goto('http://localhost:3000/');await page.waitForFunction(()=>!!window.render_game_to_text);await step(0);}
async function shot(name){await page.screenshot({path:`${out}/${name}.png`});fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(await state(),null,2));}
await reset(); let s=await state(); let x=s.player.x,z=s.player.z;
await page.keyboard.down('ArrowRight');await step(100);let move=await state();
assert(move.player.x>x && move.player.z<z,'right follows screen'); assert(Math.abs(move.player.legs[0])>.05,'gait animates');await shot('walk');
await page.keyboard.up('ArrowRight');await step(100);s=await state();x=s.player.x;z=s.player.z;
await page.keyboard.down('Shift');await step(100);await page.keyboard.up('Shift');s=await state();assert(Math.hypot(s.player.x-x,s.player.z-z)>.85,'stationary dash moves');await shot('dash');await step(100);
await page.keyboard.down('Space');await step(100);await page.keyboard.up('Space');await shot('strike');
await step(180);await page.keyboard.down('Space');await page.keyboard.up('Space');await step(183);s=await state();assert(s.player.attackTime>.25,'late attack buffered');
await page.keyboard.down('ArrowLeft');await step(50);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await step(50);assert((await state()).player.velocity.x===0,'blur releases movement');
await reset(); await page.keyboard.down('Space');
let held=[];const log=[];
for(let i=0;i<400;i++){
 s=await state(); if(s.mode!=='playing')break;
 const target=s.enemies.reduce((a,b)=>Math.hypot(a.x-s.player.x,a.z-s.player.z)<Math.hypot(b.x-s.player.x,b.z-s.player.z)?a:b);
 const dx=target.x-s.player.x,dz=target.z-s.player.z,dist=Math.hypot(dx,dz);
 const sx=(dx*11.5-dz*9.2)/Math.hypot(11.5,9.2),sy=(dx*9.2+dz*11.5)/Math.hypot(11.5,9.2);
 const dot=(dx*s.player.facing.x+dz*s.player.facing.z)/dist;
 let next=[];
 if(dist>1.25 || dot<.8){if(Math.abs(sx)>dist*.38)next.push(sx>0?'ArrowRight':'ArrowLeft');if(Math.abs(sy)>dist*.38)next.push(sy>0?'ArrowDown':'ArrowUp');}
 for(const k of held)if(!next.includes(k))await page.keyboard.up(k);
 for(const k of next)if(!held.includes(k))await page.keyboard.down(k);held=next;
 await step(100);
 if(i%15===0)log.push(await state());
 if(i===12 || i===32)await shot(`encounter-${i}`);
}
await page.keyboard.up('Space');for(const k of held)await page.keyboard.up(k);
await shot('result');s=await state();fs.writeFileSync(`${out}/combat-log.json`,JSON.stringify(log,null,2));assert.equal(s.mode,'won','first encounter clears');
await page.getByRole('button',{name:'TRY AGAIN'}).click();await page.waitForFunction(()=>window.render_game_to_text && JSON.parse(window.render_game_to_text()).mode==='playing');await step(0);assert.equal((await state()).health,100,'restart restores health');
await step(20000);await shot('loss');assert.equal((await state()).mode,'lost','loss transition');
assert.deepEqual(errors,[]); fs.writeFileSync(`${out}/report.json`,JSON.stringify({passed:true,winHealth:s.health,errors},null,2));await browser.close();


