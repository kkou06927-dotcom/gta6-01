// Solmar Bay Heat — main loop and game state. Rico Marín owes the harbour
// smuggler Ilya Brandt more money than he has. Fixer Dario Fenn has work:
// three jobs, one gold coupe, and a lot of police attention.
//
// This module owns the shared state object G, the player, combat, the
// wanted system, collisions, the camera, saving, the ?demo= screenshot
// scenes, and the frame loop. The other modules each run one system.

import { clamp, angleTo, mulberry32 } from './util.js';
import { Input } from './input.js';
import { createWorld } from './world.js';
import {
  makeCar, spawnTrafficCar, spawnParkedCars, updateTrafficCar,
  drivePlayerCar, drawCar, CAR_COLORS,
} from './vehicles.js';
import { makePed, spawnPeds, spawnFleeingPed, updatePed, hurtPed, scarePeds, drawPed } from './peds.js';
import { updatePolice, updateBust } from './police.js';
import { createMissions, drawContact } from './missions.js';
import { drawHUD, drawStartScreen, drawPause, drawBusted, drawDowned } from './hud.js';

// A tiny roundRect fallback for older canvas implementations.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) {
    this.rect(x, y, w, h);
    return this;
  };
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW_W = 1280;
const VIEW_H = 720;
const SAVE_KEY = 'solmarBayHeatSave';

const G = {
  time: 0,
  state: 'title', // 'title' | 'play' | 'pause' | 'busted' | 'downed'
  rng: mulberry32(20261121),
  world: createWorld(),
  player: null,
  cars: [],
  cops: [],
  peds: [],
  effects: [],
  missions: createMissions(),
  goldCar: null,
  money: 250,
  heat: 0,
  stars: 0,
  lastCrimeAt: -99,
  lastDamageAt: -99,
  bustMeter: 0,
  copSpawnIn: 0,
  fireIn: 0,
  bannerText: '',
  bannerSub: '',
  bannerTtl: 0,
  cam: { x: 1536, y: 1280 },
  nearCar: null,
  ui: {},
  hasSave: false,
  startedRun: false,
  saveIn: 5,
  demo: null,

  playerPos() {
    return this.player.inCar ? this.player.inCar : this.player;
  },
  banner(text, sub = '') {
    this.bannerText = text;
    this.bannerSub = sub;
    this.bannerTtl = 4.4;
  },
  commitCrime(amount) {
    this.heat = Math.min(5.6, this.heat + amount);
    this.lastCrimeAt = this.time;
  },
  setHeatAtLeast(n) {
    if (this.heat < n) this.heat = n;
    this.lastCrimeAt = this.time;
  },
  addMoney(n, x, y) {
    this.money += n;
    this.effects.push({ kind: 'text', x, y, text: `+$${n.toLocaleString('en-US')}`, color: '#7be495', ttl: 1.6, max: 1.6 });
  },
  saveGame() {
    if (!this.startedRun) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.money,
        mi: this.missions.index,
        stage: this.missions.stage,
        done: this.missions.done,
        x: this.player.x,
        y: this.player.y,
        health: this.player.health,
      }));
    } catch (e) {
      // Storage can be unavailable; the game plays on regardless.
    }
  },
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// World population ----------------------------------------------------------

function placeParked(x, y, angle, color) {
  const car = makeCar(x, y, angle, color, 'parked');
  G.cars.push(car);
  return car;
}

