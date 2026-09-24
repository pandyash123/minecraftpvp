/*
 * Minecraft-style kit PvP — authoritative game server.
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 BOTS=6 node server.js
 *
 * Movement is client simulated (for responsiveness) but combat, projectiles,
 * health, deaths and the world itself are owned by this process.
 */
'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const MC = require('./shared/blocks.js');
const WorldGen = require('./shared/worldgen.js');
const Physics = require('./shared/physics.js');

const W = MC.WORLD;
const ID = MC.ID;
const C = MC.COMBAT;

const PORT = process.env.PORT || 3000;
const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 20260726;
const BOT_COUNT = process.env.BOTS !== undefined ? parseInt(process.env.BOTS, 10) : 4;
const TICK_HZ = 30;
const SNAPSHOT_HZ = 20;

const DIFFICULTY = {
  easy: { skillMin: 0.10, skillMax: 0.22 },
  normal: { skillMin: 0.40, skillMax: 0.60 },
  hard: { skillMin: 0.78, skillMax: 0.95 },
  random: { skillMin: 0.15, skillMax: 0.95 }
};
let defaultDifficulty = DIFFICULTY[process.env.DIFFICULTY] ? process.env.DIFFICULTY : 'normal';
function rollSkill(diffKey) {
  const d = DIFFICULTY[diffKey] || DIFFICULTY[defaultDifficulty];
  return rand(d.skillMin, d.skillMax);
}

// Difficulty already governs aim/reaction/aggression via skill (above) - this
// additionally scales the raw damage a bot deals, so "Easy" bots genuinely
// hit softer and "Hard" bots genuinely hit harder, not just less/more often.
const DIFFICULTY_DAMAGE_MULT = { easy: 0.6, normal: 1.0, hard: 1.5, random: 1.0 };
function botDamageMult(bot) { return DIFFICULTY_DAMAGE_MULT[bot.difficulty] || 1; }

// Even without an axe, a bot that keeps landing blocked hits on the same
// target eventually breaks their shield - fewer hits needed at higher
// difficulty. Tracked per-attacker (blockStreak/blockStreakVictim on the
// bot), reset whenever a hit against them lands unblocked or they switch
// who they're hitting.
const BOT_SHIELD_BREAK_HITS = { easy: 3, normal: 2, hard: 1, random: 2 };

// Some bots spawn (and respawn) with one bonus consumable/utility on top of
// their normal kit - unlimited use of it (never runs out), but still
// cooldown-gated in stepBot so it doesn't spam every tick; those cooldowns
// scale down with bot.skill (same idiom as the bow-shot cooldown), so
// higher-difficulty bots genuinely reach for it more often, not just less
// randomly. egap is deliberately rarer than the other three.
const BOT_BONUS_ITEM_CHANCE = 0.3;
// elytra_firework temporarily removed - elytra flight is being tuned down
// and isn't ready for bots to use yet.
const BOT_BONUS_ITEM_WEIGHTS = { gapple: 3, cobweb: 3, egap: 1 };
function rollBonusItem() {
  if (Math.random() >= BOT_BONUS_ITEM_CHANCE) return null;
  const total = Object.values(BOT_BONUS_ITEM_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const key of Object.keys(BOT_BONUS_ITEM_WEIGHTS)) {
    r -= BOT_BONUS_ITEM_WEIGHTS[key];
    if (r <= 0) return key;
  }
  return null;
}

// Global "gang up" toggle (see /botteam, or the menu checkbox) - when on,
// bots only ever consider the human player(s) a valid target, never each
// other, so the whole squad fights you instead of each other.
let botsCooperate = false;

// Global "give bots hacks" toggle (see /bothacks, or the menu checkbox) -
// when on, every bot fights dirty: instant webs regardless of distance,
// extended melee reach, a damage multiplier, a lower attack cooldown, and a
// gentle hover/float instead of falling normally. Off by default - this is
// an opt-in novelty/challenge mode, not the baseline experience.
let botHacksEnabled = false;
const BOT_HACKS = {
  reachBonus: 3,
  dmgMult: 1.6,
  cooldownDivisor: 1.8,
  hoverFallCap: -1.5,
  hoverHopVy: 4.5
};

// How much of their kit bots actually use in a fight, chosen at the menu or
// via /botweapon / the 5th /bots argument:
//   fixed     - one melee weapon (sword or axe) for life, plus bow + shield
//               at their usual ranges. This is the original bot behaviour.
//   versatile - periodically re-rolls between sword/axe, plus bow + shield,
//               and eats a golden apple to heal when hurt.
//   full      - everything versatile does, plus occasionally drops a cobweb
//               near the player to slow them down. Never places building
//               blocks (cobble/planks).
const WEAPON_MODES = ['fixed', 'versatile', 'full'];
let defaultBotWeaponMode = WEAPON_MODES.includes(process.env.WEAPONMODE) ? process.env.WEAPONMODE : 'fixed';

// Bots each pick an armor tier (see MC.ARMOR_TIERS) instead of always
// matching the human player's fixed diamond kit - chosen at the menu or via
// /botarmor, defaulting to the same full diamond+Protection IV as the player.
let defaultBotArmor = MC.ARMOR_TIERS[process.env.ARMOR] ? process.env.ARMOR : 'diamond';

// Which ruleset (see MC.KITS) bots draw their loadout from - chosen at the
// menu or via /botkit, independent of the human player's own /kit choice.
let defaultBotKit = MC.KITS[process.env.KIT] ? process.env.KIT : 'web';

// Bots always fight with fixed numbers, independent of whatever the human
// player's own sword/axe currently is - otherwise buffing the player's
// weapon would silently buff every bot too. Each bot is dealt one of these
// at random (axe only if their kit includes it) so you can see (and fight)
// both - `slot` is the ITEMS index the bot reports so remote clients render
// the right item in its hand.
// `slot` is looked up by key instead of a hardcoded literal - ITEMS is a
// shared array whose indices shift whenever an item gets inserted anywhere
// before sword/axe (as netherite_sword/netherite_axe now do), and a stale
// hardcoded index here would make bots visibly hold/report the wrong item.
const BOT_WEAPONS = {
  sword: { key: 'sword', slot: MC.ITEMS.findIndex(i => i.key === 'sword'), damage: 6, cooldown: 0.42 },
  axe: { key: 'axe', slot: MC.ITEMS.findIndex(i => i.key === 'axe'), damage: 9, cooldown: 0.9 }
};
function pickBotWeapon(kit) {
  if (!MC.kitHasItem(kit, 'axe')) return 'sword';
  return Math.random() < 0.65 ? 'sword' : 'axe';
}

// ---------------------------------------------------------------- world ---
// Which arena layout is loaded (see WorldGen.ARENAS). Switchable at
// runtime with /arena, which regenerates the world in place.
let currentArena = WorldGen.arenaKey(process.env.ARENA || 'classic');
const blocks = WorldGen.generate(SEED, currentArena);
// Reassigned whenever the arena changes - spawn rings are per-layout, and
// a Skyward spawn on the classic map would drop people in mid-air.
let spawns = WorldGen.spawnPoints(blocks, SEED, currentArena);
/** index -> blockId, every edit made since the server booted */
const edits = new Map();

/**
 * Regenerates the pristine arena (same seed, so it's identical to what the
 * server booted with) and forgets every placed/broken block since. Called
 * when a lone player rejoins - typically just clicking "Play" again after a
 * refresh - so they don't come back to a map cluttered with their last
 * session's cobble towers. Never called while anyone else is still playing.
 */
function resetWorld(arena) {
  if (arena) currentArena = WorldGen.arenaKey(arena);
  blocks.set(WorldGen.generate(SEED, currentArena));
  spawns = WorldGen.spawnPoints(blocks, SEED, currentArena);
  edits.clear();
}

function inBounds(x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < W.SX && y < W.SY && z < W.SZ;
}
function getBlock(x, y, z) {
  x |= 0; y |= 0; z |= 0;
  if (!inBounds(x, y, z)) return y < 0 ? ID.BEDROCK : ID.AIR;
  return blocks[(y * W.SZ + z) * W.SX + x];
}
function setBlock(x, y, z, id) {
  if (!inBounds(x, y, z)) return false;
  const i = (y * W.SZ + z) * W.SX + x;
  if (blocks[i] === id) return false;
  blocks[i] = id;
  edits.set(i, id);
  return true;
}

// -------------------------------------------------------------- helpers ---
const players = new Map(); // id -> player
let projectiles = [];
let nextProjectileId = 1;
let nextBotId = 1;
// Placed-and-lit TNT/TNT Minecart blocks, counting down to their explosion -
// see the 'ignite' handler and the fuse check in tick().
let liveTNT = [];
// Temporary burning patches lit by flint and steel on non-TNT ground - see
// lightGroundFire()/igniteTNTBlock() and the tick() checks that use them.
let groundFires = [];
// Bounded flood-fill queue for water/lava spread - see the LIQUID_SPREAD_*
// tick and the seed pushed in the 'setBlock' handler.
let liquidSpreadQueue = [];
// Respawn Anchor charge counts, keyed by "x,y,z" - see the 'chargeAnchor'
// handler. Reaching COMBAT.ANCHOR_MAX_CHARGES detonates it immediately.
const anchorCharges = new Map();
// Wolves spawned from a Wolf Spawn Egg - a separate map from `players`
// since they don't have a kit/inventory/armor tier/any of that, just a
// simple health pool, an owner, and the stepWolf() AI below. Removed
// outright on death (no respawn - a wolf dying is permanent, same as
// vanilla), and when their owner disconnects (see the 'disconnect' handler).
const wolves = new Map();
let nextWolfId = 1;

const BOT_NAMES = ['Steve', 'Alex', 'Herobrine', 'Notch', 'Zombie_Slayer', 'CreeperFan',
  'DiamondSword', 'Enderman', 'PvP_God', 'BlockBuster', 'xX_Miner_Xx', 'RedstoneRick'];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function now() { return Date.now() / 1000; }

// -------------------------------------------------------------- weather ---
// clear/rain/thunder, chosen on a timer and broadcast to everyone. Rain (and
// thunder) is what lets Riptide fire outside of water, same as vanilla;
// thunder is additionally required for Channeling to do anything.
let weather = 'clear';
let weatherUntil = now() + rand(C.WEATHER_CLEAR_SECONDS[0], C.WEATHER_CLEAR_SECONDS[1]);

function rollWeather() {
  const t = now();
  if (weather === 'clear') {
    weather = 'rain';
    weatherUntil = t + rand(C.WEATHER_RAIN_SECONDS[0], C.WEATHER_RAIN_SECONDS[1]);
    if (Math.random() < C.WEATHER_THUNDER_CHANCE) {
      weather = 'thunder';
      weatherUntil = t + rand(C.WEATHER_THUNDER_SECONDS[0], C.WEATHER_THUNDER_SECONDS[1]);
    }
  } else {
    weather = 'clear';
    weatherUntil = t + rand(C.WEATHER_CLEAR_SECONDS[0], C.WEATHER_CLEAR_SECONDS[1]);
  }
  io.emit('weather', { kind: weather });
}

function isWet(p) {
  return weather !== 'clear' || isInWater(p);
}

function itemBySlot(slot) { return MC.ITEMS[clamp(slot | 0, 0, MC.ITEMS.length - 1)]; }

// Single source of truth for max stack sizes: each ITEMS entry's `ammo`
// field. Spawning/respawning gives a full stack of each.
const ITEM_BY_KEY = {};
for (const item of MC.ITEMS) ITEM_BY_KEY[item.key] = item;
// blockId -> item key, for kit-gating what can actually be placed.
const BLOCK_ITEM_KEY = {};
for (const item of MC.ITEMS) if (item.type === 'block') BLOCK_ITEM_KEY[item.block] = item.key;
// Every potion key, for the per-kill restock in kill() below.
const POTION_KEYS = MC.ITEMS.filter(i => i.type === 'potion').map(i => i.key);
// Items a kill hands out one of, with a Looting-scaled chance of 2-3
// instead (see kill()). Deliberately a list rather than hardcoded keys:
// giving a future item the same "rare but steady" drop is a one-line
// change here, with no other wiring needed.
const KILL_BONUS_ITEMS = ['totem', 'egap', 'wolf_spawn_egg'];

function freshAmmo() {
  return {
    arrow: C.ARROW_AMMO, pearl: ITEM_BY_KEY.pearl.ammo, gapple: ITEM_BY_KEY.gapple.ammo, windcharge: ITEM_BY_KEY.windcharge.ammo,
    pot_strength: ITEM_BY_KEY.pot_strength.ammo, pot_speed: ITEM_BY_KEY.pot_speed.ammo, pot_fireres: ITEM_BY_KEY.pot_fireres.ammo,
    pot_turtle: ITEM_BY_KEY.pot_turtle.ammo, pot_health: ITEM_BY_KEY.pot_health.ammo, egap: ITEM_BY_KEY.egap.ammo,
    water_bucket: ITEM_BY_KEY.water_bucket.ammo, lava_bucket: ITEM_BY_KEY.lava_bucket.ammo,
    tnt: ITEM_BY_KEY.tnt.ammo, tnt_minecart: ITEM_BY_KEY.tnt_minecart.ammo,
    powder_snow_bucket: ITEM_BY_KEY.powder_snow_bucket.ammo, totem: ITEM_BY_KEY.totem.ammo, firework: ITEM_BY_KEY.firework.ammo,
    wolf_spawn_egg: ITEM_BY_KEY.wolf_spawn_egg.ammo
  };
}

/** True if `p` is currently standing in water - Riptide (only triggers in
 * water) and Impaling (bonus damage against a target in water). */
function isInWater(p) {
  return Physics.inWater(getBlock, p.x, p.y, p.z);
}

/** True if `p` is currently standing in a placed lava block - see the lava
 * damage/ignite tick in tick(). Same body-position check Physics.inWater
 * uses, just for the specific lava block id instead of any liquid. */
function isInLava(p) {
  return getBlock(Math.floor(p.x), Math.floor(p.y + 0.6), Math.floor(p.z)) === ID.LAVA;
}

/** True if `p` is standing in a powder snow block - extinguishes burning,
 * see the tick() check that uses this. */
function isInPowderSnow(p) {
  return getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)) === ID.POWDER_SNOW;
}

/** True if `p`'s loadout grants item `key`: their own hand-picked custom
 * list if they built one (see customItems, set at join), otherwise their
 * chosen kit preset (see MC.KITS) - bots always use the latter. */
function playerHasItem(p, key) {
  // Netherite sword/axe are a tier swap on top of sword/axe (see
  // swordTier/axeTier, set at join and mirrored by the client's own hotbar
  // build - see _initInventorySlots), never both at once: whichever one a
  // kit/custom loadout would normally grant, the player's tier preference
  // decides which single variant they actually have.
  if (key === 'sword') return p.swordTier !== 'netherite' && hasBaseItem(p, 'sword');
  if (key === 'netherite_sword') return p.swordTier === 'netherite' && hasBaseItem(p, 'sword');
  if (key === 'axe') return p.axeTier !== 'netherite' && hasBaseItem(p, 'axe');
  if (key === 'netherite_axe') return p.axeTier === 'netherite' && hasBaseItem(p, 'axe');
  // Elytra is locked behind the secret '/elytra257' chat command (not in
  // /help, not in any kit/custom loadout) - entirely separate from kit
  // membership, unlike every other item.
  if (key === 'elytra') return !!p.elytraUnlocked;
  return hasBaseItem(p, key);
}
function hasBaseItem(p, key) {
  return p.customItems ? p.customItems.has(key) : MC.kitHasItem(p.kit, key);
}

/** Deep-merges a client's enchantOpts payload over MC.defaultEnchantOpts(),
 * keeping only real booleans for real (slot, key) pairs from ENCHANT_DEFS -
 * anything else in a stale/tampered payload is silently ignored rather than
 * trusted. */
function mergeEnchantOpts(user) {
  const out = MC.defaultEnchantOpts();
  if (user) {
    for (const slot in out) {
      if (!user[slot]) continue;
      for (const key in out[slot]) {
        if (typeof user[slot][key] === 'boolean') out[slot][key] = user[slot][key];
      }
    }
  }
  return out;
}

/** Whether `p`'s enchant toggle `slot.key` is on - false for anything
 * missing/malformed rather than throwing. */
function hasEnchant(p, slot, key) {
  return !!(p.enchants && p.enchants[slot] && p.enchants[slot][key]);
}

/** The item in `p`'s hotbar slot `slot`, or null if that slot is empty for
 * their loadout - the single gate every use-an-item action
 * (attack/shoot/place) goes through. */
function itemForPlayer(p, slot) {
  const item = itemBySlot(slot);
  return playerHasItem(p, item.key) ? item : null;
}

/** Netherite sword/axe are their own selectable items (so they can carry
 * their own higher base damage - see ITEMS), but mechanically they're just
 * a sword/axe: same enchant slot, same armor-reduction/shield-break/
 * looting/attack-dummy-retaliation handling as the plain version. Used
 * everywhere those need "which weapon type is this, really" instead of the
 * raw item key. */
function baseWeaponKey(key) {
  return key === 'netherite_sword' ? 'sword' : key === 'netherite_axe' ? 'axe' : key;
}

