import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import { generateFloor, canStand, moveOnFloor, TILE, cellKey } from '../../game/app/dungeon-floor.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
let minimum=Infinity;
for(let seed=0;seed<500;seed++) {
 const f=generateFloor(seed);minimum=Math.min(minimum,f.tiles.length);assert(f.tiles.length>=1610);assert.equal(f.cells.size,f.tiles.length);
 const seen=new Set(),queue=[f.tiles[0]];seen.add(cellKey(queue[0].x,queue[0].z));for(let i=0;i<queue.length;i++){const c=queue[i];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const k=cellKey(c.x+dx,c.z+dz);if(f.cells.has(k)&&!seen.has(k)){seen.add(k);queue.push({x:c.x+dx,z:c.z+dz});}}}assert.equal(seen.size,f.tiles.length);
 for(const r of f.rooms){assert(canStand(f.cells,r.x*TILE,r.z*TILE));const p={x:r.x*TILE,z:r.z*TILE};moveOnFloor(f.cells,p,400,400);assert(canStand(f.cells,p.x,p.z));}
}
console.log('500 connected seeds; minimum tiles:',minimum);
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const page=await browser.newPage({viewport:{width:850,height:600}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://localhost:3000');await page.waitForFunction(()=>!!window.render_game_to_text,{timeout:60000});
await page.evaluate(()=>window.advanceTime(0));
const initial=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));const f=generateFloor(initial.floor.seed);
await page.screenshot({path:'output/floor/start.png'});
// Drive the entire run with keyboard events; no teleports or game-state changes.
const result=await page.evaluate(async ({tiles})=>{
 const cells=new Set(tiles.map(t=>`${t.x},${t.z}`));const key=(x,z)=>`${x},${z}`;const tile=1.48;
 const state=()=>JSON.parse(window.render_game_to_text());let held=[];const snapshots=[];
 function input(next){for(const k of held)if(!next.includes(k))window.dispatchEvent(new KeyboardEvent('keyup',{code:k}));for(const k of next)if(!held.includes(k))window.dispatchEvent(new KeyboardEvent('keydown',{code:k}));held=next;}
 let lastRemaining=22;
 for(let i=0;i<600;i++){
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
  const next=[];
  if(!nearby.length||dist>1.25||dot<.8){if(Math.abs(sx)>dist*.38)next.push(sx>0?'ArrowRight':'ArrowLeft');if(Math.abs(sy)>dist*.38)next.push(sy>0?'ArrowDown':'ArrowUp');}
  input(next);window.advanceTime(100);
  if(i%100===0||s.remaining!==lastRemaining){snapshots.push(s);lastRemaining=s.remaining;}
  if(i%100===0)await new Promise(r=>setTimeout(r,0));
 }
 input([]);return {s:state(),snapshots};
},{tiles:f.tiles});
fs.writeFileSync('output/floor/loss.json',JSON.stringify(result,null,2));await page.screenshot({path:'output/floor/loss.png'});assert.equal(result.s.mode,'lost');assert.equal(result.s.experience.total,0);
const seed=result.s.floor.seed;await page.getByRole('button',{name:'NEW FLOOR'}).click();await page.waitForFunction(seed=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).floor.seed!==seed,seed);await page.evaluate(()=>window.advanceTime(0));assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).experience.total,0);
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path:'output/floor/mobile.png'});const read=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
let before=await read();await page.getByRole('button',{name:'Move right',exact:true}).dispatchEvent('pointerdown',{pointerId:1});await page.evaluate(()=>window.advanceTime(120));await page.getByRole('button',{name:'Move right',exact:true}).dispatchEvent('pointerup',{pointerId:1});let after=await read();assert(after.player.x>before.player.x);
before=after;await page.getByRole('button',{name:'DASH',exact:true}).dispatchEvent('pointerdown');await page.evaluate(()=>window.advanceTime(100));after=await read();assert(Math.hypot(after.player.x-before.player.x,after.player.z-before.player.z)>.8);
await page.keyboard.down('ArrowLeft');await page.evaluate(()=>window.advanceTime(18000));await page.keyboard.up('ArrowLeft');after=await read();const current=generateFloor(after.floor.seed);assert(canStand(current.cells,after.player.x,after.player.z));assert.equal(after.experience.total,0);
assert.deepEqual(errors,[]);console.log(JSON.stringify({minimumTiles:minimum,seeds:500,run:result.s.mode,health:result.s.health,steps:result.i,errors}));await browser.close();
