Original prompt: Play through the first combat encounter and identify where movement or attacks feel awkward. Improve the character movement and attack animations so actions feel responsive and are easy to follow. Test the encounter again and fix top issues.

Initial inspection: model forward (-Z) disagrees with rotation (+Z); world-axis movement; stationary dash does nothing; no legs, attack buffering or enemy windup. Baseline playtest pending.

Implemented screen-relative input, corrected -Z facing, articulated gait, cape/lean poses, 65ms anticipation and 110ms contact swing, one-hit-per-swing tracking, hold-to-strike and 180ms buffer, stationary directional dash and dodge cancel, 420ms enemy windup, brief hit reaction, deterministic state/time hooks, focus and touch release cleanup.

Verification: baseline ended in defeat. Repeated supplied Playwright client after implementation and slash orientation correction; inspected screenshots and JSON. Supplementary input-driven replay cleared all five enemies with 100 vitality; checked loss, restart, gait, screen-relative movement, stationary dash, late attack buffer, and focus release. No browser errors. TypeScript, lint, and production build passed (existing large Three.js bundle warning). Artifacts and scripts: ../output/combat. Existing Sites deployment is not requested; connector explicitly limits existing-site deployment to user-requested publishing. No deployment performed.

Remaining: none required for this request. Optional future tuning: enemy spacing and difficulty; full directional gait art.

Final touch verification passed: move, drag off and release, strike, dash cancellation, and arena bounds. Inspected mobile screenshot.

Follow-up quick gameplay audit: reproduced guards crowding to 0.32 world units; they now retain about 0.81 units of spacing while committed windups stay planted. Queued attacks preserve the direction tapped when queued, unless a fresh held direction overrides it; dash and blur clear it. Regression audit asserts left-facing queued swing and minimum crowd spacing. Supplied client replay, full encounter clear, defeat/restart, TypeScript, lint, and production build passed. Screenshots inspected in ../output/combat/audit, audit-client and verify. No remaining issues identified in this bounded audit.

Expanded floor from 11x7 to 15x11 tiles, moved walls/torches and expanded walkable bounds to +/-9.65 X and +/-7 Z. Added 25 XP per enemy exactly once on defeat, 125 XP encounter target, native progress bar, recent reward display and end-of-run XP tally. XP is per-run and explicitly resets on retry. Verified full encounter 125 XP, intermediate totals/HUD agreement, no duplicate rewards, zero XP for movement, reset to zero, reachable expanded floor and boundaries. Desktop/mobile screenshots reviewed. Final supplied client, full replay, build, TypeScript and lint passed. Publishing this continuation to the existing private Site.

Current request: Expand the single room into a procedurally generated floor at least 10x larger. Added seeded 12-room connected generator (minimum 2,028 chamber tiles vs 161 old tiles, plus corridors), instanced stone and parapets, collision sliding/substeps, guard pathfinding and local activation, 22 guards, room-clear healing, full-floor XP and navigation map. Validation in progress.
Validation complete: 500 seeds all connected, minimum observed 2,751 tiles (17.1x old tile count); mathematical minimum chamber-only count 2,028 (>12x) plus corridors. Input-only full-floor replay visited all 12 rooms, defeated all 22 guards, and earned exactly 550 XP. Final visual smoke confirmed corridors, room-clear healing, camera/map tracking and fresh random floor/reset. Defeat/new-floor, touch move/release, stationary dash and prolonged edge collision passed with no browser errors. Supplied Playwright client rerun; desktop, corridor, mobile and loss screenshots inspected in ../output/floor. Fixed dark terrain via neutral floor material, ambient fill and visible tile seams; low parapets avoid occlusion. TypeScript, lint, production build and diff whitespace checks pass (existing bundle-size warning). Existing Site deployment not requested; Sites connector explicitly says editing an existing Site alone does not request deployment. No required TODOs.

User request: Review and improve toward an AA indie feel, then publish. Review found empty repetitive rooms, silent combat, limited attack feedback, no pause/audio/fullscreen controls, and tap-only mobile strikes. Implemented textured stone, chamber seals, brass inlays, torchlit braziers and exterior buttresses, particles, warm/cool lighting, clearer knight armor, camera easing/lookahead, faster traversal, guard/stalker/warden variants (wardens retain committed attacks), attack telegraphs, damage bars, ambient drone and combat/footstep/reward sounds, room names and cleanse notices, full start/pause/end flow, mute/fullscreen, dodge readiness, and real multitouch hold-to-strike. Brazier bases are excluded from pathfinding and collision.
Validation: 500 seeded floors connected and remain >10x original; final input-only replay cleared 22 guards and all rooms for 550 XP, health 100. Defeat and new-floor reset verified separately. Real CDP multitouch passed simultaneous movement/held repeat strike, release, dash, pause/resume freeze and fullscreen. Supplied client rerun; desktop gameplay, telegraph combat, victory, mobile gameplay/start/pause visuals inspected in ../output/polish. TypeScript/lint passed; final build and private publication pending. No required gameplay TODOs.
Final release build and lint passed; production archive will use this validated source. Publishing to the existing owner-only Site as explicitly requested.
Reference-art continuation: user prioritizes varied, freely branching layouts. Replaced fixed 4x3 grid with rejection-placed freeform rooms, six footprint types, 16-23 areas, variable-width bent corridors, wooden bridges and shortcuts. Added keep/ruins/flooded palettes, broken back walls, banners, barrels, pillars and scattered obstacles instead of identical four-brazier rooms. Map paths now follow actual footprints and all guard/XP/room totals derive from generation. 500 seeds passed connectivity, safe spawns, solid props and area checks (3,203-6,840 walkable tiles). Full replay and final art verification in progress; previous archive is superseded and has not been deployed.
Final variety validation: input-only replay completed 20 areas and 38 guards for 950 XP with no browser errors; screenshots cover six room shapes and wood bridges. Waterfall approach and ledge rendering visually verified. Re-ran real multitouch held attacks/movement/release, dash, pause/resume and fullscreen successfully. Source time-step hook can skip intermediate drawing for long deterministic replays; normal rendering behavior is unchanged. Final supplied client and TypeScript/lint pass. Publishing the reference-art continuation to the existing private Site; no required TODOs.

Current request: Improve graphics, animations and immersion using supplied reference, preserving existing game principles. Scope: animated tidal water, cloth, layered fire/embers, character articulation and combat trails. No changes to floor generation, progression, combat timings or damage.

Completed reference graphics pass: world-space animated tidal currents, mottled moss/damp stone, softer shadow filtering, layered brazier flames with glow and batched rising embers, waterfall ripples, vertex-animated cloth capes/banners, idle breathing, skeleton gait/recoil/shield poses, tapered directional slash and pooled dash trails. Preserved generation, three-floor descent, boons, damage, attack timing and controls.
Validation: supplied Playwright client ran after both visual iterations; desktop/mobile, dash, contact strike and waterfall screenshots inspected. Supplementary replay verifies movement, dodge, pause freeze, guard kill/XP, boon choice, floor rebuild and mobile held-strike release. No browser/shader errors. Across three rebuilds textures stay at 5; geometries 49-50. All 11 existing tests, TypeScript, lint, production build and whitespace checks passed (existing bundle-size advisory only). Artifacts: ../output/immersion. No required TODOs. Existing Site was not deployed: connector instructions require a publishing request for existing Sites.
Final compatibility cleanup: replaced deprecated PCFSoft shadow option with supported PCF shadows and radius/bias settings. Production build and supplied client rerun passed.

Current request: Reduce walking-simulator pacing, minimize HUD, make rooms play differently and stop on floor success. Implemented 8.5 out-of-combat / 5.8 combat travel, shorter corridors, faster enemy pursuit, room roles (ambush, ember hazards, one-use healing shrine, watch, wardens), menu-contained controls/stats/settings, and explicit floor results/continue. Validation in progress.

Completed dynamic pacing pass. Added glowing grate landmarks and rotating cyan shrine crystals; kept branching layouts and existing rank/boon progression. Validation: all 12 generator/encounter tests, TypeScript, lint, production build and diff whitespace pass (existing Three.js bundle advisory). Supplied Playwright client ran after gameplay and final visual changes; desktop/mobile gameplay, pause menu, gauntlets, unused/used shrine, all three results screens and victory screenshots inspected. Browser fixture-assisted actual combat verifies wardens -> frozen results -> explicit next floor, final victory, last-warden boon deferral, fast travel, dash immunity, hazard damage, non-repeatable healing, ambush activation, pause/mute, mobile held-strike release, defeat/restart; no browser errors. Artifacts: ../output/dynamic. No required TODOs. Existing Site not deployed: current request is editing only, and connector instructions require a publishing request for existing Sites.

User requested two harsh cheap critics, assessment and implementation. Used two GPT-5.6-Luna subagents: combat/pacing and immersion/UX. Accepted: trivial encounter bypass pressure, identical melee behavior/interruptible windups, fixed encounter cadence, bounding-box room entry, cut-off victory audio. Rejected extra persistent objective text and expanded room notices to preserve user's minimal HUD; deferred fog-of-war and mandatory room locks. Implemented fixed-aim telegraphed stalker pounce with recovery and swept contact, wider warden strike/cue, last-180ms attack commitment, seeded shuffled encounter bags with guaranteed variety/safe breaks, tile-owned room entry, uninterrupted victory cue, and camera-aligned expandable paused map for desktop/mobile. Keyboard menu activation also retains native Space behavior. Validation: 13 tests, TypeScript, lint, build and whitespace pass; browser tests verify pounce hit/side-step dodge, warden reach, late guard commitment, map pause/resume, success audio remains running, final-kill rank-up before results, three-floor progression, and existing movement/hazards/shrines/mobile. Supplied client final screenshots plus pounce, warden, expanded desktop/mobile maps visually inspected. No browser errors. Input-only rush sample before:100 HP at stair; after:72 HP at stair (different procedural seeds, illustrative only, not a controlled benchmark). Artifacts ../output/critics. Critic final code review pending. No publishing or new commit requested.

Final critic review identified a through-wall pounce risk; added body-width walkable-ray checks before enemy windups and at melee contact, with blocked-corner/prop regression coverage. Final 14 tests, TypeScript, lint and production build pass. Browser checks rerun after this fix pass; last-warden boon and AudioContext-running assertion pass, guard late-commitment assertion pass. No required TODOs. Existing Site remains unpublished and this continuation uncommitted. Final supplied-client capture pending (its short click timeout fired after the click completed; inspect captured state).
Final supplied-client capture verified: mode playing, expected movement/strike state, desktop screenshot inspected, no game error log. Validation complete.

Audit follow-up, findings 1-4 of five raised against the shipped game. Bounded the path flood: it re-flooded every walkable cell each time the knight crossed a tile, roughly six times a second, while its only readers skip any enemy past distance 22, so a radius of 24 is provably identical for every enemy the game simulates. Packed the cell key the way the floor generator already does, which drops a rehash on each of the four probes per cell. Measured in-game, tile-crossing frames fall from 2.7ms median (5.1ms max) to 0.7ms, level with every other frame; the flood in isolation over 30 generated floors goes 1584us to 116us median. Equivalence checked over 240 random player cells: no missing or wrong entry below distance 24.

Replaced the page-reload restart with an in-place one through the usual dungeon-action protocol, so a driver restarts exactly as a player does and the AudioContext and GPU context survive. The floor map is keyed on a build counter rather than the seed, or replaying a seed would keep the previous run's explored fills. Floor one's seed is the run's fingerprint and is kept, so a lost run can be taken again from the death screen and the deepest descent survives a reload; every storage read is re-validated and every failure reads as nothing remembered, covered against absent, throwing and corrupt storage. three.js restores a lost GPU context itself but cannot stop the simulation, so the knight went on taking damage behind a frozen image: a lost context now pauses the descent and says so, and restoring never resumes on its own.

Extracted the numeric half of a run into dungeon-sim.ts - vitality, experience, rank, boons, kill and room-clear rewards, and the rule deciding whether a hit lands - with no three.js or DOM, so combat and progression are testable in node instead of by hand-driving a browser. Enemy AI, pathfinding, movement, animation, rendering and audio deliberately stay in the renderer and call in for every number an outcome depends on. restart() collapsed to createRun() plus the React setters, so a field added to the sim can no longer be forgotten there. render_game_to_text keeps every key it had and gained player.invulnerable, player.hurtFlash and features[].burned.

Fixed invulnerability being the hurt visual's own timer: the ember hazard's longer flash bought 0.65s of immunity against a melee hit's 0.35s, so eating a 10-damage tick shielded the knight from a warden's 20-damage swing. One window of 0.35s now applies to every source, granted by the damage rule itself, while hurtFlash keeps its per-source values and drives only the screen filter and shake. The hazard's longer window had been doubling as its once-per-flare throttle; that moved onto a per-ring burned flag cleared when the ring goes cold. Consequence worth naming: standing in a single ring for a full flare now costs 10 rather than 20, because the second tick was an accident of the shared timer. The overlap between two rings still costs 20 per flare, unchanged.

Validation: 31 tests (18 prior plus 13 new over the sim), TypeScript, lint and production build all pass. Browser runs confirm the exploit closed - invulnerability 0.35 after both a hazard tick and a sword hit while hurtFlash stays 0.65 against 0.35, four flares yielding exactly four hazard ticks spaced 3600ms - plus seed replay, full state reset with no stale map fills, frozen simulation through a real WEBGL_lose_context loss, persistence across a reload, and unchanged per-frame cost. No browser errors. Finding 5, combat having one verb and six flat stat boons, is not addressed here.

Second audit pass, nine findings. The first five were independent files and landed together: CI ran lint and a build on pushes to main only, so 31 tests and the typechecker gated nothing and a pull request got no checks at all - verification now runs on pull requests too and adds tsc and the suite, while write permissions stay in a deploy job no pull request can start. three.js recovers a lost GPU context but a refused one threw and left a blank page; the renderer is built first now and a refusal is answered with a screen, chrome hidden with it. favicon.svg shipped unlinked, 404ing every visit: both icons are declared with document-relative hrefs because Pages serves from a repository sub-path where the app/icon convention's root-absolute href resolves outside the deployment. 42 MB of screenshots left the working tree, replay JSON and dev scripts kept, history untouched. The README promised drag-to-move, which never existed, and listed four of seven modules; room count corrected to 10-24 across 2400 generated floors.

Extracted the spatial half into dungeon-enemy.ts: activation cutoff, pursuit step, windup and commit decisions, swept pounce contact and crowd separation, all over plain points with no three.js. The renderer keeps poses, audio, particles, cues and bars and applies the returned intent. Collision had no direct tests at all despite keeping the knight and up to 69 bodies inside the floor; it now has five, including one proving moveOnFloor subdivides a step large enough to jump a wall. Tests went 31 to 52, and each was mutation-checked: sixteen rules broken one at a time, every break caught by the test that names it. Equivalence proved by trace rather than argument - seven scripted scenarios on a fixed seed, 907 frames and 19,615 enemy rows byte-identical before and after. One nondeterminism found on the way: the rAF loop advances the sim by wall-clock during page setup, so a trace must latch manual stepping first.

A reported guard-stall bug did not survive checking. For a guard ATTACK_RANGE and HOLD_RANGE are both 1.15, so its straight-line pursuit branch is unreachable - that part is real - but the inferred consequence, a guard stalling at 1.30 against an off-centre knight and never swinging, does not reproduce: pursuit moves continuously toward the chosen neighbour rather than tile to tile, so it still closes to 1.13 and commits. Measured at both tile centre and 0.55 off-centre: 270 windup frames and a dead knight either way. Dead code, not a defect, and left alone.

Validation: 52 tests, TypeScript, lint and production build pass. Browser runs cover restart and seed replay, persistence, context loss, the hazard/melee invulnerability timeline, per-frame cost and the no-WebGL refusal screen, all without page errors.

Touch movement was four 42px buttons, and this game moves screen-relative and therefore diagonally most of the time, so a player needed two of them at once. Replaced with a dynamic-base thumbstick: the base plants wherever the thumb lands rather than asking the player to find a widget, direction is continuous rather than snapped, and the pointer is captured at plant so a thumb wandering off the zone keeps steering. The discrete move:/stop: protocol stays exactly as it was, because every automated driver steers with it; the analog stick: detail is added alongside. Measured on a real mobile context with CDP multitouch: 72 samples around a circle produce 72 distinct facings, so the direction really is continuous, and a second finger on STRIKE swings while the first steers. Clearing input now clears the stick too - a page backgrounded mid-drag does not always fire pointercancel, and a stick left live is a knight that walks by itself on resume. Verified: after a blur mid-drag and a resume, driven distance is zero.

Added a local run log beside the personal best. Every finished run records the floor it ended on, whether it was won, what killed the knight, playtime, rank, XP, kills, boons and floor one's seed, capped at 100 entries. Nothing leaves the browser: no network, no identifiers, no consent flow for data that never moves. One funnel records it, guarded so a second killing blow in the same frame cannot double-log and an abandoned restart logs nothing - an abandoned run is not an outcome and would poison the distribution. One quiet line on the intro card, and the whole history as JSON through a test hook, which is the point: this log is forty paragraphs of remembered playtests turned into something answerable. Verified end to end in a browser - a real death logs one entry with cause guard, an abandoned restart adds none, and all of it survives a reload.

Two things are not covered. The won/cause-null branch is verified by reading rather than by running: it is one line calling the same funnel the death path exercises, and engineering a floor-three victory through software rasterisation was not worth the time. And the thumbstick dropped the four aria-labelled direction buttons for an aria-hidden zone, so a screen-reader user now has no touch movement at all; they previously had one direction at a time and no diagonals, so the game was barely playable that way, but it is a real loss and belongs in the settings work rather than bolted back onto the stick.

Validation: 58 tests, TypeScript, lint and production build pass. Restart and seed replay, persistence, context loss, the hazard/melee invulnerability timeline, per-frame cost and the no-WebGL screen all re-run clean with no page errors.

Last of the nine: the settings row held sound and fullscreen and nothing a player might actually need. Added volume as a real slider multiplying the fixed 0.45 master gain, with mute kept as a separate restorable flag so un-muting returns to the chosen level; a motion setting defaulting to prefers-reduced-motion and overridable either way; a touch-layout choice restoring the labelled direction buttons the thumbstick displaced; and rebinding for all nine actions. All of it persists through dungeon-save with the same discipline as the rest - validated on read, corrupt or partial blobs falling back to defaults entire.

Reduced motion was decided effect by effect rather than as one switch. Camera shake goes entirely: ninety hertz of camera translation carries nothing the particles, the sound, the health bar and the tint do not already say. The hurt filter is reduced but kept - the discomfort is the brightness ramp, the job is telling the player they were hit, so the tint holds still for the same duration without the ramp. Hit-stop is untouched on purpose: thirty-five milliseconds of stillness is not motion, and it is thirty-five milliseconds the enemies do not get, so shortening it would be a balance change wearing an accessibility label.

A rebind cannot lock anyone out. Escape is reserved and refused for any action but pause; the pause key works whether or not it is bound, so pause can move to P and Escape still opens the menu; taking a key that would leave its previous owner with nothing makes the two trade instead; and a stored set that cannot be made whole falls back to the defaults. preventDefault now follows the bindings rather than a hardcoded list, so a rebound arrow hands page scrolling back.

Verified from outside the game through the state snapshot, which now reports the live filter, shake, hit-stop and audio level. Defaults with nothing stored and no system preference are identical to before: gain 0.45, fourteen distinct filter strings across a flash with the brightness ramp intact, WASD moving. Under a system reduced-motion preference and nothing stored the filter collapses to one held string and the shake gate stops applying any camera offset. Volume 0.3 reads back as gain 0.135 live. Rebinding up to I moves 1.934 units on I and zero on W. With pause moved to P, Escape still pauses and resumes. An attempt to store Escape as the strike key is rejected and strike stays on Space. All seven browser scripts - restart and seed replay, persistence, context loss, the invulnerability timeline, per-frame cost, the no-WebGL screen, CDP multitouch and the run log - pass with no page errors.

