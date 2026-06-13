// Standalone Node test for Alex2's analytical Jacobian blocks.
//
// Builds A_raw and B_raw two ways at a given chain state:
//   (1) Analytically, via a copy of buildJacobianBlocks from alex2-physics.js.
//   (2) Numerically (finite-difference): perturb each θ_k / θ̇_m by ε, recompute
//       θ̈ = M⁻¹·b at the perturbed state, take the central difference to get
//       A = ∂θ̈/∂θ, B = ∂θ̈/∂θ̇.  Then multiply by M(base state) to get
//       A_raw_FD = M·A_FD, B_raw_FD = M·B_FD — the same quantities the
//       analytical builder writes.
//
// Reports max absolute / relative error per block at each test state and
// flags any worst-offender entry.
//
// Run: node jacobian-fd-check.js
//
// NOTE: this file is a self-contained copy of the math from alex2-physics.js,
// so when alex2-physics.js changes, this must be re-synced.  Keeping it
// standalone is the price of running in Node without mocking the browser
// state.js / playfield.js modules.

'use strict';

// ----------------------------------------------------------------------
// Constants — match alex2-physics.js (run two passes, once each setting)
// ----------------------------------------------------------------------

const BENDING_EI    = 100;
const DAMPING_BEND  = 1;
const VISCOUS_DRAG  = 0.1;

// Toggled by run loop below.
let SIMPLIFIED_PHYSICS = false;

// ----------------------------------------------------------------------
// Math functions — copied verbatim from alex2-physics.js (modulo dropping
// the module-level pivot tracking globals; gaussSolve below ignores them).
// ----------------------------------------------------------------------

function makeRope(Ns, segmentLength, particleMass){
  const muDiag = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++) muDiag[j] = (Ns - j) * particleMass;
  return {
    Ns, segmentLength, particleMass, muDiag,
    M:      new Float64Array(Ns * Ns),
    M_snap: new Float64Array(Ns * Ns),
    A_raw:  new Float64Array(Ns * Ns),
    B_raw:  new Float64Array(Ns * Ns),
    rhs:    new Float64Array(Ns),
    accel:  new Float64Array(Ns),
    tmpNs:  new Float64Array(Ns),
    tmpNs2: new Float64Array(Ns),
  };
}

function buildMassMatrix(rope, theta){
  const Ns = rope.Ns;
  const L  = rope.segmentLength;
  const m  = rope.particleMass;
  const M  = rope.M;
  const L2 = L * L;
  if(SIMPLIFIED_PHYSICS){
    for(let j = 0; j < Ns; j++){
      for(let k = 0; k < Ns; k++){
        const mu = (Ns - Math.max(j, k)) * m;
        M[j * Ns + k] = L2 * mu;
      }
    }
    return;
  }
  for(let j = 0; j < Ns; j++){
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      M[j * Ns + k] = L2 * Math.cos(theta[j] - theta[k]) * mu;
    }
  }
}

function buildRhs(rope, theta, thetaDot, ax, ay){
  const Ns      = rope.Ns;
  const L       = rope.segmentLength;
  const m       = rope.particleMass;
  const muDiag  = rope.muDiag;
  const rhs     = rope.rhs;
  const L2      = L * L;
  const kTheta  = BENDING_EI / L;
  for(let j = 0; j < Ns; j++){
    let qAnchor = L * muDiag[j] * (Math.sin(theta[j]) * ax - Math.cos(theta[j]) * ay);
    let cj = 0;
    if(!SIMPLIFIED_PHYSICS){
      for(let k = 0; k < Ns; k++){
        const mu = (Ns - Math.max(j, k)) * m;
        cj += L2 * mu * Math.sin(theta[j] - theta[k]) * thetaDot[k] * thetaDot[k];
      }
    }
    let qDamp = 0;
    if(Ns >= 2){
      let lapThetaDot;
      if(j === 0){
        lapThetaDot = thetaDot[1] - thetaDot[0];
      } else if(j === Ns - 1){
        lapThetaDot = thetaDot[Ns - 2] - thetaDot[Ns - 1];
      } else {
        lapThetaDot = thetaDot[j - 1] - 2 * thetaDot[j] + thetaDot[j + 1];
      }
      qDamp = DAMPING_BEND * lapThetaDot;
    }
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      if(SIMPLIFIED_PHYSICS){
        let lapTheta;
        if(j === 0){
          lapTheta = theta[1] - theta[0];
        } else if(j === Ns - 1){
          lapTheta = theta[Ns - 2] - theta[Ns - 1];
        } else {
          lapTheta = theta[j - 1] - 2 * theta[j] + theta[j + 1];
        }
        qBend = kTheta * lapTheta;
      } else {
        const piMinusEps = Math.PI - 0.01;
        let vpLeft = 0;
        if(j > 0){
          let dl = theta[j] - theta[j - 1];
          if(dl >  piMinusEps) dl =  piMinusEps;
          else if(dl < -piMinusEps) dl = -piMinusEps;
          vpLeft = 2 * kTheta * Math.tan(dl * 0.5);
        }
        let vpRight = 0;
        if(j < Ns - 1){
          let dr = theta[j + 1] - theta[j];
          if(dr >  piMinusEps) dr =  piMinusEps;
          else if(dr < -piMinusEps) dr = -piMinusEps;
          vpRight = 2 * kTheta * Math.tan(dr * 0.5);
        }
        qBend = vpRight - vpLeft;
      }
    }
    rhs[j] = qAnchor - cj + qBend + qDamp;
  }
}

