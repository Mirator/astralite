from pathlib import Path
p=Path('game/app/dungeon-game.tsx');s=p.read_text(encoding='utf-8');s='\n'.join(l for l in s.splitlines() if 'const stoneMats =' not in l);p.write_text(s.rstrip()+'\n',encoding='utf-8')
