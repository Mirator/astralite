from pathlib import Path
p=Path('game/app/dungeon-game.tsx');s=p.read_text(encoding='utf-8').replace('advanceTime?: (ms: number) => void','advanceTime?: (ms: number, draw?: boolean) => void').replace('hooks.advanceTime = (ms) => {','hooks.advanceTime = (ms, draw = true) => {').replace('      renderer.render(scene, camera);\n    };','      if (draw) renderer.render(scene, camera);\n    };');p.write_text(s,encoding='utf-8')
p=Path('output/variety/verify.mjs');s=p.read_text().replace('input(next);window.advanceTime(100);','input(next);window.advanceTime(100,i%100===0);').replace('if(i%20===0)','if(i%100===0)');s=s.replace("fs.writeFileSync('output/variety/run.json'", "await page.evaluate(()=>window.advanceTime(0));fs.writeFileSync('output/variety/run.json'")
s=s.replace('let lastRemaining=total;','let lastRemaining=total;')
s=s.replace("const result=await page.evaluate", "await page.exposeFunction('reportProgress',s=>console.log('Replay:',s.remaining,'guards remain; visited',s.floor.visited.length));\nconst result=await page.evaluate")
s=s.replace("if(i%100===0){document.querySelector", "if(i%100===0){await window.reportProgress(state());document.querySelector")
p.write_text(s)
