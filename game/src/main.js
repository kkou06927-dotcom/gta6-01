// main.js — Solmar Bay Heat: boot, the game loop, and all the glue.
// Player control (on foot and driving), combat, wanted heat, collisions,
// busted/downed flow, saving, and the ?demo= staging hooks.

import { Input } from './input.js';
import { createWorld, collide, WORLD_W, WORLD_H } from './world.js';
import { spawnTraffic, updateTraffic, spawnParked, driveCar, drawCar, nearestCar, makeCar, setRoute } from './vehicles.js';
import { spawnPeds, updatePeds, drawPed, hurtPed } from './peds.js';
import { updatePolice, updateBust } from './police.js';
import { createMissions, updateMissions } from './missions.js';
import { drawHUD, drawObjectiveMarker, drawStartScreen, drawPause, drawEndScreen } from './hud.js';
import { mulberry32, clamp, dist, angDiff, TAU } from './util.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW_W = canvas.width, VIEW_H = canvas.height;
const SAVE_KEY = 'solmar-bay-heat-save-v1';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 20261121;
const demo = params.get('demo');

const world = createWorld(seed);

// ---------------------------------------------------------------- state
const G = {
  world,
  rng: mulberry32(seed),
  input: new Input(canvas),
  state: 'title', // title | play | pause | end
  time: 0,
  cam: { x: 0, y: 0 },
  traffic: [], parked: [], police: [], peds: [],
  goldCar: null,
  player: { x: 500, y: 1100, face: 0, hp: 100, cash: 120, car: null },
  missions: createMissions(),
  debtPaid: 0,
  heat: 0, stars: 0, bust: 0,
  policeTimer: 0, ramCd: 0, fireCd: 0, lastHurt: -99,
  threat: null, banner: null, hint: '',
  endKind: null, endInfo: '', endTimer: 0,
  particles: [], tracers: [],
  ui: {}, hasSave: false,
  playerPos() { const p = this.player; return p.car ? { x: p.car.x, y: p.car.y } : { x: p.x, y: p.y }; },
  solidCars() {
    const all = [...this.traffic, ...this.parked, ...this.police];
    if (this.player.car) all.push(this.player.car);
    return all;
  },
  collideWorld(x, y, r) { return collide(world, x, y, r); },
  addHeat(n) { this.heat = Math.min(620, this.heat + n); },
  setHeatAtLeast(stars) { this.heat = Math.max(this.heat, (stars - 1) * 120 + 1); },
  onPedDown(ped, cause) {
    if (cause !== 'npc') { this.addHeat(105); this.setThreat(ped.x, ped.y); }
  },
  onCarCrash(car, impact) {
    car.health = Math.max(car.kind === 'gold' ? 14 : 4, car.health - impact * 0.11);
    burst(car.x, car.y, 7, '#ffb03a', 130);
    if (car === this.player.car) {
      this.player.hp -= impact * 0.045;
      this.lastHurt = this.time;
    }
  },
  setThreat(x, y) { this.threat = { x, y, t: 1.6 }; },
  dust(x, y) { puff(x, y, '#c9b489'); },
};

function burst(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = G.rng() * TAU, s = speed * (0.3 + G.rng() * 0.7);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.32 + G.rng() * 0.25, color, size: 2.4 });
  }
}
function puff(x, y, color) {
  G.particles.push({ x, y, vx: (G.rng() - 0.5) * 22, vy: -14 - G.rng() * 18, t: 0, life: 0.7, color, size: 5 });
}

