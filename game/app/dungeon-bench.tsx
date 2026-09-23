'use client';
// The figure bench (plan 012 Stage C): every figure, from eight facings, on one sheet, rendered once and
// deterministically. It exists so a change to a spec in dungeon-knight.ts or dungeon-skeleton.ts can be
// looked at in seconds instead of a `shots:compare` run (~30s a side) and a hand crop of a 60px-tall
// figure. It builds figures only through `makeKnight`/`makeSkeleton`, the same functions the game calls,
// so it always shows the real models - never a copy kept in sync by hand.
//
// The ground plane, lights and camera approximate the game's own (dungeon-game.tsx's renderer setup and
// the moon/hemisphere lights, dungeon-aim.ts's CAMERA_OFFSET) closely enough to judge a change by, but
// this is NOT the renderer the game ships: there is no fog, no torchlight, no room mood, no paving
// texture, no cutaway, no per-frame moon retargeting. It is an approximation for fast iteration. The
// in-game `shots:compare` stays the judge of what actually ships.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { makeKnight } from './dungeon-knight';
import { makeSkeleton, type SkeletonKind } from './dungeon-skeleton';
import { CAMERA_OFFSET, SCREEN_DOWN, SCREEN_RIGHT } from './dungeon-aim';
import { makeWeapon, type ArmedWeapon, type ArmoryPalette, type Plate } from './dungeon-armory';
import { STARTING_WEAPON, WEAPONS, type WeaponId } from './dungeon-weapon';

type FigureKind = 'knight' | SkeletonKind;
const ALL_FIGURES: FigureKind[] = ['knight', 'guard', 'stalker', 'warden'];
const ALL_WEAPONS = Object.keys(WEAPONS) as WeaponId[];

// The eight facings `models-knight-strip` reads (tests/browser/shots.spec.ts): 45 degrees apart, clockwise
// on screen starting from facing the lens. `[sx, sz]` is the same screen-right/screen-down pair the game's
// own `moveInput()` builds from held arrow keys (dungeon-game.tsx); turning it into a world yaw the same
// way `player.rotation.y = Math.atan2(-facing.x, -facing.z)` does keeps the bench's columns the columns
// that strip actually shows.
const FACING_KEYS: [number, number][] = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];
const FACING_YAWS = FACING_KEYS.map(([sx, sz]) => {
  const dx = sx * SCREEN_RIGHT.x + sz * SCREEN_DOWN.x, dz = sx * SCREEN_RIGHT.z + sz * SCREEN_DOWN.z;
  const m = Math.hypot(dx, dz) || 1;
  return Math.atan2(-dx / m, -dz / m);
});

const CELL_W = 200, CELL_H = 240, LABEL_H = 22;

/** The knight's own equip step (dungeon-game.tsx's `equip`), standalone: swap the arm in his hand without
 *  touching anything else about him. */
function equipArm(knight: THREE.Group, id: WeaponId) {
  const { palette, plate } = knight.userData.armoury as { palette: ArmoryPalette; plate: Plate };
  const armed = knight.userData.armed as ArmedWeapon;
  armed.group.removeFromParent();
  const next = makeWeapon(id, palette, plate);
  (knight.userData.sword as THREE.Group).add(next.group);
  knight.userData.armed = next;
}