Two caveats worth carrying. Volume zero is not mute, so the sound button can read on while the game is silent; defensible, since mute is a separate restorable state, but it will confuse someone. And the motion attribute lands one effect pass after hydration, so for about a frame after load an explicit reduced setting on a non-reduced system can still show the two decorative CSS animations; the in-game effects are correct immediately.

Validation: 64 tests, TypeScript, lint and production build pass. The settings rules were mutation-checked - sixteen broken one at a time, each caught by the test that names it, one of which only became detectable after tightening a finite-number case.

2026-09-14 — Implemented requested polish items 2 and 3 from the overview review.

Materials and atmosphere: stone now varies roughness with damp patches and dark tide marks, with subtle floor bump relief; cooler recessed lighting contrasts with warm torch pools. Added batched soft contact shading around props and broken shoreline foam, light-responsive water normals, quieter surface ribbons, softened waterfall edges and bounded splash particles. New floor-owned textures and particle resources are disposed on rebuild. Kept the existing low-cost lighting setup and shared/instanced geometry.

Enemy presentation: guards have helmets and shields; stalkers have elongated clawed arms, a forward crouch and a committed airborne pose; wardens have broad armor, greaves, a pointed circlet and a heavy hammer. The new pure dungeon-enemy-pose.ts reads the existing windup, lunge and recovery timers. Weapon release aligns with contact and wardens visibly recover more slowly than guards. AI, damage, reach, cooldown tuning, collision and controls were not changed. Added pose diagnostics to render_game_to_text. Visual inspection caught and corrected the model-forward sign on body lean.

Verification: npm test passed 74/74, including three new pose regressions. npx tsc --noEmit --incremental false, npm run lint, npm run build and git diff --check passed. Production build retains the existing large-chunk warning. The package currently lacks the typecheck and test:browser scripts described in AGENTS.md, so their direct npx equivalents were used.

Five focused real-browser tests in tests/browser/polish.spec.ts passed: all three archetypes through anticipation/contact, water/material rendering and stable texture allocations across floor rebuilds, and mobile thumbstick/held strike/release. Final dedicated report: outputs/polish/final-tests/.last-run.json says passed with no failed tests. The supplied develop-web-game Playwright client also completed after the final graphics changes; its screenshot and state were inspected and no browser error file was emitted. Desktop enemy, water and mobile captures were visually reviewed; artifacts are in ../outputs/polish (not the historical output/ directory).

Broader existing browser suite: 14 passed, 7 failed. Six existing combat tests require dungeonTest.configureCombatFixture, absent from both the original HEAD source and the current source. The old touch test requests .touch-pad .left while the saved/default layout is the thumbstick. These pre-existing test/source mismatches were not changed as part of graphics polish. The other gameplay checks passed movement, repeated attacks, pause/map, pounce hit/dodge, warden reach, hazards, shrines, floor completion and queued rank choices. Follow-up: reconcile that older browser suite with the current game source. No commits, push or deployment.

Commit preparation (user authorized commit and push): included the existing portable Playwright configuration and shared browser helpers required by the polish regressions; pinned the already-tested @playwright/test 1.63.0 in the manifest/lockfile, added typecheck and test:browser scripts, and ignored generated Playwright output. The unrelated pre-existing combat tests, implementation plans and other untracked work are outside this commit. Pushing main uses the existing Verify and Deploy workflow.

Staged-tree check before committing: exported only the staged files to an ignored verification directory (using the installed dependency tree). TypeScript and lint passed; all 67 node tests included in the commit passed. The earlier 74-test total also included seven unrelated untracked combat tests, intentionally excluded here.

2026-09-14 — Slash animation pass requested with lower-cost subagents. Two assessment agents inspected player/enemy presentation and two implementation agents produced pure pose curves; the coordinating agent reviewed those curves, corrected discontinuities, and integrated the renderer.

Player attacks now start from the actual rest pose, wind back smoothly, sweep through 2.4 radians with coordinated torso/armor/cape motion, and settle to guard. Replaced the detached fixed floor crescent with a short, tapered ribbon sampled from the sword's world-space path. Long Guard extends the visible blade and its attached trail. Guard and warden releases interpolate through the last part of the existing tell instead of jumping to contact; their recovery and sword/hammer arcs remain distinct. Stalkers carry claw trails through launch and finish their visual hop smoothly even when contact ends movement early. The lunge floor cue fades after launch.

Trail buffers are allocated once per weapon and reused; they expire on misses and clear on dodge, death, teleport and floor rebuild. Pose snapshots expose trail visibility/triangle counts and enemy release age for deterministic checks. Combat decisions, damage values and active-hit boundaries remain unchanged. New regressions cover pose continuity, world-space attachment, expiration, all four player directions, pause/dodge/held attacks, and enemy damage boundaries. Initial verification: 82 Node tests, typecheck, lint, build and 13 focused browser checks pass. Desktop and mobile screenshots inspected. Full browser suite and final visual check pending.
Final verification: all 82 Node tests pass; typecheck, lint, production build and git diff --check pass. The focused browser run passed 13/13, and the full browser run passed 23/30. The same seven pre-existing failures remain: six combat tests require the absent dungeonTest.configureCombatFixture hook, and the legacy touch test requests .touch-pad .left while the default UI is a thumbstick. All new slash tests and the existing enemy/mobile polish checks pass. Inspected directional player cuts, enemy windup/contact and mobile captures. Artifacts and full-suite log are in ../outputs/slash; historical output/ was untouched. No commit, push or deployment performed by this task. Remaining follow-up: reconcile those pre-existing browser fixtures with the current game in a separate task.
Final supplied Playwright client rerun completed with an active player slash at contact. Screenshot and state inspected; no browser error file emitted. Local preview left running at http://127.0.0.1:3000 for review.
Commit preparation (user authorized commit and push): verified an export of the nine staged slash-animation files plus the existing tracked repository. Typecheck, lint and all 75 Node tests in that commit pass. The workspace total of 82 includes seven unrelated untracked combat tests. The 13 passing focused browser checks are included in this commit. Pushing main uses the existing Verify and Deploy workflow.

2026-09-14 — Reconciled the working tree: Plan 002 combat integration re-applied, browser suite made green, CI unified.

The Plan 002 game-side changes had only ever existed in a Codex auto-stash based on 58500c2 and conflicted on six of seven files against current main. Re-applied by hand: dungeon-game.tsx now imports swordContacts for the player hit test (a wall stops steel in both directions), the enemy loop stops for the rest of the tick once a kill opens a boon draft or a hazard ends the run, and the development-only dungeonTest.configureCombatFixture hook is installed behind a NODE_ENV branch (confirmed absent from dist/client). dungeon-sim.hurt now rounds through dungeon-combat.incomingDamage so the node suite and the running keep share one rule. Salt Ward keeps the later, committed behaviour (enemy steel only, embers unwarded); the combat browser test and the boon copy now say so rather than asserting the older plan. The touch-controls browser test selects the pad layout through a settings blob in storageState instead of assuming the pre-thumbstick default. verify.yml folded into deploy-pages.yml as parallel checks/browser/build jobs with deploy gated on all three; the duplicate workflow was removed. Stash content for README/tests README predated the settings work and would have regressed it, so only the combat rows were carried over.

Verification: typecheck, lint and production build pass; 82/82 node tests; full Playwright suite 30/30 in 6.9 minutes, no page errors. Committed on fix/combat-integration-and-ci; not pushed, not deployed. .claude/launch.json left untracked as local tooling. The reconciled auto-stash is still in the stash list and is safe to drop.

2026-09-14 — Tuning pass from the second analysis round: guard commit range, enemy scaling by floor, boon draft, opening halls.

Guards commit from 1.5 instead of 1.15 and a blow interrupts a guard or stalker tell only while more than 0.3s of it remains (was 0.18s); wardens still never flinch out. A phase-swept race simulation showed a lone guard still cannot beat a knight holding the strike key head-on, because every hit staggers it 0.2s and refreshes a 0.4s cooldown against a 0.38s swing; that is left as designed - guards are group pressure - and the comments say so rather than overclaiming. Enemy vitality now grows by one per floor and damage by fifteen percent (enemyStats in dungeon-enemy.ts); tells and speeds hold still. The boon draft is a Fisher-Yates shuffle that offers untaken boons first and fills from taken ones only when fewer than three remain; Run carries the taken list. The first two trunk halls are always watch encounters - all three previously pinned test seeds opened with a three-or-four stalker ambush in hall two, the pattern that killed a fresh bot run in 43 seconds.

Forcing the opening halls changes the seeded draw order, so the pinned browser seeds moved to 0x1, 0x7 and 0xc, found by a pure search over every fixture predicate the specs use. The progression stair fight now leaves wardens one blow from death through the combat fixture, since tougher floor-three wardens killed a knight standing in reach of three of them and the fight itself is not what that test checks.

Verification: typecheck, lint, 87/87 node tests, full Playwright suite 30/30. One seed-pin assertion in slash.spec flaked once during the first full run and passed alone and in the final run; noted, not chased.

2026-09-14 — UI polish from the screenshot-verified findings (item 8), implemented by a lower-cost subagent and reviewed here.

The corner floor label and minimap hide while any full-screen card is up, so the pause kicker no longer sits on the ghosted HUD label; the map screen keeps the same SVG expanded. The result card matches the boon card width, so the death and victory headlines hold one line at desktop widths. Minimap rooms are brighter and the goal ring and player mark are scaled up in the corner only. The HUD fades in with the first start action instead of ghosting through the intro. The hurt tint shifts red: sepia(.4) saturate(1.75) hue-rotate(-25deg) with the brightness ramp, and a single held sepia(.3) saturate(1.5) hue-rotate(-22deg) under reduced motion. The nine rebind buttons fold under a Key bindings summary inside Settings, and the pause card labels held boons.

Verified against a fresh capture of the same 26 screenshots used to find the issues, then typecheck, lint, 87/87 node tests and Playwright 30/30 after merging main (which carried the tuning pass).
2026-09-14 — A live blade is a commitment (item 6 from the second analysis round).

A dash used to zero the attack timer at any point in a swing for nothing, so committing to an attack never cost anything and the only timing that mattered was the enemy's. Now canAbortSwing in dungeon-combat.ts allows the abort only during the 65ms anticipation; once the blade is live a dash press is held in a 0.4s buffer and fires the moment the swing ends, ahead of the next held auto-swing, so a dodge pressed mid-swing is delayed rather than swallowed. The buffer drops with the attack buffer on pause, floor end, restart and focus loss. dashBuffer is in the player snapshot. Swinging into a tell is now a mistake with a cost: enemy tells run 0.5 to 0.72s against a 0.38s swing, so a swing started as a tell begins still leaves room to dodge, one started late does not.

The slash regression that expected an instant mid-swing dodge now asserts the wait and the deferred dash; a new combat regression covers both branches. README and GAME_OVERVIEW no longer promise a free cancel. Verification: typecheck, lint, 88/88 node tests, Playwright 31/31.

2026-09-15 — Requested a distinct sprint animation for fast travel between rooms.

Replaced the speed-multiplied straight-leg walk with a distance-driven locomotion curve. The knight now has articulated knees, a longer running stride with heel recovery and flight lift, forward torso lean, counter-swinging free arm, a raised moving sword carry and a more lifted cape. Actual displacement drives cadence, including footsteps, so collision stops the gait; damping blends travel/combat speed changes and stopping. Attack poses retain priority and dodge keeps its existing lean. Movement speeds, input, collision and combat rules are unchanged.

Added two pure pose regressions and two real-keyboard browser regressions for sprint, release, pause, attack/dodge transitions and pushing into a wall. Initial verification: typecheck, lint, 90/90 node tests, 2/2 focused browser tests and production build passed (existing bundle-size warning). Inspected browser extension/recovery captures and the supplied develop-web-game client's gameplay screenshot and JSON in outputs/sprint/final-client; no browser error file. The first client run logged a click timeout under concurrent WebGL load but did enter gameplay; the dedicated final rerun completed cleanly. Full browser suite pending.
Final verification: full Playwright browser suite passed 33/33, including combat, mobile input, floor progression, slash trails and both sprint regressions. No required TODOs. No commit, push or deployment.

2026-09-15 — Reference-led player model upgrade, bounded to finish before the usage limit.

Inspected docs/reference/dungeons-beyond-concept.png and followed its pale angular helmet, dark layered armor, red cloth and warm leather/brass accents. Rebuilt the cylindrical torso into a narrower silhouette with bevelled breastplate and centre ridge, layered pauldrons, helmet crown/face plates and split eye slit, scarf collar, cape hem/folds, belt buckle, tassets, pouch, greaves and knee guards. Added a connected sword sleeve and a tapered bevelled blade with fuller, brass crossguard, grip and pommel. Existing joints, sprint animation, blade endpoint and gameplay rules remain intact; all geometry remains runtime-generated and disposed with the existing scene.

Verification: typecheck, lint, production build, all 90 node tests and 10 focused browser tests (sprint, wall stop, pause/dodge, player cuts in four directions and enemy contacts) passed. Reviewed frontal/side attack and sprint screenshots. Production build retains the existing bundle-size warning. Final supplied client capture pending. No new gameplay behaviour requiring a separate regression; the existing rig/input suites were rerun. No commit, push or deployment.
Final supplied develop-web-game client passed; gameplay screenshot and JSON in outputs/knight/client inspected, with no console/page error file. Work completed with 60% of the short-term allowance and 56% of the weekly allowance still available at the last check. No required TODOs.

2026-09-15 — Fix Node.js 20 deprecation warnings in GitHub Actions.

The Pages upload wrapper v3 transitively used upload-artifact v4. Updated it to upload-pages-artifact v5 (whose pinned uploader is v7), direct failure-report uploads to v7, cache to v6, configure-pages to v6 and deploy-pages to v5. Verified each selected runtime, including the wrapper's exact nested SHA, declares node24. Checkout v5 and setup-node v5 already use node24; application Node 22 stays unchanged. Explicit include-hidden-files preserves the previous Pages archive behavior for dotfiles. Existing permissions, event guards and retention stay unchanged.

Validation: checksum-verified actionlint 1.7.12 passed the workflow; the composite action parsed with PyYAML; git diff --check passed. GitHub CI and deployment verification pending.

2026-09-15 — Commitment narrowed to the live blade (third audit round, finding 1).

Locking the whole 0.38s swing against a dash punished the default hold-to-strike style: the player is nearly always mid-swing, so a dodge fired up to 0.3s late and a guard's 0.5s tell landed in an estimated 17 to 43 percent of cases depending on reaction time. The bot re-run against the deployed build showed the same thing: two of four fresh runs died on floor one to guards in under 100 seconds, with guards dealing 92 to 100 percent of the damage. canAbortSwing now refuses a dash only while the blade is live, from the end of anticipation (0.065s) to the end of contact (0.175s); anticipation and recovery both give way at once, and a buffered dash fires the moment contact ends. Swinging into a tell still costs the 0.11s of contact. Node and browser regressions updated, with a new recovery-cancel assertion. Verification: typecheck, lint, 90/90 node tests, Playwright 33/33.

2026-09-15 — Cards are dialogs (third audit round, finding 2).

A runtime audit of the deployed build found the pause card left focus on body, let Tab reach the hamburger behind it, and gave no card a dialog role. Every full-screen card now carries role dialog (intro, pause, floor results, boon draft) or alertdialog (run end, no WebGL), is labelled by its heading, and takes focus on mount through a callback ref. Focus lands on the card itself, not its first button, because the strike key is Space and a focused button would fire on the key a player is most likely still holding when a card opens; the new a11y spec asserts Space on the focused pause card does not resume. The hamburger is disabled while paused, as it already was during a draft, and the touch controls are inert under any card or the map. The vitality track exposes aria-valuenow like the dash and rank meters. oxlint prefers native dialog and progress elements; the hand-set roles are suppressed with a reason, since a native dialog brings user-agent layout and a modal API this loop does not use. Verification: typecheck, lint, 90/90 node tests, Playwright 35/35.

2026-09-15 — The floor ends on the stair, not on the last kill.

Killing the last warden used to open the results card in the same tick, mid-swing and wherever the knight stood. Now the fall of the last warden unseals a stair at the heart of the warden hall: a stone-rimmed shaft under a dark metal seal, marked with the same amber ring the map uses. The seal lifts with a burst and the notice reads The stair opens, step onto it to descend. The results card appears only once the knight has stood inside STAIR_RADIUS (1.25) for STAIR_DWELL (0.4s); a dash across it does not count and stepping off drains the dwell twice as fast as standing fills it, so a pass-through never ends a floor. The shaft fills with light as the dwell runs, which doubles as the progress cue. stairDwellStep, STAIR_RADIUS and STAIR_DWELL live in dungeon-sim.ts with a node test; the snapshot carries objective.stairOpen, objective.stairDwell and a stair block with position, radius and dwell. Both progression regressions now walk onto the stair and assert that time passing, and a brief pass over it, end nothing. A rank-up on the last warden still drafts first; the stair simply waits. Verification: typecheck, lint, 91/91 node tests, Playwright 35/35; the open stair was inspected on all three floors.

2026-09-15 — Carved keep graphics overhaul (request: make the graphics substantially better, preserve at least 5% usage for pushing).

Replaced miniature-brick paving with bevelled mineral flagstones, inset border courses, dark submerged foundations with staggered masonry seams, and engraved bronze compass medallions. Added perimeter buttresses, recessed lancet frames, ivy, embroidered banners and bevelled prop bases/wall blocks. Room themes retain distinct stone palettes; hazard grates remain clear of decorative medallions. Added a procedural reflection environment, softer moon shadows, richer wet-stone highlights and darker, finer water currents/caustics. No downloaded assets, dependencies or gameplay-rule changes.

Paving, parapets and architectural ornaments use spatial instance batches so unseen wings are culled; floor teardown also releases instance buffers. Screenshot review caught prop holes being mistaken for exterior walls and corrected the perimeter lookup to include occupied prop cells. Added rendered-triangle and repeated-floor GPU-allocation regressions. Desktop/phone captures reviewed across keep, ruins and flooded halls; browser error collection clean. Node suite 91/91 passed; typecheck, lint and initial production build passed. Final browser suite and final build pending. No commit, push or deployment.
Final verification: 36/36 browser tests passed (8.6 minutes), including the new culling and repeated-floor allocation assertions, all combat/movement/mobile controls, progression, and animation suites. Final typecheck, lint and production build passed; existing bundle-size warning remains. Supplied develop-web-game client finished in playing mode with no browser error file; final screenshot and state inspected and preserved in outputs/graphics-overhaul-20260915. Final representative gate capture: 136,976 triangles, 253 calls, 118 geometries, 10 textures (random seed; not a like-for-like performance benchmark). No required TODOs. No commit, push or deployment.

2026-09-15 — Player, enemy and attack graphics iteration.

Added layered knight shoulder plates, crimson helmet crest, split surcoat, metal trim/rivets, engraved blade, boot and gauntlet details, and vertex-coloured cape edging/heraldry that follows the cloth. Enemies now have socketed skulls, brows, jaws/teeth, rib cages, vertebrae, paired limb bones and feet. Guards gain shield rivets/crosswork and a tapered sword; stalkers gain fangs, spinal spines and ragged wraps; wardens gain segmented/spiked armor, a surcoat and reinforced decorated hammers. Static detail is merged by animated joint and material, then cached per character type; added detail remains attached to the existing rigs.

Slash ribbons now have a bright cutting edge over a translucent fan sampled from the existing blade history. Actual successful hits emit a short star flash and expanding ground accent from a bounded reusable pool. Neither effect changes reach, hit timing, damage, attack curves or movement. Impact accents clear on floor rebuild, freeze with the simulation and release resources on unmount. Added a pure pool lifecycle regression and a real-keyboard hit/miss/pause/expiry browser regression.

