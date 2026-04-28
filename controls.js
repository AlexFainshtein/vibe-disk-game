import { canvas, screen } from './state.js';
import { disk, bar } from './playfield.js';

export function initControls(){
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if(fullscreenBtn){
    fullscreenBtn.addEventListener('pointerdown', (e)=> e.stopPropagation());
    fullscreenBtn.addEventListener('click', ()=>{
      if(document.fullscreenElement || document.webkitFullscreenElement){
        (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
      } else {
        const el = document.documentElement;
        (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
      }
    });
  }

  // Reset resets the playfield primitives (disk + bar). Variant features that want
  // to react to Reset (alex-bumper clearing, eugene-bricks regenerating) subscribe
  // their own listeners directly to this button — controls.js doesn't dispatch.
  const resetBtn = document.getElementById('resetDisk');
  resetBtn.addEventListener('pointerdown', (e)=> e.stopPropagation());
  resetBtn.addEventListener('click', ()=>{
    const eugene = document.body.dataset.player === 'eugene';
    if(!bar.hidden){
      bar.y = eugene ? canvas.height - bar.height : bar.height;
      bar.prevY = bar.y;
      bar.vy = 0;
    }
    disk.x = canvas.width / 2;
    disk.y = canvas.height / 2;
    disk.vx = 0;
    disk.vy = 0;
  });

  const btnAlex = document.getElementById('btnAlex');
  const btnEugene = document.getElementById('btnEugene');

  if(btnAlex && btnEugene){
    btnAlex.addEventListener('pointerdown', (e)=> e.stopPropagation());
    btnEugene.addEventListener('pointerdown', (e)=> e.stopPropagation());

    btnAlex.addEventListener('click', ()=>{
      screen.current = 'alex';
      btnAlex.classList.add('active');
      btnEugene.classList.remove('active');
    });

    btnEugene.addEventListener('click', ()=>{
      screen.current = 'eugene';
      btnEugene.classList.add('active');
      btnAlex.classList.remove('active');
    });
  }
}
