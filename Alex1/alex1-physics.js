import { canvas, inputHooks } from '../state.js';
import { disk, bar, anchor, setDiskRadiusFraction } from '../playfield.js';
import { bricks, initBricks, bubblePop } from './alex1-bricks.js';
import { mallet, tickMallet } from './alex1-mallet.js';
import { playKnock, playFanfare, playDing, playShatter } from '../sound.js';
import './alex1-handedness.js';
import {
  DISK_RADIUS_FRACTION,
  GRAVITY, DRAG, DRAG_INSIDE_MALLET, WALL_BOUNCE, FLOOR_BOUNCE, MAX_BOUNCE_SPEED, SUBSTEPS
} from './alex1-config.js';

setDiskRadiusFraction(DISK_RADIUS_FRACTION);
// Match disk.highlight to disk.color so render.js's 3D-ball gate fires
// (drop shadow + specular ellipse). Equal stops make the radial gradient
// render as a uniform fill — visually identical to the previous behavior,
// when shadow + specular were drawn unconditionally regardless of highlight.
disk.highlight = disk.color;
inputHooks.diskGrab = false;
bar.hidden = true;

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

  const subDt = dt / SUBSTEPS;
  let shattered = false;
  for(let s = 0; s < SUBSTEPS && !shattered; s++){
    // gravity + speed-proportional drag (always, even during spring)
    disk.vy += GRAVITY * subDt;
    if(mallet.active && mallet.mode === 'inside'){
      const relVx = disk.vx - mallet.vx;
      const relVy = disk.vy - mallet.vy;
      const relSpd = Math.hypot(relVx, relVy);
      if(relSpd > 1e-6){
        const dragScale = Math.max(0, 1 - DRAG_INSIDE_MALLET * subDt);
        disk.vx = mallet.vx + relVx * dragScale;
        disk.vy = mallet.vy + relVy * dragScale;
      }
    } else {
      const spd = Math.hypot(disk.vx, disk.vy);
      if(spd > 1e-6){
        const dragScale = Math.max(0, 1 - DRAG * subDt);
        disk.vx *= dragScale;
        disk.vy *= dragScale;
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
        if(disk.glass){
          // PRACTICE MODE: pop the bubble visually + audibly but keep the
          // disk moving. (Original behavior reset disk position + velocity
          // and aborted the substep — disabled here so the user can keep
          // practicing the ring-capture without interruption. Only the
          // Reset button stops the ball now.)
          playShatter();
          bubblePop.active = true;
          bubblePop.x = disk.x;
          bubblePop.y = disk.y;
          bubblePop.t = 0;
          bubblePop.particles = Array.from({length: 9}, (_, i) => {
            const angle = (i / 9) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const speed = 0.7 + Math.random() * 0.6;
            return { ax: Math.cos(angle) * speed, ay: Math.sin(angle) * speed };
          });
          disk.glass = false;
          // fall through to the shared push-out + reflection below
        } else {
          b.alive = false;
          playKnock(0.6);
          if(bricks.every(b => !b.alive)){
            playFanfare();
            // PRACTICE MODE: regenerate bricks but leave the disk alone.
            setTimeout(initBricks, 600);
          }
        }
        // push-out and reflection using closest point (correct for all disk/brick size ratios).
        // Shared by both glass and non-glass paths so the disk always bounces off the brick.
        const enx = disk.x - cx, eny = disk.y - cy;
        const len = Math.hypot(enx, eny) || 1;
        const nnx = enx / len, nny = eny / len;
        disk.x += nnx * (disk.r - len);
        disk.y += nny * (disk.r - len);
        const dot = disk.vx * nnx + disk.vy * nny;
        disk.vx -= (1 + WALL_BOUNCE) * dot * nnx;
        disk.vy -= (1 + WALL_BOUNCE) * dot * nny;
        break;
      }
      // continue with remaining time — next substep handles any further bricks
      if(!shattered){
        disk.x += disk.vx * (subDt - hi);
        disk.y += disk.vy * (subDt - hi);
      }
    }
  }

  const W = canvas.width, H = canvas.height;
  let bounced = false, bounceSpeed = 0;
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -WALL_BOUNCE; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -WALL_BOUNCE; bounced = true; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -WALL_BOUNCE; bounced = true; }
  let hitFloor = false;
  if(disk.y + disk.r > H){ disk.y = H - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -FLOOR_BOUNCE; bounced = true; hitFloor = true; }
  if(bounced) playKnock(Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1));
  if(hitFloor && !disk.glass){ disk.glass = true; playDing(); }
  tickMallet(dt);

  if(bubblePop.active){
    bubblePop.t += dt;
    if(bubblePop.t >= bubblePop.duration) bubblePop.active = false;
  }
}
