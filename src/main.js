// Wires the game together: screens, the frame loop, turning simulation events into effects and sound, the HUD,
// settings and saved scores. The title screen plays a demo game driven by the autopilot in bot.js.
import { chooseUpgrade, createWorld, step } from './sim.js';
import { botChoice, botInput } from './bot.js';
import { rankLabel, UPGRADES, xpToNext } from './upgrades.js';
import { ENEMIES } from './enemies.js';
import { createGrid, pushGrid, updateGrid } from './grid.js';
import { addShake, createFx, flash, floatText, hitstop, ring, sparks, updateFx } from './fx.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { loadSave, requestPersistentStorage, writeSave } from './save.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const renderer = createRenderer(canvas);
const ctx = canvas.getContext('2d');
const input = createInput(canvas);
const audio = createAudio();

// ---- Saved settings and scores ----
const DEFAULT_SETTINGS = { sound: true, music: true, autofire: true, shake: true, flashes: true, glow: true };
const SETTING_LABELS = { sound: 'Sound', music: 'Music', autofire: 'Auto-fire', shake: 'Screen shake', flashes: 'Flashes', glow: 'Glow' };
const settings = { ...DEFAULT_SETTINGS };
const savedSettings = loadSave('settings', 1);
for (const key of Object.keys(DEFAULT_SETTINGS)) if (typeof savedSettings?.[key] === 'boolean') settings[key] = savedSettings[key];

const TOP_SCORES = 5;
const savedScores = loadSave('scores', 1);
const scores = {
  best: Number.isFinite(savedScores?.best) ? savedScores.best : 0,
  top: Array.isArray(savedScores?.top) ? savedScores.top.filter(s => Number.isFinite(s?.score)).slice(0, TOP_SCORES) : []
};

// Local testing only: ?wave=8 starts at that wave (e.g. to reach the boss quickly).
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const startWave = isLocal ? Math.max(1, Number(new URLSearchParams(location.search).get('wave')) || 1) : 1;

// ---- Game state ----
let mode = 'title'; // title | playing | choosing (a level-up) | paused | over
let world, grid, fx, demo, trail;
let autopilot = false; // local testing: the autopilot flies a real game
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

function freshWorld(isDemo) {
  world = createWorld({ seed: newSeed(), portrait: innerHeight > innerWidth * 1.15 });
  if (!isDemo && startWave > 1) world.wave = startWave - 1;
  grid = createGrid(world.arena.w, world.arena.h, 50);
  fx = createFx();
  trail = [];
  demo = isDemo;
  hud.reset();
}

function showOnly(screen) {
  for (const id of ['title-screen', 'levelup-screen', 'pause-screen', 'over-screen']) $(id).hidden = id !== screen;
}

function setMode(next) {
  mode = next;
  document.body.classList.toggle('playing', mode === 'playing');
  input.setCapturing(mode === 'playing');
  $('hud').hidden = mode === 'title';
  $('touch-ui').hidden = !(mode === 'playing' && input.device === 'touch');
}

function startGame() {
  audio.unlock();
  audio.play('click');
  freshWorld(false);
  showOnly(null);
  setMode('playing');
  input.clear();
  audio.setPaused(false);
  audio.setIntensity(0);
  audio.startMusic();
  canvas.focus?.();
}

function toTitle() {
  audio.stopMusic();
  audio.setPaused(false);
  freshWorld(true);
  showOnly('title-screen');
  setMode('title');
  $('best-score').textContent = scores.best.toLocaleString('en-US');
  $('play-button').focus();
}

function pause() {
  if (mode !== 'playing') return;
  setMode('paused');
  showOnly('pause-screen');
  renderBuild();
  audio.setPaused(true);
  $('resume-button').focus();
}

function resume() {
  if (mode !== 'paused') return;
  showOnly(null);
  setMode('playing');
  input.clear();
  audio.setPaused(false);
  lastFrame = performance.now();
}

function recordScore() {
  const entry = { score: world.score, wave: world.wave, time: Math.round(world.time), at: Date.now() };
  const isBest = world.score > scores.best;
  scores.best = Math.max(scores.best, world.score);
  scores.top = [...scores.top, entry].sort((a, b) => b.score - a.score).slice(0, TOP_SCORES);
  writeSave('scores', 1, scores);
  if (world.score > 0) requestPersistentStorage();
  return { entry, isBest };
}

