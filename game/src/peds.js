// peds.js — pedestrians: they stroll the sidewalks around each block,
// flee gunfire and fast cars, and go down when hurt.

import { clamp, dist, pick, randRange, TAU } from './util.js';

const SKIN = ['#f2c79b', '#c68863', '#8a5a3b', '#e8b48c'];
const CLOTHES = ['#d95f4b', '#4b7fd9', '#59b06a', '#e3b341', '#9a6fc0', '#e8e4da', '#4fb3b3', '#d97fb0'];

export function spawnPeds(world, rng, n) {
  const peds = [];
  for (let i = 0; i < n; i++) {
    const block = pick(rng, world.pedBlocks);
    const per = 2 * (block.w + block.h);
    peds.push({
      block, s: rng() * per, per,
      dir: rng() < 0.5 ? 1 : -1,
      speed: randRange(rng, 34, 58),
      x: 0, y: 0, angle: 0,
      skin: pick(rng, SKIN), shirt: pick(rng, CLOTHES),
      state: 'walk', fleeT: 0, fleeX: 0, fleeY: 0, downT: 0, step: rng() * TAU,
    });
    placeOnBlock(peds[i]);
  }
  return peds;
}

// Position along the block perimeter for parameter s.
function placeOnBlock(p) {
  const { x, y, w, h } = p.block;
  let s = ((p.s % p.per) + p.per) % p.per;
  if (s < w) { p.x = x + s; p.y = y; p.angle = 0; }
  else if ((s -= w) < h) { p.x = x + w; p.y = y + s; p.angle = Math.PI / 2; }
  else if ((s -= h) < w) { p.x = x + w - s; p.y = y + h; p.angle = Math.PI; }
  else { s -= w; p.x = x; p.y = y + h - s; p.angle = -Math.PI / 2; }
  if (p.dir < 0) p.angle += Math.PI;
}

export function updatePeds(G, dt) {
  const threat = G.threat; // {x, y, t} recent violence, or null
  for (const p of G.peds) {
    if (p.state === 'down') { p.downT += dt; continue; }
    p.step += dt * (p.state === 'flee' ? 13 : 8);

    if (threat && threat.t > 0 && dist(p.x, p.y, threat.x, threat.y) < 190 && p.state !== 'flee') {
      p.state = 'flee'; p.fleeT = randRange(G.rng, 1.2, 2.2);
      const a = Math.atan2(p.y - threat.y, p.x - threat.x);
      p.fleeX = Math.cos(a); p.fleeY = Math.sin(a);
    }
    // Flee fast cars bearing down on them too.
    if (p.state !== 'flee') {
      for (const car of G.solidCars()) {
        if (Math.abs(car.speed) > 120 && dist(p.x, p.y, car.x, car.y) < 62) {
          p.state = 'flee'; p.fleeT = 1.1;
          const a = Math.atan2(p.y - car.y, p.x - car.x);
          p.fleeX = Math.cos(a); p.fleeY = Math.sin(a);
          break;
        }
      }
    }

    if (p.state === 'flee') {
      p.fleeT -= dt;
      const sp = 148;
      const res = G.collideWorld(p.x + p.fleeX * sp * dt, p.y + p.fleeY * sp * dt, 7);
      p.x = res.x; p.y = res.y;
      p.angle = Math.atan2(p.fleeY, p.fleeX);
      if (p.fleeT <= 0) { p.state = 'walk'; snapToBlock(p); }
    } else {
      p.s += p.dir * p.speed * dt;
      placeOnBlock(p);
    }
  }
}

// After fleeing, adopt the nearest block as the new stroll.
function snapToBlock(p) {
  // Keep the same block: project position back onto its perimeter coarsely
  // by restarting the walk at the nearest corner parameter.
  let best = 0, bestD = Infinity;
  for (let s = 0; s < p.per; s += 8) {
    const q = { block: p.block, s, per: p.per, x: 0, y: 0, angle: 0, dir: p.dir };
    placeOnBlock(q);
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  p.s = best;
}

export function hurtPed(G, ped, cause) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.downT = 0;
  G.onPedDown(ped, cause);
}

export function drawPed(ctx, p, time) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.state === 'down') {
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 2, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.shirt; ctx.fillRect(-11, -3.5, 15, 7);
    ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(8, 0, 4.4, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
  // Shadow + legs (simple two-step bob) + body + head.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 6.5, 3.4, 0, 0, TAU); ctx.fill();
  const bob = Math.sin(p.step) * 2.2;
  ctx.fillStyle = '#2e3440';
  ctx.fillRect(-3.4 + bob * 0.4, 0.5, 3, 5.5);
  ctx.fillRect(-0.6 - bob * 0.4, 0.5, 3, 5.5);
  ctx.fillStyle = p.shirt;
  ctx.beginPath(); ctx.arc(0, -1, 5.4, 0, TAU); ctx.fill();
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(0, -2.2, 3.4, 0, TAU); ctx.fill();
  ctx.restore();
  void time;
}
