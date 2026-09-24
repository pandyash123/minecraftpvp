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
        if (d2 < 13 * 13 || d2 > (WALL_R - 3) * (WALL_R - 3)) continue;
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
    for (var i = 0; i < 7; i++) {
      var ang = (i / 7) * Math.PI * 2 + 0.6;
      var dist = i % 2 === 0 ? 11 : 20;
      var px = Math.round(CX + Math.cos(ang) * dist);
      var pz = Math.round(CZ + Math.sin(ang) * dist);
      var r = 2 + (i % 3);
      disc(blocks, px, pz, r + 1, GROUND, ID.OBSIDIAN);
      disc(blocks, px, pz, r, GROUND, ID.LAVA);
      disc(blocks, px, pz, r, GROUND - 1, ID.LAVA);
    }

    // Central stepped obsidian spire, walkable from every side.
    for (var t = 0; t < 5; t++) {
      var half = 8 - t * 2;
      box(blocks, CX - half, GROUND + 1 + t, CZ - half, CX + half, GROUND + 1 + t, CZ + half,
        t === 4 ? ID.GOLD : ID.OBSIDIAN);
    }
    box(blocks, CX - 1, GROUND + 6, CZ - 1, CX + 1, GROUND + 7, CZ + 1, ID.GLOWSTONE);

    // Obsidian pillars for cover, each topped with a light.
    for (var k = 0; k < 8; k++) {
      var a2 = (k / 8) * Math.PI * 2 + 0.2;
      var cx2 = Math.round(CX + Math.cos(a2) * 15);
      var cz2 = Math.round(CZ + Math.sin(a2) * 15);
      box(blocks, cx2 - 1, GROUND + 1, cz2 - 1, cx2 + 1, GROUND + 4, cz2 + 1, ID.OBSIDIAN);
      blocks[idx(cx2, GROUND + 5, cz2)] = ID.GLOWSTONE;
    }

    ringWall(blocks, WALL_R, GROUND - 2, GROUND + 10, ID.OBSIDIAN, null);
    // Lights set into the wall so the ring is readable at night.
    for (var w = 0; w < 16; w++) {
      var aw = (w / 16) * Math.PI * 2;
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
    var pts = [[CX, CZ, 9]];
    for (var i = 0; i < 5; i++) {
      var ang = (i / 5) * Math.PI * 2 + 0.4;
      pts.push([Math.round(CX + Math.cos(ang) * 19), Math.round(CZ + Math.sin(ang) * 19), 5]);
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
      for (var s = 0; s <= 40; s++) {
        var t2 = s / 40;
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
      var sx = CX + 12 - Math.round(st * 0.45);
      box(blocks, sx - 1, GROUND + st, CZ + 11, sx + 1, GROUND + st, CZ + 13, ID.COBBLE);
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
    flatGround(blocks, GROUND, ID.GLASS, ID.STONE);

    for (z = 0; z < SZ; z++) {
      for (x = 0; x < SX; x++) {
        var n = fbm(x / 11, z / 11, seed + 404, 3);
        if (n > 0.58) blocks[idx(x, GROUND, z)] = ID.WATER;
        else if (n < 0.4) blocks[idx(x, GROUND, z)] = ID.GRAVEL;
      }
    }

    // Snow drifts - walk-through cover that also cancels fall damage.
    for (var i = 0; i < 14; i++) {
      var ang = (i / 14) * Math.PI * 2 + 0.25;
      var dist = 10 + (i % 4) * 4;
      var px = Math.round(CX + Math.cos(ang) * dist);
      var pz = Math.round(CZ + Math.sin(ang) * dist);
      disc(blocks, px, pz, 2, GROUND + 1, ID.POWDER_SNOW);
      disc(blocks, px, pz, 1, GROUND + 2, ID.POWDER_SNOW);
    }

    // The keep: a hollow glass block with stone corner pillars and a roof
    // you can fight on.
    var h = 10, half = 7;
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
      if (here === ID.LAVA || above === ID.LAVA || above === ID.WATER) continue;
      pts.push([x + 0.5, y + 1.05, z + 0.5]);
    }
    return pts;
  }

  var ARENAS = {
    classic: { name: 'Ruined Keep', build: buildClassic, spawns: function (b) { return ringSpawns(b, 13, 20, 2.5); } },
    magma: { name: 'Magma Pit', build: buildMagma, spawns: function (b) { return ringSpawns(b, 16, 20, 1.5); } },
    skyward: { name: 'Skyward', build: buildSkyward, spawns: function (b) { return skywardSpawns(b); } },
    frost: { name: 'Frostbite', build: buildFrost, spawns: function (b) { return ringSpawns(b, 17, 20, 1.5); } }
  };
  var ARENA_KEYS = ['classic', 'magma', 'skyward', 'frost'];

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
