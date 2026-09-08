from pathlib import Path
p=Path('game/app/dungeon-game.tsx');s=p.read_text(encoding='utf-8')
s=s.replace("import * as THREE from 'three';", "import * as THREE from 'three';\nimport { addAtmosphere, stoneTexture, ROOM_NAMES } from './dungeon-atmosphere';\nimport { createDungeonAudio } from './dungeon-audio';")
s=s.replace('room: number };', "room: number; kind: 'guard' | 'stalker' | 'warden'; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh };")
s=s.replace('const [showHelp, setShowHelp] = useState(true);', '''const [showHelp, setShowHelp] = useState(true);
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [muted, setMuted] = useState(false);
  const [roomName, setRoomName] = useState(ROOM_NAMES[0]), [clearedCount, setClearedCount] = useState(0);
  const [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  const dashMeter = useRef<HTMLProgressElement>(null);''')
s=s.replace('let totalXp = 0, rewardTime = 0;', '''let totalXp = 0, rewardTime = 0, noticeTime = 0, footstepTime = 0;
    let hasStarted = false, isPaused = false, isMuted = false, activeRoom = 0;
    const audio = createDungeonAudio();''')
s=s.replace('scene.fog = new THREE.FogExp2(0x07121a, 0.035);','scene.fog = new THREE.FogExp2(0x07121a, 0.018);')
s=s.replace('const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff,','const texture = stoneTexture();\n    const floorMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff,')
s=s.replace('0x3b4448, 0x465052, 0x303a3f','0x788784, 0x677c7c, 0x536767')
a=s.index('    floor.rooms.forEach(r => {',s.index('const torchLights:'));b=s.index('    const player = makeKnight()',a)
s=s[:a]+'''    const atmosphere = addAtmosphere(world, floor);
    for (let i = 0; i < 4; i++) { const light = new THREE.PointLight(0xff9b46,16,18,1.6); torchLights.push(light); scene.add(light); }
''' + s[b:]
s=s.replace('    const velocity = new THREE.Vector3()', '''    const fill = new THREE.PointLight(0x9bcdd1, 9, 12, 1.8); scene.add(fill);
    const playerRing = new THREE.Mesh(new THREE.RingGeometry(0.5,0.55,40),new THREE.MeshBasicMaterial({color:0xa1d8ce,transparent:true,opacity:0.45,depthWrite:false}));playerRing.rotation.x=-Math.PI/2;world.add(playerRing);
    const cameraFocus = player.position.clone();
    const velocity = new THREE.Vector3()''')
a=s.index('      const group = makeSkeleton(index);');b=s.index('    let pathCell',a)
s=s[:a]+'''      const kind: Enemy['kind'] = index === 0 && room.id % 3 === 0 ? 'warden' : index === 1 && room.id % 2 === 0 ? 'stalker' : 'guard';
      const maxHp = kind === 'warden' ? 4 : 2, tell = kind === 'warden' ? 0.72 : kind === 'stalker' ? 0.36 : 0.5;
      const group = makeSkeleton(kind === 'stalker' ? 1 : 0); group.position.set(room.x * TILE + side * 2.3,0.03,room.z * TILE); world.add(group);
      if (kind === 'warden') { group.scale.setScalar(1.3); const crown = new THREE.Mesh(new THREE.ConeGeometry(0.34,0.35,5,1,true),new THREE.MeshStandardMaterial({color:0xc5a264,metalness:0.6,roughness:0.45}));crown.position.y=1.7;group.add(crown); }
      if (kind === 'stalker') group.scale.set(0.82,0.94,0.82);
      const cue = new THREE.Mesh(new THREE.RingGeometry(0.85,1.5,40,1,-1.05,2.1),new THREE.MeshBasicMaterial({color:kind === 'warden'?0xff522b:0xffae52,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));cue.rotation.x=-Math.PI/2;world.add(cue);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.07),new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false}));bar.renderOrder=10;world.add(bar);
      return { group, hp:maxHp, maxHp, kind, tell, damage:kind==='warden'?20:kind==='stalker'?8:12, cue, bar, speed:kind==='stalker'?2.0:kind==='warden'?1.15:1.5, cooldown:0.4+index*0.2, hitFlash:0, dead:false, phase:room.id*1.7, windup:0, aim:new THREE.Vector3(), room:room.id };
    }));
''' + s[b:]
s=s.replace("if (gameStatus !== 'playing'", "if (!hasStarted || isPaused || gameStatus !== 'playing'")
s=s.replace('attackTime = 0.38; attackBuffer = 0;', "audio.play('slash');\n      attackTime = 0.38; attackBuffer = 0;")
s=s.replace('facing.copy(dashFacing); dashTime', "audio.play('dash');\n      facing.copy(dashFacing); dashTime")
s=s.replace('    const keyDown = (e: KeyboardEvent) => {', '''    const togglePause = () => {
      if (!hasStarted || gameStatus !== 'playing') return;
      isPaused = !isPaused; keys.clear(); attackBuffer = 0; bufferedFacing = null; setPaused(isPaused); audio.pause(isPaused);
    };
    const toggleMute = () => { isMuted = !isMuted; audio.mute(isMuted); setMuted(isMuted); };
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void mount.parentElement?.requestFullscreen?.().catch(() => undefined); };
    const keyDown = (e: KeyboardEvent) => {''')
