import { canvas, params, disk, bar, anchor, bricks } from './state.js';
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
  for(let s = 0; s < SUBSTEPS; s++){
    // spring toward anchor
    if(anchor.active){
      const dx = anchor.x - disk.x;
      const dy = anchor.y - disk.y;
      const dist = Math.hypot(dx, dy) || 1;
      const rx = dx / dist, ry = dy / dist;
      const tx = -ry,       ty = rx;
      const quadratic = quadSpringEl?.dataset.on === 'true';
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
    disk.x += disk.vx * subDt;
    disk.y += disk.vy * subDt;
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

  // brick collisions — at most one per frame to prevent velocity double-flip
  for(const b of bricks){
    if(!b.alive) continue;
    const cx = Math.max(b.x, Math.min(disk.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(disk.y, b.y + b.h));
    const dx = disk.x - cx, dy = disk.y - cy;
    if(dx*dx + dy*dy >= disk.r * disk.r) continue;

    b.alive = false;
    playKnock(0.6);

    const overlapX = (disk.r - Math.abs(disk.x - (b.x + b.w/2))) * Math.sign(disk.x - (b.x + b.w/2));
    const overlapY = (disk.r - Math.abs(disk.y - (b.y + b.h/2))) * Math.sign(disk.y - (b.y + b.h/2));
    if(Math.abs(overlapX) < Math.abs(overlapY)){
      disk.x += overlapX;
      disk.vx *= -params.bounce;
    } else {
      disk.y += overlapY;
      disk.vy *= -params.bounce;
    }
    break;
  }
}