Verification: final typecheck, lint and production build passed (existing bundle-size warning); all 92 node tests and 17 focused browser tests passed, covering player/enemy slash timing, real damage boundaries, impacts, enemy poses, repeated floor allocations, phone input and sprint transitions. Reviewed desktop/phone character and attack captures. The supplied web-game client completed in playing mode with a visible slash and no error file; its first cold-load attempt missed the disabled entry button and a later long action run was stopped and shortened. Final reviewed captures saved in outputs/characters-20260915. Last usage check: 33% short-term, 24% weekly remaining. No required TODOs. No commit, push or deployment.

2026-09-16 — Cloak fit, shield stance, and persistent enemy bodies.

Refitted the knight's cloak around a shoulder-height pivot with a narrower neck seam, a flared hem and a curved back. Cloth deformation now derives its pinned edge from the real geometry bounds; running and dodging lift the hem behind the knight without pulling the shoulder seam away. Turned the guard shield's decorated face outward, moved it onto the forearm, and replaced its weapon-arm swing and wobble with a restrained guard/brace pose.

Replaced shrinking/spinning enemy deaths with pose-preserving collapses: guards and wardens fall backwards, stalkers fall forwards. Limbs settle into spread poses, swords/hammers lie beside the body, eyes and attack effects extinguish, and full-size corpses remain until the floor is rebuilt. Death playback respects pause/draft freezes. Dead enemies remain excluded from damage, targeting and crowd collision; rewards still occur exactly once. No new scene objects are allocated during death playback.

Verification: typecheck, lint, production build and 96 node tests passed. All 17 focused browser cases passed (character lifecycle, progression, slashes and sprint), and the four new character cases passed again after visual review corrected the warden hammer's resting angle. Tests cover all three enemy types, paused falls, stable full-size corpses, walking through bodies, no repeat XP or damage, floor cleanup, cloak attachment and shield stance. Reviewed falling/settled poses plus a close-up of the fitted cloak and shield; no browser errors in the visual review. Captures are in outputs/character-fixes-20260916. Existing production bundle-size warning remains. Supplied client final capture pending. Latest usage check: 60% short-term and 16% weekly remaining, above the requested 5% reserve. No commit or push for this iteration.
Final supplied web-game client passed in playing mode with 100 vitality; screenshot and text state inspected, no error file. No required TODOs remain.

2026-09-16 — Repair the two blocked production releases.

Inspected GitHub runs 35021207554 and 35071451218 and their retained Playwright traces. Both passed checks/build and browser shard 2; browser shard 1 blocked deployment. The movement failure began in ready mode with an impossible 81.9ms hit-stop and 161.9ms shake: the first requestAnimationFrame timestamp preceded the effect's performance.now() baseline, so a negative delta grew timers. The combat trace also started with phantom hit-stop; its reused stalker retained a released pounce and left the wall fixture before the health assertion.

Initialize the animation clock from the first rAF callback and clamp subsequent deltas to 0..40ms. Add a browser regression that supplies an older first timestamp and asserts no startup hit-stop/shake. Use an awake guard in the wall-contact fixture so its windup reliably parks it between both swings. Existing movement, collision, damage and timing assertions remain unchanged; no retries or disabled gates. Typecheck, lint, all 96 node tests and production build passed (existing bundle-size warning). Repeated browser validation and production workflow verification pending.
Focused stability verification: both previously failing scenarios and the new stale-frame regression passed three consecutive runs each (9/9). Publishing this repair to restore the explicitly requested production deployment; full CI and Pages verification follows.

2026-09-16 — A balance harness, because seven weapons cannot be tuned by hand.

`npm run balance` plays a batch of seeded runs headlessly against the real rules and reports what the
keep did to them. Nothing in `scripts/balance/sim.ts` re-implements a rule: generateFloor lays the
keep, decideEnemy drives every body, swordContacts decides every hit, and hurt/resolveKill/takeBoon
move the run's numbers, so a tuning change lands in the report the same commit it lands in the game.
What is modelled rather than shared is the renderer's own bookkeeping — ember ring placement, the
ambush wake, the spawn cooldown stagger — and each carries the line of dungeon-game.tsx it mirrors,
since that is the seam where the harness can silently go stale. The knight is a policy, not a player:
it walks the flood to the stair, engages what wakes with a clear lane, and dodges a tell it has had
time to read.

Two harness bugs were found and fixed while bringing it up. Charging any body within 14 units, without
the lane check the enemy's own attack has to pass, walked the knight into the wall of the next room and
ground there until the timeout in eight runs of ten. And the dodge rolls originally shared an RNG
stream with the boon draft, so raising the dodge rate silently dealt different cards — a skill sweep
read backwards until the streams were split, with the clumsier knight simply being handed better boons.
The dodge rate is documented as non-monotonic by design and not a difficulty dial: a dodge cancels the
swing it interrupts and spends a 1.35s cooldown, so dodging everything draws fights out.

Baseline over 200 runs at reaction 0.22s, dodge 0.8, exploring: 199 escaped, 0 died, 1 stranded;
median run 5.5 minutes, median rank 6, median 104 kills. Death rate is 0.0% on all three floors, and
median vitality at the stair is 80/82/74 percent by floor. Damage dealt to the knight splits warden
78.3%, stalker 13.9%, hazard 7.5%, guard 0.2%. Two things worth saying plainly: a competent knight
currently cannot lose, and guards are decorative — they are 0.2% of all damage taken across 200 full
descents. Median rank 6 against a six-boon pool also confirms every run takes every boon.

Seven regressions cover the harness itself: seeded replay, seed variation, arrival at the stair, one
report per floor, draft independence from the dodge stream, real XP and rank movement, and damage
attribution. They share one batch of eight runs to keep the suite quick. Verification: typecheck, lint
and 103/103 node tests pass. No gameplay file was touched by this change.

2026-09-16 — A weapon is a record, not a set of constants.

`dungeon-weapon.ts` collects the nine numbers a swing used to hardcode across three files: duration,
anticipation, contact end, reach, arc, damage, move speed while swinging, and knockback against an
ordinary body and against a warden that plants itself. `TIDEBLADE` carries exactly the values those
constants held, so a run holding it plays as it did.

`playerAttackPose`, `swordContacts` and `canAbortSwing` all take a weapon, defaulting to the Tideblade
so no existing caller or fixture had to change. `PLAYER_ATTACK_DURATION` and its two siblings remain
exported, now derived from the Tideblade, because dungeon-game and the browser suite still read them.
The pose curve's shape is deliberately not per-weapon: a slower arm sweeps the same arc over a longer
span rather than a different arc. The game loop holds one `weapon` and reads every one of those numbers
off it, including the two knockback literals that were inline in the hit branch, and the snapshot
carries the held weapon so a driver can assert on it.

Verified as a no-op rather than assumed to be one: the balance harness reproduces the 200-run baseline
byte for byte — 199 escaped, 0 died, 1 stranded, median 5.5 minutes, median rank 6, median 104 kills,
and the same warden 78.3 / stalker 13.9 / hazard 7.5 / guard 0.2 damage split. The harness was then
changed to pass the Tideblade explicitly rather than lean on the defaults, so it exercises the
parameterised path, and reproduced the same numbers again.

Seven regressions in `tests/dungeon-weapon.test.ts` cover the table matching the exported constants,
an unknown id falling back to an armed knight rather than an empty hand, omitting the weapon being
identical to passing the Tideblade across pose, abort and contact, and — the ones that matter — a
synthetic heavier weapon whose live window, reach and arc all differ from the Tideblade's, so the
parameter cannot be silently ignored. A wall still stops a longer blade. Verification: typecheck, lint,
110/110 node tests.

2026-09-16 — Vitality quoted in quarter-hits, so a weapon table has room to sit.

Damage is an integer and a guard held two of them, so a weapon was either exactly as strong as the
starting sword or exactly twice as strong: there is no "a fifth harder" at that grain, and five melee
arms cannot be told apart by damage without one. `HIT = 4` in dungeon-enemy.ts; every vitality number
and the per-floor growth are quoted as multiples of it, and the Tideblade deals 4. The same swings
still kill in the same number of blows — what changed is that a gap now exists to tune inside.

The composition was wrong and is fixed with it. `run.strike` was the damage itself, starting at 1, so
threading a weapon through in the previous change produced `run.strike + weapon.damage - 1` to keep the
arithmetic working. It is now a bonus on top of whatever is held, starting at 0, and a blow takes
`weapon.damage + run.strike`. Whetted Edge adds `STRIKE_BONUS`, one more starting blade's worth, which
is the same doubling it always was.

Verified as a no-op rather than assumed to be one: the harness reproduces the 200-run baseline byte for
byte for the third time — 199 escaped, 0 died, median 5.5 minutes, median rank 6, median 104 kills,
warden 78.3 / stalker 13.9 / hazard 7.5 / guard 0.2.

The pinned assertions were updated rather than relaxed, because they exist so a rebalance has to be
deliberate. The enemy tuning table asserts blow counts as blow counts (`2 * HIT`), and every browser
test that pinned a warden at four vitality now derives the number from the snapshot's new
`weapon.strikeDamage`, so a future weapon change moves the fixtures with it instead of breaking them.
One slash fixture that pinned a body at a literal 2 would now simply die and take the impact accent
with it; it asks for two blades' worth instead.

2026-09-17 — Four more melee arms, measured before a single mesh was built.

`dungeon-weapon.ts` now carries five: the Tideblade unchanged, Twin Fangs (0.22s, reach 1.4, inside a
guard's own 1.5 commit range), the Salt Spear (reach 2.6, a thrust, past the 2.55 a warden's hammer
covers), the Warden's Cleaver (0.62s, a 180-degree arc, heavy shove) and the Bell Maul (0.66s, 9 damage,
the only arm that staggers). Nothing is wired to the pickup yet and no geometry exists; the knight still
walks in with the Tideblade. This is deliberate — the numbers are cheap to change and the meshes are
not, so the table was proved first.

`stagger` is the one weapon property that is a rule rather than a number: it lets a blow break a
warden's committed swing, which ordinary steel never does. Two findings came out of measuring it, and
both changed the design.

The cleaver originally staggered as well, and carrying the arc, the shove and a warden interrupt at
once measured at 10.3% of the knight's damage coming from wardens against 78.5% for the starting sword.
That is not a trade-off, it is simply the best arm, so the cleaver lost the stagger and half its warden
knockback and now sits at 20.0% — bought with the slowest median run of the five, 6.0 minutes against
5.4. The maul's stagger, meanwhile, did nothing at all: 76.7% against the sword's 78.5%. A broken swing
only refreshed the 0.4s every hit refreshes, so a warden whose 0.72s tell was interrupted simply wound
the same swing up again. `hitCooldown` in dungeon-enemy.ts now charges a full RECOVERY for a swing a
stagger weapon actually broke, and the maul reads 26.7%. Its duration also came down from 0.74s to
0.66s, because a swing only breaks a tell while more than COMMITTED_WINDUP remains and at 0.74s it
could not reliably arrive inside that window. Ordinary steel breaking a guard's tell still buys the
0.4s it always did.

The harness grew a `--compare` mode that walks every arm over the same seeds, a `--weapon` flag, and a
column for damage taken while three or more woken bodies stand within four units — the only measurement
that can see what a narrow arc gives up, since a duel against one body at a time cannot. It promptly
contradicted the expectation behind it: the cleaver takes the most damage while surrounded, 5.7%
against the spear's 2.4%, because being rooted at 1.6 move speed costs more than a half-circle of edge
buys. The spear keeps bodies off by killing them before they gather.

The Tideblade baseline is unmoved. The 200-run report differs only in guard damage reading 0.3% where
it read 0.2%, which is the harness's own approach distance moving from a flat 1.55 to reach times 0.85
— 1.53 for the sword. Escape rate, deaths, median run, rank, kills, clear times and vitality at each
stair are identical. Every arm still escapes 100% of the time, which is the standing difficulty problem
this change does not address and does not worsen.

Verification: typecheck, lint, 116/116 node tests. Ten new regressions cover the table's coherence,
that a found weapon is never the one already in hand, that exactly one arm staggers and it is the
slowest, that every arm differs from the sword in at least two of the four properties that decide a
fight, that nothing out-reaches the sword for free, and both halves of the stagger rule.

2026-09-17 — The arms reach the knight's hand: a rack on the floor of every descent.

`dungeon-armory.ts` is the geometry half of the weapon table, kept apart from `dungeon-weapon.ts` for
the reason `dungeon-floor` is kept apart from `dungeon-game`: the numbers have to run in node and
three.js does not. Each arm is built from the primitives the knight is already built from, with his own
palette passed in rather than rebuilt, and each declares where its blade starts and ends, because the
slash ribbon samples the weapon's world path between those two points — a spear sampled at a sword's
tip trails from the middle of its own haft. The knight's sword now comes from the same function, and
the blade dressing moved out of `knightDetails`, whose batch is cached per character type and would
otherwise have baked a swappable weapon into a cache keyed on "knight".

The floor generator lays one arm out per descent, drawn from the seed like everything else. Floor one
leaves it in the Tide Gate, which has no bodies in it, so the first real decision of a run is made in
safety; deeper floors hide it down a branch, which is what makes the detour worth walking. It is placed
clear of the room's heart, where the knight arrives, and clear of anything spawned in the same chamber.

Taking it is a dwell, not a button: `dwellStep` is now shared with the stair, so both ask for the same
deliberate pause and a dash across either counts for nothing. What the knight sets down stays on the
rack, so a pickup he regrets is a walk back rather than a dead run.

Two things were wrong and both were found by looking rather than by reasoning. The rack first laid the
weapon flat, which from an isometric camera read as a thin line — a spear vanished into the floor
entirely — so the arm is planted point-down in a plinth, half again life size, over a lit collar. And
the swap did not stop: the knight is still standing on the rack he just emptied, so the dwell refilled
and he swapped straight back, measured at a swap every half second for as long as he stood there. The
first browser test written for this passed through an even number of swaps and read "tideblade", which
looked like the pickup never firing at all; a stepped probe showed it firing five times. A latch now
clears on the swap and re-arms only by stepping off the ring, and the regression stands still for four
seconds and asserts nothing changes.

Verification: typecheck, lint, production build, 121/121 node tests and the full browser suite at
46/46. New regressions cover the dwell rule and its shared shape with the stair, that every floor lays
out exactly one arm and never the sword already in hand, that the same seed hands back the same arm and
different seeds do not all offer one, that floor one uses the empty Tide Gate, that standing takes an
arm and leaves the old one, that the swing's numbers actually change with it, that standing still
cannot oscillate, and that a new descent starts on the Tideblade whatever the last run ended holding.

2026-09-17 — Something that travels: the Keep Crossbow.

Every melee rule in this keep resolves in the frame it is asked about — the arc is tested, the body is
in it or not — and none of that helps a bolt, which exists across frames. `dungeon-projectile.ts` is
pure like the rest: a shot walks its flight in sub-steps rather than jumping it, because at 19 u/s a
frame covers most of a tile and testing only where it landed is the bug the stalker's pounce had before
sweptContact existed. It is stopped by the same stone a body is, it spends its pierce on the nearest
body first rather than on whichever the caller listed first, and it never bills the same body twice.

The arm is limited by a quiver rather than by a cooldown, and that is the whole design. The knight
walks at 8.5 against a guard's 2.2 and a stalker's 3.2, so nothing in the keep can reach him if he
simply backs away while shooting: a shot that recovered on a timer would win the game by walking
backwards. Four bolts, one back every 1.8s, firing roots him at 1.4, and the 0.36s the bolt is leaving
cannot be dashed out of. A dry crossbow has a 0.2 reach and nothing to swing.

Measured rather than argued. The harness grew a `--kite` policy that backs away from whatever is
nearest — not a style but the strongest play available to anyone holding a ranged arm — plus columns
for seconds spent within reach of a woken body and for hit rate. Kiting does not break the keep, it
stalls it: 40 of 40 runs timed out at median rank 2 and 8 kills, because backing away forever is also
never clearing a room. Fought normally the crossbow escapes 97.5% against 100% for every melee arm, is
the slowest descent at 6.6 minutes against 5.4, spends 4.8% of a run within reach against 20-28% for
the melee arms, and is the only arm in the keep that loses runs at all. The quiver was 3/3.0s at first,
which read at 9.5 minutes and 10% deaths — a slog rather than a weapon — and 5/2.0s removed the risk
entirely at 0% deaths; 4/1.8s keeps both.

Bolts come out of a pool of eight and the mesh is hidden rather than freed, because the suite asserts a
built floor allocates no new GPU memory. They are cleared on floor rebuild and on restart. The quiver
readout is four pips that appear only while a ranged arm is held, so the permanent HUD stays vitality,
dash and rank for every other weapon in the keep.

Two browser assertions had to be weakened to be true. Sustained fire does not hold the quiver at
exactly empty — it oscillates between none and one, because a bolt that comes back is spent by the next
pull almost at once — so the test pins the drain rather than the sampling moment. And a pull on an
empty quiver is not testable in a live loop at all: any wait long enough for the air to clear is also
long enough to hand a bolt back, and the press then fires a real one, which is the rule working rather
than failing. Both are written down where the assertion is.

Verification: typecheck, lint, production build, 131/131 node tests. Eleven new pure regressions cover
sub-step flight, stone, pierce ordering, one bill per body, near misses, expiry, junk frame deltas, and
the refill clock including a tab hidden for a minute. Three browser regressions cover spending a bolt
and getting it back, the drain under sustained fire, and the quiver arriving and leaving with the arm.

2026-09-17 — The seventh arm: the Tideflask, which does not point at anything.

A bolt resolves against a body; a flask resolves against ground, and then keeps resolving. `Pool` and
`poolStep` join the projectile rules: burning silt that bites once every half second for two and a
half, at most once a frame however long the frame was, so a tab hidden for a minute cannot cash in a
minute of fire on the frame it returns. The flask itself deals nothing on contact — all of it is in
what it leaves — and it throws six units against the crossbow's twelve, because it is meant for a
doorway rather than a hall.

Tuned against the harness like the rest. Two charges on a six-second refill measured at 11.5 minutes a
descent against 5.5 for the starting sword, which is a slog rather than a weapon; three charges, three
seconds and eight damage a bite reads 6.3, between the melee arms at 5.4-6.0 and the crossbow at 6.6,
which is where a second ranged arm belongs. The whole table now stands at 100% escape for the five
melee arms, 97.5% for the crossbow — still the only arm in the keep that loses runs — and 100% for the
flask, with time spent within reach of a woken body running 20-28% for the melee arms against 4.8% and
4.3% for the two that do not have to be there.

One honest limitation: the harness cannot see what area denial is for. The bot throws at whatever is
nearest and walks on, where a player would put fire in the doorway a pack has to come through. The
flask's measured numbers are therefore a floor on its value rather than an estimate of it, in the same
way the surrounded-damage column cannot see what a narrow arc gives up.

Fire is deliberately not cleaned up when the knight swaps weapons. Burning silt does not care what he
is holding, and a bolt already in the air is treated the same way — both belong to the floor once they
have left his hand. What a swap does change is the quiver, which goes with the arm. A new floor clears
both, and the regression covers all three of those rules; the first version of it asserted the opposite
and was wrong.

Verification: typecheck, lint, production build, 136/136 node tests. Five new pure regressions cover
the bite clock, the hidden-tab case, what the fire catches, junk frame deltas, and the flask being an
arm that denies a place rather than killing a body. Three new browser regressions cover fire appearing
and going out, fire outliving the arm that threw it, and a fresh floor carrying none of the last one.
The weapon-table regression that required every arm to bite on contact now asks that an arm hurt
something somehow — on contact or through what it leaves — since the flask is the one that does all of
it afterwards.

## The rack offers; the swap key takes

Standing over an arm no longer takes it. The rack lights and names what is lying on it at the foot of
the screen — "PRESS E TO SWITCH TO KEEP CROSSBOW", with the arm's own line beneath — and nothing leaves
the knight's hand until he answers. The swap is a new bound action rather than a hard-wired key, so it
sits in the bindings card with the other nine and the prompt reads its legend off the bindings at
render: rebinding it changes what the floor says the next frame.