function makePlayer(id, name, isBot, armorTier, kit, customItems, enchantOpts, swordTier, axeTier, dogArmor, trims) {
  const s = pick(spawns);
  // A custom loadout is human-only, and only every key that's actually a
  // real ITEMS entry - anything else (a stale/tampered client) is silently
  // dropped rather than trusted.
  const custom = !isBot && Array.isArray(customItems) && customItems.length
    ? new Set(customItems.filter(k => ITEM_BY_KEY[k]))
    : null;
  return {
    id, name: String(name || 'Player').slice(0, 16),
    bot: !!isBot,
    kit: MC.KITS[kit] ? kit : (isBot ? defaultBotKit : 'web'),
    customItems: custom,
    // The human player always wears the full diamond kit by default (see
    // MC.ARMOR) - optionally netherite instead, opt-in via the menu's "Use
    // netherite armor" checkbox. Bots pick a tier the same way (default:
    // matches the player's). Every enchant toggle (armor/sword/axe/bow, see
    // ENCHANT_DEFS) is human-only and opt-in via the menu; bots always get
    // the defaults, applied in combat via hasEnchant().
    armorTier: isBot ? (MC.ARMOR_TIERS[armorTier] ? armorTier : defaultBotArmor) : (armorTier === 'netherite' ? 'netherite' : 'diamond'),
    // Same idea as armorTier, but for the sword/axe slot specifically -
    // human-only (bots always get the plain version); see playerHasItem().
    swordTier: !isBot && swordTier === 'netherite' ? 'netherite' : 'diamond',
    axeTier: !isBot && axeTier === 'netherite' ? 'netherite' : 'diamond',
    // Decided once at join (the menu's "Give wolves armor" checkbox) -
    // every wolf this player's eggs spawn gets it or doesn't, see spawnWolf().
    dogArmor: !isBot && !!dogArmor,
    // Player-painted patterns, one grid per armor piece plus elytra/shield
    // (see the customize-trims menu editor and MC.sanitizeTrims) - human-
    // only, fixed for the whole session like every other menu-chosen
    // cosmetic here, and included in publicPlayer() so everyone else's
    // client can render them too.
    trims: isBot ? null : MC.sanitizeTrims(trims),
    // In-match shop (see the 'shopBuy' handler). Bots never buy anything,
    // so their levels stay at zero and every effect below resolves to 1.
    coins: isBot ? 0 : MC.SHOP.START_COINS,
    upgrades: MC.freshUpgrades(),
    lastCoinTick: now(),
    enchants: isBot ? MC.defaultEnchantOpts() : mergeEnchantOpts(enchantOpts),
    x: s[0], y: s[1], z: s[2],
    vx: 0, vy: 0, vz: 0,
    yaw: rand(-Math.PI, Math.PI), pitch: 0,
    onGround: true, sneak: false, sprint: false, gliding: false, offhandKey: 'shield', chestSlot: 'chestplate', swinging: false, blocking: false, shieldStunUntil: 0,
    blockStreak: 0, blockStreakVictim: null,
    slot: 0,
    health: C.MAX_HEALTH, absorption: 0, alive: true,
    kills: 0, deaths: 0, streak: 0,
    ammo: freshAmmo(),
    effects: {},
    burnUntil: 0, lastBurnTick: 0,
    lastAttack: 0, lastPotionThrow: 0, lastDamage: -99, lastRegen: 0, lastEffectRegenTick: 0, tridentAvailableAt: 0, spawnAt: now(),
    respawnAt: 0,
    fallFrom: null,
    smashPeak: null,
    lastSeen: now(),
    // bot only
    bonusItem: null,
    ai: isBot ? { target: null, jitter: Math.random() * 6.28, strafe: 1, nextStrafe: 0, nextShot: 0, wander: null } : null
  };
}

/** freshAmmo() scaled by whatever Starting Gear level the player has
 * bought - applied on every respawn and the moment the upgrade is bought,
 * so it never takes a death to feel the purchase. */
function upgradedAmmo(p) {
  const mult = MC.shopEffect('gear', p.upgrades && p.upgrades.gear);
  const ammo = freshAmmo();
  if (mult === 1) return ammo;
  for (const k in ammo) ammo[k] = Math.floor(ammo[k] * mult);
  return ammo;
}

/** Current coins + upgrade levels, for the owning client's shop UI. */
function shopState(p) {
  return { coins: p.coins | 0, upgrades: Object.assign({}, p.upgrades) };
}
function sendShop(p) {
  if (p.socket) p.socket.emit('shopState', shopState(p));
}
function awardCoins(p, amount) {
  if (!p || p.bot || amount <= 0) return;
  p.coins = (p.coins | 0) + amount;
  sendShop(p);
}

function respawn(p) {
  // A training dummy always returns to the exact spot it was placed at,
  // rather than a random arena spawn - it's meant to be a fixed target.
  const s = (p.dummy && p.home) ? [p.home.x, p.home.y, p.home.z] : pick(spawns);
  p.x = s[0]; p.y = s[1]; p.z = s[2];
  p.vx = p.vy = p.vz = 0;
  p.health = C.MAX_HEALTH;
  // A little buffed absorption shield on top of full health/ammo - eases you
  // back into the fight instead of dropping you in exactly as fragile as
  // when you died.
  p.absorption = 4;
  p.alive = true;
  p.ammo = upgradedAmmo(p);
  p.spawnAt = now();
  p.lastDamage = -99;
  p.fallFrom = null;
  p.smashPeak = null;
  p.slot = 0;
  p.blocking = false;
  p.shieldStunUntil = 0;
  p.blockStreak = 0;
  p.blockStreakVictim = null;
  // A clean slate each life, same as ammo/absorption above - potion buffs
  // and debuffs (and burning) don't carry through death.
  p.effects = {};
  p.burnUntil = 0;
  if (p.attackDummy) { p.retaliateWeapon = 'sword'; p.retaliateEnchants = null; }
  // Bots reroll their bonus item (see rollBonusItem) fresh each life.
  if (p.bot) {
    p.bonusItem = rollBonusItem();
    p.chestSlot = p.bonusItem === 'elytra_firework' ? 'elytra' : 'chestplate';
    p.gliding = false;
  }
  // Ammo goes with it: respawn refills the pouch server-side, and without
  // sending it the client's HUD keeps showing whatever was left when you
  // died. Doubly visible now the shop's Starting Gear changes the amount.
  if (p.socket) p.socket.emit('respawn', { x: p.x, y: p.y, z: p.z, health: p.health, absorption: p.absorption, ammo: p.ammo });
  if (p.socket) p.socket.emit('effects', {});
  io.emit('spawned', { id: p.id, x: p.x, y: p.y, z: p.z });
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, bot: p.bot, dummy: !!p.dummy, atkDummy: !!p.attackDummy, difficulty: p.difficulty || null,
    armor: p.armorTier, kit: p.kit,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, absorption: p.absorption, alive: p.alive,
    slot: p.slot, sneak: p.sneak, sprint: p.sprint, blocking: p.blocking,
    kills: p.kills, deaths: p.deaths, streak: p.streak,
    trims: p.trims || null
  };
}

/** True if `attacker` is roughly in front of `victim` - horizontal facing
 * (yaw) only. Deliberately NOT pitch-sensitive: real shield blocking doesn't
 * require your crosshair to be precisely on the attacker, only that you're
 * generally turned towards them, same as vanilla Minecraft. */
function withinFOV(victim, attacker) {
  const dx = attacker.x - victim.x, dz = attacker.z - victim.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw); // yaw 0 == -Z
  return (dx / len) * fx + (dz / len) * fz > C.SHIELD_FOV_DOT;
}

/** A shield covers the torso, not the top or bottom of the hitbox - an
 * attacker standing well above or below the victim gets a free headshot /
 * leg shot through it regardless of where the victim is looking. */
function isHeadOrLegShot(victim, attacker) {
  return Math.abs(attacker.y - victim.y) > C.SHIELD_VERTICAL_TOLERANCE;
}

/** Would `victim`'s raised shield actually block a hit from `attacker` right
 * now: not stunned, in FOV, and not a headshot/leg shot. */
function shieldBlocks(victim, attacker, t) {
  return victim.blocking && t > (victim.shieldStunUntil || 0) &&
    withinFOV(victim, attacker) && !isHeadOrLegShot(victim, attacker);
}