function gameOver() {
  setMode('over');
  const { entry, isBest } = recordScore();
  const w = world;
  // Let the final explosion play out before the results cover it.
  setTimeout(() => {
    if (mode !== 'over' || world !== w) return;
    audio.stopMusic();
    $('final-score').textContent = w.score.toLocaleString('en-US');
    $('new-best').hidden = !isBest || w.score === 0;
    $('stat-wave').textContent = w.wave;
    $('stat-time').textContent = formatTime(w.time);
    $('stat-kills').textContent = w.kills.toLocaleString('en-US');
    $('stat-mult').textContent = `×${w.maxMult}`;
    $('stat-level').textContent = w.level;
    renderBuild();
    const list = $('top-scores');
    list.replaceChildren(...scores.top.map((s, i) => {
      const li = document.createElement('li');
      li.classList.toggle('current', s === entry);
      const name = document.createElement('span');
      name.textContent = `${i + 1}. Wave ${s.wave}`;
      const value = document.createElement('span');
      value.textContent = s.score.toLocaleString('en-US');
      li.append(name, value);
      return li;
    }));
    showOnly('over-screen');
    $('again-button').focus();
  }, 1400);
}

// The upgrades taken this run, as chips on the pause and game-over screens.
function renderBuild() {
  const chips = () => Object.entries(world.upgrades).map(([id, rank]) => {
    const li = document.createElement('li');
    li.dataset.kind = UPGRADES[id].kind;
    li.textContent = UPGRADES[id].max === 1 ? UPGRADES[id].name : `${UPGRADES[id].name} ${rankLabel(rank)}`;
    return li;
  });
  for (const list of document.querySelectorAll('[data-build]')) list.replaceChildren(...chips());
}

// ---- Level-ups ----
let choiceReadyAt = 0;
const CHOICE_DELAY = 450; // ms before the cards accept a pick, so a click or key meant for the fight can't take one

function openChoice() {
  setMode('choosing');
  showOnly('levelup-screen');
  $('levelup-level').textContent = world.level;
  const part = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  };
  const cards = world.choice.map((id, i) => {
    const def = UPGRADES[id], next = (world.upgrades[id] ?? 0) + 1;
    const rank = def.filler ? '' : def.max === 1 ? 'Unique' : `Rank ${rankLabel(next)} of ${rankLabel(def.max)}`;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'choice';
    card.dataset.kind = def.kind;
    card.disabled = true;
    card.append(part('kbd', '', String(i + 1)), part('span', 'tag', def.kind), part('span', 'name', def.name), part('span', 'rank', rank), part('span', 'text', def.text(next)));
    card.addEventListener('click', () => pick(i));
    return card;
  });
  $('choices').replaceChildren(...cards);
  input.resetMenu();
  choiceReadyAt = performance.now() + CHOICE_DELAY;
  setTimeout(() => { for (const card of cards) card.disabled = false; }, CHOICE_DELAY);
}

function pick(index) {
  if (mode !== 'choosing' || performance.now() < choiceReadyAt || !chooseUpgrade(world, index)) return;
  for (const event of world.events) react(event);
  world.events.length = 0;
  if (world.choice) { openChoice(); return; } // enough XP for another level
  showOnly(null);
  setMode('playing');
  input.clear();
  lastFrame = performance.now();
}

// Gamepad on the level-up screen: left/right moves between cards, A takes the focused one.
function menuPad() {
  const { move, confirm } = input.menu();
  const cards = [...document.querySelectorAll('#choices .choice')];
  if (!cards.length || performance.now() < choiceReadyAt) return;
  const at = cards.indexOf(document.activeElement);
  if (move) cards[at < 0 ? 0 : (at + move + cards.length) % cards.length].focus();
  if (confirm && at >= 0) pick(at);
}

const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// ---- Reacting to what happened in the simulation ----
function banner(text, sub = '', boss = false) {
  if (demo) return;
  const el = $('banner');
  el.className = 'banner';
  el.textContent = text;
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    el.append(small);
  }
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  el.classList.toggle('boss', boss);
}

function sound(name, event) {
  if (!demo) audio.play(name, event);
}

