import { canvas, disk, bar, screen } from './state.js';

export function initControls(){
  const altFriction = document.getElementById('altFriction');
  if(altFriction){
    altFriction.addEventListener('click', () => {
      const isOn = altFriction.dataset.on === 'true';
      altFriction.dataset.on = isOn ? 'false' : 'true';
      altFriction.textContent = (isOn ? '○' : '✓') + ' Alt Friction';
    });
  }

  const resetBtn = document.getElementById('resetDisk');
  resetBtn.addEventListener('pointerdown', (e)=> e.stopPropagation());
  resetBtn.addEventListener('click', ()=>{
    bar.y = canvas.height * 0.85;
    bar.prevY = bar.y;
    bar.vy = 0;
    disk.x = canvas.width / 2;
    disk.y = (bar.y - disk.r) / 2;
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