function gaussSolve(N, A, b, x){
  for(let p = 0; p < N; p++){
    let pivotRow = p;
    let pivotMag = Math.abs(A[p * N + p]);
    for(let r = p + 1; r < N; r++){
      const mag = Math.abs(A[r * N + p]);
      if(mag > pivotMag){ pivotMag = mag; pivotRow = r; }
    }
    if(pivotRow !== p){
      for(let c = p; c < N; c++){
        const tmp = A[p * N + c];
        A[p * N + c] = A[pivotRow * N + c];
        A[pivotRow * N + c] = tmp;
      }
      const tmp = b[p]; b[p] = b[pivotRow]; b[pivotRow] = tmp;
    }
    const pivot = A[p * N + p];
    if(Math.abs(pivot) < 1e-12){
      for(let i = 0; i < N; i++) x[i] = 0;
      return;
    }
    for(let r = p + 1; r < N; r++){
      const factor = A[r * N + p] / pivot;
      if(factor === 0) continue;
      for(let c = p; c < N; c++){
        A[r * N + c] -= factor * A[p * N + c];
      }
      b[r] -= factor * b[p];
    }
  }
  for(let i = N - 1; i >= 0; i--){
    let sum = b[i];
    for(let c = i + 1; c < N; c++){
      sum -= A[i * N + c] * x[c];
    }
    x[i] = sum / A[i * N + i];
  }
}

function buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay){
  const Ns         = rope.Ns;
  const L          = rope.segmentLength;
  const m          = rope.particleMass;
  const muDiag     = rope.muDiag;
  const L2         = L * L;
  const kTheta     = BENDING_EI / L;
  const piMinusEps = Math.PI - 0.01;
  const A          = rope.A_raw;
  const B          = rope.B_raw;
  const M          = rope.M_snap;
  const w          = rope.tmpNs;
  const S          = rope.tmpNs2;

  A.fill(0);
  B.fill(0);

  if(!SIMPLIFIED_PHYSICS){
    for(let i = 0; i < Ns; i++) w[i] = VISCOUS_DRAG * thetaDot[i] + ddt[i];
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++){
        const mu = (Ns - Math.max(i, j)) * m;
        s += L2 * mu * Math.sin(theta[i] - theta[j]) * w[j];
      }
      S[i] = s;
    }
  }

  for(let k = 0; k < Ns; k++){
    A[k * Ns + k] += L * muDiag[k] * (Math.cos(theta[k]) * ax + Math.sin(theta[k]) * ay);

    if(!SIMPLIFIED_PHYSICS){
      const tdk2 = thetaDot[k] * thetaDot[k];
      for(let i = 0; i < Ns; i++){
        const muIK = (Ns - Math.max(i, k)) * m;
        A[i * Ns + k] += L2 * muIK * Math.cos(theta[i] - theta[k]) * tdk2;
      }
      let sumC = 0;
      for(let l = 0; l < Ns; l++){
        const muKL = (Ns - Math.max(k, l)) * m;
        sumC += L2 * muKL * Math.cos(theta[k] - theta[l]) * thetaDot[l] * thetaDot[l];
      }
      A[k * Ns + k] -= sumC;
    }

    if(!SIMPLIFIED_PHYSICS){
      for(let i = 0; i < Ns; i++){
        const muIK = (Ns - Math.max(i, k)) * m;
        A[i * Ns + k] -= L2 * muIK * Math.sin(theta[i] - theta[k]) * w[k];
      }
      A[k * Ns + k] += S[k];
    }
  }

  if(BENDING_EI !== 0 && Ns >= 2){
    for(let i = 0; i < Ns; i++){
      if(i < Ns - 1){
        let Vpp;
        if(SIMPLIFIED_PHYSICS){
          Vpp = kTheta;
        } else {
          let dr = theta[i + 1] - theta[i];
          if(dr >  piMinusEps) dr =  piMinusEps;
          else if(dr < -piMinusEps) dr = -piMinusEps;
          const c = Math.cos(dr * 0.5);
          Vpp = kTheta / (c * c);
        }
        A[i * Ns + i]       -= Vpp;
        A[i * Ns + (i + 1)] += Vpp;
      }
      if(i > 0){
        let Vpp;
        if(SIMPLIFIED_PHYSICS){
          Vpp = kTheta;
        } else {
          let dl = theta[i] - theta[i - 1];
          if(dl >  piMinusEps) dl =  piMinusEps;
          else if(dl < -piMinusEps) dl = -piMinusEps;
          const c = Math.cos(dl * 0.5);
          Vpp = kTheta / (c * c);
        }
        A[i * Ns + i]       -= Vpp;
        A[i * Ns + (i - 1)] += Vpp;
      }
    }
  }

  for(let j = 0; j < Ns; j++){
    for(let mm = 0; mm < Ns; mm++){
      if(!SIMPLIFIED_PHYSICS){
        const muJM = (Ns - Math.max(j, mm)) * m;
        B[j * Ns + mm] -= 2 * L2 * muJM * Math.sin(theta[j] - theta[mm]) * thetaDot[mm];
      }
      B[j * Ns + mm] -= VISCOUS_DRAG * M[j * Ns + mm];
    }
  }

  if(DAMPING_BEND !== 0 && Ns >= 2){
    const c = DAMPING_BEND;
    B[0 * Ns + 0] -= c;
    B[0 * Ns + 1] += c;
    for(let j = 1; j < Ns - 1; j++){
      B[j * Ns + (j - 1)] += c;
      B[j * Ns + j]       -= 2 * c;
      B[j * Ns + (j + 1)] += c;
    }
    B[(Ns - 1) * Ns + (Ns - 2)] += c;
    B[(Ns - 1) * Ns + (Ns - 1)] -= c;
  }
}

// ----------------------------------------------------------------------
// Helpers: deriv (θ̈ at a state), matrix multiply, comparison
// ----------------------------------------------------------------------

// Computes θ̈ at (theta, thetaDot) given ax, ay.  Mirrors alex2-physics.js's
// implicit-Euler path: build M, build b_conservative, add -α·M·θ̇ for mass
// damping, solve M·θ̈ = b_full.  Returns a Float64Array of θ̈ (allocates).
function computeDdt(rope, theta, thetaDot, ax, ay){
  const Ns = rope.Ns;
  buildMassMatrix(rope, theta);
  // Snapshot M before gaussSolve destroys it.
  const Mcopy = new Float64Array(rope.M);
  buildRhs(rope, theta, thetaDot, ax, ay);
  if(VISCOUS_DRAG !== 0){
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++) s += Mcopy[i * Ns + j] * thetaDot[j];
      rope.rhs[i] -= VISCOUS_DRAG * s;
    }
  }
  // gaussSolve destroys M and rhs; result lands in accel.
  gaussSolve(Ns, rope.M, rope.rhs, rope.accel);
  const out = new Float64Array(Ns);
  out.set(rope.accel);
  // Restore M to its snapshot (so the caller can rely on rope.M being intact).
  rope.M.set(Mcopy);
  return out;
}

