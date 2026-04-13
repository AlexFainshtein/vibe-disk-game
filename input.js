import { canvas, disk, input } from './state.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

export function setupInput(){
  canvas.addEventListener('pointerdown', (ev)=>{
    const p = eventPos(ev);
    if(distance(p, disk) <= disk.r){
      input.dragging = true;
      disk.vx = 0; disk.vy = 0;
      input.mouseBuf = [p];
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev)=>{
    if(!input.dragging) return;
    const p = eventPos(ev);
    disk.x = p.x; disk.y = p.y;
    input.mouseBuf.push(p);
    if(input.mouseBuf.length > 6) input.mouseBuf.shift();
  });

  canvas.addEventListener('pointerup', (ev)=>{
    if(!input.dragging) return;
    input.dragging = false;
    const buf = input.mouseBuf;
    if(buf.length >= 2){
      const a = buf[buf.length-2];
      const b = buf[buf.length-1];
      const dt = Math.max(1e-3, (b.t - a.t)/1000);
      disk.vx = (b.x - a.x)/dt;
      disk.vy = (b.y - a.y)/dt;
      const max = 1600;
      const speed = Math.hypot(disk.vx, disk.vy);
      if(speed > max){ disk.vx *= max/speed; disk.vy *= max/speed; }
    }
    input.mouseBuf = [];
    try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
  });
}
