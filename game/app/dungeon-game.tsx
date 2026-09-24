'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { alertTexture, laneTelegraphTexture, pavingGeometry, pavingKind, ROOM_MOOD, telegraphTexture, tileHash, vaultEnvironment } from './dungeon-art';
import { planPavingPatches } from './dungeon-paving-layout';
import { pavingPatchGeometry } from './dungeon-paving-patches';
import { buildSurfaceIndex, type CellSurface, type SurfaceIndex, type SurfaceTriangle } from './dungeon-surface';
import { makeKnight } from './dungeon-knight';
import { BONES, makeSkeleton } from './dungeon-skeleton';
import { impactEffects } from './dungeon-impact';
import { footstepEffects } from './dungeon-footsteps';
import { footfalls, footSupport, type FootstepKind } from './dungeon-footstep-rules';
import { advanceDeath, startDeath, type DeathAnimation } from './dungeon-death';
import { addAtmosphere, stoneTexture } from './dungeon-atmosphere';
import { flameShaderKeeper } from './dungeon-flame-fx';
import { createPostChain, postQuality } from './dungeon-post';
import { bloodDecals } from './dungeon-blood';
import { applyFloorDetail, applyStoneTextures, getFlagstoneTextures, getMasonryTextures } from './dungeon-textures';
import { createDungeonAudio } from './dungeon-audio';
import { createCutawayController, CUTAWAY_ENEMY_RANGE, type CutawayEnemyCandidate } from './dungeon-occlusion';
import { animateCloth, stoneMood, tideMood, tidalMaterial, weatherStone } from './dungeon-motion';
import { canStand, generateFloor, hasClearPath, moveOnFloor, cellKey, TILE } from './dungeon-floor';
import { CAMERA_OFFSET, groundAim, SCREEN_DOWN, SCREEN_RIGHT, SNAP_REACH, snapAim } from './dungeon-aim';
import { canAbortSwing, DASH_BUFFER, DASH_TIME, dashImmune, playerSpeed, swordContacts } from './dungeon-combat';
import { beatOf, chainLength } from './dungeon-weapon';
import { ALERT_STAGGER, decideEnemy, enemyStats, hitCooldown, interruptsWindup, nearbyDozers, NOTICE_TIME, separateCrowd, type Wakeable } from './dungeon-enemy';
import { enemyPose } from './dungeon-enemy-pose';
import { playerAttackPose } from './dungeon-attack-pose';
import { STARTING_WEAPON, TIDEBLADE, weaponById, type Weapon, type WeaponId } from './dungeon-weapon';
import { disposeWeapon, disposeWeaponDrop, makeBolt, makeFlask, makePoolMesh, makeWeapon, makeWeaponDrop, type ArmedWeapon, type ArmoryPalette, type Plate } from './dungeon-armory';
import { flyShot, poolCatches, poolStep, reloadStep, type Mark, type Pool, type Shot } from './dungeon-projectile';
import { borrowedLight, litDisc, type Radiance } from './dungeon-radiance';
import { playerRunPose, strideRate } from './dungeon-run-pose';
import { weaponTrail } from './dungeon-weapon-trail';
import { ACTIONS, appendRun, betterRun, bindKey, defaultSettings, readBest, readRuns, readSeed, readSettings, RESERVED, summariseRuns, writeBest, writeRuns, writeSeed, writeSettings, type Action, type BestRun, type RunCause, type RunEnd, type Settings } from './dungeon-save';
import { clearRoomReward, createRun, draftBoons, grantXp, heal, hurt, PICKUP_RADIUS, rankCost, resolveKill, STAIR_DWELL, STAIR_RADIUS, stairDwellStep, takeBoon, tickRun, XP_DEAD_END, XP_PER_ENEMY, type Boon, type Reward } from './dungeon-sim';

type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; death: DeathAnimation | null; phase: number; windup: number; lunge: number; aim: THREE.Vector3; room: number; kind: 'guard' | 'stalker' | 'warden'; awake: boolean; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh; alert: THREE.Sprite; attackAge: number; trails: { effect: ReturnType<typeof weaponTrail>; anchor: THREE.Object3D; inner: THREE.Vector3; tip: THREE.Vector3 }[];
  // Where it spawned, for a dozing body's pace; how far into noticing it is; a countdown to a contagion
  // kick a neighbour scheduled for it, or Infinity while none is pending. scripts/balance/sim.ts carries
  // the identical bookkeeping so a room wakes the same way in both sims.
  anchor: { x: number; z: number }; notice: number; alertIn: number };
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
/** Plan 014 round C: what the veil says is happening, one label per stage of `stagedBuild`. The label
 *  shown is the stage now running, so index 0 names the first one before it has finished. */
const VEIL_STAGES = ['Charting the halls', 'Cutting the stone', 'Raising the walls', 'Lighting the braziers', 'Flooding the halls'] as const;
/** Short in-world lines, crossfaded one at a time under the bar (CSS only). */
const VEIL_LORE = [
  'Braziers mark the rooms the warden still watches.',
  'A skeleton that crouches low is about to lunge.',
  'The tide keeps what the keep forgets.',
  'Red on the stone means a blow is already falling.',
  'Dash through a swing, not away from it.',
  'The stair only opens when its hall is quiet.',
  'The deeper the floor, the older the stone.',
  'Steel remembers every hand that held it.',
] as const;
// Keys the browser acts on itself — scrolling, quick-find, back-navigation. Only ever swallowed while one
// of them is actually bound to something, so the list follows a rebind instead of being frozen at the
// defaults: an arrow freed by a rebind goes back to scrolling the page, and a newly bound PageDown stops.
// Tab is deliberately absent. Trapping it would cost a keyboard-only player the way out of the canvas.
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Slash', 'Quote']);
const ACTION_LABELS: Record<Action, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', attack: 'Strike', dash: 'Dodge', swap: 'Take arm', pause: 'Pause', mute: 'Sound', fullscreen: 'Fullscreen' };
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
// Hydration never changes back, so there is nothing to subscribe to.
const noSubscription = () => () => {};

// Plan 009: what one figure costs to draw and how tall it stands, off its live meshes rather than off the
// source. Visible meshes only, walking down through visible nodes; the root's own flag is ignored so an
// ambush body still reports its model. The contact pool is counted, since it draws, and left out of the
// height, since it lies on the floor and writes its own world matrix at draw time (it is the one
// multiply-blended mesh on any actor). Two scratch boxes, so a call allocates nothing but its answer.
const statBox = new THREE.Box3(), partBox = new THREE.Box3();
const actorStat = (root: THREE.Object3D) => {
  let meshes = 0, triangles = 0, shadowless = 0; statBox.makeEmpty(); root.updateWorldMatrix(true, true);
  const walk = (o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry, n = g.index ? g.index.count : g.getAttribute('position').count;
      meshes++; triangles += Math.floor(Math.min(n, g.drawRange.count) / 3);
      if ((o.material as THREE.Material).blending !== THREE.MultiplyBlending) { if (!g.boundingBox) g.computeBoundingBox(); statBox.union(partBox.copy(g.boundingBox!).applyMatrix4(o.matrixWorld)); if (!o.castShadow) shadowless++; }
    }
    for (const child of o.children) if (child.visible) walk(child);
  };
  walk(root);
  return { meshes, triangles, shadowless, height: statBox.isEmpty() ? 0 : +(statBox.max.y - statBox.min.y).toFixed(4) };
};
/**
 * The two colours a blow is told in, and the only two in the keep no chamber is allowed to take.
 *
 * `THREAT` is every windup, of every kind, in every theme. It sits at H8, eighteen degrees off the
 * hottest fire any family burns and clear of the other two entirely, and it wins the one contest that
 * matters on hardness and brightness rather than on hue: a hard-edged arc closing on the body, drawn
 * opaque and above the tone-mapped range, against stone that has none of those three properties.
 *
 * `COMMIT` is the single frame it lands on, stamped on the mark and on the body together. Before this
 * the tell was an opacity ramp from .2 to .7 at a fixed size, which says that something is happening
 * but never says when — and when is the whole question.
 */
