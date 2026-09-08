from pathlib import Path
p=Path('game/app/dungeon-game.tsx')
s=p.read_text()
s=s.replace("import * as THREE from 'three';", "import * as THREE from 'three';\nimport { generateFloor, moveOnFloor, cellKey, TILE, GUARD_COUNT } from './dungeon-floor';")
s=s.replace('aim: THREE.Vector3 };','aim: THREE.Vector3; room: number };')
s=s.replace('const ARENA_X = 9.65, ARENA_Z = 7;\n','').replace('5 * XP_PER_ENEMY','GUARD_COUNT * XP_PER_ENEMY')
s=s.replace('const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));\n','')
s=s.replace('const [enemies, setEnemies] = useState(5);','const [enemies, setEnemies] = useState(GUARD_COUNT);\n  const [floorMap, setFloorMap] = useState<ReturnType<typeof generateFloor> | null>(null);\n  const [visitedCount, setVisitedCount] = useState(1);\n  const mapPlayer = useRef<SVGCircleElement>(null);')
s=s.replace('const swingHits = new Set<Enemy>();','const floor = generateFloor(crypto.getRandomValues(new Uint32Array(1))[0]);\n    setFloorMap(floor);\n    const visited = new Set([0]), cleared = new Set([0]);\n    const swingHits = new Set<Enemy>();')
a=s.index('    for (let x = -7;'); b=s.index('    const player = makeKnight();',a)
s=s[:a]+'''    const matrix = new THREE.Matrix4();
    const tiles = new THREE.InstancedMesh(tileGeo, stoneMats[0], floor.tiles.length);
    floor.tiles.forEach(({ x, z }, i) => { matrix.makeTranslation(x * TILE, -0.18, z * TILE); tiles.setMatrixAt(i, matrix); tiles.setColorAt(i, new THREE.Color([0x3b4448, 0x465052, 0x303a3f][Math.abs(x * 7 + z * 3) % 3])); });
    tiles.receiveShadow = true; world.add(tiles);
    const { minX, maxX, minZ, maxZ } = floor.bounds;
    const water = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX + 40) * TILE, (maxZ - minZ + 40) * TILE), new THREE.MeshStandardMaterial({ color: 0x0b6670, emissive: 0x062e39, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.22 }));
    water.rotation.x = -Math.PI / 2; water.position.set((minX + maxX) * TILE / 2, -1.35, (minZ + maxZ) * TILE / 2); scene.add(water);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x252f35, roughness: 1 });
    const borders: { x: number; z: number; horizontal: boolean }[] = [];
    floor.tiles.forEach(({ x, z }) => { for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!floor.cells.has(cellKey(x + dx,z + dz))) borders.push({ x: (x + dx * 0.5) * TILE, z: (z + dz * 0.5) * TILE, horizontal: dz !== 0 }); });
    // Low parapets keep the isometric view readable, including narrow bridges.
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.65, 1), wallMat, borders.length);
    borders.forEach((b,i) => { matrix.compose(new THREE.Vector3(b.x,0.15,b.z), new THREE.Quaternion(), new THREE.Vector3(b.horizontal ? TILE : 0.16,1,b.horizontal ? 0.16 : TILE)); walls.setMatrixAt(i,matrix); });
    walls.castShadow = walls.receiveShadow = true; world.add(walls);
    const torchLights: THREE.PointLight[] = [];
    floor.rooms.forEach(r => {
      for (const side of [-1,1]) {
        const x = (r.x + side * (r.halfX - 0.5)) * TILE, z = (r.z - r.halfZ + 0.5) * TILE;
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.78, 6), wallMat); pedestal.position.set(x,0.35,z);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16,0.62,7),new THREE.MeshBasicMaterial({ color: 0xffa334 })); flame.position.set(x,1.03,z); world.add(pedestal,flame);
      }
    });
    // Reuse only three local lights as the camera travels across the floor.
    for (let i = 0; i < 3; i++) { const light = new THREE.PointLight(0xff6d20,9,14,1.8); torchLights.push(light); scene.add(light); }
''' + s[b:]
s=s.replace('player.position.set(-3.8, 0.03, 2.4)','player.position.set(floor.rooms[0].x * TILE, 0.03, floor.rooms[0].z * TILE)')
a=s.index('    const enemyData: Enemy[]'); b=s.index('    const particles:',a)
s=s[:a]+'''    const enemyData: Enemy[] = floor.rooms.slice(1).flatMap(room => [-1,1].map((side, index) => {
      const group = makeSkeleton(index); group.position.set(room.x * TILE + side * 2.3,0.03,room.z * TILE); world.add(group);
      return { group, hp: 2, speed: 1.4, cooldown: 0.4 + index * 0.2, hitFlash: 0, dead: false, phase: room.id * 1.7, windup: 0, aim: new THREE.Vector3(), room: room.id };
    }));
    let pathCell = '';
    const distances = new Map<string,number>();
    const updatePaths = () => {
      const x = Math.round(player.position.x / TILE), z = Math.round(player.position.z / TILE), key = cellKey(x,z);
      if (pathCell === key) return;
      pathCell = key; distances.clear(); distances.set(key,0);
      const queue = [{ x,z }];
      for (let i = 0; i < queue.length; i++) { const c = queue[i], distance = distances.get(cellKey(c.x,c.z))!; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const next = cellKey(c.x + dx,c.z + dz); if (floor.cells.has(next) && !distances.has(next)) { distances.set(next,distance + 1); queue.push({ x: c.x + dx,z: c.z + dz }); } } }
    };
''' + s[b:]
s=s.replace('player.position.addScaledVector(velocity, dt);\n        player.position.x = clamp(player.position.x, -ARENA_X, ARENA_X); player.position.z = clamp(player.position.z, -ARENA_Z, ARENA_Z);','moveOnFloor(floor.cells, player.position, velocity.x * dt, velocity.z * dt);\n        updatePaths();\n        floor.rooms.forEach(r => { if (Math.abs(player.position.x / TILE - r.x) <= r.halfX && Math.abs(player.position.z / TILE - r.z) <= r.halfZ && !visited.has(r.id)) { visited.add(r.id); setVisitedCount(visited.size); document.getElementById(`map-room-${r.id}`)?.setAttribute("fill", "#6a9995"); } });')
s=s.replace('enemy.group.position.addScaledVector(delta, 0.38);','moveOnFloor(floor.cells, enemy.group.position, delta.x * 0.38, delta.z * 0.38);')
s=s.replace("setEnemies(5 - kills); if (kills === 5)","setEnemies(GUARD_COUNT - kills); if (!cleared.has(enemy.room) && enemyData.every(e => e.room !== enemy.room || e.dead)) { cleared.add(enemy.room); hp = Math.min(100, hp + 20); setHealth(hp); document.getElementById(`map-room-${enemy.room}`)?.setAttribute('fill', '#a8d5b0'); } if (kills === GUARD_COUNT)")
s=s.replace("enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;", "enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;\n          const ex = Math.round(enemy.group.position.x / TILE), ez = Math.round(enemy.group.position.z / TILE);\n          if ((distances.get(cellKey(ex,ez)) ?? Infinity) > 10) return;")
s=s.replace('if (dist > 1.15) enemy.group.position.addScaledVector(toPlayer.normalize(), enemy.speed * dt);', '''if (dist > 1.15) {
                let direction = toPlayer.clone();
                if (dist > TILE * 1.5) {
                  const next = [[ex + 1,ez],[ex - 1,ez],[ex,ez + 1],[ex,ez - 1]].filter(([x,z]) => floor.cells.has(cellKey(x,z))).sort((a,b) => (distances.get(cellKey(a[0],a[1])) ?? Infinity) - (distances.get(cellKey(b[0],b[1])) ?? Infinity))[0];
                  if (next) direction.set(next[0] * TILE - enemy.group.position.x,0,next[1] * TILE - enemy.group.position.z);
                }
                direction.normalize(); moveOnFloor(floor.cells,enemy.group.position,direction.x * enemy.speed * dt,direction.z * enemy.speed * dt);
              }''')
