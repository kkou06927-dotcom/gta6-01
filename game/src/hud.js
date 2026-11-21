// Everything drawn over the world: health and cash, wanted stars, the
// objective banner, story banners, the bust meter, the minimap, and the
// full-screen overlays (title, pause, busted, downed).

import { clamp } from './util.js';

const VIEW_W = 1280;
const VIEW_H = 720;

function panel(c, x, y, w, h, alpha = 0.55) {
  c.fillStyle = `rgba(12,16,22,${alpha})`;
  c.beginPath();
  c.roundRect(x, y, w, h, 8);
  c.fill();
}

function star(c, cx, cy, r, filled) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  if (filled) {
    c.fillStyle = '#ffc93e';
    c.fill();
  }
  c.strokeStyle = filled ? '#a86e00' : 'rgba(255,255,255,0.55)';
  c.lineWidth = 1.4;
  c.stroke();
}

export function drawHUD(c, G) {
  const p = G.player;
  // Health + cash, top-left.
  panel(c, 14, 14, 218, 64);
  c.fillStyle = '#e8e8e8';
  c.font = 'bold 11px system-ui, sans-serif';
  c.textAlign = 'left';
  c.fillText('HEALTH', 26, 32);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(26, 38, 130, 10);
  c.fillStyle = p.health > 30 ? '#58c96b' : '#e0483e';
  c.fillRect(26, 38, 130 * clamp(p.health / 100, 0, 1), 10);
  if (p.inCar) {
    c.fillStyle = '#e8e8e8';
    c.fillText('CAR', 166, 32);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(166, 38, 54, 10);
    c.fillStyle = '#7fb3e8';
    c.fillRect(166, 38, 54 * clamp(p.inCar.health / 100, 0, 1), 10);
  }
  c.fillStyle = '#7be495';
  c.font = 'bold 19px system-ui, sans-serif';
  c.fillText(`$${G.money.toLocaleString('en-US')}`, 26, 68);

  // Wanted stars, top-right.
  panel(c, VIEW_W - 176, 14, 162, 40);
  for (let i = 0; i < 5; i++) {
    const active = i < G.stars;
    const pulse = active && G.time - G.lastCrimeAt < 2 ? 1 + Math.sin(G.time * 10) * 0.12 : 1;
    star(c, VIEW_W - 152 + i * 31, 34, 12 * pulse, active);
  }

  // Objective, top-centre.
  const obj = G.missions.objective();
  c.font = 'bold 15px system-ui, sans-serif';
  const tw = Math.max(c.measureText(obj.text).width + 36, 240);
  panel(c, VIEW_W / 2 - tw / 2, 14, tw, 52, 0.5);
  c.fillStyle = '#ffc93e';
  c.font = 'bold 10.5px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(obj.title.toUpperCase(), VIEW_W / 2, 32);
  c.fillStyle = '#ffffff';
  c.font = 'bold 14.5px system-ui, sans-serif';
  c.fillText(obj.text, VIEW_W / 2, 54);

  // Story banner, under the objective.
  if (G.bannerTtl > 0) {
    const a = clamp(G.bannerTtl / 0.6, 0, 1);
    c.globalAlpha = a;
    c.font = 'bold 16px system-ui, sans-serif';
    const bw = Math.max(c.measureText(G.bannerText).width + 44, 280);
    panel(c, VIEW_W / 2 - bw / 2, 78, bw, G.bannerSub ? 58 : 40, 0.72);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.fillText(G.bannerText, VIEW_W / 2, G.bannerSub ? 102 : 103);
    if (G.bannerSub) {
      c.fillStyle = '#ffd97a';
      c.font = '13px system-ui, sans-serif';
      c.fillText(G.bannerSub, VIEW_W / 2, 124);
    }
    c.globalAlpha = 1;
  }

  // Context hint, bottom-left.
  c.font = '13px system-ui, sans-serif';
  c.textAlign = 'left';
  let hint = null;
  if (p.inCar) hint = 'E — get out · WASD — drive';
  else if (G.nearCar) hint = 'E — get in the car';
  else hint = 'WASD — move · mouse — aim · click — shoot · Space — punch';
  if (hint) {
    const hw = c.measureText(hint).width + 24;
    panel(c, 14, VIEW_H - 40, hw, 26, 0.45);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText(hint, 26, VIEW_H - 22);
  }
  if (p.inCar) {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = 'bold 13px system-ui, sans-serif';
    c.textAlign = 'right';
    c.fillText(`${Math.round(Math.abs(p.inCar.speed) * 0.36)} km/h`, VIEW_W - 226, VIEW_H - 22);
    c.textAlign = 'left';
  }

  // Bust meter, centre-bottom.
  if (G.bustMeter > 0.02) {
    panel(c, VIEW_W / 2 - 130, VIEW_H - 108, 260, 40, 0.7);
    c.fillStyle = '#ff5a4e';
    c.font = 'bold 12px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('BUSTED', VIEW_W / 2, VIEW_H - 92);
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(VIEW_W / 2 - 110, VIEW_H - 86, 220, 8);
    c.fillStyle = '#ff5a4e';
    c.fillRect(VIEW_W / 2 - 110, VIEW_H - 86, 220 * G.bustMeter, 8);
    c.textAlign = 'left';
  }

  drawMinimap(c, G);
}

let minimapBase = null;

