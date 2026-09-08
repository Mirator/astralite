from pathlib import Path
p=Path('game/app/dungeon-game.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('addAtmosphere, stoneTexture, ROOM_NAMES','addAtmosphere, stoneTexture').replace('cellKey, TILE, GUARD_COUNT','cellKey, TILE')
s=s.replace('const XP_PER_ENEMY = 25, ENCOUNTER_XP = GUARD_COUNT * XP_PER_ENEMY;','const XP_PER_ENEMY = 25;')
s=s.replace('useState(GUARD_COUNT)','useState(0)').replace('useState(ROOM_NAMES[0])',"useState('The Tide Gate')")
s=s.replace('    setFloorMap(floor);','    setFloorMap(floor); setEnemies(floor.guardCount);\n    const guardCount = floor.guardCount;')
s=s.replace('GUARD_COUNT','guardCount').replace('ENCOUNTER_XP','(guardCount * XP_PER_ENEMY)')
# The rendered HUD derives totals from the actual generated floor.
s=s.replace("  const action = (detail: string)","  const guardCount = floorMap?.guardCount ?? 0;\n  const roomCount = floorMap?.rooms.length ?? 0;\n  const action = (detail: string)")
s=s.replace('ROOM_NAMES[activeRoom]','floor.rooms[activeRoom].name').replace('ROOM_NAMES[enemy.room]','floor.rooms[enemy.room].name')
a=s.index('    const tiles = new THREE.InstancedMesh');b=s.index('    const { minX',a)
s=s[:a]+'''    const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
    const tiles = new THREE.InstancedMesh(tileGeo, floorMaterial, stoneTiles.length);
    stoneTiles.forEach(({x,z,room},i)=>{matrix.makeTranslation(x*TILE,-.18,z*TILE);tiles.setMatrixAt(i,matrix);const theme=room>=0?floor.rooms[room].theme:'keep';const color=new THREE.Color(theme==='ruins'?0x8b9480:theme==='flooded'?0x78908e:0x969185);color.multiplyScalar(.88+Math.abs(x*7+z*3)%5*.045);tiles.setColorAt(i,color);});
    tiles.receiveShadow=true;world.add(tiles);
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.43,.2,.34),new THREE.MeshStandardMaterial({color:0x665040,roughness:.95}),bridgeTiles.length*4);
    bridgeTiles.forEach(({x,z},i)=>{for(let n=0;n<4;n++){matrix.makeTranslation(x*TILE,-.09,z*TILE+(n-1.5)*.365);planks.setMatrixAt(i*4+n,matrix);planks.setColorAt(i*4+n,new THREE.Color(n%2?0xbca17d:0xd0b68f));}});planks.receiveShadow=true;world.add(planks);
''' +s[b:]
s=s.replace('{visitedCount} / 12 chambers explored','{visitedCount} / {roomCount} areas explored').replace('/ 11 chambers cleansed','/ {Math.max(0,roomCount - 1)} areas cleansed').replace('<small>12 chambers · a new floor every journey','<small>{roomCount} distinct areas · a new floor every journey')
# Use the real footprint on the map instead of rendering rectangles over shaped rooms.
a=s.index('        {floorMap.rooms.map(r => <rect');b=s.index('        <circle ref=',a)
s=s[:a]+'''        {floorMap.rooms.map(r => <path key={r.id} id={`map-room-${r.id}`} d={floorMap.tiles.filter(t=>t.room===r.id).map(t=>`M${t.x-.5},${t.z-.5}h1v1h-1z`).join('')} fill={r.id===0?'#6a9995':'#3e6066'} />)}
''' +s[b:]
p.write_text(s,encoding='utf-8')
p=Path('game/app/dungeon-atmosphere.ts');s=p.read_text().replace('new THREE.InstancedMesh(geometry,stone,blocks.length)','new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95}),blocks.length)');p.write_text(s,encoding='utf-8')