s=s.replace('          enemy.group.position.x = clamp(enemy.group.position.x, -ARENA_X, ARENA_X); enemy.group.position.z = clamp(enemy.group.position.z, -ARENA_Z, ARENA_Z);\n','')
s=s.replace('a.group.position.addScaledVector(delta, -push * weightA / total);','moveOnFloor(floor.cells,a.group.position,-delta.x * push * weightA / total,-delta.z * push * weightA / total);').replace('b.group.position.addScaledVector(delta, push * weightB / total);','moveOnFloor(floor.cells,b.group.position,delta.x * push * weightB / total,delta.z * push * weightB / total);')
s=s.replace('          enemyData.forEach(({ group }) => { group.position.x = clamp(group.position.x, -ARENA_X, ARENA_X); group.position.z = clamp(group.position.z, -ARENA_Z, ARENA_Z); });\n','')
s=s.replace('      camera.position.set(player.position.x + 9.2', '''      const nearest = [...floor.rooms].sort((a,b) => Math.hypot(a.x * TILE - player.position.x,a.z * TILE - player.position.z) - Math.hypot(b.x * TILE - player.position.x,b.z * TILE - player.position.z));
      torchLights.forEach((light,i) => { const r = nearest[i]; light.position.set((r.x - r.halfX + 0.5) * TILE,1.35,(r.z - r.halfZ + 0.5) * TILE); });
      moon.position.set(player.position.x - 7,12,player.position.z + 9); moon.target.position.set(player.position.x,0,player.position.z); moon.target.updateMatrixWorld();
      mapPlayer.current?.setAttribute('cx', String(player.position.x / TILE)); mapPlayer.current?.setAttribute('cy', String(player.position.z / TILE));
      camera.position.set(player.position.x + 9.2''')