function scoreboard() {
  return [...players.values()]
    .map(p => ({
      id: p.id, name: p.name, bot: p.bot, dummy: !!p.dummy, atkDummy: !!p.attackDummy, difficulty: p.difficulty || null,
      armor: p.armorTier,
      kills: p.kills, deaths: p.deaths, streak: p.streak, alive: p.alive, ping: p.ping | 0
    }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

function broadcastScores() { io.emit('scores', scoreboard()); }

// -------------------------------------------------------------- effects ---
/** `p.effects[kind]` if still running (lazily deleting it once it's
 * expired), or null. `t` is the caller's own `now()` so every check in one
 * tick agrees on the same instant. */
function activeEffect(p, kind, t) {
  const e = p.effects && p.effects[kind];
  if (!e) return null;
  if (e.until <= t) { delete p.effects[kind]; return null; }
  return e;
}

/** Sets/refreshes `p` on fire for COMBAT.BURN_SECONDS (Fire Aspect/Flame) -
 * a fresh ignite always resets the full duration rather than stacking.
 * Doesn't check Fire Resistance itself; that's checked once per tick where
 * the burn damage is actually applied (see tick()), so a potion drunk
 * *after* being ignited still stops the burn immediately. */
function ignitePlayer(p, t) {
  p.burnUntil = t + C.BURN_SECONDS;
}

/** True if `p` currently has any timed potion effect running (not Instant
 * Health, which is immediate and never occupies `p.effects`) - drives the
 * swirling particle shown around a buffed/debuffed player (see
 * sendSnapshot's flags bit and the client's per-player particle spawn). */
function hasAnyEffect(p, t) {
  return !!(activeEffect(p, 'strength', t) || activeEffect(p, 'speed', t) || activeEffect(p, 'slowness', t) ||
    activeEffect(p, 'resistance', t) || activeEffect(p, 'fireResistance', t) || activeEffect(p, 'regeneration', t));
}

/** Applies a drunk potion's effect to `p`. Speed/Slowness and Strength/
 * Resistance aren't mutually exclusive with each other, but a fresh Speed
 * clears any lingering Slowness and vice versa (Turtle Master's own kit) -
 * drinking one is meant to replace the other, not stack against it. */
function applyPotionEffect(p, item, t) {
  const dur = C.POTION_DURATION;
  switch (item.potion) {
    case 'strength': p.effects.strength = { level: item.level, until: t + dur }; break;
    case 'speed': p.effects.speed = { level: item.level, until: t + dur }; delete p.effects.slowness; break;
    case 'fireResistance': p.effects.fireResistance = { level: 1, until: t + dur }; break;
    case 'turtleMaster': {
      const tDur = C.TURTLE_MASTER_DURATION;
      p.effects.slowness = { level: item.slowLevel, until: t + tDur };
      p.effects.resistance = { level: item.resistLevel, until: t + tDur };
      delete p.effects.speed;
      break;
    }
    case 'instantHealth':
      p.health = Math.min(C.MAX_HEALTH, p.health + item.heal);
      io.emit('hp', { id: p.id, health: p.health, absorption: p.absorption });
      break;
  }
}

/** Every currently-running effect on `p`, as {level, remaining-seconds} -
 * sent to the *drinker's own* client only (so its local movement physics can
 * apply Speed/Slowness, and the HUD can show countdowns). Always a full
 * snapshot, not a delta, so the client can just replace its local copy
 * wholesale and never gets stuck with a stale entry the server already
 * cleared (e.g. Speed overwriting Slowness). */
function effectsSnapshot(p, t) {
  const out = {};
  for (const kind in p.effects) {
    const e = activeEffect(p, kind, t);
    if (e) out[kind] = { level: e.level, remaining: e.until - t };
  }
  return out;
}

// --------------------------------------------------------------- combat ---
function applyDamage(victim, amount, source, cause, kbX, kbZ, kbY) {
  if (!victim.alive || amount <= 0) return;
  const t = now();
  if (t - victim.spawnAt < C.SPAWN_PROTECT && source && source.id !== victim.id) return;

  // The attack dummy mirrors back whatever melee weapon it was just hit
  // with, *and* that weapon's own enchants (Sharpness/Knockback/Fire
  // Aspect) - update this even if the hit ends up doing ~0 damage after
  // armor. A bot attacker's own (default) enchants get copied too, not
  // just a human's.
  if (victim.attackDummy && (cause === 'sword' || cause === 'axe')) {
    victim.retaliateWeapon = cause;
    victim.retaliateEnchants = (source && source.enchants && source.enchants[cause]) ? Object.assign({}, source.enchants[cause]) : null;
  }

  let dmg = amount;
  // Full diamond/Protection IV kit + a raised shield only apply to direct
  // combat hits - fall, void and self-inflicted damage bypass armor, same
  // as vanilla.
  let blocked = false;
  if (cause === 'sword' || cause === 'arrow' || cause === 'axe' || cause === 'mace' || cause === 'spear' || cause === 'trident' || cause === 'stick' || cause === 'tnt' || cause === 'firework' || cause === 'crystal' || cause === 'anchor' || cause === 'wolf') {
    // Protection IV is always-on for bots (their fixed ARMOR_TIERS entry) but
    // an opt-in toggle for the human player (see enchants.armor.protection,
    // set at join) - build an effective tier with that swapped in rather
    // than touching ARMOR_TIERS.diamond itself. Elytra worn in the chest
    // slot instead of the chestplate gives up that piece's defense/toughness
    // entirely, same as vanilla - only humans can actually equip it.
    let tier = MC.ARMOR_TIERS[victim.armorTier];
    if (!victim.bot) {
      const chestOff = victim.chestSlot === 'elytra';
      tier = Object.assign({}, tier, {
        value: chestOff ? tier.value - MC.ARMOR.chestplate.defense : tier.value,
        toughness: chestOff ? tier.toughness - MC.ARMOR.chestplate.toughness : tier.toughness,
        protLevel: hasEnchant(victim, 'armor', 'protection') ? tier.protLevel : 0
      });
    }
    // Breach: a mace hit with it toggled on skips armor reduction entirely
    // (still blockable by a shield, still reduced by Resistance - it's
    // specifically armor it bypasses, not every layer of defense).
    const breach = cause === 'mace' && source && hasEnchant(source, 'mace', 'breach');
    if (!breach) dmg = MC.reduceByArmor(dmg, tier);
    // Blast Protection (netherite's blastResist, see ARMOR_TIERS): an extra
    // cut on top of the normal armor formula, only for explosive causes -
    // a dedicated resistance layer, same as vanilla's separate enchant.
    if (!breach && tier.blastResist && (cause === 'tnt' || cause === 'firework' || cause === 'crystal' || cause === 'anchor')) {
      dmg *= (1 - tier.blastResist);
    }
    const resist = activeEffect(victim, 'resistance', t);
    if (resist) dmg *= (1 - Math.min(1, C.RESISTANCE_PCT_PER_LEVEL * resist.level));
    // Floor the combined armor/Protection/Resistance reduction before the
    // shield is considered, so a hit that connects always does something.
    dmg = Math.max(dmg, amount * (1 - C.MAX_DAMAGE_REDUCTION));
    const canBlock = !!source && source.id !== victim.id && shieldBlocks(victim, source, t);
    if (canBlock) {
      // The hit that breaks through still gets blocked normally - the
      // punishment is disabling the shield afterward, not this hit itself.
      dmg *= (1 - C.SHIELD_BLOCK);
      blocked = true;
      // An axe always breaks a shield it connects with, on the spot,
      // whoever's swinging it. Bots additionally learn to wear a shield
      // down with repeated blocked hits from ANY weapon, even without an
      // axe - fewer hits needed the higher their difficulty.
      let breaksShield = cause === 'axe';
      if (!breaksShield && source.bot) {
        if (source.blockStreakVictim !== victim.id) { source.blockStreak = 0; source.blockStreakVictim = victim.id; }
        source.blockStreak = (source.blockStreak || 0) + 1;
        if (source.blockStreak >= (BOT_SHIELD_BREAK_HITS[source.difficulty] || 2)) breaksShield = true;
      }
      if (breaksShield) {
        victim.shieldStunUntil = t + C.AXE_STUN;
        victim.blocking = false;
        if (victim.socket) victim.socket.emit('shieldStun', { duration: C.AXE_STUN });
        io.emit('effect', { kind: 'shieldbreak', x: victim.x, y: victim.y + 1.2, z: victim.z });
        if (source.bot) source.blockStreak = 0;
      }
    } else if (source && source.bot) {
      // A clean, unblocked hit resets the attrition count - it's about
      // *consecutive* blocked hits.
      source.blockStreak = 0;
    }
    dmg = Math.round(dmg * 10) / 10;
  }
  if (blocked) { kbX = 0; kbZ = 0; kbY = 0; }
  if (dmg <= 0) {
    if (blocked) io.emit('effect', { kind: 'block', x: victim.x, y: victim.y + 1.2, z: victim.z });
    return;
  }
  // The actual amount about to come off health+absorption combined - after
  // armor/shield-block, unlike the raw `amount` parameter - is what the
  // attacker's hitmarker/damage-number display should show.
  const dealtAmount = dmg;
  if (victim.absorption > 0) {
    const used = Math.min(victim.absorption, dmg);
    victim.absorption -= used;
    dmg -= used;
  }
  victim.health = Math.max(0, victim.health - dmg);
  victim.lastDamage = t;
  if (blocked) io.emit('effect', { kind: 'block', x: victim.x, y: victim.y + 1.2, z: victim.z });

  // Wolf loyalty: any wolves owned by the victim redirect to whoever just
  // hurt them, same "defend your owner" behavior as vanilla tamed wolves -
  // skipped for self-inflicted/environmental damage (no source) and for a
  // hit that came from the victim's own wolf (no infinite retarget loop).
  if (source && source.id !== victim.id && wolves.size) {
    for (const w of wolves.values()) {
      if (w.ownerId === victim.id && Math.hypot(source.x - victim.x, source.z - victim.z) <= C.WOLF_LOYALTY_RANGE) {
        w.targetId = source.id;
      }
    }
  }

  const kb = { x: kbX || 0, y: kbY === undefined ? 0.42 : kbY, z: kbZ || 0 };
  // Knockback Resistance (netherite's knockbackResist) - applies to every
  // hit regardless of cause, unlike Blast Protection above which is
  // explosive-only.
  const kbResist = (MC.ARMOR_TIERS[victim.armorTier] || {}).knockbackResist;
  if (kbResist) { kb.x *= (1 - kbResist); kb.z *= (1 - kbResist); kb.y *= (1 - kbResist); }
  // Don't add upward knockback to a target that's already airborne: during a
  // multi-attacker brawl, hits land faster than gravity can cancel the last
  // launch, so repeatedly refreshing vy upward causes an unbounded climb
  // (looks exactly like flying). Only pop targets that are on the ground.
  if (!victim.onGround) kb.y = 0;
  if (victim.socket) {
    victim.socket.emit('hurt', {
      health: victim.health, absorption: victim.absorption,
      amount, by: source ? source.id : null, byName: source ? source.name : null,
      cause, kb, blocked
    });
  } else if (victim.bot) {
    victim.vx += kb.x * 6; victim.vz += kb.z * 6;
    if (kb.y) victim.vy = Math.min(10, Math.max(victim.vy, kb.y * 9));
  }
  if (source && source.socket && source.id !== victim.id) {
    source.socket.emit('hitmarker', { id: victim.id, amount, dealt: dealtAmount, x: victim.x, y: victim.y, z: victim.z, health: victim.health });
  }
  io.emit('hp', { id: victim.id, health: victim.health, absorption: victim.absorption });

  // Thorns III: a chance to reflect part of a landed melee hit back at the
  // attacker. Its own 'thorns' cause isn't in the armor-reduction list above
  // (unarmored, magic-flavoured damage, same as vanilla) and never re-rolls
  // itself, so this can't chain into an infinite loop even if both players
  // have it on.
  if (source && source.id !== victim.id && hasEnchant(victim, 'armor', 'thorns') &&
      (cause === 'sword' || cause === 'axe' || cause === 'mace' || cause === 'spear' || cause === 'trident' || cause === 'stick') &&
      Math.random() < C.THORNS_PROC_CHANCE) {
    applyDamage(source, rand(C.THORNS_DMG_MIN, C.THORNS_DMG_MAX), victim, 'thorns', 0, 0, 0);
  }

  // Totem of Undying: a hit that would kill you is caught instead, if
  // you have one equipped in your offhand (drag it there in the inventory
  // screen) - just owning one isn't enough, same as vanilla. Doesn't save
  // you from the void either.
  if (victim.health <= 0 && cause !== 'void' && cause !== 'kill257' && victim.offhandKey === 'totem' && (victim.ammo.totem || 0) > 0) {
    victim.ammo.totem--;
    victim.health = C.TOTEM_HEALTH;
    victim.absorption = 0;
    victim.effects.regeneration = { level: C.TOTEM_REGEN_LEVEL, until: t + C.TOTEM_REGEN_SECONDS };
    victim.effects.resistance = { level: C.TOTEM_RESIST_LEVEL, until: t + C.TOTEM_RESIST_SECONDS };
    victim.effects.fireResistance = { level: 1, until: t + C.TOTEM_FIRE_RES_SECONDS };
    if (victim.socket) {
      victim.socket.emit('heal', { health: victim.health, absorption: victim.absorption, ammo: victim.ammo });
      victim.socket.emit('effects', effectsSnapshot(victim, t));
    }
    io.emit('hp', { id: victim.id, health: victim.health, absorption: victim.absorption });
    io.emit('effect', { kind: 'totem', x: victim.x, y: victim.y + 1, z: victim.z });
    return;
  }

  if (victim.health <= 0) kill(victim, source, cause);
}

function kill(victim, source, cause) {
  victim.alive = false;
  victim.deaths++;
  victim.streak = 0;
  victim.respawnAt = now() + (victim.dummy ? 1 : C.RESPAWN_TIME);
  victim.vx = victim.vy = victim.vz = 0;
  if (source && source.id !== victim.id) {
    source.kills++;
    source.streak++;
    // reward: top up the killer a bit, classic kit-pvp style - applies to
    // bots too, not just human players (kill() doesn't distinguish source.bot).
    // Ammo restock is deliberately uncapped - every single kill adds half of
    // a full stack, even past the amount you spawn with, so a kill streak
    // can stockpile well beyond the default loadout (e.g. 100+ golden apples
    // eventually). Health still caps at max, since more-than-full health
    // isn't a meaningful reward.
    // Looting III: a kill landed with the sword (and only the sword, same as
    // vanilla's "the weapon that dealt the killing blow") multiplies the
    // whole restock below - simulated as bonus ammo since this game has no
    // physical item drops to multiply.
    // The shop's Loot Haul upgrade stacks on top of Looting, so a kill can
    // restock several times what it used to for someone who's invested in it.
    const lootMult = (cause === 'sword' && hasEnchant(source, 'sword', 'looting') ? C.LOOTING_KILL_MULT : 1)
      * MC.shopEffect('loot', source.upgrades && source.upgrades.loot);
    // Coins for the shop - a flat bounty plus a little more the longer the
    // killer's current streak is running.
    awardCoins(source, Math.round(MC.SHOP.COIN_PER_KILL + MC.SHOP.COIN_KILL_STREAK_BONUS * Math.max(0, source.streak - 1)));
    source.health = Math.min(C.MAX_HEALTH, source.health + 4);
    // Floored at the end rather than per-factor: Loot Haul's multiplier is
    // fractional, and fractional ammo counts leak into the HUD as 7.5 arrows.
    const lootAdd = n => Math.floor(n * lootMult);
    source.ammo.arrow += lootAdd(Math.floor(C.ARROW_AMMO / 2));
    source.ammo.pearl += lootAdd(Math.floor(ITEM_BY_KEY.pearl.ammo / 2));
    source.ammo.gapple += lootAdd(Math.floor(ITEM_BY_KEY.gapple.ammo / 2));
    source.ammo.windcharge += lootAdd(Math.floor(ITEM_BY_KEY.windcharge.ammo / 2));
    // Every potion in the killer's own loadout restocks a flat few, same
    // "keep the fight going" idea as the ammo above - only for potions they
    // actually have access to, not every potion that exists.
    for (const key of POTION_KEYS) {
      if (playerHasItem(source, key)) source.ammo[key] = (source.ammo[key] || 0) + lootAdd(C.POTION_KILL_RESTOCK);
    }
    // Water/lava buckets and TNT/TNT Minecart restock the same "half a
    // fresh stack" way as arrow/pearl/gapple/windcharge above, just gated on
    // actually having them in the loadout (web-kit only, same as potions).
    for (const key of ['water_bucket', 'lava_bucket', 'tnt', 'tnt_minecart']) {
      if (playerHasItem(source, key)) source.ammo[key] = (source.ammo[key] || 0) + lootAdd(Math.floor(ITEM_BY_KEY[key].ammo / 2));
    }
    // 1 guaranteed per kill, with a chance of 2-3 instead once Looting (or
    // the shop's Loot Haul) is in play - these stay scarce even so, unlike
    // the flat half-stack restocks above. See KILL_BONUS_ITEMS.
    for (const key of KILL_BONUS_ITEMS) {
      if (!playerHasItem(source, key)) continue;
      let amount = 1;
      if (lootMult > 1 && Math.random() < C.LOOT_BONUS_CHANCE) amount = Math.floor(rand(C.LOOT_BONUS_MIN, C.LOOT_BONUS_MAX + 1));
      source.ammo[key] = (source.ammo[key] || 0) + amount;
    }
    // Firework Rockets restock a flat amount per kill, no Looting scaling.
    if (playerHasItem(source, 'firework')) source.ammo.firework = (source.ammo.firework || 0) + C.FIREWORK_KILL_RESTOCK;
    if (source.socket) source.socket.emit('killreward', { health: source.health, ammo: source.ammo, streak: source.streak });
  }
  io.emit('death', {
    victim: victim.id, victimName: victim.name,
    killer: source && source.id !== victim.id ? source.id : null,
    killerName: source && source.id !== victim.id ? source.name : null,
    cause, streak: source ? source.streak : 0
  });
  // A cosmetic-only strike (no damage) marking where they fell - just the
  // spectacle, not a hazard for whoever's standing nearby.
  strikeLightning(victim.x, victim.y + 1, victim.z, null, false);
  broadcastScores();
}

/** Ray vs player AABBs. Returns the closest hit player, or null. */
function raycastPlayers(ox, oy, oz, dx, dy, dz, maxDist, exclude) {
  let best = null, bestT = maxDist;
  for (const p of players.values()) {
    if (!p.alive || (exclude && p.id === exclude.id)) continue;
    // Generous margin over the visual hitbox: a razor-thin collision box
    // against a moving target plus real aiming/network latency makes arrows
    // whiff constantly even when a shot looks like it should land.
    const r = MC.PHYS.WIDTH / 2 + 0.35;
    const hit = rayBox(ox, oy, oz, dx, dy, dz,
      p.x - r, p.y, p.z - r, p.x + r, p.y + MC.PHYS.HEIGHT, p.z + r);
    if (hit !== null && hit < bestT) { bestT = hit; best = p; }
  }
  return best ? { player: best, dist: bestT } : null;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function spawnProjectile(owner, kind, ox, oy, oz, dx, dy, dz, power, meta) {
  const speed = kind === 'pearl' ? C.PEARL_SPEED : kind === 'windcharge' ? C.WINDCHARGE_SPEED : kind === 'potion' ? C.POTION_SPEED : kind === 'firework' ? C.FIREWORK_SPEED : C.ARROW_SPEED * (0.35 + 0.65 * power);
  const pr = Object.assign({
    id: nextProjectileId++,
    kind, owner: owner.id,
    x: ox, y: oy, z: oz,
    vx: dx * speed, vy: dy * speed, vz: dz * speed,
    power, born: now(), life: kind === 'pearl' ? 8 : kind === 'windcharge' ? 6 : kind === 'potion' ? 8 : kind === 'firework' ? 6 : 12
  }, meta);
  projectiles.push(pr);
  // `meta` (currently just potionKey, for the client to tint the splash
  // bottle the right colour) rides along on the spawn broadcast too.
  io.emit('projectile', Object.assign({ id: pr.id, kind, x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz, owner: pr.owner }, meta));
  return pr;
}

/** Wind charge + ender pearl combo: instead of exploding, a wind charge that
 * touches a pearl still in flight instantly pulls its owner to that pearl's
 * current position, consuming both projectiles. */
function windchargePearlCombo(chargePr, pearlPr) {
  const thrower = players.get(chargePr.owner);
  if (thrower && thrower.alive) {
    let ty = Math.floor(pearlPr.y);
    for (let i = 0; i < 6; i++) {
      if (!MC.SOLID[getBlock(Math.floor(pearlPr.x), ty, Math.floor(pearlPr.z))] &&
          !MC.SOLID[getBlock(Math.floor(pearlPr.x), ty + 1, Math.floor(pearlPr.z))]) break;
      ty++;
    }
    thrower.x = clamp(pearlPr.x, 1, W.SX - 1);
    thrower.y = clamp(ty, 1, W.SY - 3);
    thrower.z = clamp(pearlPr.z, 1, W.SZ - 1);
    thrower.vx = thrower.vy = thrower.vz = 0;
    thrower.fallFrom = null;
    if (thrower.socket) thrower.socket.emit('teleport', { x: thrower.x, y: thrower.y, z: thrower.z });
    io.emit('effect', { kind: 'pearl', x: thrower.x, y: thrower.y, z: thrower.z });
  }
  io.emit('projectileGone', { id: pearlPr.id });
  io.emit('projectileGone', { id: chargePr.id, x: chargePr.x, y: chargePr.y, z: chargePr.z, hit: true });
  pearlPr._consumed = true;
}

/** Wind charge explosion: no direct-hit damage worth mentioning, just a
 * strong shove away from (and slightly up from) the impact point - vanilla's
 * wind charge blast. Doesn't affect the thrower (they already got their
 * guaranteed launch the instant they threw it, see the 'shoot' handler). */
function explodeWindcharge(ownerId, x, y, z) {
  const owner = players.get(ownerId) || null;
  for (const p of players.values()) {
    if (!p.alive || p.id === ownerId) continue;
    const dx = p.x - x, dz = p.z - z, dy = (p.y + 0.9) - y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > C.WINDCHARGE_BLAST_RADIUS) continue;
    const falloff = 1 - dist / C.WINDCHARGE_BLAST_RADIUS;
    const l = Math.hypot(dx, dz) || 1;
    const kbX = (dx / l) * falloff * C.WINDCHARGE_BLAST_KB;
    const kbZ = (dz / l) * falloff * C.WINDCHARGE_BLAST_KB;
    const kbY = 0.35 + falloff * 0.75;
    applyDamage(p, 1, owner, 'windcharge', kbX, kbZ, kbY);
  }
  io.emit('effect', { kind: 'windburst', x, y, z });
}

/** Firework Rocket explosion: same falloff shape as the wind charge blast
 * above, meaningfully more damage/knockback, no block clearing (it's a
 * flashy sky explosive, not a demolition charge like TNT). Includes the
 * owner in range too - a bad firework throw can hurt the thrower. */
function explodeFirework(ownerId, x, y, z) {
  const owner = players.get(ownerId) || null;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - x, dz = p.z - z, dy = (p.y + 0.9) - y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > C.FIREWORK_BLAST_RADIUS) continue;
    const falloff = 1 - dist / C.FIREWORK_BLAST_RADIUS;
    const l = Math.hypot(dx, dz) || 1;
    const kbX = (dx / l) * falloff * C.FIREWORK_BLAST_KB;
    const kbZ = (dz / l) * falloff * C.FIREWORK_BLAST_KB;
    const kbY = 0.4 + falloff * 0.8;
    applyDamage(p, Math.round(C.FIREWORK_BLAST_DMG * falloff), owner, 'firework', kbX, kbZ, kbY);
  }
  io.emit('effect', { kind: 'firework', x, y, z });
}

/** TNT / TNT Minecart explosion: damages/knocks back every alive player in
 * range (falloff by distance, same shape as the wind charge blast above)
 * and clears blocks in a rough sphere - never bedrock, never past the
 * world's edges. `ownerId` is whoever lit the fuse, purely for the kill
 * feed/attribution; friendly fire applies same as every other weapon here. */
function explodeTNT(x, y, z, radius, dmg, kb, ownerId) {
  const owner = players.get(ownerId) || null;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - x, dz = p.z - z, dy = (p.y + 0.9) - y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > radius) continue;
    const falloff = 1 - dist / radius;
    const l = Math.hypot(dx, dz) || 1;
    const kbX = (dx / l) * falloff * kb;
    const kbZ = (dz / l) * falloff * kb;
    const kbY = 0.4 + falloff * 0.9;
    applyDamage(p, Math.round(dmg * falloff), owner, 'tnt', kbX, kbZ, kbY);
  }
  const r = Math.ceil(radius);
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  for (let by = -r; by <= r; by++) {
    for (let bz = -r; bz <= r; bz++) {
      for (let bx = -r; bx <= r; bx++) {
        if (Math.hypot(bx, by, bz) > radius) continue;
        const wx = cx + bx, wy = cy + by, wz = cz + bz;
        if (!inBounds(wx, wy, wz)) continue;
        const cur = getBlock(wx, wy, wz);
        if (cur === ID.AIR || MC.HARDNESS[cur] < 0) continue;
        if (setBlock(wx, wy, wz, ID.AIR)) io.emit('block', { x: wx, y: wy, z: wz, id: ID.AIR, by: ownerId });
      }
    }
  }
  io.emit('effect', { kind: 'explosion', x, y, z, radius });
}

/** End Crystal: hit it (melee or a projectile) to detonate - huge damage to
 * anyone at or above its own height, just a couple hearts to anyone below
 * it (simplified vanilla-style height exposure, not true line-of-sight
 * raycasting). The obsidian it was resting on is spared, same as vanilla,
 * so another crystal can go right back up on the same spot. */
function detonateEndCrystal(x, y, z, ownerId) {
  const owner = players.get(ownerId) || null;
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - cx, dz = p.z - cz, dy = (p.y + 0.9) - cy;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > C.CRYSTAL_BLAST_RADIUS) continue;
    const falloff = 1 - dist / C.CRYSTAL_BLAST_RADIUS;
    const l = Math.hypot(dx, dz) || 1;
    const kbX = (dx / l) * falloff * C.CRYSTAL_BLAST_KB;
    const kbZ = (dz / l) * falloff * C.CRYSTAL_BLAST_KB;
    const kbY = 0.5 + falloff * 1.2;
    const dmg = (p.y + 0.9) >= cy ? Math.round(C.CRYSTAL_BLAST_DMG_MAX * falloff) : C.CRYSTAL_BLAST_DMG_BELOW;
    applyDamage(p, dmg, owner, 'crystal', kbX, kbZ, kbY);
  }
  const r = Math.ceil(C.CRYSTAL_BLAST_RADIUS);
  const bx0 = Math.floor(x), by0 = Math.floor(y), bz0 = Math.floor(z);
  for (let by = -r; by <= r; by++) {
    for (let bz = -r; bz <= r; bz++) {
      for (let bxx = -r; bxx <= r; bxx++) {
        if (Math.hypot(bxx, by, bz) > C.CRYSTAL_BLAST_RADIUS) continue;
        const wx = bx0 + bxx, wy = by0 + by, wz = bz0 + bz;
        if (!inBounds(wx, wy, wz)) continue;
        if (by === -1 && bxx === 0 && bz === 0) continue; // spare the obsidian it stood on
        const cur = getBlock(wx, wy, wz);
        if (cur === ID.AIR || MC.HARDNESS[cur] < 0) continue;
        if (setBlock(wx, wy, wz, ID.AIR)) io.emit('block', { x: wx, y: wy, z: wz, id: ID.AIR, by: ownerId });
      }
    }
  }
  io.emit('effect', { kind: 'crystal', x: cx, y: cy, z: cz, radius: C.CRYSTAL_BLAST_RADIUS });
}

/** Respawn Anchor: charges 1 at a time with glowstone (see the
 * 'chargeAnchor' handler) - reaching COMBAT.ANCHOR_MAX_CHARGES detonates it
 * immediately, the biggest blast in the game. */
function detonateAnchor(x, y, z, ownerId) {
  const owner = players.get(ownerId) || null;
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - cx, dz = p.z - cz, dy = (p.y + 0.9) - cy;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > C.ANCHOR_BLAST_RADIUS) continue;
    const falloff = 1 - dist / C.ANCHOR_BLAST_RADIUS;
    const l = Math.hypot(dx, dz) || 1;
    const kbX = (dx / l) * falloff * C.ANCHOR_BLAST_KB;
    const kbZ = (dz / l) * falloff * C.ANCHOR_BLAST_KB;
    const kbY = 0.5 + falloff * 1.4;
    applyDamage(p, Math.round(C.ANCHOR_BLAST_DMG * falloff), owner, 'anchor', kbX, kbZ, kbY);
  }
  const r = Math.ceil(C.ANCHOR_BLAST_RADIUS);
  const bx0 = Math.floor(x), by0 = Math.floor(y), bz0 = Math.floor(z);
  for (let by = -r; by <= r; by++) {
    for (let bz = -r; bz <= r; bz++) {
      for (let bxx = -r; bxx <= r; bxx++) {
        if (Math.hypot(bxx, by, bz) > C.ANCHOR_BLAST_RADIUS) continue;
        const wx = bx0 + bxx, wy = by0 + by, wz = bz0 + bz;
        if (!inBounds(wx, wy, wz)) continue;
        const cur = getBlock(wx, wy, wz);
        if (cur === ID.AIR || MC.HARDNESS[cur] < 0) continue;
        if (setBlock(wx, wy, wz, ID.AIR)) io.emit('block', { x: wx, y: wy, z: wz, id: ID.AIR, by: ownerId });
      }
    }
  }
  anchorCharges.delete(x + ',' + y + ',' + z);
  io.emit('effect', { kind: 'anchor', x: cx, y: cy, z: cz, radius: C.ANCHOR_BLAST_RADIUS });
}

/** Lights a placed TNT/TNT Minecart block's fuse - shared by the flint and
 * steel 'ignite' handler and a landed Flame bow/burning arrow hit. No-op if
 * that block isn't actually TNT, or is already lit. */
function igniteTNTBlock(x, y, z, ownerId) {
  const block = getBlock(x, y, z);
  if (block !== ID.TNT && block !== ID.TNT_MINECART) return false;
  if (liveTNT.some(t => t.x === x && t.y === y && t.z === z)) return false;
  const minecart = block === ID.TNT_MINECART;
  liveTNT.push({
    x, y, z,
    explodeAt: now() + (minecart ? C.TNT_MINECART_FUSE_SECONDS : C.TNT_FUSE_SECONDS),
    radius: minecart ? C.TNT_MINECART_BLAST_RADIUS : C.TNT_BLAST_RADIUS,
    dmg: minecart ? C.TNT_MINECART_BLAST_DMG : C.TNT_BLAST_DMG,
    kb: minecart ? C.TNT_MINECART_BLAST_KB : C.TNT_BLAST_KB,
    ownerId
  });
  io.emit('effect', { kind: 'fuse', x: x + 0.5, y: y + 1, z: z + 0.5 });
  return true;
}