const THREAT = 0xff4529, COMMIT = 0xffd6c2;

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
  const [heldWeapon, setHeldWeapon] = useState(TIDEBLADE.name);
  // The arm the knight is standing over, or null when he is standing over nothing. It is the whole of the
  // swap prompt's state: the key it names is read off the bindings at render, so a rebind is live at once.
  const [swapOffer, setSwapOffer] = useState<{ name: string; detail: string } | null>(null);
  // Only on screen while a ranged arm is held, so the minimal HUD stays minimal for every other weapon.
  const [ammo, setAmmo] = useState<{ held: number; of: number } | null>(null);
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
  // Plan 014 round A: which family of foreground silhouettes frames the view - it follows the same
  // chamber theme the lights do, so a keep hall, a ruined court and a flooded hall are no longer all
  // framed by the one identical statue.
  const [frameTheme, setFrameTheme] = useState<keyof typeof ROOM_MOOD>('keep');
  const [advance, setAdvance] = useState(0);
  const [notice, setNotice] = useState(''), [, setNoticeDetail] = useState(''), [ready, setReady] = useState(false);
  // What the keep is busy doing while the player waits on it, or null when it is not busy. Only ever set
  // for work that blocks the main thread long enough to be felt — which in this game is a floor build.
  const [loading, setLoading] = useState<string | null>(null);
  // Plan 014 round C: what the veil reports while a keep is raised - the stage reached (an index into
  // VEIL_STAGES; 0 is "not started"), the floor being built and, once the layout is charted, its name.
  const [veilStage, setVeilStage] = useState(0), [veilFloor, setVeilFloor] = useState(1), [veilPlace, setVeilPlace] = useState<string | null>(null);
  // True on a CPU rasteriser (the reduced post chain, `dungeon-post.ts`): the veil then drops its fog
  // layers, gradients and glow. Those are composited every frame the veil is up, and on software GL that
  // was seconds of raster per boot and per rebuild, out of the same CPU the build itself needs.
  const [plainVeil, setPlainVeil] = useState(false);
  // ENTER THE KEEP pressed before floor 1 exists. The closure holds the press and clears this when it
  // answers it; until then the loading bar is up.
  const [entering, setEntering] = useState(false);
  // False in the prerendered page and on the render that hydrates it, true from then on. The menu is in the
  // server's HTML so it is on screen before the bundle arrives, and its buttons stay disabled until there is
  // a handler behind them rather than swallowing a click.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  // Which page of the menu card is showing. Controls and Settings open in place of the menu list, with a
  // way back, rather than unfolding beneath it and pushing ENTER THE KEEP off a short screen.
  const [menuView, setMenuView] = useState<'main' | 'controls' | 'settings'>('main');
  const returnTo = useRef<string | null>(null);
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
      if (!binds) { setBindNote(keyLabel(e.code) ? `${keyLabel(e.code)} cannot be bound.` : 'That key cannot be bound.'); return; }
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
    let weapon: Weapon = TIDEBLADE;
    // Which beat of the string the running swing is, counting from zero, and how long since the
    // last one ended. `swing` is what the live swing is actually resolved against — the arm itself
    // on beat 0, an overlay on it after that — and every rule a live swing touches reads it rather
    // than `weapon`, or a heavy finish would be scored with the opening cut's numbers.
    let chainBeat = 0, chainIdle = Infinity, swing: Weapon = TIDEBLADE;
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
    // Plan 007: one controller for the life of the mount. Only its registration table and target
    // slots are floor-scoped — `clearFloor` releases them before a floor's own materials are disposed.
    const cutaway = createCutawayController();
    // Floor-scoped state: everything here is torn down and rebuilt when the knight takes the stair down.
    let floor!: ReturnType<typeof generateFloor>;
    let enemyData: Enemy[] = [];
    let atmosphere: ReturnType<typeof addAtmosphere> | null = null;
    // The presentation-only support-height index over this floor's walking surfaces (plan 006/008):
    // rebuilt from the realized scene at the end of every `buildFloor` and simply replaced, never
    // patched, so an old floor's index is dropped with it rather than carried forward.
    let surfaceIndex: SurfaceIndex | null = null;
    let pavingSummary = { pairs: 0, settled: 0, surfaceCells: 0 };
    let visited = new Set<number>([0]), cleared = new Set<number>([0]), spineRooms = new Set<number>();
    let reached = 0, loot = 0, level = 1;
    let floorStart = 0, floorKills = 0, floorXp = 0;
    // Run-scoped, not floor-scoped: these three outlive a descent and are reset only by `restart`, which
    // is what makes the logged duration, boon list and replay seed describe the whole run and not its
    // last floor. `runStart` is the moment the keep was entered, not the moment the page mounted.
    let runStart = 0, firstSeed = 0, boonsTaken: string[] = [];
    let features: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; glow: Radiance; room: number; shrine: boolean; used: boolean; phase: number; burned: boolean }[] = [];
    // The way down sits at the heart of the warden hall: sealed until the last warden falls, then open, and
    // taken only once the knight has stood on it for STAIR_DWELL seconds.
    let stairOpen = false, stairDwell = 0;
    const stairSpot = new THREE.Vector3();
    let parapetSkin: THREE.MeshStandardMaterial | null = null;
    let stairSeal: THREE.Mesh | null = null, stairRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null, stairGlow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null, stairLight: Radiance | null = null;
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
      burst(stairSpot, 0xfbc956, 24);
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
      slash.clear();enemyData.forEach(enemy=>enemy.trails.forEach(trail=>trail.effect.clear()));footsteps.clear();
      // Re-read instead of holding a snapshot: a second tab may have logged its own runs since this one
      // began, and the log is cheap enough to reread once per run that guessing is not worth it.
      const log = appendRun(readRuns(), { at: Date.now(), floor: level, won: !cause, cause, seconds: Math.max(0, Math.round(elapsed - runStart)), rank: run.rankLevel, xp: run.totalXp, kills: run.kills, boons: [...boonsTaken], seed: firstSeed });
      writeRuns(log); setRunLog(log);
    };
    const keys = new Set<string>();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1b24);
    scene.fog = new THREE.FogExp2(0x081820, 0.027);
    const environment = vaultEnvironment(); scene.environment = environment; scene.environmentIntensity = .34;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.42;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 70);
    camera.position.set(10, 13, 13); camera.lookAt(0, 0, 0);
    // Plan 014, lever 3: bloom (flames, eyes, the THREAT/COMMIT marks, the water's own glow), a
    // teal-shadow/orange-highlight grade, a tilt-shift blur and a
    // vignette - see dungeon-post.ts for why no OutputPass follows it.
    const post = createPostChain(renderer, scene, camera, mount.clientWidth || 1, mount.clientHeight || 1, postQuality(renderer, window.location.search));
    setPlainVeil(post.quality === 'reduced');
    const flameKeeper = flameShaderKeeper(); scene.add(flameKeeper);
    // Ambient is the enemy of a lit pool: it paid for every unlit corner, so a brazier could only ever
    // read as a decal on an already-bright floor. Half of it moves into the moon, which models form
    // instead of flattening it, and the rest is bought back by the torches below.
    const hemisphere = new THREE.HemisphereLight(0x8fb4c6, 0x16282c, .52); scene.add(hemisphere);
    // Plan 014 round 2: a floor under the whole scene's black point. The zoomed-in camera (lever 2)
    // and the grade pass's shadow lift (dungeon-post.ts) both push dark areas further toward zero, and
    // a corridor with no torch in view was crushing to near-total black - stone, blocks and figures
    // alike losing all their form rather than just going dim. A flat, direction-independent ambient is
    // what guarantees every visible surface keeps *some* value to shade from, however far it sits from
    // a lamp; it is intentionally small next to the hemisphere and torches above so it never flattens
    // a lit room, only rescues an unlit one.
    // Plan 014 round 4 (lever A2): pushed further teal and a touch brighter - this is meant to read as
    // the flood's own cyan bouncing off every wet surface in the keep, not a neutral grey floor, so an
    // unlit shadow goes dark teal rather than dark nothing. The warm sconces above are what it is
    // supposed to fight against; the two together are the whole of the reference's colour story.
    // Plan 014 round A: .22 left armour and cape crushing to black a stride from a torch. Doubled, and
    // pushed a touch further toward the flood's teal, so an unlit face reads dark teal with form in it.
    scene.add(new THREE.AmbientLight(0x2f5a63, .5));
    // Its intensity is set per chamber below; this is only the value the first frame is built with.
    const moon = new THREE.DirectionalLight(0xccdfe6, 5);
    // One offset, read here and again every frame when the light is re-hung over the knight. It was
    // two separate literals before and they had already drifted apart, which is a silent way to end up
    // with no key angle at all.
    //
    // It is still 46 degrees, and that is a measured decision rather than an unexamined one. Raking the
    // key down to 34 to break it over the six metres of pier the verticality pass stood up is the
    // obvious move and it works — a lit face gains half again as much light, a shadow runs half again
    // as long. It also drags a much longer, shallower volume of the keep into the shadow frustum:
    // 26,000 extra triangles in the flooded hall and 18,000 in the junction, measured, against about
    // 9,000 of junction margin left. At 40 degrees it is still 21,000 and 5,500 for an eleven per cent
    // gain. So the contrast on vertical faces is bought the free way instead — the hemisphere ambient
    // that was filling in every shadowed face is down a fifth, and the stone shader's crown term below
    // lights the top of a tall thing rather than lighting it all evenly.
    const MOONRISE = new THREE.Vector3(-7, 12, 9);
    moon.position.copy(MOONRISE); moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.radius = 3.5; moon.shadow.normalBias = .035; moon.shadow.bias = -.00015;
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12; moon.shadow.camera.right = moon.shadow.camera.top = 12; scene.add(moon);
    const world = new THREE.Group(); scene.add(world);
    const matrix = new THREE.Matrix4();
    const texture = stoneTexture();
    // Plan 014 round 3: one shared canvas texture for every attack telegraph in the keep - a
    // translucent fill, a bright rim and a single arrow baked into its alpha channel - so the mark
    // no longer needs the material's own opacity to reach 1 to be legible. Shown once, unrepeated
    // (round 2's 2x2 tiling of three chevrons apiece was the "scribbled streaks" this replaced).
    const telegraphTex = telegraphTexture(), laneTex = laneTelegraphTexture();
    // Plan 014 round 2 (lever D10): one shared texture for the alert glyph every body in the keep
    // shows the instant it notices the knight and before its own tell begins - see the `notice` window
    // below. Kept just under 1 in the framebuffer's own terms (a plain sRGB texture, tone-mapped like
    // any other sprite) so it reads as a hot little glyph without needing to bloom to be seen.
    const alertTex = alertTexture();
    const alertMaterial = new THREE.SpriteMaterial({map:alertTex,depthTest:false,transparent:true,fog:false});
    // Uploaded now rather than on first use: these only ever draw once a guard notices or winds up, so a
    // lazy upload made the renderer's texture count grow mid-floor, which reads as a leak to every check
    // that compares resource counts across rebuilds - and it was a hitch on the first windup besides.
    for (const shared of [telegraphTex, laneTex, alertTex]) renderer.initTexture(shared);
    const torchLights: THREE.PointLight[] = [];
    // Cutoff distance is what was drawing the hard-edged ellipse. Three windows a point light's falloff
    // by `(1 - (d/distance)^4)^2`, which collapses to zero over the last few units, and at distance 15 in
    // a room about that wide the collapse landed inside the frame — so the pool had a rim and read as a
    // decal. No cutoff and a physical inverse square instead: the same brightness where it matters and a
    // tail that simply runs out. The intensity here is dead code, overwritten by the flicker each frame.
    for (let i = 0; i < 4; i++) { const light = new THREE.PointLight(0xff9440,22,0,2); torchLights.push(light); scene.add(light); }
    // The sconces, lanterns and water bounces the atmosphere pass lays out are anchors, not lights (see
    // `LightAnchor`): this fixed pool is lent to the ones nearest the knight each frame. A spare one sits
    // at zero intensity rather than hidden, because an invisible light drops out of the count and a new
    // count recompiles every lit shader - the very stall the pool exists to prevent.
    const ANCHOR_LIGHTS = 4;
    const anchorLights: THREE.PointLight[] = [];
    for (let i = 0; i < ANCHOR_LIGHTS; i++) { const light = new THREE.PointLight(0xff9c52,0,6.5,2); anchorLights.push(light); scene.add(light); }
    // No fifth torch. The review's complaint was that an effect throws no light,
    // and the honest fix is a real one — but the renderer's light budget is spent
    // (a moon, a hemisphere, four torches and the knight's lantern) and a sixth
    // point light is paid for by every lit fragment in the keep, every frame,
    // whether anything is happening or not. So the fourth torch is lent out
    // instead. It is the fourth-nearest by construction, which makes it the least
    // of the four in any frame, and it is only ever away from its sconce while
    // something louder than a torch is on screen.
    const ember = borrowedLight(torchLights[3], 0xff9440);
    // One scratch vector for every bid: a light hung at floor level throws a hot
    // ring and reaches no wall, so each event lifts its offer off the paving.
    const lampAt = new THREE.Vector3(), barRight = new THREE.Vector3();
    const player = makeKnight(); world.add(player);
    // Every transform the rig is born with, so a reset can put it back. The pose is reached by
    // damping, which approaches a rest value without arriving, and `advanceTime(0)` moves nothing -
    // so a rig a scenario left mid-stride would still be mid-stride for the next one on the same
    // page. Recording the pose beats listing the bones, which would want a line every time the
    // knight grows one.
    // Euler rather than quaternion: a rotation that goes out through a quaternion and back comes
    // home a bit-width away from where it left, and -0.1 restored as -0.09999999999999999 is a
    // difference the pooled-page guard is right to refuse to ignore.
    const restPose = new Map<THREE.Object3D, { p: THREE.Vector3; r: THREE.Euler }>();
    player.traverse((o) => restPose.set(o, { p: o.position.clone(), r: o.rotation.clone() }));
    // The knight's own lantern, and the one lever that protects rule two. Same treatment: no cutoff ring
    // around him, and enough intensity that this round's floor work cannot ride him down with it.
    // Warm, and the same warm in all three families. It used to be cold, which worked while every
    // brazier in the keep burned amber and stopped working the moment two of the three families went
    // cold themselves: a cyan lantern inside a witchfire-lit hall is one more blue light in a blue
    // room. A warm lamp is the one thing none of the three themes now burns for itself, so the knight
    // carries the only warm pool in the standing keep and in the flood, and in the ruin, where he does
    // not, the cape is already doing it.
    // Plan 014 round A: 27 -> 46, and hung lower and further toward the camera (see the per-frame
    // placement below), so the steel and the red cape catch it on the faces the camera actually sees.
    const fill = new THREE.PointLight(0xffdfbe, 46, 0, 2); scene.add(fill);
    // Every room in the keep was lit by these same lamps under this same fog, so a theme could only
    // ever differ from its neighbours by the base colour of its paving — and the moss tint in the
    // stone shader pulled even that back toward one drowned green. Eight frames, one colour. The
    // reference does the opposite: an area commits to a hue family and leaves a single saturated
    // thing to carry against it.
    //
    // So the key, the sky and ground bounce, the fog, the backdrop, the environment weight and the
    // four tints the stone weathers with all read `ROOM_MOOD` for the chamber the knight is standing
    // in. Crossing a threshold slides them over about a third of a second, which is slow enough to
    // read as walking into somewhere else and fast enough to have finished before he is through the
    // door. The first frame of a floor snaps rather than sliding, so a descent never fades in.
    const moodKey = new THREE.Color(), moodSky = new THREE.Color(), moodGround = new THREE.Color();
    const moodFog = new THREE.Color(), moodBack = new THREE.Color(), moodTo = new THREE.Color();
    // What burns here, and the one accent hung on cloth. These two cross the threshold with the lights
    // rather than with the stone, because a brazier three rooms back is the thing that says which way
    // the knight has come from.
    const moodFire = new THREE.Color(), moodBanner = new THREE.Color(), moodMasonry = new THREE.Color(), moodBed = new THREE.Color();
    const moodNumbers = { key: 0, hemisphere: 0, fog: 0, environment: 0 };
    const torchTint = new THREE.Color(), torchWarm = new THREE.Color(0xff9a4a);
    let moodFloor: typeof floor | null = null, moodCell = '', moodTheme: keyof typeof ROOM_MOOD = 'keep', moodSnap = true;
    const mixTo = (v: THREE.Vector3, to: readonly [number, number, number], k: number) =>
      v.set(v.x + (to[0] - v.x) * k, v.y + (to[1] - v.y) * k, v.z + (to[2] - v.z) * k);
    const moveMood = (rate: number) => {
      // A corridor belongs to whichever chamber it is nearest. Without that the hue would change on
      // the doorway rather than on the approach, which is the one place the change would be visible
      // as a change rather than as arrival.
      const cx = Math.round(player.position.x / TILE), cz = Math.round(player.position.z / TILE), cell = cellKey(cx, cz);
      if (moodFloor !== floor) { moodFloor = floor; moodCell = ''; moodSnap = true; }
      if (cell !== moodCell) {
        moodCell = cell;
        const id = floor.roomByCell.get(cell) ?? -1;
        if (id >= 0) moodTheme = floor.rooms[id].theme;
        else { let best = Infinity; for (const r of floor.rooms) { const d = (r.x - cx) ** 2 + (r.z - cz) ** 2; if (d < best) { best = d; moodTheme = r.theme; } } }
        setFrameTheme(moodTheme);
      }
      const m = ROOM_MOOD[moodTheme], k = moodSnap ? 1 : rate; moodSnap = false;
      moodKey.lerp(moodTo.setHex(m.key), k); moodSky.lerp(moodTo.setHex(m.sky), k); moodGround.lerp(moodTo.setHex(m.ground), k);
      moodFog.lerp(moodTo.setHex(m.fog), k); moodBack.lerp(moodTo.setHex(m.background), k);
      moodFire.lerp(moodTo.setHex(m.fire), k); moodBanner.lerp(moodTo.setHex(m.banner), k);
      moodMasonry.lerp(moodTo.setHex(m.masonry), k); moodBed.lerp(moodTo.setHex(m.foundation), k);
      moodNumbers.key += (m.keyIntensity - moodNumbers.key) * k;
      moodNumbers.hemisphere += (m.hemisphere - moodNumbers.hemisphere) * k;
      moodNumbers.fog += (m.fogDensity - moodNumbers.fog) * k;
      moodNumbers.environment += (m.environment - moodNumbers.environment) * k;
      moon.color.copy(moodKey); moon.intensity = moodNumbers.key;
      hemisphere.color.copy(moodSky); hemisphere.groundColor.copy(moodGround); hemisphere.intensity = moodNumbers.hemisphere;
      (scene.fog as THREE.FogExp2).color.copy(moodFog); (scene.fog as THREE.FogExp2).density = moodNumbers.fog;
      (scene.background as THREE.Color).copy(moodBack); scene.environmentIntensity = moodNumbers.environment;
      // Every lamp in the keep, including the one that gets lent out: the sconce it returns to has to
      // burn what its three neighbours burn or a borrow reads as a colour change rather than a flare.
      // Plan 014 round B: the pools carry the warmth. A brazier's light is its theme's fire run a third
      // of the way to amber, so even a teal or violet chamber holds a warm pool against its cool ambient.
      torchTint.copy(moodFire).lerp(torchWarm, .35);
      for (const light of torchLights) light.color.copy(torchTint);
      ember.home.copy(torchTint);
      mixTo(tideMood.value, m.water, k);
      mixTo(stoneMood.moss.value, m.moss, k); mixTo(stoneMood.warm.value, m.warm, k);
      mixTo(stoneMood.cool.value, m.cool, k); mixTo(stoneMood.crown.value, m.crown, k);
      stoneMood.mossAmount.value += (m.mossAmount - stoneMood.mossAmount.value) * k;
    };
    // Plan 014 round 7 (lever 5): a .05-unit-wide `RingGeometry` annulus has no room for its own edges
    // to feather even with antialiasing on, which is what "hard, aliased thin line" was describing.
    // Widened into an actual band and given a radial alpha curve instead - RingGeometry's own UV.y runs
    // 0 at the inner edge to 1 at the outer one, so a `smoothstep` pair peaking mid-band is a feathered
    // gradient with no texture, and a slow sine on top is the "subtle pulse".
    const ringTime={value:0};
    const playerRingMaterial=new THREE.MeshBasicMaterial({color:0xcfe6e4,transparent:true,opacity:0.45,depthWrite:false,side:THREE.DoubleSide});
    playerRingMaterial.onBeforeCompile=shader=>{
      shader.uniforms.uRingTime=ringTime;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 ringUv;')
        .replace('#include <uv_vertex>','#include <uv_vertex>\nringUv = uv;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uRingTime;\nvarying vec2 ringUv;')
        .replace('#include <color_fragment>',`#include <color_fragment>
          float ringBand = smoothstep(0.0, 0.42, ringUv.y) * smoothstep(1.0, 0.55, ringUv.y);
          float ringPulse = 0.82 + 0.18 * sin(uRingTime * 2.1);
          diffuseColor.a *= ringBand * ringPulse;
        `);
    };
    playerRingMaterial.customProgramCacheKey=()=>'player-ring-feathered-v1';
    const playerRing = new THREE.Mesh(new THREE.RingGeometry(0.36,0.68,48),playerRingMaterial);playerRing.rotation.x=-Math.PI/2;world.add(playerRing);
    const cameraFocus = new THREE.Vector3();
    const velocity = new THREE.Vector3(), facing = new THREE.Vector3(1, 0, -0.6).normalize();
    const attackFacing = facing.clone(), dashFacing = facing.clone();
    let bufferedFacing: THREE.Vector3 | null = null;
    // Derived from the camera rather than written down beside it: `dungeon-aim` inverts the same
    // offset to turn a screen position back into a place on the floor, and a pointer that steered in
    // a basis of its own would point somewhere the keys could not reach.
    const screenRight = new THREE.Vector3(SCREEN_RIGHT.x, 0, SCREEN_RIGHT.z);
    const screenDown = new THREE.Vector3(SCREEN_DOWN.x, 0, SCREEN_DOWN.z);
    player.rotation.y = Math.atan2(-facing.x, -facing.z);
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const sparkGeo = new THREE.TetrahedronGeometry(0.075, 0), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb24a, toneMapped: false });
    const burst = (at: THREE.Vector3, color = 0xffb24a, amount = 12) => { for (let i = 0; i < amount; i++) { const mesh = new THREE.Mesh(sparkGeo, color === 0xffb24a ? sparkMat : new THREE.MeshBasicMaterial({ color, toneMapped: false })); mesh.position.copy(at).add(new THREE.Vector3(0, 0.8, 0)); const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5; particles.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s), life: 0.35 + Math.random() * 0.3 }); world.add(mesh); } };
    // The knight's ribbon is drawn from inside his grip out past the tip, towards
    // the distance the arc actually reaches: the blade mesh runs to 1.17 and the
    // Tideblade cuts at 1.8, so a trail sampled at the steel undersold the swing
    // by a third. 1.34 of the blade puts the outer edge at 1.57, most of the way
    // out without drawing a ribbon past where the blow would land. Same buffers,
    // same draw call, same 46-triangle ceiling; the longer life is what makes it
    // read as one crescent rather than as a wire.
    // Plan 014 round 8 (lever 3): .14s of retained history was well under the swing's own active
    // window, so a capture anywhere but right at the very end of the beat caught a short, half-built
    // ribbon rather than the full ~150 degree crescent the blade actually swept. Longer retention
    // directly lengthens the visible arc at any instant without touching the shared edge shader
    // (`dungeon-weapon-trail.ts`) that enemies also use, so it cannot introduce the "shapeless blob"
    // round 2 fixed - that was a blend-strength problem, not a lifetime one.
    // Plan 014 round 9 (lever 1): `reach` (replacing the old fan object) scales the ribbon's own
    // cross-width beyond the sword's literal blade thickness, which combined with the spline now
    // doing the actual curvature is what turns the recorded tip path into a wide crescent stroke.
    const slash=weaponTrail(0xffedc5,.22,1.05,3.0);world.add(slash.mesh);
    const impacts=impactEffects();world.add(impacts.group);
    // Plan 014 round 2 (lever B5): persistent blood splats where a blow lands. World-scoped like every
    // other pooled effect here, and cleared at the top of `buildFloor` alongside the slash and the
    // shots rather than being torn down and rebuilt with the floor group each descent.
    const blood=bloodDecals();world.add(blood.group);
    // Plan 008: one bounded particle batch for every footfall of the mounted game (see dungeon-footsteps).
    // It owns its geometry and material and disposes them itself on unmount, detaching first so the
    // generic Mesh traversal below never sees them. `stepLog` is read-only diagnostics, reset on restart.
    const footsteps=footstepEffects();world.add(footsteps.group);
    const soleAt=new THREE.Vector3();
    let stepLog:{contacts:number;skipped:number;kinds:Record<FootstepKind,number>;last:{count:number;side:0|1;kind:FootstepKind;cell:string;x:number;y:number;z:number}|null}={contacts:0,skipped:0,kinds:{keep:0,ruins:0,flooded:0},last:null};
    // The trail samples the blade's world path between these two, so they move with the weapon: a spear
    // sampled at a sword's tip would trail from the middle of its own haft.
    let armed = player.userData.armed as ArmedWeapon;
    let bladeInner=armed.inner.clone(),bladeTip=armed.tip.clone();
    // The one arm laid out on this floor, and the ring that marks it.
    let drop: {group:THREE.Group; ring:THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; blade:ArmedWeapon; kind:WeaponId; x:number; z:number} | null = null;
    // Whether the knight is inside the rack's ring this frame, and what the prompt was last told. The
    // second exists only so the offer is pushed into React on the step he arrives and the step he leaves,
    // rather than sixty times a second for as long as he stands there.
    let overDrop = false, offered: WeaponId | null = null, ringLit = 0;
    // Put a different arm in the knight's hand. The old geometry is released; the materials are his own
    // and outlive every swap, so nothing but the meshes is rebuilt.
    const equip = (id: WeaponId) => {
      const {palette, plate} = player.userData.armoury as {palette: ArmoryPalette; plate: Plate};
      disposeWeapon(armed, palette);
      weapon = weaponById(id);
      armed = makeWeapon(id, palette, plate);
      (player.userData.sword as THREE.Group).add(armed.group);
      player.userData.armed = armed;
      bladeInner=armed.inner.clone();bladeTip=armed.tip.clone();
      // A swap mid-swing would otherwise leave the old blade's ribbon hanging in the air.
      attackTime = 0; swingHits.clear(); slash.clear();
      // A string belongs to the arm that swings it: carrying a half-finished one across a swap
      // would open the new weapon on its heavy beat.
      chainBeat = 0; chainIdle = Infinity; swing = weapon; posePlayer(0);
      // A weapon picked up arrives loaded; bolts already in the air are the old arm's and stay in it.
      quiver = weapon.ranged ? weapon.ranged.capacity : 0; reload = 0;
      setAmmo(weapon.ranged ? { held: quiver, of: weapon.ranged.capacity } : null);
    };
    // Bolts in hand, and the clock the next one comes back on. A ranged arm is limited by a quiver
    // rather than by a cooldown: the knight walks at 8.5 against a stalker's 3.2, so a shot that merely
    // recovered on a timer would let him back away and win the keep without ever being reachable.
    let quiver = 0, reload = 0;
    const shots: { shot: Shot; mesh: THREE.Group }[] = [];
    // Fired shots come out of a pool. The suite asserts a floor allocates no new GPU memory once built.
    const boltPool = Array.from({ length: 8 }, () => { const bolt = makeBolt((player.userData.armoury as {palette: ArmoryPalette}).palette); world.add(bolt); return bolt; });
    const flaskPool = Array.from({ length: 6 }, () => { const flask = makeFlask((player.userData.armoury as {palette: ArmoryPalette}).palette); world.add(flask); return flask; });
    // Burning silt the knight left behind, and the rings that show it. Pooled like everything else.
    const pools: { pool: Pool; mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> }[] = [];
    const poolMeshes = Array.from({ length: 6 }, () => { const mesh = makePoolMesh(); world.add(mesh); return mesh; });
    const clearShots = () => {
      for (const live of shots) live.mesh.visible = false;
      shots.length = 0;
      for (const live of pools) live.mesh.visible = false;
      pools.length = 0;
    };
    // Push the prompt at the bottom of the screen, or take it away. Null-to-null and same-arm-to-same-arm
    // are dropped here rather than in React: the loop asks every frame and setState on every one of them
    // would re-render the whole shell sixty times a second for a line of text that never changed.
    const showOffer = (kind: WeaponId | null) => {
      if (offered === kind) return;
      offered = kind;
      const arm = kind === null ? null : weaponById(kind);
      setSwapOffer(arm ? { name: arm.name, detail: arm.detail } : null);
    };
    // Lay an arm on a rack. Called once when the floor is built and again on every swap, because what
    // the knight sets down stays where he found it: a pickup he regrets is a walk back, not a dead run.
    const placeDrop = (kind: WeaponId, x: number, z: number) => {
      const {palette, plate} = player.userData.armoury as {palette: ArmoryPalette; plate: Plate};
      if (drop) disposeWeaponDrop(drop, palette);
      const built = makeWeaponDrop(kind, palette, plate);
      built.group.position.set(x, 0, z);
      floorGroup.add(built.group);
      drop = {...built, kind, x, z};
      overDrop = false; ringLit = 0; showOffer(null);
    };
    const posePlayer=(age:number)=>{
      const pose=playerAttackPose(age,swing,chainBeat),sword=player.userData.sword as THREE.Group;
      sword.rotation.set(pose.swordPitch,pose.swordYaw,pose.swordRoll);
      sword.position.set(.44,.3,-.02-pose.armReach);
      sword.scale.z=1+run.reach*.5;
      player.userData.torso.rotation.set(0,pose.bodyYaw,pose.bodyRoll);
      if(age===0){player.userData.torso.rotation.x=locomotion.pitch;player.userData.torso.rotation.y+=locomotion.twist;sword.rotation.x+=locomotion.swordPitch;}
      return pose;
    };
    const trailGeo=new THREE.PlaneGeometry(.11,1.15);
    // Faded to zero opacity is not gone: a transparent mesh still passes the frustum and still costs a
    // draw, so these twelve sat in the counters of every scene in the keep whether or not anyone had
    // dashed. They are toggled outright now, and the twelve calls that buys pay for the first of the
    // vertical structure this round adds.
    const dashTrails=Array.from({length:12},()=>{
      const m=new THREE.Mesh(trailGeo,new THREE.MeshBasicMaterial({color:0xa9e5db,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
      m.rotation.x=-Math.PI/2;m.userData.life=0;m.visible=false;world.add(m);return m;
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
      // First: restores every registered mesh's original material and disposes each cutaway variant,
      // so the ordinary traversal/dispose below never finds a disposed variant still assigned.
      cutaway.releaseFloor();
      // Before the traversal below disposes every material on the floor: the rack is drawn in the
      // knight's own palette, and he is still wearing it.
      if (drop) { disposeWeaponDrop(drop, (player.userData.armoury as {palette: ArmoryPalette}).palette); drop = null; }
      atmosphere?.dispose();
      impacts.clear(); footsteps.clear();
      floorGroup.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      (floorGroup.userData.floorDetail as THREE.Texture | null | undefined)?.dispose(); world.remove(floorGroup);
      particles.forEach(p => { world.remove(p.mesh); if (p.mesh.material !== sparkMat) (p.mesh.material as THREE.Material).dispose(); });
      particles.length = 0;
      dashTrails.forEach(m=>{m.userData.life=0;m.visible=false;(m.material as THREE.MeshBasicMaterial).opacity=0;});
    };
    // Building a floor is the one thing here that blocks the main thread long enough to be felt — a tenth
    // of a second on a desktop, several times that on a phone — and every build is something the player has
    // just asked for and is now waiting on with no sign that anything is happening. So the veil goes up
    // first and the work waits two frames: a single rAF callback still runs before the frame it belongs to
    // is painted, so with one the build would land on the very frame the veil was meant to appear in and
    // nothing would ever be seen. A third frame after it lets the new floor be drawn under the veil before
    // it lifts, or a descent would flash the floor it just left. The mark spins on the compositor, which is
    // what keeps it turning through a block the main thread cannot answer.
    let building = false;
    // Plan 014 round C: the build is split into stages that each yield to the browser before the next,
    // so the veil can paint an honest step and a label between them rather than easing a bar toward a
    // number nobody measured. Each stage is still one synchronous block - the emblem and the fog run on
    // the compositor for exactly that reason - but the bar now moves when real work finishes:
    //   1 chart the layout (the pure generator, and the one seed draw a build makes)
    //   2 cut the stone (first-use texture generation, `dungeon-textures.ts`; cached after that)
    //   3 raise the floor (the caller's own work: `buildFloor` and whatever resets ride with it)
    //   4 warm the shaders (`renderer.compile` plus one post-chain draw, so the first visible frame does
    //     not stall on program compiles - the cold-start hitch)
    //   5 draw the first frame, and lift the veil only on the frame after it has been presented.
    // `afterWork` runs the moment stage 3 is done, before the warm-up: the floor exists and is playable from
    // then on, which is when the boot installs the window hooks. The warm-up can take ~10 s on a cold shader
    // cache (see the compile below), and nothing that only reads or steps the floor should wait
    // on it - only what shows the floor (the frame loop, the canvas fade-in, a waiting press) does.
    // `dungeonTest.buildFloor`/`reset` never come through here: they stay synchronous and deterministic.
    let pendingFloor: { level: number; floor: ReturnType<typeof generateFloor> } | null = null;
    // A frame boundary the browser has painted: a rAF callback runs before its own frame's paint, so
    // it takes two. A hidden tab runs no animation frames, and a build must not wait on it. Nor does a
    // build under a driver's clock (`advanceTime` stopped the frame loop): the stages then only have to
    // yield, so a second press still lands while the first build is pending, but they do not hold the
    // veil up for twelve frames nobody is watching - on a CPU rasteriser that was most of a test reset,
    // since every frame of the veil's fog layers was composited in software.
    const painted = () => new Promise<void>((done) => {
      if (document.hidden || manualTime) { setTimeout(done, 0); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    });
    const stagedBuild = async (nextLevel: number, seed: number | undefined, work: () => void, afterWork?: () => void) => {
      setVeilFloor(nextLevel); setVeilPlace(null); setVeilStage(0);
      await painted(); if (stopped) return false;
      const charted = generateFloor(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], nextLevel);
      pendingFloor = { level: nextLevel, floor: charted };
      setVeilPlace(charted.rooms[charted.goal]?.name ?? null); setVeilStage(1);
      await painted(); if (stopped) return false;
      getFlagstoneTextures(); getMasonryTextures();
      setVeilStage(2);
      await painted(); if (stopped) return false;
      work(); pendingFloor = null; afterWork?.();
      setVeilStage(3);
      await painted(); if (stopped) return false;
      // Compiled against the composer's own offscreen target, not the canvas: a material's program
      // differs by render target (tone mapping and output encoding are only baked in when drawing
      // straight to the canvas), and compiling for the canvas built variants the post chain never uses.
      // Synchronous on purpose. `compileAsync` polls the materials it collected across later frames,
      // and a floor torn down meanwhile (a restart, or the test pool's reset) crashed three.js inside
      // that poll on a disposed material, leaving the promise - and the veil - hanging forever. With
      // the point lights capped (see `ANCHOR_LIGHTS`) a cold compile is ~10 s rather than minutes, one
      // task the veil's compositor-driven animation runs straight through.
      world.updateMatrixWorld(true);
      const drawingTo = renderer.getRenderTarget(); renderer.setRenderTarget(post.composer.readBuffer);
      flameKeeper.visible = true; renderer.compile(scene, camera); flameKeeper.visible = false; renderer.setRenderTarget(drawingTo); post.pinPrograms();
      if (stopped) return false;
      // The two frames below are for the player: the first takes the post chain's own first-use cost
      // behind the veil, the second is the floor that is on screen when it lifts. A driver that owns the
      // clock draws when it asks to and sees nothing until then, so under manual time neither is drawn -
      // a full scene pass twice per reset was the largest single cost of a pooled test on software GL.
      if (!manualTime) { post.render(elapsed); }
      setVeilStage(4);
      await painted(); if (stopped) return false;
      if (!manualTime) { post.render(elapsed); }
      setVeilStage(5);
      await painted();
      return !stopped;
    };
    // `then` runs as the veil lifts, on the frame the new floor is first on screen.
    const veiled = (line: string, plan: { level: number; seed?: number }, work: () => void, then?: () => void) => {
      // A second press while a build is pending would queue a second build: the status that guards each
      // caller does not change until the work this one is holding actually runs.
      if (building) return;
      building = true; setLoading(line);
      void stagedBuild(plan.level, plan.seed, work).then((ok) => { if (!ok) return; building = false; setLoading(null); setVeilStage(0); then?.(); });
    };
    // An explicit seed replays a floor verbatim; without one the keep is new every descent.
    const buildFloor = (nextLevel: number, seed?: number) => {
      const clock = performance.now(); let mark = clock;
      const phase = (name: string) => { const now = performance.now(); buildMs[name] = +(now - mark).toFixed(1); mark = now; };
      buildMs = {};
      if (atmosphere) clearFloor();
      phase('dispose');
      level = nextLevel; floorStart = elapsed; floorKills = run.kills; floorXp = run.totalXp; features = []; stairOpen = false; stairDwell = 0; drop = null; overDrop = false; showOffer(null);
      gameStatus = 'playing'; setStatus('playing');
      // A staged build (see `stagedBuild`) charts the layout a stage early so the veil can name it; the
      // floor it drew is taken here instead of drawing a second seed. Only a match is taken - the same
      // level, and the same seed if one was asked for - so a synchronous build never sees a stale one.
      const charted = pendingFloor && pendingFloor.level === level && (seed === undefined || pendingFloor.floor.seed === seed >>> 0) ? pendingFloor.floor : null;
      pendingFloor = null;
      floor = charted ?? generateFloor(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], level);
      // Pure and deterministic off this floor alone: which stone cells merge into a long slab or
      // settle as a staggered strip, kept away from every 004 reservation before a single mesh exists.
      const pavingPlan = planPavingPatches(floor);
      phase('generate');
      // Floor 1 is the run's fingerprint: keeping its seed is what lets a lost run be taken again, and it
      // is what a logged entry carries, so the log is held here rather than read off the current floor.
      if (level === 1) { firstSeed = floor.seed; runStart = elapsed; setRunSeed(floor.seed); writeSeed(floor.seed); }
      floorGroup = new THREE.Group(); world.add(floorGroup);
      swingHits.clear();slash.clear();clearShots();blood.clear();posePlayer(0);
      visited = new Set([0]); cleared = new Set([0]); spineRooms = new Set(floor.spine);
      reached = 0; loot = 0; activeRoom = 0; pathCell = ''; distances.clear();
      // `vertexColors` is the slab's baked joint shading, and it multiplies with the per-instance tint
      // rather than replacing it. Only the three paving geometries use this material, and all three carry
      // the attribute.
      // Plan 014 round 3 (lever B5): the old `map`/`bumpMap` pair (a 256px grain speckle, tiled by the
      // slab's own local UV so it repeated identically on every instance) is gone in favour of a real
      // generated flagstone material sampled in world space - see `dungeon-textures.ts`. `weatherStone`
      // still runs first for its per-room tint, crack/moss placement and wet-roughness dip; the
      // triplanar sample multiplies on top of that rather than replacing it.
      const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .83, vertexColors: true });
      weatherStone(floorMaterial);
      applyStoneTextures(floorMaterial, getFlagstoneTextures(), 1.1);
      // Plan 014 round B: wall-base grime, near-mirror puddles and per-slab variation (dungeon-textures.ts).
      const floorDetail = applyFloorDetail(floorMaterial, [...floor.tiles, ...floor.props].map(({ x, z }) => ({ x: x * TILE, z: z * TILE })), TILE); floorGroup.userData.floorDetail = floorDetail;
      const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
      // A corridor tile belongs to no room and used to take the keep's own grey wherever it ran, so a
      // passage through the ruin came out as a grey ribbon laid across an ochre floor. It takes the
      // nearest chamber's theme instead, which is the same rule the lighting uses to decide what to
      // put in the air above it, so the two agree about where one area ends.
      const themeOf=(x:number,z:number,room:number)=>{if(room>=0)return floor.rooms[room].theme;let best=Infinity,theme=floor.rooms[0].theme;for(const r of floor.rooms){const d=(r.x-x)**2+(r.z-z)**2;if(d<best){best=d;theme=r.theme;}}return theme;};
      // The slab itself, and the two damaged variants. Flat-shaded and built by hand rather than a
      // smooth-chamfered rounded box: the rim now holds four distinct values under the key instead of a
      // two-pixel gradient, and it costs eighteen triangles where the box cost a hundred and eight. The
      // reasoning, and the measured values of the five faces, are over `pavingGeometry`.
      const tileGeometry=pavingGeometry('plain'),grooveGeometry=pavingGeometry('groove'),dishGeometry=pavingGeometry('dish'),foundationGeometry=new THREE.BoxGeometry(1.49,2.65,1.49);
      // White, and coloured per instance instead: the submerged plinth is the tallest continuous run of
      // stone in any frame and it was one fixed teal under every theme, which made it one of the loudest
      // things holding the three areas together. Per-instance colour is a buffer, not a draw call.
      const foundationMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9});weatherStone(foundationMaterial);applyStoneTextures(foundationMaterial,getMasonryTextures(),.9);
      // One cell's worth of paving colour, shared by the plain batches and by both variant meshes so a
      // damaged slab weathers like the one beside it. The jitter this replaces was `abs(x*7+z*3)%7`, and
      // seven divides seven — the x term cancelled and the field was a function of z alone, so two rounds
      // of "per-tile" albedo have been painting rows. Same mean and same spread as before; per cell now.
      const tint=new THREE.Color();
      const slabTint=(x:number,z:number,room:number)=>{
        const mood=ROOM_MOOD[themeOf(x,z,room)];
        const border=room>=0&&(Math.abs(x-floor.rooms[room].x)===floor.rooms[room].halfX-1||Math.abs(z-floor.rooms[room].z)===floor.rooms[room].halfZ-1);
        const wear=tileHash(x,z,1),drift=tileHash(x,z,2);
        // Plan 014 round 8 (lever 6): a hard `drift<.5?A:B` branch is a coin flip per tile, and a coin
        // flip laid over a grid is exactly what reads as a checkerboard once enough tiles are on
        // screen at once - two fixed hue offsets, no continuum between them, so neighbouring tiles
        // either match or don't with nothing in between. Both terms are continuous functions of
        // `drift` now (no threshold at all) and both ranges are narrower - the triplanar stone texture
        // from `applyStoneTextures` already carries real per-tile variation; this only has to keep the
        // instanced batch from reading as one flat colour, not do all the work itself.
        tint.setHex(border?mood.border:mood.tile).multiplyScalar(.89+wear*.09).offsetHSL((drift-.5)*.012,drift*.01-.005,0);
        return {mood,wear};
      };
      const slabEuler=new THREE.Euler(),slabTurn=new THREE.Quaternion(),slabAt=new THREE.Vector3(),slabScale=new THREE.Vector3(1,1,1);
      // A settled slab is the plain slab dropped four centimetres into its bed and left crooked, and it is
      // the one damage variant that is free: an instance matrix is not a draw call. It only ever sinks —
      // the tilt is small enough that no corner comes back up proud of its neighbours.
      const seat=(x:number,z:number,settled:boolean)=>{
        const spin=(Math.abs(x*13+z*7)%4)*Math.PI/2;
        if(settled){slabEuler.set((tileHash(x,z,4)-.5)*.09,spin,(tileHash(x,z,5)-.5)*.09);matrix.compose(slabAt.set(x*TILE,-.126,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);}
        // Plan 014 round 4 (lever C7): even an ordinary, undamaged slab now sits a few millimetres off
        // true - height and tilt both hashed off its own cell, same as the settled variant but far
        // subtler, so a floor of identical flat slabs picks up the same faint unevenness real flagstone
        // never loses even where nothing has actually broken.
        else{slabEuler.set((tileHash(x,z,24)-.5)*.025,spin,(tileHash(x,z,25)-.5)*.025);matrix.compose(slabAt.set(x*TILE,-.07-tileHash(x,z,26)*.012,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);}
        return matrix;
      };
      // Macro paving (plan 006): a merged pair's two cells never get an ordinary top at all - their
      // slab is the new rectangular patch below - and a settled single is forced to plain regardless
      // of what the per-tile damage roll would have said, so the two mechanisms never stack.
      const macroSettle=(x:number,z:number)=>{
        const spin=(Math.abs(x*13+z*7)%4)*Math.PI/2;
        const drop=.025+tileHash(x,z,21)*.02, tiltX=(tileHash(x,z,22)-.5)*.06, tiltZ=(tileHash(x,z,23)-.5)*.06;
        slabEuler.set(tiltX,spin,tiltZ);matrix.compose(slabAt.set(x*TILE,-.07-drop,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);
        return matrix;
      };
      const variants:Record<'groove'|'dish',typeof stoneTiles>={groove:[],dish:[]};
      // Spatial batches let both the view and shadow camera reject distant carved paving.
      const paving=new Map<string,typeof stoneTiles>();for(const tile of stoneTiles){const key=`${Math.floor(tile.x/12)},${Math.floor(tile.z/12)}`;const batch=paving.get(key);if(batch)batch.push(tile);else paving.set(key,[tile]);}
      for(const local of paving.values()){
        const plain=local.filter(t=>{
          const key=`${t.x},${t.z}`;
          if(pavingPlan.pairedCells.has(key))return false; // top drawn by the merged pair mesh below
          if(pavingPlan.settledCells.has(key))return true; // ordinary geometry, new settle transform
          const kind=pavingKind(t.x,t.z);if(kind==='groove'||kind==='dish'){variants[kind].push(t);return false;}return true;
        });
        const tiles=new THREE.InstancedMesh(tileGeometry,floorMaterial,plain.length),foundations=new THREE.InstancedMesh(foundationGeometry,foundationMaterial,local.length);
        // Every cell keeps its plinth, including the ones whose slab is drawn by a variant mesh below.
        local.forEach(({x,z,room},i)=>{const{mood,wear}=slabTint(x,z,room);matrix.makeTranslation(x*TILE,-1.485,z*TILE);foundations.setMatrixAt(i,matrix);foundations.setColorAt(i,tint.setHex(mood.foundation).multiplyScalar(.86+wear*.24));});
        plain.forEach(({x,z,room},i)=>{
          slabTint(x,z,room);tiles.setColorAt(i,tint);
          const settledNew=pavingPlan.settledCells.has(`${x},${z}`);
          tiles.setMatrixAt(i,settledNew?macroSettle(x,z):seat(x,z,pavingKind(x,z)==='settled'));
        });
        foundations.receiveShadow=tiles.receiveShadow=true;tiles.userData.walkingSurface=true;floorGroup.add(foundations,tiles);
      }
      // One instanced draw each for the whole floor. Damage is scattered by a hash, so a variant batched
      // by region would be a batch per region and the junction has eighteen calls of headroom, not sixty.
      for(const [kind,geometry] of [['groove',grooveGeometry],['dish',dishGeometry]] as const){
        const cells=variants[kind];
        if(!cells.length){geometry.dispose();continue;}
        const damaged=new THREE.InstancedMesh(geometry,floorMaterial,cells.length);
        cells.forEach(({x,z,room},i)=>{slabTint(x,z,room);damaged.setColorAt(i,tint);damaged.setMatrixAt(i,seat(x,z,false));});
        damaged.receiveShadow=true;damaged.userData.walkingSurface=true;floorGroup.add(damaged);
      }
      // The merged long slabs: one InstancedMesh per spatial batch a pair actually falls in, so a
      // patch costs the same kind of draw call the ordinary paving already pays for rather than a new
      // one per pair. Orientation 'z' is the same geometry turned a quarter circle, never a second
      // build; the tint is the two source cells' own slabTint, blended, so a merged slab weathers as
      // the average of the two courses it replaces rather than introducing a third palette value.
      if(pavingPlan.pairs.length){
        const pairGeometry=pavingPatchGeometry();
        const pairsByBatch=new Map<string,typeof pavingPlan.pairs>();
        for(const pair of pavingPlan.pairs){const list=pairsByBatch.get(pair.batch);if(list)list.push(pair);else pairsByBatch.set(pair.batch,[pair]);}
        for(const list of pairsByBatch.values()){
          const patches=new THREE.InstancedMesh(pairGeometry,floorMaterial,list.length);
          list.forEach((pair,i)=>{
            slabTurn.setFromEuler(slabEuler.set(0,pair.orientation==='z'?Math.PI/2:0,0));
            matrix.compose(slabAt.set(pair.x,-.07,pair.z),slabTurn,slabScale);
            patches.setMatrixAt(i,matrix);
            slabTint(pair.ax,pair.az,pair.room);const a=tint.clone();
            slabTint(pair.bx,pair.bz,pair.room);const b=tint.clone();
            patches.setColorAt(i,a.lerp(b,.5));
          });
          patches.receiveShadow=true;patches.userData.walkingSurface=true;floorGroup.add(patches);
        }
      }
      phase('tiles');
      // Plan 014 round 4 (lever C5): stone flagstone in place of the wood plank deck - the same slab
      // geometry and the same triplanar flagstone material the rest of the floor stands on, so a
      // bridge reads as a stone span rather than a wood dock. `slabTint` already resolves a theme for
      // a tile with no room of its own (a bridge always sits between two rooms), which is exactly the
      // case this needs. The timber piles and rail below stay - removing them entirely wherever a
      // stone arch now stands would leave the long stretches between arches looking unsupported, and
      // this round did not have room to also rebuild the understructure tile by tile.
      const deck = new THREE.InstancedMesh(tileGeometry, floorMaterial, bridgeTiles.length);
      bridgeTiles.forEach(({x,z,room},i)=>{slabTint(x,z,room);deck.setColorAt(i,tint);deck.setMatrixAt(i,seat(x,z,false));});
      deck.receiveShadow=true;deck.userData.walkingSurface=true;floorGroup.add(deck);
      const { minX, maxX, minZ, maxZ } = floor.bounds;
      tide = tidalMaterial(new THREE.Vector4((minX + maxX) * TILE / 2, (minZ + maxZ) * TILE / 2, (maxX - minX) * TILE / 2 + 1.5, (maxZ - minZ) * TILE / 2 + 1.5), floor.tiles.map(({ x, z }) => ({ x: x * TILE, z: z * TILE })), TILE);
      water = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX + 40) * TILE, (maxZ - minZ + 40) * TILE), tide.material);
      water.rotation.x = -Math.PI / 2; water.position.set((minX + maxX) * TILE / 2, -2.8, (minZ + maxZ) * TILE / 2); floorGroup.add(water);
      const borders: { x: number; z: number; horizontal: boolean }[] = [];
      floor.tiles.forEach(({ x, z }) => { for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!floor.cells.has(cellKey(x + dx,z + dz))) borders.push({ x: (x + dx * 0.5) * TILE, z: (z + dz * 0.5) * TILE, horizontal: dz !== 0 }); });
      // Low parapets keep the isometric view readable, including narrow bridges.
      // A kerb this low read as a painted line around the slab rather than as the top of a wall, and the
      // near edge of the platform is the one place in the frame where the reference always has built
      // mass. Half again as tall and near twice as thick, on the same instance count, so it catches the
      // moon on its cap, shades its own face, and lays a shadow of its own on the paving inside it.
      // Neutral rather than teal: the kerb runs the full border of every tile on the floor including the
      // corridors, so whatever hue it holds is a hue the whole keep holds. It takes the chamber's from
      // the weathering uniforms instead.
      const parapetGeometry=new RoundedBoxGeometry(1,0.58,1,1,.1),parapetMaterial=new THREE.MeshStandardMaterial({color:0x6b6f70,roughness:.8});parapetSkin=parapetMaterial;weatherStone(parapetMaterial);applyStoneTextures(parapetMaterial,getMasonryTextures(),.85);
      const parapets=new Map<string,typeof borders>();for(const b of borders){const key=`${Math.floor(b.x/18)},${Math.floor(b.z/18)}`;const batch=parapets.get(key);if(batch)batch.push(b);else parapets.set(key,[b]);}
      for(const local of parapets.values()){
        const walls=new THREE.InstancedMesh(parapetGeometry,parapetMaterial,local.length);
        // Plan 014 round 4 (lever C7): a run of identical merlons reads as a fence, not a broken
        // rampart. A per-segment hash jitters height and yaw so no two blocks share an edge line, and
        // one in twelve is a missing merlon - scaled to nothing rather than skipped, since an
        // instanced mesh's count is fixed once it is created.
        local.forEach((b,i)=>{
          const roll=tileHash(Math.round(b.x*4),Math.round(b.z*4),31);
          const broken=roll<.08;
          const h=broken?0:.82+tileHash(Math.round(b.x*4),Math.round(b.z*4),32)*.4;
          const yaw=(tileHash(Math.round(b.x*4),Math.round(b.z*4),33)-.5)*.12;
          matrix.compose(new THREE.Vector3(b.x,.2+(h-1)*.29,b.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,0)),new THREE.Vector3(b.horizontal?TILE:.3,broken?.001:h,b.horizontal?.3:TILE));
          walls.setMatrixAt(i,matrix);
        });
        // Not a shadow caster. The parapet runs the full border of every tile on the floor, corridors
        // included, and putting that instance count through the shadow pass as well cost more triangles
        // than every piece of vertical structure this round adds, for a shadow half a block wide.
        walls.receiveShadow=true;floorGroup.add(walls);
      }
      phase('walls');
      atmosphere = addAtmosphere(floorGroup, floor);
      // Plan 014 round 9 (lever 6): the water's own reflection streaks (dungeon-motion.ts's
      // `tidalMaterial`) need real torch world-positions, which only exist once the atmosphere pass
      // above has actually placed them - set once here, not per frame, since torches do not move.
      if (tide) { const slots = tide.torches.value; atmosphere.torchPositions.slice(0, slots.length).forEach((p, i) => slots[i].copy(p)); }
      // The presentation-only support-height index (plan 006/008): every mesh tagged
      // `walkingSurface=true` -- paving tops (plain, groove, dish, merged pairs), wood planks and
      // floor motifs -- is read back into world-space triangles once, here, after everything that
      // could tag one has been built. Collision keeps using `floor.cells`/`canStand`; nothing here is
      // ever consulted for whether a position is legal to stand on.
      world.updateMatrixWorld(true);
      {
        const triangles: SurfaceTriangle[] = [];
        const instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
        const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const collect = (geometry: THREE.BufferGeometry, transform: THREE.Matrix4) => {
          const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
          if (!position) return;
          const index = geometry.getIndex();
          const triCount = index ? index.count / 3 : position.count / 3;
          for (let t = 0; t < triCount; t++) {
            for (let k = 0; k < 3; k++) {
              const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
              corners[k].set(position.getX(vi), position.getY(vi), position.getZ(vi)).applyMatrix4(transform);
            }
            triangles.push({
              ax: corners[0].x, ay: corners[0].y, az: corners[0].z,
              bx: corners[1].x, by: corners[1].y, bz: corners[1].z,
              cx: corners[2].x, cy: corners[2].y, cz: corners[2].z,
            });
          }
        };
        floorGroup.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          // Plan 007: register every mesh tagged `cameraOccluder=true` at creation (dungeon-art.ts,
          // dungeon-atmosphere.ts) exactly once per floor build, never by traversing every frame.
          if (o.userData.cameraOccluder) cutaway.register(o as THREE.Mesh | THREE.InstancedMesh);
          if (!o.userData.walkingSurface) return;
          if (o instanceof THREE.InstancedMesh) {
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, instanceMatrix);
              worldMatrix.multiplyMatrices(o.matrixWorld, instanceMatrix);
              collect(o.geometry, worldMatrix);
            }
          } else {
            collect(o.geometry, o.matrixWorld);
          }
        });
        const cellMeta = new Map<string, CellSurface>();
        for (const t of floor.tiles) cellMeta.set(cellKey(t.x, t.z), { theme: themeOf(t.x, t.z, t.room), wood: t.wood });
        surfaceIndex = buildSurfaceIndex(triangles, cellMeta);
        pavingSummary = { pairs: pavingPlan.pairs.length, settled: pavingPlan.settled.length, surfaceCells: surfaceIndex.cells.size };
      }
      phase('surface');
      for (const room of floor.rooms) {
        if (room.id === 0 || !['sanctuary', 'gauntlet'].includes(room.encounter)) continue;
        const shrine = room.encounter === 'sanctuary';
        for (const offset of shrine ? [0] : [-2.5, 0, 2.5]) {
          // The disc is whole now rather than an annulus, and the ring is drawn
          // inside it by the fragment shader along with the light it throws on
          // the paving: same draw call, same ninety-six triangles, and a grate
          // that is part of the floor it is burning instead of a decal over it.
          // It is additive for the same reason: a grate that can only ever darken
          // the stone under it is the "flat black ellipse" the review saw. That is
          // the opposite call from the windup arc a few lines down, and both are
          // right. This is a soft glow whose whole job is to look like heat coming
          // up through the floor, so taking the paving's colour with it is what
          // makes it part of the floor. The arc is a signal that must mean the
          // same thing in three chambers, so taking the paving's colour with it
          // was the bug.
          //
          // Dormant, it is scorched iron rather than the hot red it used to be.
          // That red sat on the telegraph's own hue to within a fifth of a degree
          // at two and a half times its chroma, so a grate sitting there doing
          // nothing wore the colour that means a blow is landing. Dead grey was
          // tried in between and went too far the other way: a hazard the player
          // cannot pick out of the paving is not a fair one.
          const spread = shrine ? 1.9 : 3.25;
          const skin = new THREE.MeshBasicMaterial({ color: shrine ? 0x71f4c4 : 0x7a5238, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
          const glow = litDisc(skin, shrine ? 'shrine-disc-v1' : 'ember-disc-v1', shrine ? 4.2 : 2.0);
          glow.edge.value = (shrine ? 1.125 : 1.69) / spread; glow.width.value = (shrine ? .26 : .13) / spread;
          const mesh = new THREE.Mesh(new THREE.RingGeometry(0, spread, 48), skin);
          // Clear of the grate bars, which top out at .10: the pool now reaches
          // across them where the old ring sat outside their radius entirely.
          mesh.rotation.x = -Math.PI / 2; mesh.position.set(room.x * TILE + offset, shrine ? .085 : .125, room.z * TILE); mesh.renderOrder = 2;
          floorGroup.add(mesh); features.push({mesh, glow, room: room.id, shrine, used: false, phase: 0, burned: false});
          if (!shrine) {
            const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.56,1.56,.035,32), new THREE.MeshStandardMaterial({color:0x241b17,metalness:.8,roughness:.65}));
            grate.position.copy(mesh.position); grate.position.y=.045; floorGroup.add(grate);
            for (let n=-3;n<=3;n++) {
              const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.sqrt(1.5**2-(n*.38)**2)*2,.04,.07),new THREE.MeshStandardMaterial({color:0x836445,metalness:.8,roughness:.5}));
              rail.position.set(mesh.position.x,.08,mesh.position.z+n*.38);floorGroup.add(rail);
            }
          }
          if (shrine) {
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.5), new THREE.MeshStandardMaterial({color:0xa8f7d8,emissive:0x48cba0,emissiveIntensity:2,metalness:.3,roughness:.2}));
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
        // Wider than the shaft and soft to its rim: what comes up a stair is
        // light, and a hard-edged disc exactly the size of the hole was a lid.
        const shaftSkin = new THREE.MeshBasicMaterial({ color: 0xfbc956, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
        stairLight = litDisc(shaftSkin, 'stair-shaft-v1', 2.2); stairLight.band.value = 0;
        stairGlow = new THREE.Mesh(new THREE.CircleGeometry(2.05, 32), shaftSkin); stairGlow.rotation.x = -Math.PI / 2; stairGlow.position.set(stairSpot.x, .08, stairSpot.z); stairGlow.visible = false; stairGlow.renderOrder = 4; floorGroup.add(stairGlow);
        stairRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 48), new THREE.MeshBasicMaterial({ color: 0xfbc956, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })); stairRing.rotation.x = -Math.PI / 2; stairRing.position.set(stairSpot.x, .09, stairSpot.z); stairRing.visible = false; stairRing.renderOrder = 5; floorGroup.add(stairRing); }
      placeDrop(floor.weaponDrop.kind, floor.weaponDrop.x, floor.weaponDrop.z);
      phase('atmosphere');
      enemyData = floor.spawns.map((spawn, index) => {
        const kind = spawn.kind;
        const stats = enemyStats(kind, level), maxHp = stats.hp, tell = stats.tell;
        const group = makeSkeleton(kind); group.position.set(spawn.x * TILE,0.03,spawn.z * TILE); group.visible = !spawn.ambush; floorGroup.add(group);
        if (kind === 'warden') group.scale.setScalar(1.3);
        if (kind === 'stalker') group.scale.set(.94,1,.94);
        // One colour for all three kinds. Which body is winding up is already answered by the shape —
        // the stalker's long lane against the others' arc — and by the eye it is answered with, so the
        // two amber tells this replaced were spending hue on a question nobody was asking and spending
        // it in the same band the torches burn in. `toneMapped` and `fog` off: this is the one
        // mark in the keep the player answers on a deadline, and it has no business being compressed by
        // the same curve as the wall behind it or dimmed by the distance it is seen from.
        // Opaque over the floor rather than added to it, and drawn through whatever stands in the way.
        //
        // Additive was the obvious choice and it was wrong, measurably: the result is floor plus red,
        // so the paving's own green and blue survive underneath and set the hue. The same `0xff4529`
        // came out dusty pink over the keep's violet slate and muddy orange-brown over the flood's
        // teal — the two families whose fire was moved off amber precisely to leave red free. A mark
        // whose colour is decided by the room it is drawn in is not a signal. Normal blending at a
        // high opacity carries its own colour instead, and `toneMapped: false` writes it through
        // unchanged, so the tell is the same red in all three chambers.
        //
        // Two passes of one shape, which is how a mark stays a mark behind a pier.
        //
        // Depth-tested alone, a plinth or a column between the lens and a body ate part of the arc and,
        // in the drowned chambers, most of it. Depth-test off alone was worse: a hot arc painted over
        // solid stone makes the stone look like glass and smears the knight it crosses. So the solid
        // pass keeps its depth test and belongs to the world, and a faint copy behind it does not — at
        // a third of the opacity it is invisible wherever the real arc already shows and a red ghost
        // wherever something is standing in front of it. Seen through, rather than not seen.
        //
        // Full opacity on the solid pass, not the .88 a first cut used. At .88 the mark tops out around
        // 94 of a possible 100 while a brazier's core clips at 100, which is the one thing a signal
        // carrying a deadline may not do: be dimmer than the furniture. `toneMapped: false` buys the
        // headroom and the opacity was giving it straight back.
        const cueGeometry = kind === 'stalker' ? new THREE.PlaneGeometry(5,1.7).translate(2.5,0,0) : BONES.cue;
        // Plan 014 round 2: toneMapped is true here now (it was false). `THREAT` was drawn
        // above the tone-mapped range on purpose while the mark was an opaque slab that had to win
        // against any floor under it; translucent, it only needs to read as red, and a
        // never-compressed value alpha-blended over a lit floor is exactly what was clearing the
        // post chain's bloom threshold and blowing the whole shape out to white.
        // Plan 014 round 4 (lever B3) tried additive blending here on the theory that it would let
        // the stone underneath stay visible; round 5's critic instead read the result as laser lines
        // crossing the room. Back to `NormalBlending` (the default - no `blending` key at all) with a
        // texture that carries its own soft, capped-alpha gradient (see `telegraphTexture`), which is
        // what actually keeps the stone visible without needing additive's unbounded stacking.
        const cueMap = kind === 'stalker' ? laneTex : telegraphTex;
        const cue = new THREE.Mesh(cueGeometry,new THREE.MeshBasicMaterial({color:THREAT,map:cueMap,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,fog:false}));cue.rotation.x=-Math.PI/2;cue.renderOrder=9;floorGroup.add(cue);
        const ghost = new THREE.Mesh(cueGeometry,new THREE.MeshBasicMaterial({color:THREAT,map:cueMap,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,depthTest:false,fog:false}));ghost.renderOrder=8;cue.add(ghost);
        const bar = new THREE.Mesh(BONES.bar,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false,toneMapped:false,fog:false}));bar.renderOrder=10;floorGroup.add(bar);
        // Plan 014 round B: a framed bar - a dark border plate with a darker track behind the fill, as a
        // child of the fill counter-scaled every frame (below), so it stays full width while the fill
        // drains from the right.
        const barFrame = new THREE.Mesh(new THREE.PlaneGeometry(.88,.15),new THREE.MeshBasicMaterial({color:0x6b5a3e,depthTest:false,toneMapped:false,fog:false}));barFrame.renderOrder=9;barFrame.position.z=-.001;
        const barTrack = new THREE.Mesh(new THREE.PlaneGeometry(.82,.09),new THREE.MeshBasicMaterial({color:0x120b0a,depthTest:false,toneMapped:false,fog:false}));barTrack.renderOrder=9;barTrack.position.z=.0005;barFrame.add(barTrack);bar.add(barFrame);
        const alert = new THREE.Sprite(alertMaterial);alert.scale.set(.55,.55,1);alert.visible=false;alert.renderOrder=10;floorGroup.add(alert);
        const anchors:THREE.Object3D[]=kind==='stalker'?group.userData.limbs.slice(0,2):[group.userData.weapon];
        const trails=anchors.map(anchor=>{const effect=weaponTrail(kind==='warden'?0xffa15c:kind==='stalker'?0xffcc90:0xffd39b,kind==='warden'?.13:.095);floorGroup.add(effect.mesh);return {effect,anchor,inner:kind==='stalker'?new THREE.Vector3(0,-.72,-.12):new THREE.Vector3(0,0,-.24),tip:kind==='stalker'?new THREE.Vector3(0,-.87,-.5):new THREE.Vector3(0,0,kind==='warden'?-1.2:-.86)};});
        return { group, hp:maxHp, maxHp, kind, tell, damage:stats.damage, cue, bar, alert, trails, attackAge:Infinity, speed:stats.speed, cooldown:0.4+(index%3)*0.2, hitFlash:0, dead:false, death:null, phase:spawn.room*1.7+index*0.6, windup:0, lunge:0, aim:new THREE.Vector3(), room:spawn.room, awake:!spawn.ambush, anchor:{x:spawn.x*TILE,z:spawn.z*TILE}, notice:0, alertIn:Infinity };
      });
      phase('enemies');
      // Every texture the new floor uses goes to the GPU now. three.js otherwise uploads a texture the
      // first frame something using it is on screen, so which ones were resident depended on where the
      // camera happened to look: walking into a new room hitched on the upload, and the renderer's texture
      // count wandered by what was in view, which every leak check across rebuilds reads as a leak.
      const uploaded = new Set<THREE.Texture>();
      const upload = (value: unknown) => { if (value instanceof THREE.Texture && !uploaded.has(value)) { uploaded.add(value); renderer.initTexture(value); } };
      world.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
          for (const value of Object.values(m)) upload(value);
          const uniforms = (m as THREE.ShaderMaterial).uniforms;
          if (uniforms) for (const key in uniforms) upload(uniforms[key]?.value);
        }
      });
      phase('upload');
      player.position.set(floor.rooms[0].x * TILE, 0.03, floor.rooms[0].z * TILE);
      cameraFocus.copy(player.position);
      // The knight is on his mark, so the chamber he is standing in is known and its lights can be hung
      // before anything is drawn. Leaving it to the frame loop would leave one frame lit by whatever the
      // last floor was, and a first frame that arrives while the game is paused would never be lit at all.
      moveMood(1);
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
      veiled(`Descending to floor ${level + 1}`, { level: level + 1 }, () => {
        buildFloor(level + 1);
        heal(run, Math.round(run.maxHp * .25)); setHealth(run.hp);
        keys.clear(); attackTime = 0; dashTime = 0; attackBuffer = 0; dashBuffer = 0; chainBeat = 0; chainIdle = Infinity; swing = weapon; audio.pause(false);
        burst(player.position, 0x71f4c4, 22);
      });
    };
    // A run is nothing but this closure's counters plus floor 1, so it restarts in place: reloading
    // would refetch the bundle and throw away the AudioContext and the GPU context for no gain.
    // Everything buildFloor(1) already rebuilds (floor, level, rooms, enemies, map, status) is left to it,
    // but the run must be fresh first because it snapshots kills and XP as the floor's baseline. A whole
    // new `run` is the point of createRun(): a field added to the sim can never be forgotten here.
    const restart = (seed?: number, then?: () => void) => veiled(seed === undefined ? 'A new keep rises' : 'The same keep, again', { level: 1, seed }, () => {
      run = createRun(); boonsTaken = [];
      attackTime = 0; dashTime = 0; dashCooldown = 0; attackBuffer = 0; dashBuffer = 0; hitStop = 0; hurtFlash = 0; shake = 0; chainBeat = 0; chainIdle = Infinity; swing = weapon; clearShots();
      walkPhase = 0; gaitSpeed = 0; locomotion=playerRunPose(0,0); rewardTime = 0; noticeTime = 0; trailClock = 0; trailCursor = 0;
      footsteps.reset(); stepLog = { contacts: 0, skipped: 0, kinds: { keep: 0, ruins: 0, flooded: 0 }, last: null };
      isPaused = false; keys.clear(); bufferedFacing = null; velocity.set(0, 0, 0);
      facing.set(1, 0, -0.6).normalize(); attackFacing.copy(facing); dashFacing.copy(facing);
      setHealth(run.hp); setMaxHealth(run.maxHp); setDefeated(0); setExperience(0); setXpReward(0);
      setRank(1); setRankXp(0); setRankNeed(rankCost(1)); setTaken([]); setBoonChoice([]);
      if (weapon.id !== STARTING_WEAPON) equip(STARTING_WEAPON);
      setHeldWeapon(TIDEBLADE.name);
      setNotice(''); setNoticeDetail(''); setFloorResult({ kills: 0, xp: 0, seconds: 0 });
      setPaused(false); setMapOpen(false);
      buildFloor(1, seed);
      player.rotation.set(0, Math.atan2(-facing.x, -facing.z), 0); player.userData.sword.rotation.y = 0;
      audio.pause(false);
    }, then);
    // Read before floor 1 overwrites the stored seed, so "Last keep" still offers the previous visit's.
    const restoreSave = () => { setBest(readBest()); setPriorSeed(readSeed()); setRunLog(readRuns()); };
    restoreSave();
    // Floor 1 is not built here. The menu is in the prerendered page and is what a visitor sees first, so
    // the build waits until the end of this mount and then runs behind that menu (see `boot`). Until it
    // has run there is no floor, and nothing below may touch one: the loop draws nothing, the window
    // hooks are not installed, and a press of ENTER THE KEEP is held until the keep exists.
    let built = false, warmed = false, enterWhenBuilt = false, bootSeed: number | undefined, enterSeed: number | undefined;
    // The thumbstick's screen-space direction while a thumb is planted, null the rest of the time. It is a
    // unit vector on the very basis the keys below build on, so analog steering is a second source of the
    // same quantity rather than a second input system.
    let stick: { x: number; z: number } | null = null;
    // A pad's left stick, kept apart from the touch stick's slot so neither can strand the other. The
    // right stick is aim rather than movement, which is the twin-stick half of a pad.
    let padStick: { x: number; z: number } | null = null, padLook: { x: number; z: number } | null = null;
    let padPressed = new Set<number>();
    // The cursor in normalised device coordinates, and which device last spoke. Last device wins
    // outright rather than blending: someone who reaches for the mouse mid-fight should not have the
    // keys still arguing about where the knight is pointing. The NDC is stored rather than the
    // direction it implies, because the knight walks out from under a cursor that never moved.
    let pointerNdc: { x: number; y: number } | null = null, aimDevice: 'keys' | 'pointer' = 'keys';
    // The frustum, as the resize handler last set it. `groundAim` needs both to invert the projection.
    let viewSpan = 7.2, viewAspect = 1;
    // Bindings are read at the moment they are asked for, never snapshotted: the card can rebind a key while
    // the run is paused behind it. `Touch<action>` is the touch d-pad's own slot and belongs to no binding,
    // so the discrete move:/stop: protocol steers identically whatever the keyboard has been set to.
    // `Touch<action>`, `Mouse<action>` and `Pad<action>` are each a device's own slot, belonging to no
    // binding: a held STRIKE must keep swinging whatever the keyboard was rebound to, and must not be
    // released by letting go of a key on a different device.
    const held = (action: Action) => settingsRef.current.binds[action].some(c => keys.has(c))
      || keys.has(`Touch${action}`) || keys.has(`Mouse${action}`) || keys.has(`Pad${action}`);
    const moveInput = () => {
      const x = +held('right') - +held('left'), z = +held('down') - +held('up');
      // A planted thumb outranks the keys for exactly as long as it is down, and lifting it hands steering
      // straight back: neither path can strand the other, because neither ever writes to the other's state.
      const steer = stick ?? padStick;
      const sx = steer ? steer.x : x, sz = steer ? steer.z : z;
      return screenRight.clone().multiplyScalar(sx).addScaledVector(screenDown, sz).normalize();
    };
    // Bodies a blow could plausibly be meant for: alive, awake, near, and with stone out of the way.
    // The lane test is the expensive one, so it runs last and on the handful that survive the rest.
    const aimTargets = (reach: number) => {
      const span = reach * reach;
      return enemyData
        .filter(e => !e.dead && e.awake && e.group.position.distanceToSquared(player.position) <= span)
        .filter(e => hasClearPath(floor.cells, player.position, e.group.position))
        .map(e => ({ x: e.group.position.x, z: e.group.position.z }));
    };
    /**
     * Where the swing points. A pointer named a place on the floor and is taken at its word — someone
     * aiming with a mouse has already said what they mean, and correcting them is worse than missing.
     * Keys and sticks name one of eight directions, up to 22.5 degrees off whatever they were aimed
     * at, so those are helped the rest of the way onto a body nearly in front of the knight.
     *
     * Null means nothing was asked for, and the caller keeps the facing it had.
     */
    const aimNow = (): { x: number; z: number } | null => {
      if (aimDevice === 'pointer' && pointerNdc) {
        const at = groundAim(pointerNdc.x, pointerNdc.y, viewSpan, viewAspect,
          cameraFocus, CAMERA_OFFSET, player.position);
        if (at) return at;
      }
      const look = padLook ?? (() => { const v = moveInput(); return v.lengthSq() ? { x: v.x, z: v.z } : null; })();
      if (!look) return null;
      // A thrown arm snaps as far as the shot carries, not as far as the arm reaches: the crossbow's
      // own reach is 0.2, and a snap measured against that would leave the bolt exactly as unaimable
      // as it was. Its range is the honest answer to "what could this swing have been meant for".
      const reach = weapon.ranged
        ? weapon.ranged.speed * weapon.ranged.flight
        : (weapon.reach + run.reach) * SNAP_REACH;
      return snapAim(look, aimTargets(reach), player.position, reach);
    };
    const startAttack = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || dashTime > 0) return;
      audio.play('slash');
      // Continue the string if the last swing ended recently enough, else open a new one. The window
      // is the arm's own, and an arm with no chain has one beat, so this is inert for five of seven.
      const linking = chainIdle <= (weapon.chain?.window ?? 0) && chainBeat + 1 < chainLength(weapon);
      chainBeat = linking ? chainBeat + 1 : 0;
      chainIdle = 0;
      swing = beatOf(weapon, chainBeat);
      attackTime = swing.duration; attackBuffer = 0; swingHits.clear();slash.clear();
      const aim = aimNow();
      if (aim) facing.set(aim.x, 0, aim.z);
      else if (bufferedFacing) facing.copy(bufferedFacing);
      bufferedFacing = null;
      attackFacing.copy(facing); player.rotation.y = Math.atan2(-facing.x, -facing.z);

    };
    const requestAttack = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing') return;
      if (attackTime <= 0 && dashTime <= 0) startAttack();
      else { attackBuffer = 0.18; const aim = aimNow(); bufferedFacing = aim ? new THREE.Vector3(aim.x, 0, aim.z) : facing.clone(); }
    };
    const requestDash = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || dashCooldown > 0) return;
      // While the blade is live the swing is a commitment: the dash waits for contact to end instead of
      // cutting it short, which is what makes swinging into a tell a mistake rather than a free action.
      if (!canAbortSwing(attackTime, swing)) { dashBuffer = DASH_BUFFER; return; }
      dashBuffer = 0;
      const input = moveInput(); dashFacing.copy(input.lengthSq() ? input : facing);
      audio.play('dash');
      facing.copy(dashFacing); dashTime = DASH_TIME; dashCooldown = run.dashSpan;
      // A dodge is a way out of a string as well as out of a blow: the next strike opens again.
      chainBeat = 0; chainIdle = Infinity; swing = weapon;
      attackTime = 0; attackBuffer = 0; dashBuffer = 0; bufferedFacing = null; hitStop = 0;slash.clear();posePlayer(0);

    };
    // Answer the rack. Nothing happens unless the knight is standing in the ring with an arm laid out in
    // it, so the key is inert everywhere else in the keep rather than a second thing to be careful with.
    // What he was holding goes down where the new arm lay: a swap he regrets is a walk back, not a dead run.
    const requestSwap = () => {
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      if (!drop || !overDrop) return;
      const taken = weaponById(drop.kind), set = weapon.id, at = { x: drop.x, z: drop.z };
      equip(drop.kind);
      placeDrop(set, at.x, at.z);
      // Standing still after the swap, so the prompt comes straight back naming the arm just set down.
      overDrop = true; showOffer(set);
      audio.play('clear'); burst(player.position, 0xfbc956, 14);
      setNotice(`${taken.name} in hand`); setNoticeDetail(taken.detail); noticeTime = 3.5;
      setHeldWeapon(taken.name);
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
      // Striking or dodging *from the keyboard* is a claim on where the knight points; walking is not.
      // That distinction is the whole reason a pointer is worth having: holding D while the cursor sits
      // to the left is a knight retreating and cutting behind him, and a movement key that stole the
      // aim back would make it impossible to express. Space still claims it, so someone playing on the
      // keyboard with a cursor parked wherever the intro card left it is never aimed at that corner.
      if (does('attack') || does('dash')) aimDevice = 'keys';
      if (does('attack')) requestAttack();
      if (does('dash')) requestDash();
      if (does('swap')) requestSwap();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    // The stick clears with the keys: a page backgrounded mid-drag does not always fire pointercancel,
    // and a stick left live is a knight that walks on by itself the moment the descent resumes.
    const clearInput = () => {
      keys.clear(); stick = null; padStick = null; padLook = null; padPressed.clear();
      attackBuffer = 0; dashBuffer = 0; bufferedFacing = null;
    };
    const enter = () => { enterWhenBuilt = false; setEntering(false); if (hasStarted) return; floorStart = elapsed; runStart = elapsed; hasStarted = true; setStarted(true); setCapturing(null); };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'continue') { continueDescent(); return; }
      // `restart` opens a fresh keep, `restart:<seed>` takes the same one again; a junk seed just means fresh.
      if (detail === 'restart' || detail.startsWith('restart:')) { const seed = Number.parseInt(detail.slice(8), 10); restart(Number.isNaN(seed) ? undefined : seed >>> 0); return; }
      // `elapsed` runs from mount, so both clocks restart here or a logged run would bill the time spent
      // reading the menu. A restart mid-run has `hasStarted` already true and gets its reset in buildFloor.
      // `start:<seed>` enters the keep a previous visit left, which is what the menu's LAST KEEP asks for.
      // Pressed before floor 1 exists, the press is held behind the loading bar and answered the frame the
      // keep is on screen - and the seed, if any, becomes the one that floor is built from. The audio is
      // woken here either way, inside the gesture, because Safari will not wake it from a later frame.
      if (detail === 'start' || detail.startsWith('start:')) {
        if (hasStarted || enterWhenBuilt || building) return;
        const seed = Number.parseInt(detail.slice(6), 10), pinned = Number.isNaN(seed) ? undefined : seed >>> 0;
        audio.start();
        // Not yet on screen: either floor 1 is still ahead (the seed becomes the one it is built from) or it
        // is built and its shaders are still warming (the seed, if it differs, is taken once they are).
        if (!warmed) { enterWhenBuilt = true; setEntering(true); if (built) enterSeed = pinned; else { bootSeed = pinned; scheduleBoot(); } return; }
        if (pinned === undefined) enter(); else restart(pinned, enter);
        return;
      }
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
      // The prompt at the foot of the screen sends this too, so a tap answers the rack on a phone, where
      // there is no key to press and the prompt is the only thing naming the arm.
      if (detail === 'swap') requestSwap();
      if (detail.startsWith('move:')) keys.add(`Touch${detail.slice(5)}`);
      if (detail.startsWith('stop:')) keys.delete(`Touch${detail.slice(5)}`);
    };
    // Mouse only. The touch controls sit over this same canvas and speak their own protocol, and a
    // finger that also moved the aim would fight the thumbstick it was resting on.
    const canvas = renderer.domElement;
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerNdc = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: 1 - ((e.clientY - rect.top) / rect.height) * 2,
      };
      aimDevice = 'pointer';
    };
    // A cursor that has left the canvas is not pointing at the floor any more, and a swing aimed at
    // where it went out is a swing aimed at nothing the player can see.
    const pointerGone = (e: PointerEvent) => { if (e.pointerType === 'mouse') { pointerNdc = null; keys.delete('Mouseattack'); aimDevice = 'keys'; } };
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      pointerMove(e);
      // Its own slot, like the touch STRIKE button's: holding the left button must keep the swing
      // going, and must not be released by letting go of a key.
      if (e.button === 0) { keys.add('Mouseattack'); requestAttack(); } else requestDash();
    };
    const pointerUp = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.button === 0) keys.delete('Mouseattack'); };
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointerleave', pointerGone);
    canvas.addEventListener('contextmenu', noMenu);

    // Standard mapping only. A pad the browser cannot name is a pad whose buttons we would be
    // guessing at, and guessing wrong means the dodge button swings.
    const PAD_BUTTONS: [number, Action][] = [[0, 'attack'], [1, 'dash'], [2, 'swap'], [9, 'pause']];
    const PAD_DEADZONE = 0.25;
    const padAxis = (pad: Gamepad, ax: number, az: number): { x: number; z: number } | null => {
      const x = pad.axes[ax] ?? 0, z = pad.axes[az] ?? 0, span = Math.hypot(x, z);
      if (span < PAD_DEADZONE) return null;
      // Rescaled from the edge of the deadzone rather than from zero, or the first usable degree of
      // travel would already be a quarter of full speed.
      const scale = Math.min(1, (span - PAD_DEADZONE) / (1 - PAD_DEADZONE)) / span;
      return { x: x * scale, z: z * scale };
    };
    const dropPad = () => {
      padStick = null; padLook = null; padPressed.clear();
      for (const [, action] of PAD_BUTTONS) keys.delete(`Pad${action}`);
    };
    const pollPad = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
      if (!pad) { if (padStick || padLook || padPressed.size) dropPad(); return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') {
        // Buttons still read while the world is held, or START could never unpause it.
        padStick = null; padLook = null;
        const start = pad.buttons[9]?.pressed ?? false;
        if (start && !padPressed.has(9)) togglePause();
        padPressed = new Set(start ? [9] : []);
        return;
      }
      padStick = padAxis(pad, 0, 1);
      // The right stick aims and does not move. At rest the left stick answers for both, which is how
      // a pad plays before anyone thinks to use the second one.
      padLook = padAxis(pad, 2, 3);
      if (padLook) {
        const look = screenRight.clone().multiplyScalar(padLook.x).addScaledVector(screenDown, padLook.z).normalize();
        padLook = { x: look.x, z: look.z };
      }
      const now = new Set<number>();
      for (const [index, action] of PAD_BUTTONS) {
        if (!(pad.buttons[index]?.pressed ?? false)) { keys.delete(`Pad${action}`); continue; }
        now.add(index);
        keys.add(`Pad${action}`);
        if (padPressed.has(index)) continue;
        if (action === 'attack') requestAttack();
        if (action === 'dash') requestDash();
        if (action === 'swap') requestSwap();
        if (action === 'pause') togglePause();
      }
      padPressed = now;
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
      // Before anything reads an input: a button pressed this frame must be able to start a swing on
      // this frame, exactly as a key would.
      pollPad();
      if (isPaused || run.choosing || gameStatus === 'complete') return;
      elapsed += frameDt; const t = elapsed;
      // Deliberately not touched by reduced motion. Hit-stop is the absence of movement, not movement,
      // and it is also time the enemies do not get: shortening it would hand every landed blow back to
      // them a frame sooner, which is a balance change wearing an accessibility label.
      const dt = hitStop > 0 ? 0 : frameDt; hitStop = Math.max(0, hitStop - frameDt);
      // This, not the constructor, is the torch's real intensity — it is rewritten every frame. Raised to
      // hold the near field after the decay went from 1.9 to a physical 2 and the cutoff came off.
      // Plan 014 round A: 22 -> 34, the warm bounce a torch throws on everything within a couple of tiles.
      const torchFlicker = (i: number) => 34 + Math.sin(t * 9 + i * 2.2) * 2.6 + Math.sin(t * 17) * 0.9;
      for (let i = 0; i < torchLights.length - 1; i++) torchLights[i].intensity = torchFlicker(i);
      if (water) water.position.y = -2.8 + Math.sin(t * 0.9) * 0.05;
      if (tide) tide.time.value=t;
      animateCloth(player.userData.cape,t,dashTime>0?.32:velocity.lengthSq()>0?.16:.045);
      trailClock-=dt;
      if(dashTime>0 && trailClock<=0){
        const trail=dashTrails[trailCursor++%dashTrails.length];trail.visible=true;trail.position.copy(player.position);trail.position.y=.09;
        trail.rotation.z=Math.atan2(-dashFacing.z,dashFacing.x)+Math.PI/2;trail.userData.life=.26;trailClock=.025;
      }
      dashTrails.forEach(m=>{m.userData.life=Math.max(0,m.userData.life-dt);m.visible=m.userData.life>0;if(!m.visible)return;(m.material as THREE.MeshBasicMaterial).opacity=m.userData.life*1.8;m.scale.x=.6+m.userData.life*2;});
      if (hasStarted && gameStatus === 'playing') {
        attackBuffer = Math.max(0, attackBuffer - dt); dashBuffer = Math.max(0, dashBuffer - dt);
        if (attackBuffer === 0) bufferedFacing = null;
        dashCooldown = Math.max(0, dashCooldown - dt);
        // A dash that waited out the live blade goes first, the moment the recovery begins and ahead of the
        // next held swing, or holding strike would swallow every dodge pressed mid-swing.
        if (dashTime <= 0 && dashBuffer > 0 && canAbortSwing(attackTime, swing)) requestDash();
        if (attackTime <= 0 && dashTime <= 0 && (attackBuffer > 0 || held('attack'))) startAttack();
        const input = moveInput(), moving = input.lengthSq() > 0;
        if (moving && attackTime <= 0 && dashTime <= 0) facing.copy(input);
        const direction = dashTime > 0 ? dashFacing : facing;
        const targetAngle = Math.atan2(-direction.x, -direction.z);
        const angleDelta = Math.atan2(Math.sin(targetAngle - player.rotation.y), Math.cos(targetAngle - player.rotation.y));
        player.rotation.y += angleDelta * (1 - Math.exp(-28 * dt));
        const speed = playerSpeed({ dashing: dashTime > 0, attacking: attackTime > 0, weapon: swing });
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
            sprung.forEach(e => { e.awake = true; e.group.visible = true; e.cooldown = Math.max(e.cooldown, 0.9); burst(e.group.position, 0xff4529, 10); });
            setNotice(`${currentRoom.name} · ambush`); setNoticeDetail(`${sprung.length} rise from the silt`); noticeTime = 3; audio.play('warn'); shake = 0.12;
          }
        }
        // The stair opens when the last warden falls and takes the knight down only once he has stood on it a
        // moment: the floor ends on a step he chose, never in the middle of a swing. A dash across it does not count.
        // An arm on the floor is only ever offered. Standing in the ring lights it and names it at the foot
        // of the screen; nothing leaves the knight's hand until he answers with the swap key, so walking
        // over a rack mid-fight — or dashing through one — cannot change the weapon he is swinging.
        if (drop) {
          overDrop = Math.hypot(player.position.x - drop.x, player.position.z - drop.z) < PICKUP_RADIUS;
          showOffer(overDrop ? drop.kind : null);
          // The ring answers the step rather than a dwell, so it eases rather than fills: what it says now
          // is "this one is yours for the asking", and the asking is the key.
          ringLit += ((overDrop ? 1 : 0) - ringLit) * (1 - Math.exp(-11 * dt));
          drop.ring.material.opacity = .35 + ringLit * .6;
          drop.ring.scale.setScalar(1 + ringLit * .12);
          drop.group.rotation.y += dt * (overDrop ? 1.5 : .45);
        }
        if (!stairOpen && stairClear()) openStair();
        if (stairOpen) {
          const onStair = Math.hypot(player.position.x - stairSpot.x, player.position.z - stairSpot.z) < STAIR_RADIUS;
          stairDwell = stairDwellStep(stairDwell, onStair, dashTime > 0, dt);
          const fill = stairDwell / STAIR_DWELL, pulse = Math.sin(t * 3) * .1;
          if (stairRing) { stairRing.material.opacity = .75 + fill * .25 + pulse; stairRing.scale.setScalar(1 + fill * .15); }
          // The shaft stays dark until the knight stands on it, then fills with light as the dwell runs: the same
          // cue tells him the stair is his to take and how close he is to taking it.
          if (stairLight) stairLight.pool.value = .12 + fill * .74 + pulse * .3;
          ember.bid(lampAt.set(stairSpot.x, .55, stairSpot.z), Math.hypot(player.position.x - stairSpot.x, player.position.z - stairSpot.z), 9 + fill * 19, 0xfbc956);
          if (stairDwell >= STAIR_DWELL) descend();
        }
        if (gameStatus !== 'playing') return;
        for (const feature of features) {
          const near = Math.hypot(player.position.x-feature.mesh.position.x, player.position.z-feature.mesh.position.z);
          if (feature.shrine) {
            const crystal = feature.mesh.userData.crystal as THREE.Mesh<THREE.OctahedronGeometry,THREE.MeshStandardMaterial>;
            crystal.rotation.y = t*.65; crystal.position.y = 1.25+Math.sin(t*2)*.12; crystal.material.emissiveIntensity = feature.used ? .15 : 2;
            feature.glow.band.value = feature.used ? .12 : .5 + Math.sin(t*3)*.2;
            // Emissive is a colour, not a lamp: the crystal was the brightest
            // object in the sanctuary and the floor under it was as dark as the
            // corridor outside. The pool is what the sanctuary frame was missing
            // when the review found "no light source in frame at all".
            feature.glow.pool.value = feature.used ? .05 : .19 + Math.sin(t*2)*.05;
            // A standing light, so it bids low: any flare or blow outbids it, and
            // in a sanctuary — where nothing else is happening — nothing does.
            // Kept deliberately small. At 11.5 it lit the paving the knight was
            // standing on as much as it lit him, and measured on the sanctuary
            // frame his separation from the stone around him fell from 6.9 to
            // 3.5 — a shrine that makes the knight harder to find is a worse
            // frame however much better the shrine looks. At this strength the
            // inverse square has the light spent by the time it reaches him.
            if (!feature.used) ember.bid(crystal.position, near, 4.4 + Math.sin(t*2)*.7, 0x71f4c4);
            if (!feature.used && near < 1.5 && run.hp < run.maxHp) { feature.used = true; heal(run, 35); setHealth(run.hp); audio.play('clear'); burst(player.position,0x71f4c4,20); setNotice('+35 vitality'); setNoticeDetail(''); noticeTime = 2; }
          } else {
            const wasFiring = feature.phase > 2.6;
            feature.phase = (t + feature.room*.7) % 3.6;
            if (!wasFiring && feature.phase > 2.6 && near < 20) { burst(feature.mesh.position, 0xff8c38, 16); audio.play('warn'); }
            const firing = feature.phase > 2.6;
            const charge = Math.min(1, feature.phase / 2.6);
            feature.glow.band.value = firing ? .9 : .12 + charge*.37;
            // The tiles warm as the grate charges and are flooded when it fires.
            // This is the frame the review called out by name: three telegraphs
            // that threw no light, so the one dramatic thing in the shot did not
            // belong to the room it was burning.
            feature.glow.pool.value = firing ? .44 + Math.sin(t*27)*.06 : charge**3 * .2;
            feature.mesh.material.color.setHex(firing ? 0xffd6c2 : 0x4a4f57);
            if (firing) ember.bid(lampAt.set(feature.mesh.position.x, .85, feature.mesh.position.z), near, 30 + Math.sin(t*31)*5, 0xff5a2a);
            // The flare itself throttles the burn — one tick per flare, cleared when the ring goes cold.
            // It used to be the 0.65s hurt timer doing this job, which is why a hazard tick also bought
            // more immunity than a sword: the two roles are now separate.
            if (!firing) feature.burned = false;
            // Spent on the tick it reaches him, landed or not. The latch used to sit behind `hurt`, so a
            // refused hit left the ring armed and it simply tried again the next tick - and since a dash
            // carries 0.1s of i-frames against a flare that burns for a second, the ring always won. No
            // dash could ride one out, which is the thing a dash through fire is for.
            else if (!feature.burned && near < 1.8) {
              feature.burned = true;
              if (hurt(run, 10, { dashing: dashImmune(dashTime) })) {
                setHealth(run.hp); hurtFlash = .65; shake = .1; audio.play('hurt'); burst(player.position,0xff4529,8);
                if(run.hp===0)endRun('hazard');
              }
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
        // Plan 013: the tabard is rigid plate, so it swings out ahead of whichever thigh leads rather than let it through.
        player.userData.tabard.rotation.x=Math.max(0,...player.userData.legs.map((leg:THREE.Group)=>leg.rotation.x))*.85;
        player.position.y = 0.03 + locomotion.height + Math.sin(t*2.4)*.012*Math.max(0,1-gaitSpeed);
        player.rotation.x = THREE.MathUtils.damp(player.rotation.x, dashTime > 0 ? -0.3 : 0, 24, dt);
        player.userData.cape.rotation.x = THREE.MathUtils.damp(player.userData.cape.rotation.x, dashTime > 0 ? -.8 : -locomotion.cape, 16, dt);
        // Plan 008: the SAME crossing the step sound plays on, resolved only now that the legs and the
        // body carry this update's pose, so the sole's world point is not last frame's. The boot's own
        // x/z, the support's sampled top for y; no support, wood, or a veil pending means no effect.
        const falls=footfalls(previousPhase,walkPhase,{dashing:dashTime>0,dt,travelled});
        if(falls.length&&!building){
          player.updateWorldMatrix(true,true);
          for(const fall of falls){
            stepLog.contacts++;
            const boot=(player.userData.legs[fall.side] as THREE.Group).userData.boot as THREE.Mesh;
            soleAt.set(0,-.08,0);boot.localToWorld(soleAt);
            const support=footSupport(surfaceIndex,soleAt.x,soleAt.z);
            if(!support){stepLog.skipped++;continue;}
            footsteps.emit({x:soleAt.x,y:support.y,z:soleAt.z},support.kind,{heading:velocity,reduced:easeMotion});stepLog.kinds[support.kind]++;
            stepLog.last={count:fall.count,side:fall.side,kind:support.kind,cell:support.cell,x:soleAt.x,y:support.y,z:soleAt.z};
          }
        }
        dashTime = Math.max(0, dashTime - dt);
        // Bolts come back on their own clock, never on a cooldown, and the readout only moves when the
        // count does rather than every frame.
        if (weapon.ranged && quiver < weapon.ranged.capacity) {
          const back = reloadStep(quiver, weapon.ranged.capacity, reload, weapon.ranged.refill, dt);
          if (back.spare !== quiver) { quiver = back.spare; setAmmo({ held: quiver, of: weapon.ranged.capacity }); }
          reload = back.timer;
        }
        chainIdle = attackTime > 0 ? 0 : chainIdle + dt;
        if (attackTime > 0) {
          const wasLive = playerAttackPose(swing.duration - attackTime, swing, chainBeat).active;
          attackTime = Math.max(0, attackTime - dt);
          const pose=posePlayer(swing.duration-attackTime),active=pose.active;
          slash.update(dt,pose.trail,player.userData.sword,bladeInner,bladeTip);
          // One bolt on the frame the blade would have gone live. A dry quiver still plays the motion,
          // so running out is something the knight sees rather than something that silently does nothing.
          if (weapon.ranged && active && !wasLive) {
            if (quiver > 0) {
              quiver -= 1; setAmmo({ held: quiver, of: weapon.ranged.capacity });
              const mesh = (weapon.burst ? flaskPool : boltPool).find(thrown => !thrown.visible);
              if (mesh) {
                mesh.visible = true;
                mesh.position.set(player.position.x, .95, player.position.z);
                mesh.rotation.y = Math.atan2(-attackFacing.x, -attackFacing.z);
                shots.push({ mesh, shot: { x: player.position.x, z: player.position.z, dx: attackFacing.x, dz: attackFacing.z, speed: weapon.ranged.speed, life: weapon.ranged.flight, pierce: weapon.ranged.pierce, damage: weapon.damage + run.strike, spent: new Set<number>() } });
                audio.play('dash');
              }
            } else audio.play('warn');
          }
          if (!weapon.ranged && active) enemyData.forEach((enemy) => {
            if (gameStatus !== 'playing' || enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            // The same rule the node suite runs: inside the arc, and with no wall between the blade and the body.
            if (swordContacts(floor.cells, player.position, attackFacing, enemy.group.position, run.reach, swing)) {
              delta.normalize();
              audio.play('hit');
              swingHits.add(enemy); enemy.hp -= swing.damage + run.strike; enemy.hitFlash = 0.2;
              const broke = interruptsWindup(enemy.kind, enemy.windup, swing.stagger);
              if (broke) {enemy.windup = 0;enemy.attackAge=Infinity;enemy.trails.forEach(trail=>trail.effect.clear());}
              enemy.cooldown = Math.max(enemy.cooldown, hitCooldown(enemy.kind, broke, swing.stagger));
              const shove = enemy.kind === 'warden' ? swing.wardenKnockback : swing.knockback;
              moveOnFloor(floor.cells, enemy.group.position, delta.x * shove, delta.z * shove); burst(enemy.group.position, 0xffb24a, 3);
              // Plan 014 round 2: a blade landing was amber sparks alone, which is a spark's colour and
              // not a wound's - the reference always throws a red mist off a struck body.
              // Plan 014 round 8 (lever 3): 6 read as a puff, not a burst - the reference throws a real
              // spray of droplets off a struck body. 14 is inside the "10-20" the plan asked for and
              // still cheap: each is a pooled mesh already paid for by the spark burst beside it.
              burst(enemy.group.position, 0xe0202c, 22);
              blood.spawn(enemy.group.position, enemy.kind === 'warden' ? 1.4 : 1);
              impacts.emit(enemy.group.position,enemy.hp<=0?0xddebd3:0xffedbb,enemy.kind==='warden');
              // Three sparks rather than seven. Each one is its own mesh and so its own draw call, and
              // next to a crescent, a bloom and a shockwave they were paying four calls at the most
              // expensive frame in the game for grit nobody could pick out.
              // One crescent for the cut, on the first body it finds: a swing that takes three is still one swing.
              if (swingHits.size === 1) impacts.arc(player.position, Math.atan2(-attackFacing.x, -attackFacing.z), swing.reach + run.reach);
              // 70ms rather than 35. The freeze rounds up to whole frames, so this is five of them after
              // the blow and a held image six frames long at 60Hz, against three and four before: at this
              // character size two frames of stillness were not enough to find, because the eye reads the
              // pause rather than the pose. It also freezes the cut mid-arc now that the curve launches
              // early, so what is held is a blade across the body rather than one behind the shoulder.
              shake = 0.085; hitStop = 0.07;
              if (enemy.hp <= 0) { enemy.dead = true; enemy.death=startDeath(enemy.group,enemy.kind);enemy.cue.visible=enemy.bar.visible=enemy.alert.visible=false;enemy.trails.forEach(trail=>trail.effect.clear()); award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills); if (!cleared.has(enemy.room) && enemyData.every(e => e.room !== enemy.room || e.dead)) {
                cleared.add(enemy.room);
                const room = floor.rooms[enemy.room], detour = room.role === 'branch';
                award(clearRoomReward(run, detour));
                if (detour) { loot++; setPlundered(loot); }
                setNotice(`${room.name} · ${detour ? 'dead end plundered' : 'cleansed'}`);
                setNoticeDetail(detour ? `+${XP_DEAD_END} XP · +30 vitality` : '+12 vitality restored');
                noticeTime = 3.5; rewardTime = 1.4; audio.play('clear'); burst(player.position,0x71f4c4,18);
                document.getElementById(`map-room-${enemy.room}`)?.setAttribute('fill', detour ? '#c2b273' : '#a8d5b0');
              } if (enemy.room === floor.goal && stairClear()) openStair(); }
            }
          });
        } else { posePlayer(0);slash.update(dt,false,player.userData.sword,bladeInner,bladeTip); }
        // A kill can open a boon draft, and a hazard can end the run, part-way through this update. Every
        // eligible hit and its exactly-once reward is resolved above; from here the world is frozen, so the
        // skeletons must not get one more move out of this tick.
        if (run.choosing || gameStatus !== 'playing') return;
        enemyData.forEach((enemy, index) => {
          if (!enemy.awake) { enemy.cue.visible = false; enemy.bar.visible = false; enemy.alert.visible = false; enemy.trails.forEach(trail=>trail.effect.clear()); return; }
          // A neighbour's noticing beat can pull a still-dormant body in early; scripts/balance/sim.ts
          // carries the identical countdown so a room wakes the same way in both sims.
          if (enemy.alertIn < Infinity) { enemy.alertIn -= dt; if (enemy.alertIn <= 0) { if (enemy.notice <= 0) enemy.notice = dt; enemy.alertIn = Infinity; } }
          enemy.cue.visible = !enemy.dead && (enemy.windup > 0 || enemy.lunge > 0); enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;
          enemy.bar.position.copy(enemy.group.position).add(new THREE.Vector3(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); const fill = Math.max(.001, enemy.hp / enemy.maxHp); enemy.bar.scale.x = fill;
          // Left-anchored: the fill shifts left as it shrinks, and its frame child is counter-scaled and
          // counter-shifted so it stays put at full width.
          enemy.bar.position.addScaledVector(barRight.set(1,0,0).applyQuaternion(camera.quaternion), -(1 - fill) * .4);
          const frame = enemy.bar.children[0]; if (frame) { frame.scale.x = 1 / fill; frame.position.x = (1 - fill) * .4 / fill; }
          // Plan 014 round 2 (lever D10): the alert glyph lives exactly in the noticing window - after
          // `startedNoticing` below sets `notice` above zero and before it reaches `NOTICE_TIME`, which
          // is the same beat `decideEnemy` holds a body at before it is `awake` enough to begin its own
          // tell. That is "just seen you" as a number already in this loop, not a new timer to invent.
          enemy.alert.visible = enemy.notice > 0 && enemy.notice < NOTICE_TIME;
          enemy.alert.position.copy(enemy.group.position).add(new THREE.Vector3(0, enemy.kind === 'warden' ? 3.15 : 2.55, 0));
          // The clock. `close` runs 0 at the start of the tell to 1 on the strike, and the mark converges
          // over it: it opens at nearly twice the reach the blow actually has and shuts onto the body, so
          // what is left to run is a distance on the floor.
          //
          // The opacity ramp is gone. A first pass kept one alongside a quarter-scale convergence and it
          // was the worst of both — a quarter is under the threshold at which a mark moving with its own
          // body reads as closing at all, and the fade underneath was doing what the whole rewrite exists
          // to stop doing. The mark arrives at full strength and the only thing that changes is its size.
          const close = enemy.windup > 0 ? 1 - enemy.windup / enemy.tell : 1;
          enemy.cue.scale.setScalar((enemy.kind === 'warden' ? 1.7 : 1) * (1.9 - .9 * close));
          enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);
          const cueSkin = enemy.cue.material as THREE.MeshBasicMaterial;
          // Plan 014 round 2: this was 1 - a fully opaque slab, drawn for the whole tell, wide enough
          // in the stalker's case to cover half a room and swallow every body standing on it. The
          // texture's own alpha channel now carries the fill/rim/pattern shape (see
          // `telegraphTexture`), so the material only has to hold a modest overall multiplier.
          cueSkin.opacity = .92; cueSkin.color.setHex(THREAT);
          const cueGhost = enemy.cue.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
          cueGhost.material.opacity = .16; cueGhost.material.color.setHex(THREAT);
          if (enemy.dead) { if(enemy.death)advanceDeath(enemy.death,dt);return; }
          const hurtPlayer = () => {
            if (gameStatus !== 'playing' || !hurt(run, enemy.damage, { dashing: dashImmune(dashTime), warded: true })) return;
            setHealth(run.hp);
            audio.play('hurt'); hurtFlash=.35; shake=.12; burst(player.position,0xff4529,8);impacts.emit(player.position,0xff8763,enemy.kind==='warden');
            // Which kind landed the killing blow is the one thing only this call site knows.
            if(run.hp===0)endRun(enemy.kind);
          };
          // Everything about where this body goes and whether its blow lands is decided in dungeon-enemy;
          // what is left here is the part a node test could never see — poses, sound, flashes, particles.
          const previousWindup=enemy.windup;
          const intent = decideEnemy({ kind: enemy.kind, x: enemy.group.position.x, z: enemy.group.position.z, room: enemy.room, cooldown: enemy.cooldown, hitFlash: enemy.hitFlash, windup: enemy.windup, lunge: enemy.lunge, tell: enemy.tell, speed: enemy.speed, aim: enemy.aim, anchor: enemy.anchor, notice: enemy.notice }, player.position, enemyWorld, dt);
          const startedNoticing = enemy.notice <= 0 && intent.notice > 0;
          enemy.cooldown = intent.cooldown; enemy.hitFlash = intent.hitFlash; enemy.notice = intent.notice;
          if (Number.isFinite(enemy.attackAge)) enemy.attackAge+=dt;
          // A fresh noticing beat pulls the nearest still-dozing bodies in too, staggered so a room does
          // not snap awake on one frame; scripts/balance/sim.ts carries the identical logic.
          if (startedNoticing) {
            const wakeables: Wakeable[] = enemyData.map(e => ({ x: e.group.position.x, z: e.group.position.z, room: e.room, notice: e.notice, dead: e.dead || !e.awake }));
            nearbyDozers(wakeables, index).forEach((idx, rank) => {
              const delay = (rank + 1) * ALERT_STAGGER;
              if (delay < enemyData[idx].alertIn) enemyData[idx].alertIn = delay;
            });
          }
          enemy.windup = intent.windup; enemy.lunge = intent.lunge; enemy.aim.set(intent.aim.x,0,intent.aim.z);
          if(previousWindup>0&&enemy.windup===0)enemy.attackAge=0;
          else if(previousWindup<=0&&enemy.windup>0)enemy.attackAge=Infinity;
          enemy.group.position.x = intent.x; enemy.group.position.z = intent.z;
          if (intent.sound) audio.play(intent.sound);
          if (intent.hit) hurtPlayer();
          const pose=enemyPose(enemy.kind,enemy.windup,enemy.tell,enemy.cooldown,enemy.lunge,enemy.attackAge);
          if(!pose.trail)enemy.group.rotation.y=intent.face??enemy.group.rotation.y;
          const walking=intent.act==='dozing'||(intent.act==='ready'&&intent.distance>1.15&&enemy.hitFlash<=0&&pose.recovery===0);
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
          // Landed. The mark is at its tightest already, so the last thing it does is stop being the
          // warning and become the blow: one frame of `COMMIT` on the floor while the body carries the
          // same flare above it, then out inside a tenth of a second.
          if(enemy.windup<=0){const fade=Math.max(0,1-enemy.attackAge/.09);const skin=enemy.cue.material as THREE.MeshBasicMaterial;skin.color.setHex(COMMIT);skin.opacity=fade;const gh=enemy.cue.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;gh.material.color.setHex(COMMIT);gh.material.opacity=fade*.34;enemy.cue.scale.setScalar(enemy.kind==="warden"?1.7:1);}
          enemy.trails.forEach(trail=>trail.effect.update(dt,pose.trail,trail.anchor,trail.inner,trail.tip));
          // A struck body flares for two frames and is back to its own colour inside six. The flat 0.8
          // this replaced held an orange tint for the whole 0.2s of hitFlash, which is fifteen frames of
          // tan: a state the body was in rather than a blow it took. The curve cannot be driven off
          // hitFlash, though, because combat decrements that on the frozen clock and hit-stop would hold
          // the flare at full for its whole length — so the rising edge is stamped against `elapsed`,
          // which hit-stop does not touch, and the decay is read off that. Warm rather than white: the
          // skeletons are already pale, and a white flare on a white body deletes the skull it is on.
          // The peak is held near the 0.8 the old flat tint used, which never clipped: what makes the
          // blow read is that it now spikes and falls inside six frames rather than sitting there.
          const rig = enemy.group.userData as { struckAt?: number; wasFlashing?: number };
          if (enemy.hitFlash > (rig.wasFlashing ?? 0)) rig.struckAt = elapsed;
          rig.wasFlashing = enemy.hitFlash;
          const struck = rig.struckAt === undefined ? 0 : Math.max(0, 1 - (elapsed - rig.struckAt) / 0.1) ** 2.2;
                    // The tell's second channel. The body already lit during a windup, but at one flat dull brick
          // for the whole of it, which says a blow is coming and never says when — the same fault the
          // arc on the floor had. It takes the threat colour and rides the same clock, so the body is
          // dimmest at the top of the tell and hottest on the frame the blade goes out. That is what
          // makes the tell survive a pier standing between the lens and the arc.
          const closing = enemy.windup > 0 ? 1 - enemy.windup / enemy.tell : 0;
          // Plan 014 round 3 (lever A3): these ran up to 0.7 (struck) and 2.1 (windup) - tuned against
          // a pipeline that was tone-mapping this material before bloom ever saw it. Now that the
          // chain reads real linear HDR (see dungeon-post.ts), an emissive that hot on a whole body
          // mesh - not a point, the entire skeleton - blooms into the shapeless blob a hit used to
          // vanish into. Kept well under the bloom threshold so the flash still reads as a hot tint on
          // the body without becoming a second light source.
          // Plan 014 round 6 (lever 5): round 3's ceiling was tuned against a body standing in the
          // scene's average light, not one standing a torch-light's width from an actual brazier or
          // sconce - and this round's critic still caught both the stalker (mid-windup, torch-room) and
          // a struck skeleton (combat-bridge) clipping to a near-white blob. The emissive term stacks
          // additively on whatever direct light the body already has, so the same absolute ceiling reads
          // as a mild warm cast in mid-room and as a bloom-triggering blowout standing in a torch's own
          // pool. Confirmed with a diagnostic, not a guess: setting this to zero outright on a live
          // capture recovered the stalker's own teal-green bone exactly, at the same frame and the same
          // lighting that had it reading pale pink-white a moment before - so the wash really was this
          // term, and round 3's own halving of it was still an order of magnitude too hot for a body
          // standing this close to a real light source. Cut hard, not halved again: legible as a tint,
          // not a wash, on the frame it peaks.
          enemy.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.setHex(struck > 0 ? COMMIT : enemy.windup > 0 ? THREAT : 0x000000); o.material.emissiveIntensity = struck > 0 ? 0.015 + struck * 0.05 : enemy.windup > 0 ? 0.01 + closing * 0.06 : 0.5; } });
        });
        // Separate bodies without moving a guard during its committed windup; the rule itself lives in
        // dungeon-enemy, and only the write back into the scene graph belongs here.
        const spread = separateCrowd(floor.cells, enemyData.map(e => ({ x: e.group.position.x, z: e.group.position.z, windup: e.windup, dead: e.dead })), dt);
        enemyData.forEach((e, i) => { e.group.position.x = spread[i].x; e.group.position.z = spread[i].z; });
        // Fire on the ground bites what stands in it: the only thing the knight owns that goes on working
        // after he has stopped paying attention to it. The rule is in dungeon-projectile.
        for (let i = pools.length - 1; i >= 0; i--) {
          const live = pools[i], burn = poolStep(live.pool, dt);
          live.pool.life = burn.life; live.pool.timer = burn.timer;
          live.mesh.material.opacity = Math.min(.7, live.pool.life * .5) * (.75 + Math.sin(t * 11) * .25);
          // Burning silt is a fire on the floor and was lighting none of it.
          ember.bid(lampAt.set(live.pool.x, .6, live.pool.z), Math.hypot(player.position.x - live.pool.x, player.position.z - live.pool.z), 13 * Math.min(1, live.pool.life), 0xff6a22);
          if (burn.bites) for (const enemy of enemyData) {
            if (enemy.dead || !enemy.awake || gameStatus !== 'playing') continue;
            if (!poolCatches(live.pool, enemy.group.position.x, enemy.group.position.z)) continue;
            enemy.hp -= live.pool.damage; enemy.hitFlash = 0.2;
            burst(enemy.group.position, 0xff8c38, 5);
            if (enemy.hp <= 0) {
              enemy.dead = true; enemy.death = startDeath(enemy.group, enemy.kind);
              enemy.cue.visible = enemy.bar.visible = enemy.alert.visible = false; enemy.trails.forEach(trail => trail.effect.clear());
              award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills);
              if (!cleared.has(enemy.room) && enemyData.every(other => other.room !== enemy.room || other.dead)) {
                cleared.add(enemy.room);
                const room = floor.rooms[enemy.room];
                award(clearRoomReward(run, room.role === 'branch'));
                setNotice(`${room.name} · cleansed`); setNoticeDetail(room.role === 'branch' ? 'The detour pays' : ''); noticeTime = 2.5; audio.play('clear');
              }
            }
          }
          if (live.pool.life <= 0) { live.mesh.visible = false; pools.splice(i, 1); }
        }
        // Bolts fly last, against where the bodies actually ended the frame. The rule is in
        // dungeon-projectile; what belongs here is the mesh, the sparks and the damage call.
        if (shots.length) {
          const marks: Mark[] = enemyData.map((e, index) => ({ x: e.group.position.x, z: e.group.position.z, index })).filter(mark => !enemyData[mark.index].dead && enemyData[mark.index].awake);
          for (let i = shots.length - 1; i >= 0; i--) {
            const live = shots[i], flight = flyShot(live.shot, floor.cells, marks, dt);
            live.shot.x = flight.x; live.shot.z = flight.z; live.shot.life = flight.life; live.shot.pierce = flight.pierce;
            live.mesh.position.set(flight.x, .95, flight.z);
            for (const index of flight.hits) {
              const enemy = enemyData[index];
              if (enemy.dead || gameStatus !== 'playing') continue;
              audio.play('hit');
              enemy.hp -= live.shot.damage; enemy.hitFlash = 0.2;
              const broke = interruptsWindup(enemy.kind, enemy.windup, weapon.stagger);
              if (broke) { enemy.windup = 0; enemy.attackAge = Infinity; enemy.trails.forEach(trail => trail.effect.clear()); }
              enemy.cooldown = Math.max(enemy.cooldown, hitCooldown(enemy.kind, broke, weapon.stagger));
              const shove = enemy.kind === 'warden' ? weapon.wardenKnockback : weapon.knockback;
              moveOnFloor(floor.cells, enemy.group.position, live.shot.dx * shove, live.shot.dz * shove);
              burst(enemy.group.position, 0xffb24a, 7); burst(enemy.group.position, 0xe0202c, 22); blood.spawn(enemy.group.position, enemy.kind === 'warden' ? 1.4 : 1); impacts.emit(enemy.group.position, enemy.hp <= 0 ? 0xddebd3 : 0xffedbb, enemy.kind === 'warden');
              shake = 0.05; hitStop = 0.025;
              if (enemy.hp <= 0) {
                enemy.dead = true; enemy.death = startDeath(enemy.group, enemy.kind);
                enemy.cue.visible = enemy.bar.visible = enemy.alert.visible = false; enemy.trails.forEach(trail => trail.effect.clear());
                award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills);
                if (!cleared.has(enemy.room) && enemyData.every(other => other.room !== enemy.room || other.dead)) {
                  cleared.add(enemy.room);
                  const room = floor.rooms[enemy.room];
                  award(clearRoomReward(run, room.role === 'branch'));
                  setNotice(`${room.name} · cleansed`); setNoticeDetail(room.role === 'branch' ? 'The detour pays' : ''); noticeTime = 2.5; audio.play('clear');
                }
              }
            }
            // Stone stops a bolt as surely as it stops steel, and says so.
            if (flight.struck) burst(new THREE.Vector3(flight.x, .95, flight.z), 0xbfa781, 5);
            if (flight.done) {
              live.mesh.visible = false; shots.splice(i, 1);
              if (weapon.burst) {
                const mesh = poolMeshes.find(ring => !ring.visible);
                if (mesh) {
                  mesh.visible = true; mesh.position.set(flight.x, .07, flight.z);
                  mesh.scale.setScalar(weapon.burst.radius);
                  pools.push({ mesh, pool: { x: flight.x, z: flight.z, radius: weapon.burst.radius, life: weapon.burst.life, damage: weapon.burst.damage, interval: weapon.burst.interval, timer: 0 } });
                  burst(new THREE.Vector3(flight.x, .4, flight.z), 0xff8c38, 18); audio.play('warn'); shake = 0.06;
                }
              }
            }
          }
        }
      }
      if (noticeTime > 0) { noticeTime = Math.max(0,noticeTime-frameDt); if (noticeTime === 0) setNotice(''); }
      if (rewardTime > 0) { rewardTime = Math.max(0, rewardTime - frameDt); if (rewardTime === 0) setXpReward(0); }
      particles.forEach((p) => { p.life -= dt; p.velocity.y -= dt * 7; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.scale.setScalar(Math.max(0, p.life * 2)); });
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) { world.remove(particles[i].mesh); if (particles[i].mesh.material !== sparkMat) (particles[i].mesh.material as THREE.Material).dispose(); particles.splice(i, 1); }
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt); tickRun(run, dt);
      atmosphere?.update(t,player.position,cleared,moodFire,moodBanner,moodMasonry,moodBed);
      // Plan 007: the atmosphere pass just wrote the animated colour every eligible material carries;
      // copy it onto each material's cutaway variant, which is what every registered mesh actually
      // renders with now. Never Material.copy, never a new material, just the handful of scalars.
      cutaway.syncMaterials();
      // The parapet is carved work too, built here rather than in the atmosphere pass but lit the same.
      parapetSkin?.color.copy(moodMasonry);
      const nearest = [...(atmosphere?.torchPositions ?? [])].sort((a,b)=>a.distanceToSquared(player.position)-b.distanceToSquared(player.position));
      // Three of the four go to their sconces. The fourth is settled below, once
      // the accents have had their chance to ask for it.
      for (let i = 0; i < torchLights.length - 1; i++) if (nearest[i]) torchLights[i].position.copy(nearest[i]);
      const anchors = atmosphere?.lightAnchors ?? [];
      const lent = anchors.length <= ANCHOR_LIGHTS ? anchors : [...anchors].sort((a,b)=>((a.x-player.position.x)**2+(a.z-player.position.z)**2)-((b.x-player.position.x)**2+(b.z-player.position.z)**2));
      anchorLights.forEach((light, i) => { const a = lent[i]; if (!a) { light.intensity = 0; return; } light.position.set(a.x, a.y, a.z); light.color.setHex(a.color); light.intensity = a.intensity; light.distance = a.distance; });
      fill.position.copy(player.position).add(new THREE.Vector3(1.4,3.2,2.2));
      moveMood(1 - Math.exp(-6 * frameDt));
      playerRing.position.set(player.position.x,0.04,player.position.z); (playerRing.material as THREE.MeshBasicMaterial).opacity = dashTime > 0 ? 0.85 : 0.14; ringTime.value = t;
      moon.position.copy(player.position).setY(0).add(MOONRISE); moon.target.position.set(player.position.x,0,player.position.z); moon.target.updateMatrixWorld();
      mapPlayer.current?.setAttribute('cx', String(player.position.x / TILE)); mapPlayer.current?.setAttribute('cy', String(player.position.z / TILE));
      if (dashMeter.current) dashMeter.current.value = Math.max(0,1-dashCooldown/run.dashSpan);
      const target = player.position.clone().addScaledVector(velocity,0.12); cameraFocus.lerp(target,1-Math.exp(-8*frameDt));
      camera.position.set(cameraFocus.x + 9.2,12.5,cameraFocus.z + 11.5);
      // Reduced motion drops the shake outright: it is ~90 Hz camera translation that carries nothing the
      // particles, the sound and the health bar do not already say, so nothing is lost by not moving at all.
      if (shake > 0 && !easeMotion) camera.position.add(new THREE.Vector3(Math.sin(t*95)*shake,0,Math.cos(t*83)*shake));
      camera.lookAt(cameraFocus.x,0,cameraFocus.z);
      // Plan 007: resolve this frame's cutaway targets after the camera has its final position for the
      // frame, so the view-space centres this writes are never a frame stale. Eligibility mirrors the
      // existing threat cue exactly (`enemy.windup>0||(enemy.lunge>0&&enemy.attackAge<.09)`) rather than
      // introducing a second definition of "attacking" - an idle guard, a corpse, a dormant ambush or a
      // neighbour-room enemy is never in this list at all, which is what clears its slot at once rather
      // than fading it. `dt`, not `frameDt`, so hit-stop holds a fade exactly where it was.
      cutaway.update(camera, gameStatus === 'playing' ? { position: player.position } : null,
        gameStatus === 'playing' ? enemyData.reduce<CutawayEnemyCandidate[]>((list, enemy, index) => {
          if (enemy.dead || !enemy.awake || enemy.room !== activeRoom) return list;
          if (player.position.distanceTo(enemy.group.position) > CUTAWAY_ENEMY_RANGE) return list;
          list.push({ id: index, kind: enemy.kind, position: enemy.group.position, attacking: enemy.windup > 0 || (enemy.lunge > 0 && enemy.attackAge < .09) });
          return list;
        }, []) : [], dt);
      // frameDt, not dt: hit-stop must freeze the world, not the accents that mark
      // the blow which caused it. See impactEffects.update.
      impacts.update(frameDt,camera.quaternion);
      // `dt`, not `frameDt`: a footfall belongs to the world, so hit-stop and pause hold it where it is.
      footsteps.update(dt,camera.quaternion);
      // A blow lit nothing: the bloom and the shockwave were additive quads over
      // an unchanged floor, so the loudest thing in the frame was also the only
      // thing in it casting nothing. It bids last because it is the shortest —
      // eleven frames — and because it is the one event that happens on top of
      // the knight, where a light is worth most.
      const lamp = impacts.lamp;
      // Plan 014 round 3 (lever A3): this ran up to 31/23 - tuned before the post chain read real
      // linear HDR (see dungeon-post.ts). A real point light at that intensity sitting almost on top
      // of the struck body is exactly what was left of the white slash blob once the emissive flash
      // and the flat VFX quads were all tamed - the light itself, not anything drawn on screen, was
      // still bright enough to bloom the stone and the body around it into one shapeless glow.
      if (lamp) ember.bid(lampAt.set(lamp.at.x, .95, lamp.at.z), Math.hypot(lamp.at.x - player.position.x, lamp.at.z - player.position.z), (lamp.heavy ? 7 : 5) * lamp.glow, lamp.colour);
      ember.settle(nearest[torchLights.length - 1], torchFlicker(torchLights.length - 1));
      // The hurt filter is reduced, not removed. Its discomfort is the brightness ramping across the whole
      // screen as the flash decays; its job is telling the player they were hit, which is gameplay. So the
      // tint stays for exactly as long, holds still, and drops the brightness change entirely.
      renderer.domElement.style.filter = hurtFlash <= 0 ? '' : easeMotion ? 'sepia(.3) saturate(1.5) hue-rotate(-22deg)' : `sepia(.4) saturate(1.75) hue-rotate(-25deg) brightness(${0.9 + hurtFlash * 0.3})`;
    };
    const hooks = window as Window & {
      advanceTime?: (ms: number, draw?: boolean) => void;
      render_game_to_text?: () => string;
      dungeonTest?: { teleport: (x: number, z: number) => void; equip: (id: string) => void; descend: () => void; buildFloor: (level: number) => void; grantXp: (amount: number) => void; reset: (seed?: number) => void; runLog: () => RunEnd[]; configureCombatFixture?: (fixture: CombatFixture) => void; cutawayDiagnostics?: () => ReturnType<typeof cutaway.diagnostics>; setCutawayEnabled?: (enabled: boolean) => void; footstepParticles?: () => ReturnType<typeof footsteps.particles>; setFootstepsEnabled?: (enabled: boolean) => void; actorStats?: () => { knight: ReturnType<typeof actorStat> & { disposedMaterials: number }; enemies: ({ kind: Enemy['kind'] } & ReturnType<typeof actorStat>)[]; drop: { kind: WeaponId; meshes: number; triangles: number } | null }; lightDiagnostics?: (index: number, radius?: number) => unknown };
    };
    // Drive the run from the console or a browser test: see tests/README.md for the usual recipes.
    const testHooks: NonNullable<typeof hooks.dungeonTest> = {
      // The mood snaps rather than sliding. Crossing a threshold on foot is worth a third of a second
      // of cross-fade; arriving somewhere by fixture is not a walk, and a driver that teleports into a
      // chamber to photograph it would otherwise catch the lights still on their way there.
      teleport: (x, z) => {player.position.set(x, 0.03, z);moodCell='';moodSnap=true;slash.clear();cutaway.clear();footsteps.clear();},
      // Fixture setup, like teleport: put a named arm in hand without walking a rack down. An unknown id
      // arms the Tideblade rather than leaving the knight empty-handed, as weaponById does everywhere.
      equip: (id) => { equip(weaponById(id).id); setHeldWeapon(weaponById(id).name); },
      descend: () => buildFloor(Math.min(FLOORS, level + 1)),
      buildFloor: (nextLevel) => buildFloor(nextLevel),
      grantXp: (amount) => award(grantXp(run, amount)),
      // What a test driver uses instead of opening the page again, which costs twelve seconds of module
      // load, WebGL boot and a first floor. It is the same `restart` the end screen runs - so a field
      // added to the sim is reset by the code that already had to remember it - plus the handful of
      // counters a restart deliberately keeps, because a player restarting has already started and a
      // fresh page has not. That second half is the part that can rot, which is why nothing trusts it:
      // `helpers.ts` holds every reset against the snapshot a real boot produced and fails the next test
      // by field name rather than letting it leak. `manualTime` is not cleared on purpose - the driver
      // owns the clock from its first `advanceTime` and must keep owning it across a reset.
      reset: (seed) => {
        hasStarted = false; setStarted(false); setCapturing(null); enterWhenBuilt = false; setEntering(false);
        elapsed = 0; runStart = 0; floorStart = 0; activeRoom = 0;
        // A fresh page has never seen the cursor. The veil used to clear this by covering the canvas for a few
        // frames (Chrome then sends it a pointerleave), but a reset under the driver's clock draws none.
        pointerNdc = null; aimDevice = 'keys';
        // Before restart, which places the knight on the new floor's start tile: this puts the rig
        // back, not the body.
        restPose.forEach((rest, o) => { o.position.copy(rest.p); o.rotation.copy(rest.r); });
        restart(seed);
      },
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
      // Plan 007: read-only target/material state for a browser spec, and a same-frame A/B toggle
      // that never touches a target's own state (see `uCutawayEnabled` in dungeon-occlusion.ts) - both
      // dropped from a production build along with the rest of this block.
      testHooks.cutawayDiagnostics = () => cutaway.diagnostics();
      testHooks.setCutawayEnabled = (enabled) => cutaway.setEnabled(enabled);
      // Plan 008: every live footstep particle's world state, and a same-frame A/B draw toggle that never
      // touches a particle - both dropped from a production build with the rest of this block.
      testHooks.footstepParticles = () => footsteps.particles();
      testHooks.setFootstepsEnabled = (enabled) => footsteps.setEnabled(enabled);
      // Plan 009: the model round's shared diagnostic (009 arms, 010 knight, 011 enemies) - meshes,
      // triangles and height per figure, read off the live scene. Read-only; changes nothing a reset
      // would have to restore, and is dropped from a production build with the rest of this block.
      // The knight's materials are run-scoped and shared with every arm he holds and every rack he is
      // offered, so nothing short of an unmount may release one: each dispose that reaches one is counted.
      let knightDisposals = 0;
      const knightMaterials = new Set<THREE.Material>();
      player.traverse(o => { if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => knightMaterials.add(m)); });
      knightMaterials.forEach(m => m.addEventListener('dispose', () => { knightDisposals++; }));
      testHooks.actorStats = () => {
        const held = drop ? actorStat(drop.group) : null;
        return { knight: { ...actorStat(player), disposedMaterials: knightDisposals }, enemies: enemyData.filter(e => !e.dead).map(e => ({ kind: e.kind, ...actorStat(e.group) })), drop: drop && held ? { kind: drop.kind, meshes: held.meshes, triangles: held.triangles } : null };
      };
      // Plan 014 round 5 (lever A3): a real answer to "what is overbright here" instead of another
      // guess. Enumerates every material on a live enemy's own group, plus every light and every
      // additive-blended mesh/sprite anywhere in the scene within `radius` of its position, with the
      // handful of numbers that actually decide whether something blooms: emissive/emissiveIntensity,
      // opacity, and (for lights) colour/intensity/distance from the target. Read-only, dropped from a
      // production build with the rest of this block.
      testHooks.lightDiagnostics = (index: number, radius = 2) => {
        const enemy = enemyData[index];
        if (!enemy) throw new Error(`no enemy at spawn index ${index}`);
        const at = enemy.group.position;
        const materials: unknown[] = [];
        enemy.group.traverse(o => {
          if (!(o instanceof THREE.Mesh)) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            const std = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
            materials.push({
              node: o.name || o.type, material: m.type,
              color: '#' + std.color?.getHexString(), emissive: std.emissive ? '#' + std.emissive.getHexString() : null,
              emissiveIntensity: std.emissiveIntensity ?? null, opacity: m.opacity, transparent: m.transparent,
              blending: m.blending, toneMapped: m.toneMapped, visible: o.visible,
            });
          }
        });
        const lights: unknown[] = [];
        const nearby: unknown[] = [];
        scene.traverse(o => {
          if (o instanceof THREE.Light) {
            const d = o.position.distanceTo(at);
            if (d <= radius) lights.push({ type: o.type, color: '#' + o.color.getHexString(), intensity: o.intensity, distance: +d.toFixed(3) });
            return;
          }
          let underEnemy = false; for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === enemy.group) { underEnemy = true; break; }
          if ((o instanceof THREE.Mesh || o instanceof THREE.Sprite) && !underEnemy) {
            const d = o.getWorldPosition(new THREE.Vector3()).distanceTo(at);
            if (d > radius) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m.blending !== THREE.AdditiveBlending && m.opacity >= 1 && !(o instanceof THREE.Sprite)) continue;
              nearby.push({ node: o.name || o.type, distance: +d.toFixed(3), material: m.type, color: '#' + (m as THREE.MeshBasicMaterial).color?.getHexString(), opacity: m.opacity, blending: m.blending, toneMapped: m.toneMapped, visible: o.visible });
            }
          }
        });
        return { at: { x: at.x, y: at.y, z: at.z }, materials, lights, nearby };
      };
      testHooks.configureCombatFixture = (fixture) => {
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
            // A windup only ever exists on a body that has already cleared its notice beat - decideEnemy
            // holds windup untouched until `notice` reaches NOTICE_TIME. Staging one on a still-dozing
            // spawn (notice 0) would otherwise stage an impossible state: a swing frozen behind a beat it
            // can never finish inside a fixture's short window.
            enemy.notice = NOTICE_TIME;
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
    const advanceTime = (ms: number, draw = true) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      if (draw) { post.render(elapsed); }
    };
    const renderText = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, building, boonOffer: run.choosing, muted: isMuted, roomName: floor.rooms[activeRoom]?.name ?? 'Passage',
      health: run.hp, maxHealth: run.maxHp, rank: run.rankLevel, weapon: { id: weapon.id, name: weapon.name, damage: weapon.damage, reach: weapon.reach, duration: weapon.duration, strikeDamage: weapon.damage + run.strike, ranged: !!weapon.ranged, quiver: weapon.ranged ? quiver : null, capacity: weapon.ranged ? weapon.ranged.capacity : null, inFlight: shots.length, fires: pools.length }, boons: { strike: run.strike, reach: run.reach, draught: run.draught, dashSpan: run.dashSpan, guardAgainst: run.guardAgainst }, remaining: floor.guardCount - enemyData.filter(e => e.dead).length,
      objective: { floor: level, floors: FLOORS, goal: goalRoom().name, goalRoom: floor.goal, halls: reached, goalDepth: goalRoom().depth, atStair: activeRoom === floor.goal, stairClear: stairClear(), stairOpen, stairDwell, deadEndsPlundered: loot },
      stair: { x: stairSpot.x, z: stairSpot.z, radius: STAIR_RADIUS, dwell: STAIR_DWELL },
      drop: drop ? { x: drop.x, z: drop.z, kind: drop.kind, radius: PICKUP_RADIUS, over: overDrop, offered } : null,
      experience: { total: run.totalXp, perEnemy: XP_PER_ENEMY, intoRank: run.rankProgress, rankCost: rankCost(run.rankLevel), resetsOnNewRun: true },
      render: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: post.sceneCost.calls, triangles: post.sceneCost.triangles, frames: post.frames, passes: post.composer.passes.map(pass => pass.constructor.name), pointLights: (() => { let n = 0; scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) n++; }); return n; })(), programs: (renderer.info as unknown as { programs?: unknown[] }).programs?.length ?? 0, quality: post.quality },
      effects: { impacts: impacts.active, footsteps: { active: footsteps.active, drawn: footsteps.mesh.visible, emitted: footsteps.emitted, contacts: stepLog.contacts, skipped: stepLog.skipped, kinds: { ...stepLog.kinds }, last: stepLog.last } },
      // Added keys, never changed ones: `muted` above still means what it always did. `filter` is what the
      // canvas is actually wearing this frame, so a driver can see the hurt tint rather than infer it.
      aim: { device: aimDevice, ndc: pointerNdc, span: viewSpan, aspect: viewAspect, pad: padLook },
      settings: { ...settingsRef.current, reduceMotion: easeMotion, filter: renderer.domElement.style.filter, shake, hitStop, sound: audio.level() },
      // The camera's rest position is focus plus a fixed offset, so anything left over is the shake — which
      // makes "reduced motion actually stopped the camera moving" something a driver can read rather than see.
      camera: { x: camera.position.x, z: camera.position.z, focusX: cameraFocus.x, focusZ: cameraFocus.z, restX: cameraFocus.x + 9.2, restZ: cameraFocus.z + 11.5 },
      features: features.map(f => ({room:f.room, shrine:f.shrine, used:f.used, burned:f.burned, phase:f.phase, x:f.mesh.position.x,z:f.mesh.position.z,radius:f.shrine?1.5:1.8})),
      buildMs,
      // What the chamber is actually being lit with this frame, as hex. A driver measuring whether a
      // tell reads against the stone it is drawn on needs to know which family it is standing in, and
      // the room graph cannot tell it: the lights cross a threshold on the approach rather than on the
      // doorway, so for a third of a second the answer is genuinely neither room's.
      mood: { theme: moodTheme, fire: '#' + moodFire.getHexString(), key: '#' + moodKey.getHexString(), fog: '#' + moodFog.getHexString(), banner: '#' + moodBanner.getHexString() },
      // What actually got attached to the floor's own group, not a second recomputation of the
      // planner's own descriptors - a driver checking the real scene reads this, not `floor.rooms`.
      graphics: { motifs: atmosphere?.motifs ?? [], flames: atmosphere?.flames ?? [], paving: pavingSummary },
      floor: { level, waterfalls: atmosphere?.waterfalls, seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, start: floor.start, goal: floor.goal, spine: floor.spine, visited: [...visited], cleared: [...cleared] },
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashBuffer, dashTime, dashCooldown, chain: { beat: chainBeat, beats: chainLength(weapon), idle: Number.isFinite(chainIdle) ? chainIdle : null, damage: swing.damage + run.strike, duration: swing.duration }, invulnerable: run.invuln, hurtFlash, swordAngle: player.userData.sword.rotation.y, cloak:{anchor:player.userData.cape.position.toArray(),pitch:player.userData.cape.rotation.x}, pose: {bodyYaw:player.userData.torso.rotation.y,trail:slash.mesh.visible,trailTriangles:slash.mesh.geometry.drawRange.count/3}, locomotion: {speed:gaitSpeed,phase:walkPhase,sprint:locomotion.sprint,pitch:player.userData.torso.rotation.x,height:player.position.y,arm:player.userData.arm.rotation.x,tabard:player.userData.tabard.rotation.x,knees:player.userData.legs.map((leg:THREE.Group)=>leg.userData.knee.rotation.x)}, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      corpses: enemyData.filter(e=>e.dead).map(e=>({kind:e.kind,x:e.group.position.x,y:e.group.position.y,z:e.group.position.z,scale:e.group.scale.toArray(),rotation:e.group.userData.rig.rotation.x,age:e.death?.age,settled:e.death?.settled,visible:e.group.visible,cue:e.cue.visible,bar:e.bar.visible,trails:e.trails.some(trail=>trail.effect.mesh.visible)})),
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, kind: e.kind, windup: e.windup, lunge: e.lunge, cooldown: e.cooldown, aim: {x:e.aim.x,z:e.aim.z}, room: e.room, awake: e.awake, pose: {shieldArm:e.group.userData.limbs[0].rotation.x,shieldTilt:e.group.userData.shield.rotation.x,pitch:e.group.userData.rig.rotation.x,height:e.group.userData.rig.position.y,weapon:e.group.userData.weapon.rotation.x,weaponYaw:e.group.userData.weapon.rotation.y,attackAge:Number.isFinite(e.attackAge)?e.attackAge:null,trails:e.trails.filter(trail=>trail.effect.mesh.visible).length,cue:e.cue.visible} })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      // rAF timestamps describe the frame start, which can precede effect setup.
      // Establish the clock on the first callback so startup cannot run time backwards.
      if (built && warmed && !manualTime && !document.hidden) { update(last === null ? 0 : Math.max(0, Math.min((now - last) / 1000, 0.04))); post.render(elapsed); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
    // Plan 014: zoomed in close to the reference's framing - the knight fills much more of the
    // frame than the old 7.2/6.3 span left him. Ratio kept the same between the two breakpoints.
    // Then eased back out by a fifth (4.3/3.76 -> 5.16/4.51): the tight frame hid too much of the room.
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = w < 600 ? 4.51 : 5.16; viewSpan = span; viewAspect = aspect; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); post.resize(w, h); };
    window.addEventListener('resize', resize); resize();
    // The keep is raised two frames after the mount rather than inside it, so the hydrated menu gets a frame
    // on screen first: its button is live, and a press that lands while the build is still ahead of it
    // raises the loading bar instead of vanishing into a blocked thread. The hooks go up with the floor,
    // because every one of them reads it. A held press is answered one frame later still, once the floor
    // has actually been drawn, so the bar lifts onto the keep rather than onto an empty canvas.
    // A background tab runs no animation frames at all, and a keep that waited on them would sit unbuilt
    // until the tab came forward; a hidden page has nothing to paint first, so a timer stands in.
    let bootFrame = 0, bootTimer = 0;
    const scheduleBoot = () => {
      cancelAnimationFrame(bootFrame); clearTimeout(bootTimer);
      bootFrame = requestAnimationFrame(() => { bootFrame = requestAnimationFrame(boot); });
      if (document.hidden) bootTimer = window.setTimeout(boot, 200);
    };
    // Plan 014 round C: floor 1 is raised in the same stages as any other build (see `stagedBuild`),
    // behind the menu when nobody is waiting and behind the veil when a press beat it there. `booting`
    // keeps a press that reschedules the boot from starting a second one mid-way. The floor counts as
    // built - and the hooks go up, since every one of them reads it - as soon as it exists; it counts as
    // warmed once the shaders are linked and a frame of it has been presented, which is when the frame
    // loop starts drawing, the canvas fades in and a waiting press is answered.
    let booting = false;
    const boot = () => {
      if (stopped || built || booting) return;
      booting = true;
      void stagedBuild(1, bootSeed, () => buildFloor(1, bootSeed), () => {
        built = true;
        hooks.dungeonTest = testHooks; hooks.advanceTime = advanceTime; hooks.render_game_to_text = renderText;
      }).then((ok) => {
        booting = false; setVeilStage(0);
        if (!ok) return;
        warmed = true; setReady(true);
        if (!enterWhenBuilt) return;
        const seed = enterSeed; enterSeed = undefined;
        if (seed === undefined || seed === floor.seed) enter(); else restart(seed, enter);
      });
    };
    scheduleBoot();
    return () => { stopped = true; cancelAnimationFrame(raf); cancelAnimationFrame(bootFrame); clearTimeout(bootTimer); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointerleave', pointerGone); canvas.removeEventListener('contextmenu', noMenu); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('webglcontextrestored', contextRestored); audio.dispose(); cutaway.dispose(); atmosphere?.dispose(); texture.dispose(); telegraphTex.dispose(); laneTex.dispose(); alertTex.dispose(); alertMaterial.dispose(); environment.dispose(); impacts.dispose(); blood.dispose(); footsteps.dispose(); applyRef.current = null; delete hooks.advanceTime; delete hooks.render_game_to_text; delete hooks.dungeonTest; scene.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); post.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement); };
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
  const menuOpen = !displayFailed && (!started || (paused && !mapOpen));
  // Every time the card closes it reopens on the menu list, not on whichever page it was left at. Adjusted
  // during render rather than in an effect, so a reopened card never paints the stale page for a frame.
  const [menuWasOpen, setMenuWasOpen] = useState(menuOpen);
  if (menuWasOpen !== menuOpen) { setMenuWasOpen(menuOpen); setMenuView('main'); }
  const openView = (view: 'controls' | 'settings') => { returnTo.current = view; setMenuView(view); };
  const closeView = () => { setCapturing(null); setBindNote(''); setMenuView('main'); };
  // Focus goes back to the item that opened the page, so a keyboard player lands where they left. A stable
  // callback ref runs once, when the menu list mounts again, which is exactly the moment to do it.
  const returnFocus = useCallback((item: HTMLButtonElement | null) => { if (item && item.dataset.view === returnTo.current) { item.focus({ preventScroll: true }); returnTo.current = null; } }, []);
  // A display that was never granted has its own screen and nothing left to wait for. Nothing is waited on
  // before the menu: the keep builds behind it, and the bar goes up only for a press that beat the build,
  // or for a floor build the player has asked for since.
  const veil = displayFailed ? null : loading ?? (entering ? 'Waking the keep' : null);
  return (
    <main className={`game-shell${mapOpen ? ' map-expanded' : ''}${displayFailed ? ' no-display' : ''}${cardOpen ? ' card-open' : ''}${!started ? ' pre-start' : ''}${ready ? ' world-ready' : ''}`}>
      <div ref={mountRef} className="game-canvas" aria-label="Procedural isometric dungeon floor" />
      {/* Plan 014, lever 10: dark, out-of-focus mass in two corners, the way the reference frames its
          fight between foreground silhouettes rather than leaving the corners open floor. Decorative
          only - it never reaches the centre of the frame or the HUD, and it steps aside on a touch
          layout, where the same corners hold the real controls. */}
      <div className={`foreground-frame fg-${frameTheme}`} aria-hidden="true"><i className="fg-left" /><i className="fg-chain" /><i className="fg-ivy" /><i className="fg-column" /><i className="fg-banner" /><i className="fg-arch" /><i className="fg-reeds" /></div>
      <header className="game-title"><span className="sigil" aria-hidden="true" /><div className="title-text"><b>{floorLevel} / {FLOORS} · {roomName}</b><i>{roomName === goalName ? 'Take the stair down' : `Reach ${goalName}`}</i></div></header>
      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || paused || status !== 'playing' || boonChoice.length > 0} aria-label="Pause game">☰</button></nav>
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <section className="hud" aria-label="Player status"><div className="health-row"><span aria-hidden="true" /><b>{health}<small>/{maxHealth}</small></b><span className="rank-badge" aria-label={`Rank ${rank}`}>{rank}</span></div><div className="health-track" role="progressbar" aria-label="Vitality" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}><i style={{ width: `${Math.max(0, health / maxHealth * 100)}%` }} /></div>
        {/* The strike/dash icon row and its keycaps are gone: they read as a UI overlay on the painted
            scene. The dash meter stays, off-screen, so a driver reading the value tree still has it. */}
        <progress ref={dashMeter} max="1" value="1" className="visually-hidden" aria-hidden="true" tabIndex={-1} />
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        {ammo && <div className="quiver" role="progressbar" aria-label="Bolts in hand" aria-valuemin={0} aria-valuemax={ammo.of} aria-valuenow={ammo.held}>{Array.from({ length: ammo.of }, (_, i) => <i key={i} className={i < ammo.held ? 'held' : ''} />)}</div>}<progress className="xp-track" aria-label="Progress to the next boon" max={rankNeed} value={rankXp} /></section>
      {floorMap && <button className="floor-map" disabled={!started || status !== 'playing' || boonChoice.length > 0} onClick={() => action(mapOpen ? 'pause' : 'map')} aria-label={mapOpen ? 'Close floor map' : 'Open floor map'}><svg key={floorBuild} viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.width} ${mapBounds.height}`}><g transform={`rotate(${mapAngle*180/Math.PI})`}>
        {/* Plan 014 round 5 (lever C9): brighter, more saturated fills - the round-3 frame gave the
            panel real contrast against the world behind it, but the room shapes inside it were still
            close enough in value to the panel to read as a smudge rather than a map. */}
        <path d={floorMap.tiles.map(t => `M${t.x - 0.5},${t.z - 0.5}h1v1h-1z`).join('')} fill="#3f6572" />
        {floorMap.rooms.map(r => <path key={r.id} id={`map-room-${r.id}`} d={floorMap.tiles.filter(t=>t.room===r.id).map(t=>`M${t.x-.5},${t.z-.5}h1v1h-1z`).join('')} fill={r.id===0?'#6fd1c0':r.role==='goal'?'#d9a24f':'#5c9aa5'} />)}
        <circle className="map-mark" cx={floorMap.rooms[floorMap.goal].x} cy={floorMap.rooms[floorMap.goal].z} r="3.4" fill="none" stroke="#ffc573" strokeWidth="0.9" opacity="0.9" />
        <circle ref={mapPlayer} className="map-mark" cx={floorMap.rooms[0].x} cy={floorMap.rooms[0].z} r="1.8" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </g></svg></button>}
      {notice && started && !paused && status === 'playing' && boonChoice.length === 0 && <output className="chamber-notice"><b>{notice.split(' · ').pop()}</b></output>}
      {/* The one prompt allowed to sit in the world, and it is not persistent: it exists only while the knight
          is standing in a rack's ring, and it is the only thing that will take an arm out of his hand. It is a
          button as well as a line of text so a phone, which has no key to press, can answer it by tap — pointer
          focus is refused outright, or Space would activate this instead of swinging the moment it is touched. */}
      {swapOffer && started && !paused && status === 'playing' && boonChoice.length === 0 &&
        <button className="swap-prompt" onPointerDown={(e) => { e.preventDefault(); action('swap'); }} aria-label={`Press ${bindLabel(settings.binds.swap, ' or ')} to switch to the ${swapOffer.name}`}>
          <b><span className="swap-key">Press <kbd>{bindLabel(settings.binds.swap)}</kbd> to </span>switch to {swapOffer.name}</b><small>{swapOffer.detail}</small>
        </button>}
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      {menuOpen && <div className="intro-screen"><section className={`intro-card${menuView === 'main' ? '' : ' sub-view'}`} role="dialog" aria-modal="true" aria-labelledby="intro-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">{paused ? `FLOOR ${floorLevel} · ${roomName}` : 'THE DROWNED KEEP'}</span><h1 id="intro-title">{paused ? 'Paused' : <>Below<br /><em>the tide.</em></>}</h1>
        {menuView === 'main' ? <>
        {paused && <p>{advance} / {goalDepth} halls · {visitedCount} / {roomCount} explored · {plundered} / {deadEnds} plundered<br />Rank {rank} · {experience} XP · {rankXp} / {rankNeed} to next boon{xpReward > 0 ? ` · +${xpReward} XP` : ''}</p>}
        {!paused && best && <p className="best-run">Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</p>}
        {!paused && tally.runs > 0 && <p className="run-log">{tally.runs} {tally.runs === 1 ? 'descent' : 'descents'} logged · {tally.wins} escaped{tally.worstFalls > 0 ? ` · floor ${tally.worstFloor} has taken ${tally.worstFalls}` : ''}</p>}
        <nav className="menu-list" aria-label={paused ? 'Pause menu' : 'Main menu'}>
          <button className="primary-action" disabled={!hydrated} onClick={() => action(paused ? 'pause' : 'start')}>{paused ? 'RESUME' : 'ENTER THE KEEP'} <span>→</span></button>
          {paused && <button onClick={() => action('map')}>Floor map</button>}
          {!started && priorSeed !== null && <button disabled={!hydrated} onClick={() => action(`start:${priorSeed}`)}>Last keep</button>}
          <button data-view="controls" ref={returnFocus} className="opens" onClick={() => openView('controls')}>Controls &amp; journey<span aria-hidden="true">›</span></button>
          <button data-view="settings" ref={returnFocus} className="opens" onClick={() => openView('settings')}>Settings<span aria-hidden="true">›</span></button>
        </nav>
        <div className="menu-settings"><button onClick={() => action('mute')}>{settings.muted ? 'Sound off' : 'Sound on'}</button><button onClick={() => action('fullscreen')}>Fullscreen</button></div>
        </> : <div className="menu-panel">
        <button className="menu-back" ref={focusCard} onClick={closeView}><span aria-hidden="true">←</span> Back</button>
        <h2>{menuView === 'controls' ? 'Controls & journey' : 'Settings'}</h2>
        {/* Read off the bindings rather than written out, or this page would go on promising WASD to a player
            who rebound it ten seconds ago — which is the exact moment they would come here to check. */}
        {menuView === 'controls' ? <div className="menu-details"><div className="intro-controls"><span><kbd>{(['up', 'left', 'down', 'right'] as Action[]).map(a => bindLabel(settings.binds[a], '/')).join(' ')}</kbd> Move</span><span><kbd>{bindLabel(settings.binds.attack)}</kbd> Hold to strike</span><span><kbd>{bindLabel(settings.binds.dash)}</kbd> Dodge</span><span><kbd>{bindLabel(settings.binds.swap)}</kbd> Take the arm you stand over</span><span><kbd>{bindLabel(settings.binds.pause)}</kbd> Pause</span><span><kbd>{bindLabel(settings.binds.fullscreen)}</kbd> Fullscreen</span></div><div className="intro-controls"><span><kbd>Mouse</kbd> Point where to cut</span><span><kbd>Left</kbd> Strike, held to keep striking</span><span><kbd>Right</kbd> Dodge</span><span><kbd>Gamepad</kbd> Left stick moves, right stick aims, A strikes, B dodges</span></div><p className="control-note">A cursor over the keep aims every swing, so the knight can retreat and cut behind him. Striking from the keyboard or the pad hands the aim back, and those are helped onto whatever body is nearly in front of him. Only the keys above can be rebound.</p><p>Reach {goalName}. Defeat the stair wardens, then step onto the stair they guarded to descend. Cyan shrines heal once; amber circles flare before they burn. Dodge through them. Side chambers grant XP and vitality. An arm laid out on the floor is offered, never taken: stand in its ring and answer the prompt to trade for it.</p><p><span className="end-kicker">IN HAND · </span>{heldWeapon}</p>{taken.length > 0 && <p><span className="end-kicker">BOONS HELD · </span>{taken.join(' · ')}</p>}</div> : <div className="menu-details settings-panel">
          {/* Everything here persists, and everything here has a default that is the game exactly as it
              shipped, so a player who never opens this changes nothing by not opening it. */}
          <div className="setting-row"><label htmlFor="set-volume">Volume</label><input id="set-volume" type="range" min="0" max="100" step="5" value={Math.round(settings.volume * 100)} onChange={(e) => change({ volume: Number(e.target.value) / 100 })} /><small>{settings.muted ? 'muted' : `${Math.round(settings.volume * 100)}%`}</small></div>
          <div className="setting-row"><label htmlFor="set-motion">Motion</label><select id="set-motion" value={settings.reducedMotion === null ? 'system' : settings.reducedMotion ? 'reduce' : 'full'} onChange={(e) => change({ reducedMotion: e.target.value === 'system' ? null : e.target.value === 'reduce' })}><option value="system">System · {osReduce ? 'reduced' : 'full'}</option><option value="reduce">Reduced</option><option value="full">Full</option></select><small>{reduceMotion ? 'no camera shake; the hurt tint holds still' : 'camera shake and a hurt flash'}</small></div>
          <div className="setting-row"><label htmlFor="set-touch">Touch</label><select id="set-touch" value={settings.touchLayout} onChange={(e) => change({ touchLayout: e.target.value === 'pad' ? 'pad' : 'stick' })}><option value="stick">Thumbstick</option><option value="pad">Direction buttons</option></select><small>buttons are labelled; the stick is not</small></div>
          {/* Ten buttons is the bulk of this card, so they fold away behind their own summary — volume,
              motion and touch stay the short default view, and rebinding is one more tap away rather than
              a scroll past it. */}
          <details className="menu-details"><summary>Key bindings</summary>
            <div className="key-binds">{ACTIONS.map(a => <button key={a} className={capturing === a ? 'capturing' : ''} aria-label={`${ACTION_LABELS[a]}: ${bindLabel(settings.binds[a], ' or ')}. Activate to rebind.`} onClick={() => { setBindNote(''); setCapturing(capturing === a ? null : a); }}><span>{ACTION_LABELS[a]}</span><kbd>{capturing === a ? 'press a key' : bindLabel(settings.binds[a])}</kbd></button>)}</div>
            <output className="bind-note">{bindNote || (capturing ? 'Press any key. Escape cancels.' : 'Escape always opens this menu, so it cannot be rebound.')}</output>
            <button className="reset-binds" onClick={() => { setCapturing(null); setBindNote(''); change({ binds: defaultSettings().binds }); }}>Reset keys</button>
          </details>
        </div>}
        </div>}
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
      {/* Not in the prerendered page: the menu is, and nothing stands between a visitor and it. The veil
          belongs to the moments that make the player wait on a floor built from nothing — ENTER THE KEEP
          pressed before the first one is ready, a descent, and a fresh run — and to nothing else. */}
      {veil && <output className={plainVeil ? 'loading-veil veil-plain' : 'loading-veil'}>
        {/* Plan 014 round C: drifting fog, a vignette, the brass sigil with its ember, the line and the
            floor it is raising, a staged bar and one rotating line of keep-lore. Everything that moves
            here moves by transform or opacity only, so it keeps moving while a stage blocks the thread.
            The fog is the one part with a real per-frame cost, so a software rasteriser goes without it. */}
        {!plainVeil && <span className="veil-fog" aria-hidden="true"><i /><i /><i /></span>}
        <span className="veil-emblem" aria-hidden="true"><i className="veil-ring" /><i className="veil-diamond" /><i className="veil-glow" /><i className="veil-flame" /><i className="veil-flame veil-flame-core" /></span>
        <b>{veil}</b>
        <em className="veil-sub">Floor {veilFloor} of {FLOORS}{veilPlace ? ` · toward ${veilPlace}` : ''}</em>
        <span className="veil-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(.04, veilStage / VEIL_STAGES.length)})` }} /></span>
        <span className="veil-stage">{VEIL_STAGES[Math.min(veilStage, VEIL_STAGES.length - 1)]}<small>{Math.min(veilStage + 1, VEIL_STAGES.length)} / {VEIL_STAGES.length}</small></span>
        <span className="veil-lore" aria-hidden="true">{VEIL_LORE.map((line) => <i key={line}>{line}</i>)}</span>
      </output>}
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
