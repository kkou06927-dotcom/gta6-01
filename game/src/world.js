// world.js — the city of Solmar Bay: layout, points of interest, collision,
// and a pre-rendered static map the game blits from each frame.
//
// Layout: a grid of avenues over 3200x2400 px. The south edge is beach and
// sea, the south-east corner is the docks, and named POI blocks (police HQ,
// hospital, bank, hotel, Fenn's Garage, the hideout) anchor the missions.

import { mulberry32, clamp, circleRectResolve } from './util.js';

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const ROADS_V = [300, 700, 1100, 1500, 1900, 2300, 2700];
export const ROADS_H = [300, 700, 1100, 1500, 1900];
export const ROAD_W = 96;
const HALF = ROAD_W / 2;
export const BEACH_Y = 2060;   // sand starts
export const WATER_Y = 2290;   // sea starts (solid for cars and feet)

const ROOF_COLORS = ['#e8b4a0', '#d98c7a', '#f2d38a', '#a8c6d8', '#c3b2d9', '#f0e0b6', '#e59a8a', '#9fc9a8', '#eec27f', '#b5d3e7'];

export function createWorld(seed) {
  const rng = mulberry32(seed ^ 0x5eed);
  const buildings = [];   // solid rects {x,y,w,h}
  const lots = [];        // parking lot rects
  const pedBlocks = [];   // rects pedestrians stroll around (sidewalk inset)
  const parkingSpots = []; // {x,y,angle}
  const pois = {};

  // Block grid: cells between roads.
  const xs = [0, ...ROADS_V, WORLD_W];
  const ys = [0, ...ROADS_H, WORLD_H];
  const blockRect = (c, r) => ({
    x: xs[c] + HALF, y: ys[r] + HALF,
    w: xs[c + 1] - HALF - (xs[c] + HALF),
    h: ys[r + 1] - HALF - (ys[r] + HALF),
  });

  // Named POI blocks by [col,row].
  const poiBlocks = {
    '0,0': 'hideout', '4,1': 'hospital', '1,2': 'garage', '3,2': 'police',
    '3,3': 'bank', '6,3': 'hotel',
  };
  const parkBlocks = new Set(['2,1', '5,3', '1,4']);
  const lotBlocks = new Set(['4,2', '6,1', '2,4']);

  const drawJobs = []; // filled with closures that paint the static map

  for (let c = 0; c < xs.length - 1; c++) {
    for (let r = 0; r < ys.length - 1; r++) {
      if (r === 5) continue; // beach / docks strip handled below
      const b = blockRect(c, r);
      pedBlocks.push({ x: b.x + 8, y: b.y + 8, w: b.w - 16, h: b.h - 16 });
      const key = c + ',' + r;
      if (poiBlocks[key]) {
        buildPoi(drawJobs, buildings, pois, poiBlocks[key], b, rng);
      } else if (parkBlocks.has(key)) {
        drawJobs.push((g) => paintPark(g, b, rng));
      } else if (lotBlocks.has(key)) {
        lots.push(b);
        makeLotSpots(parkingSpots, b);
        drawJobs.push((g) => paintLot(g, b));
      } else {
        drawJobs.push((g) => paintBuildings(g, b, buildings, rng));
      }
    }
  }

  // --- Beach strip, promenade, docks, beach car park ---
  const promenade = { x: 40, y: 1988, w: WORLD_W - 80, h: 44 };
  pedBlocks.push(promenade);
  const beachPark = { x: 1150, y: 2080, w: 700, h: 130 };
  lots.push(beachPark);
  makeLotSpots(parkingSpots, beachPark, 10);
  pois.beachPark = { x: 1500, y: 2145, label: 'Palms Beach Car Park' };
  pois.goldSpot = { x: 1500, y: 2145, angle: 0 };
  const docks = { x: 2760, y: 1960, w: 400, h: 320 };
  pois.docks = { x: 2950, y: 2150, label: 'Solmar Docks' };
  const warehouse = { x: 2800, y: 1990, w: 200, h: 110 };
  buildings.push(warehouse);
  drawJobs.push((g) => paintBeach(g, rng, beachPark, docks, warehouse));

  // Street parking spots along a few avenues.
  for (const ry of [700, 1500]) {
    for (let x = 420; x < WORLD_W - 200; x += 210) {
      if (ROADS_V.some((vx) => Math.abs(vx - x) < 90)) continue;
      parkingSpots.push({ x, y: ry + HALF - 13, angle: 0 });
    }
  }

  // Respawn / door points sit on the road in front of each POI.
  pois.hospital.respawn = { x: 1700, y: 700 };
  pois.police.respawn = { x: 1300, y: 1100 };
  pois.garage.respawn = { x: 500, y: 1100 };

  // Pre-render the static city once.
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_W; canvas.height = WORLD_H;
  const g = canvas.getContext('2d');
  paintGround(g);
  for (const job of drawJobs) job(g);
  paintRoads(g);

  return {
    w: WORLD_W, h: WORLD_H, buildings, lots, pedBlocks, parkingSpots, pois,
    canvas,
  };
}

