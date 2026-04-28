import { canvas, params, disk, bar, anchor, bricks, mallet, initBricks, bubblePop } from './state.js';
import { playKnock, playFanfare, playDing, playShatter } from './sound.js';

const MAX_BOUNCE_SPEED = 1200;
const MALLET_RESTITUTION       = 0.5; // outer shell: moderate bounce
const MALLET_INNER_RESTITUTION = 0.1; // inner shell: heavy damping

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

function resolveMalletCollision(dt){
  if(!mallet.active) return;

  // velocity from position delta this frame
  mallet.vx = (mallet.x - mallet.prevX) / dt;
  mallet.vy = (mallet.y - mallet.prevY) / dt;
  mallet.prevX = mallet.x;
  mallet.prevY = mallet.y;

  const dx = disk.x - mallet.x;
  const dy = disk.y - mallet.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const nx = dx / dist, ny = dy / dist; // outward normal from mallet center

  const shellR = mallet.r; // inner contact surface radius
  const contactR = shellR - disk.r; // center-to-center distance at contact

  if(mallet.mode === 'outside'){
    // Ball outside: bounces off the outer surface of the shell.
    // Contact when disk center is within shellR + disk.r from mallet center.
    const maxDist = shellR + disk.r;
    if(dist > maxDist) return;
    // push disk out (away from mallet center)
    disk.x = mallet.x + nx * maxDist;
    disk.y = mallet.y + ny * maxDist;
    const relVn = (disk.vx - mallet.vx) * nx + (disk.vy - mallet.vy) * ny;
    if(relVn >= 0) return;
    disk.vx -= (1 + MALLET_RESTITUTION) * relVn * nx;
    disk.vy -= (1 + MALLET_RESTITUTION) * relVn * ny;
    disk.glass = false;
    playKnock(Math.min(Math.abs(relVn) / 1200, 1));
  } else {
    // Ball inside: bounces off the inner wall of the shell.
    // Contact when disk center is farther than shellR - disk.r from mallet center.
    if(dist < contactR) return;
    // push disk inward (toward mallet center)
    disk.x = mallet.x + nx * contactR;
    disk.y = mallet.y + ny * contactR;
    // normal for inner reflection points inward (negate nx/ny)
    const relVn = (disk.vx - mallet.vx) * nx + (disk.vy - mallet.vy) * ny;
    if(relVn <= 0) return; // already moving inward (separating from inner wall)
    disk.vx -= (1 + MALLET_INNER_RESTITUTION) * relVn * nx;
    disk.vy -= (1 + MALLET_INNER_RESTITUTION) * relVn * ny;
    disk.glass = false;
    playKnock(Math.min(Math.abs(relVn) / 1200, 1));
  }
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
  let shattered = false;
  for(let s = 0; s < SUBSTEPS && !shattered; s++){
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
  let hitBar = false;
  if(disk.y + disk.r > bar.y){
    disk.y = bar.y - disk.r;
    bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy));
    disk.vy = -Math.abs(disk.vy) * params.bounce + 2 * bar.vy;
    bounced = true;
    hitBar = true;
  }
  if(bounced) playKnock(Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1));
  if(hitBar && !disk.glass){ disk.glass = true; playDing(); }
  resolveMalletCollision(dt);

  if(bubblePop.active){
    bubblePop.t += dt;
    if(bubblePop.t >= bubblePop.duration) bubblePop.active = false;
  }
}
