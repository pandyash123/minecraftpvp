/*
 * Deterministic arena generation. The server and every client run this with
 * the same seed, so only block *edits* ever have to travel over the wire.
 *
 * Layout: a compact, fully solid, walled-in arena (no ocean, no floating
 * islands) with a terraced pyramid centrepiece players can walk straight up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./blocks.js'));
  else root.MCWorldGen = factory(root.MCBlocks);
})(typeof self !== 'undefined' ? self : globalThis, function (MC) {
  'use strict';

  var W = MC.WORLD, ID = MC.ID;
  var SX = W.SX, SY = W.SY, SZ = W.SZ;
  var CX = SX / 2, CZ = SZ / 2;
  var GROUND = 8;
  var WALL_R = 28;

  function idx(x, y, z) { return (y * SZ + z) * SX + x; }

  // ------------------------------------------------------------- noise ----
  // Overflow-safe 32-bit integer hash (Math.imul keeps every intermediate
  // value inside a safe int32 range, unlike naive float multiplication which
  // silently loses all precision for seeds this large).
  function hash2(x, z, seed) {
    var h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function valueNoise(x, z, seed) {
    var x0 = Math.floor(x), z0 = Math.floor(z);
    var fx = smooth(x - x0), fz = smooth(z - z0);
    var a = hash2(x0, z0, seed), b = hash2(x0 + 1, z0, seed);
    var c = hash2(x0, z0 + 1, seed), d = hash2(x0 + 1, z0 + 1, seed);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }

  function fbm(x, z, seed, octaves) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += valueNoise(x * freq, z * freq, seed + i * 7919) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /** Height of the terrain surface at x,z: gentle rolling ground, flattened
   *  to a perfectly level floor near the arena centre for fair fights. */
  function heightAt(x, z, seed) {
    var dx = x - CX, dz = z - CZ;
    var d = Math.sqrt(dx * dx + dz * dz);
    var flat = clamp01(1 - Math.max(0, d - 9) / 15);
    var hills = fbm(x / 34, z / 34, seed, 3);
    var rough = Math.round(GROUND + (hills - 0.5) * 6);
    var h = Math.round(rough * (1 - flat) + GROUND * flat);
    return Math.max(2, Math.min(SY - 14, h));
  }

  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

  // ---------------------------------------------------------- structures --
  function box(blocks, x0, y0, z0, x1, y1, z1, id) {
    if (x0 > x1) { var t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { var t2 = y0; y0 = y1; y1 = t2; }
    if (z0 > z1) { var t3 = z0; z0 = z1; z1 = t3; }
    for (var y = y0; y <= y1; y++) {
      if (y < 0 || y >= SY) continue;
      for (var z = z0; z <= z1; z++) {
        if (z < 0 || z >= SZ) continue;
        for (var x = x0; x <= x1; x++) {
          if (x < 0 || x >= SX) continue;
          blocks[idx(x, y, z)] = id;
        }
      }
    }
  }

  function tree(blocks, x, y, z, seed) {
    var h = 4 + Math.floor(hash2(x, z, seed + 991) * 3);
    for (var i = 0; i < h; i++) {
      if (y + i < SY) blocks[idx(x, y + i, z)] = ID.LOG;
    }
    var top = y + h;
    for (var dy = -2; dy <= 1; dy++) {
      var r = dy <= -1 ? 2 : 1;
      for (var dz = -r; dz <= r; dz++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy > -1) continue;
          var bx = x + dx, by = top + dy, bz = z + dz;
          if (bx < 0 || bx >= SX || bz < 0 || bz >= SZ || by < 0 || by >= SY) continue;
          if (blocks[idx(bx, by, bz)] === ID.AIR) blocks[idx(bx, by, bz)] = ID.LEAVES;
        }
      }
    }
  }

  /** Solid terraced pyramid centrepiece — walkable from any side, no
   *  floating or disconnected geometry (every layer sits on solid fill). */
  function centralPyramid(blocks) {
    var baseHalf = 9, topHalf = 3;
    var layers = baseHalf - topHalf + 1;
    for (var i = 0; i < layers; i++) {
      var half = baseHalf - i;
      var y = GROUND + 1 + i;
      var mat = i === layers - 1 ? ID.BRICK : (i % 2 === 0 ? ID.COBBLE : ID.STONE);
      box(blocks, CX - half, y, CZ - half, CX + half, y, CZ + half, mat);
    }
    var topY = GROUND + layers;
    box(blocks, CX - 1, topY + 1, CZ - 1, CX + 1, topY + 3, CZ + 1, ID.GLASS);
    box(blocks, CX, topY + 1, CZ, CX, topY + 4, CZ, ID.GOLD);
  }

  /** Perimeter wall: a solid crenellated ring that visually contains the
   *  arena so the map reads as one enclosed space, not terrain trailing off.
   *  Built as a true ring (distance-based, not a square) so there's no
   *  confusing corner where two straight walls meet and appear disjointed. */
  function perimeterWall(blocks, seed) {
    var r = WALL_R, thickness = 2;
    var top = GROUND + 9;
    // 4 gate angles (N/E/S/W), each a few degrees wide, left open.
    var gateAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    var gateHalfWidth = 0.11; // radians

    for (var z = 0; z < SZ; z++) {
      var dz = z - CZ;
      for (var x = 0; x < SX; x++) {
        var dx = x - CX;
        var d = Math.sqrt(dx * dx + dz * dz);
        // Band is wider than the nominal thickness: rounding a continuous
        // circle onto an integer grid scatters points roughly r-0.7..r+0.7,
        // so a band that only spans up to r (with no allowance above it)
        // leaves rasterization gaps at almost every other angle.
        if (d < r - thickness || d > r + 1) continue;
        var ang = Math.atan2(dz, dx);
        var isGate = false;
        for (var g = 0; g < gateAngles.length; g++) {
          var diff = angleDiff(ang, gateAngles[g]);
          if (Math.abs(diff) < gateHalfWidth) { isGate = true; break; }
        }
        if (isGate) continue;
        for (var y = GROUND - 2; y <= top; y++) blocks[idx(x, y, z)] = ID.COBBLE;
        // crenellation: merlon every ~45 degrees around the ring
        var merlon = Math.floor(((ang + Math.PI) / (Math.PI / 8))) % 2 === 0;
        if (merlon && d > r - 1.4) blocks[idx(x, top + 1, z)] = ID.BRICK;
      }
    }
  }

  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Small scattered cover blocks so the ring around the pyramid isn't open ground. */
  function coverStructures(blocks, seed) {
    for (var i = 0; i < 10; i++) {
      var ang = (i / 10) * Math.PI * 2 + 0.3;
      var dist = 15 + (i % 3) * 4;
      var x = Math.round(CX + Math.cos(ang) * dist);
      var z = Math.round(CZ + Math.sin(ang) * dist);
      if (x < 4 || x > SX - 5 || z < 4 || z > SZ - 5) continue;
      var g = heightAt(x, z, seed);
      var mat = (i % 2 === 0) ? ID.COBBLE : ID.PLANKS;
      box(blocks, x - 1, g + 1, z - 1, x + 1, g + 2, z + 1, mat);
    }
  }

  /**
   * A handful of cobweb patches scattered around the ring - a slow-you-down
   * hazard/trap for PvP (walk-through, no collision, but movement is
   * smothered while inside). Placed on a different angle/radius than the
   * cover structures so the two don't overlap.
   */
  function cobwebClusters(blocks, seed) {
    for (var i = 0; i < 5; i++) {
      var ang = (i / 5) * Math.PI * 2 + 1.1;
      var dist = 19;
      var x = Math.round(CX + Math.cos(ang) * dist);
      var z = Math.round(CZ + Math.sin(ang) * dist);
      if (x < 4 || x > SX - 5 || z < 4 || z > SZ - 5) continue;
      var g = heightAt(x, z, seed);
      box(blocks, x - 1, g + 1, z - 1, x + 1, g + 3, z + 1, ID.COBWEB);
    }
  }

  // ------------------------------------------------------------ generate --
  function generate(seed) {
    seed = seed | 0;
    var blocks = new Uint8Array(SX * SY * SZ);
    var x, y, z;

    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var h = heightAt(x, z, seed);
        for (y = 0; y <= h; y++) {
          var b;
          if (y === 0) b = ID.BEDROCK;
          else if (y === h) b = ID.GRASS;
          else if (y > h - 4) b = ID.DIRT;
          else {
            b = ID.STONE;
            var o = hash2(x * 3 + y * 17, z * 5 + y * 23, seed + 5501);
            if (y < 7 && o > 0.988) b = ID.IRON_ORE;
            else if (o > 0.982) b = ID.GRAVEL;
          }
          blocks[idx(x, y, z)] = b;
        }
      }
    }

    // trees in the ring between the pyramid and the perimeter wall
    for (z = 2; z < SZ - 2; z++) {
      for (x = 2; x < SX - 2; x++) {
        var th = heightAt(x, z, seed);
        if (blocks[idx(x, th, z)] !== ID.GRASS) continue;
        var dx = x - CX, dz = z - CZ;
        var d2 = dx * dx + dz * dz;
        if (d2 < 13 * 13 || d2 > (WALL_R - 3) * (WALL_R - 3)) continue;
        if (hash2(x, z, seed + 4242) > 0.975) tree(blocks, x, th + 1, z, seed);
      }
    }

    centralPyramid(blocks);
    coverStructures(blocks, seed);
    cobwebClusters(blocks, seed);
    perimeterWall(blocks, seed);

    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
    return blocks;
  }

  // Topmost solid block at a column (used for spawn placement).
  function surfaceY(blocks, x, z) {
    for (var y = SY - 1; y >= 0; y--) {
      var b = blocks[idx(x, y, z)];
      if (b !== ID.AIR && MC.SOLID[b]) return y;
    }
    return 1;
  }

  function spawnPoints(blocks, seed) {
    var pts = [];
    for (var i = 0; i < 20; i++) {
      var ang = (i / 20) * Math.PI * 2;
      var dist = 13 + (i % 4) * 2.5;
      var x = Math.round(CX + Math.cos(ang) * dist);
      var z = Math.round(CZ + Math.sin(ang) * dist);
      x = Math.max(2, Math.min(SX - 3, x));
      z = Math.max(2, Math.min(SZ - 3, z));
      var y = surfaceY(blocks, x, z);
      pts.push([x + 0.5, y + 1.05, z + 0.5]);
    }
    if (!pts.length) pts.push([CX, GROUND + 2, CZ]);
    return pts;
  }

  return {
    generate: generate,
    heightAt: heightAt,
    surfaceY: surfaceY,
    spawnPoints: spawnPoints,
    idx: idx
  };
});
