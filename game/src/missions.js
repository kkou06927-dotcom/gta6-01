// missions.js — Rico's story: three jobs for fixer Dario Fenn that pay
// down the $5,000 he owes harbour smuggler Ilya Brandt.
//
// Each mission is a list of steps; a step completes on reaching a marker
// or (for the gold coupe) on getting behind its wheel. main.js supplies
// the world hooks (player position, current car, heat) and pays rewards.

import { dist } from './util.js';

export const DEBT = 5000;

export const MISSIONS = [
  {
    id: 'harbour-run',
    title: 'Harbour Run',
    sub: 'A package for Fenn, no questions asked',
    reward: 600,
    steps: [
      { kind: 'goto', poi: 'docks', r: 52, text: 'Pick up the package at Solmar Docks' },
      { kind: 'goto', poi: 'hotel', r: 58, text: 'Deliver the package to the Marina Hotel' },
    ],
  },
  {
    id: 'golden-hour',
    title: 'Golden Hour',
    sub: 'Brandt wants his gold coupe back',
    reward: 1400,
    steps: [
      { kind: 'steal', poi: 'beachPark', r: 76, text: 'Steal the gold coupe at Palms Beach Car Park' },
      { kind: 'goto', poi: 'garage', r: 60, text: "Deliver the coupe to Fenn's Garage", needsGold: true },
    ],
  },
  {
    id: 'last-score',
    title: 'The Last Score',
    sub: 'One bank job clears the debt',
    reward: 3000,
    steps: [
      { kind: 'goto', poi: 'bank', r: 52, text: 'Pick up the takings at Solmar Bank', setsHeat: 3 },
      { kind: 'goto', poi: 'hideout', r: 62, text: 'Escape to the Cliffside Hideout' },
    ],
  },
];

export function createMissions() {
  return { index: 0, step: 0, done: false, started: false };
}

export function currentMission(M) {
  return M.done ? null : MISSIONS[M.index];
}

export function currentObjective(G) {
  const M = G.missions;
  const m = currentMission(M);
  if (!m) return null;
  const s = m.steps[M.step];
  const poi = G.world.pois[s.poi];
  return { x: poi.x, y: poi.y, r: s.r, text: s.text, mission: m };
}

// Advances the state machine; returns an event for main.js to react to:
// {type:'step'} | {type:'mission', mission} | {type:'story'} | null
export function updateMissions(G) {
  const M = G.missions;
  const m = currentMission(M);
  if (!m) return null;
  if (!M.started) {
    M.started = true;
    return { type: 'mission-start', mission: m };
  }
  const s = m.steps[M.step];
  const p = G.playerPos();
  let complete = false;
  if (s.kind === 'steal') {
    complete = G.player.car !== null && G.player.car === G.goldCar;
  } else if (s.kind === 'goto') {
    const poi = G.world.pois[s.poi];
    const inGold = !s.needsGold || (G.player.car !== null && G.player.car === G.goldCar);
    complete = inGold && dist(p.x, p.y, poi.x, poi.y) < s.r;
  }
  if (!complete) return null;

  if (s.setsHeat) G.setHeatAtLeast(s.setsHeat);
  M.step++;
  if (M.step < m.steps.length) return { type: 'step', mission: m };
  M.index++;
  M.step = 0;
  M.started = false;
  if (M.index >= MISSIONS.length) {
    M.done = true;
    return { type: 'story', mission: m };
  }
  return { type: 'mission', mission: m };
}