function initRun(save) {
  G.cars = [];
  G.cops = [];
  G.peds = [];
  G.effects = [];
  G.heat = 0;
  G.stars = 0;
  G.bustMeter = 0;
  G.money = 250;
  G.missions = createMissions();
  G.player = {
    x: 430, y: 2190, angle: -Math.PI / 2, vx: 0, vy: 0,
    health: 100, inCar: null, phase: 0,
  };
  // The gold coupe waits at Palms Beach Car Park from the very start.
  const spot = G.world.landmarks.carPark;
  G.goldCar = makeCar(spot.x, 2272, 0, '#e8b73a', 'parked');
  G.goldCar.gold = true;
  G.cars.push(G.goldCar);
  spawnParkedCars(G, 24);
  for (let i = 0; i < 15; i++) spawnTrafficCar(G);
  spawnPeds(G, 24);
  if (save) {
    G.money = save.money ?? G.money;
    G.missions.index = save.mi ?? 0;
    G.missions.stage = save.stage ?? 'meet';
    G.missions.done = !!save.done;
    G.player.x = save.x ?? G.player.x;
    G.player.y = save.y ?? G.player.y;
    G.player.health = save.health ?? 100;
  }
  G.startedRun = true;
}

// Demo scenes (also used for the entry's screenshots) -----------------------

function trafficAt(x, y, dir, roadCentre, speed, color = '#7f9fb0') {
  const world = G.world;
  const car = makeCar(x, y, { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 }[dir], color, 'traffic');
  car.dir = dir;
  car.roadCentre = roadCentre;
  car.speed = speed;
  car.cruise = speed;
  G.cars.push(car);
  return car;
}

function copAt(x, y, speed) {
  const cop = makeCar(x, y, 0, '#23272e', 'police');
  cop.speed = speed;
  cop.cruise = 355;
  G.cops.push(cop);
  return cop;
}

function setupDemo(mode) {
  const P = G.player;
  if (mode === 'city') {
    P.x = 1690;
    P.y = 1180;
    trafficAt(1230, 1170, 'E', 1152, 120);
    trafficAt(1750, 1134, 'W', 1152, 110);
    trafficAt(1390, 900, 'S', 1408, 115);
    placeParked(1455, 1120, -Math.PI / 2, '#3f6fb5');
    placeParked(1361, 1120, Math.PI / 2, '#c94f42');
  } else if (mode === 'drive') {
    const car = makeCar(880, 1170, 0, '#3f6fb5', 'parked');
    car.stolen = true;
    G.cars.push(car);
    P.inCar = car;
    car.speed = 215;
    P.x = car.x;
    P.y = car.y;
    trafficAt(1245, 1170, 'E', 1152, 118);
    trafficAt(1560, 1170, 'E', 1152, 126);
    trafficAt(1420, 1134, 'W', 1152, 112);
    trafficAt(700, 1134, 'W', 1152, 108);
  } else if (mode === 'chase') {
    const car = makeCar(1240, 658, 0, '#c94f42', 'parked');
    car.stolen = true;
    G.cars.push(car);
    P.inCar = car;
    car.speed = 265;
    P.x = car.x;
    P.y = car.y;
    G.setHeatAtLeast(3);
    copAt(1035, 658, 300);
    copAt(945, 622, 288);
    copAt(1095, 622, 308);
    G.copSpawnIn = 3;
  } else if (mode === 'mission') {
    G.missions.index = 1;
    G.missions.stage = 'steal';
    P.x = 1852;
    P.y = 2240;
    trafficAt(1560, 2274, 'E', 2256, 105);
    trafficAt(2350, 2238, 'W', 2256, 100);
    const ped1 = makePed(1908, 2306, G.rng);
    ped1.waypoint = { x: 2150, y: 2306 };
    G.peds.push(ped1);
    const ped2 = makePed(2050, 2216, G.rng);
    ped2.waypoint = { x: 1800, y: 2216 };
    G.peds.push(ped2);
  }
}

// Wanted level ---------------------------------------------------------------

function witnessed(x, y, r = 330) {
  for (const cop of G.cops) {
    if (Math.hypot(cop.x - x, cop.y - y) < r + 120) return true;
  }
  for (const ped of G.peds) {
    if (ped.state !== 'down' && Math.hypot(ped.x - x, ped.y - y) < r) return true;
  }
  return false;
}

function updateWanted(dt) {
  G.stars = G.heat <= 0.02 ? 0 : Math.min(5, Math.max(1, Math.round(G.heat)));
  const seen = G.cops.some((cop) => Math.hypot(cop.x - G.playerPos().x, cop.y - G.playerPos().y) < 500);
  if (G.time - G.lastCrimeAt > 6 && !seen && G.heat > 0) {
    G.heat = Math.max(0, G.heat - dt * 0.075);
  }
}

