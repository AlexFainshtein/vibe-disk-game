// Forced-response test: replicate the production scenario in Node.
//
// N=100 chain (matches production), apply a brief anchor impulse like a
// quick mouse drag would create, then watch the chain evolve.  Reports
// snapshots of energy, max|θ|, max|θ̇|, max|Δθ| (a proxy for fold-near
// configurations), and per-step Newton convergence.
//
// Goal: see whether the chaos shows up in this Node reproduction.
// If yes, the chaos is real motion of the EOMs (not a runtime quirk),
// and we know to look at the dynamics rather than the code.
// If no, the chaos is specific to something the runtime does that this
// test doesn't replicate.
//
// Run: node forced-response.js

'use strict';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

let BENDING_EI         = 100;
let DAMPING_BEND       = 1;
let DAMPING_MASS       = 0.1;
let SIMPLIFIED_PHYSICS = false;
// PROPOSED FIX (attempt 1, failed): when true, set V'' = 0 in the bending
// Jacobian when Δθ is in the clamp region.  Matches the actual derivative
// of clamped V'.  Tested — didn't stop the explosion, because the clamped
// force itself is unphysical (constant in the clamp region, breaks the
// periodic 2π structure of tan(Δθ/2)).
let FIX_BENDING_CLAMP_JACOBIAN = false;

// PROPOSED FIX (attempt 2): replace the Δθ-based clamp with a cos(Δθ/2)-based
// clamp.  tan(Δθ/2) = sin(Δθ/2) / cos(Δθ/2).  When cos(Δθ/2) ≈ 0 (i.e.
// Δθ near odd multiples of π = fold), clamp |cos(Δθ/2)| ≥ ε while
// preserving sign.  This:
//   • keeps the natural 2π periodicity of the bending force
//   • bounds the force/stiffness near each fold-singularity
//   • lets V' smoothly switch sign past each fold (restoring toward the
//     nearest even multiple of π = straight configuration)
// Affects both V' (buildRhs) and V'' (buildJacobianBlocks).
let USE_COS_BASED_CLAMP = false;
let COS_CLAMP_EPS = 0.01;

const NEWTON_MAX_ITERS = 12;
const NEWTON_TOL       = 1e-8;

// ----------------------------------------------------------------------
// Math (copy of alex2-physics.js — keeping standalone)
// ----------------------------------------------------------------------

