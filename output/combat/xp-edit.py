from pathlib import Path
p=Path('game/app/dungeon-game.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace("const clamp =", "const ARENA_X = 9.65, ARENA_Z = 7;\nconst XP_PER_ENEMY = 25, ENCOUNTER_XP = 5 * XP_PER_ENEMY;\nconst clamp =")
s=s.replace("  const [health, setHealth]", "  const [experience, setExperience] = useState(0);\n  const [xpReward, setXpReward] = useState(0);\n  const [health, setHealth]")
s=s.replace("    const swingHits =", "    let totalXp = 0, rewardTime = 0;\n    const swingHits =")
s=s.replace('x = -5; x <= 5;', 'x = -7; x <= 7;').replace('z = -3; z <= 3;', 'z = -5; z <= 5;')
s=s.replace("(Math.abs(x) === 5 && Math.abs(z) === 3) || (x === -5 && z === 2)", "Math.abs(x) === 7 && Math.abs(z) === 5")
s=s.replace('new THREE.PlaneGeometry(34, 24, 12, 8)', 'new THREE.PlaneGeometry(44, 34, 12, 8)')
s=s.replace('addWall(-7.65, -1.6, 0.8, 6.7, 3.1); addWall(7.65, 1.8, 0.8, 6.2, 3.5); addWall(3.7, 5.0, 5.5, 0.8, 3.1); addWall(-4.7, -5.0, 4.2, 0.8, 2.4);', 'addWall(-10.65, -2.6, 0.8, 10.7, 3.1); addWall(10.65, 2.8, 0.8, 10.2, 3.5); addWall(5.2, 8.0, 8.5, 0.8, 3.1); addWall(-6.2, -8.0, 7.2, 0.8, 2.4);')
s=s.replace('[[-6.7, -3.6], [6.6, 3.7], [4.9, -4.2]]', '[[-9.7, -6.6], [9.6, 6.7], [7.9, -7.2]]')
s=s.replace('-6.65, 6.65', '-ARENA_X, ARENA_X').replace('-4, 4)', '-ARENA_Z, ARENA_Z)')
s=s.replace("enemy.dead = true; kills++; burst", "enemy.dead = true; kills++; totalXp += XP_PER_ENEMY; setExperience(totalXp); setXpReward((reward) => reward + XP_PER_ENEMY); rewardTime = 1.4; burst")
s=s.replace('      particles.forEach((p) =>', '      if (rewardTime > 0) { rewardTime = Math.max(0, rewardTime - frameDt); if (rewardTime === 0) setXpReward(0); }\n      particles.forEach((p) =>')
s=s.replace('      health: hp, remaining: 5 - kills,', '      health: hp, remaining: 5 - kills,\n      experience: { total: totalXp, perEnemy: XP_PER_ENEMY, encounterTarget: ENCOUNTER_XP, resetsOnNewRun: true },\n      arena: { minX: -ARENA_X, maxX: ARENA_X, minZ: -ARENA_Z, maxZ: ARENA_Z },')
s=s.replace('<div className="enemy-count"><span>☠</span>{enemies} REMAIN</div></section>', '''<div className="enemy-count"><span>☠</span>{enemies} REMAIN</div>
        <div className="xp-panel"><div className="xp-row"><span>TOTAL XP</span><b>{experience}</b></div>
          <div className="xp-track" role="progressbar" aria-label="Encounter experience" aria-valuemin={0} aria-valuemax={ENCOUNTER_XP} aria-valuenow={experience}><i style={{ width: `${experience / ENCOUNTER_XP * 100}%` }} /></div>
          <div className="xp-caption"><span>{experience} / {ENCOUNTER_XP} this run</span><strong>{xpReward > 0 ? `+${xpReward} XP` : '25 XP / guard'}</strong></div>
        </div></section>''')
s=s.replace('<button onClick={() => location.reload()}>TRY AGAIN</button>', '<div className="xp-summary"><strong>{experience} XP earned</strong><span>{5 - enemies} / 5 guards defeated · XP resets on a new run</span></div><button onClick={() => location.reload()}>TRY AGAIN</button>')
p.write_text(s,encoding='utf-8')
