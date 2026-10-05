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
    SX: 96,
    SY: 56,
    SZ: 96,
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
    SLIME: 29,
    SOUL_SAND: 30,
    MAGMA: 31,
    ICE: 32,
    CRACKS: 33 // 33..42 = break stages 0..9
  };
  T.TILE_COUNT = 43;

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
    GLOWSTONE: 27,
    SLIME: 28,
    SOUL_SAND: 29,
    MAGMA: 30,
    ICE: 31
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
    { name: 'Glowstone', all: T.GLOWSTONE, hardness: 0.3 },
    // Arena-only special blocks (see worldgen.js). Their effects live in
    // shared/physics.js (movement) and server.js (fall damage, burning).
    // Slime: landing on it bounces you back up and cancels fall damage -
    // hold sneak to land without bouncing.
    { name: 'Slime Block', all: T.SLIME, hardness: 0, bouncy: true },
    // Soul Sand: drags anyone walking on it down to a crawl.
    { name: 'Soul Sand', all: T.SOUL_SAND, hardness: 0.5, slow: true },
    // Magma Block: burns anyone standing on it unless they sneak or have
    // Fire Resistance.
    { name: 'Magma Block', all: T.MAGMA, hardness: 0.5, pick: true, magma: true },
    // Ice: slippery - hard to start moving and harder to stop.
    { name: 'Ice', all: T.ICE, hardness: 0.5, slippery: true }
  ];

  var N = BLOCKS.length;
  var SOLID = new Uint8Array(N);
  var OPAQUE = new Uint8Array(N);
  var LIQUID = new Uint8Array(N);
  var WEB = new Uint8Array(N);
  var POWDER_SNOW = new Uint8Array(N);
  var BOUNCY = new Uint8Array(N), SLOW = new Uint8Array(N), MAGMA = new Uint8Array(N), SLIPPERY = new Uint8Array(N);
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
    BOUNCY[i] = b.bouncy ? 1 : 0;
    SLOW[i] = b.slow ? 1 : 0;
    MAGMA[i] = b.magma ? 1 : 0;
    SLIPPERY[i] = b.slippery ? 1 : 0;
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
    // Right-click to spawn a wolf a couple blocks in front of you - it's
    // loyal only to whoever's egg spawned it (see ownerId in server.js):
    // follows you around, never attacks you, and fights back for you if you
    // or it gets hit. Dog Armor (see the menu's "Give wolves armor"
    // checkbox) is decided per-owner at join, not per-egg.
    // Spawn eggs all share one code path - `mob` is what actually gets
    // summoned, so a new creature is an entry here plus a spawn function.
    { key: 'wolf_spawn_egg', name: 'Wolf Spawn Egg', type: 'spawn_egg', mob: 'wolf', ammo: 4, cooldown: 1.0, mineSpeed: 0.3 },
    // Creepers hunt whoever isn't their owner, charge up, and go off. A
    // lightning strike turns one into a charged creeper: far bigger blast,
    // much shorter fuse, and almost no health to stop it with.
    { key: 'creeper_spawn_egg', name: 'Creeper Spawn Egg', type: 'spawn_egg', mob: 'creeper', ammo: 3, cooldown: 1.4, mineSpeed: 0.3 },
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
    // Invisibility hides the wearer's body from everyone else (their held
    // item and nametag still give them away up close, same as vanilla).
    { key: 'pot_invis', name: 'Potion of Invisibility (8 min)', type: 'potion', potion: 'invisibility', ammo: 4, cooldown: 0.5 },
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
    { key: 'glowstone', name: 'Glowstone', type: 'block', block: ID.GLOWSTONE, mineSpeed: 0.3 },
    // Only in the Wind Charge Archer preset kit - a step below the diamond
    // sword. Counts as a sword for enchants/blocking (see baseWeaponKey).
    { key: 'iron_sword', name: 'Iron Sword', type: 'weapon', damage: 6, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    // Plain food: no hunger bar in this game, so it just heals outright -
    // weaker than a gapple (no absorption/regen) but you carry a stack.
    { key: 'beef', name: 'Cooked Beef', type: 'food', heal: 6, absorb: 0, eatTime: 1.6, ammo: 64, mineSpeed: 0.3 },
    // Legendary shop weapons (see SHOP.LEGENDARY). Each one has a `base`:
    // the ordinary weapon it replaces in your loadout and behaves as for
    // enchants/armor/shield rules (see baseKey()). Only one player can own
    // each at a time.
    { key: 'dark_sword', name: 'Dark Sword', type: 'weapon', base: 'sword', legendary: true, damage: 16, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    { key: 'lifesteal_sword', name: 'Lifesteal Sword', type: 'weapon', base: 'sword', legendary: true, damage: 8, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    { key: 'magic_bow', name: 'Magic Bow', type: 'bow', base: 'bow', legendary: true, maxDamage: 10, minDamage: 2, drawTime: 1.0, mineSpeed: 0.3 },
    { key: 'sea_trident', name: 'Trident of the Sea', type: 'weapon', base: 'trident', legendary: true, damage: 8, cooldown: 0.9, knockback: 1.1, mineSpeed: 0.4, throwable: true },
    { key: 'cheaters_axe', name: "Cheater's Axe", type: 'weapon', base: 'axe', legendary: true, damage: 10, cooldown: 0.9, knockback: 1.3, mineSpeed: 0.5 },
    // Levels up with kills (see SHOP.LEVELED) - its cooldown and lunge
    // improve at level 2, see weaponCooldown().
    { key: 'speed_spear', name: 'Speed Spear', type: 'weapon', base: 'spear', legendary: true, damage: 8, cooldown: 1.6, knockback: 0.9, mineSpeed: 0.4, reach: 4.5, minReach: 1.2, pierce: true },
    { key: 'blood_sword', name: 'Blood Sword', type: 'weapon', base: 'sword', legendary: true, damage: 8, cooldown: 0.42, knockback: 1.0, mineSpeed: 0.4 },
    { key: 'explosion_crossbow', name: 'Explosion Crossbow', type: 'crossbow', base: 'crossbow', legendary: true, maxDamage: 11, minDamage: 5, drawTime: 0.5, mineSpeed: 0.3 },
    { key: 'void_mace', name: 'Void Mace', type: 'weapon', base: 'mace', legendary: true, damage: 7, cooldown: 0.9, knockback: 1.2, mineSpeed: 0.4 }
  ];
  var ITEM_INDEX = {};
  for (var ii = 0; ii < ITEMS.length; ii++) ITEM_INDEX[ITEMS[ii].key] = ITEMS[ii];

  /** The ordinary weapon an item counts as: netherite/iron swords are
   * swords, the legendary shop weapons are whatever they replace, and
   * everything else is just itself. */
  function baseKey(key) {
    if (key === 'netherite_sword' || key === 'iron_sword') return 'sword';
    if (key === 'netherite_axe') return 'axe';
    var it = ITEM_INDEX[key];
    return it && it.base ? it.base : key;
  }
  for (var k = 0; k < ITEMS.length; k++) ITEMS[k].slot = k;

  // Ruleset presets, chosen at the menu for the human player and (separately)
  // for bots. Every kit shares the same base loadout - only the axe and
  // cobweb are ever added or withheld. An item not in a kit simply doesn't
  // exist for that player: its hotbar slot renders empty and using it is a
  // no-op both client and server side.
  var KITS = {
    // Custom: the one kit that isn't a preset - the menu lets you pick the
    // items, armor, sword/axe tier, arrow tip and enchantments yourself.
    // `items` here is the starting selection (the old "everything" loadout),
    // and what bots use when they match a Custom player.
    custom: {
      key: 'custom', name: 'Custom',
      items: ['sword', 'bow', 'pearl', 'gapple', 'pick', 'cobble', 'planks', 'cobweb', 'axe', 'mace', 'spear', 'windcharge',
        'obsidian', 'pot_strength', 'pot_speed', 'pot_fireres', 'pot_turtle', 'pot_health', 'pot_invis',
        'crossbow', 'trident', 'stick', 'egap',
        'water_bucket', 'lava_bucket', 'tnt', 'tnt_minecart', 'rail', 'flint_steel',
        'powder_snow_bucket', 'totem', 'firework',
        'end_crystal', 'respawn_anchor', 'glowstone', 'wolf_spawn_egg', 'creeper_spawn_egg']
    },
    // Every other kit is a fixed preset: the items, armor tier, sword/axe tier,
    // arrow tip and enchantments (MC.defaultEnchantOpts) all come with it -
    // nothing is picked separately. See kitGear(). Item counts come from
    // freshAmmo. The shield is always in the offhand, so it isn't listed.
    // The elytra only comes with the Mace / Rocket kit; anywhere else it's
    // the admin-only '/elytra' unlock (see server.js's playerHasItem()).
    crystal: {
      key: 'crystal', name: 'Crystal PvP', preset: true, armor: 'netherite', swordTier: 'netherite', axeTier: 'netherite',
      arrowTips: ['slowfall'],
      items: ['sword', 'pick', 'axe', 'crossbow', 'end_crystal', 'obsidian', 'respawn_anchor', 'glowstone', 'totem', 'pearl', 'egap']
    },
    mace: {
      key: 'mace', name: 'Mace / Rocket', preset: true, armor: 'netherite', swordTier: 'netherite',
      items: ['mace', 'elytra', 'firework', 'windcharge', 'sword', 'pearl', 'gapple']
    },
    nodebuff: {
      key: 'nodebuff', name: 'Netherite Pot / NoDebuff', preset: true, armor: 'netherite', swordTier: 'netherite', axeTier: 'netherite',
      items: ['sword', 'axe', 'pot_health', 'pot_speed', 'pot_strength', 'gapple', 'pearl']
    },
    cart: {
      key: 'cart', name: 'Cart PvP', preset: true, armor: 'netherite', swordTier: 'netherite',
      items: ['sword', 'tnt_minecart', 'rail', 'obsidian', 'flint_steel', 'gapple', 'pearl']
    },
    axeshield: {
      key: 'axeshield', name: 'Axe Shield', preset: true, armor: 'diamond', swordTier: 'diamond', axeTier: 'diamond',
      items: ['axe', 'sword', 'crossbow', 'gapple']
    },
    smp: {
      key: 'smp', name: 'SMP / Lifesteal', preset: true, armor: 'netherite', swordTier: 'netherite', axeTier: 'netherite',
      arrowTips: ['harming'],
      items: ['sword', 'axe', 'bow', 'totem', 'pearl', 'gapple', 'cobweb', 'water_bucket', 'planks']
    },
    duel: {
      key: 'duel', name: 'Sword Duel', preset: true, armor: 'diamond', swordTier: 'diamond',
      items: ['sword', 'gapple']
    },
    uhc: {
      key: 'uhc', name: 'Modern UHC', preset: true, armor: 'diamond', swordTier: 'diamond', axeTier: 'diamond',
      items: ['sword', 'axe', 'pick', 'bow', 'crossbow', 'gapple', 'water_bucket', 'lava_bucket', 'cobweb', 'planks']
    },
    archer: {
      key: 'archer', name: 'Wind Charge Archer', preset: true, armor: 'chainmail',
      arrowTips: ['poison', 'slowness'],
      items: ['bow', 'crossbow', 'windcharge', 'iron_sword', 'beef']
    }
  };
  // What you get if a kit key is missing or unknown.
  var DEFAULT_KIT = 'uhc';

  /** The kit a bot uses to match a player's kit: the same one, as long as
   * the bot AI can actually fight with it (it needs a sword or an axe) -
   * otherwise Sword Duel. */
  function botKit(kitKey) {
    var kit = KITS[kitKey];
    if (kit && (kit.items.indexOf('sword') !== -1 || kit.items.indexOf('axe') !== -1)) return kitKey;
    return 'duel';
  }

  /**
   * The gear a player actually gets for a kit: a preset kit overrides the
   * menu's armor/sword/axe/arrow-tip choices (so a diamond kit stays
   * diamond even with "use netherite" ticked); every other kit - or a
   * custom loadout - just keeps what was chosen. A preset with several
   * arrow tips keeps the player's pick if it's one of them.
   */
  /** Raw mace smash damage for a fall of `fallDist` blocks (already capped
   * by the caller), with or without Density. */
  function maceSmashDamage(fallDist, density) {
    var C = COMBAT, left = fallDist, dmg = C.MACE_SMASH_BASE;
    for (var i = 0; i < C.MACE_FALL_TIERS.length && left > 0; i++) {
      var n = Math.min(left, C.MACE_FALL_TIERS[i][0]);
      dmg += n * C.MACE_FALL_TIERS[i][1];
      left -= n;
    }
    if (density) dmg += fallDist * C.MACE_DENSITY_PER_BLOCK;
    return dmg;
  }

  /** A leveling weapon's level from its kill count (0..MAX_WEAPON_LEVEL). */
  function weaponLevel(kills) {
    return Math.max(0, Math.min(SHOP.MAX_WEAPON_LEVEL, kills | 0));
  }
  /** Attack cooldown, allowing for the Speed Spear's level-2 upgrade. */
  function weaponCooldown(item, level) {
    if (item.key === 'speed_spear' && level >= 2) return SHOP.SPEED_SPEAR_FAST_COOLDOWN;
    return item.cooldown;
  }
  /** Bow/crossbow draw time, allowing for the Explosion Crossbow's level-2
   * faster charge. */
  function weaponDrawTime(item, level) {
    if (item.key === 'explosion_crossbow' && level >= 2) return item.drawTime * SHOP.XBOW_LV2_DRAW_MULT;
    return item.drawTime;
  }

  function findItem(query) {
    var q = String(query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!q) return null;
    var norm = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]/g, ''); };
    for (var i = 0; i < ITEMS.length; i++) if (norm(ITEMS[i].key) === q || norm(ITEMS[i].name) === q) return ITEMS[i];
    for (var j = 0; j < ITEMS.length; j++) if (norm(ITEMS[j].key).indexOf(q) !== -1 || norm(ITEMS[j].name).indexOf(q) !== -1) return ITEMS[j];
    return null;
  }

  function kitGear(kitKey, chosen, custom) {
    var kit = KITS[kitKey];
    var out = { armor: chosen.armor, swordTier: chosen.swordTier, axeTier: chosen.axeTier, arrowTip: chosen.arrowTip };
    if (!kit || !kit.preset || custom) return out;
    if (kit.armor) out.armor = kit.armor;
    if (kit.swordTier) out.swordTier = kit.swordTier;
    if (kit.axeTier) out.axeTier = kit.axeTier;
    out.arrowTip = kit.arrowTips ? (kit.arrowTips.indexOf(chosen.arrowTip) !== -1 ? chosen.arrowTip : kit.arrowTips[0]) : 'none';
    return out;
  }

  /** True if the given kit includes an item by key. */
  function kitHasItem(kitKey, itemKey) {
    var kit = KITS[kitKey] || KITS[DEFAULT_KIT];
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
      { key: 'impaling', name: 'Impaling V (bonus damage if the target is in water or out in the rain)', def: true },
      { key: 'channeling', name: 'Channeling (calls down lightning on a landed throw, during a thunderstorm)', def: true }
    ],
    stick: [
      { key: 'knockback2', name: 'Knockback II', def: true },
      { key: 'knockback5', name: 'Knockback V (overrides II if both are on)', def: false }
    ],
    pick: [
      { key: 'efficiency', name: 'Efficiency V', def: true }
    ],
    mace: [
      { key: 'breach', name: 'Breach (bypasses armor)', def: true },
      { key: 'density', name: 'Density V (smash attacks hit harder the further you fell)', def: true }
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
    // Only reachable through a preset kit (Wind Charge Archer).
    chainmail: { key: 'chainmail', name: 'Chainmail', value: 12, toughness: 0, protLevel: 2 },
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

  // Custom armor/shield trims: a small pixel-art pattern a player paints
  // (see the customize-trims editor in game.js) and that everyone else sees
  // rendered onto their armor/shield (see textures.js's paintArmor/itemIcon).
  // Index 0 is deliberately "no paint" - lets the tier's base texture (or
  // the shield's default emblem) show through instead of being a 10th
  // color. Lives here rather than textures.js since the server validates an
  // incoming trim with the exact same rules, and textures.js isn't loadable
  // server-side (it touches the DOM).
  var TRIM_GRID = 16;
  var TRIM_CELLS = TRIM_GRID * TRIM_GRID;
  var TRIM_PALETTE = [
    null,
    '#d32f2f', // red
    '#f57c00', // orange
    '#fbc02d', // yellow
    '#388e3c', // green
    '#4fc3f7', // light blue
    '#1450a3', // dark blue
    '#8e24aa', // purple
    '#181818', // black
    '#f5f5f5'  // white
  ];
  function isValidTrim(trim) {
    if (!Array.isArray(trim) || trim.length !== TRIM_CELLS) return false;
    for (var i = 0; i < trim.length; i++) {
      var v = trim[i];
      if (typeof v !== 'number' || (v | 0) !== v || v < 0 || v >= TRIM_PALETTE.length) return false;
    }
    return true;
  }

  // Each armor piece is painted separately (see the customize-trims editor),
  // and each SIDE of a piece separately again - so trims are
  // {slot: {face: grid}} rather than one pattern smeared over everything.
  // Elytra and shield are flat items and only ever use the 'front' face.
  var TRIM_SLOTS = ['helmet', 'chest', 'legs', 'boots', 'elytra', 'shield'];
  var TRIM_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

  /** Keeps only well-formed grids on known slots/faces - anything else in a
   * stale/tampered payload is dropped rather than trusted. Returns null when
   * nothing survives, so "no trims" is one value instead of an empty object.
   * A slot given as a single bare grid (the older all-sides-the-same format)
   * is read as that design on the FRONT only - carrying it onto all six
   * faces instead would resurrect exactly the wrapping this per-face split
   * exists to get rid of. */
  function sanitizeTrims(trims) {
    if (!trims || typeof trims !== 'object') return null;
    var out = null, i, j;
    for (i = 0; i < TRIM_SLOTS.length; i++) {
      var slot = TRIM_SLOTS[i], val = trims[slot], faces = null;
      if (isValidTrim(val)) {
        faces = { front: val };
      } else if (val && typeof val === 'object') {
        for (j = 0; j < TRIM_FACES.length; j++) {
          if (!isValidTrim(val[TRIM_FACES[j]])) continue;
          if (!faces) faces = {};
          faces[TRIM_FACES[j]] = val[TRIM_FACES[j]];
        }
      }
      if (faces) { if (!out) out = {}; out[slot] = faces; }
    }
    return out;
  }

  // ------------------------------------------------------------- shop ----
  // An in-match shop: coins are earned by fighting and spent on upgrades
  // that last for the session. Everything here is server-authoritative
  // (see the 'shopBuy' handler) - the client only ever draws what it's
  // told, so a tampered client can't award itself levels.
  var SHOP = {
    START_COINS: 10,
    COIN_PER_KILL: 10,
    COIN_KILL_STREAK_BONUS: 2,  // extra per kill in the current streak
    // A slow trickle so someone having a bad run still gets somewhere.
    COIN_IDLE_AMOUNT: 1,
    COIN_IDLE_SECONDS: 12,
    // Rough coins-per-minute of average play (the trickle above plus a
    // kill every couple of minutes) - what prices are pegged to, see
    // legendaryCost().
    COINS_PER_MINUTE: 10,
    // How long the Luck Potion lasts, and how strong its buffs are next to
    // the ordinary potions/golden apples.
    LUCK_SECONDS: 300,
    LUCK_MULT: 1.5,
    // Magic Bow: its arrows carry every debuff at this fraction of the
    // usual strength, and curve toward anyone within HOMING_RANGE blocks.
    MAGIC_BOW_MULT: 0.75,
    MAGIC_BOW_HOMING_RANGE: 2,
    MAGIC_BOW_HOMING_TURN: 0.35,
    // Lifesteal Sword: extra max health per kill (2 = one heart), capped.
    LIFESTEAL_PER_KILL: 2,
    LIFESTEAL_MAX_BONUS: 20,
    // Trident of the Sea.
    SEA_RIPTIDE_SPEED_LEVEL: 1,
    SEA_RIPTIDE_SPEED_SECONDS: 5,
    SEA_CHANNELING_BURN_SECONDS: 10,
    SEA_RAIN_SECONDS: 60,
    SEA_RAIN_COOLDOWN: 90,
    // Weapons that level up: every kill made with one (its bleed, minion or
    // explosions included) raises its level, up to MAX_WEAPON_LEVEL. Each
    // level keeps the ones before it. Lost along with the weapon.
    MAX_WEAPON_LEVEL: 3,
    LEVELED: {
      blood_sword: ['+2 damage', 'Hits make enemies bleed', 'Weapon ability: summon a Blood Minion', 'Wider, longer-reaching swings'],
      speed_spear: ['Hits poison', 'Faster sprinting while held', 'Longer lunge, shorter cooldown', 'Charged thrust + lunge combo, extra damage'],
      explosion_crossbow: ['Explosive arrows', 'Weapon ability: double-blast that pulls enemies in', 'Faster charging', 'Bigger explosions']
    },
    // Blood Sword.
    BLOOD_SWORD_BONUS: 2,
    BLEED_SECONDS: 6,
    BLEED_DPS: 1,               // 6 damage (3 hearts) over BLEED_SECONDS
    BLOOD_SWEEP_REACH_BONUS: 1.5,
    BLOOD_SWEEP_COS: 0.5,       // extra targets within ~60 degrees of your aim
    MINION_HEALTH: 10,
    MINION_DAMAGE: 3,
    MINION_SECONDS: 30,
    MINION_COOLDOWN: 30,
    MINION_SEEK_RANGE: 16,
    // Speed Spear.
    SPEED_SPEAR_SPRINT_MULT: 1.25,
    SPEED_SPEAR_FAST_COOLDOWN: 1.1,
    SPEED_SPEAR_COMBO_DMG_MULT: 1.4,
    SPEED_SPEAR_COMBO_LUNGE_MULT: 1.3,
    // Explosion Crossbow.
    XBOW_BLAST_RADIUS: 2.5,
    XBOW_BLAST_DMG: 5,
    XBOW_BIG_RADIUS: 4.5,
    XBOW_BIG_DMG: 9,
    XBOW_BIG_PULL: 1.3,
    XBOW_BIG_DELAY: 0.7,
    XBOW_BIG_COOLDOWN: 20,
    XBOW_LV3_RADIUS_MULT: 1.5,
    XBOW_LV2_DRAW_MULT: 0.5,
    // Cheater's Axe: every hit locks the target's shield this long.
    CHEATER_STUN_SECONDS: 5,
    // Speed Spear (level 2+): a longer lunge on top of its shorter cooldown.
    SPEED_SPEAR_LUNGE_MULT: 1.5,
    // Void Mace.
    VOID_MACE_SMASH_MULT: 1.75,
    VOID_PULL_RANGE: 8,
    VOID_PULL_SPEED: 9,
    VOID_PULL_COOLDOWN: 3,
    // A dropped legendary lies on the ground this long before it goes back
    // in the shop, and whoever dropped it can't pick it straight back up.
    GROUND_SECONDS: 120,
    GROUND_PICKUP_DELAY: 5,
    // /give won't hand back something you dropped this recently.
    GIVE_DROP_COOLDOWN: 120,
    // One of each in the arena at a time (except `unlimited` ones), and a
    // weapon goes back in stock when its holder dies. `value` is how hard it
    // is to get on a 1-10 scale (1 ~ 5 minutes of play, 10 ~ an hour); the
    // price is worked out from it. `item` is the weapon it gives; the Luck
    // Potion is drunk on the spot and the Soulbound Charm is a one-use ward.
    LEGENDARY: [
      { key: 'luck', name: 'Luck Potion', value: 5, desc: 'Every buff at 1.5x strength for 5 minutes. Back in stock once it wears off.' },
      { key: 'dark_sword', item: 'dark_sword', name: 'Dark Sword', value: 3, desc: 'Replaces your sword. Twice the damage of netherite.' },
      { key: 'lifesteal_sword', item: 'lifesteal_sword', name: 'Lifesteal Sword', value: 6, desc: 'Replaces your sword. +1 heart per kill, up to 10 extra (lost on death).' },
      { key: 'magic_bow', item: 'magic_bow', name: 'Magic Bow', value: 4, desc: 'Replaces your bow. Arrows carry every debuff and home in slightly.' },
      { key: 'sea_trident', item: 'sea_trident', name: 'Trident of the Sea', value: 3, desc: 'Riptide gives Speed, Channeling sets targets alight for 10s, V summons rain.' },
      { key: 'cheaters_axe', item: 'cheaters_axe', name: "Cheater's Axe", value: 4, desc: 'Replaces your axe. Every hit disables their shield for 5s, raised or not.' },
      { key: 'speed_spear', item: 'speed_spear', name: 'Speed Spear', value: 7, desc: 'Replaces your spear (netherite strength). Levels up with kills.' },
      { key: 'blood_sword', item: 'blood_sword', name: 'Blood Sword', value: 8, desc: 'Replaces your sword. Levels up with kills.' },
      { key: 'explosion_crossbow', item: 'explosion_crossbow', name: 'Explosion Crossbow', value: 8, desc: 'Replaces your crossbow. Levels up with kills.' },
      { key: 'void_mace', item: 'void_mace', name: 'Void Mace', value: 8, desc: 'Replaces your mace. Hits far harder; right-click pulls enemies toward you.' },
      { key: 'soulbound', name: 'Soulbound Charm', value: 4, unlimited: true, desc: 'The last legendary weapon you bought survives your next death. Used up after one.' }
    ],
    // Ordinary supplies: unlimited stock, and like the rest of your pouch
    // they only last until you die. Anything your kit doesn't have (a bow
    // for arrows, flint and steel for TNT...) comes with it for that life.
    // `choices` lets the buyer pick which potion / which arrow tip.
    ITEMS: [
      { key: 'gapples', name: '10 Golden Apples', item: 'gapple', amount: 10, value: 1 },
      { key: 'pearls', name: '5 Ender Pearls', item: 'pearl', amount: 5, value: 1 },
      { key: 'potions', name: '2 Potions', amount: 2, value: 1,
        choices: ['pot_health', 'pot_strength', 'pot_speed', 'pot_fireres', 'pot_turtle', 'pot_invis'] },
      { key: 'egap', name: 'Enchanted Golden Apple', item: 'egap', amount: 1, value: 2 },
      { key: 'windcharges', name: '32 Wind Charges', item: 'windcharge', amount: 32, value: 2 },
      { key: 'fireworks', name: '32 Firework Rockets', item: 'firework', amount: 32, value: 2 },
      { key: 'arrows', name: '64 Arrows', ammo: 'arrow', amount: 64, value: 2, needsBow: true },
      { key: 'tipped', name: '32 Tipped Arrows', ammo: 'tipped_arrow', amount: 32, value: 2, needsBow: true,
        choices: ['poison', 'harming', 'wither', 'slowness', 'slowfall', 'weakness'] },
      { key: 'totems', name: '2 Totems of Undying', item: 'totem', amount: 2, value: 3 },
      { key: 'tnt', name: '32 TNT', item: 'tnt', amount: 32, value: 3, also: ['flint_steel'] },
      { key: 'tnt_minecart', name: '32 TNT Minecarts', item: 'tnt_minecart', amount: 32, value: 3, also: ['rail', 'flint_steel'] }
    ]
  };
  SHOP.ITEM_BY_KEY = {};
  for (var sii = 0; sii < SHOP.ITEMS.length; sii++) {
    SHOP.ITEMS[sii].cost = legendaryCost(SHOP.ITEMS[sii].value);
    SHOP.ITEM_BY_KEY[SHOP.ITEMS[sii].key] = SHOP.ITEMS[sii];
  }
  SHOP.LEGENDARY_BY_KEY = {};
  for (var li = 0; li < SHOP.LEGENDARY.length; li++) {
    SHOP.LEGENDARY[li].cost = legendaryCost(SHOP.LEGENDARY[li].value);
    SHOP.LEGENDARY_BY_KEY[SHOP.LEGENDARY[li].key] = SHOP.LEGENDARY[li];
  }

  /** Price for a 1-10 value: 1 is ~5 minutes of average play, 10 is ~an
   * hour, straight line between, rounded to a tidy multiple of 5. */
  function legendaryCost(value) {
    var minutes = 5 + (value - 1) * (55 / 9);
    return Math.round(minutes * SHOP.COINS_PER_MINUTE / 5) * 5;
  }

  // Every tipped-arrow option, in menu order. `none` is a plain arrow.
  var ARROW_TIPS = {
    none: { key: 'none', name: 'Normal', desc: 'No effect' },
    poison: { key: 'poison', name: 'Poison', desc: 'Heavy damage over time, but never kills' },
    harming: { key: 'harming', name: 'Instant Harming', desc: 'Extra damage the moment it lands' },
    wither: { key: 'wither', name: 'Wither', desc: 'Damage over time that can finish someone off' },
    slowness: { key: 'slowness', name: 'Slowness', desc: 'Cripples their movement speed' },
    slowfall: { key: 'slowfall', name: 'Slow Falling', desc: 'Floats them down - no fall damage' },
    weakness: { key: 'weakness', name: 'Weakness', desc: 'Weakens the damage they deal' }
  };
  var ARROW_TIP_KEYS = ['none', 'poison', 'harming', 'wither', 'slowness', 'slowfall', 'weakness'];
  function arrowTipKey(key) { return ARROW_TIPS[key] ? key : 'none'; }

  /** True if this slot's face map has at least one painted side. */
  function hasAnyTrim(faces) {
    if (!faces) return false;
    for (var i = 0; i < TRIM_FACES.length; i++) if (isValidTrim(faces[TRIM_FACES[i]])) return true;
    return false;
  }

  var COMBAT = {
    MAX_HEALTH: 20,
    REACH_BLOCK: 5.0,
    REACH_ATTACK: 3.6,
    REACH_ATTACK_SLACK: 1.6, // server side leniency for latency
    // Armor, Protection and Resistance multiply together, and stacked up
    // they could previously reach ~100% - a netherite+Protection target
    // under an egap's Resistance took 0.1 a hit, and anything weaker
    // rounded to 0 and was thrown away entirely, which is what "immortal"
    // looked like. A connecting unblocked hit now always lands at least
    // this share of its raw damage. Shields are applied after the cap and
    // can still stop a hit outright - that's active defence, not a stat.
    MAX_DAMAGE_REDUCTION: 0.85,

    // ------------------------------------------------------ tipped arrows --
    // Picked once at the menu (see ARROW_TIPS / the arrow-tip select) and
    // applied by every arrow you land. Damage-over-time tips tick once a
    // second, like burning.
    // Poison is the heaviest damage of the lot but can never land the
    // killing blow - it always leaves its target on 1 health, so it softens
    // someone up rather than finishing them. Wither hits for less in total
    // but *will* kill, which is the trade.
    POISON_DPS: 1.4,
    POISON_SECONDS: 8,
    WITHER_DPS: 0.9,
    WITHER_SECONDS: 8,
    WEAKNESS_DMG_MULT: 0.55,   // outgoing melee while weakened
    WEAKNESS_SECONDS: 10,
    ARROW_SLOWNESS_LEVEL: 4,
    ARROW_SLOWNESS_SECONDS: 8,
    SLOW_FALL_GRAVITY_MULT: 0.28,
    SLOW_FALL_SECONDS: 10,
    ARROW_HARMING_DAMAGE: 6,
    // Explosives caught in a blast go off a beat later rather than
    // instantly, so a chain reaction visibly spreads outward.
    CHAIN_DELAY_SECONDS: 0.35,

    // ----------------------------------------------------------- creepers --
    CREEPER_HEALTH: 14,
    CREEPER_CHARGED_HEALTH: 4,      // glass cannon - kill it before it reaches you
    CREEPER_SPEED: 4.2,
    CREEPER_FUSE_RANGE: 3.2,        // starts charging inside this
    CREEPER_ESCAPE_RANGE: 5.0,      // ...and gives up if you get back outside it
    CREEPER_FUSE_SECONDS: 1.6,
    CREEPER_CHARGED_FUSE_SECONDS: 0.7,
    CREEPER_BLAST_RADIUS: 4.5,
    CREEPER_BLAST_DMG: 11,
    CREEPER_CHARGED_DMG_MULT: 5,
    CREEPER_BLAST_KB: 1.5,
    CREEPER_HUNT_RANGE: 34,
    // Rain/thunder: a creeper standing out in it pulls strikes onto itself.
    // Roughly one in three random strikes goes to a creeper instead of a
    // player, which is what turns a storm into a real hazard.
    CREEPER_LIGHTNING_SHARE: 0.34,
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
    // crit) deals MACE_SMASH_BASE plus a bonus for the distance fallen
    // (capped at MACE_MAX_FALL), instead of the normal crit multiplier.
    // Same falloff shape as vanilla - the first few blocks count for the
    // most - but scaled well down: it used to be a flat 4.4 per block, so
    // a modest drop one-shot anyone. See maceSmashDamage().
    MACE_SMASH_BASE: 2,
    MACE_FALL_TIERS: [[3, 1.5], [5, 0.75], [Infinity, 0.35]], // [blocks, damage per block]
    // The Density V enchant: extra damage per block fallen, on top.
    MACE_DENSITY_PER_BLOCK: 0.4,
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
    // A charged thrust also rewards actually charging INTO the hit, jousting-
    // style: extra damage scaled off the wielder's own horizontal speed at
    // the instant it lands, on top of the flat multiplier above. Below
    // SPEAR_CHARGE_MIN_SPEED (walking pace) it's a no-op - only sprinting or
    // riding a Lunge dash into someone earns the bonus - and it's capped so
    // a chained air-lunge combo can't one-shot outright.
    SPEAR_CHARGE_MIN_SPEED: 3,
    SPEAR_CHARGE_SPEED_DMG_PER_UNIT: 0.35,
    SPEAR_CHARGE_MAX_SPEED_BONUS: 8,

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
    // Thrown potions are a burst of advantage in a fight, not something you
    // drink once and carry for the rest of the match.
    POTION_DURATION: 45,
    TURTLE_MASTER_DURATION: 20,
    // Invisibility is the exception - it's meant to last, so it stays on
    // its own long timer rather than the short combat one above.
    INVISIBILITY_DURATION: 480,
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
    KNOCKBACK_ENCHANT_ADD: 2.2, // sword Knockback III, added to the hit's knockback multiplier
    POWER_DMG_BONUS: 4, // bow Power V, added to arrow damage at any draw
    PUNCH_ENCHANT_ADD: 2.6, // bow Punch III, added to the arrow's knockback multiplier
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
    TRIDENT_SPEED: 46,
    TRIDENT_GRAVITY: 14,
    TRIDENT_THROW_DAMAGE: 9,
    TRIDENT_COOLDOWN_WITH_LOYALTY: 0.45,
    TRIDENT_COOLDOWN_NO_LOYALTY: 1.8,
    TRIDENT_RIPTIDE_SPEED: 18,
    // Riptide normally needs you to be wet. Mid-glide counts too, so a
    // trident is a usable burst of speed while flying rather than dead
    // weight the moment your feet leave the ground.
    TRIDENT_RIPTIDE_GLIDE_SPEED: 22,
    TRIDENT_CHANNELING_KB: 1.6,
    TRIDENT_IMPALING_BONUS_DMG: 5,

    // Stick: Knockback II/V dwarf a normal weapon's kbMul (usually ~1-1.8) -
    // added on top of it, not replacing it.
    STICK_KB2_ADD: 7,
    STICK_KB5_ADD: 18,

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
    // Magma block damage per second (see server.js's tick).
    MAGMA_DPS: 1,

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
    // Unboosted gliding is deliberately slow - a firework is what makes an
    // elytra fast, not the wings on their own.
    ELYTRA_MAX_SPEED: 9,
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
    LIGHTNING_STRIKE_DMG: 5,

    // Wolves: spawned by a Wolf Spawn Egg, loyal only to whoever's egg it
    // was (see ownerId in server.js). Dog Armor is a flat damage-reduction
    // fraction rather than a full armor-tier simulation - simpler, and a
    // wolf's low health pool means even vanilla-accurate protection values
    // would round to "takes noticeably less damage" anyway.
    WOLF_SPAWN_REACH: 4,
    WOLF_HEALTH: 20,
    WOLF_ARMOR_BONUS_HEALTH: 10,
    WOLF_ARMOR_DMG_REDUCTION: 0.3,
    WOLF_DAMAGE: 4,
    WOLF_ATTACK_REACH: 2.2,
    WOLF_ATTACK_COOLDOWN: 1.0,
    WOLF_FOLLOW_SPEED: 5,
    WOLF_FOLLOW_MIN_DIST: 3,
    WOLF_FOLLOW_MAX_DIST: 14, // beyond this, teleport back to the owner instead of trotting the whole way
    WOLF_LOYALTY_RANGE: 40 // an owner hit further than this away doesn't call wolves in from across the map
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
    BOUNCY: BOUNCY,
    SLOW: SLOW,
    MAGMA: MAGMA,
    SLIPPERY: SLIPPERY,
    HARDNESS: HARDNESS,
    TILES: TILES,
    ITEMS: ITEMS,
    KITS: KITS,
    DEFAULT_KIT: DEFAULT_KIT,
    botKit: botKit,
    maceSmashDamage: maceSmashDamage,
    kitGear: kitGear,
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
    TRIM_GRID: TRIM_GRID,
    TRIM_CELLS: TRIM_CELLS,
    TRIM_PALETTE: TRIM_PALETTE,
    TRIM_SLOTS: TRIM_SLOTS,
    TRIM_FACES: TRIM_FACES,
    isValidTrim: isValidTrim,
    sanitizeTrims: sanitizeTrims,
    hasAnyTrim: hasAnyTrim,
    ARROW_TIPS: ARROW_TIPS,
    ARROW_TIP_KEYS: ARROW_TIP_KEYS,
    arrowTipKey: arrowTipKey,
    SHOP: SHOP,
    baseKey: baseKey,
    findItem: findItem,
    weaponLevel: weaponLevel,
    weaponCooldown: weaponCooldown,
    weaponDrawTime: weaponDrawTime,
    COMBAT: COMBAT,
    PHYS: PHYS,
    breakTime: breakTime,
    reduceByArmor: reduceByArmor
  };
});