function react(e) {
  switch (e.type) {
    case 'shoot': {
      sound('shoot');
      const dx = Math.cos(e.angle), dy = Math.sin(e.angle);
      sparks(fx, e.x + dx * 18, e.y + dy * 18, '#fff2b8', 2, 260, 0.08, { angle: e.angle, spread: 0.8, size: 1.5 });
      break;
    }
    case 'hit':
      sound('hit');
      sparks(fx, e.x, e.y, '#ffffff', e.boss ? 8 : 5, 280, 0.2, { size: 1.5 });
      if (e.boss) addShake(fx, 0.04);
      break;
    case 'kill': {
      const color = ENEMIES[e.enemy].color;
      const big = e.boss;
      sparks(fx, e.x, e.y, color, big ? 220 : 16 + e.r * 1.4, big ? 900 : 480, big ? 1.4 : 0.6, { size: 2 });
      sparks(fx, e.x, e.y, '#ffffff', big ? 60 : 6, big ? 700 : 300, 0.35, { size: 1.5 });
      ring(fx, e.x, e.y, color, e.r * (big ? 8 : 3.2), big ? 0.9 : 0.35, big ? 6 : 2.5);
      pushGrid(grid, e.x, e.y, big ? 700 : e.r * 7, big ? 1400 : 260);
      if (e.silent) break;
      sound('kill', e);
      addShake(fx, big ? 0.9 : 0.07);
      if (big) {
        hitstop(fx, 0.2);
        flash(fx, '#ffd0d8', 1);
        banner('WARDEN DOWN', `+${e.points.toLocaleString('en-US')}`, true);
      } else if (e.points >= 2000) {
        floatText(fx, e.x, e.y - e.r - 8, e.points.toLocaleString('en-US'), color, 15);
      }
      break;
    }
    case 'spawn':
      sound('spawn', e);
      if (e.boss) {
        addShake(fx, 0.5);
        pushGrid(grid, e.x, e.y, 500, -700);
        banner('WARNING', 'The Warden approaches', true);
      }
      break;
    case 'shard':
      sound('shard');
      sparks(fx, e.x, e.y, '#ffd166', 4, 160, 0.25, { size: 1.5 });
      hud.bumpMult();
      break;
    case 'levelUp':
      sound('levelUp');
      ring(fx, world.player.x, world.player.y, '#ffd166', 140, 0.6, 4);
      break;
    case 'upgrade': {
      const color = KIND_COLORS[UPGRADES[e.id].kind];
      sound('upgrade');
      ring(fx, e.x, e.y, color, 110, 0.5, 4);
      sparks(fx, e.x, e.y, color, 30, 420, 0.5, { size: 1.8 });
      floatText(fx, e.x, e.y - 34, UPGRADES[e.id].name.toUpperCase(), color, 15);
      break;
    }
    case 'shieldBreak':
      sound('shieldBreak');
      addShake(fx, 0.35);
      ring(fx, e.x, e.y, '#5cf2b0', 200, 0.5, 5);
      sparks(fx, e.x, e.y, '#5cf2b0', 40, 600, 0.5, { size: 2 });
      pushGrid(grid, e.x, e.y, 260, 700);
      break;
    case 'shieldUp':
      sound('shieldUp');
      ring(fx, e.x, e.y, '#5cf2b0', 40, 0.4, 2);
      break;
    case 'ram':
      sparks(fx, e.x, e.y, '#7df9ff', 12, 400, 0.3, { size: 1.8 });
      addShake(fx, 0.08);
      break;
    case 'dash':
      sound('dash');
      sparks(fx, e.x, e.y, '#7df9ff', 14, 420, 0.3, { angle: Math.atan2(-e.dy, -e.dx), spread: 1.1, size: 1.5 });
      pushGrid(grid, e.x, e.y, 120, 180);
      break;
    case 'bomb':
      sound('bomb');
      addShake(fx, 0.75);
      hitstop(fx, 0.06);
      flash(fx, '#ffffff', settings.flashes ? 1 : 0.3);
      pushGrid(grid, e.x, e.y, 900, 1600);
      break;
    case 'playerDeath':
      sound('playerDeath');
      hitstop(fx, 0.35);
      addShake(fx, 1);
      flash(fx, '#ff3b5c', 1);
      sparks(fx, e.x, e.y, '#7df9ff', 140, 900, 1.3, { size: 2.2 });
      sparks(fx, e.x, e.y, '#ffffff', 60, 600, 0.9, { size: 1.8 });
      ring(fx, e.x, e.y, '#7df9ff', 260, 0.8, 5);
      pushGrid(grid, e.x, e.y, 600, 1500);
      trail = [];
      break;
    case 'respawn':
      sound('respawn');
      ring(fx, e.x, e.y, '#7df9ff', 120, 0.6, 3);
      pushGrid(grid, e.x, e.y, 250, -400);
      break;
    case 'enemyShot':
      sound('enemyShot');
      break;
    case 'shotPop':
      sound('shotPop');
      sparks(fx, e.x, e.y, '#ff6a3d', 6, 220, 0.25, { size: 1.5 });
      break;
    case 'wallHit':
      sparks(fx, e.x, e.y, '#9fb4ff', 2, 160, 0.15, { size: 1.2 });
      pushGrid(grid, e.x, e.y, 60, 40);
      break;
    case 'charge':
      sound('charge');
      sparks(fx, e.x, e.y, '#ff9e3d', 10, 300, 0.3, { angle: e.angle + Math.PI, spread: 0.9 });
      break;
    case 'wave':
      sound('wave', e);
      if (!e.boss) banner(`WAVE ${e.n}`);
      audio.setIntensity(e.n >= 8 ? 2 : e.n >= 3 ? 1 : 0);
      break;
    case 'extraLife':
      sound('extraLife');
      banner('EXTRA LIFE');
      break;
    case 'extraBomb':
      sound('extraBomb');
      banner('+1 BOMB');
      break;
    case 'gameOver':
      if (demo) break;
      sound('gameOver');
      gameOver();
      break;
  }
}

