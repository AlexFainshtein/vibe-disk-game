// XPBD-with-substepping convergence diagnostic. Runs once at module load.
//
// Same scenario as the previous PBD test: anchor jumps right by ANCHOR_DELTA,
// all other particles start at rest. But instead of pure constraint sweeps,
// we run SUBSTEPS substeps, each consisting of a Verlet step + ITERS_PER_SUBSTEP
// XPBD constraint sweeps. Records dx_i after every substep; writes CSV to the
// console + triggers a download (xpbd-convergence.csv).
//
// At COMPLIANCE = 0 the per-iteration math reduces to PBD, but the Verlet
// step between substeps propagates implicit velocity through the chain, so
// the dynamics look like a propagating + reflecting wave rather than a
// monotonic positional relaxation. No damping in the system, so don't expect
// the chain to settle at the equilibrium dx_i = ANCHOR_DELTA — it will
// oscillate around it.

(function diagnostic(){
  const N_TEST            = 10;
  const L_TEST            = 50;     // segment length (px)
  const ANCHOR_DELTA      = 30;     // anchor moves right by this many px
  const SUBSTEPS          = 30;
  const ITERS_PER_SUBSTEP = 1;
  const COMPLIANCE        = 0;

  // dt is symbolic for this test: at α = 0 and a = 0, subDt drops out of
  // both the Verlet step (a · subDt² = 0) and the XPBD formula
  // (alphaTilde = α / subDt² = 0). Any positive value works.
  const SUB_DT     = 1 / (60 * SUBSTEPS);
  const alphaTilde = COMPLIANCE / (SUB_DT * SUB_DT);

  const p = [];
  const initialX = [];
  for(let i = 0; i < N_TEST; i++){
    const x = i * L_TEST;
    p.push({ x, y: 0, px: x, py: 0 });
    initialX.push(x);
  }

  // Anchor jumps right; clear its implicit velocity.
  p[0].x += ANCHOR_DELTA;
  p[0].px = p[0].x;

  const lambda = new Float64Array(N_TEST - 1);
  const rows = [];
  rows.push(['substep', ...Array.from({length: N_TEST}, (_, i) => `dx_${i}`)].join(','));

  function recordRow(s){
    rows.push([s, ...p.map((q, i) => (q.x - initialX[i]).toFixed(6))].join(','));
  }

  // Substep 0: state right after anchor jump, before any substep.
  recordRow(0);

  for(let s = 1; s <= SUBSTEPS; s++){
    // 1. Verlet step for non-anchor particles.
    for(let i = 1; i < N_TEST; i++){
      const part = p[i];
      const vx = part.x - part.px;
      const vy = part.y - part.py;
      part.px = part.x;
      part.py = part.y;
      part.x += vx;
      part.y += vy;
    }

    // 2. Reset Lagrange multipliers at the start of every substep.
    lambda.fill(0);

    // 3. XPBD constraint sweeps.
    for(let iter = 0; iter < ITERS_PER_SUBSTEP; iter++){
      for(let j = 0; j < N_TEST - 1; j++){
        const a = p[j];
        const b = p[j + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const nx = dx / dist, ny = dy / dist;
        const C = dist - L_TEST;
        const wA = (j === 0) ? 0 : 1;
        const wB = 1;
        const dLambda = (-C - alphaTilde * lambda[j]) / (wA + wB + alphaTilde);
        lambda[j] += dLambda;
        a.x -= dLambda * wA * nx;
        a.y -= dLambda * wA * ny;
        b.x += dLambda * wB * nx;
        b.y += dLambda * wB * ny;
      }
    }
    recordRow(s);
  }

  const csv = rows.join('\n');
  console.log(`XPBD convergence: ${N_TEST} particles, segment ${L_TEST}, anchor Δ=${ANCHOR_DELTA}, ${SUBSTEPS} substeps × ${ITERS_PER_SUBSTEP} iter, compliance=${COMPLIANCE}`);
  console.log(csv);

  try {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'xpbd-convergence.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(err){
    console.warn('CSV download failed; copy the CSV block above instead.', err);
  }
})();