function buildPoi(drawJobs, buildings, pois, kind, b, rng) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const label = {
    hideout: 'CLIFFSIDE HIDEOUT', hospital: 'HOSPITAL', garage: "FENN'S GARAGE",
    police: 'POLICE HQ', bank: 'SOLMAR BANK', hotel: 'MARINA HOTEL',
  }[kind];
  pois[kind] = { x: cx, y: cy, label };
  if (kind === 'hideout') {
    const cabin = { x: cx - 55, y: cy - 40, w: 110, h: 80 };
    buildings.push(cabin);
    drawJobs.push((g) => {
      g.fillStyle = '#6f9e57'; g.fillRect(b.x, b.y, b.w, b.h);
      paintBuilding(g, cabin, '#8a6f4d');
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.font = 'bold 15px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(label, cx, b.y + b.h - 12);
    });
    return;
  }
  const main = { x: b.x + 26, y: b.y + 30, w: b.w - 52, h: b.h - 92 };
  buildings.push(main);
  const roof = { police: '#7f9fc4', hospital: '#e8e4da', bank: '#c9a86a', hotel: '#e59a8a', garage: '#9aa3ab' }[kind];
  drawJobs.push((g) => {
    paintBuilding(g, main, roof);
    if (kind === 'hospital') { // red cross on the roof
      g.fillStyle = '#d23b3b';
      g.fillRect(cx - 8, main.y + 18, 16, 44); g.fillRect(cx - 22, main.y + 32, 44, 16);
    }
    if (kind === 'garage') { // open bays at the front
      g.fillStyle = '#3a3f45';
      for (let i = 0; i < 3; i++) g.fillRect(main.x + 18 + i * 52, main.y + main.h - 6, 38, 10);
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.font = 'bold 17px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(label, cx, b.y + b.h - 14);
    // Forecourt
    g.fillStyle = '#b7ab93'; g.fillRect(b.x + 10, main.y + main.h, b.w - 20, 30);
  });
  void rng;
}

function paintBuildings(g, b, buildings, rng) {
  // Sidewalk slab first (painted under everything else in the block).
  g.fillStyle = '#cfc4ae'; g.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  const n = 1 + Math.floor(rng() * 3);
  const cellW = b.w / (n > 1 ? 2 : 1), cellH = b.h / (n > 2 ? 2 : 1);
  let placed = 0;
  for (let i = 0; i < 2 && placed < n; i++) {
    for (let j = 0; j < 2 && placed < n; j++) {
      const m = 14 + rng() * 10;
      const rect = {
        x: b.x + i * cellW + m, y: b.y + j * cellH + m,
        w: cellW - m * 2, h: cellH - m * 2,
      };
      if (rect.w < 40 || rect.h < 40) continue;
      buildings.push(rect);
      paintBuilding(g, rect, ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)]);
      placed++;
    }
  }
}

