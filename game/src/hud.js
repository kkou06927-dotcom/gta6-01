// hud.js — everything drawn over the world: status panels, wanted stars,
// objective banner and marker, minimap, bust meter, story banners, and
// the title / pause / busted / downed screens.

import { clamp, dist, TAU } from './util.js';
import { ROADS_V, ROADS_H, WORLD_W, WORLD_H, WATER_Y } from './world.js';
import { currentObjective, DEBT } from './missions.js';

const INK = 'rgba(12,16,22,0.72)';
const GOLD = '#f5c542';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
}

function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  if (frac > 0.01) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2); ctx.fill();
  }
}

// --- In-world objective marker: a pillar of gold light + pulsing ring ---
export function drawObjectiveMarker(ctx, G, time) {
  const o = currentObjective(G);
  if (!o || G.state !== 'play') return;
  const pulse = 1 + Math.sin(time * 4) * 0.16;
  const grad = ctx.createLinearGradient(o.x, o.y - 190, o.x, o.y);
  grad.addColorStop(0, 'rgba(245,197,66,0)');
  grad.addColorStop(1, 'rgba(245,197,66,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(o.x - 13, o.y - 190, 26, 190);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.55 * pulse, 0, TAU); ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, TAU); ctx.fill();
}

export function drawHUD(ctx, G, time) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const p = G.player;

  // --- Top-left: health, cash, debt ---
  panel(ctx, 14, 14, 232, p.car ? 104 : 82);
  ctx.fillStyle = '#ff6b5e'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('HEALTH', 26, 33);
  bar(ctx, 74, 24, 158, 11, p.hp / 100, p.hp > 30 ? '#59d977' : '#ff5040');
  if (p.car) {
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText('CAR', 26, 55);
    bar(ctx, 74, 46, 158, 11, p.car.health / 100, '#4db2ff');
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 19px system-ui, sans-serif';
  ctx.fillText('$' + Math.floor(p.cash).toLocaleString('en-US'), 26, p.car ? 84 : 62);
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '12px system-ui, sans-serif';
  const debtLeft = Math.max(0, DEBT - G.debtPaid);
  ctx.fillText(debtLeft > 0 ? 'Debt to Brandt: $' + debtLeft.toLocaleString('en-US') : 'Debt cleared!', 26, p.car ? 103 : 81);

  // --- Top-right: wanted stars over the minimap ---
  drawStars(ctx, W - 222, 16, G.stars, time);
  drawMinimap(ctx, G, W - 222, 44, 208, 156, time);

  // --- Top-centre: objective banner ---
  const o = currentObjective(G);
  if (o && G.state === 'play') {
    const pp = G.playerPos();
    const d = Math.round(dist(pp.x, pp.y, o.x, o.y));
    ctx.font = 'bold 14px system-ui, sans-serif';
    const tw = Math.max(ctx.measureText(o.text).width, ctx.measureText(o.mission.title.toUpperCase()).width) + 44;
    panel(ctx, (W - tw) / 2, 14, tw, 52);
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD; ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(o.mission.title.toUpperCase(), W / 2, 33);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(o.text + '  ·  ' + d + 'm', W / 2, 55);
    drawEdgeArrow(ctx, G, o);
  }

  // --- Bottom-left: context hint ---
  if (G.hint && G.state === 'play') {
    ctx.font = 'bold 14px system-ui, sans-serif';
    const tw = ctx.measureText(G.hint).width + 30;
    panel(ctx, 14, H - 46, tw, 32);
    ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'left';
    ctx.fillText(G.hint, 29, H - 25);
  }

  // --- Bottom-right: speedometer ---
  if (p.car && G.state === 'play') {
    panel(ctx, W - 138, H - 76, 124, 62);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(Math.abs(p.car.speed) * 0.31)), W - 44, H - 32);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('km/h', W - 20, H - 32);
    ctx.textAlign = 'left'; ctx.fillStyle = GOLD; ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(p.car.speed < -4 ? 'R' : 'D', W - 128, H - 32);
  }

  // --- Bust meter ---
  if (G.bust > 0.01 && G.state === 'play') {
    const w = 300;
    panel(ctx, (W - w - 24) / 2, H - 110, w + 24, 40);
    ctx.fillStyle = '#ff5040'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('BUSTED', W / 2, H - 94);
    bar(ctx, (W - w) / 2, H - 88, w, 9, G.bust, '#ff5040');
  }

  // --- Story banner (mission title cards) ---
  if (G.banner && G.banner.t > 0) {
    const a = clamp(G.banner.t / 0.6, 0, 1) * clamp((G.banner.total - G.banner.t + 0.6) / 0.6, 0, 1);
    ctx.save();
    ctx.globalAlpha = clamp(a + 0.25, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD; ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
    ctx.fillText(G.banner.title, W / 2, 150);
    ctx.fillStyle = '#fff'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(G.banner.sub, W / 2, 178);
    ctx.restore();
  }

  // --- Low health vignette ---
  if (p.hp < 32 && G.state === 'play') {
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
    grad.addColorStop(0, 'rgba(200,0,0,0)');
    grad.addColorStop(1, `rgba(200,0,0,${0.35 + Math.sin(time * 5) * 0.1})`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }
}

function drawStars(ctx, x, y, stars, time) {
  ctx.save();
  ctx.textAlign = 'left';
  for (let i = 0; i < 5; i++) {
    const on = i < stars;
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = on ? (Math.floor(time * 3) % 2 === 0 ? GOLD : '#ffd968') : 'rgba(255,255,255,0.25)';
    ctx.fillText('★', x + i * 24, y + 20);
  }
  ctx.restore();
}

function drawEdgeArrow(ctx, G, o) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const pp = G.playerPos();
  const sx = pp.x - G.cam.x, sy = pp.y - G.cam.y;
  const tx = o.x - G.cam.x, ty = o.y - G.cam.y;
  if (tx > 0 && tx < W && ty > 0 && ty < H) return; // marker itself is visible
  const a = Math.atan2(ty - sy, tx - sx);
  const ex = clamp(tx, 44, W - 44), ey = clamp(ty, 96, H - 44);
  ctx.save();
  ctx.translate(ex, ey); ctx.rotate(a);
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function drawMinimap(ctx, G, x, y, w, h, time) {
  const sx = w / WORLD_W, sy = h / WORLD_H;
  ctx.save();
  panel(ctx, x - 6, y - 6, w + 12, h + 12);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#27548a'; ctx.fillRect(x, y, w, h);            // sea
  ctx.fillStyle = '#c9bb9c'; ctx.fillRect(x, y, w, WATER_Y * sy); // land
  ctx.fillStyle = '#eed9a3'; ctx.fillRect(x, y + 2060 * sy, w, (WATER_Y - 2060) * sy); // beach
  ctx.strokeStyle = '#3d4148'; ctx.lineWidth = 3;
  for (const vx of ROADS_V) { ctx.beginPath(); ctx.moveTo(x + vx * sx, y); ctx.lineTo(x + vx * sx, y + 2060 * sy); ctx.stroke(); }
  for (const hy of ROADS_H) { ctx.beginPath(); ctx.moveTo(x, y + hy * sy); ctx.lineTo(x + w, y + hy * sy); ctx.stroke(); }
  // Gold coupe
  if (G.goldCar && !G.goldCar.dead) dot(ctx, x + G.goldCar.x * sx, y + G.goldCar.y * sy, 3, GOLD);
  // Objective
  const o = currentObjective(G);
  if (o) {
    const r = 4 + Math.sin(time * 5) * 1.4;
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + o.x * sx, y + o.y * sy, r + 2.5, 0, TAU); ctx.stroke();
    dot(ctx, x + o.x * sx, y + o.y * sy, 3, GOLD);
  }
  // Police blips
  const flash = Math.floor(time * 2.4) % 2 === 0;
  for (const cop of G.police) dot(ctx, x + cop.x * sx, y + cop.y * sy, 3, flash ? '#ff4040' : '#4d7dff');
  // Player arrow
  const pp = G.playerPos();
  const ang = G.player.car ? G.player.car.angle : G.player.face;
  ctx.translate(x + pp.x * sx, y + pp.y * sy); ctx.rotate(ang);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4.5, -4); ctx.lineTo(-4.5, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

// --- Full-screen states ---

export function drawStartScreen(ctx, G) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(20,16,40,0.55)');
  grad.addColorStop(0.6, 'rgba(60,20,40,0.45)');
  grad.addColorStop(1, 'rgba(10,10,20,0.78)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb03a'; ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18;
  ctx.fillText('SOLMAR BAY', W / 2, 168);
  ctx.fillStyle = '#ff5e7a';
  ctx.fillText('HEAT', W / 2, 246);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.font = '17px system-ui, sans-serif';
  ctx.fillText('Rico Marín owes harbour smuggler Ilya Brandt $5,000.', W / 2, 292);
  ctx.fillText('Fixer Dario Fenn has work. Drive anything. Dodge everyone. Pay the debt.', W / 2, 318);

  // Buttons (rects registered on G.ui for clicks)
  const bw = 260, bh = 52, bx = (W - bw) / 2;
  G.ui.newGame = { x: bx, y: 356, w: bw, h: bh };
  button(ctx, G.ui.newGame, 'NEW GAME', true);
  if (G.hasSave) {
    G.ui.continue = { x: bx, y: 422, w: bw, h: bh };
    button(ctx, G.ui.continue, 'CONTINUE', false);
  } else G.ui.continue = null;

  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '14px system-ui, sans-serif';
  const lines = [
    'WASD / arrows — move & drive      E — steal / exit car',
    'Mouse — aim · Click — shoot · Space — punch',
    'Shift — sprint · P / Esc — pause',
  ];
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 540 + i * 24));
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('An original fan-made-style crime sandbox. Every name, street and car in Solmar Bay is fictional.', W / 2, H - 22);
}

function button(ctx, r, label, primary) {
  ctx.fillStyle = primary ? '#f5c542' : 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 10); ctx.fill();
  ctx.fillStyle = primary ? '#23180a' : '#fff';
  ctx.font = 'bold 19px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, r.x + r.w / 2, r.y + 34);
}

export function drawPause(ctx, G) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = 'rgba(8,10,16,0.62)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 44px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PAUSED', W / 2, H / 2 - 10);
  ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('P or Esc to resume · Progress saves automatically', W / 2, H / 2 + 28);
  void G;
}

export function drawEndScreen(ctx, G) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const busted = G.endKind === 'busted';
  ctx.fillStyle = busted ? 'rgba(70,8,8,0.66)' : 'rgba(10,20,50,0.66)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = busted ? '#ff5040' : '#9fd8ff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText(busted ? 'BUSTED' : 'DOWNED', W / 2, H / 2 - 16);
  ctx.fillStyle = '#fff'; ctx.font = '17px system-ui, sans-serif';
  ctx.fillText(G.endInfo, W / 2, H / 2 + 24);
}
