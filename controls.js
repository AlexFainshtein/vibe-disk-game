import { canvas, disk, bar, screen, initBricks } from './state.js';

export function initControls(){
  const altFriction = document.getElementById('altFriction');
  if(altFriction){
    altFriction.addEventListener('click', () => {
      const isOn = altFriction.dataset.on === 'true';
      altFriction.dataset.on = isOn ? 'false' : 'true';
      altFriction.textContent = (isOn ? '○' : '✓') + ' Alt Friction';
    });
  }

  const quadSpring = document.getElementById('quadSpring');
  if(quadSpring){
    quadSpring.addEventListener('click', () => {
      const isOn = quadSpring.dataset.on === 'true';
      quadSpring.dataset.on = isOn ? 'false' : 'true';
      quadSpring.textContent = (isOn ? '○' : '✓') + ' Quadratic Spring';
    });
  }

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

  const resetBtn = document.getElementById('resetDisk');
  resetBtn.addEventListener('pointerdown', (e)=> e.stopPropagation());
  resetBtn.addEventListener('click', ()=>{
    bar.y = document.body.dataset.player === 'eugene' ? canvas.height - bar.height : canvas.height * 0.85;
    bar.prevY = bar.y;
    bar.vy = 0;
    disk.x = canvas.width / 2;
    disk.y = (bar.y - disk.r) / 2;
    disk.vx = 0;
    disk.vy = 0;
    initBricks();
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
