// Solmar Bay PD: patrol cars that spawn off-screen when your wanted level
// rises, hunt you through the road network, ram your car, and fill the bust
// meter when they pin you down.

import { clamp, angleTo, turnToward, dist } from './util.js';
import { makeCar } from './vehicles.js';

export function desiredCops(G) {
  return G.stars <= 0 ? 0 : Math.min(2 + G.stars, 6);
}

function spawnCop(G) {
  const world = G.world;
  const p = G.playerPos();
  // Find a road point in a ring around the player: close enough to matter,
  // far enough to be fair.
  let spot = null;
  for (let tries = 0; tries < 24 && !spot; tries++) {
    const cand = world.intersections[Math.floor(G.rng() * world.intersections.length)];
    const d = dist(cand.x, cand.y, p.x, p.y);
    if (d > 620 && d < 1080) spot = cand;
  }
  if (!spot) spot = world.nearestIntersection(p.x + 700, p.y);
  const cop = makeCar(spot.x, spot.y, 0, '#23272e', 'police');
  cop.cruise = 355;
  cop.stuckFor = 0;
  cop.reverseFor = 0;
  G.cops.push(cop);
  return cop;
}

export function updatePolice(G, dt) {
  const want = desiredCops(G);
  G.copSpawnIn -= dt;
  if (G.cops.length < want && G.copSpawnIn <= 0) {
    spawnCop(G);
    G.copSpawnIn = 1.1;
  }
  const p = G.playerPos();
  // Cops give up and peel away when the heat is gone.
  for (let i = G.cops.length - 1; i >= 0; i--) {
    const cop = G.cops[i];
    const d = dist(cop.x, cop.y, p.x, p.y);
    if ((want === 0 && d > 500) || d > 1700) {
      G.cops.splice(i, 1);
    }
  }

  for (const cop of G.cops) {
    // Target the player, unless a building blocks the way ahead — then cut
    // to the nearest intersection and re-acquire from there.
    let tx = p.x;
    let ty = p.y;
    const probeX = cop.x + Math.cos(cop.angle) * 74;
    const probeY = cop.y + Math.sin(cop.angle) * 74;
    const dPlayer = dist(cop.x, cop.y, p.x, p.y);
    if (dPlayer > 130 && G.world.pointInBuilding(probeX, probeY, 8)) {
      const cross = G.world.nearestIntersection(cop.x, cop.y);
      tx = cross.x;
      ty = cross.y;
      if (dist(cop.x, cop.y, tx, ty) < 34) {
        tx = p.x;
        ty = p.y;
      }
    }
    const desired = angleTo(cop.x, cop.y, tx, ty);
    cop.angle = turnToward(cop.angle, desired, 2.7 * dt);

    let targetSpeed = 352;
    if (dPlayer < 52) targetSpeed = Math.max(60, dPlayer * 3.2);
    if (cop.reverseFor > 0) {
      cop.reverseFor -= dt;
      targetSpeed = -120;
    }
    const accel = targetSpeed > cop.speed ? 300 : 420;
    cop.speed += clamp(targetSpeed - cop.speed, -accel * dt, accel * dt);

    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    const res = G.world.collideCircle(cop.x, cop.y, 16);
    cop.x = res.x;
    cop.y = res.y;

    // Stuck recovery: if barely moving while the player is far, reverse out.
    if (Math.abs(cop.speed) < 14 && dPlayer > 90 && cop.reverseFor <= 0) {
      cop.stuckFor += dt;
      if (cop.stuckFor > 1.4) {
        cop.reverseFor = 0.55;
        cop.stuckFor = 0;
        cop.angle += 0.5;
      }
    } else {
      cop.stuckFor = Math.max(0, cop.stuckFor - dt);
    }
  }
}

// The bust meter: fills while a cop is on top of a slow or on-foot player.
// Returns true on the frame the player is busted.
export function updateBust(G, dt) {
  const p = G.playerPos();
  let nearest = Infinity;
  for (const cop of G.cops) {
    nearest = Math.min(nearest, dist(cop.x, cop.y, p.x, p.y));
  }
  const playerSpeed = G.player.inCar ? Math.abs(G.player.inCar.speed) : Math.hypot(G.player.vx, G.player.vy);
  const pinned = nearest < 58 && playerSpeed < 42;
  if (pinned && G.stars > 0) {
    G.bustMeter = Math.min(1, G.bustMeter + dt / 2.1);
  } else {
    G.bustMeter = Math.max(0, G.bustMeter - dt / 1.4);
  }
  return G.bustMeter >= 1;
}
