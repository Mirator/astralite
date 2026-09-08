'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { addAtmosphere, stoneTexture } from './dungeon-atmosphere';
import { createDungeonAudio } from './dungeon-audio';
import { generateFloor, moveOnFloor, cellKey, TILE } from './dungeon-floor';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; phase: number; windup: number; aim: THREE.Vector3; room: number; kind: 'guard' | 'stalker' | 'warden'; awake: boolean; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh };
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
const XP_PER_ENEMY = 25;
const XP_DEAD_END = 60;

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
  const breastplate = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.48,0.16),steel); breastplate.position.set(0,0.91,-0.29);
  const pauldrons = [-1,1].map(side => { const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22),steel);shoulder.position.set(side*0.38,1.09,0);shoulder.scale.set(1,0.7,1);return shoulder; });
  const glove = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14),leather);glove.position.set(0,-0.02,0.03);swordPivot.add(glove);
  g.add(breastplate,...pauldrons);
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
  const [defeated, setDefeated] = useState(0);
  const [floorMap, setFloorMap] = useState<ReturnType<typeof generateFloor> | null>(null);
  const [visitedCount, setVisitedCount] = useState(1);
  const mapPlayer = useRef<SVGCircleElement>(null);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [showHelp, setShowHelp] = useState(true);
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [muted, setMuted] = useState(false);
  const [roomName, setRoomName] = useState('The Tide Gate'), [plundered, setPlundered] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [notice, setNotice] = useState(''), [noticeDetail, setNoticeDetail] = useState(''), [ready, setReady] = useState(false);
  const dashMeter = useRef<HTMLProgressElement>(null);

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
    let totalXp = 0, rewardTime = 0, noticeTime = 0, footstepTime = 0;
    let hasStarted = false, isPaused = false, isMuted = false, activeRoom = 0;
    const audio = createDungeonAudio();
    const floor = generateFloor(crypto.getRandomValues(new Uint32Array(1))[0]);
    setFloorMap(floor);
    const guardCount = floor.guardCount;
    const visited = new Set([0]), cleared = new Set([0]);
    const spine = new Set(floor.spine), goalRoom = floor.rooms[floor.goal];
    let reached = 0, loot = 0;
    const swingHits = new Set<Enemy>();
    let gameStatus: 'playing' | 'won' | 'lost' = 'playing';
    const stairClear = () => enemyData.every(e => e.room !== floor.goal || e.dead);
    const finish = () => { if (gameStatus === 'playing' && activeRoom === floor.goal && stairClear()) { gameStatus = 'won'; setStatus('won'); audio.play('win'); } };
    const keys = new Set<string>();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07121a);
    scene.fog = new THREE.FogExp2(0x07121a, 0.018);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 70);
    camera.position.set(10, 13, 13); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0x7396a0, 0x25343b, 2.0));
    const moon = new THREE.DirectionalLight(0x89afc0, 2.8);
    moon.position.set(-7, 12, 9); moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12; moon.shadow.camera.right = moon.shadow.camera.top = 12; scene.add(moon);
    const world = new THREE.Group(); scene.add(world);
    const tileGeo = new THREE.BoxGeometry(1.44, 2.8, 1.44);
    const matrix = new THREE.Matrix4();
    const texture = stoneTexture();
    const floorMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.98, emissive: 0x253b42, emissiveIntensity: 0.35 });
    const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
    const tiles = new THREE.InstancedMesh(tileGeo, floorMaterial, stoneTiles.length);
    stoneTiles.forEach(({x,z,room},i)=>{matrix.makeTranslation(x*TILE,-1.38,z*TILE);tiles.setMatrixAt(i,matrix);const theme=room>=0?floor.rooms[room].theme:'keep';const color=new THREE.Color(theme==='ruins'?0x8b9480:theme==='flooded'?0x78908e:0x969185);color.multiplyScalar(.88+Math.abs(x*7+z*3)%5*.045);tiles.setColorAt(i,color);});
    tiles.receiveShadow=true;world.add(tiles);
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.43,.2,.34),new THREE.MeshStandardMaterial({color:0x665040,roughness:.95}),bridgeTiles.length*4);
    bridgeTiles.forEach(({x,z},i)=>{for(let n=0;n<4;n++){matrix.makeTranslation(x*TILE,-.09,z*TILE+(n-1.5)*.365);planks.setMatrixAt(i*4+n,matrix);planks.setColorAt(i*4+n,new THREE.Color(n%2?0xbca17d:0xd0b68f));}});planks.receiveShadow=true;world.add(planks);
    const { minX, maxX, minZ, maxZ } = floor.bounds;
    const water = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX + 40) * TILE, (maxZ - minZ + 40) * TILE), new THREE.MeshStandardMaterial({ color: 0x0b6670, emissive: 0x062e39, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.22 }));
    water.rotation.x = -Math.PI / 2; water.position.set((minX + maxX) * TILE / 2, -2.8, (minZ + maxZ) * TILE / 2); scene.add(water);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x252f35, roughness: 1 });
    const borders: { x: number; z: number; horizontal: boolean }[] = [];
    floor.tiles.forEach(({ x, z }) => { for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!floor.cells.has(cellKey(x + dx,z + dz))) borders.push({ x: (x + dx * 0.5) * TILE, z: (z + dz * 0.5) * TILE, horizontal: dz !== 0 }); });
    // Low parapets keep the isometric view readable, including narrow bridges.
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.65, 1), wallMat, borders.length);
    borders.forEach((b,i) => { matrix.compose(new THREE.Vector3(b.x,0.15,b.z), new THREE.Quaternion(), new THREE.Vector3(b.horizontal ? TILE : 0.16,1,b.horizontal ? 0.16 : TILE)); walls.setMatrixAt(i,matrix); });
    walls.receiveShadow = true; world.add(walls);
    const torchLights: THREE.PointLight[] = [];
    const atmosphere = addAtmosphere(world, floor);
    for (let i = 0; i < 4; i++) { const light = new THREE.PointLight(0xff9b46,16,18,1.6); torchLights.push(light); scene.add(light); }
    const player = makeKnight(); player.position.set(floor.rooms[0].x * TILE, 0.03, floor.rooms[0].z * TILE); player.rotation.y = -0.6; world.add(player);
    const fill = new THREE.PointLight(0x9bcdd1, 9, 12, 1.8); scene.add(fill);
    const playerRing = new THREE.Mesh(new THREE.RingGeometry(0.5,0.55,40),new THREE.MeshBasicMaterial({color:0xa1d8ce,transparent:true,opacity:0.45,depthWrite:false}));playerRing.rotation.x=-Math.PI/2;world.add(playerRing);
    const cameraFocus = player.position.clone();
    const velocity = new THREE.Vector3(), facing = new THREE.Vector3(1, 0, -0.6).normalize();
    const attackFacing = facing.clone(), dashFacing = facing.clone();
    let bufferedFacing: THREE.Vector3 | null = null;
    const screenRight = new THREE.Vector3(11.5, 0, -9.2).normalize();
    const screenDown = new THREE.Vector3(9.2, 0, 11.5).normalize();
    player.rotation.y = Math.atan2(-facing.x, -facing.z);
    const enemyData: Enemy[] = floor.spawns.map((spawn, index) => {
      const kind = spawn.kind;
      const maxHp = kind === 'warden' ? 4 : 2, tell = kind === 'warden' ? 0.72 : kind === 'stalker' ? 0.36 : 0.5;
      const group = makeSkeleton(kind === 'stalker' ? 1 : 0); group.position.set(spawn.x * TILE,0.03,spawn.z * TILE); group.visible = !spawn.ambush; world.add(group);
      if (kind === 'warden') { group.scale.setScalar(1.3); const crown = new THREE.Mesh(new THREE.ConeGeometry(0.34,0.35,5,1,true),new THREE.MeshStandardMaterial({color:0xc5a264,metalness:0.6,roughness:0.45}));crown.position.y=1.7;group.add(crown); }
      if (kind === 'stalker') group.scale.set(0.82,0.94,0.82);
      const cue = new THREE.Mesh(new THREE.RingGeometry(0.85,1.5,40,1,-1.05,2.1),new THREE.MeshBasicMaterial({color:kind === 'warden'?0xff522b:0xffae52,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));cue.rotation.x=-Math.PI/2;world.add(cue);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.07),new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false}));bar.renderOrder=10;world.add(bar);
      return { group, hp:maxHp, maxHp, kind, tell, damage:kind==='warden'?20:kind==='stalker'?8:12, cue, bar, speed:kind==='stalker'?2.0:kind==='warden'?1.15:1.5, cooldown:0.4+(index%3)*0.2, hitFlash:0, dead:false, phase:spawn.room*1.7+index*0.6, windup:0, aim:new THREE.Vector3(), room:spawn.room, awake:!spawn.ambush };
    });
    let pathCell = '';
    const distances = new Map<string,number>();
    const updatePaths = () => {
      const x = Math.round(player.position.x / TILE), z = Math.round(player.position.z / TILE), key = cellKey(x,z);
      if (pathCell === key) return;
      pathCell = key; distances.clear(); distances.set(key,0);
      const queue = [{ x,z }];
      for (let i = 0; i < queue.length; i++) { const c = queue[i], distance = distances.get(cellKey(c.x,c.z))!; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const next = cellKey(c.x + dx,c.z + dz); if (floor.cells.has(next) && !distances.has(next)) { distances.set(next,distance + 1); queue.push({ x: c.x + dx,z: c.z + dz }); } } }
    };
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
      if (!hasStarted || isPaused || gameStatus !== 'playing' || dashTime > 0) return;
      audio.play('slash');
      attackTime = 0.38; attackBuffer = 0; swingHits.clear();
      const input = moveInput();
      if (input.lengthSq()) facing.copy(input);
      else if (bufferedFacing) facing.copy(bufferedFacing);
      bufferedFacing = null;
      attackFacing.copy(facing); player.rotation.y = Math.atan2(-facing.x, -facing.z);
      setShowHelp(false);
    };
    const requestAttack = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing') return;
      if (attackTime <= 0 && dashTime <= 0) startAttack();
      else { attackBuffer = 0.18; const input = moveInput(); bufferedFacing = input.lengthSq() ? input : facing.clone(); }
    };
    const requestDash = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || dashCooldown > 0) return;
      const input = moveInput(); dashFacing.copy(input.lengthSq() ? input : facing);
      audio.play('dash');
      facing.copy(dashFacing); dashTime = 0.18; dashCooldown = 1.35;
      attackTime = 0; attackBuffer = 0; bufferedFacing = null; hitStop = 0;
      setShowHelp(false);
    };
    const togglePause = () => {
      if (!hasStarted || gameStatus !== 'playing') return;
      isPaused = !isPaused; keys.clear(); attackBuffer = 0; bufferedFacing = null; setPaused(isPaused); audio.pause(isPaused);
    };
    const toggleMute = () => { isMuted = !isMuted; audio.mute(isMuted); setMuted(isMuted); };
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void mount.parentElement?.requestFullscreen?.().catch(() => undefined); };
    const keyDown = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat && e.code === 'Escape') { togglePause(); return; }
      if (!e.repeat && e.code === 'KeyM') { toggleMute(); return; }
      if (!e.repeat && e.code === 'KeyF') { fullscreen(); return; }
      if (!hasStarted || isPaused) return;
      keys.add(e.code); if (e.repeat) return;
      if (e.code === 'Space') requestAttack();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') requestDash();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const clearInput = () => { keys.clear(); attackBuffer = 0; bufferedFacing = null; };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'start') { hasStarted = true; setStarted(true); audio.start(); return; }
      if (detail === 'pause') { togglePause(); return; }
      if (detail === 'mute') { toggleMute(); return; }
      if (detail === 'fullscreen') { fullscreen(); return; }
      if (!hasStarted || isPaused) return;
      if (detail === 'attack') requestAttack();
      if (detail === 'hold-attack') { keys.add('Space'); requestAttack(); }
      if (detail === 'release-attack') keys.delete('Space');
      if (detail === 'dash') requestDash();
      if (detail.startsWith('move:')) keys.add(`Touch${detail.slice(5)}`);
      if (detail.startsWith('stop:')) keys.delete(`Touch${detail.slice(5)}`);
    };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    const blur = () => { clearInput(); if (hasStarted && !isPaused && gameStatus === 'playing') togglePause(); };
    const visibility = () => { if (document.hidden) blur(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur); window.addEventListener('dungeon-action', trigger);
    let last = performance.now(), raf = 0;
    const update = (frameDt: number) => {
      if (isPaused) return;
      elapsed += frameDt; const t = elapsed;
      const dt = hitStop > 0 ? 0 : frameDt; hitStop = Math.max(0, hitStop - frameDt);
      torchLights.forEach((l, i) => { l.intensity = 16 + Math.sin(t * 9 + i * 2.2) * 1.4 + Math.sin(t * 17) * 0.5; });
      water.position.y = -2.8 + Math.sin(t * 0.9) * 0.05;
      if (hasStarted && gameStatus === 'playing') {
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
        const speed = dashTime > 0 ? 9.5 : attackTime > 0 ? 2.6 : 4.6;
        velocity.copy(dashTime > 0 ? dashFacing : input).multiplyScalar(speed);
        moveOnFloor(floor.cells, player.position, velocity.x * dt, velocity.z * dt);
        updatePaths();
        const currentRoom = floor.rooms.find(r => Math.abs(player.position.x / TILE-r.x)<=r.halfX && Math.abs(player.position.z / TILE-r.z)<=r.halfZ);
        if (currentRoom && activeRoom !== currentRoom.id) {
          activeRoom = currentRoom.id; setRoomName(floor.rooms[activeRoom].name);
          // Only the trunk counts as progress; a dead end must never read as ground gained.
          if (spine.has(currentRoom.id) && currentRoom.depth > reached) { reached = currentRoom.depth; setAdvance(reached); }
          if (currentRoom.id === floor.goal && !stairClear()) { setNotice(`${goalRoom.name} · wardens bar the stair`); setNoticeDetail('Break them to leave the keep'); noticeTime = 4; }
          const sprung = enemyData.filter(e => e.room === currentRoom.id && !e.awake && !e.dead);
          if (sprung.length) {
            sprung.forEach(e => { e.awake = true; e.group.visible = true; e.cooldown = Math.max(e.cooldown, 0.9); burst(e.group.position, 0x7fd6c6, 10); });
            setNotice(`${currentRoom.name} · ambush`); setNoticeDetail(`${sprung.length} rise from the silt`); noticeTime = 3; audio.play('warn'); shake = 0.12;
          }
        }
        finish();
        floor.rooms.forEach(r => { if (Math.abs(player.position.x / TILE - r.x) <= r.halfX && Math.abs(player.position.z / TILE - r.z) <= r.halfZ && !visited.has(r.id)) { visited.add(r.id); setVisitedCount(visited.size); document.getElementById(`map-room-${r.id}`)?.setAttribute("fill", "#6a9995"); } });
        if (moving) { footstepTime -= dt; if (footstepTime <= 0 && dashTime <= 0) { audio.play('step'); footstepTime = 0.29; } walkPhase += dt * speed * 3.3; setShowHelp(false); }
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
            if (enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            if (delta.length() < 1.8 && delta.normalize().dot(attackFacing) > 0.35) {
              audio.play('hit');
              swingHits.add(enemy); enemy.hp--; enemy.hitFlash = 0.2; if (enemy.kind !== 'warden') enemy.windup = 0;
              enemy.cooldown = Math.max(enemy.cooldown, 0.4);
              moveOnFloor(floor.cells, enemy.group.position, delta.x * (enemy.kind === 'warden' ? 0.1 : 0.38), delta.z * (enemy.kind === 'warden' ? 0.1 : 0.38)); burst(enemy.group.position, 0xffb24a, 7); shake = 0.07; hitStop = 0.035;
              if (enemy.hp <= 0) { enemy.dead = true; kills++; totalXp += XP_PER_ENEMY; setExperience(totalXp); setXpReward((reward) => reward + XP_PER_ENEMY); rewardTime = 1.4; burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(kills); if (!cleared.has(enemy.room) && enemyData.every(e => e.room !== enemy.room || e.dead)) {
                cleared.add(enemy.room);
                const room = floor.rooms[enemy.room], detour = room.role === 'branch';
                // Detours are optional, so they pay: the trunk only tops you up enough to keep walking.
                if (detour) { loot++; setPlundered(loot); totalXp += XP_DEAD_END; setExperience(totalXp); setXpReward((reward) => reward + XP_DEAD_END); }
                hp = Math.min(100, hp + (detour ? 30 : 12)); setHealth(hp);
                setNotice(`${room.name} · ${detour ? 'dead end plundered' : 'cleansed'}`);
                setNoticeDetail(detour ? `+${XP_DEAD_END} XP · +30 vitality` : '+12 vitality restored');
                noticeTime = 3.5; rewardTime = 1.4; audio.play('clear'); burst(player.position,0x8de9be,18);
                document.getElementById(`map-room-${enemy.room}`)?.setAttribute('fill', detour ? '#c2b273' : '#a8d5b0');
              } finish(); }
            }
          });
        } else { player.userData.sword.rotation.y = THREE.MathUtils.damp(player.userData.sword.rotation.y, 0, 24, dt); player.userData.body.rotation.z = 0; (slash.material as THREE.MeshBasicMaterial).opacity = 0; }
        enemyData.forEach((enemy) => {
          if (!enemy.awake) { enemy.cue.visible = false; enemy.bar.visible = false; return; }
          enemy.cue.visible = !enemy.dead && enemy.windup > 0; enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;
          enemy.bar.position.copy(enemy.group.position).add(new THREE.Vector3(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); enemy.bar.scale.x = enemy.hp / enemy.maxHp;
          enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);
          (enemy.cue.material as THREE.MeshBasicMaterial).opacity = 0.2 + (1 - enemy.windup / enemy.tell) * 0.5;
          if (enemy.dead) { enemy.group.rotation.z += dt * 5; enemy.group.scale.multiplyScalar(Math.max(0.001, 1 - dt * 4.5)); return; }
          enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;
          const ex = Math.round(enemy.group.position.x / TILE), ez = Math.round(enemy.group.position.z / TILE);
          if ((distances.get(cellKey(ex,ez)) ?? Infinity) > 10) return;
          const toPlayer = player.position.clone().sub(enemy.group.position); toPlayer.y = 0; const dist = toPlayer.length();
          if (enemy.windup > 0) {
            enemy.windup = Math.max(0, enemy.windup - dt);
            enemy.group.userData.weapon.rotation.x = -0.4 - Math.sin((1 - enemy.windup / enemy.tell) * Math.PI / 2) * 1.7;
            if (enemy.windup === 0) {
              enemy.cooldown = 1.25; enemy.group.userData.weapon.rotation.x = 0.55;
              if (dist < 1.55 && toPlayer.normalize().dot(enemy.aim) > 0.45 && dashTime <= 0 && hurtFlash <= 0 && gameStatus === 'playing') {
                hp = Math.max(0, hp - enemy.damage); audio.play('hurt'); hurtFlash = 0.35; shake = 0.12; burst(player.position, 0xff4c2f, 8); setHealth(hp);
                if (hp <= 0) { gameStatus = 'lost'; setStatus('lost'); }
              }
            }
          } else {
            enemy.group.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z);
            enemy.group.userData.weapon.rotation.x = THREE.MathUtils.damp(enemy.group.userData.weapon.rotation.x, -0.4, 10, dt);
            if (enemy.hitFlash <= 0) {
              if (dist > 1.15) {
                const direction = toPlayer.clone();
                if (dist > TILE * 1.5) {
                  const next = [[ex + 1,ez],[ex - 1,ez],[ex,ez + 1],[ex,ez - 1]].filter(([x,z]) => floor.cells.has(cellKey(x,z))).sort((a,b) => (distances.get(cellKey(a[0],a[1])) ?? Infinity) - (distances.get(cellKey(b[0],b[1])) ?? Infinity))[0];
                  if (next) direction.set(next[0] * TILE - enemy.group.position.x,0,next[1] * TILE - enemy.group.position.z);
                }
                direction.normalize(); moveOnFloor(floor.cells,enemy.group.position,direction.x * enemy.speed * dt,direction.z * enemy.speed * dt);
              }
              else if (enemy.cooldown <= 0) { enemy.windup = enemy.tell; audio.play('warn'); enemy.aim.copy(toPlayer).normalize(); }
            }
          }
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
            moveOnFloor(floor.cells,a.group.position,-delta.x * push * weightA / total,-delta.z * push * weightA / total);
            moveOnFloor(floor.cells,b.group.position,delta.x * push * weightB / total,delta.z * push * weightB / total);
          }
        }
      }
      if (noticeTime > 0) { noticeTime = Math.max(0,noticeTime-frameDt); if (noticeTime === 0) setNotice(''); }
      if (rewardTime > 0) { rewardTime = Math.max(0, rewardTime - frameDt); if (rewardTime === 0) setXpReward(0); }
      particles.forEach((p) => { p.life -= dt; p.velocity.y -= dt * 7; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.scale.setScalar(Math.max(0, p.life * 2)); });
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) { world.remove(particles[i].mesh); if (particles[i].mesh.material !== sparkMat) (particles[i].mesh.material as THREE.Material).dispose(); particles.splice(i, 1); }
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt);
      atmosphere.update(t,player.position,cleared);
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
      renderer.domElement.style.filter = hurtFlash > 0 ? `sepia(.3) saturate(1.3) brightness(${0.9 + hurtFlash * 0.3})` : '';
    };
    const hooks = window as Window & { advanceTime?: (ms: number, draw?: boolean) => void; render_game_to_text?: () => string };
    hooks.advanceTime = (ms, draw = true) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      if (draw) renderer.render(scene, camera);
    };
    hooks.render_game_to_text = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, muted: isMuted, roomName: floor.rooms[activeRoom].name,
      health: hp, remaining: guardCount - kills,
      objective: { goal: goalRoom.name, goalRoom: floor.goal, halls: reached, goalDepth: goalRoom.depth, atStair: activeRoom === floor.goal, stairClear: stairClear(), deadEndsPlundered: loot },
      experience: { total: totalXp, perEnemy: XP_PER_ENEMY, encounterTarget: (guardCount * XP_PER_ENEMY), resetsOnNewRun: true },
      floor: { waterfalls: atmosphere.waterfalls, seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, start: floor.start, goal: floor.goal, spine: floor.spine, visited: [...visited], cleared: [...cleared] },
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashTime, dashCooldown, swordAngle: player.userData.sword.rotation.y, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, kind: e.kind, windup: e.windup, room: e.room, awake: e.awake })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      if (!manualTime && !document.hidden) { update(Math.min((now - last) / 1000, 0.04)); renderer.render(scene, camera); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = w < 600 ? 6.3 : 7.2; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener('resize', resize); resize(); setReady(true);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); audio.dispose(); atmosphere.dispose(); texture.dispose(); delete hooks.advanceTime; delete hooks.render_game_to_text; scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const guardCount = floorMap?.guardCount ?? 0;
  const roomCount = floorMap?.rooms.length ?? 0;
  const goalName = floorMap?.rooms[floorMap.goal].name ?? 'The Sunken Stair';
  const goalDepth = floorMap?.rooms[floorMap.goal].depth ?? 0;
  const deadEnds = floorMap?.rooms.filter(r => r.role === 'branch').length ?? 0;
  const xpTarget = guardCount * XP_PER_ENEMY + deadEnds * XP_DEAD_END;
  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" aria-label="Procedural isometric dungeon floor" />
      <header className="game-title"><span className="sigil">✦</span><div><p>THE DROWNED KEEP</p><span>{roomName}</span></div></header>
      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || status !== 'playing'} aria-label="Pause game">Ⅱ</button><button onClick={() => action('mute')} aria-label={muted ? 'Enable sound' : 'Mute sound'}>{muted ? 'SOUND OFF' : 'SOUND ON'}</button><button onClick={() => action('fullscreen')} aria-label="Toggle fullscreen">⛶</button></nav>
      <section className="hud" aria-live="polite"><div className="health-row"><span>VITALITY</span><b>{health}</b></div><div className="health-track"><i style={{ width: `${health}%` }} /></div><div className="dash-status"><span>EVASION</span><progress ref={dashMeter} max="1" value="1" aria-label="Dash readiness" /></div>
        <div className="xp-panel"><div className="xp-row"><span>TOTAL XP</span><b>{experience}</b></div>
          <progress className="xp-track" aria-label="Encounter experience" max={xpTarget} value={experience}>{experience} / {xpTarget} XP</progress>
          <div className="xp-caption"><span>{experience} / {xpTarget} this run</span><strong>{xpReward > 0 ? `+${xpReward} XP` : '25 XP / guard'}</strong></div>
        </div></section>
      {floorMap && <aside className="floor-map" aria-label="Floor map: your position and connected chambers"><svg viewBox={`${floorMap.bounds.minX - 3} ${floorMap.bounds.minZ - 3} ${floorMap.bounds.maxX - floorMap.bounds.minX + 6} ${floorMap.bounds.maxZ - floorMap.bounds.minZ + 6}`}>
        <path d={floorMap.tiles.map(t => `M${t.x - 0.5},${t.z - 0.5}h1v1h-1z`).join('')} fill="#334e56" />
        {floorMap.rooms.map(r => <path key={r.id} id={`map-room-${r.id}`} d={floorMap.tiles.filter(t=>t.room===r.id).map(t=>`M${t.x-.5},${t.z-.5}h1v1h-1z`).join('')} fill={r.id===0?'#6a9995':r.role==='goal'?'#7a5f3c':'#3e6066'} />)}
        <circle cx={floorMap.rooms[floorMap.goal].x} cy={floorMap.rooms[floorMap.goal].z} r="3.4" fill="none" stroke="#ffc573" strokeWidth="0.9" opacity="0.8" />
        <circle ref={mapPlayer} cx={floorMap.rooms[0].x} cy={floorMap.rooms[0].z} r="1.8" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </svg><span>{visitedCount} / {roomCount} areas explored · {plundered} / {deadEnds} dead ends plundered</span></aside>}
      <div className="floor-objective"><span>REACH {goalName.toUpperCase()}</span><b>{advance} <i>/ {goalDepth} halls onward</i></b></div>
      {notice && started && !paused && <output className="chamber-notice"><span>✦</span><b>{notice}</b><small>{noticeDetail}</small></output>}
      <aside className="controls"><span><kbd>WASD</kbd> MOVE</span><span><kbd>SPACE</kbd> HOLD TO STRIKE</span><span><kbd>SHIFT</kbd> DASH</span><span><kbd>ESC</kbd> PAUSE</span></aside>
      {showHelp && started && !paused && status === 'playing' && <div className="start-prompt"><b>PRESS ON TO {goalName.toUpperCase()}</b><span>Side chambers are optional · they pay in XP and vitality</span></div>}
      {(!started || paused) && <div className="intro-screen"><section className="intro-card"><span className="end-kicker">{paused ? 'A MOMENT OF STILLNESS' : 'CHAPTER I · THE LOWER CISTERN'}</span><h1>{paused ? 'The keep can wait.' : <>The Drowned<br /><em>Keep</em></>}</h1><p>{paused ? 'Gather yourself. Your journey is held here.' : 'Beneath the tide, the old watch still stands. Fight your way down the drowned halls to the sunken stair — and rob the dead ends on the way if you dare.'}</p><div className="intro-controls"><span><kbd>WASD / ↑↓←→</kbd> Move</span><span><kbd>SPACE</kbd> Hold to strike</span><span><kbd>SHIFT</kbd> Dodge attacks</span></div><button className="primary-action" disabled={!ready} onClick={() => action(paused ? 'pause' : 'start')}>{!ready ? 'ENTERING THE KEEP…' : paused ? 'RESUME JOURNEY' : 'ENTER THE KEEP'} <span>→</span></button><small>{goalDepth} halls to the stair · {deadEnds} optional dead ends<br />Clearing a dead end pays {XP_DEAD_END} XP and 30 vitality.</small></section></div>}
      {status !== 'playing' && <div className="end-screen"><div className="end-card"><span className="end-kicker">FLOOR {status === 'won' ? 'ESCAPED' : 'FAILED'}</span><h1>{status === 'won' ? 'The stair is yours.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'You climb out of the cistern. Beyond the tide, dawn waits.' : 'Steel yourself and enter once more.'}</p><div className="xp-summary"><strong>{experience} XP earned</strong><span>{defeated} / {guardCount} guards defeated · {plundered} / {deadEnds} dead ends plundered · XP resets on a new run</span></div><button onClick={() => location.reload()}>NEW FLOOR</button></div></div>}
      <div className="touch-pad" aria-label="Touch movement controls">{['up', 'left', 'down', 'right'].map((dir) => <button key={dir} className={dir} aria-label={`Move ${dir}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action(`move:${dir}`); }} onLostPointerCapture={() => action(`stop:${dir}`)} onPointerUp={() => action(`stop:${dir}`)} onPointerCancel={() => action(`stop:${dir}`)}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</button>)}</div>
      <div className="touch-actions"><button onPointerDown={() => action('dash')}>DASH</button><button className="strike" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-attack'); }} onPointerUp={() => action('release-attack')} onPointerCancel={() => action('release-attack')} onLostPointerCapture={() => action('release-attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