// Player ---------------------------------------------------------------------

function damagePlayer(amount) {
  G.player.health -= amount;
  G.lastDamageAt = G.time;
}

function nearestCar(x, y, maxD) {
  let best = null;
  let bd = maxD;
  const scan = (car) => {
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bd) {
      bd = d;
      best = car;
    }
  };
  G.cars.forEach(scan);
  G.cops.forEach(scan);
  return best;
}

function tryEnterExit() {
  const P = G.player;
  if (P.inCar) {
    const car = P.inCar;
    P.inCar = null;
    const side = car.angle - Math.PI / 2;
    P.x = car.x + Math.cos(side) * 26;
    P.y = car.y + Math.sin(side) * 26;
    const res = G.world.collideCircle(P.x, P.y, 10);
    P.x = res.x;
    P.y = res.y;
    return;
  }
  const car = nearestCar(P.x, P.y, 48);
  if (!car) return;
  const copIndex = G.cops.indexOf(car);
  if (copIndex >= 0) {
    G.cops.splice(copIndex, 1);
    G.cars.push(car);
  }
  if (!car.stolen) {
    car.stolen = true;
    if (car.kind === 'traffic') {
      car.kind = 'parked';
      spawnFleeingPed(G, car.x + 14, car.y, P.x, P.y);
    }
    G.commitCrime(1.0);
    scarePeds(G, car.x, car.y, 130);
  }
  P.inCar = car;
  G.missions.onEnterCar(G, car);
}

function updatePlayer(dt) {
  const P = G.player;
  // Aim at the mouse, in world space.
  const mouseWX = G.cam.x - VIEW_W / 2 + Input.mouse.x;
  const mouseWY = G.cam.y - VIEW_H / 2 + Input.mouse.y;
  if (!P.inCar) {
    P.angle = angleTo(P.x, P.y, mouseWX, mouseWY);
    let mx = 0;
    let my = 0;
    if (Input.down('KeyW', 'ArrowUp')) my -= 1;
    if (Input.down('KeyS', 'ArrowDown')) my += 1;
    if (Input.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (Input.down('KeyD', 'ArrowRight')) mx += 1;
    const len = Math.hypot(mx, my) || 1;
    const run = Input.down('ShiftLeft', 'ShiftRight') ? 252 : 172;
    P.vx = (mx / len) * (mx || my ? run : 0);
    P.vy = (my / len) * (mx || my ? run : 0);
    let nx = P.x + P.vx * dt;
    let ny = P.y + P.vy * dt;
    if (G.world.isWater(nx, ny)) {
      nx = P.x;
      ny = P.y;
    }
    const res = G.world.collideCircle(nx, ny, 10);
    P.x = clamp(res.x, 12, G.world.w - 12);
    P.y = clamp(res.y, 12, G.world.h - 8);
    P.phase += dt * (Math.hypot(P.vx, P.vy) / 11);
  } else {
    const impact = drivePlayerCar(G, P.inCar, dt);
    P.x = P.inCar.x;
    P.y = P.inCar.y;
    P.angle = P.inCar.angle;
    if (impact > 215) {
      damagePlayer((impact - 215) / 13);
      G.shake = Math.min(9, (impact - 215) / 22);
      addSpark(P.inCar.x, P.inCar.y, 10);
      if (impact > 260) G.commitCrime(0.34);
    }
  }
  G.nearCar = P.inCar ? null : nearestCar(P.x, P.y, 48);
  if (Input.wasPressed('KeyE')) tryEnterExit();

  // Health creeps back when things are quiet.
  if (G.heat <= 0.02 && G.time - G.lastDamageAt > 4 && P.health > 0) {
    P.health = Math.min(100, P.health + 3 * dt);
  }
  if (P.health <= 0 && G.state === 'play') {
    G.state = 'downed';
  }
}

// Combat -----------------------------------------------------------------------

function addSpark(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = G.rng() * Math.PI * 2;
    const s = 30 + G.rng() * 90;
    G.effects.push({
      kind: 'spark', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      ttl: 0.32, max: 0.32,
    });
  }
}