function makeRope(Ns, segmentLength, particleMass){
  const muDiag = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++) muDiag[j] = (Ns - j) * particleMass;
  return {
    Ns, segmentLength, particleMass, muDiag,
    theta:        new Float64Array(Ns),
    thetaDot:     new Float64Array(Ns),
    M:            new Float64Array(Ns * Ns),
    M_snap:       new Float64Array(Ns * Ns),
    A_raw:        new Float64Array(Ns * Ns),
    B_raw:        new Float64Array(Ns * Ns),
    K:            new Float64Array(Ns * Ns),
    rhs:          new Float64Array(Ns),
    accel:        new Float64Array(Ns),
    thetaN:       new Float64Array(Ns),
    thetaDotN:    new Float64Array(Ns),
    thetaNew:     new Float64Array(Ns),
    thetaDotNew:  new Float64Array(Ns),
    thetaEval:    new Float64Array(Ns),
    thetaDotEval: new Float64Array(Ns),
    ddtEval:      new Float64Array(Ns),
    F_theta:      new Float64Array(Ns),
    F_thetaDot:   new Float64Array(Ns),
    dTheta:       new Float64Array(Ns),
    dThetaDot:    new Float64Array(Ns),
    Krhs:         new Float64Array(Ns),
    tmpNs:        new Float64Array(Ns),
    tmpNs2:       new Float64Array(Ns),
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
    if(DAMPING_BEND !== 0 && Ns >= 2){
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
      } else if(USE_COS_BASED_CLAMP){
        // V'(Δθ) = 2 k_θ sin(Δθ/2) / cos(Δθ/2).  Clamp |cos(Δθ/2)| ≥ ε
        // while preserving its sign, so the force stays bounded near
        // each fold-singularity (Δθ ≈ odd multiples of π) without
        // breaking the natural 2π periodicity.
        let vpLeft = 0;
        if(j > 0){
          const half = (theta[j] - theta[j - 1]) * 0.5;
          const sinH = Math.sin(half);
          const cosH = Math.cos(half);
          const cosClamped = cosH >= 0
            ? Math.max(cosH,  COS_CLAMP_EPS)
            : Math.min(cosH, -COS_CLAMP_EPS);
          vpLeft = 2 * kTheta * sinH / cosClamped;
        }
        let vpRight = 0;
        if(j < Ns - 1){
          const half = (theta[j + 1] - theta[j]) * 0.5;
          const sinH = Math.sin(half);
          const cosH = Math.cos(half);
          const cosClamped = cosH >= 0
            ? Math.max(cosH,  COS_CLAMP_EPS)
            : Math.min(cosH, -COS_CLAMP_EPS);
          vpRight = 2 * kTheta * sinH / cosClamped;
        }
        qBend = vpRight - vpLeft;
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
    for(let i = 0; i < Ns; i++) w[i] = DAMPING_MASS * thetaDot[i] + ddt[i];
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
        } else if(USE_COS_BASED_CLAMP){
          // Outside the cos-clamp: V'' = k_θ / cos²(Δθ/2).
          // Inside the clamp (|cos| < ε): V' = 2k_θ·sin(half)/(sign·ε),
          // so ∂V'/∂Δθ = k_θ·|cos(half)|/ε.  Continuous across the
          // boundary (both formulas give k_θ at |cos| = ε).
          const cosH = Math.cos((theta[i + 1] - theta[i]) * 0.5);
          const absC = Math.abs(cosH);
          if(absC >= COS_CLAMP_EPS){
            Vpp = kTheta / (cosH * cosH);
          } else {
            Vpp = kTheta * absC / COS_CLAMP_EPS;
          }
        } else {
          const drReal = theta[i + 1] - theta[i];
          let dr = drReal;
          let clamped = false;
          if(dr >  piMinusEps){ dr =  piMinusEps; clamped = true; }
          else if(dr < -piMinusEps){ dr = -piMinusEps; clamped = true; }
          if(FIX_BENDING_CLAMP_JACOBIAN && clamped){
            Vpp = 0;
          } else {
            const c = Math.cos(dr * 0.5);
            Vpp = kTheta / (c * c);
          }
        }
        A[i * Ns + i]       -= Vpp;
        A[i * Ns + (i + 1)] += Vpp;
      }
      if(i > 0){
        let Vpp;
        if(SIMPLIFIED_PHYSICS){
          Vpp = kTheta;
        } else if(USE_COS_BASED_CLAMP){
          const cosH = Math.cos((theta[i] - theta[i - 1]) * 0.5);
          const absC = Math.abs(cosH);
          if(absC >= COS_CLAMP_EPS){
            Vpp = kTheta / (cosH * cosH);
          } else {
            Vpp = kTheta * absC / COS_CLAMP_EPS;
          }
        } else {
          const dlReal = theta[i] - theta[i - 1];
          let dl = dlReal;
          let clamped = false;
          if(dl >  piMinusEps){ dl =  piMinusEps; clamped = true; }
          else if(dl < -piMinusEps){ dl = -piMinusEps; clamped = true; }
          if(FIX_BENDING_CLAMP_JACOBIAN && clamped){
            Vpp = 0;
          } else {
            const c = Math.cos(dl * 0.5);
            Vpp = kTheta / (c * c);
          }
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
      B[j * Ns + mm] -= DAMPING_MASS * M[j * Ns + mm];
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

function implicitStep(rope, h, ax, ay, gamma){
  const Ns          = rope.Ns;
  const theta       = rope.theta;
  const thetaDot    = rope.thetaDot;
  const thetaN      = rope.thetaN;
  const thetaDotN   = rope.thetaDotN;
  const thetaNew    = rope.thetaNew;
  const thetaDotNew = rope.thetaDotNew;
  const thetaEval   = rope.thetaEval;
  const thetaDotEval= rope.thetaDotEval;
  const ddtEval     = rope.ddtEval;
  const F_theta     = rope.F_theta;
  const F_thetaDot  = rope.F_thetaDot;
  const dTheta      = rope.dTheta;
  const dThetaDot   = rope.dThetaDot;
  const A           = rope.A_raw;
  const B           = rope.B_raw;
  const K           = rope.K;
  const Krhs        = rope.Krhs;
  const Msnap       = rope.M_snap;

  thetaN.set(theta);
  thetaDotN.set(thetaDot);

  buildMassMatrix(rope, thetaN);
  Msnap.set(rope.M);
  buildRhs(rope, thetaN, thetaDotN, ax, ay);
  if(DAMPING_MASS !== 0){
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotN[j];
      rope.rhs[i] -= DAMPING_MASS * s;
    }
  }
  gaussSolve(Ns, rope.M, rope.rhs, rope.accel);
  for(let i = 0; i < Ns; i++){
    thetaNew[i]    = thetaN[i]    + h * thetaDotN[i];
    thetaDotNew[i] = thetaDotN[i] + h * rope.accel[i];
  }

  const oneMinusGamma = 1 - gamma;
  const hg   = h * gamma;
  const hg2  = hg * hg;
  const invHg = 1 / hg;

  let converged = false;
  let iters = 0;
  let lastRel = 0;
  for(let iter = 0; iter < NEWTON_MAX_ITERS; iter++){
    iters = iter + 1;
    for(let i = 0; i < Ns; i++){
      thetaEval[i]    = oneMinusGamma * thetaN[i]    + gamma * thetaNew[i];
      thetaDotEval[i] = oneMinusGamma * thetaDotN[i] + gamma * thetaDotNew[i];
    }
    buildMassMatrix(rope, thetaEval);
    Msnap.set(rope.M);
    buildRhs(rope, thetaEval, thetaDotEval, ax, ay);
    if(DAMPING_MASS !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotEval[j];
        rope.rhs[i] -= DAMPING_MASS * s;
      }
    }
    gaussSolve(Ns, rope.M, rope.rhs, rope.accel);
    ddtEval.set(rope.accel);

    for(let i = 0; i < Ns; i++){
      F_theta[i]    = thetaNew[i]    - thetaN[i]    - h * thetaDotEval[i];
      F_thetaDot[i] = thetaDotNew[i] - thetaDotN[i] - h * ddtEval[i];
    }

    buildJacobianBlocks(rope, thetaEval, thetaDotEval, ddtEval, ax, ay);

    const Ns2 = Ns * Ns;
    for(let i = 0; i < Ns2; i++){
      K[i] = Msnap[i] - hg * B[i] - hg2 * A[i];
    }

    for(let i = 0; i < Ns; i++){
      let mTheta = 0, mThetaDot = 0, bTheta = 0;
      for(let j = 0; j < Ns; j++){
        mTheta    += Msnap[i * Ns + j] * (-F_theta[j]);
        mThetaDot += Msnap[i * Ns + j] * (-F_thetaDot[j]);
        bTheta    += B[i * Ns + j]     * (-F_theta[j]);
      }
      Krhs[i] = mTheta + hg * mThetaDot - hg * bTheta;
    }
    gaussSolve(Ns, K, Krhs, dTheta);

    let dNorm2 = 0, yNorm2 = 0;
    for(let i = 0; i < Ns; i++){
      dThetaDot[i]    = invHg * (dTheta[i] + F_theta[i]);
      thetaNew[i]    += dTheta[i];
      thetaDotNew[i] += dThetaDot[i];
      dNorm2 += dTheta[i] * dTheta[i] + dThetaDot[i] * dThetaDot[i];
      yNorm2 += thetaNew[i] * thetaNew[i] + thetaDotNew[i] * thetaDotNew[i];
    }
    const denom = Math.max(Math.sqrt(yNorm2), 1);
    lastRel = Math.sqrt(dNorm2) / denom;
    if(lastRel < NEWTON_TOL){ converged = true; break; }
  }
  theta.set(thetaNew);
  thetaDot.set(thetaDotNew);
  return { converged, iters, lastRel };
}

