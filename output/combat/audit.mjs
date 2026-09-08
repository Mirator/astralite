import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='output/combat/audit';fs.mkdirSync(dir,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const p=await b.newPage({viewport:{width:1000,height:700}});
await p.goto('http://localhost:3000');await p.waitForFunction(()=>!!window.render_game_to_text);await p.evaluate(()=>window.advanceTime(0));
await p.keyboard.down('Space');await p.keyboard.up('Space');await p.evaluate(()=>window.advanceTime(280));
await p.keyboard.down('ArrowLeft');await p.keyboard.down('Space');await p.keyboard.up('Space');await p.keyboard.up('ArrowLeft');await p.evaluate(()=>window.advanceTime(175));
let state=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));console.log('Queued left-facing attack',state.player);assert(state.player.facing.x<0 && state.player.facing.z>0,'queued strike remembers tapped left');
await p.evaluate(()=>window.advanceTime(4500));state=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));
let min=100;for(let i=0;i<state.enemies.length;i++)for(let j=i+1;j<state.enemies.length;j++)min=Math.min(min,Math.hypot(state.enemies[i].x-state.enemies[j].x,state.enemies[i].z-state.enemies[j].z));
console.log('Closest enemy centres',min);assert(min>.65,'enemy silhouettes remain separated');await p.screenshot({path:`${dir}/crowd.png`});fs.writeFileSync(`${dir}/state.json`,JSON.stringify(state,null,2));await b.close();