s=s.replace('remaining: 5 - kills','remaining: GUARD_COUNT - kills')
s=s.replace('arena: { minX: -ARENA_X, maxX: ARENA_X, minZ: -ARENA_Z, maxZ: ARENA_Z },', 'floor: { seed: floor.seed, tiles: floor.tiles.length, areaMultiplier: floor.tiles.length / 161, tileSize: TILE, bounds: floor.bounds, rooms: floor.rooms, edges: floor.edges, visited: [...visited], cleared: [...cleared] },')
s=s.replace('Isometric dungeon combat arena','Procedural isometric dungeon floor').replace('Lower cistern · encounter 01','Lower cistern · 12 chambers')
s=s.replace('      <aside className="controls">','''      {floorMap && <aside className="floor-map" aria-label="Floor map: your position and connected chambers"><svg viewBox={`${floorMap.bounds.minX - 3} ${floorMap.bounds.minZ - 3} ${floorMap.bounds.maxX - floorMap.bounds.minX + 6} ${floorMap.bounds.maxZ - floorMap.bounds.minZ + 6}`}>
        <path d={floorMap.tiles.map(t => `M${t.x - 0.5},${t.z - 0.5}h1v1h-1z`).join('')} fill="#334e56" />
        {floorMap.rooms.map(r => <rect key={r.id} id={`map-room-${r.id}`} x={r.x - r.halfX} y={r.z - r.halfZ} width={r.halfX * 2} height={r.halfZ * 2} fill={r.id === 0 ? '#6a9995' : '#3e6066'} />)}
        <circle ref={mapPlayer} cx={floorMap.rooms[0].x} cy={floorMap.rooms[0].z} r="1.8" fill="#ffc573" stroke="#071119" strokeWidth="0.7" />
      </svg><span>{visitedCount} / 12 chambers explored</span></aside>}
      <aside className="controls">''')
s=s.replace('ENTER THE FRAY','EXPLORE THE CISTERN').replace('Move toward the skeleton guard','Clear each chamber · recover 20 vitality')
s=s.replace('ENCOUNTER {status','FLOOR {status').replace('{5 - enemies} / 5 guards','{GUARD_COUNT - enemies} / {GUARD_COUNT} guards').replace('TRY AGAIN','NEW FLOOR')
p.write_text(s)
with Path('game/app/globals.css').open('a') as f: f.write('''\n.floor-map { position: absolute; left: 24px; bottom: 82px; z-index: 4; width: 200px; padding: 10px; border: 1px solid #87989a44; background: #071119d9; pointer-events: none; }\n.floor-map svg { display: block; width: 100%; height: 135px; }\n.floor-map span { display: block; text-align: center; font-size: 12px; color: #acbbb8; margin-top: 6px; }\n@media (max-width: 720px) { .floor-map { left: 14px; top: 94px; bottom: auto; width: 120px; padding: 6px; } .floor-map svg { height: 80px; } .floor-map span { font-size: 12px; } }\n''')
with Path('game/progress.md').open('a') as f: f.write('\nCurrent request: Expand the single room into a procedurally generated floor at least 10x larger. Added seeded 12-room connected generator (minimum 2,028 chamber tiles vs 161 old tiles, plus corridors), instanced stone and parapets, collision sliding/substeps, guard pathfinding and local activation, 22 guards, room-clear healing, full-floor XP and navigation map. Validation in progress.\n')