function shoot() {
  const P = G.player;
  const ang = P.angle;
  const ox = P.x + Math.cos(ang) * 15;
  const oy = P.y + Math.sin(ang) * 15;
  let bestT = 560;
  let best = null;
  const testCircle = (x, y, r, obj, kind) => {
    const dx = x - ox;
    const dy = y - oy;
    const t = dx * Math.cos(ang) + dy * Math.sin(ang);
    if (t < 4 || t > bestT) return;
    const perp = Math.abs(dx * -Math.sin(ang) + dy * Math.cos(ang));
    if (perp < r + 2) {
      bestT = t;
      best = { obj, kind, x: ox + Math.cos(ang) * t, y: oy + Math.sin(ang) * t };
    }
  };
  for (const ped of G.peds) if (ped.state !== 'down') testCircle(ped.x, ped.y, 9, ped, 'ped');
  for (const car of G.cars) testCircle(car.x, car.y, 20, car, 'car');
  for (const cop of G.cops) testCircle(cop.x, cop.y, 20, cop, 'cop');
  const hx = best ? best.x : ox + Math.cos(ang) * 560;
  const hy = best ? best.y : oy + Math.sin(ang) * 560;
  G.effects.push({ kind: 'tracer', x1: ox, y1: oy, x2: hx, y2: hy, ttl: 0.07, max: 0.07 });
  G.effects.push({ kind: 'flash', x: ox, y: oy, ttl: 0.06, max: 0.06 });
  scarePeds(G, P.x, P.y, 200);
  if (!best) {
    if (witnessed(P.x, P.y)) G.commitCrime(0.5);
    return;
  }
  addSpark(hx, hy, 4);
  if (best.kind === 'ped') {
    const died = hurtPed(G, best.obj, 34);
    G.commitCrime(died ? 1.5 : 0.9);
  } else {
    best.obj.health -= 9;
    if (best.kind === 'cop') G.commitCrime(1.0);
    else if (witnessed(P.x, P.y)) G.commitCrime(0.3);
  }
}

function melee() {
  const P = G.player;
  let hitAny = false;
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    const d = Math.hypot(ped.x - P.x, ped.y - P.y);
    if (d < 44) {
      const died = hurtPed(G, ped, 26);
      ped.x += Math.cos(P.angle) * 12;
      ped.y += Math.sin(P.angle) * 12;
      hitAny = true;
      if (died) G.commitCrime(1.1);
    }
  }
  if (hitAny && witnessed(P.x, P.y)) G.commitCrime(0.34);
  G.effects.push({ kind: 'flash', x: P.x + Math.cos(P.angle) * 22, y: P.y + Math.sin(P.angle) * 22, ttl: 0.08, max: 0.08 });
}

function updateCombat(dt) {
  G.fireIn -= dt;
  if (G.player.inCar) return;
  if (Input.mouse.down && G.fireIn <= 0) {
    shoot();
    G.fireIn = 0.24;
  }
  if (Input.wasPressed('Space')) melee();
}

// Collisions between cars, and cars versus people ------------------------------

function collideCars() {
  const all = [...G.cars, ...G.cops];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = 31;
      if (d === 0 || d >= min) continue;
      const nx = dx / d;
      const ny = dy / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const relSpeed = Math.abs((a.speed - b.speed) * (Math.cos(a.angle) * nx + Math.sin(a.angle) * ny - (Math.cos(b.angle) * nx + Math.sin(b.angle) * ny)));
      const closing = Math.abs(a.speed - b.speed);
      const impact = Math.max(relSpeed, closing * 0.6);
      if (impact > 105) {
        const dmg = (impact - 105) / 13;
        a.health -= dmg;
        b.health -= dmg;
        addSpark((a.x + b.x) / 2, (a.y + b.y) / 2, 6);
        a.speed *= 0.72;
        b.speed *= 0.72;
        const playerInvolved = a === G.player.inCar || b === G.player.inCar;
        if (playerInvolved) {
          if (impact > 185) damagePlayer((impact - 185) / 15);
          if (impact > 150) G.commitCrime(0.34);
          G.shake = Math.min(8, impact / 45);
        }
      }
    }
  }
}

