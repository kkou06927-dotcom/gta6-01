// Cars: the factory, AI traffic that follows the road network lane by lane,
// parked cars waiting to be borrowed, the arcade driving model for whoever
// is behind the wheel, and the drawing code for every kind of car.

import { clamp, angleTo, turnToward, pick, shade } from './util.js';
import { Input } from './input.js';

export const CAR_COLORS = [
  '#c94f42', '#3f6fb5', '#e0a32e', '#5da85f', '#8e6fc0',
  '#d7d7d7', '#37414a', '#e2784a', '#4fb3a9', '#b03a5b',
];

export const DIRS = {
  E: { x: 1, y: 0, angle: 0 },
  S: { x: 0, y: 1, angle: Math.PI / 2 },
  W: { x: -1, y: 0, angle: Math.PI },
  N: { x: 0, y: -1, angle: -Math.PI / 2 },
};
const DIR_NAMES = ['E', 'S', 'W', 'N'];
const OPPOSITE = { E: 'W', W: 'E', S: 'N', N: 'S' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };

let nextCarId = 1;

export function makeCar(x, y, angle, color, kind) {
  return {
    id: nextCarId++,
    x, y, angle,
    speed: 0,
    color,
    kind, // 'traffic' | 'parked' | 'police'
    health: 100,
    w: 38,
    h: 19,
    stolen: false,
    // traffic brain
    dir: null,
    roadCentre: 0,
    waypoint: null,
    nextDir: null,
    decidedFor: '',
    cruise: 130,
    stuckFor: 0,
    reverseFor: 0,
  };
}

// The lane point a car in direction `dir` should aim at on a road centred
// on `centre`, standing at (x, y): far ahead along its lane.
function laneTarget(world, car) {
  const d = DIRS[car.dir];
  if (car.dir === 'E' || car.dir === 'W') {
    return { x: car.x + d.x * 320, y: world.laneCoord(car.dir, car.roadCentre) };
  }
  return { x: world.laneCoord(car.dir, car.roadCentre), y: car.y + d.y * 320 };
}

// The next intersection centre strictly ahead of the car along its lane.
function nextCrossing(world, car) {
  const d = DIRS[car.dir];
  let best = null;
  let bd = Infinity;
  const roads = car.dir === 'E' || car.dir === 'W' ? world.vRoads : world.hAll;
  for (const c of roads) {
    const along = car.dir === 'E' || car.dir === 'W' ? (c - car.x) * d.x : (c - car.y) * d.y;
    if (along > 4 && along < bd) {
      bd = along;
      best = c;
    }
  }
  return best;
}

export function spawnTrafficCar(G, nearX = null, nearY = null) {
  const world = G.world;
  const rng = G.rng;
  let cx;
  let cy;
  if (nearX !== null) {
    const p = world.nearestIntersection(nearX, nearY);
    cx = p.x;
    cy = p.y;
  } else {
    const p = pick(rng, world.intersections);
    cx = p.x;
    cy = p.y;
  }
  const dir = pick(rng, DIR_NAMES);
  const d = DIRS[dir];
  // Start a little way back from the intersection, on the correct lane.
  const back = 60 + rng() * 120;
  let x;
  let y;
  let roadCentre;
  if (dir === 'E' || dir === 'W') {
    roadCentre = cy;
    y = world.laneCoord(dir, cy);
    x = cx - d.x * back;
  } else {
    roadCentre = cx;
    x = world.laneCoord(dir, cx);
    y = cy - d.y * back;
  }
  const car = makeCar(x, y, d.angle, pick(rng, CAR_COLORS), 'traffic');
  car.dir = dir;
  car.roadCentre = roadCentre;
  car.speed = 90 + rng() * 40;
  car.cruise = 115 + rng() * 45;
  G.cars.push(car);
  return car;
}

export function spawnParkedCars(G, count) {
  const world = G.world;
  const rng = G.rng;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 300) {
    // Park parallel along a random block edge, just off the road.
    const vertical = rng() < 0.5;
    const road = vertical ? pick(rng, world.vRoads) : pick(rng, world.hAll);
    const side = rng() < 0.5 ? -1 : 1;
    const along = 80 + rng() * (vertical ? world.h - 500 : world.w - 160);
    let x;
    let y;
    let angle;
    if (vertical) {
      x = road + side * 47;
      y = Math.min(along, 2180);
      angle = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      x = along;
      y = road + side * 47;
      angle = side > 0 ? 0 : Math.PI;
    }
    if (world.pointInBuilding(x, y, 16)) continue;
    if (G.cars.some((c) => Math.hypot(c.x - x, c.y - y) < 52)) continue;
    const car = makeCar(x, y, angle, pick(rng, CAR_COLORS), 'parked');
    G.cars.push(car);
    placed++;
  }
}

