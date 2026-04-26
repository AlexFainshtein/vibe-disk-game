import { canvas, inputHooks } from './state.js';
import { disk, bar, clickMarker, diskHistory, anchor, clampBarY } from './playfield.js';
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
  let yMin, yMax;
  if(bar.layout === 'top'){
    yMin = bar.y + bar.height + margin; // just below the bar (the ceiling)
    yMax = canvas.height - margin;       // just above the floor
  } else {
    yMin = margin;                        // just below the canvas top
    yMax = bar.y - margin;                // just above the bar (the floor)
  }
  return {
    x: Math.max(margin, Math.min(canvas.width - margin, x)),
    y: Math.max(yMin, Math.min(yMax, y))
  };
}

export function setupInput(){
  let barGrabOffset = 0;
  let emptyEngaged = false; // a feature module captured the current empty-space pointer

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
    // if(hit) console.log('Hit! Frame lag:', hitFrame, '(0 = current frame)');
    // else console.log('Miss');
    clickMarker.hit = hit;
    clickMarker.active = true;

    if(hit){
      const clamped = clampAnchor(p.x, p.y);
      anchor.active = true;
      anchor.x = clamped.x;
      anchor.y = clamped.y;
      anchor.prevX = clamped.x;
      anchor.prevY = clamped.y;
      disk.glass = false;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
    } else if(inputHooks.emptyDown){
      emptyEngaged = inputHooks.emptyDown(p.x, p.y) === true;
      if(emptyEngaged) canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev)=>{
    const p = eventPos(ev);
    if(bar.dragging){
      bar.y = clampBarY(p.y + barGrabOffset);

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
      return;
    }
    if(emptyEngaged && inputHooks.emptyMove){
      inputHooks.emptyMove(p.x, p.y);
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
      return;
    }
    if(emptyEngaged){
      emptyEngaged = false;
      if(inputHooks.emptyUp) inputHooks.emptyUp();
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
    }
  });
}
