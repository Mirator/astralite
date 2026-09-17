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