/** Flint and steel on anything that isn't TNT: a temporary burning patch in
 * the empty space directly above that block - see the groundFires
 * damage/ignite tick and the arrow burning check, both in
 * tick()/stepProjectiles. `x,y,z` is the solid block that got hit; the fire
 * itself lives one cell higher, where a player would actually stand in it. */
function lightGroundFire(x, y, z) {
  const fy = y + 1;
  groundFires.push({ x, y: fy, z, until: now() + C.GROUND_FIRE_SECONDS });
  io.emit('effect', { kind: 'groundfire', x: x + 0.5, y: fy + 0.2, z: z + 0.5, duration: C.GROUND_FIRE_SECONDS });
}

/** A lightning strike at (x,y,z) - always broadcasts the visual/sound, and
 * when `dealDamage` is true also hurts and ignites anyone within
 * LIGHTNING_STRIKE_RADIUS (bypasses armor, same as fire/lava/fall - it's an
 * environmental hazard, not a combat hit) and lights a couple of nearby
 * ground tiles on fire. Used for weather's random strikes and a Channeling
 * trident hit (both damaging); the cosmetic strike at a death location
 * passes dealDamage=false - just the spectacle, no punishing a bystander. */
function strikeLightning(x, y, z, ownerId, dealDamage) {
  if (dealDamage) {
    const owner = ownerId ? players.get(ownerId) : null;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (dist > C.LIGHTNING_STRIKE_RADIUS) continue;
      applyDamage(p, C.LIGHTNING_STRIKE_DMG, owner, 'lightning', 0, 0, 0.3);
      ignitePlayer(p, now());
    }
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let i = 0; i < 3; i++) {
      const fx = bx + (rand(-1, 2) | 0), fz = bz + (rand(-1, 2) | 0), fy2 = Math.floor(y) - 1;
      if (inBounds(fx, fy2, fz) && MC.SOLID[getBlock(fx, fy2, fz)]) lightGroundFire(fx, fy2, fz);
    }
  }
  io.emit('effect', { kind: 'lightning', x, y, z });
}

function stepProjectiles(dt) {
  const g = { arrow: C.ARROW_GRAVITY, pearl: C.PEARL_GRAVITY, windcharge: C.WINDCHARGE_GRAVITY, potion: C.POTION_GRAVITY, trident: C.TRIDENT_GRAVITY, firework: C.FIREWORK_GRAVITY };
  const alive = [];
  const t = now();
  for (const pr of projectiles) {
    if (pr._consumed) continue;
    if (t - pr.born > pr.life) { io.emit('projectileGone', { id: pr.id }); continue; }
    let removed = false;
    const steps = 4;
    const h = dt / steps;
    for (let s = 0; s < steps && !removed; s++) {
      pr.vy -= g[pr.kind] * h;
      const nx = pr.x + pr.vx * h, ny = pr.y + pr.vy * h, nz = pr.z + pr.vz * h;
      // An arrow that flies through a flint-and-steel ground fire catches
      // fire itself - it'll ignite whatever it hits next, same as a Flame
      // bow shot, regardless of whether the shooter actually has Flame on.
      if (pr.kind === 'arrow' && !pr.burning && groundFires.length) {
        const ax = Math.floor(nx), ay = Math.floor(ny), az = Math.floor(nz);
        if (groundFires.some(f => f.x === ax && f.y === ay && f.z === az)) pr.burning = true;
      }
      // wind charge <-> ender pearl mid-air combo (checked before any other
      // collision so a charge racing toward a pearl doesn't explode on
      // terrain first)
      if (pr.kind === 'windcharge') {
        let combo = null;
        for (const other of projectiles) {
          if (other === pr || other._consumed || other.kind !== 'pearl') continue;
          if (Math.hypot(nx - other.x, ny - other.y, nz - other.z) < C.WINDCHARGE_PEARL_COMBO_RADIUS) { combo = other; break; }
        }
        if (combo) { windchargePearlCombo(pr, combo); removed = true; break; }
      }
      // player hit
      const len = Math.hypot(nx - pr.x, ny - pr.y, nz - pr.z);
      if (len > 1e-6) {
        const owner = players.get(pr.owner);
        const hit = raycastPlayers(pr.x, pr.y, pr.z, (nx - pr.x) / len, (ny - pr.y) / len, (nz - pr.z) / len, len,
          t - pr.born < 0.12 ? owner : null);
        if (hit) {
          if (pr.kind === 'arrow') {
            // weaponKey distinguishes a plain bow shot from a crossbow bolt
            // (see spawnProjectile's meta) - each uses its own damage range,
            // and only the bow's own enchants (Power/Punch/Flame) apply to
            // a bow shot specifically, not a crossbow bolt.
            const weaponItem = ITEM_BY_KEY[pr.weaponKey] || MC.ITEMS[1];
            const isBowShot = weaponItem.key === 'bow';
            let dmg = weaponItem.minDamage + (weaponItem.maxDamage - weaponItem.minDamage) * pr.power;
            if (isBowShot && owner && hasEnchant(owner, 'bow', 'power')) dmg += C.POWER_DMG_BONUS;
            if (owner && owner.bot) dmg *= botDamageMult(owner);
            const hx = pr.vx, hz = pr.vz;
            const hl = Math.hypot(hx, hz) || 1;
            // Bow boosting: this same arrow hitting its own shooter (only
            // possible after the 0.12s self-hit grace period above) is a
            // deliberate mobility trick, not incidental damage - give it a
            // real forward+upward shove instead of the ordinary hit's kb.
            const isSelfHit = owner && hit.player.id === owner.id;
            let kbMul = isSelfHit ? C.BOW_BOOST_KB_MULT : 0.5;
            if (isBowShot && owner && hasEnchant(owner, 'bow', 'punch')) kbMul += C.PUNCH_ENCHANT_ADD;
            applyDamage(hit.player, Math.round(dmg), owner, 'arrow', (hx / hl) * kbMul, (hz / hl) * kbMul, isSelfHit ? C.BOW_BOOST_KB_Y : 0.36);
            if (pr.burning || (isBowShot && owner && hasEnchant(owner, 'bow', 'flame'))) ignitePlayer(hit.player, t);
            if (owner && owner.socket) owner.socket.emit('arrowHit', { id: hit.player.id, dist: Math.hypot(hit.player.x - owner.x, hit.player.z - owner.z) });
          } else if (pr.kind === 'pearl') {
            teleportPearl(pr, nx, ny, nz);
          } else if (pr.kind === 'potion') {
            splashPotion(pr, nx, ny, nz);
          } else if (pr.kind === 'trident') {
            // Channeling only does anything during an active thunderstorm,
            // same restriction as vanilla - a landed hit calls down a real
            // lightning strike on top of the normal throw damage.
            const channeling = owner && hasEnchant(owner, 'trident', 'channeling') && weather === 'thunder';
            const dmg0 = C.TRIDENT_THROW_DAMAGE +
              (owner && hasEnchant(owner, 'trident', 'impaling') && isInWater(hit.player) ? C.TRIDENT_IMPALING_BONUS_DMG : 0) +
              (channeling ? C.LIGHTNING_BONUS_DMG : 0);
            const kbMul = channeling ? C.TRIDENT_CHANNELING_KB : 0.6;
            const hx = pr.vx, hz = pr.vz, hl = Math.hypot(hx, hz) || 1;
            applyDamage(hit.player, dmg0, owner, 'trident', (hx / hl) * kbMul, (hz / hl) * kbMul, 0.5);
            if (channeling) strikeLightning(hit.player.x, hit.player.y + 1, hit.player.z, owner ? owner.id : null, true);
          } else if (pr.kind === 'firework') {
            explodeFirework(pr.owner, nx, ny, nz);
          } else {
            explodeWindcharge(pr.owner, nx, ny, nz);
          }
          io.emit('projectileGone', { id: pr.id, x: nx, y: ny, z: nz, hit: true });
          removed = true;
          break;
        }
      }
      // world hit
      const worldBlock = getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (MC.SOLID[worldBlock] || worldBlock === ID.END_CRYSTAL) {
        if (worldBlock === ID.END_CRYSTAL) {
          // Non-solid, but any projectile hitting it (arrow, trident, etc.)
          // detonates it same as a melee hit would.
          const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
          if (setBlock(bx, by, bz, ID.AIR)) io.emit('block', { x: bx, y: by, z: bz, id: ID.AIR, by: pr.owner });
          detonateEndCrystal(bx, by, bz, pr.owner);
        } else if (pr.kind === 'pearl') teleportPearl(pr, pr.x, pr.y, pr.z);
        else if (pr.kind === 'windcharge') explodeWindcharge(pr.owner, pr.x, pr.y, pr.z);
        else if (pr.kind === 'firework') explodeFirework(pr.owner, pr.x, pr.y, pr.z);
        else if (pr.kind === 'potion') splashPotion(pr, pr.x, pr.y, pr.z);
        else if (pr.kind === 'arrow') {
          // A Flame bow shot (or an arrow that flew through a ground fire)
          // lands on TNT/TNT Minecart -> lights its fuse, same as flint and
          // steel would.
          const owner = players.get(pr.owner);
          const weaponItem = ITEM_BY_KEY[pr.weaponKey] || MC.ITEMS[1];
          const flameShot = pr.burning || (weaponItem.key === 'bow' && owner && hasEnchant(owner, 'bow', 'flame'));
          if (flameShot) igniteTNTBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz), pr.owner);
        }
        io.emit('projectileGone', { id: pr.id, x: pr.x, y: pr.y, z: pr.z, hit: true });
        removed = true;
        break;
      }
      if (nx < 0 || nz < 0 || nx > W.SX || nz > W.SZ || ny < 0 || ny > W.SY) {
        io.emit('projectileGone', { id: pr.id });
        removed = true;
        break;
      }
      pr.x = nx; pr.y = ny; pr.z = nz;
    }
    if (!removed) alive.push(pr);
  }
  projectiles = alive.filter(p => !p._consumed);
}

/** Splash potion: applies its effect to every alive player within
 * COMBAT.POTION_SPLASH_RADIUS of the impact point, thrower included - the
 * only way to self-buff instantly is to throw one at your own feet. */
function splashPotion(pr, x, y, z) {
  const item = ITEM_BY_KEY[pr.potionKey];
  if (!item) return;
  const t = now();
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - x, (p.y + 0.9) - y, p.z - z);
    if (dist > C.POTION_SPLASH_RADIUS) continue;
    applyPotionEffect(p, item, t);
    if (p.socket) p.socket.emit('effects', effectsSnapshot(p, t));
  }
  io.emit('effect', { kind: 'drink', potionKey: pr.potionKey, x, y, z });
}

function teleportPearl(pr, x, y, z) {
  const owner = players.get(pr.owner);
  if (!owner || !owner.alive) return;
  // find a safe standing spot near the impact
  let ty = Math.floor(y);
  for (let i = 0; i < 6; i++) {
    if (!MC.SOLID[getBlock(Math.floor(x), ty, Math.floor(z))] &&
        !MC.SOLID[getBlock(Math.floor(x), ty + 1, Math.floor(z))]) break;
    ty++;
  }
  owner.x = clamp(x, 1, W.SX - 1);
  owner.y = clamp(ty, 1, W.SY - 3);
  owner.z = clamp(z, 1, W.SZ - 1);
  owner.vx = owner.vy = owner.vz = 0;
  owner.fallFrom = null;
  if (owner.socket) owner.socket.emit('teleport', { x: owner.x, y: owner.y, z: owner.z });
  applyDamage(owner, 2, null, 'pearl', 0, 0, 0);
  io.emit('effect', { kind: 'pearl', x: owner.x, y: owner.y, z: owner.z });
}

// ------------------------------------------------------------------ bots ---
function addBot(difficulty, armorTier, kit, weaponMode) {
  const id = 'bot' + (nextBotId++);
  const name = pick(BOT_NAMES) + (Math.random() < 0.5 ? '' : (10 + ((Math.random() * 89) | 0)));
  const diff = DIFFICULTY[difficulty] ? difficulty : defaultDifficulty;
  const armor = MC.ARMOR_TIERS[armorTier] ? armorTier : defaultBotArmor;
  const botKit = MC.KITS[kit] ? kit : defaultBotKit;
  const p = makePlayer(id, name, true, armor, botKit);
  p.difficulty = diff;
  p.skill = rollSkill(diff);
  p.weaponMode = WEAPON_MODES.includes(weaponMode) ? weaponMode : defaultBotWeaponMode;
  p.meleeWeapon = pickBotWeapon(p.kit);
  p.slot = BOT_WEAPONS[p.meleeWeapon].slot;
  p.bonusItem = rollBonusItem();
  if (p.bonusItem === 'elytra_firework') p.chestSlot = 'elytra';
  players.set(id, p);
  io.emit('playerJoin', publicPlayer(p));
  broadcastScores();
  return p;
}

function setBotDifficulty(bot, key) {
  if (!DIFFICULTY[key]) return false;
  bot.difficulty = key;
  bot.skill = rollSkill(key);
  return true;
}

function setBotArmor(bot, key) {
  if (!MC.ARMOR_TIERS[key]) return false;
  bot.armorTier = key;
  return true;
}

function setBotKit(bot, key) {
  if (!MC.KITS[key]) return false;
  bot.kit = key;
  // Drop a now-illegal axe back to the sword immediately, rather than
  // waiting for its next melee swing to notice.
  if (bot.meleeWeapon === 'axe' && !MC.kitHasItem(key, 'axe')) {
    bot.meleeWeapon = 'sword';
    bot.slot = BOT_WEAPONS.sword.slot;
  }
  return true;
}

function setBotWeaponMode(bot, key) {
  if (!WEAPON_MODES.includes(key)) return false;
  bot.weaponMode = key;
  return true;
}

function removeBot() {
  for (const p of players.values()) {
    if (p.bot && !p.dummy) {
      players.delete(p.id);
      io.emit('playerLeave', { id: p.id });
      broadcastScores();
      return true;
    }
  }
  return false;
}

// A stationary target that never moves or attacks - purely for testing that
// hits/damage register. Always respawns at the exact spot it was placed.
function addDummy(shieldEnabled) {
  const id = 'dummy' + (nextBotId++);
  const existing = [...players.values()].filter(p => p.dummy && !p.attackDummy).length;
  const name = existing === 0 ? 'Training Dummy' : 'Training Dummy ' + (existing + 1);
  // Full diamond/Protection IV like the player, so it actually soaks hits
  // like a real opponent instead of dying to any old poke.
  const p = makePlayer(id, name, true, 'diamond');
  p.dummy = true;
  p.difficulty = null;
  p.home = { x: p.x, y: p.y, z: p.z };
  // Holds a shield up by default - since a passive dummy's AI never runs,
  // whatever we set here just stays put forever, no per-tick logic needed.
  p.blocking = shieldEnabled !== false;
  players.set(id, p);
  io.emit('playerJoin', publicPlayer(p));
  broadcastScores();
  return p;
}

function removeDummy() {
  for (const p of players.values()) {
    if (p.dummy && !p.attackDummy) {
      players.delete(p.id);
      io.emit('playerLeave', { id: p.id });
      broadcastScores();
      return true;
    }
  }
  return false;
}

// Stands its ground facing one fixed direction forever (never turns to
// track anyone) and only swings at whoever's standing in that direction
// within reach. Whatever melee weapon last hit it becomes the weapon it
// swings back with - hit it with an axe to test shield-stun, a sword to
// test plain blocking, etc.
function addAttackDummy() {
  const id = 'atkdummy' + (nextBotId++);
  const existing = [...players.values()].filter(p => p.attackDummy).length;
  const name = existing === 0 ? 'Attack Dummy' : 'Attack Dummy ' + (existing + 1);
  // Full diamond/Protection IV too, for the same reason as the training dummy.
  const p = makePlayer(id, name, true, 'diamond');
  p.dummy = true;
  p.attackDummy = true;
  p.difficulty = null;
  p.home = { x: p.x, y: p.y, z: p.z };
  p.fixedYaw = p.yaw;
  p.retaliateWeapon = 'sword';
  p.retaliateEnchants = null;
  players.set(id, p);
  io.emit('playerJoin', publicPlayer(p));
  broadcastScores();
  return p;
}

function removeAttackDummy() {
  for (const p of players.values()) {
    if (p.attackDummy) {
      players.delete(p.id);
      io.emit('playerLeave', { id: p.id });
      broadcastScores();
      return true;
    }
  }
  return false;
}

