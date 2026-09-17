'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { vaultEnvironment } from './dungeon-art';
import { enemyDetails, knightDetails } from './dungeon-characters';
import { impactEffects } from './dungeon-impact';
import { playerCloakGeometry } from './dungeon-cloak';
import { advanceDeath, startDeath, type DeathAnimation } from './dungeon-death';
import { addAtmosphere, stoneTexture } from './dungeon-atmosphere';
import { createDungeonAudio } from './dungeon-audio';
import { animateCloth, tidalMaterial, weatherStone } from './dungeon-motion';
import { canStand, generateFloor, moveOnFloor, cellKey, TILE } from './dungeon-floor';
import { canAbortSwing, DASH_BUFFER, swordContacts } from './dungeon-combat';
import { decideEnemy, enemyStats, interruptsWindup, separateCrowd } from './dungeon-enemy';
import { enemyPose } from './dungeon-enemy-pose';
import { playerAttackPose } from './dungeon-attack-pose';
import { TIDEBLADE, type Weapon } from './dungeon-weapon';
import { playerRunPose, strideRate } from './dungeon-run-pose';
import { weaponTrail } from './dungeon-weapon-trail';
import { ACTIONS, appendRun, betterRun, bindKey, defaultSettings, readBest, readRuns, readSeed, readSettings, RESERVED, summariseRuns, writeBest, writeRuns, writeSeed, writeSettings, type Action, type BestRun, type RunCause, type RunEnd, type Settings } from './dungeon-save';
import { clearRoomReward, createRun, draftBoons, grantXp, heal, hurt, rankCost, resolveKill, STAIR_DWELL, STAIR_RADIUS, stairDwellStep, takeBoon, tickRun, XP_DEAD_END, XP_PER_ENEMY, type Boon, type Reward } from './dungeon-sim';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; death: DeathAnimation | null; phase: number; windup: number; lunge: number; aim: THREE.Vector3; room: number; kind: 'guard' | 'stalker' | 'warden'; awake: boolean; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh; attackAge: number; trails: { effect: ReturnType<typeof weaponTrail>; anchor: THREE.Object3D; inner: THREE.Vector3; tip: THREE.Vector3 }[] };
// Development-only test fixture payload: which existing actors to move, and to what. Deliberately narrow —
// no code, no arbitrary paths, no new combat rules.
type CombatFixture = {
  health?: number;
  enemies?: { index: number; x?: number; z?: number; hp?: number; windup?: number; cooldown?: number; aim?: { x: number; z: number } }[];
};
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
// Keys the browser acts on itself — scrolling, quick-find, back-navigation. Only ever swallowed while one
// of them is actually bound to something, so the list follows a rebind instead of being frozen at the
// defaults: an arrow freed by a rebind goes back to scrolling the page, and a newly bound PageDown stops.
// Tab is deliberately absent. Trapping it would cost a keyboard-only player the way out of the canvas.
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Slash', 'Quote']);
const ACTION_LABELS: Record<Action, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', attack: 'Strike', dash: 'Dodge', pause: 'Pause', mute: 'Sound', fullscreen: 'Fullscreen' };
// One funnel for every settings change: React state for the card, storage for the next visit, and the ref
// the render loop reads, all in the same breath, so a second change in the same tick builds on the first
// rather than on a render that has not happened yet. Built from a ref and a setState — both stable for the
// life of the mount — so the world's one long-lived closure can hold its own copy and never go stale.
const changeSettings = (ref: { current: Settings }, set: (next: Settings) => void) => (patch: Partial<Settings>) => {
  const next = { ...ref.current, ...patch };
  ref.current = next; writeSettings(next); set(next);
};
// A KeyboardEvent.code is a hardware position, not a legend, and 'KeyW' on the card would be nonsense to
// the AZERTY player this exists for. `key` is the legend but is unstable under modifiers, so the code is
// shortened where its tail is already the character and left whole where it is not.
const keyLabel = (code: string) => code.startsWith('Key') || code.startsWith('Digit') ? code.replace(/^(Key|Digit)/, '') : code.startsWith('Arrow') ? ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[code] ?? code : code.replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$1');
// Deduplicated after labelling, not before: the two shift keys are distinct codes and one legend, and
// "Shift / Shift" tells a player nothing except that the card is not thinking.
const bindLabel = (codes: string[], join = ' / ') => [...new Set(codes.map(keyLabel))].join(join);

function makeKnight() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x202b32, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.48, metalness: 0.35, flatShading: true });
  const iron = new THREE.MeshStandardMaterial({ color: 0x66747b, roughness: .58, metalness: .45, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc49a54, roughness: .5, metalness: .5 });
  const shadow = new THREE.MeshStandardMaterial({ color: 0x080f14, roughness: 1 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa52c34, roughness: 0.9, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5b3728, roughness: 1 });
  // Bevelled, cut plates keep the reference's broad painted facets readable
  // at gameplay scale. Every decorative part stays on its existing joint.
  const plate=(outline:number[][],depth:number,material:THREE.Material)=>{
    const shape=new THREE.Shape();outline.forEach(([x,y],i)=>{if(i)shape.lineTo(x,y);else shape.moveTo(x,y);});shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.015,bevelThickness:.012,bevelSegments:1,steps:1,curveSegments:1});
    geometry.translate(0,0,-depth/2);return new THREE.Mesh(geometry,material);
  };
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.32,.28,.63,8), dark);
  body.position.y = .81;
  const head = new THREE.Group();head.position.y=1.37;
  const helmet=new THREE.Mesh(new THREE.CylinderGeometry(.16,.28,.39,6),steel);helmet.position.y=.045;helmet.rotation.y=Math.PI/6;
  const crown=plate([[-.23,.16],[-.1,.29],[.035,.34],[.23,.16],[.22,.06],[-.22,.06]],.23,steel);crown.position.z=.005;
  const face=plate([[-.24,.14],[.24,.14],[.22,-.16],[.09,-.23],[-.09,-.23],[-.22,-.16]],.065,steel);face.position.z=-.215;
  const visor = new THREE.Group();visor.position.set(0,0,-.264);
  for(const side of [-1,1]){const slit=new THREE.Mesh(new THREE.BoxGeometry(.175,.052,.018),shadow);slit.position.set(side*.116,.02,0);slit.rotation.z=side*.08;visor.add(slit);}
  const nose=plate([[-.025,.11],[.025,.11],[.035,-.18],[0,-.215],[-.035,-.18]],.045,steel);nose.position.z=-.275;
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(.035,.1,.018),shadow);mouth.position.set(0,-.13,-.257);
  head.add(helmet,crown,face,visor,nose,mouth);
  const capeGeometry = playerCloakGeometry();
  const cape = new THREE.Mesh(capeGeometry, red);
  cape.position.set(0, 1.2, .22); cape.rotation.x = -.1;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(.285,.047,4,8), leather);
  belt.position.y = .66; belt.rotation.x = Math.PI / 2;
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.44, 1.0, -0.02);
  const blade=plate([[-.065,0],[.065,0],[.075,.87],[0,1.158],[-.075,.87]],.045,steel);blade.rotation.x=-Math.PI/2;
  const fuller=new THREE.Mesh(new THREE.BoxGeometry(.022,.006,.66),iron);fuller.position.set(0,.038,-.45);
  const hilt=plate([[-.23,-.035],[-.24,.045],[-.08,.075],[.08,.075],[.24,.045],[.23,-.035],[.07,.015],[-.07,.015]],.08,brass);hilt.rotation.x=-Math.PI/2;
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.2,6),leather);grip.rotation.x=Math.PI/2;grip.position.z=.12;
  const pommel=new THREE.Mesh(new THREE.DodecahedronGeometry(.072,0),brass);pommel.position.z=.24;
  swordPivot.add(blade,fuller,hilt,grip,pommel);
  const breastplate=plate([[-.27,.22],[.27,.22],[.3,.08],[.22,-.22],[0,-.27],[-.22,-.22],[-.3,.08]],.13,iron);breastplate.position.set(0,.92,-.25);
  const chestRidge=plate([[-.025,.18],[.025,.18],[.035,-.19],[0,-.23],[-.035,-.19]],.02,steel);chestRidge.position.z=-.085;breastplate.add(chestRidge);
  const pauldrons = [-1,1].map(side => { const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(.23,0),iron);shoulder.position.set(side*.37,1.1,0);shoulder.scale.set(1,.66,1.12);const rim=new THREE.Mesh(new THREE.DodecahedronGeometry(.23,0),steel);rim.scale.set(1.08,.3,1.04);rim.position.y=-.06;shoulder.add(rim);return shoulder; });
  const glove = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14),leather);glove.position.set(0,-0.02,0.03);swordPivot.add(glove);
  const torso=new THREE.Group();torso.position.y=.7;
  for(const part of [breastplate,...pauldrons,body,head,cape,belt,swordPivot]){part.position.y-=.7;torso.add(part);}g.add(torso);
  const collar=new THREE.Mesh(new THREE.TorusGeometry(.24,.075,4,8),red);collar.rotation.x=Math.PI/2;collar.position.set(0,.51,0);torso.add(collar);
  const buckle=plate([[-.065,.055],[.065,.055],[.065,-.055],[-.065,-.055]],.045,brass);buckle.position.set(0,-.035,-.32);torso.add(buckle);
  for(const side of [-1,1]){
    const skirt=plate([[-.12,.12],[.12,.12],[.14,-.17],[-.1,-.2]],.055,leather);skirt.position.set(side*.19,-.17,-.14);skirt.rotation.z=side*.13;torso.add(skirt);
    const clasp=new THREE.Mesh(new THREE.DodecahedronGeometry(.048,0),brass);clasp.position.set(side*.2,.44,-.23);torso.add(clasp);
  }
  const pouch=new THREE.Mesh(new THREE.BoxGeometry(.17,.2,.13),leather);pouch.position.set(.3,-.09,.1);torso.add(pouch);
  const swordSleeve=new THREE.Mesh(new THREE.CylinderGeometry(.12,.09,.26,6),dark);swordSleeve.position.set(-.035,-.03,.13);swordSleeve.rotation.x=-.85;swordPivot.add(swordSleeve);
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.2, 0.48, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.23, 0.2), dark); leg.position.y = -0.1;
    const knee = new THREE.Group(); knee.position.y = -.22;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(.17,.16,.18), dark); shin.position.y = -.06;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(.22,.16,.34),leather); boot.position.set(0,-.12,-.06);
    const greave=plate([[-.095,.08],[.095,.08],[.08,-.11],[0,-.14],[-.08,-.11]],.05,iron);greave.position.set(0,-.025,-.105);
    const kneecap=new THREE.Mesh(new THREE.DodecahedronGeometry(.115,0),steel);kneecap.scale.set(.95,.8,.6);kneecap.position.z=-.11;
    knee.add(shin,boot,greave,kneecap);hip.add(leg,knee);hip.userData.knee=knee;g.add(hip);return hip;
  });
  const arm=new THREE.Group();arm.position.set(-.4,.34,0);
  const sleeve=new THREE.Mesh(new THREE.BoxGeometry(.17,.28,.18),dark);sleeve.position.y=-.14;
  const forearm=new THREE.Mesh(new THREE.BoxGeometry(.16,.17,.28),steel);forearm.position.set(0,-.28,-.09);
  const fist=new THREE.Mesh(new THREE.DodecahedronGeometry(.12),leather);fist.position.set(0,-.28,-.24);
  arm.add(sleeve,forearm,fist);torso.add(arm);g.userData.arm=arm;
  g.userData.legs = legs; g.userData.cape = cape; g.userData.body = body;
  g.userData.sword = swordPivot;g.userData.torso=torso;
  knightDetails({torso,head,sword:swordPivot,arm,legs,cape},{steel,iron,brass,red,leather,shadow});
  pauldrons.forEach(shoulder=>{shoulder.visible=false;});
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
  limb: shared(new THREE.CylinderGeometry(.055,.075,.65,6)),
  shield: shared(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 8)),
  weapon: shared(new THREE.BoxGeometry(0.09, 0.09, 0.92)),
  crown: shared(new THREE.CylinderGeometry(.29,.28,.11,8,1,true)),
  crownTooth: shared(new THREE.ConeGeometry(.065,.2,4)),
  armor: shared(new THREE.DodecahedronGeometry(.32,0)),
  plate: shared(new THREE.BoxGeometry(.72,.48,.34)),
  haft: shared(new THREE.CylinderGeometry(.055,.075,1.3,6)),
  hammer: shared(new THREE.BoxGeometry(.72,.36,.38)),
  claw: shared(new THREE.ConeGeometry(.055,.48,4)),
  cue: shared(new THREE.RingGeometry(0.85, 1.5, 40, 1, -1.05, 2.1)),
  bar: shared(new THREE.PlaneGeometry(0.8, 0.07)),
};