function paintBuilding(g, r, roof) {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(r.x + 5, r.y + 7, r.w, r.h); // drop shadow
  g.fillStyle = roof; g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  const cols = Math.max(2, Math.floor(r.w / 26)), rows = Math.max(2, Math.floor(r.h / 26));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    g.fillRect(r.x + 8 + i * 24, r.y + 8 + j * 24, 9, 9); // window glints
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(r.x + r.w * 0.55, r.y + r.h * 0.5, r.w * 0.3, r.h * 0.32); // rooftop unit
}

function paintPark(g, b, rng) {
  g.fillStyle = '#5da85f'; g.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  g.strokeStyle = '#d9c9a3'; g.lineWidth = 10;
  g.beginPath();
  g.moveTo(b.x, b.y + b.h / 2); g.lineTo(b.x + b.w, b.y + b.h / 2);
  g.moveTo(b.x + b.w / 2, b.y); g.lineTo(b.x + b.w / 2, b.y + b.h);
  g.stroke();
  for (let i = 0; i < 14; i++) {
    const x = b.x + 16 + rng() * (b.w - 32), y = b.y + 16 + rng() * (b.h - 32);
    g.fillStyle = '#2f7a3d'; g.beginPath(); g.arc(x, y, 13 + rng() * 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3f9e4d'; g.beginPath(); g.arc(x - 3, y - 3, 8 + rng() * 5, 0, Math.PI * 2); g.fill();
  }
}

function makeLotSpots(spots, lot, perRow) {
  const cols = perRow ?? Math.max(3, Math.floor(lot.w / 64));
  const rows = Math.max(1, Math.floor(lot.h / 64));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      spots.push({
        x: lot.x + 36 + c * ((lot.w - 72) / Math.max(1, cols - 1)),
        y: lot.y + 34 + r * 62,
        angle: -Math.PI / 2,
        lot: true,
      });
    }
  }
}

function paintLot(g, b) {
  g.fillStyle = '#555a61'; g.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
  const cols = Math.max(3, Math.floor(b.w / 64)), rows = Math.max(1, Math.floor(b.h / 64));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.x + 36 + c * ((b.w - 72) / Math.max(1, cols - 1));
      g.strokeRect(x - 15, b.y + 34 + r * 62 - 24, 30, 48);
    }
  }
}

function paintBeach(g, rng, beachPark, docks, warehouse) {
  // Sand
  g.fillStyle = '#eed9a3'; g.fillRect(0, BEACH_Y, WORLD_W, WORLD_H - BEACH_Y);
  // Promenade
  g.fillStyle = '#d9c9a3'; g.fillRect(0, 1976, WORLD_W, 60);
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 1976, WORLD_W, 3); g.fillRect(0, 2033, WORLD_W, 3);
  // Palms along the promenade
  for (let x = 90; x < WORLD_W; x += 170) {
    if (x > docks.x - 40 && x < docks.x + docks.w) continue;
    g.fillStyle = '#2f7a3d'; g.beginPath(); g.arc(x, 2006, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3f9e4d'; g.beginPath(); g.arc(x - 4, 2002, 9, 0, Math.PI * 2); g.fill();
  }
  // Beach car park
  paintLot(g, beachPark);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = 'bold 16px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('PALMS BEACH CAR PARK', beachPark.x + beachPark.w / 2, beachPark.y + beachPark.h + 24);
  // Docks: yard, warehouse, crates, piers
  g.fillStyle = '#8d8272'; g.fillRect(docks.x, docks.y, docks.w, docks.h);
  paintBuilding(g, warehouse, '#a0855c');
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.font = 'bold 16px system-ui, sans-serif';
  g.fillText('SOLMAR DOCKS', docks.x + 100, docks.y + 24);
  for (let i = 0; i < 12; i++) {
    const x = docks.x + 20 + rng() * (docks.w - 60), y = docks.y + 140 + rng() * 150;
    g.fillStyle = ['#b5651d', '#8a6f4d', '#707880'][i % 3];
    g.fillRect(x, y, 26, 26);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.strokeRect(x, y, 26, 26);
  }
  g.fillStyle = '#7a5c38';
  for (const px of [docks.x + 40, docks.x + 190, docks.x + 320]) {
    g.fillRect(px, WATER_Y, 34, WORLD_H - WATER_Y); // piers into the sea
  }
  // Umbrellas on the sand
  for (let i = 0; i < 16; i++) {
    const x = 80 + rng() * (WORLD_W - 500), y = 2160 + rng() * 90;
    if (x > beachPark.x - 20 && x < beachPark.x + beachPark.w + 20 && y < beachPark.y + beachPark.h + 30) continue;
    g.fillStyle = ['#e2543e', '#f2b138', '#3f8fbf'][i % 3];
    g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
  }
}

