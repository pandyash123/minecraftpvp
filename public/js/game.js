/* Main game loop: input, prediction, networking glue, HUD, rendering. */
(function (global) {
  'use strict';

  const MC = global.MCBlocks;
  const Physics = global.MCPhysics;
  const W = MC.WORLD, ID = MC.ID, PHYS = MC.PHYS, C = MC.COMBAT;
  const ITEMS = MC.ITEMS;
  const CH = W.CHUNK;
  const TAU = Math.PI * 2;
  const EFFECT_NAME = { strength: 'Strength', speed: 'Speed', slowness: 'Slowness', resistance: 'Resistance', fireResistance: 'Fire Resistance', regeneration: 'Regeneration' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  // Which potion's icon represents each active-effect kind in the HUD -
  // Slowness/Resistance both come from Turtle Master, the only potion that
  // grants either.
  const EFFECT_ICON_KEY = { strength: 'pot_strength', speed: 'pot_speed', slowness: 'pot_turtle', resistance: 'pot_turtle', fireResistance: 'pot_fireres' };


  const el = id => document.getElementById(id);

  class Game {
    constructor() {
      this.canvas = el('view');
      this.hud = {
        hearts: el('hearts'),
        hotbar: el('hotbar'), scoreboard: el('scoreboardBody'),
        chatLog: el('chatLog'), chatInput: el('chatInput'),
        deathScreen: el('deathScreen'), deathText: el('deathText'), respawnTimer: el('respawnTimer'),
        crosshair: el('crosshair'), hint: el('hint'), loading: el('loading'), loadingBar: el('loadingBar'),
        killfeed: el('killfeed'), ammo: el('ammoText'), fps: el('fps'), ping: el('pingText'), viewModeBtn: el('viewModeBtn'),
        chargeWrap: el('chargeWrap'), chargeFill: el('chargeFill'),
        menu: el('menu'), nameInput: el('nameInput'), playBtn: el('playBtn'), botsInput: el('botsInput'),
        kitSelect: el('kitSelect'), botKitSelect: el('botKitSelect'),
        botWeaponSelect: el('botWeaponSelect'), botTeamCheck: el('botTeamCheck'), botHacksCheck: el('botHacksCheck'),
        difficultySelect: el('difficultySelect'), armorSelect: el('armorSelect'), dummyCheck: el('dummyCheck'),
        dummyShieldCheck: el('dummyShieldCheck'),
        atkDummyCheck: el('atkDummyCheck'), dmgNumbersCheck: el('dmgNumbersCheck'), resetTerrainBtn: el('resetTerrainBtn'), resetTerrainMsg: el('resetTerrainMsg'),
        inventory: el('inventory'), mainInventory: el('mainInventory'), invHotbar: el('invHotbar'),
        pauseMenu: el('pauseMenu'), resumeBtn: el('resumeBtn'), leaveBtn: el('leaveBtn'),
        customLoadoutCheck: el('customLoadoutCheck'), customItemsList: el('customItemsList'),
        netheriteArmorCheck: el('netheriteArmorCheck'), netheriteSwordCheck: el('netheriteSwordCheck'), netheriteAxeCheck: el('netheriteAxeCheck'),
        dogArmorCheck: el('dogArmorCheck'),
        enchantList: el('enchantList'),
        effectsBar: el('effectsBar'),
        trimsBtn: el('trimsBtn'), trimEditor: el('trimEditor'), trimCanvas: el('trimCanvas'),
        trimTabArmor: el('trimTabArmor'), trimTabShield: el('trimTabShield'), trimPalette: el('trimPalette'),
        trimBrushRow: el('trimBrushRow'), trimClearBtn: el('trimClearBtn'), trimExportBtn: el('trimExportBtn'),
        trimImportBtn: el('trimImportBtn'), trimImportInput: el('trimImportInput'), trimCloseBtn: el('trimCloseBtn')
      };
      this.inventoryOpen = false;
      this.heartNodes = []; // cached <canvas> elements so we only redraw what changed
      this.activeEffects = {}; // kind -> {level, until (performance.now() ms)}

      this.net = new global.MCNet();
      this.world = null;
      this.renderer = null;

      this.me = null;               // {id, x,y,z,vx,vy,vz,yaw,pitch,onGround,...}
      this.remote = new Map();      // id -> remote player render state
      this.wolves = new Map();      // id -> {id, ownerId, name, x,y,z,yaw, health, maxHealth, alive, hasArmor}
      this.projectiles = new Map();
      this.particlesMeta = [];      // {x,y,z,vx,vy,vz,r,g,b,a,size,life}
      this._groundFires = [];       // {x,y,z,until} - cosmetic only, see 'groundfire' effect
      this._damageNumbers = [];     // {x,y,z,node,born} - floating hit numbers, see _spawnDamageNumber()

      this.keys = {};
      this.mouseDown = { left: false, right: false };
      this.rightDownAt = 0;
      this.pointerLocked = false;
      this.yaw = 0; this.pitch = 0;

      this.mining = null;           // {x,y,z,block,progress}
      this.lastPlaceAt = 0;
      this.swingT = 0;
      this.bobPhase = 0;
      this.deadUntilRespawn = false;
      this.lastAttackClient = 0;
      this.hitmarkerT = 0;
      this.killfeedItems = [];
      this.scores = [];
      this.selfName = '';
      this.shieldStunUntil = 0;
      this._hasEverLocked = false;
      this._wired = false;
      this._running = false;

      // Which ruleset (see MC.KITS) - chosen at the menu. hotbarSlots (9) and
      // backpackSlots (27) each hold a logical ITEMS index or null (empty);
      // together they're the pool of items your kit gives you, freely
      // rearranged by drag-and-drop in the inventory screen. `me.slot` (sent
      // to the server, indexed everywhere else in this file) is always a
      // logical ITEMS index for whichever item is currently equipped,
      // wherever it happens to physically sit right now.
      this.kit = 'web';
      this.hotbarSlots = [];
      this.backpackSlots = [];

      this._frame = this._frame.bind(this);
      this._bindMenu();
    }

    /** Fills hotbarSlots/backpackSlots fresh for a new session: every item
     * the chosen kit (or, in custom-loadout mode, every item the player
     * checked in the menu's item list) starts equipped (hotbar), backpack
     * starts empty. Fewer than 9 items just leaves trailing hotbar slots
     * empty. */
    _initInventorySlots(kitKey, customItemKeys, swordTier, axeTier) {
      this.kit = MC.KITS[kitKey] ? kitKey : 'web';
      let itemKeys = customItemKeys && customItemKeys.length ? customItemKeys : MC.KITS[this.kit].items;
      // netherite_sword/netherite_axe are a tier swap on top of sword/axe
      // (see the menu's checkboxes), not a separate item picked alongside
      // them - swap the key in place so the hotbar only ever shows one.
      if (swordTier === 'netherite') itemKeys = itemKeys.map(k => k === 'sword' ? 'netherite_sword' : k);
      if (axeTier === 'netherite') itemKeys = itemKeys.map(k => k === 'axe' ? 'netherite_axe' : k);
      const indices = itemKeys.map(key => ITEMS.findIndex(i => i.key === key)).filter(idx => idx !== -1);
      this.hotbarSlots = new Array(9).fill(null);
      this.backpackSlots = new Array(27).fill(null);
      // A loadout can grant more than 9 items - anything past the hotbar
      // spills into the backpack instead of being silently dropped, same as
      // picking up more than a full hotbar's worth of gear.
      let bp = 0;
      indices.forEach((idx, i) => {
        if (i < 9) this.hotbarSlots[i] = idx;
        else if (bp < this.backpackSlots.length) this.backpackSlots[bp++] = idx;
      });
    }

    // ---------------------------------------------------------- bootstrap --
    _bindMenu() {
      const saved = localStorage.getItem('mc_name');
      if (saved) this.hud.nameInput.value = saved;
      const savedKit = localStorage.getItem('mc_kit');
      if (savedKit && this.hud.kitSelect) this.hud.kitSelect.value = savedKit;
      this.hud.playBtn.addEventListener('click', () => this._startFromMenu());
      this.hud.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') this._startFromMenu(); });
      this.hud.resetTerrainBtn.addEventListener('click', () => this._resetTerrainFromMenu());
      this._buildCustomItemsMenu();
      this._buildEnchantMenu();
      this._wireTrimEditor();
    }

    /**
     * Builds the Enchantments panel straight from MC.ENCHANT_DEFS, grouped
     * by which slot each enchant applies to - adding a new enchant there is
     * the only step needed to expose it here too, same auto-updating idea
     * as the custom item loadout list above.
     */
    _buildEnchantMenu() {
      const list = this.hud.enchantList;
      if (!list) return;
      const SLOT_TITLE = { armor: 'Armor', sword: 'Sword', axe: 'Axe', bow: 'Bow', trident: 'Trident', stick: 'Stick', pick: 'Pickaxe', mace: 'Mace' };
      list.innerHTML = '';
      for (const slot in MC.ENCHANT_DEFS) {
        const group = document.createElement('div');
        group.className = 'enchantgroup';
        const h3 = document.createElement('h3');
        h3.textContent = SLOT_TITLE[slot] || slot;
        group.appendChild(h3);
        for (const def of MC.ENCHANT_DEFS[slot]) {
          const label = document.createElement('label');
          label.className = 'checkline';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = def.def;
          box.dataset.slot = slot;
          box.dataset.key = def.key;
          label.appendChild(box);
          label.appendChild(document.createTextNode(' ' + def.name));
          group.appendChild(label);
        }
        list.appendChild(group);
      }
    }

    /** Every enchant checkbox's current state, structured as
     * {slot: {key: bool}} - exactly what the server's mergeEnchantOpts expects. */
    _enchantOptsFromMenu() {
      const out = {};
      if (!this.hud.enchantList) return out;
      for (const box of this.hud.enchantList.querySelectorAll('input[type=checkbox]')) {
        (out[box.dataset.slot] || (out[box.dataset.slot] = {}))[box.dataset.key] = box.checked;
      }
      return out;
    }

    /**
     * The pixel-art armor/shield trim editor, opened from the main menu.
     * Fully self-contained: two 16x16 color-index grids (armor/shield),
     * auto-saved to localStorage on every stroke (see loadTrim/saveTrim) so
     * a returning player's trim just applies without re-importing anything,
     * plus an explicit export/import round-trip through a downloaded .json
     * file for moving a trim to another browser or device.
     */
    _wireTrimEditor() {
      const hud = this.hud;
      if (!hud.trimsBtn) return;
      const GRID = MC.TRIM_GRID;
      const CELL = hud.trimCanvas.width / GRID; // 320/16 = 20px/cell
      const ctx = hud.trimCanvas.getContext('2d');
      this._trimGrids = { armor: null, shield: null };
      this._trimTarget = 'armor';
      this._trimColor = 1; // index into MC.TRIM_PALETTE - starts on the first real color
      this._trimBrush = 1;

      const blank = () => new Array(MC.TRIM_CELLS).fill(0);
      const keyFor = target => target === 'shield' ? 'mcpvp_shieldTrim' : 'mcpvp_armorTrim';
      const gridFor = target => this._trimGrids[target] || (this._trimGrids[target] = loadTrim(keyFor(target)) || blank());

      const draw = () => {
        const grid = gridFor(this._trimTarget);
        ctx.clearRect(0, 0, hud.trimCanvas.width, hud.trimCanvas.height);
        for (let ty = 0; ty < GRID; ty++) {
          for (let tx = 0; tx < GRID; tx++) {
            const idx = grid[ty * GRID + tx];
            // A faint checkerboard for "no paint" cells - same idea as any
            // image editor's transparency grid, so an empty cell reads as
            // "nothing painted here" rather than looking like solid black.
            ctx.fillStyle = idx ? MC.TRIM_PALETTE[idx] : ((tx + ty) % 2 ? '#3a3a3a' : '#333');
            ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
          }
        }
      };

      // Palette swatches, built straight from MC.TRIM_PALETTE (index 0 gets
      // its own "eraser" swatch instead of a color chip).
      hud.trimPalette.innerHTML = '';
      for (let i = 0; i < MC.TRIM_PALETTE.length; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'trimSwatch' + (i === 0 ? ' eraser' : '') + (i === this._trimColor ? ' active' : '');
        if (i > 0) btn.style.background = MC.TRIM_PALETTE[i];
        btn.title = i === 0 ? 'Eraser' : 'Color ' + i;
        btn.addEventListener('click', () => {
          this._trimColor = i;
          hud.trimPalette.querySelectorAll('.trimSwatch').forEach(s => s.classList.remove('active'));
          btn.classList.add('active');
        });
        hud.trimPalette.appendChild(btn);
      }

      hud.trimBrushRow.querySelectorAll('.brushBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._trimBrush = parseInt(btn.dataset.size, 10) || 1;
          hud.trimBrushRow.querySelectorAll('.brushBtn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      const setTarget = target => {
        this._trimTarget = target;
        hud.trimTabArmor.classList.toggle('active', target === 'armor');
        hud.trimTabShield.classList.toggle('active', target === 'shield');
        draw();
      };
      hud.trimTabArmor.addEventListener('click', () => setTarget('armor'));
      hud.trimTabShield.addEventListener('click', () => setTarget('shield'));

      // Paints a brush-sized square of cells centered on (cx,cy), clipped to
      // the grid edges - "diameter N" meaning an NxN block of cells, same
      // brush-size request as the palette above.
      const paintAt = (cx, cy) => {
        const grid = gridFor(this._trimTarget);
        const half = (this._trimBrush - 1) / 2;
        const x0 = Math.round(cx - half), y0 = Math.round(cy - half);
        for (let dy = 0; dy < this._trimBrush; dy++) {
          for (let dx = 0; dx < this._trimBrush; dx++) {
            const x = x0 + dx, y = y0 + dy;
            if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
            grid[y * GRID + x] = this._trimColor;
          }
        }
        draw();
      };
      let painting = false;
      const cellFromEvent = e => {
        const rect = hud.trimCanvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width * hud.trimCanvas.width;
        const py = (e.clientY - rect.top) / rect.height * hud.trimCanvas.height;
        return [Math.floor(px / CELL), Math.floor(py / CELL)];
      };
      hud.trimCanvas.addEventListener('mousedown', e => { painting = true; paintAt(...cellFromEvent(e)); });
      hud.trimCanvas.addEventListener('mousemove', e => { if (painting) paintAt(...cellFromEvent(e)); });
      window.addEventListener('mouseup', () => {
        if (!painting) return;
        painting = false;
        // Auto-save on stroke release, not on the menu's Play click - this
        // is a standalone editor, so closing/switching tabs never loses
        // whatever was just painted.
        saveTrim(keyFor(this._trimTarget), this._trimGrids[this._trimTarget]);
      });

      hud.trimClearBtn.addEventListener('click', () => {
        this._trimGrids[this._trimTarget] = blank();
        saveTrim(keyFor(this._trimTarget), this._trimGrids[this._trimTarget]);
        draw();
      });

      hud.trimExportBtn.addEventListener('click', () => {
        // Bundles both grids into one file regardless of which tab is open -
        // a single download that's a complete backup of everything painted.
        const payload = { armorTrim: gridFor('armor'), shieldTrim: gridFor('shield') };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'mc-pvp-trims.json';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });

      hud.trimImportBtn.addEventListener('click', () => hud.trimImportInput.click());
      hud.trimImportInput.addEventListener('change', () => {
        const file = hud.trimImportInput.files[0];
        hud.trimImportInput.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            let imported = 0;
            if (MC.isValidTrim(data.armorTrim)) { this._trimGrids.armor = data.armorTrim; saveTrim(keyFor('armor'), data.armorTrim); imported++; }
            if (MC.isValidTrim(data.shieldTrim)) { this._trimGrids.shield = data.shieldTrim; saveTrim(keyFor('shield'), data.shieldTrim); imported++; }
            if (!imported) { alert('That file has no valid armor/shield trim in it.'); return; }
            draw();
          } catch (e) { alert('Could not read that file as a trim export.'); }
        };
        reader.readAsText(file);
      });

      hud.trimsBtn.addEventListener('click', () => { setTarget('armor'); hud.trimEditor.classList.remove('hidden'); });
      hud.trimCloseBtn.addEventListener('click', () => hud.trimEditor.classList.add('hidden'));
    }

    /**
     * Builds the "pick your own items" checklist straight from MC.ITEMS, so
     * it never needs touching again when a new item is added anywhere in
     * shared/blocks.js - it just shows up here next time the page loads.
     * Defaults every box to whatever the Web PvP kit already grants, so
     * switching into custom mode doesn't dump you with an empty loadout.
     */
    _buildCustomItemsMenu() {
      const list = this.hud.customItemsList;
      const check = this.hud.customLoadoutCheck;
      if (!list || !check) return;
      const defaults = new Set(MC.KITS.web.items);
      list.innerHTML = '';
      for (const item of ITEMS) {
        // Netherite sword/axe aren't independently selectable - they're a
        // tier swap on the regular sword/axe (see the checkboxes right
        // below this list), always exactly one of each in a loadout.
        if (item.key === 'netherite_sword' || item.key === 'netherite_axe') continue;
        // Elytra is locked behind the secret '/elytra257' chat command, not
        // a normal loadout pick - see net.on('elytraUnlocked', ...) below.
        if (item.key === 'elytra') continue;
        const label = document.createElement('label');
        label.className = 'checkline itemcheck';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = item.key;
        box.checked = defaults.has(item.key);
        label.appendChild(box);
        label.appendChild(document.createTextNode(' ' + item.name));
        list.appendChild(label);
      }
      const toggle = () => list.classList.toggle('hidden', !check.checked);
      check.addEventListener('change', toggle);
      toggle();
    }

    /** Every item key currently checked in the custom loadout list, or null
     * if custom mode isn't on (falls back to the kit dropdown as before). */
    _customItemsFromMenu() {
      if (!this.hud.customLoadoutCheck || !this.hud.customLoadoutCheck.checked) return null;
      return [...this.hud.customItemsList.querySelectorAll('input[type=checkbox]:checked')].map(b => b.value);
    }

    async _resetTerrainFromMenu() {
      const btn = this.hud.resetTerrainBtn, msg = this.hud.resetTerrainMsg;
      btn.disabled = true;
      msg.classList.remove('hidden');
      msg.textContent = 'Resetting...';
      let ok = false;
      try {
        const res = await fetch('/reset', { method: 'POST' });
        if (res.ok) {
          msg.textContent = 'Terrain reset.';
          ok = true;
        } else {
          // Surface the actual status/body instead of a bare "failed" - a 404
          // here almost always means the server process is still running
          // older code that predates this endpoint and needs a restart.
          const body = await res.text().catch(() => '');
          msg.textContent = 'Reset failed: HTTP ' + res.status + (res.status === 404 ? ' (server needs restarting)' : '') + (body ? ' - ' + body.slice(0, 150) : '');
          console.error('[Reset Terrain] server responded', res.status, body);
        }
      } catch (e) {
        msg.textContent = 'Reset failed: ' + e.message + ' (is the server running?)';
        console.error('[Reset Terrain] request threw', e);
      }
      btn.disabled = false;
      setTimeout(() => msg.classList.add('hidden'), ok ? 2500 : 10000);
    }

    _startFromMenu() {
      const name = (this.hud.nameInput.value || 'Player').trim().slice(0, 16) || 'Player';
      localStorage.setItem('mc_name', name);
      const kit = this.hud.kitSelect ? this.hud.kitSelect.value : 'web';
      localStorage.setItem('mc_kit', kit);
      this.selfName = name;
      const customItems = this._customItemsFromMenu();
      const enchantOpts = this._enchantOptsFromMenu();
      const armor = this.hud.netheriteArmorCheck && this.hud.netheriteArmorCheck.checked ? 'netherite' : 'diamond';
      const swordTier = this.hud.netheriteSwordCheck && this.hud.netheriteSwordCheck.checked ? 'netherite' : 'diamond';
      const axeTier = this.hud.netheriteAxeCheck && this.hud.netheriteAxeCheck.checked ? 'netherite' : 'diamond';
      const dogArmor = !!(this.hud.dogArmorCheck && this.hud.dogArmorCheck.checked);
      // Trims are edited from their own panel (see _wireTrimEditor), not
      // this menu form - they're read straight from localStorage here so
      // whatever was last saved just applies, no re-import needed each
      // session (see loadTrim()).
      const armorTrim = loadTrim('mcpvp_armorTrim');
      const shieldTrim = loadTrim('mcpvp_shieldTrim');
      this.hud.menu.classList.add('hidden');
      this.hud.loading.classList.remove('hidden');
      global.MCSound.resume();
      this.start(name, kit, customItems, enchantOpts, armor, swordTier, axeTier, dogArmor, armorTrim, shieldTrim).catch(err => {
        console.error(err);
        this.hud.loading.classList.add('hidden');
        this.hud.menu.classList.remove('hidden');
        alert('Failed to connect: ' + err.message);
      });
    }

    async start(name, kit, customItems, enchantOpts, armor, swordTier, axeTier, dogArmor, armorTrim, shieldTrim) {
      // Drives the armor-piece icon color in the inventory (see
      // _buildInventoryUI/_renderChestSlot) - the human player's own tier
      // isn't part of `this.me` (only remote players carry .armor, from
      // publicPlayer()), so it's tracked here instead.
      this.armorTier = armor === 'netherite' ? 'netherite' : 'diamond';
      // Same idea as armorTier above - our own trim isn't part of `this.me`
      // either, so it's tracked here for the third-person self-render and
      // the shield viewmodel (see render()/_drawViewmodel()).
      this.myArmorTrim = MC.isValidTrim(armorTrim) ? armorTrim : null;
      this.myShieldTrim = MC.isValidTrim(shieldTrim) ? shieldTrim : null;
      this._initInventorySlots(kit, customItems, swordTier, axeTier);
      // Kept purely for client-side-only cosmetics/pacing that don't need a
      // server round-trip (currently just the pickaxe's Efficiency V mining
      // speed) - combat-relevant enchants are already re-validated server-side
      // regardless of what this holds.
      this.myEnchants = enchantOpts || MC.defaultEnchantOpts();
      const init = await this.net.connect(name, this.kit, customItems, enchantOpts, armor, swordTier, axeTier, dogArmor, this.myArmorTrim, this.myShieldTrim);
      this.world = new global.MCWorld(init.seed);
      this.world.applyEdits(init.edits || []);
      // The WebGL context (and everything already uploaded into it - block
      // texture, cached skins) is reused across sessions; only the world's
      // chunk meshes need rebuilding below. Creating a second context on the
      // same canvas would leak GPU resources every time someone leaves to
      // the menu and plays again.
      if (!this.renderer) this.renderer = new global.MCRenderer(this.canvas);

      this.me = {
        id: init.id, name, x: init.spawn.x, y: init.spawn.y, z: init.spawn.z,
        vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, sneak: false, sprint: false,
        slot: 0, health: C.MAX_HEALTH, absorption: 0, alive: true, blocking: false
      };
      this.mySkin = null;
      this.yaw = this.me.yaw; this.pitch = 0;
      // Camera perspective: 0 = first person, 1 = third person (behind,
      // over-the-shoulder), 2 = third person front (selfie-style, looking
      // back at your own face) - cycled by F5 or the on-screen button, same
      // three-way toggle as vanilla Minecraft.
      this.viewMode = 0;
      this.selfWalkPhase = 0;
      this.ammo = init.ammo;
      this.weather = init.weather || 'clear';
      this.gliding = false;
      // Offhand: 'shield' (the default, no real inventory slot of its own)
      // or a firework/block/totem item key dragged there in the inventory
      // screen - see _wireOffhandDrag(). Synced to the server (the 'oh'
      // field in _sendState) since Totem of Undying only actually saves you
      // while equipped here, not just sitting in the backpack.
      this.offhand = 'shield';
      // Chest slot: 'chestplate' (default) or 'elytra' - right-click the
      // elytra (or drag it onto the chest armor slot in the inventory) to
      // swap it in. Synced via the 'ch' field in _sendState - wearing it
      // gives up the chestplate's defense/toughness (see server.js's
      // applyDamage), and gliding requires it to actually be worn here now,
      // not just held.
      this.chestSlot = 'chestplate';
      // Purely a local display preference (chosen at the menu) - floating
      // damage numbers for your own outgoing hits, see net.on('hitmarker').
      this.showDamageNumbers = !!(this.hud.dmgNumbersCheck && this.hud.dmgNumbersCheck.checked);

      this.remote.clear();
      for (const p of init.players) if (p.id !== this.me.id) this._ensureRemote(p);
      // Input/net handlers are wired to this persistent Game instance once
      // ever - re-wiring on every session would stack duplicate listeners
      // and fire everything N times after N replays.
      if (!this._wired) {
        this._wireNetEvents();
        this._wireInput();
        this._wired = true;
      }
      await this._buildInitialMeshes();

      const requestedBots = parseInt(this.hud.botsInput.value, 10);
      const difficulty = this.hud.difficultySelect ? this.hud.difficultySelect.value : 'normal';
      const botArmor = this.hud.armorSelect ? this.hud.armorSelect.value : 'diamond';
      const botKit = this.hud.botKitSelect ? this.hud.botKitSelect.value : 'web';
      const botWeapon = this.hud.botWeaponSelect ? this.hud.botWeaponSelect.value : 'fixed';
      if (requestedBots >= 0) this.net.chat('/bots ' + Math.max(0, Math.min(16, requestedBots)) + ' ' + difficulty + ' ' + botArmor + ' ' + botKit + ' ' + botWeapon);
      this.net.chat('/botteam ' + (this.hud.botTeamCheck && this.hud.botTeamCheck.checked ? 'on' : 'off'));
      this.net.chat('/bothacks ' + (this.hud.botHacksCheck && this.hud.botHacksCheck.checked ? 'on' : 'off'));
      if (this.hud.dummyCheck && this.hud.dummyCheck.checked) {
        const wantShield = !this.hud.dummyShieldCheck || this.hud.dummyShieldCheck.checked;
        this.net.chat('/dummy 1 ' + (wantShield ? 'shield' : 'noshield'));
      }
      if (this.hud.atkDummyCheck && this.hud.atkDummyCheck.checked) this.net.chat('/atkdummy 1');

      this.hud.loading.classList.add('hidden');
      this._buildHotbar();
      this._buildOffhandHUD();
      this._updateHealthUI();
      this._buildInventoryUI();
      this._log('Welcome, ' + name + '. WASD to move, mouse to look, click to lock pointer.');
      this.lastFrameTime = performance.now();
      this._running = true;
      this._rafId = requestAnimationFrame(this._frame);
    }

    /** Tears the current session down and returns to the pre-join menu,
     * leaving the renderer/GL context alive so Play can be clicked again. */
    _leaveToMenu() {
      this._running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      clearInterval(this._respawnInt);
      this.net.disconnect();
      document.exitPointerLock && document.exitPointerLock();
      this.hud.pauseMenu.classList.add('hidden');
      this.hud.deathScreen.classList.add('hidden');
      if (this.inventoryOpen) { this.inventoryOpen = false; this.hud.inventory.classList.add('hidden'); }

      this.remote.clear();
      this.projectiles.clear();
      this.particlesMeta.length = 0;
      this._groundFires.length = 0;
      for (const d of this._damageNumbers) d.node.remove();
      this._damageNumbers.length = 0;
      if (this._tags) { for (const t of this._tags.values()) t.node.remove(); this._tags.clear(); }
      this.hud.chatLog.innerHTML = '';
      this.killfeedItems = [];
      this._renderKillfeed();
      this.scores = [];
      this._renderScoreboard();

      this.keys = {};
      this.mouseDown = { left: false, right: false };
      this.mining = null;
      this.swingT = 0;
      this.bobPhase = 0;
      this.hitmarkerT = 0;
      this._shakeT = 0;
      this._flashT = 0;
      this.deadUntilRespawn = false;
      this._hasEverLocked = false;
      this.weather = 'clear';
      this._lightningFlashT = 0;
      this.gliding = false;
      this.offhand = 'shield';
      this.chestSlot = 'chestplate';

      this.me = null;
      this.world = null;
      this.hud.menu.classList.remove('hidden');
    }

    async _buildInitialMeshes() {
      const total = this.world.chunkCount;
      let done = 0;
      const cxN = W.SX / CH, czN = W.SZ / CH;
      for (let cz = 0; cz < czN; cz++) {
        for (let cx = 0; cx < cxN; cx++) {
          const idx = this.world.chunkIndex(cx, cz);
          const mesh = global.MCMesher.meshChunk(this.world, cx, cz);
          this.renderer.uploadChunk(idx, mesh);
          done++;
        }
        this.hud.loadingBar.style.width = Math.round((done / total) * 100) + '%';
        if (cz % 2 === 1) await nextFrame();
      }
      this.world.dirty.clear();
    }

    remeshDirty(budgetMs) {
      if (!this.world.dirty.size) return;
      const start = performance.now();
      const cxN = W.SX / CH;
      for (const idx of Array.from(this.world.dirty)) {
        this.world.dirty.delete(idx);
        const cx = idx % cxN, cz = (idx / cxN) | 0;
        const mesh = global.MCMesher.meshChunk(this.world, cx, cz);
        this.renderer.uploadChunk(idx, mesh);
        if (performance.now() - start > budgetMs) break;
      }
    }

    // --------------------------------------------------------------- net ---
    _wireNetEvents() {
      const net = this.net;
      net.on('playerJoin', p => { if (p.id !== this.me.id) { this._ensureRemote(p); this._log(p.name + ' joined'); } });
      net.on('playerLeave', d => {
        this.remote.delete(d.id);
        // Their nametag DOM node otherwise lingers forever on screen - only
        // _drawNameTag() ever adds one, nothing was ever removing it.
        if (this._tags) {
          const tag = this._tags.get(d.id);
          if (tag) { tag.node.remove(); this._tags.delete(d.id); }
        }
      });
      net.on('wolfSpawn', w => { this.wolves.set(w.id, w); });
      net.on('wolfHp', d => { const w = this.wolves.get(d.id); if (w) w.health = d.health; });
      net.on('wolfTeleport', d => { const w = this.wolves.get(d.id); if (w) { w.x = d.x; w.y = d.y; w.z = d.z; } });
      net.on('wolfDeath', d => {
        this.wolves.delete(d.id);
        // Same nametag-cleanup need as a player/bot leaving - see playerLeave above.
        if (this._tags) { const tag = this._tags.get(d.id); if (tag) { tag.node.remove(); this._tags.delete(d.id); } }
      });
      net.on('chat', m => this._log(m.system ? m.text : (m.name + ': ' + m.text), m.system));
      net.on('scores', s => {
        this.scores = s; this._renderScoreboard();
        // Armor tier isn't part of the high-frequency snapshot (it almost
        // never changes), so this is how a live /botarmor change reaches
        // already-connected clients' 3D rendering without a refresh.
        for (const sc of s) { const r = this.remote.get(sc.id); if (r) r.armor = sc.armor || 'none'; }
      });
      net.on('block', d => {
        this.world.set(d.x, d.y, d.z, d.id);
        if (d.by !== this.me.id) { /* remote edit */ }
      });
      net.on('worldReset', async d => {
        // Someone hit "Reset Terrain" (possibly this same player, from
        // another tab) while this session was already live - rebuild the
        // whole world model and every chunk mesh from scratch.
        this.world = new global.MCWorld(d.seed);
        await this._buildInitialMeshes();
        this._log('The terrain was reset.', true);
      });
      net.on('respawn', d => {
        this.me.x = d.x; this.me.y = d.y; this.me.z = d.z;
        this.me.vx = this.me.vy = this.me.vz = 0;
        this.me.alive = true;
        this.me.health = d.health === undefined ? C.MAX_HEALTH : d.health;
        this.me.absorption = d.absorption === undefined ? 0 : d.absorption;
        this.me.blocking = false;
        this.shieldStunUntil = 0;
        this.deadUntilRespawn = false;
        this.hud.deathScreen.classList.add('hidden');
        this._updateHealthUI();
        this._requestPointerLock();
      });
      net.on('shieldStun', d => {
        this.shieldStunUntil = performance.now() + (d.duration || 0) * 1000;
        this.me.blocking = false;
      });
      net.on('teleport', d => { this.me.x = d.x; this.me.y = d.y; this.me.z = d.z; this.me.vx = this.me.vy = this.me.vz = 0; });
      // Server-authoritative movement kick for effects the server decides
      // (mace Wind Burst launch, spear Lunge dash, wind charge self-launch) -
      // additive horizontally, "raise the floor" vertically, same shape as
      // the kb handling in 'hurt' below.
      net.on('launch', d => {
        if (!this.me) return;
        if (d.vx) { this.me.vx += d.vx; this._lungeLockUntil = performance.now() + 250; }
        if (d.vz) { this.me.vz += d.vz; this._lungeLockUntil = performance.now() + 250; }
        if (d.vy !== undefined) this.me.vy = Math.max(this.me.vy, d.vy);
      });
      net.on('spawned', d => { const r = this.remote.get(d.id); if (r) { r.x = r.tx = d.x; r.y = r.ty = d.y; r.z = r.tz = d.z; r.alive = true; } });
      net.on('hurt', d => {
        this.me.health = d.health; this.me.absorption = d.absorption;
        this._updateHealthUI();
        // A shield-blocked hit already gets its own soft "clink" (see the
        // 'block' effect below) - the full red-flash/shake/grunt combo is
        // for damage that actually landed, so skip it here.
        if (!d.blocked) {
          global.MCSound.hurtSelf();
          this._flashDamage();
          this._shakeT = 0.28;
        }
        if (d.kb) { this.me.vx += d.kb.x * 6; this.me.vz += d.kb.z * 6; if (d.kb.y) this.me.vy = Math.min(10, Math.max(this.me.vy, d.kb.y * 9)); }
      });
      net.on('heal', d => {
        this.me.health = d.health; this.me.absorption = d.absorption;
        if (d.ammo) this.ammo = d.ammo;
        // A totem save consumes the one in the offhand - once its ammo runs
        // out there's nothing left to hold there, so fall back to the shield.
        if (this.offhand === 'totem' && (!this.ammo || !this.ammo.totem)) { this.offhand = 'shield'; this._renderOffhandSlot(); }
        this._updateHealthUI(); this._updateAmmoUI();
      });
      net.on('killreward', d => { this.me.health = d.health; this.ammo = d.ammo; this._updateHealthUI(); this._updateAmmoUI(); global.MCSound.kill(); });
      net.on('ammo', d => { this.ammo = d; this._updateAmmoUI(); });
      net.on('effects', d => this._applyEffectsSnapshot(d));
      net.on('hp', d => {
        if (d.id === this.me.id) { this.me.health = d.health; this.me.absorption = d.absorption; this._updateHealthUI(); }
        else { const r = this.remote.get(d.id); if (r) r.health = d.health; }
      });
      net.on('hitmarker', d => {
        this.hitmarkerT = 0.35;
        global.MCSound.hit();
        if (this.showDamageNumbers && d.dealt > 0) this._spawnDamageNumber(d.x, d.y, d.z, d.dealt);
      });
      net.on('arrowHit', () => global.MCSound.arrowHit());
      net.on('swing', d => { const r = this.remote.get(d.id); if (r) { r.swingT = 0.001; } });
      net.on('effect', d => this._spawnEffect(d));
      net.on('weather', d => { this.weather = d.kind; });
      // Secret '/elytra257' unlock landed - add it to the loadout live
      // (first open hotbar slot, else backpack) instead of requiring a
      // rejoin, and rebuild whatever UI shows the loadout.
      net.on('elytraUnlocked', () => {
        const elytraIdx = ITEMS.findIndex(i => i.key === 'elytra');
        if (elytraIdx === -1) return;
        if (this.hotbarSlots.includes(elytraIdx) || this.backpackSlots.includes(elytraIdx)) return;
        let placed = false;
        const hbPos = this.hotbarSlots.indexOf(null);
        if (hbPos !== -1) { this.hotbarSlots[hbPos] = elytraIdx; placed = true; }
        if (!placed) {
          const bpPos = this.backpackSlots.indexOf(null);
          if (bpPos !== -1) { this.backpackSlots[bpPos] = elytraIdx; placed = true; }
        }
        this._buildHotbar();
        if (this.inventoryOpen) this._buildInventoryUI();
      });
      net.on('death', d => {
        if (d.victim === this.me.id) this._onSelfDeath(d);
        else { const r = this.remote.get(d.victim); if (r) r.alive = false; }
        this._pushKillfeed(d);
        if (d.killer === this.me.id) global.MCSound.kill();
      });
      net.on('projectile', d => {
        this.projectiles.set(d.id, {
          id: d.id, kind: d.kind, x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz,
          owner: d.owner, potionKey: d.potionKey, snapT: performance.now()
        });
        if (d.owner === this.me.id) global.MCSound.shoot();
      });
      net.on('projectileGone', d => {
        const pr = this.projectiles.get(d.id);
        if (pr && d.hit) this._spawnImpact(d.x !== undefined ? d.x : pr.x, d.y !== undefined ? d.y : pr.y, d.z !== undefined ? d.z : pr.z, pr.kind);
        this.projectiles.delete(d.id);
      });
      net.on('snapshot', s => this._applySnapshot(s));
      net.on('disconnected', reason => {
        // This only ever fires for an unexpected drop (a deliberate leave-
        // to-menu goes through Net.disconnect(), which strips this listener
        // first) - almost always the server restarting for an update, e.g.
        // a Render redeploy. Socket.io would otherwise quietly auto-
        // reconnect the existing tab and keep running its old in-memory JS
        // against the new server, which is exactly what looks like "the
        // update didn't reach everyone" - reload instead so the tab re-
        // fetches whatever new code just shipped.
        this._log('Disconnected: ' + reason + ' - reloading...', true);
        setTimeout(() => location.reload(), 1200);
      });
    }

    _ensureRemote(p) {
      let r = this.remote.get(p.id);
      if (!r) {
        r = {
          id: p.id, name: p.name, bot: p.bot, dummy: !!p.dummy, difficulty: p.difficulty || null,
          armor: p.armor || 'none',
          x: p.x, y: p.y, z: p.z, tx: p.x, ty: p.y, tz: p.z,
          yaw: p.yaw, pitch: p.pitch, tyaw: p.yaw, tpitch: p.pitch,
          vx: 0, vz: 0, health: p.health, alive: p.alive, slot: p.slot,
          sneak: false, sprint: false, blocking: !!p.blocking, walkPhase: 0, swingT: 0,
          skin: this.renderer ? this.renderer.getSkin(p.name) : null,
          // Only ever present on the full publicPlayer() payload (init.players/
          // playerJoin), never on a bare per-tick snapshot row - see
          // _applySnapshot, which only ever updates an ALREADY-created entry's
          // live fields, so this never gets clobbered back to null once set.
          armorTrim: p.armorTrim || null, shieldTrim: p.shieldTrim || null
        };
        this.remote.set(p.id, r);
      }
      return r;
    }

    _applySnapshot(s) {
      const now = performance.now();
      for (const row of s.p) {
        const [id, x, y, z, yaw, pitch, health, alive, slot, flags, vx, vz] = row;
        if (id === this.me.id) { this.me.burning = !!(flags & 8); continue; }
        const isDummy = String(id).startsWith('dummy') || String(id).startsWith('atkdummy');
        const r = this._ensureRemote({ id, name: id, x, y, z, yaw, pitch, health, alive, slot, bot: String(id).startsWith('bot') || isDummy, dummy: isDummy });
        r.tx = x; r.ty = y; r.tz = z; r.tyaw = yaw; r.tpitch = pitch;
        r.health = health; r.alive = !!alive; r.slot = slot;
        r.sneak = !!(flags & 1); r.sprint = !!(flags & 2); r.blocking = !!(flags & 4); r.burning = !!(flags & 8); r.hasEffect = !!(flags & 16); r.gliding = !!(flags & 32);
        r.vx = vx; r.vz = vz;
        r.snapT = now;
      }
      const seen = new Set(s.p.map(r => r[0]));
      for (const id of this.remote.keys()) if (!seen.has(id)) this.remote.delete(id);

      for (const row of s.r) {
        const [id, isPearl, x, y, z, vx, vy, vz] = row;
        let pr = this.projectiles.get(id);
        if (!pr) { pr = { id, kind: isPearl ? 'pearl' : 'arrow', x, y, z, vx, vy, vz, owner: null }; this.projectiles.set(id, pr); }
        pr.correctX = x; pr.correctY = y; pr.correctZ = z;
        pr.vx = vx; pr.vy = vy; pr.vz = vz;
        pr.snapT = now;
      }

      // Wolves ride the same high-frequency snapshot for position (see
      // sendSnapshot in server.js) - state changes (spawn/health/death/
      // teleport) arrive as their own one-off events instead, handled in
      // _wireNetEvents. No interpolation smoothing yet, just direct
      // position updates - acceptable at a wolf's walking pace.
      if (s.w) {
        for (const row of s.w) {
          const [id, x, y, z, yaw] = row;
          const w = this.wolves.get(id);
          if (w) { w.x = x; w.y = y; w.z = z; w.yaw = yaw; }
        }
      }
    }

    // ------------------------------------------------------------- input ---
    _wireInput() {
      window.addEventListener('keydown', e => {
        if (document.activeElement === this.hud.chatInput) {
          if (e.key === 'Enter') this._submitChat();
          else if (e.key === 'Escape') this._closeChat();
          return;
        }
        if (!this.me) return; // no session running (at the menu, or between sessions)
        if (e.code === 'KeyE' && this.me.alive) { e.preventDefault(); this._toggleInventory(); return; }
        // Same three-way camera cycle as vanilla Minecraft's F5 - block the
        // browser's own "refresh page" default or every press would reload.
        if (e.code === 'F5') { e.preventDefault(); this._cyclePerspective(); return; }
        if (this.inventoryOpen) {
          if (e.code === 'Escape') this._toggleInventory();
          return; // swallow movement/hotbar keys while browsing the inventory
        }
        this.keys[e.code] = true;
        if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); this._openChat(); }
        if (e.code === 'Escape') {
          // A second Escape (pointer already released) opens the pause menu
          // instead of doing nothing - pressing it again resumes.
          if (this.hud.pauseMenu.classList.contains('hidden')) document.exitPointerLock && document.exitPointerLock();
          else this._requestPointerLock();
        }
        const num = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8 };
        if (num[e.code] !== undefined) {
          const idx = this.hotbarSlots[num[e.code]];
          if (idx !== null && idx !== undefined) this._selectSlot(idx);
        }
      });
      window.addEventListener('keyup', e => { this.keys[e.code] = false; });
      window.addEventListener('wheel', e => {
        if (document.activeElement === this.hud.chatInput || !this.me) return;
        const dir = e.deltaY > 0 ? 1 : -1;
        // Cycle through physical hotbar positions, skipping empty ones (kit
        // exclusions or items currently stashed in the backpack).
        const n = this.hotbarSlots.length;
        let pos = this.hotbarSlots.indexOf(this.me.slot);
        if (pos < 0) pos = 0;
        for (let i = 0; i < n; i++) {
          pos = (pos + dir + n) % n;
          const idx = this.hotbarSlots[pos];
          if (idx !== null) { this._selectSlot(idx); break; }
        }
      });

      this.canvas.addEventListener('click', () => { this._requestPointerLock(); global.MCSound.resume(); });
      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === this.canvas;
        if (this.pointerLocked) { this._hasEverLocked = true; this.hud.pauseMenu.classList.add('hidden'); }
        this.hud.hint.classList.toggle('hidden', this.pointerLocked);
        // Losing pointer lock mid-game (Escape, alt-tab, focus loss) pauses -
        // but not on the very first click-to-start, and not while dead or
        // browsing the inventory, which already have their own overlays.
        if (!this.pointerLocked && this._hasEverLocked && this.me && this.me.alive && !this.inventoryOpen) {
          this.hud.pauseMenu.classList.remove('hidden');
        }
      });
      this.hud.resumeBtn.addEventListener('click', () => this._requestPointerLock());
      this.hud.leaveBtn.addEventListener('click', () => this._leaveToMenu());
      this.hud.viewModeBtn.addEventListener('click', () => this._cyclePerspective());
      document.addEventListener('mousemove', e => {
        if (!this.pointerLocked) return;
        const sens = 0.0022;
        this.yaw -= e.movementX * sens;
        this.pitch -= e.movementY * sens;
        this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
        while (this.yaw > Math.PI) this.yaw -= TAU;
        while (this.yaw < -Math.PI) this.yaw += TAU;
      });
      document.addEventListener('mousedown', e => {
        if (!this.pointerLocked) return;
        if (e.button === 0) { this.mouseDown.left = true; this._onLeftDown(); }
        if (e.button === 2) { this.mouseDown.right = true; this.rightDownAt = performance.now(); this._onRightDown(); }
      });
      document.addEventListener('mouseup', e => {
        if (e.button === 0) { this.mouseDown.left = false; this._onLeftUp(); }
        if (e.button === 2) { this.mouseDown.right = false; this._onRightUp(); }
      });
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
      window.addEventListener('blur', () => { this.mouseDown.left = this.mouseDown.right = false; this._spearChargeStart = null; });
    }

    _requestPointerLock() {
      if (!this.me || this.deadUntilRespawn) return;
      if (document.pointerLockElement === this.canvas) return;
      if (!this.canvas.requestPointerLock) return;
      // Chrome's requestPointerLock() returns a Promise that rejects if a
      // request is already pending or the element isn't eligible yet (e.g.
      // right after a previous lock/unlock) - without a .catch() that shows
      // up as an uncaught "WrongDocumentError" in the console on every
      // repeat click, even though the game itself keeps working fine.
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }

    _openChat() { this.hud.chatInput.classList.remove('hidden'); this.hud.chatInput.focus(); }
    _closeChat() { this.hud.chatInput.classList.add('hidden'); this.hud.chatInput.value = ''; this.hud.chatInput.blur(); }
    _submitChat() {
      const v = this.hud.chatInput.value.trim();
      if (v) this.net.chat(v);
      this._closeChat();
    }

    _selectSlot(i) { this.me.slot = i; this._buildHotbar(); }

    _toggleInventory() {
      this.inventoryOpen = !this.inventoryOpen;
      this.hud.inventory.classList.toggle('hidden', !this.inventoryOpen);
      if (this.inventoryOpen) {
        this.mouseDown.left = this.mouseDown.right = false;
        document.exitPointerLock && document.exitPointerLock();
        this._buildInventoryUI();
      } else {
        this._requestPointerLock();
      }
    }

    /**
     * Minecraft-shaped slot layout with no crafting grid: 4 armor slots, a
     * 27-slot backpack, and the hotbar - the backpack and hotbar share one
     * pool of items (whatever the chosen kit grants), freely dragged between
     * the two. Armor + offhand are the fixed kit everyone spawns with, so
     * they're filled once and never change.
     */
    _buildInventoryUI() {
      if (!this._armorBuilt) {
        this._armorBuilt = true;
        // Helmet/legs/boots are the fixed kit, filled once and never change.
        // Chest is dynamic (chestplate or elytra) - see _renderChestSlot().
        const armorMap = { helmet: 'helmet', legs: 'leggings', boots: 'boots' };
        document.querySelectorAll('#armorSlots [data-armor]').forEach(slot => {
          const key = armorMap[slot.dataset.armor];
          if (!key) return;
          const piece = MC.ARMOR[key];
          slot.innerHTML = '';
          slot.appendChild(global.MCTextures.itemIcon(key, 36, this.armorTier));
          const tag = document.createElement('div');
          tag.className = 'count';
          tag.textContent = 'IV';
          slot.appendChild(tag);
          slot.title = piece.name + ' — Protection IV';
        });
        this._wireOffhandDrag(el('invOffhandSlot'));
        const chestEl = document.querySelector('#armorSlots [data-armor="chest"]');
        if (chestEl) this._wireChestDrag(chestEl);
      }
      this._renderOffhandSlot();
      this._renderChestSlot();
      if (this.renderer) {
        this._renderSlotZone(this.hud.invHotbar, 'hotbar', this.hotbarSlots);
        this._renderSlotZone(this.hud.mainInventory, 'backpack', this.backpackSlots);
      }
    }

    /** Redraws the chest armor slot from `this.chestSlot` - chestplate
     * (fixed Protection IV, like the other 3 pieces) or the elytra, if
     * equipped. Mirrors _renderOffhandSlot()'s shape. */
    _renderChestSlot() {
      const chestEl = document.querySelector('#armorSlots [data-armor="chest"]');
      if (!chestEl) return;
      chestEl.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'slotlabel';
      label.textContent = 'Chest';
      chestEl.appendChild(label);
      if (this.chestSlot === 'elytra') {
        chestEl.appendChild(global.MCTextures.itemIcon('elytra', 36));
        chestEl.title = 'Elytra (drag out, or right-click it, to swap the chestplate back in)';
      } else {
        chestEl.appendChild(global.MCTextures.itemIcon('chestplate', 36, this.armorTier));
        const tag = document.createElement('div');
        tag.className = 'count';
        tag.textContent = 'IV';
        chestEl.appendChild(tag);
        chestEl.title = MC.ARMOR.chestplate.name + ' — Protection IV (drag the elytra here, or right-click it, to swap it in)';
      }
      chestEl.draggable = this.chestSlot === 'elytra';
    }

    /** Whether `item` is allowed in the offhand slot - shield (the default)
     * plus firework/block/totem, same restriction in both the inventory
     * screen's offhand slot and the in-game HUD icon below it. */
    _canOffhand(item) {
      return item && (item.type === 'firework' || item.type === 'block' || item.type === 'totem');
    }

    /** Redraws the inventory screen's offhand slot from `this.offhand` -
     * called on every _buildInventoryUI() (ammo counts change) in addition
     * to whenever the offhand item itself changes. */
    _renderOffhandSlot() {
      const el2 = el('invOffhandSlot');
      if (!el2) return;
      el2.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'slotlabel';
      label.textContent = 'Off-hand';
      el2.appendChild(label);
      if (this.offhand === 'shield') {
        el2.appendChild(global.MCTextures.itemIcon('shield', 36));
        el2.title = MC.SHIELD.name + ' (drag a firework, block, or totem here to swap it in)';
      } else {
        const item = ITEMS.find(i => i.key === this.offhand);
        const icon = item.type === 'block' && this.renderer ? global.MCTextures.blockIcon(this.renderer.tiles, item.block, 36) : global.MCTextures.itemIcon(item.key, 36);
        el2.appendChild(icon);
        if (item.ammo !== undefined) {
          const count = document.createElement('div');
          count.className = 'count';
          count.textContent = this.ammo ? this.ammo[item.key] : item.ammo;
          el2.appendChild(count);
        }
        el2.title = item.name + ' (drag out to swap the shield back in)';
      }
      el2.classList.toggle('empty', false);
      el2.draggable = this.offhand !== 'shield';
      this._buildOffhandHUD();
    }

    /** Builds one draggable slot grid (hotbar mirror or backpack) from a
     * hotbarSlots/backpackSlots array. Both zones share the same drag/drop
     * logic in _wireSlotDrag, so items move freely between them. */
    _renderSlotZone(container, zone, arr) {
      const tiles = this.renderer.tiles;
      container.innerHTML = '';
      arr.forEach((idx, pos) => {
        const cell = document.createElement('div');
        // 'chestplate' is a placeholder (not a real ITEMS index) left behind
        // when the elytra gets equipped in its place - see _wireChestDrag().
        const isChestplate = idx === 'chestplate';
        cell.className = 'slot invslot' + (typeof idx === 'number' && idx === this.me.slot ? ' active' : '') + (idx === null ? ' empty' : '');
        cell.dataset.pos = pos;
        if (isChestplate) {
          cell.appendChild(global.MCTextures.itemIcon('chestplate', 36, this.armorTier));
          const tag = document.createElement('div');
          tag.className = 'count';
          tag.textContent = 'IV';
          cell.appendChild(tag);
          cell.title = MC.ARMOR.chestplate.name + ' — Protection IV (drag back onto the chest armor slot to re-equip it)';
        } else if (idx !== null) {
          const item = ITEMS[idx];
          const icon = item.type === 'block' ? global.MCTextures.blockIcon(tiles, item.block, 36) : global.MCTextures.itemIcon(item.key, 36);
          cell.appendChild(icon);
          const count = document.createElement('div');
          count.className = 'count';
          if (item.ammo !== undefined) count.textContent = this.ammo ? this.ammo[item.key] : item.ammo;
          else if (item.key === 'bow' || item.key === 'crossbow') count.textContent = this.ammo ? this.ammo.arrow : '';
          cell.appendChild(count);
          cell.title = item.name + ' (drag to move)';
        }
        this._wireSlotDrag(cell, zone, pos);
        container.appendChild(cell);
      });
    }

    _slotArray(zone) { return zone === 'hotbar' ? this.hotbarSlots : this.backpackSlots; }

    /** Drag-and-drop between hotbar and backpack slots (either direction,
     * either zone) - dropping always swaps whatever's at the two positions,
     * so dropping onto an empty slot is a move and dropping onto an
     * occupied one is a straight swap. Purely a client-side arrangement:
     * the server only cares which item is currently equipped (me.slot),
     * not whether it's sitting in the hotbar or tucked in the backpack. */
    _wireSlotDrag(cell, zone, pos) {
      const idx = this._slotArray(zone)[pos];
      if (idx === 'chestplate') {
        // The displaced-chestplate placeholder: only draggable back onto
        // the chest armor slot (see _wireChestDrag()), not swappable with
        // ordinary items.
        cell.draggable = true;
        cell.addEventListener('dragstart', e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'chestplate-return:' + zone + ':' + pos);
          cell.classList.add('dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      } else if (idx !== null) {
        cell.draggable = true;
        cell.addEventListener('dragstart', e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', zone + ':' + pos);
          cell.classList.add('dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      }
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('dragover'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('dragover');
        const raw = e.dataTransfer.getData('text/plain') || '';
        if (raw.startsWith('chestplate-return:')) return; // only the chest armor slot accepts this
        if (raw === 'offhand') {
          // Pulling the offhand item back out - it always lands here (this
          // is where the drop happened), swapping out whatever was here.
          // Rejected if this slot holds the chestplate placeholder - that
          // one only ever goes back to the chest armor slot.
          if (this.offhand === 'shield') return;
          const toArr = this._slotArray(zone);
          if (toArr[pos] === 'chestplate') return;
          const outgoing = ITEMS.findIndex(i => i.key === this.offhand);
          this.offhand = toArr[pos] !== null ? ITEMS[toArr[pos]].key : 'shield';
          if (this.offhand !== 'shield' && !this._canOffhand(ITEMS[ITEMS.findIndex(i => i.key === this.offhand)])) {
            // Whatever was sitting in this slot isn't offhand-eligible -
            // just drop the totem/firework/block back in this slot instead
            // of swapping something invalid into the offhand.
            this.offhand = 'shield';
          }
          toArr[pos] = outgoing;
          this._renderOffhandSlot();
          this._buildInventoryUI();
          this._buildHotbar();
          return;
        }
        if (raw === 'chest') {
          // Pulling the elytra back out of the chest slot - lands here if
          // this slot is empty, or currently holds the displaced chestplate
          // placeholder (which then returns to the chest armor slot).
          if (this.chestSlot !== 'elytra') return;
          const toArr = this._slotArray(zone);
          if (toArr[pos] !== null && toArr[pos] !== 'chestplate') return;
          toArr[pos] = ITEMS.findIndex(i => i.key === 'elytra');
          this.chestSlot = 'chestplate';
          this._renderChestSlot();
          this._buildInventoryUI();
          this._buildHotbar();
          return;
        }
        const [fromZone, fromPosStr] = raw.split(':');
        const fromPos = parseInt(fromPosStr, 10);
        if ((fromZone !== 'hotbar' && fromZone !== 'backpack') || !Number.isInteger(fromPos)) return;
        if (fromZone === zone && fromPos === pos) return;
        const fromArr = this._slotArray(fromZone), toArr = this._slotArray(zone);
        // Never let an ordinary item get swapped onto the chestplate
        // placeholder - it only ever goes back to the chest armor slot.
        if (toArr[pos] === 'chestplate' || fromArr[fromPos] === 'chestplate') return;
        const tmp = toArr[pos];
        toArr[pos] = fromArr[fromPos];
        fromArr[fromPos] = tmp;
        this._buildInventoryUI();
        this._buildHotbar();
      });
    }

    /** Drag-and-drop for the single offhand slot - accepts a firework,
     * block, or totem dragged in from the hotbar/backpack (swapping the
     * previous offhand occupant, if any, into the slot it came from), and
     * lets the current offhand item be dragged back out the same way. */
    _wireOffhandDrag(cell) {
      cell.addEventListener('dragstart', e => {
        if (this.offhand === 'shield') { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'offhand');
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('dragover'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('dragover');
        const raw = e.dataTransfer.getData('text/plain') || '';
        if (raw === 'offhand') return;
        const [fromZone, fromPosStr] = raw.split(':');
        const fromPos = parseInt(fromPosStr, 10);
        if ((fromZone !== 'hotbar' && fromZone !== 'backpack') || !Number.isInteger(fromPos)) return;
        const fromArr = this._slotArray(fromZone);
        const idx = fromArr[fromPos];
        if (idx === null || !this._canOffhand(ITEMS[idx])) return;
        const incoming = ITEMS[idx].key;
        const outgoingKey = this.offhand;
        fromArr[fromPos] = outgoingKey === 'shield' ? null : ITEMS.findIndex(i => i.key === outgoingKey);
        this.offhand = incoming;
        this._renderOffhandSlot();
        this._buildInventoryUI();
        this._buildHotbar();
      });
    }

    /** Drag-and-drop for the chest armor slot - only the elytra can be
     * dragged in (swapping the chestplate back into whatever slot it came
     * from), and it can be dragged back out the same way. Mirrors
     * _wireOffhandDrag()'s shape. */
    _wireChestDrag(cell) {
      cell.addEventListener('dragstart', e => {
        if (this.chestSlot !== 'elytra') { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'chest');
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('dragover'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('dragover');
        const raw = e.dataTransfer.getData('text/plain') || '';
        if (raw === 'chest' || raw === 'offhand') return;
        if (raw.startsWith('chestplate-return:')) {
          // Dragging the displaced-chestplate placeholder back onto the
          // chest slot: re-equip it, and send the elytra back to wherever
          // the placeholder was sitting.
          const [, fromZone, fromPosStr] = raw.split(':');
          const fromPos = parseInt(fromPosStr, 10);
          if ((fromZone !== 'hotbar' && fromZone !== 'backpack') || !Number.isInteger(fromPos)) return;
          if (this.chestSlot !== 'elytra') return;
          const fromArr = this._slotArray(fromZone);
          if (fromArr[fromPos] !== 'chestplate') return;
          fromArr[fromPos] = ITEMS.findIndex(i => i.key === 'elytra');
          this.chestSlot = 'chestplate';
          this._renderChestSlot();
          this._buildInventoryUI();
          this._buildHotbar();
          return;
        }
        const [fromZone, fromPosStr] = raw.split(':');
        const fromPos = parseInt(fromPosStr, 10);
        if ((fromZone !== 'hotbar' && fromZone !== 'backpack') || !Number.isInteger(fromPos)) return;
        const fromArr = this._slotArray(fromZone);
        const idx = fromArr[fromPos];
        if (idx === null || idx === 'chestplate' || ITEMS[idx].key !== 'elytra') return;
        // The displaced chestplate takes the elytra's old slot, same shape
        // as the offhand's shield/item swap.
        fromArr[fromPos] = 'chestplate';
        this.chestSlot = 'elytra';
        // If it was the actively-held item, it's no longer sitting in any
        // hotbar slot to show as "active" - switch back to the primary
        // weapon instead of leaving the hotbar looking empty.
        if (this.me.slot === idx) this.me.slot = 0;
        this._renderChestSlot();
        this._buildInventoryUI();
        this._buildHotbar();
      });
    }

    _onLeftDown() {
      if (!this.me || !this.me.alive) return;
      const item = ITEMS[this.me.slot];
      // Hitting an end crystal detonates it, regardless of what's held -
      // checked first since it's block-aimed. A strict raycast alone misses
      // constantly at melee range (you're standing right next to it, not
      // lined up dead-center) so fall back to a forgiving nearby search,
      // same fix as the respawn anchor's glowstone-charge targeting.
      const pick = this._pick();
      const exactCrystal = (pick && pick.type === 'block' && pick.block.block === ID.END_CRYSTAL && pick.dist <= C.REACH_ATTACK) ? pick.block : null;
      const crystal = exactCrystal || this._findNearbyBlock(ID.END_CRYSTAL, C.REACH_ATTACK);
      if (crystal) {
        this.net.hitCrystal(crystal.x, crystal.y, crystal.z);
        this._swingLocal();
        return;
      }
      // A sword hit against a charged respawn anchor detonates it early -
      // same forgiving block targeting as the crystal above.
      if (item.key === 'sword' || item.key === 'netherite_sword') {
        const exactAnchor = (pick && pick.type === 'block' && pick.block.block === ID.RESPAWN_ANCHOR && pick.dist <= C.REACH_ATTACK) ? pick.block : null;
        const anchor = exactAnchor || this._findNearbyBlock(ID.RESPAWN_ANCHOR, C.REACH_ATTACK);
        if (anchor) {
          this.net.hitAnchor(anchor.x, anchor.y, anchor.z);
          this._swingLocal();
          return;
        }
      }
      if (item.type === 'weapon' || item.type === 'tool') {
        if (item.pierce) {
          // The spear's Lunge fires on every swing, landed hit or not - so
          // always send the jab, even with an empty target list (the
          // server's 'attack' handler no longer requires a hit for it).
          // Holding past this also starts tracking a charge - see
          // _onLeftUp / C.SPEAR_CHARGE_HOLD.
          const targets = this._pickAttackTargets(item);
          this._tryAttackMulti(targets, item);
          if (item.key === 'spear') this._spearChargeStart = performance.now();
          return;
        } else {
          const target = this._pickAttackTarget();
          if (target) { this._tryAttack(target); return; }
        }
      }
      const hit = this._pick();
      if (hit && hit.type === 'entity') {
        this._tryAttack(hit.entity);
      } else {
        this._swingLocal();
      }
    }

    /** Releasing the attack button after holding it past SPEAR_CHARGE_HOLD
     * unleashes a stronger, longer-reaching charged thrust on top of the
     * quick jab _onLeftDown already sent - a deliberate "gap closer" that,
     * like the jab, dashes forward whether or not it connects. */
    _onLeftUp() {
      const start = this._spearChargeStart;
      this._spearChargeStart = null;
      if (!start || !this.me || !this.me.alive) return;
      const item = ITEMS[this.me.slot];
      if (item.key !== 'spear') return;
      const held = (performance.now() - start) / 1000;
      if (held < C.SPEAR_CHARGE_HOLD) return;
      const chargedReach = Object.assign({}, item, { reach: (item.reach || C.REACH_ATTACK) + C.SPEAR_CHARGE_REACH_BONUS });
      const targets = this._pickAttackTargets(chargedReach);
      this._tryAttackCharged(targets, item);
    }

    _onRightDown() {
      if (!this.me || !this.me.alive) return;
      const item = ITEMS[this.me.slot];
      if (item.type === 'pearl') {
        if (this.ammo.pearl <= 0) return;
        const dir = this._lookDir();
        this.net.shoot(dir[0], dir[1], dir[2], 1);
        this.ammo.pearl--; this._updateAmmoUI();
        this._swingLocal();
      } else if (item.type === 'block') {
        // Glowstone aimed at a respawn anchor charges it instead of placing
        // a normal block - anything else, it places like any other block.
        if (item.key === 'glowstone') {
          const pick = this._pick();
          const exact = (pick && pick.type === 'block' && pick.block.block === ID.RESPAWN_ANCHOR && pick.dist <= C.REACH_BLOCK) ? pick.block : null;
          // Fall back to a forgiving nearby-anchor search (same idea as
          // _pickAttackTarget's forgiving melee targeting) if the strict
          // raycast doesn't land exactly on the anchor's block face - lets
          // charging work without needing pixel-perfect aim.
          const anchor = exact || this._findNearbyBlock(ID.RESPAWN_ANCHOR, C.REACH_BLOCK);
          if (anchor) {
            const t = performance.now();
            if ((item.ammo !== undefined && this.ammo.glowstone <= 0) || t - this.lastPlaceAt < 180) return;
            this.lastPlaceAt = t;
            this.net.chargeAnchor(anchor.x, anchor.y, anchor.z);
            if (item.ammo !== undefined) { this.ammo.glowstone--; this._updateAmmoUI(); }
            global.MCSound.click();
            return;
          }
        }
        this._placeBlock();
      } else if (item.type === 'windcharge') {
        const t = performance.now();
        if (this.ammo.windcharge <= 0 || t - (this._lastWindchargeAt || 0) < item.cooldown * 1000) return;
        this._lastWindchargeAt = t;
        const dir = this._lookDir();
        this.net.shoot(dir[0], dir[1], dir[2], 1);
        this.ammo.windcharge--; this._updateAmmoUI();
        this._swingLocal();
        // Predicted locally for instant feedback - the server echoes the
        // same launch back (see net.on('launch', ...)) as the authoritative
        // version, same pattern as every other server-owned combat effect.
        this.me.vy = Math.max(this.me.vy, C.WINDCHARGE_SELF_LAUNCH_VY);
        global.MCSound.windBurst();
      } else if (item.type === 'potion') {
        // Thrown, same as a pearl/wind charge - splashes on impact (see
        // server.js's splashPotion), thrower included if they're close
        // enough, so throwing one at your own feet is the way to self-buff
        // instantly. The server is still what actually applies the effect;
        // this is just an optimistic local gate against ammo/cooldown spam.
        const t = performance.now();
        if (this.ammo[item.key] <= 0 || t - (this._lastPotionThrowAt || 0) < item.cooldown * 1000) return;
        this._lastPotionThrowAt = t;
        const dir = this._lookDir();
        this.net.shoot(dir[0], dir[1], dir[2], 1);
        this.ammo[item.key]--; this._updateAmmoUI();
        this._swingLocal(); // the projectile-spawn echo (net.on('projectile', ...)) already plays the throw sound
      } else if (item.throwable) {
        // Trident: no ammo to track (it's the weapon itself), just a
        // cooldown - the server is authoritative on the actual length
        // (Loyalty on/off, or a Riptide launch instead of a throw), this is
        // only an optimistic local gate against spamming the button.
        const t = performance.now();
        if (t - (this._lastTridentThrowAt || 0) < C.TRIDENT_COOLDOWN_WITH_LOYALTY * 1000) return;
        this._lastTridentThrowAt = t;
        const dir = this._lookDir();
        this.net.shoot(dir[0], dir[1], dir[2], 1);
        this._swingLocal();
      } else if (item.type === 'igniter') {
        this._useFlintSteel();
      } else if (item.type === 'elytra' && this.chestSlot !== 'elytra') {
        // Equip it in place of the chestplate - relocates it out of
        // whichever hotbar/backpack slot it's currently held from (replaced
        // by a chestplate placeholder you can drag back to swap again),
        // same thing dragging it onto the chest armor slot does. Once worn
        // it's no longer a selectable held item, so un-equipping only
        // happens through the inventory drag (either direction).
        let arr = this.hotbarSlots, arrPos = arr.indexOf(this.me.slot);
        if (arrPos === -1) { arr = this.backpackSlots; arrPos = arr.indexOf(this.me.slot); }
        if (arrPos !== -1) arr[arrPos] = 'chestplate';
        this.chestSlot = 'elytra';
        // The item just worn is no longer sitting in any hotbar slot to show
        // as "active" - switch back to the primary weapon instead of
        // leaving the hotbar looking like nothing is held.
        this.me.slot = 0;
        this._renderChestSlot();
        this._buildHotbar();
        if (this.inventoryOpen) this._buildInventoryUI();
        global.MCSound.click();
      } else if (item.type === 'firework') {
        // Only does anything while gliding (a forward speed boost) - firing
        // one as a weapon now requires a crossbow (see the crossbow branch
        // below, Shift+RMB), not just holding the firework itself.
        if (!this.gliding) return;
        const t = performance.now();
        if (this.ammo.firework <= 0 || t - (this._lastFireworkAt || 0) < item.cooldown * 1000) return;
        this._lastFireworkAt = t;
        const dir = this._lookDir();
        this.net.shoot(dir[0], dir[1], dir[2], 1);
        this.ammo.firework--; this._updateAmmoUI();
        this._swingLocal();
        this.me.vx += dir[0] * C.FIREWORK_BOOST_SPEED;
        this.me.vy += dir[1] * C.FIREWORK_BOOST_SPEED;
        this.me.vz += dir[2] * C.FIREWORK_BOOST_SPEED;
        // Raises the glide speed cap (see input.boosted in physics.js) for a
        // few seconds - without this a firework boost would just get
        // clamped straight back down to the same slow plain-glide ceiling.
        this._boostedUntil = performance.now() / 1000 + C.ELYTRA_BOOST_WINDOW;
        global.MCSound.fireworkLaunch();
      } else if (item.type === 'spawn_egg') {
        // No aiming needed - the server places it a couple blocks in front
        // of wherever you're facing (see spawnWolf in server.js). Ammo is
        // decremented server-side (it also owns the cooldown), mirrored
        // back here on the 'ammo' event like every other consumable.
        const t = performance.now();
        if (this.ammo.wolf_spawn_egg <= 0 || t - (this._lastWolfEggAt || 0) < item.cooldown * 1000) return;
        this._lastWolfEggAt = t;
        this.net.spawnWolf();
        this._swingLocal();
        global.MCSound.click();
      }
      // bow charging is handled continuously in update() via rightDownAt
    }

    /** Flint and steel: right-click a placed TNT/TNT Minecart within reach
     * to light its fuse, or any other block to set the ground above it on
     * fire instead - unlimited uses, the server decides which (and owns the
     * actual fuse/explosion or fire timer). */
    _useFlintSteel() {
      const t = performance.now();
      if (t - (this._lastIgniteAt || 0) < 250) return;
      const hit = this._pick();
      if (!hit || hit.type !== 'block') return;
      const b = hit.block;
      this._lastIgniteAt = t;
      this.net.ignite(b.x, b.y, b.z);
      global.MCSound.click();
    }

    _onRightUp() {
      if (!this.me) return;
      const item = ITEMS[this.me.slot];
      if (item.type === 'bow' || item.type === 'crossbow') {
        const held = (performance.now() - this.rightDownAt) / 1000;
        // Shift+RMB with a crossbow out fires a firework rocket instead of
        // an arrow (uses firework ammo, not arrow ammo) - this is the only
        // way to fire one as a weapon now, plain RMB is always arrows.
        const fireworkMode = item.key === 'crossbow' && this.me.sneak && this.ammo.firework > 0;
        if (fireworkMode && held > 0.08) {
          const dir = this._lookDir();
          this.net.shoot(dir[0], dir[1], dir[2], 1, true);
          this.ammo.firework--; this._updateAmmoUI();
          this._swingLocal();
        } else if (!fireworkMode && this.ammo.arrow > 0 && held > 0.08) {
          const power = clamp(held / item.drawTime, 0.12, 1);
          const dir = this._lookDir();
          this.net.shoot(dir[0], dir[1], dir[2], power);
          this.ammo.arrow--; this._updateAmmoUI();
          this._swingLocal();
        }
        this.hud.chargeWrap.classList.add('hidden');
      } else if (item.type === 'food') {
        const held = (performance.now() - this.rightDownAt) / 1000;
        if (held > item.eatTime * 0.7 && this.ammo[item.key] > 0) {
          this.net.eat();
          this.ammo[item.key]--; this._updateAmmoUI();
          global.MCSound.eat();
        }
        this.hud.chargeWrap.classList.add('hidden');
      }
    }

    _lookDir() {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
      return [-sy * cp, sp, -cy * cp];
    }

    _cyclePerspective() {
      this.viewMode = (this.viewMode + 1) % 3;
      this.hud.viewModeBtn.textContent = ['1st Person', '3rd Person', '3rd Person (Front)'][this.viewMode];
      global.MCSound.click();
    }

    /**
     * Camera eye position + look yaw/pitch for the current view mode. First
     * person is just the player's own eye, unchanged. Both third-person
     * modes pull the camera back along a ray from the player's eye (behind
     * for the over-the-shoulder view, in front for the selfie view) and
     * raycast against the world so a wall behind/in front of you pulls the
     * camera in instead of clipping through it - same idea as vanilla MC's
     * own third-person camera collision.
     */
    _computeCamera(eyePos) {
      if (this.viewMode === 0) return { eye: eyePos, yaw: this.yaw, pitch: this.pitch };
      const dir = this._lookDir();
      const back = this.viewMode === 1 ? 1 : -1; // behind you, or out in front of you
      const wantDist = 4.5;
      const hit = this.world.raycast(eyePos[0], eyePos[1], eyePos[2], -dir[0] * back, -dir[1] * back, -dir[2] * back, wantDist, false);
      // Never further than just short of whatever's in the way - a small
      // floor only to avoid a literal zero-distance camera, not "breathing
      // room" (raising it further would let the camera clip past a wall
      // that's closer than the floor). A cramped space still means an
      // uncomfortably close camera, same tradeoff vanilla Minecraft makes.
      const dist = hit ? Math.max(0.15, hit.dist - 0.3) : wantDist;
      const eye = [eyePos[0] - dir[0] * back * dist, eyePos[1] - dir[1] * back * dist, eyePos[2] - dir[2] * back * dist];
      // Behind-the-shoulder view looks the same direction you do. The front
      // ("selfie") view instead looks back at your own face - flip yaw 180
      // degrees and mirror pitch so tilting your look up still tilts the
      // camera to keep your face framed, not away from it.
      if (this.viewMode === 1) return { eye, yaw: this.yaw, pitch: this.pitch };
      return { eye, yaw: this.yaw + Math.PI, pitch: -this.pitch };
    }

    _swingLocal() {
      this.swingT = 0.0001;
      this.net.swing();
      global.MCSound.swing();
    }

    _tryAttack(entity) {
      const item = ITEMS[this.me.slot];
      const cd = (item.cooldown || 0.35) * 1000;
      const t = performance.now();
      if (t - this.lastAttackClient < cd) return;
      this.lastAttackClient = t;
      this.net.attack(entity.id);
      this._swingLocal();
    }

    /** Spear-only: every landed jab pierces every valid target in front of
     * it, not just the nearest one - so pick all of them, closest first. */
    _tryAttackMulti(targets, item) {
      const cd = (item.cooldown || 0.35) * 1000;
      const t = performance.now();
      if (t - this.lastAttackClient < cd) return;
      this.lastAttackClient = t;
      this.net.attack(null, targets.map(r => r.id));
      this._swingLocal();
    }

    /** Spear-only charged thrust, released from _onLeftUp once held past
     * C.SPEAR_CHARGE_HOLD - shares the same cooldown gate as the quick jab. */
    _tryAttackCharged(targets, item) {
      const cd = (item.cooldown || 0.35) * 1000;
      const t = performance.now();
      if (t - this.lastAttackClient < cd) return;
      this.lastAttackClient = t;
      this.net.attack(null, targets.map(r => r.id), true);
      this._swingLocal();
      global.MCSound.smash(); // reuse the mace's heavier swing sound for the extra weight of a charged thrust
    }

    _pick() {
      const eye = [this.me.x, this.me.y + PHYS.EYE, this.me.z];
      const dir = this._lookDir();
      const maxDist = Math.max(C.REACH_BLOCK, C.REACH_ATTACK);
      const blockHit = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], C.REACH_BLOCK, false);
      let entityHit = null, entityDist = Infinity;
      for (const r of this.remote.values()) {
        if (!r.alive) continue;
        const d = this._raySphere(eye, dir, r.x, r.y + PHYS.HEIGHT / 2, r.z, 0.9, C.REACH_ATTACK);
        if (d !== null && d < entityDist) { entityDist = d; entityHit = r; }
      }
      const blockDist = blockHit ? blockHit.dist : Infinity;
      if (entityHit && entityDist < blockDist + 0.35) return { type: 'entity', entity: entityHit, dist: entityDist };
      if (blockHit && blockHit.dist <= C.REACH_BLOCK) return { type: 'block', block: blockHit, dist: blockHit.dist };
      return null;
    }

    /**
     * Forgiving melee target selection: nearest alive enemy within reach and
     * roughly in front of the camera, not gated behind a precise raycast hit.
     * A strict "does the crosshair ray exactly intersect the hitbox sphere"
     * test misses constantly against a moving target with terrain nearby
     * (real games don't require pixel-perfect aim for melee) - this instead
     * scores candidates by how centered and close they are, same shape as
     * vanilla Minecraft's attack targeting.
     */
    _pickAttackTarget() {
      const eye = [this.me.x, this.me.y + PHYS.EYE, this.me.z];
      const dir = this._lookDir();
      const reach = C.REACH_ATTACK + 0.5;
      let best = null, bestScore = -Infinity;
      for (const r of this.remote.values()) {
        if (!r.alive) continue;
        const tx = r.x, ty = r.y + PHYS.HEIGHT * 0.5, tz = r.z;
        const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > reach) continue;
        const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / (dist || 1);
        if (dot < 0.68) continue; // ~47 degree cone - forgiving but still "in front"
        // Don't let melee reach through a solid wall: only block if something
        // solid sits clearly closer than the target along this exact ray.
        const blockHit = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], dist - 0.4, false);
        if (blockHit) continue;
        const score = dot * 2 - dist * 0.12;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      return best;
    }

    /**
     * Forgiving block targeting: nearest block of the given id within reach
     * and roughly in front of the camera, same shape as _pickAttackTarget
     * above - a strict raycast hit on the exact block face misses
     * constantly at melee/charging range (you're standing right next to
     * it), so hitting a crystal, sword-hitting an anchor, or charging one
     * with glowstone shouldn't require pixel-perfect aim either.
     */
    _findNearbyBlock(blockId, reach) {
      const eye = [this.me.x, this.me.y + PHYS.EYE, this.me.z];
      const dir = this._lookDir();
      const r = Math.ceil(reach);
      const px = Math.floor(this.me.x), py = Math.floor(this.me.y), pz = Math.floor(this.me.z);
      let best = null, bestScore = -Infinity;
      for (let bx = px - r; bx <= px + r; bx++) {
        for (let by = py - r; by <= py + r; by++) {
          for (let bz = pz - r; bz <= pz + r; bz++) {
            if (this.world.get(bx, by, bz) !== blockId) continue;
            const cx = bx + 0.5, cy = by + 0.5, cz = bz + 0.5;
            const dx = cx - eye[0], dy = cy - eye[1], dz = cz - eye[2];
            const dist = Math.hypot(dx, dy, dz);
            if (dist > reach) continue;
            const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / (dist || 1);
            if (dot < 0.5) continue; // ~60 degree cone - forgiving but still "in front"
            const score = dot * 2 - dist * 0.12;
            if (score > bestScore) { bestScore = score; best = { x: bx, y: by, z: bz }; }
          }
        }
      }
      return best;
    }

    /** Spear pierce: every alive enemy in a narrow forward cone, within
     * [minReach, reach] and with a clear line to them (no wall in between),
     * closest first - the server independently re-validates every one of
     * these before applying damage, same as the single-target path. */
    _pickAttackTargets(item) {
      const eye = [this.me.x, this.me.y + PHYS.EYE, this.me.z];
      const dir = this._lookDir();
      const reach = (item.reach || C.REACH_ATTACK) + 0.5;
      const minReach = item.minReach || 0;
      const out = [];
      for (const r of this.remote.values()) {
        if (!r.alive) continue;
        const tx = r.x, ty = r.y + PHYS.HEIGHT * 0.5, tz = r.z;
        const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > reach || dist < minReach) continue;
        const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / (dist || 1);
        if (dot < 0.6) continue; // forgiving forward cone - a lunge shouldn't require pixel-perfect aim
        const blockHit = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], dist - 0.4, false);
        if (blockHit) continue;
        out.push({ r, dist });
      }
      out.sort((a, b) => a.dist - b.dist);
      return out.slice(0, 8).map(o => o.r);
    }

    _raySphere(o, d, cx, cy, cz, r, maxDist) {
      const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
      const b = ox * d[0] + oy * d[1] + oz * d[2];
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) return null;
      return t;
    }

    _placeBlock() {
      const t = performance.now();
      if (t - this.lastPlaceAt < 180) return;
      const item = ITEMS[this.me.slot];
      if (item.type !== 'block') return;
      if (item.ammo !== undefined && this.ammo[item.key] <= 0) return;
      const eye = [this.me.x, this.me.y + PHYS.EYE, this.me.z];
      const dir = this._lookDir();
      const hit = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], C.REACH_BLOCK, false);
      if (!hit) return;
      const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
      if (this.world.get(x, y, z) !== ID.AIR) return;
      // client-side player-overlap guard mirrors the server check
      const r = PHYS.WIDTH / 2;
      if (x + 1 > this.me.x - r && x < this.me.x + r && z + 1 > this.me.z - r && z < this.me.z + r &&
          y + 1 > this.me.y && y < this.me.y + PHYS.HEIGHT) return;
      this.lastPlaceAt = t;
      this.world.set(x, y, z, item.block);
      this.remeshDirty(30);
      this.net.setBlock(x, y, z, item.block);
      global.MCSound.place();
      if (item.ammo !== undefined) { this.ammo[item.key]--; this._updateAmmoUI(); }
    }

    // ------------------------------------------------------------- frame ---
    _frame(nowMs) {
      if (!this._running) return; // stopped by _leaveToMenu()
      this._rafId = requestAnimationFrame(this._frame);
      let dt = (nowMs - this.lastFrameTime) / 1000;
      this.lastFrameTime = nowMs;
      dt = Math.min(0.05, Math.max(0, dt));
      this._fpsAccum = (this._fpsAccum || 0) + 1;
      this._fpsT = (this._fpsT || 0) + dt;
      if (this._fpsT > 0.5) { this.hud.fps.textContent = Math.round(this._fpsAccum / this._fpsT) + ' fps'; this._fpsAccum = 0; this._fpsT = 0; }
      this.hud.ping.textContent = Math.round(this.net.ping) + ' ms';

      this.update(dt, nowMs);
      this.render(dt);
    }

    update(dt, nowMs) {
      this.remeshDirty(4);
      if (this.me.alive) {
        this._updateLocalPlayer(dt);
        this._updateMining(dt);
        this._updateCharging(nowMs);
        this._sendState();
        this._renderEffectsBar();
        // Own walk-cycle animation, only actually needed for third-person
        // self-rendering (see render()) - same speed/sprint-scaled formula
        // _updateRemotes uses for every other player's walkPhase.
        const selfSpeed = Math.hypot(this.me.vx || 0, this.me.vz || 0);
        if (selfSpeed > 0.3 && this.me.onGround) this.selfWalkPhase += dt * (this.me.sprint ? 11 : 8.5);
        else this.selfWalkPhase *= 0.9;
        // Other clients already see us burning via the snapshot's flags bit
        // (see _updateRemotes) - this is just so it's visible in our own
        // first-person view too.
        if (this.me.burning && Math.random() < dt * 18) this._spawnFlameParticle(this.me.x, this.me.y + 0.9, this.me.z);
        // Unlike burning, we know our own active effects exactly (see
        // activeEffects), so we can colour-match the swirl per potion
        // rather than falling back to the generic remote-player tint.
        const activeKinds = Object.keys(this.activeEffects);
        if (activeKinds.length && Math.random() < dt * 6) {
          const potKey = EFFECT_ICON_KEY[activeKinds[(Math.random() * activeKinds.length) | 0]];
          const colors = potKey && global.MCTextures.POTION_COLORS[potKey];
          this._spawnEffectParticle(this.me.x, this.me.y + 0.9, this.me.z, colors && hexToRgb(colors[0]));
        }
      }
      this._updateRemotes(dt);
      this._updateProjectilesLocal(dt);
      if (this.hitmarkerT > 0) this.hitmarkerT -= dt;
      if (this._shakeT > 0) this._shakeT -= dt;
      if (this._flashT > 0) this._flashT -= dt;
      if (this._lightningFlashT > 0) this._lightningFlashT -= dt;
      if (this.weather && this.weather !== 'clear') this._updateRain(dt);
      if (this._groundFires.length) this._updateGroundFires(dt, nowMs);
      this.swingT += dt;
    }

    /** Cosmetic-only local upkeep for active ground fires: a steady flicker
     * of flame particles for as long as each one's server-told duration
     * lasts, then forgotten - the server independently owns the actual
     * damage/ignite hazard (see the groundFires tick in server.js). */
    _updateGroundFires(dt, nowMs) {
      for (let i = this._groundFires.length - 1; i >= 0; i--) {
        const f = this._groundFires[i];
        if (nowMs >= f.until) { this._groundFires.splice(i, 1); continue; }
        if (Math.random() < dt * 14) this._spawnFlameParticle(f.x, f.y, f.z);
      }
    }

    // Rain falls in a box centered on the camera so it's always around the
    // player regardless of where they wander - cheap "screen space" weather
    // rather than tracking real per-block precipitation.
    _updateRain(dt) {
      const drops = this.weather === 'thunder' ? 90 : 55;
      const n = Math.round(drops * dt);
      for (let i = 0; i < n; i++) {
        this.particlesMeta.push({
          x: this.me.x + (Math.random() - 0.5) * 24, y: this.me.y + 10 + Math.random() * 4, z: this.me.z + (Math.random() - 0.5) * 24,
          vx: 0, vy: -14, vz: 0, r: 0.65, g: 0.72, b: 0.85, a: 0.5, size: 0.04, life: 1, t: 0
        });
      }
    }

    _updateLocalPlayer(dt) {
      // Browsing the inventory stops new movement input but not physics -
      // you keep falling/sliding, same as vanilla Minecraft.
      const inv = this.inventoryOpen;
      // A spear Lunge is a burst of velocity way above normal walk/sprint
      // speed - the ground-movement model in shared/physics.js pulls
      // horizontal velocity toward whatever WASD currently asks for every
      // frame, so holding W while lunging (the natural thing to do mid-
      // attack) crushed the dash back down to walk speed within a couple of
      // frames, making it imperceptible. Briefly ignoring movement input
      // right after a lunge lets its own momentum coast/decay instead of
      // being fought, so it actually reads as a dash.
      const lunging = performance.now() < (this._lungeLockUntil || 0);
      const forward = (inv || lunging) ? 0 : (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
      const strafe = (inv || lunging) ? 0 : (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
      const sneak = !inv && !!this.keys.ShiftLeft;
      // ControlLeft used to also trigger sprint, but holding it with W to
      // sprint-forward is literally the browser's "close tab" shortcut -
      // dropped it in favor of purely safe keys.
      const sprint = !inv && (!!this.keys.KeyR || !!this.keys.CapsLock);
      const jump = !inv && !!this.keys.Space;
      this.me.yaw = this.yaw; this.me.pitch = this.pitch;
      // A raised shield takes both hands like in vanilla - no sprinting
      // while blocking, and only sword/pick have a free off-hand to block
      // with (bow draw, pearl throw, block placement all need the right
      // hand busy already).
      const item = ITEMS[this.me.slot];
      const shieldStunned = performance.now() < (this.shieldStunUntil || 0);
      this.me.blocking = !inv && !shieldStunned && this.mouseDown.right && (item.type === 'weapon' || item.type === 'tool');
      this.me.sneak = sneak && !jump;
      this.me.sprint = sprint && forward > 0 && !this.me.blocking;

      // Speed/Slowness potions scale the walk/sprint/sneak target speed
      // itself (vanilla's own rates), same multiplier either way round -
      // Slowness VI (Turtle Master) and Speed II can't both be active at
      // once (see applyPotionEffect, drinking one clears the other).
      const nowMs = performance.now();
      const speedEff = this.activeEffects.speed, slowEff = this.activeEffects.slowness;
      let speedMult = 1;
      if (speedEff && nowMs < speedEff.until) speedMult += C.SPEED_PCT_PER_LEVEL * speedEff.level;
      if (slowEff && nowMs < slowEff.until) speedMult = Math.max(0.05, speedMult - C.SLOWNESS_PCT_PER_LEVEL * slowEff.level);

      // Elytra: jump while airborne starts a glide - matches vanilla's
      // forgiving activation (you don't need to already be falling fast,
      // just off the ground - walk off a ledge and tap jump). Driven by
      // whether it's actually worn in the chest slot now (not just held/
      // selected). Once started it keeps going regardless of what's
      // selected afterward, until landing or sneaking cancels it.
      if (!this.gliding && !inv && this.chestSlot === 'elytra' && !this.me.onGround && this.me.vy <= 0.5 && jump) {
        this.gliding = true;
      }
      if (this.gliding && (this.me.onGround || sneak)) this.gliding = false;

      const wasGround = this.me.onGround;
      const prevY = this.me.y;
      Physics.step((x, y, z) => this.world.get(x, y, z), this.me,
        { forward, strafe, jump, sneak: this.me.sneak, sprint: this.me.sprint, block: this.me.blocking, yaw: this.yaw, pitch: this.pitch, dashing: lunging, glide: this.gliding, speedMult, boosted: performance.now() / 1000 < (this._boostedUntil || 0) }, dt);

      if (!wasGround && this.me.onGround) {
        const fell = prevY - this.me.y;
        if (fell > 1.2) global.MCSound.land();
      }
      if (jump && wasGround && !this._jumpSoundLock) { global.MCSound.jump(); this._jumpSoundLock = true; }
      if (!jump) this._jumpSoundLock = false;

      const speed = Math.hypot(this.me.vx, this.me.vz);
      if (this.me.onGround && speed > 0.3) this.bobPhase += dt * (this.me.sprint ? 11 : 8.5);
      else this.bobPhase *= 0.9;

      if (Physics.headInWater(x => this.world.get(x, this.me.y, x), this.me.x, this.me.y, this.me.z)) {
        // simple: nothing extra, physics.step already handles buoyancy via getBlock lookups below
      }
    }

    _sendState() {
      this._netAccum = (this._netAccum || 0) + 1;
      this.net.sendState({
        x: this.me.x, y: this.me.y, z: this.me.z,
        vx: this.me.vx, vy: this.me.vy, vz: this.me.vz,
        yaw: this.me.yaw, pitch: this.me.pitch,
        g: this.me.onGround, sn: this.me.sneak, sp: this.me.sprint, bl: this.me.blocking, slot: this.me.slot, gl: this.gliding, oh: this.offhand, ch: this.chestSlot
      });
    }

    /** Item to actually mine with - just ITEMS[slot], except the pickaxe
     * with Efficiency V toggled on mines everything much faster. Mining has
     * no server-side timing check (same as every other tool's mineSpeed),
     * so this only ever needs to be right on the client. */
    _miningItem(slot) {
      const item = ITEMS[slot === undefined ? this.me.slot : slot];
      if (item.key === 'pick' && this.myEnchants && this.myEnchants.pick && this.myEnchants.pick.efficiency) {
        return Object.assign({}, item, { mineSpeed: item.mineSpeed * C.PICK_EFFICIENCY_MULT });
      }
      return item;
    }

    _updateMining(dt) {
      const item = this._miningItem();
      if (!this.mouseDown.left) { this.mining = null; return; }
      const hit = this._pick();
      if (!hit || hit.type !== 'block') { this.mining = null; return; }
      const b = hit.block;
      if (this.mining && (this.mining.x !== b.x || this.mining.y !== b.y || this.mining.z !== b.z)) this.mining = null;
      if (!this.mining) this.mining = { x: b.x, y: b.y, z: b.z, block: b.block, progress: 0 };
      const time = MC.breakTime(b.block, item);
      if (time === Infinity) return;
      this.mining.progress += dt;
      if (this.mining.progress >= time) {
        this.world.set(b.x, b.y, b.z, ID.AIR);
        this.remeshDirty(30);
        this.net.setBlock(b.x, b.y, b.z, ID.AIR);
        global.MCSound.breakBlock();
        this._spawnBreakParticles(b.x, b.y, b.z, b.block);
        this.mining = null;
      }
    }

    _updateCharging(nowMs) {
      const item = ITEMS[this.me.slot];
      if (this.mouseDown.right && (item.type === 'bow' || item.type === 'crossbow' || item.type === 'food')) {
        const held = (nowMs - this.rightDownAt) / 1000;
        const denom = (item.type === 'bow' || item.type === 'crossbow') ? item.drawTime : item.eatTime;
        const frac = clamp(held / denom, 0, 1);
        this.hud.chargeWrap.classList.remove('hidden');
        this.hud.chargeFill.style.width = Math.round(frac * 100) + '%';
        if ((item.type === 'bow' || item.type === 'crossbow') && Math.floor(held * 10) !== this._lastDrawTick) { this._lastDrawTick = Math.floor(held * 10); }
      } else if (this.mouseDown.left && item.key === 'spear' && this._spearChargeStart) {
        const held = (nowMs - this._spearChargeStart) / 1000;
        const frac = clamp(held / C.SPEAR_CHARGE_HOLD, 0, 1);
        this.hud.chargeWrap.classList.remove('hidden');
        this.hud.chargeFill.style.width = Math.round(frac * 100) + '%';
      } else {
        this.hud.chargeWrap.classList.add('hidden');
      }
    }

    _updateRemotes(dt) {
      const now = performance.now();
      for (const r of this.remote.values()) {
        const age = (now - (r.snapT || now)) / 1000;
        const lerp = 1 - Math.pow(0.001, dt * 12);
        r.x += (r.tx - r.x) * lerp; r.y += (r.ty - r.y) * lerp; r.z += (r.tz - r.z) * lerp;
        let dyaw = r.tyaw - r.yaw;
        while (dyaw > Math.PI) dyaw -= TAU;
        while (dyaw < -Math.PI) dyaw += TAU;
        r.yaw += dyaw * lerp;
        r.pitch += (r.tpitch - r.pitch) * lerp;
        const speed = Math.hypot(r.vx || 0, r.vz || 0);
        if (speed > 0.3 && r.alive) r.walkPhase = (r.walkPhase || 0) + dt * (r.sprint ? 11 : 8.5);
        else r.walkPhase = (r.walkPhase || 0) * 0.9;
        if (r.swingT !== undefined && r.swingT >= 0) r.swingT += dt;
        if (r.burning && r.alive && Math.random() < dt * 18) this._spawnFlameParticle(r.x, r.y + 0.9, r.z);
        // Remote clients only ever get a yes/no "has some potion effect"
        // flag (see _applySnapshot), not which one - a neutral swirl colour
        // reads fine for "this player is buffed/debuffed" without needing
        // to know which.
        if (r.hasEffect && r.alive && Math.random() < dt * 6) this._spawnEffectParticle(r.x, r.y + 0.9, r.z);
      }
    }

    /** One little lick of fire (Fire Aspect/Flame) - called continuously
     * while a player (remote or local) is burning, not just as a one-shot
     * effect burst. */
    _spawnFlameParticle(x, y, z) {
      this.particlesMeta.push({
        x: x + (Math.random() - 0.5) * 0.5, y: y + (Math.random() - 0.5) * 0.3, z: z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.4, vy: 1.2 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4,
        r: 1, g: 0.55 + Math.random() * 0.25, b: 0.1, a: 1, size: 0.09, life: 0.35, t: 0
      });
    }

    /** A gentle rising sparkle around a player with an active potion effect
     * (Strength/Speed/Slowness/Resistance/Fire Resistance) - vanilla's own
     * swirling potion particles, simplified. `color` is an [r,g,b] triple
     * (0..1); defaults to a neutral lavender for remote players, whose
     * client only knows *that* they're buffed, not with what. */
    _spawnEffectParticle(x, y, z, color) {
      const c = color || [0.72, 0.55, 0.95];
      this.particlesMeta.push({
        x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.5, z: z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.3,
        r: c[0], g: c[1], b: c[2], a: 0.85, size: 0.08, life: 0.6, t: 0
      });
    }

    _updateProjectilesLocal(dt) {
      const g = { arrow: C.ARROW_GRAVITY, pearl: C.PEARL_GRAVITY, windcharge: C.WINDCHARGE_GRAVITY, potion: C.POTION_GRAVITY, trident: C.TRIDENT_GRAVITY };
      for (const pr of this.projectiles.values()) {
        pr.vy -= g[pr.kind] * dt;
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
        if (pr.correctX !== undefined) {
          const k = 1 - Math.pow(0.001, dt * 8);
          pr.x += (pr.correctX - pr.x) * k; pr.y += (pr.correctY - pr.y) * k; pr.z += (pr.correctZ - pr.z) * k;
        }
        if (pr.kind === 'arrow' && Math.random() < dt * 40) this._pushTrail(pr);
      }
      this._updateParticles(dt);
    }

    _pushTrail(pr) {
      this.particlesMeta.push({ x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0.1, vz: 0, r: 0.85, g: 0.8, b: 0.6, a: 0.5, size: 0.05, life: 0.3, t: 0 });
    }

    _spawnBreakParticles(x, y, z, blockId) {
      for (let i = 0; i < 14; i++) {
        this.particlesMeta.push({
          x: x + 0.5 + (Math.random() - 0.5) * 0.8, y: y + 0.5 + (Math.random() - 0.5) * 0.8, z: z + 0.5 + (Math.random() - 0.5) * 0.8,
          vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3,
          r: 0.55, g: 0.5, b: 0.42, a: 1, size: 0.12, life: 0.5, t: 0, gravity: true
        });
      }
    }

    _spawnImpact(x, y, z, kind) {
      const col = kind === 'pearl' ? [0.3, 0.9, 0.7] : [0.8, 0.8, 0.8];
      for (let i = 0; i < 10; i++) {
        this.particlesMeta.push({
          x, y, z, vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2.5,
          r: col[0], g: col[1], b: col[2], a: 1, size: 0.1, life: 0.4, t: 0, gravity: kind !== 'pearl'
        });
      }
    }

    _spawnEffect(d) {
      if (d.kind === 'crit') {
        for (let i = 0; i < 8; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2 + 1, vz: (Math.random() - 0.5) * 2,
          r: 1, g: 1, b: 0.6, a: 1, size: 0.09, life: 0.45, t: 0, gravity: true
        });
      } else if (d.kind === 'eat') {
        for (let i = 0; i < 10; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5,
          r: 1, g: 0.85, b: 0.2, a: 1, size: 0.1, life: 0.5, t: 0, gravity: true
        });
      } else if (d.kind === 'pearl') {
        for (let i = 0; i < 16; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, vz: (Math.random() - 0.5) * 4,
          r: 0.3, g: 0.9, b: 0.75, a: 1, size: 0.12, life: 0.4, t: 0
        });
      } else if (d.kind === 'block') {
        for (let i = 0; i < 6; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 1.6, vy: Math.random() * 1.4, vz: (Math.random() - 0.5) * 1.6,
          r: 0.84, g: 0.84, b: 0.9, a: 1, size: 0.08, life: 0.3, t: 0, gravity: true
        });
        global.MCSound.block();
      } else if (d.kind === 'shieldbreak') {
        for (let i = 0; i < 14; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2.5, vz: (Math.random() - 0.5) * 3,
          r: 1, g: 0.9, b: 0.4, a: 1, size: 0.1, life: 0.4, t: 0, gravity: true
        });
        global.MCSound.shieldBreak();
      } else if (d.kind === 'smash') {
        for (let i = 0; i < 20; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 5,
          r: 0.75, g: 0.72, b: 0.8, a: 1, size: 0.13, life: 0.5, t: 0, gravity: true
        });
        global.MCSound.smash();
      } else if (d.kind === 'windburst') {
        for (let i = 0; i < 16; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 4.5, vy: (Math.random() - 0.2) * 3, vz: (Math.random() - 0.5) * 4.5,
          r: 0.9, g: 0.96, b: 1, a: 0.9, size: 0.11, life: 0.4, t: 0
        });
        global.MCSound.windBurst();
      } else if (d.kind === 'drink') {
        // Splash colour matches the actual potion thrown (see POTION_COLORS
        // in textures.js, same liquid/glint pair as its bottle icon) -
        // falls back to a generic purple for anything unrecognized.
        const colors = global.MCTextures.POTION_COLORS[d.potionKey];
        const liquid = colors ? hexToRgb(colors[0]) : [0.7, 0.4, 0.9];
        const glint = colors ? hexToRgb(colors[1]) : [0.85, 0.65, 1];
        for (let i = 0; i < 16; i++) {
          const c = Math.random() < 0.6 ? liquid : glint;
          this.particlesMeta.push({
            x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 2.2, vy: Math.random() * 2.2, vz: (Math.random() - 0.5) * 2.2,
            r: c[0], g: c[1], b: c[2], a: 1, size: 0.1, life: 0.5, t: 0, gravity: true
          });
        }
      } else if (d.kind === 'lightning') {
        // A visible bolt "sketched" as a tall stack of bright particles
        // (no dedicated line-drawing in the renderer) plus a bright crackle
        // burst at the strike point, and a screen-wide flash if it's close.
        // Sized up to match the real area-damage/ignite radius it now
        // carries server-side, not just a cosmetic flicker anymore.
        for (let i = 0; i < 34; i++) {
          const h = i / 33;
          this.particlesMeta.push({
            x: d.x + (Math.random() - 0.5) * 0.6 * h, y: d.y + h * 20, z: d.z + (Math.random() - 0.5) * 0.6 * h,
            vx: (Math.random() - 0.5) * 0.7, vy: 0, vz: (Math.random() - 0.5) * 0.7,
            r: 0.85, g: 0.9, b: 1, a: 1, size: 0.2, life: 0.3, t: 0
          });
        }
        for (let i = 0; i < 30; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 7, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 7,
          r: 0.8, g: 0.88, b: 1, a: 1, size: 0.2, life: 0.5, t: 0, gravity: true
        });
        const dist = Math.hypot(d.x - this.me.x, d.y - this.me.y, d.z - this.me.z);
        this._lightningFlashT = clamp(0.65 - dist / 70, 0, 0.65);
        global.MCSound.thunder();
      } else if (d.kind === 'fuse') {
        // A lit TNT block: a handful of little sparks while the fuse burns.
        for (let i = 0; i < 5; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 1.2, vy: Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.2,
          r: 1, g: 0.75, b: 0.2, a: 1, size: 0.08, life: 0.35, t: 0, gravity: true
        });
        global.MCSound.fuse();
      } else if (d.kind === 'groundfire') {
        // Server owns the actual hazard/timer - this just remembers where
        // and for how long to keep drawing flame particles locally.
        this._groundFires.push({ x: d.x, y: d.y, z: d.z, until: performance.now() + (d.duration || 9) * 1000 });
        global.MCSound.ignite();
      } else if (d.kind === 'explosion') {
        const n = Math.min(60, 24 + (d.radius || 5) * 5);
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2, up = Math.random();
          const spd = 3 + Math.random() * ((d.radius || 5) * 1.1);
          this.particlesMeta.push({
            x: d.x, y: d.y, z: d.z,
            vx: Math.cos(ang) * spd * (1 - up * 0.4), vy: up * spd, vz: Math.sin(ang) * spd * (1 - up * 0.4),
            r: 1, g: 0.55 + Math.random() * 0.3, b: 0.15, a: 1, size: 0.22, life: 0.55 + Math.random() * 0.3, t: 0, gravity: true
          });
        }
        for (let i = 0; i < 24; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 2, vy: 0.5 + Math.random() * 3, vz: (Math.random() - 0.5) * 2,
          r: 0.4, g: 0.38, b: 0.36, a: 0.85, size: 0.3, life: 1.1 + Math.random() * 0.6, t: 0
        });
        const dist = Math.hypot(d.x - this.me.x, d.y - this.me.y, d.z - this.me.z);
        this._lightningFlashT = Math.max(this._lightningFlashT || 0, clamp(0.35 - dist / 45, 0, 0.35));
        this._shakeT = Math.max(this._shakeT || 0, clamp(0.5 - dist / 30, 0, 0.5));
        global.MCSound.explosion();
      } else if (d.kind === 'firework') {
        // Smaller and far more colourful than a TNT blast.
        const colors = [[1, 0.3, 0.3], [0.3, 0.7, 1], [1, 0.85, 0.2], [0.4, 1, 0.6], [0.9, 0.4, 1]];
        for (let i = 0; i < 40; i++) {
          const ang = Math.random() * Math.PI * 2, up = Math.random();
          const spd = 2 + Math.random() * 6;
          const c = colors[(Math.random() * colors.length) | 0];
          this.particlesMeta.push({
            x: d.x, y: d.y, z: d.z,
            vx: Math.cos(ang) * spd, vy: up * spd, vz: Math.sin(ang) * spd,
            r: c[0], g: c[1], b: c[2], a: 1, size: 0.14, life: 0.5 + Math.random() * 0.4, t: 0, gravity: true
          });
        }
        const dist = Math.hypot(d.x - this.me.x, d.y - this.me.y, d.z - this.me.z);
        this._lightningFlashT = Math.max(this._lightningFlashT || 0, clamp(0.2 - dist / 30, 0, 0.2));
        global.MCSound.fireworkExplode();
      } else if (d.kind === 'fireworkboost') {
        for (let i = 0; i < 18; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
          r: 1, g: 0.8, b: 0.3, a: 1, size: 0.1, life: 0.35, t: 0
        });
        global.MCSound.fireworkLaunch();
      } else if (d.kind === 'totem') {
        for (let i = 0; i < 30; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 3,
          r: 1, g: 0.85, b: 0.25, a: 1, size: 0.13, life: 0.7 + Math.random() * 0.3, t: 0, gravity: true
        });
        global.MCSound.totem();
      } else if (d.kind === 'crystal') {
        // A big pink/white shatter burst, bigger and brighter than TNT.
        const n = Math.min(90, 30 + (d.radius || 6) * 6);
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2, up = Math.random();
          const spd = 3 + Math.random() * ((d.radius || 6) * 1.3);
          const pink = Math.random() < 0.5;
          this.particlesMeta.push({
            x: d.x, y: d.y, z: d.z,
            vx: Math.cos(ang) * spd * (1 - up * 0.3), vy: up * spd * 1.2, vz: Math.sin(ang) * spd * (1 - up * 0.3),
            r: pink ? 1 : 0.9, g: pink ? 0.6 : 0.9, b: pink ? 0.85 : 1, a: 1, size: 0.2, life: 0.5 + Math.random() * 0.4, t: 0, gravity: true
          });
        }
        const dist = Math.hypot(d.x - this.me.x, d.y - this.me.y, d.z - this.me.z);
        this._lightningFlashT = Math.max(this._lightningFlashT || 0, clamp(0.35 - dist / 40, 0, 0.35));
        this._shakeT = Math.max(this._shakeT || 0, clamp(0.55 - dist / 25, 0, 0.55));
        global.MCSound.crystal();
      } else if (d.kind === 'anchor') {
        // The biggest explosion in the game - reuse the TNT burst shape but
        // scaled way up, with a deep purple tint (respawn anchor's colour).
        const n = Math.min(110, 40 + (d.radius || 8) * 6);
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2, up = Math.random();
          const spd = 3 + Math.random() * ((d.radius || 8) * 1.4);
          this.particlesMeta.push({
            x: d.x, y: d.y, z: d.z,
            vx: Math.cos(ang) * spd * (1 - up * 0.4), vy: up * spd, vz: Math.sin(ang) * spd * (1 - up * 0.4),
            r: 0.55 + Math.random() * 0.3, g: 0.15, b: 0.65 + Math.random() * 0.3, a: 1, size: 0.24, life: 0.6 + Math.random() * 0.4, t: 0, gravity: true
          });
        }
        for (let i = 0; i < 30; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 2.5, vy: 0.5 + Math.random() * 3.5, vz: (Math.random() - 0.5) * 2.5,
          r: 0.35, g: 0.32, b: 0.3, a: 0.85, size: 0.32, life: 1.2 + Math.random() * 0.6, t: 0
        });
        const dist = Math.hypot(d.x - this.me.x, d.y - this.me.y, d.z - this.me.z);
        this._lightningFlashT = Math.max(this._lightningFlashT || 0, clamp(0.5 - dist / 55, 0, 0.5));
        this._shakeT = Math.max(this._shakeT || 0, clamp(0.7 - dist / 35, 0, 0.7));
        global.MCSound.explosion();
        global.MCSound.explosion();
      } else if (d.kind === 'anchorcharge') {
        for (let i = 0; i < 8; i++) this.particlesMeta.push({
          x: d.x, y: d.y, z: d.z, vx: (Math.random() - 0.5) * 1.4, vy: Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.4,
          r: 1, g: 0.8, b: 0.3, a: 1, size: 0.09, life: 0.4, t: 0
        });
        global.MCSound.click();
      }
    }

    _updateParticles(dt) {
      const arr = this.particlesMeta;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.t += dt;
        if (p.t >= p.life) { arr.splice(i, 1); continue; }
        if (p.gravity) p.vy -= 9 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const a = p.a * (1 - p.t / p.life);
        this.renderer.pushParticle(p.x, p.y, p.z, p.r, p.g, p.b, a, p.size);
      }
    }

    // -------------------------------------------------------------- death --
    _onSelfDeath(d) {
      this.me.alive = false;
      this.deadUntilRespawn = true;
      if (this.inventoryOpen) this._toggleInventory();
      document.exitPointerLock && document.exitPointerLock();
      global.MCSound.death();
      const text = d.killerName ? ('Killed by ' + d.killerName) : (d.cause === 'fall' ? 'You fell to your death' : d.cause === 'void' ? 'You fell into the void' : 'You died');
      this.hud.deathText.textContent = text;
      this.hud.deathScreen.classList.remove('hidden');
      let t = C.RESPAWN_TIME;
      clearInterval(this._respawnInt);
      this._respawnInt = setInterval(() => {
        t -= 0.5;
        this.hud.respawnTimer.textContent = Math.max(0, t).toFixed(1) + 's';
        if (t <= 0) clearInterval(this._respawnInt);
      }, 500);
    }

    _pushKillfeed(d) {
      const causeIcon = { sword: '⚔', arrow: '➶', pearl: '◉', fall: '⬇', void: '⚠', suicide: '☠' };
      const text = (d.killerName ? d.killerName : '') + ' ' + (d.killerName ? verbFor(d.cause) : deathVerbFor(d.cause)) + ' ' + d.victimName;
      this.killfeedItems.push({ text, t: 6 });
      this._renderKillfeed();
      setTimeout(() => this._renderKillfeed(), 6000);
    }

    _renderKillfeed() {
      this.killfeedItems = this.killfeedItems.filter(k => (k.t -= 0) || true);
      this.hud.killfeed.innerHTML = this.killfeedItems.slice(-5).map(k => '<div class="kf">' + escapeHtml(k.text) + '</div>').join('');
    }

    _flashDamage() { this._flashT = 0.35; }

    // --------------------------------------------------------------- hud ---
    _buildHotbar() {
      const tiles = this.renderer.tiles;
      this.hud.hotbar.innerHTML = '';
      this.hotbarSlots.forEach((idx, pos) => {
        const cell = document.createElement('div');
        // 'chestplate' is a placeholder (not a real ITEMS index) left behind
        // when the elytra gets equipped in its place - see the elytra-equip
        // branch of _onRightDown() and _wireChestDrag(). Indexing ITEMS with
        // it returns undefined and crashing here on item.type would abort
        // this whole forEach loop, silently dropping every hotbar slot after
        // it - same bugfix as _renderSlotZone's isChestplate check.
        const isChestplate = idx === 'chestplate';
        cell.className = 'slot' + (typeof idx === 'number' && idx === this.me.slot ? ' active' : '') + (idx === null ? ' empty' : '');
        if (isChestplate) {
          cell.appendChild(global.MCTextures.itemIcon('chestplate', 40, this.armorTier));
          const tag = document.createElement('div');
          tag.className = 'count';
          tag.textContent = 'IV';
          cell.appendChild(tag);
        } else if (idx !== null) {
          const item = ITEMS[idx];
          const icon = item.type === 'block' ? global.MCTextures.blockIcon(tiles, item.block, 40) : global.MCTextures.itemIcon(item.key, 40);
          cell.appendChild(icon);
          const count = document.createElement('div');
          count.className = 'count';
          if (item.ammo !== undefined) count.textContent = this.ammo ? this.ammo[item.key] : item.ammo;
          else if (item.key === 'bow' || item.key === 'crossbow') count.textContent = this.ammo ? this.ammo.arrow : '';
          cell.appendChild(count);
        }
        const label = document.createElement('div');
        label.className = 'key';
        label.textContent = pos + 1;
        cell.appendChild(label);
        this.hud.hotbar.appendChild(cell);
      });
    }

    /** Redraws the in-game HUD's offhand icon (next to the hotbar) from
     * `this.offhand` - called at session start and again whenever the
     * offhand item changes (see _renderOffhandSlot()). */
    _buildOffhandHUD() {
      const slot = el('offhandSlot');
      const label = slot.querySelector('.slotlabel');
      slot.innerHTML = '';
      if (label) slot.appendChild(label);
      if (this.offhand === 'shield') {
        slot.appendChild(global.MCTextures.itemIcon('shield', 40));
        slot.title = MC.SHIELD.name + ' — hold RMB with sword/pick to block';
      } else {
        const item = ITEMS.find(i => i.key === this.offhand);
        const icon = item.type === 'block' && this.renderer ? global.MCTextures.blockIcon(this.renderer.tiles, item.block, 40) : global.MCTextures.itemIcon(item.key, 40);
        slot.appendChild(icon);
        if (item.ammo !== undefined) {
          const count = document.createElement('div');
          count.className = 'count';
          count.textContent = this.ammo ? this.ammo[item.key] : item.ammo;
          slot.appendChild(count);
        }
        slot.title = item.name + ' (equipped in offhand)';
      }
    }

    _updateAmmoUI() {
      this._buildHotbar();
      this._buildOffhandHUD();
      // Keep the inventory's hotbar mirror (ammo counts, active slot) in
      // sync too, in case ammo changes while the player is tabbed into it.
      if (this.inventoryOpen) this._buildInventoryUI();
    }

    /** Full-replace snapshot of this player's own active potion effects (see
     * server.js effectsSnapshot) - Speed/Slowness also drive the local
     * movement model (see _updateLocalPlayer's speedMult), everything else
     * is only ever checked server-side and shown here purely for the HUD.
     * Always a full replace, never a merge, so a clock-corrected clean-up
     * server-side (e.g. Speed overwriting Slowness) can't leave a stale
     * entry lingering client-side. */
    _applyEffectsSnapshot(effects) {
      const nowMs = performance.now();
      const next = {};
      for (const kind in effects) next[kind] = { level: effects[kind].level, until: nowMs + effects[kind].remaining * 1000 };
      this.activeEffects = next;
      this._renderEffectsBar();
    }

    /** Top-right HUD strip: one pill per active effect, icon + name/level +
     * a live countdown. Keeps persistent DOM nodes per effect kind (only
     * touching the timer text most frames) rather than rebuilding via
     * innerHTML every frame, so the icon <canvas> isn't torn down and
     * redrawn 60 times a second for nothing. */
    _renderEffectsBar() {
      const bar = this.hud.effectsBar;
      if (!bar) return;
      const nowMs = performance.now();
      const nodes = this._effectNodes || (this._effectNodes = new Map());
      const seen = new Set();
      for (const kind in this.activeEffects) {
        const e = this.activeEffects[kind];
        const remain = (e.until - nowMs) / 1000;
        if (remain <= 0) { delete this.activeEffects[kind]; continue; }
        seen.add(kind);
        let node = nodes.get(kind);
        if (!node) {
          node = document.createElement('div');
          node.className = 'effectpill';
          const iconKey = EFFECT_ICON_KEY[kind];
          if (iconKey) {
            const icon = global.MCTextures.itemIcon(iconKey, 20);
            icon.className = 'effecticon';
            node.appendChild(icon);
          }
          node._label = document.createElement('span');
          node.appendChild(node._label);
          node._timer = document.createElement('b');
          node.appendChild(node._timer);
          nodes.set(kind, node);
          bar.appendChild(node);
        }
        node._label.textContent = (EFFECT_NAME[kind] || kind) + ' ' + (ROMAN[e.level] || e.level) + ' ';
        node._timer.textContent = Math.ceil(remain) + 's';
      }
      // Burning (Fire Aspect/Flame) isn't a potion effect - the server only
      // ever tells us a per-snapshot yes/no (see _applySnapshot), not a
      // precise remaining time, so this pill has no countdown.
      if (this.me.burning) {
        seen.add('burning');
        let node = nodes.get('burning');
        if (!node) {
          node = document.createElement('div');
          node.className = 'effectpill';
          const icon = global.MCTextures.flameIcon(20);
          icon.className = 'effecticon';
          node.appendChild(icon);
          node._label = document.createElement('span');
          node.appendChild(node._label);
          nodes.set('burning', node);
          bar.appendChild(node);
        }
        node._label.textContent = 'Burning';
      }
      for (const [kind, node] of nodes) {
        if (!seen.has(kind)) { node.remove(); nodes.delete(kind); }
      }
    }

    _updateHealthUI() {
      const health = Math.max(0, this.me.health);
      const redCount = Math.ceil(C.MAX_HEALTH / 2);
      const goldCount = Math.ceil((this.me.absorption || 0) / 2);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < redCount; i++) {
        const remain = clamp(health - i * 2, 0, 2);
        frag.appendChild(global.MCTextures.heartIcon(remain / 2, '#e0432a', 18));
      }
      for (let i = 0; i < goldCount; i++) {
        const remain = clamp((this.me.absorption || 0) - i * 2, 0, 2);
        frag.appendChild(global.MCTextures.heartIcon(remain / 2, '#f2d24a', 18));
      }
      this.hud.hearts.innerHTML = '';
      this.hud.hearts.appendChild(frag);
    }

    _renderScoreboard() {
      this.hud.scoreboard.innerHTML = this.scores.map(s => {
        let tag = '';
        if (s.atkDummy) tag = ' <span class="tag dummy">ATK DUMMY</span>';
        else if (s.dummy) tag = ' <span class="tag dummy">DUMMY</span>';
        else if (s.bot) tag = ' <span class="tag">BOT' + (s.difficulty ? '&middot;' + capitalize(s.difficulty) : '') + (s.armor && s.armor !== 'none' ? '&middot;' + capitalize(s.armor) : '') + '</span>';
        return '<tr class="' + (s.id === this.me.id ? 'me' : '') + (s.alive ? '' : ' dead') + '">' +
          '<td>' + escapeHtml(s.name) + tag + '</td>' +
          '<td>' + s.kills + '</td><td>' + s.deaths + '</td><td>' + s.streak + '</td><td>' + (s.ping || '-') + '</td></tr>';
      }).join('');
    }

    _log(text, system) {
      const div = document.createElement('div');
      div.className = 'chatline' + (system ? ' sys' : '');
      div.textContent = text;
      this.hud.chatLog.appendChild(div);
      while (this.hud.chatLog.children.length > 60) this.hud.chatLog.removeChild(this.hud.chatLog.firstChild);
      this.hud.chatLog.scrollTop = this.hud.chatLog.scrollHeight;
      div.style.opacity = '1';
      setTimeout(() => { div.classList.add('fade'); }, 8000);
    }

    // ------------------------------------------------------------ render ---
    render(dt) {
      const r = this.renderer;
      const t = performance.now() / 1000;
      const shakeX = this._shakeT > 0 ? (Math.random() - 0.5) * this._shakeT * 0.05 : 0;
      const shakeY = this._shakeT > 0 ? (Math.random() - 0.5) * this._shakeT * 0.05 : 0;

      const eyePos = [this.me.x, this.me.y + PHYS.EYE + bobOffsetY(this.bobPhase), this.me.z];
      const cam = this._computeCamera(eyePos);
      const eye = cam.eye;
      const sunAngle = 0.9;
      // Rain/thunder mute and grey everything out, and pull fog in close so
      // visibility actually feels worse - thunder is the darkest of the two.
      const wet = this.weather === 'rain' ? 0.7 : (this.weather === 'thunder' ? 1 : 0);
      const skyTop = lerpRGB([0.35, 0.55, 0.92], [0.22, 0.24, 0.28], wet);
      const skyBottom = lerpRGB([0.72, 0.82, 0.95], [0.4, 0.42, 0.46], wet);
      const fogColor = lerpRGB([0.72, 0.82, 0.95], [0.38, 0.4, 0.44], wet);
      const fogNear = wet ? 30 : 60, fogFar = wet ? 75 : 130;

      r.resize();
      r.setCamera(eye, cam.yaw + shakeX, cam.pitch + shakeY, 78 + (this.mouseDown.right && ITEMS[this.me.slot].type === 'bow' ? -6 : 0));
      r.clear(fogColor[0], fogColor[1], fogColor[2]);
      r.drawSky(skyTop, skyBottom, [1, 0.98, 0.85], [Math.cos(sunAngle) * 0.5, 0.55]);
      r.drawWorld(fogColor, fogNear, fogFar);

      // Third person: draw our own body (never rendered in first person)
      // exactly like a remote player, at our real position/pose - the
      // camera itself has already been pulled back/around by _computeCamera.
      if (this.viewMode !== 0 && this.me.alive) {
        if (!this.mySkin) this.mySkin = r.getSkin(this.me.name || '');
        const heldItem = ITEMS[this.me.slot];
        const pose = poseFor(this.selfWalkPhase, this.swingT, heldItem, this.me.blocking);
        r.drawPlayer(this.mySkin, this.me.x, this.me.y, this.me.z, this.me.yaw, pose, [1, 1, 1], 1);
        r.drawArmorLayer(this.armorTier, this.me.x, this.me.y, this.me.z, this.me.yaw, pose, this.myArmorTrim);
        r.drawHeldItem(this.me.blocking ? r.getShieldTexture(this.myShieldTrim) : r.getIconTexture(heldItem), this.me.blocking ? 0.85 : 0.4);
      }

      // remote players
      for (const p of this.remote.values()) {
        if (!p.alive) continue;
        // Fully fogged out at this range anyway (see fogFar above) - skip
        // the whole draw+nametag sequence rather than rendering something
        // invisible. A real win once a 16-bot arena scatters half the
        // roster past typical fight range; zero visual difference since
        // they were already indistinguishable from the fog. Their nametag
        // DOM node (if it exists from being in range a moment ago) has to be
        // explicitly hidden here too, or it freezes in its last position
        // instead of following _drawNameTag's own distance fade.
        if (Math.hypot(p.x - eye[0], p.y - eye[1], p.z - eye[2]) > fogFar) {
          const tag = this._tags && this._tags.get(p.id);
          if (tag) tag.node.style.display = 'none';
          continue;
        }
        if (!p.skin) p.skin = r.getSkin(p.name);
        const heldItem = ITEMS[p.slot || 0];
        const pose = poseFor(p.walkPhase || 0, p.swingT, heldItem, p.blocking);
        r.drawPlayer(p.skin, p.x, p.y, p.z, p.yaw, pose, [1, 1, 1], 1);
        // Real inflated armor geometry worn over the body (see
        // MCEntities.armorParts), not a tint on the skin - drawn as a
        // separate pass right after the body so it layers on top.
        r.drawArmorLayer(p.armor, p.x, p.y, p.z, p.yaw, pose, p.armorTrim);
        // So you can tell what a bot/remote player is actually fighting with -
        // and a raised shield takes visual priority over whatever's in the
        // main hand, same as the local first-person viewmodel does.
        r.drawHeldItem(p.blocking ? r.getShieldTexture(p.shieldTrim) : r.getIconTexture(heldItem), p.blocking ? 0.85 : 0.4);
        this._drawNameTag(p);
        if (p.swingT !== undefined && p.swingT >= 0 && p.swingT < 0.001) p.swingT = 0.001;
        if (p.swingT > 0.4) p.swingT = -1;
      }
      // wolves - same fog-distance skip as remote players above, and
      // _drawNameTag() is reused as-is (it only needs x/y/z/name/health).
      for (const w of this.wolves.values()) {
        if (Math.hypot(w.x - eye[0], w.y - eye[1], w.z - eye[2]) > fogFar) {
          const tag = this._tags && this._tags.get(w.id);
          if (tag) tag.node.style.display = 'none';
          continue;
        }
        r.drawWolf(w.x, w.y, w.z, w.yaw, w.hasArmor);
        this._drawNameTag(w);
      }
      if (this._damageNumbers && this._damageNumbers.length) this._drawDamageNumbers();

      // projectiles
      for (const pr of this.projectiles.values()) {
        if (pr.kind === 'windcharge') {
          const spin = (t * 4 + pr.id * 0.7) % (Math.PI * 2);
          r.drawCharge(pr.x, pr.y, pr.z, spin, PROJECTILE_COLOR.windcharge);
        } else if (pr.kind === 'potion') {
          const spin = (t * 4 + pr.id * 0.7) % (Math.PI * 2);
          const colors = global.MCTextures.POTION_COLORS[pr.potionKey];
          r.drawCharge(pr.x, pr.y, pr.z, spin, colors ? hexToRgb(colors[0]) : PROJECTILE_COLOR.windcharge);
        } else {
          const yaw = Math.atan2(-pr.vx, -pr.vz);
          const pitch = Math.atan2(pr.vy, Math.hypot(pr.vx, pr.vz));
          r.drawArrow(pr.x, pr.y, pr.z, yaw, -pitch, PROJECTILE_COLOR[pr.kind]);
        }
      }

      // block break overlay + selection
      if (this.me.alive) {
        const item = ITEMS[this.me.slot];
        const canMelee = item.type === 'weapon' || item.type === 'tool';
        const meleeTarget = canMelee ? (item.pierce ? this._pickAttackTargets(item)[0] : this._pickAttackTarget()) : null;
        const hit = this._pick();
        if (hit && hit.type === 'block') {
          r.drawSelection(hit.block.x, hit.block.y, hit.block.z);
          if (this.mining && this.mining.x === hit.block.x && this.mining.y === hit.block.y && this.mining.z === hit.block.z) {
            const time = MC.breakTime(this.mining.block, this._miningItem());
            const stage = Math.min(9, Math.floor((this.mining.progress / time) * 10));
            r.drawBreakOverlay(hit.block.x, hit.block.y, hit.block.z, stage);
          }
        }
        this.hud.crosshair.classList.toggle('target', !!meleeTarget || !!hit);
      }

      const camRight = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
      const camUp = [0, 1, 0];
      r.drawParticles(camRight, camUp);

      // The viewmodel is drawn in a fixed camera-relative space (see its own
      // comment further down) - only makes sense glued to the lens in first
      // person. Third person shows the held item on the body model instead
      // (drawHeldItem above, same as any remote player).
      if (this.viewMode === 0) this._drawViewmodel(t);
      this._updateDamageFlashDOM();
      this.hud.ammo.textContent = ammoLabel(this.me.slot, this.ammo);
      const offhand = el('offhandSlot');
      offhand.classList.toggle('blocking', !!(this.me.alive && this.me.blocking));
      offhand.classList.toggle('stunned', performance.now() < (this.shieldStunUntil || 0));
    }

    _drawNameTag(p) {
      // Lightweight DOM-based name tags projected to screen space.
      let tag = this._tags = this._tags || new Map();
      let entry = tag.get(p.id);
      if (!entry) {
        const node = document.createElement('div');
        node.className = 'nametag';
        const nameEl = document.createElement('div');
        nameEl.className = 'nametag-name';
        const barWrap = document.createElement('div');
        barWrap.className = 'nametag-hp-wrap';
        const bar = document.createElement('div');
        bar.className = 'nametag-hp';
        barWrap.appendChild(bar);
        node.appendChild(nameEl);
        node.appendChild(barWrap);
        document.getElementById('tags').appendChild(node);
        entry = { node, nameEl, bar };
        tag.set(p.id, entry);
      }
      const node = entry.node;
      entry.nameEl.textContent = p.name + (p.dummy ? ' [DUMMY]' : (p.bot ? ' [BOT]' : ''));
      const pct = clamp((p.health || 0) / C.MAX_HEALTH, 0, 1);
      entry.bar.style.width = Math.round(pct * 100) + '%';
      entry.bar.style.background = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#e0a72a' : '#e0432a';
      const vp = this.renderer.viewProj;
      const wx = p.x, wy = p.y + 2.05, wz = p.z;
      const cx4 = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12];
      const cy4 = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13];
      const cw4 = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];
      if (cw4 <= 0.05) { node.style.display = 'none'; return; }
      const ndcX = cx4 / cw4, ndcY = cy4 / cw4;
      const sx = (ndcX * 0.5 + 0.5) * window.innerWidth;
      const sy = (1 - (ndcY * 0.5 + 0.5)) * window.innerHeight;
      node.style.display = 'block';
      // translate3d instead of left/top - with a full 16-bot arena this runs
      // once per visible nametag every frame, and left/top forces a layout
      // reflow each time where a transform is GPU-composited instead. The
      // -50%/-100% centering offset (see .nametag in style.css) moves into
      // this same transform chain since setting it here overrides the CSS one.
      node.style.transform = 'translate3d(' + sx + 'px,' + sy + 'px,0) translate(-50%,-100%)';
      const dist = Math.hypot(p.x - this.me.x, p.y - this.me.y, p.z - this.me.z);
      node.style.opacity = dist > 55 ? '0' : '1';
    }

    /** Spawns one floating damage number at a world position (the "Show
     * damage numbers" menu option) - bright, outlined text that drifts up
     * and fades out over ~1s, then removes itself. Projected to screen
     * space every frame in _drawDamageNumbers(), same technique as
     * _drawNameTag(). */
    _spawnDamageNumber(x, y, z, amount) {
      const node = document.createElement('div');
      node.className = 'dmgnum';
      node.textContent = (Math.round(amount * 10) / 10).toString();
      document.getElementById('tags').appendChild(node);
      this._damageNumbers.push({
        x: x + (Math.random() - 0.5) * 0.4, y: y + 1.6, z: z + (Math.random() - 0.5) * 0.4,
        node, born: performance.now()
      });
    }

    _drawDamageNumbers() {
      const life = 1000; // ms
      const vp = this.renderer.viewProj;
      const now = performance.now();
      for (let i = this._damageNumbers.length - 1; i >= 0; i--) {
        const d = this._damageNumbers[i];
        const age = now - d.born;
        if (age >= life) { d.node.remove(); this._damageNumbers.splice(i, 1); continue; }
        const frac = age / life;
        const wy = d.y + frac * 1.1; // drifts upward as it ages
        const cx4 = vp[0] * d.x + vp[4] * wy + vp[8] * d.z + vp[12];
        const cy4 = vp[1] * d.x + vp[5] * wy + vp[9] * d.z + vp[13];
        const cw4 = vp[3] * d.x + vp[7] * wy + vp[11] * d.z + vp[15];
        if (cw4 <= 0.05) { d.node.style.display = 'none'; continue; }
        const ndcX = cx4 / cw4, ndcY = cy4 / cw4;
        const sx = (ndcX * 0.5 + 0.5) * window.innerWidth;
        const sy = (1 - (ndcY * 0.5 + 0.5)) * window.innerHeight;
        d.node.style.display = 'block';
        // Same transform-instead-of-left/top reflow fix as _drawNameTag.
        d.node.style.transform = 'translate3d(' + sx + 'px,' + sy + 'px,0) translate(-50%,-100%)';
        d.node.style.opacity = String(Math.max(0, 1 - frac));
      }
    }

    _drawViewmodel() {
      // A minimal first-person hand: reuse the player arm mesh, drawn with a
      // fixed camera-relative transform (not affected by world VP fog).
      const r = this.renderer;
      const gl = r.gl;
      const item = ITEMS[this.me.slot];
      const M4 = global.GLX.M4;

      gl.clear(gl.DEPTH_BUFFER_BIT);
      const proj = M4.create();
      M4.perspective(proj, 70 * Math.PI / 180, r.aspect, 0.01, 4);
      const view = M4.create();
      M4.identity(view);
      const vp = M4.create();
      M4.multiply(vp, proj, view);

      const swing = Math.min(1, this.swingT / 0.22);
      const s = Math.sin(Math.min(Math.PI, swing * Math.PI));
      const bob = bobOffsetY(this.bobPhase) * 0.6;
      const blocking = this.me.alive && this.me.blocking;
      // Kept far enough from the tiny viewmodel camera that its own depth
      // extent stays small relative to its distance - too close (it used to
      // sit at z=-0.62) makes one edge of the item noticeably nearer than
      // the other under a wide FOV, stretching it into a distorted wedge
      // that fills much of the screen instead of reading as a held item.
      // A raised shield sits centred and close, not off to the side mid-swing.
      const x = blocking ? 0.22 : 0.75;
      const y = blocking ? -0.22 + bob : -0.62 + bob - s * 0.16;
      const z = blocking ? -0.82 : -1.35 - s * 0.3;
      const rx = blocking ? 0.02 : -0.08 + s * 0.35;
      const ry = blocking ? 0.05 : 0.12 - s * 0.18;

      if (item.type === 'block') {
        const vao = r.getBlockCubeVAO(item.block);
        gl.useProgram(r.progChunk);
        gl.uniformMatrix4fv(r.progChunk.u.uVP, false, vp);
        gl.uniform3f(r.progChunk.u.uOffset, 0, 0, 0);
        gl.uniform3fv(r.progChunk.u.uFogColor, [0, 0, 0]);
        gl.uniform1f(r.progChunk.u.uFogNear, 999); gl.uniform1f(r.progChunk.u.uFogFar, 1000);
        gl.uniform1f(r.progChunk.u.uAlpha, 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.blockTexture);
        gl.uniform1i(r.progChunk.u.uTex, 0);
        const m = M4.create();
        M4.fromTRS(m, x, y, z, rx, ry, 0, 0.38, 0.38, 0.38);
        // bake model into offset by multiplying vp*model manually since chunk shader adds uOffset to local pos
        const mvp = M4.create();
        M4.multiply(mvp, vp, m);
        gl.uniformMatrix4fv(r.progChunk.u.uVP, false, mvp);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(vao.vao);
        gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
        gl.enable(gl.CULL_FACE);
      } else {
        const key = blocking ? 'shield' : (item.type === 'tool' ? 'pick' : item.key);
        const tex = this._viewIconTex || (this._viewIconTex = {});
        // A raised shield gets a much higher-res canvas than a normal item
        // icon - it's rendered far bigger both here and out in the world
        // (drawHeldItem's scale), so a painted trim actually has enough
        // pixels to read clearly instead of blurring. The trim itself is
        // fixed for the whole session (chosen at the menu, see start()), so
        // this cache never needs to invalidate mid-match.
        if (!tex[key]) {
          const size = blocking ? global.MCTextures.SHIELD_ICON_SIZE : 64;
          tex[key] = uploadCanvasTex(gl, global.MCTextures.itemIcon(key, size, null, blocking ? this.myShieldTrim : null));
        }
        const vao = this._viewQuad || (this._viewQuad = quadVAO(gl));
        gl.useProgram(r.progEntity);
        gl.uniformMatrix4fv(r.progEntity.u.uVP, false, vp);
        const m = M4.create();
        const scale = blocking ? 0.85 : 0.36;
        M4.fromTRS(m, x, y, z, rx, ry, 0.12, scale, scale, scale);
        gl.uniformMatrix4fv(r.progEntity.u.uModel, false, m);
        gl.uniform3fv(r.progEntity.u.uTint, [1, 1, 1]);
        gl.uniform1f(r.progEntity.u.uAlpha, 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[key]);
        gl.uniform1i(r.progEntity.u.uTex, 0);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(vao.vao);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
        gl.enable(gl.CULL_FACE);
      }
    }

    _updateDamageFlashDOM() {
      const f = el('flash');
      if (this._flashT > 0) f.style.opacity = String(clamp(this._flashT / 0.35, 0, 1) * 0.45);
      else f.style.opacity = '0';
      const wf = el('weatherFlash');
      if (wf) wf.style.opacity = this._lightningFlashT > 0 ? String(clamp(this._lightningFlashT / 0.5, 0, 1) * 0.8) : '0';
    }
  }

  // -------------------------------------------------------------- helpers --
  const PROJECTILE_COLOR = { arrow: [0.55, 0.42, 0.28], pearl: [0.25, 0.85, 0.7], windcharge: [0.88, 0.95, 0.97], trident: [0.75, 0.8, 0.85] };
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerpRGB(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function nextFrame() { return new Promise(res => requestAnimationFrame(() => res())); }
  function bobOffsetY(phase) { return Math.abs(Math.sin(phase)) * 0.06; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  /** Reads a saved trim grid (see the customize-trims editor) from
   * localStorage - null if there's never been one saved, or it's corrupt/
   * stale from an older grid size, so start()/net.connect() always get
   * either a valid trim or a clean null rather than needing to re-validate. */
  function loadTrim(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return MC.isValidTrim(arr) ? arr : null;
    } catch (e) { return null; }
  }
  function saveTrim(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) { /* private-window/quota - trim just won't persist */ }
  }
  function verbFor(cause) {
    return {
      sword: 'slew', arrow: 'shot', pearl: 'ambushed', fall: 'knocked off', void: 'ended',
      mace: 'smashed', spear: 'skewered', windcharge: 'blew away', trident: 'impaled', stick: 'yeeted',
      fire: 'burned', lava: 'melted', tnt: 'blew up'
    }[cause] || 'defeated';
  }
  function deathVerbFor(cause) {
    return cause === 'fall' ? 'fell to their death' : cause === 'void' ? 'fell into the void' : cause === 'suicide' ? 'gave up' :
      cause === 'lava' ? 'burned to a crisp' : cause === 'tnt' ? 'blew up' : 'died';
  }
  function ammoLabel(slot, ammo) {
    const item = ITEMS[slot];
    if (!ammo) return '';
    if (item.type === 'bow' || item.type === 'crossbow') return 'Arrows: ' + ammo.arrow;
    if (item.type === 'pearl') return 'Pearls: ' + ammo.pearl;
    if (item.type === 'food') return item.name + ': ' + ammo[item.key];
    if (item.type === 'windcharge') return 'Wind Charges: ' + ammo.windcharge;
    if (item.type === 'potion') return item.name + ': ' + ammo[item.key];
    if (item.type === 'block' && item.ammo !== undefined) return item.name + ': ' + ammo[item.key];
    if (item.type === 'totem') return 'Totems: ' + ammo.totem;
    if (item.type === 'firework') return 'Fireworks: ' + ammo.firework;
    if (item.type === 'spawn_egg') return 'Wolf Spawn Eggs: ' + ammo.wolf_spawn_egg;
    return '';
  }

  function poseFor(walkPhase, swingT, item, blocking) {
    const swing = swingT !== undefined && swingT >= 0 ? Math.min(1, swingT / 0.22) : 0;
    const s = Math.sin(Math.min(Math.PI, swing * Math.PI));
    const legSwing = Math.sin(walkPhase) * 0.7;
    return {
      legR: { rx: legSwing },
      legL: { rx: -legSwing },
      // A raised shield holds the off-arm up and inward across the chest,
      // overriding its usual idle walk-swing.
      armL: blocking ? { rx: -2.1, ry: 0.5 } : { rx: -legSwing * 0.8 },
      armR: { rx: -legSwing * 0.5 - s * 1.8, ry: s * 0.3 }
    };
  }

  function uploadCanvasTex(gl, cv) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function quadVAO(gl) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, 0.5, 0, 0, 0, 1,
      -0.5, -0.5, 0, 0, 1, 1,
      0.5, 0.5, 0, 1, 0, 1,
      0.5, -0.5, 0, 1, 1, 1
    ]), gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao };
  }

  window.addEventListener('DOMContentLoaded', () => { global.MCGame = new Game(); });
})(window);
