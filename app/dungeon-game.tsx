'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; phase: number };
type GameToolContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: { action?: string }) => { accepted: boolean; action: string };
  }, options: { signal: AbortSignal }) => void | Promise<void>;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function makeKnight() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x17202a, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.48, metalness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0x851f22, roughness: 0.9 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5b3728, roughness: 1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.48, 0.8, 6), dark);
  body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.31, 0), steel);
  head.position.y = 1.36; head.scale.z = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.12), dark);
  visor.position.set(0, 1.38, -0.26);
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.56, 1.18, 5, 1, true, 0.3), red);
  cape.position.set(0, 0.68, 0.31); cape.rotation.x = 0.1;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.055, 5, 8), leather);
  belt.position.y = 0.67; belt.rotation.x = Math.PI / 2;
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.44, 1.0, -0.02);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 1.18), steel);
  blade.position.z = -0.58;
  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.1), leather);
  swordPivot.add(blade, hilt);
  g.add(body, head, visor, cape, belt, swordPivot);
  g.userData.sword = swordPivot;
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function makeSkeleton(index: number) {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9d1bd, roughness: 0.92 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x4c5156, roughness: 0.75, metalness: 0.28 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff421f });
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.22, 0.25), bone); pelvis.position.y = 0.55;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.13), bone); spine.position.y = 0.91;
  const ribs = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 4, 7, Math.PI * 1.55), bone);
  ribs.position.set(0, 1.03, -0.02); ribs.rotation.set(Math.PI / 2, 0, -Math.PI * 0.78);
  const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.27, 0), bone);
  skull.position.y = 1.42; skull.scale.set(0.88, 1, 0.78);
  const sockets = [-1, 1].map((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), eye); e.position.set(s * 0.085, 1.45, -0.21); return e; });
  const limbs = [-1, 1].flatMap((s) => { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.12), bone); arm.position.set(s * 0.35, 0.95, 0); arm.rotation.z = s * 0.17; const leg = arm.clone(); leg.position.set(s * 0.18, 0.25, 0); return [arm, leg]; });
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 8), iron);
  shield.position.set(-0.45, 0.92, -0.12); shield.rotation.set(Math.PI / 2, 0, 0); shield.visible = index % 2 === 0;
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.92), iron);
  weapon.position.set(0.42, 0.84, -0.28); weapon.rotation.x = -0.4;
  g.add(pelvis, spine, ribs, skull, ...sockets, ...limbs, shield, weapon);
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export default function DungeonGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState(100);
  const [enemies, setEnemies] = useState(5);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [showHelp, setShowHelp] = useState(true);

  useEffect(() => {
    const context = (document as Document & { modelContext?: GameToolContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'perform_combat_action',
      title: 'Perform combat action',
      description: 'Trigger one visible player combat action in the current Drowned Keep encounter.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['strike', 'dash'] } },
        required: ['action'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (input.action !== 'strike' && input.action !== 'dash') throw new Error('Action must be strike or dash.');
        window.dispatchEvent(new CustomEvent('dungeon-action', { detail: input.action === 'strike' ? 'attack' : 'dash' }));
        return { accepted: true, action: input.action };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let stopped = false, hp = 100, kills = 0, attackTime = 0, dashTime = 0, dashCooldown = 0, hurtFlash = 0, shake = 0;
    let gameStatus: 'playing' | 'won' | 'lost' = 'playing';
    const keys = new Set<string>();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07121a);
    scene.fog = new THREE.FogExp2(0x07121a, 0.035);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 70);
    camera.position.set(10, 13, 13); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0x7396a0, 0x061015, 1.15));
    const moon = new THREE.DirectionalLight(0x89afc0, 2.1);
    moon.position.set(-7, 12, 9); moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12; moon.shadow.camera.right = moon.shadow.camera.top = 12; scene.add(moon);
    const world = new THREE.Group(); scene.add(world);
    const stoneMats = [0x3b4448, 0x465052, 0x303a3f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.98 }));
    const tileGeo = new THREE.BoxGeometry(1.52, 0.38, 1.52);
    for (let x = -5; x <= 5; x++) for (let z = -3; z <= 3; z++) {
      if ((Math.abs(x) === 5 && Math.abs(z) === 3) || (x === -5 && z === 2)) continue;
      const tile = new THREE.Mesh(tileGeo, stoneMats[Math.abs(x * 7 + z * 3) % 3]);
      tile.position.set(x * 1.48, -0.18 + ((x * z) % 3) * 0.012, z * 1.48); tile.rotation.y = ((x + z) % 2) * 0.018; tile.receiveShadow = true; world.add(tile);
    }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(34, 24, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0b6670, emissive: 0x062e39, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.22, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -1.35; scene.add(water);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x252f35, roughness: 1 });
    const addWall = (x: number, z: number, sx: number, sz: number, h = 2.5) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), wallMat); wall.position.set(x, h / 2 - 0.05, z); wall.castShadow = wall.receiveShadow = true; world.add(wall);
      for (let i = 0; i < Math.max(sx, sz); i += 1.25) { const cap = new THREE.Mesh(new THREE.BoxGeometry(sz > sx ? 0.9 : 1.15, 0.42, sx > sz ? 0.9 : 1.15), stoneMats[1]); cap.position.set(x + (sx > sz ? i - sx / 2 + 0.6 : 0), h + 0.05, z + (sz > sx ? i - sz / 2 + 0.6 : 0)); cap.castShadow = true; world.add(cap); }
    };
    addWall(-7.65, -1.6, 0.8, 6.7, 3.1); addWall(7.65, 1.8, 0.8, 6.2, 3.5); addWall(3.7, 5.0, 5.5, 0.8, 3.1); addWall(-4.7, -5.0, 4.2, 0.8, 2.4);
    const torchLights: THREE.PointLight[] = [];
    [[-6.7, -3.6], [6.6, 3.7], [4.9, -4.2]].forEach(([x, z]) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.78, 6), wallMat); pedestal.position.set(x, 0.35, z);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.62, 7), new THREE.MeshBasicMaterial({ color: 0xffa334 })); flame.position.set(x, 1.03, z);
      const light = new THREE.PointLight(0xff6d20, 9, 7, 1.8); light.position.set(x, 1.35, z); torchLights.push(light); world.add(pedestal, flame, light);
    });
    const player = makeKnight(); player.position.set(-3.8, 0.03, 2.4); player.rotation.y = -0.6; world.add(player);
    const velocity = new THREE.Vector3(), facing = new THREE.Vector3(0, 0, -1);
    const enemyData: Enemy[] = [[3.8, -2.6], [4.8, 1.3], [0.8, -2.9], [2.0, 2.8], [-0.3, 0.1]].map(([x, z], i) => { const group = makeSkeleton(i); group.position.set(x, 0.03, z); world.add(group); return { group, hp: i === 4 ? 3 : 2, speed: 1.35 + i * 0.045, cooldown: Math.random(), hitFlash: 0, dead: false, phase: i * 1.7 }; });
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const sparkGeo = new THREE.TetrahedronGeometry(0.075, 0), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb24a, toneMapped: false });
    const burst = (at: THREE.Vector3, color = 0xffb24a, amount = 12) => { for (let i = 0; i < amount; i++) { const mesh = new THREE.Mesh(sparkGeo, color === 0xffb24a ? sparkMat : new THREE.MeshBasicMaterial({ color, toneMapped: false })); mesh.position.copy(at).add(new THREE.Vector3(0, 0.8, 0)); const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5; particles.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s), life: 0.35 + Math.random() * 0.3 }); world.add(mesh); } };
    const slash = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 28, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xfff0c6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    slash.rotation.x = -Math.PI / 2; slash.position.y = 0.72; world.add(slash);
    const keyDown = (e: KeyboardEvent) => { keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (e.code === 'Space' && attackTime <= 0 && gameStatus === 'playing') attackTime = 0.42; if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && dashCooldown <= 0 && gameStatus === 'playing') { dashTime = 0.18; dashCooldown = 1.35; } };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const trigger = (e: Event) => { const detail = (e as CustomEvent<string>).detail; if (detail === 'attack' && attackTime <= 0) attackTime = 0.42; if (detail === 'dash' && dashCooldown <= 0) { dashTime = 0.18; dashCooldown = 1.35; } if (detail.startsWith('move:')) keys.add(`Touch${detail.slice(5)}`); if (detail.startsWith('stop:')) keys.delete(`Touch${detail.slice(5)}`); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('dungeon-action', trigger);
    let last = performance.now(), raf = 0; const startedAt = performance.now();
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate); const dt = Math.min((now - last) / 1000, 0.04); last = now; const t = (now - startedAt) / 1000;
      torchLights.forEach((l, i) => { l.intensity = 8.5 + Math.sin(t * 9 + i * 2.2) * 1.4 + Math.sin(t * 17) * 0.5; }); water.position.y = -1.35 + Math.sin(t * 0.9) * 0.05;
      if (gameStatus === 'playing') {
        const mx = +(keys.has('KeyD') || keys.has('ArrowRight') || keys.has('Touchright')) - +(keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('Touchleft'));
        const mz = +(keys.has('KeyS') || keys.has('ArrowDown') || keys.has('Touchdown')) - +(keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Touchup'));
        velocity.set(mx, 0, mz);
        if (velocity.lengthSq() > 0) { velocity.normalize(); facing.lerp(velocity, 0.24).normalize(); player.rotation.y = Math.atan2(facing.x, facing.z); player.position.addScaledVector(velocity, dt * (dashTime > 0 ? 9.5 : 3.4)); player.position.y = 0.03 + Math.abs(Math.sin(t * 11)) * 0.06; setShowHelp(false); }
        player.position.x = clamp(player.position.x, -6.65, 6.65); player.position.z = clamp(player.position.z, -4, 4); dashTime -= dt; dashCooldown -= dt; attackTime -= dt;
        if (attackTime > 0) {
          const phase = 1 - attackTime / 0.42; player.userData.sword.rotation.y = -1.35 + phase * 2.7; slash.position.copy(player.position).addScaledVector(facing, 0.2); slash.rotation.z = -player.rotation.y + Math.PI; (slash.material as THREE.MeshBasicMaterial).opacity = Math.sin(phase * Math.PI) * 0.78; slash.scale.setScalar(0.82 + phase * 0.4);
          if (phase > 0.32 && phase < 0.66) enemyData.forEach((enemy) => { if (enemy.dead || enemy.hitFlash > 0) return; const delta = enemy.group.position.clone().sub(player.position); if (delta.length() < 1.8 && delta.normalize().dot(facing) > -0.05) { enemy.hp--; enemy.hitFlash = 0.28; enemy.group.position.addScaledVector(delta, 0.55); burst(enemy.group.position); shake = 0.16; if (enemy.hp <= 0) { enemy.dead = true; kills++; burst(enemy.group.position, 0xd9d1bd, 18); setEnemies(5 - kills); if (kills === 5) { gameStatus = 'won'; setStatus('won'); } } } });
        } else { player.userData.sword.rotation.y *= 0.78; (slash.material as THREE.MeshBasicMaterial).opacity = 0; }
        enemyData.forEach((enemy) => {
          if (enemy.dead) { enemy.group.rotation.z += dt * 5; enemy.group.scale.multiplyScalar(Math.max(0.001, 1 - dt * 4.5)); return; }
          enemy.hitFlash -= dt; enemy.cooldown -= dt; const toPlayer = player.position.clone().sub(enemy.group.position), dist = toPlayer.length(); enemy.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
          if (dist > 1.05) enemy.group.position.addScaledVector(toPlayer.normalize(), enemy.speed * dt); else if (enemy.cooldown <= 0 && dashTime <= 0) { enemy.cooldown = 1.25 + Math.random() * 0.55; hp = Math.max(0, hp - 12); hurtFlash = 0.28; shake = 0.24; burst(player.position, 0xff4c2f, 10); setHealth(hp); if (hp <= 0) { gameStatus = 'lost'; setStatus('lost'); } }
          enemy.group.position.y = 0.03 + Math.abs(Math.sin(t * 6 + enemy.phase)) * 0.045; const scale = enemy.hitFlash > 0 ? 1.12 : 1; enemy.group.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.25);
        });
      }
      particles.forEach((p) => { p.life -= dt; p.velocity.y -= dt * 7; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.scale.setScalar(Math.max(0, p.life * 2)); });
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) { world.remove(particles[i].mesh); particles.splice(i, 1); }
      hurtFlash -= dt; shake -= dt; const targetCam = new THREE.Vector3(player.position.x + 9.2, 12.5, player.position.z + 11.5); camera.position.lerp(targetCam, 0.035); if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - .5) * shake, (Math.random() - .5) * shake, (Math.random() - .5) * shake)); camera.lookAt(player.position.x, 0, player.position.z); renderer.domElement.style.filter = hurtFlash > 0 ? `sepia(.5) saturate(1.5) brightness(${0.78 + hurtFlash})` : ''; renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = h < 650 ? 5.4 : 5; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener('resize', resize); resize();
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); window.removeEventListener('dungeon-action', trigger); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" aria-label="Isometric dungeon combat arena" />
      <header className="game-title"><span className="sigil">✦</span><div><p>THE DROWNED KEEP</p><span>Lower cistern · encounter 01</span></div></header>
      <section className="hud" aria-live="polite"><div className="health-row"><span>VITALITY</span><b>{health}</b></div><div className="health-track"><i style={{ width: `${health}%` }} /></div><div className="enemy-count"><span>☠</span>{enemies} REMAIN</div></section>
      <aside className="controls"><span><kbd>WASD</kbd> MOVE</span><span><kbd>SPACE</kbd> STRIKE</span><span><kbd>SHIFT</kbd> DASH</span></aside>
      {showHelp && status === 'playing' && <div className="start-prompt"><b>ENTER THE FRAY</b><span>Move toward the skeleton guard</span></div>}
      {status !== 'playing' && <div className="end-screen"><div className="end-card"><span className="end-kicker">ENCOUNTER {status === 'won' ? 'CLEARED' : 'FAILED'}</span><h1>{status === 'won' ? 'The gate stirs.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'For now, the drowned keep is silent.' : 'Steel yourself and enter once more.'}</p><button onClick={() => location.reload()}>TRY AGAIN</button></div></div>}
      <div className="touch-pad" aria-label="Touch movement controls">{['up', 'left', 'down', 'right'].map((dir) => <button key={dir} className={dir} aria-label={`Move ${dir}`} onPointerDown={() => action(`move:${dir}`)} onPointerUp={() => action(`stop:${dir}`)} onPointerCancel={() => action(`stop:${dir}`)}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</button>)}</div>
      <div className="touch-actions"><button onPointerDown={() => action('dash')}>DASH</button><button className="strike" onPointerDown={() => action('attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