// ----------------------------------------------------------------------
// Diagnostics
// ----------------------------------------------------------------------

function computeEnergy(rope){
  const Ns = rope.Ns;
  buildMassMatrix(rope, rope.theta);
  let Ek = 0;
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += rope.M[i * Ns + j] * rope.thetaDot[j];
    Ek += rope.thetaDot[i] * s;
  }
  Ek *= 0.5;
  let V = 0;
  const L = rope.segmentLength;
  const kTheta = BENDING_EI / L;
  if(BENDING_EI !== 0 && Ns >= 2){
    for(let j = 0; j < Ns - 1; j++){
      const dx = rope.theta[j + 1] - rope.theta[j];
      if(SIMPLIFIED_PHYSICS){
        V += 0.5 * kTheta * dx * dx;
      } else {
        const cd = Math.cos(dx * 0.5);
        V += -4 * kTheta * Math.log(Math.max(cd, 1e-12));
      }
    }
  }
  return { Ek, V, total: Ek + V };
}

function chainStats(rope){
  const Ns = rope.Ns;
  let maxTheta = 0, maxThetaDot = 0, maxDtheta = 0;
  for(let j = 0; j < Ns; j++){
    if(Math.abs(rope.theta[j]) > maxTheta) maxTheta = Math.abs(rope.theta[j]);
    if(Math.abs(rope.thetaDot[j]) > maxThetaDot) maxThetaDot = Math.abs(rope.thetaDot[j]);
  }
  for(let j = 0; j < Ns - 1; j++){
    const d = Math.abs(rope.theta[j + 1] - rope.theta[j]);
    if(d > maxDtheta) maxDtheta = d;
  }
  return { maxTheta, maxThetaDot, maxDtheta };
}

