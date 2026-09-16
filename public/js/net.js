/* Thin wrapper around the socket.io client with a tiny event-bus feel. */
(function (global) {
  'use strict';

  class Net {
    constructor() {
      this.socket = null;
      this.handlers = {};
      this.ping = 0;
      this.connected = false;
      this._pingTimer = null;
    }

    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); return this; }
    emit2(evt, data) { (this.handlers[evt] || []).forEach(fn => fn(data)); }

    connect(name, kit, customItems, enchantOpts, armor, swordTier, axeTier) {
      return new Promise((resolve, reject) => {
        const socket = io({ transports: ['websocket', 'polling'] });
        this.socket = socket;
        const timeout = setTimeout(() => reject(new Error('Connection timed out')), 12000);

        socket.on('connect', () => {
          this.connected = true;
          socket.emit('join', { name, kit, customItems, enchantOpts, armor, swordTier, axeTier }, () => {
            clearTimeout(timeout);
          });
        });

        socket.on('init', data => { clearTimeout(timeout); resolve(data); });
        socket.on('connect_error', err => { clearTimeout(timeout); reject(err); });

        const events = ['playerJoin', 'playerLeave', 'spawned', 'respawn', 'teleport', 'hurt', 'heal',
          'killreward', 'hp', 'death', 'block', 'snapshot', 'projectile', 'projectileGone', 'swing',
          'hitmarker', 'arrowHit', 'effect', 'scores', 'chat', 'ammo', 'shieldStun', 'launch',
          'effects', 'weather', 'elytraUnlocked'];
        for (const e of events) socket.on(e, data => this.emit2(e, data));

        socket.on('disconnect', reason => this.emit2('disconnected', reason));

        this._pingLoop();
      });
    }

    /**
     * Tears down the current session so connect() can be called again
     * cleanly (leaving to the menu and playing another round) without
     * leaking socket listeners or the ping interval. Deliberately does NOT
     * clear `handlers` - game.js wires its net.on(...) callbacks exactly
     * once on this persistent Net instance (see Game._wired) and expects
     * them to keep working across a reconnect; wiping them here would leave
     * every future session's server events silently going nowhere.
     */
    disconnect() {
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      if (this.socket) { this.socket.removeAllListeners(); this.socket.disconnect(); this.socket = null; }
      this.connected = false;
      this.ping = 0;
    }

    _pingLoop() {
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => {
        if (!this.socket || !this.connected) return;
        const t0 = performance.now();
        this.socket.emit('ping', t0, () => { this.ping = performance.now() - t0; });
      }, 2000);
    }

    sendState(s) { if (this.socket) this.socket.volatile.emit('state', s); }
    attack(id, ids, charged) { if (this.socket) this.socket.emit('attack', Object.assign(ids ? { ids } : { id }, charged ? { charged: true } : null)); }
    swing() { if (this.socket) this.socket.emit('swing'); }
    shoot(dx, dy, dz, power, firework) { if (this.socket) this.socket.emit('shoot', { dx, dy, dz, power, firework: !!firework }); }
    eat() { if (this.socket) this.socket.emit('eat'); }
    setBlock(x, y, z, id) { if (this.socket) this.socket.emit('setBlock', { x, y, z, id }); }
    ignite(x, y, z) { if (this.socket) this.socket.emit('ignite', { x, y, z }); }
    hitCrystal(x, y, z) { if (this.socket) this.socket.emit('hitCrystal', { x, y, z }); }
    chargeAnchor(x, y, z) { if (this.socket) this.socket.emit('chargeAnchor', { x, y, z }); }
    hitAnchor(x, y, z) { if (this.socket) this.socket.emit('hitAnchor', { x, y, z }); }
    chat(text) { if (this.socket) this.socket.emit('chat', text); }
  }

  global.MCNet = Net;
})(window);
