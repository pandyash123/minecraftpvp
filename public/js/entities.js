/*
 * Geometry builders for entities. Everything is expressed in "skin pixels"
 * (1/16 block) and scaled so a player model is exactly 1.8 blocks tall.
 */
(function (global) {
  'use strict';

  const TX = global.MCTextures;
  const S = 1.8 / 32;      // 32px tall model -> 1.8 blocks
  const SKIN = 64;         // skin texture size

  // Face brightness baked per side, matching the world lighting feel.
  const FACE_LIGHT = { top: 1.0, bottom: 0.55, right: 0.82, left: 0.82, front: 0.92, back: 0.78 };

  /**
   * Builds one cuboid.
   * @param w,h,d      size in pixels
   * @param ox,oy,oz   offset of the box minimum corner from the pivot (pixels)
   * @param uv         rects from MCTextures.boxUV
   * @param inflate    extra size (used for hats / armour layers)
   */
  function box(w, h, d, ox, oy, oz, uv, inflate) {
    inflate = inflate || 0;
    const x0 = (ox - inflate) * S, x1 = (ox + w + inflate) * S;
    const y0 = (oy - inflate) * S, y1 = (oy + h + inflate) * S;
    const z0 = (oz - inflate) * S, z1 = (oz + d + inflate) * S;

    const verts = [];
    const idx = [];
    let n = 0;

    function quad(p0, p1, p2, p3, rect, light) {
      const [ru, rv, rw, rh] = rect;
      const u0 = ru / SKIN, v0 = rv / SKIN, u1 = (ru + rw) / SKIN, v1 = (rv + rh) / SKIN;
      const uvs = [[u0, v0], [u0, v1], [u1, v0], [u1, v1]];
      const ps = [p0, p1, p2, p3];
      for (let k = 0; k < 4; k++) {
        verts.push(ps[k][0], ps[k][1], ps[k][2], uvs[k][0], uvs[k][1], light);
      }
      idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      n += 4;
    }

    // -Z is the "front" (the model faces -Z at yaw 0)
    quad([x1, y1, z0], [x1, y0, z0], [x0, y1, z0], [x0, y0, z0], uv.front, FACE_LIGHT.front);
    quad([x0, y1, z1], [x0, y0, z1], [x1, y1, z1], [x1, y0, z1], uv.back, FACE_LIGHT.back);
    quad([x1, y1, z1], [x1, y0, z1], [x1, y1, z0], [x1, y0, z0], uv.left, FACE_LIGHT.left);
    quad([x0, y1, z0], [x0, y0, z0], [x0, y1, z1], [x0, y0, z1], uv.right, FACE_LIGHT.right);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z0], [x1, y1, z1], uv.top, FACE_LIGHT.top);
    quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z1], [x1, y0, z0], uv.bottom, FACE_LIGHT.bottom);

    return { vertices: new Float32Array(verts), indices: new Uint16Array(idx), count: idx.length };
  }

  /*
   * Player skeleton, in pixels above the feet:
   *   hip 12, shoulder 22, neck 24, head top 32
   */
  function playerParts() {
    const P = TX.SKIN_PARTS;
    return {
      head: { geo: box(8, 8, 8, -4, 0, -4, P.head), pivot: [0, 24 * S, 0] },
      body: { geo: box(8, 12, 4, -4, -12, -2, P.body), pivot: [0, 24 * S, 0] },
      armR: { geo: box(4, 12, 4, -2, -10, -2, P.armR), pivot: [-6 * S, 22 * S, 0] },
      armL: { geo: box(4, 12, 4, -2, -10, -2, P.armL), pivot: [6 * S, 22 * S, 0] },
      legR: { geo: box(4, 12, 4, -2, -12, -2, P.legR), pivot: [-2 * S, 12 * S, 0] },
      legL: { geo: box(4, 12, 4, -2, -12, -2, P.legL), pivot: [2 * S, 12 * S, 0] }
    };
  }

  /**
   * Armor layer: four genuinely separate equipment pieces (helmet,
   * chestplate, leggings, boots - matching MC.ARMOR's own four slots),
   * each its own slightly-inflated box worn over the body rather than a
   * recolor of it - the classic vanilla Minecraft armor-rendering trick.
   * A GAP is baked into each piece's shared boundary (neck, waist, knee)
   * so neighbouring pieces don't touch or overlap - without that they read
   * as one continuous shell instead of four distinct items. Pivots match
   * the playerParts() bone they ride; legs are additionally split
   * top/bottom (leggings vs boots) where playerParts() has one box per
   * leg. Coverage is deliberately partial and the bulge kept small: the
   * helmet only caps the top of the head (face stays visible), the
   * chestplate only caps the shoulders (most of each arm stays visible),
   * and every piece is barely larger than the body part underneath it, so
   * this reads as "worn over" the skin instead of swallowing it whole.
   * UVs are reused from the skin atlas layout, but that's only bookkeeping
   * - the armor texture painted in textures.js is a flat material color,
   * so any rect on it samples the same color.
   */
  function armorParts() {
    const P = TX.SKIN_PARTS;
    // Each shared boundary (waist, knee) is formed by two pieces each
    // pulling back by HALF, so the visible seam between them totals GAP -
    // pull back by the full GAP on both sides and you'd double it.
    const GAP = 0.4, HALF = GAP / 2;
    return {
      // helmet - the top 5 of 8px of the head (crown/forehead), leaving
      // eyes-down-to-chin and the neck exposed. Small bulge.
      head: { geo: box(8.5, 5, 8.5, -4.25, 3, -4.25, P.head), pivot: [0, 24 * S, 0] },
      // ...plus a brow tab down each side of the front, with a gap between
      // them: the notch over the face that makes a Minecraft helmet read as
      // a helmet rather than a plain cap. Shallow (one pixel of depth) so
      // it sits on the front of the crown instead of boxing the head in.
      browL: { geo: box(2.75, 2, 1, -4.25, 1, -4.25, P.head), pivot: [0, 24 * S, 0] },
      browR: { geo: box(2.75, 2, 1, 1.5, 1, -4.25, P.head), pivot: [0, 24 * S, 0] },
      // chestplate torso - small bulge so a sliver of shirt shows at the
      // edges; shares a boundary with the leggings at the waist.
      body: { geo: box(9, 12 - GAP, 5, -4.5, -12 + HALF, -2.5, P.body), pivot: [0, 24 * S, 0] },
      // chestplate "sleeves" - just a shoulder cap, exposing the rest of
      // each arm (upper arm, forearm, hand).
      armR: { geo: box(5, 4, 5, -2.5, -2, -2.5, P.armR), pivot: [-6 * S, 22 * S, 0] },
      armL: { geo: box(5, 4, 5, -2.5, -2, -2.5, P.armL), pivot: [6 * S, 22 * S, 0] },
      // leggings - upper ~60% of each leg, small bulge; shares boundaries
      // at both top (waist) and bottom (knee).
      legR: { geo: box(4.5, 7 - GAP, 4.5, -2.25, -7 + HALF, -2.25, P.legR), pivot: [-2 * S, 12 * S, 0] },
      legL: { geo: box(4.5, 7 - GAP, 4.5, -2.25, -7 + HALF, -2.25, P.legL), pivot: [2 * S, 12 * S, 0] },
      // boots - lower ~40% of each leg, small bulge; only shares a
      // boundary at the top (knee) - the bottom sits flush on the ground.
      bootR: { geo: box(4.4, 5 - HALF, 4.4, -2.2, -12, -2.2, P.legR), pivot: [-2 * S, 12 * S, 0] },
      bootL: { geo: box(4.4, 5 - HALF, 4.4, -2.2, -12, -2.2, P.legL), pivot: [2 * S, 12 * S, 0] }
    };
  }

  /**
   * A simple blocky quadruped - body, head, tail and 4 legs, all sharing
   * one pivot (shoulder height, on top of the legs) except the legs
   * themselves which pivot from the ground up. Rendered with a flat-color
   * texture (see textures.js's createWolfTexture, same trick as
   * armorParts()'s flat material colors) rather than a painted skin, so
   * the UV rects below are pure bookkeeping - any rect samples the same
   * color regardless of which part it's assigned to.
   */
  function wolfParts() {
    const P = TX.SKIN_PARTS;
    const LEG_H = 8; // pixels
    const body = [0, LEG_H * S, 0];
    return {
      body: { geo: box(8, 8, 12, -4, 0, -6, P.body), pivot: body },
      head: { geo: box(6, 6, 6, -3, 1, -12, P.head), pivot: body },
      tail: { geo: box(3, 3, 6, -1.5, 2, 6, P.legR), pivot: body },
      legFR: { geo: box(3, LEG_H, 3, -1.5, -LEG_H, -1.5, P.legR), pivot: [-3 * S, LEG_H * S, -4 * S] },
      legFL: { geo: box(3, LEG_H, 3, -1.5, -LEG_H, -1.5, P.legL), pivot: [3 * S, LEG_H * S, -4 * S] },
      legBR: { geo: box(3, LEG_H, 3, -1.5, -LEG_H, -1.5, P.legR), pivot: [-3 * S, LEG_H * S, 4 * S] },
      legBL: { geo: box(3, LEG_H, 3, -1.5, -LEG_H, -1.5, P.legL), pivot: [3 * S, LEG_H * S, 4 * S] }
    };
  }

  /** Simple textured quad in the XY plane, centred on the origin. */
  function quadGeo(w, h) {
    const x = w / 2, y = h / 2;
    return {
      vertices: new Float32Array([
        -x, y, 0, 0, 0, 1,
        -x, -y, 0, 0, 1, 1,
        x, y, 0, 1, 0, 1,
        x, -y, 0, 1, 1, 1
      ]),
      indices: new Uint16Array([0, 1, 2, 2, 1, 3]),
      count: 6
    };
  }

  /** Arrow: a shaft plus two crossed fletchings, mapped to a flat colour uv. */
  function arrowGeo() {
    const verts = [];
    const idx = [];
    let n = 0;
    function cuboid(x0, y0, z0, x1, y1, z1, light) {
      const pts = [
        [[x1, y1, z0], [x1, y0, z0], [x0, y1, z0], [x0, y0, z0]],
        [[x0, y1, z1], [x0, y0, z1], [x1, y1, z1], [x1, y0, z1]],
        [[x1, y1, z1], [x1, y0, z1], [x1, y1, z0], [x1, y0, z0]],
        [[x0, y1, z0], [x0, y0, z0], [x0, y1, z1], [x0, y0, z1]],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z0], [x1, y1, z1]],
        [[x0, y0, z1], [x0, y0, z0], [x1, y0, z1], [x1, y0, z0]]
      ];
      const shades = [0.9, 0.75, 0.82, 0.82, 1.0, 0.55];
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const p = pts[f][k];
          verts.push(p[0], p[1], p[2], 0.5, 0.5, shades[f] * light);
        }
        idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        n += 4;
      }
    }
    // shaft along +Z (the arrow is oriented along its velocity at draw time)
    cuboid(-0.03, -0.03, -0.45, 0.03, 0.03, 0.35, 1.0);
    cuboid(-0.001, -0.12, 0.05, 0.001, 0.12, 0.35, 0.85);  // vertical fletch
    cuboid(-0.12, -0.001, 0.05, 0.12, 0.001, 0.35, 0.85);  // horizontal fletch
    cuboid(-0.045, -0.045, 0.35, 0.045, 0.045, 0.5, 0.7);  // tip
    return { vertices: new Float32Array(verts), indices: new Uint16Array(idx), count: idx.length };
  }

  /** Unit cube (0..1) with block-array UVs; used for the held-block viewmodel. */
  function blockCubeGeo(blockId) {
    const MC = global.MCBlocks;
    const F = global.MCMesher.FACES;
    const verts = [];
    const idx = [];
    let n = 0;
    for (let f = 0; f < 6; f++) {
      const face = F[f];
      const layer = MC.TILES[blockId * 6 + f];
      for (let k = 0; k < 4; k++) {
        const c = face.c[k];
        verts.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5, c[3], c[4], layer, face.shade);
      }
      idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      n += 4;
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idx), count: idx.length };
  }

  /** Wireframe edges of a unit cube, as line pairs. */
  function cubeWireGeo() {
    const c = [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
      [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]
    ];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = [];
    for (const [a, b] of e) v.push(c[a][0], c[a][1], c[a][2], c[b][0], c[b][1], c[b][2]);
    return { vertices: new Float32Array(v), count: v.length / 3 };
  }

  /** Low-poly sphere (regular icosahedron, 20 faces) for the wind charge
   * projectile - a real round body instead of reusing the arrow's shaft
   * mesh. Non-indexed (3 verts per face) to match entityVAOSolid's layout. */
  function chargeGeo(radius) {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ].map(v => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / len * radius, v[1] / len * radius, v[2] / len * radius];
    });
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];
    const verts = [];
    for (const f of faces) for (const idx of f) verts.push(raw[idx][0], raw[idx][1], raw[idx][2]);
    return { vertices: new Float32Array(verts), count: verts.length / 3 };
  }

  global.MCEntities = { playerParts, armorParts, wolfParts, quadGeo, arrowGeo, blockCubeGeo, cubeWireGeo, chargeGeo, box, S };
})(window);
