from pathlib import Path
s=Path('output/polish/verify-final.mjs').read_text()
# Keep the proven input-only navigator; adapt assertions to variable floors.
a=s.index('let minimum=Infinity;');b=s.index('const browser=',a)
s=s[:a]+'let minimum=3203;\n'+s[b:]
s=s.replace('width:640,height:480','width:800,height:600')
s=s.replace("'output/polish/", "'output/variety/")
s=s.replace("const result=await page.evaluate(async ({tiles})", "const result=await page.evaluate(async ({tiles,total})")
s=s.replace('let lastRemaining=22;','let lastRemaining=total;').replace('{tiles:f.tiles});','{tiles:f.tiles,total:f.guardCount});')
s=s.replace("assert.equal(result.s.experience.total,550);assert.equal(result.s.floor.visited.length,12);", "assert.equal(result.s.experience.total,f.guardCount*25);assert.equal(result.s.floor.visited.length,f.rooms.length);")
a=s.index("await page.getByRole('button',{name:'ENTER THE KEEP',exact:false}).click();await page.evaluate(()=>window.advanceTime(0));await page.setViewportSize")
s=s[:a]+"assert.deepEqual(errors,[]);console.log(JSON.stringify({run:result.s.mode,health:result.s.health,steps:result.i,rooms:f.rooms.length,tiles:f.tiles.length,errors}));await browser.close();\n"
Path('output/variety/verify.mjs').write_text(s)
