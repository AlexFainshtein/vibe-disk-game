import { canvas, params, disk, bar, anchor, bricks, ghostDisk } from './state.js';
import { playKnock } from './sound.js';

const MAX_BOUNCE_SPEED = 1200;

const SUBSTEPS        = 4;           // sub-steps per frame for spring stability
const SPRING_K        = 800;         // default: spring stiffness
const SPRING_K_SQ     = 10;          // default: quadratic spring stiffness (force = k_sq * dist * displacement)
const DAMP_RADIAL     = SPRING_K/10; // default: damping along radial direction (toward/away from finger), relative to screen
const DAMP_TANGENTIAL = SPRING_K/10; // default: damping along tangential direction (perpendicular to finger), relative to screen

const ALT_SPRING_K        = 850;              // alt friction: spring stiffness
const ALT_SPRING_K_SQ     = 0.5;            // alt friction: quadratic spring stiffness
const ALT_DAMP_RADIAL     = ALT_SPRING_K/10;  // alt friction: damping along radial direction (toward/away from finger), relative to finger
const ALT_DAMP_TANGENTIAL = ALT_SPRING_K/10; // alt friction: damping along tangential direction (perpendicular to finger), relative to finger

const altFrictionEl   = document.getElementById('altFriction');
const quadSpringEl    = document.getElementById('quadSpring');

function resolveGhostCollision(dt){
  if(!ghostDisk.active) return;
  ghostDisk.life -= dt;
  if(ghostDisk.life <= 0){ ghostDisk.active = false; return; }

  const dx = disk.x - ghostDisk.x;
  const dy = disk.y - ghostDisk.y;
  const dist = Math.hypot(dx, dy);
  const minDist = disk.r * 2;
  if(dist >= minDist || dist < 1e-6) return;

  const nx = dx / dist, ny = dy / dist;
  disk.x = ghostDisk.x + nx * minDist;
  disk.y = ghostDisk.y + ny * minDist;

  const relVn = (disk.vx - ghostDisk.vx) * nx + (disk.vy - ghostDisk.vy) * ny;
  if(relVn >= 0) return;

  disk.vx -= (1 + params.bounce) * relVn * nx;
  disk.vy -= (1 + params.bounce) * relVn * ny;
  playKnock(Math.min(Math.abs(relVn) / 1200, 1));
}

