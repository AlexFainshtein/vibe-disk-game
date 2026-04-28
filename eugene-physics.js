import { canvas, params, inputHooks } from './state.js';
import { disk, bar, anchor, setDiskRadiusFraction } from './playfield.js';
import { bricks, initBricks, bubblePop } from './eugene-bricks.js';
import { mallet, tickMallet } from './eugene-mallet.js';
import { playKnock, playFanfare, playDing, playShatter } from './sound.js';
import './eugene-handedness.js';

// Eugene's hollow-shell mallet variant uses a much smaller disk than Alex's
// fidget — the mallet is 3× the disk radius (see eugene-mallet.js), so a small
// disk lets the shell feel substantial without filling the playfield. Override
// the playfield default at module load.
setDiskRadiusFraction(1/40);
inputHooks.diskGrab = false; // disk grabbing / spring not used in Eugene's variant
bar.hidden = true;


const MAX_BOUNCE_SPEED = 1200;
const GRAVITY         = 400;   // px/s² downward
const DRAG            = 0.3;   // speed-proportional damping fraction per second
const BAR_BOUNCE      = 1.1;   // bar restitution > 1 adds energy on bounce

const SUBSTEPS = 4; // sub-steps per frame for brick collision accuracy

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
  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  const subDt = dt / SUBSTEPS;
  let shattered = false;
  for(let s = 0; s < SUBSTEPS && !shattered; s++){
    // gravity + speed-proportional drag (always, even during spring)
    disk.vy += GRAVITY * subDt;
    const spd = Math.hypot(disk.vx, disk.vy);
    if(spd > 1e-6){
      const dragScale = Math.max(0, 1 - DRAG * subDt * frameMultiplier);
      disk.vx *= dragScale;
      disk.vy *= dragScale;
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
          // bubble pops instead of breaking the brick
          playShatter();
          // spawn pop animation at the collision point
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
          disk.x = canvas.width / 2;
          disk.y = canvas.height / 2;
          disk.vx = 0;
          disk.vy = 0;
          mallet.active = false;
          anchor.active = false;
          shattered = true;
        } else {
          b.alive = false;
          playKnock(0.6);
          if(bricks.every(b => !b.alive)){
            playFanfare();
            setTimeout(() => {
              initBricks();
              disk.x = canvas.width / 2;
              disk.y = canvas.height / 2;
              disk.vx = 0;
              disk.vy = 0;
              disk.glass = false;
              mallet.active = false;
              anchor.active = false;
            }, 600);
          }
          // push-out and reflection using closest point (correct for all disk/brick size ratios)
          const enx = disk.x - cx, eny = disk.y - cy;
          const len = Math.hypot(enx, eny) || 1;
          const nnx = enx / len, nny = eny / len;
          disk.x += nnx * (disk.r - len);
          disk.y += nny * (disk.r - len);
          const dot = disk.vx * nnx + disk.vy * nny;
          disk.vx -= (1 + params.bounce) * dot * nnx;
          disk.vy -= (1 + params.bounce) * dot * nny;
        }
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
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -params.bounce; bounced = true; }
  let hitFloor = false;
  if(disk.y + disk.r > H){ disk.y = H - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -BAR_BOUNCE; bounced = true; hitFloor = true; }
  if(bounced) playKnock(Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1));
  if(hitFloor && !disk.glass){ disk.glass = true; playDing(); }
  tickMallet(dt);

  if(bubblePop.active){
    bubblePop.t += dt;
    if(bubblePop.t >= bubblePop.duration) bubblePop.active = false;
  }
}