function paintGround(g) {
  g.fillStyle = '#a89a80'; g.fillRect(0, 0, WORLD_W, WORLD_H); // dry city pavement
  // Sea
  const grad = g.createLinearGradient(0, WATER_Y, 0, WORLD_H);
  grad.addColorStop(0, '#3d94c9'); grad.addColorStop(1, '#1b5e8f');
  g.fillStyle = grad; g.fillRect(0, WATER_Y, WORLD_W, WORLD_H - WATER_Y);
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
  for (let x = 30; x < WORLD_W; x += 90) {
    g.beginPath(); g.arc(x, WATER_Y + 34, 16, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.beginPath(); g.arc(x + 40, WATER_Y + 74, 13, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  }
  g.fillStyle = '#f4e6bb'; g.fillRect(0, WATER_Y - 8, WORLD_W, 10); // waterline foam
}

function paintRoads(g) {
  g.fillStyle = '#3d4148';
  for (const x of ROADS_V) g.fillRect(x - HALF, 0, ROAD_W, BEACH_Y + 20);
  for (const y of ROADS_H) g.fillRect(0, y - HALF, WORLD_W, ROAD_W);
  // Edge lines
  g.fillStyle = '#e8e4da';
  for (const x of ROADS_V) { g.fillRect(x - HALF + 2, 0, 3, BEACH_Y + 20); g.fillRect(x + HALF - 5, 0, 3, BEACH_Y + 20); }
  for (const y of ROADS_H) { g.fillRect(0, y - HALF + 2, WORLD_W, 3); g.fillRect(0, y + HALF - 5, WORLD_W, 3); }
  // Centre dashes
  g.fillStyle = '#d8b93a';
  for (const x of ROADS_V) for (let y = 8; y < BEACH_Y; y += 44) g.fillRect(x - 2, y, 4, 24);
  for (const y of ROADS_H) for (let x = 8; x < WORLD_W; x += 44) g.fillRect(x, y - 2, 24, 4);
}

// --- Queries used by the rest of the game ---

export function isOnRoad(x, y) {
  for (const vx of ROADS_V) if (Math.abs(x - vx) <= HALF + 4 && y < BEACH_Y + 24) return true;
  for (const hy of ROADS_H) if (Math.abs(y - hy) <= HALF + 4) return true;
  return false;
}

// Push a circle (entity) out of all buildings, the sea and the world edge.
export function collide(world, x, y, r) {
  let hit = false;
  for (const b of world.buildings) {
    const res = circleRectResolve(x, y, r, b);
    if (res.hit) { x = res.x; y = res.y; hit = true; }
  }
  if (y > WATER_Y - r) { y = WATER_Y - r; hit = true; }
  x = clamp(x, r, WORLD_W - r);
  y = clamp(y, r, WORLD_H - r);
  return { x, y, hit };
}

export function intersections() {
  const pts = [];
  for (const x of ROADS_V) for (const y of ROADS_H) pts.push({ x, y });
  return pts;
}

// Intersections directly reachable from (x,y) along its road.
export function nextIntersections(x, y) {
  const out = [];
  if (ROADS_V.includes(x)) {
    const i = ROADS_H.indexOf(y);
    if (i > 0) out.push({ x, y: ROADS_H[i - 1] });
    if (i < ROADS_H.length - 1) out.push({ x, y: ROADS_H[i + 1] });
  }
  if (ROADS_H.includes(y)) {
    const i = ROADS_V.indexOf(x);
    if (i > 0) out.push({ x: ROADS_V[i - 1], y });
    if (i < ROADS_V.length - 1) out.push({ x: ROADS_V[i + 1], y });
  }
  return out;
}
