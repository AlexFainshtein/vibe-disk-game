import { canvas, params, disk, input } from './state.js';

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
  if(disk.x - disk.r < 0){ disk.x = disk.r; disk.vx *= params.wallBounce; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; disk.vx *= params.wallBounce; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; disk.vy *= params.wallBounce; }
  if(disk.y + disk.r > H){ disk.y = H - disk.r; disk.vy *= params.wallBounce; }
}