function carsVsPeople() {
  const runners = [...G.cars, ...G.cops];
  for (const car of runners) {
    if (Math.abs(car.speed) < 4) continue;
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      const d = Math.hypot(ped.x - car.x, ped.y - car.y);
      if (d < 21) {
        if (Math.abs(car.speed) > 55) {
          const died = hurtPed(G, ped, Math.abs(car.speed) * 0.85);
          if (car === G.player.inCar) {
            G.commitCrime(died ? 1.6 : 1.1);
            G.shake = Math.min(7, Math.abs(car.speed) / 50);
          }
        } else {
          // A gentle nudge aside.
          const a = Math.atan2(ped.y - car.y, ped.x - car.x);
          ped.x += Math.cos(a) * 3.2;
          ped.y += Math.sin(a) * 3.2;
        }
      }
    }
    // The player, on foot, in the road.
    const P = G.player;
    if (!P.inCar && car !== P.inCar) {
      const d = Math.hypot(P.x - car.x, P.y - car.y);
      if (d < 22 && Math.abs(car.speed) > 60 && car.kind !== 'police') {
        damagePlayer(Math.abs(car.speed) / 11);
        const a = Math.atan2(P.y - car.y, P.x - car.x);
        P.x += Math.cos(a) * 20;
        P.y += Math.sin(a) * 20;
        G.shake = 6;
      }
    }
  }
}

// Frame update -----------------------------------------------------------------

function updateEffects(dt) {
  for (let i = G.effects.length - 1; i >= 0; i--) {
    const e = G.effects[i];
    e.ttl -= dt;
    if (e.kind === 'spark') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
    if (e.kind === 'text') e.y -= 30 * dt;
    if (e.ttl <= 0) G.effects.splice(i, 1);
  }
}

function dismissBusted() {
  G.money = Math.max(0, G.money - 150);
  G.heat = 0;
  G.cops = [];
  G.bustMeter = 0;
  const P = G.player;
  P.inCar = null;
  P.x = G.world.landmarks.police.x;
  P.y = G.world.landmarks.police.y + 26;
  P.health = Math.max(P.health, 55);
  G.state = 'play';
  G.saveGame();
}

function dismissDowned() {
  G.money = Math.max(0, G.money - 200);
  G.heat = 0;
  G.cops = [];
  G.bustMeter = 0;
  const P = G.player;
  P.inCar = null;
  P.x = G.world.landmarks.hospital.x;
  P.y = G.world.landmarks.hospital.y + 26;
  P.health = 100;
  G.state = 'play';
  G.saveGame();
}

