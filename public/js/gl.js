/* Minimal mat4 / WebGL2 helpers. No external dependencies. */
(function (global) {
  'use strict';

  const M4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[11] = -1;
      o[10] = (far + near) / (near - far);
      o[14] = (2 * far * near) / (near - far);
      return o;
    },
    ortho(o, l, r, b, t, n, f) {
      o.fill(0);
      o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[15] = 1;
      o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n);
      return o;
    },
    multiply(o, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },
    translate(o, x, y, z) {
      M4.identity(o); o[12] = x; o[13] = y; o[14] = z; return o;
    },
    fromTRS(o, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
      sx = sx === undefined ? 1 : sx; sy = sy === undefined ? 1 : sy; sz = sz === undefined ? 1 : sz;
      const cx = Math.cos(rx), sxr = Math.sin(rx);
      const cy = Math.cos(ry), syr = Math.sin(ry);
      const cz = Math.cos(rz), szr = Math.sin(rz);
      // R = Ry * Rx * Rz
      const m00 = cy * cz + syr * sxr * szr, m01 = cx * szr, m02 = -syr * cz + cy * sxr * szr;
      const m10 = -cy * szr + syr * sxr * cz, m11 = cx * cz, m12 = syr * szr + cy * sxr * cz;
      const m20 = syr * cx, m21 = -sxr, m22 = cy * cx;
      o[0] = m00 * sx; o[1] = m01 * sx; o[2] = m02 * sx; o[3] = 0;
      o[4] = m10 * sy; o[5] = m11 * sy; o[6] = m12 * sy; o[7] = 0;
      o[8] = m20 * sz; o[9] = m21 * sz; o[10] = m22 * sz; o[11] = 0;
      o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;
      return o;
    },
    /** Camera view matrix from position + yaw/pitch (yaw 0 looks down -Z). */
    view(o, x, y, z, yaw, pitch, roll) {
      roll = roll || 0;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      // forward (world) for yaw/pitch
      const fx = -sy * cp, fy = sp, fz = -cy * cp;
      let rx = cy, ry = 0, rz = -sy;                 // right = forward x worldUp
      let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
      if (roll) {
        const nrx = rx * cr + ux * sr, nry = ry * cr + uy * sr, nrz = rz * cr + uz * sr;
        ux = ux * cr - rx * sr; uy = uy * cr - ry * sr; uz = uz * cr - rz * sr;
        rx = nrx; ry = nry; rz = nrz;
      }
      o[0] = rx; o[1] = ux; o[2] = -fx; o[3] = 0;
      o[4] = ry; o[5] = uy; o[6] = -fy; o[7] = 0;
      o[8] = rz; o[9] = uz; o[10] = -fz; o[11] = 0;
      o[12] = -(rx * x + ry * y + rz * z);
      o[13] = -(ux * x + uy * y + uz * z);
      o[14] = (fx * x + fy * y + fz * z);
      o[15] = 1;
      return o;
    }
  };

  /** Extracts the 6 frustum planes from a view-projection matrix. */
  function frustumFromVP(m, out) {
    const p = out || new Float32Array(24);
    const rows = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
      [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
      [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
      [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]
    ];
    for (let i = 0; i < 6; i++) {
      const r = rows[i];
      const len = Math.hypot(r[0], r[1], r[2]) || 1;
      p[i * 4] = r[0] / len; p[i * 4 + 1] = r[1] / len;
      p[i * 4 + 2] = r[2] / len; p[i * 4 + 3] = r[3] / len;
    }
    return p;
  }

  function aabbInFrustum(p, x0, y0, z0, x1, y1, z1) {
    for (let i = 0; i < 6; i++) {
      const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
      const px = a > 0 ? x1 : x0;
      const py = b > 0 ? y1 : y0;
      const pz = c > 0 ? z1 : z0;
      if (a * px + b * py + c * pz + d < 0) return false;
    }
    return true;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    p.u = uniforms;
    return p;
  }

  global.GLX = { M4, createProgram, frustumFromVP, aabbInFrustum };
})(window);
