from pathlib import Path
p=Path('output/combat/audit.mjs')
s=p.read_text(encoding='utf-8').replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport assert from 'node:assert/strict';")
s=s.replace("console.log('Queued left-facing attack',state.player.facing);", "console.log('Queued left-facing attack',state.player.facing);assert(state.player.facing.x<0 && state.player.facing.z>0,'queued strike remembers tapped left');")
s=s.replace("console.log('Closest enemy centres',min);", "console.log('Closest enemy centres',min);assert(min>.65,'enemy silhouettes remain separated');")
p.write_text(s,encoding='utf-8')