// ----------------------------------------------------------------------
// Run scenarios
// ----------------------------------------------------------------------

// Generic runner: forcingFn(substep, h_sub) returns [ax, ay] for that substep.
function runScenarioFn(label, Ns, L, m, gamma, h_sub, forcingFn, totalFrames){
  const rope = makeRope(Ns, L, m);
  const E0 = computeEnergy(rope);
  console.log(`\n=== ${label} ===`);
  console.log(`  Ns=${Ns}, L=${L.toFixed(3)}, m=${m.toFixed(4)}, h_sub=${h_sub.toFixed(5)}, integrator=${gamma === 1 ? 'euler' : 'midpoint'}`);
  console.log(`  Total substeps: ${totalFrames}, total time: ${(totalFrames * h_sub).toFixed(3)}s`);
  console.log(`  Damping: BEND=${DAMPING_BEND}, MASS=${DAMPING_MASS}, BENDING_EI=${BENDING_EI}, SIMPLIFIED=${SIMPLIFIED_PHYSICS}`);
  console.log(`  E0: Ek=${E0.Ek.toExponential(3)}  V=${E0.V.toExponential(3)}  total=${E0.total.toExponential(3)}`);
  console.log(`\n  ${'substep'.padStart(8)} ${'time(s)'.padStart(8)} ${'maxθ'.padStart(10)} ${'maxθ̇'.padStart(12)} ${'maxΔθ'.padStart(10)} ${'Ek'.padStart(11)} ${'V'.padStart(11)} ${'E_total'.padStart(11)} ${'iters'.padStart(6)} ${'relStep'.padStart(10)}`);

  const snapshotEvery = Math.max(1, Math.floor(totalFrames / 30));
  let totalIters = 0;
  let nonConvergeCount = 0;
  let maxIterSeen = 0;
  let maxThetaEver = 0, maxThetaDotEver = 0, maxDthetaEver = 0;

  for(let s = 0; s < totalFrames; s++){
    const [ax, ay] = forcingFn(s, h_sub);
    const r = implicitStep(rope, h_sub, ax, ay, gamma);
    totalIters += r.iters;
    if(r.iters > maxIterSeen) maxIterSeen = r.iters;
    if(!r.converged) nonConvergeCount++;
    const stats = chainStats(rope);
    if(stats.maxTheta > maxThetaEver) maxThetaEver = stats.maxTheta;
    if(stats.maxThetaDot > maxThetaDotEver) maxThetaDotEver = stats.maxThetaDot;
    if(stats.maxDtheta > maxDthetaEver) maxDthetaEver = stats.maxDtheta;

    if(s % snapshotEvery === 0 || s === totalFrames - 1){
      const E = computeEnergy(rope);
      console.log(`  ${String(s).padStart(8)} ${(s*h_sub).toFixed(3).padStart(8)} ${stats.maxTheta.toExponential(3).padStart(10)} ${stats.maxThetaDot.toExponential(3).padStart(12)} ${stats.maxDtheta.toExponential(3).padStart(10)} ${E.Ek.toExponential(3).padStart(11)} ${E.V.toExponential(3).padStart(11)} ${E.total.toExponential(3).padStart(11)} ${String(r.iters).padStart(6)} ${r.lastRel.toExponential(2).padStart(10)}`);
    }
  }

  console.log(`\n  Summary: max iters=${maxIterSeen}, non-converged steps=${nonConvergeCount}/${totalFrames}, avg iters=${(totalIters/totalFrames).toFixed(2)}`);
  console.log(`           max|θ| ever: ${maxThetaEver.toExponential(3)}, max|θ̇| ever: ${maxThetaDotEver.toExponential(3)}, max|Δθ| ever: ${maxDthetaEver.toExponential(3)} (π=${Math.PI.toFixed(3)})`);
  const E_final = computeEnergy(rope);
  console.log(`           E_final: Ek=${E_final.Ek.toExponential(3)}  V=${E_final.V.toExponential(3)}  total=${E_final.total.toExponential(3)}`);
}

