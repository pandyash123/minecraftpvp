/* Client side world: block storage, skylight heightmap and voxel raycasting. */
(function (global) {
  'use strict';

  const MC = global.MCBlocks;
  const Gen = global.MCWorldGen;
  const W = MC.WORLD;
  const CH = W.CHUNK;

  class World {
    constructor(seed) {
      this.seed = seed;
      this.blocks = Gen.generate(seed);
      this.cx = W.SX / CH;
      this.cz = W.SZ / CH;
      this.chunkCount = this.cx * this.cz;
      this.height = new Int16Array(W.SX * W.SZ); // topmost opaque block
      this.dirty = new Set();
      this.rebuildHeightmap();
    }

    index(x, y, z) { return (y * W.SZ + z) * W.SX + x; }

    inBounds(x, y, z) {
      return x >= 0 && y >= 0 && z >= 0 && x < W.SX && y < W.SY && z < W.SZ;
    }

    get(x, y, z) {
      x |= 0; y |= 0; z |= 0;
      if (x < 0 || z < 0 || x >= W.SX || z >= W.SZ) return MC.ID.BEDROCK; // world walls
      if (y < 0) return MC.ID.BEDROCK;
      if (y >= W.SY) return MC.ID.AIR;
      return this.blocks[(y * W.SZ + z) * W.SX + x];
    }

    /** Same as get() but treats out-of-world as air (used for lighting). */
    getSoft(x, y, z) {
      if (!this.inBounds(x, y, z)) return MC.ID.AIR;
      return this.blocks[(y * W.SZ + z) * W.SX + x];
    }

    set(x, y, z, id) {
      if (!this.inBounds(x, y, z)) return false;
      const i = (y * W.SZ + z) * W.SX + x;
      if (this.blocks[i] === id) return false;
      this.blocks[i] = id;
      this.updateHeight(x, z, y, id);
      this.markDirty(x, y, z);
      return true;
    }

    rebuildHeightmap() {
      for (let z = 0; z < W.SZ; z++) {
        for (let x = 0; x < W.SX; x++) {
          let h = 0;
          for (let y = W.SY - 1; y >= 0; y--) {
            if (MC.OPAQUE[this.blocks[(y * W.SZ + z) * W.SX + x]]) { h = y; break; }
          }
          this.height[z * W.SX + x] = h;
        }
      }
    }

    updateHeight(x, z, y, id) {
      const hi = z * W.SX + x;
      const h = this.height[hi];
      if (MC.OPAQUE[id]) {
        if (y > h) this.height[hi] = y;
      } else if (y === h) {
        let nh = 0;
        for (let yy = y - 1; yy >= 0; yy--) {
          if (MC.OPAQUE[this.blocks[(yy * W.SZ + z) * W.SX + x]]) { nh = yy; break; }
        }
        this.height[hi] = nh;
      }
    }

    /** Skylight factor for a block position (1 = open sky, dimmer below). */
    skyLit(x, y, z) {
      if (x < 0 || z < 0 || x >= W.SX || z >= W.SZ) return 1;
      return y >= this.height[z * W.SX + x] ? 1 : 0;
    }

    chunkIndex(cx, cz) { return cz * this.cx + cx; }

    markDirty(x, y, z) {
      const cx = (x / CH) | 0, cz = (z / CH) | 0;
      this.dirty.add(this.chunkIndex(cx, cz));
      // Neighbouring chunk meshes need rebuilding when we touch a border block
      // (their faces may now be exposed or hidden) - and the column above/below
      // for skylight changes.
      const lx = x - cx * CH, lz = z - cz * CH;
      if (lx === 0 && cx > 0) this.dirty.add(this.chunkIndex(cx - 1, cz));
      if (lx === CH - 1 && cx < this.cx - 1) this.dirty.add(this.chunkIndex(cx + 1, cz));
      if (lz === 0 && cz > 0) this.dirty.add(this.chunkIndex(cx, cz - 1));
      if (lz === CH - 1 && cz < this.cz - 1) this.dirty.add(this.chunkIndex(cx, cz + 1));
    }

    markAllDirty() {
      for (let i = 0; i < this.chunkCount; i++) this.dirty.add(i);
    }

    applyEdits(flat) {
      for (let i = 0; i < flat.length; i += 2) {
        const idx = flat[i], id = flat[i + 1];
        this.blocks[idx] = id;
      }
      if (flat.length) {
        this.rebuildHeightmap();
        this.markAllDirty();
      }
    }

    /**
     * Amanatides & Woo voxel traversal.
     * Returns {x,y,z,nx,ny,nz,block,dist} for the first solid hit, else null.
     */
    raycast(ox, oy, oz, dx, dy, dz, maxDist, includeLiquid) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tDeltaX = Math.abs(1 / dx), tDeltaY = Math.abs(1 / dy), tDeltaZ = Math.abs(1 / dz);
      let tMaxX = (dx > 0 ? (x + 1 - ox) : (ox - x)) * (tDeltaX === Infinity ? 0 : tDeltaX);
      let tMaxY = (dy > 0 ? (y + 1 - oy) : (oy - y)) * (tDeltaY === Infinity ? 0 : tDeltaY);
      let tMaxZ = (dz > 0 ? (z + 1 - oz) : (oz - z)) * (tDeltaZ === Infinity ? 0 : tDeltaZ);
      if (!isFinite(tMaxX)) tMaxX = Infinity;
      if (!isFinite(tMaxY)) tMaxY = Infinity;
      if (!isFinite(tMaxZ)) tMaxZ = Infinity;
      let nx = 0, ny = 0, nz = 0;
      let t = 0;

      for (let i = 0; i < 512; i++) {
        const b = this.get(x, y, z);
        const hit = includeLiquid ? b !== MC.ID.AIR : MC.SOLID[b] === 1;
        if (hit && this.inBounds(x, y, z)) {
          return { x, y, z, nx, ny, nz, block: b, dist: t };
        }
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
          else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
        } else {
          if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
          else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
        }
        if (t > maxDist) break;
        if (y < -1 || y > W.SY + 1) break;
      }
      return null;
    }
  }

  global.MCWorld = World;
})(window);
