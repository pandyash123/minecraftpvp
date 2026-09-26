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

    /** A random id for this browser tab, sent with every join so the server
     * can carry coins/upgrades across the trip into a duel and back. */
    session() {
      if (this._session) return this._session;
      let id = null;
      try { id = sessionStorage.getItem('mc_session'); } catch (e) { /* storage blocked */ }
      if (!id) {
        id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        try { sessionStorage.setItem('mc_session', id); } catch (e) { /* storage blocked - lasts for this page only */ }
      }
      this._session = id;
      return id;
    }

    /** `ns` is the socket.io namespace to join - the main arena by default,
     * or a private duel room's (see the server's duel section). */
    connect(name, kit, customItems, enchantOpts, armor, swordTier, axeTier, dogArmor, trims, arena, arrowTip, ns) {
      return new Promise((resolve, reject) => {
        const socket = io(ns || '/', { transports: ['websocket', 'polling'], forceNew: true });
        const session = this.session();
        this.socket = socket;
        const timeout = setTimeout(() => reject(new Error('Connection timed out')), 12000);

        socket.on('connect', () => {
          this.connected = true;
          socket.emit('join', { name, kit, customItems, enchantOpts, armor, swordTier, axeTier, dogArmor, trims, arena, arrowTip, session }, () => {
            clearTimeout(timeout);
          });
        });

        socket.on('init', data => { clearTimeout(timeout); resolve(data); });
        socket.on('connect_error', err => { clearTimeout(timeout); reject(err); });
        socket.on('duelDenied', () => { clearTimeout(timeout); reject(new Error('That duel is no longer available')); });

        const events = ['playerJoin', 'playerLeave', 'spawned', 'respawn', 'teleport', 'hurt', 'heal',
          'killreward', 'hp', 'death', 'block', 'snapshot', 'projectile', 'projectileGone', 'swing',
          'hitmarker', 'arrowHit', 'effect', 'scores', 'chat', 'ammo', 'shieldStun', 'launch',
          'effects', 'weather', 'elytraUnlocked', 'itemUnlocked', 'wolfSpawn', 'wolfHp', 'wolfDeath', 'wolfTeleport', 'shopState',
          'creeperSpawn', 'creeperState', 'creeperDeath',
          'duelInvite', 'duelStart', 'duelEnd', 'duelReturn',
          // worldReset was missing here, so game.js's listener for it never
          // fired and an in-game terrain reset (or arena change) left
          // everyone still rendering the old map.
          'worldReset'];
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
    spawnMob() { if (this.socket) this.socket.emit('spawnMob'); }
    chat(text) { if (this.socket) this.socket.emit('chat', text); }
    shopBuy(key) { if (this.socket) this.socket.emit('shopBuy', key); }
    shopBuyItem(key) { if (this.socket) this.socket.emit('shopBuyItem', key); }
    duelRequest(d) { if (this.socket) this.socket.emit('duelRequest', d); }
    duelAnswer(d) { if (this.socket) this.socket.emit('duelAnswer', d); }
  }

  global.MCNet = Net;
})(window);
