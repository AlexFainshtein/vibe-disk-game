import { canvas, disk, bar, clickMarker, diskHistory, anchor, ghostDisk, GHOST_LIFE } from './state.js';
import { playGrab, playRelease } from './sound.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

function clampAnchor(x, y){
  const margin = disk.r + 0.5;
  return {
    x: Math.max(margin, Math.min(canvas.width - margin, x)),
    y: Math.max(margin, Math.min(bar.y - margin, y))
  };
}

export function setupInput(){
  let barGrabOffset = 0;
  let prevPointer = null; // {x, y, t} — used to estimate tap velocity for ghost disk

  // Prevent double-tap-and-hold text-selection loupe on iOS (canvas only, so buttons still work)
  let lastTouchEnd = 0;
  canvas.addEventListener('touchend',   () => { lastTouchEnd = Date.now(); }, { passive: true });
  canvas.addEventListener('touchstart', (e) => { if(Date.now() - lastTouchEnd <= 500) e.preventDefault(); }, { passive: false });

  canvas.addEventListener('pointerdown', (ev)=>{
    const p = eventPos(ev);

    // Check bar hit first (must click directly on the bar)
    if(p.y >= bar.y && p.y <= bar.y + bar.height){
      bar.dragging = true;
      barGrabOffset = bar.y - p.y;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
      return;
    }

    // lag-compensated hit detection: check current + recent positions
    let hit = false;
    let hitFrame = -1;
    if(distance(p, disk) <= disk.r){
      hit = true;
      hitFrame = 0;
    } else {
      for(let i = diskHistory.length - 1; i >= 0; i--){
        if(distance(p, diskHistory[i]) <= disk.r){
          hit = true;
          hitFrame = diskHistory.length - i;
          break;
        }
      }
    }
    if(hit) console.log('Hit! Frame lag:', hitFrame, '(0 = current frame)');
    else console.log('Miss');
    clickMarker.hit = hit;
    clickMarker.active = true;

    if(hit){
      const clamped = clampAnchor(p.x, p.y);
      anchor.active = true;
      anchor.x = clamped.x;
      anchor.y = clamped.y;
      anchor.prevX = clamped.x;
      anchor.prevY = clamped.y;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
    } else if(document.body.dataset.player === 'eugene'){
      // Spawn a ghost disk at the tap position (Eugene's variant only).
      // Velocity is estimated from pointer movement leading into the tap.
      let gvx = 0, gvy = 0;
      if(prevPointer){
        const dt = (p.t - prevPointer.t) / 1000;
        if(dt > 0 && dt < 0.2){
          gvx = (p.x - prevPointer.x) / dt;
          gvy = (p.y - prevPointer.y) / dt;
        }
      }
      ghostDisk.active = true;
      ghostDisk.x = p.x;
      ghostDisk.y = p.y;
      ghostDisk.vx = gvx;
      ghostDisk.vy = gvy;
      ghostDisk.life = GHOST_LIFE;
    }
    prevPointer = p;
  });

  canvas.addEventListener('pointermove', (ev)=>{
    const p = eventPos(ev);
    prevPointer = p;
    if(bar.dragging){
      const minBarY = disk.r * 2;
      let newBarY = p.y + barGrabOffset;
      bar.y = Math.max(minBarY, Math.min(canvas.height - bar.height, newBarY));

      // auto-release if pointer leaves the bar due to clamping
      if(p.y < bar.y || p.y > bar.y + bar.height){
        bar.dragging = false;
        playRelease();
        try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      }
      return;
    }
    if(anchor.active){
      const clamped = clampAnchor(p.x, p.y);
      anchor.x = clamped.x;
      anchor.y = clamped.y;
    }
  });

  canvas.addEventListener('pointerup', (ev)=>{
    if(bar.dragging){
      bar.dragging = false;
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      return;
    }
    if(anchor.active){
      anchor.active = false;
      clickMarker.active = false;
      playRelease();
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
    }
  });
}