This retires the pickup dwell. It existed to stop a rack swapping the weapon out from under a fight,
and it bought that with half a second of standing still, a latch to stop the knight trading back and
forth on the rack he had just emptied, and the reverse problem — a swap he never asked for because he
stopped in the wrong place. A key answers all three at once: crossing a ring, dashing through one, or
standing in one forever now do exactly nothing, and `PICKUP_DWELL` and the latch are gone with the
`dropReady`/`dropPrompted` pair that supported them. `PICKUP_RADIUS` stays and is still the wider of
the two rings, because a rack is walked up to rather than stood on. The ring's own fill was the dwell,
so it now eases toward lit while the knight is inside it; it reports a state rather than a countdown.

The prompt is a button as well as a line of text, and it sends the same `swap` action the key does.
That is the whole of the touch story: a phone has no key to press, and without it a player on glass
could never change weapons again. It refuses pointer focus outright — `preventDefault` on pointerdown —
because a focused button would activate on Space, which is the strike key and the one most likely to be
held when a rack is touched. On a coarse pointer the key hint is hidden and the line reads "SWITCH TO
KEEP CROSSBOW"; the button is the affordance there.

It is the only prompt allowed to sit in the world, and it is not an overlay in the sense the HUD rules
forbid: it exists while the knight is inside a ring and at no other time.

Verification: typecheck, lint, 136/136 node tests, and the weapon browser spec green (5/5, twice). The
spec was rewritten around the new rule: standing in the ring offers and takes nothing however long he
waits, the key outside the ring is inert, the key inside it swaps and turns the prompt around to name
what was just set down, the prompt leaves with him, and a dash across a rack changes nothing. The text
hook's `drop` traded `dwell`/`takes` for `over` and `offered`, which is what a driver can now assert on.
The full browser suite was not run to completion this session.

## Three streams against Death's Door: silhouette, surfaces, and the blow

The keep was measured against Death's Door rather than against a description of it. Twelve of its store
stills were normalised to our own 1000x700 and 48 consecutive frames were pulled from its gameplay
trailer, so every judgement in this entry was made with the two sets side by side.

### The instrument came first

`tests/browser/shots.spec.ts` stages eight scenes on pinned seeds - a torchlit flooded hall with the watch
closing, a sealed warden chamber, the middle of a plank bridge, an unspent shrine, an ember gauntlet
mid-flare, the contact frame of a strike, a corridor with no brazier in view, and a junction branching
three ways - plus two frame sequences stepped at 16ms, one displayed frame at 60Hz: thirty-two frames of a
full strike and twenty-four of a full dash, each with the simulation clock written beside it.

Whether those captures could be trusted took three attempts and two wrong turns. Pinning `Math.random` to
stop sparks scattering made it worse, because three.js draws object ids from it and a fixed stream
perturbs render ordering. The real cause was that a keypress races the stepped clock and lands a frame
either side of it, moving the knight, the camera, and with them every pixel; the sequences now settle onto
an exact mark and fire the verb through the action event instead. A third pair, run with nothing else
touching the machine, came back with the flooded hall and the bridge bit-identical, zero pixels apart, and
the dash strip differing by a couple of hundred pixels at one value step. The strike strip still differs
run to run - but its simulation is identical across all thirty-two frames, so the swing is stable and only
the sparks are not. `zz-pixel-diff.spec.ts` is the tool that answers this question and self-skips unless
given two directories.

`tests/browser/frame-budget.spec.ts` is a ceiling rather than a report. Wall-clock frame timing was tried
first and abandoned: on a software rasteriser the same frame reports a 130ms median and a 1900ms 95th
percentile, and no build can be failed honestly on a number with that spread. The renderer's own counters
can, and they are exact. Three scenes are covered - the two heaviest, and the one where a blow lands,
which was added after a reviewer pointed out that neither heavy frame contains a blow, so nothing bounded
a change to how blows land.

`GAME_TEST_PORT` lets several checkouts verify at once; loopback stays hard-wired. `GAME_TEST_GL=d3d11`
runs the suite on the machine's actual GPU, which takes it from twenty-three minutes to two and a half. It
is deliberately not the default: the captures are the renderer's output and the reference set was taken on
SwiftShader, so CI stays there and only local iteration uses it.

### What the three streams changed

**Silhouette.** The knight's plate was 0xd8d4c8 and skeleton bone 0xd9d1bd - the same value, so a crowded
hall was four pale shapes and nothing said which one was the player. The plate is now dark and cool, the
trim hot, the cape wider and hotter, and every enemy has been pushed off the warm half of the wheel with
bone split by kind; the blade alone keeps the old pale value, so the long bright edge stays the marker
while the body drops away under it. The reasoning is worth keeping: the knight is read by the contrast he
carries, not by his value against the room, because the rooms run from a mandala at a fifth of full value
to lit paving at twice that.

**Surfaces and light.** Two rounds. The first was half ineffective and said so: the torch brightening was
dead code, overwritten every frame, so it shipped the same light with a tighter cutoff and made the pool's
hard edge worse; and the cross-tile weathering was built from sin(x) times sin(z), which is separable and
therefore lands in step with a square tile grid and deepens it. The second rebuilt weathering on hashed
value noise with three octaves rotated about 28 degrees apart so no frequency aligns with the grid, gave
the point lights physical inverse-square falloff in place of a window that collapsed inside the frame, and
returned the medallion to its original base because the lift was spending the knight's contrast for
nothing.

**The blow.** Combat scores on a cone test, so a body in the arc is struck on the first live frame - and
under the old curve that frame showed the sword parked at its deepest backswing, at yaw -1.076, behind the
shoulder and indistinguishable from the frame before. It now launches at 80% of anticipation and lands at
+0.35, crossing the target's chest. The sixteen-point star became a two-triangle shader plane, cheaper and
larger. Hit-stop went 35ms to 70ms, five frozen frames instead of three. Then the accents were found to be
running on the hit-stop-scaled clock, so freezing the world froze the flash with it and doubling hit-stop
doubled a plateau rather than lengthening a decay; they now run on unscaled wall time, and the enemy
hit-flash is stamped against elapsed time on its rising edge for the same reason. Blown pixels on the
struck skeleton across frames 06-11 went 946/946/941/937/935/935 to 705/535/381/205/162/146: one clipped
frame instead of nine, and the skull keeps its eye socket.

**Verticality.** A blind review of the merged result lost all eight pairs and named the reason as
structural: nothing rose above knee height and nothing ever occluded the camera, so every shadow was a
small ellipse and every light a smooth gradient on an unbroken plane. The cause was in code. The carved
architecture pass walked only [-1,0] and [0,-1] of a room's perimeter, and both point away from a camera at
focus+(9.2,12.5,11.5) - so every tall thing in the keep stood on the back wall and the camera-facing edge
of every room was bare paving. All four faces are now walked, with near faces getting instanced work only
so a whole near wall costs triangles and no draw calls; interior pillars went from bollard height to nearly
six metres, the back pilaster was raised until the moon's rake was longer than the pier is wide, and the
parapet doubled in height and thickness at the same instance count.

### Cost

Twelve dash-trail meshes were faded to zero opacity and never made invisible, so they drew in every frame
of every scene; gating them on their own lifetime gave twelve draw calls back everywhere. A parapet shadow
pass was tried and rejected - it runs the border of every tile and cost more triangles in corridors than
all the vertical structure combined. Net against the original baseline, after everything: flooded hall 508
to 511 calls, junction 399 to 407, and the contact frame 389 down to 365.

The budget was raised 15% on both counts, deliberately and by the owner, to pay for vertical mass; the
figures in the gate record the original numbers and the reason. Most of it went unspent.

### What a blind reviewer still says

Set against the reference with the labels stripped and the sides shuffled, the keep lost 1-8 and then 0-8.
Two criteria are now called near-competitive by a reviewer who did not know which set was ours: finding the
player, where the knight is top two in most pairs, and colour discipline, which holds across all eight with
no hue drift. It loses on surface interest, sculpted form, occlusion and whether anything is happening in
the frame. Named as still missing: an arch that physically crosses the play space, corridors and spans that
the masonry passes skip entirely, and frame corners that the reference always crowds and ours leave open.

One measurement caution, found by running our own findability metric on the reference: Death's Door's crow
scores 10 and 0 for "brighter than its background" and 103 and 92 the other way. A metric that asks whether
the hero is pale rewards exactly the defect this work removed. Judge separation in both directions.

Verification: typecheck, lint, 137/137 node tests, 66/66 browser tests, the frame budget at all three
scenes, and a production build - all green on the merged tree. The verticality work is not in this commit;
it is still under review.

## The palette becomes a place

`docs/art-direction.md` is the standard this round was measured against. Its rule is that colour carries
category and that urgency is carried by a hard edge closing on a clock, above the tone-mapped range.

### What was wrong

Four torch lights were hardcoded `0xff9440` and fire was not a field of `Mood` at all, so the one saturated
thing in any frame was identical in all three families and a theme could only be a filter over the stone.
Every banner in the keep hung from the same `red` material as the knight's cape. Carved work - columns,
cornices, archivolts, parapets, the bowls fire sits in - was one neutral grey chosen for a keep that had a
single palette, which came out of every key in the game brighter than the knight. And the windup tell, the
one mark a player answers on a deadline, ramped opacity from 0.2 to 0.7 at a fixed size and colour: it said
a blow was coming and never said when.

### What it is now

`Mood` carries `fire`, `banner` and `masonry`, and the frame drives the torch lights, the flame bodies,
their cores, the halo sprites, the ember motes, `borrowedLight`'s home colour, the cloth, the carved stone,
the prop bases, the brazier bowls, the parapets and the medallion bed from them. The keep burns violet
witchfire, the ruin real flame, the flood a cold bioluminescence. Two of the three left amber, which is
what freed hot red for the tell in every chamber.

The tell converges rather than fades: it opens at 1.9x the reach the blow has and shuts onto the body, at a
constant 0.88 opacity, in one colour for all three kinds - shape and eye hue already carry which body it is.
It draws with normal blending, not additive. That was the round's sharpest finding and it came from a
measurement, not an opinion: additive means floor plus red, so the paving's own green and blue survive and
set the hue, and the same `0xff4529` measured out as dusty pink over the keep's violet slate and muddy
orange-brown over the flood's teal. The two families whose fire had just been moved off amber were the two
where red failed. Normal blending at high opacity carries its own colour instead.

The body is the tell's second channel. It already lit during a windup, at one flat dull brick for the whole
of it; it now takes the threat colour and rides the same clock. Drawing the arc through the world was tried
so a pier could not hide it, and reverted - a hot arc painted over solid stone makes the stone look like
glass and smears the knight it crosses, which is a worse lie than a mark partly behind something. The body
channel is what makes an occluded tell still a tell.

Paving dropped into the low thirties and gained chroma; carved work and coursework came down under it,
because measured off the frames they were running twenty points of lightness above the floor they stood on,
which makes a chamber a bright cage around a dark pit with nothing in it reading as lit by the braziers.
The medallion's brass went to worn inlay a tenth above its bed: it was a hard bright ring on the floor of
every chamber, which is the form and family the stair is the only thing allowed to speak in, and its star
sat brighter than the knight standing on it.

### Measuring it rather than arguing about it

`tests/browser/art-direction.spec.ts` settles both of the document's claims off the rendered canvas in CIE
Lab, not off the constants - what a tell is worth on screen is what survives the key, the fog, the
weathering shader and ACES, and none of those are visible from a palette table. It draws each chamber twice,
once with the body at rest and once at the top of its tell, and differences the frames: the pixels the mark
covers are exactly the pixels that changed, so nothing has to know where the decal landed on screen. It
asserts the three fires are more than forty degrees apart, that the mark is mean dE 25 from the stone under
it, and that its core is within eighteen degrees of `THREAT` at chroma 45 in all three families. That last
pair is the regression guard for the additive bug.

The first run of it failed, usefully: the keep's witchfire and the flood's bioluminescence were 28 degrees
apart in Lab, which is two blues, not two places. Both moved.

`dungeonTest.teleport` now snaps the mood rather than sliding it. A threshold crossed on foot is worth a
third of a second of cross-fade; arriving by fixture is not a walk, and a driver teleporting into a chamber
to photograph it was catching the lights still on their way there. `render_game_to_text` carries a `mood`
block for the same reason: the room graph cannot answer which family is lighting a frame, because on the
approach the answer is genuinely neither room's.

### What four rounds of an independent critic found

Every round was reviewed by a critic given the document and the frames and nothing else, and told to
measure rather than look. Four things it found that reading the source would not have:

The tell was drawn additively, so the paving underneath set its hue. The same constant measured out as
dusty pink over the keep's violet slate and muddy orange-brown over the flood's teal, in exactly the two
families whose fire had just been moved off amber to leave red free. Opaque now, and at full opacity
rather than the .88 a first cut used: at .88 the mark topped out near 94 of a possible 100 while a
brazier core clipped at 100, and a signal carrying a deadline may not be dimmer than the furniture.

The keep's witchfire and the flood's bioluminescence were 28 degrees apart in Lab. Two blues, not two
places. The first run of the new spec caught it before a human looked at a frame.

The pillar plinth and capital were built from the brazier's brass, which is why one warm tan slab
survived three rounds of recolouring every stone around it. And the flames were washing white because an
additive halo sprite sits over the whole flame — two rounds were spent correcting the core mesh, which
was never the white thing.

The spec itself claimed to measure pixels and was comparing palette constants. It passed comfortably
through the round in which four fifths of the bright pixels in both cold chambers were rendering under a
quarter saturation. It reads the canvas now, and a brightness band went in beside it: "dark field" has no
lower bound written into it anywhere, and three rounds of honouring it took the frame's ninetieth
percentile from the mid forties to the low thirties one step at a time with nothing watching.

Verification: typecheck, lint, 142/142 node tests, the full browser suite, and four measured assertions
per chamber in `art-direction.spec.ts`.

### The small things

A pass over what was left after the critic stopped failing it, none of it structural.

Five tokens in `globals.css` were declared and never referenced, which is the smell a token block exists
to remove; four are wired to the literals they duplicated and `--ink-panel` is gone, because every use of
that colour carries an alpha and a `var()` cannot take one appended. The Unicode heart beside the
vitality figure was the one glyph in the game borrowed from a web page, and a screen reader had to say it
out loud before reaching the bar underneath that already means the same thing: it is the rotated square
the title sigil is cut from now, in the threat channel, and marked `aria-hidden`. The rank track spends
most of a run empty and at three pixels on a near-black fill with its border removed it read as a dead
black bar under the other two rather than as a channel waiting to fill; a faint track instead.

The medallion had been over-corrected. Putting the star under its bed was right and taking the rings and
ticks with it was not: everything inside three points of the same value is a stain, not an engraving. A
cut reads as a cut because it has both edges, so the star and the ticks keep the trough and the three
rings take a lit lip. They are a quarter of a unit wide, which is the whole reason a lip can be lifted
there at all — at that width it is a drawn line, where the same value across the star's face was a slab
catching the moon.

The ember grate went too far the other way in the same pass. Its dormant colour had been sitting on the
telegraph's own hue to within a fifth of a degree at two and a half times its chroma, so a grate doing
nothing wore the colour that means a blow is landing; the correction made it dead grey, and a hazard the
player cannot pick out of the paving is not a fair one. Scorched iron: nineteen degrees off the tell and
at a third of its chroma, visible as a burnt thing and not as a warning.

## The wait gets a screen

Three moments in this game make the player wait on the main thread, and none of them said so. The
longest is the first: the page paints its intro card at about 200ms and the world is not built until
about 700ms, so for half a second the card offered a dead LOADING… button over a black rectangle. The
other two are the floor builds — a descent and a fresh run — which measure 70 to 160ms here on a
desktop with a GPU, and are the only work in the game that blocks long enough to be felt.

A veil now covers all three. It is markup in the prerendered HTML rather than an overlay raised by an
effect, which matters more than it sounds: the wait it covers starts while the bundle is still
arriving, so anything React mounts is by definition too late for it. The first test in
`loading.spec.ts` asserts exactly that by reading the served HTML.

The two floor builds needed the work deferred, not just a flag set. A single `requestAnimationFrame`
callback still runs before the frame it belongs to is painted, so a build behind one would land on the
very frame the veil was meant to appear in and nothing would ever be seen; `veiled` waits two, and
takes a third afterwards so the new floor is drawn under the veil before it lifts rather than flashing
the floor it just left. The mark turns on `transform` alone, which is a compositor animation and
therefore the one thing on screen that keeps moving through a block the main thread cannot answer.
Under a reduced-motion answer it fades instead of turning, rather than going still like the drifting
prompts — a player who asked for less movement still has to be told the keep has not stopped.

`veiled` carries its own `building` flag because the status each caller guards on does not change
until the work it is holding actually runs: without it a second press on DESCEND would queue a second
build of the same floor. The flag is on the snapshot too, so a driver can tell a floor that has not
arrived yet from one that never will, and `game.built()` is what the three tests that cross a build
now wait on.

Verification: typecheck, lint, 142/142 node tests, the full browser suite.

## Controls: a pointer, a pad, a dash that travels, and a string

Plan 003. The keep's controls were one verb short of its genre: aim was movement. The swing took its
direction from whatever the movement keys said on the frame it started, so the knight could strike in
eight directions and never in one while walking in another. The Tideblade's arc absorbs the 22.5° that
costs; the Keep Crossbow's does not. A bolt carries 11.8 units and stops within 0.62 of a body, so a
worst-aligned target was struck out to about 1.5 of those units and the other ten were decoration.

`dungeon-aim.ts` is the way out, and it is pure: `groundPoint` inverts the orthographic projection in
closed form — orthographic is what makes it exact rather than a raycast, because every screen point
sends a ray the same way — and `snapAim` closes the gap the keys leave by pulling a swing onto a body
within 35°. The camera basis is derived from `CAMERA_OFFSET` rather than written down beside the one
the game loop already had, and a test asserts the two agree; had they drifted, a pointer and a key
would have steered in different worlds and no amount of tuning would have made aiming feel right.

The rule that decides who owns the aim took two attempts. "Last device wins" is wrong, and the browser
test caught it: it let a *movement* key take the aim back, which breaks the one case a pointer exists
for. Walking right while cutting left has to be expressible. Striking or dodging from the keyboard is
a claim on the aim; walking is not — so someone on the keyboard with a cursor parked wherever the
intro card left it is never aimed at that corner, and someone on a mouse can retreat and cut behind.

The simulator could not measure any of this. `attackFacing = toward` — it has always aimed perfectly,
so it never modelled the quantisation the change removes, and the "pre-aim baseline" the plan asked
for would have been the post-aim world under another name. `--quantise` fixes that, default off so
every number this repository has recorded still means what it said. What aim is worth, measured: the
five melee arms do not move at all (4.5m before and after, all of them), and the crossbow goes from
61.7% of runs escaping to 99.0%, from 38.3% dying to 1.0%. Not dominance — at 6.1m it is still the
slowest arm in the keep. It went from unusable to viable, which is a different claim than the one
the plan made, and the batch is why we know.

The dash now travels. 0.18s at 12 netted 1.12 units over a walk against a warden's 2.55 reach, which
made it an invulnerability blink rather than a way to be somewhere else. What sets the new numbers is
one rule, and it lives in the suite rather than in a comment: `DASH_TIME * (DASH_SPEED - WALK_SPEED)`
must clear a warden's reach. The first pass at 0.24s and 19 nets 2.52 against 2.55 and fails its own
rule by three hundredths; the test said so, and 19.5 is what passes. Immunity covers only the first
0.1s, so the tail is a commitment. The proximity tax is gone: `weapon.moveSpeed` already charges for
committing to a swing, and charging again for merely standing near something awake cost mobility
exactly when responsiveness mattered.

That first tuning was too strong and the batch said so — a warden went from dealing 44% of the damage
the knight suffered to 7%, which is to say it stopped being what kills people. Cooldown to 0.8s and
immunity to 0.1s puts uptime at 12.5% against the old 13%: the same defensive value, bought with a
dash that covers two and a half times the ground. The distance was never a lever.