// ---------------------------------------------------------------- setup
function setupRun(save) {
  G.rng = mulberry32(seed);
  G.traffic = spawnTraffic(world, G.rng, 15);
  G.parked = spawnParked(world, G.rng);
  for (const c of G.parked) { c.vx = 0; c.vy = 0; }
  G.peds = spawnPeds(world, G.rng, 26);
  G.police = [];
  const gs = world.pois.goldSpot;
  G.goldCar = makeCar(gs.x, gs.y, gs.angle, '#f5c542', 'gold');
  G.goldCar.vx = 0; G.goldCar.vy = 0;
  G.parked.push(G.goldCar);
  G.missions = createMissions();
  G.debtPaid = 0;
  G.heat = 0; G.stars = 0; G.bust = 0; G.threat = null; G.banner = null;
  G.particles = []; G.tracers = [];
  const p = G.player;
  p.car = null; p.hp = 100; p.cash = 120;
  p.x = world.pois.garage.respawn.x; p.y = world.pois.garage.respawn.y; p.face = -Math.PI / 2;
  if (save) {
    p.cash = save.cash; G.debtPaid = save.debtPaid;
    G.missions.index = save.mi; G.missions.done = !!save.done;
    if (typeof save.x === 'number') { p.x = save.x; p.y = save.y; }
  }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave() {
  const p = G.player, pp = G.playerPos();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: Math.floor(p.cash), debtPaid: G.debtPaid,
      mi: G.missions.index, done: G.missions.done, x: pp.x, y: pp.y,
    }));
    G.hasSave = true;
  } catch { /* storage unavailable: play on without saving */ }
}
G.hasSave = !!readSave();

function startGame(save) {
  setupRun(save);
  G.state = 'play';
}

// ---------------------------------------------------------------- demos
function stageDemo(name) {
  setupRun(null);
  G.state = 'play';
  const p = G.player;
  const giveCar = (x, y, angle, speed) => {
    const car = makeCar(x, y, angle, '#c94f42', 'civ');
    car.speed = speed;
    p.car = car; p.x = x; p.y = y;
    return car;
  };
  if (name === 'city') {
    p.x = 1452; p.y = 1168; p.face = -Math.PI / 2;
    setRoute(G.traffic[0], 1100, 1100, 1500, 1100, 210);
    setRoute(G.traffic[1], 1900, 1100, 1500, 1100, 160);
    setRoute(G.traffic[2], 1500, 700, 1500, 1100, 190);
    setRoute(G.traffic[3], 1100, 1500, 1500, 1500, 260);
  } else if (name === 'drive' || name === 'chase') {
    giveCar(1240, 1114, 0, name === 'chase' ? 235 : 185);
    setRoute(G.traffic[0], 1500, 1100, 1900, 1100, 130);
    setRoute(G.traffic[1], 1900, 1100, 1500, 1100, 210);
    setRoute(G.traffic[2], 1500, 1500, 1500, 1100, 120);
    if (name === 'chase') {
      G.setHeatAtLeast(3); G.heat = 300;
      const spots = [[1020, 1114, 0], [1120, 1086, 0], [900, 1100, 0.2]];
      for (const [x, y, a] of spots) {
        const cop = makeCar(x, y, a, '#e9ebee', 'police');
        cop.speed = 215; cop.rev = 0;
        G.police.push(cop);
      }
    }
  } else if (name === 'mission') {
    const car = giveCar(2760, 1990, Math.PI / 4, 65);
    car.color = '#4a7fb5';
    G.missions.started = false;
  }
}

// ---------------------------------------------------------------- combat
function shoot() {
  const p = G.player;
  const m = G.input.mouse;
  const wx = m.x + G.cam.x, wy = m.y + G.cam.y;
  const a = Math.atan2(wy - p.y, wx - p.x);
  p.face = a;
  const RANGE = 430;
  const ex = p.x + Math.cos(a) * RANGE, ey = p.y + Math.sin(a) * RANGE;
  let bestT = Infinity, hitPed = null, hitCar = null;
  const testCircle = (cx, cy, r, isPed, obj) => {
    const dx = ex - p.x, dy = ey - p.y;
    const t = ((cx - p.x) * dx + (cy - p.y) * dy) / (RANGE * RANGE);
    if (t < 0 || t > 1) return;
    const px = p.x + dx * t, py = p.y + dy * t;
    if (dist(cx, cy, px, py) < r && t < bestT) {
      bestT = t;
      if (isPed) { hitPed = obj; hitCar = null; } else { hitCar = obj; hitPed = null; }
    }
  };
  for (const ped of G.peds) if (ped.state !== 'down') testCircle(ped.x, ped.y, 9, true, ped);
  for (const car of G.solidCars()) testCircle(car.x, car.y, 19, false, car);
  const hx = bestT === Infinity ? ex : p.x + (ex - p.x) * bestT;
  const hy = bestT === Infinity ? ey : p.y + (ey - p.y) * bestT;
  G.tracers.push({ x1: p.x + Math.cos(a) * 12, y1: p.y + Math.sin(a) * 12, x2: hx, y2: hy, t: 0 });
  burst(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, 2, '#ffe9a8', 40);
  if (hitPed) hurtPed(G, hitPed, 'shot');
  else if (hitCar) {
    hitCar.health = Math.max(hitCar.kind === 'gold' ? 14 : 4, hitCar.health - 9);
    burst(hx, hy, 5, '#ffb03a', 110);
    if (hitCar.kind === 'police') G.addHeat(35);
    G.setThreat(p.x, p.y);
  } else G.setThreat(p.x, p.y);
  G.addHeat(14);
  G.fireCd = 0.17;
}