s=s.replace("      keys.add(e.code); if (e.repeat) return;", "      if (!e.repeat && e.code === 'Escape') { togglePause(); return; }\n      if (!e.repeat && e.code === 'KeyM') { toggleMute(); return; }\n      if (!e.repeat && e.code === 'KeyF') { fullscreen(); return; }\n      if (!hasStarted || isPaused) return;\n      keys.add(e.code); if (e.repeat) return;")
s=s.replace("      if (detail === 'attack') requestAttack();", """      if (detail === 'start') { hasStarted = true; setStarted(true); audio.start(); return; }
      if (detail === 'pause') { togglePause(); return; }
      if (detail === 'mute') { toggleMute(); return; }
      if (detail === 'fullscreen') { fullscreen(); return; }
      if (!hasStarted || isPaused) return;
      if (detail === 'attack') requestAttack();
      if (detail === 'hold-attack') { keys.add('Space'); requestAttack(); }
      if (detail === 'release-attack') keys.delete('Space');""")
s=s.replace("    window.addEventListener('blur', clearInput);", "    const blur = () => { clearInput(); if (hasStarted && !isPaused && gameStatus === 'playing') togglePause(); };\n    const visibility = () => { if (document.hidden) blur(); };\n    document.addEventListener('visibilitychange', visibility);\n    window.addEventListener('blur', blur);")
s=s.replace('      elapsed += frameDt;', '      if (isPaused) return;\n      elapsed += frameDt;')
s=s.replace("      if (gameStatus === 'playing') {", "      if (hasStarted && gameStatus === 'playing') {")
s=s.replace("torchLights.forEach((l, i) => { l.intensity = 8.5", "torchLights.forEach((l, i) => { l.intensity = 16")
s=s.replace(' : 3.4;', ' : 4.6;')
s=s.replace('        if (moving) { walkPhase', "        if (moving) { footstepTime -= dt; if (footstepTime <= 0 && dashTime <= 0) { audio.play('step'); footstepTime = 0.29; } walkPhase")
s=s.replace('        floor.rooms.forEach(r => { if', "        const currentRoom = floor.rooms.find(r => Math.abs(player.position.x / TILE-r.x)<=r.halfX && Math.abs(player.position.z / TILE-r.z)<=r.halfZ);\n        if (currentRoom && activeRoom !== currentRoom.id) { activeRoom = currentRoom.id; setRoomName(ROOM_NAMES[activeRoom]); }\n        floor.rooms.forEach(r => { if")
s=s.replace('swingHits.add(enemy); enemy.hp--;', "audio.play('hit');\n              swingHits.add(enemy); enemy.hp--;")
s=s.replace('cleared.add(enemy.room); hp =', "cleared.add(enemy.room); setClearedCount(cleared.size - 1); setNotice(`${ROOM_NAMES[enemy.room]} · cleansed`); noticeTime = 3.5; audio.play('clear'); burst(player.position,0x8de9be,18); hp =")
s=s.replace("gameStatus = 'won'; setStatus('won');", "gameStatus = 'won'; setStatus('won'); audio.play('win');")
s=s.replace("          if (enemy.dead) {", "          enemy.cue.visible = !enemy.dead && enemy.windup > 0; enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;\n          enemy.bar.position.copy(enemy.group.position).add(new THREE.Vector3(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); enemy.bar.scale.x = enemy.hp / enemy.maxHp;\n          enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);\n          (enemy.cue.material as THREE.MeshBasicMaterial).opacity = 0.2 + (1 - enemy.windup / enemy.tell) * 0.5;\n          if (enemy.dead) {")
s=s.replace('enemy.windup / 0.42','enemy.windup / enemy.tell').replace('enemy.windup = 0.42;', "enemy.windup = enemy.tell; audio.play('warn');")
s=s.replace('hp - 12','hp - enemy.damage').replace('hurtFlash = 0.35; shake', "audio.play('hurt'); hurtFlash = 0.35; shake")
s=s.replace('      if (rewardTime > 0)', "      if (noticeTime > 0) { noticeTime = Math.max(0,noticeTime-frameDt); if (noticeTime === 0) setNotice(''); }\n      if (rewardTime > 0)")
a=s.index('      const nearest = [...floor.rooms]');b=s.index('      renderer.domElement.style.filter',a)
s=s[:a]+'''      atmosphere.update(t,player.position,cleared);
      const nearest = [...atmosphere.torchPositions].sort((a,b)=>a.distanceToSquared(player.position)-b.distanceToSquared(player.position));
      torchLights.forEach((light,i)=>light.position.copy(nearest[i]));
      fill.position.copy(player.position).add(new THREE.Vector3(0,4,1));
      playerRing.position.set(player.position.x,0.04,player.position.z); (playerRing.material as THREE.MeshBasicMaterial).opacity = dashTime > 0 ? 0.85 : 0.32;
      moon.position.set(player.position.x - 7,12,player.position.z + 9); moon.target.position.set(player.position.x,0,player.position.z); moon.target.updateMatrixWorld();
      mapPlayer.current?.setAttribute('cx', String(player.position.x / TILE)); mapPlayer.current?.setAttribute('cy', String(player.position.z / TILE));
      if (dashMeter.current) dashMeter.current.value = Math.max(0,1-dashCooldown/1.35);
      const target = player.position.clone().addScaledVector(velocity,0.12); cameraFocus.lerp(target,1-Math.exp(-8*frameDt));
      camera.position.set(cameraFocus.x + 9.2,12.5,cameraFocus.z + 11.5);
      if (shake > 0) camera.position.add(new THREE.Vector3(Math.sin(t*95)*shake,0,Math.cos(t*83)*shake));
      camera.lookAt(cameraFocus.x,0,cameraFocus.z);
''' + s[b:]
s=s.replace('mode: gameStatus,', "mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, muted: isMuted, roomName: ROOM_NAMES[activeRoom],")
s=s.replace('hp: e.hp, windup: e.windup','hp: e.hp, kind: e.kind, windup: e.windup')
s=s.replace('span = h < 650 ? 5.4 : 5','span = w < 600 ? 6.3 : 7.2')
s=s.replace('resize();\n    return', "resize(); setReady(true);\n    return")
s=s.replace("window.removeEventListener('blur', clearInput);", "window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); audio.dispose(); atmosphere.dispose(); texture.dispose();")
s=s.replace('Lower cistern · 12 chambers','{roomName}')
s=s.replace('      <section className="hud"', '''      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || status !== 'playing'} aria-label="Pause game">Ⅱ</button><button onClick={() => action('mute')} aria-label={muted ? 'Enable sound' : 'Mute sound'}>{muted ? 'SOUND OFF' : 'SOUND ON'}</button><button onClick={() => action('fullscreen')} aria-label="Toggle fullscreen">⛶</button></nav>
      <section className="hud"''')