// Is something solid directly ahead of this car? Returns a slow-down factor.
function trafficAhead(G, car, lookDist) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let factor = 1;
  const consider = (ox, oy, r) => {
    const dx = ox - car.x;
    const dy = oy - car.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < 6 || ahead > lookDist) return;
    const side = Math.abs(dx * -fy + dy * fx);
    if (side < r) factor = Math.min(factor, clamp((ahead - 20) / lookDist, 0, 1));
  };
  for (const other of G.cars) {
    if (other !== car) consider(other.x, other.y, 17);
  }
  for (const cop of G.cops) consider(cop.x, cop.y, 17);
  if (G.player.inCar) consider(G.player.inCar.x, G.player.inCar.y, 17);
  for (const ped of G.peds) {
    if (ped.state !== 'down') consider(ped.x, ped.y, 11);
  }
  return factor;
}

export function updateTrafficCar(G, car, dt) {
  const world = G.world;
  if (car.waypoint) {
    const d = Math.hypot(car.waypoint.x - car.x, car.waypoint.y - car.y);
    if (d < 14) {
      // Arrived at the corner: adopt the new direction and its road.
      car.dir = car.nextDir;
      car.roadCentre = car.waypointRoad;
      car.waypoint = null;
      car.nextDir = null;
    }
  }
  if (!car.waypoint) {
    const cross = nextCrossing(world, car);
    if (cross !== null) {
      const key = `${car.dir}@${cross}`;
      const along =
        car.dir === 'E' || car.dir === 'W'
          ? Math.abs(cross - car.x)
          : Math.abs(cross - car.y);
      if (along < 105 && car.decidedFor !== key) {
        car.decidedFor = key;
        const roll = G.rng();
        let nd = car.dir;
        if (roll > 0.82) nd = RIGHT[car.dir];
        else if (roll > 0.64) nd = LEFT[car.dir];
        if (nd !== car.dir) {
          // Corner point: the new lane's across-coordinate combined with the
          // current lane's along-coordinate, so the car sweeps the corner.
          let wx;
          let wy;
          if (nd === 'E' || nd === 'W') {
            wx = world.laneCoord(car.dir, car.roadCentre);
            wy = world.laneCoord(nd, cross);
          } else {
            wx = world.laneCoord(nd, cross);
            wy = world.laneCoord(car.dir, car.roadCentre);
          }
          car.waypoint = { x: wx, y: wy };
          car.waypointRoad = cross;
          car.nextDir = nd;
        }
      }
    }
  }

  const target = car.waypoint ? car.waypoint : laneTarget(world, car);
  const desired = angleTo(car.x, car.y, target.x, target.y);
  const turnRate = car.waypoint ? 2.4 : 1.6;
  car.angle = turnToward(car.angle, desired, turnRate * dt);

  const ahead = trafficAhead(G, car, 62);
  let targetSpeed = car.cruise * ahead;
  if (car.waypoint) targetSpeed = Math.min(targetSpeed, 95);
  const accel = targetSpeed > car.speed ? 150 : 320;
  car.speed += clamp(targetSpeed - car.speed, -accel * dt, accel * dt);
  if (car.speed < 0) car.speed = 0;

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const res = world.collideCircle(car.x, car.y, 15);
  car.x = res.x;
  car.y = res.y;
}