// Builds A_FD, B_FD by central differences on θ̈, then returns
// A_raw_FD = M·A_FD and B_raw_FD = M·B_FD (matching the analytical
// convention).  Uses base-state M for the multiply.
function fdJacobianBlocks(rope, theta, thetaDot, ax, ay, eps){
  const Ns = rope.Ns;
  const A_FD = new Float64Array(Ns * Ns);
  const B_FD = new Float64Array(Ns * Ns);
  const thetaPert    = new Float64Array(theta);
  const thetaDotPert = new Float64Array(thetaDot);

  // ∂θ̈/∂θ_k by central difference.
  for(let k = 0; k < Ns; k++){
    thetaPert[k] = theta[k] + eps;
    const ddtPlus = computeDdt(rope, thetaPert, thetaDot, ax, ay);
    thetaPert[k] = theta[k] - eps;
    const ddtMinus = computeDdt(rope, thetaPert, thetaDot, ax, ay);
    thetaPert[k] = theta[k];
    for(let i = 0; i < Ns; i++){
      A_FD[i * Ns + k] = (ddtPlus[i] - ddtMinus[i]) / (2 * eps);
    }
  }

  // ∂θ̈/∂θ̇_m by central difference.
  for(let mm = 0; mm < Ns; mm++){
    thetaDotPert[mm] = thetaDot[mm] + eps;
    const ddtPlus = computeDdt(rope, theta, thetaDotPert, ax, ay);
    thetaDotPert[mm] = thetaDot[mm] - eps;
    const ddtMinus = computeDdt(rope, theta, thetaDotPert, ax, ay);
    thetaDotPert[mm] = thetaDot[mm];
    for(let j = 0; j < Ns; j++){
      B_FD[j * Ns + mm] = (ddtPlus[j] - ddtMinus[j]) / (2 * eps);
    }
  }

  // Convert FD A and B to A_raw and B_raw by multiplying by base-state M.
  buildMassMatrix(rope, theta);
  const Mbase = rope.M;
  const A_raw_FD = new Float64Array(Ns * Ns);
  const B_raw_FD = new Float64Array(Ns * Ns);
  for(let i = 0; i < Ns; i++){
    for(let k = 0; k < Ns; k++){
      let sA = 0, sB = 0;
      for(let j = 0; j < Ns; j++){
        sA += Mbase[i * Ns + j] * A_FD[j * Ns + k];
        sB += Mbase[i * Ns + j] * B_FD[j * Ns + k];
      }
      A_raw_FD[i * Ns + k] = sA;
      B_raw_FD[i * Ns + k] = sB;
    }
  }
  return { A_raw_FD, B_raw_FD };
}

// Compares two square Float64Arrays of size Ns·Ns.  Returns
// { maxAbs, maxRel, worstAbs:{i,k,a,b}, worstRel:{i,k,a,b} }.
function compareMatrices(A, B, Ns, label){
  let maxAbs = 0, maxRel = 0;
  let worstAbs = { i: 0, k: 0, a: 0, b: 0 };
  let worstRel = { i: 0, k: 0, a: 0, b: 0 };
  for(let i = 0; i < Ns; i++){
    for(let k = 0; k < Ns; k++){
      const idx = i * Ns + k;
      const a = A[idx];
      const b = B[idx];
      const absErr = Math.abs(a - b);
      if(absErr > maxAbs){ maxAbs = absErr; worstAbs = { i, k, a, b }; }
      const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
      const relErr = absErr / denom;
      if(relErr > maxRel && denom > 1e-8){
        maxRel = relErr;
        worstRel = { i, k, a, b };
      }
    }
  }
  return { label, maxAbs, maxRel, worstAbs, worstRel };
}

function fmt(x){
  if(!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if(a === 0) return '0';
  if(a >= 1e4 || a < 1e-3) return x.toExponential(3);
  return x.toFixed(6);
}

function reportComparison(cmp){
  console.log(`    ${cmp.label}:  maxAbs=${fmt(cmp.maxAbs)}  maxRel=${fmt(cmp.maxRel)}`);
  if(cmp.maxRel > 1e-4){
    console.log(`      worst rel at (i=${cmp.worstRel.i}, k=${cmp.worstRel.k}):  analytical=${fmt(cmp.worstRel.a)}  fd=${fmt(cmp.worstRel.b)}`);
  }
  if(cmp.maxAbs > 1e-4){
    console.log(`      worst abs at (i=${cmp.worstAbs.i}, k=${cmp.worstAbs.k}):  analytical=${fmt(cmp.worstAbs.a)}  fd=${fmt(cmp.worstAbs.b)}`);
  }
}

// ----------------------------------------------------------------------
// Test runner: given a state, compare analytical vs FD Jacobian blocks.
// ----------------------------------------------------------------------

function runTest(label, Ns, segmentLength, particleMass, thetaFn, thetaDotFn, ax, ay, eps = 1e-5){
  const rope = makeRope(Ns, segmentLength, particleMass);
  const theta    = new Float64Array(Ns);
  const thetaDot = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++){
    theta[j]    = thetaFn(j, Ns);
    thetaDot[j] = thetaDotFn(j, Ns);
  }

  // Compute analytical A_raw, B_raw.
  const ddt = computeDdt(rope, theta, thetaDot, ax, ay);
  buildMassMatrix(rope, theta);
  rope.M_snap.set(rope.M);
  buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay);
  const A_an = new Float64Array(rope.A_raw);
  const B_an = new Float64Array(rope.B_raw);

  // FD baseline.
  const { A_raw_FD, B_raw_FD } = fdJacobianBlocks(rope, theta, thetaDot, ax, ay, eps);

  console.log(`\n=== ${label}  (Ns=${Ns}, SIMPLIFIED_PHYSICS=${SIMPLIFIED_PHYSICS}, eps=${eps}) ===`);
  reportComparison(compareMatrices(A_an, A_raw_FD, Ns, 'A_raw'));
  reportComparison(compareMatrices(B_an, B_raw_FD, Ns, 'B_raw'));
}