function drawMinimap(c, G) {
  const MW = 196;
  const MH = 164;
  const x0 = VIEW_W - MW - 14;
  const y0 = VIEW_H - MH - 14;
  if (!minimapBase) {
    minimapBase = document.createElement('canvas');
    minimapBase.width = MW;
    minimapBase.height = MH;
    const mc = minimapBase.getContext('2d');
    mc.fillStyle = '#274b63';
    mc.fillRect(0, 0, MW, MH);
    mc.drawImage(G.world.staticCanvas, 0, 0, MW, MH);
  }
  c.save();
  panel(c, x0 - 4, y0 - 4, MW + 8, MH + 8, 0.6);
  c.drawImage(minimapBase, x0, y0);
  const sx = MW / G.world.w;
  const sy = MH / G.world.h;
  const dot = (x, y, color, r) => {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x0 + x * sx, y0 + y * sy, r, 0, Math.PI * 2);
    c.fill();
  };
  const mk = G.missions.marker(G);
  if (mk) {
    const pulse = 3 + Math.sin(G.time * 5) * 1.2;
    dot(mk.x, mk.y, '#ffc93e', pulse);
  }
  for (const cop of G.cops) dot(cop.x, cop.y, '#ff5040', 2.6);
  // Player arrow.
  const p = G.playerPos();
  const a = G.player.inCar ? G.player.inCar.angle : G.player.angle;
  c.save();
  c.translate(x0 + p.x * sx, y0 + p.y * sy);
  c.rotate(a);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(6, 0);
  c.lineTo(-4, -3.6);
  c.lineTo(-4, 3.6);
  c.closePath();
  c.fill();
  c.restore();
  c.restore();
}

// Overlays ------------------------------------------------------------------

function bigTitle(c, title, sub) {
  c.fillStyle = 'rgba(8,10,16,0.78)';
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  c.textAlign = 'center';
  c.fillStyle = '#ffc93e';
  c.font = 'bold 64px system-ui, sans-serif';
  c.fillText(title, VIEW_W / 2, 218);
  if (sub) {
    c.fillStyle = '#ffffff';
    c.font = '19px system-ui, sans-serif';
    c.fillText(sub, VIEW_W / 2, 256);
  }
  c.textAlign = 'left';
}

export function drawStartScreen(c, G) {
  // The city shows behind a light veil.
  c.fillStyle = 'rgba(10,14,22,0.55)';
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  c.textAlign = 'center';
  c.fillStyle = '#ffc93e';
  c.font = 'bold 72px system-ui, sans-serif';
  c.fillText('SOLMAR BAY HEAT', VIEW_W / 2, 190);
  c.fillStyle = '#ffffff';
  c.font = '19px system-ui, sans-serif';
  c.fillText('An open-world crime story in a sun-soaked coastal city.', VIEW_W / 2, 228);
  c.fillText('Run jobs for Dario Fenn, dodge the Solmar Bay PD, clear your debt.', VIEW_W / 2, 254);

  const lines = [
    'WASD / arrows — move and drive',
    'E — steal / enter and exit cars',
    'Mouse — aim · click — shoot · Space — punch',
    'P — pause · Stars rise with crime and fade when you lie low',
  ];
  c.font = '15.5px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.85)';
  lines.forEach((t, i) => c.fillText(t, VIEW_W / 2, 316 + i * 24));

  const bw = 230;
  const bh = 52;
  const y = 452;
  G.ui.newBtn = { x: VIEW_W / 2 - bw - 14, y, w: bw, h: bh };
  G.ui.contBtn = G.hasSave ? { x: VIEW_W / 2 + 14, y, w: bw, h: bh } : null;
  const btn = (r, label, enabled) => {
    c.fillStyle = enabled ? '#ffc93e' : 'rgba(255,255,255,0.15)';
    c.beginPath();
    c.roundRect(r.x, r.y, r.w, r.h, 9);
    c.fill();
    c.fillStyle = enabled ? '#231a04' : 'rgba(255,255,255,0.5)';
    c.font = 'bold 19px system-ui, sans-serif';
    c.fillText(label, r.x + r.w / 2, r.y + 33);
  };
  btn(G.ui.newBtn, 'NEW GAME', true);
  if (G.ui.contBtn) btn(G.ui.contBtn, 'CONTINUE', true);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.font = '13.5px system-ui, sans-serif';
  c.fillText(G.hasSave ? 'Enter — new game · C — continue' : 'Click NEW GAME or press Enter', VIEW_W / 2, y + 84);
  c.textAlign = 'left';
}

export function drawPause(c) {
  bigTitle(c, 'PAUSED', 'Press P or Esc to keep playing');
}

export function drawBusted(c, G) {
  bigTitle(c, 'BUSTED', `The Solmar Bay PD got you. Fine: $150. Cash left: $${Math.max(0, G.money - 150).toLocaleString('en-US')}`);
  c.textAlign = 'center';
  c.fillStyle = '#ffffff';
  c.font = '16px system-ui, sans-serif';
  c.fillText('Click or press Enter to walk out of the station', VIEW_W / 2, 320);
  c.textAlign = 'left';
}

export function drawDowned(c, G) {
  bigTitle(c, 'DOWNED', `You wake up at Solmar General. Bill: $200. Cash left: $${Math.max(0, G.money - 200).toLocaleString('en-US')}`);
  c.textAlign = 'center';
  c.fillStyle = '#ffffff';
  c.font = '16px system-ui, sans-serif';
  c.fillText('Click or press Enter to check out', VIEW_W / 2, 320);
  c.textAlign = 'left';
}