function nearestTarget(bot) {
  let best = null, bestD = 70;
  for (const p of players.values()) {
    if (p.id === bot.id || !p.alive || p.dummy) continue; // bots ignore dummies
    if (botsCooperate && p.bot) continue; // gang-up mode: bots only ever target the human player(s)
    if (now() - p.spawnAt < C.SPAWN_PROTECT) continue;
    const d = Math.hypot(p.x - bot.x, (p.y - bot.y) * 0.5, p.z - bot.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function lineOfSight(a, b) {
  const ox = a.x, oy = a.y + MC.PHYS.EYE, oz = a.z;
  const tx = b.x, ty = b.y + 1.2, tz = b.z;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len * 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (MC.SOLID[getBlock(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t))]) return false;
  }
  return true;
}

/**
 * Never turns, never chases - just swings at whatever's standing in its one
 * fixed direction within reach, using whichever melee weapon last landed on
 * it (see the retaliateWeapon tracking in applyDamage).
 */
function stepAttackDummy(bot, t) {
  bot.yaw = bot.fixedYaw;
  const fx = -Math.sin(bot.fixedYaw), fz = -Math.cos(bot.fixedYaw); // yaw 0 == -Z
  let target = null, bestD = C.REACH_ATTACK - 0.5;
  for (const p of players.values()) {
    if (p.id === bot.id || !p.alive || p.dummy) continue;
    if (t - p.spawnAt < C.SPAWN_PROTECT) continue;
    const dx = p.x - bot.x, dz = p.z - bot.z, dy = p.y - bot.y;
    const dist = Math.hypot(dx, dz);
    if (dist > bestD || Math.abs(dy) > 2.2) continue;
    if ((dx / (dist || 1)) * fx + (dz / (dist || 1)) * fz < 0.5) continue; // outside its one attack direction
    target = p; bestD = dist;
  }
  if (!target) return;
  const weapon = BOT_WEAPONS[bot.retaliateWeapon] || BOT_WEAPONS.sword;
  bot.slot = weapon.slot;
  if (t - bot.lastAttack > weapon.cooldown) {
    bot.lastAttack = t;
    io.emit('swing', { id: bot.id });
    const enchants = bot.retaliateEnchants;
    let dmg = weapon.damage, kbMul = 0.55;
    if (enchants) {
      if (enchants.sharpness) dmg += C.SHARPNESS_DMG_BONUS;
      if (weapon.key === 'sword' && enchants.knockback) kbMul += C.KNOCKBACK_ENCHANT_ADD;
    }
    const dx = target.x - bot.x, dz = target.z - bot.z, l = Math.hypot(dx, dz) || 1;
    applyDamage(target, dmg, bot, weapon.key, (dx / l) * kbMul, (dz / l) * kbMul, 0.42);
    if (weapon.key === 'sword' && enchants && enchants.fireAspect) ignitePlayer(target, t);
  }
}

/** Spawns a wolf a couple blocks in front of `owner`, loyal only to them
 * (see stepWolf/damageWolf below for what that actually means). hasArmor
 * is decided once at the owner's join (the menu's "Give wolves armor"
 * checkbox), not per-egg. */
function spawnWolf(owner, hasArmor) {
  const dir = ownerLookDir(owner);
  const id = 'wolf' + (nextWolfId++);
  const maxHealth = C.WOLF_HEALTH + (hasArmor ? C.WOLF_ARMOR_BONUS_HEALTH : 0);
  const wolf = {
    id, ownerId: owner.id, name: owner.name + "'s Wolf",
    x: owner.x + dir[0] * 2, y: owner.y, z: owner.z + dir[2] * 2,
    vx: 0, vy: 0, vz: 0, yaw: owner.yaw, pitch: 0, onGround: true,
    health: maxHealth, maxHealth, alive: true, hasArmor: !!hasArmor,
    targetId: null, lastAttack: 0, lastSeen: now()
  };
  wolves.set(id, wolf);
  io.emit('wolfSpawn', publicWolf(wolf));
  return wolf;
}

/** Look direction from yaw/pitch alone (no MC.PHYS.EYE offset needed here -
 * this only picks a spawn direction, not an eye-level raycast origin). Same
 * convention as game.js's _lookDir()/every other yaw-to-vector spot in this
 * file (yaw 0 == -Z). */
function ownerLookDir(p) {
  return [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
}

function publicWolf(w) {
  return { id: w.id, ownerId: w.ownerId, name: w.name, x: w.x, y: w.y, z: w.z, yaw: w.yaw, health: w.health, maxHealth: w.maxHealth, alive: w.alive, hasArmor: w.hasArmor };
}

/** Damages a wolf - deliberately simpler than applyDamage's full armor/
 * shield/enchant pipeline (a wolf has none of that), just Dog Armor's flat
 * reduction. Retaliation (see stepWolf) is handled by the caller, same as
 * a player's applyDamage callers already know who dealt the hit. */
function damageWolf(wolf, amount, source) {
  if (!wolf.alive || amount <= 0) return;
  const dmg = wolf.hasArmor ? amount * (1 - C.WOLF_ARMOR_DMG_REDUCTION) : amount;
  wolf.health = Math.max(0, wolf.health - dmg);
  io.emit('wolfHp', { id: wolf.id, health: wolf.health });
  if (wolf.health <= 0) {
    wolf.alive = false;
    io.emit('wolfDeath', { id: wolf.id });
    wolves.delete(wolf.id);
    return;
  }
  if (source && source.id !== wolf.ownerId) wolf.targetId = source.id;
}

function stepWolf(wolf, dt, t) {
  const owner = players.get(wolf.ownerId);
  if (!owner) { wolves.delete(wolf.id); io.emit('wolfDeath', { id: wolf.id }); return; }

  // A target stops being valid if it died, disconnected, is the wolf's own
  // owner (never happens through damageWolf's guard, but re-checked here in
  // case ownership context changes), or wandered out of the loyalty range.
  let target = wolf.targetId ? players.get(wolf.targetId) : null;
  if (target && (!target.alive || target.id === wolf.ownerId || Math.hypot(target.x - wolf.x, target.z - wolf.z) > C.WOLF_LOYALTY_RANGE)) {
    target = null; wolf.targetId = null;
  }

  const input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: wolf.yaw };

  if (target) {
    const dx = target.x - wolf.x, dz = target.z - wolf.z, dy = target.y - wolf.y;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    let diff = wantYaw - wolf.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    wolf.yaw += clamp(diff, -6 * dt, 6 * dt);
    if (dist > C.WOLF_ATTACK_REACH - 0.3) {
      input.forward = 1; input.sprint = true;
    } else if (t - wolf.lastAttack > C.WOLF_ATTACK_COOLDOWN && Math.abs(dy) < 2.2) {
      wolf.lastAttack = t;
      io.emit('swing', { id: wolf.id });
      const l = Math.hypot(dx, dz) || 1;
      // Passing the wolf itself as `source` (not null) keeps spawn
      // protection and the victim's-own-wolves-retaliate hook above both
      // working correctly - shieldBlocks()/withinFOV() only touch x/y/z/
      // yaw, which a wolf has same as any player.
      applyDamage(target, C.WOLF_DAMAGE, wolf, 'wolf', (dx / l) * 0.5, (dz / l) * 0.5, 0.36);
    }
  } else {
    // No target: follow the owner, same "close enough, just idle" rule as
    // a real pet rather than a bot that paces the exact same spot.
    const dx = owner.x - wolf.x, dz = owner.z - wolf.z;
    const dist = Math.hypot(dx, dz);
    if (dist > C.WOLF_FOLLOW_MAX_DIST) {
      // Fell too far behind (owner pearled/sprinted off) - reappear at
      // their side instead of visibly teleporting mid-view when possible.
      const dir = ownerLookDir(owner);
      wolf.x = owner.x - dir[0] * 2; wolf.y = owner.y; wolf.z = owner.z - dir[2] * 2;
      wolf.vx = wolf.vy = wolf.vz = 0;
      io.emit('wolfTeleport', { id: wolf.id, x: wolf.x, y: wolf.y, z: wolf.z });
    } else if (dist > C.WOLF_FOLLOW_MIN_DIST) {
      const wantYaw = Math.atan2(-dx, -dz);
      let diff = wantYaw - wolf.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      wolf.yaw += clamp(diff, -6 * dt, 6 * dt);
      input.forward = 1;
      input.sprint = dist > C.WOLF_FOLLOW_MIN_DIST * 2.5;
    }
  }

  input.yaw = wolf.yaw;
  Physics.step(getBlock, wolf, input, dt);
}

function stepBot(bot, dt, t) {
  if (!bot.alive) return;
  if (bot.dummy && !bot.attackDummy) return; // a training dummy never moves or fights back
  if (bot.attackDummy) { stepAttackDummy(bot, t); return; }
  const ai = bot.ai;
  let target = players.get(ai.target);
  if (!target || !target.alive || Math.hypot(target.x - bot.x, target.z - bot.z) > 75) {
    target = nearestTarget(bot);
    ai.target = target ? target.id : null;
  }

  const input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: bot.yaw };

  if (target) {
    const dx = target.x - bot.x, dz = target.z - bot.z, dy = target.y - bot.y;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz); // yaw 0 == -Z
    let diff = wantYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = (2.5 + bot.skill * 5) * dt;
    bot.yaw += clamp(diff, -turn, turn);
    bot.pitch = clamp(-Math.atan2(dy + 1.2 - MC.PHYS.EYE, Math.max(0.5, dist)), -1.4, 1.4);

    if (t > ai.nextStrafe) {
      ai.strafe = pick([-1, 0, 1, 1, -1]);
      ai.nextStrafe = t + rand(0.4, 1.3);
    }

    if (dist > 2.2) {
      input.forward = 1;
      input.sprint = dist > 5 && bot.skill > 0.45;
      input.strafe = ai.strafe * 0.5;
    } else {
      input.forward = 0.2;
      input.strafe = ai.strafe;
    }

    // jump over obstacles / to reach higher ground / combo jumping
    if (bot.blocked || (dy > 0.8 && dist < 4)) input.jump = true;
    if (dist < 3 && Math.random() < 0.02 + bot.skill * 0.03) input.jump = true;

    // versatile/full bots don't commit to one melee weapon for life - they
    // periodically reconsider, same as a player switching hotbar slots.
    if (bot.weaponMode !== 'fixed' && t > (ai.nextWeaponSwitch || 0)) {
      ai.nextWeaponSwitch = t + rand(8, 15);
      bot.meleeWeapon = pickBotWeapon(bot.kit);
    }

    // melee - hacks (see /bothacks) extend reach, lower the cooldown, and
    // multiply damage on top of the normal difficulty scaling.
    const weapon = BOT_WEAPONS[bot.meleeWeapon] || BOT_WEAPONS.sword;
    const meleeReach = C.REACH_ATTACK + (botHacksEnabled ? BOT_HACKS.reachBonus : 0);
    const meleeCooldown = weapon.cooldown / Math.max(0.4, bot.skill) / (botHacksEnabled ? BOT_HACKS.cooldownDivisor : 1);
    if (dist < meleeReach - 0.5 && Math.abs(dy) < 2.2 && t - bot.lastAttack > meleeCooldown) {
      bot.lastAttack = t;
      bot.slot = weapon.slot;
      io.emit('swing', { id: bot.id });
      if (lineOfSight(bot, target)) {
        const l = Math.hypot(dx, dz) || 1;
        const dmg = weapon.damage * botDamageMult(bot) * (botHacksEnabled ? BOT_HACKS.dmgMult : 1);
        applyDamage(target, dmg, bot, weapon.key, (dx / l) * 0.55, (dz / l) * 0.55, 0.42);
      }
    }

    // full only (the most advanced AI tier) - and even then, sparingly: a
    // real fight, not a bot that tops off the instant it's scratched.
    // Golden apples only kick in once genuinely low on health, gated by a
    // random per-check chance on top of a long cooldown so it doesn't
    // reliably eat the very first tick it qualifies.
    if (bot.weaponMode === 'full' && bot.health < C.MAX_HEALTH * 0.35 && bot.ammo.gapple > 0 &&
        t > (ai.nextEat || 0) && Math.random() < 0.2) {
      ai.nextEat = t + rand(5, 9);
      const gapple = ITEM_BY_KEY.gapple;
      // The gapple bonus (rollBonusItem) is unlimited - don't spend it down.
      if (bot.bonusItem !== 'gapple') bot.ammo.gapple--;
      bot.health = Math.min(C.MAX_HEALTH, bot.health + gapple.heal);
      bot.absorption = Math.min(8, bot.absorption + gapple.absorb);
      io.emit('hp', { id: bot.id, health: bot.health, absorption: bot.absorption });
      io.emit('effect', { kind: 'eat', x: bot.x, y: bot.y + 1.2, z: bot.z });
    }

    // Bonus item (see rollBonusItem/addBot/respawn): unlimited use (ammo is
    // never spent below) but still cooldown-gated - the cooldown shrinks
    // with bot.skill so higher-difficulty bots reach for it more often,
    // same idiom as the bow-shot cooldown further down. Skip it for a
    // 'full' bot with the gapple bonus - the block above already covers
    // that exact case, so this only adds real behavior for egap (which
    // 'full' mode never eats on its own) or for non-full bots with gapple.
    if ((bot.bonusItem === 'gapple' || bot.bonusItem === 'egap') &&
        !(bot.bonusItem === 'gapple' && bot.weaponMode === 'full') &&
        bot.health < C.MAX_HEALTH * 0.5 && t > (ai.nextBonusEat || 0) && Math.random() < 0.3) {
      ai.nextBonusEat = t + rand(6, 11) / Math.max(0.4, bot.skill);
      const food = ITEM_BY_KEY[bot.bonusItem];
      bot.health = Math.min(C.MAX_HEALTH, bot.health + food.heal);
      bot.absorption = Math.min(food.absorbCap || 8, bot.absorption + food.absorb);
      io.emit('hp', { id: bot.id, health: bot.health, absorption: bot.absorption });
      io.emit('effect', { kind: 'eat', x: bot.x, y: bot.y + 1.2, z: bot.z });
    }

    // full: throws potions at its own feet situationally - Instant Health
    // when badly hurt (an alternative to the gapple above, same low-health
    // gate so it doesn't burn through both at once), Strength when about to
    // brawl up close, Speed when it needs to close distance on a target
    // that's pulling away. Only ever potions its own loadout actually has.
    if (bot.weaponMode === 'full' && t > (ai.nextPotion || 0)) {
      let potionKey = null;
      if (bot.health < C.MAX_HEALTH * 0.35 && playerHasItem(bot, 'pot_health') && bot.ammo.pot_health > 0) {
        potionKey = 'pot_health';
      } else if (dist < 4 && playerHasItem(bot, 'pot_strength') && bot.ammo.pot_strength > 0 && Math.random() < 0.35) {
        potionKey = 'pot_strength';
      } else if (dist > 8 && playerHasItem(bot, 'pot_speed') && bot.ammo.pot_speed > 0 && Math.random() < 0.3) {
        potionKey = 'pot_speed';
      }
      if (potionKey) {
        ai.nextPotion = t + rand(8, 14);
        bot.ammo[potionKey]--;
        spawnProjectile(bot, 'potion', bot.x, bot.y + MC.PHYS.EYE, bot.z, 0, -1, 0, 1, { potionKey });
      }
    }

    // full: occasionally drop a cobweb near the player's feet to slow them
    // down - never builds with cobble/planks, just this one tactical block.
    if (bot.weaponMode === 'full' && dist < 8 && dist > 1.5 && t > (ai.nextWeb || 0) && Math.random() < 0.15) {
      ai.nextWeb = t + rand(4, 8);
      const wx = Math.floor(target.x), wy = Math.floor(target.y), wz = Math.floor(target.z);
      if (getBlock(wx, wy, wz) === ID.AIR && setBlock(wx, wy, wz, ID.COBWEB)) {
        io.emit('block', { x: wx, y: wy, z: wz, id: ID.COBWEB, by: bot.id });
      }
    }

    // Bonus item cobweb: same tactical drop as the full-mode one above, but
    // available to any bot that rolled the bonus regardless of weaponMode -
    // cooldown scales with skill/difficulty like the other bonus behaviors.
    if (bot.bonusItem === 'cobweb' && bot.weaponMode !== 'full' && dist < 8 && dist > 1.5 &&
        t > (ai.nextBonusWeb || 0) && Math.random() < 0.2) {
      ai.nextBonusWeb = t + rand(4, 8) / Math.max(0.4, bot.skill);
      const wx = Math.floor(target.x), wy = Math.floor(target.y), wz = Math.floor(target.z);
      if (getBlock(wx, wy, wz) === ID.AIR && setBlock(wx, wy, wz, ID.COBWEB)) {
        io.emit('block', { x: wx, y: wy, z: wz, id: ID.COBWEB, by: bot.id });
      }
    }

    // Hacks: place a cobweb right on the target no matter how far away they
    // are (see /bothacks) - unlike the two cobweb behaviors above, no
    // distance gate at all.
    if (botHacksEnabled && t > (ai.nextHackWeb || 0) && Math.random() < 0.2) {
      ai.nextHackWeb = t + rand(3, 6);
      const wx = Math.floor(target.x), wy = Math.floor(target.y), wz = Math.floor(target.z);
      if (getBlock(wx, wy, wz) === ID.AIR && setBlock(wx, wy, wz, ID.COBWEB)) {
        io.emit('block', { x: wx, y: wy, z: wz, id: ID.COBWEB, by: bot.id });
      }
    }

    // shield: raise it in short bursts while a fight is close, more often
    // (and for longer) the higher the bot's skill.
    if (bot.blocking) {
      if (t > ai.blockUntil) bot.blocking = false;
    } else if (dist < 4.5 && t > (ai.nextBlock || 0) && t > (bot.shieldStunUntil || 0) && Math.random() < 0.02 + bot.skill * 0.03) {
      bot.blocking = true;
      ai.blockUntil = t + rand(0.3, 0.5 + bot.skill * 0.6);
      ai.nextBlock = ai.blockUntil + rand(0.4, 1.2);
    }

    // bow
    if (dist > 9 && dist < 45 && t > ai.nextShot && bot.ammo.arrow > 0 && lineOfSight(bot, target)) {
      ai.nextShot = t + rand(1.5, 4) / Math.max(0.4, bot.skill);
      bot.ammo.arrow--;
      bot.slot = 1;
      const err = (1 - bot.skill) * 0.09;
      const flight = dist / C.ARROW_SPEED;
      const aimY = target.y + 1.0 + 0.5 * C.ARROW_GRAVITY * flight * flight;
      let vx = target.x - bot.x + rand(-err, err) * dist;
      let vy = aimY - (bot.y + MC.PHYS.EYE);
      let vz = target.z - bot.z + rand(-err, err) * dist;
      const l = Math.hypot(vx, vy, vz) || 1;
      spawnProjectile(bot, 'arrow', bot.x, bot.y + MC.PHYS.EYE, bot.z, vx / l, vy / l, vz / l, 1);
    } else if (dist < 6) {
      bot.slot = weapon.slot;
    }
  } else {
    // wander
    if (!ai.wander || Math.hypot(ai.wander[0] - bot.x, ai.wander[1] - bot.z) < 3) {
      ai.wander = [rand(8, W.SX - 8), rand(8, W.SZ - 8)];
    }
    const wantYaw = Math.atan2(-(ai.wander[0] - bot.x), -(ai.wander[1] - bot.z));
    let diff = wantYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += clamp(diff, -2 * dt, 2 * dt);
    bot.pitch *= 0.9;
    input.forward = 1;
    if (bot.blocked) input.jump = true;
    bot.blocking = false;
  }

  // Hacks: a gentle hover instead of properly falling/staying grounded -
  // slow-falls (capped downward speed) and every so often nudges itself
  // back up a little, so it drifts and bobs a small height off the ground
  // instead of true flight.
  if (botHacksEnabled) {
    if (!bot.onGround && bot.vy < BOT_HACKS.hoverFallCap) bot.vy = BOT_HACKS.hoverFallCap;
    if (t > (ai.nextHackHop || 0) && Math.random() < 0.15) {
      ai.nextHackHop = t + rand(0.6, 1.4);
      bot.vy = Math.max(bot.vy, BOT_HACKS.hoverHopVy);
    }
  }

  // Elytra + fireworks bonus: glide instead of just falling whenever
  // airborne (same activation condition as a real player wearing one - see
  // game.js), and firework-boost toward the target while gliding - more
  // often at higher skill/difficulty, same cooldown idiom as the other
  // bonus behaviors. Fully unlimited: this never touches bot.ammo.firework.
  if (bot.bonusItem === 'elytra_firework') {
    if (!bot.gliding && !bot.onGround && bot.vy <= 0.5) bot.gliding = true;
    if (bot.gliding && bot.onGround) bot.gliding = false;
    input.glide = bot.gliding;
    if (bot.gliding && target && t > (ai.nextBonusBoost || 0) && Math.random() < 0.4) {
      ai.nextBonusBoost = t + rand(2, 4) / Math.max(0.4, bot.skill);
      const dx2 = target.x - bot.x, dy2 = target.y - bot.y, dz2 = target.z - bot.z;
      const l2 = Math.hypot(dx2, dy2, dz2) || 1;
      const boost = C.FIREWORK_BOOST_SPEED;
      bot.vx += (dx2 / l2) * boost; bot.vy += (dy2 / l2) * boost; bot.vz += (dz2 / l2) * boost;
      io.emit('effect', { kind: 'fireworkboost', x: bot.x, y: bot.y + 1, z: bot.z });
    }
  }

  input.yaw = bot.yaw;
  input.pitch = bot.pitch;
  input.block = bot.blocking;
  const prevY = bot.y;
  const wasGround = bot.onGround;
  Physics.step(getBlock, bot, input, dt);

  // drowning / stuck-in-water escape
  if (Physics.headInWater(getBlock, bot.x, bot.y, bot.z)) bot.vy = Math.max(bot.vy, 2.5);

  // fall damage
  trackFall(bot, prevY, wasGround);
}