function pointInRect(x, y, r) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function update(dt) {
  G.time += dt;
  if (G.bannerTtl > 0) G.bannerTtl -= dt;
  G.shake = Math.max(0, (G.shake || 0) - dt * 14);

  if (G.state === 'title') {
    // A slow pan across downtown behind the title.
    G.cam.x = 1536 + Math.sin(G.time * 0.07) * 340;
    G.cam.y = 1180 + Math.cos(G.time * 0.05) * 160;
    for (const car of G.cars) if (car.kind === 'traffic') updateTrafficCar(G, car, dt);
    for (const ped of G.peds) updatePed(G, ped, dt);
    if (Input.mouse.clicked) {
      if (pointInRect(Input.mouse.x, Input.mouse.y, G.ui.newBtn)) {
        initRun(null);
        G.state = 'play';
      } else if (pointInRect(Input.mouse.x, Input.mouse.y, G.ui.contBtn)) {
        initRun(loadSave());
        G.state = 'play';
      }
    }
    if (Input.wasPressed('Enter')) {
      initRun(null);
      G.state = 'play';
    } else if (Input.wasPressed('KeyC') && G.hasSave) {
      initRun(loadSave());
      G.state = 'play';
    }
    return;
  }

  if (G.state === 'pause') {
    if (Input.wasPressed('KeyP', 'Escape')) G.state = 'play';
    return;
  }
  if (G.state === 'busted') {
    if (Input.mouse.clicked || Input.wasPressed('Enter')) dismissBusted();
    return;
  }
  if (G.state === 'downed') {
    if (Input.mouse.clicked || Input.wasPressed('Enter')) dismissDowned();
    return;
  }

  // state === 'play'
  if (Input.wasPressed('KeyP', 'Escape')) {
    G.state = 'pause';
    return;
  }
  updatePlayer(dt);
  updateCombat(dt);
  for (const car of G.cars) {
    if (car.kind === 'traffic' && car !== G.player.inCar) updateTrafficCar(G, car, dt);
  }
  updatePolice(G, dt);
  for (const ped of G.peds) updatePed(G, ped, dt);
  collideCars();
  carsVsPeople();
  G.missions.update(G);
  updateWanted(dt);
  if (updateBust(G, dt)) {
    G.state = 'busted';
  }
  updateEffects(dt);

  // Camera follows whoever Rico is right now.
  const p = G.playerPos();
  G.cam.x += (p.x - G.cam.x) * Math.min(1, dt * 5);
  G.cam.y += (p.y - G.cam.y) * Math.min(1, dt * 5);
  G.cam.x = clamp(G.cam.x, VIEW_W / 2, G.world.w - VIEW_W / 2);
  G.cam.y = clamp(G.cam.y, VIEW_H / 2, G.world.h - VIEW_H / 2);

  G.saveIn -= dt;
  if (G.saveIn <= 0) {
    G.saveGame();
    G.saveIn = 6;
  }
}

// Rendering ----------------------------------------------------------------------

