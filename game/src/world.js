// The city of Solmar Bay: a sun-soaked coastal grid of pastel blocks, palm
// promenades and one long beach. This module owns the map layout, the road
// network, collision against buildings, and a pre-rendered static picture of
// the whole city that the main loop blits each frame.

import { clamp, mulberry32, pick, shade, resolveCircleRect } from './util.js';

export const WORLD_W = 3072;
export const WORLD_H = 2560;
export const ROAD_W = 72;
export const PITCH = 256;
export const BEACH_Y = 2304; // sand starts here
export const WATER_Y = 2432; // open water starts here
export const PROMENADE_Y = 2256; // beachfront road centre line

const PALETTE = [
  '#f2e3c9', '#e8b4a0', '#d98e73', '#a8c3bc', '#7fb3b0',
  '#f4d58d', '#e07a5f', '#81b29a', '#f2cc8f', '#c9ada7',
  '#dbe7c8', '#e5c1a8',
];

export function createWorld(seed = 1337) {
  const rng = mulberry32(seed);

  // Road centre lines. Vertical roads run the full height down to the
  // promenade; horizontal roads span the full width.
  const vRoads = [];
  for (let i = 0; i < 12; i++) vRoads.push(128 + PITCH * i);
  const hRoads = [];
  for (let j = 0; j < 9; j++) hRoads.push(128 + PITCH * j);
  const hAll = [...hRoads, PROMENADE_Y];

  const intersections = [];
  for (const x of vRoads) for (const y of hAll) intersections.push({ x, y });

  const buildings = [];
  const parks = [];
  const lots = [];
  const palms = [];

  // Blocks: the cells between neighbouring roads.
  for (let i = 0; i < 11; i++) {
    for (let j = 0; j < 8; j++) {
      const x0 = vRoads[i] + ROAD_W / 2;
      const y0 = hRoads[j] + ROAD_W / 2;
      const x1 = vRoads[i + 1] - ROAD_W / 2;
      const y1 = hRoads[j + 1] - ROAD_W / 2;
      const cell = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const roll = rng();
      if (roll < 0.13) {
        parks.push(cell);
        const n = 4 + Math.floor(rng() * 5);
        for (let k = 0; k < n; k++) {
          palms.push({
            x: cell.x + 20 + rng() * (cell.w - 40),
            y: cell.y + 20 + rng() * (cell.h - 40),
            s: 0.8 + rng() * 0.5,
          });
        }
        continue;
      }
      if (roll < 0.23) {
        lots.push(cell);
        continue;
      }
      const inset = 12;
      const ix = cell.x + inset;
      const iy = cell.y + inset;
      const iw = cell.w - inset * 2;
      const ih = cell.h - inset * 2;
      const pattern = rng();
      const addBuilding = (x, y, w, h) => {
        const color = pick(rng, PALETTE);
        buildings.push({ x, y, w, h, color, roof: shade(color, 0.78) });
      };
      if (pattern < 0.34) {
        addBuilding(ix, iy, iw, ih);
      } else if (pattern < 0.67) {
        const gap = 14;
        if (rng() < 0.5) {
          const w = (iw - gap) / 2;
          addBuilding(ix, iy, w, ih);
          addBuilding(ix + w + gap, iy, w, ih);
        } else {
          const h = (ih - gap) / 2;
          addBuilding(ix, iy, iw, h);
          addBuilding(ix, iy + h + gap, iw, h);
        }
      } else {
        const gap = 12;
        const w = (iw - gap) / 2;
        const h = (ih - gap) / 2;
        addBuilding(ix, iy, w, h);
        addBuilding(ix + w + gap, iy, w, h);
        addBuilding(ix, iy + h + gap, w, h);
        addBuilding(ix + w + gap, iy + h + gap, w, h);
      }
    }
  }

  // Palms along the beach and the promenade.
  for (let x = 60; x < WORLD_W - 40; x += 84 + rng() * 40) {
    palms.push({ x, y: BEACH_Y + 26 + rng() * 40, s: 0.9 + rng() * 0.5 });
    if (rng() < 0.7) palms.push({ x: x + 30, y: PROMENADE_Y - 52, s: 0.75 + rng() * 0.4 });
  }

  const landmarks = {
    docks: { x: 340, y: PROMENADE_Y, name: 'Solmar Docks' },
    hotel: { x: 2740, y: PROMENADE_Y, name: 'Marina Grand Hotel' },
    garage: { x: 640, y: 712, name: "Fenn's Garage" },
    bank: { x: 1536, y: 1216, name: 'First Bank of Solmar' },
    bankFront: { x: 1536, y: 1090, name: 'First Bank of Solmar' },
    hideout: { x: 2900, y: 190, name: 'Cliffside Hideout' },
    police: { x: 1408, y: 436, name: 'Solmar Police HQ' },
    hospital: { x: 436, y: 1408, name: 'Solmar General Hospital' },
    carPark: { x: 1950, y: 2296, name: 'Palms Beach Car Park' },
  };

  function isRoad(x, y) {
    if (y > WATER_Y) return false;
    for (const cx of vRoads) if (Math.abs(x - cx) <= ROAD_W / 2 && y <= PROMENADE_Y + 28) return true;
    for (const cy of hRoads) if (Math.abs(y - cy) <= ROAD_W / 2) return true;
    if (Math.abs(y - PROMENADE_Y) <= 28) return true;
    return false;
  }

  function isWater(x, y) {
    return y > WATER_Y;
  }

  function pointInBuilding(x, y, pad = 0) {
    for (const b of buildings) {
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return true;
    }
    return false;
  }

  // Push a circle at (x, y) out of every building it touches.
  function collideCircle(x, y, r) {
    let hit = false;
    for (const b of buildings) {
      if (x < b.x - r - 4 || x > b.x + b.w + r + 4 || y < b.y - r - 4 || y > b.y + b.h + r + 4) continue;
      const res = resolveCircleRect(x, y, r, b);
      if (res.hit) {
        x = res.x;
        y = res.y;
        hit = true;
      }
    }
    return { x, y, hit };
  }

  function nearestIntersection(x, y) {
    let best = intersections[0];
    let bd = Infinity;
    for (const p of intersections) {
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // Lane centre coordinate for a direction of travel on a road whose centre
  // line is `centre` (right-hand traffic).
  function laneCoord(dir, centre) {
    if (dir === 'E') return centre + 18;
    if (dir === 'W') return centre - 18;
    if (dir === 'S') return centre - 18;
    return centre + 18; // 'N'
  }

  const world = {
    w: WORLD_W,
    h: WORLD_H,
    vRoads,
    hRoads,
    hAll,
    intersections,
    buildings,
    parks,
    lots,
    palms,
    landmarks,
    isRoad,
    isWater,
    pointInBuilding,
    collideCircle,
    nearestIntersection,
    laneCoord,
    staticCanvas: null,
  };
  world.staticCanvas = renderStatic(world);
  return world;
}

// Draw the whole city once onto an offscreen canvas.
function renderStatic(world) {
  const cv = document.createElement('canvas');
  cv.width = world.w;
  cv.height = world.h;
  const c = cv.getContext('2d');
  const { vRoads, hRoads } = world;

  // Land base and sea.
  c.fillStyle = '#b3a284';
  c.fillRect(0, 0, world.w, world.h);
  const sea = c.createLinearGradient(0, WATER_Y, 0, world.h);
  sea.addColorStop(0, '#2e7fa8');
  sea.addColorStop(1, '#1a567c');
  c.fillStyle = sea;
  c.fillRect(0, WATER_Y, world.w, world.h - WATER_Y);
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.lineWidth = 2;
  for (let i = 0; i < 46; i++) {
    const y = WATER_Y + 14 + ((i * 53) % (world.h - WATER_Y - 20));
    const x = (i * 271) % world.w;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 46, y);
    c.stroke();
  }
  // Sand.
  c.fillStyle = '#ecd9a0';
  c.fillRect(0, BEACH_Y, world.w, WATER_Y - BEACH_Y);
  c.fillStyle = 'rgba(190,160,90,0.35)';
  for (let i = 0; i < 130; i++) {
    const x = (i * 197) % world.w;
    const y = BEACH_Y + ((i * 89) % (WATER_Y - BEACH_Y));
    c.fillRect(x, y, 9, 3);
  }

  // Sidewalks: a pale slab under every block.
  c.fillStyle = '#cfc8bb';
  for (let i = 0; i < 11; i++) {
    for (let j = 0; j < 8; j++) {
      const x0 = vRoads[i] + ROAD_W / 2 - 9;
      const y0 = hRoads[j] + ROAD_W / 2 - 9;
      const x1 = vRoads[i + 1] - ROAD_W / 2 + 9;
      const y1 = hRoads[j + 1] - ROAD_W / 2 + 9;
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  // Block interiors not covered by parks/lots get a sandy lot tone.
  for (let i = 0; i < 11; i++) {
    for (let j = 0; j < 8; j++) {
      const cell = {
        x: vRoads[i] + ROAD_W / 2,
        y: hRoads[j] + ROAD_W / 2,
        w: PITCH - ROAD_W,
        h: PITCH - ROAD_W,
      };
      const covered =
        world.parks.some((p) => p.x === cell.x && p.y === cell.y) ||
        world.lots.some((l) => l.x === cell.x && l.y === cell.y);
      if (!covered) {
        c.fillStyle = '#c2b294';
        c.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    }
  }

  // Parks and parking lots sit on top of their sidewalk slabs.
  for (const p of world.parks) {
    c.fillStyle = '#7fae5f';
    c.fillRect(p.x - 8, p.y - 8, p.w + 16, p.h + 16);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(p.x + 10, p.y + 10, p.w - 20, 26);
  }
  for (const l of world.lots) {
    c.fillStyle = '#77787c';
    c.fillRect(l.x - 8, l.y - 8, l.w + 16, l.h + 16);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2;
    for (let x = l.x + 12; x < l.x + l.w - 20; x += 34) {
      c.strokeRect(x, l.y + 14, 26, 52);
      c.strokeRect(x, l.y + l.h - 66, 26, 52);
    }
  }

  // Roads.
  c.fillStyle = '#4a4d52';
  for (const cx of vRoads) c.fillRect(cx - ROAD_W / 2, 0, ROAD_W, PROMENADE_Y + 28);
  for (const cy of hRoads) c.fillRect(0, cy - ROAD_W / 2, world.w, ROAD_W);
  c.fillStyle = '#55575c';
  c.fillRect(0, PROMENADE_Y - 28, world.w, 56);
  // Edge lines and centre dashes.
  c.strokeStyle = 'rgba(230,230,230,0.65)';
  c.lineWidth = 2;
  for (const cx of vRoads) {
    c.beginPath();
    c.moveTo(cx - ROAD_W / 2 + 3, 0);
    c.lineTo(cx - ROAD_W / 2 + 3, PROMENADE_Y + 28);
    c.moveTo(cx + ROAD_W / 2 - 3, 0);
    c.lineTo(cx + ROAD_W / 2 - 3, PROMENADE_Y + 28);
    c.stroke();
  }
  for (const cy of hRoads) {
    c.beginPath();
    c.moveTo(0, cy - ROAD_W / 2 + 3);
    c.lineTo(world.w, cy - ROAD_W / 2 + 3);
    c.moveTo(0, cy + ROAD_W / 2 - 3);
    c.lineTo(world.w, cy + ROAD_W / 2 - 3);
    c.stroke();
  }
  c.strokeStyle = '#e8c766';
  c.lineWidth = 3;
  c.setLineDash([22, 18]);
  for (const cx of vRoads) {
    c.beginPath();
    c.moveTo(cx, 0);
    c.lineTo(cx, PROMENADE_Y + 28);
    c.stroke();
  }
  for (const cy of hRoads) {
    c.beginPath();
    c.moveTo(0, cy);
    c.lineTo(world.w, cy);
    c.stroke();
  }
  c.setLineDash([]);

  // Buildings with a soft shadow and a roof inset.
  for (const b of world.buildings) {
    c.fillStyle = 'rgba(60,45,30,0.20)';
    c.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    c.fillStyle = b.color;
    c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = b.roof;
    c.fillRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
    c.fillStyle = 'rgba(255,255,255,0.20)';
    c.fillRect(b.x + 14, b.y + 14, Math.max(0, b.w - 28), 8);
  }

  // Docks: crates and a jetty on the promenade's west end.
  c.fillStyle = '#8a6f4d';
  for (let i = 0; i < 7; i++) {
    const x = 190 + (i % 4) * 44;
    const y = 2196 + Math.floor(i / 4) * 40;
    c.fillRect(x, y, 34, 30);
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.strokeRect(x, y, 34, 30);
  }
  c.fillStyle = '#9b7d55';
  c.fillRect(240, WATER_Y - 6, 26, 96);

  // Palm trees: trunk plus a star of fronds.
  for (const p of world.palms) {
    c.strokeStyle = '#7a5c38';
    c.lineWidth = 3 * p.s;
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + 3 * p.s, p.y - 6 * p.s);
    c.stroke();
    c.strokeStyle = '#3f8f4f';
    c.lineWidth = 2.4 * p.s;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + p.x;
      c.beginPath();
      c.moveTo(p.x + 3 * p.s, p.y - 6 * p.s);
      c.lineTo(p.x + 3 * p.s + Math.cos(a) * 13 * p.s, p.y - 6 * p.s + Math.sin(a) * 8 * p.s - 3);
      c.stroke();
    }
  }

  // Painted landmark names on the ground.
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.font = 'bold 17px system-ui, sans-serif';
  c.textAlign = 'center';
  const label = (x, y, text) => c.fillText(text, x, y);
  label(340, 2206, 'SOLMAR DOCKS');
  label(2740, 2206, 'MARINA GRAND');
  label(640, 668, "FENN'S GARAGE");
  label(1536, 1180, 'FIRST BANK');
  label(1408, 402, 'POLICE HQ');
  label(436, 1364, 'HOSPITAL');

  return cv;
}