s=s.replace('<div className="enemy-count"><span>☠</span>{enemies} REMAIN</div>','<div className="enemy-count"><span>☠</span>{enemies} GUARDS REMAIN</div><div className="dash-status"><span>EVASION</span><progress ref={dashMeter} max="1" value="1" aria-label="Dash readiness" /></div>')
s=s.replace('      <aside className="controls">', '''      <div className="floor-objective"><span>BREAK THE CISTERN’S WATCH</span><b>{clearedCount} <i>/ 11 chambers cleansed</i></b></div>
      {notice && started && !paused && <div className="chamber-notice" role="status"><span>✦</span><b>{notice}</b><small>+20 vitality restored</small></div>}
      <aside className="controls">''')
s=s.replace('<kbd>SHIFT</kbd> DASH</span></aside>', '<kbd>SHIFT</kbd> DASH</span><span><kbd>ESC</kbd> PAUSE</span></aside>')
s=s.replace("{showHelp && status === 'playing'", "{showHelp && started && !paused && status === 'playing'")
s=s.replace('      {status !==', '''      {(!started || paused) && <div className="intro-screen"><section className="intro-card"><span className="end-kicker">{paused ? 'A MOMENT OF STILLNESS' : 'CHAPTER I · THE LOWER CISTERN'}</span><h1>{paused ? 'The keep can wait.' : <>The Drowned<br /><em>Keep</em></>}</h1><p>{paused ? 'Gather yourself. Your journey is held here.' : 'Beneath the tide, the old watch still stands. Cross the drowned halls and put its restless guardians to rest.'}</p><div className="intro-controls"><span><kbd>WASD / ↑↓←→</kbd> Move</span><span><kbd>SPACE</kbd> Hold to strike</span><span><kbd>SHIFT</kbd> Dodge attacks</span></div><button className="primary-action" disabled={!ready} onClick={() => action(paused ? 'pause' : 'start')}>{!ready ? 'ENTERING THE KEEP…' : paused ? 'RESUME JOURNEY' : 'ENTER THE KEEP'} <span>→</span></button><small>12 chambers · a new floor every journey<br />Cleanse a chamber to recover vitality.</small></section></div>}
      {status !==''')
s=s.replace("'The gate stirs.'", "'The watch is broken.'").replace("'For now, the drowned keep is silent.'", "'The cistern falls quiet. Beyond the tide, dawn waits.'")
s=s.replace('<button className="strike" onPointerDown={() => action(\'attack\')}>STRIKE</button>', '''<button className="strike" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-attack'); }} onPointerUp={() => action('release-attack')} onPointerCancel={() => action('release-attack')} onLostPointerCapture={() => action('release-attack')}>STRIKE</button>''')
p.write_text(s,encoding='utf-8')
