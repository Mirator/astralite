from pathlib import Path
s=Path('output/variety/verify.mjs').read_text()
s=s.replace("const result=await page.evaluate(async ({tiles,total})", "const result=await page.evaluate(async ({tiles,total,goal})")
s=s.replace('const s=state();if(s.mode',"const s=state();if(Math.hypot(s.player.x-goal.x,s.player.z-goal.z)<.8){input([]);window.advanceTime(0);return {s,i,snapshots};}if(s.mode")
s=s.replace("const targets=new Set(s.enemies.map(e=>key(Math.round(e.x/tile),Math.round(e.z/tile))));", "const targets=new Set([key(Math.round(goal.x/tile),Math.round(goal.z/tile))]);")
s=s.replace("const captured=new Set();", "const fall=initial.floor.waterfalls[0];assert(fall);const target=f.tiles.reduce((a,b)=>Math.hypot(a.x*TILE-fall.x,a.z*TILE-fall.z)<Math.hypot(b.x*TILE-fall.x,b.z*TILE-fall.z)?a:b);\nconst captured=new Set();")
s=s.replace('{tiles:f.tiles,total:f.guardCount});','{tiles:f.tiles,total:f.guardCount,goal:{x:target.x*TILE,z:target.z*TILE}});')
s=s.replace('i<14000','i<5000')
a=s.index("await page.evaluate(()=>window.advanceTime(0));fs.writeFileSync")
s=s[:a]+"await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path:'output/variety/waterfall.png'});assert.equal(result.s.mode,'playing');assert(Math.hypot(result.s.player.x-target.x*TILE,result.s.player.z-target.z*TILE)<.8);assert.deepEqual(errors,[]);console.log('Waterfall approach passed',result.i);await browser.close();\n"
Path('output/variety/waterfall.mjs').write_text(s)