Worth recording about the instrument: the navigator escapes 100% of runs and dies in 0% both before
and after, at every policy tried. The batch measures pace and the composition of damage, and those
moved clearly — every arm 0.6 to 0.9 minutes faster. It is not a measure of whether a human can die,
and tuning hard against it would be trusting it past what it can see.

Finally the held strike has a shape. It used to restart an identical swing forever, so holding the key
was strictly optimal and carried no rhythm. The Tideblade and the Twin Fangs now swing three beats:
the second mirrored, the third slower, heavier, rooted and committed for longer — and `canAbortSwing`
already refuses a dash inside contact, so the cost of the finish falls out of a rule that was already
there. A beat is a `Partial<Weapon>` overlaid on the arm, which is why this needed no new plumbing:
`swordContacts`, `playerAttackPose`, `playerSpeed` and `canAbortSwing` all take a Weapon already. The
other five arms have no chain and are untouched; a string on a slow committed heave is a different
weapon, not a better one.

Verification: typecheck, lint, 163/163 node tests, and the browser suite including new `aim.spec.ts`,
`dash.spec.ts` and `chain.spec.ts`.

## A dash that could never ride out a flare

`main` went red on the merge of #30 and nobody noticed: run 35580107278 on `3ad0055` failed
`gameplay.spec.ts:321`, the same test that then failed on the next branch off it. The run before it, on
`beac77e` itself, passed - which is the only reason this looked like flake. It is not. The test fails
15 times out of 15 locally: on SwiftShader and on d3d11, with captures on and off, on one worker, and
on a clean `beac77e` checkout in a separate worktree with nothing else applied. Always 58 then 48.

The gauntlet's burn is latched by `feature.burned`, and the latch sat behind the hit:

    else if (!feature.burned && near < 1.8 && hurt(run, 10, { dashing: dashImmune(dashTime) })) {
      feature.burned = true; ...

So a refused hit left the ring armed and it tried again on the next tick. A dash carries
`DASH_IFRAMES` of 0.1s out of a `DASH_TIME` of 0.24, and a flare burns for a whole second, so the ring
always outlasted the i-frames and landed the blow the moment they lapsed. A dash could not ride out a
flare at all - which is the one thing a dash through fire is for, and what the test's own name claims.

The comment two lines above already said what was intended - "one tick per flare, cleared when the ring
goes cold", and that the 0.65s hurt timer used to do this job - so the code did not match its own
stated design. The latch now fires on the tick the flare reaches him, landed or not.

Worth being plain about the alternative that was rejected: narrowing the assertion to the 0.1s i-frame
window would have turned the suite green without touching the game. It would also have made the test
assert the opposite of its name, and frozen a regression in place as though it were the design.

Verification: typecheck, lint, 163/163 node tests, and `gameplay.spec.ts`, `combat.spec.ts` and
`dash.spec.ts` in full - 18/18, including the failing gauntlet scenario, `a lethal gauntlet ends the
tick`, and `the dash is immune at the head and exposed in the tail`, which pins the window this change
deliberately does not widen.

## Nineteen minutes of pull-request feedback, and where it went

Measured off the CI logs of run 35576604538 rather than guessed at. `checks` took 37 seconds and
`build` 38; the two browser shards took 18.8 and 18.1 minutes. So the browser suite is the entire
wall clock of this pipeline — about 37 minutes of work — and everything else is noise beside it.

Three things in that 37 minutes, from the per-test times in the log:

**The boot floor is 12 seconds and it is paid 85 times — about 17 minutes, or 46% of the suite.**
The cheapest meaningful test in the suite is `smoke.spec` at 12.0s; `dash.spec:40` is 12.3s and
`combat.spec:243` is 12.7s. The control is `loading.spec.ts:10`, the one test that does not take the
`game` fixture: **60 milliseconds.** All of it is `Game.open` — fresh context, `goto('/')` against the
Vite dev server, three.js, a WebGL context on SwiftShader, a floor, a frame.

**The captures cost about 3.5 minutes and CI deleted every one of them.** `shots.spec.ts` alone is
5.6 minutes, of which the strike sequence is 1.6 (32 frames) and the dash sequence 1.4 (24 frames) —
roughly 2.6s per capture on a software rasteriser. The upload step in the workflow is `if: failure()`,
so a green run drew eighty frames and threw them all away. Worth stating plainly because the waste was
invisible: the job looked like it was testing.

**The remaining ~16 minutes is real simulation and assertions**, and is not obviously reducible.

### What changed

Captures are off unless asked for. Nothing in the suite asserts on a PNG, and this was checked call
site by call site rather than assumed: every helper that reads pixels — `loudestColour`,
`tellAgainstStone` — calls `advanceTime(0, true)` itself, and the two places that hold render counters
against a ceiling (`polish.spec:57` and `:82`) are preceded by their own `step(…, true)`. So
`Game.capture` is a no-op under `GAME_TEST_CAPTURE=0` and skips the draw as well as the readback, which
is the expensive half. Failure diagnostics are untouched: those come from the config's
`screenshot: 'only-on-failure'`, not from this helper. The reviewed set is now taken deliberately, from
the `captures` input on the workflow, which is also the only way to get it off the same SwiftShader the
baseline in `output/shots/baseline/` came from.

Two shards became six. The runners are free on a public repository and the only floor is the ~50s each
one spends on checkout, `npm ci` and starting a dev server.

`workers` became `GAME_TEST_WORKERS`, and CI sets it to 2. The old comment claimed a second WebGL
context on one machine "only adds noise", and that does not survive contact with the suite: **nothing
here measures wall-clock time.** The clock is stepped by hand through `advanceTime`, and
`frame-budget.spec.ts` holds the renderer's counters precisely because a software rasteriser's
durations have a 130ms median against a 1900ms 95th percentile and cannot fail a build honestly. What
the old setting actually did was leave three of a runner's four cores idle. Two rather than four
because SwiftShader is CPU-bound and the third and fourth workers would mostly contend.

And `GAME_TEST_GL=d3d11` is now in `AGENTS.md`. It has existed since the graphics pass and was recorded
only here, in one line of this file — which is to say the single biggest lever on local iteration,
twenty-three minutes down to two and a half, was undiscoverable.

### What this does not do, and what was rejected

It does not touch the 17 minutes of boot, which is now the largest remaining cost by a wide margin. The
structural fix is a worker-scoped page — boot once per worker, reset between tests through a new
`dungeonTest.reset(seeds)` alongside the `buildFloor`, `teleport`, `equip` and `grantXp` hooks that
already exist — and it would take those 37 minutes to about 22. It is deliberately not done here. This
suite's whole premise is per-test isolation, and a reused page is exactly the failure this repository
has already had once: the 2026-09-16 entry above records a reused stalker carrying a released pounce
across a test boundary. That trade is worth making only if four minutes still proves too slow.

Serving a production build instead of the dev server was also considered and rejected: the fixtures need
the dev-only `configureCombatFixture`, and "the real page" is part of what these tests are for.

Verification: typecheck, lint, and `progression.spec.ts` locally with zero PNGs written, which is what
confirms no assertion depended on a capture.

Then measured on CI, run 35588947404: **5 minutes 32 seconds against nineteen and a half.** Shard times
were 5m21s, 4m32s, 4m51s, 5m32s, 3m40s and 3m44s, so the split is even enough that a seventh shard
would buy little against its own ~50s of setup. `GAME_TEST_WORKERS=2` is no longer untested: two
workers drove every shard and the timing-sensitive scenes came through, including `junction`, whose
counters drift within a band and were the thing most likely to mind the company.

That run was red, on `gameplay.spec.ts:321` — but so was `main`, on the same test, before this branch
existed. See the entry above. Nothing here caused it: the test failed 15 out of 15 locally on both
renderers, with captures on and off, on one worker, and on a clean checkout of the commit this branch
started from.

## One page per worker, and the guard that makes it safe to say so

The entry above left 17 of the suite's 33 minutes in per-test boots and said why it was not touching
them: this suite's premise is per-test isolation, and a reused page is the failure this repository
already had once. That reasoning was right about the risk and wrong about the price of covering it.

The reset itself turned out to be small, because the game already had one. `restart` is what the end
screen runs, and its comment states the property this needed: "A whole new `run` is the point of
`createRun()`: a field added to the sim can never be forgotten here." So `dungeonTest.reset` is that
path plus the few counters a restart deliberately keeps - `hasStarted`, the clock - because a player
restarting has already started and a fresh page has not. That second half is the part that can rot.

### The guard is the actual work

Every pooled scenario ends by resetting back to the seeds its worker booted on and holding the whole
snapshot against what that boot produced. Not a list of fields to check - the whole snapshot, minus a
`DRIFTS` list that is three entries long and carries a reason each. Two properties matter:

- It fails the scenario that left the state behind, naming the field, rather than the innocent one
  that inherits it three tests later. That is the difference between a morning and a day.
- It cannot be satisfied by remembering to reset things. Either the page comes back to boot state or
  the suite says which field did not.

It earned that on the first run. Three leaks, all of which a hand-written checklist would have missed:

**The AudioContext stays running.** A page that booted but never started a run has no running context
and one cannot be un-started - the browser hands it out on a gesture and keeps it. This is the only
true drift admitted, and it went in as `settings.sound` rather than `settings`, because `muted` lives
beside it and is game state.

**The rig froze mid-stride.** Poses are reached by damping, and `advanceTime(0)` has a `dt` of zero,
so nothing moves: a knight left mid-swing by one scenario was still mid-swing for the next. Fixed by
recording every transform the rig is born with and restoring it, rather than listing bones - a list
would want a new line every time the knight grows a joint, and the list is what rots.

**A quaternion round-trip.** Restoring through `quaternion` returned -0.1 as -0.09999999999999999.
That one was not forgiven in the guard: the cause was the restore, so the restore stores Euler. Only
genuine damping residue below 1e-9 is snapped, and the threshold says why.

### Numbers, and the shard count

Locally on d3d11 the whole suite is 88 tests in 1.8 minutes; a scenario that cost seconds now costs
about 600ms, and the boot is paid once per worker instead of 88 times. CI is the case that matters,
where a boot was twelve seconds rather than one.

Shards went from six back to three in the same change. Six was right when the work was 33 minutes; at
under twenty it would spend more of the run on the ~50s of checkout, `npm ci` and dev server than on
testing. Three also halves what a single run holds - at eight jobs a run, two overlapping runs came
close enough to a public repository's concurrency limit that a third queued, which is exactly what
made the merge of #31 sit for thirteen minutes before it started.

### Two guards outside the suite

`GAME_TEST_ISOLATE=1` restores the old boot-per-test path and runs nightly on main. If it disagrees
with the pooled run in either direction, a reset is not returning a page to boot state and the
in-suite guard has a hole. The answer is to close it in `reset`, not to widen `DRIFTS`.

And an `alarm` job, because the thing that actually went wrong today was not a slow suite. The merge
of #30 went red on main at 08:51 and nobody saw it; the next branch cut from main inherited a failing
test, and an afternoon went into proving the failure predated the change under review. A pull
request's red X is on a page its author is looking at. A red push to main is not. The job opens an
issue. It is the weaker half of the fix - the stronger one is requiring these checks before a merge,
which is a branch protection setting and cannot live in this file.

### The race pooling uncovered

The first CI run of this change failed one scenario, and it is worth recording because the cause was
not the pooling and the fix was not to slow anything down.

`a second press while the veil is up does not build a second keep` sent its two presses as two
`act('restart')` calls, which is two round-trips into the page. `veiled` holds `building` for three
animation frames, about 50ms; a round-trip is usually well under that, so the second press normally
arrived while the veil was up and was suppressed. When it does not, the veil is already down, the
second press is an ordinary restart, it eats the next pinned seed, and the assertion reads floor 3's
seed where it wanted floor 2's - which is indistinguishable from the bug the test exists to catch.

That race was always there. What this change did was lose it: a worker used to spend most of every
scenario waiting on a page load, and now it drives the simulation continuously, so the neighbouring
worker on the same runner is genuinely busier and the round-trip is genuinely slower.

The fix is to stop racing. `act` takes several actions and dispatches them in one evaluate, with no
frame between them, so "while the veil is up" is guaranteed by construction rather than by winning a
timing bet. Fifteen consecutive local runs of that spec pass. A test that has to be fast enough to
pass is not testing what its name says.

Plan 004: replaced the single 16-point compass every room's medallion bed carved, whatever its
theme, with three theme-distinct constructions. `dungeon-decor-layout.ts` is new and pure -
`decorReservations` gives conservative world-space rectangles for every room's motif, the goal, a
sanctuary's clear centre, a gauntlet's whole floor and the weapon drop; `planRoomMotif` plans at
most one motif per room from a seed and room id, rejecting only a gauntlet, the goal, a keep
sanctuary (no fragment of a solid shield can hold a hole without becoming something else) and a
motif that would spill onto a hole, a corridor, wood, or the drop's own clearance, shrinking the bed
conservatively before giving up on it entirely. `dungeon-floor-motifs.ts` is new and builds three
canonical unit-space constructions - keep an octagonal bed with a shield cut and a hairline split;
ruins three separated sectors of that same octagon, the fourth dropped outright, each edged where it
was cut and carrying one broken chevron; flooded three parallel channels crossed by two bars, no
disk at all - and bakes every room's instance straight into merged, per-material, per-region
geometry (the same 12-tile regions `dungeon-game.tsx` already batches paving with), reusing the
existing `dark`/`inlay`/`lip` materials rather than adding new ones. `dungeon-art.ts`'s
`addCarvedArchitecture` calls the two in place of the old disk/rings/star/ticks block. A sanctuary's
1.6-unit clear centre is built into the ruins/flooded construction directly (an annular sector, a
channel with a circular gap cut around the origin) rather than trimmed out of a construction that
runs through the centre - the first version did the latter, and a channel or a fan sector that
passes through the centre loses far more than the circle itself once whole triangles are dropped
instead of the geometry being built to avoid it; a triangle-centroid clip against `clearRadius`
remains as a safety net, not the primary defence. `addAtmosphere` threads the realized list through
as `motifs` on its return value (a one-line, additive change to `dungeon-atmosphere.ts`, which is
outside this plan's stated file list but unavoidable: it is the one link in the existing
`buildFloor -> addAtmosphere -> addCarvedArchitecture` call chain the plan itself keeps, and there is
no other way to reach `dungeon-game.tsx` without calling `addCarvedArchitecture` a second time).
`dungeon-game.tsx` exposes it as `graphics.motifs` on `render_game_to_text`, so a driver can check
what actually got attached rather than a second recomputation of the planner's own descriptors.

New tests: `dungeon-decor-layout.test.ts` (repeatability, all three themes across a sample, no
mutation, every room shape, negative coordinates, goal/gauntlet exclusion, sanctuary clearance, drop
clearance, reservation shapes) and `dungeon-floor-motifs.test.ts` (finite/upward-facing/in-budget
triangles across ten seeds and three levels, every vertex inside some planned bed, a sanctuary's
clear centre empty but still holding a substantial motif outside it - the regression guard for the
bug above, which the first, narrower version of this test would not have caught - stable rebuilds,
safe disposal). `tests/browser/floor-motifs.spec.ts` checks the live scene against the pure planner
on the same floor (exact match, not a re-derivation), all three themes realized on seed 0x1, no
motif in a gauntlet or the goal, no keep motif in a sanctuary, a pinned-seed reset realizing the same
motifs, and stable geometry/texture counts across four rebuilds; a second block captures each theme's
motif (combat frozen first, so a live windup cannot obscure the frame) at desktop size, a third at
390x844 phone size.

Verification: baseline `art-direction.spec.ts` and `frame-budget.spec.ts` were run and captured
(`test-results/graphics-004-before`, SwiftShader) before any source edit. After: `npm run typecheck`,
`npm run lint`, `npm test` (178 tests, the 15 new here), the full `GAME_TEST_GL=d3d11` browser suite
(97 passed, 1 pre-existing skip), and `npm run build` all pass; `git diff --check` from root is
clean. Removing the per-room disk/rings/star/ticks meshes and replacing them with merged,
region-batched geometry left every frame-budget scene under its ceiling with room to spare rather
than closer to it: flooded-hall 434/439 calls and 193,188/198,818 triangles, junction 490/502 and
332,890/343,716, strike-contact 371/447 and 152,556/236,196 (all previously nearer their ceilings).
Captured and opened `test-results/graphics-004-after` (SwiftShader, seed 0x1) alongside the before
set: the keep motif reads as a clean octagon with a traced border and a hairline split; the flooded
motif's three channels and two crossbars are legible even before zooming; the ruins motif was, on
first capture, reduced to an almost invisible sliver inside a sanctuary room (the clip-after-building
bug above) - fixed and re-captured, after which a live, non-sanctuary ruins room shows the radiating
cut-edge hairlines and the gap where the fourth sector is missing. Reviewed at desktop (1000x700)
and phone (390x844) sizes, and against the existing `art-direction.spec.ts` telegraph and fire
measurements, which are unchanged. Limitation carried forward: the ruins motif is the most visually
subtle of the three against its own warm, already-dark paving and the existing seal ring's wash;
distinguishable at native size and confirmed geometrically distinct and correctly built by direct
inspection, but a future pass could give it more contrast if a reviewer wants it louder.

CI follow-up: `browser (2)` (of 3) failed 3/3 times, always on the same pre-existing, unrelated
test - `polish.spec.ts`'s "polish on a phone" - timing out in `Game.enter()` waiting on
`render_game_to_text` after `page.goto('/')`. Confirmed against the last six merged PRs that this
test never fails on `main`, so the failure traced back to this PR rather than pre-existing
flakiness. Root cause: `floor-motifs.spec.ts`'s three "a ${theme} chamber's motif reads at phone
size" tests each declared their own `test.use({ viewport, isMobile: true, hasTouch: true })`, which
`needsOwnPage` (helpers.ts) turns into a brand-new isolated browser context per test - a full fresh
page boot (module load, WebGL context, first floor build) rather than the worker's pooled page the
rest of the suite reuses. CI's per-test timings showed those three tests costing 23.7s, 16.4s and
27.4s - almost entirely boot overhead - on a `GAME_TEST_WORKERS=2` shard already carrying another
new, expensive test ("repeated rebuilds..." at 44.4s); the combined wall-clock pushed shard 2 long
enough that `polish.spec.ts`'s own pre-existing isolated-mobile test (paying the same fresh-boot
cost, and sharing the same resource contention) reliably blew through its 15s boot timeout.
Fix: the phone describe block's three per-theme tests were consolidated into one test that boots a
single isolated mobile context, then walks the knight between the three theme rooms already known
to coexist on seed 0x1's floor (per "three different theme motifs are attached" above) via
`game.teleport`, checking and capturing each in turn - one fresh-boot cost instead of three, with no
coverage dropped (same per-theme assertions, same three named captures). Locally this dropped
`floor-motifs.spec.ts`'s total runtime from roughly 33s to about 22s for the file, with the phone
block itself running in ~1.3-1.4s once warm (not directly comparable to CI's cold, contended
timings, but confirms one boot replaced three). Re-ran the full gate: `npm run typecheck`, `npm run
lint`, `npm test` (178 tests), `GAME_TEST_GL=d3d11 npm run test:browser` (95 passed, 1 pre-existing
skip, including `polish.spec.ts`'s phone test unmodified), `npm run build`, and `git diff --check`
from root - all pass.

## Plan 005: three flames instead of one octahedron in three colours

Implemented on top of 004, same working tree. Baseline established first: `npm run typecheck`,
`npm run lint`, `npm test` (178 tests) and, on `GAME_TEST_GL=d3d11`, `art-direction.spec.ts` and
`frame-budget.spec.ts` (7/7) all passed before any source edit, and a SwiftShader capture of
`art-direction.spec.ts` was taken first (`test-results/graphics-005-before`) for a genuine before/
after comparison - the working tree was set aside with `git stash push -u`, the pre-edit capture
run, then the stash re-applied and dropped by its own SHA (never a bare pop, since this worktree
shares its stash stack with the main checkout and other worktrees).

New `game/app/dungeon-flame.ts`: three theme geometries (`createFlameGeometry(theme, part)`), built
from explicit vertex/face lists and `computeVertexNormals` rather than a stock primitive, each
capped at 8 triangles per body-or-core geometry. `keep` is a tall, asymmetric bipyramid, tip leaning
off axis; `ruins` is two closed tetrahedra sharing one `BufferGeometry` - a tall tongue and a short
one at 65% of its height, standing well apart on the local x axis; `flooded` is a squashed bipyramid
with an off-centre peak and a wide equatorial ring. A pure `flamePose(theme, time, phase)` returns
scale/offset/yaw for one instant - deterministic, no allocation, and unit-tested for exactly that.
`emberOffset(theme, t, phase, slot)` gives the existing six ember slots per source a rising, a
drifting or a clustered-local motion by theme, reusing the same buffer.

`dungeon-atmosphere.ts`: `PROP.flame` (the shared octahedron) is gone. A brazier's theme is resolved
once at build time from `floor.rooms[prop.room].theme` - never the current chamber's fire colour or
the camera's room - and a per-atmosphere-instance `Map<string, BufferGeometry>` (keyed `theme:part`,
never marked `shared`) builds each shape lazily and is released by the existing floorGroup traversal
on rebuild, exactly like any other prop mesh; nothing here introduces a module-level cache. `flames`
became typed records (`body`, `core`, `theme`, `phase`, `base` position) in place of a bare
`THREE.Mesh[]`; the per-frame update calls `flamePose` once per source and applies scale/offset/yaw
to the body, which the core inherits for free as its child. Body centres sit at 1.52/1.43/1.28
(keep/ruins/flooded), each theme's core is its own smaller geometry (not the body geometry under a
runtime scale - see the deviation below), and the halo keeps its existing sprite and additive
material but shrinks per theme (2.0x3.3 / 2.6x2.7 / 2.7x1.9, all inside the old 2.7x3.5 ceiling).
`render_game_to_text` gained `graphics.flames`: theme, and body/core width/height/depth/y read off
the actually-attached mesh's own geometry bounds and current pose scale, not the design table
recomputed - the same "attached, not recomputed" contract `graphics.motifs` already keeps for 004.