// The arcade driving model used for the player's car. Returns the impact
// speed lost to a building hit this frame (0 when there was none).
export function drivePlayerCar(G, car, dt) {
  const up = Input.down('KeyW', 'ArrowUp');
  const downKey = Input.down('KeyS', 'ArrowDown');
  const left = Input.down('KeyA', 'ArrowLeft');
  const right = Input.down('KeyD', 'ArrowRight');
  const handbrake = Input.down('Space');

  const MAXF = 345;
  const MAXR = 130;
  if (up) car.speed += 265 * dt;
  else if (downKey) car.speed -= (car.speed > 8 ? 330 : 165) * dt;
  else car.speed -= car.speed * 0.55 * dt;
  if (handbrake) car.speed -= car.speed * 2.4 * dt;
  car.speed = clamp(car.speed, -MAXR, MAXF);

  const steerInput = (left ? -1 : 0) + (right ? 1 : 0);
  if (steerInput !== 0 && Math.abs(car.speed) > 4) {
    const grip = clamp(Math.abs(car.speed) / 130, 0.25, 1);
    car.angle += steerInput * 1.85 * grip * dt * Math.sign(car.speed);
  }

  const px = car.x;
  const py = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, 24, G.world.w - 24);
  car.y = clamp(car.y, 24, G.world.h - 10);
  if (G.world.isWater(car.x, car.y + 6)) {
    car.y = py;
    car.speed *= 0.4;
  }
  const res = G.world.collideCircle(car.x, car.y, 16);
  let impact = 0;
  if (res.hit) {
    const moved = Math.hypot(car.x - px, car.y - py);
    const wanted = Math.abs(car.speed) * dt;
    if (wanted - moved > 2.2) impact = Math.abs(car.speed);
    car.x = res.x;
    car.y = res.y;
    if (impact > 0) car.speed *= 0.25;
  }
  return impact;
}

// Drawing -----------------------------------------------------------------

export function drawCar(c, car, time) {
  c.save();
  c.translate(car.x, car.y);
  c.rotate(car.angle);
  const w = car.w;
  const h = car.h;
  // Shadow.
  c.fillStyle = 'rgba(40,30,20,0.28)';
  c.beginPath();
  c.roundRect(-w / 2 + 2, -h / 2 + 3, w, h, 6);
  c.fill();
  // Body.
  c.fillStyle = car.color;
  c.beginPath();
  c.roundRect(-w / 2, -h / 2, w, h, 6);
  c.fill();
  c.fillStyle = shade(car.color.startsWith('#') ? car.color : '#888888', 1.18);
  c.beginPath();
  c.roundRect(-w / 2 + 3, -h / 2 + 2, w - 14, h - 4, 4);
  c.fill();
  // Cabin and glass.
  c.fillStyle = '#22303c';
  c.beginPath();
  c.roundRect(-6, -h / 2 + 3, 15, h - 6, 3);
  c.fill();
  c.fillStyle = 'rgba(160,210,235,0.85)';
  c.fillRect(-5, -h / 2 + 4, 4, h - 8);
  c.fillRect(6, -h / 2 + 4, 3, h - 8);
  // Wheels.
  c.fillStyle = '#14161a';
  c.fillRect(-w / 2 + 4, -h / 2 - 2, 9, 4);
  c.fillRect(-w / 2 + 4, h / 2 - 2, 9, 4);
  c.fillRect(w / 2 - 13, -h / 2 - 2, 9, 4);
  c.fillRect(w / 2 - 13, h / 2 - 2, 9, 4);
  // Lights.
  c.fillStyle = '#ffe9a8';
  c.fillRect(w / 2 - 2, -h / 2 + 2, 2, 4);
  c.fillRect(w / 2 - 2, h / 2 - 6, 2, 4);
  c.fillStyle = '#d23b2e';
  c.fillRect(-w / 2, -h / 2 + 2, 2, 4);
  c.fillRect(-w / 2, h / 2 - 6, 2, 4);
  if (car.kind === 'police') {
    c.fillStyle = '#f2f2f2';
    c.fillRect(-4, -h / 2 + 2, 9, h - 4);
    const flash = Math.floor(time * 5) % 2 === 0;
    c.fillStyle = flash ? '#ff4040' : '#ffd0d0';
    c.fillRect(-2, -h / 2 + 1, 5, 5);
    c.fillStyle = flash ? '#cfe4ff' : '#3a7bff';
    c.fillRect(-2, h / 2 - 6, 5, 5);
  }
  if (car.gold) {
    c.fillStyle = 'rgba(255,240,180,0.9)';
    c.fillRect(-w / 2 + 6, -3, w - 20, 6);
  }
  if (car.health < 45) {
    c.fillStyle = 'rgba(70,70,70,0.5)';
    c.beginPath();
    c.arc(w / 2 - 4, 0, 6 + (45 - car.health) * 0.12, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}
