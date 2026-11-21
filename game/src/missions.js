// The story thread: three jobs for fixer Dario Fenn that walk Rico Marín
// from broke wheelman to debt-free. Each mission is a small stage machine —
// go to the marker, do the thing, get paid. Markers, objectives and cash
// rewards all live here; the main loop just calls update().

export const MISSIONS = [
  {
    id: 'first-run',
    title: 'First Run',
    reward: 600,
    meetText: 'Meet Dario at the Solmar Docks',
    steps: {
      meet: 'Meet Dario at the Solmar Docks',
      deliver: 'Take the package to the Marina Grand Hotel',
    },
  },
  {
    id: 'golden-hour',
    title: 'Golden Hour',
    reward: 1400,
    meetText: "See Dario at Fenn's Garage",
    steps: {
      meet: "See Dario at Fenn's Garage",
      steal: 'Steal the gold coupe at Palms Beach Car Park',
      deliver: "Bring the gold coupe back to Fenn's Garage",
    },
  },
  {
    id: 'harbour-lights',
    title: 'Harbour Lights',
    reward: 3000,
    meetText: 'Meet the crew outside the First Bank of Solmar',
    steps: {
      meet: 'Meet the crew outside the First Bank of Solmar',
      pickup: 'Pull up at the bank front and pick up the crew',
      escape: 'Lose yourself — reach the Cliffside Hideout',
    },
  },
];

const ARRIVE_R = 52;

export function createMissions() {
  return {
    index: 0,
    stage: 'meet',
    done: false,

    current() {
      return this.done ? null : MISSIONS[this.index];
    },

    objective() {
      if (this.done) return { title: 'Solmar Bay', text: 'The bay is yours. Free roam.' };
      const m = this.current();
      return { title: m.title, text: m.steps[this.stage] };
    },

    // Where the glowing marker stands right now (null when story is done).
    marker(G) {
      if (this.done) return null;
      const L = G.world.landmarks;
      if (this.index === 0) {
        return this.stage === 'meet' ? { ...L.docks, label: 'Dario' } : { ...L.hotel, label: 'Drop-off' };
      }
      if (this.index === 1) {
        if (this.stage === 'meet') return { ...L.garage, label: 'Dario' };
        if (this.stage === 'steal' && G.goldCar) return { x: G.goldCar.x, y: G.goldCar.y, label: 'Gold coupe' };
        return { ...L.garage, label: 'Garage' };
      }
      if (this.stage === 'meet') return { ...L.bank, label: 'The crew' };
      if (this.stage === 'pickup') return { ...L.bankFront, label: 'Pick-up' };
      return { ...L.hideout, label: 'Hideout' };
    },

    finishMission(G) {
      const m = this.current();
      G.addMoney(m.reward, G.player.x, G.player.y - 24);
      this.index += 1;
      this.stage = 'meet';
      if (this.index >= MISSIONS.length) {
        this.done = true;
        G.banner('Debt cleared.', 'Brandt is paid. Solmar Bay is yours now.');
      }
      G.saveGame();
    },

    update(G) {
      if (this.done) return;
      const mk = this.marker(G);
      if (!mk) return;
      const p = G.playerPos();
      const d = Math.hypot(p.x - mk.x, p.y - mk.y);
      if (this.index === 1 && this.stage === 'deliver') {
        // The garage only takes the delivery with the gold car itself.
        if (d < ARRIVE_R && G.player.inCar === G.goldCar) {
          G.banner('Golden Hour complete.', 'Dario: Clean work. She is beautiful.');
          this.finishMission(G);
        }
        return;
      }
      if (d >= ARRIVE_R) return;

      if (this.index === 0 && this.stage === 'meet') {
        this.stage = 'deliver';
        G.banner('Dario: Rico! Package is in your hands now.', 'Marina Grand, south-east shore. Move.');
      } else if (this.index === 0 && this.stage === 'deliver') {
        G.banner('First Run complete.', 'The concierge tips well. Dario will call again.');
        this.finishMission(G);
      } else if (this.index === 1 && this.stage === 'meet') {
        this.stage = 'steal';
        G.banner('Dario: A collector owes us a gold coupe.', 'Palms Beach Car Park. Take it, bring it home.');
      } else if (this.index === 2 && this.stage === 'meet') {
        this.stage = 'pickup';
        G.banner('The crew is inside the bank.', 'Pull up at the front doors. Be ready to run.');
      } else if (this.index === 2 && this.stage === 'pickup') {
        this.stage = 'escape';
        G.setHeatAtLeast(3);
        G.banner('Crew aboard!', 'Three stars. The Cliffside Hideout, north-east. Go!');
      } else if (this.index === 2 && this.stage === 'escape') {
        G.banner('Harbour Lights complete.', 'The crew vanishes into the cliffs.');
        this.finishMission(G);
      }
    },

    // Called by the main loop the moment the player gets into a car.
    onEnterCar(G, car) {
      if (this.done) return;
      if (this.index === 1 && this.stage === 'steal' && car === G.goldCar) {
        this.stage = 'deliver';
        G.setHeatAtLeast(2);
        G.banner("That's the coupe!", "Two stars. Get it to Fenn's Garage.");
      }
    },
  };
}

// The contact figure waiting at "meet" markers: a person in a loud shirt
// with a gold ring at their feet, drawn in world space.
export function drawContact(c, G) {
  const M = G.missions;
  if (M.done || M.stage !== 'meet') return;
  const mk = M.marker(G);
  if (!mk) return;
  const bob = Math.sin(G.time * 3) * 2;
  c.save();
  c.translate(mk.x, mk.y);
  c.strokeStyle = 'rgba(255,205,60,0.9)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(0, 0, 17 + Math.sin(G.time * 4) * 2.5, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(40,30,20,0.25)';
  c.beginPath();
  c.ellipse(0, 4, 7, 3.4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffd23e';
  c.beginPath();
  c.arc(0, bob * 0.4, 6.4, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#8d5524';
  c.beginPath();
  c.arc(0, -1 + bob * 0.4, 3.8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffffff';
  c.font = 'bold 15px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('!', 0, -16 + bob);
  c.restore();
}