New tests: `dungeon-flame.test.ts` (9 cases - triangle caps, finite/non-degenerate bounds, the three
aspect profiles including a direct check that `ruins`'s two tongues sit on both sides of the shared
centre at roughly a 65% height ratio, `flamePose` purity and allocation-freedom via a `Float32Array`
constructor spy, phase desync, ten seconds of sampled poses never sinking a body below y=1.03, and
each theme moving only the channels its own spec names) and `tests/browser/theme-flames.spec.ts` (a
brazier's theme/count/core-proportion resolve from `floor.rooms[prop.room]`; a zero-time redraw and
a pause both leave every source's reported pose unchanged; crossing into another theme's room never
swaps an old brazier's shape; a pinned-seed rebuild after all three shapes have drawn settles at
stable counts; one capture test per theme showing four idle phases plus a mid-windup frame; one
isolated mobile context - not three - walking the knight between all three theme rooms already known
to coexist on seed 0x1, per the CI-budget lesson 004 paid for).

Two deliberate deviations from a literal reading of the plan, both driven by what a rendered capture
showed rather than by the geometry alone:

- **No per-source static yaw.** A first pass gave each body's `rotation.y` a fixed value from its own
  seeded `phase`, so two braziers of the same theme would not look like one stamped copy of the
  other. Captured and reviewed, this actively broke `ruins`: its two tongues sit apart on one local
  axis, and a random yaw just as often turns that axis to face the fixed isometric camera edge-on,
  hiding the shorter tongue behind the taller one - a captured `ruins` brazier read as one spike,
  indistinguishable from `keep`. `rotationY` is now 0 for every theme; `phase` still desyncs each
  source's breathing/sway timing, which is the desync the plan actually asks for ("Seeded phase per
  source avoids synchronized breathing") - only the extra, self-imposed static rotation is gone.
- **`ruins`'s core is not 45-55% of body width.** That figure is written for one peak, where a
  body's overall width and a peak's own reach are the same measurement. For `ruins` the body's width
  is mostly the *gap* between its two peaks; a core built by uniformly scaling the body's own
  geometry toward its shared local origin (which is what `keep` and `flooded` do, correctly, since
  they have one peak) pulls both peaks toward each other by that same factor, and at 45-55% scale
  that collapses back into the single-spike failure above - confirmed by a captured, reviewed frame
  before this was caught. `ruinsFlame`'s core keeps both apexes at the body's own x position and
  shrinks only each tongue's own height (still <=65%) and radius, which `theme-flames.spec.ts` checks
  with a `ruins`-specific bound (core visibly smaller on every axis, never within 95% of body width/
  depth, never collapsed under 30%) in place of the universal 45-55% window used for the other two.
  Both exceptions and their reasoning are written on `ruinsFlame` and `flamePose` in
  `dungeon-flame.ts`, and repeated in `docs/art-direction.md`'s new "Flame silhouettes" section.

Verification: `npm run typecheck`, `npm run lint`, `npm test` (187 tests, the 9 new here), the full
`GAME_TEST_GL=d3d11 npm run test:browser` (103 passed, 1 pre-existing skip - unchanged from 004's
own baseline plus the 7 new `theme-flames.spec.ts` cases), `npm run build`, and `git diff --check`
from root all pass. `frame-budget.spec.ts`'s three ceilings are unchanged and, if anything, further
from their limit than 004 left them, since the new geometries are smaller and simpler than the old
octahedron plus its 0.55/0.8/0.55-scaled core copy: flooded-hall 428/439 calls and 196,500/198,818
triangles, junction 496/502 and 326,280/343,716, strike-contact 371/447 and 154,500/236,196.

Captured and opened `test-results/graphics-005-after` (SwiftShader, seed 0x1), alongside the
`-before` set taken on the unmodified octahedron flame for the same chambers. All three themes were
inspected at native size via cropped, upscaled PNGs read directly (not just saved): `keep` reads as
one narrow, clearly-taller-than-wide diamond leaning slightly off axis; `flooded` reads as a low,
distinctly wider-than-tall faceted cube/bud with an off-centre top facet, nothing about it shooting
upward; `ruins` reads as a tall primary tongue with a smaller, shorter, laterally offset second tongue
beside it, confirmed by a tight crop after the two deviations above were found and fixed - the
second tongue is legitimately smaller than the first (65% height, per spec) and reads as a subtler
feature of the silhouette than the primary one, a limitation carried forward openly rather than
inflating its share of the shape past what "unequal" calls for. Reviewed idle (four phases: 0/150/
300/600ms) and a mid-windup frame (an enemy parked beside the knight rather than on the brazier, so
neither obscures the other) for all three themes at desktop size (1000x700), and once more at phone
size (390x844) via the single isolated mobile context above. The existing `art-direction.spec.ts`
telegraph and fire measurements are unchanged and still pass at the same thresholds.

Cost of the one new isolated-context test (`theme-flames.spec.ts`'s phone block): 1.5-1.9s warm on
`GAME_TEST_GL=d3d11` in repeated local runs - one fresh boot, not three, following 004's own
CI-budget fix; no other new test here requests its own context. The heaviest new test is the
three-rebuild stability check (`buildFloor` x3), which cost 1.2s warm/~6-11s on SwiftShader,
comparable to 004's own four-rebuild motif test.

Limitation carried forward: the brazier's existing rim (`PROP.rim`, out of this plan's scope - "no
edits to bowls") sits close enough to each theme's body base that, from the game's fixed isometric
camera, it visually screens off most of a flame's lower silhouette regardless of theme; what a
player actually sees above the rim is closer to each shape's own tip than its full rest envelope.
This was true of the old octahedron too (confirmed by the `-before` capture) and is unrelated to the
new geometry.

## Plan 005 follow-up: the ruins tongue that was not there

A reviewer, reading this same `test-results/graphics-005-after` capture set rather than trusting the
paragraph above it, said the "subtle second tongue" claim did not hold up: every `ruins` frame they
opened showed one spike on a pale cap, not two. They asked for the claim to be checked by actual
measurement rather than by eye a second time, not just re-reviewed.

It was right, and the paragraph above it - "reads as subtle rather than bold" - was a misdiagnosis:
the second tongue was not subtle, it was not rendering at all, and re-looking at the same PNGs harder
was never going to find a tongue that was not in them.

**How this was actually checked this time**, in order:

1. A projection script replicated the game's exact camera (position, `lookAt`, orthographic frustum,
   from `dungeon-game.tsx`) in a throwaway Node script using the real `three` package, and projected
   both tongue apexes' world positions through it. At the geometry's numbers as committed, the two
   apexes separated by about 5px on a 1000-wide canvas, against tongues 5-8px wide apiece - already
   grounds to suspect the gap was too tight to read, before touching a single rendered pixel.
2. A brazier was rendered with its halo, core and rim mesh temporarily deleted (a few commented-out
   lines, reverted immediately after), isolating the raw body mesh with no lighting effects layered
   over it, and captured at native resolution with nearest-neighbour scaling (no LANCZOS blur, which
   a first pass's crops had used and which can smear two adjacent thin shapes into what looks like
   one soft-edged one). That capture showed **one** tongue. Not two overlapping ones, not one washed
   pale by the halo - one, full stop, with nothing where the second belonged.
3. That ruled out "halo/rim washing it out" as the explanation and pointed at the geometry or its
   winding. Re-reading `solid()` (the shared triangle-winding helper) found the bug: it decides which
   way to wind a face by testing the face's normal against the vector from the **global origin** to
   that face's centroid. That is a correct test only when the shape being built is actually centred
   on the origin - true for `keep` and `flooded`, both single peaks built that way on purpose, and
   false for either of `ruins`'s two tongues considered on its own, since each sits well off to one
   side of the origin by design. For the shorter tongue, the faces on its side facing back toward the
   taller one - precisely the faces the camera needed to see - have a true outward direction that
   disagrees with "away from the origin", so the shared winding test flipped them backward and
   three.js back-face-culled them into nothing. Not small, not faint: absent.
4. Fixed by winding each tongue outward from its own vertex centroid instead of the shared origin
   (`windOutward` takes an explicit centre now; `mergeSolids` concatenates the two independently-wound
   triangle buffers into the one `BufferGeometry` the plan asks for). Re-ran the same isolated,
   halo/core/rim-free capture: both tongues rendered, a tall one and a visibly separate, shorter one.
5. With the bug fixed, the *other* two problems a first pass had already reasoned through (and had
   partly compensated for, blind to the winding bug underneath) turned out to matter for real: the
   apex separation the projection script measured (~5px) was retested and confirmed too tight even
   with both tongues actually rendering, and the halo (sized to match a single peak, several times
   wider than the whole twin-tongue body) filled the gap between two now-real tongues with its own
   glow. Both were already recorded above as deliberate choices; both got a second, larger pass:
   apex separation widened from 0.32 to 0.51 (radius correspondingly thinned, from 0.105/0.075 to
   0.065/0.048, so the total width stays within a pixel or two of the same 0.50 the table gives), and
   `ruins`'s halo shrunk from 2.6x2.7 to 1.5x1.7 - well past a cosmetic trim, specifically so the
   body's own silhouette carries the read instead of the glow smoothing over it.
6. Re-captured with everything restored (halo, core, rim, at their final sizes) and reviewed at
   native resolution with nearest-neighbour crops rather than LANCZOS ones: `ruins` now shows a tall
   tongue and a distinctly shorter, separate one beside it, in both the idle and the mid-windup frame.

Gates re-run after the fix: `npm run typecheck`, `npm run lint`, `npm test` (187), the full
`GAME_TEST_GL=d3d11 npm run test:browser` (103 passed, 1 pre-existing skip, unchanged), `npm run
build`, and `git diff --check` from root all pass again. `frame-budget.spec.ts`'s three ceilings are
unaffected (the triangle count per tongue did not change, only vertex positions).

The corrected, checked claim: `keep` reads as one narrow, taller-than-wide diamond; `flooded` reads
as a low, wider-than-tall faceted bud; `ruins` reads as two distinct tongues, a tall one and a
visibly shorter, separate one beside it, confirmed by (a) a camera-accurate projection of both
apexes showing they separate on screen, (b) an isolated capture of the raw body mesh with no halo,
core or rim to interfere, showing both tongues actually drawing, and (c) a final capture with the
full rig restored, at native resolution, with both tongues still legible. Everything in the previous
entry that was not about the second tongue's visibility - the theme resolution, the pose rhythms, the
budget numbers, the test suite - was unaffected by this and remains as recorded.

Lesson for next time, stated plainly so it does not have to be relearned: a capture reviewed by eye,
especially through an upscaled/interpolated crop, can fail to distinguish "a real but subtle feature"
from "a feature that silently is not being drawn at all". Where a claim is "two of something are
visible", the check that actually settles it is isolating that something from everything drawn
alongside it and confirming it renders on its own - not a harder look at a crop of the combined
scene.

## Plan 006: merged two-cell slabs and settled strips instead of a perfect grid

Implemented on top of 004/005, same working tree. Baseline established first: `npm run typecheck`,
`npm run lint`, `npm test` (187 tests) and, on `GAME_TEST_GL=d3d11`, `art-direction.spec.ts` and
`frame-budget.spec.ts` all passed before any source edit.

Three new pure modules, none of them importing three.js or React:

- `dungeon-paving-layout.ts`: `planPavingPatches(floor)` plans, per room, a bounded set of merged
  two-cell pairs and settled, staggered strips. Eligibility for either treatment requires every cell
  within two cardinal steps to belong to the same room's own stone footprint (interior only, clear of
  any hole, wood tile, corridor or a neighbouring room's ownership) and outside every rectangle
  `dungeon-decor-layout.ts`'s `decorReservations` returns, expanded by a 0.3-unit margin - which is
  also why a gauntlet, whose whole footprint is one such reservation, never receives a patch. Pairing
  targets a seeded 20-30% coverage of a room's eligible cells once it has at least 24 of them, capped
  so a pair never claims more than 35% of the room's total stone cells; candidate pairs are scored per
  theme (`keep` favours its own long axis and stays near the centreline, `ruins` scatters two or three
  offset clusters with alternating orientation, `flooded` pulls toward the room's edges) and accepted
  best-first without reusing a cell. Settled singles then claim a theme-sized fraction (5/12/8%) of
  whatever eligible cells the pairs left, in staggered three-or-four-cell strips seeded toward the
  room's edges. Everything here is deterministic off `floor.seed` and `room.id` alone (own hash, salted
  per cell/cluster/strip - never touches the generator's own PRNG) and mutates nothing it is handed.
- `dungeon-paving-patches.ts`: `pavingPatchGeometry()` builds the merged slab by hand - one top quad,
  four rim quads, four skirt quads, eighteen triangles total, the same nine-quad shape
  `pavingGeometry('plain')` already uses for one tile, just built on independent half-width/half-depth
  (2.91 x 1.43, `2*TILE-0.05` by `TILE-0.05`) rather than one shared half, since a rectangle's four
  sides are not a single trapezoid turned four times the way a square's are. Every quad's winding is
  picked by `orientQuad`, which computes the flat normal and flips the vertex order if it disagrees
  with an explicit expected outward direction, rather than trusting a hand-picked corner order to be
  right - directly applying the lesson two entries above this one, at construction time instead of
  after a capture catches it missing. The whole rectangle is mapped over one 0..1 UV space rather than
  the single-tile mapping repeated twice, so the existing edge-shaded stone texture's own border falls
  only on the true outer boundary.
- `dungeon-surface.ts`: a presentation-only support-height index for plan 008 to reuse.
  `buildSurfaceIndex` bins every upward-facing triangle (by the sign of its own flat normal, source
  winding respected rather than assumed) into the grid cell its bounding box touches; `sampleSurface`
  returns the highest face whose barycentric coordinates actually contain the query point, or `null`
  for a real gap. Never consulted for collision - `floor.cells`/`canStand` are untouched.

`dungeon-game.tsx` wires the three in: `planPavingPatches` runs once per `buildFloor`, right after
`generateFloor`. Paired cells are filtered out of the plain/groove/dish top batches entirely (their
top is the new merged-slab `InstancedMesh` instead, one per spatial batch a pair actually falls in,
tinted with the two source cells' own `slabTint` blended); every stone cell keeps its own foundation
regardless. Settled singles are forced into the plain batch (bypassing the per-tile groove/dish/old-
settled roll, so the two mechanisms never stack) and get a new, shallower transform
(`macroSettle`: 0.025-0.045 additional sink, up to 0.03 radian of tilt on each axis) instead of the
existing damage variant's own settle. After `addAtmosphere` (which is where floor motifs attach),
every mesh tagged `userData.walkingSurface = true` - plain/groove/dish/pair tops, wood planks, floor
motifs - is walked once, its geometry's position attribute transformed by its own (or its instance's)
world matrix into numeric triangles, and handed to `buildSurfaceIndex` alongside a per-cell
theme/wood map built from `floor.tiles`. The result is kept in a closure variable and a compact
`graphics.paving = { pairs, settled, surfaceCells }` summary is added to `render_game_to_text`,
counting only the realized batches - no geometry buffers in the diagnostic.

New tests: `dungeon-paving-layout.test.ts` (28 cases spanning seeds 1-100 x levels 1-3: determinism,
no mutation, pair adjacency/same-room/same-batch, no cell claimed twice, nothing inside a reservation
with margin, a gauntlet never gets a patch, the 35% coverage bound holds per room, negative-coordinate
floors work, every theme realizes a pair and a settled single across the sample),
`dungeon-paving-patches.test.ts` (the geometry is exactly 18 triangles at the stated bounds, no vertex
sits on the old centre joint, every facet's winding and stored normal agree and point outward/upward,
a bounding box/sphere exist, the UV mapping spans the whole rectangle rather than repeating the
single-tile one), and `dungeon-surface.test.ts` (flat/tilted/rotated/merged/motif-like surfaces sample
correctly, a downward face is never a support, overlapping faces resolve to the higher one, negative
cells and genuine gaps work, barycentric interpolation checked against hand-computed weights rather
than just "some plausible number").

New browser spec `macro-paving.spec.ts` (seed 0x5d/93, which realizes a pair and a settled single in
all three themes on one floor, plus 0x22/34 for a `hall`-shaped room and 0x2 for a wide junction):
the live `graphics.paving` counters match an independent call to `planPavingPatches` on the same
floor; a pinned-seed reset and four repeated rebuilds are stable; walking from one cell of a pair onto
its other cell, and off a settled single, both displace the knight normally (no invisible seam); a
strike against a target standing on a merged slab connects exactly like anywhere else; all three
themes, a narrow hall, a junction and a bridge-approach-beside-a-pair are captured for review, plus
one isolated mobile context walking between all three themes (not three separate mobile boots, per
the CI-budget lesson from 004/005). 13 tests, all under 2s each on `GAME_TEST_GL=d3d11` (measured
total: this spec's 13 tests summed to about 12.5s combined against the full suite's ~3 minutes) - no
new per-test page boot beyond the one existing mobile describe block already pays for.

**Visual verification, done the way the two entries above this one say to do it - by isolating and
zooming into the actual capture PNGs, not by glancing at a full-frame screenshot:**

A camera-accurate projection script (same technique as the ruins-tongue fix above: replicate the
game's fixed orthographic camera - position `focus + (9.2, 12.5, 11.5)`, `lookAt(focus)`, span 7.2,
aspect from the 1000x700 canvas - in a throwaway script, project a known world point, and use that to
crop precisely rather than guess) located each fixture's pair and settled single in the SwiftShader
captures (`test-results/graphics-006-after`, reviewed and then discarded - nothing here is committed,
matching the plan's own `test-results/` ignore rule). Nearest-neighbour 2-4x crops (no LANCZOS, for
the same reason the ruins-tongue investigation avoided it) confirmed, in every theme:

- **keep** (room 1, "Hollow Court"): one clearly elongated slab, roughly twice the length of its
  neighbours along the same diagonal, with no interior seam and no repeated texture border down its
  middle.
- **ruins** (room 12): two separate elongated slabs visible in one crop, both continuous, both
  correctly bevelled at their true outer edges only.
- **flooded** (room 8, "The Sunken Stair"): one elongated slab, same signature, in the goal/warden
  room - confirming a pair can legally sit in a goal room once clear of its 2.2-unit stair reservation.
- **a junction** (seed 0x2, room 1, a `court`-shaped room with three branches): once precisely located
  via the same projection technique, the merged slab reads identically to the other three.
- **a bridge approach** (seed 0x5d, room 1): the knight standing exactly on the wood-plank transition
  shows clean ordinary planks and clean ordinary paving on both sides - no patch geometry anywhere
  near the wood, matching the eligibility rule's own two-step clearance.

A settled single (room 1's own, cell (10,-10)) was checked two ways rather than one: visually, at 4-5x
zoom with brightness/contrast boosted (the keep theme is dark by design), the tile's own bevel reads
as very slightly uneven rather than dramatically sunk - expected, since the spec caps the effect at
0.045 units of sink and 0.03 radians of tilt, which this camera's own vertical scale (~0.76 screen-units
per world-unit, ~49px per screen-unit at this canvas size) renders as roughly a 1-2px difference; and
numerically, by recomputing the exact same seeded hash formula `macroSettle` uses for eight different
settled cells across all three themes, confirming every one produces a non-zero, in-range drop
(0.025-0.045) and tilt (±0.03 rad on each axis) - ruling out the specific failure mode "the formula
always returns near-zero and the effect is invisible because it isn't really there," which a purely
visual pass on a deliberately subtle effect cannot rule out on its own. An attempt to get fully live
ground truth (patching `THREE.WebGLRenderer.prototype.render` on a manually-driven dev-server session
to read the actual instance matrix back) was abandoned part-way through: the dynamically re-imported
`three` module was a distinct module instance from the one the running app actually used, so the
patched prototype was never the one in the app's own prototype chain, and chasing the exact
Vite-optimized-deps identity down was a worse use of time than the two checks above, which already
rule out the two failure modes that matter (wrong/degenerate math; visibly broken geometry).

Gates: `npm run typecheck`, `npm run lint`, `npm test` (215, up from 187), the full
`GAME_TEST_GL=d3d11 npm run test:browser` (116 passed, 1 pre-existing skip - `zz-pixel-diff.spec.ts`,
unchanged), `npm run build`, and `git diff --check` from root all pass. `frame-budget.spec.ts`'s three
ceilings are unaffected and, incidentally, came in under their previous measurements in two of three
scenes (junction 498/502 calls, 326,192/343,716 triangles; flooded-hall 428/439, 196,500/198,818) -
merging two ordinary 18-triangle tops into one 18-triangle pair is a net saving wherever a pair lands,
not a new cost.

No deviation from the plan's scope list. `dungeon-decor-layout.ts` was not touched - its existing
`decorReservations` contract already covered every case this plan needed (gauntlet, goal, sanctuary
centre, weapon drop), so the "only if a missing reservation is found" clause never triggered.

Plan 007, local actor cutaway. `dungeon-occlusion.ts` is a new controller: fixed uniform storage for
three centres/radii/strengths plus the camera's own world matrix (needed to recover world-y from a
view-space varying); a material-variant cache that clones each eligible source material exactly once,
captures its existing `onBeforeCompile`/`customProgramCacheKey` before installing a wrapper that calls
the captured hook first and appends the cutaway's own vertex/fragment injection after - so
`weatherStone`'s hook, and its `stoneWorld` varying, are never touched or duplicated. The vertex hook
stores `mvPosition.xyz` (already carrying instance transforms, confirmed against the installed three.js
source per the plan's own anchor-verification instruction) and a camera-relative world-y in two
uniquely-named varyings after `#include <project_vertex>`; the fragment hook discards after
`#include <clipping_planes_fragment>` when a fragment sits inside a target's ellipse (smooth from
normalized radius 0.65 to 1.0), in front of it by 0.10-6.0 world units, above y 0.18, combined across
up to three targets by max rather than sum, and gated by a 4x4 Bayer dither capped at 90% removal. A
`uCutawayEnabled` uniform is a same-frame development-only A/B toggle that never touches a target's own
state. Slot bookkeeping (player always on at strength 1 while playing; up to two enemy slots, filled by
nearest-first with an id tie-break, faded 0.10s in / 0.16s out, instantly dropped - not faded - the
instant an id is missing from the caller's own eligible-candidate list, which is what makes death,
dormancy, room change and out-of-range all resolve to the same "gone" path) lives in the controller,
independent of any three.js/DOM dependency, so `tests/dungeon-occlusion.test.ts` (20 cases) exercises
the view/depth math, ellipse limits, the max-not-sum overlap bound, three-slot capacity, stable target
identity under equal distance, fade timing, instant-clear, and the hook-chaining/no-double-wrap
behaviour entirely off plain numbers and stub materials, no WebGL required.