function punch() {
  const p = G.player;
  let struck = false;
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    if (dist(p.x, p.y, ped.x, ped.y) < 38 && Math.abs(angDiff(p.face, Math.atan2(ped.y - p.y, ped.x - p.x))) < 1.2) {
      hurtPed(G, ped, 'punch');
      struck = true;
    }
  }
  if (!struck) {
    const car = nearestCar(G.solidCars(), p.x, p.y, 34);
    if (car) { car.health = Math.max(4, car.health - 3); burst(car.x, car.y, 3, '#ffd968', 70); G.addHeat(16); }
  }
  G.fireCd = 0.3;
}

// ---------------------------------------------------------------- cars
function enterCar(car) {
  const p = G.player;
  const from = (list) => { const i = list.indexOf(car); if (i >= 0) list.splice(i, 1); };
  const wasTraffic = G.traffic.includes(car);
  from(G.traffic); from(G.parked); from(G.police);
  if (wasTraffic) {
    // The driver bails out and runs.
    const bail = {
      block: { x: car.x - 30, y: car.y - 30, w: 60, h: 60 }, s: 0, per: 240, dir: 1,
      speed: 50, x: car.x + 14, y: car.y + 10, angle: 0,
      skin: '#e8b48c', shirt: '#4b7fd9', state: 'flee', fleeT: 1.8,
      fleeX: Math.cos(car.angle + Math.PI / 2), fleeY: Math.sin(car.angle + Math.PI / 2),
      downT: 0, step: 0,
    };
    G.peds.push(bail);
  }
  car.speed = 0;
  p.car = car;
  G.addHeat(125); // grand theft auto, Solmar style
  G.setThreat(car.x, car.y);
  if (car === G.goldCar) G.banner = { title: 'Golden Hour', sub: 'You have the coupe — get it to Fenn\'s Garage!', t: 2.6, total: 2.6 };
}

function exitCar() {
  const p = G.player;
  const car = p.car;
  if (!car) return;
  car.speed = 0;
  if (!G.parked.includes(car)) { car.vx = 0; car.vy = 0; G.parked.push(car); }
  const side = car.angle + Math.PI / 2;
  const res = G.collideWorld(car.x + Math.cos(side) * 26, car.y + Math.sin(side) * 26, 8);
  p.x = res.x; p.y = res.y;
  p.car = null;
}

function resetGoldCar() {
  const gs = world.pois.goldSpot;
  const car = G.goldCar;
  const from = (list) => { const i = list.indexOf(car); if (i >= 0) list.splice(i, 1); };
  from(G.traffic); from(G.police);
  if (G.player.car === car) G.player.car = null;
  car.x = gs.x; car.y = gs.y; car.angle = gs.angle; car.speed = 0; car.health = 100; car.vx = 0; car.vy = 0;
  if (!G.parked.includes(car)) G.parked.push(car);
}

// Parked cars can be shunted around by impacts.
function updateParked(dt) {
  for (const car of G.parked) {
    if (!car.vx && !car.vy) continue;
    const res = G.collideWorld(car.x + car.vx * dt, car.y + car.vy * dt, 17);
    car.x = res.x; car.y = res.y;
    const f = Math.max(0, 1 - 3.4 * dt);
    car.vx *= f; car.vy *= f;
    if (Math.abs(car.vx) < 2) car.vx = 0;
    if (Math.abs(car.vy) < 2) car.vy = 0;
  }
}