function makeSkeleton(kind: Enemy['kind']) {
  const g = new THREE.Group(),rig = new THREE.Group();g.add(rig);
  const stalker=kind==='stalker',warden=kind==='warden';
  const bone = new THREE.MeshStandardMaterial({ color: stalker?0xadc4b6:0xd9d1bd, roughness: 0.82 });
  const iron = new THREE.MeshStandardMaterial({ color: warden?0x344550:0x56616a, roughness: 0.48, metalness: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb89960, roughness: .5, metalness: .55 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff421f });
  const pelvis = new THREE.Mesh(BONES.pelvis, bone); pelvis.position.y = 0.55;
  const spine = new THREE.Mesh(BONES.spine, bone); spine.position.y = 0.91;
  const ribs = new THREE.Mesh(BONES.ribs, bone);
  ribs.position.set(0, 1.03, -0.02); ribs.rotation.set(Math.PI / 2, 0, -Math.PI * 0.78);
  const skull = new THREE.Mesh(BONES.skull, bone);
  skull.position.y = 1.42; skull.scale.set(0.88, 1, 0.78);
  const sockets = [-1, 1].map((s) => { const e = new THREE.Mesh(BONES.socket, eye); e.position.set(s * 0.085, 1.45, -0.21); return e; });
  const arms=[-1,1].map(s=>{const pivot=new THREE.Group();pivot.position.set(s*(warden?.48:.33),1.14,0);pivot.rotation.z=s*(stalker?.25:.12);const arm=new THREE.Mesh(BONES.limb,bone);arm.position.y=stalker?-.4:-.27;arm.scale.y=stalker?1.35:.85;pivot.add(arm);return pivot;});
  const legs=[-1,1].map(s=>{const pivot=new THREE.Group();pivot.position.set(s*(warden?.25:.18),.53,0);const leg=new THREE.Mesh(BONES.limb,bone);leg.scale.y=.75;leg.position.y=-.25;pivot.add(leg);return pivot;});
  const limbs=[...arms,...legs];
  const shield = new THREE.Mesh(BONES.shield, iron);
  shield.position.set(-.02,-.36,-.16); shield.rotation.set(-Math.PI / 2, 0, 0); shield.visible = !stalker&&!warden;arms[0].add(shield);
  const boss=new THREE.Mesh(BONES.armor,brass);boss.scale.set(.38,.16,.38);boss.position.y=.075;shield.add(boss);
  const weapon = new THREE.Group();weapon.position.set(warden?.5:.42,.97,-.12);weapon.rotation.x=warden?.45:.1;
  if(stalker){
    skull.scale.set(.85,.82,1.15);skull.position.z=-.16;ribs.scale.set(.85,1,1);sockets.forEach(eye=>{eye.position.z-=.16;});
    arms.forEach(arm=>{for(let i=0;i<3;i++){const claw=new THREE.Mesh(BONES.claw,iron);claw.rotation.x=-Math.PI/2;claw.position.set((i-1)*.11,-.83,-.16);arm.add(claw);}});
  }else if(warden){
    const plate=new THREE.Mesh(BONES.plate,iron);plate.position.set(0,1.0,-.05);rig.add(plate);
    for(const s of [-1,1]){const shoulder=new THREE.Mesh(BONES.armor,iron);shoulder.position.set(s*.49,1.21,0);shoulder.scale.set(1.18,.72,1);rig.add(shoulder);}
    const crown=new THREE.Mesh(BONES.crown,brass);crown.position.set(0,1.63,0);rig.add(crown);
    for(let i=0;i<6;i++){const tooth=new THREE.Mesh(BONES.crownTooth,brass),angle=i*Math.PI/3;tooth.position.set(Math.cos(angle)*.26,.1,Math.sin(angle)*.26);crown.add(tooth);}
    legs.forEach(leg=>{const greave=new THREE.Mesh(BONES.armor,iron);greave.position.y=-.29;greave.scale.set(.55,.7,.65);leg.add(greave);});
    const haft=new THREE.Mesh(BONES.haft,brass);haft.rotation.x=Math.PI/2;haft.position.z=-.42;
    const head=new THREE.Mesh(BONES.hammer,iron);head.position.z=-1.04;weapon.add(haft,head);
    const band=new THREE.Mesh(BONES.hammer,brass);band.scale.set(.18,1.04,1.04);head.add(band);
  }else{
    const blade=new THREE.Mesh(BONES.weapon,iron);blade.position.z=-.4;weapon.add(blade);
    const helmet=new THREE.Mesh(BONES.armor,iron);helmet.position.set(0,1.53,.04);helmet.scale.set(.94,.6,.94);rig.add(helmet);
  }
  rig.add(pelvis, spine, ribs, skull, ...sockets, ...limbs, weapon);
  rig.position.y=stalker?-.18:0;rig.rotation.x=stalker?-.38:0;
  g.userData.rig=rig;
  g.userData.eyes=sockets;
  g.userData.weapon = weapon;
  g.userData.limbs = limbs; g.userData.skull = skull; g.userData.shield = shield;
  enemyDetails(kind,rig,skull,limbs,weapon,shield,bone,iron,brass);
  sockets.forEach(socket=>{socket.position.z=stalker?-.445:-.223;socket.scale.setScalar(1.2);});
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
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false);
  // Settings start at the shipped defaults and are read from storage in an effect rather than during
  // render: the server has no localStorage, and a first paint that disagreed with it would be a hydration
  // mismatch. `osReduce` is the media query's answer, which is the default the player can then override.
  const [settings, setSettings] = useState<Settings>(defaultSettings), [osReduce, setOsReduce] = useState(false);
  const [capturing, setCapturing] = useState<Action | null>(null), [bindNote, setBindNote] = useState('');
  // Written by the two places that change settings, never during render, so what the closure reads is always
  // what the card last committed rather than whatever the last render happened to see.
  const settingsRef = useRef(settings);
  const applyRef = useRef<((settings: Settings, reduceMotion: boolean) => void) | null>(null);
  const reduceMotion = settings.reducedMotion ?? osReduce;
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
  // Not derived from `best`: the record is one run, this is the distribution every balance argument in
  // progress.md currently rests on somebody's memory of.
  const [runLog, setRunLog] = useState<RunEnd[]>([]);

  // Built at call time, not at render time: the ref is only ever read inside a handler, which is the one
  // place a ref may be read at all.
  const change = useCallback((patch: Partial<Settings>) => changeSettings(settingsRef, setSettings)(patch), []);

  // Storage is read once, on mount. A second tab writing its own settings mid-run and having them appear
  // under the player's hands would be worse than the two tabs simply disagreeing until the next visit.
  // Read here rather than in a state initialiser because the server has no storage, and a first paint that
  // disagreed with what came back would be a hydration mismatch over a slider position.
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const restore = () => { const stored = readSettings(); settingsRef.current = stored; setSettings(stored); setOsReduce(query.matches); };
    restore();
    // The preference can change while the page is open — a system toggle, or a driver emulating one — and
    // a player who flips it mid-run should not have to reload before the game believes them.
    const follow = (e: MediaQueryListEvent) => setOsReduce(e.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  // The world lives in one closure that cannot be rebuilt without restarting the run, so settings are
  // pushed into it rather than read back out of a capture that went stale on the first render after mount.
  useEffect(() => { applyRef.current?.(settings, reduceMotion); }, [settings, reduceMotion]);
  // The two decorative CSS animations follow the same effective answer, so an explicit "full motion" wins
  // over the media query in both directions instead of the OS always having the last word.
  useEffect(() => { document.documentElement.dataset.motion = reduceMotion ? 'reduce' : 'full'; }, [reduceMotion]);

  // Capture phase, stopped dead: the game's own keydown sits on window too, so without this a player
  // rebinding Sound would mute the game on the way past. Escape cancels rather than binds — it is reserved,
  // so it could never be the answer, and cancelling is what a player pressing it expects anyway.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      // A focused button activates on the key's *release*, which would drop straight back into capture; the
      // matching keyup is swallowed once so binding Space or Enter behaves like binding anything else.
      window.addEventListener('keyup', (up: KeyboardEvent) => { up.preventDefault(); up.stopImmediatePropagation(); }, { capture: true, once: true });
      setCapturing(null);
      if (e.code === RESERVED) { setBindNote('Escape always opens this menu, so it stays on Pause.'); return; }
      const held = ACTIONS.find(a => a !== capturing && settingsRef.current.binds[a].includes(e.code));
      const binds = bindKey(settingsRef.current.binds, capturing, e.code);
      if (!binds) { setBindNote(`${keyLabel(e.code)} cannot be bound.`); return; }
      change({ binds });
      // Say what the key cost, because the action it was taken from is somewhere else on the card and the
      // player would otherwise find out mid-fight.
      setBindNote(held ? `${keyLabel(e.code)} taken from ${ACTION_LABELS[held]} — now ${bindLabel(binds[held])}.` : '');
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, change]);

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
    // What the knight is holding. Every number the swing used to hardcode now comes off this record,
    // so a second arm is a different record rather than a second code path.
    const weapon: Weapon = TIDEBLADE;
    let attackBuffer = 0, dashBuffer = 0, walkPhase = 0, gaitSpeed = 0, elapsed = 0, manualTime = false, hitStop = 0;
    let locomotion=playerRunPose(0,0);
    let rewardTime = 0, noticeTime = 0;
    let hasStarted = false, isPaused = false, isMuted = false, activeRoom = 0;
    const audio = createDungeonAudio();
    // The one piece of settings state the loop reads every frame, so it is a plain local rather than a
    // property lookup through the ref; everything else is read at the moment a key or a menu asks for it.
    let easeMotion = false;
    // The closure's own handle on the same funnel the card uses — built here from a ref and a setState, both
    // stable for the life of the mount, so this effect stays dependency-free and the world is never rebuilt.
    const updateSettings = changeSettings(settingsRef, setSettings);
    applyRef.current = (next, reduce) => { easeMotion = reduce; audio.volume(next.volume); audio.mute(next.muted); isMuted = next.muted; };
    // And called once for whatever is already stored. The effect that pushes later changes may well have
    // run before this one mounted, in which case it found no `applyRef` and did nothing; without this the
    // world would sit on the defaults until the player happened to change something else.
    applyRef.current(settingsRef.current, settingsRef.current.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Floor-scoped state: everything here is torn down and rebuilt when the knight takes the stair down.
    let floor!: ReturnType<typeof generateFloor>;
    let enemyData: Enemy[] = [];
    let atmosphere: ReturnType<typeof addAtmosphere> | null = null;
    let visited = new Set<number>([0]), cleared = new Set<number>([0]), spineRooms = new Set<number>();
    let reached = 0, loot = 0, level = 1;
    let floorStart = 0, floorKills = 0, floorXp = 0;
    // Run-scoped, not floor-scoped: these three outlive a descent and are reset only by `restart`, which
    // is what makes the logged duration, boon list and replay seed describe the whole run and not its
    // last floor. `runStart` is the moment the keep was entered, not the moment the page mounted.
    let runStart = 0, firstSeed = 0, boonsTaken: string[] = [];
    let features: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; room: number; shrine: boolean; used: boolean; phase: number; burned: boolean }[] = [];
    // The way down sits at the heart of the warden hall: sealed until the last warden falls, then open, and
    // taken only once the knight has stood on it for STAIR_DWELL seconds.
    let stairOpen = false, stairDwell = 0;
    const stairSpot = new THREE.Vector3();
    let stairSeal: THREE.Mesh | null = null, stairRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null, stairGlow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
    let floorGroup = new THREE.Group();
    let water: THREE.Mesh | null = null;
    let tide: ReturnType<typeof tidalMaterial> | null = null;
    // Building a floor is the only place this game can stutter, so each phase is timed and reported.
    let buildMs: Record<string, number> = {};
    const goalRoom = () => floor.rooms[floor.goal];
    const swingHits = new Set<Enemy>();
    let gameStatus: 'playing' | 'complete' | 'won' | 'lost' = 'playing';
    const stairClear = () => enemyData.every(e => e.room !== floor.goal || e.dead);
    // The last warden's fall unseals the stair; the knight still has to take it, and nothing ends until he does.
    const openStair = () => {
      if (stairOpen) return;
      stairOpen = true; stairDwell = 0;
      if (stairSeal) stairSeal.visible = false;
      if (stairRing) stairRing.visible = true;
      if (stairGlow) stairGlow.visible = true;
      burst(stairSpot, 0xffc573, 24);
      setNotice('The stair opens'); setNoticeDetail('step onto it to descend'); noticeTime = 4;
    };
    const offerBoon = () => {
      run.choosing = true; keys.clear();
      setBoonChoice(draftBoons(run));
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
      boonsTaken.push(boon.id);
      if (run.pendingRanks > 0) offerBoon();
    };
    // The single door out of a run, and the only place `gameStatus` becomes 'won' or 'lost'. It refuses
    // to act unless the run is still live, which is what makes a second entry for one run impossible:
    // a warden's blow and an ember tick in the same frame, a repeated `continue` event, or a restart off
    // the death screen all find the status already settled and write nothing. `cause` is null for a win.
    const endRun = (cause: RunCause | null) => {
      if (gameStatus === 'won' || gameStatus === 'lost') return;
      gameStatus = cause ? 'lost' : 'won'; setStatus(gameStatus);
      slash.clear();enemyData.forEach(enemy=>enemy.trails.forEach(trail=>trail.effect.clear()));
      // Re-read instead of holding a snapshot: a second tab may have logged its own runs since this one
      // began, and the log is cheap enough to reread once per run that guessing is not worth it.
      const log = appendRun(readRuns(), { at: Date.now(), floor: level, won: !cause, cause, seconds: Math.max(0, Math.round(elapsed - runStart)), rank: run.rankLevel, xp: run.totalXp, kills: run.kills, boons: [...boonsTaken], seed: firstSeed });
      writeRuns(log); setRunLog(log);
    };
    const keys = new Set<string>();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1b24);
    scene.fog = new THREE.FogExp2(0x0a1b24, 0.022);
    const environment = vaultEnvironment(); scene.environment = environment; scene.environmentIntensity = .48;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 70);
    camera.position.set(10, 13, 13); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xa2c5d3, 0x243b3c, .95));
    const moon = new THREE.DirectionalLight(0xc2d9e1, 3.5);
    moon.position.set(-7, 12, 9); moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.radius = 3.5; moon.shadow.normalBias = .035; moon.shadow.bias = -.00015;
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
    const slash=weaponTrail(0xffedc5,.105);world.add(slash.mesh);
    const impacts=impactEffects();world.add(impacts.group);
    const bladeInner=new THREE.Vector3(0,0,-.32),bladeTip=new THREE.Vector3(0,0,-1.17);
    const posePlayer=(age:number)=>{
      const pose=playerAttackPose(age,weapon),sword=player.userData.sword as THREE.Group;
      sword.rotation.set(pose.swordPitch,pose.swordYaw,pose.swordRoll);
      sword.position.set(.44,.3,-.02-pose.armReach);
      sword.scale.z=1+run.reach*.5;
      player.userData.torso.rotation.set(0,pose.bodyYaw,pose.bodyRoll);
      if(age===0){player.userData.torso.rotation.x=locomotion.pitch;player.userData.torso.rotation.y+=locomotion.twist;sword.rotation.x+=locomotion.swordPitch;}
      return pose;
    };
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
    // The floor this hands out is the one being played: `floor` and `activeRoom` are both reassigned as
    // the run descends, so they are read through getters rather than snapshotted into a stale view.
    const enemyWorld = { get cells() { return floor.cells; }, get activeRoom() { return activeRoom; }, pathDistance: (x: number, z: number) => distances.get(pathKey(x,z)) ?? Infinity };
    // Only the shared texture, the knight and the lights outlive a floor; the rest is rebuilt per descent.
    const clearFloor = () => {
      atmosphere?.dispose();
      impacts.clear();
      floorGroup.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
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
      level = nextLevel; floorStart = elapsed; floorKills = run.kills; floorXp = run.totalXp; features = []; stairOpen = false; stairDwell = 0;
      gameStatus = 'playing'; setStatus('playing');
      floor = generateFloor(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], level);
      phase('generate');
      // Floor 1 is the run's fingerprint: keeping its seed is what lets a lost run be taken again, and it
      // is what a logged entry carries, so the log is held here rather than read off the current floor.
      if (level === 1) { firstSeed = floor.seed; runStart = elapsed; setRunSeed(floor.seed); writeSeed(floor.seed); }
      floorGroup = new THREE.Group(); world.add(floorGroup);
      swingHits.clear();slash.clear();posePlayer(0);
      visited = new Set([0]); cleared = new Set([0]); spineRooms = new Set(floor.spine);
      reached = 0; loot = 0; activeRoom = 0; pathCell = ''; distances.clear();
      const floorMaterial = new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: .035, color: 0xffffff, roughness: .83 });
      weatherStone(floorMaterial);
      const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
      const tileGeometry=new RoundedBoxGeometry(1.45,.18,1.45,1,.045),foundationGeometry=new THREE.BoxGeometry(1.49,2.65,1.49);
      const foundationMaterial=new THREE.MeshStandardMaterial({color:0x3a5055,roughness:.9});weatherStone(foundationMaterial);
      // Spatial batches let both the view and shadow camera reject distant carved paving.
      const paving=new Map<string,typeof stoneTiles>();for(const tile of stoneTiles){const key=`${Math.floor(tile.x/12)},${Math.floor(tile.z/12)}`;const batch=paving.get(key);if(batch)batch.push(tile);else paving.set(key,[tile]);}
      for(const local of paving.values()){
        const tiles=new THREE.InstancedMesh(tileGeometry,floorMaterial,local.length),foundations=new THREE.InstancedMesh(foundationGeometry,foundationMaterial,local.length);
        local.forEach(({x,z,room},i)=>{matrix.makeRotationY((Math.abs(x*13+z*7)%4)*Math.PI/2);matrix.setPosition(x*TILE,-.07,z*TILE);tiles.setMatrixAt(i,matrix);const theme=room>=0?floor.rooms[room].theme:'keep';const border=room>=0&&(Math.abs(x-floor.rooms[room].x)===floor.rooms[room].halfX-1||Math.abs(z-floor.rooms[room].z)===floor.rooms[room].halfZ-1);const color=new THREE.Color(border?0x546e6a:theme==='ruins'?0x9fa98e:theme==='flooded'?0x779e9c:0xb2ada0);color.multiplyScalar(.83+Math.abs(x*7+z*3)%7*.045);tiles.setColorAt(i,color);matrix.makeTranslation(x*TILE,-1.485,z*TILE);foundations.setMatrixAt(i,matrix);});
        foundations.receiveShadow=tiles.receiveShadow=true;floorGroup.add(foundations,tiles);
      }
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
      const parapetGeometry=new RoundedBoxGeometry(1,0.38,1,1,.045),parapetMaterial=new THREE.MeshStandardMaterial({color:0x607574,roughness:.8});
      const parapets=new Map<string,typeof borders>();for(const b of borders){const key=`${Math.floor(b.x/18)},${Math.floor(b.z/18)}`;const batch=parapets.get(key);if(batch)batch.push(b);else parapets.set(key,[b]);}
      for(const local of parapets.values()){
        const walls=new THREE.InstancedMesh(parapetGeometry,parapetMaterial,local.length);
        local.forEach((b,i)=>{matrix.compose(new THREE.Vector3(b.x,.15,b.z),new THREE.Quaternion(),new THREE.Vector3(b.horizontal?TILE:.16,1,b.horizontal?.16:TILE));walls.setMatrixAt(i,matrix);});
        walls.receiveShadow=true;floorGroup.add(walls);
      }
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
      // The way down: a sealed grate at the heart of the warden hall, ringed in stone over a dark shaft. The seal
      // lifts when the last warden falls; the gold ring is the same mark the map uses for the stair.
      { const goal = floor.rooms[floor.goal]; stairSpot.set(goal.x * TILE, 0, goal.z * TILE);
        const pit = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), new THREE.MeshBasicMaterial({ color: 0x04070a })); pit.rotation.x = -Math.PI / 2; pit.position.set(stairSpot.x, .07, stairSpot.z); floorGroup.add(pit);
        const rim = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.42, 32), new THREE.MeshStandardMaterial({ color: 0x55636a, roughness: .9 })); rim.rotation.x = -Math.PI / 2; rim.position.set(stairSpot.x, .075, stairSpot.z); floorGroup.add(rim);
        stairSeal = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, .05, 32), new THREE.MeshStandardMaterial({ color: 0x241b17, metalness: .8, roughness: .65 })); stairSeal.position.set(stairSpot.x, .1, stairSpot.z); floorGroup.add(stairSeal);
        // Open: light from below fills the shaft and a wide amber ring sits clear of the stone rim, so the change reads
        // from across the hall on every floor's lighting, not only the darkest.
        stairGlow = new THREE.Mesh(new THREE.CircleGeometry(1.12, 32), new THREE.MeshBasicMaterial({ color: 0xffc573, transparent: true, opacity: .35, depthWrite: false })); stairGlow.rotation.x = -Math.PI / 2; stairGlow.position.set(stairSpot.x, .08, stairSpot.z); stairGlow.visible = false; stairGlow.renderOrder = 4; floorGroup.add(stairGlow);
        stairRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })); stairRing.rotation.x = -Math.PI / 2; stairRing.position.set(stairSpot.x, .09, stairSpot.z); stairRing.visible = false; stairRing.renderOrder = 5; floorGroup.add(stairRing); }
      phase('atmosphere');
      enemyData = floor.spawns.map((spawn, index) => {
        const kind = spawn.kind;
        const stats = enemyStats(kind, level), maxHp = stats.hp, tell = stats.tell;
        const group = makeSkeleton(kind); group.position.set(spawn.x * TILE,0.03,spawn.z * TILE); group.visible = !spawn.ambush; floorGroup.add(group);
        if (kind === 'warden') group.scale.setScalar(1.3);
        if (kind === 'stalker') group.scale.set(.94,1,.94);
        const cue = new THREE.Mesh(kind === 'stalker' ? new THREE.PlaneGeometry(5,1.7).translate(2.5,0,0) : BONES.cue,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xff522b:0xffae52,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));cue.rotation.x=-Math.PI/2;floorGroup.add(cue);
        const bar = new THREE.Mesh(BONES.bar,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false}));bar.renderOrder=10;floorGroup.add(bar);
        const anchors:THREE.Object3D[]=kind==='stalker'?group.userData.limbs.slice(0,2):[group.userData.weapon];
        const trails=anchors.map(anchor=>{const effect=weaponTrail(kind==='warden'?0xffa15c:kind==='stalker'?0xffcc90:0xffd39b,kind==='warden'?.13:.095);floorGroup.add(effect.mesh);return {effect,anchor,inner:kind==='stalker'?new THREE.Vector3(0,-.72,-.12):new THREE.Vector3(0,0,-.24),tip:kind==='stalker'?new THREE.Vector3(0,-.87,-.5):new THREE.Vector3(0,0,kind==='warden'?-1.2:-.86)};});
        return { group, hp:maxHp, maxHp, kind, tell, damage:stats.damage, cue, bar, trails, attackAge:Infinity, speed:stats.speed, cooldown:0.4+(index%3)*0.2, hitFlash:0, dead:false, death:null, phase:spawn.room*1.7+index*0.6, windup:0, lunge:0, aim:new THREE.Vector3(), room:spawn.room, awake:!spawn.ambush };
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
      gameStatus = 'complete'; setStatus('complete'); keys.clear(); attackBuffer = 0; dashBuffer = 0; bufferedFacing = null; velocity.set(0,0,0);
      setFloorResult({kills: run.kills - floorKills, xp: run.totalXp - floorXp, seconds: Math.round(elapsed - floorStart)});
      setNotice(''); audio.play('win');
    };
    const continueDescent = () => {
      if (gameStatus !== 'complete') return;
      if (level >= FLOORS) { endRun(null); return; }
      buildFloor(level + 1);
      heal(run, Math.round(run.maxHp * .25)); setHealth(run.hp);
      keys.clear(); attackTime = 0; dashTime = 0; attackBuffer = 0; dashBuffer = 0; audio.pause(false);
      burst(player.position, 0x8de9be, 22);
    };
    // A run is nothing but this closure's counters plus floor 1, so it restarts in place: reloading
    // would refetch the bundle and throw away the AudioContext and the GPU context for no gain.
    // Everything buildFloor(1) already rebuilds (floor, level, rooms, enemies, map, status) is left to it,
    // but the run must be fresh first because it snapshots kills and XP as the floor's baseline. A whole
    // new `run` is the point of createRun(): a field added to the sim can never be forgotten here.
    const restart = (seed?: number) => {
      run = createRun(); boonsTaken = [];
      attackTime = 0; dashTime = 0; dashCooldown = 0; attackBuffer = 0; dashBuffer = 0; hitStop = 0; hurtFlash = 0; shake = 0;
      walkPhase = 0; gaitSpeed = 0; locomotion=playerRunPose(0,0); rewardTime = 0; noticeTime = 0; trailClock = 0; trailCursor = 0;
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
    const restoreSave = () => { setBest(readBest()); setPriorSeed(readSeed()); setRunLog(readRuns()); };
    restoreSave();
    buildFloor(1);
    // The thumbstick's screen-space direction while a thumb is planted, null the rest of the time. It is a
    // unit vector on the very basis the keys below build on, so analog steering is a second source of the
    // same quantity rather than a second input system.
    let stick: { x: number; z: number } | null = null;
    // Bindings are read at the moment they are asked for, never snapshotted: the card can rebind a key while
    // the run is paused behind it. `Touch<action>` is the touch d-pad's own slot and belongs to no binding,
    // so the discrete move:/stop: protocol steers identically whatever the keyboard has been set to.
    const held = (action: Action) => settingsRef.current.binds[action].some(c => keys.has(c)) || keys.has(`Touch${action}`);
    const moveInput = () => {
      const x = +held('right') - +held('left'), z = +held('down') - +held('up');
      // A planted thumb outranks the keys for exactly as long as it is down, and lifting it hands steering
      // straight back: neither path can strand the other, because neither ever writes to the other's state.
      const sx = stick ? stick.x : x, sz = stick ? stick.z : z;
      return screenRight.clone().multiplyScalar(sx).addScaledVector(screenDown, sz).normalize();
    };
    const startAttack = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || dashTime > 0) return;
      audio.play('slash');
      attackTime = weapon.duration; attackBuffer = 0; swingHits.clear();slash.clear();
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
      // While the blade is live the swing is a commitment: the dash waits for contact to end instead of
      // cutting it short, which is what makes swinging into a tell a mistake rather than a free action.
      if (!canAbortSwing(attackTime, weapon)) { dashBuffer = DASH_BUFFER; return; }
      dashBuffer = 0;
      const input = moveInput(); dashFacing.copy(input.lengthSq() ? input : facing);
      audio.play('dash');
      facing.copy(dashFacing); dashTime = 0.18; dashCooldown = run.dashSpan;
      attackTime = 0; attackBuffer = 0; dashBuffer = 0; bufferedFacing = null; hitStop = 0;slash.clear();posePlayer(0);

    };
    const togglePause = () => {
      // Pausing on top of an open boon draft would stack two overlays; the draft already holds the world still.
      if (!hasStarted || gameStatus !== 'playing' || run.choosing) return;
      // An armed rebind goes with the card. Left live, the first key pressed back in the fight would be
      // bound instead of swung, which is the worst possible moment to find out the capture was still open.
      isPaused = !isPaused; setMapOpen(false); setCapturing(null); keys.clear(); attackBuffer = 0; dashBuffer = 0; bufferedFacing = null; setPaused(isPaused); audio.pause(isPaused);
    };
    // Mute is a setting like any other now, so it goes out through the same funnel and comes back through
    // applyRef — one path, whether it was the M key, the menu button or a `mute` event that asked.
    const toggleMute = () => updateSettings({ muted: !settingsRef.current.muted });
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void mount.parentElement?.requestFullscreen?.().catch(() => undefined); };
    const keyDown = (e: KeyboardEvent) => {
      const binds = settingsRef.current.binds, does = (action: Action) => binds[action].includes(e.code);
      // Swallow a browser key only while it is bound to something: freeing an arrow by rebinding hands page
      // scrolling straight back, and binding PageDown stops the page jumping out from under the fight.
      if (hasStarted && !isPaused && !run.choosing && gameStatus === 'playing' && SCROLL_KEYS.has(e.code) && ACTIONS.some(does)) e.preventDefault();
      // Escape answers whatever else it is set to. It is the one key no rebind can take away, so a player
      // cannot shut themselves out of the menu that would let them undo the rebind.
      if (!e.repeat && (e.code === RESERVED || does('pause'))) { togglePause(); return; }
      if (!e.repeat && does('mute')) { toggleMute(); return; }
      if (!e.repeat && does('fullscreen')) { fullscreen(); return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      keys.add(e.code); if (e.repeat) return;
      if (does('attack')) requestAttack();
      if (does('dash')) requestDash();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    // The stick clears with the keys: a page backgrounded mid-drag does not always fire pointercancel,
    // and a stick left live is a knight that walks on by itself the moment the descent resumes.
    const clearInput = () => { keys.clear(); stick = null; attackBuffer = 0; dashBuffer = 0; bufferedFacing = null; };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'continue') { continueDescent(); return; }
      // `restart` opens a fresh keep, `restart:<seed>` takes the same one again; a junk seed just means fresh.
      if (detail === 'restart' || detail.startsWith('restart:')) { const seed = Number.parseInt(detail.slice(8), 10); restart(Number.isNaN(seed) ? undefined : seed >>> 0); return; }
      // `elapsed` runs from mount, so both clocks restart here or a logged run would bill the time spent
      // reading the menu. A restart mid-run has `hasStarted` already true and gets its reset in buildFloor.
      if (detail === 'start') { if (hasStarted) return; floorStart = elapsed; runStart = elapsed; hasStarted = true; setStarted(true); setCapturing(null); audio.start(); return; }
      if (detail === 'map') { if (!hasStarted || run.choosing || gameStatus !== 'playing') return; if (!isPaused) togglePause(); setMapOpen(true); return; }
      if (detail === 'pause') { togglePause(); return; }
      if (detail === 'mute') { toggleMute(); return; }
      if (detail === 'fullscreen') { fullscreen(); return; }
      if (detail.startsWith('boon:')) { chooseBoon(detail.slice(5)); return; }
      // Above the play guard on purpose: a release has to land even if the draft, the pause or a death
      // arrived between plant and lift, or the knight would keep walking with no thumb on the glass.
      // Junk parses as a release for the same reason.
      if (detail.startsWith('stick:')) { const [x, z] = detail.slice(6).split(',').map(Number); stick = Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      if (detail === 'attack') requestAttack();
      // Its own slot rather than the attack binding's: the touch STRIKE button must hold a swing going
      // whatever the keyboard has been rebound to, and must not be released by letting go of a key.
      if (detail === 'hold-attack') { keys.add('Touchattack'); requestAttack(); }
      if (detail === 'release-attack') keys.delete('Touchattack');
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
    let last: number | null = null, raf = 0;
    const update = (frameDt: number) => {
      if (isPaused || run.choosing || gameStatus === 'complete') return;
      elapsed += frameDt; const t = elapsed;
      // Deliberately not touched by reduced motion. 35ms of hit-stop is the absence of movement, not
      // movement, and it is also 35ms the enemies do not get: shortening it would hand every landed blow
      // back to them a frame sooner, which is a balance change wearing an accessibility label.
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
        attackBuffer = Math.max(0, attackBuffer - dt); dashBuffer = Math.max(0, dashBuffer - dt);
        if (attackBuffer === 0) bufferedFacing = null;
        dashCooldown = Math.max(0, dashCooldown - dt);
        // A dash that waited out the live blade goes first, the moment the recovery begins and ahead of the
        // next held swing, or holding strike would swallow every dodge pressed mid-swing.
        if (dashTime <= 0 && dashBuffer > 0 && canAbortSwing(attackTime, weapon)) requestDash();
        if (attackTime <= 0 && dashTime <= 0 && (attackBuffer > 0 || held('attack'))) startAttack();
        const input = moveInput(), moving = input.lengthSq() > 0;
        if (moving && attackTime <= 0 && dashTime <= 0) facing.copy(input);
        const direction = dashTime > 0 ? dashFacing : facing;
        const targetAngle = Math.atan2(-direction.x, -direction.z);
        const angleDelta = Math.atan2(Math.sin(targetAngle - player.rotation.y), Math.cos(targetAngle - player.rotation.y));
        player.rotation.y += angleDelta * (1 - Math.exp(-28 * dt));
        const threatened = enemyData.some(e => !e.dead && e.awake && e.group.position.distanceToSquared(player.position) < 100);
        const speed = dashTime > 0 ? 12 : attackTime > 0 ? weapon.moveSpeed : threatened ? 5.8 : 8.5;
        velocity.copy(dashTime > 0 ? dashFacing : input).multiplyScalar(speed);
        const oldX=player.position.x,oldZ=player.position.z;
        moveOnFloor(floor.cells, player.position, velocity.x * dt, velocity.z * dt);
        const travelled=Math.hypot(player.position.x-oldX,player.position.z-oldZ);
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
        // The stair opens when the last warden falls and takes the knight down only once he has stood on it a
        // moment: the floor ends on a step he chose, never in the middle of a swing. A dash across it does not count.
        if (!stairOpen && stairClear()) openStair();
        if (stairOpen) {
          const onStair = Math.hypot(player.position.x - stairSpot.x, player.position.z - stairSpot.z) < STAIR_RADIUS;
          stairDwell = stairDwellStep(stairDwell, onStair, dashTime > 0, dt);
          const fill = stairDwell / STAIR_DWELL, pulse = Math.sin(t * 3) * .1;
          if (stairRing) { stairRing.material.opacity = .75 + fill * .25 + pulse; stairRing.scale.setScalar(1 + fill * .15); }
          // The shaft stays dark until the knight stands on it, then fills with light as the dwell runs: the same
          // cue tells him the stair is his to take and how close he is to taking it.
          if (stairGlow) stairGlow.material.opacity = .08 + fill * .7 + pulse * .3;
          if (stairDwell >= STAIR_DWELL) descend();
        }
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
              if(run.hp===0)endRun('hazard');
            }
          }
        }

        const groundSpeed=dashTime<=0&&dt>0?travelled/dt:0;
        gaitSpeed=THREE.MathUtils.damp(gaitSpeed,groundSpeed,14,dt);
        const previousPhase=walkPhase;
        if(groundSpeed>.05)walkPhase+=travelled*strideRate(gaitSpeed);
        if(Math.floor((previousPhase+Math.PI/2)/Math.PI)!==Math.floor((walkPhase+Math.PI/2)/Math.PI))audio.play('step');
        locomotion=playerRunPose(walkPhase,gaitSpeed);
        player.userData.legs.forEach((leg: THREE.Group, i: number) => { leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, locomotion.legs[i].hip, 28, dt);leg.userData.knee.rotation.x=THREE.MathUtils.damp(leg.userData.knee.rotation.x,locomotion.legs[i].knee,28,dt); });
        player.userData.arm.rotation.x=THREE.MathUtils.damp(player.userData.arm.rotation.x,attackTime>0?-.35:locomotion.arm,20,dt);
        player.position.y = 0.03 + locomotion.height + Math.sin(t*2.4)*.012*Math.max(0,1-gaitSpeed);
        player.rotation.x = THREE.MathUtils.damp(player.rotation.x, dashTime > 0 ? -0.3 : 0, 24, dt);
        player.userData.cape.rotation.x = THREE.MathUtils.damp(player.userData.cape.rotation.x, dashTime > 0 ? -.8 : -locomotion.cape, 16, dt);
        dashTime = Math.max(0, dashTime - dt);
        if (attackTime > 0) {
          attackTime = Math.max(0, attackTime - dt);
          const pose=posePlayer(weapon.duration-attackTime),active=pose.active;
          slash.update(dt,pose.trail,player.userData.sword,bladeInner,bladeTip);
          if (active) enemyData.forEach((enemy) => {
            if (gameStatus !== 'playing' || enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            // The same rule the node suite runs: inside the arc, and with no wall between the blade and the body.
            if (swordContacts(floor.cells, player.position, attackFacing, enemy.group.position, run.reach, weapon)) {
              delta.normalize();
              audio.play('hit');
              swingHits.add(enemy); enemy.hp -= run.strike + weapon.damage - 1; enemy.hitFlash = 0.2; if (interruptsWindup(enemy.kind, enemy.windup)) {enemy.windup = 0;enemy.attackAge=Infinity;enemy.trails.forEach(trail=>trail.effect.clear());}
              enemy.cooldown = Math.max(enemy.cooldown, 0.4);
              const shove = enemy.kind === 'warden' ? weapon.wardenKnockback : weapon.knockback;
              moveOnFloor(floor.cells, enemy.group.position, delta.x * shove, delta.z * shove); burst(enemy.group.position, 0xffb24a, 7); impacts.emit(enemy.group.position,enemy.hp<=0?0xddebd3:0xffedbb,enemy.kind==='warden'); shake = 0.07; hitStop = 0.035;
              if (enemy.hp <= 0) { enemy.dead = true; enemy.death=startDeath(enemy.group,enemy.kind);enemy.cue.visible=enemy.bar.visible=false;enemy.trails.forEach(trail=>trail.effect.clear()); award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills); if (!cleared.has(enemy.room) && enemyData.every(e => e.room !== enemy.room || e.dead)) {
                cleared.add(enemy.room);
                const room = floor.rooms[enemy.room], detour = room.role === 'branch';
                award(clearRoomReward(run, detour));
                if (detour) { loot++; setPlundered(loot); }
                setNotice(`${room.name} · ${detour ? 'dead end plundered' : 'cleansed'}`);
                setNoticeDetail(detour ? `+${XP_DEAD_END} XP · +30 vitality` : '+12 vitality restored');
                noticeTime = 3.5; rewardTime = 1.4; audio.play('clear'); burst(player.position,0x8de9be,18);
                document.getElementById(`map-room-${enemy.room}`)?.setAttribute('fill', detour ? '#c2b273' : '#a8d5b0');
              } if (enemy.room === floor.goal && stairClear()) openStair(); }
            }
          });
        } else { posePlayer(0);slash.update(dt,false,player.userData.sword,bladeInner,bladeTip); }
        // A kill can open a boon draft, and a hazard can end the run, part-way through this update. Every
        // eligible hit and its exactly-once reward is resolved above; from here the world is frozen, so the
        // skeletons must not get one more move out of this tick.
        if (run.choosing || gameStatus !== 'playing') return;
        enemyData.forEach((enemy) => {
          if (!enemy.awake) { enemy.cue.visible = false; enemy.bar.visible = false;enemy.trails.forEach(trail=>trail.effect.clear()); return; }
          enemy.cue.visible = !enemy.dead && (enemy.windup > 0 || enemy.lunge > 0); enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;
          enemy.bar.position.copy(enemy.group.position).add(new THREE.Vector3(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); enemy.bar.scale.x = enemy.hp / enemy.maxHp;
          enemy.cue.scale.setScalar(enemy.kind === 'warden' ? 1.7 : 1);
          enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);
          (enemy.cue.material as THREE.MeshBasicMaterial).opacity = 0.2 + (1 - enemy.windup / enemy.tell) * 0.5;
          if (enemy.dead) { if(enemy.death)advanceDeath(enemy.death,dt);return; }
          const hurtPlayer = () => {
            if (gameStatus !== 'playing' || !hurt(run, enemy.damage, { dashing: dashTime > 0, warded: true })) return;
            setHealth(run.hp);
            audio.play('hurt'); hurtFlash=.35; shake=.12; burst(player.position,0xff4c2f,8);impacts.emit(player.position,0xff8763,enemy.kind==='warden');
            // Which kind landed the killing blow is the one thing only this call site knows.
            if(run.hp===0)endRun(enemy.kind);
          };
          // Everything about where this body goes and whether its blow lands is decided in dungeon-enemy;
          // what is left here is the part a node test could never see — poses, sound, flashes, particles.
          const previousWindup=enemy.windup;
          const intent = decideEnemy({ kind: enemy.kind, x: enemy.group.position.x, z: enemy.group.position.z, room: enemy.room, cooldown: enemy.cooldown, hitFlash: enemy.hitFlash, windup: enemy.windup, lunge: enemy.lunge, tell: enemy.tell, speed: enemy.speed, aim: enemy.aim }, player.position, enemyWorld, dt);
          enemy.cooldown = intent.cooldown; enemy.hitFlash = intent.hitFlash;
          if (Number.isFinite(enemy.attackAge)) enemy.attackAge+=dt;
          if (intent.act === 'inert') {enemy.trails.forEach(trail=>trail.effect.clear());return;}
          enemy.windup = intent.windup; enemy.lunge = intent.lunge; enemy.aim.set(intent.aim.x,0,intent.aim.z);
          if(previousWindup>0&&enemy.windup===0)enemy.attackAge=0;
          else if(previousWindup<=0&&enemy.windup>0)enemy.attackAge=Infinity;
          enemy.group.position.x = intent.x; enemy.group.position.z = intent.z;
          if (intent.sound) audio.play(intent.sound);
          if (intent.hit) hurtPlayer();
          const pose=enemyPose(enemy.kind,enemy.windup,enemy.tell,enemy.cooldown,enemy.lunge,enemy.attackAge);
          if(!pose.trail)enemy.group.rotation.y=intent.face??enemy.group.rotation.y;
          const walking=intent.act==='ready'&&intent.distance>1.15&&enemy.hitFlash<=0&&pose.recovery===0;
          const gait=walking?Math.sin(t*enemy.speed*5+enemy.phase)*(enemy.kind==='warden'?.28:.48):0;
          enemy.group.position.y=.03;
          enemy.group.userData.rig.position.y=pose.height+(walking?Math.abs(gait)*.07:0);
          enemy.group.userData.rig.rotation.x=pose.pitch+(enemy.hitFlash>0?.15:0);
          enemy.group.userData.rig.rotation.y=pose.bodyYaw;
          enemy.group.userData.weapon.rotation.set(pose.weapon,pose.weaponYaw,pose.weaponRoll);
          enemy.group.userData.limbs.forEach((limb:THREE.Group,i:number)=>{limb.rotation.x=(i<2?pose.arms:0)+(i%2?gait:-gait);});
          enemy.group.userData.skull.rotation.y=Math.sin(t*1.5+enemy.phase)*.06;
          if(enemy.kind==='guard')enemy.group.userData.limbs[0].rotation.x=-.16+gait*.12-.1*(enemy.windup>0?1-enemy.windup/enemy.tell:pose.recovery);
          enemy.cue.visible=enemy.windup>0||(enemy.lunge>0&&enemy.attackAge<.09);
          if(enemy.windup<=0)(enemy.cue.material as THREE.MeshBasicMaterial).opacity=.5*Math.max(0,1-enemy.attackAge/.09);
          enemy.trails.forEach(trail=>trail.effect.update(dt,pose.trail,trail.anchor,trail.inner,trail.tip));
          enemy.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.setHex(enemy.hitFlash > 0 ? 0xffa34a : enemy.windup > 0 ? 0xb83915 : 0x000000); o.material.emissiveIntensity = enemy.hitFlash > 0 ? 0.8 : 0.5; } });
        });
        // Separate bodies without moving a guard during its committed windup; the rule itself lives in
        // dungeon-enemy, and only the write back into the scene graph belongs here.
        const spread = separateCrowd(floor.cells, enemyData.map(e => ({ x: e.group.position.x, z: e.group.position.z, windup: e.windup, dead: e.dead })), dt);
        enemyData.forEach((e, i) => { e.group.position.x = spread[i].x; e.group.position.z = spread[i].z; });
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
      // Reduced motion drops the shake outright: it is ~90 Hz camera translation that carries nothing the
      // particles, the sound and the health bar do not already say, so nothing is lost by not moving at all.
      if (shake > 0 && !easeMotion) camera.position.add(new THREE.Vector3(Math.sin(t*95)*shake,0,Math.cos(t*83)*shake));
      camera.lookAt(cameraFocus.x,0,cameraFocus.z);
      impacts.update(dt,camera.quaternion);
      // The hurt filter is reduced, not removed. Its discomfort is the brightness ramping across the whole
      // screen as the flash decays; its job is telling the player they were hit, which is gameplay. So the
      // tint stays for exactly as long, holds still, and drops the brightness change entirely.
      renderer.domElement.style.filter = hurtFlash <= 0 ? '' : easeMotion ? 'sepia(.3) saturate(1.5) hue-rotate(-22deg)' : `sepia(.4) saturate(1.75) hue-rotate(-25deg) brightness(${0.9 + hurtFlash * 0.3})`;
    };
    const hooks = window as Window & {
      advanceTime?: (ms: number, draw?: boolean) => void;
      render_game_to_text?: () => string;
      dungeonTest?: { teleport: (x: number, z: number) => void; descend: () => void; buildFloor: (level: number) => void; grantXp: (amount: number) => void; runLog: () => RunEnd[]; configureCombatFixture?: (fixture: CombatFixture) => void };
    };
    // Drive the run from the console or a browser test: see tests/README.md for the usual recipes.
    hooks.dungeonTest = {
      teleport: (x, z) => {player.position.set(x, 0.03, z);slash.clear();},
      descend: () => buildFloor(Math.min(FLOORS, level + 1)),
      buildFloor: (nextLevel) => buildFloor(nextLevel),
      grantXp: (amount) => award(grantXp(run, amount)),
      // Straight off the store, re-validated on the way out, so what comes back is what a later session
      // would also see — not whatever this session happens to be holding in React state.
      runLog: () => readRuns(),
    };
    // Development only. A guard one blow from death while another attacker's windup expires in the very
    // same update is not a state real play reaches, and the freeze-on-rank-up regression needs exactly that
    // tick. This moves actors the floor already spawned; it never replaces a rule and never takes code. The
    // bundler inlines NODE_ENV, so the whole block is dropped from a production build rather than switched off.
    if (process.env.NODE_ENV !== 'production') {
      const finite = (value: number, label: string) => {
        if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
        return value;
      };
      hooks.dungeonTest.configureCombatFixture = (fixture) => {
        if (!hasStarted) throw new Error('start the run before staging a combat fixture');
        if (!isPaused && !manualTime) throw new Error('pause or take manual time before staging a combat fixture');
        if (fixture.health !== undefined) {
          const value = Math.round(finite(fixture.health, 'health'));
          if (value < 1 || value > run.maxHp) throw new Error(`health must be between 1 and ${run.maxHp}`);
          run.hp = value; setHealth(run.hp);
        }
        for (const change of fixture.enemies ?? []) {
          const enemy = enemyData[change.index];
          if (!enemy) throw new Error(`no enemy at spawn index ${change.index}`);
          if (enemy.dead) throw new Error(`enemy ${change.index} is already dead`);
          if (change.x !== undefined || change.z !== undefined) {
            const x = finite(change.x ?? enemy.group.position.x, 'x');
            const z = finite(change.z ?? enemy.group.position.z, 'z');
            if (!canStand(floor.cells, x, z)) throw new Error(`enemy ${change.index} cannot stand at ${x}, ${z}`);
            enemy.group.position.set(x, enemy.group.position.y, z);
          }
          if (change.hp !== undefined) {
            const value = Math.round(finite(change.hp, 'hp'));
            if (value < 1 || value > enemy.maxHp) throw new Error(`enemy ${change.index} hp must be 1..${enemy.maxHp}`);
            enemy.hp = value;
          }
          if (change.windup !== undefined) {
            const value = finite(change.windup, 'windup');
            if (value < 0 || value > enemy.tell) throw new Error(`enemy ${change.index} windup must be 0..${enemy.tell}`);
            enemy.windup = value;
          }
          if (change.cooldown !== undefined) {
            const value = finite(change.cooldown, 'cooldown');
            if (value < 0) throw new Error(`enemy ${change.index} cooldown cannot be negative`);
            enemy.cooldown = value;
          }
          if (change.aim !== undefined) {
            const x = finite(change.aim.x, 'aim.x'), z = finite(change.aim.z, 'aim.z');
            if (!Math.hypot(x, z)) throw new Error(`enemy ${change.index} aim cannot be zero`);
            enemy.aim.set(x, 0, z).normalize();
          }
        }
      };
    }
    hooks.advanceTime = (ms, draw = true) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      if (draw) renderer.render(scene, camera);
    };
    hooks.render_game_to_text = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, boonOffer: run.choosing, muted: isMuted, roomName: floor.rooms[activeRoom]?.name ?? 'Passage',
      health: run.hp, maxHealth: run.maxHp, rank: run.rankLevel, weapon: { id: weapon.id, name: weapon.name, damage: weapon.damage, reach: weapon.reach, duration: weapon.duration }, boons: { strike: run.strike, reach: run.reach, draught: run.draught, dashSpan: run.dashSpan, guardAgainst: run.guardAgainst }, remaining: floor.guardCount - enemyData.filter(e => e.dead).length,
      objective: { floor: level, floors: FLOORS, goal: goalRoom().name, goalRoom: floor.goal, halls: reached, goalDepth: goalRoom().depth, atStair: activeRoom === floor.goal, stairClear: stairClear(), stairOpen, stairDwell, deadEndsPlundered: loot },
      stair: { x: stairSpot.x, z: stairSpot.z, radius: STAIR_RADIUS, dwell: STAIR_DWELL },
      experience: { total: run.totalXp, perEnemy: XP_PER_ENEMY, intoRank: run.rankProgress, rankCost: rankCost(run.rankLevel), resetsOnNewRun: true },
      render: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
      effects: { impacts: impacts.active },
      // Added keys, never changed ones: `muted` above still means what it always did. `filter` is what the
      // canvas is actually wearing this frame, so a driver can see the hurt tint rather than infer it.
      settings: { ...settingsRef.current, reduceMotion: easeMotion, filter: renderer.domElement.style.filter, shake, hitStop, sound: audio.level() },
      // The camera's rest position is focus plus a fixed offset, so anything left over is the shake — which
      // makes "reduced motion actually stopped the camera moving" something a driver can read rather than see.
      camera: { x: camera.position.x, z: camera.position.z, focusX: cameraFocus.x, focusZ: cameraFocus.z, restX: cameraFocus.x + 9.2, restZ: cameraFocus.z + 11.5 },
      features: features.map(f => ({room:f.room, shrine:f.shrine, used:f.used, burned:f.burned, phase:f.phase, x:f.mesh.position.x,z:f.mesh.position.z,radius:f.shrine?1.5:1.8})),
      buildMs,
      floor: { level, waterfalls: atmosphere?.waterfalls, seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, start: floor.start, goal: floor.goal, spine: floor.spine, visited: [...visited], cleared: [...cleared] },
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashBuffer, dashTime, dashCooldown, invulnerable: run.invuln, hurtFlash, swordAngle: player.userData.sword.rotation.y, cloak:{anchor:player.userData.cape.position.toArray(),pitch:player.userData.cape.rotation.x}, pose: {bodyYaw:player.userData.torso.rotation.y,trail:slash.mesh.visible,trailTriangles:slash.mesh.geometry.drawRange.count/3}, locomotion: {speed:gaitSpeed,phase:walkPhase,sprint:locomotion.sprint,pitch:player.userData.torso.rotation.x,height:player.position.y,arm:player.userData.arm.rotation.x,knees:player.userData.legs.map((leg:THREE.Group)=>leg.userData.knee.rotation.x)}, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      corpses: enemyData.filter(e=>e.dead).map(e=>({kind:e.kind,x:e.group.position.x,y:e.group.position.y,z:e.group.position.z,scale:e.group.scale.toArray(),rotation:e.group.userData.rig.rotation.x,age:e.death?.age,settled:e.death?.settled,visible:e.group.visible,cue:e.cue.visible,bar:e.bar.visible,trails:e.trails.some(trail=>trail.effect.mesh.visible)})),
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, kind: e.kind, windup: e.windup, lunge: e.lunge, cooldown: e.cooldown, aim: {x:e.aim.x,z:e.aim.z}, room: e.room, awake: e.awake, pose: {shieldArm:e.group.userData.limbs[0].rotation.x,shieldTilt:e.group.userData.shield.rotation.x,pitch:e.group.userData.rig.rotation.x,height:e.group.userData.rig.position.y,weapon:e.group.userData.weapon.rotation.x,weaponYaw:e.group.userData.weapon.rotation.y,attackAge:Number.isFinite(e.attackAge)?e.attackAge:null,trails:e.trails.filter(trail=>trail.effect.mesh.visible).length,cue:e.cue.visible} })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      // rAF timestamps describe the frame start, which can precede effect setup.
      // Establish the clock on the first callback so startup cannot run time backwards.
      if (!manualTime && !document.hidden) { update(last === null ? 0 : Math.max(0, Math.min((now - last) / 1000, 0.04))); renderer.render(scene, camera); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = w < 600 ? 6.3 : 7.2; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener('resize', resize); resize(); setReady(true);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('webglcontextrestored', contextRestored); audio.dispose(); atmosphere?.dispose(); texture.dispose(); environment.dispose(); impacts.dispose(); applyRef.current = null; delete hooks.advanceTime; delete hooks.render_game_to_text; delete hooks.dungeonTest; scene.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const roomCount = floorMap?.rooms.length ?? 0;
  const goalName = floorMap?.rooms[floorMap.goal].name ?? 'The Sunken Stair';
  const goalDepth = floorMap?.rooms[floorMap.goal].depth ?? 0;
  const deadEnds = floorMap?.rooms.filter(r => r.role === 'branch').length ?? 0;
  const mapAngle = Math.atan2(9.2,11.5), mapCos = Math.cos(mapAngle), mapSin = Math.sin(mapAngle);
  const mapCorners = floorMap ? [[floorMap.bounds.minX,floorMap.bounds.minZ],[floorMap.bounds.maxX,floorMap.bounds.minZ],[floorMap.bounds.minX,floorMap.bounds.maxZ],[floorMap.bounds.maxX,floorMap.bounds.maxZ]].map(([x,z])=>({x:x*mapCos-z*mapSin,y:x*mapSin+z*mapCos})) : [{x:0,y:0}];
  const mapBounds = {x:Math.min(...mapCorners.map(p=>p.x))-4,y:Math.min(...mapCorners.map(p=>p.y))-4,width:Math.max(...mapCorners.map(p=>p.x))-Math.min(...mapCorners.map(p=>p.x))+8,height:Math.max(...mapCorners.map(p=>p.y))-Math.min(...mapCorners.map(p=>p.y))+8};
  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  // The HUD is deliberately bare, so the log gets one line and no more: how many descents, how many got
  // out, and the floor that has taken the most. The full history is `window.dungeonTest.runLog()`.
  const tally = summariseRuns(runLog);
  // Whenever a full-screen card sits over the world (intro, pause, a boon choice, or a run's end), the
  // corner chrome behind it — the floor label and the minimap — has nothing to add and only collides with
  // the card's own kicker, so it hides rather than moves.
  // Focus lands on the card itself, not its first button: the strike key is Space, and a focused button
  // would activate on the very key a player is most likely still holding when a card opens. A dialog with
  // a name announces itself; Tab then reaches the card's own controls first.
  const focusCard = useCallback((card: HTMLElement | null) => { card?.focus({ preventScroll: true }); }, []);
  const cardOpen = !started || (paused && !mapOpen) || (boonChoice.length > 0 && status === 'playing') || status === 'complete' || status === 'won' || status === 'lost';
  return (
    <main className={`game-shell${mapOpen ? ' map-expanded' : ''}${displayFailed ? ' no-display' : ''}${cardOpen ? ' card-open' : ''}${!started ? ' pre-start' : ''}`}>
      <div ref={mountRef} className="game-canvas" aria-label="Procedural isometric dungeon floor" />
      <header className="game-title"><span>{floorLevel} / {FLOORS} · {roomName}</span></header>
      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || paused || status !== 'playing' || boonChoice.length > 0} aria-label="Pause game">☰</button></nav>
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <section className="hud" aria-label="Player status"><div className="health-row"><span>♥</span><b>{health}<small>/{maxHealth}</small></b></div><div className="health-track" role="progressbar" aria-label="Vitality" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}><i style={{ width: `${Math.max(0, health / maxHealth * 100)}%` }} /></div><div className="dash-status"><progress ref={dashMeter} max="1" value="1" aria-label="Dash readiness" /></div><progress className="xp-track" aria-label="Progress to the next boon" max={rankNeed} value={rankXp} /></section>
      {floorMap && <button className="floor-map" disabled={!started || status !== 'playing' || boonChoice.length > 0} onClick={() => action(mapOpen ? 'pause' : 'map')} aria-label={mapOpen ? 'Close floor map' : 'Open floor map'}><svg key={floorBuild} viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.width} ${mapBounds.height}`}><g transform={`rotate(${mapAngle*180/Math.PI})`}>
        <path d={floorMap.tiles.map(t => `M${t.x - 0.5},${t.z - 0.5}h1v1h-1z`).join('')} fill="#334e56" />
        {floorMap.rooms.map(r => <path key={r.id} id={`map-room-${r.id}`} d={floorMap.tiles.filter(t=>t.room===r.id).map(t=>`M${t.x-.5},${t.z-.5}h1v1h-1z`).join('')} fill={r.id===0?'#5aa89d':r.role==='goal'?'#b8863f':'#4a747c'} />)}
        <circle className="map-mark" cx={floorMap.rooms[floorMap.goal].x} cy={floorMap.rooms[floorMap.goal].z} r="3.4" fill="none" stroke="#ffc573" strokeWidth="0.9" opacity="0.9" />
        <circle ref={mapPlayer} className="map-mark" cx={floorMap.rooms[0].x} cy={floorMap.rooms[0].z} r="1.8" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </g></svg></button>}
      {notice && started && !paused && status === 'playing' && boonChoice.length === 0 && <output className="chamber-notice"><b>{notice.split(' · ').pop()}</b></output>}
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      {!displayFailed && (!started || (paused && !mapOpen)) && <div className="intro-screen"><section className="intro-card" role="dialog" aria-modal="true" aria-labelledby="intro-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">{paused ? `FLOOR ${floorLevel} · ${roomName}` : 'THE DROWNED KEEP'}</span><h1 id="intro-title">{paused ? 'Paused' : <>Below<br /><em>the tide.</em></>}</h1>
        {paused && <p>{advance} / {goalDepth} halls · {visitedCount} / {roomCount} explored · {plundered} / {deadEnds} plundered<br />Rank {rank} · {experience} XP · {rankXp} / {rankNeed} to next boon{xpReward > 0 ? ` · +${xpReward} XP` : ''}</p>}
        {!paused && best && <p className="best-run">Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</p>}
        {!paused && tally.runs > 0 && <p className="run-log">{tally.runs} {tally.runs === 1 ? 'descent' : 'descents'} logged · {tally.wins} escaped{tally.worstFalls > 0 ? ` · floor ${tally.worstFloor} has taken ${tally.worstFalls}` : ''}</p>}
        <button className="primary-action" disabled={!ready} onClick={() => action(paused ? 'pause' : 'start')}>{!ready ? 'LOADING…' : paused ? 'RESUME' : 'ENTER THE KEEP'} <span>→</span></button>
        {/* Read off the bindings rather than written out, or this card would go on promising WASD to a player
            who rebound it ten seconds ago — which is the exact moment they would come here to check. */}
        <details className="menu-details"><summary>Controls & journey</summary><div className="intro-controls"><span><kbd>{(['up', 'left', 'down', 'right'] as Action[]).map(a => bindLabel(settings.binds[a], '/')).join(' ')}</kbd> Move</span><span><kbd>{bindLabel(settings.binds.attack)}</kbd> Hold to strike</span><span><kbd>{bindLabel(settings.binds.dash)}</kbd> Dodge</span><span><kbd>{bindLabel(settings.binds.pause)}</kbd> Pause</span><span><kbd>{bindLabel(settings.binds.fullscreen)}</kbd> Fullscreen</span></div><p>Reach {goalName}. Defeat the stair wardens, then step onto the stair they guarded to descend. Cyan shrines heal once; amber circles flare before they burn. Dodge through them. Side chambers grant XP and vitality.</p>{taken.length > 0 && <p><span className="end-kicker">BOONS HELD · </span>{taken.join(' · ')}</p>}</details>
        {/* Folded away beside the journey, not added to the HUD: this card is where detail belongs, and the
            world stays bare. Everything here persists, and everything here has a default that is the game
            exactly as it shipped, so a player who never opens this changes nothing by not opening it. */}
        <details className="menu-details settings-panel"><summary>Settings</summary>
          <div className="setting-row"><label htmlFor="set-volume">Volume</label><input id="set-volume" type="range" min="0" max="100" step="5" value={Math.round(settings.volume * 100)} onChange={(e) => change({ volume: Number(e.target.value) / 100 })} /><small>{settings.muted ? 'muted' : `${Math.round(settings.volume * 100)}%`}</small></div>
          <div className="setting-row"><label htmlFor="set-motion">Motion</label><select id="set-motion" value={settings.reducedMotion === null ? 'system' : settings.reducedMotion ? 'reduce' : 'full'} onChange={(e) => change({ reducedMotion: e.target.value === 'system' ? null : e.target.value === 'reduce' })}><option value="system">System · {osReduce ? 'reduced' : 'full'}</option><option value="reduce">Reduced</option><option value="full">Full</option></select><small>{reduceMotion ? 'no camera shake; the hurt tint holds still' : 'camera shake and a hurt flash'}</small></div>
          <div className="setting-row"><label htmlFor="set-touch">Touch</label><select id="set-touch" value={settings.touchLayout} onChange={(e) => change({ touchLayout: e.target.value === 'pad' ? 'pad' : 'stick' })}><option value="stick">Thumbstick</option><option value="pad">Direction buttons</option></select><small>buttons are labelled; the stick is not</small></div>
          {/* Nine buttons is the bulk of this card, so they fold away behind their own summary — volume,
              motion and touch stay the short default view, and rebinding is one more tap away rather than
              a scroll past it. */}
          <details className="menu-details"><summary>Key bindings</summary>
            <div className="key-binds">{ACTIONS.map(a => <button key={a} className={capturing === a ? 'capturing' : ''} aria-label={`${ACTION_LABELS[a]}: ${bindLabel(settings.binds[a], ' or ')}. Activate to rebind.`} onClick={() => { setBindNote(''); setCapturing(capturing === a ? null : a); }}><span>{ACTION_LABELS[a]}</span><kbd>{capturing === a ? 'press a key' : bindLabel(settings.binds[a])}</kbd></button>)}</div>
            <output className="bind-note">{bindNote || (capturing ? 'Press any key. Escape cancels.' : 'Escape always opens this menu, so it cannot be rebound.')}</output>
            <button className="reset-binds" onClick={() => { setCapturing(null); setBindNote(''); change({ binds: defaultSettings().binds }); }}>Reset keys</button>
          </details>
        </details>
        <div className="menu-settings">{started && <button onClick={() => action('map')}>Map</button>}<button onClick={() => action('mute')}>{settings.muted ? 'Sound off' : 'Sound on'}</button><button onClick={() => action('fullscreen')}>Fullscreen</button>{!started && priorSeed !== null && <button onClick={() => action(`restart:${priorSeed}`)}>Last keep</button>}</div>
      </section></div>}
      {mapOpen && <div className="map-screen"><h1>Floor {floorLevel}</h1><p>Gold ring: stair · Bright rooms: explored</p><button className="primary-action" onClick={() => action('pause')}>RESUME</button></div>}
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      {status === 'complete' && <div className="end-screen success-screen"><div className="end-card" role="dialog" aria-modal="true" aria-labelledby="success-title" tabIndex={-1} ref={focusCard}><span className="success-sigil">✦</span><span className="end-kicker">FLOOR {floorLevel} COMPLETE</span><h1 id="success-title">The watch falls silent.</h1><div className="floor-results"><span><strong>{floorResult.kills}</strong>guards felled</span><span><strong>{floorResult.xp}</strong>XP earned</span><span><strong>{Math.floor(floorResult.seconds / 60)}:{String(floorResult.seconds % 60).padStart(2,'0')}</strong>elapsed</span></div><button onClick={() => action('continue')}>{floorLevel < FLOORS ? 'DESCEND TO FLOOR ' + (floorLevel + 1) : 'STEP INTO THE DAWN'} →</button>{floorLevel < FLOORS && <p className="recovery-note">Recover 25% vitality on descent</p>}</div></div>}
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      {boonChoice.length > 0 && status === 'playing' && <div className="end-screen boon-screen"><div className="end-card boon-card" role="dialog" aria-modal="true" aria-labelledby="boon-title" tabIndex={-1} ref={focusCard}>
        <span className="end-kicker">RANK {rank} · CHOOSE A BOON</span><h1 id="boon-title">The tide gives back.</h1>
        <div className="boon-options">{boonChoice.map(boon => <button key={boon.id} className="boon-option" onClick={() => action(`boon:${boon.id}`)}><strong>{boon.name}</strong><span>{boon.detail}</span></button>)}</div>
      </div></div>}
      {(status === 'won' || status === 'lost') && <div className="end-screen result-screen"><div className="end-card result-card" role="alertdialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">{status === 'won' ? 'THE KEEP IS BEHIND YOU' : `FLOOR ${floorLevel} · FAILED`}</span><h1 id="result-title">{status === 'won' ? 'You climb into the dawn.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'Three floors of the drowned watch lie still behind you.' : 'Steel yourself and enter once more.'}</p><div className="xp-summary"><strong>{experience} XP earned</strong><span>Floor {floorLevel} of {FLOORS} · rank {rank} · {defeated} guards felled · XP resets on a new run</span>{best && <small>Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</small>}</div><button onClick={() => action('restart')}>NEW DESCENT</button>{status === 'lost' && runSeed !== null && <button className="seed-retry" onClick={() => action(`restart:${runSeed}`)}>SAME KEEP</button>}</div></div>}
      {/* Plain markup on purpose: the canvas was never mounted, so this is the only thing left to look at. */}
      {displayFailed && <div className="end-screen display-failed"><div className="end-card" role="alertdialog" aria-modal="true" aria-labelledby="display-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">THE GATE STAYS SHUT</span><h1 id="display-title">No light to see by.</h1><p>This browser could not open a 3D display, so the keep cannot be drawn. That most often means hardware acceleration is switched off in the browser&rsquo;s settings.</p></div></div>}
      {displayLost && <output className="display-notice">Display interrupted · the descent is paused</output>}
      {/* The alternative layout, not a fallback bolted onto the stick: four buttons a screen reader can name
          and reach, each speaking the same discrete move:/stop: protocol every automated driver uses. It is
          the worse way to play — one direction at a time, no diagonals — and the only way to play at all if
          the stick's aria-hidden zone is invisible to you, so it is the player's choice and not ours. */}
      {/* A zone, not four keys: movement is screen-relative and diagonal most of the time, so the base plants
          wherever the thumb lands and carries a continuous direction. State lives on the element (data-pointer,
          the origin, the last detail sent) rather than in React, because a drag writes on every pointer frame and
          none of it belongs in a render. Capture is taken first: if it is refused nothing below runs and nothing
          is live, which is what lets a single lost-capture handler own every way a drag can end - a lift, a
          cancel, the element going away - with no path that leaves the knight walking on its own. */}
      {settings.touchLayout === 'pad'
        ? <div className="touch-pad" aria-label="Touch movement controls" inert={cardOpen || mapOpen}>{(['up', 'left', 'down', 'right'] as const).map((dir) => <button key={dir} className={dir} aria-label={`Move ${dir}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action(`move:${dir}`); }} onLostPointerCapture={() => action(`stop:${dir}`)} onPointerUp={() => action(`stop:${dir}`)} onPointerCancel={() => action(`stop:${dir}`)}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</button>)}</div>
        : <div className="touch-stick" aria-hidden="true" inert={cardOpen || mapOpen}
        onPointerDown={(e) => { const z = e.currentTarget; if (z.dataset.pointer) return; z.setPointerCapture(e.pointerId); const r = z.getBoundingClientRect(); z.dataset.pointer = `${e.pointerId}`; z.dataset.ox = `${e.clientX}`; z.dataset.oy = `${e.clientY}`; z.dataset.sent = 'stick:0,0'; z.style.setProperty('--ox', `${e.clientX - r.left}px`); z.style.setProperty('--oy', `${e.clientY - r.top}px`); action('stick:0,0'); }}
        onPointerMove={(e) => { const z = e.currentTarget; if (z.dataset.pointer !== `${e.pointerId}`) return; const dx = e.clientX - Number(z.dataset.ox), dy = e.clientY - Number(z.dataset.oy), span = Math.hypot(dx, dy), live = span > 8; z.style.setProperty('--kx', `${live ? dx * Math.min(span, 44) / span : 0}px`); z.style.setProperty('--ky', `${live ? dy * Math.min(span, 44) / span : 0}px`); const detail = live ? `stick:${(dx / span).toFixed(3)},${(dy / span).toFixed(3)}` : 'stick:0,0'; if (detail !== z.dataset.sent) { z.dataset.sent = detail; action(detail); } }}
        onLostPointerCapture={(e) => { const z = e.currentTarget; if (!z.dataset.pointer) return; delete z.dataset.pointer; z.removeAttribute('style'); action('stick:off'); }}>
        <i className="stick-base" /><i className="stick-knob" /></div>}
      <div className="touch-actions" inert={cardOpen || mapOpen}><button onPointerDown={() => action('dash')}>DASH</button><button className="strike" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-attack'); }} onPointerUp={() => action('release-attack')} onPointerCancel={() => action('release-attack')} onLostPointerCapture={() => action('release-attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
