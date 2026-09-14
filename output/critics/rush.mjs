import {chromium} from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import {generateFloor} from '../../game/app/dungeon-floor.ts';
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const p=await b.newPage({viewport:{width:800,height:600}});await p.goto('http://localhost:3000');await p.waitForFunction(()=>!!window.render_game_to_text);await p.evaluate(()=>window.advanceTime(0));await p.locator('.primary-action').click();const state=await p.evaluate(()=>JSON.parse(window.render_game_to_text())),f=generateFloor(state.floor.seed);
const result=await p.evaluate(({tiles,goal})=>{
const cells=new Set(tiles.map(t=>`${t.x},${t.z}`));const key=(x,z)=>`${x},${z}`,target=key(goal.x,goal.z),queue=[[goal.x,goal.z]],dist=new Map([[target,0]]);
for(let i=0;i<queue.length;i++){const [x,z]=queue[i];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const k=key(x+dx,z+dz);if(cells.has(k)&&!dist.has(k)){dist.set(k,dist.get(key(x,z))+1);queue.push([x+dx,z+dz]);}}}
let held=[];function input(next){for(const k of held)if(!next.includes(k))window.dispatchEvent(new KeyboardEvent('keyup',{code:k}));for(const k of next)if(!held.includes(k))window.dispatchEvent(new KeyboardEvent('keydown',{code:k}));held=next;}
for(let i=0;i<7000;i++){
 const s=JSON.parse(window.render_game_to_text());if(s.mode!=='playing'){input([]);return {mode:s.mode,hp:s.health,i};}const px=Math.round(s.player.x/1.48),pz=Math.round(s.player.z/1.48);if(Math.hypot(s.player.x-goal.x*1.48,s.player.z-goal.z*1.48)<1.5){input([]);return {mode:'reached stair without attacking',hp:s.health,seconds:i*.05,visited:s.floor.visited.length};}
 const next=[[px+1,pz],[px-1,pz],[px,pz+1],[px,pz-1]].filter(([x,z])=>cells.has(key(x,z))).sort((a,b)=>(dist.get(key(...a))??1e9)-(dist.get(key(...b))??1e9))[0];if(!next)throw Error('stuck');
 const dx=next[0]*1.48-s.player.x,dz=next[1]*1.48-s.player.z,len=Math.hypot(dx,dz),sx=(dx*11.5-dz*9.2)/14.72,sy=(dx*9.2+dz*11.5)/14.72,keys=[];if(Math.abs(sx)>len*.38)keys.push(sx>0?'ArrowRight':'ArrowLeft');if(Math.abs(sy)>len*.38)keys.push(sy>0?'ArrowDown':'ArrowUp');input(keys);window.advanceTime(50,false);
}input([]);return {mode:'timeout',state:JSON.parse(window.render_game_to_text()).player};
},{tiles:f.tiles,goal:f.rooms[f.goal]});console.log(JSON.stringify(result));await b.close();
