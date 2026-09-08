from pathlib import Path
s=Path('output/polish/verify.mjs').read_text()
s=s.replace('width:960,height:700','width:640,height:480')
s=s.replace("if(i%100===0)await new Promise(r=>setTimeout(r,0));", "if(i%20===0){document.querySelector('canvas').getContext('webgl2').finish();await new Promise(r=>setTimeout(r,0));}")
s=s.replace("await page.getByRole('button',{name:'ENTER THE KEEP',exact:false}).click();await page.evaluate(()=>window.advanceTime(0));", "await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path:'output/polish/intro.png'});await page.getByRole('button',{name:'ENTER THE KEEP',exact:false}).click();await page.evaluate(()=>window.advanceTime(0));",1)
s=s.replace("const seed=result.s.floor.seed;", "const seed=result.s.floor.seed;")
s=s.replace("await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.advanceTime(0));await page.screenshot({path:'output/polish/mobile.png'});", """await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.advanceTime(0));
let before=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
await page.getByRole('button',{name:'Move right',exact:true}).dispatchEvent('pointerdown',{pointerId:1});await page.evaluate(()=>window.advanceTime(120));await page.getByRole('button',{name:'Move right',exact:true}).dispatchEvent('pointerup',{pointerId:1});let after=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(after.player.x>before.player.x);
await page.getByRole('button',{name:'STRIKE',exact:true}).dispatchEvent('pointerdown',{pointerId:2});await page.evaluate(()=>window.advanceTime(500));after=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(after.player.attackTime>0,'touch repeats while held');await page.getByRole('button',{name:'STRIKE',exact:true}).dispatchEvent('pointerup',{pointerId:2});await page.evaluate(()=>window.advanceTime(500));assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).player.attackTime,0);
await page.getByRole('button',{name:'DASH',exact:true}).dispatchEvent('pointerdown');await page.evaluate(()=>window.advanceTime(100));after=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(after.player.dashCooldown>0);await page.screenshot({path:'output/polish/mobile.png'});
await page.getByRole('button',{name:'Pause game'}).click();await page.screenshot({path:'output/polish/pause.png'});assert.equal((await page.evaluate(()=>JSON.parse(window.render_game_to_text()))).mode,'paused');await page.getByRole('button',{name:'RESUME JOURNEY',exact:false}).click();
await page.getByRole('button',{name:'Toggle fullscreen'}).click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.getByRole('button',{name:'Toggle fullscreen'}).click();await page.waitForFunction(()=>!document.fullscreenElement);
""")
Path('output/polish/verify-final.mjs').write_text(s)
