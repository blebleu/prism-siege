// All sound is synthesized with the Web Audio API: no audio files. Effects are short envelopes on oscillators
// and filtered noise; the music is a small step sequencer (kick, bass, hats, and an arpeggio that joins in
// later waves) scheduled slightly ahead of time so it stays in time even when frames drop.
export function createAudio() {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noise = null;
  let soundOn = true, musicOn = true;
  const lastPlayed = new Map();
  const music = { playing: false, step: 0, nextTime: 0, timer: 0, intensity: 0 };

  function ensure() {
    if (ctx) return ctx.state === 'running';
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return false;
    ctx = new Context();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -12;
    master.ratio.value = 6;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = soundOn ? 0.5 : 0;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? 0.32 : 0;
    musicBus.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx.state === 'running';
  }

  // Browsers only start audio after a click or key press; call this from one.
  function unlock() {
    ensure();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  }

  // Skips a sound that played less than `gap` seconds ago (many identical sounds at once just get loud).
  function throttle(name, gap) {
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(name) ?? -1) < gap) return false;
    lastPlayed.set(name, now);
    return true;
  }

  function tone({ type = 'sine', from, to = from, time = 0.1, volume = 0.3, at = 0, bus = sfxBus, attack = 0.004 }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + time);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + time);
    osc.connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + time + 0.02);
  }

  function hiss({ time = 0.2, volume = 0.3, from = 4000, to = 400, q = 1, type = 'lowpass', at = 0, bus = sfxBus }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + time);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + time);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + time + 0.02);
  }

  const EXPLOSION_PITCH = { mote: 1.2, seeker: 1.4, dodger: 1.1, splitter: 0.8, splinter: 1.6, charger: 0.9, spitter: 0.7, warden: 0.4 };
  let shardChain = 0, shardAt = 0;

  const sounds = {
    shoot() {
      if (!throttle('shoot', 0.05)) return;
      tone({ type: 'square', from: 880 + Math.random() * 60, to: 220, time: 0.06, volume: 0.05 });
    },
    hit() {
      if (!throttle('hit', 0.03)) return;
      tone({ type: 'triangle', from: 600, to: 300, time: 0.05, volume: 0.1 });
    },
    kill({ enemy, silent, boss }) {
      if (silent || !throttle('kill', 0.025)) return;
      const pitch = EXPLOSION_PITCH[enemy] ?? 1;
      hiss({ time: boss ? 1.6 : 0.28, volume: boss ? 0.9 : 0.35, from: 3500 * pitch, to: 150 });
      tone({ type: 'sine', from: 180 * pitch, to: 45, time: boss ? 1.2 : 0.18, volume: boss ? 0.7 : 0.25 });
    },
    spawn({ boss }) {
      if (boss) { tone({ type: 'sawtooth', from: 55, to: 110, time: 1.6, volume: 0.25, attack: 0.5 }); return; }
      if (!throttle('spawn', 0.12)) return;
      tone({ type: 'sine', from: 300, to: 700, time: 0.18, volume: 0.05, attack: 0.08 });
    },
    shard() {
      const now = ctx.currentTime;
      shardChain = now - shardAt < 0.5 ? Math.min(shardChain + 1, 24) : 0;
      shardAt = now;
      if (!throttle('shard', 0.02)) return;
      tone({ type: 'sine', from: 660 * 2 ** (shardChain / 12), time: 0.08, volume: 0.1 });
    },
    power() {
      [0, 4, 7, 12].forEach((semi, i) => tone({ type: 'triangle', from: 523 * 2 ** (semi / 12), time: 0.14, volume: 0.18, at: i * 0.05 }));
    },
    dash() {
      hiss({ time: 0.18, volume: 0.25, from: 800, to: 5000, type: 'bandpass', q: 2 });
    },
    bomb() {
      hiss({ time: 1.4, volume: 0.9, from: 6000, to: 60 });
      tone({ type: 'sine', from: 120, to: 30, time: 1.2, volume: 0.8 });
    },
    playerDeath() {
      hiss({ time: 1.2, volume: 0.9, from: 2500, to: 60 });
      tone({ type: 'sawtooth', from: 400, to: 40, time: 0.9, volume: 0.35 });
    },
    respawn() {
      tone({ type: 'sine', from: 220, to: 880, time: 0.4, volume: 0.2, attack: 0.1 });
    },
    enemyShot() {
      if (!throttle('enemyShot', 0.06)) return;
      tone({ type: 'sine', from: 240, to: 160, time: 0.12, volume: 0.1 });
    },
    shotPop() {
      if (!throttle('shotPop', 0.04)) return;
      tone({ type: 'triangle', from: 900, to: 1400, time: 0.05, volume: 0.07 });
    },
    charge() {
      hiss({ time: 0.3, volume: 0.2, from: 500, to: 2500, type: 'bandpass', q: 4 });
    },
    wave({ boss }) {
      const root = boss ? 110 : 220;
      [0, 7, 12].forEach((semi, i) => tone({ type: 'sawtooth', from: root * 2 ** (semi / 12), time: 0.5, volume: 0.07, at: i * 0.07, attack: 0.02 }));
    },
    extraLife() {
      [0, 4, 7, 12, 16].forEach((semi, i) => tone({ type: 'square', from: 659 * 2 ** (semi / 12), time: 0.12, volume: 0.1, at: i * 0.07 }));
    },
    extraBomb() {
      [0, 7, 12].forEach((semi, i) => tone({ type: 'square', from: 440 * 2 ** (semi / 12), time: 0.12, volume: 0.1, at: i * 0.07 }));
    },
    gameOver() {
      [12, 7, 3, 0].forEach((semi, i) => tone({ type: 'triangle', from: 220 * 2 ** (semi / 12), time: 0.5, volume: 0.2, at: i * 0.22 }));
    },
    click() {
      tone({ type: 'triangle', from: 1200, to: 900, time: 0.04, volume: 0.08 });
    }
  };

  function play(name, event = {}) {
    if (!ctx || ctx.state !== 'running' || !soundOn) return;
    sounds[name]?.(event);
  }

  // ---- Music: 16th-note steps at 124 bpm over a four-chord loop in A minor ----
  const BPM = 124;
  const STEP = 60 / BPM / 4;
  const ROOTS = [45, 41, 48, 43]; // A2, F2, C3, G2 (MIDI)
  const CHORDS = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12]];
  const midi = n => 440 * 2 ** ((n - 69) / 12);

  function scheduleStep(step, t) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const root = ROOTS[bar];
    const level = music.intensity;
    const at = t - ctx.currentTime;
    if (s % 4 === 0) tone({ type: 'sine', from: 150, to: 40, time: 0.22, volume: 0.9, at, bus: musicBus });
    if (s % 2 === 0) tone({ type: 'sawtooth', from: midi(root + (s % 8 === 6 ? 12 : 0)), time: STEP * 1.6, volume: 0.16, at, bus: musicBus, attack: 0.01 });
    if (s % 4 === 2) hiss({ time: 0.05, volume: 0.12, from: 9000, to: 6000, type: 'highpass', at, bus: musicBus });
    if (level >= 1 && s % 8 === 4) hiss({ time: 0.16, volume: 0.25, from: 3000, to: 900, type: 'bandpass', q: 0.8, at, bus: musicBus });
    if (level >= 2) {
      const chord = CHORDS[bar];
      tone({ type: 'square', from: midi(root + 24 + chord[s % 4]), time: STEP * 0.9, volume: 0.035, at, bus: musicBus });
    }
  }

  function pump() {
    if (!music.playing || !ctx) return;
    while (music.nextTime < ctx.currentTime + 0.12) {
      scheduleStep(music.step, music.nextTime);
      music.step += 1;
      music.nextTime += STEP;
    }
  }

  function startMusic() {
    if (!ensure() || music.playing) return;
    music.playing = true;
    music.step = 0;
    music.nextTime = ctx.currentTime + 0.05;
    music.timer = setInterval(pump, 25);
  }

  function stopMusic() {
    music.playing = false;
    clearInterval(music.timer);
  }

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    // 0: kick, bass and hats; 1 adds a snare; 2 adds the arpeggio.
    setIntensity(level) { music.intensity = level; },
    setSound(on) { soundOn = on; if (sfxBus) sfxBus.gain.value = on ? 0.5 : 0; },
    setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.value = on ? 0.32 : 0; },
    // Silences everything (music included, which also stops advancing) while the game is paused.
    setPaused(paused) { if (ctx) (paused ? ctx.suspend() : ctx.resume()).catch(() => {}); }
  };
}