`dungeon-art.ts` tags the `stone`/`pale` instanced masonry batches and the archivolt ring
(`userData.cameraOccluder = true`) inside `addCarvedArchitecture`; the grille's bronze bars, the blind
lancet, foliage and floor motifs are left untagged (bars and floor tops are explicitly excluded).
`dungeon-atmosphere.ts` tags a standing pillar's shaft and cap (not its low plinth) and the per-region
wall-masonry `InstancedMesh` batches. `dungeon-game.tsx` creates one controller for the life of the
mount; registers every tagged mesh in the SAME traversal that already collects `walkingSurface`
triangles for the surface index, right after `addAtmosphere` runs, so a floor build never gains a
second full traversal; calls `cutaway.releaseFloor()` first in `clearFloor`, before the atmosphere and
floor-group dispose, so a disposed variant is never left assigned; calls `cutaway.syncMaterials()`
right after `atmosphere.update()` each frame (copying colour/emissive/roughness/metalness/opacity from
each source material onto its variant, never `Material.copy`, never a new material); and resolves this
frame's player/enemy candidates and calls `cutaway.update(camera, ...)` right after `camera.lookAt`,
using simulation `dt` (not `frameDt`) so hit-stop and the pause guard freeze it exactly like everything
else the same `update()` function drives. Enemy eligibility mirrors the existing threat-cue visibility
rule verbatim (`windup>0||(lunge>0&&attackAge<.09)`) rather than inventing a second definition of
"attacking". `teleport` clears the controller's slots explicitly; `restart`/`buildFloor`/pooled reset
all go through `clearFloor`, which already does. Two development-only hooks
(`dungeonTest.cutawayDiagnostics`, `dungeonTest.setCutawayEnabled`), guarded by the same
`NODE_ENV !== 'production'` branch as `configureCombatFixture`, are confirmed absent from
`npm run build`'s own `dist/client` output by grep.

Step 1's prototype gate was not skipped: the unit suite above was written and passed first, against
plain TypeScript objects and a fake `{vertexShader, fragmentShader, uniforms}` shader record - proof of
the math and the hook-composition contract, not of GLSL. Only after that did integration proceed to a
real `GAME_TEST_GL=d3d11` Chromium session, where the shader actually compiled (three's own
`onBeforeCompile` chain resolved with no duplicate-anchor or double-wrap errors) and rendered.

Two real bugs surfaced only by that live pixel evidence, both fixed rather than worked around:

1. `cutawayDiagnostics().slots[i].strength` is, by design, always 1 for the player slot while playing
   (the plan's own "remains at full strength" rule) and ramps toward 1 for an attacking enemy
   regardless of whether any eligible geometry is anywhere nearby - it is a fade value, not an
   occlusion signal. An early test draft used it to decide whether a candidate teleport spot was
   "occluded", which is meaningless for the player slot and unreliable for enemies. Every "is this
   spot occluded/clear" question in the final test asks the rendered pixels instead (`cutawayFrames`,
   toggling `uCutawayEnabled` for a same-instant A/B), and the diagnostic is used only for what it does
   answer honestly: which owner/id holds a slot, and how many slots are allocated.
2. A room's own centre is not floor-wide safe ground: `headroom`'s clamp only holds a room's own near
   architecture clear of a centre-standing actor *in that room* - it says nothing about a neighbouring
   room's own tall backdrop mass. The first "clear control" pick (the first walkable room centre) was
   sometimes itself faintly occluded. Fixed by searching room centres live for one that actually draws
   pixel-identical with the cutaway enabled and disabled, the same standard used for the occluded spot.
3. Driving a pause as two separate `page.evaluate` round trips (dispatch the action, then read pixels)
   occasionally read a transient frame from the browser's own paint/compositor scheduling in the real
   time gap between them - reproducing between 0 and several thousand differing pixels across otherwise
   identical runs, which is the signature of a harness race rather than a simulation bug (a real fade
   ticking during pause would be a small, *consistent* per-frame drift, not a number that varies wildly
   run to run including exact zero). Fixed with `Game.pauseFreezeCheck`, which drives the pause
   dispatch, the simulated time step and both pixel reads inside one synchronous evaluated task, exactly
   as `cutawayFrames`/`tellAgainstStone` already do for their own before/after pairs. Stable across
   repeated runs afterward.

Visual review, not just a passing counter: `occlusion-player-occluded-on.png`,
`occlusion-player-control.png` and `occlusion-mobile-player-occluded.png` were captured
(`GAME_TEST_GL=d3d11 GAME_TEST_CAPTURE=1`, a new feature with no historical SwiftShader baseline to
stay comparable with) and opened, then a 260x260 region around the actor was cropped and upscaled for a
close look. The occluded frame shows a real, small, dithered opening in the pillar's own coping/cap
stone directly in front of the knight's head and shoulder - the pillar's silhouette, the coping's edge
and the surrounding paving are all still there and still stone, not a clean hole and not the whole cap
gone; the knight's cape, pauldron and blade are legible through the dithered gap. The control frame
(a different room, `roomCentre`) shows the knight fully clear with no dithering artefact anywhere. The
mobile capture shows the same dithered opening at the phone viewport/aspect. Floor, shadows and the
rest of the frame are visually unaffected in every capture.

CI-budget shape, per the explicit lesson from 004-006: the five cutaway questions that all need an
already-found occluded spot and an already-found clear spot (real hole exists, control is clean, a
zero-time redraw matches, a pause matches, moving away/back opens and closes it, a floor rebuild drops
stale ids) are one consolidated test rather than five, because the live search for each spot is the
expensive part (real draws per candidate) and splitting them would repeat that search once per
question for no additional coverage - exactly the mistake the operator's notes warn against. That one
test needs `test.setTimeout(240_000)`, stated with a comment: a live multi-candidate search over real
frames is not comfortably inside the default 120s. The remaining three occlusion scenarios (a windup
enemy behind a wall, the three-slot/idle-exclusion bookkeeping, one mobile-viewport case using its own
isolated context as `needsOwnPage` requires) are each their own test. Measured cost on this machine
(materially slowed by unrelated background load - `wmic cpu get loadpercentage` read 39% and free
memory was under 15% of 32GB with roughly twenty unrelated Node processes already running - so treat
these as upper bounds, not clean numbers): the full `occlusion.spec.ts` file, four tests plus one
mobile-context test, 3-5 minutes; the enemy-windup scenario reports an honest `test.skip` with a stated
reason when this seed's floor does not happen to place a living enemy in the same room as a usable
occluder within range, rather than failing or faking a result.

Gates: `npm run typecheck`, `npm run lint`, `npm test` (235, up from 215 - the 20 new cases are
`tests/dungeon-occlusion.test.ts`), `GAME_TEST_GL=d3d11 npm run test:browser` for the full suite (119
passed, 2 skipped - the pre-existing `zz-pixel-diff.spec.ts` skip, unchanged, and the seed-dependent
enemy-windup skip above), `npm run build`, and `git diff --check` from root all pass.
`frame-budget.spec.ts`'s three ceilings are unaffected and unchanged in shape (flooded-hall 428/439
calls, 196,500/198,818 triangles; junction 497/502, 326,188/343,716; strike-contact 371/447,
154,500/236,196): the controller adds zero draw calls and zero triangles by construction (materials
change, geometry does not), and material property tests in `polish.spec.ts`/`art-direction.spec.ts`
confirm distant architecture culling, the palette/tell measurements and phone-viewport materials all
still read correctly with every eligible material now wrapped in a cutaway variant.

No deviation from the plan's scope list; every touched file is one the plan named. Not committed to a
PR - local commit only, per the task's own instruction.

## Plan 008: surface feedback at real foot contacts

Built on plan 007 (`origin/feat/local-actor-cutaway`, PR #39), which sits on 006/005/004. Reuses 006's
`dungeon-surface.ts` (`buildSurfaceIndex`/`sampleSurface`) unchanged for every contact height; no second
lookup. `dungeon-surface.ts` and its test are untouched.

What landed:

- `app/dungeon-footstep-rules.ts` (pure): `footfalls(previous, current, {dashing, dt, travelled})` is the
  existing `floor((phase + PI/2)/PI)` crossing, capped at 2 per update, empty for dash / zero dt / zero
  travel; `landingLeg` maps odd counts to `legs[0]` (the leg `playerRunPose` has at full forward
  extension); `footSupport` returns `{kind, cell, y}` from `sampleSurface`, or null on wood, a seam/hole,
  a cell that is not a floor tile, or no index.
- `app/dungeon-footsteps.ts`: one pre-allocated batch, 32 camera-facing quads, one BufferGeometry + one
  MeshBasicMaterial (vec4 vertex colour for alpha, procedural soft mask via `onBeforeCompile`, depth test
  on, depth write off, no shadows), live quads compacted into `drawRange`, mesh invisible when empty,
  bounding sphere recomputed from live particles each update. Deterministic hash scatter off a private
  serial. Ages on simulation `dt`.
- `dungeon-game.tsx`: `hip.userData.boot` retained at construction; after the legs, body height, pitch
  and cape are posed, a crossing updates the player's world matrix once and resolves the sole point
  (`boot.localToWorld(0,-.08,0)`), samples the support and emits. Audio line untouched. Cleared on
  teleport, floor replacement (`clearFloor`) and `endRun`; `reset()` (serial, counters) on restart;
  disposed on unmount after detaching itself so the generic traversal cannot double-dispose.
  `effects.footsteps` in the snapshot (active, drawn, emitted, contacts, skipped, kinds, last contact
  cell/y); dev-only `footstepParticles()` and `setFootstepsEnabled()` (same-frame A/B), stripped from the
  production build (checked: neither string appears in `dist/client`).

Bugs the pixel checks caught, not the counters:

1. Dust born at the sole centre was inside the boot mesh and depth-hidden: 1 live particle changed 0
   pixels (peak ΔRGB 3). Particles are now born on the sole's rim; the first on the rim point facing the
   lens.
2. Drops never rendered at all: the streak basis `(across, along)` had the opposite handedness to
   `(right, up)`, so every drop quad wound away from the camera and FrontSide culling dropped it - 3 live
   drops, 0 changed pixels. Fixed; `dungeon-footsteps.test.ts` now asserts front-facing winding for every
   triangle of every kind, and fails on the old basis (verified by reverting the one line).

Tests: `tests/dungeon-footstep-rules.test.ts` (8), `tests/dungeon-footsteps.test.ts` (10; the size/life/
height/alpha bounds are held to the plan's table restated independently of the implementation's own
constants), `tests/browser/footsteps.spec.ts` (9, one of them the single isolated phone context).
SwiftShader wall time per browser test, no capture: four directions 14.6s (includes the pooled boot),
rest/wall/dash/redraw/pause/teleport 18.4s, hit-stop 1.2s, surface kinds + wood 1.5s, 16 ms vs
subdivided + repeat resources 11.9s, keep/ruins/flooded pixel proof 11.6/7.1/7.5s, phone 23.1s - whole
file 1.8 min. With `GAME_TEST_CAPTURE=1` the longest is the phone test at 32.6s.

Render cost: exactly one extra draw while particles are alive (asserted: A/B `render.calls` delta = 1),
zero when empty. `frame-budget.spec.ts` untouched and unaffected, all three scenes stationary:
flooded-hall 428/439 calls, 196,500/198,818 triangles; junction 496-498/502 (its documented drift band;
the pre-edit baseline run measured 496 and 007 recorded 497); strike-contact 371/447, 154,500/236,196.

Captures: `game/test-results/graphics-008-before/` (sprint + polish, SwiftShader, pre-edit) and
`game/test-results/graphics-008-after/` (footsteps.spec, SwiftShader): per theme contact, +60, +120,
+240 ms full frames, a live combat (hit-stop) frame, phone keep/flooded ordinary and reduced, and for
each contact a 4x close-up sheet (batch off | on | difference x6), all drawn in one task.

Visual verdict, from opening the PNGs: placement is right. In every close-up the difference sits
exactly at the base of the planted boot, on the stone, below the ankle, never on the torso, never a ring
or a flash, never on wood. Measured on screen at +60 ms: keep 16 px changed (peak summed ΔRGB 55), ruins
45 px (95), flooded 12 px (56); phone keep 26 px, flooded 14 px; reduced motion 3-7 px. That is also the
limitation: at the plan's own size and alpha ceilings (this implementation sits at the top of them), a
fleck is 2-6 px at 1000x700, and I could not pick it out at native size in the full frames without the
difference panel. It is restrained to the edge of imperceptible. Making it read would need sizes or
alpha outside the plan's ranges - an operator decision, not taken here.

Gates: `npm run typecheck`, `npm run lint`, `npm test` (253 pass), `GAME_TEST_GL=d3d11 npm run
test:browser` (128 passed, 2 skipped - the same two pre-existing skips as plan 007: `zz-pixel-diff` and
occlusion's seed-dependent windup case), `npm run build`, `git diff --check` all pass.

Deviations: particles start at the rim of the sole, not its exact x/z centre (see bug 1; still within
0.35 of the contact, which the node test enforces). The phone test walks with the keyboard (a touch
context still delivers it) for the same deterministic stride as desktop; reduced motion is switched on
through the real pause-menu settings card.

## Docs-only changes skip the gates; a balance band joins the fast ones

Two CI changes in `.github/workflows/deploy-pages.yml`, neither yet run on GitHub.

A new first job, `changes`, diffs the pull request (`base...head`) or the push (`before..sha`) with plain
git and says whether anything but prose moved. Prose is `*.md` anywhere, `docs/**` and `plans/**`;
`.github/**` and `game/public/**` always count as code (one steers the pipeline, the other ships to
Pages). Checked first that nothing in `game/` imports or bundles those files: no `.md` import, `?raw` or
`import.meta.glob` in `app/`, `scripts/` or the configs, and the only `docs/` mentions are comments in
`tests/browser/art-direction.spec.ts` and `tests/README.md`. Every doubt means code: `workflow_dispatch`,
an all-zero or unfetchable `before`, a git error, an empty diff. `--no-renames` so that moving a source
file into `docs/` still lists the deletion. `checks`, `browser` and `build` run only when code changed;
`deploy` additionally requires it, so a docs-only push to main leaves the site on the last code push's
deployment. `verified` is new and is the single check branch protection should require: a skipped matrix
job reports as `browser`, not `browser (1)`, so requiring shards by name would hold docs-only PRs forever.
It fails unless `changes` succeeded and every gate succeeded, or skipped on a docs-only change. `alarm`
now also listens to `changes` and `verified`.

The diff step was exercised locally against this repository's history and a scratch repository: docs-only
push and PR (plans/README.md) read as prose; a code commit, an all-zero `before`, a missing `before`, a
short SHA, an empty diff, `workflow_dispatch`, `.github/NOTES.md`, `game/public/help.md` and a rename of
`game/app/x.ts` to `docs/x.md` all read as code. A non-ASCII path reads as code too (git quotes it), which
is the safe way to be wrong.

`npm run balance:check` (`scripts/balance/check.ts`) now runs in `checks` after `npm test`. It walks 30
seeds from seed 1 at the default policy and at `dodge 0, reaction 0.6`, and holds escape rate, per-floor
death rate, per-floor median HP left and median run length to the loose bands in
`scripts/balance/bands.json`, which also records what was measured. The pure part (`summarise`,
`compareBands`) is in `scripts/balance/bands.ts` and covered by `tests/balance-bands.test.ts` without
running the sim; a floor nobody reached is a missing metric and fails rather than passing by default.
Measured: default 100% escape, 0% deaths, 100% median HP on all three floors, 266.1s median run; weak
93.3% escape, deaths 0/3.3/3.4%, median HP 92/88/73.6%, 241.4s. About 60s locally for both policies.
These are bot numbers; a deliberate balance change is expected to update `bands.json` in its own PR.

Verification: `npm run typecheck`, `npm run lint`, `npm test` (258 pass), `npm run balance:check`
(pass, 59.8s), the same with the weak policy's floor-3 HP band tightened to max 70 (exit 1, names
`weak: floor3.medianHpLeft measured 73.6, above band [55, 70]`, band reverted), actionlint 1.7.12
clean on both workflows, `git diff --check` clean. Browser suite and build not run (shared machine, and
nothing they cover changed).



## Shot comparison: one command for an art change's before/after sheet

`npm run shots:compare` (`scripts/shots/compare.ts`) replaces the hand-made capture/before-after round every
visual change used to need. It captures `tests/browser/shots.spec.ts` on the previous version and on the
working tree, one after the other, and writes `outputs/shots-compare/<timestamp>/index.html`: a row per scene
of previous | current | difference x6 (change box outlined), changed pixels, worst and mean step, bounding
box, and draw calls and triangles from the `COST` lines, with the concept sheet's main scene pinned beside the
index and the two strips folded under their own headings. It judges nothing. Usage is in `tests/README.md`.

- Previous defaults to `git merge-base main HEAD` (HEAD for uncommitted work on main's tip, HEAD~1 for a clean
  one); `--base <ref>` picks any commit, `--before <dir>` / `--after <dir>` take directories instead. The base is
  a detached `git worktree` in the temp directory with `game/node_modules` junctioned to this checkout's, on
  port+1, so vite.config's per-port prebundle cache keeps the two apart. Cleanup unlinks the junction before
  `git worktree remove --force`, and runs on failure (checked with a capture that found no tests: worktree
  gone, `node_modules` intact, both ports free). ^C is handled but was not exercised.
- Both sides always use the same renderer. A directory's renderer comes from its `meta.json` (and
  `output/shots/baseline` is known to be SwiftShader); a mismatch is refused without `--allow-mixed-gl`, and a
  base whose playwright config predates `GAME_TEST_GL` or `GAME_TEST_PORT` is refused outright.
