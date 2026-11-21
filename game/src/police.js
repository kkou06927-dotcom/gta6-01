// police.js — Solmar Bay PD: spawn pressure scaled by wanted stars,
// pursuit steering that rams the player, and the bust meter.

import { angLerp, clamp, dist } from './util.js';
import { intersections } from './world.js';
import { makeCar } from './vehicles.js';

export function desiredPolice(G) {
  return G.stars <= 0 ? 0 : Math.min(2 + G.stars, 6);
}

function spawnCop(G) {
  const p = G.playerPos();
  const pts = intersections();
  let best = null, bestScore = -Infinity;
  for (const pt of pts) {
    const d = dist(p.x, p.y, pt.x, pt.y);
    if (d < 480) continue;
    const score = -Math.abs(d - 640) + G.rng() * 60;
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  if (!best) return;
  const car = makeCar(best.x, best.y, Math.atan2(p.y - best.y, p.x - best.x), '#e9ebee', 'police');
  car.rev = 0;
  G.police.push(car);
}

export function updatePolice(G, dt) {
  // Spawning pressure.
  G.policeTimer -= dt;
  if (G.police.length < desiredPolice(G) && G.policeTimer <= 0) {
    spawnCop(G);
    G.policeTimer = 1.6;
  }

  const target = G.playerPos();
  const topSpeed = 288 + G.stars * 9;
  for (let i = G.police.length - 1; i >= 0; i--) {
    const cop = G.police[i];
    const d = dist(cop.x, cop.y, target.x, target.y);

    if (G.stars <= 0) { // called off: coast away and despawn out of sight
      cop.speed = Math.max(0, cop.speed - 160 * dt);
      cop.x += Math.cos(cop.angle) * cop.speed * dt;
      cop.y += Math.sin(cop.angle) * cop.speed * dt;
      if (d > 700) G.police.splice(i, 1);
      continue;
    }

    const want = Math.atan2(target.y - cop.y, target.x - cop.x);
    cop.angle = angLerp(cop.angle, want, clamp(dt * 3.2, 0, 1));

    let goal = topSpeed;
    if (G.player.car === null && d < 60) goal = Math.max(0, (d - 30) * 4); // close in on foot targets
    if (cop.rev > 0) { cop.rev -= dt; goal = -120; }
    cop.speed += clamp(goal - cop.speed, -500 * dt, 300 * dt);

    const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
    const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
    const res = G.collideWorld(nx, ny, 17);
    if (res.hit) {
      if (Math.abs(cop.speed) > 130 && cop.rev <= 0) cop.rev = 0.55; // back out and try again
      cop.speed *= 0.3;
    }
    cop.x = res.x; cop.y = res.y;
  }
}

// Bust meter: fills while a cop has you pinned (on foot, or in a stopped
// car), drains otherwise. Returns true the moment it tops out.
export function updateBust(G, dt) {
  const p = G.playerPos();
  const pinned = G.police.some((cop) => dist(cop.x, cop.y, p.x, p.y) < 52);
  const slow = G.player.car === null || Math.abs(G.player.car.speed) < 34;
  if (pinned && slow && G.stars > 0) G.bust = Math.min(1, G.bust + dt / 1.5);
  else G.bust = Math.max(0, G.bust - dt * 0.55);
  return G.bust >= 1;
}
