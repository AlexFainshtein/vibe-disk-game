let ctx = null;

function getCtx(){
  if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export function playKnock(intensity){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();

  const vol = 0.15 + 0.55 * intensity;
  const freq = 120 + 180 * intensity;
  const duration = 0.04 + 0.03 * intensity;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + duration);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800 + 600 * intensity, ac.currentTime);
  filter.Q.setValueAtTime(1.5, ac.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration + 0.01);
}
