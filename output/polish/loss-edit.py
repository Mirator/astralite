from pathlib import Path
s=Path('output/polish/verify-final.mjs').read_text().replace('width:640,height:480','width:1100,height:760')
s=s.replace('i<14000','i<700').replace("const next=nearby.length?['Space']:[];",'const next=[];')
s=s.replace('let lastRemaining=22;','let lastRemaining=22, captured=false;')
s=s.replace("const result=await page.evaluate", "await page.exposeFunction('captureCombat',async()=>page.screenshot({path:'output/polish/combat.png'}));\nconst result=await page.evaluate")
s=s.replace("const s=state();if(s.mode", "const s=state();if(!captured&&s.enemies.some(e=>e.windup>0)){captured=true;document.querySelector('canvas').getContext('webgl2').finish();await window.captureCombat();}if(s.mode")
s=s.replace("assert.equal(result.s.mode,'won');assert.equal(result.s.experience.total,550);assert.equal(result.s.floor.visited.length,12);", "assert.equal(result.s.mode,'lost');assert.equal(result.s.experience.total,0);assert.equal(result.s.health,0);")
s=s.replace("output/polish/run.json", "output/polish/loss.json").replace("output/polish/result.png", "output/polish/loss.png")
Path('output/polish/loss-controls.mjs').write_text(s)
