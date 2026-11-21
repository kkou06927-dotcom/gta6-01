// Pedestrians: Solmar Bay residents strolling the sidewalks. They walk the
// pavement network corner to corner, flee from gunfire and fast cars, fight
// back if punched, and go down when hurt badly.

import { clamp, angleTo, turnToward, pick } from './util.js';

const SHIRTS = ['#d95f4b', '#4b7fd9', '#f2f2f2', '#57a773', '#e9c46a', '#9b5de5', '#ef8354', '#6fb3b8'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

export function makePed(x, y, rng) {
  return {
    x, y,
    angle: rng() * Math.PI * 2,
    speed: 0,
    walkSpeed: 52 + rng() * 30,
    health: 100,
    state: 'walk', // 'walk' | 'flee' | 'down'
    shirt: pick(rng, SHIRTS),
    skin: pick(rng, SKIN),
    waypoint: null,
    fleeFrom: null,
    fleeFor: 0,
    downFor: 0,
    phase: rng() * Math.PI * 2,
  };
}

// A point on a sidewalk: just off a road, along a random block edge.
function sidewalkPoint(G) {
  const world = G.world;
  const rng = G.rng;
  const vertical = rng() < 0.5;
  if (vertical) {
    const road = pick(rng, world.vRoads);
    const side = rng() < 0.5 ? -1 : 1;
    return { x: road + side * 46, y: 60 + rng() * 2150 };
  }
  const road = pick(rng, world.hAll);
  const side = rng() < 0.5 ? -1 : 1;
  return { x: 60 + rng() * (world.w - 120), y: road + side * 46 };
}

export function spawnPeds(G, count) {
  for (let i = 0; i < count; i++) {
    const p = sidewalkPoint(G);
    const ped = makePed(p.x, p.y, G.rng);
    ped.waypoint = sidewalkPoint(G);
    G.peds.push(ped);
  }
}

export function spawnFleeingPed(G, x, y, fromX, fromY) {
  const ped = makePed(x, y, G.rng);
  ped.state = 'flee';
  ped.fleeFrom = { x: fromX, y: fromY };
  ped.fleeFor = 3;
  G.peds.push(ped);
  return ped;
}

export function updatePed(G, ped, dt) {
  if (ped.state === 'down') {
    ped.downFor += dt;
    return;
  }
  let tx;
  let ty;
  let speed = ped.walkSpeed;
  if (ped.state === 'flee') {
    ped.fleeFor -= dt;
    if (ped.fleeFor <= 0 || !ped.fleeFrom) {
      ped.state = 'walk';
      ped.waypoint = sidewalkPoint(G);
    } else {
      const away = Math.atan2(ped.y - ped.fleeFrom.y, ped.x - ped.fleeFrom.x);
      tx = ped.x + Math.cos(away) * 120;
      ty = ped.y + Math.sin(away) * 120;
      speed = 158;
    }
  }
  if (ped.state === 'walk') {
    if (!ped.waypoint || Math.hypot(ped.waypoint.x - ped.x, ped.waypoint.y - ped.y) < 12) {
      ped.waypoint = sidewalkPoint(G);
    }
    tx = ped.waypoint.x;
    ty = ped.waypoint.y;
  }
  const desired = angleTo(ped.x, ped.y, tx, ty);
  ped.angle = turnToward(ped.angle, desired, 6 * dt);
  ped.speed = speed;
  let nx = ped.x + Math.cos(ped.angle) * speed * dt;
  let ny = ped.y + Math.sin(ped.angle) * speed * dt;
  if (G.world.isWater(nx, ny)) {
    ped.angle += Math.PI * dt * 2;
    nx = ped.x;
    ny = ped.y;
  }
  const res = G.world.collideCircle(nx, ny, 8);
  ped.x = clamp(res.x, 10, G.world.w - 10);
  ped.y = clamp(res.y, 10, G.world.h - 6);
  ped.phase += dt * (speed / 9);
}

// Hurt a pedestrian. Returns true when this blow puts them down.
export function hurtPed(G, ped, dmg) {
  if (ped.state === 'down') return false;
  ped.health -= dmg;
  if (ped.health <= 0) {
    ped.state = 'down';
    ped.downFor = 0;
    ped.speed = 0;
    return true;
  }
  ped.state = 'flee';
  ped.fleeFrom = { x: G.player.x, y: G.player.y };
  ped.fleeFor = 2.5;
  return false;
}

// Nearby pedestrians panic and run from a scare at (x, y).
export function scarePeds(G, x, y, radius) {
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    if (Math.hypot(ped.x - x, ped.y - y) < radius) {
      ped.state = 'flee';
      ped.fleeFrom = { x, y };
      ped.fleeFor = 2 + G.rng() * 1.5;
    }
  }
}

export function drawPed(c, ped) {
  c.save();
  c.translate(ped.x, ped.y);
  if (ped.state === 'down') {
    c.rotate(ped.angle);
    c.fillStyle = 'rgba(40,30,20,0.25)';
    c.beginPath();
    c.ellipse(0, 2, 13, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ped.shirt;
    c.beginPath();
    c.ellipse(0, 0, 12, 5, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ped.skin;
    c.beginPath();
    c.arc(13, 0, 4, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  const bob = Math.sin(ped.phase) * 1.3;
  c.fillStyle = 'rgba(40,30,20,0.25)';
  c.beginPath();
  c.ellipse(0, 3, 7, 3.4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ped.shirt;
  c.beginPath();
  c.arc(0, bob * 0.3, 6, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ped.skin;
  c.beginPath();
  c.arc(0, -1 + bob * 0.3, 3.6, 0, Math.PI * 2);
  c.fill();
  // A little direction tick so movement reads at a glance.
  c.strokeStyle = ped.shirt;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(Math.cos(ped.angle) * 7, Math.sin(ped.angle) * 7);
  c.stroke();
  c.restore();
}