function trackFall(p, prevY, wasGround) {
  if (!p.alive) return;
  if (!p.onGround) {
    if (p.vy < -0.1) {
      if (p.fallFrom === null || p.fallFrom === undefined) p.fallFrom = prevY;
      else p.fallFrom = Math.max(p.fallFrom, prevY);
    } else if (p.vy > 0.1) {
      p.fallFrom = null;
    }
    // Elytra flight never takes fall damage on landing, same as vanilla -
    // remembered for the whole fall (not just checked at the landing
    // instant) since `gliding` itself flips false the moment a landing is
    // detected, before this same tick's damage check would ever see it.
    if (p.gliding) p.glidedThisFall = true;
    // Mace smash peak, separate from fall-damage tracking above (which
    // vanilla-accurately wipes on any upward tick, including the tiny pitch
    // wobble that's normal mid-glide). This tracks the MOST RECENT high
    // point: it keeps following the player up for as long as they're
    // climbing or level, then freezes the instant they start actually
    // descending - so a dive right after an elytra climb counts from
    // wherever that climb topped out, not the start of the whole flight.
    if (p.y >= prevY - 0.02) p.smashPeak = p.y;
  } else {
    if (p.fallFrom !== null && p.fallFrom !== undefined) {
      const dist = p.fallFrom - p.y;
      p.fallFrom = null;
      const glided = p.glidedThisFall;
      p.glidedThisFall = false;
      // A powder snow bucket clutch works the same way water already does:
      // non-solid, so you fall straight through to solid ground - if that
      // ground still has powder snow sitting on it where you land, no damage.
      if (!glided && dist > C.FALL_SAFE && !Physics.inWater(getBlock, p.x, p.y, p.z) &&
          getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)) !== ID.POWDER_SNOW) {
        // Feather Falling isn't a real enchant here - netherite's fallResist
        // fills that role instead.
        const fallResist = (MC.ARMOR_TIERS[p.armorTier] || {}).fallResist || 0;
        const fallDmg = Math.floor((dist - C.FALL_SAFE) * (1 - fallResist));
        if (fallDmg > 0) applyDamage(p, fallDmg, null, 'fall', 0, 0, 0);
      }
    }
    p.glidedThisFall = false;
    p.smashPeak = null;
  }
}

// ------------------------------------------------------------- game loop ---
let lastTick = Date.now();
let snapAccum = 0;
let spreadAccum = 0;

function tick() {
  const t0 = Date.now();
  const dt = Math.min(0.1, (t0 - lastTick) / 1000);
  lastTick = t0;
  const t = now();

  if (t >= weatherUntil) rollWeather();
  // Rare cosmetic strikes during a thunderstorm, just for atmosphere - near
  // a random living player so it's actually visible to someone, no damage.
  if (weather === 'thunder' && Math.random() < C.RANDOM_LIGHTNING_CHANCE_PER_TICK) {
    const alive = [...players.values()].filter(p => p.alive);
    if (alive.length) {
      const p = pick(alive);
      strikeLightning(p.x + rand(-6, 6), p.y + 1, p.z + rand(-6, 6), null, true);
    }
  }

  for (const p of players.values()) {
    if (!p.alive) {
      if (t >= p.respawnAt) respawn(p);
      continue;
    }
    if (p.bot) stepBot(p, dt, t);

    // A slow coin trickle for the shop, so a player who isn't getting kills
    // still creeps towards their first upgrade (see MC.SHOP).
    if (!p.bot && t - p.lastCoinTick >= MC.SHOP.COIN_IDLE_SECONDS) {
      p.lastCoinTick = t;
      awardCoins(p, MC.SHOP.COIN_IDLE_AMOUNT);
    }

    // natural regeneration
    if (p.health > 0 && p.health < C.MAX_HEALTH &&
        t - p.lastDamage > C.REGEN_DELAY && t - p.lastRegen > C.REGEN_INTERVAL) {
      p.lastRegen = t;
      p.health = Math.min(C.MAX_HEALTH, p.health + 1);
      if (p.socket) p.socket.emit('heal', { health: p.health, absorption: p.absorption });
      io.emit('hp', { id: p.id, health: p.health, absorption: p.absorption });
    }
    // Fire Aspect / Flame: burning ticks once a second while p.burnUntil is
    // in the future, bypassing armor (a status effect, not a weapon hit) -
    // Fire Resistance blocks it outright.
    if (p.burnUntil > t) {
      if (!activeEffect(p, 'fireResistance', t) && t - p.lastBurnTick >= 1) {
        p.lastBurnTick = t;
        applyDamage(p, C.BURN_DPS, null, 'fire', 0, 0, 0);
      }
    }
    // Regeneration (egap) - independent of natural regen above: ticks
    // regardless of recent damage, faster, and only for its own duration.
    {
      const regen = activeEffect(p, 'regeneration', t);
      if (regen && p.health > 0 && p.health < C.MAX_HEALTH && t - p.lastEffectRegenTick >= C.REGEN_TICK_INTERVAL) {
        p.lastEffectRegenTick = t;
        p.health = Math.min(C.MAX_HEALTH, p.health + C.REGEN_HP_PER_LEVEL_PER_TICK * regen.level);
        if (p.socket) p.socket.emit('heal', { health: p.health, absorption: p.absorption });
        io.emit('hp', { id: p.id, health: p.health, absorption: p.absorption });
      }
    }
    // Powder snow puts out fire on contact, same as vanilla.
    if (p.burnUntil > t && isInPowderSnow(p)) p.burnUntil = 0;

    // Lava: hurts once a second (bypasses armor, same as fire/burn - it's an
    // environmental hazard, not a weapon hit) and also ignites, so the burn
    // keeps ticking for a few seconds after stepping out.
    if (isInLava(p)) {
      if (!activeEffect(p, 'fireResistance', t) && t - p.lastBurnTick >= 1) {
        p.lastBurnTick = t;
        applyDamage(p, C.LAVA_DPS, null, 'lava', 0, 0, 0);
      }
      ignitePlayer(p, t);
    }
    // A flint-and-steel ground fire - same shape as lava above, lighter
    // damage, and it burns itself out instead of being a permanent block.
    if (groundFires.some(f => Math.floor(p.x) === f.x && Math.floor(p.y) === f.y && Math.floor(p.z) === f.z)) {
      if (!activeEffect(p, 'fireResistance', t) && t - p.lastBurnTick >= 1) {
        p.lastBurnTick = t;
        applyDamage(p, C.GROUND_FIRE_DPS, null, 'fire', 0, 0, 0);
      }
      ignitePlayer(p, t);
    }

    // void / suffocation guard
    if (p.y < -3) applyDamage(p, 100, null, 'void', 0, 0, 0);

    // drop idle humans
    if (!p.bot && t - p.lastSeen > 45) {
      if (p.socket) p.socket.disconnect(true);
    }
  }

  // Wolves - stepWolf() also handles despawning one whose owner disconnected
  // (players.delete already happened by the time this runs, so it just
  // shows up as a missing owner here, no separate cleanup needed elsewhere).
  for (const w of wolves.values()) stepWolf(w, dt, t);

  // TNT / TNT Minecart fuses - explode anything whose timer has run out.
  if (liveTNT.length) {
    const stillLit = [];
    for (const fuse of liveTNT) {
      if (t >= fuse.explodeAt) {
        setBlock(fuse.x, fuse.y, fuse.z, ID.AIR);
        io.emit('block', { x: fuse.x, y: fuse.y, z: fuse.z, id: ID.AIR, by: fuse.ownerId });
        explodeTNT(fuse.x + 0.5, fuse.y + 0.5, fuse.z + 0.5, fuse.radius, fuse.dmg, fuse.kb, fuse.ownerId);
      } else {
        stillLit.push(fuse);
      }
    }
    liveTNT = stillLit;
  }

  // Ground fires burn out on their own - the damage tick above already
  // checked them this frame, this just forgets expired ones.
  if (groundFires.length) groundFires = groundFires.filter(f => t < f.until);

  // Water/lava spread - a few queued cells at a time, throttled well below
  // tick rate so it stays a slow trickle rather than an instant flood.
  // Vanilla-shaped priority: falling is unlimited distance and always tried
  // first (resetting the horizontal hop budget on every drop, so a
  // waterfall off a cliff reaches the bottom instead of stopping partway
  // down) - only once a cell can't fall any further does it spread
  // sideways, and that horizontal spread is what's actually hop-limited.
  spreadAccum += dt;
  if (spreadAccum >= C.LIQUID_SPREAD_INTERVAL) {
    spreadAccum = 0;
    let n = C.LIQUID_SPREAD_PER_TICK;
    while (n-- > 0 && liquidSpreadQueue.length) {
      const cur = liquidSpreadQueue.shift();
      const belowY = cur.y - 1;
      if (inBounds(cur.x, belowY, cur.z) && getBlock(cur.x, belowY, cur.z) === ID.AIR) {
        if (setBlock(cur.x, belowY, cur.z, cur.kind)) {
          io.emit('block', { x: cur.x, y: belowY, z: cur.z, id: cur.kind, by: null });
          liquidSpreadQueue.push({ x: cur.x, y: belowY, z: cur.z, kind: cur.kind, hop: 0 });
        }
        continue;
      }
      const maxHop = cur.kind === ID.LAVA ? C.LAVA_SPREAD_MAX_HOPS : C.WATER_SPREAD_MAX_HOPS;
      if (cur.hop >= maxHop) continue;
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      for (const [dx, dy, dz] of dirs) {
        const nx = cur.x + dx, ny = cur.y + dy, nz = cur.z + dz;
        if (!inBounds(nx, ny, nz)) continue;
        if (getBlock(nx, ny, nz) !== ID.AIR) continue;
        if (setBlock(nx, ny, nz, cur.kind)) {
          io.emit('block', { x: nx, y: ny, z: nz, id: cur.kind, by: null });
          liquidSpreadQueue.push({ x: nx, y: ny, z: nz, kind: cur.kind, hop: cur.hop + 1 });
        }
      }
    }
  }

  stepProjectiles(dt);

  snapAccum += dt;
  if (snapAccum >= 1 / SNAPSHOT_HZ) {
    snapAccum = 0;
    sendSnapshot();
  }
}

function sendSnapshot() {
  const t = now();
  const list = [];
  for (const p of players.values()) {
    list.push([
      p.id,
      Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100,
      Math.round(p.yaw * 1000) / 1000, Math.round(p.pitch * 1000) / 1000,
      p.health, p.alive ? 1 : 0, p.slot,
      // Absorption rides along so other clients can show the shield. Without
      // it a player eating gapples reads as an empty health bar that refuses
      // to die, because the hearts soaking the damage are invisible.
      Math.round(p.absorption * 10) / 10,
      (p.sneak ? 1 : 0) | (p.sprint ? 2 : 0) | (p.blocking ? 4 : 0) | (p.burnUntil > t ? 8 : 0) | (hasAnyEffect(p, t) ? 16 : 0) | (p.gliding ? 32 : 0),
      Math.round(p.vx * 10) / 10, Math.round(p.vz * 10) / 10
    ]);
  }
  const prj = projectiles.map(p => [p.id, p.kind === 'pearl' ? 1 : 0,
    Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100,
    Math.round(p.vx * 10) / 10, Math.round(p.vy * 10) / 10, Math.round(p.vz * 10) / 10]);
  // Wolves move continuously like players, so they ride the same
  // high-frequency snapshot rather than one-off events (those - wolfSpawn/
  // wolfHp/wolfDeath/wolfTeleport - only cover state *changes*).
  const wlv = [];
  for (const w of wolves.values()) {
    wlv.push([w.id, Math.round(w.x * 100) / 100, Math.round(w.y * 100) / 100, Math.round(w.z * 100) / 100, Math.round(w.yaw * 1000) / 1000]);
  }
  io.volatile.emit('snapshot', { t: Date.now(), p: list, r: prj, w: wlv });
}

// ---------------------------------------------------------------- server ---
const app = express();
// Force revalidation on every request. The client's own copy of shared/*.js
// generates its local world model from the same seed as the server - if a
// browser ever serves a stale cached copy after the world/game code changes,
// the client and server silently disagree about what's solid ground, which
// looks exactly like the world "not generating properly" and entities
// "flying" (they're standing on server-side geometry the stale client never
// built). no-store rules that out entirely, at the cost of a full re-fetch
// on every load - a fair trade for a small local game.
const noCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
app.use(noCache);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false, lastModified: false }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: 0, etag: false, lastModified: false }));
app.get('/health', (req, res) => res.json({
  ok: true, players: players.size, bots: [...players.values()].filter(p => p.bot).length, seed: SEED, arena: currentArena
}));
// Manual escape hatch for the menu's "Reset Terrain" button - doesn't need a
// live socket connection (the button lives on the pre-join menu screen), and
// still broadcasts to anyone already playing so their client rebuilds too.
app.post('/reset', (req, res) => {
  resetWorld();
  io.emit('worldReset', { seed: SEED, arena: currentArena });
  io.emit('chat', { system: true, text: 'The terrain was reset.' });
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 12000 });

