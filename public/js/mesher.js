/*
 * Turns a chunk of voxels into two vertex buffers (opaque + water).
 * Vertex layout: px py pz  u v  layer  light   (7 floats)
 */
(function (global) {
  'use strict';

  const MC = global.MCBlocks;
  const W = MC.WORLD;
  const CH = W.CHUNK;
  const ID = MC.ID;

  // corner order: 0=(-t1,-t2) 1=(-t1,+t2) 2=(+t1,-t2) 3=(+t1,+t2) per face def
  const FACES = [
    { // +X
      dir: [1, 0, 0], shade: 0.72, t1: 2, t2: 1,
      c: [[1, 1, 1, 0, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]]
    },
    { // -X
      dir: [-1, 0, 0], shade: 0.72, t1: 2, t2: 1,
      c: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1]]
    },
    { // +Y
      dir: [0, 1, 0], shade: 1.0, t1: 0, t2: 2,
      c: [[0, 1, 0, 0, 0], [0, 1, 1, 0, 1], [1, 1, 0, 1, 0], [1, 1, 1, 1, 1]]
    },
    { // -Y
      dir: [0, -1, 0], shade: 0.5, t1: 0, t2: 2,
      c: [[0, 0, 1, 0, 0], [0, 0, 0, 0, 1], [1, 0, 1, 1, 0], [1, 0, 0, 1, 1]]
    },
    { // +Z
      dir: [0, 0, 1], shade: 0.86, t1: 0, t2: 1,
      c: [[0, 1, 1, 0, 0], [0, 0, 1, 0, 1], [1, 1, 1, 1, 0], [1, 0, 1, 1, 1]]
    },
    { // -Z
      dir: [0, 0, -1], shade: 0.86, t1: 0, t2: 1,
      c: [[1, 1, 0, 0, 0], [1, 0, 0, 0, 1], [0, 1, 0, 1, 0], [0, 0, 0, 1, 1]]
    }
  ];

  const WATER_DROP = 0.11; // water surface sits slightly below a full block

  function Builder() {
    this.v = [];
    this.i = [];
    this.count = 0;
  }
  Builder.prototype.quad = function (verts, flip) {
    const base = this.count;
    for (let k = 0; k < 4; k++) {
      const q = verts[k];
      this.v.push(q[0], q[1], q[2], q[3], q[4], q[5], q[6]);
    }
    this.count += 4;
    if (flip) this.i.push(base + 1, base + 3, base + 0, base + 0, base + 3, base + 2);
    else this.i.push(base + 0, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  Builder.prototype.done = function () {
    return {
      vertices: new Float32Array(this.v),
      indices: new Uint32Array(this.i),
      count: this.i.length
    };
  };

  function aoValue(s1, s2, c) {
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + c);
  }

  /**
   * @param world  MCWorld instance
   * @param cx,cz  chunk coordinates
   * @returns {opaque, water} mesh data
   */
  function meshChunk(world, cx, cz) {
    const opaque = new Builder();
    const water = new Builder();
    const x0 = cx * CH, z0 = cz * CH;
    const get = (x, y, z) => world.get(x, y, z);

    for (let y = 0; y < W.SY; y++) {
      for (let lz = 0; lz < CH; lz++) {
        const z = z0 + lz;
        for (let lx = 0; lx < CH; lx++) {
          const x = x0 + lx;
          const id = world.blocks[(y * W.SZ + z) * W.SX + x];
          if (id === ID.AIR) continue;
          const isWater = MC.LIQUID[id] === 1;
          const build = isWater ? water : opaque;
          const waterTopExposed = isWater && !MC.LIQUID[get(x, y + 1, z)];

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nxp = x + face.dir[0], nyp = y + face.dir[1], nzp = z + face.dir[2];
            const nb = get(nxp, nyp, nzp);
            if (MC.OPAQUE[nb]) continue;
            if (nb === id) continue;                      // same material: hide the seam
            if (isWater && MC.SOLID[nb]) continue;        // water hidden by solids
            if (!isWater && MC.LIQUID[nb] && MC.OPAQUE[id]) {
              // opaque block against water: still draw so you see it underwater
            }

            const layer = MC.TILES[id * 6 + f];
            const lit = world.skyLit(nxp, nyp, nzp) ? 1 : 0.62;
            const verts = [];
            const ao = [0, 0, 0, 0];

            for (let k = 0; k < 4; k++) {
              const c = face.c[k];
              // AO neighbours in the plane just outside this face
              const s1 = [0, 0, 0], s2 = [0, 0, 0];
              const d1 = c[face.t1] * 2 - 1;
              const d2 = c[face.t2] * 2 - 1;
              s1[face.t1] = d1;
              s2[face.t2] = d2;
              const b1 = MC.OPAQUE[get(nxp + s1[0], nyp + s1[1], nzp + s1[2])] ? 1 : 0;
              const b2 = MC.OPAQUE[get(nxp + s2[0], nyp + s2[1], nzp + s2[2])] ? 1 : 0;
              const bc = MC.OPAQUE[get(nxp + s1[0] + s2[0], nyp + s1[1] + s2[1], nzp + s1[2] + s2[2])] ? 1 : 0;
              const a = aoValue(b1, b2, bc);
              ao[k] = a;

              let vy = y + c[1];
              if (isWater && waterTopExposed && c[1] === 1) vy -= WATER_DROP;

              const light = face.shade * lit * (0.55 + 0.45 * (a / 3));
              verts.push([x + c[0], vy, z + c[2], c[3], c[4], layer, light]);
            }
            // flip the triangulation on the anisotropy seam so AO gradients look right
            const flip = ao[0] + ao[3] > ao[1] + ao[2];
            build.quad(verts, flip);
          }
        }
      }
    }

    return { opaque: opaque.done(), water: water.done() };
  }

  global.MCMesher = { meshChunk, FACES };
})(window);