function drawMarker(c) {
  const mk = G.missions.marker(G);
  if (!mk) return;
  const pulse = 0.75 + Math.sin(G.time * 4.5) * 0.25;
  c.save();
  c.translate(mk.x, mk.y);
  const grad = c.createLinearGradient(0, -190, 0, 0);
  grad.addColorStop(0, 'rgba(255,201,62,0)');
  grad.addColorStop(1, `rgba(255,201,62,${0.5 * pulse})`);
  c.fillStyle = grad;
  c.fillRect(-13, -190, 26, 190);
  c.strokeStyle = `rgba(255,201,62,${pulse})`;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(0, 0, 26 + Math.sin(G.time * 4.5) * 4, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#ffc93e';
  c.font = 'bold 13px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(mk.label.toUpperCase(), 0, -196);
  c.restore();

  // Off-screen direction arrow.
  const p = G.playerPos();
  const sx = mk.x - G.cam.x + VIEW_W / 2;
  const sy = mk.y - G.cam.y + VIEW_H / 2;
  if (sx < -30 || sx > VIEW_W + 30 || sy < -30 || sy > VIEW_H + 30) {
    const a = Math.atan2(mk.y - p.y, mk.x - p.x);
    const ax = clamp(sx, 44, VIEW_W - 44);
    const ay = clamp(sy, 90, VIEW_H - 60);
    c.save();
    c.translate(ax, ay);
    c.rotate(a);
    c.fillStyle = 'rgba(255,201,62,0.92)';
    c.beginPath();
    c.moveTo(15, 0);
    c.lineTo(-9, -9);
    c.lineTo(-9, 9);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = '#ffffff';
    c.font = 'bold 11.5px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(`${Math.round(Math.hypot(mk.x - p.x, mk.y - p.y))}m`, ax, ay + 26);
    c.textAlign = 'left';
  }
}

function drawPlayer(c) {
  const P = G.player;
  c.save();
  c.translate(P.x, P.y);
  const bob = Math.sin(P.phase) * 1.2;
  c.fillStyle = 'rgba(40,30,20,0.28)';
  c.beginPath();
  c.ellipse(0, 4, 8, 3.8, 0, 0, Math.PI * 2);
  c.fill();
  c.rotate(P.angle);
  // Arms and the pistol line, pointing at the mouse.
  c.strokeStyle = '#1f8a80';
  c.lineWidth = 3.4;
  c.beginPath();
  c.moveTo(2, -4);
  c.lineTo(11, -2);
  c.moveTo(2, 4);
  c.lineTo(11, 2);
  c.stroke();
  c.fillStyle = '#22242a';
  c.fillRect(10, -1.6, 8, 3.2);
  c.rotate(-P.angle);
  c.fillStyle = '#2ec4b6';
  c.beginPath();
  c.arc(0, bob * 0.3, 7, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e0ac69';
  c.beginPath();
  c.arc(0, -1 + bob * 0.3, 4.2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.arc(0, 0, 10.5, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

function drawEffects(c) {
  for (const e of G.effects) {
    const a = clamp(e.ttl / e.max, 0, 1);
    if (e.kind === 'tracer') {
      c.strokeStyle = `rgba(255,230,150,${a})`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(e.x1, e.y1);
      c.lineTo(e.x2, e.y2);
      c.stroke();
    } else if (e.kind === 'flash') {
      c.fillStyle = `rgba(255,210,90,${a * 0.9})`;
      c.beginPath();
      c.arc(e.x, e.y, 7 * a + 2, 0, Math.PI * 2);
      c.fill();
    } else if (e.kind === 'spark') {
      c.fillStyle = `rgba(255,180,80,${a})`;
      c.fillRect(e.x - 1.6, e.y - 1.6, 3.2, 3.2);
    } else if (e.kind === 'text') {
      c.globalAlpha = a;
      c.fillStyle = e.color;
      c.font = 'bold 17px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(e.text, e.x, e.y);
      c.globalAlpha = 1;
      c.textAlign = 'left';
    }
  }
}

function render() {
  ctx.fillStyle = '#1a567c';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const shakeX = G.shake ? (G.rng() - 0.5) * G.shake : 0;
  const shakeY = G.shake ? (G.rng() - 0.5) * G.shake : 0;
  const ox = G.cam.x - VIEW_W / 2 + shakeX;
  const oy = G.cam.y - VIEW_H / 2 + shakeY;
  ctx.save();
  ctx.translate(-ox, -oy);
  ctx.drawImage(G.world.staticCanvas, 0, 0);
  if (G.state !== 'title') drawMarker(ctx);
  drawContact(ctx, G);
  for (const car of G.cars) drawCar(ctx, car, G.time);
  for (const cop of G.cops) drawCar(ctx, cop, G.time);
  for (const ped of G.peds) drawPed(ctx, ped);
  if (!G.player.inCar && G.state !== 'title') drawPlayer(ctx);
  drawEffects(ctx);
  ctx.restore();

  if (G.state === 'title') {
    drawStartScreen(ctx, G);
  } else {
    drawHUD(ctx, G);
    if (G.state === 'pause') drawPause(ctx);
    else if (G.state === 'busted') drawBusted(ctx, G);
    else if (G.state === 'downed') drawDowned(ctx, G);
  }
}

// Boot -----------------------------------------------------------------------------

Input.attach(canvas);
G.hasSave = !!loadSave();
initRun(null);

const params = new URLSearchParams(window.location.search);
const demo = params.get('demo');
if (demo && ['city', 'drive', 'chase', 'mission'].includes(demo)) {
  G.demo = demo;
  setupDemo(demo);
  const p = G.playerPos();
  G.cam.x = clamp(p.x, VIEW_W / 2, G.world.w - VIEW_W / 2);
  G.cam.y = clamp(p.y, VIEW_H / 2, G.world.h - VIEW_H / 2);
  G.state = 'play';
}

const status = document.getElementById('status');
if (status) status.textContent = 'Solmar Bay Heat loaded';

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
