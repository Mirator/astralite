'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; phase: number; windup: number; aim: THREE.Vector3 };
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
const ARENA_X = 9.65, ARENA_Z = 7;
const XP_PER_ENEMY = 25, ENCOUNTER_XP = 5 * XP_PER_ENEMY;
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
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.2, 0.48, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.36, 0.2), dark); leg.position.y = -0.13;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.36), steel); boot.position.set(0, -0.34, -0.06);
    hip.add(leg, boot); g.add(hip); return hip;
  });
  g.userData.legs = legs; g.userData.cape = cape; g.userData.body = body;
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
  g.userData.weapon = weapon;
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export default function DungeonGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [experience, setExperience] = useState(0);
  const [xpReward, setXpReward] = useState(0);
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
    let attackBuffer = 0, walkPhase = 0, elapsed = 0, manualTime = false, hitStop = 0;
    let totalXp = 0, rewardTime = 0;
    const swingHits = new Set<Enemy>();
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
    for (let x = -7; x <= 7; x++) for (let z = -5; z <= 5; z++) {
      if (Math.abs(x) === 7 && Math.abs(z) === 5) continue;
      const tile = new THREE.Mesh(tileGeo, stoneMats[Math.abs(x * 7 + z * 3) % 3]);
      tile.position.set(x * 1.48, -0.18 + ((x * z) % 3) * 0.012, z * 1.48); tile.rotation.y = ((x + z) % 2) * 0.018; tile.receiveShadow = true; world.add(tile);
    }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(44, 34, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0b6670, emissive: 0x062e39, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.22, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -1.35; scene.add(water);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x252f35, roughness: 1 });
    const addWall = (x: number, z: number, sx: number, sz: number, h = 2.5) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), wallMat); wall.position.set(x, h / 2 - 0.05, z); wall.castShadow = wall.receiveShadow = true; world.add(wall);
      for (let i = 0; i < Math.max(sx, sz); i += 1.25) { const cap = new THREE.Mesh(new THREE.BoxGeometry(sz > sx ? 0.9 : 1.15, 0.42, sx > sz ? 0.9 : 1.15), stoneMats[1]); cap.position.set(x + (sx > sz ? i - sx / 2 + 0.6 : 0), h + 0.05, z + (sz > sx ? i - sz / 2 + 0.6 : 0)); cap.castShadow = true; world.add(cap); }
    };
    addWall(-10.65, -2.6, 0.8, 10.7, 3.1); addWall(10.65, 2.8, 0.8, 10.2, 3.5); addWall(5.2, 8.0, 8.5, 0.8, 3.1); addWall(-6.2, -8.0, 7.2, 0.8, 2.4);
    const torchLights: THREE.PointLight[] = [];
    [[-9.7, -6.6], [9.6, 6.7], [7.9, -7.2]].forEach(([x, z]) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.78, 6), wallMat); pedestal.position.set(x, 0.35, z);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.62, 7), new THREE.MeshBasicMaterial({ color: 0xffa334 })); flame.position.set(x, 1.03, z);
      const light = new THREE.PointLight(0xff6d20, 9, 7, 1.8); light.position.set(x, 1.35, z); torchLights.push(light); world.add(pedestal, flame, light);
    });
    const player = makeKnight(); player.position.set(-3.8, 0.03, 2.4); player.rotation.y = -0.6; world.add(player);
    const velocity = new THREE.Vector3(), facing = new THREE.Vector3(1, 0, -0.6).normalize();
    const attackFacing = facing.clone(), dashFacing = facing.clone();
    let bufferedFacing: THREE.Vector3 | null = null;
    const screenRight = new THREE.Vector3(11.5, 0, -9.2).normalize();
    const screenDown = new THREE.Vector3(9.2, 0, 11.5).normalize();
    player.rotation.y = Math.atan2(-facing.x, -facing.z);
    const enemyData: Enemy[] = [[3.8, -2.6], [4.8, 1.3], [0.8, -2.9], [2.0, 2.8], [-0.3, 0.1]].map(([x, z], i) => { const group = makeSkeleton(i); group.position.set(x, 0.03, z); world.add(group); return { group, hp: i === 4 ? 3 : 2, speed: 1.35 + i * 0.045, cooldown: 0.3 + i * 0.13, hitFlash: 0, dead: false, phase: i * 1.7, windup: 0, aim: new THREE.Vector3() }; });
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const sparkGeo = new THREE.TetrahedronGeometry(0.075, 0), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb24a, toneMapped: false });
    const burst = (at: THREE.Vector3, color = 0xffb24a, amount = 12) => { for (let i = 0; i < amount; i++) { const mesh = new THREE.Mesh(sparkGeo, color === 0xffb24a ? sparkMat : new THREE.MeshBasicMaterial({ color, toneMapped: false })); mesh.position.copy(at).add(new THREE.Vector3(0, 0.8, 0)); const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5; particles.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s), life: 0.35 + Math.random() * 0.3 }); world.add(mesh); } };
    const slash = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 28, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xfff0c6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    slash.rotation.x = -Math.PI / 2; slash.position.y = 0.72; world.add(slash);
    const moveInput = () => {
      const x = +(keys.has('KeyD') || keys.has('ArrowRight') || keys.has('Touchright')) - +(keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('Touchleft'));
      const z = +(keys.has('KeyS') || keys.has('ArrowDown') || keys.has('Touchdown')) - +(keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Touchup'));
      return screenRight.clone().multiplyScalar(x).addScaledVector(screenDown, z).normalize();
    };
    const startAttack = () => {
      if (gameStatus !== 'playing' || dashTime > 0) return;
      attackTime = 0.38; attackBuffer = 0; swingHits.clear();
      const input = moveInput();
      if (input.lengthSq()) facing.copy(input);
      else if (bufferedFacing) facing.copy(bufferedFacing);
      bufferedFacing = null;
      attackFacing.copy(facing); player.rotation.y = Math.atan2(-facing.x, -facing.z);
      setShowHelp(false);
    };
    const requestAttack = () => {
      if (gameStatus !== 'playing') return;
      if (attackTime <= 0 && dashTime <= 0) startAttack();
      else { attackBuffer = 0.18; const input = moveInput(); bufferedFacing = input.lengthSq() ? input : facing.clone(); }
    };
    const requestDash = () => {
      if (gameStatus !== 'playing' || dashCooldown > 0) return;
      const input = moveInput(); dashFacing.copy(input.lengthSq() ? input : facing);
      facing.copy(dashFacing); dashTime = 0.18; dashCooldown = 1.35;
      attackTime = 0; attackBuffer = 0; bufferedFacing = null; hitStop = 0;
      setShowHelp(false);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      keys.add(e.code); if (e.repeat) return;
      if (e.code === 'Space') requestAttack();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') requestDash();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const clearInput = () => { keys.clear(); attackBuffer = 0; bufferedFacing = null; };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'attack') requestAttack();
      if (detail === 'dash') requestDash();
      if (detail.startsWith('move:')) keys.add(`Touch${detail.slice(5)}`);
      if (detail.startsWith('stop:')) keys.delete(`Touch${detail.slice(5)}`);
    };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearInput); window.addEventListener('dungeon-action', trigger);
    let last = performance.now(), raf = 0;
    const update = (frameDt: number) => {
      elapsed += frameDt; const t = elapsed;
      const dt = hitStop > 0 ? 0 : frameDt; hitStop = Math.max(0, hitStop - frameDt);
      torchLights.forEach((l, i) => { l.intensity = 8.5 + Math.sin(t * 9 + i * 2.2) * 1.4 + Math.sin(t * 17) * 0.5; });
      water.position.y = -1.35 + Math.sin(t * 0.9) * 0.05;
      if (gameStatus === 'playing') {
        attackBuffer = Math.max(0, attackBuffer - dt);
        if (attackBuffer === 0) bufferedFacing = null;
        dashCooldown = Math.max(0, dashCooldown - dt);
        if (attackTime <= 0 && dashTime <= 0 && (attackBuffer > 0 || keys.has('Space'))) startAttack();
        const input = moveInput(), moving = input.lengthSq() > 0;
        if (moving && attackTime <= 0 && dashTime <= 0) facing.copy(input);
        const direction = dashTime > 0 ? dashFacing : facing;
        const targetAngle = Math.atan2(-direction.x, -direction.z);
        const angleDelta = Math.atan2(Math.sin(targetAngle - player.rotation.y), Math.cos(targetAngle - player.rotation.y));
        player.rotation.y += angleDelta * (1 - Math.exp(-28 * dt));
        const speed = dashTime > 0 ? 9.5 : attackTime > 0 ? 2.6 : 3.4;
        velocity.copy(dashTime > 0 ? dashFacing : input).multiplyScalar(speed);
        player.position.addScaledVector(velocity, dt);
        player.position.x = clamp(player.position.x, -ARENA_X, ARENA_X); player.position.z = clamp(player.position.z, -ARENA_Z, ARENA_Z);
        if (moving) { walkPhase += dt * speed * 3.3; setShowHelp(false); }
        const stride = moving && dashTime <= 0 ? Math.sin(walkPhase) * 0.6 : 0;
        player.userData.legs.forEach((leg: THREE.Group, i: number) => { leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, i ? -stride : stride, 28, dt); });
        player.position.y = 0.03 + (moving ? Math.abs(Math.sin(walkPhase)) * 0.055 : 0);
        player.rotation.x = THREE.MathUtils.damp(player.rotation.x, dashTime > 0 ? -0.3 : moving ? -0.07 : 0, 24, dt);
        player.userData.cape.rotation.x = THREE.MathUtils.damp(player.userData.cape.rotation.x, dashTime > 0 ? 0.95 : moving ? 0.35 + Math.sin(walkPhase) * 0.08 : 0.1, 16, dt);
        dashTime = Math.max(0, dashTime - dt);
        if (attackTime > 0) {
          attackTime = Math.max(0, attackTime - dt);
          const age = 0.38 - attackTime;
          // Brief anticipation, fast contact, then a readable recovery to guard.
          const swing = age < 0.065 ? -0.65 - age / 0.065 * 0.65 : age < 0.175 ? -1.3 + (age - 0.065) / 0.11 * 2.6 : 1.3 * (1 - (age - 0.175) / 0.205);
          player.userData.sword.rotation.y = swing;
          player.userData.body.rotation.z = -Math.sin(age / 0.38 * Math.PI) * 0.13;
          slash.position.copy(player.position); slash.position.y += 0.72;
          slash.rotation.z = Math.atan2(-attackFacing.z, attackFacing.x);
          const active = age >= 0.065 && age <= 0.175;
          (slash.material as THREE.MeshBasicMaterial).opacity = active ? 0.65 : Math.max(0, 1 - (age - 0.175) / 0.09) * (age > 0.175 ? 0.35 : 0);
          slash.scale.setScalar(1.45);
          if (active) enemyData.forEach((enemy) => {
            if (enemy.dead || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            if (delta.length() < 1.8 && delta.normalize().dot(attackFacing) > 0.35) {
              swingHits.add(enemy); enemy.hp--; enemy.hitFlash = 0.2; enemy.windup = 0;
              enemy.cooldown = Math.max(enemy.cooldown, 0.4);
              enemy.group.position.addScaledVector(delta, 0.38); burst(enemy.group.position, 0xffb24a, 7); shake = 0.07; hitStop = 0.035;
              if (enemy.hp <= 0) { enemy.dead = true; kills++; totalXp += XP_PER_ENEMY; setExperience(totalXp); setXpReward((reward) => reward + XP_PER_ENEMY); rewardTime = 1.4; burst(enemy.group.position, 0xd9d1bd, 12); setEnemies(5 - kills); if (kills === 5) { gameStatus = 'won'; setStatus('won'); } }
            }
          });
        } else { player.userData.sword.rotation.y = THREE.MathUtils.damp(player.userData.sword.rotation.y, 0, 24, dt); player.userData.body.rotation.z = 0; (slash.material as THREE.MeshBasicMaterial).opacity = 0; }
        enemyData.forEach((enemy) => {
          if (enemy.dead) { enemy.group.rotation.z += dt * 5; enemy.group.scale.multiplyScalar(Math.max(0.001, 1 - dt * 4.5)); return; }
          enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;
          const toPlayer = player.position.clone().sub(enemy.group.position); toPlayer.y = 0; const dist = toPlayer.length();
          if (enemy.windup > 0) {
            enemy.windup = Math.max(0, enemy.windup - dt);
            enemy.group.userData.weapon.rotation.x = -0.4 - Math.sin((1 - enemy.windup / 0.42) * Math.PI / 2) * 1.7;
            if (enemy.windup === 0) {
              enemy.cooldown = 1.25; enemy.group.userData.weapon.rotation.x = 0.55;
              if (dist < 1.55 && toPlayer.normalize().dot(enemy.aim) > 0.45 && dashTime <= 0 && hurtFlash <= 0 && gameStatus === 'playing') {
                hp = Math.max(0, hp - 12); hurtFlash = 0.35; shake = 0.12; burst(player.position, 0xff4c2f, 8); setHealth(hp);
                if (hp <= 0) { gameStatus = 'lost'; setStatus('lost'); }
              }
            }
          } else {
            enemy.group.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z);
            enemy.group.userData.weapon.rotation.x = THREE.MathUtils.damp(enemy.group.userData.weapon.rotation.x, -0.4, 10, dt);
            if (enemy.hitFlash <= 0) {
              if (dist > 1.15) enemy.group.position.addScaledVector(toPlayer.normalize(), enemy.speed * dt);
              else if (enemy.cooldown <= 0) { enemy.windup = 0.42; enemy.aim.copy(toPlayer).normalize(); }
            }
          }
          enemy.group.position.x = clamp(enemy.group.position.x, -ARENA_X, ARENA_X); enemy.group.position.z = clamp(enemy.group.position.z, -ARENA_Z, ARENA_Z);
          enemy.group.position.y = 0.03 + Math.abs(Math.sin(t * 6 + enemy.phase)) * 0.045;
          enemy.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.setHex(enemy.hitFlash > 0 ? 0xffa34a : enemy.windup > 0 ? 0xb83915 : 0x000000); o.material.emissiveIntensity = enemy.hitFlash > 0 ? 0.8 : 0.5; } });
        });
        // Separate bodies without moving a guard during its committed windup.
        // Two short passes resolve crowds while keeping the correction gentle.
        if (dt > 0) for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < enemyData.length; i++) for (let j = i + 1; j < enemyData.length; j++) {
            const a = enemyData[i], b = enemyData[j];
            if (a.dead || b.dead) continue;
            const delta = b.group.position.clone().sub(a.group.position); delta.y = 0;
            const distance = delta.length(); if (distance >= 0.82) continue;
            if (distance < 0.001) delta.set(1, 0, 0); else delta.divideScalar(distance);
            const weightA = a.windup > 0 ? 0 : 1, weightB = b.windup > 0 ? 0 : 1;
            const total = weightA + weightB; if (!total) continue;
            const push = Math.min(0.82 - distance, dt * 3);
            a.group.position.addScaledVector(delta, -push * weightA / total);
            b.group.position.addScaledVector(delta, push * weightB / total);
          }
          enemyData.forEach(({ group }) => { group.position.x = clamp(group.position.x, -ARENA_X, ARENA_X); group.position.z = clamp(group.position.z, -ARENA_Z, ARENA_Z); });
        }
      }
      if (rewardTime > 0) { rewardTime = Math.max(0, rewardTime - frameDt); if (rewardTime === 0) setXpReward(0); }
      particles.forEach((p) => { p.life -= dt; p.velocity.y -= dt * 7; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.scale.setScalar(Math.max(0, p.life * 2)); });
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) { world.remove(particles[i].mesh); if (particles[i].mesh.material !== sparkMat) (particles[i].mesh.material as THREE.Material).dispose(); particles.splice(i, 1); }
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt);
      camera.position.set(player.position.x + 9.2, 12.5, player.position.z + 11.5);
      if (shake > 0) camera.position.add(new THREE.Vector3(Math.sin(t * 95) * shake, 0, Math.cos(t * 83) * shake));
      camera.lookAt(player.position.x, 0, player.position.z);
      renderer.domElement.style.filter = hurtFlash > 0 ? `sepia(.3) saturate(1.3) brightness(${0.9 + hurtFlash * 0.3})` : '';
    };
    const hooks = window as Window & { advanceTime?: (ms: number) => void; render_game_to_text?: () => string };
    hooks.advanceTime = (ms) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      renderer.render(scene, camera);
    };
    hooks.render_game_to_text = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: gameStatus,
      health: hp, remaining: 5 - kills,
      experience: { total: totalXp, perEnemy: XP_PER_ENEMY, encounterTarget: ENCOUNTER_XP, resetsOnNewRun: true },
      arena: { minX: -ARENA_X, maxX: ARENA_X, minZ: -ARENA_Z, maxZ: ARENA_Z },
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashTime, dashCooldown, swordAngle: player.userData.sword.rotation.y, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, windup: e.windup })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      if (!manualTime && !document.hidden) { update(Math.min((now - last) / 1000, 0.04)); renderer.render(scene, camera); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = h < 650 ? 5.4 : 5; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener('resize', resize); resize();
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', clearInput); delete hooks.advanceTime; delete hooks.render_game_to_text; scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" aria-label="Isometric dungeon combat arena" />
      <header className="game-title"><span className="sigil">✦</span><div><p>THE DROWNED KEEP</p><span>Lower cistern · encounter 01</span></div></header>
      <section className="hud" aria-live="polite"><div className="health-row"><span>VITALITY</span><b>{health}</b></div><div className="health-track"><i style={{ width: `${health}%` }} /></div><div className="enemy-count"><span>☠</span>{enemies} REMAIN</div>
        <div className="xp-panel"><div className="xp-row"><span>TOTAL XP</span><b>{experience}</b></div>
          <progress className="xp-track" aria-label="Encounter experience" max={ENCOUNTER_XP} value={experience}>{experience} / {ENCOUNTER_XP} XP</progress>
          <div className="xp-caption"><span>{experience} / {ENCOUNTER_XP} this run</span><strong>{xpReward > 0 ? `+${xpReward} XP` : '25 XP / guard'}</strong></div>
        </div></section>
      <aside className="controls"><span><kbd>WASD</kbd> MOVE</span><span><kbd>SPACE</kbd> HOLD TO STRIKE</span><span><kbd>SHIFT</kbd> DASH</span></aside>
      {showHelp && status === 'playing' && <div className="start-prompt"><b>ENTER THE FRAY</b><span>Move toward the skeleton guard</span></div>}
      {status !== 'playing' && <div className="end-screen"><div className="end-card"><span className="end-kicker">ENCOUNTER {status === 'won' ? 'CLEARED' : 'FAILED'}</span><h1>{status === 'won' ? 'The gate stirs.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'For now, the drowned keep is silent.' : 'Steel yourself and enter once more.'}</p><div className="xp-summary"><strong>{experience} XP earned</strong><span>{5 - enemies} / 5 guards defeated · XP resets on a new run</span></div><button onClick={() => location.reload()}>TRY AGAIN</button></div></div>}
      <div className="touch-pad" aria-label="Touch movement controls">{['up', 'left', 'down', 'right'].map((dir) => <button key={dir} className={dir} aria-label={`Move ${dir}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action(`move:${dir}`); }} onLostPointerCapture={() => action(`stop:${dir}`)} onPointerUp={() => action(`stop:${dir}`)} onPointerCancel={() => action(`stop:${dir}`)}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</button>)}</div>
      <div className="touch-actions"><button onPointerDown={() => action('dash')}>DASH</button><button className="strike" onPointerDown={() => action('attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
