'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { addAtmosphere, stoneTexture } from './dungeon-atmosphere';
import { createDungeonAudio } from './dungeon-audio';
import { animateCloth, tidalMaterial, weatherStone } from './dungeon-motion';
import { generateFloor, moveOnFloor, hasClearPath, cellKey, TILE } from './dungeon-floor';
import { betterRun, readBest, readSeed, writeBest, writeSeed, type BestRun } from './dungeon-save';
import { BOONS, clearRoomReward, createRun, grantXp, heal, hurt, rankCost, resolveKill, takeBoon, tickRun, XP_DEAD_END, XP_PER_ENEMY, type Boon, type Reward } from './dungeon-sim';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; phase: number; windup: number; lunge: number; aim: THREE.Vector3; room: number; kind: 'guard' | 'stalker' | 'warden'; awake: boolean; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh };
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
const FLOORS = 3;

function makeKnight() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x17202a, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.48, metalness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0x9b292d, roughness: 0.9, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5b3728, roughness: 1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.48, 0.8, 6), dark);
  body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.31, 0), steel);
  head.position.y = 1.36; head.scale.z = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.12), dark);
  visor.position.set(0, 1.38, -0.26);
  const capeGeometry = new THREE.PlaneGeometry(.88,1.12,6,8);
  const cloth = capeGeometry.getAttribute('position');
  for(let i=0;i<cloth.count;i++){const free=(.56-cloth.getY(i))/1.12;cloth.setX(i,cloth.getX(i)*(.65+free*.4));cloth.setZ(i,free*.2);}
  const cape = new THREE.Mesh(capeGeometry, red);
  cape.position.set(0, 0.69, 0.3); cape.rotation.x = 0.1;
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

const shared = <T extends THREE.BufferGeometry>(geometry: T) => { geometry.userData.shared = true; return geometry; };
const BONES = {
  pelvis: shared(new THREE.BoxGeometry(0.48, 0.22, 0.25)),
  spine: shared(new THREE.BoxGeometry(0.13, 0.58, 0.13)),
  ribs: shared(new THREE.TorusGeometry(0.27, 0.055, 4, 7, Math.PI * 1.55)),
  skull: shared(new THREE.DodecahedronGeometry(0.27, 0)),
  socket: shared(new THREE.SphereGeometry(0.035, 5, 4)),
  limb: shared(new THREE.BoxGeometry(0.12, 0.65, 0.12)),
  shield: shared(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 8)),
  weapon: shared(new THREE.BoxGeometry(0.09, 0.09, 0.92)),
  crown: shared(new THREE.ConeGeometry(0.34, 0.35, 5, 1, true)),
  cue: shared(new THREE.RingGeometry(0.85, 1.5, 40, 1, -1.05, 2.1)),
  bar: shared(new THREE.PlaneGeometry(0.8, 0.07)),
};

