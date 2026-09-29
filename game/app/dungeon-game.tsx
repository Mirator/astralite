'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { alertTexture, laneTelegraphTexture, telegraphTexture, vaultEnvironment } from './dungeon-art';
import { planPavingPatches } from './dungeon-paving-layout';
import { makeKnight } from './dungeon-knight';
import { impactEffects } from './dungeon-impact';
import { footstepEffects } from './dungeon-footsteps';
import { footfalls, footSupport, type FootstepKind } from './dungeon-footstep-rules';
import { startDeath } from './dungeon-death';
import { stoneTexture, type LightAnchor } from './dungeon-atmosphere';
import { flameShaderKeeper } from './dungeon-flame-fx';
import { createPostChain, postQuality } from './dungeon-post';
import { bloodDecals } from './dungeon-blood';
import { getFlagstoneTexturesSteps, getMasonryTexturesSteps } from './dungeon-textures';
import { createDungeonAudio } from './dungeon-audio';
import { createCutawayController, CUTAWAY_ENEMY_RANGE, type CutawayEnemyCandidate } from './dungeon-occlusion';
import { animateCloth } from './dungeon-motion';
import { canStand, generateFloor, hasClearPath, moveOnFloor, cellKey, TILE, type Door } from './dungeon-floor';
import { arenaFloor, parseArena, type Arena } from './dungeon-arena';
import ArenaPanel, { type ArenaChoice } from './dungeon-arena-panel';
import { CAMERA_OFFSET, groundAim, SNAP_REACH, snapAim } from './dungeon-aim';
import { DASH_BUFFER, dashImmune, dragToward, hurledBlow, lineContacts, specialAvailable, specialGate, specialMayCut, specialSpends, swordContacts, vaultLanding, vaultTarget } from './dungeon-combat';
import { ALERT_STAGGER, BESTIARY, decideEnemy, fallOf, nearbyDozers, raiseSpot, separateCrowd, type Wakeable } from './dungeon-enemy';
import { awayFrom, burn as burnBody, landBlow } from './dungeon-hits';
import { chargePose } from './dungeon-attack-pose';
import { chainLength, chargeLevel, chargeReleases, devStartingArm, drawDamage, drawn, lungeStep, specialSwing, STARTING_WEAPON, TIDEBLADE, vaultHeight, vaultLanded, vaultStep, weaponById, type Special, type WeaponId } from './dungeon-weapon';
import { disposeWeapon, disposeWeaponDrop, makeBolt, makeFlask, makePoolMesh, makeWeapon, makeWeaponDrop, type ArmedWeapon, type ArmoryPalette, type Plate } from './dungeon-armory';
import { deathPool, flashpointHits, flyHostile, flyShot, homeStep, hostileBolt, laneLength, poolCatches, poolStep, reloadStep, type Mark, type Pool, type Shot } from './dungeon-projectile';
import { borrowedLight, litDisc, type Radiance } from './dungeon-radiance';
import { playerRunPose, strideRate } from './dungeon-run-pose';
import { weaponTrail } from './dungeon-weapon-trail';
import { createSparks } from './dungeon-sparks';
import { nearestFirst } from './dungeon-nearest';
import { serialiseRunExport } from './dungeon-run-export';
import { summariseRunEnd } from './dungeon-run-summary';
import { ACTIONS, appendRun, betterRun, bindKey, defaultSettings, readBest, readRuns, readSeed, readSettings, RESERVED, summariseRuns, writeBest, writeRuns, writeSeed, writeSettings, type Action, type BestRun, type RunCause, type RunEnd, type Settings } from './dungeon-save';
import { chamberReward, createRun, DOOR_RADIUS, draftBoons, grantXp, heal, hurt, PICKUP_RADIUS, rankCost, resetSpecial, resolveKill, specialReady, spendSpecial, STAIR_RADIUS, takeBoon, tickRun, XP_PER_ENEMY, type Boon, type Reward } from './dungeon-sim';
import { ACTION_LABELS, bindLabel, isHeld, keycapFor, keyLabel, moveHeading, PAD_BUTTONS, PAD_START, PAD_VIEW, padAxis, padLook as readPadLook, parseCommand, pointerNdc as toNdc, readKey, type Stick } from './dungeon-input';
import { armWith, bufferedDashReady, bufferSwing, canSwing, createPlayerControl, dashStep, dropBuffers, faceStart, frameDelta, frameStep, haltControl, normalise, resetControl, startDash, startSwing, steer, swingPose, swingReady, swingStep, tickBuffers, travelHeading, travelSpeed } from './dungeon-player';
import { dropMarks, hideMarks, makeArrow, markEnemy, poseEnemy, type Enemy, type EnemyKind } from './dungeon-enemy-view';
import { createFloorStage, doorSign, raiseFloor, type DoorSign, type FloorArt } from './dungeon-floor-scene';
import { createMood } from './dungeon-mood';
import { driveSliced as driveSlicedSteps, linkedPrograms, pollProgramsReady as pollPrograms, precompilePost } from './dungeon-warmup';
// What the veil says is happening, one label per stage of `stagedBuild`, and how far its bar has run.
import { creep, programsShare, SHADER_POST, SHADER_SCENE, VEIL_STAGES, veilProgress } from './dungeon-veil';
import { applyCombatFixture } from './dungeon-fixture';
import { actorStat, countDisposals, drainGpu, lightDiagnostics, pointLightCount, textureHash, type GameToolContext, type HookedWindow, type TestHooks } from './dungeon-test-hooks';

const FLOORS = 3;
/** Short in-world lines, crossfaded one at a time under the bar (CSS only). */
// What the prompt at the foot of the screen says a door leads to (plan 017).
const DOOR_WORDS: Record<DoorSign, string> = { arm: 'an arm on a rack', mend: 'a mending', cache: 'a purse of experience', rest: 'a quiet shrine', stair: 'the stair down', fight: 'a fight' };
// Each half of the fade a door is taken behind: dark by the first, lit again by the second.
const CROSS_TIME = .15;
// Where a chamber sits on the pause-menu map: its layer across, its place in the layer down.
const mapNode = (floor: ReturnType<typeof generateFloor>, id: number) => {
  const room = floor.rooms[id], layer = floor.rooms.filter(r => r.layer === room.layer), at = layer.indexOf(room);
  return { x: room.layer * 12, y: (at - (layer.length - 1) / 2) * 11 };
};
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
// One funnel for every settings change: React state for the card, storage for the next visit, and the ref
// the render loop reads, all in the same breath, so a second change in the same tick builds on the first
// rather than on a render that has not happened yet. Built from a ref and a setState — both stable for the
// life of the mount — so the world's one long-lived closure can hold its own copy and never go stale.
const changeSettings = (ref: { current: Settings }, set: (next: Settings) => void) => (patch: Partial<Settings>) => {
  const next = { ...ref.current, ...patch };
  ref.current = next; writeSettings(next); set(next);
};
// Hydration never changes back, so there is nothing to subscribe to.
const noSubscription = () => () => {};
// What an arm set down on a rack still owes when it is taken back: its special's seconds of cooldown, and its
// bolts in hand with the clock on the next one. Frozen while it lies there, like the arm itself.
type Kept = { cooldown: number; quiver: number; reload: number };

