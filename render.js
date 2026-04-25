import { canvas, ctx, disk, bar, clickMarker, anchor, screen, renderExtras } from './state.js';

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const bg = screen.backgrounds[screen.current];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, bg.top); g.addColorStop(1, bg.bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // bar
  ctx.fillStyle = bar.color;
  ctx.fillRect(0, bar.y, W, bar.height);

  // feature-supplied extras (e.g. targets), behind the disk
  for(const fn of renderExtras) fn(ctx);

  // shadow
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.ellipse(disk.x+6,disk.y+8,disk.r*0.95,disk.r*0.5,0,0,Math.PI*2);
  ctx.fill();

  // disk
  ctx.beginPath();
  ctx.fillStyle = disk.color;
  ctx.arc(disk.x,disk.y,disk.r,0,Math.PI*2);
  ctx.fill();

  // highlight
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.ellipse(disk.x - disk.r*0.25, disk.y - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
  ctx.fill();

  // debug: disk boundary circle on hit
  if(clickMarker.active && clickMarker.hit){
    ctx.beginPath();
    ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(0,255,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // spring line from anchor to disk center
  if(anchor.active){
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(disk.x, disk.y);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.stroke();
    // dot at anchor point
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI*2);
    ctx.fillStyle = '#00ff00';
    ctx.fill();
  }
}