function makeSkeleton(index: number) {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9d1bd, roughness: 0.92 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x4c5156, roughness: 0.75, metalness: 0.28 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff421f });
  const pelvis = new THREE.Mesh(BONES.pelvis, bone); pelvis.position.y = 0.55;
  const spine = new THREE.Mesh(BONES.spine, bone); spine.position.y = 0.91;
  const ribs = new THREE.Mesh(BONES.ribs, bone);
  ribs.position.set(0, 1.03, -0.02); ribs.rotation.set(Math.PI / 2, 0, -Math.PI * 0.78);
  const skull = new THREE.Mesh(BONES.skull, bone);
  skull.position.y = 1.42; skull.scale.set(0.88, 1, 0.78);
  const sockets = [-1, 1].map((s) => { const e = new THREE.Mesh(BONES.socket, eye); e.position.set(s * 0.085, 1.45, -0.21); return e; });
  const limbs = [-1, 1].flatMap((s) => { const arm = new THREE.Mesh(BONES.limb, bone); arm.position.set(s * 0.35, 0.95, 0); arm.rotation.z = s * 0.17; const leg = arm.clone(); leg.position.set(s * 0.18, 0.25, 0); return [arm, leg]; });
  const shield = new THREE.Mesh(BONES.shield, iron);
  shield.position.set(-0.45, 0.92, -0.12); shield.rotation.set(Math.PI / 2, 0, 0); shield.visible = index % 2 === 0;
  const weapon = new THREE.Mesh(BONES.weapon, iron);
  weapon.position.set(0.42, 0.84, -0.28); weapon.rotation.x = -0.4;
  g.add(pelvis, spine, ribs, skull, ...sockets, ...limbs, shield, weapon);
  g.userData.weapon = weapon;
  g.userData.limbs = limbs; g.userData.skull = skull; g.userData.shield = shield;
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// three.js throws outright when the browser will not hand out a context at all — no GPU, WebGL off by
// policy or setting, a browser too old. That is not the same as losing a context mid-run, which three.js
// gets back by itself: nothing is coming back here, so the throw is caught and answered with a screen.
const makeRenderer = () => { try { return new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { return null; } };

export default function DungeonGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [experience, setExperience] = useState(0);
  const [xpReward, setXpReward] = useState(0);
  const [health, setHealth] = useState(100);
  const [defeated, setDefeated] = useState(0);
  const [floorLevel, setFloorLevel] = useState(1);
  const [maxHealth, setMaxHealth] = useState(100);
  const [rank, setRank] = useState(1), [rankXp, setRankXp] = useState(0), [rankNeed, setRankNeed] = useState(rankCost(1));
  const [boonChoice, setBoonChoice] = useState<Boon[]>([]), [taken, setTaken] = useState<string[]>([]);
  const [floorMap, setFloorMap] = useState<ReturnType<typeof generateFloor> | null>(null);
  const [visitedCount, setVisitedCount] = useState(1);
  const mapPlayer = useRef<SVGCircleElement>(null);
  const [status, setStatus] = useState<'playing' | 'complete' | 'won' | 'lost'>('playing');
  const [mapOpen, setMapOpen] = useState(false);
  const [floorResult, setFloorResult] = useState({ kills: 0, xp: 0, seconds: 0 });
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [muted, setMuted] = useState(false);
  const [roomName, setRoomName] = useState('The Tide Gate'), [plundered, setPlundered] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [notice, setNotice] = useState(''), [, setNoticeDetail] = useState(''), [ready, setReady] = useState(false);
  const dashMeter = useRef<HTMLProgressElement>(null);
  const [displayLost, setDisplayLost] = useState(false), [floorBuild, setFloorBuild] = useState(0);
  // Deliberately not the same flag as displayLost: that is a context taken away mid-descent and handed
  // back, this is one never granted, so there is no run to pause and nothing that could restore it.
  const [displayFailed, setDisplayFailed] = useState(false);
  const [best, setBest] = useState<BestRun | null>(null);
  const [runSeed, setRunSeed] = useState<number | null>(null), [priorSeed, setPriorSeed] = useState<number | null>(null);

  // Persisting a finished run is a write to an external system, so it belongs in an effect. Both endings
  // settle every HUD value before `status` flips, which makes this the one honest place to read the run.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return;
    const record = (run: BestRun) => { setBest(run); writeBest(run); };
    const next = betterRun(best, { floor: floorLevel, xp: experience, kills: defeated, won: status === 'won' });
    if (next && next !== best) record(next);
  }, [status, floorLevel, experience, defeated, best]);

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
    // The renderer is built before anything else because it is the one piece of setup that can fail
    // outright, and both ways of failing want the same bail-out: nothing below has been constructed yet,
    // so there is no audio context, no listener, no loop and no window hook to undo — which is why this
    // effect can leave without a cleanup function at all. A missing mount is React between renders and
    // says nothing; a refused context is the browser declining to draw and has to say so on screen.
    const renderer = mount && makeRenderer();
    if (!mount || !renderer) { if (mount) setDisplayFailed(true); return; }
    // Every number a combat or progression outcome depends on lives in `run`, in dungeon-sim.ts, where it
    // can be tested without a browser. What is left here is the world: timers that only drive visuals,
    // input, and anything holding a THREE object.
    let run = createRun();
    let stopped = false, attackTime = 0, dashTime = 0, dashCooldown = 0, hurtFlash = 0, shake = 0;
    let attackBuffer = 0, walkPhase = 0, elapsed = 0, manualTime = false, hitStop = 0;
    let rewardTime = 0, noticeTime = 0, footstepTime = 0;
    let hasStarted = false, isPaused = false, isMuted = false, activeRoom = 0;
    const audio = createDungeonAudio();
    // Floor-scoped state: everything here is torn down and rebuilt when the knight takes the stair down.
    let floor!: ReturnType<typeof generateFloor>;
    let enemyData: Enemy[] = [];
    let atmosphere: ReturnType<typeof addAtmosphere> | null = null;
    let visited = new Set<number>([0]), cleared = new Set<number>([0]), spineRooms = new Set<number>();
    let reached = 0, loot = 0, level = 1;
    let floorStart = 0, floorKills = 0, floorXp = 0;
    let features: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; room: number; shrine: boolean; used: boolean; phase: number; burned: boolean }[] = [];
    let floorGroup = new THREE.Group();
    let water: THREE.Mesh | null = null;
    let tide: ReturnType<typeof tidalMaterial> | null = null;
    // Building a floor is the only place this game can stutter, so each phase is timed and reported.
    let buildMs: Record<string, number> = {};
    const goalRoom = () => floor.rooms[floor.goal];
    const swingHits = new Set<Enemy>();
    let gameStatus: 'playing' | 'complete' | 'won' | 'lost' = 'playing';
    const stairClear = () => enemyData.every(e => e.room !== floor.goal || e.dead);
    const offerBoon = () => {
      run.choosing = true; keys.clear();
      setBoonChoice([...BOONS].sort(() => Math.random() - 0.5).slice(0, 3));
      audio.play('clear');
    };
    // Every reward the sim hands back funnels through here, so the HUD, the XP ticker and the boon draft
    // stay in step with the run no matter which rule paid out.
    const award = (reward: Reward) => {
      if (reward.xp > 0) {
        setExperience(run.totalXp); setXpReward((earned) => earned + reward.xp); rewardTime = 1.4;
        setRank(run.rankLevel); setRankXp(run.rankProgress); setRankNeed(rankCost(run.rankLevel));
        if (run.pendingRanks > 0 && !run.choosing) offerBoon();
      }
      if (reward.healed > 0) setHealth(run.hp);
    };
    const chooseBoon = (id: string) => {
      const boon = takeBoon(run, id);
      if (!boon) return;
      setMaxHealth(run.maxHp); setHealth(run.hp); setBoonChoice([]);
      setTaken((list) => [...list, boon.name]);
      setNotice(`${boon.name} taken`); setNoticeDetail(boon.detail); noticeTime = 3;
      if (run.pendingRanks > 0) offerBoon();
    };
    const keys = new Set<string>();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07121a);
    scene.fog = new THREE.FogExp2(0x07121a, 0.018);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 70);
    camera.position.set(10, 13, 13); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0x7396a0, 0x25343b, 2.0));
    const moon = new THREE.DirectionalLight(0x89afc0, 2.8);
    moon.position.set(-7, 12, 9); moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.radius = 2; moon.shadow.normalBias = .035; moon.shadow.bias = -.00015;
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12; moon.shadow.camera.right = moon.shadow.camera.top = 12; scene.add(moon);
    const world = new THREE.Group(); scene.add(world);
    const matrix = new THREE.Matrix4();
    const texture = stoneTexture();
    const torchLights: THREE.PointLight[] = [];
    for (let i = 0; i < 4; i++) { const light = new THREE.PointLight(0xff9b46,16,18,1.6); torchLights.push(light); scene.add(light); }
    const player = makeKnight(); world.add(player);
    const fill = new THREE.PointLight(0x9bcdd1, 9, 12, 1.8); scene.add(fill);
    const playerRing = new THREE.Mesh(new THREE.RingGeometry(0.5,0.55,40),new THREE.MeshBasicMaterial({color:0xa1d8ce,transparent:true,opacity:0.45,depthWrite:false}));playerRing.rotation.x=-Math.PI/2;world.add(playerRing);
    const cameraFocus = new THREE.Vector3();
    const velocity = new THREE.Vector3(), facing = new THREE.Vector3(1, 0, -0.6).normalize();
    const attackFacing = facing.clone(), dashFacing = facing.clone();
    let bufferedFacing: THREE.Vector3 | null = null;
    const screenRight = new THREE.Vector3(11.5, 0, -9.2).normalize();
    const screenDown = new THREE.Vector3(9.2, 0, 11.5).normalize();
    player.rotation.y = Math.atan2(-facing.x, -facing.z);
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const sparkGeo = new THREE.TetrahedronGeometry(0.075, 0), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb24a, toneMapped: false });
    const burst = (at: THREE.Vector3, color = 0xffb24a, amount = 12) => { for (let i = 0; i < amount; i++) { const mesh = new THREE.Mesh(sparkGeo, color === 0xffb24a ? sparkMat : new THREE.MeshBasicMaterial({ color, toneMapped: false })); mesh.position.copy(at).add(new THREE.Vector3(0, 0.8, 0)); const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5; particles.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s), life: 0.35 + Math.random() * 0.3 }); world.add(mesh); } };
    const slash = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 28, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xfff0c6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    slash.rotation.x = -Math.PI / 2; slash.position.y = 0.72; world.add(slash);
    // A tapered sweep carries the blade direction through the contact pose.
    const slashPositions = slash.geometry.getAttribute('position');
    for(let i=0;i<slashPositions.count;i++){
      const x=slashPositions.getX(i),y=slashPositions.getY(i),angle=Math.atan2(y,x),radius=Math.hypot(x,y);
      const taper=THREE.MathUtils.clamp((angle+1.15)/2.3,0,1);
      const r=radius<1.05?1.15-(.025+.23*taper):1.15;
      slashPositions.setXY(i,Math.cos(angle)*r,Math.sin(angle)*r);
    }
    const trailGeo=new THREE.PlaneGeometry(.11,1.15);
    const dashTrails=Array.from({length:12},()=>{
      const m=new THREE.Mesh(trailGeo,new THREE.MeshBasicMaterial({color:0xa9e5db,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
      m.rotation.x=-Math.PI/2;m.userData.life=0;world.add(m);return m;
    });
    let trailCursor=0,trailClock=0;
    let pathCell = '';
    // An enemy past distance 22 is skipped outright, and the one that isn't picks its step from its four
    // neighbours, so nothing beyond 23 is ever read back: flooding to 24 is identical to flooding the whole
    // floor while touching ~1200 cells instead of 2-7k. Raise this alongside the activation radius below,
    // or pursuit will stall at the old edge.
    const PATH_RADIUS = 24;
    // Packed keys for the reason dungeon-floor packs its corridor cells: a Map keyed by a string built fresh
    // on each probe re-hashes every time, and the flood probes four times per cell.
    const pathKey = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);
    const distances = new Map<number,number>();
    const updatePaths = () => {
      const x = Math.round(player.position.x / TILE), z = Math.round(player.position.z / TILE), key = cellKey(x,z);
      if (pathCell === key) return;
      pathCell = key; distances.clear(); distances.set(pathKey(x,z),0);
      // Flat x,z,distance triples. The queue stays in non-decreasing distance, so the first node sitting at
      // the radius ends the whole flood rather than merely skipping its own expansion.
      const queue = [x,z,0];
      for (let i = 0; i < queue.length; i += 3) { const cx = queue[i], cz = queue[i + 1], distance = queue[i + 2]; if (distance >= PATH_RADIUS) break; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = cx + dx, nz = cz + dz, next = pathKey(nx,nz); if (!distances.has(next) && floor.cells.has(cellKey(nx,nz))) { distances.set(next,distance + 1); queue.push(nx,nz,distance + 1); } } }
    };
    // Only the shared texture, the knight and the lights outlive a floor; the rest is rebuilt per descent.
    const clearFloor = () => {
      atmosphere?.dispose();
      floorGroup.traverse((o) => { if (o instanceof THREE.Mesh) { if (!o.geometry.userData.shared) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      world.remove(floorGroup);
      particles.forEach(p => { world.remove(p.mesh); if (p.mesh.material !== sparkMat) (p.mesh.material as THREE.Material).dispose(); });
      particles.length = 0;
      dashTrails.forEach(m=>{m.userData.life=0;(m.material as THREE.MeshBasicMaterial).opacity=0;});
    };
    // An explicit seed replays a floor verbatim; without one the keep is new every descent.
    const buildFloor = (nextLevel: number, seed?: number) => {
      const clock = performance.now(); let mark = clock;
      const phase = (name: string) => { const now = performance.now(); buildMs[name] = +(now - mark).toFixed(1); mark = now; };
      buildMs = {};
      if (atmosphere) clearFloor();
      phase('dispose');
      level = nextLevel; floorStart = elapsed; floorKills = run.kills; floorXp = run.totalXp; features = [];
      gameStatus = 'playing'; setStatus('playing');
      floor = generateFloor(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], level);
      phase('generate');
      // Floor 1 is the run's fingerprint: keeping its seed is what lets a lost run be taken again.
      if (level === 1) { setRunSeed(floor.seed); writeSeed(floor.seed); }
      floorGroup = new THREE.Group(); world.add(floorGroup);
      swingHits.clear();
      visited = new Set([0]); cleared = new Set([0]); spineRooms = new Set(floor.spine);
      reached = 0; loot = 0; activeRoom = 0; pathCell = ''; distances.clear();
      const floorMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.98, emissive: 0x253b42, emissiveIntensity: 0.35 });
      weatherStone(floorMaterial);
      const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
      const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1.44, 2.8, 1.44), floorMaterial, stoneTiles.length);
      stoneTiles.forEach(({x,z,room},i)=>{matrix.makeTranslation(x*TILE,-1.38,z*TILE);tiles.setMatrixAt(i,matrix);const theme=room>=0?floor.rooms[room].theme:'keep';const color=new THREE.Color(theme==='ruins'?0x8b9480:theme==='flooded'?0x78908e:0x969185);color.multiplyScalar(.88+Math.abs(x*7+z*3)%5*.045);tiles.setColorAt(i,color);});
      tiles.receiveShadow=true;floorGroup.add(tiles);
      phase('tiles');
      const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.43,.2,.34),new THREE.MeshStandardMaterial({color:0x665040,roughness:.95}),bridgeTiles.length*4);
      bridgeTiles.forEach(({x,z},i)=>{for(let n=0;n<4;n++){matrix.makeTranslation(x*TILE,-.09,z*TILE+(n-1.5)*.365);planks.setMatrixAt(i*4+n,matrix);planks.setColorAt(i*4+n,new THREE.Color(n%2?0xbca17d:0xd0b68f));}});planks.receiveShadow=true;floorGroup.add(planks);
      const { minX, maxX, minZ, maxZ } = floor.bounds;
      tide = tidalMaterial();
      water = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX + 40) * TILE, (maxZ - minZ + 40) * TILE), tide.material);
      water.rotation.x = -Math.PI / 2; water.position.set((minX + maxX) * TILE / 2, -2.8, (minZ + maxZ) * TILE / 2); floorGroup.add(water);
      const borders: { x: number; z: number; horizontal: boolean }[] = [];
      floor.tiles.forEach(({ x, z }) => { for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!floor.cells.has(cellKey(x + dx,z + dz))) borders.push({ x: (x + dx * 0.5) * TILE, z: (z + dz * 0.5) * TILE, horizontal: dz !== 0 }); });
      // Low parapets keep the isometric view readable, including narrow bridges.
      const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.65, 1), new THREE.MeshStandardMaterial({ color: 0x252f35, roughness: 1 }), borders.length);
      borders.forEach((b,i) => { matrix.compose(new THREE.Vector3(b.x,0.15,b.z), new THREE.Quaternion(), new THREE.Vector3(b.horizontal ? TILE : 0.16,1,b.horizontal ? 0.16 : TILE)); walls.setMatrixAt(i,matrix); });
      walls.receiveShadow = true; floorGroup.add(walls);
      phase('walls');
      atmosphere = addAtmosphere(floorGroup, floor);
      for (const room of floor.rooms) {
        if (room.id === 0 || !['sanctuary', 'gauntlet'].includes(room.encounter)) continue;
        const shrine = room.encounter === 'sanctuary';
        for (const offset of shrine ? [0] : [-2.5, 0, 2.5]) {
          const mesh = new THREE.Mesh(new THREE.RingGeometry(shrine ? .9 : 1.58, shrine ? 1.35 : 1.8, 48), new THREE.MeshBasicMaterial({ color: shrine ? 0x83ffd7 : 0xff6c28, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false }));
          mesh.rotation.x = -Math.PI / 2; mesh.position.set(room.x * TILE + offset, .08, room.z * TILE);
          floorGroup.add(mesh); features.push({mesh, room: room.id, shrine, used: false, phase: 0, burned: false});
          if (!shrine) {
            const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.56,1.56,.035,32), new THREE.MeshStandardMaterial({color:0x241b17,metalness:.8,roughness:.65}));
            grate.position.copy(mesh.position); grate.position.y=.045; floorGroup.add(grate);
            for (let n=-3;n<=3;n++) {
              const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.sqrt(1.5**2-(n*.38)**2)*2,.04,.07),new THREE.MeshStandardMaterial({color:0x836445,metalness:.8,roughness:.5}));
              rail.position.set(mesh.position.x,.08,mesh.position.z+n*.38);floorGroup.add(rail);
            }
          }
          if (shrine) {
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.5), new THREE.MeshStandardMaterial({color:0x9affe0,emissive:0x48cba0,emissiveIntensity:2,metalness:.3,roughness:.2}));
            crystal.position.set(room.x*TILE,1.2,room.z*TILE); floorGroup.add(crystal); mesh.userData.crystal = crystal;
          }
        }
      }
      phase('atmosphere');
      enemyData = floor.spawns.map((spawn, index) => {
        const kind = spawn.kind;
        const maxHp = kind === 'warden' ? 4 : 2, tell = kind === 'warden' ? 0.72 : kind === 'stalker' ? 0.58 : 0.5;
        const group = makeSkeleton(kind === 'stalker' ? 1 : 0); group.position.set(spawn.x * TILE,0.03,spawn.z * TILE); group.visible = !spawn.ambush; floorGroup.add(group);
        if (kind === 'warden') { group.scale.setScalar(1.3); const crown = new THREE.Mesh(BONES.crown,new THREE.MeshStandardMaterial({color:0xc5a264,metalness:0.6,roughness:0.45}));crown.position.y=1.7;group.add(crown); }
        if (kind === 'stalker') group.scale.set(0.82,0.94,0.82);
        const cue = new THREE.Mesh(kind === 'stalker' ? new THREE.PlaneGeometry(5,1.7).translate(2.5,0,0) : BONES.cue,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xff522b:0xffae52,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));cue.rotation.x=-Math.PI/2;floorGroup.add(cue);
        const bar = new THREE.Mesh(BONES.bar,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false}));bar.renderOrder=10;floorGroup.add(bar);
        return { group, hp:maxHp, maxHp, kind, tell, damage:kind==='warden'?20:kind==='stalker'?8:12, cue, bar, speed:kind==='stalker'?3.2:kind==='warden'?1.65:2.2, cooldown:0.4+(index%3)*0.2, hitFlash:0, dead:false, phase:spawn.room*1.7+index*0.6, windup:0, lunge:0, aim:new THREE.Vector3(), room:spawn.room, awake:!spawn.ambush };
      });
      phase('enemies');
      player.position.set(floor.rooms[0].x * TILE, 0.03, floor.rooms[0].z * TILE);
      cameraFocus.copy(player.position);
      updatePaths();
      // Room fills are painted imperatively as rooms are explored, so the map has to be a new element
      // every build — keying it on the seed alone would keep a retried floor's old fills on screen.
      setFloorMap(floor); setFloorBuild(build => build + 1); setFloorLevel(level); setRoomName(floor.rooms[0].name);
      setVisitedCount(1); setPlundered(0); setAdvance(0);
      buildMs.total = +(performance.now() - clock).toFixed(1);
    };
    const descend = () => {
      if (gameStatus !== 'playing' || run.choosing || activeRoom !== floor.goal || !stairClear()) return;
      gameStatus = 'complete'; setStatus('complete'); keys.clear(); attackBuffer = 0; bufferedFacing = null; velocity.set(0,0,0);
      setFloorResult({kills: run.kills - floorKills, xp: run.totalXp - floorXp, seconds: Math.round(elapsed - floorStart)});
      setNotice(''); audio.play('win');
    };
    const continueDescent = () => {
      if (gameStatus !== 'complete') return;
      if (level >= FLOORS) { gameStatus = 'won'; setStatus('won'); return; }
      buildFloor(level + 1);
      heal(run, Math.round(run.maxHp * .25)); setHealth(run.hp);
      keys.clear(); attackTime = 0; dashTime = 0; attackBuffer = 0; audio.pause(false);
      burst(player.position, 0x8de9be, 22);
    };
    // A run is nothing but this closure's counters plus floor 1, so it restarts in place: reloading
    // would refetch the bundle and throw away the AudioContext and the GPU context for no gain.
    // Everything buildFloor(1) already rebuilds (floor, level, rooms, enemies, map, status) is left to it,
    // but the run must be fresh first because it snapshots kills and XP as the floor's baseline. A whole
    // new `run` is the point of createRun(): a field added to the sim can never be forgotten here.
    const restart = (seed?: number) => {
      run = createRun();
      attackTime = 0; dashTime = 0; dashCooldown = 0; attackBuffer = 0; hitStop = 0; hurtFlash = 0; shake = 0;
      walkPhase = 0; footstepTime = 0; rewardTime = 0; noticeTime = 0; trailClock = 0; trailCursor = 0;
      isPaused = false; keys.clear(); bufferedFacing = null; velocity.set(0, 0, 0);
      facing.set(1, 0, -0.6).normalize(); attackFacing.copy(facing); dashFacing.copy(facing);
      setHealth(run.hp); setMaxHealth(run.maxHp); setDefeated(0); setExperience(0); setXpReward(0);
      setRank(1); setRankXp(0); setRankNeed(rankCost(1)); setTaken([]); setBoonChoice([]);
      setNotice(''); setNoticeDetail(''); setFloorResult({ kills: 0, xp: 0, seconds: 0 });
      setPaused(false); setMapOpen(false);
      buildFloor(1, seed);
      player.rotation.set(0, Math.atan2(-facing.x, -facing.z), 0); player.userData.sword.rotation.y = 0;
      audio.pause(false);
    };
    // Read before floor 1 overwrites the stored seed, so "Last keep" still offers the previous visit's.
    const restoreSave = () => { setBest(readBest()); setPriorSeed(readSeed()); };
    restoreSave();
    buildFloor(1);
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
      facing.copy(dashFacing); dashTime = 0.18; dashCooldown = run.dashSpan;
      attackTime = 0; attackBuffer = 0; bufferedFacing = null; hitStop = 0;

    };
    const togglePause = () => {
      // Pausing on top of an open boon draft would stack two overlays; the draft already holds the world still.
      if (!hasStarted || gameStatus !== 'playing' || run.choosing) return;
      isPaused = !isPaused; setMapOpen(false); keys.clear(); attackBuffer = 0; bufferedFacing = null; setPaused(isPaused); audio.pause(isPaused);
    };
    const toggleMute = () => { isMuted = !isMuted; audio.mute(isMuted); setMuted(isMuted); };
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void mount.parentElement?.requestFullscreen?.().catch(() => undefined); };
    const keyDown = (e: KeyboardEvent) => {
      if (hasStarted && !isPaused && !run.choosing && gameStatus === 'playing' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat && e.code === 'Escape') { togglePause(); return; }
      if (!e.repeat && e.code === 'KeyM') { toggleMute(); return; }
      if (!e.repeat && e.code === 'KeyF') { fullscreen(); return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      keys.add(e.code); if (e.repeat) return;
      if (e.code === 'Space') requestAttack();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') requestDash();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const clearInput = () => { keys.clear(); attackBuffer = 0; bufferedFacing = null; };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'continue') { continueDescent(); return; }
      // `restart` opens a fresh keep, `restart:<seed>` takes the same one again; a junk seed just means fresh.
      if (detail === 'restart' || detail.startsWith('restart:')) { const seed = Number.parseInt(detail.slice(8), 10); restart(Number.isNaN(seed) ? undefined : seed >>> 0); return; }
      if (detail === 'start') { if (hasStarted) return; floorStart = elapsed; hasStarted = true; setStarted(true); audio.start(); return; }
      if (detail === 'map') { if (!hasStarted || run.choosing || gameStatus !== 'playing') return; if (!isPaused) togglePause(); setMapOpen(true); return; }
      if (detail === 'pause') { togglePause(); return; }
      if (detail === 'mute') { toggleMute(); return; }
      if (detail === 'fullscreen') { fullscreen(); return; }
      if (detail.startsWith('boon:')) { chooseBoon(detail.slice(5)); return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
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
    // three.js restores the GPU context on its own; what it cannot do is stop the simulation, so without
    // this the knight goes on taking damage behind a frozen image. Restoring never resumes by itself —
    // whoever was pulled away picks the moment to step back into the fight.
    const contextLost = () => { setDisplayLost(true); blur(); };
    const contextRestored = () => setDisplayLost(false);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    let last = performance.now(), raf = 0;
    const update = (frameDt: number) => {
      if (isPaused || run.choosing || gameStatus === 'complete') return;
      elapsed += frameDt; const t = elapsed;
      const dt = hitStop > 0 ? 0 : frameDt; hitStop = Math.max(0, hitStop - frameDt);
      torchLights.forEach((l, i) => { l.intensity = 16 + Math.sin(t * 9 + i * 2.2) * 1.4 + Math.sin(t * 17) * 0.5; });
      if (water) water.position.y = -2.8 + Math.sin(t * 0.9) * 0.05;
      if (tide) tide.time.value=t;
      animateCloth(player.userData.cape,t,dashTime>0?.32:velocity.lengthSq()>0?.16:.045);
      trailClock-=dt;
      if(dashTime>0 && trailClock<=0){
        const trail=dashTrails[trailCursor++%dashTrails.length];trail.position.copy(player.position);trail.position.y=.09;
        trail.rotation.z=Math.atan2(-dashFacing.z,dashFacing.x)+Math.PI/2;trail.userData.life=.26;trailClock=.025;
      }
      dashTrails.forEach(m=>{m.userData.life=Math.max(0,m.userData.life-dt);(m.material as THREE.MeshBasicMaterial).opacity=m.userData.life*1.8;m.scale.x=.6+m.userData.life*2;});
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
        const threatened = enemyData.some(e => !e.dead && e.awake && e.group.position.distanceToSquared(player.position) < 100);
        const speed = dashTime > 0 ? 12 : attackTime > 0 ? 3.2 : threatened ? 5.8 : 8.5;
        velocity.copy(dashTime > 0 ? dashFacing : input).multiplyScalar(speed);
        moveOnFloor(floor.cells, player.position, velocity.x * dt, velocity.z * dt);
        updatePaths();
        const roomId = floor.roomByCell.get(cellKey(Math.round(player.position.x/TILE),Math.round(player.position.z/TILE))) ?? -1;
        const currentRoom = floor.rooms[roomId];
        const entered = activeRoom !== roomId;
        if (entered) { activeRoom = roomId; setRoomName(currentRoom?.name ?? 'Passage'); }
        if (currentRoom && entered) {
          if (!visited.has(roomId)) { visited.add(roomId); setVisitedCount(visited.size); document.getElementById(`map-room-${roomId}`)?.setAttribute('fill', '#6a9995'); }
          // Only the trunk counts as progress; a dead end must never read as ground gained.
          if (spineRooms.has(currentRoom.id) && currentRoom.depth > reached) { reached = currentRoom.depth; setAdvance(reached); }
          if (currentRoom.id === floor.goal && !stairClear()) { setNotice(`${goalRoom().name} · wardens bar the stair`); setNoticeDetail('Break them to leave the keep'); noticeTime = 4; }
          const sprung = enemyData.filter(e => e.room === currentRoom.id && !e.awake && !e.dead);
          if (sprung.length) {
            sprung.forEach(e => { e.awake = true; e.group.visible = true; e.cooldown = Math.max(e.cooldown, 0.9); burst(e.group.position, 0x7fd6c6, 10); });
            setNotice(`${currentRoom.name} · ambush`); setNoticeDetail(`${sprung.length} rise from the silt`); noticeTime = 3; audio.play('warn'); shake = 0.12;
          }
        }
        descend();
        if (gameStatus !== 'playing') return;
        for (const feature of features) {
          const near = Math.hypot(player.position.x-feature.mesh.position.x, player.position.z-feature.mesh.position.z);
          if (feature.shrine) {
            const crystal = feature.mesh.userData.crystal as THREE.Mesh<THREE.OctahedronGeometry,THREE.MeshStandardMaterial>;
            crystal.rotation.y = t*.65; crystal.position.y = 1.25+Math.sin(t*2)*.12; crystal.material.emissiveIntensity = feature.used ? .15 : 2;
            feature.mesh.material.opacity = feature.used ? .12 : .5 + Math.sin(t*3)*.2;
            if (!feature.used && near < 1.5 && run.hp < run.maxHp) { feature.used = true; heal(run, 35); setHealth(run.hp); audio.play('clear'); burst(player.position,0x83ffd7,20); setNotice('+35 vitality'); setNoticeDetail(''); noticeTime = 2; }
          } else {
            const wasFiring = feature.phase > 2.6;
            feature.phase = (t + feature.room*.7) % 3.6;
            if (!wasFiring && feature.phase > 2.6 && near < 20) { burst(feature.mesh.position, 0xff8c38, 16); audio.play('warn'); }
            const firing = feature.phase > 2.6;
            feature.mesh.material.opacity = firing ? .85 : .12 + feature.phase*.14;
            feature.mesh.material.color.setHex(firing ? 0xffe49c : 0xff6c28);
            // The flare itself throttles the burn — one tick per flare, cleared when the ring goes cold.
            // It used to be the 0.65s hurt timer doing this job, which is why a hazard tick also bought
            // more immunity than a sword: the two roles are now separate.
            if (!firing) feature.burned = false;
            else if (!feature.burned && near < 1.8 && hurt(run, 10, { dashing: dashTime > 0 })) {
              feature.burned = true; setHealth(run.hp); hurtFlash = .65; shake = .1; audio.play('hurt'); burst(player.position,0xff782c,8);
              if(run.hp===0){gameStatus='lost';setStatus('lost');}
            }
          }
        }

        if (moving) { footstepTime -= dt; if (footstepTime <= 0 && dashTime <= 0) { audio.play('step'); footstepTime = 0.29; } walkPhase += dt * speed * 3.3; }
        const stride = moving && dashTime <= 0 ? Math.sin(walkPhase) * 0.6 : 0;
        player.userData.legs.forEach((leg: THREE.Group, i: number) => { leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, i ? -stride : stride, 28, dt); });
        player.position.y = 0.03 + (moving ? Math.abs(Math.sin(walkPhase)) * 0.055 : Math.sin(t*2.4)*.012);
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
          slash.rotation.z = Math.atan2(-attackFacing.z, attackFacing.x) + swing*.24;
          const active = age >= 0.065 && age <= 0.175;
          (slash.material as THREE.MeshBasicMaterial).opacity = active ? 0.65 : Math.max(0, 1 - (age - 0.175) / 0.09) * (age > 0.175 ? 0.35 : 0);
          slash.scale.setScalar(1.45+run.reach*.55);
          if (active) enemyData.forEach((enemy) => {
            if (gameStatus !== 'playing' || enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            if (delta.length() < 1.8 + run.reach && delta.normalize().dot(attackFacing) > 0.35 - run.reach * 0.12) {
              audio.play('hit');
              swingHits.add(enemy); enemy.hp -= run.strike; enemy.hitFlash = 0.2; if (enemy.kind !== 'warden' && enemy.windup > .18) enemy.windup = 0;
              enemy.cooldown = Math.max(enemy.cooldown, 0.4);
              moveOnFloor(floor.cells, enemy.group.position, delta.x * (enemy.kind === 'warden' ? 0.1 : 0.38), delta.z * (enemy.kind === 'warden' ? 0.1 : 0.38)); burst(enemy.group.position, 0xffb24a, 7); shake = 0.07; hitStop = 0.035;
              if (enemy.hp <= 0) { enemy.dead = true; award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills); if (!cleared.has(enemy.room) && enemyData.every(e => e.room !== enemy.room || e.dead)) {
                cleared.add(enemy.room);
                const room = floor.rooms[enemy.room], detour = room.role === 'branch';
                award(clearRoomReward(run, detour));
                if (detour) { loot++; setPlundered(loot); }
                setNotice(`${room.name} · ${detour ? 'dead end plundered' : 'cleansed'}`);
                setNoticeDetail(detour ? `+${XP_DEAD_END} XP · +30 vitality` : '+12 vitality restored');
                noticeTime = 3.5; rewardTime = 1.4; audio.play('clear'); burst(player.position,0x8de9be,18);
                document.getElementById(`map-room-${enemy.room}`)?.setAttribute('fill', detour ? '#c2b273' : '#a8d5b0');
              } descend(); }
            }
          });
        } else { player.userData.sword.rotation.y = THREE.MathUtils.damp(player.userData.sword.rotation.y, 0, 24, dt); player.userData.body.rotation.z = 0; (slash.material as THREE.MeshBasicMaterial).opacity = 0; }
        enemyData.forEach((enemy) => {
          if (!enemy.awake) { enemy.cue.visible = false; enemy.bar.visible = false; return; }
          enemy.cue.visible = !enemy.dead && (enemy.windup > 0 || enemy.lunge > 0); enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;
          enemy.bar.position.copy(enemy.group.position).add(new THREE.Vector3(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); enemy.bar.scale.x = enemy.hp / enemy.maxHp;
          enemy.cue.scale.setScalar(enemy.kind === 'warden' ? 1.7 : 1);
          enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);
          (enemy.cue.material as THREE.MeshBasicMaterial).opacity = 0.2 + (1 - enemy.windup / enemy.tell) * 0.5;
          if (enemy.dead) { enemy.group.rotation.z += dt * 5; enemy.group.scale.multiplyScalar(Math.max(0.001, 1 - dt * 4.5)); return; }
          enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;
          const ex = Math.round(enemy.group.position.x / TILE), ez = Math.round(enemy.group.position.z / TILE);
          if ((distances.get(pathKey(ex,ez)) ?? Infinity) > (enemy.room === activeRoom ? 22 : 10)) return;
          const toPlayer = player.position.clone().sub(enemy.group.position); toPlayer.y = 0; const dist = toPlayer.length();
          const strikeRange = enemy.kind === 'warden' ? 2.55 : 1.55;
          const hurtPlayer = () => {
            if (gameStatus !== 'playing' || !hurt(run, enemy.damage, { dashing: dashTime > 0, warded: true })) return;
            setHealth(run.hp);
            audio.play('hurt'); hurtFlash=.35; shake=.12; burst(player.position,0xff4c2f,8);
            if(run.hp===0){gameStatus='lost';setStatus('lost');}
          };
          if (enemy.lunge > 0) {
            const before = enemy.group.position.clone();
            moveOnFloor(floor.cells,enemy.group.position,enemy.aim.x*13*dt,enemy.aim.z*13*dt);
            enemy.lunge = Math.max(0,enemy.lunge-dt);
            // Swept contact prevents a fast pounce from tunnelling through the knight.
            const travel = enemy.group.position.clone().sub(before), toward = player.position.clone().sub(before); travel.y=0; toward.y=0;
            const fraction = THREE.MathUtils.clamp(toward.dot(travel)/Math.max(.0001,travel.lengthSq()),0,1);
            const closest = before.addScaledVector(travel,fraction); closest.y=player.position.y;
            if(closest.distanceTo(player.position)<.85){hurtPlayer();enemy.lunge=0;}
            enemy.group.position.y=.03+Math.sin(enemy.lunge/.32*Math.PI)*.3;
            enemy.group.rotation.x=-.3; enemy.group.userData.weapon.rotation.x=.55;
            enemy.group.userData.limbs.forEach((limb:THREE.Mesh,i:number)=>{limb.rotation.x=i%2?.75:-.75;});
            return;
          }
          if (enemy.windup > 0) {
            enemy.windup = Math.max(0, enemy.windup - dt);
            enemy.group.userData.weapon.rotation.x = -0.4 - Math.sin((1 - enemy.windup / enemy.tell) * Math.PI / 2) * 1.7;
            if (enemy.windup === 0) {
              enemy.cooldown = enemy.kind === 'stalker' ? 1.7 : enemy.kind === 'warden' ? 1.6 : 1.25;
              enemy.group.userData.weapon.rotation.x = 0.55;
              if (enemy.kind === 'stalker') { enemy.lunge = .32; audio.play('dash'); }
              else if (dist < strikeRange && hasClearPath(floor.cells,enemy.group.position,player.position) && toPlayer.normalize().dot(enemy.aim) > .45) hurtPlayer();
            }
          } else {
            enemy.group.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z);
            enemy.group.userData.weapon.rotation.x = THREE.MathUtils.damp(enemy.group.userData.weapon.rotation.x, -0.4, 10, dt);
            if (enemy.hitFlash <= 0) {
              const attackDistance = enemy.kind === 'stalker' ? 4.2 : enemy.kind === 'warden' ? 2.2 : 1.15;
              const clearAttackLine = dist <= attackDistance && hasClearPath(floor.cells,enemy.group.position,player.position);
              if (clearAttackLine && enemy.cooldown <= 0) {
                enemy.windup=enemy.tell; audio.play('warn'); enemy.aim.copy(toPlayer).normalize();
              } else if ((dist > (enemy.kind === 'warden' ? 2.0 : 1.15) || !clearAttackLine) && (enemy.kind !== 'stalker' || enemy.cooldown < .9)) {
                const direction = toPlayer.clone();
                if (dist > TILE * 1.5 || !clearAttackLine) {
                  const next = [[ex + 1,ez],[ex - 1,ez],[ex,ez + 1],[ex,ez - 1]].filter(([x,z]) => floor.cells.has(cellKey(x,z))).sort((a,b) => (distances.get(pathKey(a[0],a[1])) ?? Infinity) - (distances.get(pathKey(b[0],b[1])) ?? Infinity))[0];
                  if (next) direction.set(next[0] * TILE - enemy.group.position.x,0,next[1] * TILE - enemy.group.position.z);
                }
                direction.normalize(); moveOnFloor(floor.cells,enemy.group.position,direction.x * enemy.speed * dt,direction.z * enemy.speed * dt);
              }

            }
          }
          enemy.group.position.y = 0.03 + Math.abs(Math.sin(t * 6 + enemy.phase)) * 0.045;
          const walking=dist>1.15&&enemy.windup<=0&&enemy.hitFlash<=0;
          const gait=walking?Math.sin(t*enemy.speed*5+enemy.phase)*.48:0;
          enemy.group.userData.limbs.forEach((limb:THREE.Mesh,i:number)=>{limb.rotation.x=THREE.MathUtils.damp(limb.rotation.x,(i<2?1:-1)*(i%2?gait:-gait*.55),18,dt);});
          enemy.group.rotation.x=THREE.MathUtils.damp(enemy.group.rotation.x,enemy.hitFlash>0?-.2:enemy.windup>0?-.12:0,18,dt);
          enemy.group.userData.skull.rotation.y=Math.sin(t*1.5+enemy.phase)*.06;
          enemy.group.userData.shield.rotation.z=enemy.windup>0?-.25:gait*.16;
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
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt); tickRun(run, dt);
      atmosphere?.update(t,player.position,cleared);
      const nearest = [...(atmosphere?.torchPositions ?? [])].sort((a,b)=>a.distanceToSquared(player.position)-b.distanceToSquared(player.position));
      torchLights.forEach((light,i)=>light.position.copy(nearest[i]));
      fill.position.copy(player.position).add(new THREE.Vector3(0,4,1));
      playerRing.position.set(player.position.x,0.04,player.position.z); (playerRing.material as THREE.MeshBasicMaterial).opacity = dashTime > 0 ? 0.85 : 0.32;
      moon.position.set(player.position.x - 7,12,player.position.z + 9); moon.target.position.set(player.position.x,0,player.position.z); moon.target.updateMatrixWorld();
      mapPlayer.current?.setAttribute('cx', String(player.position.x / TILE)); mapPlayer.current?.setAttribute('cy', String(player.position.z / TILE));
      if (dashMeter.current) dashMeter.current.value = Math.max(0,1-dashCooldown/run.dashSpan);
      const target = player.position.clone().addScaledVector(velocity,0.12); cameraFocus.lerp(target,1-Math.exp(-8*frameDt));
      camera.position.set(cameraFocus.x + 9.2,12.5,cameraFocus.z + 11.5);
      if (shake > 0) camera.position.add(new THREE.Vector3(Math.sin(t*95)*shake,0,Math.cos(t*83)*shake));
      camera.lookAt(cameraFocus.x,0,cameraFocus.z);
      renderer.domElement.style.filter = hurtFlash > 0 ? `sepia(.3) saturate(1.3) brightness(${0.9 + hurtFlash * 0.3})` : '';
    };
    const hooks = window as Window & {
      advanceTime?: (ms: number, draw?: boolean) => void;
      render_game_to_text?: () => string;
      dungeonTest?: { teleport: (x: number, z: number) => void; descend: () => void; buildFloor: (level: number) => void; grantXp: (amount: number) => void };
    };
    // Drive the run from the console or a browser test: see tests/README.md for the usual recipes.
    hooks.dungeonTest = {
      teleport: (x, z) => player.position.set(x, 0.03, z),
      descend: () => buildFloor(Math.min(FLOORS, level + 1)),
      buildFloor: (nextLevel) => buildFloor(nextLevel),
      grantXp: (amount) => award(grantXp(run, amount)),
    };
    hooks.advanceTime = (ms, draw = true) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      if (draw) renderer.render(scene, camera);
    };
    hooks.render_game_to_text = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, boonOffer: run.choosing, muted: isMuted, roomName: floor.rooms[activeRoom]?.name ?? 'Passage',
      health: run.hp, maxHealth: run.maxHp, rank: run.rankLevel, boons: { strike: run.strike, reach: run.reach, draught: run.draught, dashSpan: run.dashSpan, guardAgainst: run.guardAgainst }, remaining: floor.guardCount - enemyData.filter(e => e.dead).length,
      objective: { floor: level, floors: FLOORS, goal: goalRoom().name, goalRoom: floor.goal, halls: reached, goalDepth: goalRoom().depth, atStair: activeRoom === floor.goal, stairClear: stairClear(), deadEndsPlundered: loot },
      experience: { total: run.totalXp, perEnemy: XP_PER_ENEMY, intoRank: run.rankProgress, rankCost: rankCost(run.rankLevel), resetsOnNewRun: true },
      render: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
      features: features.map(f => ({room:f.room, shrine:f.shrine, used:f.used, burned:f.burned, phase:f.phase, x:f.mesh.position.x,z:f.mesh.position.z,radius:f.shrine?1.5:1.8})),
      buildMs,
      floor: { level, waterfalls: atmosphere?.waterfalls, seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, start: floor.start, goal: floor.goal, spine: floor.spine, visited: [...visited], cleared: [...cleared] },
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashTime, dashCooldown, invulnerable: run.invuln, hurtFlash, swordAngle: player.userData.sword.rotation.y, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, kind: e.kind, windup: e.windup, lunge: e.lunge, cooldown: e.cooldown, aim: {x:e.aim.x,z:e.aim.z}, room: e.room, awake: e.awake })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      if (!manualTime && !document.hidden) { update(Math.min((now - last) / 1000, 0.04)); renderer.render(scene, camera); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = w < 600 ? 6.3 : 7.2; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener('resize', resize); resize(); setReady(true);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('webglcontextrestored', contextRestored); audio.dispose(); atmosphere?.dispose(); texture.dispose(); delete hooks.advanceTime; delete hooks.render_game_to_text; delete hooks.dungeonTest; scene.traverse((o) => { if (o instanceof THREE.Mesh) { if (!o.geometry.userData.shared) o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const roomCount = floorMap?.rooms.length ?? 0;
  const goalName = floorMap?.rooms[floorMap.goal].name ?? 'The Sunken Stair';
  const goalDepth = floorMap?.rooms[floorMap.goal].depth ?? 0;
  const deadEnds = floorMap?.rooms.filter(r => r.role === 'branch').length ?? 0;
  const mapAngle = Math.atan2(9.2,11.5), mapCos = Math.cos(mapAngle), mapSin = Math.sin(mapAngle);
  const mapCorners = floorMap ? [[floorMap.bounds.minX,floorMap.bounds.minZ],[floorMap.bounds.maxX,floorMap.bounds.minZ],[floorMap.bounds.minX,floorMap.bounds.maxZ],[floorMap.bounds.maxX,floorMap.bounds.maxZ]].map(([x,z])=>({x:x*mapCos-z*mapSin,y:x*mapSin+z*mapCos})) : [{x:0,y:0}];
  const mapBounds = {x:Math.min(...mapCorners.map(p=>p.x))-4,y:Math.min(...mapCorners.map(p=>p.y))-4,width:Math.max(...mapCorners.map(p=>p.x))-Math.min(...mapCorners.map(p=>p.x))+8,height:Math.max(...mapCorners.map(p=>p.y))-Math.min(...mapCorners.map(p=>p.y))+8};
  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  return (
    <main className={`game-shell${mapOpen ? ' map-expanded' : ''}${displayFailed ? ' no-display' : ''}`}>
      <div ref={mountRef} className="game-canvas" aria-label="Procedural isometric dungeon floor" />
      <header className="game-title"><span>{floorLevel} / {FLOORS} · {roomName}</span></header>
      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || status !== 'playing' || boonChoice.length > 0} aria-label="Pause game">☰</button></nav>
      <section className="hud" aria-label="Player status"><div className="health-row"><span>♥</span><b>{health}<small>/{maxHealth}</small></b></div><div className="health-track" aria-label="Vitality"><i style={{ width: `${Math.max(0, health / maxHealth * 100)}%` }} /></div><div className="dash-status"><progress ref={dashMeter} max="1" value="1" aria-label="Dash readiness" /></div><progress className="xp-track" aria-label="Progress to the next boon" max={rankNeed} value={rankXp} /></section>
      {floorMap && <button className="floor-map" disabled={!started || status !== 'playing' || boonChoice.length > 0} onClick={() => action(mapOpen ? 'pause' : 'map')} aria-label={mapOpen ? 'Close floor map' : 'Open floor map'}><svg key={floorBuild} viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.width} ${mapBounds.height}`}><g transform={`rotate(${mapAngle*180/Math.PI})`}>
        <path d={floorMap.tiles.map(t => `M${t.x - 0.5},${t.z - 0.5}h1v1h-1z`).join('')} fill="#334e56" />
        {floorMap.rooms.map(r => <path key={r.id} id={`map-room-${r.id}`} d={floorMap.tiles.filter(t=>t.room===r.id).map(t=>`M${t.x-.5},${t.z-.5}h1v1h-1z`).join('')} fill={r.id===0?'#6a9995':r.role==='goal'?'#7a5f3c':'#3e6066'} />)}
        <circle cx={floorMap.rooms[floorMap.goal].x} cy={floorMap.rooms[floorMap.goal].z} r="3.4" fill="none" stroke="#ffc573" strokeWidth="0.9" opacity="0.8" />
        <circle ref={mapPlayer} cx={floorMap.rooms[0].x} cy={floorMap.rooms[0].z} r="1.8" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </g></svg></button>}
      {notice && started && !paused && status === 'playing' && boonChoice.length === 0 && <output className="chamber-notice"><b>{notice.split(' · ').pop()}</b></output>}
      {!displayFailed && (!started || (paused && !mapOpen)) && <div className="intro-screen"><section className="intro-card"><span className="end-kicker">{paused ? `FLOOR ${floorLevel} · ${roomName}` : 'THE DROWNED KEEP'}</span><h1>{paused ? 'Paused' : <>Below<br /><em>the tide.</em></>}</h1>
        {paused && <p>{advance} / {goalDepth} halls · {visitedCount} / {roomCount} explored · {plundered} / {deadEnds} plundered<br />Rank {rank} · {experience} XP · {rankXp} / {rankNeed} to next boon{xpReward > 0 ? ` · +${xpReward} XP` : ''}</p>}
        {!paused && best && <p className="best-run">Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</p>}
        <button className="primary-action" disabled={!ready} onClick={() => action(paused ? 'pause' : 'start')}>{!ready ? 'LOADING…' : paused ? 'RESUME' : 'ENTER THE KEEP'} <span>→</span></button>
        <details className="menu-details"><summary>Controls & journey</summary><div className="intro-controls"><span><kbd>WASD / ↑↓←→</kbd> Move</span><span><kbd>SPACE</kbd> Hold to strike</span><span><kbd>SHIFT</kbd> Dodge</span><span><kbd>ESC</kbd> Pause</span><span><kbd>F</kbd> Fullscreen</span></div><p>Reach {goalName}. Defeat the stair wardens to descend. Cyan shrines heal once; amber circles flare before they burn. Dodge through them. Side chambers grant XP and vitality.</p>{taken.length > 0 && <p>{taken.join(' · ')}</p>}</details>
        <div className="menu-settings">{started && <button onClick={() => action('map')}>Map</button>}<button onClick={() => action('mute')}>{muted ? 'Sound off' : 'Sound on'}</button><button onClick={() => action('fullscreen')}>Fullscreen</button>{!started && priorSeed !== null && <button onClick={() => action(`restart:${priorSeed}`)}>Last keep</button>}</div>
      </section></div>}
      {mapOpen && <div className="map-screen"><h1>Floor {floorLevel}</h1><p>Gold ring: stair · Bright rooms: explored</p><button className="primary-action" onClick={() => action('pause')}>RESUME</button></div>}
      {status === 'complete' && <div className="end-screen success-screen"><div className="end-card"><span className="success-sigil">✦</span><span className="end-kicker">FLOOR {floorLevel} COMPLETE</span><h1>The watch falls silent.</h1><div className="floor-results"><span><strong>{floorResult.kills}</strong>guards felled</span><span><strong>{floorResult.xp}</strong>XP earned</span><span><strong>{Math.floor(floorResult.seconds / 60)}:{String(floorResult.seconds % 60).padStart(2,'0')}</strong>elapsed</span></div><button onClick={() => action('continue')}>{floorLevel < FLOORS ? 'DESCEND TO FLOOR ' + (floorLevel + 1) : 'STEP INTO THE DAWN'} →</button>{floorLevel < FLOORS && <p className="recovery-note">Recover 25% vitality on descent</p>}</div></div>}
      {boonChoice.length > 0 && status === 'playing' && <div className="end-screen boon-screen"><div className="end-card boon-card">
        <span className="end-kicker">RANK {rank} · CHOOSE A BOON</span><h1>The tide gives back.</h1>
        <div className="boon-options">{boonChoice.map(boon => <button key={boon.id} className="boon-option" onClick={() => action(`boon:${boon.id}`)}><strong>{boon.name}</strong><span>{boon.detail}</span></button>)}</div>
      </div></div>}
      {(status === 'won' || status === 'lost') && <div className="end-screen"><div className="end-card"><span className="end-kicker">{status === 'won' ? 'THE KEEP IS BEHIND YOU' : `FLOOR ${floorLevel} · FAILED`}</span><h1>{status === 'won' ? 'You climb into the dawn.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'Three floors of the drowned watch lie still behind you.' : 'Steel yourself and enter once more.'}</p><div className="xp-summary"><strong>{experience} XP earned</strong><span>Floor {floorLevel} of {FLOORS} · rank {rank} · {defeated} guards felled · XP resets on a new run</span>{best && <small>Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</small>}</div><button onClick={() => action('restart')}>NEW DESCENT</button>{status === 'lost' && runSeed !== null && <button className="seed-retry" onClick={() => action(`restart:${runSeed}`)}>SAME KEEP</button>}</div></div>}
      {/* Plain markup on purpose: the canvas was never mounted, so this is the only thing left to look at. */}
      {displayFailed && <div className="end-screen display-failed"><div className="end-card"><span className="end-kicker">THE GATE STAYS SHUT</span><h1>No light to see by.</h1><p>This browser could not open a 3D display, so the keep cannot be drawn. That most often means hardware acceleration is switched off in the browser&rsquo;s settings.</p></div></div>}
      {displayLost && <output className="display-notice">Display interrupted · the descent is paused</output>}
      <div className="touch-pad" aria-label="Touch movement controls">{['up', 'left', 'down', 'right'].map((dir) => <button key={dir} className={dir} aria-label={`Move ${dir}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action(`move:${dir}`); }} onLostPointerCapture={() => action(`stop:${dir}`)} onPointerUp={() => action(`stop:${dir}`)} onPointerCancel={() => action(`stop:${dir}`)}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</button>)}</div>
      <div className="touch-actions"><button onPointerDown={() => action('dash')}>DASH</button><button className="strike" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-attack'); }} onPointerUp={() => action('release-attack')} onPointerCancel={() => action('release-attack')} onLostPointerCapture={() => action('release-attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