// three.js throws outright when the browser will not hand out a context at all — no GPU, WebGL off by
// policy or setting, a browser too old. That is not the same as losing a context mid-run, which three.js
// gets back by itself: nothing is coming back here, so the throw is caught and answered with a screen.
const makeRenderer = () => { try { return new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); } catch { return null; } };

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
  // Plan 016: the held arm's special, or null for an arm that has none (its HUD slot and touch button sit
  // empty), and whether the cursor owns the aim, which is what decides the keycaps' device.
  const [specialArm, setSpecialArm] = useState<{ name: string; detail: string } | null>(TIDEBLADE.special ? { name: TIDEBLADE.special.name, detail: TIDEBLADE.special.detail } : null), [pointerAim, setPointerAim] = useState(false);
  // What the swap key would do where the knight stands - take the arm he is over, or the open stair - or
  // null when it would do nothing. It is the whole of the prompt's state: the key it names is read off
  // the bindings at render, so a rebind is live at once.
  const [swapOffer, setSwapOffer] = useState<{ act: string; detail: string } | null>(null);
  // Only on screen while a ranged arm is held, so the minimal HUD stays minimal for every other weapon.
  const [ammo, setAmmo] = useState<{ held: number; of: number } | null>(null);
  const [floorMap, setFloorMap] = useState<ReturnType<typeof generateFloor> | null>(null);
  const [visitedCount, setVisitedCount] = useState(1);
  const mapPlayer = useRef<SVGCircleElement>(null);
  const crossFade = useRef<HTMLDivElement>(null);
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
  const [roomName, setRoomName] = useState('The Tide Gate');
  const [advance, setAdvance] = useState(0);
  const [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  // What the keep is busy doing while the player waits on it, or null when it is not busy. Only ever set
  // for work that blocks the main thread long enough to be felt — which in this game is a floor build.
  const [loading, setLoading] = useState<string | null>(null);
  // Plan 014 round C: what the veil reports while a keep is raised - the number of stages finished (of
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
  const [menuView, setMenuView] = useState<'main' | 'controls' | 'settings' | 'arena'>('main');
  // The arena page's counts and floor (development only), kept here so they survive leaving the page.
  const [arenaChoice, setArenaChoice] = useState<ArenaChoice>({ pick: { guard: 1 }, level: 1 });
  // The arena the world closure is charting floors as, mirrored for the card that names it and for the
  // best-run record, which an arena run must not touch.
  const [arenaOn, setArenaOn] = useState<Arena | null>(null);
  const returnTo = useRef<string | null>(null);
  const dashMeter = useRef<HTMLProgressElement>(null);
  // Plan 014 round 5 (lever C8): the dash icon's own radial sweep, driven the same imperative way the
  // old `<progress>` was - one DOM write a frame from the render loop, no React state and no re-render
  // for something that changes sixty times a second.
  const dashSweep = useRef<HTMLDivElement>(null);
  // The veil's bar fill, written the same way: `showVeil` moves it as texture bands finish and shader
  // programs link, which during a cold load is every frame for seconds.
  const veilFill = useRef<HTMLElement>(null);
  // Plan 016 decision 4: the special's own sweep, the dash icon's language in the same row.
  const specialSweep = useRef<HTMLDivElement>(null);
  const [displayLost, setDisplayLost] = useState(false), [floorBuild, setFloorBuild] = useState(0);
  // Deliberately not the same flag as displayLost: that is a context taken away mid-descent and handed
  // back, this is one never granted, so there is no run to pause and nothing that could restore it.
  const [displayFailed, setDisplayFailed] = useState(false);
  // The world stopped on a throw it could not answer (see `fail` in the world closure). Its own screen,
  // like `displayFailed`: there is no run left to pause and nothing but a reload brings one back.
  const [fault, setFault] = useState(false);
  const [best, setBest] = useState<BestRun | null>(null);
  const [runSeed, setRunSeed] = useState<number | null>(null), [priorSeed, setPriorSeed] = useState<number | null>(null);
  // Not derived from `best`: the record is one run, this is the distribution every balance argument in
  // progress.md currently rests on somebody's memory of.
  const [runLog, setRunLog] = useState<RunEnd[]>([]);
  // "Copy run log": the note under the button, and the JSON itself when the clipboard refused it, shown in a read-only box so it can be copied by hand. Nothing leaves the page but through the player's own paste.
  const [exportNote, setExportNote] = useState(''), [exportText, setExportText] = useState('');
  const copyRuns = () => { const runs = readRuns(); if (!runs.length) { setExportText(''); setExportNote('No runs recorded yet'); return; } const text = serialiseRunExport(runs, new Date()); const count = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`; const fallback = () => { setExportText(text); setExportNote(`Copy the ${count} below`); }; if (!navigator.clipboard?.writeText) { fallback(); return; } navigator.clipboard.writeText(text).then(() => { setExportText(''); setExportNote(`Copied ${count}`); }, fallback); };
  const [ended, setEnded] = useState<RunEnd | null>(null);

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
  // One way a captured code becomes a binding, whether it came from a key or (plan 016) a mouse button on the
  // capture surface below the list.
  const commitBind = useCallback((action: Action, code: string) => {
    setCapturing(null);
    if (code === RESERVED) { setBindNote('Escape always opens this menu, so it stays on Pause.'); return; }
    const held = ACTIONS.find(a => a !== action && settingsRef.current.binds[a].includes(code));
    const binds = bindKey(settingsRef.current.binds, action, code);
    if (!binds) { setBindNote(keyLabel(code) ? `${keyLabel(code)} cannot be bound.` : 'That key cannot be bound.'); return; }
    change({ binds });
    // Say what the key cost, because the action it was taken from is somewhere else on the card and the
    // player would otherwise find out mid-fight.
    setBindNote(held ? `${keyLabel(code)} taken from ${ACTION_LABELS[held]} — now ${bindLabel(binds[held])}.` : '');
  }, [change]);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      // A focused button activates on the key's *release*, which would drop straight back into capture; the
      // matching keyup is swallowed once so binding Space or Enter behaves like binding anything else.
      window.addEventListener('keyup', (up: KeyboardEvent) => { up.preventDefault(); up.stopImmediatePropagation(); }, { capture: true, once: true });
      commitBind(capturing, e.code);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, commitBind]);

  // Persisting a finished run is a write to an external system, so it belongs in an effect. Both endings
  // settle every HUD value before `status` flips, which makes this the one honest place to read the run.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return;
    // An arena is a chosen fight, not a descent: it sets no record.
    if (arenaOn) return;
    const record = (run: BestRun) => { setBest(run); writeBest(run); };
    const next = betterRun(best, { floor: floorLevel, xp: experience, kills: defeated, won: status === 'won' });
    if (next && next !== best) record(next);
  }, [status, floorLevel, experience, defeated, best, arenaOn]);

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
    let stopped = false, hurtFlash = 0, shake = 0;
    // Plan 015 Stage B: `animate` draws only when this is true, then clears it. Set wherever the picture
    // can actually change while the frame loop is the one deciding whether to draw - which the paused/
    // drafting/complete return inside `update` is not, since nothing past it ever runs. Starts true so
    // the first frame after the keep is warm still paints.
    let dirty = true;
    // What the knight is holding, the swing and the string it belongs to, the dash, both input buffers and
    // hit-stop. Every number the swing used to hardcode comes off the arm in `pc.weapon`, and every rule that
    // moves these clocks is in dungeon-player.ts, where it runs without a browser; what stays here is when
    // each rule is asked, and what the knight looks and sounds like when it answers.
    const pc = createPlayerControl();
    let walkPhase = 0, gaitSpeed = 0, elapsed = 0, manualTime = false;
    // Plan 016: which verb the live swing is lives on `pc.swingKind`, because a special runs on the strike's
    // own clock. `charging` is seconds a charged special has been held, null when none is; `specialBuffer`
    // is a press that waits out a live blade the way a buffered dodge does.
    let specialBuffer = 0, charging: number | null = null, specialWasReady = true, glintTime = 0;
    const lungeFrom = new THREE.Vector3(), glintAt = new THREE.Vector3();
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
    applyRef.current = (next, reduce) => { easeMotion = reduce; audio.volume(next.volume); audio.mute(next.muted); isMuted = next.muted; dirty = true; };
    // And called once for whatever is already stored. The effect that pushes later changes may well have
    // run before this one mounted, in which case it found no `applyRef` and did nothing; without this the
    // world would sit on the defaults until the player happened to change something else.
    applyRef.current(settingsRef.current, settingsRef.current.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Plan 007: one controller for the life of the mount. Only its registration table and target
    // slots are floor-scoped — `clearFloor` releases them before a floor's own materials are disposed.
    const cutaway = createCutawayController();
    // Floor-scoped state: everything here is torn down and rebuilt when the knight takes the stair down.
    let floor!: ReturnType<typeof generateFloor>;
    // What a floor build leaves for the world to drive - the enemies, the hazards and shrines, the stair's
    // parts, the flood, the atmosphere pass and the walking-surface index - written by `raiseFloor`
    // (dungeon-floor-scene.ts) and replaced field by field by the next build.
    const stage = createFloorStage();
    let visited = new Set<number>([0]), cleared = new Set<number>([0]), spineRooms = new Set<number>();
    let reached = 0, level = 1;
    let floorStart = 0, floorKills = 0, floorXp = 0;
    // Run-scoped, not floor-scoped: these three outlive a descent and are reset only by `restart`, which
    // is what makes the logged duration, boon list and replay seed describe the whole run and not its
    // last floor. `runStart` is the moment the keep was entered, not the moment the page mounted.
    let runStart = 0, firstSeed = 0, boonsTaken: string[] = [];
    // The way down sits at the heart of the warden hall: sealed until the last warden falls, then open, and
    // taken only when the knight stands on it and answers with the swap key, the same as a rack.
    let stairOpen = false, onStair = false, stairLit = 0;

    let floorGroup = new THREE.Group();
    // Building a floor is the only place this game can stutter, so each phase is timed and reported.
    let buildMs: Record<string, number> = {};
    // Plan 015 Stage C: what the last staged build's warm-up cost (see `stagedBuild`) - programs linked at
    // each step, and the longest single slice of each kind of work, for the probe to report.
    let warmUp = { precompiled: 0, firstFrame: 0, firstFrameSliceMs: 0, secondFrame: 0, sceneCompileMs: 0, postCompileMs: 0, pollSliceMs: 0, buildSliceMs: 0 };
    const goalRoom = () => floor.rooms[floor.goal];
    const swingHits = new Set<Enemy>();
    let gameStatus: 'playing' | 'complete' | 'won' | 'lost' = 'playing';
    const stairClear = () => stage.enemies.every(e => e.room !== floor.goal || e.dead);
    // The last warden's fall unseals the stair; the knight still has to take it, and nothing ends until he does.
    const openStair = () => {
      if (stairOpen) return;
      stairOpen = true; onStair = false; stairLit = 0;
      if (stage.stairSeal) stage.stairSeal.visible = false;
      if (stage.stairRing) stage.stairRing.visible = true;
      if (stage.stairGlow) stage.stairGlow.visible = true;
      burst(stage.stairSpot, 0xfbc956, 24);
      setNotice('The stair opens'); noticeTime = 4;
    };
    const offerBoon = () => {
      // A charge the draft interrupts is let go at no cost, never slammed on the frame the card closes.
      run.choosing = true; keys.clear(); cancelCharge(); specialBuffer = 0;
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
    // A body going down, however it was brought there: its fall starts, its marks go, and the kill pays -
    // unless it is one a bonecaller raised and the caller still stands, which goes back into the ground
    // whole instead, unpaid (dungeon-enemy's `fallOf`).
    const fell = (enemy: Enemy) => {
      const fall = fallOf(stage.enemies, stage.enemies.indexOf(enemy));
      if (fall.reassembles) { rebury(enemy, stage.enemies[enemy.summoner]); return; }
      enemy.dead = true; enemy.death = startDeath(enemy.group, enemy.kind); dropMarks(enemy);
      award(resolveKill(run)); burst(enemy.group.position, 0xd9d1bd, 12); setDefeated(run.kills);
      // A pyre leaves its fire where it fell (dungeon-projectile's `deathPool`), which bites the knight.
      const fire = deathPool(enemy.kind, enemy.group.position), ring = fire ? hostilePoolMeshes.find(mesh => !mesh.visible) : undefined;
      if (fire && ring) { ring.visible = true; ring.position.set(fire.x, .07, fire.z); ring.scale.setScalar(fire.radius); hostilePools.push({ pool: fire, mesh: ring, kind: enemy.kind }); burst(enemy.group.position, 0xff8c38, 18); }
      // Everything a summoner called crumbles with it, standing or still buried, and none of it pays.
      for (const at of fall.crumble) {
        const body = stage.enemies[at];
        body.dead = true;
        if (!body.buried) { body.death = startDeath(body.group, body.kind); dropMarks(body); burst(body.group.position, 0xd9d1bd, 10); }
      }
    };
    // A raised body cut down while its caller stands: a puff of bone dust, and it is back in the reserve
    // under the caller, whole and asleep, for a later tell to raise again.
    const rebury = (body: Enemy, caller: Enemy) => {
      burst(body.group.position, 0xd9d1bd, 12); dropMarks(body);
      body.buried = true; body.awake = false; body.group.visible = false; body.hp = body.maxHp;
      body.windup = 0; body.lunge = 0; body.hitFlash = 0; body.notice = 0; body.attackAge = Infinity;
      body.group.position.set(caller.group.position.x, .03, caller.group.position.z);
    };
    // The heading a body looks along, off the yaw its pose last set (`face` is atan2(-x, -z) of it).
    const facingOf = (enemy: Enemy) => ({ x: -Math.sin(enemy.group.rotation.y), z: -Math.cos(enemy.group.rotation.y) });
    // A bonecaller's tell ran out: the next `perTell` of its buried reserve stand up side by side, a pace
    // toward the knight, awake.
    const raise = (caller: Enemy, index: number) => {
      const reserve = stage.enemies.filter(e => e.buried && !e.dead && e.summoner === index).slice(0, BESTIARY[caller.kind].summons?.perTell ?? 0);
      reserve.forEach((body, slot) => {
        const at = raiseSpot(floor.cells, caller.group.position, player.position, slot);
        body.buried = false; body.awake = true; body.group.visible = true; body.room = caller.room;
        body.group.position.set(at.x, .03, at.z); body.anchor = { x: at.x, z: at.z }; body.cooldown = Math.max(body.cooldown, .6);
        burst(body.group.position, 0xb9a4ff, 14);
      });
    };
    // The last body in a chamber has fallen, whatever brought it down: it pays what its door promised, its
    // ways out open, it is announced and marked on the map, and the stair opens under the last warden.
    // Steel, bolts and fire all come through here, so no weapon can clear a chamber the doors disagree about.
    const settleRoom = (id: number) => {
      if (!cleared.has(id) && stage.enemies.every(e => e.room !== id || e.dead)) {
        cleared.add(id);
        const room = floor.rooms[id], ways = stage.doors.filter(view => view.door.from === id);
        award(chamberReward(run, room.reward));
        setNotice(`${room.name} · ${ways.length ? 'the way on opens' : 'cleansed'}`);
        noticeTime = 3.5; rewardTime = 1.4; audio.play('clear'); burst(player.position,0x71f4c4,18);
        for (const view of ways) burst(view.spot, view.color, 14);
        document.getElementById(`map-room-${id}`)?.setAttribute('fill', '#a8d5b0');
      }
      if (id === floor.goal && stairClear()) openStair();
    };
    const chooseBoon = (id: string) => {
      const boon = takeBoon(run, id);
      if (!boon) return;
      setMaxHealth(run.maxHp); setHealth(run.hp); setBoonChoice([]);
      setTaken((list) => [...list, boon.name]);
      setNotice(`${boon.name} taken`); noticeTime = 3;
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
      slash.clear();stage.enemies.forEach(enemy=>enemy.trails.forEach(trail=>trail.effect.clear()));footsteps.clear();
      // Re-read instead of holding a snapshot: a second tab may have logged its own runs since this one
      // began, and the log is cheap enough to reread once per run that guessing is not worth it.
      const end: RunEnd = { at: Date.now(), floor: level, won: !cause, cause, seconds: Math.max(0, Math.round(elapsed - runStart)), rank: run.rankLevel, xp: run.totalXp, kills: run.kills, boons: [...boonsTaken], seed: firstSeed };
      setEnded(end);
      if (arena) return;
      const log = appendRun(readRuns(), end);
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
    const lampAt = new THREE.Vector3();
    // Scratch for the frame's own arithmetic, so a frame allocates nothing it throws away: the fill
    // light's hang, the camera's lead, the shake, a blow's shove, and the lamps nearest the knight.
    const FILL_OFFSET = new THREE.Vector3(1.4,3.2,2.2), focusAhead = new THREE.Vector3(), shakeBy = new THREE.Vector3();
    const nearTorches: THREE.Vector3[] = [], nearAnchors: LightAnchor[] = [];
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
    // The chamber the knight is standing in decides the key, the bounce, the fog and the fire; see
    // dungeon-mood.ts for why, and for the slide across a threshold.
    const mood = createMood({ scene, moon, hemisphere, torches: torchLights, emberHome: ember.home });
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
    const velocity = new THREE.Vector3();

    player.rotation.y = Math.atan2(-pc.facing.x, -pc.facing.z);
    // Every spark in the keep, in one pooled instanced draw (dungeon-sparks.ts).
    const sparks = createSparks(); world.add(sparks.mesh);
    const burst = (at: THREE.Vector3, color = 0xffb24a, amount = 12) => sparks.burst(at, color, amount);
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
    // `kept` is what an arm the knight set down there still owed: its special's cooldown and its quiver.
    let drop: {group:THREE.Group; ring:THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; blade:ArmedWeapon; kind:WeaponId; x:number; z:number; kept?:Kept} | null = null;
    // Whether the knight is inside the rack's ring this frame, and what the prompt was last told. The
    // second exists only so the offer is pushed into React on the step he arrives and the step he leaves,
    // rather than sixty times a second for as long as he stands there.
    let overDrop = false, offered: WeaponId | 'stair' | `door:${number}` | null = null, ringLit = 0;
    // Plan 017: the door the knight is standing at, and the fade he is crossing to the next chamber behind.
    let overDoor: Door | null = null, crossing: { door: Door; time: number; flipped: boolean } | null = null;
    // Put a different arm in the knight's hand. The old geometry is released; the materials are his own
    // and outlive every swap, so nothing but the meshes is rebuilt.
    const equip = (id: WeaponId, kept?: Kept) => {
      const {palette, plate} = player.userData.armoury as {palette: ArmoryPalette; plate: Plate};
      disposeWeapon(armed, palette);
      const next = weaponById(id);
      armed = makeWeapon(id, palette, plate);
      (player.userData.sword as THREE.Group).add(armed.group);
      player.userData.armed = armed;
      bladeInner=armed.inner.clone();bladeTip=armed.tip.clone();
      // A swap mid-swing drops the swing and its string (see `armWith`), and would otherwise leave the old
      // blade's ribbon hanging in the air. So does a special, a charge, and a thrown spear (it goes down on the
      // rack with the arm). The cooldown is the arm's own: one found on a floor arrives ready, one taken back
      // off the rack brings back what it had left (`kept`), so swap, swap back is no way round a cooldown.
      armWith(pc, next); endSpecial(); resetSpecial(run, kept?.cooldown); swingHits.clear(); slash.clear(); posePlayer(0);
      // A weapon found arrives loaded, one taken back as empty as it was left; bolts already in the air stay in it.
      fillQuiver(kept);
      setSpecialArm(pc.weapon.special ? { name: pc.weapon.special.name, detail: pc.weapon.special.detail } : null);
    };
    // What the arm in hand still owes, for the rack it is about to be set down on.
    const keep = (): Kept => ({ cooldown: run.specialCooldown, quiver, reload });
    const fillQuiver = (kept?: Kept) => {
      quiver = pc.weapon.ranged ? kept ? Math.min(kept.quiver, pc.weapon.ranged.capacity) : pc.weapon.ranged.capacity : 0; reload = kept?.reload ?? 0;
      setAmmo(pc.weapon.ranged ? { held: quiver, of: pc.weapon.ranged.capacity } : null);
    };
    // Bolts in hand, and the clock the next one comes back on. A ranged arm is limited by a quiver
    // rather than by a cooldown: the knight walks at 8.5 against a stalker's 3.2, so a shot that merely
    // recovered on a timer would let him back away and win the keep without ever being reachable.
    let quiver = 0, reload = 0;
    // `harpoon` marks the Salt Spear itself on its way out (plan 016): same flight rule, its own hit rule.
    // `special` is the special that loosed it, so a swap while it flies cannot hand it the new arm's numbers.
    const shots: { shot: Shot; mesh: THREE.Group; harpoon?: boolean; heavy?: boolean; special?: Special }[] = [];
    // Fired shots come out of a pool. The suite asserts a floor allocates no new GPU memory once built.
    const boltPool = Array.from({ length: 8 }, () => { const bolt = makeBolt((player.userData.armoury as {palette: ArmoryPalette}).palette); world.add(bolt); return bolt; });
    const flaskPool = Array.from({ length: 6 }, () => { const flask = makeFlask((player.userData.armoury as {palette: ArmoryPalette}).palette); world.add(flask); return flask; });
    // Burning silt the knight left behind, and the rings that show it. Pooled like everything else.
    const pools: { pool: Pool; mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> }[] = [];
    const poolMeshes = Array.from({ length: 6 }, () => { const mesh = makePoolMesh(); world.add(mesh); return mesh; });
    // Bolts loosed at the knight, and the pool they come out of. Their own list, because they resolve
    // against him rather than against the bodies, and they never pierce.
    const hostile: { shot: Shot; mesh: THREE.Group; kind: EnemyKind }[] = [];
    const arrowPool = Array.from({ length: 12 }, () => { const arrow = makeArrow(); world.add(arrow); return arrow; });
    // Fire a pyre left where it fell, burning the knight rather than the bodies. Pooled like every other effect.
    const hostilePools: { pool: Pool; mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; kind: EnemyKind }[] = [];
    const hostilePoolMeshes = Array.from({ length: 6 }, () => { const mesh = makePoolMesh(); world.add(mesh); return mesh; });
    // Plan 016: the Tolling Slam's ring on the floor while the maul is wound; the slam itself is impacts.slam.
    // An outline at the reach over a faint wash rather than the flask's solid ring: it has to say "this far"
    // under the knight for a second at a time without the paving disappearing under it. Made once at mount.
    const chargeRing = new THREE.Mesh(new THREE.RingGeometry(0, 1, 48), new THREE.MeshBasicMaterial({ color: 0xf2c47b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    const chargeGlow = litDisc(chargeRing.material, 'slam-charge-v1', .35); chargeGlow.edge.value = .95; chargeGlow.width.value = .05; chargeGlow.pool.value = .22;
    chargeRing.rotation.x = -Math.PI / 2; chargeRing.visible = false; world.add(chargeRing);
    // The Salt Spear while it is out of the hand: flying out (a live entry in `shots`) or coming back.
    let harpoon: { mesh: THREE.Group; phase: 'out' | 'back'; x: number; z: number; speed: number; dragged: boolean } | null = null;
    // Stage C. The Vault in progress: the body it goes over (or none), how long its path is and which way it
    // runs (measured off the floor at takeoff), and whether the backstab has been scored.
    let vault: { target: Enemy | null; distance: number; dir: THREE.Vector3; landed: boolean } | null = null;
    // The Heavy Bolt's line on the floor: faint while it is drawn, bright on the frame it goes. One mesh on the
    // dash streak's own geometry, made once at mount; `laneLife` is the bright line's wall-clock fade.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(.11, 1.15), new THREE.MeshBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    lane.rotation.x = -Math.PI / 2; lane.visible = false; world.add(lane);
    let laneLife = 0;
    const layLane = (length: number, width: number, opacity: number) => {
      lane.visible = true; lane.material.opacity = opacity;
      lane.position.set(player.position.x + pc.facing.x * length / 2, .08, player.position.z + pc.facing.z * length / 2);
      lane.rotation.z = Math.atan2(-pc.facing.z, pc.facing.x) + Math.PI / 2; lane.scale.set(width / .11, Math.max(.05, length) / 1.15, 1);
    };
    // The Flashpoint's pools going up: the fire goes out and in its place a bright band runs out to the pool's
    // rim over a light wash, added onto the floor rather than laid over it, then gone. It was the pool's own
    // ring flared opaque cream, a flat disc that hid the paving; this is the Tolling Slam charge's ring language
    // (the same lit-disc program, so no new shader), one pooled mesh per pool as before, made once at mount.
    const flareDisc = new THREE.RingGeometry(0, 1, 48);
    const flarePool = Array.from({ length: 6 }, () => {
      const mesh = new THREE.Mesh(flareDisc, new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      const glow = litDisc(mesh.material, 'slam-charge-v1', .35); glow.width.value = .06;
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false; world.add(mesh);
      return { mesh, glow };
    });
    const flares: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; glow: Radiance; age: number; radius: number }[] = [];
    const FLARE_LIFE = .3;
    const clearFlares = () => { for (const flare of flares) flare.mesh.visible = false; flares.length = 0; };
    const catchHarpoon = () => {
      if (!harpoon) return;
      const at = shots.findIndex(live => live.harpoon); if (at >= 0) shots.splice(at, 1);
      harpoon.mesh.visible = false; harpoon.mesh.scale.set(1, 1, 1); harpoon = null; armed.group.visible = true;
    };
    const cancelCharge = () => { charging = null; chargeRing.visible = false; if (laneLife <= 0) lane.visible = false; };
    // Everything a special can leave running, put away: a swap, a restart, a descent, a reset.
    const endSpecial = () => {
      cancelCharge(); specialBuffer = 0; impacts.clearShock(); glintTime = 0; catchHarpoon();
      vault = null; laneLife = 0; lane.visible = false; clearFlares();
      if (pc.swingKind === 'special') { pc.attackTime = 0; pc.swing = pc.weapon; }
      pc.swingKind = 'strike';
    };
    const clearShots = () => {
      for (const live of shots) { live.mesh.visible = false; if (live.heavy) live.mesh.scale.set(1, 1, 1); }
      shots.length = 0;
      for (const live of hostile) live.mesh.visible = false;
      hostile.length = 0;
      for (const live of hostilePools) live.mesh.visible = false;
      hostilePools.length = 0;
      for (const live of pools) live.mesh.visible = false;
      pools.length = 0;
    };
    // Push the prompt at the bottom of the screen, or take it away. Null-to-null and same-arm-to-same-arm
    // are dropped here rather than in React: the loop asks every frame and setState on every one of them
    // would re-render the whole shell sixty times a second for a line of text that never changed.
    const showOffer = (kind: WeaponId | 'stair' | `door:${number}` | null) => {
      if (offered === kind) return;
      offered = kind;
      if (kind === 'stair') { setSwapOffer({ act: 'take the stair down', detail: level >= FLOORS ? 'Out of the keep' : `To floor ${level + 1}` }); return; }
      if (kind?.startsWith('door:')) { const to = floor.rooms[floor.doors[Number(kind.slice(5))].to]; setSwapOffer({ act: 'take this door', detail: `${to.name} · ${DOOR_WORDS[doorSign(to)]}` }); return; }
      const arm = kind === null ? null : weaponById(kind);
      setSwapOffer(arm ? { act: `switch to ${arm.name}`, detail: arm.detail } : null);
    };
    // Lay an arm on a rack. Called once when the floor is built and again on every swap, because what
    // the knight sets down stays where he found it: a pickup he regrets is a walk back, not a dead run.
    const placeDrop = (kind: WeaponId, x: number, z: number, kept?: Kept) => {
      const {palette, plate} = player.userData.armoury as {palette: ArmoryPalette; plate: Plate};
      if (drop) disposeWeaponDrop(drop, palette);
      const built = makeWeaponDrop(kind, palette, plate);
      built.group.position.set(x, 0, z);
      floorGroup.add(built.group);
      drop = {...built, kind, x, z, kept};
      overDrop = false; ringLit = 0; showOffer(null);
    };
    // What a floor build borrows from the world: the shared telegraph art, the scene root, the cutaway
    // controller's registration and the knight's own rack.
    const floorArt: FloorArt = { telegraph: telegraphTex, lane: laneTex, alert: alertMaterial, world, register: (mesh) => cutaway.register(mesh), placeDrop };
    // The pose the live swing is in: a strike's curve, a special's own tracks (`swingPose`), or the maul being wound.
    const poseAt=(age:number)=>charging!==null&&age===0&&pc.swingKind!=='special'&&pc.weapon.special?chargePose(charging/(pc.weapon.special.chargeMin??1),pc.weapon.special.kind):swingPose(pc,age);
    const posePlayer=(age:number)=>{
      const pose=poseAt(age),sword=player.userData.sword as THREE.Group;
      sword.rotation.set(pose.swordPitch,pose.swordYaw,pose.swordRoll);
      sword.position.set(.44,.3,-.02-pose.armReach);
      sword.scale.z=1+run.reach*.5;
      player.userData.torso.rotation.set(0,pose.bodyYaw,pose.bodyRoll);
      if(age===0&&charging===null){player.userData.torso.rotation.x=locomotion.pitch;player.userData.torso.rotation.y+=locomotion.twist;sword.rotation.x+=locomotion.swordPitch;}
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
      stage.atmosphere?.dispose();
      impacts.clear(); footsteps.clear();
      floorGroup.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      (floorGroup.userData.floorDetail as THREE.Texture | null | undefined)?.dispose(); world.remove(floorGroup);
      sparks.clear();
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
    // The arena (dungeon-arena.ts), a chosen roster standing in the gate of an otherwise empty floor. While
    // one is set, every floor this closure charts - the boot, a restart, a descent, the test hooks - is
    // charted as that arena, so taking the stair meets the same roster a floor deeper. `?arena=` sets it in
    // every build, the published one included, so a kind can be played anywhere the game is; the menu's
    // arena page and `dungeonTest.buildArena` are development only. Cleared by `reset`. An arena run is
    // never recorded: no run log entry, no best run, no LAST KEEP seed.
    let arena: Arena | null = null;
    const setArena = (next: Arena | null) => { arena = next; setArenaOn(next); };
    setArena(parseArena(new URLSearchParams(window.location.search).get('arena'), new URLSearchParams(window.location.search).get('level'), FLOORS));
    const chart = (seed: number, nextLevel: number) => arena ? arenaFloor(seed, nextLevel, arena.roster) : generateFloor(seed, nextLevel);
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
    // Plan 015 Stage C fix round: a cheaper yield for a poll's own internal slices, which only need to
    // give the browser a turn - not the two-rAF guarantee that a *user-visible* change (a veil stage's
    // label) actually painted before the next stage starts. `painted()`'s two rAFs cost ~33ms at 60Hz;
    // spent on every one of a poll's slices (tens of them for the programs, dozens for a cold texture
    // band or a build phase), that was most of the wall-time regression this round exists to fix.
    // `pollProgramsReady` and `driveSliced` yield through this instead, and call `painted()` only at the
    // `stagedBuild` stage boundaries above and below, where the label genuinely has to be on screen.
    const yielded = () => new Promise<void>((done) => {
      if (document.hidden || manualTime) { setTimeout(done, 0); return; }
      requestAnimationFrame(() => done());
    });
    // Plan 015 Stage C.1: bumped once per `stagedBuild` call and captured by each poll below, so a build
    // superseded by a newer one (a second press, a restart, the test pool's reset) makes its own poll
    // stop rather than fighting the new build for frames - the failure mode `compileAsync` had, because
    // it polled the *materials* it collected, and a restart meanwhile disposed one out from under it and
    // left the veil hanging forever. This reads `renderer.info.programs` instead, the renderer's own live
    // list, which a disposed program simply leaves; it never looks at a material.
    let buildToken = 0;
    // The bar only ever moves forward: a stage's measured share can fall (the program list grows as the post
    // chain and the first frame add to it), and a bar that ran backwards would be worse than one that paused.
    let veilShown = 0;
    const showVeil = (stage: number, fraction = 0) => {
      veilShown = Math.max(veilShown, veilProgress(stage, fraction));
      const fill = veilFill.current;
      if (fill) { fill.style.transform = `scaleX(${Math.max(.04, veilShown)})`; fill.dataset.progress = veilShown.toFixed(3); }
    };
    // The program poll and the sliced driver are in dungeon-warmup.ts. Each is told whether the build that
    // asked is still the one running, and reports its slowest slice for `warmUp`; the poll also reports how
    // many programs have linked, which is what the veil's shader stage measures.
    const pollProgramsReady = (token: number, share?: (ready: number, total: number, stalledMs: number) => void) => pollPrograms(renderer, () => !stopped && buildToken === token, yielded, (ms) => { warmUp.pollSliceMs = Math.max(warmUp.pollSliceMs, ms); }, share);
    const driveSliced = (steps: Generator<void>, token: number) => driveSlicedSteps(steps, () => !stopped && buildToken === token, yielded, (ms) => { warmUp.buildSliceMs = Math.max(warmUp.buildSliceMs, ms); });
    const stagedBuild = async (nextLevel: number, seed: number | undefined, work: (token: number) => void | Promise<void>, afterWork?: () => void) => {
      const myToken = ++buildToken;
      warmUp = { precompiled: 0, firstFrame: 0, firstFrameSliceMs: 0, secondFrame: 0, sceneCompileMs: 0, postCompileMs: 0, pollSliceMs: 0, buildSliceMs: 0 };
      setVeilFloor(nextLevel); setVeilPlace(null); setVeilStage(0); veilShown = 0; showVeil(0);
      await painted(); if (stopped) return false;
      const charted = chart(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], nextLevel);
      pendingFloor = { level: nextLevel, floor: charted };
      setVeilPlace(charted.rooms[charted.goal]?.name ?? null); setVeilStage(1); showVeil(1);
      await painted(); if (stopped) return false;
      await driveSliced(getFlagstoneTexturesSteps(), myToken);
      if (stopped || buildToken !== myToken) return false;
      showVeil(1, .5);
      await driveSliced(getMasonryTexturesSteps(), myToken);
      if (stopped || buildToken !== myToken) return false;
      setVeilStage(2); showVeil(2);
      await painted(); if (stopped) return false;
      await work(myToken); pendingFloor = null; afterWork?.();
      if (stopped || buildToken !== myToken) return false;
      setVeilStage(3); showVeil(3);
      await painted(); if (stopped) return false;
      // Compiled against the composer's own offscreen target, not the canvas: a material's program
      // differs by render target (tone mapping and output encoding are only baked in when drawing
      // straight to the canvas), and compiling for the canvas built variants the post chain never uses.
      // `renderer.compile` only submits the work (see `pollProgramsReady` above); with the point lights
      // capped (see `ANCHOR_LIGHTS`) a cold link is ~3 s of GPU-process time rather than tens of seconds,
      // none of it blocking the main thread here.
      world.updateMatrixWorld(true);
      const warmUpFrom = linkedPrograms(renderer);
      const drawingTo = renderer.getRenderTarget(); renderer.setRenderTarget(post.composer.readBuffer);
      const compileStart = performance.now();
      flameKeeper.visible = true; renderer.compile(scene, camera); warmUp.sceneCompileMs = +(performance.now() - compileStart).toFixed(1); flameKeeper.visible = false; renderer.setRenderTarget(drawingTo); post.pinPrograms();
      if (stopped) return false;
      await pollProgramsReady(myToken, (ready, total, stalled) => showVeil(3, creep(programsShare(ready, total, 0, SHADER_SCENE), SHADER_SCENE, stalled)));
      if (stopped || buildToken !== myToken) return false;
      // The post chain's own materials, against the proxies they are really drawn with (dungeon-warmup.ts).
      warmUp.postCompileMs = precompilePost(renderer, post, scene, camera);
      if (stopped) return false;
      await pollProgramsReady(myToken, (ready, total, stalled) => showVeil(3, creep(programsShare(ready, total, SHADER_SCENE, SHADER_POST), SHADER_POST, stalled)));
      if (stopped || buildToken !== myToken) return false;
      showVeil(3, SHADER_POST);
      // The two frames below are for the player: the first takes whatever the precompile above still
      // left for first use - draws the composer's own passes one at a time, each its own task, rather
      // than the one synchronous `post.render` that used to be the whole point of this bug; nothing from
      // this frame reaches the screen, so a pass drawing into the wrong ping-pong buffer only costs
      // pixels nobody sees. The second is the floor that is on screen when the veil lifts, and is a
      // single ordinary draw - everything should be warm by then. A driver that owns the clock draws
      // when it asks to and sees nothing until then, so under manual time neither runs - a full scene
      // pass twice per reset was the largest single cost of a pooled test on software GL.
      // `warmUp` (in `render_game_to_text`) records what each step still compiled, so the probe can say
      // whether the precompile above is being reused rather than guessing from the total.
      const linked = () => linkedPrograms(renderer);
      warmUp.precompiled = linked() - warmUpFrom;
      if (!manualTime) {
        const from = linked();
        const steps = post.renderSteps(elapsed);
        // The pass count is not known up front, so each pass closes half the gap left in the stage.
        let pass = 0;
        while (true) {
          const sliceStart = performance.now();
          if (steps.next().done) break;
          showVeil(3, 1 - (1 - SHADER_POST) / 2 ** ++pass);
          warmUp.firstFrameSliceMs = Math.max(warmUp.firstFrameSliceMs, +(performance.now() - sliceStart).toFixed(1));
          if (stopped || buildToken !== myToken) return false;
          await yielded();
        }
        warmUp.firstFrame = linked() - from;
      }
      setVeilStage(4); showVeil(4);
      await painted(); if (stopped) return false;
      if (!manualTime) { const from = linked(); post.render(elapsed); warmUp.secondFrame = linked() - from; }
      setVeilStage(5); showVeil(5);
      await painted();
      return !stopped;
    };
    // `then` runs as the veil lifts, on the frame the new floor is first on screen.
    const veiled = (line: string, plan: { level: number; seed?: number }, work: (token: number) => void | Promise<void>, then?: () => void) => {
      // A second press while a build is pending would queue a second build: the status that guards each
      // caller does not change until the work this one is holding actually runs.
      if (building) return;
      building = true; setLoading(line);
      void stagedBuild(plan.level, plan.seed, work).then((ok) => { if (!ok) return; building = false; setLoading(null); setVeilStage(0); then?.(); }).catch(fail);
    };
    // An explicit seed replays a floor verbatim; without one the keep is new every descent.
    // Plan 015 Stage C.2: a generator, yielding once after each existing `phase()` boundary, so the
    // boot/restart path below can spread it across frames instead of paying for it in one block; `buildFloor`
    // just past the closing brace runs it to completion synchronously, so `dungeonTest.buildFloor`, `reset`
    // and `buildMs` see no change at all - same phases, same order, same numbers, same PRNG draws.
    function* buildFloorSteps(nextLevel: number, seed?: number): Generator<void> {
      const clock = performance.now(); let mark = clock, phases = 0;
      // Eight phases, dispose through upload, each ending in a yield; behind the veil each one moves its bar.
      const phase = (name: string) => { const now = performance.now(); buildMs[name] = +(now - mark).toFixed(1); mark = now; if (building) showVeil(2, ++phases / 8); };
      buildMs = {};
      if (stage.atmosphere) clearFloor();
      phase('dispose'); yield;
      level = nextLevel; floorStart = elapsed; floorKills = run.kills; floorXp = run.totalXp; stage.features = []; stairOpen = false; onStair = false; stairLit = 0; drop = null; overDrop = false; showOffer(null);
      gameStatus = 'playing'; setStatus('playing');
      // A staged build (see `stagedBuild`) charts the layout a stage early so the veil can name it; the
      // floor it drew is taken here instead of drawing a second seed. Only a match is taken - the same
      // level, and the same seed if one was asked for - so a synchronous build never sees a stale one.
      const charted = pendingFloor && pendingFloor.level === level && (seed === undefined || pendingFloor.floor.seed === seed >>> 0) ? pendingFloor.floor : null;
      pendingFloor = null;
      floor = charted ?? chart(seed ?? crypto.getRandomValues(new Uint32Array(1))[0], level);
      // Pure and deterministic off this floor alone: which stone cells merge into a long slab or
      // settle as a staggered strip, kept away from every 004 reservation before a single mesh exists.
      const pavingPlan = planPavingPatches(floor);
      phase('generate'); yield;
      // Floor 1 is the run's fingerprint: keeping its seed is what lets a lost run be taken again, and it
      // is what a logged entry carries, so the log is held here rather than read off the current floor.
      if (level === 1) { firstSeed = floor.seed; runStart = elapsed; setRunSeed(floor.seed); if (!arena) writeSeed(floor.seed); }
      floorGroup = new THREE.Group(); world.add(floorGroup);
      // endSpecial first: a spear in the air is one of the shots, and dropping it without it leaves the arm out of hand.
      swingHits.clear();slash.clear();endSpecial();clearShots();blood.clear();posePlayer(0);
      visited = new Set([0]); cleared = new Set([0]); spineRooms = new Set(floor.spine);
      reached = 0; activeRoom = 0; pathCell = ''; distances.clear(); overDoor = null; crossing = null; if (crossFade.current) crossFade.current.style.opacity = '0';
      // The floor itself - paving, flood, parapets, atmosphere, the walking-surface index, hazards, shrines,
      // the stair and every skeleton - is raised by dungeon-floor-scene.ts, one timed phase per yield.
      for (const name of raiseFloor(floor, level, floorGroup, pavingPlan, stage, floorArt)) { phase(name); yield; }
      // The gate holds nobody, so its doors stand open from the first frame; every other door starts barred.
      for (const view of stage.doors) view.bars.visible = !cleared.has(view.door.from);
      // Every texture the new floor uses goes to the GPU now. three.js otherwise uploads a texture the
      // first frame something using it is on screen, so which ones were resident depended on where the
      // camera happened to look: walking into a new room hitched on the upload, and the renderer's texture
      // count wandered by what was in view, which every leak check across rebuilds reads as a leak.
      const uploaded = new Set<THREE.Texture>();
      // Non-null assertion, not a new check: `renderer` is guaranteed by the mount guard above, but a
      // hoisted function declaration (`buildFloorSteps`, needed because a generator cannot be an arrow
      // function) is outside the arrow-function closures TypeScript narrows a `const` guard through.
      const upload = (value: unknown) => { if (value instanceof THREE.Texture && !uploaded.has(value)) { uploaded.add(value); renderer!.initTexture(value); } };
      world.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
          for (const value of Object.values(m)) upload(value);
          const uniforms = (m as THREE.ShaderMaterial).uniforms;
          if (uniforms) for (const key in uniforms) upload(uniforms[key]?.value);
        }
      });
      phase('upload'); yield;
      player.position.set(floor.rooms[0].x * TILE, 0.03, floor.rooms[0].z * TILE);
      cameraFocus.copy(player.position);
      // The knight is on his mark, so the chamber he is standing in is known and its lights can be hung
      // before anything is drawn. Leaving it to the frame loop would leave one frame lit by whatever the
      // last floor was, and a first frame that arrives while the game is paused would never be lit at all.
      mood.move(1, floor, player.position.x, player.position.z);
      updatePaths();
      // Room fills are painted imperatively as rooms are explored, so the map has to be a new element
      // every build — keying it on the seed alone would keep a retried floor's old fills on screen.
      setFloorMap(floor); setFloorBuild(build => build + 1); setFloorLevel(level); setRoomName(floor.rooms[0].name);
      setVisitedCount(1); setAdvance(0);
      buildMs.total = +(performance.now() - clock).toFixed(1);
    }
    // Runs `buildFloorSteps` to completion synchronously - every caller before plan 015 Stage C.2, and
    // still every one of them (`dungeonTest.buildFloor`/`reset` above all: they stay synchronous and
    // deterministic). The boot/restart path below drives the same generator incrementally instead.
    const buildFloor = (nextLevel: number, seed?: number) => {
      const steps = buildFloorSteps(nextLevel, seed);
      let step = steps.next();
      while (!step.done) step = steps.next();
    };
    const descend = () => {
      if (gameStatus !== 'playing' || run.choosing || activeRoom !== floor.goal || !stairClear()) return;
      showOffer(null);
      gameStatus = 'complete'; setStatus('complete'); keys.clear(); dropBuffers(pc); velocity.set(0,0,0);
      setFloorResult({kills: run.kills - floorKills, xp: run.totalXp - floorXp, seconds: Math.round(elapsed - floorStart)});
      setNotice(''); audio.play('win');
    };
    const continueDescent = () => {
      if (gameStatus !== 'complete') return;
      if (level >= FLOORS) { endRun(null); return; }
      veiled(`Descending to floor ${level + 1}`, { level: level + 1 }, async (token) => {
        await driveSliced(buildFloorSteps(level + 1), token);
        heal(run, Math.round(run.maxHp * .25)); setHealth(run.hp);
        endSpecial(); keys.clear(); haltControl(pc); audio.pause(false);
        burst(player.position, 0x71f4c4, 22);
      });
    };
    // A run is nothing but this closure's counters plus floor 1, so it restarts in place: reloading
    // would refetch the bundle and throw away the AudioContext and the GPU context for no gain.
    // Everything buildFloor(1) already rebuilds (floor, level, rooms, enemies, map, status) is left to it,
    // but the run must be fresh first because it snapshots kills and XP as the floor's baseline. A whole
    // new `run` is the point of createRun(): a field added to the sim can never be forgotten here.
    // An arena restarts on its own floor rather than on floor one.
    const restart = (seed?: number, then?: () => void, startLevel = arena?.level ?? 1) => veiled(seed === undefined ? 'A new keep rises' : 'The same keep, again', { level: startLevel, seed }, async (token) => {
      run = createRun(); boonsTaken = [];
      endSpecial(); specialWasReady = true;
      resetControl(pc); hurtFlash = 0; shake = 0; clearShots();
      walkPhase = 0; gaitSpeed = 0; locomotion=playerRunPose(0,0); rewardTime = 0; noticeTime = 0; trailClock = 0; trailCursor = 0;
      footsteps.reset(); stepLog = { contacts: 0, skipped: 0, kinds: { keep: 0, ruins: 0, flooded: 0 }, last: null };
      isPaused = false; keys.clear(); velocity.set(0, 0, 0);
      faceStart(pc);
      setHealth(run.hp); setMaxHealth(run.maxHp); setDefeated(0); setExperience(0); setXpReward(0);
      setRank(1); setRankXp(0); setRankNeed(rankCost(1)); setTaken([]); setEnded(null); setBoonChoice([]);
      const startArm = (process.env.NODE_ENV !== 'production' ? devStartingArm(window.location.search) : null) ?? STARTING_WEAPON;
      // The same arm is not re-made, but it starts the run as a found one does: loaded (the fresh run is ready).
      if (pc.weapon.id !== startArm) equip(startArm); else fillQuiver();
      setHeldWeapon(weaponById(startArm).name);
      setNotice(''); setFloorResult({ kills: 0, xp: 0, seconds: 0 });
      setPaused(false); setMapOpen(false); mapShown = false;
      await driveSliced(buildFloorSteps(startLevel, seed), token);
      player.rotation.set(0, Math.atan2(-pc.facing.x, -pc.facing.z), 0); player.userData.sword.rotation.y = 0;
      audio.pause(false);
    }, then);
    // Read before floor 1 overwrites the stored seed, so "Last keep" still offers the previous visit's.
    const restoreSave = () => { setBest(readBest()); setPriorSeed(readSeed()); setRunLog(readRuns()); };
    restoreSave();
    // Floor 1 is not built here. The menu is in the prerendered page and is what a visitor sees first, and
    // nothing below runs until ENTER THE KEEP asks for it (see `boot`, called on demand from the press
    // path further down). Until a press starts one, there is no floor and nothing below may touch one: no
    // frame is requested, the window hooks are not installed, and the press itself is what raises the
    // loading bar and is answered once the keep exists.
    let built = false, warmed = false, enterWhenBuilt = false, bootSeed: number | undefined, enterSeed: number | undefined;
    // Takes the arena page's listener down on unmount. Installed only in development (see the test hooks),
    // so the event's name never appears outside that block; null in production.
    let dropArenaListener: (() => void) | null = null;
    // The thumbstick's screen-space direction while a thumb is planted, null the rest of the time. It is a
    // unit vector on the very basis the keys below build on, so analog steering is a second source of the
    // same quantity rather than a second input system.
    let stick: Stick | null = null;
    // A pad's left stick, kept apart from the touch stick's slot so neither can strand the other. The
    // right stick is aim rather than movement, which is the twin-stick half of a pad.
    let padStick: Stick | null = null, padLook: Stick | null = null;
    let padPressed = new Set<number>();
    // The cursor in normalised device coordinates, and which device last spoke. Last device wins
    // outright rather than blending: someone who reaches for the mouse mid-fight should not have the
    // keys still arguing about where the knight is pointing. The NDC is stored rather than the
    // direction it implies, because the knight walks out from under a cursor that never moved.
    let pointerNdc: { x: number; y: number } | null = null, aimDevice: 'keys' | 'pointer' = 'keys';
    // The keycaps name the device that last spoke, so the HUD hears about a change - and only about a change.
    const claimAim = (device: 'keys' | 'pointer') => { if (aimDevice === device) return; aimDevice = device; setPointerAim(device === 'pointer'); };
    // Whether the floor map is what the pause is showing, so the key that opened it can close it again.
    let mapShown = false;
    // The frustum, as the resize handler last set it. `groundAim` needs both to invert the projection.
    let viewSpan = 7.2, viewAspect = 1;
    // Bindings are read at the moment they are asked for, never snapshotted: the card can rebind a key while
    // the run is paused behind it. `Touch<action>` is the touch d-pad's own slot and belongs to no binding,
    // so the discrete move:/stop: protocol steers identically whatever the keyboard has been set to.
    // `Touch<action>`, `Mouse<action>` and `Pad<action>` are each a device's own slot, belonging to no
    // binding: a held STRIKE must keep swinging whatever the keyboard was rebound to, and must not be
    // released by letting go of a key on a different device.
    const held = (action: Action) => isHeld(keys, settingsRef.current.binds, action);
    // A planted thumb outranks the keys for exactly as long as it is down (see `moveHeading`).
    const moveInput = () => moveHeading(held, stick ?? padStick);
    // Bodies a blow could plausibly be meant for: alive, awake, near, and with stone out of the way.
    // The lane test is the expensive one, so it runs last and on the handful that survive the rest.
    const aimTargets = (reach: number) => {
      const span = reach * reach;
      return stage.enemies
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
      const look = padLook ?? (() => { const v = moveInput(); return v.x * v.x + v.z * v.z ? { x: v.x, z: v.z } : null; })();
      if (!look) return null;
      // A thrown arm snaps as far as the shot carries, not as far as the arm reaches: the crossbow's
      // own reach is 0.2, and a snap measured against that would leave the bolt exactly as unaimable
      // as it was. Its range is the honest answer to "what could this swing have been meant for".
      const reach = pc.weapon.ranged
        ? pc.weapon.ranged.speed * pc.weapon.ranged.flight
        : (pc.weapon.reach + run.reach) * SNAP_REACH;
      return snapAim(look, aimTargets(reach), player.position, reach);
    };
    const startAttack = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || pc.dashTime > 0 || charging !== null) return;
      audio.play('slash');
      // Continue the string or open a new one, pointed where the swing was asked to go (`startSwing`).
      startSwing(pc, aimNow()); swingHits.clear(); slash.clear();
      // With the spear out on its line, the knight fights with what he has left: his fists.
      if (harpoon && pc.weapon.special?.hurl) pc.swing = { ...pc.swing, damage: pc.swing.damage * pc.weapon.special.hurl.bare };
      player.rotation.y = Math.atan2(-pc.facing.x, -pc.facing.z);

    };
    const requestAttack = () => {
      // Plan 015 Stage C fix round: `building` too. A sliced restart/descent flips `gameStatus` to
      // 'playing' in its first slice, well before `enemyData` and the floor it swings against exist -
      // and a restart's own work resets these buffers before the sliced build even starts, so a press
      // made during the veil would otherwise sit buffered and fire on the very first frame after it.
      if (!hasStarted || isPaused || gameStatus !== 'playing' || building) return;
      if (canSwing(pc) && charging === null) startAttack();
      else bufferSwing(pc, aimNow());
    };
    const requestDash = () => {
      if (!hasStarted || isPaused || gameStatus !== 'playing' || building || pc.dashCooldown > 0) return;
      // While the blade is live the swing is a commitment: the dash waits for contact to end instead of
      // cutting it short, which is what makes swinging into a tell a mistake rather than a free action.
      if (!startDash(pc, moveInput(), run.dashSpan)) return;
      // A charge is let go and a special still winding up is dropped, both before contact and so at no cost.
      cancelCharge(); vault = null;
      audio.play('dash'); slash.clear(); posePlayer(0);

    };
    // Plan 017: a door is taken behind a short fade. The knight is set down in the next chamber at the dark
    // point of it, so the move is never seen; a reduced-motion player gets a plain cut instead.
    const takeDoor = (door: Door) => {
      crossing = { door, time: 0, flipped: false }; overDoor = null; showOffer(null); dropBuffers(pc);
      audio.play('clear');
    };
    // The next chamber is all there is: the knight at its near wall facing its far one, the camera and the
    // lights on him at once, and nothing of the last chamber's blows, bolts or footprints carried across.
    const arrive = (id: number) => {
      const room = floor.rooms[id];
      player.position.set(room.entry.x * TILE, .03, room.entry.z * TILE); player.rotation.y = 0; pc.facing.x = 0; pc.facing.z = -1;
      velocity.set(0,0,0); cameraFocus.copy(player.position);
      swingHits.clear(); slash.clear(); clearShots(); footsteps.clear(); impacts.clear(); sparks.clear();
      dashTrails.forEach(m=>{m.userData.life=0;m.visible=false;});
      pathCell = ''; updatePaths(); mood.move(1, floor, player.position.x, player.position.z);
    };
    const stepCrossing = (frameDt: number) => {
      if (!crossing) return;
      crossing.time += frameDt;
      if (!crossing.flipped && (easeMotion || crossing.time >= CROSS_TIME)) { arrive(crossing.door.to); crossing.flipped = true; crossing.time = easeMotion ? CROSS_TIME * 2 : CROSS_TIME; }
      const shade = easeMotion ? 0 : crossing.flipped ? 2 - crossing.time / CROSS_TIME : crossing.time / CROSS_TIME;
      if (crossFade.current) crossFade.current.style.opacity = String(Math.max(0, Math.min(1, shade)));
      if (crossing.flipped && crossing.time >= CROSS_TIME * 2) crossing = null;
    };
    // Answer the rack, or the open stair. Nothing happens unless the knight is standing in a rack's ring
    // or on the stair once its wardens are down, so the key is inert everywhere else in the keep rather
    // than a second thing to be careful with. The rack wins if he somehow stands in both, because the
    // prompt names the arm then. What he was holding goes down where the new arm lay: a swap he regrets
    // is a walk back, not a dead run.
    const requestSwap = () => {
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing' || building || crossing) return;
      if (!drop || !overDrop) { if (stairOpen && onStair) descend(); else if (overDoor && cleared.has(overDoor.from)) takeDoor(overDoor); return; }
      // Both arms keep their own clocks: read the one in hand before `equip` hands over the rack's.
      const taken = weaponById(drop.kind), set = pc.weapon.id, at = { x: drop.x, z: drop.z }, left = keep();
      equip(drop.kind, drop.kept);
      placeDrop(set, at.x, at.z, left);
      // Standing still after the swap, so the prompt comes straight back naming the arm just set down.
      overDrop = true; showOffer(set);
      audio.play('clear'); burst(player.position, 0xfbc956, 14);
      setNotice(`${taken.name} in hand`); noticeTime = 3.5;
      setHeldWeapon(taken.name);
    };
    // Plan 016: the arm's own verb. An arm without one leaves the input inert (decision 3). It is a swing
    // on the strike's clock, so it waits out a live blade or a dodge the way a buffered dodge does, and
    // cancels a strike's wind-up or recovery the way a dodge does - except a held one (the charge, the draw),
    // which waits out the whole strike (`specialMayCut`). It never interrupts itself.
    const startSpecial = (charge: number) => {
      const special = pc.weapon.special;
      if (!special) return;
      pc.swing = specialSwing(pc.weapon, charge); pc.swingKind = 'special';
      pc.attackTime = pc.swing.duration; pc.attackBuffer = 0; specialBuffer = 0; swingHits.clear(); slash.clear();
      pc.chainBeat = 0; pc.chainIdle = Infinity;
      const aim = aimNow();
      if (aim) { pc.facing.x = aim.x; pc.facing.z = aim.z; }
      pc.attackFacing.x = pc.facing.x; pc.attackFacing.z = pc.facing.z; player.rotation.y = Math.atan2(-pc.facing.x, -pc.facing.z);
      lungeFrom.copy(player.position);
      // The Vault picks its body and measures its path now, off the floor as it is: the hop never changes its
      // mind in the air, and never ends inside stone or a prop.
      vault = null;
      if (special.vault) {
        const bodies = stage.enemies.filter(enemy => !enemy.dead && enemy.awake);
        const at = vaultTarget(floor.cells, player.position, pc.facing, bodies.map(enemy => enemy.group.position), special.vault.range, special.vault.cone);
        const target = at >= 0 ? bodies[at] : null;
        const path = vaultLanding(floor.cells, player.position, pc.facing, target ? target.group.position : null, special.vault.over, special.vault.hop);
        vault = { target, distance: path.distance, dir: new THREE.Vector3(path.dir.x, 0, path.dir.z), landed: false };
      }
      audio.play(special.kind === 'lunge' ? 'lunge' : special.kind === 'throw' ? 'harpoon' : special.kind === 'whirl' ? 'whirl' : special.kind === 'draw' || special.kind === 'detonate' ? 'warn' : special.kind === 'vault' ? 'vault' : 'slash');
    };
    const requestSpecial = () => {
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing' || building || !pc.weapon.special) return;
      const gate = specialGate({ weapon: pc.weapon, ready: specialAvailable(pc.weapon.special, { cooled: specialReady(run), quiver, out: !!harpoon }), attackTime: pc.attackTime, swing: pc.swing, dashTime: pc.dashTime, specialLive: pc.swingKind === 'special' && pc.attackTime > 0, busy: !!harpoon || charging !== null, pools: pools.length });
      if (gate === 'refuse') return;
      if (gate === 'wait') { specialBuffer = DASH_BUFFER; return; }
      specialBuffer = 0; pc.attackTime = 0; pc.swingKind = 'strike'; pc.swing = pc.weapon; slash.clear();
      if (pc.weapon.special.kind === 'charge' || pc.weapon.special.kind === 'draw') { charging = 0; pc.attackBuffer = 0; audio.play(pc.weapon.special.kind === 'draw' ? 'draw' : 'charge'); return; }
      startSpecial(1);
    };
    // Let go of a charge: past the minimum it slams at whatever it reached, short of it nothing is spent.
    const releaseCharge = () => {
      const heldFor = charging ?? 0, special = pc.weapon.special;
      cancelCharge();
      // A draw only fires full, and a quiver emptied some other way meanwhile has nothing left to spend.
      if (special?.draw) { if (drawn(special, heldFor) && quiver > 0) startSpecial(1); return; }
      if (special && chargeReleases(special, heldFor)) startSpecial(chargeLevel(special, heldFor));
    };
    const togglePause = () => {
      // Pausing on top of an open boon draft would stack two overlays; the draft already holds the world still.
      if (!hasStarted || gameStatus !== 'playing' || run.choosing) return;
      // An armed rebind goes with the card. Left live, the first key pressed back in the fight would be
      // bound instead of swung, which is the worst possible moment to find out the capture was still open.
      isPaused = !isPaused; setMapOpen(false); mapShown = false; setCapturing(null); keys.clear(); dropBuffers(pc); specialBuffer = 0; cancelCharge(); impacts.clearShock(); laneLife = 0; lane.visible = false; clearFlares(); setPaused(isPaused); audio.pause(isPaused);
      dirty = true;
    };
    // Mute is a setting like any other now, so it goes out through the same funnel and comes back through
    // applyRef — one path, whether it was the M key, the menu button or a `mute` event that asked.
    const toggleMute = () => updateSettings({ muted: !settingsRef.current.muted });
    // The map is a pause with the floor on it, so it opens through the pause and closes the same way.
    const openMap = () => { if (!hasStarted || run.choosing || gameStatus !== 'playing') return; if (!isPaused) togglePause(); setMapOpen(true); mapShown = true; };
    const toggleMap = () => { if (mapShown) togglePause(); else openMap(); };
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void mount.parentElement?.requestFullscreen?.().catch(() => undefined); };
    const keyDown = (e: KeyboardEvent) => {
      const intent = readKey(e.code, e.repeat, settingsRef.current.binds, hasStarted && !isPaused && !run.choosing && gameStatus === 'playing', mapShown);
      // Swallow a browser key only while it is bound to something: freeing an arrow by rebinding hands page
      // scrolling straight back, and binding PageDown stops the page jumping out from under the fight.
      if (intent.prevent) e.preventDefault();
      // Escape answers whatever else it is set to. It is the one key no rebind can take away, so a player
      // cannot shut themselves out of the menu that would let them undo the rebind.
      if (intent.command === 'pause') { togglePause(); return; }
      if (intent.command === 'mute') { toggleMute(); return; }
      if (intent.command === 'fullscreen') { fullscreen(); return; }
      // Only while the fight is live or the map is already up (`readKey`), so a map key pressed on a menu
      // card is left to do whatever it does there - Tab keeps moving focus.
      if (intent.command === 'map') { toggleMap(); return; }
      if (!intent.hold) return;
      keys.add(e.code);
      // Striking *from the keyboard* is a claim on where the knight points; walking is not. That
      // distinction is the whole reason a pointer is worth having: holding D while the cursor sits to the
      // left is a knight retreating and cutting behind him, and a movement key that stole the aim back
      // would make it impossible to express. J still claims it, so someone playing on the keyboard with a
      // cursor parked wherever the intro card left it is never aimed at that corner. The dodge does not
      // (plan 016): it is on Space now, under a mouse player's thumb, and a dodge that handed the aim to
      // the keys would leave every swing after it pointed away from the cursor until the mouse moved.
      if (intent.claimAim) claimAim('keys');
      for (const press of intent.press) { if (press === 'attack') requestAttack(); else if (press === 'special') requestSpecial(); else if (press === 'dash') requestDash(); else requestSwap(); }
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    // The stick clears with the keys: a page backgrounded mid-drag does not always fire pointercancel,
    // and a stick left live is a knight that walks on by itself the moment the descent resumes.
    const clearInput = () => {
      keys.clear(); stick = null; padStick = null; padLook = null; padPressed.clear();
      // A button let go while the window was away never reports it, and a stale bit would swallow the next click.
      mouseHeld = 0;
      dropBuffers(pc);
    };
    const enter = () => { enterWhenBuilt = false; setEntering(false); if (hasStarted) return;
      // The first descent never passes through `restart`, so a dev `?arm=` has to be honoured here as well.
      if (process.env.NODE_ENV !== 'production') { const arm = devStartingArm(window.location.search); if (arm && pc.weapon.id !== arm) { equip(arm); setHeldWeapon(weaponById(arm).name); } }
      floorStart = elapsed; runStart = elapsed; hasStarted = true; setStarted(true); setCapturing(null); };
    const trigger = (e: Event) => {
      const command = parseCommand((e as CustomEvent<string>).detail);
      if (!command) return;
      switch (command.kind) {
        case 'continue': continueDescent(); return;
        // `restart` opens a fresh keep, `restart:<seed>` takes the same one again; a junk seed just means fresh.
        case 'restart': restart(command.seed); return;
        // `elapsed` runs from mount, so both clocks restart here or a logged run would bill the time spent
        // reading the menu. A restart mid-run has `hasStarted` already true and gets its reset in buildFloor.
        // `start:<seed>` enters the keep a previous visit left, which is what the menu's LAST KEEP asks for.
        // Pressed before floor 1 exists, the press is held behind the loading bar and answered the frame the
        // keep is on screen - and the seed, if any, becomes the one that floor is built from. The audio is
        // woken here either way, inside the gesture, because Safari will not wake it from a later frame.
        case 'start': {
          if (hasStarted || enterWhenBuilt || building) return;
          const pinned = command.seed;
          audio.start();
          // Not yet on screen: either floor 1 is still ahead (the seed becomes the one it is built from) or it
          // is built and its shaders are still warming (the seed, if it differs, is taken once they are).
          if (!warmed) { enterWhenBuilt = true; setEntering(true); if (built) enterSeed = pinned; else { bootSeed = pinned; scheduleBoot(); } return; }
          if (pinned === undefined) enter(); else restart(pinned, enter);
          return;
        }
        case 'map': openMap(); return;
        case 'pause': togglePause(); return;
        case 'mute': toggleMute(); return;
        case 'fullscreen': fullscreen(); return;
        case 'boon': chooseBoon(command.id); return;
        // Above the play guard on purpose: a release has to land even if the draft, the pause or a death
        // arrived between plant and lift, or the knight would keep walking with no thumb on the glass.
        // Junk parses as a release for the same reason.
        case 'stick': stick = command.stick; return;
      }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') return;
      switch (command.kind) {
        case 'attack': requestAttack(); break;
        // Its own slot rather than the attack binding's: the touch STRIKE button must hold a swing going
        // whatever the keyboard has been rebound to, and must not be released by letting go of a key.
        case 'hold-attack': keys.add('Touchattack'); requestAttack(); break;
        case 'release-attack': keys.delete('Touchattack'); break;
        case 'dash': requestDash(); break;
        // The touch SPECIAL button holds like STRIKE, in its own slot, because a charged special is released
        // rather than pressed; `special` alone is a tap.
        case 'special': requestSpecial(); break;
        case 'hold-special': keys.add('Touchspecial'); requestSpecial(); break;
        case 'release-special': keys.delete('Touchspecial'); break;
        // The prompt at the foot of the screen sends this too, so a tap answers the rack on a phone, where
        // there is no key to press and the prompt is the only thing naming the arm.
        case 'swap': requestSwap(); break;
        case 'move': keys.add(`Touch${command.action}`); break;
        case 'stop': keys.delete(`Touch${command.action}`); break;
      }
    };
    // Mouse only. The touch controls sit over this same canvas and speak their own protocol, and a
    // finger that also moved the aim would fight the thumbstick it was resting on.
    const canvas = renderer.domElement;
    // Read once per layout rather than on every pointermove: after the frame's own style writes, each
    // read forced a synchronous layout. `resize` forgets it, and the next move reads it again.
    let canvasRect: DOMRect | null = null;
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const at = toNdc(e.clientX, e.clientY, canvasRect ??= canvas.getBoundingClientRect());
      if (!at) return;
      pointerNdc = at;
      claimAim('pointer');
      // A second button pressed while one is already down arrives as a move, not a down: that is how
      // pointer events report a chord, and it is how a held strike and a special meet.
      mouseSync(e, true);
    };
    // Plan 016: a button is a bind code, `Mouse<button>`, pressed and held through the same set a key is.
    // `buttons` is the whole chord as a bitmask; bit i is button BUTTON_BITS[i]. The side buttons are not bind
    // codes (`isMouseCode`), so they are not read at all.
    const BUTTON_BITS = [0, 2, 1];
    let mouseHeld = 0;
    const mousePress = (code: string, e: PointerEvent) => {
      // Pause and the map answer while paused, as their keys do (`readKey`), so a button that opened one closes it.
      const live = hasStarted && !isPaused && !run.choosing && gameStatus === 'playing';
      if (!live && !(hasStarted && isPaused)) return;
      const binds = settingsRef.current.binds, does = (action: Action) => binds[action].includes(code);
      if (!ACTIONS.some(does)) return;
      e.preventDefault();
      if (does('pause')) { togglePause(); return; }
      if (does('map') && (live || mapShown)) { toggleMap(); return; }
      if (!live) return;
      if (does('mute')) { toggleMute(); return; }
      if (does('fullscreen')) { fullscreen(); return; }
      keys.add(code);
      if (does('attack')) requestAttack();
      if (does('special')) requestSpecial();
      if (does('dash')) requestDash();
      if (does('swap')) requestSwap();
    };
    const mouseSync = (e: PointerEvent, presses: boolean) => {
      const now = e.buttons, was = mouseHeld; mouseHeld = now;
      for (let bit = 0; bit < BUTTON_BITS.length; bit++) {
        const mask = 1 << bit, code = `Mouse${BUTTON_BITS[bit]}`;
        if (was & mask && !(now & mask)) keys.delete(code);
        else if (presses && !(was & mask) && now & mask) mousePress(code, e);
      }
    };
    // A cursor that has left the canvas is not pointing at the floor any more, and a swing aimed at
    // where it went out is a swing aimed at nothing the player can see.
    const pointerGone = (e: PointerEvent) => { if (e.pointerType === 'mouse') { pointerNdc = null; mouseHeld = 0; BUTTON_BITS.forEach(b => keys.delete(`Mouse${b}`)); claimAim('keys'); } };
    // Back over the canvas with a button still down is not a press: the chord it brings is taken as already
    // held, so only a button pressed from here on (a real pointerdown, or a chord added to it) presses.
    const pointerBack = (e: PointerEvent) => { if (e.pointerType === 'mouse') mouseHeld = e.buttons; };
    const pointerDown = (e: PointerEvent) => { if (e.pointerType === 'mouse') pointerMove(e); };
    // While paused the canvas is under the card or the map, so a button bound to pause or the map is heard on
    // the window instead. Never the left button (it clicks the card, whatever it is bound to), never the canvas
    // itself (it has its own path) and never the capture strip, where a button is being bound, not used.
    const pausedDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !isPaused || e.button === 0 || e.button > 2 || e.target === canvas || (e.target as Element | null)?.closest?.('.mouse-capture')) return;
      const code = `Mouse${e.button}`, binds = settingsRef.current.binds;
      if (!binds.pause.includes(code) && !binds.map.includes(code)) return;
      if (e.button === 2) window.addEventListener('contextmenu', (menu) => menu.preventDefault(), { capture: true, once: true });
      // Held, as far as the canvas is concerned, so a button still down when the card goes is not pressed again.
      mouseHeld = e.buttons; mousePress(code, e);
    };
    // On the window, so a button let go of anywhere is let go of; releases only, never presses.
    const pointerUp = (e: PointerEvent) => { if (e.pointerType === 'mouse') mouseSync(e, false); };
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointerleave', pointerGone);
    canvas.addEventListener('pointerenter', pointerBack);
    window.addEventListener('pointerdown', pausedDown);
    canvas.addEventListener('contextmenu', noMenu);


    const dropPad = () => {
      padStick = null; padLook = null; padPressed.clear();
      for (const [index] of PAD_BUTTONS) keys.delete(`Pad${index}`);
    };
    const pollPad = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
      if (!pad) { if (padStick || padLook || padPressed.size) dropPad(); return; }
      if (!hasStarted || isPaused || run.choosing || gameStatus !== 'playing') {
        // Buttons still read while the world is held, or START could never unpause it - and VIEW could
        // never close the map it opened.
        padStick = null; padLook = null;
        const start = pad.buttons[PAD_START]?.pressed ?? false, view = pad.buttons[PAD_VIEW]?.pressed ?? false;
        if (start && !padPressed.has(PAD_START)) togglePause();
        else if (view && !padPressed.has(PAD_VIEW)) toggleMap();
        padPressed = new Set([...(start ? [PAD_START] : []), ...(view ? [PAD_VIEW] : [])]);
        return;
      }
      padStick = padAxis(pad.axes, 0, 1);
      // The right stick aims and does not move. At rest the left stick answers for both, which is how
      // a pad plays before anyone thinks to use the second one.
      padLook = readPadLook(pad.axes);
      const now = new Set<number>();
      for (const [index, action] of PAD_BUTTONS) {
        if (!(pad.buttons[index]?.pressed ?? false)) { keys.delete(`Pad${index}`); continue; }
        now.add(index);
        keys.add(`Pad${index}`);
        if (padPressed.has(index)) continue;
        if (action === 'attack') requestAttack();
        if (action === 'special') requestSpecial();
        if (action === 'dash') requestDash();
        if (action === 'swap') requestSwap();
        if (action === 'map') toggleMap();
        if (action === 'pause') togglePause();
      }
      padPressed = now;
    };

    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    const blur = () => { clearInput(); if (hasStarted && !isPaused && gameStatus === 'playing') togglePause(); };
    // Plan 015 Stage B: a background tab draws no frame at all, held or not, so nothing about `dirty`
    // needs to change while hidden; coming back does not know that on its own, so it asks for one frame.
    const visibility = () => { if (document.hidden) blur(); else dirty = true; };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur); window.addEventListener('dungeon-action', trigger);
    // three.js restores the GPU context on its own; what it cannot do is stop the simulation, so without
    // this the knight goes on taking damage behind a frozen image. Restoring never resumes by itself —
    // whoever was pulled away picks the moment to step back into the fight.
    const contextLost = () => { setDisplayLost(true); blur(); };
    const contextRestored = () => { setDisplayLost(false); dirty = true; };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    let last: number | null = null, raf = 0;
    // A throw from inside `update` or a draw used to be thrown again on every frame after it, since the
    // loop asks for its next frame before it runs this one: the picture froze, the console filled, and
    // nothing on screen said why. A throw out of a floor build left the veil up for good. Either one now
    // stops the world once, says so once, and puts up a screen with the one way out.
    let faulted = false;
    const fail = (error: unknown) => {
      if (faulted) return;
      faulted = true; cancelAnimationFrame(raf); clearInput(); audio.pause(true);
      console.error('The keep stopped:', error);
      setLoading(null); setFault(true);
    };
    const update = (frameDt: number) => {
      // Before anything reads an input: a button pressed this frame must be able to start a swing on
      // this frame, exactly as a key would.
      pollPad();
      if (isPaused || run.choosing || gameStatus === 'complete') return;
      dirty = true;
      elapsed += frameDt; const t = elapsed;
      // Deliberately not touched by reduced motion. Hit-stop is the absence of movement, not movement,
      // and it is also time the enemies do not get: shortening it would hand every landed blow back to
      // them a frame sooner, which is a balance change wearing an accessibility label.
      const dt = frameStep(pc, frameDt);
      // This, not the constructor, is the torch's real intensity — it is rewritten every frame. Raised to
      // hold the near field after the decay went from 1.9 to a physical 2 and the cutoff came off.
      // Plan 014 round A: 22 -> 34, the warm bounce a torch throws on everything within a couple of tiles.
      const torchFlicker = (i: number) => 34 + Math.sin(t * 9 + i * 2.2) * 2.6 + Math.sin(t * 17) * 0.9;
      for (let i = 0; i < torchLights.length - 1; i++) torchLights[i].intensity = torchFlicker(i);
      if (stage.water) stage.water.position.y = -2.8 + Math.sin(t * 0.9) * 0.05;
      if (stage.tide) stage.tide.time.value=t;
      animateCloth(player.userData.cape,t,pc.dashTime>0?.32:velocity.lengthSq()>0?.16:.045);
      trailClock-=dt;
      // The Vault leaves the dash's streaks along its hop, so the frame it lands on still shows the way it came.
      const hopping=pc.swingKind==='special'&&pc.attackTime>0&&!!vault&&!vault.landed&&vault.distance>0&&pc.swing.duration-pc.attackTime>pc.swing.anticipation;
      if((pc.dashTime>0||hopping) && trailClock<=0){
        const trail=dashTrails[trailCursor++%dashTrails.length],way=hopping&&vault?vault.dir:pc.dashFacing;trail.visible=true;trail.position.copy(player.position);trail.position.y=.09;
        trail.rotation.z=Math.atan2(-way.z,way.x)+Math.PI/2;trail.userData.life=.26;trailClock=.025;
      }
      dashTrails.forEach(m=>{m.userData.life=Math.max(0,m.userData.life-dt);m.visible=m.userData.life>0;if(!m.visible)return;(m.material as THREE.MeshBasicMaterial).opacity=m.userData.life*1.8;m.scale.x=.6+m.userData.life*2;});
      if (hasStarted && gameStatus === 'playing') {
        stepCrossing(frameDt);
        tickBuffers(pc, dt); specialBuffer = Math.max(0, specialBuffer - dt);
        // A dash that waited out the live blade goes first, the moment the recovery begins and ahead of the
        // next held swing, or holding strike would swallow every dodge pressed mid-swing.
        if (bufferedDashReady(pc)) requestDash();
        // A special that waited out a blade or a dodge goes next, ahead of a held strike, for the same reason.
        // A held special waits out the whole strike, which can be longer than the buffer, so it keeps its place
        // for as long as the button is down and begins the frame the strike ends.
        if (specialBuffer > 0 && pc.weapon.special && (pc.weapon.special.kind === 'charge' || pc.weapon.special.kind === 'draw') && held('special')) specialBuffer = DASH_BUFFER;
        if (pc.dashTime <= 0 && specialBuffer > 0 && pc.weapon.special && specialMayCut(pc.weapon.special, pc.attackTime, pc.swing)) requestSpecial();
        // A charge runs for as long as the special is held by any device, and is released the frame it is not.
        if (charging !== null) { if (held('special')) charging += dt; else releaseCharge(); }
        if (swingReady(pc, held('attack'))) startAttack();
        const input = moveInput();
        const direction = steer(pc, input);
        // A drawn crossbow follows the aim, so the line can be laid across a rank before it is let go.
        if (charging !== null && pc.weapon.special?.draw && pc.dashTime <= 0) { const aim = aimNow(); if (aim) { pc.facing.x = aim.x; pc.facing.z = aim.z; } }
        const targetAngle = Math.atan2(-direction.x, -direction.z);
        const angleDelta = Math.atan2(Math.sin(targetAngle - player.rotation.y), Math.cos(targetAngle - player.rotation.y));
        player.rotation.y += angleDelta * (1 - Math.exp(-28 * dt));
        const heading = travelHeading(pc, input);
        const speed = charging !== null && pc.dashTime <= 0 ? pc.weapon.moveSpeed * (pc.weapon.special?.moveScale ?? 1) : travelSpeed(pc);
        velocity.set(heading.x, 0, heading.z).multiplyScalar(speed);
        // A lunge carries the knight down its line for its travel window, whatever the keys say: this frame
        // covers the special from `age` to `age + dt`, before the swing's own clock is stepped below.
        const lunge = pc.swingKind === 'special' && pc.attackTime > 0 && pc.weapon.special?.lunge ? lungeStep(pc.weapon.special, pc.swing.anticipation, pc.swing.duration - pc.attackTime + dt, dt) : 0;
        if (lunge > 0 && dt > 0) velocity.set(pc.attackFacing.x, 0, pc.attackFacing.z).multiplyScalar(lunge / dt);
        // The Vault's hop runs the path it measured at takeoff, over whatever is standing on it.
        const hop = pc.swingKind === 'special' && pc.attackTime > 0 && vault && pc.weapon.special?.vault ? vaultStep(pc.weapon.special, pc.swing.anticipation, vault.distance, pc.swing.duration - pc.attackTime + dt, dt) : 0;
        if (hop > 0 && dt > 0 && vault) velocity.copy(vault.dir).multiplyScalar(hop / dt);
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
          if (currentRoom.id === floor.goal && !stairClear()) { setNotice(`${goalRoom().name} · wardens bar the stair`); noticeTime = 4; }
          // Plan 017: a chamber with nobody in it has nothing to hold the knight for, so its ways on are
          // open the moment he arrives. Any other seals behind him until its last body falls.
          if (!cleared.has(roomId) && !stage.enemies.some(e => e.room === roomId)) { cleared.add(roomId); document.getElementById(`map-room-${roomId}`)?.setAttribute('fill', '#a8d5b0'); }
          const node = mapNode(floor, roomId); mapPlayer.current?.setAttribute('cx', String(node.x)); mapPlayer.current?.setAttribute('cy', String(node.y));
          const sprung = stage.enemies.filter(e => e.room === currentRoom.id && !e.awake && !e.dead && !e.buried);
          if (sprung.length) {
            sprung.forEach(e => { e.awake = true; e.group.visible = true; e.cooldown = Math.max(e.cooldown, 0.9); burst(e.group.position, 0xff4529, 10); });
            setNotice(`${currentRoom.name} · ambush`); noticeTime = 3; audio.play('warn'); shake = 0.12;
          } else if (!cleared.has(roomId) && currentRoom.id !== floor.goal) { setNotice(`${currentRoom.name} · sealed`); noticeTime = 2.5; audio.play('warn'); }
        }
        // The stair opens when the last warden falls and, like a rack, only ever offers: it takes the knight
        // down when he stands on it and presses the swap key, so the floor ends on a choice he made, never on
        // a step he took mid-swing.
        // An arm on the floor is only ever offered. Standing in the ring lights it and names it at the foot
        // of the screen; nothing leaves the knight's hand until he answers with the swap key, so walking
        // over a rack mid-fight — or dashing through one — cannot change the weapon he is swinging.
        if (drop) {
          overDrop = Math.hypot(player.position.x - drop.x, player.position.z - drop.z) < PICKUP_RADIUS;
          // The ring answers the step rather than a dwell, so it eases rather than fills: what it says now
          // is "this one is yours for the asking", and the asking is the key.
          ringLit += ((overDrop ? 1 : 0) - ringLit) * (1 - Math.exp(-11 * dt));
          drop.ring.material.opacity = .35 + ringLit * .6;
          drop.ring.scale.setScalar(1 + ringLit * .12);
          drop.group.rotation.y += dt * (overDrop ? 1.5 : .45);
        }
        // Plan 017: this chamber's ways out. Barred until it is clear, lit once it is, and brighter still
        // under the knight's feet, like the rack's ring: the door is his for the asking, and the asking is
        // the swap key.
        overDoor = null;
        for (const view of stage.doors) {
          if (view.door.from !== activeRoom) continue;
          const open = cleared.has(view.door.from), near = !crossing && Math.hypot(player.position.x - view.spot.x, player.position.z - view.spot.z) < DOOR_RADIUS;
          if (near) overDoor = view.door;
          view.lit += ((open ? .5 : 0) + (open && near ? .5 : 0) - view.lit) * (1 - Math.exp(-9 * dt));
          view.bars.visible = !open;
          view.veil.material.opacity = .08 + view.lit * .5; view.ring.material.opacity = .15 + view.lit * .7;
          view.sigil.rotation.y = t * 1.2; view.sigil.position.y = 1.25 + Math.sin(t * 2 + view.door.id) * .08; view.sigil.material.emissiveIntensity = .6 + view.lit * 1.6;
        }
        if (!stairOpen && stairClear()) openStair();
        if (stairOpen) {
          onStair = Math.hypot(player.position.x - stage.stairSpot.x, player.position.z - stage.stairSpot.z) < STAIR_RADIUS;
          // Eased like the rack's ring rather than filled: nothing is counting down, the stair is simply his.
          stairLit += ((onStair ? 1 : 0) - stairLit) * (1 - Math.exp(-11 * dt));
          const pulse = Math.sin(t * 3) * .1;
          if (stage.stairRing) { stage.stairRing.material.opacity = .75 + stairLit * .25 + pulse; stage.stairRing.scale.setScalar(1 + stairLit * .15); }
          // The shaft stays dark until the knight stands on it, then fills with light: the cue that the stair
          // is his to take, alongside the prompt naming the key.
          if (stage.stairLight) stage.stairLight.pool.value = .12 + stairLit * .74 + pulse * .3;
          ember.bid(lampAt.set(stage.stairSpot.x, .55, stage.stairSpot.z), Math.hypot(player.position.x - stage.stairSpot.x, player.position.z - stage.stairSpot.z), 9 + stairLit * 19, 0xfbc956);
        }
        // One prompt, asked once a frame, so the rack and the stair never take turns clearing each other's.
        showOffer(drop && overDrop ? drop.kind : stairOpen && onStair ? 'stair' : overDoor && cleared.has(overDoor.from) ? `door:${overDoor.id}` : null);
        if (gameStatus !== 'playing') return;
        for (const feature of stage.features) {
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
            if (!feature.used && near < 1.5 && run.hp < run.maxHp) { feature.used = true; heal(run, 35); setHealth(run.hp); audio.play('clear'); burst(player.position,0x71f4c4,20); setNotice('+35 vitality'); noticeTime = 2; }
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
              if (hurt(run, 10, { dashing: dashImmune(pc.dashTime) })) {
                setHealth(run.hp); hurtFlash = .65; shake = .1; audio.play('hurt'); burst(player.position,0xff4529,8);
                if(run.hp===0)endRun('hazard');
              }
            }
          }
        }

        const groundSpeed=pc.dashTime<=0&&dt>0?travelled/dt:0;
        gaitSpeed=THREE.MathUtils.damp(gaitSpeed,groundSpeed,14,dt);
        const previousPhase=walkPhase;
        if(groundSpeed>.05)walkPhase+=travelled*strideRate(gaitSpeed);
        if(Math.floor((previousPhase+Math.PI/2)/Math.PI)!==Math.floor((walkPhase+Math.PI/2)/Math.PI))audio.play('step');
        locomotion=playerRunPose(walkPhase,gaitSpeed);
        player.userData.legs.forEach((leg: THREE.Group, i: number) => { leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, locomotion.legs[i].hip, 28, dt);leg.userData.knee.rotation.x=THREE.MathUtils.damp(leg.userData.knee.rotation.x,locomotion.legs[i].knee,28,dt); });
        player.userData.arm.rotation.x=THREE.MathUtils.damp(player.userData.arm.rotation.x,pc.attackTime>0?-.35:locomotion.arm,20,dt);
        // Plan 013: the tabard is rigid plate, so it swings out ahead of whichever thigh leads rather than let it through.
        player.userData.tabard.rotation.x=Math.max(0,...player.userData.legs.map((leg:THREE.Group)=>leg.rotation.x))*.85;
        player.position.y = 0.03 + locomotion.height + Math.sin(t*2.4)*.012*Math.max(0,1-gaitSpeed) + (pc.swingKind === 'special' && pc.attackTime > 0 && vault && pc.weapon.special ? vaultHeight(pc.weapon.special, pc.swing.anticipation, pc.swing.duration - pc.attackTime) : 0);
        player.rotation.x = THREE.MathUtils.damp(player.rotation.x, pc.dashTime > 0 ? -0.3 : 0, 24, dt);
        player.userData.cape.rotation.x = THREE.MathUtils.damp(player.userData.cape.rotation.x, pc.dashTime > 0 ? -.8 : -locomotion.cape, 16, dt);
        // Plan 008: the SAME crossing the step sound plays on, resolved only now that the legs and the
        // body carry this update's pose, so the sole's world point is not last frame's. The boot's own
        // x/z, the support's sampled top for y; no support or a veil pending means no effect.
        const falls=footfalls(previousPhase,walkPhase,{dashing:pc.dashTime>0,dt,travelled});
        if(falls.length&&!building){
          player.updateWorldMatrix(true,true);
          for(const fall of falls){
            stepLog.contacts++;
            const boot=(player.userData.legs[fall.side] as THREE.Group).userData.boot as THREE.Mesh;
            soleAt.set(0,-.08,0);boot.localToWorld(soleAt);
            const support=footSupport(stage.surfaceIndex,soleAt.x,soleAt.z);
            if(!support){stepLog.skipped++;continue;}
            footsteps.emit({x:soleAt.x,y:support.y,z:soleAt.z},support.kind,{heading:velocity,reduced:easeMotion});stepLog.kinds[support.kind]++;
            stepLog.last={count:fall.count,side:fall.side,kind:support.kind,cell:support.cell,x:soleAt.x,y:support.y,z:soleAt.z};
          }
        }
        dashStep(pc, dt);
        // Bolts come back on their own clock, never on a cooldown, and the readout only moves when the
        // count does rather than every frame.
        if (pc.weapon.ranged && quiver < pc.weapon.ranged.capacity) {
          const back = reloadStep(quiver, pc.weapon.ranged.capacity, reload, pc.weapon.ranged.refill, dt);
          if (back.spare !== quiver) { quiver = back.spare; setAmmo({ held: quiver, of: pc.weapon.ranged.capacity }); }
          reload = back.timer;
        }
        const swung = swingStep(pc, dt);
        if (swung) {
          const wasLive = swung.wasLive;
          const pose=posePlayer(swung.age),active=pose.active;
          slash.update(dt,pose.trail,player.userData.sword,bladeInner,bladeTip);
          // Plan 016: a special's cooldown starts on its first live frame, so one dropped before it is free.
          // A Flashpoint whose every pool went out during its wind-up ends here instead, and costs nothing.
          const fizzled = pc.swingKind === 'special' && !!pc.weapon.special && active && !wasLive && !specialSpends(pc.weapon.special, { pools: pools.length });
          if (fizzled) { pc.attackTime = 0; pc.swingKind = 'strike'; pc.swing = pc.weapon; slash.clear(); posePlayer(0); }
          else if (pc.swingKind === 'special' && pc.weapon.special && active && !wasLive) {
            spendSpecial(run, pc.weapon.special.cooldown);
            if (pc.weapon.special.kind === 'charge') { impacts.slam(player.position, pc.swing.reach + run.reach, easeMotion); audio.play('toll'); shake = 0.14; burst(player.position, 0xf2c47b, 16); }
            // Stage C. The Whirl's ring goes down at the reach the ring is scored at, on the frame it is scored.
            if (pc.weapon.special.kind === 'whirl') { impacts.whirl(player.position, pc.swing.reach + run.reach, easeMotion); shake = 0.1; }
            // The Heavy Bolt: the whole quiver leaves as one bolt, down the line the draw showed.
            if (pc.weapon.special.kind === 'draw' && pc.swing.ranged && quiver > 0) {
              const mesh = boltPool.find(thrown => !thrown.visible), damage = drawDamage(pc.weapon, quiver);
              quiver = 0; reload = 0; setAmmo({ held: 0, of: pc.weapon.ranged?.capacity ?? 0 });
              if (mesh) {
                mesh.visible = true; mesh.scale.set(2, 2, 3.2);
                mesh.position.set(player.position.x, .95, player.position.z);
                mesh.rotation.y = Math.atan2(-pc.attackFacing.x, -pc.attackFacing.z);
                shots.push({ mesh, heavy: true, special: pc.weapon.special, shot: { x: player.position.x, z: player.position.z, dx: pc.attackFacing.x, dz: pc.attackFacing.z, speed: pc.swing.ranged.speed, life: pc.swing.ranged.flight, pierce: pc.swing.ranged.pierce, damage: damage + run.strike, spent: new Set<number>() } });
              }
              laneLife = .28; layLane(laneLength(floor.cells, player.position, pc.attackFacing.x, pc.attackFacing.z, pc.swing.ranged.speed * pc.swing.ranged.flight), .42, .9);
              audio.play('heavybolt'); shake = 0.12; burst(player.position.clone().add(new THREE.Vector3(pc.attackFacing.x * .8, 0, pc.attackFacing.z * .8)).setY(.95), 0xffd79a, 12);
            }
            // The Flashpoint: every pool goes up at once. Each body standing in any of them is caught once.
            if (pc.weapon.special.kind === 'detonate' && pools.length) {
              const marks: Mark[] = stage.enemies.map((e, index) => ({ x: e.group.position.x, z: e.group.position.z, index })).filter(mark => !stage.enemies[mark.index].dead && stage.enemies[mark.index].awake);
              const caught = flashpointHits(pools.map(live => live.pool), marks);
              for (const live of pools) {
                live.mesh.visible = false;
                const flare = flarePool.find(disc => !disc.mesh.visible);
                if (flare) { flare.mesh.visible = true; flare.mesh.position.set(live.pool.x, .08, live.pool.z); flare.mesh.scale.setScalar(live.pool.radius); flares.push({ ...flare, age: 0, radius: live.pool.radius }); }
                burst(new THREE.Vector3(live.pool.x, .5, live.pool.z), 0xffd27a, 8);
              }
              pools.length = 0;
              for (const index of caught) {
                const enemy = stage.enemies[index];
                if (enemy.dead || gameStatus !== 'playing') continue;
                // Fire's own blow (dungeon-hits' `burn`): no stagger and no shove, and a kill settles like any other.
                const killed = burnBody(enemy, pc.swing.damage + run.strike);
                burst(enemy.group.position, 0xe0202c, 10); blood.spawn(enemy.group.position, BESTIARY[enemy.kind].look.blood); impacts.emit(enemy.group.position, enemy.hp <= 0 ? 0xddebd3 : 0xffd27a, true);
                if (killed) { fell(enemy); settleRoom(enemy.room); }
              }
              audio.play('flashpoint'); shake = 0.16; pc.hitStop = caught.length ? 0.06 : 0;
            }
          }
          // The Harpoon: the spear itself leaves on the frame it goes live, down the same flight a bolt takes.
          if (pc.swingKind === 'special' && pc.weapon.special?.kind === 'throw' && pc.swing.ranged && active && !wasLive) {
            const mesh = boltPool.find(thrown => !thrown.visible);
            if (mesh) {
              mesh.visible = true; mesh.scale.set(1.7, 1.7, 2.6);
              mesh.position.set(player.position.x, .95, player.position.z);
              mesh.rotation.y = Math.atan2(-pc.attackFacing.x, -pc.attackFacing.z);
              shots.push({ mesh, harpoon: true, special: pc.weapon.special, shot: { x: player.position.x, z: player.position.z, dx: pc.attackFacing.x, dz: pc.attackFacing.z, speed: pc.swing.ranged.speed, life: pc.swing.ranged.flight, pierce: pc.swing.ranged.pierce, damage: pc.swing.damage + run.strike, spent: new Set<number>() } });
              harpoon = { mesh, phase: 'out', x: player.position.x, z: player.position.z, speed: pc.swing.ranged.speed, dragged: false };
              armed.group.visible = false;
            }
          }
          // One bolt on the frame the blade would have gone live. A dry quiver still plays the motion,
          // so running out is something the knight sees rather than something that silently does nothing.
          else if (!fizzled && pc.swingKind === 'strike' && pc.weapon.ranged && active && !wasLive) {
            if (quiver > 0) {
              quiver -= 1; setAmmo({ held: quiver, of: pc.weapon.ranged.capacity });
              const mesh = (pc.weapon.burst ? flaskPool : boltPool).find(thrown => !thrown.visible);
              if (mesh) {
                mesh.visible = true;
                mesh.position.set(player.position.x, .95, player.position.z);
                mesh.rotation.y = Math.atan2(-pc.attackFacing.x, -pc.attackFacing.z);
                shots.push({ mesh, shot: { x: player.position.x, z: player.position.z, dx: pc.attackFacing.x, dz: pc.attackFacing.z, speed: pc.weapon.ranged.speed, life: pc.weapon.ranged.flight, pierce: pc.weapon.ranged.pierce, damage: pc.weapon.damage + run.strike, spent: new Set<number>() } });
                audio.play('dash');
              }
            } else audio.play('warn');
          }
          // The lunge cuts what lies on the line it ran, from where it started to just ahead of the knight.
          const line = pc.swingKind === 'special' ? pc.weapon.special?.lunge : undefined;
          const lineTo = line ? { x: player.position.x + pc.attackFacing.x * line.width, z: player.position.z + pc.attackFacing.z * line.width } : null;
          // The Vault: nothing is cut in the air. On the frame he comes down he turns on the body he went over,
          // and that body alone is what the backstab is scored against.
          const vaulting = pc.swingKind === 'special' && pc.weapon.special?.kind === 'vault' ? pc.weapon.special : undefined;
          if (vaulting && vault && active && !vault.landed && vaultLanded(vaulting, pc.swing.anticipation, pc.swing.duration - pc.attackTime)) {
            vault.landed = true;
            if (vault.target && !vault.target.dead) { pc.attackFacing.x = vault.target.group.position.x - player.position.x; pc.attackFacing.z = vault.target.group.position.z - player.position.z; if (pc.attackFacing.x ** 2 + pc.attackFacing.z ** 2 > 1e-8) { normalise(pc.attackFacing); pc.facing.x = pc.attackFacing.x; pc.facing.z = pc.attackFacing.z; player.rotation.y = Math.atan2(-pc.facing.x, -pc.facing.z); } }
            audio.play('backstab'); impacts.land(player.position, pc.swing.reach + run.reach, easeMotion);
          }
          const scoring = pc.swingKind !== 'special' || (pc.weapon.special?.kind !== 'detonate' && pc.weapon.special?.kind !== 'draw' && (!vaulting || !!vault?.landed));
          if (!pc.swing.ranged && active && scoring) stage.enemies.forEach((enemy) => {
            if (gameStatus !== 'playing' || enemy.dead || !enemy.awake || swingHits.has(enemy)) return;
            if (vaulting && enemy !== vault?.target) return;
            // The same rule the node suite runs: inside the arc, and with no wall between the blade and the body.
            if (line && lineTo ? lineContacts(floor.cells, lungeFrom, lineTo, enemy.group.position, line.width, player.position) : swordContacts(floor.cells, player.position, pc.attackFacing, enemy.group.position, run.reach, pc.swing)) {
              audio.play('hit');
              swingHits.add(enemy);
              // What the blow does to the body is dungeon-hits'; what is left here is how it looks.
              const hit = landBlow(floor.cells, enemy, enemy.group.position, { ...pc.swing, damage: pc.swing.damage + run.strike }, awayFrom(player.position, enemy.group.position), facingOf(enemy));
              // Turned aside by a shield: a clang of sparks and a short freeze, and none of the wound below.
              if (hit.blocked) { enemy.blocked++; audio.play('warn'); burst(enemy.group.position, 0xdfe6ea, 10); shake = 0.05; pc.hitStop = 0.04; return; }
              if (hit.broke) {enemy.attackAge=Infinity;enemy.trails.forEach(trail=>trail.effect.clear());}
              burst(enemy.group.position, 0xffb24a, 3);
              // Plan 014 round 2: a blade landing was amber sparks alone, which is a spark's colour and
              // not a wound's - the reference always throws a red mist off a struck body.
              // Plan 014 round 8 (lever 3): 6 read as a puff, not a burst - the reference throws a real
              // spray of droplets off a struck body. 14 is inside the "10-20" the plan asked for and
              // still cheap: each is a pooled mesh already paid for by the spark burst beside it.
              // Stage C: a Whirl bleeds every body round it on one frame; eight droplets each keeps that frame
              // no dearer than a plain cleaver strike on the same bodies (frame-budget's strike-contact ceiling).
              burst(enemy.group.position, 0xe0202c, pc.swingKind === 'special' && pc.weapon.special?.kind === 'whirl' ? 8 : 22);
              blood.spawn(enemy.group.position, BESTIARY[enemy.kind].look.blood);
              impacts.emit(enemy.group.position,enemy.hp<=0?0xddebd3:0xffedbb,BESTIARY[enemy.kind].look.heavy);
              // Three sparks rather than seven. Each one is its own mesh and so its own draw call, and
              // next to a crescent, a bloom and a shockwave they were paying four calls at the most
              // expensive frame in the game for grit nobody could pick out.
              // One crescent for the cut, on the first body it finds: a swing that takes three is still one swing.
              if (swingHits.size === 1 && pc.swing.arc > -1) impacts.arc(player.position, Math.atan2(-pc.attackFacing.x, -pc.attackFacing.z), pc.swing.reach + run.reach);
              // Stage C: the backstab throws a heavy bloom of its own colour, on top of the crescent.
              if (vaulting) { impacts.emit(enemy.group.position, 0xbff7e6, true); burst(enemy.group.position, 0xbff7e6, 10); }
              // 70ms rather than 35. The freeze rounds up to whole frames, so this is five of them after
              // the blow and a held image six frames long at 60Hz, against three and four before: at this
              // character size two frames of stillness were not enough to find, because the eye reads the
              // pause rather than the pose. It also freezes the cut mid-arc now that the curve launches
              // early, so what is held is a blade across the body rather than one behind the shoulder.
              shake = 0.085; pc.hitStop = 0.07;
              if (hit.killed) { fell(enemy); settleRoom(enemy.room); }
            }
          });
        } else { posePlayer(0);slash.update(dt,false,player.userData.sword,bladeInner,bladeTip); }
        // A kill can open a boon draft, and a hazard can end the run, part-way through this update. Every
        // eligible hit and its exactly-once reward is resolved above; from here the world is frozen, so the
        // skeletons must not get one more move out of this tick.
        if (run.choosing || gameStatus !== 'playing') return;
        // A blow reaching the knight, from a body's swing or from its bolt. Which kind landed the killing
        // blow is the one thing only this call site knows.
        const hurtBy = (kind: EnemyKind, damage: number) => {
          if (gameStatus !== 'playing' || !hurt(run, damage, { dashing: dashImmune(pc.dashTime), warded: true })) return;
          setHealth(run.hp);
          audio.play('hurt'); hurtFlash=.35; shake=.12; burst(player.position,0xff4529,8);impacts.emit(player.position,0xff8763,BESTIARY[kind].look.heavy);
          if(run.hp===0)endRun(kind);
        };
        stage.enemies.forEach((enemy, index) => {
          if (!enemy.awake) { hideMarks(enemy); return; }
          // A neighbour's noticing beat can pull a still-dormant body in early; scripts/balance/sim.ts
          // carries the identical countdown so a room wakes the same way in both sims.
          if (enemy.alertIn < Infinity) { enemy.alertIn -= dt; if (enemy.alertIn <= 0) { if (enemy.notice <= 0) enemy.notice = dt; enemy.alertIn = Infinity; } }
          // Its bar, its glyph and its telegraph, off the state the last decision left; a corpse only falls.
          if (!markEnemy(enemy, camera, dt)) return;
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
            const wakeables: Wakeable[] = stage.enemies.map(e => ({ x: e.group.position.x, z: e.group.position.z, room: e.room, notice: e.notice, dead: e.dead || !e.awake }));
            nearbyDozers(wakeables, index).forEach((idx, rank) => {
              const delay = (rank + 1) * ALERT_STAGGER;
              if (delay < stage.enemies[idx].alertIn) stage.enemies[idx].alertIn = delay;
            });
          }
          if (intent.raise) raise(enemy, index);
          enemy.windup = intent.windup; enemy.lunge = intent.lunge; enemy.aim.set(intent.aim.x,0,intent.aim.z);
          if(previousWindup>0&&enemy.windup===0)enemy.attackAge=0;
          else if(previousWindup<=0&&enemy.windup>0)enemy.attackAge=Infinity;
          enemy.group.position.x = intent.x; enemy.group.position.z = intent.z;
          if (intent.sound) audio.play(intent.sound);
          if (intent.hit) hurtBy(enemy.kind, enemy.damage);
          // A volley becomes a bolt in the air; whether it finds the knight is decided as it flies, below.
          const bolt = BESTIARY[enemy.kind].bolt, arrow = intent.loose && bolt ? arrowPool.find(a => !a.visible) : undefined;
          if (intent.loose && bolt && arrow) {
            arrow.visible = true; arrow.position.set(enemy.group.position.x, .95, enemy.group.position.z); arrow.rotation.y = Math.atan2(-intent.loose.x, -intent.loose.z);
            hostile.push({ mesh: arrow, kind: enemy.kind, shot: hostileBolt(enemy.group.position, intent.loose, bolt, enemy.damage) });
          }
          // What the decision looks like: pose, gait, the landed blow's flash and its trails (dungeon-enemy-view).
          poseEnemy(enemy, intent, dt, t, elapsed);
        });
        // Separate bodies without moving a guard during its committed windup; the rule itself lives in
        // dungeon-enemy, and only the write back into the scene graph belongs here.
        const spread = separateCrowd(floor.cells, stage.enemies.map(e => ({ x: e.group.position.x, z: e.group.position.z, windup: e.windup, dead: e.dead || e.buried })), dt);
        stage.enemies.forEach((e, i) => { e.group.position.x = spread[i].x; e.group.position.z = spread[i].z; });
        // Bolts at the knight. The rule - stone stops them, a dash's opening frames let them through - is
        // dungeon-projectile's; the mesh, the sparks off stone and the hurt are what is left here.
        for (let i = hostile.length - 1; i >= 0; i--) {
          const live = hostile[i], flight = flyHostile(live.shot, floor.cells, player.position, dashImmune(pc.dashTime), dt);
          live.shot.x = flight.x; live.shot.z = flight.z; live.shot.life = flight.life; live.shot.pierce = flight.pierce;
          live.mesh.position.set(flight.x, .95, flight.z);
          if (flight.hit) hurtBy(live.kind, live.shot.damage);
          if (flight.struck) burst(new THREE.Vector3(flight.x, .95, flight.z), 0xbfa781, 4);
          if (flight.done) { live.mesh.visible = false; hostile.splice(i, 1); }
        }
        // A pyre's fire, burning the knight on the same clock the knight's own fire burns bodies on.
        for (let i = hostilePools.length - 1; i >= 0; i--) {
          const live = hostilePools[i], bite = poolStep(live.pool, dt);
          live.pool.life = bite.life; live.pool.timer = bite.timer;
          live.mesh.material.opacity = Math.min(.7, live.pool.life * .5) * (.75 + Math.sin(t * 11) * .25);
          ember.bid(lampAt.set(live.pool.x, .6, live.pool.z), Math.hypot(player.position.x - live.pool.x, player.position.z - live.pool.z), 13 * Math.min(1, live.pool.life), 0xff6a22);
          if (bite.bites && poolCatches(live.pool, player.position.x, player.position.z)) hurtBy(live.kind, live.pool.damage);
          if (live.pool.life <= 0) { live.mesh.visible = false; hostilePools.splice(i, 1); }
        }
        // Fire on the ground bites what stands in it: the only thing the knight owns that goes on working
        // after he has stopped paying attention to it. The rule is in dungeon-projectile.
        for (let i = pools.length - 1; i >= 0; i--) {
          const live = pools[i], burn = poolStep(live.pool, dt);
          live.pool.life = burn.life; live.pool.timer = burn.timer;
          live.mesh.material.opacity = Math.min(.7, live.pool.life * .5) * (.75 + Math.sin(t * 11) * .25);
          // Burning silt is a fire on the floor and was lighting none of it.
          ember.bid(lampAt.set(live.pool.x, .6, live.pool.z), Math.hypot(player.position.x - live.pool.x, player.position.z - live.pool.z), 13 * Math.min(1, live.pool.life), 0xff6a22);
          if (burn.bites) for (const enemy of stage.enemies) {
            if (enemy.dead || !enemy.awake || gameStatus !== 'playing') continue;
            if (!poolCatches(live.pool, enemy.group.position.x, enemy.group.position.z)) continue;
            const killed = burnBody(enemy, live.pool.damage);
            burst(enemy.group.position, 0xff8c38, 5);
            if (killed) {
              fell(enemy);
              settleRoom(enemy.room);
            }
          }
          if (live.pool.life <= 0) { live.mesh.visible = false; pools.splice(i, 1); }
        }
        // A detonated pool flares out a little past its fire and is gone in a third of a second; reduced motion
        // lets it fade where it burned.
        for (let i = flares.length - 1; i >= 0; i--) {
          const flare = flares[i]; flare.age += dt;
          const k = Math.min(1, flare.age / FLARE_LIFE);
          // The band runs from inside the fire out to its rim and a little past; reduced motion leaves it at the rim.
          const out = easeMotion ? 1 : 1 - (1 - k) ** 3;
          flare.mesh.scale.setScalar(flare.radius * (easeMotion ? 1 : 1 + .12 * out)); flare.mesh.material.opacity = (1 - k) ** 1.5;
          flare.glow.edge.value = easeMotion ? .93 : .62 + .33 * out; flare.glow.pool.value = .4 * (1 - k);
          if (k < .5) ember.bid(lampAt.set(flare.mesh.position.x, .6, flare.mesh.position.z), Math.hypot(player.position.x - flare.mesh.position.x, player.position.z - flare.mesh.position.z), 30 * (1 - k * 2), 0xffc070);
          if (k >= 1) { flare.mesh.visible = false; flares.splice(i, 1); }
        }
        // Bolts fly last, against where the bodies actually ended the frame. The rule is in
        // dungeon-projectile; what belongs here is the mesh, the sparks and the damage call.
        if (shots.length) {
          const marks: Mark[] = stage.enemies.map((e, index) => ({ x: e.group.position.x, z: e.group.position.z, index })).filter(mark => !stage.enemies[mark.index].dead && stage.enemies[mark.index].awake);
          for (let i = shots.length - 1; i >= 0; i--) {
            const live = shots[i], flight = flyShot(live.shot, floor.cells, marks, dt);
            live.shot.x = flight.x; live.shot.z = flight.z; live.shot.life = flight.life; live.shot.pierce = flight.pierce;
            live.mesh.position.set(flight.x, .95, flight.z);
            for (const index of flight.hits) {
              const enemy = stage.enemies[index];
              if (enemy.dead || gameStatus !== 'playing') continue;
              audio.play('hit');
              // A special's bolt (the Harpoon, the Heavy Bolt) carries the special's numbers, a plain bolt the arm's.
              // The first body the spear takes that is not steadfast is hauled in rather than shoved; a warden only staggers.
              const hurled = live.special, thrown = hurled ? hurledBlow(hurled, { harpoon: !!live.harpoon, damage: live.shot.damage }, { free: !!harpoon && !harpoon.dragged, steadfast: !!BESTIARY[enemy.kind].steadfast }) : null;
              const drags = !!thrown?.drags;
              const blow = thrown ? thrown.blow : { ...pc.weapon, damage: live.shot.damage };
              const hit = landBlow(floor.cells, enemy, enemy.group.position, blow, { x: live.shot.dx, z: live.shot.dz }, facingOf(enemy));
              if (hit.blocked) { enemy.blocked++; audio.play('warn'); burst(enemy.group.position, 0xdfe6ea, 8); continue; }
              if (hit.broke) { enemy.attackAge = Infinity; enemy.trails.forEach(trail => trail.effect.clear()); }
              if (drags && hurled?.hurl && harpoon) {
                harpoon.dragged = true;
                const pull = dragToward(enemy.group.position, player.position, hurled.hurl.drag);
                moveOnFloor(floor.cells, enemy.group.position, pull.x, pull.z);
              }
              burst(enemy.group.position, 0xffb24a, 7); burst(enemy.group.position, 0xe0202c, 22); blood.spawn(enemy.group.position, BESTIARY[enemy.kind].look.blood); impacts.emit(enemy.group.position, enemy.hp <= 0 ? 0xddebd3 : 0xffedbb, BESTIARY[enemy.kind].look.heavy || !!live.heavy);
              shake = live.heavy ? 0.09 : 0.05; pc.hitStop = 0.025;
              if (hit.killed) {
                fell(enemy);
                settleRoom(enemy.room);
              }
            }
            // Stone stops a bolt as surely as it stops steel, and says so.
            if (flight.struck) burst(new THREE.Vector3(flight.x, .95, flight.z), 0xbfa781, 5);
            if (live.harpoon && harpoon) { harpoon.x = flight.x; harpoon.z = flight.z; }
            // The spear does not fall where it stops: it turns and comes home, below.
            if (flight.done && live.harpoon) { shots.splice(i, 1); if (harpoon) harpoon.phase = 'back'; }
            else if (flight.done) {
              live.mesh.visible = false; shots.splice(i, 1);
              if (live.heavy) { live.mesh.scale.set(1, 1, 1); continue; }
              if (pc.weapon.burst) {
                const mesh = poolMeshes.find(ring => !ring.visible);
                if (mesh) {
                  mesh.visible = true; mesh.position.set(flight.x, .07, flight.z);
                  mesh.scale.setScalar(pc.weapon.burst.radius);
                  pools.push({ mesh, pool: { x: flight.x, z: flight.z, radius: pc.weapon.burst.radius, life: pc.weapon.burst.life, damage: pc.weapon.burst.damage, interval: pc.weapon.burst.interval, timer: 0 } });
                  burst(new THREE.Vector3(flight.x, .4, flight.z), 0xff8c38, 18); audio.play('warn'); shake = 0.06;
                }
              }
            }
          }
        }
      }
      if (hasStarted && gameStatus === 'playing') {
        // Plan 016. The spear on its way home: straight at the knight, caught the step it reaches him.
        if (harpoon && harpoon.phase === 'back') {
          const home = homeStep(harpoon, player.position, harpoon.speed, dt);
          harpoon.x = home.x; harpoon.z = home.z;
          harpoon.mesh.position.set(home.x, .95, home.z);
          harpoon.mesh.rotation.y = Math.atan2(player.position.x - home.x, player.position.z - home.z);
          if (home.home) catchHarpoon();
        }
        // The maul's ring on the floor while it is wound: it grows to the slam's own radius as the charge
        // passes its minimum, and brightens the moment letting go would slam rather than cancel.
        const special = pc.weapon.special;
        if (charging !== null && special?.radius) {
          const level = chargeLevel(special, charging), primed = chargeReleases(special, charging);
          const radius = primed ? special.radius[0] + (special.radius[1] - special.radius[0]) * level : special.radius[0] * Math.min(1, charging / (special.chargeMin ?? 1));
          chargeRing.visible = true; chargeRing.position.set(player.position.x, .07, player.position.z);
          chargeRing.scale.setScalar(Math.max(.05, radius + run.reach) / .95); chargeRing.material.opacity = primed ? .5 + level * .3 : .25;
        } else chargeRing.visible = false;
        // The Heavy Bolt's line: faint and thin while drawing, fuller once drawn; after the release, the bright
        // line the bolt was fired down fades on its own clock.
        if (laneLife > 0) { laneLife = Math.max(0, laneLife - frameDt); lane.material.opacity = .9 * (laneLife / .28) ** 1.4; if (laneLife === 0) lane.visible = false; }
        else if (charging !== null && special?.draw && special.swing.ranged) { const full = drawn(special, charging); layLane(laneLength(floor.cells, player.position, pc.facing.x, pc.facing.z, special.swing.ranged.speed * special.swing.ranged.flight), full ? .2 : .1, full ? .38 : .16 * Math.min(1, charging / (special.chargeMax ?? 1))); }
        else lane.visible = false;
        // Decision 4: the moment it comes back is heard and seen on the blade, not only in the HUD sweep.
        const ready = specialAvailable(special, { cooled: specialReady(run), quiver, out: !!harpoon });
        if (special && ready && !specialWasReady) {
          audio.play('ready'); glintTime = .6;
          player.updateWorldMatrix(true, true); (player.userData.sword as THREE.Group).localToWorld(glintAt.copy(bladeTip)); burst(glintAt, 0xffb24a, 6);
        }
        specialWasReady = ready; glintTime = Math.max(0, glintTime - dt);
      }
      if (noticeTime > 0) { noticeTime = Math.max(0,noticeTime-frameDt); if (noticeTime === 0) setNotice(''); }
      if (rewardTime > 0) { rewardTime = Math.max(0, rewardTime - frameDt); if (rewardTime === 0) setXpReward(0); }
      sparks.update(dt);
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt); tickRun(run, dt);
      stage.atmosphere?.update(t,player.position,cleared,mood.fire,mood.banner,mood.masonry,mood.bed);
      // Plan 007: the atmosphere pass just wrote the animated colour every eligible material carries;
      // copy it onto each material's cutaway variant, which is what every registered mesh actually
      // renders with now. Never Material.copy, never a new material, just the handful of scalars.
      cutaway.syncMaterials();
      // The parapet is carved work too, built here rather than in the atmosphere pass but lit the same.
      stage.parapetSkin?.color.copy(mood.masonry);
      const nearest = nearestFirst(stage.atmosphere?.torchPositions ?? [], torchLights.length, (a) => a.distanceToSquared(player.position), nearTorches);
      // Three of the four go to their sconces. The fourth is settled below, once
      // the accents have had their chance to ask for it.
      for (let i = 0; i < torchLights.length - 1; i++) if (nearest[i]) torchLights[i].position.copy(nearest[i]);
      const anchors = stage.atmosphere?.lightAnchors ?? [];
      const lent = anchors.length <= ANCHOR_LIGHTS ? anchors : nearestFirst(anchors, ANCHOR_LIGHTS, (a) => (a.x-player.position.x)**2+(a.z-player.position.z)**2, nearAnchors);
      anchorLights.forEach((light, i) => { const a = lent[i]; if (!a) { light.intensity = 0; return; } light.position.set(a.x, a.y, a.z); light.color.setHex(a.color); light.intensity = a.intensity; light.distance = a.distance; });
      fill.position.copy(player.position).add(FILL_OFFSET);
      mood.move(1 - Math.exp(-6 * frameDt), floor, player.position.x, player.position.z);
      playerRing.position.set(player.position.x,0.04,player.position.z); (playerRing.material as THREE.MeshBasicMaterial).opacity = pc.dashTime > 0 ? 0.85 : 0.14; ringTime.value = t;
      moon.position.copy(player.position).setY(0).add(MOONRISE); moon.target.position.set(player.position.x,0,player.position.z); moon.target.updateMatrixWorld();
      if (dashMeter.current) dashMeter.current.value = Math.max(0,1-pc.dashCooldown/run.dashSpan);
      if (dashSweep.current) dashSweep.current.style.setProperty('--ready', String(Math.max(0,Math.min(1,1-pc.dashCooldown/run.dashSpan))));
      if (specialSweep.current) { specialSweep.current.style.setProperty('--ready', String(pc.weapon.special ? harpoon ? 0 : pc.weapon.special.draw ? quiver > 0 ? 1 : Math.min(1, reload / (pc.weapon.ranged?.refill ?? 1)) : Math.max(0, Math.min(1, 1 - run.specialCooldown / pc.weapon.special.cooldown)) : 1)); specialSweep.current.parentElement?.classList.toggle('special-ready', glintTime > 0); }
      const target = focusAhead.copy(player.position).addScaledVector(velocity,0.12); cameraFocus.lerp(target,1-Math.exp(-8*frameDt));
      camera.position.set(cameraFocus.x + 9.2,12.5,cameraFocus.z + 11.5);
      // Reduced motion drops the shake outright: it is ~90 Hz camera translation that carries nothing the
      // particles, the sound and the health bar do not already say, so nothing is lost by not moving at all.
      if (shake > 0 && !easeMotion) camera.position.add(shakeBy.set(Math.sin(t*95)*shake,0,Math.cos(t*83)*shake));
      camera.lookAt(cameraFocus.x,0,cameraFocus.z);
      // Plan 007: resolve this frame's cutaway targets after the camera has its final position for the
      // frame, so the view-space centres this writes are never a frame stale. Eligibility mirrors the
      // existing threat cue exactly (`enemy.windup>0||(enemy.lunge>0&&enemy.attackAge<.09)`) rather than
      // introducing a second definition of "attacking" - an idle guard, a corpse, a dormant ambush or a
      // neighbour-room enemy is never in this list at all, which is what clears its slot at once rather
      // than fading it. `dt`, not `frameDt`, so hit-stop holds a fade exactly where it was.
      cutaway.update(camera, gameStatus === 'playing' ? { position: player.position } : null,
        gameStatus === 'playing' ? stage.enemies.reduce<CutawayEnemyCandidate[]>((list, enemy, index) => {
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
    const hooks = window as HookedWindow;
    // Drive the run from the console
    const testHooks: TestHooks = {
      // The mood snaps rather than sliding. Crossing a threshold on foot is worth a third of a second
      // of cross-fade; arriving somewhere by fixture is not a walk, and a driver that teleports into a
      // chamber to photograph it would otherwise catch the lights still on their way there.
      teleport: (x, z) => {player.position.set(x, 0.03, z);mood.snap();slash.clear();cutaway.clear();footsteps.clear();},
      // Fixture setup, like teleport: put a named arm in hand without walking a rack down. An unknown id
      // arms the Tideblade rather than leaving the knight empty-handed, as weaponById does everywhere.
      equip: (id) => { equip(weaponById(id).id); setHeldWeapon(weaponById(id).name); },
      descend: () => buildFloor(Math.min(FLOORS, level + 1)),
      // The optional seed (plan 015 Stage C.2) is additive: every existing one-argument call still draws
      // from the pinned queue exactly as before. It exists so a test can build the same floor twice, once
      // through this synchronous path and once through the sliced boot/restart path, and compare them.
      buildFloor: (nextLevel, seed) => buildFloor(nextLevel, seed),
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
        setArena(null);
        hasStarted = false; setStarted(false); setCapturing(null); enterWhenBuilt = false; setEntering(false);
        elapsed = 0; runStart = 0; floorStart = 0; activeRoom = 0;
        // A fresh page has never seen the cursor. The veil used to clear this by covering the canvas for a few
        // frames (Chrome then sends it a pointerleave), but a reset under the driver's clock draws none.
        pointerNdc = null; mouseHeld = 0; claimAim('keys');
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
      // Plan 007: read-only target/material state for a browser spec, and a same-frame A/B toggle
      // that never touches a target's own state (see `uCutawayEnabled` in dungeon-occlusion.ts).
      testHooks.cutawayDiagnostics = () => cutaway.diagnostics();
      testHooks.setCutawayEnabled = (enabled) => cutaway.setEnabled(enabled);
      // Plan 008: every live footstep particle's world state, and a same-frame A/B draw toggle that never
      // touches a particle.
      testHooks.footstepParticles = () => footsteps.particles();
      testHooks.setFootstepsEnabled = (enabled) => footsteps.setEnabled(enabled);
      // Hides one body's rig and nothing else - its ground mark is drawn outside it - so a pixel test of
      // the telegraph can difference the mark alone, not the mark plus a body flashing the same red.
      testHooks.setEnemyRigVisible = (index, visible) => { const rig = stage.enemies[index]?.group.userData.rig as THREE.Object3D | undefined; if (!rig) throw new Error(`no enemy at spawn index ${index}`); rig.visible = visible; };
      // The arena (dungeon-arena.ts), synchronous and deterministic like `buildFloor`: this roster, awake in
      // the gate of this floor, until `reset`.
      testHooks.buildArena = (roster, arenaLevel = 1) => { setArena(roster.length ? { roster: [...roster], level: arenaLevel } : null); buildFloor(arenaLevel); };
      // The menu's arena page asks through this event, never through `dungeon-action`, so nothing about it
      // exists in a production build. Before the first floor exists it is a press of ENTER with the arena
      // set, which the boot then charts; once the keep is up it is a restart into the arena, entering it if
      // the knight was still on the menu. An empty roster leaves the arena for an ordinary keep.
      const arenaRequest = (e: Event) => {
        const asked = (e as CustomEvent<Arena | null>).detail;
        setArena(asked && asked.roster.length ? { roster: [...asked.roster], level: asked.level } : null);
        if (building || booting || (built && !warmed)) return;
        if (!built) { window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' })); return; }
        audio.start();
        restart(undefined, hasStarted ? undefined : enter);
      };
      window.addEventListener('dungeon-arena', arenaRequest);
      dropArenaListener = () => window.removeEventListener('dungeon-arena', arenaRequest);
      // Plan 009: the model round's shared diagnostic - meshes, triangles and height per figure, read off
      // the live scene - with every dispose that has reached one of the knight's run-scoped materials.
      const knightDisposals = countDisposals(player);
      testHooks.actorStats = () => {
        const held = drop ? actorStat(drop.group) : null;
        return { knight: { ...actorStat(player), disposedMaterials: knightDisposals() }, enemies: stage.enemies.filter(e => !e.dead).map(e => ({ kind: e.kind, ...actorStat(e.group) })), drop: drop && held ? { kind: drop.kind, meshes: held.meshes, triangles: held.triangles } : null };
      };
      testHooks.textureHash = textureHash;
      testHooks.drainGpu = () => drainGpu(renderer);
      testHooks.lightDiagnostics = (index, radius = 2) => lightDiagnostics(scene, stage.enemies[index], index, radius);
      // Moves actors the floor already spawned and nothing else; the refusals are in dungeon-fixture.ts.
      testHooks.configureCombatFixture = (fixture) => applyCombatFixture(fixture, { started: hasStarted, held: isPaused || manualTime, run, enemies: stage.enemies, canStand: (x, z) => canStand(floor.cells, x, z), healthSet: setHealth });
    }
    const advanceTime = (ms: number, draw = true) => {
      manualTime = true;
      if (faulted) throw new Error('the keep has stopped; reload to start again');
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      // The driver hears the throw as well as seeing the screen: a stepped test fails where it happened.
      try {
        for (let i = 0; i < steps; i++) update(ms / steps / 1000);
        if (draw) { post.render(elapsed); }
      } catch (error) { fail(error); throw error; }
    };
    const renderText = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: !hasStarted ? 'ready' : isPaused ? 'paused' : gameStatus, building, fault: faulted, boonOffer: run.choosing, muted: isMuted, roomName: floor.rooms[activeRoom]?.name ?? 'Passage',
      arena: arena ? { roster: [...arena.roster], level: arena.level } : null,
      health: run.hp, maxHealth: run.maxHp, rank: run.rankLevel, weapon: { id: pc.weapon.id, name: pc.weapon.name, damage: pc.weapon.damage, reach: pc.weapon.reach, duration: pc.weapon.duration, strikeDamage: pc.weapon.damage + run.strike, ranged: !!pc.weapon.ranged, quiver: pc.weapon.ranged ? quiver : null, capacity: pc.weapon.ranged ? pc.weapon.ranged.capacity : null, inFlight: shots.length, fires: pools.length, pools: pools.map(live => ({ x: live.pool.x, z: live.pool.z })), special: pc.weapon.special ?? null }, hostileBolts: hostile.map(h => ({ kind: h.kind, x: h.shot.x, z: h.shot.z, dx: h.shot.dx, dz: h.shot.dz, damage: h.shot.damage })), hostilePools: hostilePools.map(h => ({ kind: h.kind, x: h.pool.x, z: h.pool.z, radius: h.pool.radius, life: h.pool.life, damage: h.pool.damage })), boons: { strike: run.strike, reach: run.reach, draught: run.draught, dashSpan: run.dashSpan, guardAgainst: run.guardAgainst }, remaining: stage.enemies.filter(e => !e.dead && !e.buried).length,
      objective: { floor: level, floors: FLOORS, goal: goalRoom().name, goalRoom: floor.goal, halls: reached, goalDepth: goalRoom().depth, atStair: activeRoom === floor.goal, stairClear: stairClear(), stairOpen, onStair: stairOpen && onStair },
      chamber: { id: activeRoom, layer: floor.rooms[activeRoom]?.layer ?? -1, reward: floor.rooms[activeRoom]?.reward ?? null, sealed: !cleared.has(activeRoom), crossing: crossing ? (crossing.flipped ? 'in' : 'out') : null, doors: stage.doors.filter(view => view.door.from === activeRoom).map(view => ({ id: view.door.id, to: view.door.to, sign: doorSign(floor.rooms[view.door.to]), x: view.spot.x, z: view.spot.z, radius: DOOR_RADIUS, open: !view.bars.visible, over: overDoor?.id === view.door.id })) },
      stair: { x: stage.stairSpot.x, z: stage.stairSpot.z, radius: STAIR_RADIUS },
      drop: drop ? { x: drop.x, z: drop.z, kind: drop.kind, radius: PICKUP_RADIUS, over: overDrop, offered: offered === 'stair' || offered?.startsWith('door:') ? null : offered } : null,
      experience: { total: run.totalXp, perEnemy: XP_PER_ENEMY, intoRank: run.rankProgress, rankCost: rankCost(run.rankLevel), resetsOnNewRun: true },
      render: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: post.sceneCost.calls, triangles: post.sceneCost.triangles, frames: post.frames, shadow: post.shadow, passes: post.composer.passes.map(pass => pass.constructor.name), pointLights: pointLightCount(scene), programs: linkedPrograms(renderer), warmUp, quality: post.quality },
      effects: { impacts: impacts.active, sparks: sparks.active, shock: impacts.shock, flares: flares.length, lane: lane.visible ? { length: lane.scale.y * 1.15, opacity: lane.material.opacity } : null, footsteps: { active: footsteps.active, drawn: footsteps.mesh.visible, emitted: footsteps.emitted, contacts: stepLog.contacts, skipped: stepLog.skipped, kinds: { ...stepLog.kinds }, last: stepLog.last } },
      // Added keys, never changed ones: `muted` above still means what it always did. `filter` is what the
      // canvas is actually wearing this frame, so a driver can see the hurt tint rather than infer it.
      aim: { device: aimDevice, ndc: pointerNdc, span: viewSpan, aspect: viewAspect, pad: padLook },
      settings: { ...settingsRef.current, reduceMotion: easeMotion, filter: renderer.domElement.style.filter, shake, hitStop: pc.hitStop, sound: audio.level() },
      // The camera's rest position is focus plus a fixed offset, so anything left over is the shake — which
      // makes "reduced motion actually stopped the camera moving" something a driver can read rather than see.
      camera: { x: camera.position.x, z: camera.position.z, focusX: cameraFocus.x, focusZ: cameraFocus.z, restX: cameraFocus.x + 9.2, restZ: cameraFocus.z + 11.5 },
      features: stage.features.map(f => ({room:f.room, shrine:f.shrine, used:f.used, burned:f.burned, phase:f.phase, x:f.mesh.position.x,z:f.mesh.position.z,radius:f.shrine?1.5:1.8})),
      buildMs,
      // What the chamber is actually being lit with this frame, as hex. A driver measuring whether a
      // tell reads against the stone it is drawn on needs to know which family it is standing in, and
      // the room graph cannot tell it: the lights cross a threshold on the approach rather than on the
      // doorway, so for a third of a second the answer is genuinely neither room's.
      mood: { theme: mood.theme, fire: '#' + mood.fire.getHexString(), key: '#' + mood.key.getHexString(), fog: '#' + mood.fog.getHexString(), banner: '#' + mood.banner.getHexString(), halos: stage.atmosphere?.halos ?? [] },
      // What actually got attached to the floor's own group, not a second recomputation of the
      // planner's own descriptors - a driver checking the real scene reads this, not `floor.rooms`.
      graphics: { motifs: stage.atmosphere?.motifs ?? [], flames: stage.atmosphere?.flames ?? [], paving: stage.pavingSummary },
      floor: { level, waterfalls: stage.atmosphere?.waterfalls, seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, start: floor.start, goal: floor.goal, spine: floor.spine, visited: [...visited], cleared: [...cleared] },
      player: { x: player.position.x, z: player.position.z, facing: { x: pc.facing.x, z: pc.facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime: pc.attackTime, attackBuffer: pc.attackBuffer, dashBuffer: pc.dashBuffer, dashTime: pc.dashTime, dashCooldown: pc.dashCooldown, chain: { beat: pc.chainBeat, beats: chainLength(pc.weapon), idle: Number.isFinite(pc.chainIdle) ? pc.chainIdle : null, damage: pc.swing.damage + run.strike, duration: pc.swing.duration }, invulnerable: run.invuln, hurtFlash, special: pc.weapon.special ? { id: pc.weapon.special.id, ready: specialAvailable(pc.weapon.special, { cooled: specialReady(run), quiver, out: !!harpoon }), cooldown: run.specialCooldown, charging: charging !== null, charge: charging !== null ? chargeLevel(pc.weapon.special, charging) : 0, held: charging ?? 0, live: pc.swingKind === 'special' && pc.attackTime > 0, buffered: specialBuffer, harpoon: harpoon ? { phase: harpoon.phase, x: harpoon.x, z: harpoon.z } : null, bare: !!harpoon, vault: vault ? { target: vault.target ? stage.enemies.filter(e => !e.dead).indexOf(vault.target) : null, distance: vault.distance, landed: vault.landed } : null } : null, swordAngle: player.userData.sword.rotation.y, cloak:{anchor:player.userData.cape.position.toArray(),pitch:player.userData.cape.rotation.x}, pose: {bodyYaw:player.userData.torso.rotation.y,trail:slash.mesh.visible,trailTriangles:slash.mesh.geometry.drawRange.count/3}, locomotion: {speed:gaitSpeed,phase:walkPhase,sprint:locomotion.sprint,pitch:player.userData.torso.rotation.x,height:player.position.y,arm:player.userData.arm.rotation.x,tabard:player.userData.tabard.rotation.x,knees:player.userData.legs.map((leg:THREE.Group)=>leg.userData.knee.rotation.x)}, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      corpses: stage.enemies.filter(e=>e.dead).map(e=>({kind:e.kind,x:e.group.position.x,y:e.group.position.y,z:e.group.position.z,scale:e.group.scale.toArray(),rotation:e.group.userData.rig.rotation.x,age:e.death?.age,settled:e.death?.settled,visible:e.group.visible,cue:e.cue.visible,bar:e.bar.visible,trails:e.trails.some(trail=>trail.effect.mesh.visible)})),
      enemies: stage.enemies.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, kind: e.kind, buried: e.buried, summoner: e.summoner, blocked: e.blocked, visible: e.group.visible, windup: e.windup, lunge: e.lunge, cooldown: e.cooldown, aim: {x:e.aim.x,z:e.aim.z}, room: e.room, awake: e.awake, pose: {shieldArm:e.group.userData.limbs[0].rotation.x,shieldTilt:e.group.userData.shield.rotation.x,pitch:e.group.userData.rig.rotation.x,height:e.group.userData.rig.position.y,weapon:e.group.userData.weapon.rotation.x,weaponYaw:e.group.userData.weapon.rotation.y,attackAge:Number.isFinite(e.attackAge)?e.attackAge:null,trails:e.trails.filter(trail=>trail.effect.mesh.visible).length,cue:e.cue.visible} })),
    });
    const animate = (now: number) => {
      if (stopped || faulted) return; raf = requestAnimationFrame(animate);
      // rAF timestamps describe the frame start, which can precede effect setup.
      // Establish the clock on the first callback so startup cannot run time backwards.
      // Plan 015 Stage C fix round: `!building` too. A sliced restart or descent swaps `gameStatus` to
      // 'playing' and `floor` to the new one in its first slices, while `enemyData`, `atmosphere` and
      // `surfaceIndex` still belong to the old, already-disposed floor until later phases (the player's
      // own position does not move until 'upload') - `update` and a draw in that window ran the sim and
      // drew a half-built floor under real time, which manual time never caught since every pooled and
      // isolated scenario steps it by hand. `stagedBuild`'s own two warm-up `post.render` calls are
      // direct, not gated here, and are unaffected.
      if (built && warmed && !building && !manualTime && !document.hidden) {
        try { update(frameDelta(now, last)); }
        catch (error) { fail(error); return; }
        // Plan 015 Stage B: a frozen frame (paused, drafting, complete, or simply nothing since invalidated)
        // matches the one already on screen, so it is not redrawn. `update` sets `dirty` itself whenever it
        // actually advances; everything else that can change the picture while frozen sets it directly.
        if (dirty) { try { post.render(elapsed); } catch (error) { fail(error); return; } dirty = false; }
      }
      last = now;
    };
    // Plan 015: no `raf = requestAnimationFrame(animate)` here any more - a page nobody enters must
    // never ask for a frame. The loop is kicked off from `boot` below instead, the one place that runs
    // on demand; `animate` keeps re-requesting itself every tick after that, and stays a no-op draw-wise
    // (see the `built && warmed` guard above) until stagedBuild's own warm-up frames have run.
    // Plan 014: zoomed in close to the reference's framing - the knight fills much more of the
    // frame than the old 7.2/6.3 span left him. Ratio kept the same between the two breakpoints.
    // Then eased back out a fifth twice (4.3/3.76 -> 5.16/4.51 -> 6.19/5.41): the tight frame hid too much of the room.
    const resize = () => { canvasRect = null; const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h, span = w < 600 ? 5.41 : 6.19; viewSpan = span; viewAspect = aspect; camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix(); renderer.setSize(w, h); post.resize(w, h); dirty = true; };
    window.addEventListener('resize', resize); resize();
    // Plan 015: the keep is raised on the press that asks for it (`enterWhenBuilt`/`bootSeed` below),
    // never at mount, so the hydrated menu's button is live from the first frame and a press before the
    // floor exists raises the loading bar rather than vanishing into a blocked thread. The hooks go up
    // with the floor, because every one of them reads it. A held press is answered one frame later
    // still, once the floor has actually been drawn, so the bar lifts onto the keep rather than onto an
    // empty canvas. A background tab runs no animation frames at all, and a boot that waited on them
    // would sit unbuilt until the tab came forward; a hidden page has nothing to paint first, so a timer
    // stands in.
    let bootFrame = 0, bootTimer = 0;
    const scheduleBoot = () => {
      cancelAnimationFrame(bootFrame); clearTimeout(bootTimer);
      bootFrame = requestAnimationFrame(() => { bootFrame = requestAnimationFrame(boot); });
      if (document.hidden) bootTimer = window.setTimeout(boot, 200);
    };
    // Plan 014 round C, on demand since plan 015: floor 1 is raised in the same stages as any other
    // build (see `stagedBuild`), behind the veil the press that called `scheduleBoot` just raised.
    // `booting` keeps a press that reschedules the boot from starting a second one mid-way. The floor
    // counts as built - and the hooks go up, since every one of them reads it - as soon as it exists; it
    // counts as warmed once the shaders are linked and a frame of it has been presented, which is when
    // the frame loop starts drawing, the canvas fades in and a waiting press is answered.
    let booting = false;
    const boot = () => {
      if (stopped || built || booting) return;
      booting = true;
      // Plan 015 Stage C.1: also claims `veiled`'s own `building` flag, not just `booting`. Before the
      // compile's wait moved off the main thread (see `pollProgramsReady`), a boot's own stagedBuild call
      // finished within one synchronous burst, so nothing else ever got a turn to run while it was in
      // flight. Now it can span real seconds of async polling, and without this a `dungeonTest.reset()`
      // or a restart landing in that window sailed straight past `veiled`'s guard (which only ever
      // checked `building`, never `booting`) and started a second, concurrent stagedBuild - whichever one
      // finished first superseded the other via `buildToken`, and if that was this boot, its own `.then`
      // saw `ok === false` and returned before ever setting `warmed`, wedging every future press behind
      // `enterWhenBuilt` with nothing left to answer it. `building` now covers both paths uniformly.
      building = true;
      // The frame loop's first request, moved here from mount (plan 015): this is the one place a boot
      // actually starts, so it is also the one place a page that never enters never reaches.
      if (!raf) raf = requestAnimationFrame(animate);
      const bootLevel = arena?.level ?? 1;
      void stagedBuild(bootLevel, bootSeed, (token) => driveSliced(buildFloorSteps(bootLevel, bootSeed), token), () => {
        built = true;
        hooks.dungeonTest = testHooks; hooks.advanceTime = advanceTime; hooks.render_game_to_text = renderText;
      }).then((ok) => {
        booting = false; building = false; setVeilStage(0);
        if (!ok) return;
        warmed = true; setReady(true);
        if (!enterWhenBuilt) return;
        const seed = enterSeed; enterSeed = undefined;
        if (seed === undefined || seed === floor.seed) enter(); else restart(seed, enter);
      }).catch(fail);
    };
    // Plan 015: no boot at mount. `scheduleBoot`'s only caller is now the press path (`enterWhenBuilt`
    // above), so a visit that never presses ENTER never builds a floor, compiles a shader or requests a
    // frame. `?boot=eager`, dev-only, restores today's mount-time boot for the test harness, which wants
    // a floor built (and its hooks up) the moment a scenario's page is up without spending every test on
    // a press; kept out of production the same way `configureCombatFixture` is, and passed on every
    // harness `goto` (`tests/browser/helpers.ts`). Scenarios that test the boot itself load the plain URL.
    if (process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('boot') === 'eager') scheduleBoot();
    return () => { stopped = true; dropArenaListener?.(); cancelAnimationFrame(raf); cancelAnimationFrame(bootFrame); clearTimeout(bootTimer); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('resize', resize); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointerleave', pointerGone); canvas.removeEventListener('pointerenter', pointerBack); window.removeEventListener('pointerdown', pausedDown); canvas.removeEventListener('contextmenu', noMenu); window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange',visibility); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('webglcontextrestored', contextRestored); audio.dispose(); cutaway.dispose(); stage.atmosphere?.dispose(); texture.dispose(); telegraphTex.dispose(); laneTex.dispose(); alertTex.dispose(); alertMaterial.dispose(); environment.dispose(); impacts.dispose(); blood.dispose(); footsteps.dispose(); applyRef.current = null; delete hooks.advanceTime; delete hooks.render_game_to_text; delete hooks.dungeonTest; scene.traverse((o) => { if (o instanceof THREE.Mesh) { if(o instanceof THREE.InstancedMesh)o.dispose(); if (!o.geometry.userData.shared) o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); post.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  const roomCount = floorMap?.rooms.length ?? 0;
  const goalName = floorMap?.rooms[floorMap.goal].name ?? 'The Sunken Stair';
  const goalDepth = floorMap?.rooms[floorMap.goal].depth ?? 0;
  // Plan 017: the map is the floor's chambers as the doors join them - the gate on the left, the stair on
  // the right, a column per layer - rather than their footprints, which now stand far apart in the sea.
  const mapNodes = floorMap ? floorMap.rooms.map(r => mapNode(floorMap, r.id)) : [{x:0,y:0}];
  const mapBounds = {x:Math.min(...mapNodes.map(p=>p.x))-6,y:Math.min(...mapNodes.map(p=>p.y))-6,width:Math.max(...mapNodes.map(p=>p.x))-Math.min(...mapNodes.map(p=>p.x))+12,height:Math.max(...mapNodes.map(p=>p.y))-Math.min(...mapNodes.map(p=>p.y))+12};
  const action = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
  // The HUD is deliberately bare, so the log gets one line and no more: how many descents, how many got
  // out, and the floor that has taken the most. The full history is `window.dungeonTest.runLog()`.
  const tally = summariseRuns(runLog);
  // Whenever a full-screen card sits over the world (intro, pause, a boon choice, or a run's end), the
  // corner chrome behind it — the floor label and the minimap — has nothing to add and only collides with
  // the card's own kicker, so it hides rather than moves.
  // Focus lands on the card itself, not its first button: the dodge key is Space, and a focused button
  // would activate on the very key a player is most likely still holding when a card opens. A dialog with
  // a name announces itself; Tab then reaches the card's own controls first.
  const focusCard = useCallback((card: HTMLElement | null) => { card?.focus({ preventScroll: true }); }, []);
  const cardOpen = fault || !started || (paused && !mapOpen) || (boonChoice.length > 0 && status === 'playing') || status === 'complete' || status === 'won' || status === 'lost';
  const menuOpen = !displayFailed && !fault && (!started || (paused && !mapOpen));
  // Every time the card closes it reopens on the menu list, not on whichever page it was left at. Adjusted
  // during render rather than in an effect, so a reopened card never paints the stale page for a frame.
  const [menuWasOpen, setMenuWasOpen] = useState(menuOpen);
  if (menuWasOpen !== menuOpen) { setMenuWasOpen(menuOpen); setMenuView('main'); }
  const openView = (view: 'controls' | 'settings' | 'arena') => { returnTo.current = view; setMenuView(view); };
  const closeView = () => { setCapturing(null); setBindNote(''); setMenuView('main'); };
  // Focus goes back to the item that opened the page, so a keyboard player lands where they left. A stable
  // callback ref runs once, when the menu list mounts again, which is exactly the moment to do it.
  const returnFocus = useCallback((item: HTMLButtonElement | null) => { if (item && item.dataset.view === returnTo.current) { item.focus({ preventScroll: true }); returnTo.current = null; } }, []);
  // A display that was never granted has its own screen and nothing left to wait for. Nothing is waited on
  // before the menu: nothing builds until ENTER is pressed (plan 015), and the bar goes up for that first
  // press, or for any floor build the player has asked for since.
  const veil = displayFailed || fault ? null : loading ?? (entering ? 'Waking the keep' : null);
  return (
    <main className={`game-shell${mapOpen ? ' map-expanded' : ''}${displayFailed ? ' no-display' : ''}${cardOpen ? ' card-open' : ''}${!started ? ' pre-start' : ''}${ready ? ' world-ready' : ''}${plainVeil ? ' plain-chrome' : ''}`}>
      <div ref={mountRef} className="game-canvas" aria-label="Procedural isometric dungeon floor" />
      {/* Plan 017: the dark a door is taken behind. Driven imperatively from the frame loop, never by React. */}
      <div ref={crossFade} className="chamber-fade" aria-hidden="true" />
      {/* Plan 015 Stage A.3: a static frame of the keep (npm run backdrop), standing in for the live one
          that used to build behind the menu. Pre-start only, under the intro gradient, never over a
          started run - `.game-canvas` carries the live keep once one exists. Document-relative for the
          same reason as the favicon hrefs in layout.tsx: GitHub Pages serves this project from a
          sub-path. The menu never waits on it - low priority, decoded off the main thread, no alt text.
          A plain img on purpose: this is a static export with no next/image loader behind it. */}
      {/* oxlint-disable-next-line next/no-img-element */}
      {!started && <img className="keep-backdrop" src="./keep-backdrop.jpg" alt="" aria-hidden="true" decoding="async" fetchPriority="low" />}
      <header className="game-title"><span className="sigil" aria-hidden="true" /><div className="title-text"><b>{floorLevel} / {FLOORS} · {roomName}</b><i>{roomName === goalName ? 'Take the stair down' : `Reach ${goalName}`}</i></div></header>
      <nav className="game-options" aria-label="Game options"><button onClick={() => action('pause')} disabled={!started || paused || status !== 'playing' || boonChoice.length > 0} aria-label="Pause game">☰</button></nav>
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <section className="hud" aria-label="Player status"><div className="health-row"><span aria-hidden="true" /><b>{health}<small>/{maxHealth}</small></b><span className="rank-badge" aria-label={`Rank ${rank}`}>{rank}</span></div><div className="health-track" role="progressbar" aria-label="Vitality" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}><i style={{ width: `${Math.max(0, health / maxHealth * 100)}%` }} /></div>
        {/* Plan 014 round 5 (lever C8): the two abilities the knight actually has, each named by its
            real bound key rather than a fixed legend - a rebind shows up here the same frame it shows
            up on the settings card. The dash icon's own conic-gradient sweep is what used to be the
            plain `<progress>` bar; `dashMeter` stays too, off-screen, so nothing that reads the
            accessible value tree loses the plain 0-1 progressbar semantics a sweep can't carry alone. */}
        <div className="ability-row">
          <div className="ability"><div className="ability-icon strike-icon" aria-hidden="true"><span className="ability-glyph">⚔</span></div><kbd className="keycap"><span className="visually-hidden">{bindLabel(settings.binds.attack)}</span><span aria-hidden="true">{keycapFor(settings.binds.attack, pointerAim)}</span></kbd></div>
          {/* Plan 016 decision 4: the arm's special, in the row that already exists rather than as an overlay of
              its own. The sweep is the dash icon's; an arm with no special leaves the socket empty. */}
          <div className={`ability${specialArm ? '' : ' ability-empty'}`}>
            {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
            <div className="ability-icon special-icon" role="progressbar" aria-label={specialArm ? `${specialArm.name} readiness` : 'No special for this arm'} aria-valuemin={0} aria-valuemax={1}>
              <div className="special-sweep" ref={specialSweep} /><span className="ability-glyph">{specialArm ? '✦' : ''}</span>
            </div>
            <kbd className="keycap"><span className="visually-hidden">{bindLabel(settings.binds.special)}</span><span aria-hidden="true">{keycapFor(settings.binds.special, pointerAim)}</span></kbd>
          </div>
          <div className="ability">
            {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
            <div className="ability-icon dash-icon" role="progressbar" aria-label="Dash readiness" aria-valuemin={0} aria-valuemax={1}>
              <div className="dash-sweep" ref={dashSweep} /><span className="ability-glyph">»</span>
            </div>
            <kbd className="keycap"><span className="visually-hidden">{bindLabel(settings.binds.dash)}</span><span aria-hidden="true">{keycapFor(settings.binds.dash, pointerAim)}</span></kbd>
          </div>
          <progress ref={dashMeter} max="1" value="1" className="visually-hidden" aria-hidden="true" tabIndex={-1} />
        </div>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        {ammo && <div className="quiver" role="progressbar" aria-label="Bolts in hand" aria-valuemin={0} aria-valuemax={ammo.of} aria-valuenow={ammo.held}>{Array.from({ length: ammo.of }, (_, i) => <i key={i} className={i < ammo.held ? 'held' : ''} />)}</div>}<progress className="xp-track" aria-label="Progress to the next boon" max={rankNeed} value={rankXp} /></section>
      {floorMap && <button className="floor-map" disabled={!started || status !== 'playing' || boonChoice.length > 0} onClick={() => action(mapOpen ? 'pause' : 'map')} aria-label={mapOpen ? 'Close floor map' : 'Open floor map'}><svg key={floorBuild} viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.width} ${mapBounds.height}`}><g>
        {floorMap.doors.map(d => <line key={`door-${d.id}`} x1={mapNodes[d.from].x} y1={mapNodes[d.from].y} x2={mapNodes[d.to].x} y2={mapNodes[d.to].y} stroke="#3f6572" strokeWidth="1.1" />)}
        {floorMap.rooms.map(r => <circle key={r.id} id={`map-room-${r.id}`} cx={mapNodes[r.id].x} cy={mapNodes[r.id].y} r="2.6" fill={r.id===0?'#6fd1c0':r.role==='goal'?'#d9a24f':'#5c9aa5'} />)}
        <circle className="map-mark" cx={mapNodes[floorMap.goal].x} cy={mapNodes[floorMap.goal].y} r="4.4" fill="none" stroke="#ffc573" strokeWidth="0.9" opacity="0.9" />
        <circle ref={mapPlayer} className="map-mark" cx={mapNodes[0].x} cy={mapNodes[0].y} r="1.6" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </g></svg></button>}
      {notice && started && !paused && status === 'playing' && boonChoice.length === 0 && <output className="chamber-notice"><b>{notice.split(' · ').pop()}</b></output>}
      {/* The one prompt allowed to sit in the world, and it is not persistent: it exists only while the knight
          is standing in a rack's ring, and it is the only thing that will take an arm out of his hand. It is a
          button as well as a line of text so a phone, which has no key to press, can answer it by tap — pointer
          focus is refused outright, or Space would activate this instead of swinging the moment it is touched. */}
      {swapOffer && started && !paused && status === 'playing' && boonChoice.length === 0 &&
        <button className="swap-prompt" onPointerDown={(e) => { e.preventDefault(); action('swap'); }} aria-label={`Press ${bindLabel(settings.binds.swap, ' or ')} to ${swapOffer.act}`}>
          <b><span className="swap-key">Press <kbd>{bindLabel(settings.binds.swap)}</kbd> to </span>{swapOffer.act}</b><small>{swapOffer.detail}</small>
        </button>}
      {/* A hand-set role: the cards and the vitality track are positioned overlays with their own chrome, and a native
          element here would bring user-agent layout and a modal API this loop does not use. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      {menuOpen && <div className="intro-screen"><section className={`intro-card${menuView === 'main' ? '' : ' sub-view'}`} role="dialog" aria-modal="true" aria-labelledby="intro-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">{paused ? `FLOOR ${floorLevel} · ${roomName}` : arenaOn ? `ARENA · ${arenaOn.roster.length} ${arenaOn.roster.length === 1 ? 'FOE' : 'FOES'} · FLOOR ${arenaOn.level}` : 'THE DROWNED KEEP'}</span><h1 id="intro-title">{paused ? 'Paused' : <>Below<br /><em>the tide.</em></>}</h1>
        {menuView === 'main' ? <>
        {paused && <p>{advance} / {goalDepth} chambers down · {visitedCount} of {roomCount} seen<br />Rank {rank} · {experience} XP · {rankXp} / {rankNeed} to next boon{xpReward > 0 ? ` · +${xpReward} XP` : ''}</p>}
        {!paused && best && <p className="best-run">Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</p>}
        {!paused && tally.runs > 0 && <p className="run-log">{tally.runs} {tally.runs === 1 ? 'descent' : 'descents'} logged · {tally.wins} escaped{tally.worstFalls > 0 ? ` · floor ${tally.worstFloor} has taken ${tally.worstFalls}` : ''}</p>}
        <nav className="menu-list" aria-label={paused ? 'Pause menu' : 'Main menu'}>
          <button className="primary-action" disabled={!hydrated} onClick={() => action(paused ? 'pause' : 'start')}>{paused ? 'RESUME' : 'ENTER THE KEEP'} <span>→</span></button>
          {paused && <button onClick={() => action('map')}>Floor map</button>}
          {!started && priorSeed !== null && <button disabled={!hydrated} onClick={() => action(`start:${priorSeed}`)}>Last keep</button>}
          <button data-view="controls" ref={returnFocus} className="opens" onClick={() => openView('controls')}>Controls &amp; journey<span aria-hidden="true">›</span></button>
          <button data-view="settings" ref={returnFocus} className="opens" onClick={() => openView('settings')}>Settings<span aria-hidden="true">›</span></button>
        </nav>
        <div className="menu-settings"><button onClick={() => action('mute')}>{settings.muted ? 'Sound off' : 'Sound on'}</button><button onClick={() => action('fullscreen')}>Fullscreen</button>{!paused && <button className="copy-runs" disabled={!hydrated || runLog.length === 0} onClick={copyRuns}>Copy run log</button>}</div>
        {!paused && <output className="run-export">{runLog.length === 0 ? 'No runs recorded yet' : exportNote}</output>}
        {!paused && exportText && <textarea className="run-export-text" readOnly aria-label="Run log JSON" value={exportText} ref={(el) => { el?.select(); }} />}
        {/* Development only, and outside the menu list so the list reads the same in both builds. */}
        {process.env.NODE_ENV !== 'production' && <div className="menu-dev"><button data-view="arena" ref={returnFocus} className="opens" disabled={!hydrated} onClick={() => openView('arena')}>Arena · dev<span aria-hidden="true">›</span></button></div>}
        </> : <div className="menu-panel">
        <button className="menu-back" ref={focusCard} onClick={closeView}><span aria-hidden="true">←</span> Back</button>
        <h2>{menuView === 'controls' ? 'Controls & journey' : menuView === 'arena' ? 'Arena' : 'Settings'}</h2>
        {/* Read off the bindings rather than written out, or this page would go on promising WASD to a player
            who rebound it ten seconds ago — which is the exact moment they would come here to check. */}
        {process.env.NODE_ENV !== 'production' && menuView === 'arena' ? <ArenaPanel floors={FLOORS} choice={arenaChoice} choose={setArenaChoice} /> : menuView === 'controls' ? <div className="menu-details"><div className="intro-controls"><span><kbd>{(['up', 'left', 'down', 'right'] as Action[]).map(a => bindLabel(settings.binds[a], '/')).join(' ')}</kbd> Move</span><span><kbd>{bindLabel(settings.binds.attack)}</kbd> Hold to strike</span><span><kbd>{bindLabel(settings.binds.special)}</kbd> {specialArm ? `${specialArm.name}, the arm's special` : 'Special · this arm has none'}</span><span><kbd>{bindLabel(settings.binds.dash)}</kbd> Dodge</span><span><kbd>{bindLabel(settings.binds.swap)}</kbd> Take the arm or open stair you stand on</span><span><kbd>{bindLabel(settings.binds.map)}</kbd> Floor map</span><span><kbd>{bindLabel(settings.binds.pause)}</kbd> Pause</span><span><kbd>{bindLabel(settings.binds.fullscreen)}</kbd> Fullscreen</span></div><div className="intro-controls"><span><kbd>Mouse</kbd> Point where to cut</span><span><kbd>Gamepad</kbd> Left stick moves, right stick aims, A strikes, B or RB dodges, X special, Y takes the arm or the stair, View opens the map</span></div><p className="control-note">A cursor over the keep aims every swing, so the knight can retreat and cut behind him. Striking from the keyboard or the pad hands the aim back, and those are helped onto whatever body is nearly in front of him; dodging does not. Every arm has a special of its own, and taking up another arm hands you a ready one.{specialArm ? ` ${specialArm.detail}` : ''}</p><p>Reach {goalName}. Defeat the stair wardens, then stand on the stair they guarded and answer the prompt to descend. Cyan shrines heal once; amber circles flare before they burn. Dodge through them. Side chambers grant XP and vitality. An arm laid out on the floor is offered, never taken: stand in its ring and answer the prompt to trade for it.</p><p><span className="end-kicker">IN HAND · </span>{heldWeapon}</p>{taken.length > 0 && <p><span className="end-kicker">BOONS HELD · </span>{taken.join(' · ')}</p>}</div> : <div className="menu-details settings-panel">
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
            {/* Plan 016: a mouse button binds from here, not from anywhere on the card, so the left button still
                clicks every other control while a rebind is armed. */}
            {capturing && <button type="button" className="mouse-capture" onPointerDown={(e) => { if (e.pointerType !== 'mouse' || e.button > 2) return; e.preventDefault(); if (e.button === 2) window.addEventListener('contextmenu', (menu) => menu.preventDefault(), { capture: true, once: true }); commitBind(capturing, `Mouse${e.button}`); }} onContextMenu={(e) => e.preventDefault()}>Or click here with the mouse button for {ACTION_LABELS[capturing]}</button>}
            <output className="bind-note">{bindNote || (capturing ? 'Press any key, or a mouse button on the strip above. Escape cancels.' : 'Escape always opens this menu, so it cannot be rebound.')}</output>
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
      {(status === 'won' || status === 'lost') && <div className="end-screen result-screen"><div className="end-card result-card" role="alertdialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">{status === 'won' ? 'THE KEEP IS BEHIND YOU' : `FLOOR ${floorLevel} · FAILED`}</span><h1 id="result-title">{status === 'won' ? 'You climb into the dawn.' : 'The dark takes you.'}</h1><p>{status === 'won' ? 'Three floors of the drowned watch lie still behind you.' : 'Steel yourself and enter once more.'}</p><div className="xp-summary"><strong>{experience} XP earned</strong><span>Floor {floorLevel} of {FLOORS} · rank {rank} · {defeated} guards felled · XP resets on a new run</span>{ended && (() => { const sum = summariseRunEnd(ended); return <>{sum.cause && <span className="run-cause">{sum.cause}</span>}<span className="run-detail">{sum.time} · {sum.boons}</span></>; })()}{best && <small>Deepest descent · floor {best.floor} of {FLOORS} · {best.xp} XP</small>}</div><button onClick={() => action('restart')}>NEW DESCENT</button>{status === 'lost' && runSeed !== null && <button className="seed-retry" onClick={() => action(`restart:${runSeed}`)}>SAME KEEP</button>}</div></div>}
      {/* Plain markup on purpose: the canvas was never mounted, so this is the only thing left to look at. */}
      {displayFailed && <div className="end-screen display-failed"><div className="end-card" role="alertdialog" aria-modal="true" aria-labelledby="display-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">THE GATE STAYS SHUT</span><h1 id="display-title">No light to see by.</h1><p>This browser could not open a 3D display, so the keep cannot be drawn. That most often means hardware acceleration is switched off in the browser&rsquo;s settings.</p></div></div>}
      {fault && <div className="end-screen display-failed fault-screen"><div className="end-card" role="alertdialog" aria-modal="true" aria-labelledby="fault-title" tabIndex={-1} ref={focusCard}><span className="end-kicker">THE KEEP HAS STOPPED</span><h1 id="fault-title">Something in the dark gave way.</h1><p>The descent cannot go on from here. Reloading raises the keep afresh; your settings and your deepest descent are kept.</p><button onClick={() => window.location.reload()}>RELOAD</button></div></div>}
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
        {/* The fill's width is `showVeil`'s: React sets only where it starts, and never touches it again. */}
        <span className="veil-bar" aria-hidden="true"><i ref={veilFill} style={{ transform: 'scaleX(.04)' }} /></span>
        <span className="veil-stage">{VEIL_STAGES[Math.min(veilStage, VEIL_STAGES.length - 1)]}</span>
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
      <div className="touch-actions" inert={cardOpen || mapOpen}><button onPointerDown={() => action('dash')}>DASH</button><button className="special" disabled={!specialArm} aria-label={specialArm ? specialArm.name : 'No special for this arm'} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-special'); }} onPointerUp={() => action('release-special')} onPointerCancel={() => action('release-special')} onLostPointerCapture={() => action('release-special')}>SPECIAL</button><button className="strike" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action('hold-attack'); }} onPointerUp={() => action('release-attack')} onPointerCancel={() => action('release-attack')} onLostPointerCapture={() => action('release-attack')}>STRIKE</button></div><div className="vignette" />
    </main>
  );
}
