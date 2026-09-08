from pathlib import Path
p=Path('game/app/dungeon-game.tsx');s=p.read_text(encoding='utf-8-sig').replace('enemy.hp--; enemy.hitFlash = 0.2; enemy.windup = 0;', "enemy.hp--; enemy.hitFlash = 0.2; if (enemy.kind !== 'warden') enemy.windup = 0;")
s=s.replace('delta.x * 0.38, delta.z * 0.38','delta.x * (enemy.kind === \'warden\' ? 0.1 : 0.38), delta.z * (enemy.kind === \'warden\' ? 0.1 : 0.38)')
p.write_text(s.rstrip()+'\n',encoding='utf-8')