// ----------------------------------------------------------------------
// Test states
// ----------------------------------------------------------------------

const L_default = 2.5;            // canvas.width=550, ROPE_LENGTH_FRACTION=0.45, Ns=99 → ~2.5 px
const m_default = 1 / 99;         // M_ROPE=1, Ns=99

// Use small Ns for first sanity test (more readable diagnostics).
const Ns_small = 5;
const L_small  = (550 * 0.45) / Ns_small;
const m_small  = 1 / Ns_small;

function runAllStates(){
  // 1. Straight chain at rest, no anchor input.
  runTest('straight-at-rest, ax=ay=0',
    Ns_small, L_small, m_small,
    () => 0,
    () => 0,
    0, 0);

  // 2. Straight chain, with anchor acceleration.
  runTest('straight, ax=10 ay=20',
    Ns_small, L_small, m_small,
    () => 0,
    () => 0,
    10, 20);

  // 3. Mildly bent chain at rest.
  runTest('mildly-bent (θ_j=0.1j), θ̇=0, no anchor',
    Ns_small, L_small, m_small,
    (j) => 0.1 * j,
    () => 0,
    0, 0);

  // 4. Bent + rotating, mid-amplitude.
  runTest('bent (θ_j=0.2j) + rotating (θ̇_j=0.5sin(j)), ax=5 ay=5',
    Ns_small, L_small, m_small,
    (j) => 0.2 * j,
    (j) => 0.5 * Math.sin(j),
    5, 5);

  // 5. Random small-amplitude state.
  runTest('random small-amplitude',
    Ns_small, L_small, m_small,
    (j) => 0.3 * Math.sin(j * 1.7),
    (j) => 0.4 * Math.cos(j * 2.1),
    3, -2);

  // 6. Approaching folding: Δθ close to π between adjacent joints.
  runTest('near-folding (Δθ ≈ 0.9π between adjacent joints)',
    Ns_small, L_small, m_small,
    (j) => (j % 2) * 0.9 * Math.PI,
    () => 0,
    0, 0);

  // 7. Larger chain (Ns=20) random state — catches scaling-related bugs.
  runTest('large Ns=20 random',
    20, (550 * 0.45) / 20, 1 / 20,
    (j) => 0.15 * Math.sin(j * 1.3),
    (j) => 0.3 * Math.cos(j * 0.7),
    4, -3);
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

console.log('================================================================');
console.log('Alex2 Jacobian FD check: compares analytical A_raw/B_raw vs');
console.log('finite-difference computation of M·(∂θ̈/∂θ) and M·(∂θ̈/∂θ̇).');
console.log('Small max-relative-error means the analytical Jacobian matches');
console.log('the residual, so Newton convergence implies the correct fixed');
console.log('point.  A relative error > ~1e-4 in a specific block means we');
console.log('have a bug in that block.');
console.log('================================================================');

console.log('\n#### Pass 1: SIMPLIFIED_PHYSICS = true ####');
SIMPLIFIED_PHYSICS = true;
runAllStates();

console.log('\n#### Pass 2: SIMPLIFIED_PHYSICS = false (full physics) ####');
SIMPLIFIED_PHYSICS = false;
runAllStates();

console.log('\n================================================================');
console.log('Done.');
console.log('================================================================');
