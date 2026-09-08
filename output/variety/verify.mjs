import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import { generateFloor, canStand, moveOnFloor, TILE, cellKey } from '../../game/app/dungeon-floor.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
let minimum=3203;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const page=await browser.newPage({viewport:{width:800,height:600}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://localhost:3000');await page.waitForFunction(()=>!!window.render_game_to_text,{timeout:60000});
await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path:'output/variety/intro.png'});await page.getByRole('button',{name:'ENTER THE KEEP',exact:false}).click();await page.evaluate(()=>window.advanceTime(0));
const initial=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));const f=generateFloor(initial.floor.seed);
await page.screenshot({path:'output/variety/start.png'});
await page.keyboard.press('Escape');let paused=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));assert.equal(paused.mode,'paused');await page.evaluate(()=>window.advanceTime(5000));assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).player.x,paused.player.x);await page.getByRole('button',{name:'RESUME JOURNEY',exact:false}).click();await page.keyboard.press('KeyM');assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).muted,true);await page.keyboard.press('KeyM');
// Drive the entire run with keyboard events; no teleports or game-state changes.
const captured=new Set();await page.exposeFunction('reportProgress',async s=>{console.log('Replay:',s.remaining,'guards remain; visited',s.floor.visited.length);const r=s.floor.rooms.find(r=>r.name===s.roomName),tile=f.tiles.find(t=>t.x===Math.round(s.player.x/TILE)&&t.z===Math.round(s.player.z/TILE));const name=tile?.wood?'bridge':r?.shape;if(name&&!captured.has(name)){captured.add(name);await page.screenshot({path:`output/variety/${name}.png`});}});
const result=await page.evaluate(async ({tiles,total})=>{
 const cells=new Set(tiles.map(t=>`${t.x},${t.z}`));const key=(x,z)=>`${x},${z}`;const tile=1.48;
 const state=()=>JSON.parse(window.render_game_to_text());let held=[];const snapshots=[];
 function input(next){for(const k of held)if(!next.includes(k))window.dispatchEvent(new KeyboardEvent('keyup',{code:k}));for(const k of next)if(!held.includes(k))window.dispatchEvent(new KeyboardEvent('keydown',{code:k}));held=next;}
 let lastRemaining=total;
 for(let i=0;i<14000;i++){
  const s=state();if(s.mode!=='playing'){input([]);return {s,i,snapshots};}
  const px=Math.round(s.player.x/tile),pz=Math.round(s.player.z/tile);
  const queue=[[px,pz]],previous=new Map([[key(px,pz),null]]);for(let j=0;j<queue.length;j++){const [x,z]=queue[j];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const k=key(x+dx,z+dz);if(cells.has(k)&&!previous.has(k)){previous.set(k,[x,z]);queue.push([x+dx,z+dz]);}}}
  const nearby=s.enemies.filter(e=>Math.hypot(e.x-s.player.x,e.z-s.player.z)<2.8);
  let target;
  if(nearby.length)target=nearby.sort((a,b)=>Math.hypot(a.x-s.player.x,a.z-s.player.z)-Math.hypot(b.x-s.player.x,b.z-s.player.z))[0];
  else {
   const targets=new Set(s.enemies.map(e=>key(Math.round(e.x/tile),Math.round(e.z/tile))));let dest=queue.find(([x,z])=>targets.has(key(x,z)));
   if(!dest)throw Error('unreachable guard');
   let parent=previous.get(key(...dest));while(parent&&(parent[0]!==px||parent[1]!==pz)){dest=parent;parent=previous.get(key(...dest));}
   target={x:dest[0]*tile,z:dest[1]*tile};
  }
  const dx=target.x-s.player.x,dz=target.z-s.player.z,dist=Math.hypot(dx,dz);const sx=(dx*11.5-dz*9.2)/Math.hypot(11.5,9.2),sy=(dx*9.2+dz*11.5)/Math.hypot(11.5,9.2);const dot=(dx*s.player.facing.x+dz*s.player.facing.z)/dist;
  const next=nearby.length?['Space']:[];
  if(!nearby.length||dist>1.25||dot<.8){if(Math.abs(sx)>dist*.38)next.push(sx>0?'ArrowRight':'ArrowLeft');if(Math.abs(sy)>dist*.38)next.push(sy>0?'ArrowDown':'ArrowUp');}
  input(next);window.advanceTime(100,i%100===0);
  if(i%100===0||s.remaining!==lastRemaining){snapshots.push(s);lastRemaining=s.remaining;}
  if(i%100===0){await window.reportProgress(state());document.querySelector('canvas').getContext('webgl2').finish();await new Promise(r=>setTimeout(r,0));}
 }
 input([]);return {s:state(),snapshots};
},{tiles:f.tiles,total:f.guardCount});
await page.evaluate(()=>window.advanceTime(0));fs.writeFileSync('output/variety/run.json',JSON.stringify(result,null,2));await page.screenshot({path:'output/variety/result.png'});assert.equal(result.s.mode,'won');assert.equal(result.s.experience.total,f.guardCount*25);assert.equal(result.s.floor.visited.length,f.rooms.length);
const seed=result.s.floor.seed;await page.getByRole('button',{name:'NEW FLOOR'}).click();await page.waitForFunction(seed=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).floor.seed!==seed,seed);await page.evaluate(()=>window.advanceTime(0));assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).experience.total,0);
assert.deepEqual(errors,[]);console.log(JSON.stringify({run:result.s.mode,health:result.s.health,steps:result.i,rooms:f.rooms.length,tiles:f.tiles.length,errors}));await browser.close();
