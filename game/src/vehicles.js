// vehicles.js — cars: AI traffic on the road graph, parked cars, the
// player-driven car physics, and car rendering.

import { clamp, dist, pick, randRange } from './util.js';
import { intersections, nextIntersections, isOnRoad } from './world.js';

export const CAR_COLORS = ['#c94f42', '#4a7fb5', '#63a05a', '#d9d3c8', '#8a8f98', '#e0a458', '#7a5fa0', '#3f8f8a', '#b5658f', '#565d66'];
const LANE = 14; // right-hand lane offset from road centre

export function makeCar(x, y, angle, color, kind = 'civ') {
  return {
    x, y, angle, speed: 0, color, kind,
    health: 100, route: null, cruise: 150, dead: false, honk: 0,
  };
}

// --- Traffic ---

function newLeg(rng, from, avoid) {
  const options = nextIntersections(from.x, from.y).filter(
    (p) => !avoid || p.x !== avoid.x || p.y !== avoid.y,
  );
  const to = options.length ? pick(rng, options) : avoid ?? { x: from.x, y: from.y };
  const len = dist(from.x, from.y, to.x, to.y);
  return { ax: from.x, ay: from.y, bx: to.x, by: to.y, s: 0, len };
}

export function spawnTraffic(world, rng, n) {
  const pts = intersections();
  const cars = [];
  for (let i = 0; i < n; i++) {
    const start = pick(rng, pts);
    const car = makeCar(start.x, start.y, 0, pick(rng, CAR_COLORS), 'civ');
    car.cruise = randRange(rng, 125, 175);
    car.route = newLeg(rng, start, null);
    car.route.s = rng() * car.route.len * 0.9;
    placeOnRoute(car);
    cars.push(car);
  }
  return cars;
}

// Teleport a traffic car onto a specific leg (used to stage demo scenes).
export function setRoute(car, ax, ay, bx, by, s = 0) {
  car.route = { ax, ay, bx, by, s, len: dist(ax, ay, bx, by) };
  placeOnRoute(car);
}

function placeOnRoute(car) {
  const r = car.route;
  const dx = (r.bx - r.ax) / r.len, dy = (r.by - r.ay) / r.len;
  car.x = r.ax + dx * r.s - dy * LANE; // right-hand side: right vector is (-dy, dx)
  car.y = r.ay + dy * r.s + dx * LANE;
  car.angle = Math.atan2(dy, dx);
}

export function updateTraffic(G, dt) {
  const rng = G.rng;
  for (const car of G.traffic) {
    if (car.dead) continue;
    const r = car.route;
    const dx = (r.bx - r.ax) / r.len, dy = (r.by - r.ay) / r.len;
    // Slow for anything solid ahead in our lane.
    let desired = car.cruise;
    const aheadX = car.x + dx * 42, aheadY = car.y + dy * 42;
    for (const other of G.solidCars()) {
      if (other === car) continue;
      const gap = dist(aheadX, aheadY, other.x, other.y);
      if (gap < 34) desired = Math.min(desired, Math.max(0, (gap - 18) / 16) * car.cruise);
    }
    car.speed += clamp(desired - car.speed, -260 * dt, 130 * dt);
    r.s += car.speed * dt;
    if (r.s >= r.len) {
      const arrived = { x: r.bx, y: r.by };
      const cameFrom = { x: r.ax, y: r.ay };
      car.route = newLeg(rng, arrived, cameFrom);
    }
    placeOnRoute(car);
  }
}

// --- Parked cars ---

export function spawnParked(world, rng) {
  const cars = [];
  for (const spot of world.parkingSpots) {
    if (rng() < 0.38) continue; // leave some bays empty
    const car = makeCar(spot.x, spot.y, spot.angle + (rng() < 0.12 ? Math.PI : 0), pick(rng, CAR_COLORS), 'civ');
    cars.push(car);
  }
  return cars;
}

// --- Player driving ---

const MAX_F = 350, MAX_R = -130;

