import { params, disk } from './state.js';

const STORAGE_KEY = 'vibe-settings';

function saveSettings(){
  const s = { friction: params.friction, diskRadius: params.diskRadius };
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){}
}

function loadSettings(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const s = JSON.parse(raw);
    if(typeof s.friction === 'number') params.friction = s.friction;
    if(typeof s.diskRadius === 'number') params.diskRadius = s.diskRadius;
  }catch(e){}
}

export function initControls(){
  loadSettings();
  const rSlider = document.getElementById('diskRadius');
  const rVal = document.getElementById('diskRadiusVal');
  const fSlider = document.getElementById('friction');
  const fVal = document.getElementById('frictionVal');
  const reset = document.getElementById('resetDefaults');

  rSlider.value = params.diskRadius;
  fSlider.value = params.friction;
  rVal.textContent = params.diskRadius;
  fVal.textContent = String(params.friction);
  disk.r = params.diskRadius;

  rSlider.addEventListener('input', (e)=>{
    params.diskRadius = Number(e.target.value);
    rVal.textContent = params.diskRadius;
    disk.r = params.diskRadius;
    saveSettings();
  });
  fSlider.addEventListener('input', (e)=>{
    params.friction = Number(e.target.value);
    fVal.textContent = params.friction.toFixed(3);
    saveSettings();
  });

  reset.addEventListener('click', ()=>{
    params.friction = 0.98; params.diskRadius = 36;
    rSlider.value = params.diskRadius; fSlider.value = params.friction;
    rVal.textContent = params.diskRadius; fVal.textContent = params.friction;
    disk.r = params.diskRadius; saveSettings();
  });
}
