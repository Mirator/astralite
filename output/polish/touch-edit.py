from pathlib import Path
p=Path('output/polish/loss-controls.mjs');s=p.read_text();a=s.index('let before=await page.evaluate');b=s.index("await page.getByRole('button',{name:'Pause game'}).click();",a)
s=s[:a]+'''const read=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const touch=await page.context().newCDPSession(page);const right=await page.getByRole('button',{name:'Move right',exact:true}).boundingBox(),strike=await page.getByRole('button',{name:'STRIKE',exact:true}).boundingBox();
const rp={x:right.x+right.width/2,y:right.y+right.height/2,id:1},sp={x:strike.x+strike.width/2,y:strike.y+strike.height/2,id:2};
const before=await read();await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rp]});await page.evaluate(()=>window.advanceTime(120));assert((await read()).player.x>before.player.x);
await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rp,sp]});await page.evaluate(()=>window.advanceTime(500));assert((await read()).player.attackTime>0,'touch repeats while held');
await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.evaluate(()=>window.advanceTime(500));assert.equal((await read()).player.attackTime,0);assert.equal((await read()).player.velocity.x,0);
await page.getByRole('button',{name:'DASH',exact:true}).click();await page.evaluate(()=>window.advanceTime(100));assert((await read()).player.dashCooldown>0);await page.screenshot({path:'output/polish/mobile.png'});
''' +s[b:];p.write_text(s)
