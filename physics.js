import { canvas, params, disk, input } from './state.js';
import { playKnock } from './sound.js';

const MAX_BOUNCE_SPEED = 1200;

export function update(dt){
  if(input.dragging) return;

  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  const speed = Math.hypot(disk.vx, disk.vy);
  if(speed > 1e-6 && friction > 0){
    const decel = speed * friction * dt * frameMultiplier;
    const rawNewSpeed = speed - decel;
    let newSpeed;
    // if the sign would change (overshoot past zero), keep original speed
    if(Math.sign(rawNewSpeed) !== Math.sign(speed)){
      newSpeed = speed;
    } else {
      newSpeed = rawNewSpeed;
    }
    const scale = newSpeed / speed;
    disk.vx *= scale;
    disk.vy *= scale;
  }

  disk.x += disk.vx * dt;
  disk.y += disk.vy * dt;

  const W = canvas.width, H = canvas.height;
  let bounced = false, bounceSpeed = 0;
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= params.wallBounce; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= params.wallBounce; bounced = true; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= params.wallBounce; bounced = true; }
  if(disk.y + disk.r > H){ disk.y = H - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= params.wallBounce; bounced = true; }
  if(bounced) playKnock(Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1));
}