const KIND_COLORS = { weapon: '#ff4fa3', ship: '#4cc9f0', defense: '#5cf2b0' };

// ---- HUD (only touched when a value changes) ----
const hud = (() => {
  const shown = {};
  const setText = (key, el, text) => { if (shown[key] !== text) { shown[key] = text; el.textContent = text; } };
  const setStock = (key, el, count) => {
    if (shown[key] === count) return;
    shown[key] = count;
    el.replaceChildren(...Array.from({ length: Math.max(0, count) }, () => document.createElement('i')));
  };
  return {
    reset() { for (const key of Object.keys(shown)) delete shown[key]; },
    bumpMult() {
      const box = $('mult-box');
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
      clearTimeout(box.bumpTimer);
      box.bumpTimer = setTimeout(() => box.classList.remove('bump'), 90);
    },
    update(w) {
      setText('score', $('score'), w.score.toLocaleString('en-US'));
      setText('mult', $('mult'), String(w.mult));
      setText('wave', $('wave'), `WAVE ${Math.max(1, w.wave)}`);
      setStock('lives', $('lives'), w.lives);
      setStock('bombs', $('bombs'), w.bombs);
      const boss = w.enemies.find(e => ENEMIES[e.type].boss);
      $('boss-bar').hidden = !boss;
      if (boss) $('boss-fill').style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
      setText('level', $('level'), `LV ${w.level}`);
      const fill = Math.min(1, w.xp / xpToNext(w.level)).toFixed(3);
      if (shown.xp !== fill) { shown.xp = fill; $('xp-fill').style.transform = `scaleX(${fill})`; }
    }
  };
})();

// ---- Frame loop ----
let lastFrame = performance.now();

function simulate(dt) {
  if (fx.hitstop > 0) {
    // Hit-stop: the world freezes for a moment on big impacts; the shake keeps going.
    fx.hitstop -= dt;
    fx.t += dt;
    return;
  }
  const p = world.player;
  const controls = demo || (autopilot && mode === 'playing') ? botInput(world)
    : mode === 'playing' ? input.read({ player: p, screenToWorld: renderer.screenToWorld, autofire: settings.autofire })
    : { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: false, bomb: false };
  let remaining = dt, first = true;
  while (remaining > 1e-6) {
    const h = Math.min(1 / 60, remaining);
    step(world, first ? controls : { ...controls, dash: false, bomb: false }, h);
    first = false;
    remaining -= h;
  }
  for (const event of world.events) react(event);
  world.events.length = 0;
  if (world.choice) {
    if (demo || autopilot) chooseUpgrade(world, botChoice(world));
    else if (mode === 'playing') openChoice();
  }

  if (p.alive && p.dashT > 0) trail.push({ x: p.x, y: p.y, angle: p.angle, alpha: 1 });
  for (const ghost of trail) ghost.alpha -= dt * 5;
  trail = trail.filter(ghost => ghost.alpha > 0);
  const speed = Math.hypot(p.vx, p.vy);
  if (p.alive && speed > 80 && p.dashT <= 0) {
    const back = Math.atan2(-p.vy, -p.vx);
    sparks(fx, p.x + Math.cos(back) * 9, p.y + Math.sin(back) * 9, '#4cc9f0', 1, 140, 0.28, { angle: back, spread: 0.7, size: 2.2, line: false });
  }
  updateFx(fx, dt);
  updateGrid(grid, dt);
  if (demo && (world.over || world.time > 150)) freshWorld(true);
}

