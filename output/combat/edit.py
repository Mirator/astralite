from pathlib import Path
p=Path('game/app/dungeon-game.tsx')
s=p.read_text()
a=s.index('    const keyDown =')
b=s.index('    const resize =', a)
s=s[:a]+'''    const moveInput = () => {
      const x = +(keys.has('KeyD') || keys.has('ArrowRight') || keys.has('Touchright')) - +(keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('Touchleft'));
      const z = +(keys.has('KeyS') || keys.has('ArrowDown') || keys.has('Touchdown')) - +(keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Touchup'));
      return screenRight.clone().multiplyScalar(x).addScaledVector(screenDown, z).normalize();
    };
    const startAttack = () => {
      if (gameStatus !== 'playing' || dashTime > 0) return;
      attackTime = 0.38; attackBuffer = 0; swingHits.clear();
      const input = moveInput(); if (input.lengthSq()) facing.copy(input);
      attackFacing.copy(facing); player.rotation.y = Math.atan2(-facing.x, -facing.z);
      setShowHelp(false);
    };
    const requestAttack = () => {
      if (gameStatus !== 'playing') return;
      if (attackTime <= 0 && dashTime <= 0) startAttack(); else attackBuffer = 0.18;
    };
    const requestDash = () => {
      if (gameStatus !== 'playing' || dashCooldown > 0) return;
      const input = moveInput(); dashFacing.copy(input.lengthSq() ? input : facing);
      facing.copy(dashFacing); dashTime = 0.18; dashCooldown = 1.35;
      attackTime = 0; attackBuffer = 0; hitStop = 0;
      setShowHelp(false);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      keys.add(e.code); if (e.repeat) return;
      if (e.code === 'Space') requestAttack();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') requestDash();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const clearInput = () => { keys.clear(); attackBuffer = 0; };
    const trigger = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'attack') requestAttack();
      if (detail === 'dash') requestDash();
      if (detail.startsWith('move:')) keys.add(`Touch${detail.slice(5)}`);
      if (detail.startsWith('stop:')) keys.delete(`Touch${detail.slice(5)}`);
    };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearInput); window.addEventListener('dungeon-action', trigger);
    let last = performance.now(), raf = 0;
    const update = (frameDt: number) => {
      elapsed += frameDt; const t = elapsed;
      const dt = hitStop > 0 ? 0 : frameDt; hitStop = Math.max(0, hitStop - frameDt);
      torchLights.forEach((l, i) => { l.intensity = 8.5 + Math.sin(t * 9 + i * 2.2) * 1.4 + Math.sin(t * 17) * 0.5; });
      water.position.y = -1.35 + Math.sin(t * 0.9) * 0.05;
      if (gameStatus === 'playing') {
        attackBuffer = Math.max(0, attackBuffer - dt);
        dashCooldown = Math.max(0, dashCooldown - dt);
        if (attackTime <= 0 && dashTime <= 0 && (attackBuffer > 0 || keys.has('Space'))) startAttack();
        const input = moveInput(), moving = input.lengthSq() > 0;
        if (moving && attackTime <= 0 && dashTime <= 0) facing.copy(input);
        const direction = dashTime > 0 ? dashFacing : facing;
        const targetAngle = Math.atan2(-direction.x, -direction.z);
        const angleDelta = Math.atan2(Math.sin(targetAngle - player.rotation.y), Math.cos(targetAngle - player.rotation.y));
        player.rotation.y += angleDelta * (1 - Math.exp(-28 * dt));
        const speed = dashTime > 0 ? 9.5 : attackTime > 0 ? 2.6 : 3.4;
        velocity.copy(dashTime > 0 ? dashFacing : input).multiplyScalar(speed);
        player.position.addScaledVector(velocity, dt);
        player.position.x = clamp(player.position.x, -6.65, 6.65); player.position.z = clamp(player.position.z, -4, 4);
        if (moving) { walkPhase += dt * speed * 3.3; setShowHelp(false); }
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
          slash.rotation.z = -Math.atan2(-attackFacing.x, -attackFacing.z) + Math.PI / 2;
          const active = age >= 0.065 && age <= 0.175;
          (slash.material as THREE.MeshBasicMaterial).opacity = active ? 0.65 : Math.max(0, 1 - (age - 0.175) / 0.09) * (age > 0.175 ? 0.35 : 0);
          slash.scale.setScalar(1.45);
          if (active) enemyData.forEach((enemy) => {
            if (enemy.dead || swingHits.has(enemy)) return;
            const delta = enemy.group.position.clone().sub(player.position); delta.y = 0;
            if (delta.length() < 1.8 && delta.normalize().dot(attackFacing) > 0.35) {
              swingHits.add(enemy); enemy.hp--; enemy.hitFlash = 0.2; enemy.windup = 0;
              enemy.cooldown = Math.max(enemy.cooldown, 0.4);
              enemy.group.position.addScaledVector(delta, 0.38); burst(enemy.group.position, 0xffb24a, 7); shake = 0.07; hitStop = 0.035;
              if (enemy.hp <= 0) { enemy.dead = true; kills++; burst(enemy.group.position, 0xd9d1bd, 12); setEnemies(5 - kills); if (kills === 5) { gameStatus = 'won'; setStatus('won'); } }
            }
          });
        } else { player.userData.sword.rotation.y = THREE.MathUtils.damp(player.userData.sword.rotation.y, 0, 24, dt); player.userData.body.rotation.z = 0; (slash.material as THREE.MeshBasicMaterial).opacity = 0; }
        enemyData.forEach((enemy) => {
          if (enemy.dead) { enemy.group.rotation.z += dt * 5; enemy.group.scale.multiplyScalar(Math.max(0.001, 1 - dt * 4.5)); return; }
          enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.cooldown -= dt;
          const toPlayer = player.position.clone().sub(enemy.group.position); toPlayer.y = 0; const dist = toPlayer.length();
          if (enemy.windup > 0) {
            enemy.windup = Math.max(0, enemy.windup - dt);
            enemy.group.userData.weapon.rotation.x = -0.4 - Math.sin((1 - enemy.windup / 0.42) * Math.PI / 2) * 1.7;
            if (enemy.windup === 0) {
              enemy.cooldown = 1.25; enemy.group.userData.weapon.rotation.x = 0.55;
              if (dist < 1.55 && toPlayer.normalize().dot(enemy.aim) > 0.45 && dashTime <= 0 && hurtFlash <= 0 && gameStatus === 'playing') {
                hp = Math.max(0, hp - 12); hurtFlash = 0.35; shake = 0.12; burst(player.position, 0xff4c2f, 8); setHealth(hp);
                if (hp <= 0) { gameStatus = 'lost'; setStatus('lost'); }
              }
            }
          } else {
            enemy.group.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z);
            enemy.group.userData.weapon.rotation.x = THREE.MathUtils.damp(enemy.group.userData.weapon.rotation.x, -0.4, 10, dt);
            if (enemy.hitFlash <= 0) {
              if (dist > 1.15) enemy.group.position.addScaledVector(toPlayer.normalize(), enemy.speed * dt);
              else if (enemy.cooldown <= 0) { enemy.windup = 0.42; enemy.aim.copy(toPlayer).normalize(); }
            }
          }
          enemy.group.position.x = clamp(enemy.group.position.x, -6.65, 6.65); enemy.group.position.z = clamp(enemy.group.position.z, -4, 4);
          enemy.group.position.y = 0.03 + Math.abs(Math.sin(t * 6 + enemy.phase)) * 0.045;
          enemy.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.setHex(enemy.hitFlash > 0 ? 0xffa34a : enemy.windup > 0 ? 0xb83915 : 0x000000); o.material.emissiveIntensity = enemy.hitFlash > 0 ? 0.8 : 0.5; } });
        });
      }
      particles.forEach((p) => { p.life -= dt; p.velocity.y -= dt * 7; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.scale.setScalar(Math.max(0, p.life * 2)); });
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) { world.remove(particles[i].mesh); if (particles[i].mesh.material !== sparkMat) (particles[i].mesh.material as THREE.Material).dispose(); particles.splice(i, 1); }
      hurtFlash = Math.max(0, hurtFlash - dt); shake = Math.max(0, shake - dt);
      camera.position.set(player.position.x + 9.2, 12.5, player.position.z + 11.5);
      if (shake > 0) camera.position.add(new THREE.Vector3(Math.sin(t * 95) * shake, 0, Math.cos(t * 83) * shake));
      camera.lookAt(player.position.x, 0, player.position.z);
      renderer.domElement.style.filter = hurtFlash > 0 ? `sepia(.3) saturate(1.3) brightness(${0.9 + hurtFlash * 0.3})` : '';
    };
    const hooks = window as Window & { advanceTime?: (ms: number) => void; render_game_to_text?: () => string };
    hooks.advanceTime = (ms) => {
      manualTime = true;
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < steps; i++) update(ms / steps / 1000);
      renderer.render(scene, camera);
    };
    hooks.render_game_to_text = () => JSON.stringify({
      coordinates: 'World X right, Z down; controls relative to camera; model forward -Z', mode: gameStatus,
      health: hp, remaining: 5 - kills,
      player: { x: player.position.x, z: player.position.z, facing: { x: facing.x, z: facing.z }, rotation: player.rotation.y, velocity: { x: velocity.x, z: velocity.z }, attackTime, attackBuffer, dashTime, dashCooldown, swordAngle: player.userData.sword.rotation.y, legs: player.userData.legs.map((leg: THREE.Group) => leg.rotation.x) },
      enemies: enemyData.filter(e => !e.dead).map(e => ({ x: e.group.position.x, z: e.group.position.z, hp: e.hp, windup: e.windup })),
    });
    const animate = (now: number) => {
      if (stopped) return; raf = requestAnimationFrame(animate);
      if (!manualTime && !document.hidden) { update(Math.min((now - last) / 1000, 0.04)); renderer.render(scene, camera); }
      last = now;
    };
    raf = requestAnimationFrame(animate);
''' +s[b:]
s=s.replace("window.removeEventListener('dungeon-action', trigger); renderer.dispose();", "window.removeEventListener('dungeon-action', trigger); window.removeEventListener('blur', clearInput); delete hooks.advanceTime; delete hooks.render_game_to_text; scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose();")
s=s.replace('onPointerDown={() => action(`move:${dir}`)}', 'onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); action(`move:${dir}`); }} onLostPointerCapture={() => action(`stop:${dir}`)}')
s=s.replace('<kbd>SPACE</kbd> STRIKE', '<kbd>SPACE</kbd> HOLD TO STRIKE')
p.write_text(s)
