from pathlib import Path
s=Path('output/combat/verify.mjs').read_text(encoding='utf-8')
s=s.replace("out='output/combat/verify'", "out='output/combat/xp-verify'")
s=s.replace(" s=await state(); if(s.mode!=='playing')break;", " s=await state(); assert.equal(s.experience.total,(5-s.remaining)*25,'exactly one XP reward per kill'); assert.equal(Number(await page.getByRole('progressbar',{name:'Encounter experience'}).getAttribute('aria-valuenow')),s.experience.total,'HUD matches XP'); if(s.mode!=='playing')break;")
s=s.replace("assert.equal(s.mode,'won','first encounter clears');", "assert.equal(s.mode,'won','first encounter clears'); assert.equal(s.experience.total,125,'all five rewards recorded'); await step(2000); assert.equal((await state()).experience.total,125,'dead enemies never award XP again');")
s=s.replace("assert.equal((await state()).health,100,'restart restores health');", "assert.equal((await state()).health,100,'restart restores health'); assert.equal((await state()).experience.total,0,'new run resets XP');")
s=s.replace("winHealth:s.health,errors", "winHealth:s.health,experience:s.experience,errors")
Path('output/combat/xp-verify.mjs').write_text(s,encoding='utf-8')