function frame(now) {
  // The next frame is booked first, so an error in this one can't stop the game for good.
  requestAnimationFrame(frame);
  // A frame's timestamp can be slightly earlier than a click handled just before it (which resets lastFrame),
  // so the gap can come out negative: never run time backwards.
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (input.takePause()) mode === 'playing' ? pause() : mode === 'paused' && resume();
  if (mode !== 'paused') simulate(dt);
  if (mode === 'choosing') menuPad();
  const usingMouse = input.device === 'mouse' && input.mouse.seen;
  document.body.classList.toggle('mouse', usingMouse);
  $('touch-ui').hidden = !(mode === 'playing' && input.device === 'touch');
  let crosshair = null, lead = [0, 0];
  if (!demo && mode === 'playing') {
    const p = world.player;
    if (usingMouse) {
      crosshair = renderer.screenToWorld(input.mouse.x, input.mouse.y);
      const dx = crosshair[0] - p.x, dy = crosshair[1] - p.y, d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(110, d * 0.2);
      lead = [(dx / d) * reach, (dy / d) * reach];
    } else {
      lead = [Math.cos(p.angle) * 50, Math.sin(p.angle) * 50];
    }
  }
  renderer.draw(world, fx, grid, {
    dt: mode === 'paused' ? 0 : dt, glowOn: settings.glow, shake: settings.shake ? 1 : 0, flashes: settings.flashes ? 1 : 0.25,
    lead, crosshair, trail
  });
  input.drawSticks(ctx);
  if (!demo) hud.update(world);
}

// ---- Settings ----
function applySettings() {
  audio.setSound(settings.sound);
  audio.setMusic(settings.music);
  for (const button of document.querySelectorAll('[data-setting]')) button.setAttribute('aria-pressed', String(settings[button.dataset.setting]));
}

for (const container of document.querySelectorAll('[data-settings]')) {
  for (const [key, label] of Object.entries(SETTING_LABELS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.setting = key;
    button.textContent = label;
    button.addEventListener('click', () => {
      settings[key] = !settings[key];
      writeSave('settings', 1, settings);
      applySettings();
      audio.unlock();
      audio.play('click');
    });
    container.append(button);
  }
}

// ---- Buttons and keys ----
$('play-button').addEventListener('click', startGame);
$('again-button').addEventListener('click', startGame);
$('restart-button').addEventListener('click', startGame);
$('resume-button').addEventListener('click', resume);
$('quit-button').addEventListener('click', toTitle);
$('title-button').addEventListener('click', toTitle);
$('pause-button').addEventListener('click', pause);
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('settings-button').addEventListener('click', () => $('settings-dialog').showModal());
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

for (const [id, action] of [['touch-dash', 'dash'], ['touch-bomb', 'bomb']]) {
  $(id).addEventListener('pointerdown', event => { event.preventDefault(); input.press(action); });
}

addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.repeat) return;
  const onButton = document.activeElement instanceof HTMLButtonElement;
  if (event.code === 'Enter' && !onButton && (mode === 'title' || mode === 'over')) startGame();
  const digit = /^(Digit|Numpad)([1-3])$/.exec(event.code);
  if (digit && mode === 'choosing') pick(Number(digit[2]) - 1);
});

// Pause when the player leaves the tab or window.
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('resize', () => renderer.resize());

// Local testing only: the live world, for poking at from the browser console.
// advance(seconds) runs the game without animation frames (a background tab gets none).
if (isLocal) {
  Object.defineProperty(globalThis, 'prism', {
    get: () => ({
      world, fx, mode, renderer,
      set autopilot(on) { autopilot = on; },
      advance(seconds) {
        for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60);
        renderer.draw(world, fx, grid, { dt: 1 / 60, glowOn: settings.glow, trail });
        if (!demo) hud.update(world);
      }
    })
  });
}

renderer.resize();
applySettings();
toTitle();
requestAnimationFrame(frame);
