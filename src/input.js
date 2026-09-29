// Turns keyboard + mouse, gamepads and touch into one input for the simulation:
// { moveX, moveY, aimX, aimY, fire, dash, bomb }. Whatever was used last decides how aiming works.
const DEADZONE = 0.25;
const STICK_RADIUS = 60; // css px a touch stick can travel

const MOVE_KEYS = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };
const AIM_KEYS = { ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] };
const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);
const BOMB_KEYS = new Set(['KeyE', 'KeyQ']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
// Standard gamepad layout: A / RB / RT dash, B / LB / LT bomb, Start pauses.
const PAD_DASH = [0, 5, 7];
const PAD_BOMB = [1, 4, 6];
const PAD_PAUSE = 9;

export function createInput(canvas) {
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, seen: false };
  const presses = { dash: false, bomb: false, pause: false };
  const sticks = { move: null, aim: null };
  const padPrevious = new Map();
  let device = 'mouse';
  let capturing = false; // while playing, game keys don't also scroll the page or press focused buttons

  const press = name => { presses[name] = true; };

  addEventListener('keydown', event => {
    if (capturing && (MOVE_KEYS[event.code] || AIM_KEYS[event.code] || DASH_KEYS.has(event.code))) event.preventDefault();
    if (!event.repeat) {
      if (DASH_KEYS.has(event.code)) press('dash');
      if (BOMB_KEYS.has(event.code)) press('bomb');
      if (PAUSE_KEYS.has(event.code)) press('pause');
    }
    keys.add(event.code);
    if (AIM_KEYS[event.code]) device = 'keys';
  });
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('blur', () => { keys.clear(); mouse.down = false; sticks.move = sticks.aim = null; });

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      device = 'touch';
      const side = event.clientX < canvas.clientWidth / 2 ? 'move' : 'aim';
      if (!sticks[side]) sticks[side] = { id: event.pointerId, ox: event.clientX, oy: event.clientY, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    device = 'mouse';
    mouse.seen = true;
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    if (event.button === 0) mouse.down = true;
    if (event.button === 2) press('dash');
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') {
      for (const stick of Object.values(sticks)) if (stick?.id === event.pointerId) { stick.x = event.clientX; stick.y = event.clientY; }
      return;
    }
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) device = 'mouse';
    mouse.seen = true;
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });
  const release = event => {
    if (event.pointerType === 'touch') {
      for (const side of ['move', 'aim']) if (sticks[side]?.id === event.pointerId) sticks[side] = null;
      return;
    }
    if (event.button === 0) mouse.down = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Offset of a touch stick from where it started, as -1..1 on each axis.
  function stickValue(stick) {
    if (!stick) return [0, 0, 0];
    let dx = (stick.x - stick.ox) / STICK_RADIUS, dy = (stick.y - stick.oy) / STICK_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len; dy /= len;
      // Drag the stick's origin along so reversing direction responds immediately.
      stick.ox = stick.x - dx * STICK_RADIUS;
      stick.oy = stick.y - dy * STICK_RADIUS;
    }
    return [dx, dy, Math.min(1, len)];
  }

  function readPad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== 'standard') continue;
      const pressed = i => pad.buttons[i]?.pressed;
      const before = padPrevious.get(pad.index) ?? [];
      const edge = list => list.some(i => pressed(i) && !before[i]);
      if (edge(PAD_DASH)) press('dash');
      if (edge(PAD_BOMB)) press('bomb');
      if (pressed(PAD_PAUSE) && !before[PAD_PAUSE]) press('pause');
      padPrevious.set(pad.index, pad.buttons.map(b => b.pressed));
      const [lx, ly, rx, ry] = pad.axes;
      const move = Math.hypot(lx, ly) > DEADZONE ? [lx, ly] : [0, 0];
      const aim = Math.hypot(rx, ry) > DEADZONE ? [rx, ry] : [0, 0];
      if (move[0] || move[1] || aim[0] || aim[1] || pad.buttons.some(b => b.pressed)) device = 'pad';
      return { move, aim };
    }
    return null;
  }

  // Which menu directions and buttons are held on any standard gamepad (d-pad or left stick; A confirms).
  let menuPrevious = {};
  function menuState() {
    const state = { prev: false, next: false, confirm: false };
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || pad.mapping !== 'standard') continue;
      const held = i => !!pad.buttons[i]?.pressed;
      const [x = 0, y = 0] = pad.axes;
      state.prev ||= held(14) || held(12) || x < -0.6 || y < -0.6;
      state.next ||= held(15) || held(13) || x > 0.6 || y > 0.6;
      state.confirm ||= held(0);
    }
    return state;
  }

  // The input for this frame. `player` is the ship's world position; screenToWorld converts the mouse.
  function read({ player, screenToWorld, autofire }) {
    const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: presses.dash, bomb: presses.bomb };
    presses.dash = presses.bomb = false;
    const pad = readPad();
    for (const [code, [x, y]] of Object.entries(MOVE_KEYS)) if (keys.has(code)) { input.moveX += x; input.moveY += y; }
    if (pad) { input.moveX += pad.move[0]; input.moveY += pad.move[1]; }
    const [tx, ty, tl] = stickValue(sticks.move);
    if (tl > 0.15) { input.moveX += tx; input.moveY += ty; }

    let ax = 0, ay = 0;
    for (const [code, [x, y]] of Object.entries(AIM_KEYS)) if (keys.has(code)) { ax += x; ay += y; }
    const [sx, sy, sl] = stickValue(sticks.aim);
    if (ax || ay) {
      input.fire = true;
    } else if (pad && (pad.aim[0] || pad.aim[1])) {
      [ax, ay] = pad.aim;
      input.fire = true;
    } else if (sticks.aim) {
      if (sl > 0.2) { ax = sx; ay = sy; input.fire = true; }
    } else if (device === 'mouse' && mouse.seen) {
      const [wx, wy] = screenToWorld(mouse.x, mouse.y);
      ax = wx - player.x;
      ay = wy - player.y;
      input.fire = mouse.down || autofire;
    }
    const aim = Math.hypot(ax, ay);
    if (aim > 0.001) { input.aimX = ax / aim; input.aimY = ay / aim; } else input.fire = false;
    return input;
  }

  return {
    read,
    get device() { return device; },
    get mouse() { return mouse; },
    press,
    setCapturing(on) { capturing = on; },
    // Gamepad menu navigation: { move: -1 | 0 | 1, confirm } for presses since the last call. resetMenu() first
    // takes a snapshot, so a button already held down (say, A from dashing) doesn't count as a press.
    resetMenu() { menuPrevious = menuState(); },
    menu() {
      const now = menuState(), before = menuPrevious;
      menuPrevious = now;
      const pressed = key => now[key] && !before[key];
      return { move: pressed('next') ? 1 : pressed('prev') ? -1 : 0, confirm: pressed('confirm') };
    },
    takePause() { const p = presses.pause; presses.pause = false; return p; },
    clear() { presses.dash = presses.bomb = presses.pause = false; mouse.down = false; sticks.move = sticks.aim = null; },
    // Draws the two touch sticks (screen space) while a finger is down.
    drawSticks(ctx) {
      for (const stick of Object.values(sticks)) {
        if (!stick) continue;
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#9fb4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(stick.ox, stick.oy, STICK_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#9fb4ff';
        ctx.beginPath();
        ctx.arc(stick.x, stick.y, 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };
}
