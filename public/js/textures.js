/*
 * Everything the game draws is painted procedurally at boot: the 16x16 block
 * tiles, player skins and the hotbar icons. Keeps the game asset-free.
 */
(function (global) {
  'use strict';

  const MC = global.MCBlocks;
  const T = MC.T;
  const TILE = 16;
  // Custom armor/shield trims: grid size + hex palette live in shared/blocks.js
  // (MC.TRIM_GRID/TRIM_PALETTE/isValidTrim) since the server also needs to
  // validate an incoming trim payload - see MC.isValidTrim there.
  const TRIM_GRID = MC.TRIM_GRID;
  const TRIM_PALETTE = MC.TRIM_PALETTE;

  // ------------------------------------------------------------- rng ------
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function hex(c) {
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }

  // A tile is a flat RGBA Uint8Array of TILE*TILE*4.
  function newTile() { return new Uint8Array(TILE * TILE * 4); }

  function px(t, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    t[i] = r; t[i + 1] = g; t[i + 2] = b; t[i + 3] = a === undefined ? 255 : a;
  }

  function fill(t, color, noise, seed) {
    const [r, g, b] = hex(color);
    const rnd = rng(seed);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = (rnd() - 0.5) * 2 * (noise || 0);
        px(t, x, y, clamp255(r + n), clamp255(g + n), clamp255(b + n), 255);
      }
    }
    return t;
  }

  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }

  function blobs(t, color, count, size, seed, alpha) {
    const [r, g, b] = hex(color);
    const rnd = rng(seed);
    for (let i = 0; i < count; i++) {
      const cx = (rnd() * TILE) | 0, cy = (rnd() * TILE) | 0;
      const s = 1 + ((rnd() * size) | 0);
      for (let y = -s; y <= s; y++) {
        for (let x = -s; x <= s; x++) {
          if (x * x + y * y > s * s) continue;
          const n = (rnd() - 0.5) * 24;
          px(t, cx + x, cy + y, clamp255(r + n), clamp255(g + n), clamp255(b + n), alpha === undefined ? 255 : alpha);
        }
      }
    }
    return t;
  }

  /**
   * Chunky pixel-art bevel: lightens the top/left edge, darkens the
   * bottom/right edge. Applied per-tile, this reads as a visible seam at
   * every block boundary once tiled across a wall - without it, a big flat
   * surface of one material looks like a single smeared blob instead of
   * distinct blocks (skips fully transparent pixels so holes/edges in
   * leaves and glass aren't affected).
   */
  function applyBevel(t, edgeLight, edgeDark) {
    edgeLight = edgeLight === undefined ? 20 : edgeLight;
    edgeDark = edgeDark === undefined ? 30 : edgeDark;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * TILE + x) * 4;
        if (t[i + 3] === 0) continue;
        let delta = 0;
        if (x === 0 || y === 0) delta += edgeLight;
        if (x === TILE - 1 || y === TILE - 1) delta -= edgeDark;
        if (!delta) continue;
        t[i] = clamp255(t[i] + delta);
        t[i + 1] = clamp255(t[i + 1] + delta);
        t[i + 2] = clamp255(t[i + 2] + delta);
      }
    }
  }

  function buildTiles() {
    const tiles = [];
    for (let i = 0; i < T.TILE_COUNT; i++) tiles[i] = newTile();

    // grass top
    fill(tiles[T.GRASS_TOP], '#5b8f3a', 18, 7);
    blobs(tiles[T.GRASS_TOP], '#6ea342', 26, 1, 13);
    blobs(tiles[T.GRASS_TOP], '#4c7c30', 20, 1, 29);

    // dirt
    fill(tiles[T.DIRT], '#8a6142', 16, 3);
    blobs(tiles[T.DIRT], '#7a5238', 18, 1, 11);
    blobs(tiles[T.DIRT], '#9a7050', 12, 1, 23);

    // grass side = dirt with a ragged green cap
    tiles[T.GRASS_SIDE].set(tiles[T.DIRT]);
    {
      const rnd = rng(77);
      const [r, g, b] = hex('#5b8f3a');
      for (let x = 0; x < TILE; x++) {
        const h = 3 + ((rnd() * 3) | 0);
        for (let y = 0; y < h; y++) {
          const n = (rnd() - 0.5) * 26;
          px(tiles[T.GRASS_SIDE], x, y, clamp255(r + n), clamp255(g + n), clamp255(b + n), 255);
        }
      }
    }

    // stone
    fill(tiles[T.STONE], '#87878a', 18, 5);
    blobs(tiles[T.STONE], '#75757a', 16, 2, 19);
    blobs(tiles[T.STONE], '#9c9ca0', 12, 2, 31);
    blobs(tiles[T.STONE], '#68686c', 6, 1, 37);

    // cobblestone: dark mortar base, individually-shaded stones with a
    // darker outline around each one so the grid of blocks stays readable
    // even when many cobble blocks are tiled together on a wall.
    fill(tiles[T.COBBLE], '#4a4a4a', 8, 41);
    {
      const rnd = rng(53);
      const stones = [[1, 1, 6, 5], [8, 1, 6, 4], [1, 7, 4, 4], [6, 6, 4, 5], [11, 6, 4, 4], [1, 12, 6, 3], [8, 11, 7, 4]];
      for (const [sx, sy, sw, sh] of stones) {
        const base = 118 + rnd() * 50;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const edge = x === 0 || y === 0 || x === sw - 1 || y === sh - 1;
            const n = (rnd() - 0.5) * 22;
            const v = clamp255(base + n - (edge ? 26 : 0));
            px(tiles[T.COBBLE], sx + x, sy + y, v, v, v, 255);
          }
        }
      }
    }

    // logs
    fill(tiles[T.LOG_SIDE], '#6b4f2a', 8, 61);
    {
      const rnd = rng(67);
      for (let x = 0; x < TILE; x++) {
        if (rnd() > 0.55) continue;
        const v = 70 + rnd() * 40;
        for (let y = 0; y < TILE; y++) {
          px(tiles[T.LOG_SIDE], x, y, clamp255(v + 30), clamp255(v + 12), clamp255(v - 12), 255);
        }
      }
    }
    fill(tiles[T.LOG_TOP], '#a8814b', 10, 71);
    for (let ring = 1; ring < 8; ring += 2) {
      for (let a = 0; a < 64; a++) {
        const ang = (a / 64) * Math.PI * 2;
        px(tiles[T.LOG_TOP], (8 + Math.cos(ang) * ring) | 0, (8 + Math.sin(ang) * ring) | 0, 120, 88, 48, 255);
      }
    }

    // leaves (with holes so they read as foliage)
    {
      const t = tiles[T.LEAVES];
      const rnd = rng(83);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const v = rnd();
          if (v < 0.16) { px(t, x, y, 0, 0, 0, 0); continue; }
          const g = 96 + v * 70;
          px(t, x, y, clamp255(g * 0.42), clamp255(g), clamp255(g * 0.36), 255);
        }
      }
    }

    fill(tiles[T.SAND], '#ded2a0', 12, 97);
    blobs(tiles[T.SAND], '#d2c48c', 12, 1, 101);

    // water (alpha handled by the shader, keep it opaque-ish here)
    fill(tiles[T.WATER], '#2f5fd0', 10, 103);
    blobs(tiles[T.WATER], '#3d72e0', 10, 2, 107);

    // lava: dark base with bright molten cracks
    fill(tiles[T.LAVA], '#8a2c0a', 10, 211);
    blobs(tiles[T.LAVA], '#ff7a1a', 14, 2, 223);
    blobs(tiles[T.LAVA], '#ffcf3a', 6, 1, 229);

    // planks
    fill(tiles[T.PLANKS], '#a9834e', 9, 109);
    for (let y = 0; y < TILE; y++) {
      if (y % 4 === 3) for (let x = 0; x < TILE; x++) px(tiles[T.PLANKS], x, y, 108, 80, 44, 255);
    }
    {
      const rnd = rng(113);
      for (let i = 0; i < 10; i++) {
        const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
        px(tiles[T.PLANKS], x, y, 128, 96, 56, 255);
      }
    }

    // glass: transparent centre, visible frame
    {
      const t = tiles[T.GLASS];
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
          if (edge) px(t, x, y, 205, 230, 240, 235);
          else if ((x + y) % 11 === 0) px(t, x, y, 235, 248, 255, 90);
          else px(t, x, y, 220, 240, 250, 26);
        }
      }
    }

    fill(tiles[T.BEDROCK], '#4a4a4a', 22, 127);
    blobs(tiles[T.BEDROCK], '#2c2c2c', 16, 2, 131);
    blobs(tiles[T.BEDROCK], '#6a6a6a', 10, 1, 137);

    fill(tiles[T.OBSIDIAN], '#170f24', 8, 139);
    blobs(tiles[T.OBSIDIAN], '#3a2b56', 8, 1, 149);

    fill(tiles[T.GRAVEL], '#7f7a74', 16, 151);
    blobs(tiles[T.GRAVEL], '#605c58', 16, 1, 157);
    blobs(tiles[T.GRAVEL], '#9a948c', 12, 1, 163);

    fill(tiles[T.IRON], '#d8d8d8', 8, 167);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (x === 0 || y === 0) px(tiles[T.IRON], x, y, 240, 240, 240, 255);
      if (x === TILE - 1 || y === TILE - 1) px(tiles[T.IRON], x, y, 165, 165, 165, 255);
    }
    fill(tiles[T.GOLD], '#f2d24a', 8, 173);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (x === 0 || y === 0) px(tiles[T.GOLD], x, y, 255, 232, 120, 255);
      if (x === TILE - 1 || y === TILE - 1) px(tiles[T.GOLD], x, y, 190, 150, 40, 255);
    }

    // bricks
    fill(tiles[T.BRICK], '#9c5b46', 6, 179);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const row = (y / 4) | 0;
        const off = (row % 2) * 4;
        if (y % 4 === 0 || (x + off) % 8 === 0) px(tiles[T.BRICK], x, y, 186, 178, 168, 255);
      }
    }

    tiles[T.IRON_ORE].set(tiles[T.STONE]);
    blobs(tiles[T.IRON_ORE], '#c7a17a', 5, 1, 191);
    tiles[T.GOLD_ORE].set(tiles[T.STONE]);
    blobs(tiles[T.GOLD_ORE], '#f0cc4a', 5, 1, 193);

    // cobweb: mostly transparent, fine diagonal lattice of pale threads
    {
      const t = tiles[T.COBWEB];
      const rnd = rng(197);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const a = (x + y) % 4, b = ((x - y) + TILE * 4) % 4;
          const onThread = a === 0 || b === 0;
          if (!onThread) { px(t, x, y, 0, 0, 0, 0); continue; }
          const shade = 215 + rnd() * 30;
          px(t, x, y, shade, shade, shade + 4, 235);
        }
      }
    }

    // TNT: red field, a beige stripe with a dashed fuse-line through it, same
    // silhouette on every face (no separate top/side art needed here).
    {
      const t = tiles[T.TNT];
      fill(t, '#c23a2a', 8, 233);
      const bandY0 = (TILE * 0.4) | 0, bandY1 = (TILE * 0.62) | 0;
      for (let y = bandY0; y < bandY1; y++) {
        for (let x = 0; x < TILE; x++) px(t, x, y, 214, 198, 158, 255);
      }
      const midY = ((bandY0 + bandY1) / 2) | 0;
      for (let x = 0; x < TILE; x++) {
        if ((x >> 1) % 2 === 0) { px(t, x, midY, 30, 26, 22, 255); px(t, x, midY - 1, 30, 26, 22, 255); }
      }
      const rnd = rng(239);
      for (let i = 0; i < 10; i++) {
        const x = (rnd() * TILE) | 0;
        const y = rnd() < 0.5 ? (rnd() * bandY0) | 0 : bandY1 + (rnd() * (TILE - bandY1)) | 0;
        px(t, x, y, 90, 22, 14, 255);
      }
    }
    // TNT Minecart: same red/fuse motif, wrapped in a dark metal cart frame
    // border so it reads as the bigger, cart-mounted variant at a glance.
    {
      const t = tiles[T.TNT_MINECART];
      t.set(tiles[T.TNT]);
      const frame = 2;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const edge = x < frame || y < frame || x >= TILE - frame || y >= TILE - frame;
          if (edge) px(t, x, y, 46, 46, 50, 255);
        }
      }
    }

    // Rail: wooden tie base with two parallel metal rails running across.
    {
      const t = tiles[T.RAIL];
      fill(t, '#7a5a34', 8, 251);
      for (let y = 0; y < TILE; y++) {
        if (y % 4 === 1 || y % 4 === 2) {
          for (let x = 0; x < TILE; x++) px(t, x, y, 90, 66, 38, 255);
        }
      }
      for (const rx of [4, 11]) {
        for (let y = 0; y < TILE; y++) {
          px(t, rx, y, 176, 178, 182, 255);
          px(t, rx + 1, y, 132, 134, 138, 255);
        }
      }
    }

    // Powder snow: near-white with a faint blue-grey speckle, soft (no bevel).
    fill(tiles[T.POWDER_SNOW], '#eef3f7', 6, 263);
    blobs(tiles[T.POWDER_SNOW], '#d8e4ec', 10, 1, 269);

    // End Crystal: glassy pink/white core - soft (no bevel), matches its
    // glowing, non-opaque look in-world.
    fill(tiles[T.END_CRYSTAL], '#f3d9f7', 4, 401);
    blobs(tiles[T.END_CRYSTAL], '#ffffff', 18, 2, 409);
    blobs(tiles[T.END_CRYSTAL], '#c88cd8', 8, 1, 419);

    // Respawn Anchor: dark purple stone with a glowing crystalline top.
    fill(tiles[T.RESPAWN_ANCHOR], '#2a1830', 10, 431);
    blobs(tiles[T.RESPAWN_ANCHOR], '#3d2246', 14, 1, 439);
    blobs(tiles[T.RESPAWN_ANCHOR], '#9a4ad8', 6, 1, 449);

    // Glowstone: warm yellow, blotchy like real vanilla glowstone.
    fill(tiles[T.GLOWSTONE], '#e8c25a', 10, 461);
    blobs(tiles[T.GLOWSTONE], '#fff0a0', 12, 2, 469);
    blobs(tiles[T.GLOWSTONE], '#c9963a', 8, 1, 479);

    // Slime block: bright translucent-looking green with a darker core.
    fill(tiles[T.SLIME], '#76c95a', 6, 501);
    blobs(tiles[T.SLIME], '#9ee07e', 10, 2, 509);
    {
      const t = tiles[T.SLIME];
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px(t, x, y, 84, 160, 62, 255);
      for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) px(t, x, y, 96, 178, 72, 255);
    }

    // Soul sand: dark brown with faint screaming-face hollows.
    fill(tiles[T.SOUL_SAND], '#5a4332', 12, 521);
    blobs(tiles[T.SOUL_SAND], '#3e2d22', 10, 1, 529);
    {
      const t = tiles[T.SOUL_SAND];
      for (const [fx, fy] of [[3, 4], [10, 9]]) {
        px(t, fx, fy, 38, 27, 20, 255); px(t, fx + 2, fy, 38, 27, 20, 255);
        px(t, fx, fy + 2, 38, 27, 20, 255); px(t, fx + 1, fy + 2, 38, 27, 20, 255); px(t, fx + 2, fy + 2, 38, 27, 20, 255);
      }
    }

    // Magma block: near-black crust split by glowing orange cracks.
    fill(tiles[T.MAGMA], '#4a1e0e', 10, 541);
    {
      const t = tiles[T.MAGMA];
      const rnd = rng(547);
      for (let l = 0; l < 6; l++) {
        let x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
        for (let i = 0; i < 9; i++) {
          px(t, x, y, 255, 140, 40, 255);
          x += ((rnd() * 3) | 0) - 1; y += ((rnd() * 3) | 0) - 1;
          if (x < 0 || y < 0 || x >= TILE || y >= TILE) break;
        }
      }
    }

    // Ice: pale blue with long diagonal glints.
    fill(tiles[T.ICE], '#9cc8f2', 5, 561);
    {
      const t = tiles[T.ICE];
      for (let i = 0; i < TILE; i++) {
        px(t, i, (i + 3) % TILE, 222, 240, 255, 255);
        px(t, i, (i + 10) % TILE, 200, 228, 252, 255);
      }
    }

    // break overlay stages 0..9 (transparent + growing dark cracks)
    for (let s = 0; s < 10; s++) {
      const t = tiles[T.CRACKS + s];
      const rnd = rng(9001 + s);
      const lines = 1 + s;
      for (let l = 0; l < lines; l++) {
        let x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
        const steps = 4 + s * 2;
        for (let i = 0; i < steps; i++) {
          px(t, x, y, 12, 12, 12, 190);
          px(t, x + 1, y, 30, 30, 30, 110);
          x += ((rnd() * 3) | 0) - 1;
          y += ((rnd() * 3) | 0) - 1;
          if (x < 0 || y < 0 || x >= TILE || y >= TILE) break;
        }
      }
    }

    // Bevel every solid, fully-opaque tile so individual blocks stay visually
    // distinct when tiled across a wall/floor - skip tiles that already have
    // their own border treatment (IRON, GOLD), transparency holes (LEAVES),
    // shader-blended tiles (WATER, GLASS), and the break-overlay layers.
    [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT, T.STONE, T.COBBLE, T.LOG_SIDE, T.LOG_TOP,
      T.SAND, T.PLANKS, T.BEDROCK, T.OBSIDIAN, T.GRAVEL, T.BRICK, T.IRON_ORE, T.GOLD_ORE, T.TNT, T.TNT_MINECART, T.RAIL,
      T.RESPAWN_ANCHOR, T.GLOWSTONE, T.SOUL_SAND, T.MAGMA]
      .forEach(idx => applyBevel(tiles[idx]));

    return tiles;
  }

  /** Uploads all tiles as one GL_TEXTURE_2D_ARRAY (no atlas bleeding). */
  function createBlockTexture(gl) {
    const tiles = buildTiles();
    const layers = tiles.length;
    const data = new Uint8Array(TILE * TILE * 4 * layers);
    for (let i = 0; i < layers; i++) data.set(tiles[i], i * TILE * TILE * 4);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, TILE, TILE, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, tiles };
  }

  // ------------------------------------------------------------ skins -----
  // Classic 64x64 skin layout helper: returns the six face rects of a box.
  function boxUV(u, v, w, h, d) {
    return {
      top: [u + d, v, w, d],
      bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h],
      front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h],
      back: [u + d + w + d, v + d, w, h]
    };
  }

  const SKIN_PARTS = {
    head: boxUV(0, 0, 8, 8, 8),
    body: boxUV(16, 16, 8, 12, 4),
    armR: boxUV(40, 16, 4, 12, 4),
    armL: boxUV(32, 48, 4, 12, 4),
    legR: boxUV(0, 16, 4, 12, 4),
    legL: boxUV(16, 48, 4, 12, 4)
  };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function hsl(h, s, l) { return 'hsl(' + (h | 0) + ',' + (s | 0) + '%,' + (l | 0) + '%)'; }

  function paintSkin(name) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 64, 64);

    const h = hashStr(name || 'player');
    const rnd = rng(h || 1);
    const shirtHue = (h % 360);
    const pantsHue = (shirtHue + 140 + rnd() * 60) % 360;
    const skinTones = ['#f0c8a0', '#e0ac7a', '#c68642', '#8d5524', '#ffdbac', '#5a3a22'];
    const skin = skinTones[h % skinTones.length];
    const hair = ['#2b1a0e', '#553311', '#111111', '#7a4a20', '#c9a227'][(h >> 3) % 5];
    const shirt = hsl(shirtHue, 55 + rnd() * 25, 45 + rnd() * 12);
    const shirtDark = hsl(shirtHue, 55, 34);
    const pants = hsl(pantsHue, 40, 34);
    const shoes = '#3a3a3a';

    function rect(r, color) { g.fillStyle = color; g.fillRect(r[0], r[1], r[2], r[3]); }
    function noise(r, amount, seed) {
      const rr = rng(seed);
      const img = g.getImageData(r[0], r[1], r[2], r[3]);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rr() - 0.5) * amount;
        img.data[i] = clamp255(img.data[i] + n);
        img.data[i + 1] = clamp255(img.data[i + 1] + n);
        img.data[i + 2] = clamp255(img.data[i + 2] + n);
      }
      g.putImageData(img, r[0], r[1]);
    }

    // head
    const H = SKIN_PARTS.head;
    for (const k of ['top', 'bottom', 'right', 'front', 'left', 'back']) rect(H[k], skin);
    rect(H.top, hair);
    rect(H.back, hair);
    // hair fringe + sides
    g.fillStyle = hair;
    g.fillRect(H.front[0], H.front[1], 8, 2);
    g.fillRect(H.right[0], H.right[1], 8, 2);
    g.fillRect(H.left[0], H.left[1], 8, 2);
    // eyes
    g.fillStyle = '#ffffff';
    g.fillRect(H.front[0] + 1, H.front[1] + 3, 2, 2);
    g.fillRect(H.front[0] + 5, H.front[1] + 3, 2, 2);
    g.fillStyle = ['#3b5ea8', '#4b3421', '#2e7d4f'][(h >> 7) % 3];
    g.fillRect(H.front[0] + 2, H.front[1] + 3, 1, 2);
    g.fillRect(H.front[0] + 5, H.front[1] + 3, 1, 2);
    // mouth
    g.fillStyle = 'rgba(90,50,40,0.75)';
    g.fillRect(H.front[0] + 3, H.front[1] + 6, 2, 1);
    noise(H.front, 14, h + 1);

    // body
    const B = SKIN_PARTS.body;
    for (const k of ['top', 'bottom', 'right', 'front', 'left', 'back']) rect(B[k], shirt);
    rect(B.right, shirtDark);
    rect(B.left, shirtDark);
    // belt
    g.fillStyle = '#40332a';
    g.fillRect(B.front[0], B.front[1] + 10, 8, 2);
    g.fillRect(B.back[0], B.back[1] + 10, 8, 2);
    noise(B.front, 12, h + 2);

    // arms: sleeve on top, bare hand at the bottom
    for (const key of ['armR', 'armL']) {
      const A = SKIN_PARTS[key];
      for (const k of ['top', 'bottom', 'right', 'front', 'left', 'back']) rect(A[k], shirt);
      for (const k of ['right', 'front', 'left', 'back']) {
        const r = A[k];
        g.fillStyle = skin;
        g.fillRect(r[0], r[1] + 8, r[2], 4);
      }
      rect(A.bottom, skin);
      noise(A.front, 12, h + 3);
    }

    // legs
    for (const key of ['legR', 'legL']) {
      const L = SKIN_PARTS[key];
      for (const k of ['top', 'bottom', 'right', 'front', 'left', 'back']) rect(L[k], pants);
      for (const k of ['right', 'front', 'left', 'back']) {
        const r = L[k];
        g.fillStyle = shoes;
        g.fillRect(r[0], r[1] + 10, r[2], 2);
      }
      rect(L.bottom, shoes);
      noise(L.front, 10, h + 4);
    }

    return cv;
  }

  function createSkinTexture(gl, name) {
    const cv = paintSkin(name);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // Armor layer texture: a flat material color (matching MC.ARMOR_TIERS) -
  // this is drawn as its own inflated box shell over the body (see
  // MCEntities.armorParts / Renderer.drawArmorLayer), not a tint on the
  // skin, so it reads as "wearing plates" rather than "recolored".
  const ARMOR_COLORS = { leather: '#8a5a2e', chainmail: '#7c8088', iron: '#d3d5d8', diamond: '#3fd0c9', netherite: '#17161a' };
  const ARMOR_FLECKS = { leather: '#c9915a', chainmail: '#3c3f45', iron: '#ffffff', diamond: '#c8fff9', netherite: '#6a5a52' };
  function paintArmor(tier, pieceKey, faceGrids) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const [r, gr, b] = hex(ARMOR_COLORS[tier] || ARMOR_COLORS.iron);
    const rnd = rng(hashStr(tier) || 1);
    const img = g.createImageData(64, 64);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 20;
      img.data[i] = clamp255(r + n);
      img.data[i + 1] = clamp255(gr + n);
      img.data[i + 2] = clamp255(b + n);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // sparse bright flecks (rivets / gem glints) so it doesn't read as flat plastic
    g.fillStyle = ARMOR_FLECKS[tier] || '#ffffff';
    const flecks = rng((hashStr(tier) || 1) + 7);
    for (let i = 0; i < 90; i++) {
      if (flecks() > 0.12) continue;
      g.fillRect((flecks() * 64) | 0, (flecks() * 64) | 0, 1, 1);
    }
    // A player-painted trim (see game.js's customize-trims editor) is
    // stamped on top of the tier's own noise/flecks, once per face of the
    // piece being painted - so a design wraps identically around all six
    // sides rather than being sliced up by the atlas layout. Index 0 ("no
    // paint") leaves the base tier texture showing through untouched, which
    // is also what makes the base visible underneath in the editor.
    if (pieceKey && faceGrids) {
      for (const { face, rect } of pieceFaceRects(pieceKey)) {
        if (MC.isValidTrim(faceGrids[face])) stampTrim(g, faceGrids[face], rect);
      }
    }
    return cv;
  }

  /** Every atlas face rect belonging to one armor piece, tagged with which
   * side it is so each can take its own painted grid. Boots and leggings
   * deliberately share the same rects - they get separate textures (see
   * Renderer.getPieceArmorTexture), so the overlap never collides. */
  const PIECE_PARTS = {
    helmet: ['head'],
    chest: ['body', 'armR', 'armL'],
    legs: ['legR', 'legL'],
    boots: ['legR', 'legL']
  };
  const FACE_ORDER = MC.TRIM_FACES;
  function pieceFaceRects(pieceKey) {
    const out = [];
    for (const part of (PIECE_PARTS[pieceKey] || [])) {
      const uv = SKIN_PARTS[part];
      for (const face of FACE_ORDER) out.push({ face, rect: uv[face] });
    }
    return out;
  }

  /** Paints a trim grid to fill one atlas face rect, skipping "no paint". */
  function stampTrim(g, grid, rect) {
    const [ru, rv, rw, rh] = rect;
    const cw = rw / MC.TRIM_GRID, ch = rh / MC.TRIM_GRID;
    for (let ty = 0; ty < MC.TRIM_GRID; ty++) {
      for (let tx = 0; tx < MC.TRIM_GRID; tx++) {
        const idx = grid[ty * MC.TRIM_GRID + tx];
        if (!idx) continue;
        g.fillStyle = TRIM_PALETTE[idx];
        // Overdraw by a hair: adjacent cells at fractional sizes otherwise
        // leave hairline seams of base texture between them.
        g.fillRect(ru + tx * cw, rv + ty * ch, cw + 0.5, ch + 0.5);
      }
    }
  }

  /**
   * Wolf pelt: pale grey-white fur with a real face painted into the head's
   * front atlas face (eyes, brows, snout, nose) instead of the flat
   * featureless colour block wolves used to render as. An armored wolf keeps
   * the same fur and face and gets a steel vest over the body/tail region
   * only, rather than the whole animal turning a solid armor colour.
   */
  function paintWolf(armored) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    const rnd = rng(hashStr('wolf_fur') || 97);
    const img = g.createImageData(64, 64);
    const [fr, fg, fb] = hex('#e3e1dc'); // pale wolf grey-white
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 26;
      img.data[i] = clamp255(fr + n);
      img.data[i + 1] = clamp255(fg + n);
      img.data[i + 2] = clamp255(fb + n);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    // Darker grey guard hairs, so the pelt reads as fur not paint.
    const flecks = rng(1337);
    g.fillStyle = '#b4b1aa';
    for (let i = 0; i < 220; i++) {
      if (flecks() > 0.35) continue;
      g.fillRect((flecks() * 64) | 0, (flecks() * 64) | 0, 1, 1);
    }

    if (armored) {
      // Steel vest across the torso only - the body part's own atlas faces.
      for (const f of FACE_ORDER) {
        const [u, v, w, h] = SKIN_PARTS.body[f];
        g.fillStyle = '#6b7a84';
        g.fillRect(u, v, w, h);
        g.fillStyle = '#93a3ad';
        g.fillRect(u, v, w, Math.max(1, h * 0.18));
      }
    }

    // Face, painted into the head's front face rect (the wolf looks -Z).
    const [hu, hv, hw, hh] = SKIN_PARTS.head.front;
    const px = hw / 8, py = hh / 8; // the rect is an 8x8 "skin pixel" face
    const fill = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(hu + x * px, hv + y * py, w * px, h * py); };
    fill(1, 2, 2, 2, '#2b2b2f');       // left eye
    fill(5, 2, 2, 2, '#2b2b2f');       // right eye
    fill(1.5, 2.4, 0.8, 0.8, '#d9d7d2'); // eye glints
    fill(5.5, 2.4, 0.8, 0.8, '#d9d7d2');
    fill(0.8, 1.4, 2.4, 0.6, '#a9a69f'); // brows
    fill(4.8, 1.4, 2.4, 0.6, '#a9a69f');
    fill(2.6, 4.4, 2.8, 2.2, '#cfccc5'); // snout
    fill(3.2, 4.8, 1.6, 1.2, '#26262a'); // nose
    return cv;
  }

  /**
   * Creeper hide: mottled green, with the classic face painted into the
   * head's front atlas face. A charged creeper keeps the same face but
   * takes on the electric blue-white cast that warns you it's the one
   * that will take a chunk out of the map.
   */
  function paintCreeper(charged) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    const base = charged ? '#4fd8e8' : '#5bab48';
    const dark = charged ? '#2b7f95' : '#3d7a33';
    const rnd = rng(hashStr(charged ? 'creeper_charged' : 'creeper') || 7);
    const [r0, g0, b0] = hex(base);
    const img = g.createImageData(64, 64);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 34;
      img.data[i] = clamp255(r0 + n);
      img.data[i + 1] = clamp255(g0 + n);
      img.data[i + 2] = clamp255(b0 + n);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blotch = rng(4242);
    g.fillStyle = dark;
    for (let i = 0; i < 260; i++) {
      if (blotch() > 0.4) continue;
      g.fillRect((blotch() * 64) | 0, (blotch() * 64) | 0, 1 + ((blotch() * 2) | 0), 1 + ((blotch() * 2) | 0));
    }

    // The face, on the head's front rect (the model looks -Z).
    const [hu, hv, hw, hh] = SKIN_PARTS.head.front;
    const px = hw / 8, py = hh / 8;
    const fill = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(hu + x * px, hv + y * py, w * px, h * py); };
    fill(1, 2, 2, 2, '#0c1410');   // eyes
    fill(5, 2, 2, 2, '#0c1410');
    fill(3, 4, 2, 2, '#0c1410');   // nose/mouth block
    fill(2, 5, 1, 2, '#0c1410');   // ...and its two fangs
    fill(5, 5, 1, 2, '#0c1410');
    return cv;
  }

  function createCreeperTexture(gl, charged) {
    return uploadNearest(gl, paintCreeper(charged));
  }

  function createWolfTexture(gl, armored) {
    return uploadNearest(gl, paintWolf(armored));
  }

  function uploadNearest(gl, cv) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function createArmorTexture(gl, tier, pieceKey, faceGrids) {
    return uploadNearest(gl, paintArmor(tier, pieceKey, faceGrids));
  }

  /** Name plate rendered to a texture. Returns {tex, w, h, aspect}. */
  function createLabelTexture(gl, text, color) {
    const pad = 8, fontSize = 32;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = 'bold ' + fontSize + 'px monospace';
    const w = Math.ceil(measure.measureText(text).width) + pad * 2;
    const h = fontSize + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, w, h);
    g.font = 'bold ' + fontSize + 'px monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillText(text, w / 2 + 2, h / 2 + 2);
    g.fillStyle = color || '#ffffff';
    g.fillText(text, w / 2, h / 2);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w, h, aspect: w / h };
  }

  // ------------------------------------------------------- item icons -----
  function tileCanvas(tiles, index) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TILE;
    const g = cv.getContext('2d');
    const img = g.createImageData(TILE, TILE);
    img.data.set(tiles[index]);
    g.putImageData(img, 0, 0);
    return cv;
  }

  function blockIcon(tiles, blockId, size) {
    const S = size || 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const top = tileCanvas(tiles, MC.TILES[blockId * 6 + 2]);
    const side = tileCanvas(tiles, MC.TILES[blockId * 6 + 0]);

    function face(img, ox, oy, ux, uy, vx, vy, shade) {
      g.save();
      g.setTransform(ux, uy, vx, vy, ox, oy);
      g.drawImage(img, 0, 0, 1, 1);
      g.restore();
      if (shade < 1) {
        g.save();
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(0,0,0,' + (1 - shade) + ')';
        g.setTransform(ux, uy, vx, vy, ox, oy);
        g.fillRect(0, 0, 1, 1);
        g.restore();
      }
    }
    const p = S * 0.06;
    const w = S - p * 2;
    // top, left, right faces of an isometric cube
    face(top, p, p + w * 0.25, w * 0.5, -w * 0.25, w * 0.5, w * 0.25, 1.0);
    face(side, p, p + w * 0.25, w * 0.5, w * 0.25, 0, w * 0.5, 0.72);
    face(side, p + w * 0.5, p + w * 0.5, w * 0.5, -w * 0.25, 0, w * 0.5, 0.55);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return cv;
  }

  // Liquid/glint colour pairs per potion, roughly matching vanilla's own
  // per-effect potion colours.
  const POTION_COLORS = {
    pot_strength: ['#e8c22a', '#fff29a'],
    pot_speed: ['#3fa9d6', '#bfe8ff'],
    pot_fireres: ['#e07a1a', '#ffcf7a'],
    pot_turtle: ['#3a5a2a', '#8fce6a'],
    pot_health: ['#e0432a', '#ff9a8a'],
    pot_invis: ['#8f8f9c', '#d8d8e4']
  };

  /** Classic Minecraft-shaped potion bottle: narrow neck, rounded body, a
   * liquid fill colour and a small glint. */
  function potionBottle(g, S, u, colors) {
    const [liquid, glint] = colors;
    const outline = () => {
      g.beginPath();
      g.moveTo(S * 0.42, S * 0.18); g.lineTo(S * 0.58, S * 0.18); g.lineTo(S * 0.58, S * 0.32);
      g.quadraticCurveTo(S * 0.78, S * 0.42, S * 0.78, S * 0.62);
      g.quadraticCurveTo(S * 0.78, S * 0.92, S * 0.5, S * 0.92);
      g.quadraticCurveTo(S * 0.22, S * 0.92, S * 0.22, S * 0.62);
      g.quadraticCurveTo(S * 0.22, S * 0.42, S * 0.42, S * 0.32);
      g.closePath();
    };
    g.fillStyle = 'rgba(255,255,255,0.15)';
    outline(); g.fill();
    g.fillStyle = liquid;
    g.beginPath();
    g.moveTo(S * 0.24, S * 0.55);
    g.quadraticCurveTo(S * 0.24, S * 0.9, S * 0.5, S * 0.9);
    g.quadraticCurveTo(S * 0.76, S * 0.9, S * 0.76, S * 0.55);
    g.lineTo(S * 0.24, S * 0.55);
    g.closePath();
    g.fill();
    g.fillStyle = '#8a6a3a';
    g.fillRect(S * 0.42, S * 0.08, S * 0.16, S * 0.12);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = Math.max(1, u * 0.4);
    outline(); g.stroke();
    g.fillStyle = glint;
    g.beginPath(); g.arc(S * 0.38, S * 0.55, S * 0.05, 0, 6.29); g.fill();
  }

  /** Hand-drawn pixel icons for the non-block kit items. `tier` only matters
   * for the 4 armor-piece keys (helmet/chestplate/leggings/boots) - pass the
   * player's actual armorTier so netherite renders in its own near-black
   * palette instead of always looking like diamond. */
  function itemIcon(key, size, tier, trim) {
    const S = size || 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const u = S / 16;
    const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x * u, y * u, w * u, h * u); };

    if (key === 'sword' || key === 'netherite_sword') {
      // Diamond Sword (Sharpness V): pale cyan blade instead of iron-grey.
      // The netherite version swaps in a near-black blade instead.
      const netherite = key === 'netherite_sword';
      P(3, 11, 3, 2, '#5a3d1e');          // handle
      P(4, 10, 5, 2, '#8a6a3a');          // guard
      for (let i = 0; i < 8; i++) P(5 + i, 8 - i, 2, 2, netherite ? '#1c1a1e' : '#7de3e0');
      for (let i = 0; i < 8; i++) P(5 + i, 8 - i, 1, 1, netherite ? '#413a3f' : '#c8fef9');
      P(12, 2, 2, 2, netherite ? '#5a5058' : '#eafffd');
    } else if (key === 'pick') {
      P(4, 11, 2, 4, '#5a3d1e');
      P(5, 9, 2, 3, '#6b4a25');
      P(3, 6, 10, 2, '#d6dde6');
      P(2, 7, 3, 2, '#c2cad4');
      P(11, 7, 3, 2, '#c2cad4');
      P(4, 6, 8, 1, '#ffffff');
    } else if (key === 'axe' || key === 'netherite_axe') {
      const netheriteAxe = key === 'netherite_axe';
      P(6, 8, 2, 6, '#5a3d1e');
      P(6, 6, 2, 3, '#6b4a25');
      g.fillStyle = netheriteAxe ? '#211f23' : '#c2cad4';
      g.beginPath();
      g.moveTo(S * 0.44, S * 0.32);
      g.lineTo(S * 0.88, S * 0.16);
      g.lineTo(S * 0.95, S * 0.40);
      g.lineTo(S * 0.68, S * 0.60);
      g.lineTo(S * 0.44, S * 0.52);
      g.closePath();
      g.fill();
      g.fillStyle = netheriteAxe ? '#463e40' : '#eef2f6';
      g.beginPath();
      g.moveTo(S * 0.58, S * 0.30); g.lineTo(S * 0.84, S * 0.20); g.lineTo(S * 0.89, S * 0.32); g.lineTo(S * 0.62, S * 0.42);
      g.closePath();
      g.fill();
      g.strokeStyle = netheriteAxe ? '#0a0a0b' : '#7d8791';
      g.lineWidth = Math.max(1, u * 0.4);
      g.stroke();
    } else if (key === 'bow') {
      g.strokeStyle = '#8a5a28';
      g.lineWidth = u * 1.6;
      g.beginPath();
      g.arc(S * 0.34, S * 0.5, S * 0.34, -Math.PI * 0.42, Math.PI * 0.42);
      g.stroke();
      g.strokeStyle = '#e8e8e8';
      g.lineWidth = Math.max(1, u * 0.5);
      g.beginPath();
      g.moveTo(S * 0.46, S * 0.09); g.lineTo(S * 0.46, S * 0.91);
      g.stroke();
      P(3, 7, 9, 1, '#c9a06a');
      P(11, 6, 2, 3, '#e0e0e0');
    } else if (key === 'beef') {
      // Cooked beef: a browned steak with a pale fat edge and a bone nub.
      P(3, 5, 9, 7, '#7a3f1c');
      P(4, 4, 7, 1, '#7a3f1c');
      P(4, 12, 7, 1, '#7a3f1c');
      P(4, 5, 7, 6, '#9c5427');
      P(5, 6, 3, 2, '#b86a35');
      P(2, 6, 1, 5, '#e8d2b0');
      P(12, 7, 2, 3, '#e8e2d4');
      P(13, 6, 1, 1, '#e8e2d4'); P(13, 10, 1, 1, '#e8e2d4');
    } else if (key === 'pearl') {
      const grd = g.createRadialGradient(S * 0.42, S * 0.4, S * 0.05, S * 0.5, S * 0.5, S * 0.42);
      grd.addColorStop(0, '#c8fff0');
      grd.addColorStop(0.45, '#25c39a');
      grd.addColorStop(1, '#0d5e4c');
      g.fillStyle = grd;
      g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.36, 0, 6.29); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.arc(S * 0.38, S * 0.36, S * 0.07, 0, 6.29); g.fill();
    } else if (key === 'gapple') {
      const grd = g.createRadialGradient(S * 0.42, S * 0.38, S * 0.05, S * 0.5, S * 0.52, S * 0.4);
      grd.addColorStop(0, '#fff6c0');
      grd.addColorStop(0.5, '#f5c542');
      grd.addColorStop(1, '#a87b12');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(S * 0.38, S * 0.56, S * 0.26, 0, 6.29);
      g.arc(S * 0.62, S * 0.56, S * 0.26, 0, 6.29);
      g.fill();
      P(7, 2, 2, 3, '#6b4a25');
      g.fillStyle = '#4caf50';
      g.beginPath(); g.ellipse(S * 0.62, S * 0.2, S * 0.14, S * 0.07, -0.5, 0, 6.29); g.fill();
    } else if (key === 'helmet' || key === 'chestplate' || key === 'leggings' || key === 'boots') {
      // Diamond's cyan palette, or netherite's near-black / chainmail's
      // grey one (matching the 3D armor layer's ARMOR_COLORS/ARMOR_FLECKS)
      // if that tier was passed in.
      const netheriteArmor = tier === 'netherite';
      const chain = tier === 'chainmail';
      const main = netheriteArmor ? '#221f24' : chain ? '#8a8e96' : '#6fd8d4';
      const shadow = netheriteArmor ? '#17161a' : chain ? '#6c7078' : '#57c2be';
      const trim = netheriteArmor ? '#0d0c0f' : chain ? '#4a4d54' : '#3fa9a6';
      const shade = netheriteArmor ? '#0c0b0d' : chain ? '#2e3036' : '#173230';
      const highlight = netheriteArmor ? '#6a5a52' : chain ? '#c4c8ce' : '#c8fef9';
      if (key === 'helmet') {
        P(4, 2, 8, 3, main);
        P(3, 5, 10, 3, shadow);
        P(5, 5, 2, 2, shade);
        P(9, 5, 2, 2, shade);
        P(4, 2, 8, 1, highlight);
        P(3, 2, 1, 6, trim);
        P(12, 2, 1, 6, trim);
      } else if (key === 'chestplate') {
        P(3, 2, 3, 2, shadow);
        P(10, 2, 3, 2, shadow);
        P(3, 4, 10, 7, main);
        P(6, 4, 4, 7, shadow);
        P(3, 4, 1, 7, trim);
        P(12, 4, 1, 7, trim);
        P(4, 2, 2, 1, highlight);
      } else if (key === 'leggings') {
        P(4, 2, 8, 2, shadow);
        P(4, 4, 3, 8, main);
        P(9, 4, 3, 8, main);
        P(4, 4, 1, 8, highlight);
        P(6, 11, 1, 1, trim);
        P(9, 11, 1, 1, trim);
      } else if (key === 'boots') {
        P(4, 9, 3, 4, main);
        P(9, 9, 3, 4, main);
        P(3, 12, 4, 1, trim);
        P(9, 12, 4, 1, trim);
        P(4, 9, 3, 1, highlight);
        P(9, 9, 3, 1, highlight);
      }
    } else if (key === 'mace') {
      // Mace (Density V, Wind Burst III): studded head on a short haft.
      P(6, 5, 3, 9, '#4a3a2e');
      g.fillStyle = '#8a8a90';
      g.beginPath(); g.arc(S * 0.5, S * 0.28, S * 0.22, 0, 6.29); g.fill();
      g.strokeStyle = '#c8c8d0';
      g.lineWidth = u * 1.4;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const cx = S * 0.5 + Math.cos(ang) * S * 0.22, cy = S * 0.28 + Math.sin(ang) * S * 0.22;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(ang) * S * 0.09, cy + Math.sin(ang) * S * 0.09);
        g.stroke();
      }
      P(6, 3, 3, 1, '#e8e8ee');
    } else if (key === 'spear') {
      // Spear (Lunge III, Sharpness V): long haft, diamond thrusting head.
      P(6, 6, 2, 9, '#5a3d1e');
      P(6, 12, 2, 2, '#8a6a3a');
      g.fillStyle = '#7de3e0';
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.03);
      g.lineTo(S * 0.66, S * 0.32);
      g.lineTo(S * 0.5, S * 0.42);
      g.lineTo(S * 0.34, S * 0.32);
      g.closePath();
      g.fill();
      g.strokeStyle = '#c8fef9';
      g.lineWidth = Math.max(1, u * 0.5);
      g.beginPath(); g.moveTo(S * 0.5, S * 0.06); g.lineTo(S * 0.5, S * 0.36); g.stroke();
    } else if (key === 'windcharge') {
      // Wind Charge: a pale swirling vortex orb.
      const grd = g.createRadialGradient(S * 0.42, S * 0.4, S * 0.04, S * 0.5, S * 0.5, S * 0.42);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.5, '#cfe8ea');
      grd.addColorStop(1, '#7fa8ac');
      g.fillStyle = grd;
      g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.38, 0, 6.29); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = Math.max(1, u * 0.6);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(S * 0.5, S * 0.5, S * (0.14 + i * 0.09), 0.4 + i, 3.4 + i);
        g.stroke();
      }
    } else if (key === 'shield') {
      g.fillStyle = '#8a5a28';
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.05);
      g.lineTo(S * 0.92, S * 0.22);
      g.lineTo(S * 0.92, S * 0.55);
      g.quadraticCurveTo(S * 0.92, S * 0.85, S * 0.5, S * 0.98);
      g.quadraticCurveTo(S * 0.08, S * 0.85, S * 0.08, S * 0.55);
      g.lineTo(S * 0.08, S * 0.22);
      g.closePath();
      g.fill();
      g.strokeStyle = '#5c3a18';
      g.lineWidth = Math.max(1, u * 0.6);
      g.stroke();
      g.strokeStyle = '#d6dde6';
      g.lineWidth = Math.max(1, u * 1.1);
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.11);
      g.lineTo(S * 0.86, S * 0.26);
      g.lineTo(S * 0.86, S * 0.54);
      g.quadraticCurveTo(S * 0.86, S * 0.8, S * 0.5, S * 0.91);
      g.quadraticCurveTo(S * 0.14, S * 0.8, S * 0.14, S * 0.54);
      g.lineTo(S * 0.14, S * 0.26);
      g.closePath();
      g.stroke();
      if (MC.isValidTrim(trim)) {
        // A player-painted trim replaces the default emblem below, clipped
        // to the shield's own inner-border outline (same path just stroked
        // above) so painted pixels never spill past the shield's silhouette.
        g.save();
        g.beginPath();
        g.moveTo(S * 0.5, S * 0.11);
        g.lineTo(S * 0.86, S * 0.26);
        g.lineTo(S * 0.86, S * 0.54);
        g.quadraticCurveTo(S * 0.86, S * 0.8, S * 0.5, S * 0.91);
        g.quadraticCurveTo(S * 0.14, S * 0.8, S * 0.14, S * 0.54);
        g.lineTo(S * 0.14, S * 0.26);
        g.closePath();
        g.clip();
        const cell = S / MC.TRIM_GRID;
        for (let ty = 0; ty < MC.TRIM_GRID; ty++) {
          for (let tx = 0; tx < MC.TRIM_GRID; tx++) {
            const idx = trim[ty * MC.TRIM_GRID + tx];
            if (!idx) continue;
            g.fillStyle = TRIM_PALETTE[idx];
            g.fillRect(tx * cell, ty * cell, cell, cell);
          }
        }
        g.restore();
      } else {
        g.fillStyle = '#d6dde6';
        g.beginPath(); g.arc(S * 0.5, S * 0.42, S * 0.13, 0, 6.29); g.fill();
        g.fillStyle = '#7de3e0';
        g.beginPath();
        g.moveTo(S * 0.5, S * 0.31); g.lineTo(S * 0.59, S * 0.42); g.lineTo(S * 0.5, S * 0.53); g.lineTo(S * 0.41, S * 0.42);
        g.closePath(); g.fill();
      }
    } else if (key === 'sword_plain' || key === 'iron_sword') {
      // Same shape as the Sharpness V sword, plain steel-grey blade instead
      // of the enchanted cyan - enchantments don't change an item's model in
      // vanilla either, just its glint, which this skips for simplicity.
      P(3, 11, 3, 2, '#5a3d1e');
      P(4, 10, 5, 2, '#8a6a3a');
      for (let i = 0; i < 8; i++) P(5 + i, 8 - i, 2, 2, '#d6dde6');
      for (let i = 0; i < 8; i++) P(5 + i, 8 - i, 1, 1, '#eef2f6');
      P(12, 2, 2, 2, '#ffffff');
    } else if (key === 'axe_sharp') {
      // Same shape as the plain Iron Axe, cyan-tinted head for Sharpness V
      // (matching the sword's own enchanted-vs-plain colour convention).
      P(6, 8, 2, 6, '#5a3d1e');
      P(6, 6, 2, 3, '#6b4a25');
      g.fillStyle = '#7de3e0';
      g.beginPath();
      g.moveTo(S * 0.44, S * 0.32); g.lineTo(S * 0.88, S * 0.16); g.lineTo(S * 0.95, S * 0.40); g.lineTo(S * 0.68, S * 0.60); g.lineTo(S * 0.44, S * 0.52);
      g.closePath(); g.fill();
      g.fillStyle = '#c8fef9';
      g.beginPath();
      g.moveTo(S * 0.58, S * 0.30); g.lineTo(S * 0.84, S * 0.20); g.lineTo(S * 0.89, S * 0.32); g.lineTo(S * 0.62, S * 0.42);
      g.closePath(); g.fill();
      g.strokeStyle = '#3fa9a6';
      g.lineWidth = Math.max(1, u * 0.4);
      g.stroke();
    } else if (key === 'bow_plain') {
      // Power doesn't change a bow's model in vanilla either - identical to 'bow'.
      g.strokeStyle = '#8a5a28';
      g.lineWidth = u * 1.6;
      g.beginPath();
      g.arc(S * 0.34, S * 0.5, S * 0.34, -Math.PI * 0.42, Math.PI * 0.42);
      g.stroke();
      g.strokeStyle = '#e8e8e8';
      g.lineWidth = Math.max(1, u * 0.5);
      g.beginPath();
      g.moveTo(S * 0.46, S * 0.09); g.lineTo(S * 0.46, S * 0.91);
      g.stroke();
      P(3, 7, 9, 1, '#c9a06a');
      P(11, 6, 2, 3, '#e0e0e0');
    } else if (key.slice(0, 4) === 'pot_') {
      potionBottle(g, S, u, POTION_COLORS[key] || ['#8a5ac2', '#c9a6f5']);
    } else if (key === 'crossbow') {
      // Horizontal stock with a bow arc mounted across the front and a taut string.
      P(2, 7, 11, 2, '#6b4a25');
      P(11, 6, 2, 4, '#4a3320');
      g.strokeStyle = '#8a8a90';
      g.lineWidth = u * 1.4;
      g.beginPath();
      g.moveTo(S * 0.86, S * 0.12); g.lineTo(S * 0.98, S * 0.5); g.lineTo(S * 0.86, S * 0.88);
      g.stroke();
      g.strokeStyle = '#e8e0c8';
      g.lineWidth = Math.max(1, u * 0.4);
      g.beginPath(); g.moveTo(S * 0.86, S * 0.12); g.lineTo(S * 0.86, S * 0.88); g.stroke();
      P(2, 9, 5, 2, '#8a6a3a');
    } else if (key === 'trident') {
      // Long shaft with a three-prong fork at the top.
      P(7, 6, 2, 9, '#5a3d1e');
      g.fillStyle = '#7de3e0';
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.02); g.lineTo(S * 0.58, S * 0.28); g.lineTo(S * 0.42, S * 0.28);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(S * 0.22, S * 0.1); g.lineTo(S * 0.4, S * 0.32); g.lineTo(S * 0.28, S * 0.34);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(S * 0.78, S * 0.1); g.lineTo(S * 0.6, S * 0.32); g.lineTo(S * 0.72, S * 0.34);
      g.closePath(); g.fill();
      g.strokeStyle = '#c8fef9';
      g.lineWidth = Math.max(1, u * 0.4);
      g.beginPath(); g.moveTo(S * 0.5, S * 0.06); g.lineTo(S * 0.5, S * 0.3); g.stroke();
    } else if (key === 'stick') {
      P(3, 12, 2, 2, '#6b4a25');
      g.save();
      g.translate(S * 0.5, S * 0.5);
      g.rotate(-0.55);
      g.fillStyle = '#8a6a3a';
      g.fillRect(-S * 0.06, -S * 0.42, S * 0.12, S * 0.84);
      g.fillStyle = '#6b4a25';
      g.fillRect(-S * 0.06, S * 0.2, S * 0.12, S * 0.22);
      g.restore();
    } else if (key === 'egap') {
      // Same silhouette as the plain golden apple, gold-foil gradient
      // swapped for a shimmering enchant purple, plus a sparkle scatter.
      const grd = g.createRadialGradient(S * 0.42, S * 0.38, S * 0.05, S * 0.5, S * 0.52, S * 0.4);
      grd.addColorStop(0, '#f3e6ff');
      grd.addColorStop(0.5, '#a259e6');
      grd.addColorStop(1, '#4a1a80');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(S * 0.38, S * 0.56, S * 0.26, 0, 6.29);
      g.arc(S * 0.62, S * 0.56, S * 0.26, 0, 6.29);
      g.fill();
      P(7, 2, 2, 3, '#6b4a25');
      g.fillStyle = '#4caf50';
      g.beginPath(); g.ellipse(S * 0.62, S * 0.2, S * 0.14, S * 0.07, -0.5, 0, 6.29); g.fill();
      g.fillStyle = '#fff';
      const sparkles = [[0.2, 0.3], [0.82, 0.42], [0.5, 0.15], [0.3, 0.75], [0.72, 0.78]];
      for (const [sx, sy] of sparkles) g.fillRect(S * sx, S * sy, Math.max(1, u * 0.7), Math.max(1, u * 0.7));
    } else if (key === 'flint_steel') {
      // Grey flint stone (lower-left) crossed by an L-shaped steel striker
      // (upper-right), with a small spark burst where they meet.
      g.fillStyle = '#4a4a52';
      g.beginPath();
      g.moveTo(S * 0.18, S * 0.62); g.lineTo(S * 0.4, S * 0.5); g.lineTo(S * 0.52, S * 0.66);
      g.lineTo(S * 0.34, S * 0.86); g.lineTo(S * 0.16, S * 0.82);
      g.closePath(); g.fill();
      g.fillStyle = '#6a6a74';
      g.beginPath(); g.moveTo(S * 0.22, S * 0.64); g.lineTo(S * 0.36, S * 0.56); g.lineTo(S * 0.4, S * 0.66); g.lineTo(S * 0.26, S * 0.74); g.closePath(); g.fill();
      g.strokeStyle = '#c9ccd2';
      g.lineWidth = u * 1.3;
      g.beginPath();
      g.moveTo(S * 0.42, S * 0.86); g.lineTo(S * 0.42, S * 0.4); g.lineTo(S * 0.86, S * 0.16);
      g.stroke();
      g.fillStyle = '#8a6a3a';
      g.fillRect(S * 0.37, S * 0.78, S * 0.1, S * 0.14);
      g.fillStyle = '#ffe27a';
      const sparks = [[0.5, 0.42], [0.58, 0.36], [0.46, 0.34], [0.56, 0.46]];
      for (const [sx, sy] of sparks) g.fillRect(S * sx, S * sy, Math.max(1, u * 0.8), Math.max(1, u * 0.8));
    } else if (key === 'totem') {
      // Squat golden idol silhouette with a wide "arms out" head, vanilla's
      // totem-of-undying read at a glance.
      const grd = g.createLinearGradient(0, S * 0.1, 0, S * 0.95);
      grd.addColorStop(0, '#ffe27a'); grd.addColorStop(1, '#a8720f');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.08);
      g.lineTo(S * 0.7, S * 0.28); g.lineTo(S * 0.62, S * 0.28); g.lineTo(S * 0.62, S * 0.5);
      g.lineTo(S * 0.78, S * 0.62); g.lineTo(S * 0.68, S * 0.68); g.lineTo(S * 0.58, S * 0.58);
      g.lineTo(S * 0.58, S * 0.92); g.lineTo(S * 0.42, S * 0.92); g.lineTo(S * 0.42, S * 0.58);
      g.lineTo(S * 0.32, S * 0.68); g.lineTo(S * 0.22, S * 0.62); g.lineTo(S * 0.38, S * 0.5);
      g.lineTo(S * 0.38, S * 0.28); g.lineTo(S * 0.3, S * 0.28);
      g.closePath(); g.fill();
      g.fillStyle = '#5a3a0a';
      g.fillRect(S * 0.44, S * 0.34, S * 0.12, S * 0.1);
      g.fillStyle = '#7de3e0';
      g.fillRect(S * 0.46, S * 0.36, S * 0.03, S * 0.03);
      g.fillRect(S * 0.51, S * 0.36, S * 0.03, S * 0.03);
    } else if (key === 'creeper_spawn_egg') {
      // Same spawn-egg shape as the wolf's, in creeper green.
      g.fillStyle = '#5bab48';
      g.beginPath();
      g.ellipse(S * 0.5, S * 0.56, S * 0.28, S * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f5c28';
      const cspots = [[0.42, 0.4], [0.58, 0.46], [0.46, 0.62], [0.6, 0.68], [0.38, 0.58], [0.52, 0.32]];
      for (const [sx, sy] of cspots) {
        g.beginPath();
        g.ellipse(S * sx, S * sy, S * 0.06, S * 0.05, 0.4, 0, Math.PI * 2);
        g.fill();
      }
    } else if (key === 'wolf_spawn_egg') {
      // Classic vanilla spawn-egg look: an egg-shaped base color (wolf fur
      // grey-brown) with a speckled pattern in a contrasting color (the
      // fur's darker patches) instead of a solid fill.
      g.fillStyle = '#c9bda8';
      g.beginPath();
      g.ellipse(S * 0.5, S * 0.56, S * 0.28, S * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#7a6a58';
      const spots = [[0.42, 0.4], [0.58, 0.46], [0.46, 0.62], [0.6, 0.68], [0.38, 0.58], [0.52, 0.32]];
      for (const [sx, sy] of spots) {
        g.beginPath();
        g.ellipse(S * sx, S * sy, S * 0.06, S * 0.05, 0.4, 0, Math.PI * 2);
        g.fill();
      }
    } else if (key === 'elytra') {
      // A pair of angular wings, mirrored either side of a small spine.
      const wing = (sign) => {
        g.save();
        g.translate(S * 0.5, S * 0.5);
        g.scale(sign, 1);
        const grd = g.createLinearGradient(0, -S * 0.4, S * 0.42, S * 0.3);
        grd.addColorStop(0, '#4a3a52'); grd.addColorStop(1, '#7a5a8a');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, -S * 0.32);
        g.lineTo(S * 0.42, -S * 0.12);
        g.lineTo(S * 0.36, S * 0.3);
        g.lineTo(S * 0.06, S * 0.36);
        g.closePath();
        g.fill();
        g.strokeStyle = '#2c2236';
        g.lineWidth = Math.max(1, u * 0.4);
        g.stroke();
        g.restore();
      };
      wing(-1); wing(1);
      g.fillStyle = '#3a2c44';
      g.fillRect(S * 0.47, S * 0.16, S * 0.06, S * 0.24);
    } else if (key === 'firework') {
      // A striped paper tube with a fuse and a small colourful star burst
      // above it, hinting at what it does when it goes off.
      g.fillStyle = '#c23a2a';
      g.fillRect(S * 0.42, S * 0.42, S * 0.16, S * 0.44);
      g.fillStyle = '#e8e0c8';
      for (let i = 0; i < 4; i++) g.fillRect(S * 0.42, S * (0.46 + i * 0.09), S * 0.16, S * 0.03);
      g.strokeStyle = '#8a6a3a';
      g.lineWidth = Math.max(1, u * 0.5);
      g.beginPath(); g.moveTo(S * 0.5, S * 0.42); g.lineTo(S * 0.46, S * 0.3); g.stroke();
      const colors = ['#ff5a5a', '#5ad0ff', '#ffe066', '#7dffb0'];
      for (let i = 0; i < colors.length; i++) {
        const ang = (i / colors.length) * Math.PI * 2 - Math.PI / 2;
        g.fillStyle = colors[i];
        g.beginPath();
        g.arc(S * 0.5 + Math.cos(ang) * S * 0.16, S * 0.2 + Math.sin(ang) * S * 0.16, S * 0.045, 0, 6.29);
        g.fill();
      }
    }
    // A player-painted trim, roughly applied to the finished icon so the
    // hotbar/inventory preview matches what the real piece looks like.
    // 'source-atop' clips the paint to whatever the icon just drew, so it
    // lands on the item's silhouette rather than the empty background, and
    // the slight transparency keeps the icon's own shading readable through
    // it. The shield isn't listed here - it paints its own trim further up,
    // properly clipped to its outline.
    if (TRIMMABLE_ICONS[key] && MC.isValidTrim(trim)) {
      g.save();
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.85;
      stampTrim(g, trim, [0, 0, S, S]);
      g.restore();
    }
    return cv;
  }
  const TRIMMABLE_ICONS = { helmet: 1, chestplate: 1, leggings: 1, boots: 1, elytra: 1 };

  // Classic blocky pixel-art heart, matching the game's chunky icon style.
  // fill: 0..1, continuous (drains column by column) rather than snapping to
  // just empty/half/full - armor can reduce a hit to a fraction of a heart,
  // and that needs to read as a small dent rather than rounding away to
  // "nothing happened". color: hex string for the filled portion.
  const HEART_MASK = [
    '.11.11.',
    '1111111',
    '1111111',
    '.11111.',
    '..111..',
    '...1...'
  ];
  function heartIcon(fill, color, size) {
    const S = size || 18;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cols = HEART_MASK[0].length, rows = HEART_MASK.length;
    const cell = S / cols;
    const offY = (S - rows * cell) / 2;
    const empty = 'rgba(40,10,10,0.55)';
    const outline = 'rgba(0,0,0,0.55)';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (HEART_MASK[y][x] !== '1') continue;
        const filled = x < cols * fill;
        g.fillStyle = filled ? color : empty;
        g.fillRect(Math.floor(x * cell), Math.floor(offY + y * cell), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
      }
    }
    // thin outline pass for readability against bright backgrounds
    g.strokeStyle = outline;
    g.lineWidth = 1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (HEART_MASK[y][x] !== '1') continue;
        const up = y > 0 && HEART_MASK[y - 1][x] === '1';
        const left = x > 0 && HEART_MASK[y][x - 1] === '1';
        if (!up) g.strokeRect(Math.floor(x * cell), Math.floor(offY + y * cell), cell, 0.5);
        if (!left) g.strokeRect(Math.floor(x * cell), Math.floor(offY + y * cell), 0.5, cell);
      }
    }
    return cv;
  }

  /** Small flame icon for the "Burning" HUD pill (Fire Aspect/Flame) - a
   * simple two-tone teardrop, same chunky pixel-art style as the rest of
   * the HUD's icons. */
  function flameIcon(size) {
    const S = size || 20;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#e0601a';
    g.beginPath();
    g.moveTo(S * 0.5, S * 0.04);
    g.quadraticCurveTo(S * 0.92, S * 0.42, S * 0.78, S * 0.72);
    g.quadraticCurveTo(S * 0.7, S * 0.94, S * 0.5, S * 0.96);
    g.quadraticCurveTo(S * 0.3, S * 0.94, S * 0.22, S * 0.72);
    g.quadraticCurveTo(S * 0.08, S * 0.42, S * 0.5, S * 0.04);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(S * 0.5, S * 0.32);
    g.quadraticCurveTo(S * 0.72, S * 0.56, S * 0.64, S * 0.76);
    g.quadraticCurveTo(S * 0.58, S * 0.9, S * 0.5, S * 0.9);
    g.quadraticCurveTo(S * 0.42, S * 0.9, S * 0.36, S * 0.76);
    g.quadraticCurveTo(S * 0.28, S * 0.56, S * 0.5, S * 0.32);
    g.closePath();
    g.fill();
    return cv;
  }

  global.MCTextures = {
    TILE, buildTiles, createBlockTexture, createSkinTexture, createLabelTexture, createArmorTexture,
    createWolfTexture, paintWolf, createCreeperTexture, paintCreeper,
    blockIcon, itemIcon, heartIcon, flameIcon, paintSkin, paintArmor, SKIN_PARTS, boxUV, hashStr, POTION_COLORS,
    pieceFaceRects, PIECE_PARTS, FACE_ORDER, stampTrim,
    SHIELD_ICON_SIZE: 128
  };
})(window);