- The diff moved out of `zz-pixel-diff.spec.ts` into `scripts/shots/diff.ts`, one self-contained function both
  callers ship into Chromium as source text. The spec reports the same numbers it did (checked on the run
  below: identical to the sheet's). `tests/shots-compare.test.ts` (11) covers arguments, the base decision, COST
  parsing, pairing, the diff and difference image, the source-text rebuild in a fresh VM context, and escaping.
- Output goes under the root `outputs/` ignore rule, not `test-results/`, because the next browser run empties
  that. Each run is ~82MB (every PNG twice plus diffs).

`--base HEAD` on d3d11 (`e2f49b5`, 1m36s end to end, 44s and 43s a side): flooded hall and warden chamber
identical; strike contact 8 px (worst 36), shrine 9 px (worst 1); bridge 2,495 px (0.36%, worst 6) and junction
2,895 px (0.41%, worst 1), faint, along the top walls; dark corridor 21,041 px (3.01%, worst 17), top walls and
the HUD bars; gauntlet 38,310 px (5.47%, worst 203), its embers. Strips: dash 7/24 frames moved, at most 470 px
(frame 00, the HUD corner); strike 28/32 moved, at most 85 px (its sparks). So on d3d11 the strike strip is
nearly stable and the gauntlet is the scene that is not - the reverse of what the SwiftShader STABILITY run
suggested. The faint top-wall band and the HUD differences look like something keyed to wall-clock time rather
than to `advanceTime`; not chased here.

`--before ../output/shots/baseline --gl swiftshader`: 135s for the one capture; every scene 99.7-99.99% changed,
which is the baseline being stale (it predates plans 004-008 and the smaller rooms), not misalignment - the
frames line up and the rooms are simply different. `strike-seq-30/31` exist only on the current side.

Gates: `npm run typecheck`, `npm run lint`, `npm test` (269 pass), `git diff --check`. The browser suite was not
run in full; `shots.spec.ts` passed 10/10 in every capture above and `zz-pixel-diff.spec.ts` passed with
DIFF_A/DIFF_B set.

## 2026-09-22 - Triangle ceilings tripled for the model round

Owner decision. `tests/browser/frame-budget.spec.ts` triangle ceilings x3: flooded hall 198,818 -> 596,454,
junction 343,716 -> 1,031,148, strike contact 236,196 -> 708,588. Draw-call ceilings unchanged (439 / 502 /
447). What it buys: room for plans 009-011 (weapons, knight, enemies) to add shape; the flooded hall sat exactly on
its old figure. Draw calls stay the binding constraint on part count. Not re-measured here; no scene's actual
cost changed with this edit.

## 2026-09-23 - Plan 009: the armoury baked, three arms reshaped, the model round's shared tools

Worktree branch from `62cfe64` (`feat/shot-compare`); committed locally, not pushed.

What changed:
- NEW `app/dungeon-bake.ts`: `bakeStatic(root, { keep?, cacheKey? }) -> { meshes, merged }`. Folds every
  visible plain Mesh with one opaque `MeshStandardMaterial` under `root` into one mesh per (material,
  castShadow, receiveShadow, renderOrder), in root-local space, appended to `root` as `baked:<i>`. Kept
  subtrees are untouched; hidden mergeable meshes are removed; a removed part whose children stay becomes a
  bare `Object3D` in its place (name, transform, userData carried; references to the old mesh are not
  rewritten). Invisible root untouched; a Mesh root keeps its own geometry. With `cacheKey` the merged
  geometry is built once per key, flagged `userData.shared`, and every call binds its own materials; a call
  whose batch structure differs from the cached one throws before touching anything. Mirrored parts get their
  winding flipped. Shared sources, and sources still drawn by a remaining mesh, are never disposed.
  `tests/dungeon-bake.test.ts` (9) holds all of that.
- `app/dungeon-armory.ts`: `makeWeapon` builds the arm and bakes it (no cache; `disposeWeapon` still releases
  it). `makeWeaponDrop` bakes the whole rack once after posing and shadow flags, so plinth and collar fold into
  the arm's iron and brass; `{ group, ring, blade }` unchanged (`blade.group` is the arm's now-empty group;
  nothing reads its children). `makeBolt` bakes with `cacheKey: 'armory:bolt'` before it is hidden.
- Silhouettes: fangs blade half-width .05/.055 -> .065/.07 plus a brass knuckle bar .20x.035x.05 at (0,.036,.06);
  spear head .07/.085 -> .09/.11, two brass lugs .18x.03x.05 at (+-.12, .036, -1.22) (the plan gave no x; .12
  puts each lug's inner end inside the socket), bindings iron -> brass; crossbow prod iron -> steel.
  Every `inner`/`tip` unchanged and pinned in `tests/dungeon-armory.test.ts`.
- `dungeonTest.actorStats()` (dev-only block, typed in `helpers.ts` as `ActorStats`, plus a `Game.actorStats()`
  wrapper): `{ knight: {meshes, triangles, height}, enemies: [{kind, meshes, triangles, height}] (living,
  snapshot order), drop: {kind, meshes, triangles} | null }`. Visible meshes walking down through visible nodes
  (the root's own flag ignored), contact pool counted, pool excluded from height.
- `tests/browser/shots.spec.ts`: a `models` describe block. Gate scenes on seed 0x86 floor 2 (seeds
  `[0x86, 0x86]`, `buildFloor(2)`): its Tide Gate holds no rack, shrine or body and its nearest spawn is 18
  tiles off. `models-armoury-<id>` / `models-armoury-profile-<id>` (one test, 14 frames),
  `models-knight-strip-00..07` (clockwise from facing the lens, 45 degrees apart), `models-cast` (knight at the
  left of a row facing the lens, then guard, stalker, warden borrowed via `configureCombat` with cooldown 999 and
  no `windup` field - any windup marks a body as having noticed and it walks at once - captured 100 ms in, inside
  the 320 ms notice beat). `models-drop-<kind>` on level-1 seeds fangs 0x2, spear 0x1, cleaver 0xb, maul 0x4,
  crossbow 0x10, flask 0x3, knight 2.6 units screen-left of the rack. `settle()` now also takes two keys.
- NEW `tests/browser/models.spec.ts`: rack <= 8 meshes via `actorStats`; equipping every arm and back to the
  Tideblade (drawing after each) leaves `render.geometries` where it started.

Counters (d3d11, `frame-budget.spec.ts`; ceilings unchanged):

| Scene | Untouched tree | After 009 |
| --- | --- | --- |
| flooded hall | 428 calls / 196,500 tris | 416 / 196,500 |
| junction | 496 / 326,184 | 485 / 326,188 (its known drift band) |
| strike contact | 371 / 154,500 | 349 / 154,548 (+48: the reshaped spear rack of seed 0x1 is in frame, drawn twice) |

`actorStats()` on seed 0x1: knight 59 meshes / 3,990 tris / height 1.8243 -> 53 / 3,990 / 1.8243; spear rack
11 / 440 -> 6 / 464. (The before figures were taken by temporarily restoring `62cfe64`'s armoury after the
fact; step 2 itself missed recording them.) Enemies, unchanged, for 010/011: guard 29 / 3,261 / 1.6744,
stalker 25 / 2,670 / 1.61, warden 42 / 3,862 / 2.339.

Per arm, meshes / triangles (node, `makeWeapon` and `makeWeaponDrop`):

| Arm | In hand before -> after | Rack before -> after |
| --- | --- | --- |
| tideblade | 10 / 228 -> 4 / 228 | 14 / 476 -> 6 / 476 |
| fangs | 5 / 120 -> 3 / 132 | 9 / 368 -> 6 / 380 |
| spear | 7 / 192 -> 3 / 216 | 11 / 440 -> 6 / 464 |
| cleaver | 5 / 136 -> 4 / 136 | 9 / 384 -> 6 / 384 |
| maul | 8 / 112 -> 4 / 112 | 12 / 360 -> 6 / 360 |
| crossbow | 10 / 124 -> 4 / 124 | 14 / 372 -> 7 / 372 |
| flask | 7 / 328 -> 4 / 328 (ember separate) | 11 / 576 -> 6 / 576 |
| bolt (pooled) | 4 / 52 -> 3 / 52 | |

Captures: B0 = `outputs/shots-compare/2026-09-22_21-20-24/after` (from `--base HEAD` with only `actorStats` and
the scenes added). After-sheet = `outputs/shots-compare/2026-09-23_05-12-18/index.html` (`--before <B0>`), both
under the worktree's `game/`, d3d11. Reviewed at native size and in 3x crops.

Visual verdict per arm:
- tideblade - same. Front frame identical; profile 28,532 px changed but worst step 2, spread over the whole
  frame (the same sub-perceptual band moves in knight-strip 01/03/04/06, which hold the same arm, while 00/02/05/07
  are near-identical: scene noise, not the bake). The strike and dash strips' changes (<= 564 px) sit entirely
  on the spear rack in frame; the knight's blade is unchanged in every frame.
- cleaver, maul, flask - same. 10-19 px where not under that band; racks 4 px (cleaver), 450 px worst 1 (maul),
  1,659 px worst 3 (flask). No normal, shading or shadow change visible.
- crossbow - better. The pale prod makes the T read from above in hand and on the rack; before, the prod was a
  black bar lost on the floor.
- spear - better. Brass bindings now mark the haft's length at native size and the head is visibly broader.
  Caveat: the two lugs read as a cross-guard, so at a glance the head can look a little like a short sword on a
  pole; the bindings are what still say spear.
- fangs - slightly better on the rack, same in hand. On the rack the wider blades nearly touch under one brass
  bar and read as a pair rather than two slivers. In hand the fist and arm hide most of it and the knuckle bar is
  not visible at native size in either facing. That part of the acceptance is only partly met.

Gates: typecheck, lint, `npm test` (277 pass), full browser suite on d3d11 (139 passed, 2 skipped, 6.1 min;
untouched tree 128 passed, 2 skipped), `npm run build`, `git diff --check` - all pass.

Seen, not touched (out of scope): `equip` never sets shadow flags on a swapped-in arm (only `makeKnight`'s
traverse does), so every arm but the starting one casts no shadow; and the floor teardown disposes the rack's
materials, which are the knight's palette (they recompile on next use).

## 2026-09-23 - Plan 011: the guard, stalker and warden models

Branch `feat/enemy-models` from `5137836` (plans + plan 009 cherry-picked onto `9fd9a47`, the integration
branch `feat/model-round`); committed locally per stage, not pushed. Plan 010 (the knight) ran in parallel from
the same commit, so every knight-vs-enemy figure here is against the **pre-010 knight** and has to be
re-measured after the two merge.

Step 1, untouched tree (d3d11): typecheck, lint, `npm test` (282 pass), full browser suite (139 passed,
2 skipped, 6.9 min), `npm run build`, `git diff --check` - all pass. Drift check since `c45664f`: only plan 009's
`actorStats` block in `dungeon-game.tsx`. `actorStats()`: guard 29 meshes / 3,261 tris / height 1.6744, stalker
25 / 2,670 / 1.61, warden 42 / 3,862 / 2.339 (identical to 009's figures on the older base). Budget scenes:
flooded hall 416 calls / 196,500 tris, junction 486 / 326,192, strike contact 349 / 154,548.

Step 2, separation on the unchanged enemies (`models.spec.ts`, describe `enemies`, the `models-cast` staging).
NEW `tests/browser/enemy-mask.ts` (010 owns `figure-mask.ts`): three announces every `Scene` it builds to
`__THREE_DEVTOOLS__`, so an init script installed before boot is handed the live scene with no game hook; the
describe runs on its own page for that reason (`isolate: true`). One figure per pair of frames is hidden, in one
`page.evaluate`; that figure casts no shadow and its contact pool is hidden in both frames, so the mask is the body
and not the moon shadow most of a tile away. Two frames with nothing hidden differ by 0 px. Mean CIE Lab per mask,
CIE76 between masks:

| Pair | d3d11 | SwiftShader |
| --- | --- | --- |
| knight-guard | 10.46 | 10.58 |
| knight-stalker | 16.75 | 16.80 |
| knight-warden | 16.02 | 15.97 |
| guard-stalker | 6.50 | 6.44 |
| guard-warden | 15.77 | 15.87 |
| stalker-warden | 18.37 | 18.43 |

The spec asserts each pair at or above the lower of the two, less one. Masks: knight 3,186 px, guard 2,123,
stalker 1,518 (51 x 72 px box), warden 5,393.

### Stage A - bake and plain trim boxes (no visible change)

- `makeSkeleton`: after the shadow-flag traverse, `bakeStatic(rig, { keep: [skull, limbs, weapon, eyes],
  cacheKey: '<kind>:rig' })`, then each joint with the shield kept (`'<kind>:joint<i>'`), then the shield itself
  (`'<kind>:shield'`; hidden on stalker and warden, so skipped). The skull is now a `Group` joint at the same
  position/scale carrying the skull mesh as its first child, so the skull folds into its own bone batch rather
  than staying apart as a mesh root (the one type change; `userData.skull` is only ever rotated). The shield stays
  a Mesh and a joint. 009's node test already holds that a cached bake binds each instance's own materials
  (`dungeon-bake.test.ts`, "a cached bake shares geometry..."), so the helper was not touched.
- `enemyDetails`: a `box` piece whose smallest dimension is under .06 uses a plain unit `BoxGeometry` (brow
  ridges, teeth, the guard's shield cross, the warden's strap and hammer bands). No pauldron plate is under .06.
- `models.spec.ts` `enemies`: mesh ceilings per kind, height within .10 of before, snapshot joints unchanged,
  separation floors, and a windup test reading `emissive` off the rig's baked batch, the skull and the shield arm
  (all `0xff4529`) for each kind.

| Kind | Before | After A |
| --- | --- | --- |
| guard | 29 meshes / 3,261 tris | 18 / 2,397 |
| stalker | 25 / 2,670 | 13 / 1,998 |
| warden | 42 / 3,862 | 19 / 2,806 |

Heights unchanged. **Targets missed for guard (14) and warden (16)**, met for the stalker. What is left is one
mesh per material per joint plus eyes and pool: guard rig bone/iron/cloth, skull bone/shadow, 2 eyes, arms
bone+iron x2, legs 1 x2, shield iron+brass, sword iron+brass, pool. Lower needs a material shared across bodies
(forbidden: the flash) or a part recoloured; neither done. Guard triangles -864 (plan asked -1,200; the owner
relaxed triangles).

Budget after A: flooded hall 350 calls / 191,316 tris, junction 396 / 320,888, strike contact 327 / 152,820.
Specs: character-life, combat, polish (holds `render.geometries` across rebuilds), occlusion, art-direction,
frame-budget - 27 passed, 1 skipped.

Sheets (d3d11, under this worktree's `game/`): against B0 `outputs/shots-compare/2026-09-23_05-51-47/index.html`
(B0 predates 009, so rack and knight-arm rows carry 009's own changes); stage A alone, `--base HEAD`,
`outputs/shots-compare/2026-09-23_05-53-16/index.html`. Reviewed in 2-3x crops: the enemies differ only by
edge specks where bevels went (models-cast worst step 66 on a few pixels per body; flooded hall 91 px). The
strong-looking rows are not the models: the warden chamber (6,849 px, worst 223) and junction (4,547 px) are the
floating room label ("wardens bar the stair", "ambush") landing ~2 px off, and the models-cast/dark-corridor
full-frame counts are the known worst-2 band along the top walls.

### Stage B - the guard: open cap, flat blade, brass rim

- Helmet: same `BONES.armor`, scale (.90, .42, .95), position (0, 1.62, .13) - tuned inside the plan's range from
  the (1.60, .10) start after one side-by-side; the higher, further-back cap shows a little more bone round the
  sockets and still sits on the skull (no gap in any frame).
- Sword: NEW shared `BONES.blade`, a flat box .16 x .035 x .92, broad face up at the idle pose (weapon rotation
  x .1, rig unrotated). Deviation: its last quarter pinches to a point (box with 4 depth segments, the tip ring's x
  set to 0), because a square-ended .16 blade swallowed the trim's .095 spike and read as a bar; the spike stays
  and now reads as a ridge down the point. Iron, unchanged value.
- Shield rim: brass torus r .36, tube .025, 4 x 16, on the face at y .055, merged into the shield's brass batch.

`actorStats()` guard: 18 meshes / 2,397 tris / 1.6744 -> 18 / 2,549 / 1.7106 (+152 tris; the cap's top is the
new highest point, +.036). Separation: knight-guard 10.45 -> 11.54, guard-stalker 6.54 -> 6.04 (floor 5.44),
guard-warden 15.78 -> 18.13. Budget: flooded hall 350 calls / 192,228 tris (step 1: 416 / 196,500), junction
397 / 320,892, strike contact 327 / 153,124. Same spec set plus models.spec: 31 passed, 1 skipped.

Sheets: vs B0 `outputs/shots-compare/2026-09-23_06-05-28/index.html`; stage B alone (A's captures vs B's, no
recapture) `outputs/shots-compare/2026-09-23_06-06-39/index.html`. Changes sit on guards only (models-cast,
flooded hall, strike contact); the warden chamber and junction rows are the floating label again.

Verdict (guard acceptance): met in the three-quarter views. In models-cast and both front-facing flooded-hall
guards the brow, both sockets and the jaw now show as bone under the cap, where before the helmet came down to
the eyes; seen from behind (the flooded hall's left guard) it is still mostly cap, as it should be. The sword
reads as a blade at native size - a broad dark wedge with a point - rather than a line. The rim is the most
visible change: the shield is now a gold ring with a cross rather than eight dots. Caveat: under the struck
flash (strike-contact) the whole body goes pale, and the broader blade makes that a larger pale area for those
frames; at rest it is dark iron and nothing like the knight's pale sword.