io.on('connection', socket => {
  let me = null;

  socket.on('join', (data, ack) => {
    if (me) return;
    const name = (data && data.name ? String(data.name) : 'Player').replace(/[^\w \-\[\]]/g, '').trim().slice(0, 16) || 'Player';
    const kit = data && MC.KITS[data.kit] ? data.kit : 'web';
    // Nobody else human around (typical "refresh the tab, click Play again")
    // -> treat this as a fresh session and clear whatever got built/broken
    // last time. Never wipes a map other real players are still using.
    // A lone player rejoining also gets whatever arena they picked at the
    // menu - with nobody else around there's nothing to disrupt.
    if (![...players.values()].some(p => !p.bot)) resetWorld(data && data.arena);
    me = makePlayer(socket.id, name, false, data && data.armor, kit, data && data.customItems, data && data.enchantOpts, data && data.swordTier, data && data.axeTier, data && data.dogArmor, data && data.trims);
    me.socket = socket;
    players.set(me.id, me);

    const editList = [];
    for (const [i, id] of edits) editList.push(i, id);

    socket.emit('init', {
      id: me.id,
      seed: SEED,
      arena: currentArena,
      spawn: { x: me.x, y: me.y, z: me.z },
      edits: editList,
      players: [...players.values()].map(publicPlayer),
      // Wolves already on the field. wolfSpawn only reaches whoever was
      // connected at the time, so without this a player who joins later
      // never creates an entry for them and the snapshot's position rows
      // have nothing to update - the wolves stay invisible for that client.
      wolves: [...wolves.values()].map(publicWolf),
      you: publicPlayer(me),
      ammo: me.ammo,
      shop: shopState(me),
      serverTime: Date.now(),
      weather: weather
    });
    socket.broadcast.emit('playerJoin', publicPlayer(me));
    io.emit('chat', { system: true, text: name + ' joined the arena' });
    broadcastScores();
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('state', d => {
    if (!me || !me.alive || !d) return;
    me.lastSeen = now();
    const nx = +d.x, ny = +d.y, nz = +d.z;
    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) return;
    // Loose sanity check: reject absurd teleports, otherwise trust the client.
    const jump = Math.hypot(nx - me.x, ny - me.y, nz - me.z);
    if (jump > 24) {
      socket.emit('teleport', { x: me.x, y: me.y, z: me.z });
      return;
    }
    const prevY = me.y;
    const wasGround = me.onGround;
    me.x = clamp(nx, 0, W.SX); me.y = clamp(ny, -10, W.SY); me.z = clamp(nz, 0, W.SZ);
    me.vx = +d.vx || 0; me.vy = +d.vy || 0; me.vz = +d.vz || 0;
    me.yaw = +d.yaw || 0; me.pitch = +d.pitch || 0;
    me.onGround = !!d.g;
    me.sneak = !!d.sn;
    me.sprint = !!d.sp;
    me.blocking = !!d.bl && now() > (me.shieldStunUntil || 0);
    me.slot = clamp(d.slot | 0, 0, MC.ITEMS.length - 1);
    me.gliding = !!d.gl && playerHasItem(me, 'elytra');
    me.offhandKey = (typeof d.oh === 'string' && (d.oh === 'shield' || (ITEM_BY_KEY[d.oh] && playerHasItem(me, d.oh)))) ? d.oh : 'shield';
    me.chestSlot = (d.ch === 'elytra' && playerHasItem(me, 'elytra')) ? 'elytra' : 'chestplate';
    trackFall(me, prevY, wasGround);
  });

  socket.on('ping', (t, ack) => {
    if (me) me.lastSeen = now();
    if (typeof ack === 'function') ack(t);
  });

  socket.on('swing', () => {
    if (!me || !me.alive) return;
    socket.broadcast.emit('swing', { id: me.id });
  });

  socket.on('attack', d => {
    if (!me || !me.alive || !d) return;
    const t = now();
    const item = itemForPlayer(me, me.slot);
    if (!item) return;
    if (item.type !== 'weapon' && item.type !== 'tool' && item.type !== 'block' && item.type !== 'bow') return;
    // netherite_sword/netherite_axe behave exactly like sword/axe for every
    // enchant/armor/shield-break/looting check below - see baseWeaponKey().
    const weaponKey = baseWeaponKey(item.key);
    const cd = item.cooldown || 0.3;
    if (t - me.lastAttack < cd * 0.85) return;
    // A thrown trident isn't in hand again until it "returns" - see the
    // 'shoot' handler, which sets this based on Loyalty.
    if (item.key === 'trident' && t < (me.tridentAvailableAt || 0)) return;

    const isSpear = item.key === 'spear';
    // Holding the attack button instead of tapping charges a stronger
    // thrust - only meaningful for the spear, ignored for every other item.
    const charged = isSpear && !!d.charged;

    // The spear pierces every valid target in front of it (up to 8), sent as
    // d.ids; every other weapon is the usual single d.id. A charged thrust
    // reaches further on top of the spear's own longer reach.
    const reach = (item.reach || C.REACH_ATTACK) + C.REACH_ATTACK_SLACK + (charged ? C.SPEAR_CHARGE_REACH_BONUS : 0);
    const minReach = item.minReach || 0;
    const rawIds = item.pierce && Array.isArray(d.ids) ? d.ids.slice(0, 8) : [d.id];
    const hits = [];
    // Wolves live in their own map (see damageWolf) rather than `players`,
    // so a swing checks both - same reach rules either way.
    const wolfHits = [];
    for (const id of rawIds) {
      const victim = players.get(id);
      if (victim && victim.alive && victim.id !== me.id) {
        const dist = Math.hypot(victim.x - me.x, (victim.y + 0.9) - (me.y + MC.PHYS.EYE), victim.z - me.z);
        if (dist <= reach && dist >= minReach) hits.push(victim);
        continue;
      }
      const w = wolves.get(id);
      if (w && w.alive) {
        const dist = Math.hypot(w.x - me.x, (w.y + 0.5) - (me.y + MC.PHYS.EYE), w.z - me.z);
        if (dist <= reach && dist >= minReach) wolfHits.push(w);
      }
    }
    // Every other weapon needs an actual target to do anything; the spear's
    // Lunge fires on every swing regardless (a mobility tool as much as a
    // weapon), so only bail out here for a non-spear whiff.
    if (!hits.length && !wolfHits.length && !isSpear) return;
    me.lastAttack = t;

    let dmg = item.damage || 1;
    let kbMul = item.knockback || 0.5;
    // critical hit: falling and not on the ground (classic MC rule) - a mace
    // instead turns this into a smash attack, scaling with fall distance.
    let crit = false, smash = false;
    if (!me.onGround && me.vy < -0.15) {
      if (item.key === 'mace') {
        smash = true;
        // Density counts from the most recent high point (see smashPeak in
        // trackFall()) - it follows the player up through an elytra climb
        // and freezes the moment they actually start descending, so diving
        // right after a climb counts from wherever that climb topped out.
        const peak = me.smashPeak === null || me.smashPeak === undefined ? me.y : me.smashPeak;
        const fallDist = Math.min(C.MACE_MAX_FALL, Math.max(0, peak - me.y));
        dmg = Math.ceil(C.MACE_SMASH_BASE + fallDist * C.MACE_DENSITY_PER_BLOCK);
        kbMul += 0.8;
      } else {
        dmg = Math.ceil(dmg * 1.5);
        crit = true;
      }
    }
    const str = activeEffect(me, 'strength', t);
    if (str) dmg += C.STRENGTH_DMG_PER_LEVEL * str.level;
    // Sharpness V (sword/axe) and Knockback III (sword) are opt-in toggles -
    // see ENCHANT_DEFS / the menu's Enchantments panel.
    if ((weaponKey === 'sword' || weaponKey === 'axe') && hasEnchant(me, weaponKey, 'sharpness')) dmg += C.SHARPNESS_DMG_BONUS;
    if (weaponKey === 'sword' && hasEnchant(me, 'sword', 'knockback')) kbMul += C.KNOCKBACK_ENCHANT_ADD;
    // The knockback stick: Knockback V (if on) always wins over II.
    if (item.key === 'stick') {
      if (hasEnchant(me, 'stick', 'knockback5')) kbMul += C.STICK_KB5_ADD;
      else if (hasEnchant(me, 'stick', 'knockback2')) kbMul += C.STICK_KB2_ADD;
    }
    if (charged) {
      dmg *= C.SPEAR_CHARGE_DMG_MULT;
      // Jousting bonus: extra damage scaled off how fast the wielder is
      // actually moving horizontally the instant the thrust lands (sprinting
      // or mid-Lunge-dash) - a charge held standing still gets none of this,
      // only the flat multiplier above.
      const speed = Math.hypot(me.vx, me.vz);
      if (speed > C.SPEAR_CHARGE_MIN_SPEED) {
        dmg += Math.min(C.SPEAR_CHARGE_MAX_SPEED_BONUS, (speed - C.SPEAR_CHARGE_MIN_SPEED) * C.SPEAR_CHARGE_SPEED_DMG_PER_UNIT);
      }
    }
    if (me.sprint) kbMul += 0.5;

    const fireAspect = weaponKey === 'sword' && hasEnchant(me, 'sword', 'fireAspect');
    const impaling = item.key === 'trident' && hasEnchant(me, 'trident', 'impaling');
    for (const victim of hits) {
      const dx = victim.x - me.x, dz = victim.z - me.z;
      const l = Math.hypot(dx, dz) || 1;
      const victimDmg = dmg + (impaling && isInWater(victim) ? C.TRIDENT_IMPALING_BONUS_DMG : 0);
      applyDamage(victim, victimDmg, me, weaponKey, (dx / l) * 0.55 * kbMul, (dz / l) * 0.55 * kbMul, 0.42);
      if (fireAspect) ignitePlayer(victim, t);
    }
    for (const w of wolfHits) damageWolf(w, dmg, me);
    const firstHit = hits[0] || wolfHits[0];
    if (crit && firstHit) io.emit('effect', { kind: 'crit', x: firstHit.x, y: firstHit.y + 1, z: firstHit.z });
    if (smash) {
      io.emit('effect', { kind: 'smash', x: firstHit.x, y: firstHit.y + 0.2, z: firstHit.z });
      // Wind Burst III: launch the wielder back into the air so a smash can
      // be chained, and waive whatever fall damage this landing would've
      // otherwise dealt (same as vanilla). smashPeak will naturally re-track
      // from this new height on the way back up - no explicit reset needed.
      me.vy = C.MACE_WINDBURST_VY;
      me.fallFrom = null;
      socket.emit('launch', { vy: C.MACE_WINDBURST_VY });
    }
    if (isSpear) {
      // Lunge III: every spear swing propels the wielder forward
      // horizontally, stronger mid-air - a charged thrust dashes further still.
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw); // yaw 0 == -Z
      let mul = C.SPEAR_LUNGE_SPEED * (me.onGround ? 1 : C.SPEAR_LUNGE_AIR_MULT);
      if (charged) mul *= C.SPEAR_CHARGE_LUNGE_MULT;
      const lvx = fx * mul, lvz = fz * mul;
      me.vx += lvx; me.vz += lvz;
      socket.emit('launch', { vx: lvx, vz: lvz });
    }
  });

  // Right-click a Wolf Spawn Egg to spawn a wolf loyal only to you (see
  // spawnWolf/stepWolf) - no aiming needed, it appears a couple blocks in
  // front of wherever you're facing.
  socket.on('spawnWolf', () => {
    if (!me || !me.alive) return;
    const item = itemForPlayer(me, me.slot);
    if (!item || item.type !== 'spawn_egg') return;
    const t = now();
    if (t - (me.lastWolfEgg || 0) < item.cooldown) return;
    if ((me.ammo.wolf_spawn_egg || 0) <= 0) return;
    me.lastWolfEgg = t;
    me.ammo.wolf_spawn_egg--;
    socket.emit('ammo', me.ammo);
    spawnWolf(me, me.dogArmor);
  });

  // Shop purchases are decided entirely here: the client sends only which
  // upgrade it wants, and gets the authoritative coins/levels back.
  socket.on('shopBuy', key => {
    if (!me || typeof key !== 'string') return;
    const up = MC.SHOP.UPGRADES[key];
    if (!up) return;
    const level = me.upgrades[key] | 0;
    const cost = MC.shopCost(key, level);
    if (cost === null) { socket.emit('chat', { system: true, text: up.name + ' is already maxed out.' }); return; }
    if (me.coins < cost) { socket.emit('chat', { system: true, text: 'Not enough coins for ' + up.name + ' (need ' + cost + ').' }); return; }
    me.coins -= cost;
    me.upgrades[key] = level + 1;
    // Starting Gear is about what you spawn with, but waiting for a death
    // to feel a purchase is miserable - top up on the spot as well.
    if (key === 'gear') {
      const ammo = upgradedAmmo(me);
      for (const k in ammo) me.ammo[k] = Math.max(me.ammo[k] | 0, ammo[k]);
      socket.emit('ammo', me.ammo);
    }
    sendShop(me);
    socket.emit('chat', { system: true, text: 'Bought ' + up.name + ' ' + me.upgrades[key] + '/' + MC.SHOP.MAX_LEVEL + '.' });
  });

  socket.on('shoot', d => {
    if (!me || !me.alive || !d) return;
    const dir = normalize(d.dx, d.dy, d.dz);
    if (!dir) return;
    const item = itemForPlayer(me, me.slot);
    if (!item) return;
    if (item.type === 'bow') {
      if (me.ammo.arrow <= 0) return;
      me.ammo.arrow--;
      const power = clamp(+d.power || 0, 0.1, 1);
      spawnProjectile(me, 'arrow', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], power, { weaponKey: 'bow' });
      socket.emit('ammo', me.ammo);
    } else if (item.type === 'crossbow') {
      // Shift+RMB loads a firework rocket instead of an arrow - this is the
      // only way to fire one as a weapon (the firework item itself only
      // does anything while gliding, see the 'firework' branch below).
      if (d.firework && playerHasItem(me, 'firework')) {
        if (me.ammo.firework <= 0) return;
        me.ammo.firework--;
        spawnProjectile(me, 'firework', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], 1);
        socket.emit('ammo', me.ammo);
        return;
      }
      // Quick Charge is just its own short drawTime (client-side charge
      // timer, same mechanism as the bow) - Multishot fires several arrows
      // in a horizontal spread from a single arrow of ammo.
      if (me.ammo.arrow <= 0) return;
      me.ammo.arrow--;
      const power = clamp(+d.power || 0, 0.1, 1);
      const n = C.CROSSBOW_MULTISHOT_COUNT, spread = C.CROSSBOW_MULTISHOT_SPREAD;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * spread;
        const cosA = Math.cos(off), sinA = Math.sin(off);
        const ndx = dir[0] * cosA - dir[2] * sinA, ndz = dir[0] * sinA + dir[2] * cosA;
        spawnProjectile(me, 'arrow', me.x, me.y + MC.PHYS.EYE, me.z, ndx, dir[1], ndz, power, { weaponKey: 'crossbow' });
      }
      socket.emit('ammo', me.ammo);
    } else if (item.throwable) {
      // Trident. Riptide launches the thrower instead of throwing it at all,
      // if they're currently wet (in water, or it's raining/thundering) -
      // holding sneak forces a normal throw anyway, same override vanilla
      // uses. Loyalty (checked either way) is how long until it's ready to
      // use again; no physical pickup in this game, so "walk over and grab
      // it" is simulated as a cooldown instead.
      const t = now();
      if (t < (me.tridentAvailableAt || 0)) return;
      if (hasEnchant(me, 'trident', 'riptide') && isWet(me) && !me.sneak) {
        const vx = dir[0] * C.TRIDENT_RIPTIDE_SPEED, vy = Math.max(dir[1], 0.3) * C.TRIDENT_RIPTIDE_SPEED, vz = dir[2] * C.TRIDENT_RIPTIDE_SPEED;
        me.vx += vx; me.vy = Math.max(me.vy, vy); me.vz += vz;
        me.tridentAvailableAt = t + C.TRIDENT_COOLDOWN_WITH_LOYALTY;
        socket.emit('launch', { vx, vy, vz });
        return;
      }
      me.tridentAvailableAt = t + (hasEnchant(me, 'trident', 'loyalty') ? C.TRIDENT_COOLDOWN_WITH_LOYALTY : C.TRIDENT_COOLDOWN_NO_LOYALTY);
      spawnProjectile(me, 'trident', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], 1);
    } else if (item.type === 'pearl') {
      const t = now();
      if (me.ammo.pearl <= 0 || t - me.lastAttack < item.cooldown) return;
      me.lastAttack = t;
      me.ammo.pearl--;
      spawnProjectile(me, 'pearl', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], 1);
      socket.emit('ammo', me.ammo);
    } else if (item.type === 'windcharge') {
      const t = now();
      // Its own cooldown timer, not shared with melee/pearl (me.lastAttack) -
      // the pearl combo below needs a wind charge to follow a thrown pearl
      // within a fraction of a second, which the shared melee cooldown would
      // rule out (a pearl travels ~24 blocks in the 0.8s that cooldown takes).
      if (me.ammo.windcharge <= 0 || t - (me.lastWindcharge || 0) < item.cooldown) return;
      me.lastWindcharge = t;
      me.ammo.windcharge--;
      spawnProjectile(me, 'windcharge', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], 1);
      // Using it always launches the thrower straight up, vanilla's classic
      // "wind charge jump" - independent of whatever the thrown charge itself
      // goes on to hit.
      me.vy = Math.max(me.vy, C.WINDCHARGE_SELF_LAUNCH_VY);
      socket.emit('launch', { vy: C.WINDCHARGE_SELF_LAUNCH_VY });
      socket.emit('ammo', me.ammo);
    } else if (item.type === 'potion') {
      const t = now();
      if (me.ammo[item.key] <= 0 || t - (me.lastPotionThrow || 0) < item.cooldown) return;
      me.lastPotionThrow = t;
      me.ammo[item.key]--;
      spawnProjectile(me, 'potion', me.x, me.y + MC.PHYS.EYE, me.z, dir[0], dir[1], dir[2], 1, { potionKey: item.key });
      socket.emit('ammo', me.ammo);
    } else if (item.type === 'firework') {
      // Only does anything while gliding (a forward speed boost, same
      // self-launch pattern as the wind charge/riptide above) - firing one
      // as a weapon requires a crossbow instead, see that branch above.
      if (!me.gliding) return;
      const t = now();
      if (me.ammo.firework <= 0 || t - (me.lastFirework || 0) < item.cooldown) return;
      me.lastFirework = t;
      me.ammo.firework--;
      const vx = dir[0] * C.FIREWORK_BOOST_SPEED, vy = dir[1] * C.FIREWORK_BOOST_SPEED, vz = dir[2] * C.FIREWORK_BOOST_SPEED;
      me.vx += vx; me.vy += vy; me.vz += vz;
      socket.emit('launch', { vx, vy, vz });
      io.emit('effect', { kind: 'fireworkboost', x: me.x, y: me.y + 1, z: me.z });
      socket.emit('ammo', me.ammo);
    }
  });

  socket.on('eat', () => {
    if (!me || !me.alive) return;
    // Generic over every food item (gapple, egap, any future one) instead
    // of a hardcoded gapple lookup - each defines its own heal/absorb(Cap),
    // and egap additionally grants Regeneration/Fire Resistance/Resistance
    // (see ENCHANT_DEFS-independent buff fields on the ITEMS entry itself -
    // these aren't player toggles, they're just what the item does).
    const item = itemForPlayer(me, me.slot);
    if (!item || item.type !== 'food') return;
    if (me.ammo[item.key] <= 0) return;
    me.ammo[item.key]--;
    const t = now();
    me.health = Math.min(C.MAX_HEALTH, me.health + item.heal);
    me.absorption = Math.min(item.absorbCap || 8, me.absorption + item.absorb);
    if (item.regenLevel) me.effects.regeneration = { level: item.regenLevel, until: t + item.regenSeconds };
    if (item.fireResLevel) me.effects.fireResistance = { level: item.fireResLevel, until: t + item.buffSeconds };
    if (item.resistLevel) me.effects.resistance = { level: item.resistLevel, until: t + item.buffSeconds };
    if (item.regenLevel || item.fireResLevel || item.resistLevel) socket.emit('effects', effectsSnapshot(me, t));
    socket.emit('heal', { health: me.health, absorption: me.absorption, ammo: me.ammo });
    io.emit('hp', { id: me.id, health: me.health, absorption: me.absorption });
    io.emit('effect', { kind: 'eat', x: me.x, y: me.y + 1.2, z: me.z });
  });

  socket.on('setBlock', d => {
    if (!me || !me.alive || !d) return;
    const x = d.x | 0, y = d.y | 0, z = d.z | 0;
    if (!inBounds(x, y, z)) return;
    const dist = Math.hypot(x + 0.5 - me.x, y + 0.5 - (me.y + MC.PHYS.EYE), z + 0.5 - me.z);
    if (dist > C.REACH_BLOCK + 2) return;
    const current = getBlock(x, y, z);
    const id = d.id | 0;
    let ammoChanged = false;

    if (id === ID.AIR) {
      if (MC.HARDNESS[current] < 0) return; // bedrock
      if (current === ID.AIR) return;
      // No bucket to pick liquids back up with any more - once placed,
      // water/lava is permanent (short of a TNT explosion clearing it).
      if (MC.LIQUID[current]) return;
      if (current === ID.RESPAWN_ANCHOR) anchorCharges.delete(x + ',' + y + ',' + z);
    } else {
      if (current !== ID.AIR && !MC.LIQUID[current]) return;
      if (id >= MC.BLOCKS.length) return;
      // Can only place a block whose item is actually in your loadout (e.g.
      // no placing cobwebs in Sword/Axe PvP even if you spoof the block id).
      const key = BLOCK_ITEM_KEY[id];
      if (key && !playerHasItem(me, key)) return;
      // TNT Minecart can only be set down directly on top of a rail.
      if (id === ID.TNT_MINECART && getBlock(x, y - 1, z) !== ID.RAIL) return;
      // End Crystal can only be set down directly on top of obsidian.
      if (id === ID.END_CRYSTAL && getBlock(x, y - 1, z) !== ID.OBSIDIAN) return;
      // never let someone build inside a player
      for (const p of players.values()) {
        if (!p.alive) continue;
        const r = MC.PHYS.WIDTH / 2;
        if (x + 1 > p.x - r && x < p.x + r && z + 1 > p.z - r && z < p.z + r &&
            y + 1 > p.y && y < p.y + MC.PHYS.HEIGHT) return;
      }
      // Ammo-limited placeable blocks (water/lava buckets, TNT) consume 1 to
      // place - ordinary building blocks (cobble/planks/rail/...) have no
      // `ammo` field and place for free, unaffected by this.
      if (key) {
        const placedItem = ITEM_BY_KEY[key];
        if (placedItem.ammo !== undefined) {
          if ((me.ammo[key] || 0) <= 0) return;
          me.ammo[key]--;
          ammoChanged = true;
        }
      }
    }
    if (setBlock(x, y, z, id)) {
      io.emit('block', { x, y, z, id, by: me.id });
      if (ammoChanged) socket.emit('ammo', me.ammo);
      // Seed the bounded flood-fill spread from a freshly-placed liquid
      // source - see the LIQUID_SPREAD_* tick below.
      if (id === ID.WATER || id === ID.LAVA) liquidSpreadQueue.push({ x, y, z, kind: id, hop: 0 });
    }
  });

  socket.on('ignite', d => {
    if (!me || !me.alive || !d) return;
    const item = itemForPlayer(me, me.slot);
    if (!item || item.type !== 'igniter') return;
    const x = d.x | 0, y = d.y | 0, z = d.z | 0;
    if (!inBounds(x, y, z)) return;
    const dist = Math.hypot(x + 0.5 - me.x, y + 0.5 - (me.y + MC.PHYS.EYE), z + 0.5 - me.z);
    if (dist > C.IGNITE_REACH) return;
    const block = getBlock(x, y, z);
    if (MC.HARDNESS[block] < 0 || block === ID.AIR || MC.LIQUID[block]) return; // bedrock, nothing there, or a liquid
    if (block === ID.TNT || block === ID.TNT_MINECART) igniteTNTBlock(x, y, z, me.id);
    else lightGroundFire(x, y, z);
  });

  // Hitting an end crystal (melee, aimed via the client's block raycast -
  // any weapon works, matching vanilla) detonates it on the spot.
  socket.on('hitCrystal', d => {
    if (!me || !me.alive || !d) return;
    const x = d.x | 0, y = d.y | 0, z = d.z | 0;
    if (!inBounds(x, y, z)) return;
    const dist = Math.hypot(x + 0.5 - me.x, y + 0.5 - (me.y + MC.PHYS.EYE), z + 0.5 - me.z);
    if (dist > C.CRYSTAL_HIT_REACH) return;
    if (getBlock(x, y, z) !== ID.END_CRYSTAL) return;
    if (setBlock(x, y, z, ID.AIR)) io.emit('block', { x, y, z, id: ID.AIR, by: me.id });
    detonateEndCrystal(x, y, z, me.id);
  });

  // Right-click a respawn anchor with glowstone selected to charge it (up
  // to ANCHOR_MAX_CHARGES) instead of placing a block normally.
  socket.on('chargeAnchor', d => {
    if (!me || !me.alive || !d) return;
    const item = itemForPlayer(me, me.slot);
    if (!item || item.key !== 'glowstone') return;
    if (item.ammo !== undefined && (me.ammo.glowstone || 0) <= 0) return;
    const x = d.x | 0, y = d.y | 0, z = d.z | 0;
    if (!inBounds(x, y, z)) return;
    const dist = Math.hypot(x + 0.5 - me.x, y + 0.5 - (me.y + MC.PHYS.EYE), z + 0.5 - me.z);
    if (dist > C.REACH_BLOCK + 2) return;
    if (getBlock(x, y, z) !== ID.RESPAWN_ANCHOR) return;
    const key = x + ',' + y + ',' + z;
    const charges = (anchorCharges.get(key) || 0) + 1;
    if (item.ammo !== undefined) { me.ammo.glowstone--; socket.emit('ammo', me.ammo); }
    if (charges >= C.ANCHOR_MAX_CHARGES) {
      detonateAnchor(x, y, z, me.id);
    } else {
      anchorCharges.set(key, charges);
      io.emit('effect', { kind: 'anchorcharge', x: x + 0.5, y: y + 1, z: z + 0.5, charges });
    }
  });

  // A sword hit against a respawn anchor holding at least 1 charge
  // detonates it early - a shorter fuse for less damage than letting it
  // reach the full 4 charges, same "trigger it yourself" role hitCrystal
  // plays for end crystals.
  socket.on('hitAnchor', d => {
    if (!me || !me.alive || !d) return;
    const item = itemForPlayer(me, me.slot);
    if (!item || baseWeaponKey(item.key) !== 'sword') return;
    const x = d.x | 0, y = d.y | 0, z = d.z | 0;
    if (!inBounds(x, y, z)) return;
    const dist = Math.hypot(x + 0.5 - me.x, y + 0.5 - (me.y + MC.PHYS.EYE), z + 0.5 - me.z);
    if (dist > C.ANCHOR_SWORD_HIT_REACH) return;
    if (getBlock(x, y, z) !== ID.RESPAWN_ANCHOR) return;
    const key = x + ',' + y + ',' + z;
    if ((anchorCharges.get(key) || 0) < 1) return;
    anchorCharges.delete(key);
    detonateAnchor(x, y, z, me.id);
  });

  socket.on('chat', text => {
    if (!me) return;
    let msg = String(text || '').slice(0, 140).trim();
    if (!msg) return;
    if (msg[0] === '/') return command(msg);
    io.emit('chat', { id: me.id, name: me.name, text: msg });
  });

  function command(msg) {
    const parts = msg.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const reply = text => socket.emit('chat', { system: true, text });
    // Secret, undocumented (not in /help) unlock for elytra - a one-way
    // switch for this player's current session, not a toggle. See
    // playerHasItem()'s elytra check.
    if (cmd === 'elytra257') {
      if (!me.elytraUnlocked) {
        me.elytraUnlocked = true;
        reply('Elytra unlocked.');
        socket.emit('elytraUnlocked');
      } else {
        reply('Elytra is already unlocked.');
      }
      return;
    }
    if (cmd === 'bots') {
      const want = clamp(parseInt(parts[1], 10) || 0, 0, 16);
      const diffArg = (parts[2] || '').toLowerCase();
      const armorArg = (parts[3] || '').toLowerCase();
      const kitArg = (parts[4] || '').toLowerCase();
      const weaponArg = (parts[5] || '').toLowerCase();
      const applyDiff = DIFFICULTY[diffArg] ? diffArg : null;
      const applyArmor = MC.ARMOR_TIERS[armorArg] ? armorArg : null;
      const applyKit = MC.KITS[kitArg] ? kitArg : null;
      const applyWeapon = WEAPON_MODES.includes(weaponArg) ? weaponArg : null;
      if (applyDiff) defaultDifficulty = applyDiff;
      if (applyArmor) defaultBotArmor = applyArmor;
      if (applyKit) defaultBotKit = applyKit;
      if (applyWeapon) defaultBotWeaponMode = applyWeapon;
      let have = [...players.values()].filter(p => p.bot && !p.dummy).length;
      while (have < want) { addBot(defaultDifficulty, defaultBotArmor, defaultBotKit, defaultBotWeaponMode); have++; }
      while (have > want) { if (!removeBot()) break; have--; }
      // An explicit difficulty/armor/kit/weapon mode is a request that ALL
      // current bots match it, not just ones newly created here - otherwise
      // picking "Hard" or "Diamond" in the menu silently does nothing when
      // bots already exist.
      if (applyDiff) for (const p of players.values()) { if (p.bot && !p.dummy) setBotDifficulty(p, applyDiff); }
      if (applyArmor) for (const p of players.values()) { if (p.bot && !p.dummy) setBotArmor(p, applyArmor); }
      if (applyKit) for (const p of players.values()) { if (p.bot && !p.dummy) setBotKit(p, applyKit); }
      if (applyWeapon) for (const p of players.values()) { if (p.bot && !p.dummy) setBotWeaponMode(p, applyWeapon); }
      io.emit('chat', {
        system: true,
        text: me.name + ' set bots to ' + want + (applyDiff ? ' (' + applyDiff + ')' : '') + (applyArmor ? ' [' + applyArmor + ' armor]' : '') + (applyKit ? ' {' + applyKit + ' kit}' : '') + (applyWeapon ? ' <' + applyWeapon + '>' : '')
      });
      broadcastScores();
    } else if (cmd === 'kit') {
      const key = (parts[1] || '').toLowerCase();
      if (!MC.KITS[key]) { reply('Usage: /kit <sword|axe|web>'); return; }
      me.kit = key;
      if (me.slot === MC.ITEMS.find(i => i.key === 'axe').slot && !MC.kitHasItem(key, 'axe')) me.slot = 0;
      io.emit('chat', { system: true, text: me.name + ' switched to ' + key + ' kit' });
    } else if (cmd === 'botkit') {
      const key = (parts[1] || '').toLowerCase();
      if (!MC.KITS[key]) { reply('Usage: /botkit <sword|axe|web>'); return; }
      defaultBotKit = key;
      let changed = 0;
      for (const p of players.values()) { if (p.bot && !p.dummy) { setBotKit(p, key); changed++; } }
      io.emit('chat', { system: true, text: me.name + ' set bot kit to ' + key + ' (' + changed + ' bots)' });
      broadcastScores();
    } else if (cmd === 'botweapon') {
      const key = (parts[1] || '').toLowerCase();
      if (!WEAPON_MODES.includes(key)) { reply('Usage: /botweapon <fixed|versatile|full>'); return; }
      defaultBotWeaponMode = key;
      let changed = 0;
      for (const p of players.values()) { if (p.bot && !p.dummy) { setBotWeaponMode(p, key); changed++; } }
      io.emit('chat', { system: true, text: me.name + ' set bot weapon mode to ' + key + ' (' + changed + ' bots)' });
      broadcastScores();
    } else if (cmd === 'botteam') {
      const arg = (parts[1] || '').toLowerCase();
      if (arg !== 'on' && arg !== 'off') { reply('Usage: /botteam <on|off>'); return; }
      botsCooperate = arg === 'on';
      io.emit('chat', { system: true, text: me.name + (botsCooperate ? ' made the bots team up against you' : ' let the bots go back to fighting each other') });
    } else if (cmd === 'bothacks') {
      const arg = (parts[1] || '').toLowerCase();
      if (arg !== 'on' && arg !== 'off') { reply('Usage: /bothacks <on|off>'); return; }
      botHacksEnabled = arg === 'on';
      io.emit('chat', { system: true, text: me.name + (botHacksEnabled ? ' gave the bots hacks (webs from anywhere, longer reach, more damage, faster hits, hovering)' : ' turned off bot hacks') });
    } else if (cmd === 'difficulty') {
      const key = (parts[1] || '').toLowerCase();
      if (!DIFFICULTY[key]) { reply('Usage: /difficulty <easy|normal|hard|random>'); return; }
      defaultDifficulty = key;
      let changed = 0;
      for (const p of players.values()) { if (p.bot && !p.dummy) { setBotDifficulty(p, key); changed++; } }
      io.emit('chat', { system: true, text: me.name + ' set difficulty to ' + key + ' (' + changed + ' bots)' });
      broadcastScores();
    } else if (cmd === 'botarmor') {
      const key = (parts[1] || '').toLowerCase();
      if (!MC.ARMOR_TIERS[key]) { reply('Usage: /botarmor <none|leather|iron|diamond|netherite>'); return; }
      defaultBotArmor = key;
      let changed = 0;
      for (const p of players.values()) { if (p.bot && !p.dummy) { setBotArmor(p, key); changed++; } }
      io.emit('chat', { system: true, text: me.name + ' set bot armor to ' + key + ' (' + changed + ' bots)' });
      broadcastScores();
    } else if (cmd === 'botdiff') {
      const key = (parts[parts.length - 1] || '').toLowerCase();
      const nameQuery = parts.slice(1, -1).join(' ').toLowerCase();
      if (!DIFFICULTY[key] || !nameQuery) { reply('Usage: /botdiff <bot name> <easy|normal|hard|random>'); return; }
      const target = [...players.values()].find(p => p.bot && !p.dummy && p.name.toLowerCase().includes(nameQuery));
      if (!target) { reply('No bot matching "' + nameQuery + '"'); return; }
      setBotDifficulty(target, key);
      io.emit('chat', { system: true, text: me.name + ' set ' + target.name + ' to ' + key });
      broadcastScores();
    } else if (cmd === 'dummy') {
      const want = clamp(parseInt(parts[1], 10) || 0, 0, 3);
      const shieldArg = (parts[2] || '').toLowerCase();
      const applyShield = shieldArg === 'shield' ? true : shieldArg === 'noshield' ? false : null;
      let have = [...players.values()].filter(p => p.dummy && !p.attackDummy).length;
      while (have < want) { addDummy(applyShield === null ? true : applyShield); have++; }
      while (have > want) { if (!removeDummy()) break; have--; }
      if (applyShield !== null) for (const p of players.values()) { if (p.dummy && !p.attackDummy) p.blocking = applyShield; }
      io.emit('chat', { system: true, text: me.name + ' set training dummies to ' + want + (applyShield === null ? '' : applyShield ? ' (shield on)' : ' (shield off)') });
    } else if (cmd === 'atkdummy') {
      const want = clamp(parseInt(parts[1], 10) || 0, 0, 3);
      let have = [...players.values()].filter(p => p.attackDummy).length;
      while (have < want) { addAttackDummy(); have++; }
      while (have > want) { if (!removeAttackDummy()) break; have--; }
      io.emit('chat', { system: true, text: me.name + ' set attacking dummies to ' + want });
    } else if (cmd === 'kill') {
      applyDamage(me, 999, null, 'suicide', 0, 0, 0);
    } else if (cmd === 'kill257') {
      // Secret, undocumented (not in /help) admin-style force-kill - same
      // "257" naming as /elytra257. Case-insensitive on the name (falls
      // back to a substring match, same leniency /botdiff already gives
      // partial bot names), or '@e' for everyone currently alive.
      const query = parts.slice(1).join(' ').trim();
      if (!query) { reply('Usage: /kill257 <name|@e>'); return; }
      let targets;
      if (query.toLowerCase() === '@e') {
        targets = [...players.values()].filter(p => p.alive);
      } else {
        const q = query.toLowerCase();
        const exact = [...players.values()].filter(p => p.alive && p.name.toLowerCase() === q);
        targets = exact.length ? exact : [...players.values()].filter(p => p.alive && p.name.toLowerCase().includes(q));
      }
      if (!targets.length) { reply('No player matching "' + query + '"'); return; }
      // A big, unarmored, un-blockable, un-totem-able hit - see applyDamage's
      // armor-reduction cause list (kill257 isn't in it) and the totem save
      // check right below (kill257 is excluded there, same as void).
      for (const target of targets) applyDamage(target, 9999, null, 'kill257', 0, 0, 0);
      reply('Killed ' + targets.length + (targets.length === 1 ? ' player.' : ' players.'));
    } else if (cmd === 'spawn') {
      const s = pick(spawns);
      me.x = s[0]; me.y = s[1]; me.z = s[2]; me.fallFrom = null;
      socket.emit('teleport', { x: me.x, y: me.y, z: me.z });
    } else if (cmd === 'arena') {
      const want = (parts[1] || '').toLowerCase();
      if (!want || !WorldGen.ARENAS[want]) {
        const list = WorldGen.ARENA_KEYS.map(k => k + ' (' + WorldGen.ARENAS[k].name + ')').join(', ');
        reply('Usage: /arena <' + WorldGen.ARENA_KEYS.join('|') + '>  -  ' + list);
        reply('Currently playing: ' + WorldGen.ARENAS[currentArena].name);
        return;
      }
      resetWorld(want);
      io.emit('worldReset', { seed: SEED, arena: currentArena });
      // Everyone has to be put back on the new layout - the old spawn ring
      // could easily be inside a wall, or mid-air, on a different arena.
      for (const p of players.values()) {
        const s2 = pick(spawns);
        p.x = s2[0]; p.y = s2[1]; p.z = s2[2];
        p.vx = p.vy = p.vz = 0;
        p.fallFrom = null; p.smashPeak = null;
        if (p.socket) p.socket.emit('teleport', { x: p.x, y: p.y, z: p.z });
      }
      // Wolves belong to the old map too; drop them rather than leave them
      // standing in whatever the new arena put where they were.
      for (const w of wolves.values()) io.emit('wolfDeath', { id: w.id });
      wolves.clear();
      io.emit('chat', { system: true, text: me.name + ' changed the arena to ' + WorldGen.ARENAS[currentArena].name });
    } else if (cmd === 'weather') {
      const kind = (parts[1] || '').toLowerCase();
      if (kind !== 'clear' && kind !== 'rain' && kind !== 'thunder') { reply('Usage: /weather <clear|rain|thunder>'); return; }
      weather = kind;
      weatherUntil = now() + rand(
        kind === 'clear' ? C.WEATHER_CLEAR_SECONDS[0] : kind === 'rain' ? C.WEATHER_RAIN_SECONDS[0] : C.WEATHER_THUNDER_SECONDS[0],
        kind === 'clear' ? C.WEATHER_CLEAR_SECONDS[1] : kind === 'rain' ? C.WEATHER_RAIN_SECONDS[1] : C.WEATHER_THUNDER_SECONDS[1]
      );
      io.emit('weather', { kind: weather });
      io.emit('chat', { system: true, text: me.name + ' set the weather to ' + weather });
    } else if (cmd === 'help') {
      reply('Commands: /bots <0-16> [difficulty] [armor] [kit] [weapon], /difficulty <easy|normal|hard|random>, /botarmor <none|leather|iron|diamond|netherite>, /botkit <sword|axe|web>, /botweapon <fixed|versatile|full>, /botteam <on|off>, /bothacks <on|off>, /kit <sword|axe|web>, /botdiff <name> <level>, /dummy <0-3> [shield|noshield], /atkdummy <0-3>, /weather <clear|rain|thunder>, /arena <classic|magma|skyward|frost>, /spawn, /kill, /help');
    } else {
      reply('Unknown command: ' + cmd + ' (try /help)');
    }
  }

  socket.on('disconnect', () => {
    if (!me) return;
    players.delete(me.id);
    io.emit('playerLeave', { id: me.id });
    io.emit('chat', { system: true, text: me.name + ' left the arena' });
    broadcastScores();
    me = null;
  });
});

function normalize(x, y, z) {
  x = +x; y = +y; z = +z;
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  const l = Math.hypot(x, y, z);
  if (l < 1e-6) return null;
  return [x / l, y / l, z / l];
}

for (let i = 0; i < BOT_COUNT; i++) addBot(defaultDifficulty);
setInterval(tick, 1000 / TICK_HZ);

// Bind explicitly to every interface (not just loopback) so other devices on
// the same network can reach this process, not just the machine running it.
server.listen(PORT, '0.0.0.0', () => {
  console.log('  Minecraft PvP  ->  http://localhost:' + PORT + '  (this machine only)');
  const nets = require('os').networkInterfaces();
  for (const name in nets) {
    for (const net of nets[name]) {
      // IPv4, non-internal (skips 127.0.0.1) - the address other devices on
      // the same Wi-Fi/LAN should actually use to join.
      if (net.family === 'IPv4' && !net.internal) {
        console.log('  Minecraft PvP  ->  http://' + net.address + ':' + PORT + '  (share this with other devices on your network)');
      }
    }
  }
  console.log('  seed=' + SEED + '  world=' + W.SX + 'x' + W.SY + 'x' + W.SZ + '  bots=' + BOT_COUNT + '  difficulty=' + defaultDifficulty);
});