function runScenario(label, Ns, L, m, gamma, h_sub, ax_impulse, ay_impulse, impulseFrames, totalFrames){
  return runScenarioFn(
    label, Ns, L, m, gamma, h_sub,
    (s) => s < impulseFrames ? [ax_impulse, ay_impulse] : [0, 0],
    totalFrames
  );
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

const Ns_prod = 99;                       // production N=100 → Ns=99
const W       = 550;                      // approx canvas width
const L_prod  = W * 0.45 / Ns_prod;       // ≈ 2.5 px
const m_prod  = 1 / Ns_prod;
const h_sub   = 1 / 60 / 16;              // production h_sub

console.log('================================================================');
console.log('Alex2 forced-response test (Node reproduction of runtime scenario)');
console.log('================================================================');

// NOTE: forcing with ax (horizontal) on a horizontal chain (θ=0) gives
// zero generalized force — Q_anchor_j = L·μ·(sin(0)·ax − cos(0)·ay) = 0.
// Chain has to bend before ax matters.  Using ay (perpendicular) below
// to drive the joints from the very start.

// Scenario 1: brief mouse-drag-like impulse, production parameters.
// ay = 6000 px/s² (Δv=100 px/s spread over 16ms frame) for 16 substeps,
// then quiescent.  See whether chaos emerges and how it evolves.
SIMPLIFIED_PHYSICS = false;
DAMPING_BEND = 1;
DAMPING_MASS = 0.1;
BENDING_EI = 100;
runScenario('Full physics, defaults, brief perpendicular mouse impulse',
  Ns_prod, L_prod, m_prod, 1.0, h_sub, 0, 6000, 16, 600);

// Scenario 2: same but bigger impulse — simulates a more aggressive drag.
runScenario('Full physics, defaults, BIG perpendicular mouse impulse (ay=20000)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub, 0, 20000, 16, 600);

// Scenario 3: with strong damping (matches user's c=1000 test).
DAMPING_BEND = 1000;
runScenario('Full physics, BIG damping, mouse impulse',
  Ns_prod, L_prod, m_prod, 1.0, h_sub, 0, 6000, 16, 600);

// Scenario 4: simplified physics, defaults — see if chaos goes away.
SIMPLIFIED_PHYSICS = true;
DAMPING_BEND = 1;
DAMPING_MASS = 0.1;
BENDING_EI = 100;
runScenario('Simplified physics, defaults, mouse impulse',
  Ns_prod, L_prod, m_prod, 1.0, h_sub, 0, 6000, 16, 600);

// Scenario 5: implicit midpoint with full physics — conservation test in the
// presence of forcing.  Energy should not BLOW UP, only stay near the input
// energy minus dissipation.
SIMPLIFIED_PHYSICS = false;
DAMPING_BEND = 1;
DAMPING_MASS = 0.1;
BENDING_EI = 100;
runScenario('Full physics, MIDPOINT (γ=0.5), mouse impulse',
  Ns_prod, L_prod, m_prod, 0.5, h_sub, 0, 6000, 16, 600);

// Scenarios 6+: sustained / oscillating forcing — mimic the user dragging
// the mouse back and forth (changing directions a few times).  This is the
// scenario where the user reports chaos most reliably.

// Oscillating forcing: ay alternates direction every "halfPeriodFrames"
// substeps, with magnitude amp.
function makeOscillating(amp, halfPeriodFrames){
  return (s) => [0, (Math.floor(s / halfPeriodFrames) % 2 === 0) ? amp : -amp];
}

// 1 Hz oscillation at amp=6000 = aggressive but believable mouse shake.
DAMPING_BEND = 1;
runScenarioFn('Full physics, OSCILLATING ay (±6000, 1Hz, sustained)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 30 * 16)),  // half period = 8 frames = ~0.13s
  1500);

// Higher-frequency oscillation — closer to "shake the mouse rapidly"
runScenarioFn('Full physics, OSCILLATING ay (±6000, 5Hz, sustained)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 6 * 16)),
  1500);

// With c=1000 — does damping save us during sustained forcing?
DAMPING_BEND = 1000;
runScenarioFn('Full physics, BIG damping, OSCILLATING ay (±6000, 5Hz)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 6 * 16)),
  1500);

// Same 1Hz scenario as the one that exploded, but with linear bending
// (SIMPLIFIED_PHYSICS).  Hypothesis: the clamp-vs-Jacobian inconsistency
// in the nonlinear-bending implementation is what drove the explosion;
// linear bending has no clamp, so it shouldn't blow up.
SIMPLIFIED_PHYSICS = true;
DAMPING_BEND = 1;
runScenarioFn('Simplified (LINEAR bending), OSCILLATING ay (±6000, 1Hz, sustained)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 30 * 16)),
  1500);

// And the same again with BIG damping.
DAMPING_BEND = 1000;
runScenarioFn('Simplified (LINEAR bending), BIG damping, OSCILLATING ay (±6000, 1Hz)',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 30 * 16)),
  1500);

