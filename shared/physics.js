/*
 * Voxel AABB collision + movement. Shared so that server side bots move with
 * exactly the same rules as a human player running the client.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./blocks.js'));
  else root.MCPhysics = factory(root.MCBlocks);
})(typeof self !== 'undefined' ? self : globalThis, function (MC) {
  'use strict';

  var W = MC.WORLD, PHYS = MC.PHYS;
  var EPS = 1e-4;

  // An entity box is centred on x/z, and y is the feet position.
  function boxAt(x, y, z, w, h) {
    var r = w / 2;
    return { x0: x - r, y0: y, z0: z - r, x1: x + r, y1: y + h, z1: z + r };
  }

  function solidAt(getBlock, x, y, z) {
    return MC.SOLID[getBlock(x, y, z)] === 1;
  }

  function boxHitsWorld(getBlock, b) {
    var x0 = Math.floor(b.x0 + EPS), x1 = Math.floor(b.x1 - EPS);
    var y0 = Math.floor(b.y0 + EPS), y1 = Math.floor(b.y1 - EPS);
    var z0 = Math.floor(b.z0 + EPS), z1 = Math.floor(b.z1 - EPS);
    for (var y = y0; y <= y1; y++) {
      for (var z = z0; z <= z1; z++) {
        for (var x = x0; x <= x1; x++) {
          if (solidAt(getBlock, x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /*
   * Moves an entity by (dx,dy,dz), resolving one axis at a time and optionally
   * stepping up single blocks. Mutates and returns `e` ({x,y,z,vx,vy,vz}).
   */
  function move(getBlock, e, dx, dy, dz, opts) {
    opts = opts || {};
    var w = opts.width || PHYS.WIDTH;
    var h = opts.height || PHYS.HEIGHT;
    var stepUp = opts.stepUp !== false;
    var onGround = false;

    // --- Y ---
    if (dy !== 0) {
      var by = boxAt(e.x, e.y + dy, e.z, w, h);
      if (boxHitsWorld(getBlock, by)) {
        if (dy < 0) {
          e.y = Math.floor(e.y + dy) + 1;
          onGround = true;
        } else {
          e.y = Math.ceil(e.y + dy + h) - h - EPS;
        }
        e.vy = 0;
        // Nudge out in case we started intersecting geometry.
        var guard = 0;
        while (boxHitsWorld(getBlock, boxAt(e.x, e.y, e.z, w, h)) && guard++ < 4) e.y += 0.02;
      } else {
        e.y += dy;
      }
    }

    // --- X / Z with optional step-up over 1 block ledges ---
    function axis(axisName, amount) {
      if (amount === 0) return false;
      var nx = e.x + (axisName === 'x' ? amount : 0);
      var nz = e.z + (axisName === 'z' ? amount : 0);
      if (!boxHitsWorld(getBlock, boxAt(nx, e.y, nz, w, h))) {
        e.x = nx; e.z = nz;
        return false;
      }
      if (stepUp) {
        for (var s = 0.5; s <= 1.05; s += 0.5) {
          if (!boxHitsWorld(getBlock, boxAt(nx, e.y + s, nz, w, h)) &&
              !boxHitsWorld(getBlock, boxAt(e.x, e.y + s, e.z, w, h))) {
            e.x = nx; e.z = nz; e.y += s;
            return false;
          }
        }
      }
      if (axisName === 'x') e.vx = 0; else e.vz = 0;
      return true;
    }

    var blockedX = axis('x', dx);
    var blockedZ = axis('z', dz);

    // Clamp inside the world walls.
    var r = w / 2;
    if (e.x < r) { e.x = r; e.vx = 0; blockedX = true; }
    if (e.x > W.SX - r) { e.x = W.SX - r; e.vx = 0; blockedX = true; }
    if (e.z < r) { e.z = r; e.vz = 0; blockedZ = true; }
    if (e.z > W.SZ - r) { e.z = W.SZ - r; e.vz = 0; blockedZ = true; }
    if (e.y > W.SY - h) { e.y = W.SY - h; e.vy = Math.min(0, e.vy); }

    // Ground probe (a hair below the feet) so standing is stable.
    if (!onGround) {
      onGround = boxHitsWorld(getBlock, boxAt(e.x, e.y - 0.02, e.z, w, 0.02));
    }
    e.onGround = onGround;
    e.blocked = blockedX || blockedZ;
    return e;
  }

  function inWater(getBlock, x, y, z) {
    return MC.LIQUID[getBlock(Math.floor(x), Math.floor(y + 0.6), Math.floor(z))] === 1;
  }

  function headInWater(getBlock, x, y, z) {
    return MC.LIQUID[getBlock(Math.floor(x), Math.floor(y + PHYS.EYE), Math.floor(z))] === 1;
  }

  /** True if any part of the entity's body (feet to head) overlaps a cobweb. */
  function inWeb(getBlock, x, y, z) {
    return MC.WEB[getBlock(Math.floor(x), Math.floor(y + 0.05), Math.floor(z))] === 1 ||
      MC.WEB[getBlock(Math.floor(x), Math.floor(y + PHYS.HEIGHT * 0.5), Math.floor(z))] === 1 ||
      MC.WEB[getBlock(Math.floor(x), Math.floor(y + PHYS.HEIGHT - 0.05), Math.floor(z))] === 1;
  }

  /*
   * One integration step of the standard walk/jump/swim controller.
   * `input` = {forward,strafe,jump,sneak,sprint,yaw}
   */
  function step(getBlock, e, input, dt) {
    var water = inWater(getBlock, e.x, e.y, e.z);
    var web = !water && inWeb(getBlock, e.x, e.y, e.z);
    var speed = input.sneak ? PHYS.SNEAK : (input.sprint ? PHYS.SPRINT : PHYS.WALK);
    if (input.block) speed *= PHYS.BLOCK_SPEED;
    if (water) speed *= 0.62;
    if (web) speed *= PHYS.WEB_SPEED;
    // Speed/Slowness potions (client-only for now - see game.js) scale the
    // target speed itself, same as vanilla.
    if (input.speedMult) speed *= input.speedMult;

    var sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    // yaw 0 looks towards -Z (same convention as the renderer)
    var wishX = input.strafe * cos - input.forward * sin;
    var wishZ = -input.strafe * sin - input.forward * cos;
    var len = Math.hypot(wishX, wishZ);
    if (len > 1e-5) { wishX /= len; wishZ /= len; } else { wishX = wishZ = 0; }

    var accel = e.onGround ? PHYS.FRICTION_GROUND : PHYS.FRICTION_GROUND * PHYS.AIR_CONTROL;
    if (water) accel *= 0.7;
    if (web) accel *= 0.5;
    // A burst dash (spear Lunge) is a brief window of pure momentum, not
    // ground movement - the ordinary blend-toward-wish-speed above pulls
    // horizontal velocity toward whatever WASD currently asks for every
    // frame, so holding a movement key mid-lunge (the natural thing to do
    // mid-attack) would otherwise crush a 15-22 speed burst back down to
    // 4.4-5.9 walk/sprint speed within a couple of frames, and the rate this
    // happens at is itself frame-time-dependent (worse on a low framerate).
    // Skipping the blend entirely while dashing sidesteps both problems -
    // the caller (game.js) still owns how long that window lasts.
    if (!input.dashing) {
      e.vx += (wishX * speed - e.vx) * Math.min(1, accel * dt);
      e.vz += (wishZ * speed - e.vz) * Math.min(1, accel * dt);
    }

    if (web) {
      // Vanilla-style web behaviour: falling and jumping are both smothered,
      // not just horizontal movement.
      e.vy -= PHYS.GRAVITY * dt;
      e.vy = Math.max(e.vy, -1.4);
      if (input.jump && e.onGround) e.vy = PHYS.JUMP * 0.35;
    } else if (water) {
      e.vy -= PHYS.GRAVITY * 0.28 * dt;
      e.vy *= Math.max(0, 1 - PHYS.WATER_DRAG * dt * 0.35);
      if (input.jump) e.vy = PHYS.SWIM_UP;
    } else {
      e.vy -= PHYS.GRAVITY * dt;
      if (input.jump && e.onGround) e.vy = PHYS.JUMP;
    }
    if (e.vy < -PHYS.TERMINAL) e.vy = -PHYS.TERMINAL;

    move(getBlock, e, e.vx * dt, e.vy * dt, e.vz * dt, {});
    return e;
  }

  return {
    move: move,
    step: step,
    boxAt: boxAt,
    boxHitsWorld: boxHitsWorld,
    inWater: inWater,
    headInWater: headInWater,
    inWeb: inWeb
  };
});