function vehicleCollisions() {
  const p = G.player;
  if (!p.car) return;
  const mine = p.car;
  const impact = Math.abs(mine.speed);
  for (const other of [...G.traffic, ...G.parked, ...G.police]) {
    const d = dist(mine.x, mine.y, other.x, other.y);
    if (d >= 34 || d === 0) continue;
    const nx = (mine.x - other.x) / d, ny = (mine.y - other.y) / d;
    if (other.kind === 'civ' && G.parked.includes(other)) {
      other.vx = (other.vx || 0) - nx * impact * 0.55;
      other.vy = (other.vy || 0) - ny * impact * 0.55;
      other.angle += (G.rng() - 0.5) * 0.2;
      if (impact > 120) { G.onCarCrash(other, impact * 0.7); G.onCarCrash(mine, impact * 0.8); }
      mine.speed *= 0.55;
    } else if (G.police.includes(other)) {
      other.x -= nx * (34 - d) / 2; other.y -= ny * (34 - d) / 2;
      mine.x += nx * (34 - d) / 2; mine.y += ny * (34 - d) / 2;
      if (impact > 90) {
        G.onCarCrash(other, impact * 0.6); G.onCarCrash(mine, impact * 0.9);
        if (G.ramCd <= 0) { G.addHeat(30); G.ramCd = 1; }
      }
      mine.speed *= 0.45;
      other.speed *= 0.5;
    } else { // traffic: on rails, the player bounces off
      mine.x += nx * (34 - d); mine.y += ny * (34 - d);
      if (impact > 100) { G.onCarCrash(other, impact * 0.5); G.onCarCrash(mine, impact); G.addHeat(18); G.setThreat(mine.x, mine.y); }
      mine.speed = -mine.speed * 0.22;
    }
  }
}

