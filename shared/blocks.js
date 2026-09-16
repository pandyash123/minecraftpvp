/*
 * Shared block / item definitions. Loaded by both the Node server and the
 * browser client, so it must stay dependency free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCBlocks = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var WORLD = {
    SX: 64,
    SY: 48,
    SZ: 64,
    SEA: 1, // effectively unused: the arena has no ocean
    CHUNK: 16 // horizontal chunk size; chunks are full height
  };

  // Texture array layer indices. Layers are painted procedurally by the client
  // (public/js/textures.js) in exactly this order.
  var T = {
    GRASS_TOP: 0,
    GRASS_SIDE: 1,
    DIRT: 2,
    STONE: 3,
    COBBLE: 4,
    LOG_SIDE: 5,
    LOG_TOP: 6,
    LEAVES: 7,
    SAND: 8,
    WATER: 9,
    PLANKS: 10,
    GLASS: 11,
    BEDROCK: 12,
    OBSIDIAN: 13,
    GRAVEL: 14,
    IRON: 15,
    GOLD: 16,
    BRICK: 17,
    IRON_ORE: 18,
    GOLD_ORE: 19,
    COBWEB: 20,
    LAVA: 21,
    TNT: 22,
    TNT_MINECART: 23,
    RAIL: 24,
    POWDER_SNOW: 25,
    END_CRYSTAL: 26,
    RESPAWN_ANCHOR: 27,
    GLOWSTONE: 28,
    CRACKS: 29 // 29..38 = break stages 0..9
  };
  T.TILE_COUNT = 39;

  var ID = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    COBBLE: 4,
    LOG: 5,
    LEAVES: 6,
    SAND: 7,
    WATER: 8,
    PLANKS: 9,
    GLASS: 10,
    BEDROCK: 11,
    OBSIDIAN: 12,
    GRAVEL: 13,
    IRON: 14,
    GOLD: 15,
    BRICK: 16,
    IRON_ORE: 17,
    GOLD_ORE: 18,
    COBWEB: 19,
    LAVA: 20,
    TNT: 21,
    TNT_MINECART: 22,
    RAIL: 23,
    POWDER_SNOW: 24,
    END_CRYSTAL: 25,
    RESPAWN_ANCHOR: 26,
    GLOWSTONE: 27
  };

  // solid   -> blocks player movement
  // opaque  -> hides the neighbouring face and blocks skylight
  // pick    -> mined quickly with a pickaxe
  var BLOCKS = [
    { name: 'Air', solid: false, opaque: false, hardness: 0 },
    { name: 'Grass Block', top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT, hardness: 0.6, tint: true },
    { name: 'Dirt', all: T.DIRT, hardness: 0.5 },
    { name: 'Stone', all: T.STONE, hardness: 1.5, pick: true },
    { name: 'Cobblestone', all: T.COBBLE, hardness: 2.0, pick: true },
    { name: 'Oak Log', top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP, hardness: 2.0 },
    { name: 'Leaves', all: T.LEAVES, hardness: 0.2, solid: false, opaque: false, tint: true },
    { name: 'Sand', all: T.SAND, hardness: 0.5 },
    { name: 'Water', all: T.WATER, hardness: 0, solid: false, opaque: false, liquid: true },
    { name: 'Oak Planks', all: T.PLANKS, hardness: 2.0 },
    { name: 'Glass', all: T.GLASS, hardness: 0.3, opaque: false },
    { name: 'Bedrock', all: T.BEDROCK, hardness: -1 },
    { name: 'Obsidian', all: T.OBSIDIAN, hardness: 12, pick: true },
    { name: 'Gravel', all: T.GRAVEL, hardness: 0.6 },
    { name: 'Block of Iron', all: T.IRON, hardness: 5, pick: true },
    { name: 'Block of Gold', all: T.GOLD, hardness: 3, pick: true },
    { name: 'Bricks', all: T.BRICK, hardness: 2, pick: true },
    { name: 'Iron Ore', all: T.IRON_ORE, hardness: 3, pick: true },
    { name: 'Gold Ore', all: T.GOLD_ORE, hardness: 3, pick: true },
    // Walk-through (no collision) but drastically slows anyone standing in it,
    // same as vanilla cobwebs - see PHYS.WEB_SPEED in shared/physics.js.
    { name: 'Cobweb', all: T.COBWEB, hardness: 4, solid: false, opaque: false, web: true },
    // Placed with a lava bucket - swimmable like water (shares the generic
    // `liquid` flag with Physics/the mesher) but hurts anyone standing in it
    // and ignites them, see server.js's per-tick lava damage check.
    { name: 'Lava', all: T.LAVA, hardness: 0, solid: false, opaque: false, liquid: true, lava: true },
    // TNT / TNT Minecart: inert until lit with flint and steel (see
    // server.js's 'ignite' handler + the liveTNT fuse/explosion tick) - both
    // are solid, standable, ordinary-hardness blocks otherwise.
    { name: 'TNT', all: T.TNT, hardness: 0 },
    { name: 'TNT Minecart', all: T.TNT_MINECART, hardness: 0 },
    // A TNT Minecart can only be placed directly on top of a rail (see
    // server.js's 'setBlock' handler) - a plain, unlimited utility block
    // otherwise, same tier as cobble/planks. Renders as a thin flat slab
    // (see mesher.js's RAIL_HEIGHT), not a full cube - still solid/full
    // collision though, so it's still walkable like normal ground.
    { name: 'Rail', all: T.RAIL, hardness: 0.5, opaque: false },
    // Walk/fall-through like a cobweb (no collision), but the opposite
    // effect - see server.js's fall-damage and burn checks: standing/landing
    // in it cancels fall damage and extinguishes fire instead of hurting you.
    { name: 'Powder Snow', all: T.POWDER_SNOW, hardness: 0.3, solid: false, opaque: false, powderSnow: true },
    // Can only be placed on top of obsidian (see server.js's 'setBlock'
    // handler) - non-solid (you can walk through/under it, matching
    // vanilla's floating crystal) and never occludes light. Hit it (melee
    // or a projectile) to detonate - see server.js's 'hitCrystal' handler
    // and detonateEndCrystal().
    { name: 'End Crystal', all: T.END_CRYSTAL, hardness: 0, solid: false, opaque: false },
    // Charge with glowstone (right-click it while holding glowstone) up to
    // 4 times - the 4th charge detonates it immediately, a bigger blast
    // than an end crystal. See server.js's 'chargeAnchor' handler.
    { name: 'Respawn Anchor', all: T.RESPAWN_ANCHOR, hardness: 3, pick: true },
    // A plain light-emitting decorative block - also what charges a
    // respawn anchor (right-click one instead of placing normally).
    { name: 'Glowstone', all: T.GLOWSTONE, hardness: 0.3 }
  ];

  var N = BLOCKS.length;
  var SOLID = new Uint8Array(N);
  var OPAQUE = new Uint8Array(N);
  var LIQUID = new Uint8Array(N);
  var WEB = new Uint8Array(N);
  var POWDER_SNOW = new Uint8Array(N);
  var HARDNESS = new Float32Array(N);
  var PICKABLE = new Uint8Array(N);
  // per-face tile: order +X, -X, +Y, -Y, +Z, -Z
  var TILES = new Int32Array(N * 6);

  for (var i = 0; i < N; i++) {
    var b = BLOCKS[i];
    b.id = i;
    SOLID[i] = b.solid === false ? 0 : 1;
    OPAQUE[i] = b.opaque === false ? 0 : 1;
    LIQUID[i] = b.liquid ? 1 : 0;
    WEB[i] = b.web ? 1 : 0;
    POWDER_SNOW[i] = b.powderSnow ? 1 : 0;
    HARDNESS[i] = b.hardness === undefined ? 1 : b.hardness;
    PICKABLE[i] = b.pick ? 1 : 0;
    var top = b.top !== undefined ? b.top : b.all;
    var bot = b.bottom !== undefined ? b.bottom : b.all;
    var side = b.side !== undefined ? b.side : b.all;
    if (i === ID.AIR) { top = bot = side = 0; }
    TILES[i * 6 + 0] = side;
    TILES[i * 6 + 1] = side;
    TILES[i * 6 + 2] = top;
    TILES[i * 6 + 3] = bot;
    TILES[i * 6 + 4] = side;
    TILES[i * 6 + 5] = side;
  }
  OPAQUE[ID.AIR] = 0;

  // ---------------------------------------------------------------- items --
  // The kit every player spawns with. Slot order == hotbar order.
  // Sharpness/Power/Knockback/Punch/Looting/Fire Aspect/Flame/Protection/
  // Thorns are no longer baked into separate items - they're per-player
  // toggles (see ENCHANT_DEFS below and COMBAT's ENCHANT_* constants),
  // chosen in the menu's Enchantments panel and applied dynamically in
  // combat. These base entries are each weapon's unenchanted numbers.
  var ITEMS = [
    { key: 'sword', name: 'Diamond Sword', type: 'weapon', damage: 7, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    // Mechanically just a sword - same enchant slot, same armor/shield-break/
    // looting handling (see server.js's baseWeaponKey()) - only the base
    // damage is higher, a small edge to match its rarer material.
    { key: 'netherite_sword', name: 'Netherite Sword', type: 'weapon', damage: 8, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    { key: 'bow', name: 'Bow', type: 'bow', maxDamage: 10, minDamage: 2, drawTime: 1.0, mineSpeed: 0.3 },
    // ammo here doubles as the max stack size - also what you spawn with.
    { key: 'pearl', name: 'Ender Pearl', type: 'pearl', ammo: 16, cooldown: 1.6, mineSpeed: 0.3 },
    // Absorption is instant on eating; the 4 hearts of real healing trickle
    // in afterward via Regeneration I (8 HP over 8s = 1 HP/s), not a flat
    // instant heal.
    { key: 'gapple', name: 'Golden Apple', type: 'food', heal: 0, absorb: 4, eatTime: 1.3, ammo: 64, mineSpeed: 0.3,
      regenLevel: 1, regenSeconds: 8 },
    { key: 'pick', name: 'Iron Pickaxe', type: 'tool', damage: 3, cooldown: 0.5, knockback: 0.6, mineSpeed: 6, pick: true },
    { key: 'cobble', name: 'Cobblestone', type: 'block', block: ID.COBBLE, mineSpeed: 0.3 },
    { key: 'planks', name: 'Oak Planks', type: 'block', block: ID.PLANKS, mineSpeed: 0.3 },
    { key: 'cobweb', name: 'Cobweb', type: 'block', block: ID.COBWEB, mineSpeed: 0.3 },
    // Slower and hits harder than the sword, and any hit that connects while
    // the victim is blocking punches straight through their shield (no
    // damage reduction from it) and stuns it for a few seconds.
    { key: 'axe', name: 'Iron Axe', type: 'weapon', damage: 9, cooldown: 0.9, knockback: 1.3, mineSpeed: 0.5 },
    // Same deal as netherite_sword above - just an axe, slightly harder-hitting.
    { key: 'netherite_axe', name: 'Netherite Axe', type: 'weapon', damage: 10, cooldown: 0.9, knockback: 1.3, mineSpeed: 0.5 },
    // Weak on a normal swing - its real damage only comes from a "smash
    // attack" (falling and not on the ground when it lands, same rule as a
    // crit): Density V scales that bonus with fall distance, and Wind Burst
    // III launches the wielder skyward afterwards so smashes can be chained.
    // See COMBAT.MACE_* below for the actual numbers.
    { key: 'mace', name: 'Mace (Density V, Wind Burst III)', type: 'weapon', damage: 4, cooldown: 0.9, knockback: 1.2, mineSpeed: 0.4 },
    // Longer reach than a sword but can't jab a target standing right on top
    // of you (minReach), pierces every target in a line instead of just the
    // nearest one, and Lunge III propels the wielder forward horizontally on
    // every landed jab (stronger mid-air) - see COMBAT.SPEAR_* below.
    { key: 'spear', name: 'Spear (Lunge III, Sharpness V)', type: 'weapon', damage: 7, cooldown: 1.6, knockback: 0.9, mineSpeed: 0.4, reach: 4.5, minReach: 1.2, pierce: true },
    // Right-click: launches the thrower upward immediately (vanilla's "wind
    // charge jump") and lobs a slow-falling charge that shoves anyone caught
    // in its blast on impact. If it touches an ender pearl still in flight,
    // the thrower is instantly pulled to the pearl instead of exploding.
    { key: 'windcharge', name: 'Wind Charge', type: 'windcharge', ammo: 64, cooldown: 0.8, mineSpeed: 0.3 },
    { key: 'obsidian', name: 'Obsidian', type: 'block', block: ID.OBSIDIAN, mineSpeed: 0.3 },
    // Potions: right-click throws a splash bottle (arcs like a pearl, not an
    // instant self-use) that applies its effect to every alive player
    // within COMBAT.POTION_SPLASH_RADIUS of wherever it lands or hits -
    // including the thrower if they're standing close enough, so throwing
    // one at your own feet is still the way to self-buff instantly.
    // Buffs/debuffs last COMBAT.POTION_DURATION seconds; Instant Health has
    // no duration, it just heals on the spot.
    { key: 'pot_strength', name: 'Potion of Strength II', type: 'potion', potion: 'strength', level: 2, ammo: 8, cooldown: 0.5 },
    { key: 'pot_speed', name: 'Potion of Speed II', type: 'potion', potion: 'speed', level: 2, ammo: 8, cooldown: 0.5 },
    // Blocks burning entirely - the counter to Fire Aspect/Flame (see
    // ENCHANT_DEFS below and the burn handling in server.js's tick loop).
    { key: 'pot_fireres', name: 'Potion of Fire Resistance', type: 'potion', potion: 'fireResistance', ammo: 8, cooldown: 0.5 },
    // Slowness VI + Resistance IV - built to tank hits and stall a fight in
    // place, not to move or deal damage.
    { key: 'pot_turtle', name: 'Turtle Master Potion (Slowness VI, Resistance IV)', type: 'potion', potion: 'turtleMaster', slowLevel: 6, resistLevel: 4, ammo: 8, cooldown: 0.5 },
    { key: 'pot_health', name: 'Potion of Instant Health II', type: 'potion', potion: 'instantHealth', heal: 10, ammo: 8, cooldown: 0.5 },
    // Quick Charge + Multishot are baked in (not toggles), same precedent as
    // the mace/spear above: a much shorter draw than the bow, and every
    // shot fires 3 arrows in a spread from a single arrow of ammo.
    { key: 'crossbow', name: 'Crossbow (Quick Charge III, Multishot)', type: 'crossbow', maxDamage: 11, minDamage: 5, drawTime: 0.5, mineSpeed: 0.3 },
    // Melee like a sword, but also throwable (right-click) - Loyalty brings
    // it back to hand quickly instead of leaving you weaponless, Riptide
    // launches you forward instead of throwing it at all if you're standing
    // in water, Channeling adds a heavy "lightning strike" bonus on a
    // landed throw, and Impaling adds bonus damage against a target that's
    // in water. All four are toggles in the Enchantments panel - see
    // ENCHANT_DEFS.trident and COMBAT.TRIDENT_* below.
    { key: 'trident', name: 'Trident', type: 'weapon', damage: 8, cooldown: 0.9, knockback: 1.1, mineSpeed: 0.4, throwable: true },
    // The classic "knockback stick" - negligible damage, absurd knockback.
    // Knockback II/V are toggles (see ENCHANT_DEFS.stick) - V wins if both
    // are somehow checked at once.
    { key: 'stick', name: 'Stick', type: 'weapon', damage: 1, cooldown: 0.4, knockback: 0.3, mineSpeed: 0.2 },
    // Notch apple: Absorption IV (a full extra row of hearts) is instant,
    // same as a golden apple, plus Fire Resistance I and Resistance I for 5
    // minutes. The actual healing is the same 4-hearts-over-8s trickle as a
    // plain golden apple, not an instant heal - egap's edge here is the
    // absorption/resistance/fire-res, not faster healing.
    { key: 'egap', name: 'Enchanted Golden Apple', type: 'food', heal: 0, absorb: 20, absorbCap: 20, eatTime: 1.6, ammo: 2, mineSpeed: 0.3,
      regenLevel: 1, regenSeconds: 8, fireResLevel: 1, resistLevel: 1, buffSeconds: 300 },
    // Right-click places a water source block, same flow as any other
    // placeable block (cobble/planks/etc) - a one-way, ammo-limited
    // consumable (no bucket to fill back up), restocked on kills instead.
    { key: 'water_bucket', name: 'Water Bucket', type: 'block', block: ID.WATER, ammo: 2, mineSpeed: 0.3 },
    // Lava hurts (and ignites) anyone standing in it - see the per-tick lava
    // damage check in server.js.
    { key: 'lava_bucket', name: 'Lava Bucket', type: 'block', block: ID.LAVA, ammo: 2, mineSpeed: 0.3 },
    // Placed inert; right-click it with flint and steel (or land a Flame bow
    // arrow on it) to light the fuse - see COMBAT.TNT_* below and
    // server.js's liveTNT fuse/explosion tick.
    { key: 'tnt', name: 'TNT', type: 'block', block: ID.TNT, ammo: 6, mineSpeed: 0.3 },
    // Same idea as TNT, bigger blast - but can only be placed on top of an
    // already-placed rail block (see server.js's 'setBlock' handler).
    { key: 'tnt_minecart', name: 'TNT Minecart', type: 'block', block: ID.TNT_MINECART, ammo: 2, mineSpeed: 0.3 },
    // Ground for TNT Minecarts to sit on - a plain, unlimited utility block.
    { key: 'rail', name: 'Rail', type: 'block', block: ID.RAIL, mineSpeed: 0.3 },
    // Right-click a placed TNT/TNT Minecart within reach to light its fuse -
    // right-click any other block to set the ground on fire instead (see
    // COMBAT.GROUND_FIRE_* below). Unlimited uses, like the other basic tools.
    { key: 'flint_steel', name: 'Flint and Steel', type: 'igniter', mineSpeed: 0.3 },
    // Non-solid like a cobweb (you fall/walk straight through it), but the
    // opposite effect - cancels fall damage on landing in it and puts out
    // fire, see server.js's fall-damage and burn checks.
    { key: 'powder_snow_bucket', name: 'Powder Snow Bucket', type: 'block', block: ID.POWDER_SNOW, ammo: 2, mineSpeed: 0.3 },
    // Passive - not something you right-click. Only actually saves you
    // while equipped in the offhand slot (drag it there in the inventory
    // screen) - a hit that would kill you is consumed instead: you're left
    // at 1 HP with a burst of
    // Regeneration/Resistance/Fire Resistance, same as vanilla. Doesn't
    // save you from the void. See applyDamage()'s death check. Starts with
    // 3 in reserve; only one can ever be equipped (armed) at a time.
    { key: 'totem', name: 'Totem of Undying', type: 'totem', ammo: 3, mineSpeed: 0.3 },
    // Right-click it (or drag it onto the chest armor slot in the
    // inventory) to wear it in place of the chestplate - gives up the
    // chestplate's defense/toughness, same as vanilla (see applyDamage()).
    // Once worn, jump while falling to start gliding, regardless of what's
    // currently held - see COMBAT.ELYTRA_* below and the glide branch in
    // shared/physics.js. No ammo; it never runs out.
    { key: 'elytra', name: 'Elytra', type: 'elytra', mineSpeed: 0.3 },
    // Held and right-clicked while gliding, it's a forward speed boost -
    // that's the only thing the item itself does. Firing one as an
    // explosive weapon requires a crossbow: Shift+right-click with the
    // crossbow out loads/fires a firework instead of an arrow, spending
    // firework ammo instead of arrow ammo. See COMBAT.FIREWORK_* below.
    { key: 'firework', name: 'Firework Rocket', type: 'firework', ammo: 16, cooldown: 0.5, mineSpeed: 0.3 },
    // Can only be placed on top of obsidian. Hit it with anything (melee or
    // a projectile) to detonate it - huge damage to anyone at or above its
    // own height, only a couple hearts to anyone below it (real height
    // matters, not just distance) - see COMBAT.CRYSTAL_* below.
    { key: 'end_crystal', name: 'End Crystal', type: 'block', block: ID.END_CRYSTAL, mineSpeed: 0.3 },
    // Charge with glowstone (right-click it while holding glowstone) up to
    // 4 times - reaching 4 detonates it immediately, a bigger blast than an
    // end crystal. See COMBAT.ANCHOR_* below.
    { key: 'respawn_anchor', name: 'Respawn Anchor', type: 'block', block: ID.RESPAWN_ANCHOR, mineSpeed: 0.3 },
    // Right-click a respawn anchor within reach to charge it instead of
    // placing normally - otherwise just a plain light-emitting block.
    { key: 'glowstone', name: 'Glowstone', type: 'block', block: ID.GLOWSTONE, mineSpeed: 0.3 }
  ];
  for (var k = 0; k < ITEMS.length; k++) ITEMS[k].slot = k;

  // Ruleset presets, chosen at the menu for the human player and (separately)
  // for bots. Every kit shares the same base loadout - only the axe and
  // cobweb are ever added or withheld. An item not in a kit simply doesn't
  // exist for that player: its hotbar slot renders empty and using it is a
  // no-op both client and server side.
  var KITS = {
    sword: { key: 'sword', name: 'Sword PvP', items: ['sword', 'bow', 'pearl', 'gapple', 'pick', 'cobble', 'planks', 'mace', 'spear', 'windcharge'] },
    axe: { key: 'axe', name: 'Axe PvP', items: ['sword', 'bow', 'pearl', 'gapple', 'pick', 'cobble', 'planks', 'axe', 'mace', 'spear', 'windcharge'] },
    web: {
      key: 'web', name: 'Web PvP',
      items: ['sword', 'bow', 'pearl', 'gapple', 'pick', 'cobble', 'planks', 'cobweb', 'axe', 'mace', 'spear', 'windcharge',
        'obsidian', 'pot_strength', 'pot_speed', 'pot_fireres', 'pot_turtle', 'pot_health',
        'crossbow', 'trident', 'stick', 'egap',
        'water_bucket', 'lava_bucket', 'tnt', 'tnt_minecart', 'rail', 'flint_steel',
        'powder_snow_bucket', 'totem', 'firework',
        'end_crystal', 'respawn_anchor', 'glowstone']
      // netherite_sword/netherite_axe are deliberately NOT listed here -
      // they're a tier swap on top of sword/axe (see swordTier/axeTier,
      // set at join), not separate items you'd pick alongside them. Only
      // ever one sword and one axe in a loadout at a time. elytra is ALSO
      // deliberately not listed here (or in any kit) - it's locked behind
      // the secret '/elytra257' chat command instead (see
      // server.js's playerHasItem() and the 'elytraUnlocked' client event).
    }
  };

  /** True if the given kit includes an item by key. */
  function kitHasItem(kitKey, itemKey) {
    var kit = KITS[kitKey] || KITS.web;
    return kit.items.indexOf(itemKey) !== -1;
  }

  /** True if the given kit includes the item at ITEMS[slot]. */
  function kitHasSlot(kitKey, slot) {
    var item = ITEMS[slot];
    return !!item && kitHasItem(kitKey, item.key);
  }

  // Enchantment toggles, chosen per-player at join (see server.js's
  // per-player `enchants`) and applied dynamically in combat instead of
  // being baked into separate items. Grouped by which slot they apply to -
  // the menu's Enchantments panel is built straight from this list, so
  // adding a new enchant here is the only step needed to expose it there
  // too (same auto-updating idea as the custom item loadout list).
  var ENCHANT_DEFS = {
    armor: [
      { key: 'protection', name: 'Protection IV', def: true },
      { key: 'thorns', name: 'Thorns III', def: false }
    ],
    sword: [
      { key: 'sharpness', name: 'Sharpness V', def: true },
      { key: 'knockback', name: 'Knockback III', def: false },
      { key: 'looting', name: 'Looting III (bonus restock on kill)', def: false },
      { key: 'fireAspect', name: 'Fire Aspect II (burns target)', def: false }
    ],
    axe: [
      { key: 'sharpness', name: 'Sharpness V', def: true }
    ],
    bow: [
      { key: 'power', name: 'Power V', def: true },
      { key: 'punch', name: 'Punch III (extra arrow knockback)', def: false },
      { key: 'flame', name: 'Flame (burns target, ignites TNT it lands on)', def: false }
    ],
    trident: [
      { key: 'loyalty', name: 'Loyalty III (returns to hand quickly)', def: true },
      { key: 'riptide', name: 'Riptide III (launches you instead, if wet - hold shift to throw anyway)', def: true },
      { key: 'impaling', name: 'Impaling V (bonus damage if the target is in water)', def: true },
      { key: 'channeling', name: 'Channeling (calls down lightning on a landed throw, during a thunderstorm)', def: false }
    ],
    stick: [
      { key: 'knockback2', name: 'Knockback II', def: true },
      { key: 'knockback5', name: 'Knockback V (overrides II if both are on)', def: false }
    ],
    pick: [
      { key: 'efficiency', name: 'Efficiency V', def: true }
    ],
    mace: [
      { key: 'breach', name: 'Breach (bypasses armor)', def: false }
    ]
  };

  /** Default enchant selections (every def's own `def` flag), used both as
   * the menu's starting checkbox state and as the server's fallback when a
   * client doesn't send an enchantOpts payload at all (e.g. a bot). */
  function defaultEnchantOpts() {
    var out = {};
    for (var slot in ENCHANT_DEFS) {
      out[slot] = {};
      for (var i = 0; i < ENCHANT_DEFS[slot].length; i++) out[slot][ENCHANT_DEFS[slot][i].key] = ENCHANT_DEFS[slot][i].def;
    }
    return out;
  }

  // The player's fixed armor kit: full diamond, Protection IV on each piece.
  // There's no pickup/equip system (same as the hotbar kit) - this is just
  // what the human player always wears, shown in the inventory's armor slots.
  var ARMOR = {
    helmet: { key: 'helmet', name: 'Diamond Helmet', defense: 3, toughness: 2, protection: 4 },
    chestplate: { key: 'chestplate', name: 'Diamond Chestplate', defense: 8, toughness: 2, protection: 4 },
    leggings: { key: 'leggings', name: 'Diamond Leggings', defense: 6, toughness: 2, protection: 4 },
    boots: { key: 'boots', name: 'Diamond Boots', defense: 3, toughness: 2, protection: 4 }
  };
  var ARMOR_VALUE = 0, ARMOR_TOUGHNESS = 0;
  for (var ak in ARMOR) {
    ARMOR_VALUE += ARMOR[ak].defense;
    ARMOR_TOUGHNESS += ARMOR[ak].toughness;
  }
  var ARMOR_PROT_LEVEL = 4; // Protection IV, every piece

  // Bots pick one of these tiers (chosen at the menu / via /botarmor) instead
  // of always matching the player's fixed diamond kit - "diamond" here has
  // the exact same value/toughness/protection as the player's ARMOR set
  // above, everything below it is progressively weaker vanilla gear.
  var ARMOR_TIERS = {
    none: { key: 'none', name: 'None', value: 0, toughness: 0, protLevel: 0 },
    leather: { key: 'leather', name: 'Leather', value: 7, toughness: 0, protLevel: 0 },
    iron: { key: 'iron', name: 'Iron', value: 15, toughness: 0, protLevel: 2 },
    diamond: { key: 'diamond', name: 'Diamond', value: ARMOR_VALUE, toughness: ARMOR_TOUGHNESS, protLevel: ARMOR_PROT_LEVEL },
    // A step above diamond, but deliberately only a SLIGHT one - a little
    // extra raw defense/toughness plus small resistance fractions
    // (knockback, fall damage, and blast damage from TNT/firework/crystal/
    // anchor, each cut by that fraction on top of the normal armor formula
    // in applyDamage()/trackFall()), not the much bigger jump this had
    // before.
    netherite: {
      key: 'netherite', name: 'Netherite', value: ARMOR_VALUE + 1, toughness: ARMOR_TOUGHNESS + 2, protLevel: ARMOR_PROT_LEVEL,
      knockbackResist: 0.15, fallResist: 0.2, blastResist: 0.15
    }
  };

  var SHIELD = { key: 'shield', name: 'Shield' };

  var COMBAT = {
    MAX_HEALTH: 20,
    REACH_BLOCK: 5.0,
    REACH_ATTACK: 3.6,
    REACH_ATTACK_SLACK: 1.6, // server side leniency for latency
    REGEN_DELAY: 5.0,
    REGEN_INTERVAL: 2.5,
    SPAWN_PROTECT: 2.5,
    RESPAWN_TIME: 3.0,
    ARROW_SPEED: 48,
    ARROW_GRAVITY: 20,
    PEARL_SPEED: 30,
    PEARL_GRAVITY: 22,
    ARROW_AMMO: 48,
    FALL_SAFE: 3.0,
    // Raised shield: fraction of (already armor-reduced) damage still blocked.
    SHIELD_BLOCK: 0.92,
    // Minimum dot(victim-forward, victim->attacker), horizontal (yaw) only -
    // deliberately not pitch-sensitive, so blocking doesn't require your
    // crosshair to be precisely on the attacker. ~0.6 = roughly a 106 degree
    // cone in front of you.
    SHIELD_FOV_DOT: 0.6,
    // A hit whose attacker is more than this many blocks above or below the
    // victim is treated as a headshot (from above) or a leg shot (from
    // below) - a shield doesn't cover the top or bottom of your hitbox, only
    // the torso. Wide enough that ordinary terrain bumps don't trigger it.
    SHIELD_VERTICAL_TOLERANCE: 1.6,
    // How long (seconds) an axe hit disables the victim's shield for.
    AXE_STUN: 3.0,

    // Mace: a landed smash attack (falling + not on ground, same rule as a
    // crit) deals this much plus fall distance (capped) times the Density V
    // rate, instead of the normal crit multiplier. Tuned so the one-shot
    // point against a full diamond/Protection IV target is a genuine
    // 15-block fall (~68 raw -> ~20.6 after armor, against 20 max health) -
    // shorter falls scale down from there instead of already being lethal
    // well before 15 blocks.
    MACE_SMASH_BASE: 2,
    MACE_DENSITY_PER_BLOCK: 4.4,
    MACE_MAX_FALL: 24,
    // Wind Burst III: upward velocity given to the wielder right after a
    // smash lands, tuned to this arena's scale (not a literal port of
    // vanilla's much taller build height) so a chained smash-jump stays
    // playable instead of launching clean off the map.
    MACE_WINDBURST_VY: 16,

    // Spear: Lunge III fires a forward dash on *every* swing now, landed hit
    // or not - it's a mobility tool as much as a weapon, not just a combat
    // reward - stronger mid-air per vanilla's own rule.
    SPEAR_LUNGE_SPEED: 10,
    SPEAR_LUNGE_AIR_MULT: 1.5,
    // Holding the attack button (instead of tapping) charges a stronger
    // thrust: bigger lunge, bonus damage, extended reach - released on
    // mouse-up once held past SPEAR_CHARGE_HOLD seconds.
    SPEAR_CHARGE_HOLD: 0.5,
    SPEAR_CHARGE_DMG_MULT: 1.6,
    SPEAR_CHARGE_LUNGE_MULT: 2.2,
    SPEAR_CHARGE_REACH_BONUS: 2.5,

    // Wind Charge projectile + its self-launch and blast knockback.
    WINDCHARGE_SPEED: 26,
    WINDCHARGE_GRAVITY: 9,
    WINDCHARGE_SELF_LAUNCH_VY: 13,
    WINDCHARGE_BLAST_RADIUS: 3.2,
    WINDCHARGE_BLAST_KB: 2.2,
    // How close an airborne wind charge needs to get to an airborne ender
    // pearl to trigger the teleport combo instead of just exploding.
    WINDCHARGE_PEARL_COMBO_RADIUS: 1.5,

    // Potions - see the pot_* ITEMS entries above for which potion grants
    // which level. Strength/Speed/Fire Resistance last this long; Turtle
    // Master is deliberately much shorter (it's a defensive panic button,
    // not a sustained buff) - see TURTLE_MASTER_DURATION. Instant Health is
    // immediate and has no duration.
    POTION_DURATION: 480,
    TURTLE_MASTER_DURATION: 30,
    // Every potion your kit/loadout grants restocks by this many per kill,
    // same "keep the fight going" reward as the arrow/pearl/apple/wind
    // charge restock below.
    POTION_KILL_RESTOCK: 3,
    STRENGTH_DMG_PER_LEVEL: 3, // added to weapon damage before armor, same scale as this game's baked-in Sharpness bonus
    SPEED_PCT_PER_LEVEL: 0.20, // vanilla rate
    SLOWNESS_PCT_PER_LEVEL: 0.15, // vanilla rate
    RESISTANCE_PCT_PER_LEVEL: 0.20, // extra damage-taken reduction stage, after armor/Protection
    // Thorns III: one flat chance/damage roll per hit taken, rather than
    // vanilla's independent per-armor-piece rolls - simpler, same ballpark.
    THORNS_PROC_CHANCE: 0.3,
    THORNS_DMG_MIN: 2,
    THORNS_DMG_MAX: 4,

    // Potions are thrown, not drunk - travels like a pearl and splashes on
    // impact (player or world), applying to every alive player within the
    // radius, thrower included.
    POTION_SPEED: 28,
    POTION_GRAVITY: 20,
    POTION_SPLASH_RADIUS: 3.5,

    // Enchant toggles (see ENCHANT_DEFS above).
    SHARPNESS_DMG_BONUS: 3, // sword/axe, same scale as Strength's own bonus
    KNOCKBACK_ENCHANT_ADD: 1.1, // sword Knockback III, added to the hit's knockback multiplier
    POWER_DMG_BONUS: 4, // bow Power V, added to arrow damage at any draw
    PUNCH_ENCHANT_ADD: 1.3, // bow Punch III, added to the arrow's knockback multiplier
    // Bow boosting: shoot a low-charge arrow point-blank and step/jump into
    // its path once the 0.12s self-hit grace period passes (see
    // stepProjectiles) - a deliberate mobility trick, so a self-hit gets a
    // much bigger forward+upward shove than an ordinary arrow hit (0.5 kb
    // mult / 0.36 kbY) would otherwise give.
    BOW_BOOST_KB_MULT: 2.2,
    BOW_BOOST_KB_Y: 0.9,
    LOOTING_KILL_MULT: 2, // sword Looting III: kill-reward ammo restock multiplier
    // Fire Aspect/Flame: sets the target alight for this many seconds,
    // ticking BURN_DPS unarmored damage once per second - a fresh ignite
    // always refreshes the full duration rather than stacking. A burning
    // player with Fire Resistance active takes no burn damage at all.
    BURN_SECONDS: 4,
    BURN_DPS: 1,

    // Crossbow: fires this many arrows per shot (Multishot), spread this
    // many radians apart, consuming only 1 arrow of ammo total either way.
    CROSSBOW_MULTISHOT_COUNT: 3,
    CROSSBOW_MULTISHOT_SPREAD: 0.09,

    // Trident: Loyalty controls how long until it's ready to throw again -
    // fast with it, a real wait without it (no physical pickup in this
    // game, so "walk over and grab it" is simulated as a cooldown instead).
    // Riptide launches the thrower instead of throwing the trident at all.
    // Channeling and Impaling are flat bonuses on a landed throw.
    TRIDENT_SPEED: 32,
    TRIDENT_GRAVITY: 14,
    TRIDENT_THROW_DAMAGE: 9,
    TRIDENT_COOLDOWN_WITH_LOYALTY: 0.9,
    TRIDENT_COOLDOWN_NO_LOYALTY: 4.5,
    TRIDENT_RIPTIDE_SPEED: 18,
    TRIDENT_CHANNELING_KB: 1.6,
    TRIDENT_IMPALING_BONUS_DMG: 5,

    // Stick: Knockback II/V dwarf a normal weapon's kbMul (usually ~1-1.8) -
    // added on top of it, not replacing it.
    STICK_KB2_ADD: 4.5,
    STICK_KB5_ADD: 12,

    // Pickaxe Efficiency V: multiplies mineSpeed - purely a client-side
    // pacing number (mining has no server-side timing check), same as every
    // other tool's mineSpeed already is.
    PICK_EFFICIENCY_MULT: 4,

    // Enchanted Golden Apple (egap): Absorption uses the item's own
    // absorbCap (see the 'eat' handler) instead of the plain golden apple's
    // lower cap. Regeneration ticks like natural regen but faster and
    // independent of recent damage.
    REGEN_HP_PER_LEVEL_PER_TICK: 1,
    REGEN_TICK_INTERVAL: 1.0,

    // Weather: clear/rain/thunder, chosen server-side and broadcast to
    // everyone. Rain (and thunder) is what makes Riptide usable outside of
    // water too, same as vanilla; thunder is additionally required for
    // Channeling to do anything at all - also same as vanilla.
    WEATHER_CLEAR_SECONDS: [60, 150],
    WEATHER_RAIN_SECONDS: [40, 90],
    WEATHER_THUNDER_CHANCE: 0.5, // fraction of "rain" rolls that upgrade to a thunderstorm
    WEATHER_THUNDER_SECONDS: [20, 45],
    // Lightning: a Channeling trident hit lands during a thunderstorm, or a
    // rare ambient strike (cosmetic, doesn't damage anyone) just for atmosphere.
    LIGHTNING_BONUS_DMG: 8,
    RANDOM_LIGHTNING_CHANCE_PER_TICK: 0.0015,

    // Lava: hurts (and ignites, so it keeps burning after stepping out)
    // anyone standing in it, checked once a second same cadence as fire.
    LAVA_DPS: 8,
    // TNT / TNT Minecart: flint and steel starts the fuse, then after it
    // burns down the block clears itself, breaks blocks in a radius (never
    // bedrock) and blasts/damages nearby players - same shape as the wind
    // charge explosion already in the game. The minecart variant is just a
    // bigger, harder-hitting version placed straight on the ground.
    TNT_FUSE_SECONDS: 3,
    TNT_BLAST_RADIUS: 5,
    TNT_BLAST_DMG: 22,
    TNT_BLAST_KB: 2.2,
    TNT_MINECART_FUSE_SECONDS: 0,
    TNT_MINECART_BLAST_RADIUS: 6,
    TNT_MINECART_BLAST_DMG: 80,
    TNT_MINECART_BLAST_KB: 2.8,
    IGNITE_REACH: 5,

    // Flint and steel on anything that isn't TNT lights the ground on fire
    // instead - a temporary hazard, same per-second damage/ignite idea as
    // lava but shorter-lived and not a placed block. Any arrow (bow or
    // crossbow) that flies through one catches fire and ignites whatever it
    // hits next, same as a Flame bow shot would.
    GROUND_FIRE_SECONDS: 9,
    GROUND_FIRE_DPS: 2,

    // Water/lava spread a little after being placed - a slow, bounded
    // flood-fill (not full fluid simulation) capped at a small number of
    // hops from the original source block, water reaching a bit further
    // than lava, same relative relationship as vanilla.
    WATER_SPREAD_MAX_HOPS: 4,
    LAVA_SPREAD_MAX_HOPS: 2,
    LIQUID_SPREAD_INTERVAL: 0.4,
    LIQUID_SPREAD_PER_TICK: 3,

    // Totem of Undying: what a save leaves you with - a sliver of health and
    // a few seconds of buffs to actually get you out of danger, same shape
    // as vanilla's totem pop.
    TOTEM_HEALTH: 1,
    TOTEM_REGEN_LEVEL: 2,
    TOTEM_REGEN_SECONDS: 4,
    TOTEM_RESIST_LEVEL: 4,
    TOTEM_RESIST_SECONDS: 4,
    TOTEM_FIRE_RES_SECONDS: 4,

    // Looting III's kill restock for totem/egap: 1 guaranteed, with a chance
    // to bump that up to 2-3 instead - same rule for both, unlike the flat
    // half-stack restock every other item gets.
    LOOT_BONUS_CHANCE: 0.5,
    LOOT_BONUS_MIN: 2,
    LOOT_BONUS_MAX: 3,

    // Elytra: hold jump while falling (not on the ground) to start gliding -
    // pitch steers it, same trade-off as vanilla (diving trades altitude for
    // speed, climbing trades speed for altitude). DRAG slowly bleeds off
    // whatever speed a firework boost isn't actively refilling.
    ELYTRA_MIN_FALL_SPEED: 1.5, // vy must already be falling at least this fast to start gliding
    // Deliberately weaker than a "real" elytra - slower top speed, less
    // pitch authority (sluggish to steer/climb), more gravity (bleeds
    // altitude faster) and more drag (loses speed faster without a
    // firework boost topping it up). ELYTRA_MAX_SPEED is the plain-glide
    // ceiling; a firework boost raises it to ELYTRA_BOOST_MAX_SPEED for
    // ELYTRA_BOOST_WINDOW seconds (see input.boosted in physics.js) instead
    // of immediately getting clamped back down to the same slow cap -
    // fireworks are the actual reason to fly fast, not gliding alone.
    ELYTRA_GLIDE_GRAVITY: 7,
    ELYTRA_MAX_SPEED: 14,
    ELYTRA_BOOST_MAX_SPEED: 30,
    ELYTRA_BOOST_WINDOW: 2.2,
    ELYTRA_DRAG: 0.985,
    ELYTRA_PITCH_ACCEL: 16,

    // Firework Rocket: a forward speed burst while gliding, or a thrown
    // explosive otherwise - smaller/faster than TNT, more like a beefed-up
    // wind charge blast with a flashy multi-colour burst.
    FIREWORK_BOOST_SPEED: 18,
    FIREWORK_SPEED: 26,
    FIREWORK_GRAVITY: 4,
    FIREWORK_BLAST_RADIUS: 3.5,
    FIREWORK_BLAST_DMG: 16,
    FIREWORK_BLAST_KB: 1.6,
    FIREWORK_KILL_RESTOCK: 16,

    // End Crystal: classic "crystal PvP" - devastating if the target is at
    // or above the crystal's own height, barely a scratch if they're below
    // it (real vanilla's exposure-based falloff, simplified to a flat
    // height check rather than true line-of-sight raycasting).
    CRYSTAL_BLAST_RADIUS: 4,
    CRYSTAL_BLAST_DMG_MAX: 46,
    CRYSTAL_BLAST_DMG_BELOW: 2,
    CRYSTAL_BLAST_KB: 2.4,
    CRYSTAL_HIT_REACH: 5,

    // Respawn Anchor: charges 1 at a time with glowstone, reaching 4
    // detonates it on the spot - bigger than TNT or an end crystal, same
    // "obviously the strongest bomb" role it has in vanilla. A sword hit
    // against one holding at least 1 charge detonates it early too (see the
    // 'hitAnchor' handler) - a shorter fuse for less damage, encouraging
    // actually finishing the full 4-charge bomb instead.
    ANCHOR_MAX_CHARGES: 4,
    ANCHOR_BLAST_RADIUS: 5,
    ANCHOR_BLAST_DMG: 60,
    ANCHOR_BLAST_KB: 3.2,
    ANCHOR_SWORD_HIT_REACH: 5,

    // Lightning: a real area strike now, not just a visual - anyone caught
    // in LIGHTNING_STRIKE_RADIUS takes a jolt of damage (bypasses armor,
    // same as fire/lava/fall - it's an environmental hazard, not a combat
    // hit) and catches fire, and a couple of nearby ground tiles catch too.
    // Triggered by weather's random strikes, a Channeling trident hit, and
    // (cosmetically only, no damage) wherever a player/bot just died.
    LIGHTNING_STRIKE_RADIUS: 4.5,
    LIGHTNING_STRIKE_DMG: 5
  };

  var PHYS = {
    WIDTH: 0.6,
    HEIGHT: 1.8,
    EYE: 1.62,
    GRAVITY: 30,
    JUMP: 8.6,
    WALK: 4.4,
    SPRINT: 5.9,
    SNEAK: 1.5,
    BLOCK_SPEED: 0.6, // movement multiplier while a shield is raised
    AIR_CONTROL: 0.28,
    FRICTION_GROUND: 12,
    FRICTION_AIR: 1.4,
    SWIM_UP: 3.0,
    WATER_DRAG: 6.0,
    TERMINAL: 60,
    WEB_SPEED: 0.12 // movement multiplier while standing in a cobweb
  };

  /**
   * Damage remaining after a given armor tier (see ARMOR_TIERS), using
   * vanilla Minecraft's two-stage armor formula (armor value+toughness,
   * then enchantment protection), each stage capped at 80% reduction.
   * Only meant for direct combat hits (sword/arrow) - fall/void/self damage
   * bypass armor entirely, same as vanilla. Defaults to the diamond tier.
   */
  function reduceByArmor(damage, tier) {
    tier = tier || ARMOR_TIERS.diamond;
    if (damage <= 0 || (tier.value <= 0 && tier.protLevel <= 0)) return Math.max(0, damage);
    var x = Math.max(tier.value / 5, tier.value - 4 * damage / (2 + tier.toughness));
    var afterArmor = damage * (1 - Math.min(20, Math.max(0, x)) / 25);
    var epf = tier.protLevel * 4; // general Protection: 1 EPF per level, per piece, 4 pieces
    var afterProt = afterArmor * (1 - Math.min(20, epf) / 25);
    return Math.max(0, afterProt);
  }

  function breakTime(blockId, item) {
    var h = HARDNESS[blockId];
    if (h < 0) return Infinity;
    if (h === 0) return 0.05;
    var speed = item && item.mineSpeed ? item.mineSpeed : 1;
    if (PICKABLE[blockId] && !(item && item.pick)) speed = Math.min(speed, 0.35);
    return (h * 1.5) / speed;
  }

  return {
    WORLD: WORLD,
    ID: ID,
    T: T,
    BLOCKS: BLOCKS,
    SOLID: SOLID,
    OPAQUE: OPAQUE,
    LIQUID: LIQUID,
    WEB: WEB,
    POWDER_SNOW: POWDER_SNOW,
    HARDNESS: HARDNESS,
    TILES: TILES,
    ITEMS: ITEMS,
    KITS: KITS,
    kitHasSlot: kitHasSlot,
    kitHasItem: kitHasItem,
    ENCHANT_DEFS: ENCHANT_DEFS,
    defaultEnchantOpts: defaultEnchantOpts,
    ARMOR: ARMOR,
    ARMOR_VALUE: ARMOR_VALUE,
    ARMOR_TOUGHNESS: ARMOR_TOUGHNESS,
    ARMOR_PROT_LEVEL: ARMOR_PROT_LEVEL,
    ARMOR_TIERS: ARMOR_TIERS,
    SHIELD: SHIELD,
    COMBAT: COMBAT,
    PHYS: PHYS,
    breakTime: breakTime,
    reduceByArmor: reduceByArmor
  };
});