function anyBrickHit(x, y, r, bricks){
  const r2 = r * r;
  for(const b of bricks){
    if(!b.alive) continue;
    const cx = Math.max(b.x, Math.min(x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - cx, dy = y - cy;
    if(dx*dx + dy*dy < r2) return true;
  }
  return false;
}

export function update(dt){
  // compute bar velocity from position change
  bar.vy = (bar.y - bar.prevY) / dt;
  bar.prevY = bar.y;

  // compute anchor velocity from position change
  const anchorVx = anchor.active ? (anchor.x - anchor.prevX) / dt : 0;
  const anchorVy = anchor.active ? (anchor.y - anchor.prevY) / dt : 0;
  anchor.prevX = anchor.x;
  anchor.prevY = anchor.y;

  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  const subDt = dt / SUBSTEPS;
  const quadratic = quadSpringEl?.dataset.on === 'true';
  for(let s = 0; s < SUBSTEPS; s++){
    // spring toward anchor
    if(anchor.active){
      const dx = anchor.x - disk.x;
      const dy = anchor.y - disk.y;
      const dist = Math.hypot(dx, dy) || 1;
      const rx = dx / dist, ry = dy / dist;
      const tx = -ry,       ty = rx;
      if(altFrictionEl?.dataset.on === 'true'){
        const relVx = disk.vx - anchorVx;
        const relVy = disk.vy - anchorVy;
        const radialSpeed     = relVx * rx + relVy * ry;
        const tangentialSpeed = relVx * tx + relVy * ty;
        const dampVx = ALT_DAMP_RADIAL * radialSpeed * rx + ALT_DAMP_TANGENTIAL * tangentialSpeed * tx;
        const dampVy = ALT_DAMP_RADIAL * radialSpeed * ry + ALT_DAMP_TANGENTIAL * tangentialSpeed * ty;
        const k = quadratic ? ALT_SPRING_K_SQ * dist : ALT_SPRING_K;
        disk.vx += (k * dx - dampVx) * subDt;
        disk.vy += (k * dy - dampVy) * subDt;
      } else {
        const radialSpeed     = disk.vx * rx + disk.vy * ry;
        const tangentialSpeed = disk.vx * tx + disk.vy * ty;
        const dampVx = DAMP_RADIAL * radialSpeed * rx + DAMP_TANGENTIAL * tangentialSpeed * tx;
        const dampVy = DAMP_RADIAL * radialSpeed * ry + DAMP_TANGENTIAL * tangentialSpeed * ty;
        const k = quadratic ? SPRING_K_SQ * dist : SPRING_K;
        disk.vx += (k * dx - dampVx) * subDt;
        disk.vy += (k * dy - dampVy) * subDt;
      }
    }
    // integrate position; bisect to first brick contact if needed; at most 1 brick per substep
    const px = disk.x, py = disk.y;
    disk.x += disk.vx * subDt;
    disk.y += disk.vy * subDt;
    if(anyBrickHit(disk.x, disk.y, disk.r, bricks)){
      let lo = 0, hi = subDt;
      for(let i = 0; i < 8; i++){
        const mid = (lo + hi) * 0.5;
        if(anyBrickHit(px + disk.vx * mid, py + disk.vy * mid, disk.r, bricks)) hi = mid;
        else lo = mid;
      }
      disk.x = px + disk.vx * hi;
      disk.y = py + disk.vy * hi;
      for(const b of bricks){
        if(!b.alive) continue;
        const cx = Math.max(b.x, Math.min(disk.x, b.x + b.w));
        const cy = Math.max(b.y, Math.min(disk.y, b.y + b.h));
        const ddx = disk.x - cx, ddy = disk.y - cy;
        if(ddx*ddx + ddy*ddy >= disk.r * disk.r) continue;
        b.alive = false;
        playKnock(0.6);
        // push-out and reflection using closest point (correct for all disk/brick size ratios)
        const enx = disk.x - cx, eny = disk.y - cy;
        const len = Math.hypot(enx, eny) || 1;
        const nnx = enx / len, nny = eny / len;
        disk.x += nnx * (disk.r - len);
        disk.y += nny * (disk.r - len);
        const dot = disk.vx * nnx + disk.vy * nny;
        disk.vx -= (1 + params.bounce) * dot * nnx;
        disk.vy -= (1 + params.bounce) * dot * nny;
        break;
      }
      // continue with remaining time — next substep handles any further bricks
      disk.x += disk.vx * (subDt - hi);
      disk.y += disk.vy * (subDt - hi);
    }
  }

  // friction (only when spring is not active)
  const speed = Math.hypot(disk.vx, disk.vy);
  if(!anchor.active && speed > 1e-6 && friction > 0){
    const decel = speed * friction * dt * frameMultiplier;
    const rawNewSpeed = speed - decel;
    let newSpeed;
    if(Math.sign(rawNewSpeed) !== Math.sign(speed)){
      newSpeed = speed;
    } else {
      newSpeed = rawNewSpeed;
    }
    const scale = newSpeed / speed;
    disk.vx *= scale;
    disk.vy *= scale;
  }

  const W = canvas.width, H = canvas.height;
  let bounced = false, bounceSpeed = 0;
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -params.bounce; bounced = true; }
  // bar collision: disk bounces off bar top with relative velocity
  if(disk.y + disk.r > bar.y){
    disk.y = bar.y - disk.r;
    bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy));
    disk.vy = -Math.abs(disk.vy) * params.bounce + 2 * bar.vy;
    bounced = true;
  }
  if(bounced) playKnock(Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1));
  resolveGhostCollision(dt);
}
