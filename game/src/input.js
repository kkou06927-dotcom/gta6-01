// Keyboard and mouse state. Everything is tracked by KeyboardEvent.code so
// layouts do not matter; mouse coordinates are kept in canvas pixels.

export const Input = {
  keys: new Set(),
  pressed: new Set(),
  mouse: { x: 0, y: 0, down: false, clicked: false },

  attach(canvas) {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    const setMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      this.mouse.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    };
    canvas.addEventListener('mousemove', setMouse);
    canvas.addEventListener('mousedown', (e) => {
      setMouse(e);
      this.mouse.down = true;
      this.mouse.clicked = true;
    });
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  },

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  },

  // Call once at the end of each frame.
  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
  },
};