export function driveCar(G, car, dt) {
  const input = G.input;
  const up = input.down('KeyW', 'ArrowUp');
  const down = input.down('KeyS', 'ArrowDown');
  const steer = (input.down('KeyA', 'ArrowLeft') ? -1 : 0) + (input.down('KeyD', 'ArrowRight') ? 1 : 0);
  const offroad = !isOnRoad(car.x, car.y) && !G.world.lots.some((l) => car.x > l.x && car.x < l.x + l.w && car.y > l.y && car.y < l.y + l.h);
  const topSpeed = offroad ? MAX_F * 0.5 : MAX_F;

  if (up) car.speed += (car.speed < 0 ? 420 : 290) * dt;
  else if (down) car.speed -= (car.speed > 10 ? 400 : 180) * dt;
  else car.speed -= car.speed * 0.7 * dt; // engine braking / drag
  if (Math.abs(car.speed) < 4 && !up && !down) car.speed = 0;
  car.speed = clamp(car.speed, MAX_R, topSpeed + 40);
  if (car.speed > topSpeed) car.speed = Math.max(topSpeed, car.speed - 200 * dt);

  const grip = clamp(Math.abs(car.speed) / 80, 0, 1) * Math.sign(car.speed);
  car.angle += steer * 1.85 * grip * dt;

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const res = G.collideWorld(nx, ny, 17);
  if (res.hit) {
    const impact = Math.abs(car.speed);
    if (impact > 110) {
      G.onCarCrash(car, impact);
      car.speed = -car.speed * 0.25;
    } else {
      car.speed = 0;
    }
    car.x = res.x; car.y = res.y;
  } else {
    car.x = nx; car.y = ny;
  }
  if (offroad && Math.abs(car.speed) > 40 && Math.random() < dt * 2) G.dust(car.x, car.y);
}

// --- Queries / drawing ---

export function nearestCar(cars, x, y, maxD) {
  let best = null, bestD = maxD;
  for (const car of cars) {
    if (car.dead) continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export function drawCar(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-17, -6, 38, 19);
  // Wheels
  ctx.fillStyle = '#17181c';
  ctx.fillRect(-13, -11, 9, 4); ctx.fillRect(6, -11, 9, 4);
  ctx.fillRect(-13, 7, 9, 4); ctx.fillRect(6, 7, 9, 4);
  // Body
  ctx.fillStyle = car.kind === 'police' ? '#e9ebee' : car.color;
  roundRect(ctx, -19, -9.5, 38, 19, 5); ctx.fill();
  if (car.kind === 'police') {
    ctx.fillStyle = '#23262b';
    ctx.fillRect(-6, -9.5, 13, 19); // black doors band
    ctx.fillStyle = '#274b73';
    ctx.fillRect(-19, -9.5, 6, 19); ctx.fillRect(13, -9.5, 6, 19);
  }
  if (car.kind === 'gold') {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-19, -3, 38, 3); // showroom shine
  }
  // Cabin + glass
  ctx.fillStyle = '#1d2733';
  roundRect(ctx, -8, -7.5, 15, 15, 3); ctx.fill();
  ctx.fillStyle = 'rgba(160,210,240,0.5)';
  ctx.fillRect(4, -6.5, 3, 13);
  // Headlights / taillights
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(17.5, -7, 2.5, 4); ctx.fillRect(17.5, 3, 2.5, 4);
  ctx.fillStyle = '#c23b2e';
  ctx.fillRect(-20, -7, 2.5, 4); ctx.fillRect(-20, 3, 2.5, 4);
  // Police light bar
  if (car.kind === 'police') {
    const phase = Math.floor(time * 5) % 2 === 0;
    ctx.fillStyle = phase ? '#ff4040' : '#7a1616';
    ctx.fillRect(-3, -6, 6, 5);
    ctx.fillStyle = phase ? '#2a2a66' : '#4d7dff';
    ctx.fillRect(-3, 1, 6, 5);
  }
  // Damage
  if (car.health < 45) {
    ctx.fillStyle = `rgba(30,30,30,${0.25 + (45 - car.health) / 90})`;
    roundRect(ctx, -19, -9.5, 38, 19, 5); ctx.fill();
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
