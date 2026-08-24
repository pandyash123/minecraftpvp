/* Tiny procedural sound engine — every effect is synthesized, no audio files. */
(function (global) {
  'use strict';

  class Sound {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = true;
    }

    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }

    resume() { this.ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); }

    noiseBuffer(dur) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, Math.max(1, (dur * ctx.sampleRate) | 0), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    thump(freq, dur, vol, type) {
      if (!this.enabled) return; this.ensure();
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    noise(dur, vol, filterFreq, type) {
      if (!this.enabled) return; this.ensure();
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(dur);
      const filt = ctx.createBiquadFilter();
      filt.type = type || 'bandpass';
      filt.frequency.value = filterFreq || 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filt); filt.connect(gain); gain.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    swing() { this.noise(0.08, 0.18, 2200, 'highpass'); }
    hit() { this.noise(0.12, 0.5, 900, 'bandpass'); this.thump(180, 0.1, 0.25, 'square'); }
    hitCrit() { this.hit(); this.thump(500, 0.14, 0.2, 'triangle'); }
    shoot() { this.noise(0.1, 0.3, 3000, 'highpass'); this.thump(220, 0.12, 0.2, 'sawtooth'); }
    arrowHit() { this.noise(0.06, 0.25, 1800, 'bandpass'); }
    draw() { this.noise(0.05, 0.05, 4000, 'highpass'); }
    pearl() { this.thump(700, 0.2, 0.25, 'sine'); this.noise(0.15, 0.2, 2600, 'bandpass'); }
    eat() { this.noise(0.06, 0.2, 1500, 'bandpass'); this.thump(300, 0.06, 0.15, 'square'); }
    jump() { this.thump(260, 0.08, 0.12, 'sine'); }
    land() { this.noise(0.08, 0.2, 500, 'lowpass'); }
    place() { this.noise(0.07, 0.3, 700, 'lowpass'); }
    breakBlock() { this.noise(0.18, 0.35, 550, 'lowpass'); }
    hurtSelf() { this.thump(140, 0.25, 0.35, 'sawtooth'); this.noise(0.2, 0.3, 700, 'bandpass'); }
    block() { this.noise(0.1, 0.35, 1400, 'bandpass'); this.thump(240, 0.12, 0.3, 'square'); }
    shieldBreak() { this.noise(0.22, 0.4, 1000, 'bandpass'); this.thump(160, 0.28, 0.35, 'sawtooth'); this.thump(90, 0.3, 0.25, 'square'); }
    death() { this.thump(120, 0.5, 0.4, 'sawtooth'); }
    kill() { this.thump(660, 0.12, 0.25, 'sine'); this.thump(880, 0.16, 0.22, 'sine'); }
    click() { this.noise(0.03, 0.15, 3500, 'highpass'); }
    splash() { this.noise(0.2, 0.2, 1200, 'bandpass'); }
    smash() { this.thump(90, 0.28, 0.4, 'square'); this.noise(0.2, 0.4, 400, 'lowpass'); }
    windBurst() { this.noise(0.28, 0.3, 2000, 'bandpass'); this.thump(340, 0.2, 0.22, 'sine'); }
    thunder() {
      this.noise(0.05, 0.5, 4000, 'highpass');
      this.thump(90, 0.9, 0.4, 'sawtooth');
      this.noise(1.1, 0.35, 220, 'lowpass');
    }
    fuse() { this.noise(0.05, 0.18, 5500, 'highpass'); }
    ignite() { this.noise(0.35, 0.3, 2800, 'bandpass'); this.thump(200, 0.3, 0.18, 'sawtooth'); }
    explosion() {
      this.noise(0.08, 0.55, 3200, 'highpass');
      this.thump(70, 0.7, 0.5, 'sawtooth');
      this.noise(0.9, 0.45, 260, 'lowpass');
    }
    totem() {
      this.thump(500, 0.3, 0.3, 'sine');
      this.thump(750, 0.35, 0.25, 'sine');
      this.noise(0.4, 0.25, 3000, 'bandpass');
    }
    fireworkLaunch() { this.noise(0.15, 0.25, 4000, 'highpass'); this.thump(260, 0.25, 0.2, 'sawtooth'); }
    fireworkExplode() {
      this.noise(0.06, 0.4, 3800, 'highpass');
      this.thump(180, 0.35, 0.3, 'square');
      this.noise(0.3, 0.2, 1400, 'bandpass');
    }
    crystal() {
      this.noise(0.1, 0.5, 4500, 'highpass');
      this.thump(120, 0.6, 0.4, 'sawtooth');
      this.thump(900, 0.3, 0.2, 'sine');
      this.noise(0.6, 0.3, 2000, 'bandpass');
    }
  }

  global.MCSound = new Sound();
})(window);