// === PROPOSED FIX TEST 1 (FAILED) ===
// Same 1Hz scenario that exploded with full nonlinear bending, but with
// FIX_BENDING_CLAMP_JACOBIAN = true.  Sets V''=0 in the bending
// Jacobian when Δθ enters the clamp region.  Tested — chain still
// explodes (Jacobian consistency doesn't help; the force law itself is
// unphysical in the clamp region).
SIMPLIFIED_PHYSICS = false;
DAMPING_BEND = 1;
DAMPING_MASS = 0.1;
BENDING_EI = 100;
FIX_BENDING_CLAMP_JACOBIAN = true;
runScenarioFn('FIX 1 (V\'\'=0 at clamp), OSCILLATING ay (±6000, 1Hz) — still explodes',
  Ns_prod, L_prod, m_prod, 1.0, h_sub,
  makeOscillating(6000, Math.round((1 / 60 * 16) * 30 * 16)),
  1500);
FIX_BENDING_CLAMP_JACOBIAN = false;

// === PROPOSED FIX TEST 2 (sweep ε) ===
// Replace the Δθ-based clamp with a cos(Δθ/2)-based clamp.  Periodic,
// continuous, sign-flipping past π.  Sweep ε to see if a softer clamp
// (smaller peak force) keeps the integrator from overshooting the
// singularity.  Smaller ε = stronger anti-fold, more likely to overshoot;
// larger ε = weaker anti-fold, less overshoot risk.
USE_COS_BASED_CLAMP = true;
for(const eps of [0.01, 0.1, 0.3, 0.5]){
  COS_CLAMP_EPS = eps;
  runScenarioFn(`FIX 2 (cos-clamp ε=${eps}), OSCILLATING ay (±6000, 1Hz)`,
    Ns_prod, L_prod, m_prod, 1.0, h_sub,
    makeOscillating(6000, Math.round((1 / 60 * 16) * 30 * 16)),
    1500);
}
USE_COS_BASED_CLAMP = false;


console.log('\n================================================================');
console.log('Done.');
console.log('================================================================');
