import { canvas, inputHooks } from './state.js';
import { disk, bar, diskHistory, anchor, clampBarY } from './playfield.js';
import { playGrab, playRelease } from './sound.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

function clampAnchor(x, y){
  return { x, y };
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

    // Check bar hit first (must click directly on the bar).
    // barDown hook is checked regardless of bar.hidden so variants that draw
    // their own bar (hidden=true) can still intercept touches in the bar area.
    const inBarBounds = p.y >= bar.y && p.y <= bar.y + bar.height;
    if(inBarBounds && inputHooks.barDown && inputHooks.barDown(p.x, p.y) === true){
      emptyEngaged = true; // reuse emptyEngaged so move/up route through emptyMove/emptyUp
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if(!bar.hidden && inBarBounds){
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

    if(hit && inputHooks.diskGrab !== false){
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