function pedCarCollisions() {
  const cars = G.solidCars();
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    for (const car of cars) {
      const spd = car === G.player.car || G.police.includes(car) || G.traffic.includes(car)
        ? Math.abs(car.speed) : Math.hypot(car.vx || 0, car.vy || 0);
      if (spd < 45) continue;
      if (dist(ped.x, ped.y, car.x, car.y) < 17) {
        hurtPed(G, ped, car === G.player.car ? 'car' : 'npc');
        if (car === G.player.car) { G.onCarCrash(car, 60); car.speed *= 0.7; }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- flow
function endRun(kind) {
  const p = G.player;
  G.state = 'end';
  G.endKind = kind;
  G.endTimer = 2.8;
  if (kind === 'busted') {
    const fine = Math.min(Math.floor(p.cash), 200 + G.stars * 60);
    p.cash -= fine;
    G.endInfo = `The SBPD took ${'$' + fine} in fines. You walk out of HQ with empty pockets.`;
  } else {
    const bill = Math.floor(p.cash * 0.1);
    p.cash -= bill;
    G.endInfo = `You wake up at Solmar General. Medical bill: $${bill}.`;
  }
}

function respawn() {
  const p = G.player;
  const at = G.endKind === 'busted' ? world.pois.police.respawn : world.pois.hospital.respawn;
  if (p.car === G.goldCar) resetGoldCar();
  p.car = null;
  p.x = at.x; p.y = at.y; p.hp = 100;
  G.heat = 0; G.stars = 0; G.bust = 0;
  G.police = [];
  G.state = 'play';
  writeSave();
}

// ---------------------------------------------------------------- update
function updatePlayer(dt) {
  const p = G.player;
  const input = G.input;
  G.hint = '';

  if (p.car) {
    driveCar(G, p.car, dt);
    p.x = p.car.x; p.y = p.car.y;
    p.face = p.car.angle;
    G.hint = 'E — get out';
    if (input.hit('KeyE')) exitCar();
  } else {
    const ax = input.axes();
    const sprint = input.down('ShiftLeft', 'ShiftRight');
    const sp = sprint ? 232 : 150;
    if (ax.x || ax.y) {
      const res = G.collideWorld(p.x + ax.x * sp * dt, p.y + ax.y * sp * dt, 8);
      p.x = res.x; p.y = res.y;
    }
    const m = input.mouse;
    p.face = Math.atan2(m.y + G.cam.y - p.y, m.x + G.cam.x - p.x);
    const near = nearestCar(G.solidCars(), p.x, p.y, 44);
    if (near) {
      G.hint = near.kind === 'gold' ? 'E — steal the gold coupe' : 'E — steal car';
      if (input.hit('KeyE')) enterCar(near);
    }
    G.fireCd -= dt;
    if (input.mouse.down && G.fireCd <= 0) shoot();
    if (input.hit('Space') && G.fireCd <= 0) punch();
  }

  // Health regen after a quiet spell.
  if (G.time - G.lastHurt > 5 && p.hp > 0) p.hp = Math.min(100, p.hp + 6 * dt);
  if (p.hp <= 0 && G.state === 'play') endRun('downed');
}

function update(dt) {
  G.time += dt;
  const input = G.input;

  if (G.state === 'title') {
    updateTraffic(G, dt);
    updatePeds(G, dt);
    G.cam.x = clamp(WORLD_W / 2 - VIEW_W / 2 + Math.sin(G.time * 0.07) * 620, 0, WORLD_W - VIEW_W);
    G.cam.y = clamp(1150 - VIEW_H / 2 + Math.cos(G.time * 0.05) * 260, 0, WORLD_H - VIEW_H);
    if (input.mouse.clicked) {
      const m = input.mouse;
      const inRect = (r) => r && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
      if (inRect(G.ui.newGame)) startGame(null);
      else if (inRect(G.ui.continue)) startGame(readSave());
    }
    if (input.hit('Enter')) startGame(null);
    if (input.hit('KeyC') && G.hasSave) startGame(readSave());
    input.endFrame();
    return;
  }

  if (G.state === 'pause') {
    if (input.hit('KeyP', 'Escape')) G.state = 'play';
    input.endFrame();
    return;
  }

  if (G.state === 'end') {
    updateTraffic(G, dt);
    updatePeds(G, dt);
    G.endTimer -= dt;
    if (G.endTimer <= 0) respawn();
    input.endFrame();
    return;
  }

  // --- play ---
  if (input.hit('KeyP', 'Escape')) { G.state = 'pause'; input.endFrame(); return; }

  G.ramCd -= dt; G.fireCd = Math.min(G.fireCd, 0.4);
  updatePlayer(dt);
  updateTraffic(G, dt);
  updateParked(dt);
  updatePeds(G, dt);
  vehicleCollisions();
  pedCarCollisions();
  updatePolice(G, dt);
  if (updateBust(G, dt)) { endRun('busted'); input.endFrame(); return; }

  // Wanted heat: cools off when no cop is watching.
  const pp = G.playerPos();
  const watched = G.police.some((c) => dist(c.x, c.y, pp.x, pp.y) < 540);
  if (!watched) G.heat = Math.max(0, G.heat - 4.2 * dt);
  G.stars = G.heat <= 0 ? 0 : Math.min(5, 1 + Math.floor(G.heat / 120));
  if (G.threat) { G.threat.t -= dt; if (G.threat.t <= 0) G.threat = null; }

  // Missions
  const ev = updateMissions(G);
  if (ev) {
    const m = ev.mission;
    if (ev.type === 'mission-start') {
      G.banner = { title: m.title, sub: m.sub, t: 3.2, total: 3.2 };
    } else if (ev.type === 'step') {
      G.banner = { title: m.title, sub: 'Objective updated', t: 1.8, total: 1.8 };
    } else if (ev.type === 'mission' || ev.type === 'story') {
      G.player.cash += m.reward;
      G.debtPaid += m.reward;
      G.banner = ev.type === 'story'
        ? { title: 'DEBT CLEARED', sub: `${m.title} complete · +$${m.reward} — Brandt is paid in full. Solmar Bay is yours.`, t: 4.2, total: 4.2 }
        : { title: 'Mission Complete', sub: `${m.title} · +$${m.reward}`, t: 3, total: 3 };
      writeSave();
    }
  }
  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }

  // Smoke from wrecked cars near the camera.
  for (const car of G.solidCars()) {
    if (car.health < 38 && Math.abs(car.x - pp.x) < 700 && Math.abs(car.y - pp.y) < 500 && G.rng() < dt * 6) {
      puff(car.x, car.y - 8, 'rgba(70,70,70,0.55)');
    }
  }

  // Particles & tracers
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const pt = G.particles[i];
    pt.t += dt;
    if (pt.t >= pt.life) { G.particles.splice(i, 1); continue; }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= 0.92; pt.vy *= 0.92;
  }
  for (let i = G.tracers.length - 1; i >= 0; i--) {
    G.tracers[i].t += dt;
    if (G.tracers[i].t > 0.08) G.tracers.splice(i, 1);
  }

  // Camera follows the player.
  G.cam.x = clamp(pp.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  G.cam.y = clamp(pp.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);

  input.endFrame();
}

// ---------------------------------------------------------------- render
function drawPlayer(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 3, 7, 3.6, 0, 0, TAU); ctx.fill();
  ctx.rotate(p.face);
  ctx.fillStyle = '#2e3440';
  ctx.fillRect(-4, -5, 4.5, 3.4); ctx.fillRect(-4, 1.6, 4.5, 3.4); // legs
  ctx.fillStyle = '#e2543e'; // Rico's sunset-orange shirt
  ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8a4b2a';
  ctx.beginPath(); ctx.arc(0.6, 0, 3.8, 0, TAU); ctx.fill(); // head
  ctx.fillStyle = '#f5c542'; // cap
  ctx.beginPath(); ctx.arc(0.6, 0, 3.8, -0.6, 2.2); ctx.fill();
  ctx.fillRect(3.4, -1.4, 3.4, 2.8);
  ctx.fillStyle = '#22252b'; // pistol in hand
  ctx.fillRect(5.4, 2.6, 7, 2.6);
  ctx.restore();
}

function render() {
  ctx.fillStyle = '#1b5e8f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(world.canvas, G.cam.x, G.cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.translate(-Math.round(G.cam.x), -Math.round(G.cam.y));
  drawObjectiveMarker(ctx, G, G.time);
  for (const car of G.parked) drawCar(ctx, car, G.time);
  for (const car of G.traffic) drawCar(ctx, car, G.time);
  for (const cop of G.police) drawCar(ctx, cop, G.time);
  if (G.player.car) drawCar(ctx, G.player.car, G.time);
  for (const ped of G.peds) drawPed(ctx, ped, G.time);
  if (G.state !== 'title' && !G.player.car) drawPlayer(ctx, G.player);
  // Tracers
  for (const t of G.tracers) {
    ctx.strokeStyle = `rgba(255,233,168,${1 - t.t / 0.08})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
  }
  // Particles
  for (const pt of G.particles) {
    ctx.globalAlpha = 1 - pt.t / pt.life;
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (G.state === 'title') { drawHUDTitleSafe(); }
  else {
    drawHUD(ctx, G, G.time);
    if (G.state === 'pause') drawPause(ctx, G);
    if (G.state === 'end') drawEndScreen(ctx, G);
  }
}

// On the title screen we still want the city alive behind the panel, but
// none of the play HUD.
function drawHUDTitleSafe() { drawStartScreen(ctx, G); }

// ---------------------------------------------------------------- boot
setupRun(null);
if (demo && ['city', 'drive', 'chase', 'mission'].includes(demo)) stageDemo(demo);

const status = document.getElementById('status');
let lastStatus = '';
function announce() {
  const s = G.state === 'title' ? 'Solmar Bay Heat — title screen'
    : G.state === 'pause' ? 'Paused'
    : G.state === 'end' ? (G.endKind === 'busted' ? 'Busted' : 'Downed')
    : `Playing. Cash $${Math.floor(G.player.cash)}, wanted ${G.stars} stars.`;
  if (s !== lastStatus && status) { status.textContent = s; lastStatus = s; }
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  update(dt);
  render();
  announce();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
