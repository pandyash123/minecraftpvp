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
  // Every arena was laid out for a 64-wide world; K scales those distances
  // to whatever MC.WORLD is now, so the old maps grow with it instead of
  // sitting in one corner of a bigger box.
  var K = SX / 64;
  function s(n) { return Math.round(n * K); }
  var WALL_R = s(28);

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
    var flat = clamp01(1 - Math.max(0, d - s(9)) / s(15));
    var hills = fbm(x / s(34), z / s(34), seed, 3);
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
    var baseHalf = s(9), topHalf = 3;
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
    for (var i = 0; i < 16; i++) {
      var ang = (i / 16) * Math.PI * 2 + 0.3;
      var dist = s(15) + (i % 3) * s(4);
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
    for (var i = 0; i < 8; i++) {
      var ang = (i / 8) * Math.PI * 2 + 1.1;
      var dist = s(19);
      var x = Math.round(CX + Math.cos(ang) * dist);
      var z = Math.round(CZ + Math.sin(ang) * dist);
      if (x < 4 || x > SX - 5 || z < 4 || z > SZ - 5) continue;
      var g = heightAt(x, z, seed);
      box(blocks, x - 1, g + 1, z - 1, x + 1, g + 3, z + 1, ID.COBWEB);
    }
  }

  // ------------------------------------------------------- arena: classic --
  /** The original arena: rolling grass, a terraced pyramid centrepiece and
   *  a crenellated ring wall. */
  function buildClassic(blocks, seed) {
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
        if (d2 < s(13) * s(13) || d2 > (WALL_R - 3) * (WALL_R - 3)) continue;
        if (hash2(x, z, seed + 4242) > 0.975) tree(blocks, x, th + 1, z, seed);
      }
    }

    centralPyramid(blocks);
    coverStructures(blocks, seed);
    cobwebClusters(blocks, seed);
    perimeterWall(blocks, seed);

    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }


  // ------------------------------------------------------- arena helpers --
  /** Flat bedrock floor + fill up to `top`, with `cap` on the surface. The
   *  shared base every non-classic arena starts from. */
  function flatGround(blocks, top, cap, fill) {
    var x, y, z;
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        for (y = 0; y <= top; y++) {
          blocks[idx(x, y, z)] = y === 0 ? ID.BEDROCK : (y === top ? cap : fill);
        }
      }
    }
  }

  /** A solid ring wall of `id` from `yFrom` to `yTo`, with four gateways
   *  left open so the arena reads as enclosed without being a sealed box.
   *  Same distance-based ring as perimeterWall, for the same reason: a
   *  square of four straight walls has confusing corners. */
  function ringWall(blocks, radius, yFrom, yTo, id, capId) {
    var gates = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (var z = 0; z < SZ; z++) {
      var dz = z - CZ;
      for (var x = 0; x < SX; x++) {
        var dx = x - CX;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < radius - 2 || d > radius + 1) continue;
        var ang = Math.atan2(dz, dx), isGate = false;
        for (var g = 0; g < gates.length; g++) {
          if (Math.abs(angleDiff(ang, gates[g])) < 0.11) { isGate = true; break; }
        }
        if (isGate) continue;
        for (var y = yFrom; y <= yTo; y++) blocks[idx(x, y, z)] = id;
        if (capId && yTo + 1 < SY) blocks[idx(x, yTo + 1, z)] = capId;
      }
    }
  }

  /** A filled disc of `id` at one height - islands, pools and platforms. */
  function disc(blocks, cx, cz, radius, y, id) {
    if (y < 0 || y >= SY) return;
    for (var z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
      if (z < 0 || z >= SZ) continue;
      for (var x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (x < 0 || x >= SX) continue;
        var dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz > radius * radius) continue;
        blocks[idx(x, y, z)] = id;
      }
    }
  }

  // -------------------------------------------------------- arena: magma --
  /** Obsidian plateau pocked with lava pools, ringed by an obsidian wall
   *  lit with glowstone. No trees, no soft ground - the hazard is the map. */
  function buildMagma(blocks, seed) {
    var x, z;
    flatGround(blocks, GROUND, ID.COBBLE, ID.STONE);

    // Scorched patches so the floor isn't a uniform grey sheet.
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var n = fbm(x / 9, z / 9, seed + 31, 2);
        if (n > 0.62) blocks[idx(x, GROUND, z)] = ID.OBSIDIAN;
        else if (n < 0.34) blocks[idx(x, GROUND, z)] = ID.GRAVEL;
      }
    }

    // Lava pools, sunk a block into the floor. Kept off the spawn ring
    // radius so nobody materialises standing in one.
    for (var i = 0; i < 10; i++) {
      var ang = (i / 10) * Math.PI * 2 + 0.6;
      var dist = i % 2 === 0 ? s(11) : s(20);
      var px = Math.round(CX + Math.cos(ang) * dist);
      var pz = Math.round(CZ + Math.sin(ang) * dist);
      var r = 2 + (i % 3);
      disc(blocks, px, pz, r + 1, GROUND, ID.OBSIDIAN);
      disc(blocks, px, pz, r, GROUND, ID.LAVA);
      disc(blocks, px, pz, r, GROUND - 1, ID.LAVA);
    }

    // Central stepped obsidian spire, walkable from every side.
    for (var t = 0; t < 5; t++) {
      var half = s(8) - t * 2;
      box(blocks, CX - half, GROUND + 1 + t, CZ - half, CX + half, GROUND + 1 + t, CZ + half,
        t === 4 ? ID.GOLD : ID.OBSIDIAN);
    }
    box(blocks, CX - 1, GROUND + 6, CZ - 1, CX + 1, GROUND + 7, CZ + 1, ID.GLOWSTONE);

    // Obsidian pillars for cover, each topped with a light.
    for (var k = 0; k < 12; k++) {
      var a2 = (k / 12) * Math.PI * 2 + 0.2;
      var cx2 = Math.round(CX + Math.cos(a2) * s(15));
      var cz2 = Math.round(CZ + Math.sin(a2) * s(15));
      box(blocks, cx2 - 1, GROUND + 1, cz2 - 1, cx2 + 1, GROUND + 4, cz2 + 1, ID.OBSIDIAN);
      blocks[idx(cx2, GROUND + 5, cz2)] = ID.GLOWSTONE;
    }

    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 10, ID.OBSIDIAN, null);
    // Lights set into the wall so the ring is readable at night.
    for (var w = 0; w < 24; w++) {
      var aw = (w / 24) * Math.PI * 2;
      var wx = Math.round(CX + Math.cos(aw) * (WALL_R - 2));
      var wz = Math.round(CZ + Math.sin(aw) * (WALL_R - 2));
      if (wx < 0 || wx >= SX || wz < 0 || wz >= SZ) continue;
      blocks[idx(wx, GROUND + 6, wz)] = ID.GLOWSTONE;
    }
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  // ------------------------------------------------------ arena: skyward --
  // Two tiers: a barren lower floor and a ring of floating islands linked by
  // plank bridges overhead. Deliberately NOT a true void map - with nothing
  // underneath, bots walk off the edge on a loop and hand out free kills.
  var SKY_Y = GROUND + 14;

  function skyIslands() {
    var pts = [[CX, CZ, s(9)]];
    for (var i = 0; i < 6; i++) {
      var ang = (i / 6) * Math.PI * 2 + 0.4;
      pts.push([Math.round(CX + Math.cos(ang) * s(20)), Math.round(CZ + Math.sin(ang) * s(20)), s(5)]);
    }
    return pts;
  }

  function buildSkyward(blocks, seed) {
    var x, z;
    flatGround(blocks, GROUND, ID.GRAVEL, ID.STONE);
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        if (fbm(x / 7, z / 7, seed + 77, 2) > 0.6) blocks[idx(x, GROUND, z)] = ID.COBBLE;
      }
    }

    var isles = skyIslands();
    for (var i = 0; i < isles.length; i++) {
      var ix = isles[i][0], iz = isles[i][1], r = isles[i][2];
      // Tapered underside so each island reads as a chunk of torn-up land
      // rather than a floating pancake.
      disc(blocks, ix, iz, r, SKY_Y, ID.GRASS);
      disc(blocks, ix, iz, r, SKY_Y - 1, ID.DIRT);
      disc(blocks, ix, iz, r - 1, SKY_Y - 2, ID.STONE);
      disc(blocks, ix, iz, r - 3, SKY_Y - 3, ID.STONE);
      if (i > 0 && hash2(ix, iz, seed + 5) > 0.45) tree(blocks, ix, SKY_Y + 1, iz, seed);
    }

    // Plank bridges from the centre island out to each satellite, drawn as
    // a 3-wide cross at each step so diagonal runs stay walkable.
    for (var b = 1; b < isles.length; b++) {
      var bx = isles[b][0], bz = isles[b][1];
      for (var st2 = 0; st2 <= 60; st2++) {
        var t2 = st2 / 60;
        var px = Math.round(CX + (bx - CX) * t2);
        var pz = Math.round(CZ + (bz - CZ) * t2);
        for (var w = -1; w <= 1; w++) {
          if (px + w >= 0 && px + w < SX) blocks[idx(px + w, SKY_Y, pz)] = ID.PLANKS;
          if (pz + w >= 0 && pz + w < SZ) blocks[idx(px, SKY_Y, pz + w)] = ID.PLANKS;
        }
      }
    }

    // A staircase from the floor up to the islands, so the top tier is
    // reachable without pearls.
    for (var st = 0; st <= SKY_Y - GROUND; st++) {
      var sx = CX + s(12) - Math.round(st * 0.45);
      box(blocks, sx - 1, GROUND + st, CZ + s(11), sx + 1, GROUND + st, CZ + s(11) + 2, ID.COBBLE);
    }

    box(blocks, CX - 1, SKY_Y + 1, CZ - 1, CX + 1, SKY_Y + 2, CZ + 1, ID.GLASS);
    blocks[idx(CX, SKY_Y + 3, CZ)] = ID.GOLD;

    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 7, ID.COBBLE, ID.BRICK);
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  // -------------------------------------------------------- arena: frost --
  /** A glass keep on a frozen lake: powder snow drifts break falls and
   *  smother fire, meltwater channels slow you down. */
  function buildFrost(blocks, seed) {
    var x, z;
    flatGround(blocks, GROUND, ID.ICE, ID.STONE);

    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var n = fbm(x / 11, z / 11, seed + 404, 3);
        if (n > 0.58) blocks[idx(x, GROUND, z)] = ID.WATER;
        else if (n < 0.4) blocks[idx(x, GROUND, z)] = ID.GRAVEL;
      }
    }

    // Snow drifts - walk-through cover that also cancels fall damage.
    for (var i = 0; i < 20; i++) {
      var ang = (i / 20) * Math.PI * 2 + 0.25;
      var dist = s(10) + (i % 4) * s(4);
      var px = Math.round(CX + Math.cos(ang) * dist);
      var pz = Math.round(CZ + Math.sin(ang) * dist);
      disc(blocks, px, pz, 2, GROUND + 1, ID.POWDER_SNOW);
      disc(blocks, px, pz, 1, GROUND + 2, ID.POWDER_SNOW);
    }

    // The keep: a hollow glass block with stone corner pillars and a roof
    // you can fight on.
    var h = 10, half = s(7);
    box(blocks, CX - half, GROUND + 1, CZ - half, CX + half, GROUND + h, CZ + half, ID.GLASS);
    box(blocks, CX - half + 1, GROUND + 1, CZ - half + 1, CX + half - 1, GROUND + h - 1, CZ + half - 1, ID.AIR);
    box(blocks, CX - 1, GROUND + 1, CZ - half, CX + 1, GROUND + 3, CZ - half, ID.AIR);
    box(blocks, CX - 1, GROUND + 1, CZ + half, CX + 1, GROUND + 3, CZ + half, ID.AIR);
    box(blocks, CX - half, GROUND + 1, CZ - 1, CX - half, GROUND + 3, CZ + 1, ID.AIR);
    box(blocks, CX + half, GROUND + 1, CZ - 1, CX + half, GROUND + 3, CZ + 1, ID.AIR);
    var corners = [[-half, -half], [-half, half], [half, -half], [half, half]];
    for (var c = 0; c < corners.length; c++) {
      box(blocks, CX + corners[c][0], GROUND + 1, CZ + corners[c][1],
        CX + corners[c][0], GROUND + h + 2, CZ + corners[c][1], ID.STONE);
    }
    box(blocks, CX - half, GROUND + h, CZ - half, CX + half, GROUND + h, CZ + half, ID.GLASS);
    blocks[idx(CX, GROUND + h + 1, CZ)] = ID.GOLD;
    // Snow piled inside, so dropping in through the roof is survivable.
    disc(blocks, CX, CZ, 3, GROUND + 1, ID.POWDER_SNOW);

    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 8, ID.STONE, ID.GLASS);
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  /** Distance from the arena centre. */
  function distC(x, z) { var dx = x - CX, dz = z - CZ; return Math.sqrt(dx * dx + dz * dz); }

  /** True if angle `ang` is within `half` radians of any of `list`. */
  function nearAngle(ang, list, half) {
    for (var i = 0; i < list.length; i++) if (Math.abs(angleDiff(ang, list[i])) < half) return true;
    return false;
  }

  /** A straight 3-wide walkway of `id` between two points at height y. */
  function walkway(blocks, x0, z0, x1, z1, y, id) {
    var steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))) * 2;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var px = Math.round(x0 + (x1 - x0) * t), pz = Math.round(z0 + (z1 - z0) * t);
      box(blocks, px - 1, y, pz - 1, px + 1, y, pz + 1, id);
    }
  }

  // --------------------------------------------------- arena: colosseum --
  /** A sunken sand pit ringed by a lava moat, inside a tiered stone bowl.
   *  Four bridges cross the moat; its banks are magma, so you don't want
   *  to linger at the edge. Fights start in the pit. */
  function buildColosseum(blocks, seed) {
    var x, y, z;
    flatGround(blocks, GROUND, ID.SAND, ID.STONE);
    var MOAT_IN = 16, MOAT_OUT = 20, STANDS = 23, OUTER = s(28);
    var bridges = [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4];
    var gates = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var d = distC(x, z), ang = Math.atan2(z - CZ, x - CX);
        if (d >= MOAT_IN && d < MOAT_OUT) {
          if (nearAngle(ang, bridges, 0.09)) { blocks[idx(x, GROUND, z)] = ID.BRICK; continue; }
          var bank = d < MOAT_IN + 1 || d >= MOAT_OUT - 1;
          blocks[idx(x, GROUND, z)] = bank ? ID.MAGMA : ID.LAVA;
          if (!bank) blocks[idx(x, GROUND - 1, z)] = ID.LAVA;
        } else if (d >= STANDS && d < OUTER) {
          // Stands: one step up every two blocks outward, broken by four
          // tunnels at the cardinal gates.
          var tier = Math.floor((d - STANDS) / 2) + 1;
          var gate = nearAngle(ang, gates, 0.07);
          for (y = GROUND + 1; y <= GROUND + tier; y++) {
            if (gate && y <= GROUND + 3) continue;
            blocks[idx(x, y, z)] = (tier % 2 === 0) ? ID.BRICK : ID.STONE;
          }
        } else if (d >= OUTER && d < OUTER + 3) {
          for (y = GROUND + 1; y <= GROUND + 14; y++) blocks[idx(x, y, z)] = ID.STONE;
          if (Math.floor((ang + Math.PI) / (Math.PI / 12)) % 2 === 0) blocks[idx(x, GROUND + 15, z)] = ID.BRICK;
        }
      }
    }
    // Torches along the top of the stands.
    for (var w = 0; w < 24; w++) {
      var a = (w / 24) * Math.PI * 2;
      blocks[idx(Math.round(CX + Math.cos(a) * (OUTER - 1)), GROUND + Math.floor((OUTER - 1 - STANDS) / 2) + 2, Math.round(CZ + Math.sin(a) * (OUTER - 1)))] = ID.GLOWSTONE;
    }
    // Central dais with a gold crown, and low cover walls in the pit.
    disc(blocks, CX, CZ, 5, GROUND + 1, ID.BRICK);
    disc(blocks, CX, CZ, 3, GROUND + 2, ID.BRICK);
    blocks[idx(CX, GROUND + 3, CZ)] = ID.GOLD;
    for (var c = 0; c < 6; c++) {
      var ca = (c / 6) * Math.PI * 2 + 0.5;
      var cx = Math.round(CX + Math.cos(ca) * 9), cz = Math.round(CZ + Math.sin(ca) * 9);
      box(blocks, cx - 1, GROUND + 1, cz, cx + 1, GROUND + 2, cz, ID.STONE);
    }
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  // ------------------------------------------------------ arena: temple --
  /** A stepped jungle temple in a moat, with four watch towers joined to
   *  its summit by high walkways. Slime pits under the walkways turn a
   *  knock-off into a bounce instead of a death. */
  function buildTemple(blocks, seed) {
    var x, z;
    flatGround(blocks, GROUND, ID.GRASS, ID.DIRT);
    // Moat.
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var d = distC(x, z);
        if (d >= 17 && d < 20 && !nearAngle(Math.atan2(z - CZ, x - CX), [0, Math.PI / 2, Math.PI, -Math.PI / 2], 0.1)) {
          blocks[idx(x, GROUND, z)] = ID.WATER;
          blocks[idx(x, GROUND - 1, z)] = ID.WATER;
        }
      }
    }
    // Temple: five square steps, cobble and stone alternating.
    var levels = 6;
    for (var i = 0; i < levels; i++) {
      var half = 13 - i * 2;
      box(blocks, CX - half, GROUND + 1 + i * 2, CZ - half, CX + half, GROUND + 2 + i * 2, CZ + half, i % 2 ? ID.STONE : ID.COBBLE);
    }
    var summit = GROUND + levels * 2;
    // A shrine on top: leaf-roofed, glowstone lit.
    box(blocks, CX - 2, summit + 1, CZ - 2, CX + 2, summit + 1, CZ + 2, ID.BRICK);
    box(blocks, CX - 2, summit + 4, CZ - 2, CX + 2, summit + 4, CZ + 2, ID.LEAVES);
    var posts = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
    for (var p = 0; p < posts.length; p++) box(blocks, CX + posts[p][0], summit + 2, CZ + posts[p][1], CX + posts[p][0], summit + 3, CZ + posts[p][1], ID.LOG);
    blocks[idx(CX, summit + 2, CZ)] = ID.GLOWSTONE;

    // Watch towers at the diagonals: a stepped base you can walk up, a
    // platform, and a walkway back to the temple summit.
    var TD = 27, towerTop = summit;
    for (var t = 0; t < 4; t++) {
      var ta = Math.PI / 4 + t * Math.PI / 2;
      var tx = Math.round(CX + Math.cos(ta) * TD), tz = Math.round(CZ + Math.sin(ta) * TD);
      for (var k = 0; k <= towerTop - GROUND - 1; k++) {
        var th = Math.max(2, 6 - Math.floor(k / 2));
        box(blocks, tx - th, GROUND + 1 + k, tz - th, tx + th, GROUND + 1 + k, tz + th, ID.COBBLE);
      }
      box(blocks, tx - 3, towerTop, tz - 3, tx + 3, towerTop, tz + 3, ID.PLANKS);
      walkway(blocks, tx, tz, CX + Math.round(Math.cos(ta) * 3), CZ + Math.round(Math.sin(ta) * 3), towerTop, ID.PLANKS);
      // Slime pit under the middle of the walkway.
      var mx = Math.round(CX + Math.cos(ta) * 20), mz = Math.round(CZ + Math.sin(ta) * 20);
      disc(blocks, mx, mz, 3, GROUND, ID.SLIME);
    }
    // Jungle trees in the outer ring.
    for (z = 3; z < SZ - 3; z++) {
      for (x = 3; x < SX - 3; x++) {
        var dd = distC(x, z);
        if (dd < 34 || dd > WALL_R - 3) continue;
        if (hash2(x, z, seed + 2626) > 0.96) tree(blocks, x, GROUND + 1, z, seed);
      }
    }
    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 6, ID.COBBLE, ID.LEAVES);
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  // -------------------------------------------------- arena: soul valley --
  /** A Nether valley: soul sand fields that bog you down, glowing magma
   *  veins that burn, basalt-dark pillars, lavafalls pouring down the rim
   *  and a brick fortress in the middle to fight over. */
  function buildSoulValley(blocks, seed) {
    var x, y, z;
    flatGround(blocks, GROUND, ID.SOUL_SAND, ID.STONE);
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var n = fbm(x / 10, z / 10, seed + 666, 3);
        // Magma follows a thin band of the noise, so it forms veins rather
        // than blobs; gravel and cobble break up the soul sand elsewhere.
        if (Math.abs(n - 0.5) < 0.025) blocks[idx(x, GROUND, z)] = ID.MAGMA;
        else if (n > 0.64) blocks[idx(x, GROUND, z)] = ID.GRAVEL;
        else if (n < 0.33) blocks[idx(x, GROUND, z)] = ID.COBBLE;
      }
    }
    // Basalt-style pillars: obsidian columns of uneven height, some bridged.
    for (var i = 0; i < 18; i++) {
      var pa = hash2(i, 7, seed + 11) * Math.PI * 2;
      var pd = 14 + hash2(i, 9, seed + 13) * 22;
      var px = Math.round(CX + Math.cos(pa) * pd), pz = Math.round(CZ + Math.sin(pa) * pd);
      var ph = 5 + Math.floor(hash2(i, 3, seed + 17) * 10);
      box(blocks, px - 1, GROUND + 1, pz - 1, px + 1, GROUND + ph, pz + 1, ID.OBSIDIAN);
      blocks[idx(px, GROUND + ph + 1, pz)] = ID.GLOWSTONE;
    }
    // Fortress: a hollow brick hall with open ends and a walkable roof.
    var hx = 10, hz = 6, hh = 7;
    box(blocks, CX - hx, GROUND + 1, CZ - hz, CX + hx, GROUND + hh, CZ + hz, ID.BRICK);
    box(blocks, CX - hx + 1, GROUND + 1, CZ - hz + 1, CX + hx - 1, GROUND + hh - 1, CZ + hz - 1, ID.AIR);
    box(blocks, CX - hx, GROUND + 1, CZ - 2, CX - hx, GROUND + 4, CZ + 2, ID.AIR);
    box(blocks, CX + hx, GROUND + 1, CZ - 2, CX + hx, GROUND + 4, CZ + 2, ID.AIR);
    for (var wi = -hx + 3; wi <= hx - 3; wi += 4) {
      box(blocks, CX + wi, GROUND + 3, CZ - hz, CX + wi + 1, GROUND + 4, CZ - hz, ID.AIR);
      box(blocks, CX + wi, GROUND + 3, CZ + hz, CX + wi + 1, GROUND + 4, CZ + hz, ID.AIR);
    }
    // Stairs up to the roof on the south side.
    for (var st = 0; st < hh; st++) box(blocks, CX - 2, GROUND + 1 + st, CZ + hz + hh - st, CX + 2, GROUND + 1 + st, CZ + hz + hh - st, ID.COBBLE);
    box(blocks, CX - 1, GROUND + hh + 1, CZ - 1, CX + 1, GROUND + hh + 1, CZ + 1, ID.GLOWSTONE);

    // Rim wall with lavafalls pouring down the inside face into pools.
    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 12, ID.OBSIDIAN, null);
    for (var f = 0; f < 10; f++) {
      var fa = (f / 10) * Math.PI * 2 + 0.3;
      var fx = Math.round(CX + Math.cos(fa) * (WALL_R - 3)), fz = Math.round(CZ + Math.sin(fa) * (WALL_R - 3));
      for (y = GROUND + 1; y <= GROUND + 12; y++) blocks[idx(fx, y, fz)] = ID.LAVA;
      disc(blocks, fx, fz, 1.5, GROUND, ID.LAVA);
    }
    box(blocks, 0, 0, 0, SX - 1, 0, SZ - 1, ID.BEDROCK);
  }

  // ------------------------------------------------------ arena: canyon --
  // Laid out along Z instead of around a centre point: two cliff tops with
  // a river gorge between them.
  var CLIFF_W = 30, CLIFF_H = 12;

  /** Two grassy cliffs either side of a river gorge, joined by bridges.
   *  Waterfalls pour off both cliffs; the north end is frozen over, and
   *  slime ledges at the cliff foot soften a fall into the gorge. */
  function buildCanyon(blocks, seed) {
    var x, y, z;
    var gorge0 = CLIFF_W, gorge1 = SX - CLIFF_W - 1;
    var top = GROUND + CLIFF_H;
    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var inGorge = x >= gorge0 && x <= gorge1;
        // A little wobble so the cliff edges aren't ruler-straight.
        var wob = Math.round((fbm(z / 8, x < CX ? 1 : 9, seed + 55, 2) - 0.5) * 4);
        if (inGorge && (x < gorge0 + 2 + wob || x > gorge1 - 2 + wob)) inGorge = false;
        var h = inGorge ? GROUND - 2 : top;
        for (y = 0; y <= h; y++) {
          blocks[idx(x, y, z)] = y === 0 ? ID.BEDROCK : y === h ? (inGorge ? ID.SAND : ID.GRASS) : (y > h - 3 ? ID.DIRT : ID.STONE);
        }
        if (inGorge) {
          var mid = Math.abs(x - CX);
          if (mid <= 6) { blocks[idx(x, GROUND - 2, z)] = ID.WATER; blocks[idx(x, GROUND - 1, z)] = ID.WATER; blocks[idx(x, GROUND, z)] = ID.WATER; }
          else if (mid <= 8) blocks[idx(x, GROUND - 2, z)] = ID.GRAVEL;
        }
        // Frozen north end: the river and the cliff tops ice over.
        if (z < 22) {
          if (blocks[idx(x, GROUND, z)] === ID.WATER) blocks[idx(x, GROUND, z)] = ID.ICE;
          if (!inGorge && hash2(x, z, seed + 88) > 0.4) blocks[idx(x, top, z)] = ID.ICE;
        }
      }
    }
    // Waterfalls: water columns down both cliff faces.
    for (var wf = 0; wf < 6; wf++) {
      var wz = 28 + wf * 11;
      var left = wf % 2 === 0;
      var fx = left ? gorge0 + 1 : gorge1 - 1;
      for (y = GROUND - 1; y <= top; y++) { blocks[idx(fx, y, wz)] = ID.WATER; blocks[idx(fx, y, wz + 1)] = ID.WATER; }
    }
    // Slime ledges at the foot of each cliff.
    for (var sl = 0; sl < 5; sl++) {
      var sz = 18 + sl * 16;
      box(blocks, gorge0 + 3, GROUND - 2, sz, gorge0 + 5, GROUND - 2, sz + 3, ID.SLIME);
      box(blocks, gorge1 - 5, GROUND - 2, sz + 8, gorge1 - 3, GROUND - 2, sz + 11, ID.SLIME);
    }
    // Three bridges at cliff height; the middle one has a gap to jump.
    var bz = [20, 48, 76];
    for (var b = 0; b < bz.length; b++) {
      box(blocks, gorge0 - 1, top, bz[b] - 1, gorge1 + 1, top, bz[b] + 1, ID.PLANKS);
      if (b === 1) box(blocks, CX - 1, top, bz[b] - 1, CX + 1, top, bz[b] + 1, ID.AIR);
      // Rope-style side rails.
      box(blocks, gorge0 - 1, top + 1, bz[b] - 2, gorge1 + 1, top + 1, bz[b] - 2, ID.LOG);
      box(blocks, gorge0 - 1, top + 1, bz[b] + 2, gorge1 + 1, top + 1, bz[b] + 2, ID.LOG);
      if (b === 1) {
        box(blocks, CX - 1, top + 1, bz[b] - 2, CX + 1, top + 1, bz[b] - 2, ID.AIR);
        box(blocks, CX - 1, top + 1, bz[b] + 2, CX + 1, top + 1, bz[b] + 2, ID.AIR);
      }
    }
    // Trails down into the gorge at both ends so it's not a one-way trip.
    for (var sd = 0; sd <= CLIFF_H + 2; sd++) {
      box(blocks, gorge0 + sd, top - sd, SZ - 8, gorge0 + sd, top - sd, SZ - 5, ID.COBBLE);
      box(blocks, gorge1 - sd, top - sd, 5, gorge1 - sd, top - sd, 8, ID.COBBLE);
    }
    // Trees and rock cover on the cliff tops.
    for (z = 4; z < SZ - 4; z++) {
      for (x = 3; x < SX - 3; x++) {
        if (x >= gorge0 - 3 && x <= gorge1 + 3) continue;
        var r = hash2(x, z, seed + 404);
        if (z >= 24 && r > 0.975) tree(blocks, x, top + 1, z, seed);
        else if (r < 0.006) box(blocks, x, top + 1, z, x + 1, top + 2, z + 1, ID.COBBLE);
      }
    }
    // Low boundary wall around the edge of the map.
    box(blocks, 0, top + 1, 0, SX - 1, top + 2, 0, ID.COBBLE);
    box(blocks, 0, top + 1, SZ - 1, SX - 1, top + 2, SZ - 1, ID.COBBLE);
    box(blocks, 0, top + 1, 0, 0, top + 2, SZ - 1, ID.COBBLE);
    box(blocks, SX - 1, top + 1, 0, SX - 1, top + 2, SZ - 1, ID.COBBLE);
  }

  /** Canyon spawns: spread along both cliff tops, facing across the gorge. */
  function canyonSpawns(blocks) {
    var pts = [];
    for (var i = 0; i < 12; i++) {
      var z = 26 + (i >> 1) * 11;
      var x = i % 2 === 0 ? 14 : SX - 15;
      var y = surfaceY(blocks, x, z);
      var here = blocks[idx(x, y, z)];
      if (here === ID.WATER || here === ID.LAVA) continue;
      pts.push([x + 0.5, y + 1.05, z + 0.5]);
    }
    return pts;
  }

  // Topmost solid block at a column (used for spawn placement).
  function surfaceY(blocks, x, z) {
    for (var y = SY - 1; y >= 0; y--) {
      var b = blocks[idx(x, y, z)];
      if (b !== ID.AIR && MC.SOLID[b]) return y;
    }
    return 1;
  }

  /** Ring of candidate spawns at `dist` from the centre, dropped onto
   *  whatever is solid beneath and rejected if that lands in lava or water -
   *  an arena with pools would otherwise spawn people straight into them. */
  function ringSpawns(blocks, dist, count, spread) {
    var pts = [];
    for (var i = 0; i < count; i++) {
      var ang = (i / count) * Math.PI * 2;
      var d = dist + (i % 4) * (spread || 0);
      var x = Math.max(2, Math.min(SX - 3, Math.round(CX + Math.cos(ang) * d)));
      var z = Math.max(2, Math.min(SZ - 3, Math.round(CZ + Math.sin(ang) * d)));
      var y = surfaceY(blocks, x, z);
      var here = blocks[idx(x, y, z)];
      var above = y + 1 < SY ? blocks[idx(x, y + 1, z)] : ID.AIR;
      if (here === ID.LAVA || here === ID.MAGMA || above === ID.LAVA || above === ID.WATER) continue;
      pts.push([x + 0.5, y + 1.05, z + 0.5]);
    }
    return pts;
  }

  var ARENAS = {
    classic: { name: 'Ruined Keep', build: buildClassic, spawns: function (b) { return ringSpawns(b, s(13), 24, 2.5); } },
    magma: { name: 'Magma Pit', build: buildMagma, spawns: function (b) { return ringSpawns(b, s(16), 24, 1.5); } },
    skyward: { name: 'Skyward', build: buildSkyward, spawns: function (b) { return skywardSpawns(b); } },
    frost: { name: 'Frostbite', build: buildFrost, spawns: function (b) { return ringSpawns(b, s(17), 24, 1.5); } },
    colosseum: { name: 'Lava Colosseum', build: buildColosseum, spawns: function (b) { return ringSpawns(b, 11, 16, 1); } },
    temple: { name: 'Slime Temple', build: buildTemple, spawns: function (b) { return ringSpawns(b, 30, 24, 1.5); } },
    soulvalley: { name: 'Soul Valley', build: buildSoulValley, spawns: function (b) { return ringSpawns(b, 20, 24, 3); } },
    canyon: { name: 'Waterfall Canyon', build: buildCanyon, spawns: function (b) { return canyonSpawns(b); } }
  };
  var ARENA_KEYS = ['classic', 'magma', 'skyward', 'frost', 'colosseum', 'temple', 'soulvalley', 'canyon'];

  /** Skyward spawns people on the islands themselves - a ring spawn would
   *  drop everyone on the empty lower floor and nobody would find the map. */
  function skywardSpawns(blocks) {
    var pts = [], isles = skyIslands();
    for (var i = 1; i < isles.length; i++) {
      var ix = isles[i][0], iz = isles[i][1];
      for (var k = 0; k < 4; k++) {
        var a = (k / 4) * Math.PI * 2;
        var x = Math.max(2, Math.min(SX - 3, Math.round(ix + Math.cos(a) * 2)));
        var z = Math.max(2, Math.min(SZ - 3, Math.round(iz + Math.sin(a) * 2)));
        pts.push([x + 0.5, surfaceY(blocks, x, z) + 1.05, z + 0.5]);
      }
    }
    return pts;
  }

  function arenaKey(key) {
    return ARENAS[key] ? key : 'classic';
  }

  // ------------------------------------------------------------ generate --
  function generate(seed, arena) {
    seed = seed | 0;
    var blocks = new Uint8Array(SX * SY * SZ);
    ARENAS[arenaKey(arena)].build(blocks, seed);
    return blocks;
  }

  function spawnPoints(blocks, seed, arena) {
    var pts = ARENAS[arenaKey(arena)].spawns(blocks, seed);
    if (!pts.length) pts.push([CX + 0.5, GROUND + 2, CZ + 0.5]);
    return pts;
  }

  return {
    generate: generate,
    heightAt: heightAt,
    surfaceY: surfaceY,
    spawnPoints: spawnPoints,
    idx: idx,
    ARENAS: ARENAS,
    ARENA_KEYS: ARENA_KEYS,
    arenaKey: arenaKey
  };
});
