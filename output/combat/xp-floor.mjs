import { chromium } from 'file:///C:/Users/Miroslav%20Pavelek/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto('http://localhost:3000');await p.waitForFunction(()=>!!window.render_game_to_text);await p.evaluate(()=>window.advanceTime(0));
await p.screenshot({path:'output/combat/xp-mobile.png'});
await p.keyboard.down('ArrowRight');await p.evaluate(()=>window.advanceTime(7000));await p.keyboard.up('ArrowRight');
const s=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(s.player.x>6.65 && s.player.z < -4,'expanded floor reachable');assert(s.player.x<=s.arena.maxX && s.player.z>=s.arena.minZ,'new bounds stop movement');assert.equal(s.experience.total,0,'no XP for movement');await p.screenshot({path:'output/combat/xp-edge.png'});
await b.close();console.log('Expanded floor, new boundaries, zero unearned XP and mobile HUD verified.');
