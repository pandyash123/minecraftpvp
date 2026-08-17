/*
 * WebGL2 renderer: sky, chunk meshes (opaque + water), player models,
 * projectiles, block break overlay, selection wireframe, name tags,
 * hit particles and a first-person view-bob/hand.
 */
(function (global) {
  'use strict';

  const { M4, createProgram, frustumFromVP, aabbInFrustum } = global.GLX;
  const MC = global.MCBlocks;
  const W = MC.WORLD;
  const CH = W.CHUNK;
  const ME = global.MCEntities;

  const CHUNK_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUV;
  layout(location=2) in float aLayer;
  layout(location=3) in float aLight;
  uniform mat4 uVP;
  uniform vec3 uOffset;
  out vec2 vUV;
  out float vLayer;
  out float vLight;
  out float vFog;
  uniform vec3 uEye;
  void main() {
    vec3 world = aPos + uOffset;
    gl_Position = uVP * vec4(world, 1.0);
    vUV = aUV; vLayer = aLayer; vLight = aLight;
    vFog = distance(world, uEye);
  }`;

  const CHUNK_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec2 vUV; in float vLayer; in float vLight; in float vFog;
  uniform sampler2DArray uTex;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uAlpha;
  out vec4 outColor;
  void main() {
    vec4 c = texture(uTex, vec3(vUV, vLayer));
    if (c.a < 0.05) discard;
    c.rgb *= vLight;
    float fog = clamp((vFog - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    c.rgb = mix(c.rgb, uFogColor, fog);
    outColor = vec4(c.rgb, c.a * uAlpha);
  }`;

  const ENTITY_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUV;
  layout(location=2) in float aLight;
  uniform mat4 uVP;
  uniform mat4 uModel;
  out vec2 vUV;
  out float vLight;
  void main() {
    gl_Position = uVP * uModel * vec4(aPos, 1.0);
    vUV = aUV; vLight = aLight;
  }`;

  const ENTITY_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; in float vLight;
  uniform sampler2D uTex;
  uniform vec3 uTint;
  uniform float uAlpha;
  out vec4 outColor;
  void main() {
    vec4 c = texture(uTex, vUV);
    if (c.a < 0.05) discard;
    outColor = vec4(c.rgb * vLight * uTint, c.a * uAlpha);
  }`;

  const SOLID_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  uniform mat4 uVP;
  uniform mat4 uModel;
  void main() { gl_Position = uVP * uModel * vec4(aPos, 1.0); }`;
  const SOLID_FS = `#version 300 es
  precision highp float;
  uniform vec4 uColor;
  out vec4 outColor;
  void main() { outColor = uColor; }`;

  const SKY_VS = `#version 300 es
  layout(location=0) in vec2 aPos;
  out vec2 vPos;
  void main() { vPos = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vPos;
  uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSun; uniform vec2 uSunDir;
  out vec4 outColor;
  void main() {
    float t = clamp(vPos.y * 0.5 + 0.55, 0.0, 1.0);
    vec3 col = mix(uBottom, uTop, t);
    float sunD = distance(vPos, uSunDir);
    col += uSun * smoothstep(0.16, 0.0, sunD) * 0.9;
    col += uSun * smoothstep(0.4, 0.0, sunD) * 0.15;
    outColor = vec4(col, 1.0);
  }`;

  const PARTICLE_VS = `#version 300 es
  layout(location=0) in vec3 aOffset;
  layout(location=1) in vec3 aCenter;
  layout(location=2) in vec4 aColor;
  layout(location=3) in float aSize;
  uniform mat4 uVP;
  uniform vec3 uRight, uUp;
  out vec4 vColor;
  void main() {
    vec3 world = aCenter + (uRight * aOffset.x + uUp * aOffset.y) * aSize;
    gl_Position = uVP * vec4(world, 1.0);
    vColor = aColor;
  }`;
  const PARTICLE_FS = `#version 300 es
  precision highp float;
  in vec4 vColor;
  out vec4 outColor;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    outColor = vColor;
  }`;

  function makeBuffer(gl, data, target) {
    const b = gl.createBuffer();
    gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
    gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  function chunkVAO(gl, mesh) {
    if (!mesh.count) return null;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = makeBuffer(gl, mesh.vertices);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
    const ib = makeBuffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    return { vao, count: mesh.count, vb, ib };
  }

  function entityVAO(gl, mesh) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = makeBuffer(gl, mesh.vertices);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    const ib = makeBuffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    return { vao, count: mesh.count, vb, ib };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is required to run this game.');
      this.gl = gl;
      gl.getExtension('OES_element_index_uint');

      this.progChunk = createProgram(gl, CHUNK_VS, CHUNK_FS);
      this.progEntity = createProgram(gl, ENTITY_VS, ENTITY_FS);
      this.progSolid = createProgram(gl, SOLID_VS, SOLID_FS);
      this.progSky = createProgram(gl, SKY_VS, SKY_FS);
      this.progParticle = createProgram(gl, PARTICLE_VS, PARTICLE_FS);

      const blockTex = global.MCTextures.createBlockTexture(gl);
      this.blockTexture = blockTex.tex;
      this.tiles = blockTex.tiles;

      this.chunks = new Map();     // index -> {opaque, water}
      this.skins = new Map();      // name -> WebGLTexture

      this.viewProj = M4.create();
      this.proj = M4.create();
      this.view = M4.create();
      this.frustum = new Float32Array(24);

      this.skyQuad = (() => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        makeBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        return vao;
      })();

      this.wireGeo = entityVAOSolid(gl, ME.cubeWireGeo());
      this.blockCubeCache = new Map();
      this.arrowMesh = entityVAO(gl, ME.arrowGeo());
      this.chargeMesh = entityVAOSolid(gl, ME.chargeGeo(0.28));
      this.playerParts = ME.playerParts();
      this.playerVAOs = {};
      for (const k in this.playerParts) this.playerVAOs[k] = entityVAO(gl, this.playerParts[k].geo);
      this.armorParts = ME.armorParts();
      this.armorVAOs = {};
      for (const k in this.armorParts) this.armorVAOs[k] = entityVAO(gl, this.armorParts[k].geo);
      this.armorTex = new Map();

      this.particles = { data: new Float32Array(2000 * 8), n: 0, cap: 2000 };
      this.particleVAO = null;
      this.buildParticleVAO();

      // Held-item icons for remote players (see drawHeldItem below).
      this.iconTex = new Map();
      this.itemQuadVAO = buildIconQuadVAO(gl);
      this._armRMatrix = M4.create();
      this._haveArmR = false;

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const gl = this.gl;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
      gl.viewport(0, 0, w, h);
      this.aspect = w / h;
    }

    getSkin(name) {
      let t = this.skins.get(name);
      if (!t) { t = global.MCTextures.createSkinTexture(this.gl, name); this.skins.set(name, t); }
      return t;
    }

    getArmorTexture(tier) {
      let t = this.armorTex.get(tier);
      if (!t) { t = global.MCTextures.createArmorTexture(this.gl, tier); this.armorTex.set(tier, t); }
      return t;
    }

    getBlockCubeVAO(blockId) {
      let v = this.blockCubeCache.get(blockId);
      if (!v) {
        // blockCubeGeo() emits the chunk-shader's 7-float layout
        // (pos,uv,layer,light) - it must use chunkVAO's 4-attribute/28-byte
        // stride setup, not entityVAO's 3-attribute/24-byte one (that
        // mismatch silently misread every vertex after the first as raw
        // bytes from the wrong offset, producing exploded jagged geometry
        // rendered black since the never-enabled light attribute read 0).
        v = chunkVAO(this.gl, ME.blockCubeGeo(blockId));
        this.blockCubeCache.set(blockId, v);
      }
      return v;
    }

    buildParticleVAO() {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const quadBuf = makeBuffer(gl, new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.particles.data.byteLength, gl.DYNAMIC_DRAW);
      const stride = 8 * 4;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
      gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);
      this.particleVAO = vao;
      this.particleBuf = instBuf;
      this.quadBuf = quadBuf;
    }

    uploadChunk(index, mesh) {
      const gl = this.gl;
      const old = this.chunks.get(index);
      if (old) {
        if (old.opaque) { gl.deleteVertexArray(old.opaque.vao); gl.deleteBuffer(old.opaque.vb); gl.deleteBuffer(old.opaque.ib); }
        if (old.water) { gl.deleteVertexArray(old.water.vao); gl.deleteBuffer(old.water.vb); gl.deleteBuffer(old.water.ib); }
      }
      this.chunks.set(index, {
        opaque: chunkVAO(gl, mesh.opaque),
        water: chunkVAO(gl, mesh.water)
      });
    }

    setCamera(eye, yaw, pitch, fovDeg, roll) {
      M4.perspective(this.proj, (fovDeg || 78) * Math.PI / 180, this.aspect, 0.05, 640);
      M4.view(this.view, eye[0], eye[1], eye[2], yaw, pitch, roll || 0);
      M4.multiply(this.viewProj, this.proj, this.view);
      frustumFromVP(this.viewProj, this.frustum);
      this.eye = eye;
    }

    drawSky(skyTop, skyBottom, sunColor, sunDir) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.progSky);
      gl.uniform3fv(this.progSky.u.uTop, skyTop);
      gl.uniform3fv(this.progSky.u.uBottom, skyBottom);
      gl.uniform3fv(this.progSky.u.uSun, sunColor);
      gl.uniform2fv(this.progSky.u.uSunDir, sunDir);
      gl.bindVertexArray(this.skyQuad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
    }

    drawWorld(fogColor, fogNear, fogFar) {
      const gl = this.gl;
      gl.useProgram(this.progChunk);
      gl.uniformMatrix4fv(this.progChunk.u.uVP, false, this.viewProj);
      gl.uniform3fv(this.progChunk.u.uFogColor, fogColor);
      gl.uniform1f(this.progChunk.u.uFogNear, fogNear);
      gl.uniform1f(this.progChunk.u.uFogFar, fogFar);
      gl.uniform3fv(this.progChunk.u.uEye, this.eye);
      gl.uniform1f(this.progChunk.u.uAlpha, 1.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTexture);
      gl.uniform1i(this.progChunk.u.uTex, 0);

      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      // Chunk mesh vertices already contain absolute world coordinates (see
      // mesher.js), so the chunk offset here must stay (0,0,0) - it exists
      // only for drawBreakOverlay()'s local-space cube, further down.
      gl.uniform3f(this.progChunk.u.uOffset, 0, 0, 0);

      let drawn = 0, total = 0;
      const visible = [];
      for (const [index, chunk] of this.chunks) {
        total++;
        const cx = index % (W.SX / CH), cz = (index / (W.SX / CH)) | 0;
        const x0 = cx * CH, z0 = cz * CH;
        if (!aabbInFrustum(this.frustum, x0, 0, z0, x0 + CH, W.SY, z0 + CH)) continue;
        visible.push([index, chunk, x0, z0]);
      }

      // opaque pass
      for (const [index, chunk, x0, z0] of visible) {
        if (!chunk.opaque || !chunk.opaque.count) continue;
        gl.bindVertexArray(chunk.opaque.vao);
        gl.drawElements(gl.TRIANGLES, chunk.opaque.count, gl.UNSIGNED_INT, 0);
        drawn++;
      }

      // water pass: no backface cull, alpha blend, no depth write
      gl.uniform1f(this.progChunk.u.uAlpha, 0.78);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const [index, chunk, x0, z0] of visible) {
        if (!chunk.water || !chunk.water.count) continue;
        gl.bindVertexArray(chunk.water.vao);
        gl.drawElements(gl.TRIANGLES, chunk.water.count, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      this.stats = { drawn, total };
    }

    /** Draws one humanoid at (x,y,z) feet position with the given pose. */
    drawPlayer(skinTex, x, y, z, yaw, pose, tint, alpha) {
      const gl = this.gl;
      gl.useProgram(this.progEntity);
      gl.uniformMatrix4fv(this.progEntity.u.uVP, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, skinTex);
      gl.uniform1i(this.progEntity.u.uTex, 0);
      gl.uniform3fv(this.progEntity.u.uTint, tint || [1, 1, 1]);
      gl.uniform1f(this.progEntity.u.uAlpha, alpha === undefined ? 1 : alpha);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      const base = M4.create();
      M4.fromTRS(base, x, y, z, 0, yaw, 0, 1, 1, 1);

      const parts = ['head', 'body', 'legR', 'legL', 'armR', 'armL'];
      const m = M4.create(), local = M4.create(), tmp = M4.create();
      for (const key of parts) {
        const part = this.playerParts[key];
        const p = pose[key] || { rx: 0, ry: 0, rz: 0 };
        const pivot = part.pivot;
        M4.fromTRS(local, pivot[0], pivot[1], pivot[2], p.rx || 0, p.ry || 0, p.rz || 0, 1, 1, 1);
        M4.multiply(tmp, base, local);
        // undo pivot translation baked into geometry (geometry already offset by pivot origin) -
        // geometry vertices are already relative to (0,0,0) at the pivot minus local offsets,
        // so composing base*local directly is correct since box() coordinates are absolute
        // to the pivot already subtracted in playerParts().
        m.set(tmp);
        // Stashed so a following drawHeldItem() call can hang an item icon
        // off the same bone the swinging arm is attached to.
        if (key === 'armR') { this._armRMatrix.set(m); this._haveArmR = true; }
        gl.uniformMatrix4fv(this.progEntity.u.uModel, false, m);
        const vao = this.playerVAOs[key];
        gl.bindVertexArray(vao.vao);
        gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_SHORT, 0);
      }
      gl.bindVertexArray(null);
    }

    /**
     * Draws the armor shell (see MCEntities.armorParts) over a player just
     * drawn by drawPlayer() at the same (x,y,z,yaw,pose) - real inflated
     * geometry worn over the body, not a tint on the skin. No-ops for
     * armorTier 'none'/falsy.
     */
    drawArmorLayer(armorTier, x, y, z, yaw, pose) {
      if (!armorTier || armorTier === 'none') return;
      const gl = this.gl;
      gl.useProgram(this.progEntity);
      gl.uniformMatrix4fv(this.progEntity.u.uVP, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.getArmorTexture(armorTier));
      gl.uniform1i(this.progEntity.u.uTex, 0);
      gl.uniform3fv(this.progEntity.u.uTint, [1, 1, 1]);
      gl.uniform1f(this.progEntity.u.uAlpha, 1);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      const base = M4.create();
      M4.fromTRS(base, x, y, z, 0, yaw, 0, 1, 1, 1);

      const parts = ['head', 'body', 'legR', 'legL', 'armR', 'armL', 'bootR', 'bootL'];
      // Boots aren't in `pose` (poseFor() only knows the six playerParts
      // bones) - they ride the same leg swing as the leggings covering
      // that same leg, so borrow that entry.
      const poseKey = { bootR: 'legR', bootL: 'legL' };
      const m = M4.create(), local = M4.create(), tmp = M4.create();
      for (const key of parts) {
        const part = this.armorParts[key];
        const p = pose[poseKey[key] || key] || { rx: 0, ry: 0, rz: 0 };
        const pivot = part.pivot;
        M4.fromTRS(local, pivot[0], pivot[1], pivot[2], p.rx || 0, p.ry || 0, p.rz || 0, 1, 1, 1);
        M4.multiply(tmp, base, local);
        m.set(tmp);
        gl.uniformMatrix4fv(this.progEntity.u.uModel, false, m);
        const vao = this.armorVAOs[key];
        gl.bindVertexArray(vao.vao);
        gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_SHORT, 0);
      }
      gl.bindVertexArray(null);
    }

    /** Icon texture for a remote player's held item, cached by key. */
    getIconTexture(item) {
      const key = item.type === 'block' ? 'block:' + item.block : item.key;
      let tex = this.iconTex.get(key);
      if (!tex) {
        const cv = item.type === 'block' ? global.MCTextures.blockIcon(this.tiles, item.block, 32) : global.MCTextures.itemIcon(item.key, 32);
        tex = uploadIconTex(this.gl, cv);
        this.iconTex.set(key, tex);
      }
      return tex;
    }

    /** Draws a small item icon hanging off the swing arm from the most
     * recent drawPlayer() call - lets you tell what a remote player/bot is
     * actually holding without a full 3D held-item model. */
    drawHeldItem(tex) {
      if (!this._haveArmR) return;
      const gl = this.gl;
      const local = M4.create();
      M4.fromTRS(local, 0, -0.55, 0.1, 0, 0, 0, 0.4, 0.4, 0.4);
      const model = M4.create();
      M4.multiply(model, this._armRMatrix, local);
      gl.useProgram(this.progEntity);
      gl.uniformMatrix4fv(this.progEntity.u.uVP, false, this.viewProj);
      gl.uniformMatrix4fv(this.progEntity.u.uModel, false, model);
      gl.uniform3fv(this.progEntity.u.uTint, [1, 1, 1]);
      gl.uniform1f(this.progEntity.u.uAlpha, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.progEntity.u.uTex, 0);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.itemQuadVAO.vao);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
      gl.enable(gl.CULL_FACE);
    }

    drawHeldBlock(blockId, modelMatrix) {
      const gl = this.gl;
      const vao = this.getBlockCubeVAO(blockId);
      gl.useProgram(this.progChunk);
      // Reuse chunk shader with identity VP*model baked externally: simpler to
      // just draw with the entity shader using the block texture array via a
      // tiny inline path.
      gl.bindVertexArray(vao.vao);
      gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    drawArrow(x, y, z, yaw, pitch, color) {
      const gl = this.gl;
      gl.useProgram(this.progEntity);
      gl.uniformMatrix4fv(this.progEntity.u.uVP, false, this.viewProj);
      const m = M4.create();
      M4.fromTRS(m, x, y, z, pitch, yaw, 0, 1, 1, 1);
      gl.uniformMatrix4fv(this.progEntity.u.uModel, false, m);
      gl.uniform3fv(this.progEntity.u.uTint, [1, 1, 1]);
      gl.uniform1f(this.progEntity.u.uAlpha, 1);
      // Projectiles reuse this one shaft-shaped mesh (no dedicated pearl/wind
      // charge model) - just recolored per kind via `color`.
      const c = color || [0.55, 0.42, 0.28];
      gl.useProgram(this.progSolid);
      gl.uniformMatrix4fv(this.progSolid.u.uVP, false, this.viewProj);
      gl.uniformMatrix4fv(this.progSolid.u.uModel, false, m);
      gl.uniform4f(this.progSolid.u.uColor, c[0], c[1], c[2], 1);
      gl.bindVertexArray(this.arrowMesh.vao);
      gl.drawElements(gl.TRIANGLES, this.arrowMesh.count, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }

    /** Wind charge: a small tumbling icosahedron instead of the arrow-shaft
     * mesh every other projectile reuses - it's a thrown ball, not a bolt. */
    drawCharge(x, y, z, spin, color) {
      const gl = this.gl;
      const m = M4.create();
      M4.fromTRS(m, x, y, z, spin * 0.7, spin, spin * 0.4, 1, 1, 1);
      gl.useProgram(this.progSolid);
      gl.uniformMatrix4fv(this.progSolid.u.uVP, false, this.viewProj);
      gl.uniformMatrix4fv(this.progSolid.u.uModel, false, m);
      const c = color || [0.85, 0.95, 1];
      gl.uniform4f(this.progSolid.u.uColor, c[0], c[1], c[2], 1);
      gl.bindVertexArray(this.chargeMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.chargeMesh.count);
      gl.bindVertexArray(null);
    }

    drawSelection(x, y, z) {
      const gl = this.gl;
      gl.useProgram(this.progSolid);
      gl.uniformMatrix4fv(this.progSolid.u.uVP, false, this.viewProj);
      const m = M4.create();
      M4.fromTRS(m, x - 0.003, y - 0.003, z - 0.003, 0, 0, 0, 1.006, 1.006, 1.006);
      gl.uniformMatrix4fv(this.progSolid.u.uModel, false, m);
      gl.uniform4f(this.progSolid.u.uColor, 0, 0, 0, 0.75);
      gl.lineWidth(2);
      gl.bindVertexArray(this.wireGeo.vao);
      gl.drawArrays(gl.LINES, 0, this.wireGeo.count);
      gl.bindVertexArray(null);
    }

    drawBreakOverlay(x, y, z, stage) {
      if (stage < 0) return;
      const gl = this.gl;
      const layer = MC.T.CRACKS + Math.min(9, stage);
      gl.useProgram(this.progChunk);
      gl.uniformMatrix4fv(this.progChunk.u.uVP, false, this.viewProj);
      gl.uniform3fv(this.progChunk.u.uEye, this.eye);
      gl.uniform3fv(this.progChunk.u.uFogColor, [0, 0, 0]);
      gl.uniform1f(this.progChunk.u.uFogNear, 9999); gl.uniform1f(this.progChunk.u.uFogFar, 10000);
      gl.uniform1f(this.progChunk.u.uAlpha, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTexture);
      gl.uniform1i(this.progChunk.u.uTex, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.disable(gl.CULL_FACE);
      const vao = this._breakVAO || (this._breakVAO = this._buildBreakCube());
      gl.uniform3f(this.progChunk.u.uOffset, x, y, z);
      gl.bindVertexArray(vao.vao);
      // patch layer per draw via a uniform trick isn't set up; rebuild each call is cheap enough (small cube)
      this._setBreakLayer(layer);
      gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.enable(gl.CULL_FACE);
    }

    _buildBreakCube() {
      const gl = this.gl;
      const F = global.MCMesher.FACES;
      const verts = [];
      const idx = [];
      let n = 0;
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const c = F[f].c[k];
          verts.push(c[0], c[1], c[2], c[3], c[4], 20, 1);
        }
        idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        n += 4;
      }
      this._breakVerts = new Float32Array(verts);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = makeBuffer(gl, this._breakVerts);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
      const ib = makeBuffer(gl, new Uint32Array(idx), gl.ELEMENT_ARRAY_BUFFER);
      this._breakVB = vb;
      return { vao, count: idx.length };
    }

    _setBreakLayer(layer) {
      const gl = this.gl;
      for (let i = 0; i < 24; i++) this._breakVerts[i * 7 + 5] = layer;
      gl.bindBuffer(gl.ARRAY_BUFFER, this._breakVB);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._breakVerts);
    }

    pushParticle(x, y, z, r, g, b, a, size) {
      const p = this.particles;
      if (p.n >= p.cap) return;
      const o = p.n * 8;
      p.data[o] = x; p.data[o + 1] = y; p.data[o + 2] = z;
      p.data[o + 3] = r; p.data[o + 4] = g; p.data[o + 5] = b; p.data[o + 6] = a;
      p.data[o + 7] = size;
      p.n++;
    }

    drawParticles(camRight, camUp) {
      const gl = this.gl;
      const p = this.particles;
      if (!p.n) return;
      gl.useProgram(this.progParticle);
      gl.uniformMatrix4fv(this.progParticle.u.uVP, false, this.viewProj);
      gl.uniform3fv(this.progParticle.u.uRight, camRight);
      gl.uniform3fv(this.progParticle.u.uUp, camUp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, p.data.subarray(0, p.n * 8));
      gl.bindVertexArray(this.particleVAO);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.n);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      p.n = 0;
    }

    clear(r, g, b) {
      const gl = this.gl;
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
  }

  function entityVAOSolid(gl, geo) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    makeBuffer(gl, geo.vertices);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: geo.count };
  }

  /** Small textured quad (pos+uv+light, matching the entity shader layout)
   * used to hang a held-item icon off a remote player's arm bone. */
  function buildIconQuadVAO(gl) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    makeBuffer(gl, new Float32Array([
      -0.5, 0.5, 0, 0, 0, 1,
      -0.5, -0.5, 0, 0, 1, 1,
      0.5, 0.5, 0, 1, 0, 1,
      0.5, -0.5, 0, 1, 1, 1
    ]));
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao };
  }

  function uploadIconTex(gl, cv) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  global.MCRenderer = Renderer;
})(window);