function parseFigures(raw: string | null): FigureKind[] {
  if (!raw) return ALL_FIGURES;
  const requested = raw.split(',').map(s => s.trim()).filter((s): s is FigureKind => (ALL_FIGURES as string[]).includes(s));
  return requested.length ? requested : ALL_FIGURES;
}
function parseWeapon(raw: string | null): WeaponId | 'all' {
  if (raw === 'all') return 'all';
  return raw && (ALL_WEAPONS as string[]).includes(raw) ? (raw as WeaponId) : STARTING_WEAPON;
}
function parseZoom(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function parseBg(raw: string | null): 'paving' | 'grey' {
  return raw === 'grey' ? 'grey' : 'paving';
}

type Row = { label: string; group: THREE.Group };

export default function DungeonBench() {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current, labelHost = labelsRef.current;
    if (!mount || !labelHost) return;

    const params = new URLSearchParams(window.location.search);
    const figures = parseFigures(params.get('figures'));
    const weaponParam = parseWeapon(params.get('weapon'));
    const zoom = parseZoom(params.get('zoom'));
    const bg = parseBg(params.get('bg'));

    const rows: Row[] = [];
    for (const kind of figures) {
      if (kind === 'knight') {
        const ids = weaponParam === 'all' ? ALL_WEAPONS : [weaponParam];
        for (const id of ids) {
          const knight = makeKnight();
          if (id !== STARTING_WEAPON) equipArm(knight, id);
          rows.push({ label: weaponParam === 'all' ? `knight ${id}` : 'knight', group: knight });
        }
      } else {
        rows.push({ label: kind, group: makeSkeleton(kind) });
      }
    }

    const cols = FACING_YAWS.length;
    const width = cols * CELL_W, height = rows.length * CELL_H;

    // preserveDrawingBuffer: the game's own renderer skips this for performance, but the bench draws once
    // and stops, and bench.spec.ts and `npm run figures` both need the framebuffer to still be there
    // whenever they get around to reading it back, not just in the task that drew it.
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); // device scale 1: a reviewable frame is a fixed pixel size, not a display's own.
    renderer.setSize(width, height, false);
    renderer.setScissorTest(true);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    // The game's own output settings (dungeon-game.tsx, ~377): ACES at 1.15 is what every figure is
    // actually judged under, and a bench lit any other way would send an artist chasing a colour that
    // reads differently in the real game.
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1b24);

    // The game's hemisphere and moon values (dungeon-game.tsx, ~384-403), minus the per-room mood that
    // retargets the moon every frame - there is no room here for it to be lit by.
    scene.add(new THREE.HemisphereLight(0x8fb4c6, 0x16282c, .52));
    const moon = new THREE.DirectionalLight(0xccdfe6, 5);
    moon.position.set(-7, 12, 9);
    moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.radius = 3.5; moon.shadow.normalBias = .035; moon.shadow.bias = -.00015;
    moon.shadow.camera.left = moon.shadow.camera.bottom = -6; moon.shadow.camera.right = moon.shadow.camera.top = 6;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 40;
    scene.add(moon);
    scene.add(moon.target);

    // A flat square of the paving colour to stand on - an approximation of contrast, not the paving
    // geometry or its texture (dungeon-art.ts). "grey" is a neutral alternative for judging a figure's
    // own values without the paving's own hue in the frame.
    const groundColor = bg === 'grey' ? 0x808080 : 0x607574;
    // Big enough that its far edge never enters an orthographic frame at any zoom the bench supports.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    // One figure live in the scene at a time, swapped between cells; each row's figure is built once and
    // reused across all eight columns, so `figures=knight,guard,stalker,warden` builds four figures, not
    // thirty-two.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
    const away = new THREE.Vector3(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z).normalize();
    // Tallest figure sets the shared zoom, so every row sits at the same scale and a change in one figure's
    // height is visible against the others rather than hidden by a camera that re-fit itself.
    const TALLEST = 2.4;
    const focusHeight = TALLEST * 0.42;
    const span = (TALLEST / 0.95 / 2) / zoom;
    const aspect = CELL_W / CELL_H;
    camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span;
    camera.position.copy(away).multiplyScalar(16);
    camera.lookAt(0, focusHeight, 0);
    camera.updateProjectionMatrix();
    moon.target.position.set(0, focusHeight, 0);

    for (const { group } of rows) scene.add(group);
    for (const { group } of rows) group.visible = false;

    labelHost.textContent = '';
    labelHost.style.width = `${width}px`; labelHost.style.height = `${height}px`;
    for (const [r, row] of rows.entries()) {
      for (let c = 0; c < cols; c++) {
        const div = document.createElement('div');
        div.textContent = cols === 1 ? row.label : `${row.label} ${c}`;
        Object.assign(div.style, {
          position: 'absolute', left: `${c * CELL_W}px`, top: `${r * CELL_H + CELL_H - LABEL_H}px`,
          width: `${CELL_W}px`, height: `${LABEL_H}px`, lineHeight: `${LABEL_H}px`,
          font: '11px ui-monospace, monospace', color: '#dce8e6', background: 'rgba(4,10,12,.72)',
          textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        labelHost.appendChild(div);
      }
    }

    // One render pass per cell: place this row's figure at the facing this column names, point the camera
    // at it from the game's own angle, and paint only this cell's rectangle (setScissor), bottom-left
    // origin like the rest of WebGL. The label strip is left in the render; the DOM overlay above sits on
    // top of it, exactly where dungeon-figures.test.ts would need a name to matter and nowhere WebGL has to
    // know what a name is.
    for (const [r, row] of rows.entries()) {
      row.group.visible = true;
      for (let c = 0; c < cols; c++) {
        row.group.rotation.y = FACING_YAWS[c]!;
        row.group.updateMatrixWorld(true);
        const x = c * CELL_W, y = height - (r + 1) * CELL_H;
        renderer.setViewport(x, y, CELL_W, CELL_H);
        renderer.setScissor(x, y, CELL_W, CELL_H);
        renderer.render(scene, camera);
      }
      row.group.visible = false;
    }

    (window as unknown as { __bench: string }).__bench = 'ready';

    return () => {
      for (const { group } of rows) {
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            if (!o.geometry.userData.shared) o.geometry.dispose();
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            for (const material of materials) material.dispose();
          }
        });
      }
      ground.geometry.dispose(); (ground.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      labelHost.textContent = '';
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: 'fit-content', background: '#050b0d' }}>
      <div ref={mountRef} />
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  );
}
