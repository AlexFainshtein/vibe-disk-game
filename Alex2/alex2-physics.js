import { canvas, inputHooks, renderExtras, renderOverlays } from '../state.js';
import { disk, bar, setDiskRadiusFraction } from '../playfield.js';

// Alex2: chain dynamics via REDUCED COORDINATES.
// Each rope is parameterized by N-1 joint angles θ_k (one per segment).
// Distance constraints are exact by construction — there's nothing to solve.
// The equations of motion come from Lagrangian mechanics:
//   M(θ) · θ̈ + C(θ, θ̇) = Q_anchor
// where:
//   M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}
//   C_j(θ,θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²
//   Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
//   μ_{jk}     = Σ_{i ≥ max(j,k)} m_i   (total mass of particles affected by both θ_j and θ_k)
//
// Time stepping: RK4 on the first-order system y' = f(y), y = [θ, θ̇].
// Each RK4 evaluation builds M, C, Q and does a dense Gaussian-elimination
// solve M · θ̈ = Q − C. That's O(N³) per evaluation, ×4 per frame, per rope.
// For N up to ~200 this is comfortably real-time.
//
// Anchor inputs reach the chain through two different mechanisms:
//   • Arrow keys: bounded Δv (=ANCHOR_KEY_VELOCITY_STEP per press) is
//     delivered as an instantaneous angular-momentum impulse
//       M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
//     applied inside the keydown handler.  Cheap and exact.
//   • Mouse drag: the per-frame velocity change is converted to a smooth
//     anchor acceleration ax = Δv/h, ay = Δv/h and passed to Q_anchor
//     during the RK4 evaluations.  Same total angular momentum delivered
//     over the frame, but spread across the substeps so the chain's θ̇
//     ramps up gradually (and the quadratic Coriolis term doesn't see the
//     full Δv-induced velocity at every substep).

bar.hidden = true;
inputHooks.diskGrab = false;
setDiskRadiusFraction(0);

const N = 50;   // number of particles in the chain (joints = N − 1)
// Chain total length = max(ROPE_LENGTH_FRACTION·width, ROPE_LENGTH_FRACTION_H·height).
// The height term keeps the chain a useful length on narrow/tall screens
// (e.g. a folded foldable) where width alone makes it too short.
const ROPE_LENGTH_FRACTION   = 0.45;   // of canvas width
const ROPE_LENGTH_FRACTION_H = 0.3;    // of canvas height

// Initial chain orientation (all joints equal → straight, no bending force).
// π/2 = straight down: on a narrow screen a horizontal chain runs off-frame,
// and "hanging down" is the natural rest pose (and matches gravity, later).
const INITIAL_THETA = Math.PI / 2;

// Total chain mass (excluding anchor). Distributed uniformly across the
// N−1 non-anchor particles. Combined with the Lagrangian formulation,
// dynamics should be approximately N-invariant.
const M_ROPE = 1;

// Internal RK4 substepping: per real frame, do RK4_SUBSTEPS_PER_FRAME
// RK4 steps each of size h/RK4_SUBSTEPS_PER_FRAME, holding ax/ay constant
// across them.  Total physics time per real frame is unchanged (= h), and
// mouse driving stays in lockstep with chain motion (no anchor-vs-chain
// mismatch).  Refining h reduces RK4's substep-amplification of nonlinear
// Coriolis terms — should let the chain tolerate larger |θ̇| before
// exploding.  Cost: each frame does RK4_SUBSTEPS_PER_FRAME times more
// linear solves.  At N=100, one RK4 step ≈ 4·O(N³) ≈ 4M ops; 4× substep
// is ~16M ops/frame, well within budget.
const RK4_SUBSTEPS_PER_FRAME = 16;

const ANCHOR_MARKER_RADIUS_FRAC = 1 / 60;
const ANCHOR_GRAB_RADIUS_FRAC   = 1 / 30;
const ANCHOR_COLOR = '#555555'; // was 88c0d0

// One arrow-key press changes anchor velocity by this much (px / s). The
// resulting angular-momentum impulse is applied directly to the chain.
const ANCHOR_KEY_VELOCITY_STEP = 50;

// --- Mouse→anchor spring + handle -------------------------------------
//
// Instead of pinning the anchor to the finger, the finger drives a big
// HANDLE; the anchor is a spring-mass-damper that chases the handle. The
// anchor acceleration fed to Q_anchor is then the spring force / mass —
// bounded by the *stretch* (a physical distance), NOT by Δv/h. That breaks
// the clamp-inflation blow-up (a slow frame can no longer manufacture a
// huge ax) and acts as a physical low-pass filter on hard jerks.
//
// Two grab targets (dual-touch):
//   • HANDLE (big, easy) → spring mode: filtered, the shipping control.
//   • ANCHOR (small, precise) → direct mode: rigid pin, for testing tight
//     control. Direct mode bypasses the spring, so it re-exposes the
//     blow-up — testing only, not exposed to the end user.
const USE_ANCHOR_SPRING       = true;
const SPRING_K                = 800; // was 400  // stiffness (px/s² per px of stretch, per unit anchor mass)
const SPRING_DAMP             = 25; // damping on anchor velocity (≈ near-critical at K=200, m=2)
const ANCHOR_MASS             = 2;      // anchor inertia; bigger = smoother/laggier, smaller ax
const SPRING_REST_FRAC        = 0.16;   // spring rest length as a fraction of min(canvas w,h) — the idle handle offset below the anchor
const HANDLE_GRAB_RADIUS_FRAC = 1 / 6; // finger hit target for the handle (big, for narrow screens)
const HANDLE_MARKER_RADIUS_FRAC = 1 / 15; // drawn handle radius
const HANDLE_COLOR            = 'rgba(136, 192, 208, 0.55)'; // semi-transparent so the string shows through
const SPRING_COIL_COLOR       = 'rgba(160, 170, 180, 0.7)';
const SPRING_COIL_TURNS       = 8;      // zigzag turns drawn between anchor and handle
const SPRING_COIL_AMPLITUDE_FRAC = 1 / 90; // coil width as a fraction of min(canvas w,h)

// Toroidal wrap: the part of the chain that leaves the frame reappears on the
// opposite edge. Purely visual (no collisions in this variant) — the renderer
// draws edge-crossing copies of the chain shifted by ±canvas. The anchor is
// clamped inside the canvas, so its particle positions stay near-frame and a
// single ±w/±h shift covers the overflow.
const USE_CHAIN_WRAP = true;

// Bending stiffness. Per-joint angular spring constant k_θ = BENDING_EI / L.
// BENDING_EI is the continuum flexural rigidity (N-invariant material
// property). Higher = stiffer, but too high will require smaller dt for
// RK4 stability. Set to 0 to disable bending entirely (chain is a free
// jointed pendulum with no restoring force).
const BENDING_EI = 500000;   // continuum flexural rigidity; k_θ = BENDING_EI / L. Sweet spot ~100K–1M (holds shape, kinks spring straight, still far from a rigid rod). EI=1 was ~3 orders too weak — kinks froze.

// --- Damping (non-conservative; added directly to the EOM, not Lagrangian) ---
//
// DAMPING_BEND: strain-rate / stiffness-proportional damping. Force per
// joint = c · (θ̇_{j-1} − 2θ̇_j + θ̇_{j+1}) — the discrete Laplacian of θ̇.
// Pulls each joint's angular velocity toward its neighbors'. Has *zero
// effect* on rigid rotation (all θ̇ equal → Laplacian = 0), so the chain
// can still spin freely; but suppresses high-frequency / alternating-sign
// modes exponentially. Analog of stiffness-proportional Rayleigh damping.
//
// Added inline to the conservative RHS (see buildRhs), so it goes through
// RK4 with everything else. This is explicit integration, so c is bounded
// by RK4's stability region: roughly c · max_eigenvalue(M⁻¹·D) · h < 2.78.
// At N=100 with h≈1/60 that puts the upper limit somewhere around c ≈ 1;
// keep this in mind when raising the value.
const DAMPING_BEND = 1000;

// VISCOUS_DRAG: viscous drag. Subtracts α · θ̇ from θ̈ each
// frame, so the time constant of every mode decays at rate α regardless of
// frequency. Use to slowly bleed off rotation / bulk motion. 0 means the
// chain coasts indefinitely (only DAMPING_BEND dissipates).
const VISCOUS_DRAG = 0.5; // was 0.1, 0

// --- Gravity -----------------------------------------------------------
//
// Downward (+y) acceleration in px/s². Acts on the chain (as a generalized
// force Q_grav_j = g·L·μ_jj·cos θ_j, so straight-down θ=π/2 is the
// equilibrium) and on the anchor body (adds g to its ay). It does NOT act on
// the spring or the handle — those are kinematic control elements.
// Equivalence-principle check: if the anchor free-falls (ay=g), Q_anchor's
// −cos θ_j·ay exactly cancels Q_grav, so a free-falling chain doesn't deform.
// Set to 0 to disable. Tunable for feel.
const GRAVITY = 1000;   // downward acceleration (px/s²) on the chain + anchor; 0 disables
// --- Implicit integrators (experimental, B3 in our discussion) --------
//
// INTEGRATOR: 'rk4' (explicit, the old default), 'implicit-midpoint'
// (A-stable; conserves high-frequency modes — vulnerable to feedback
// chaos in stiff regimes), or 'implicit-euler' (L-stable; damps
// high-frequency modes, more robust to stiffness at the price of
// slight artificial damping).  Both implicit variants share the same
// per-substep Newton iteration; only the residual definition and the
// Jacobian's h-coefficient differ.
const INTEGRATOR                     = 'implicit-midpoint';
const IMPLICIT_SUBSTEPS_PER_FRAME    = 16; // At N=50 (current default), 16 runs unclamped real-time and holds for normal play; only deliberate hard jerks that push the frame into the dt-clamp still blow up (see CLAUDE-ALEX2.md). At N=100 this needed 32.
const NEWTON_MAX_ITERS               = 8;
// Warm-start: seed each substep's Newton iteration from the previous
// substep's realized increment (linear extrapolation y⁰ = yₙ + Δy_prev)
// instead of one explicit-Euler step (y⁰ = yₙ + h·f(yₙ)).  The realized
// increment is bounded physical motion, so it avoids the h·θ̈ overshoot
// that walks the explicit-Euler guess out of Newton's convergence basin
// once θ̈ gets large.  Falls back to explicit Euler when no prior
// increment is available (first substep after Reset / impulse / a
// non-converged step).  Toggle false to compare against the cold-start.
const NEWTON_WARM_START              = true;
// Newton convergence: stop when ‖Δy‖ / max(‖y‖, 1) < NEWTON_TOL.
const NEWTON_TOL                     = 1e-6;

// USE_HALVING: the principled recovery before coasting. When a substep's
// Newton fails, retry it as two half-steps (recursively, up to
// HALVING_MAX_DEPTH levels) — a smaller h shrinks the Newton-basin overshoot
// that causes the failure, so the slice usually becomes solvable. Coasting
// is the last resort, used only if even the
// deepest halving still can't converge. Local: only the failing slice pays
// the extra cost, so normal play is untouched.
const USE_HALVING       = true;
const HALVING_MAX_DEPTH = 2;   // 2 → retry down to h_sub/4 before coasting

// Diagnostic: when true, log a one-line summary per frame showing how each
// substep's Newton iteration went — GATED to problem frames only (a substep
// fails to converge, or strains near the iter cap), silent when healthy.
// Off now — decluttering the console for the winding check (the [E] log
// carries halveΣ/rejΣ, so we still see failure activity).
const NEWTON_LOG_ENABLED             = false;

// --- Energy monitoring (diagnostic) ------------------------------------
//
// Compute E = (1/2) θ̇ᵀ M(θ) θ̇ per rope per frame. For the conservative
// system this is exactly conserved (Noether); with damping it must
// monotonically decrease. Anything else — sudden spikes, NaN, runaway
// growth — is a numerical-stability problem we want to catch in the act.
const ENERGY_MONITOR  = false;     // off — no console spam during this test
const E_SPIKE_RATIO   = 100;       // log when E_new / E_prev exceeds this

// ENERGY_DECAY_LOG: every ENERGY_DECAY_LOG_EVERY frames, print elapsed time +
// chain kinetic energy + max|θ̇| + anchor speed + reject total. For the
// non-decay investigation: perturb a hands-off chain (Reset, then
// window.alex2.kickChain()) and watch whether KE falls ~e-fold per 2 s (as
// VISCOUS_DRAG=0.5 predicts) or plateaus (energy not leaving). Console only.
const ENERGY_DECAY_LOG       = false;  // off — the stream was burying the on-demand dumpTheta() output
const ENERGY_DECAY_LOG_EVERY = 30;

// Spectral condition-number estimator for M (power iteration for λ_max,
// inverse power iteration for λ_min, ratio gives κ₂(M)).  Each frame runs
// CONDITION_ITERS mat-vecs + CONDITION_ITERS linear solves — roughly 2.5×
// the cost of one RK4 step.  Disable when not debugging.
const CONDITION_ESTIMATE    = false; // off — expensive, not needed for this test
const CONDITION_ITERS       = 10;

// --- Performance HUD (diagnostic) -------------------------------------
//
// SHOW_PERF_HUD: draw an on-canvas overlay (top-left) with the three
// numbers needed to compare devices and read the real frame budget:
//   • achieved FPS + real frame interval (ms), measured from the wall-clock
//     gap between successive update() calls — independent of the dt clamp.
//   • physics ms/frame — wall-clock time spent in the integrator substep
//     loop only (excludes the diagnostic monitors). This IS the budget
//     number: at 60 Hz you have 16.7 ms total; physics/frame says how much
//     of it the chain eats.
//   • raw dt fed to the loop + a CLAMPED flag when main.js's 33 ms ceiling
//     fired (real interval > 33 ms → physics ran in slow motion). Desktop
//     pinned at CLAMPED while the phone isn't = the cross-device hypothesis
//     confirmed.
// On-canvas (not console) so it reads identically on desktop and phone with
// the two devices held side by side.
const SHOW_PERF_HUD = true;

// --- Rope factory ------------------------------------------------------

// `opts` lets the caller override segmentLength and particleMass — used by
// the small debug rope so its per-link physics matches N=100's exactly
// (same L, same m), while keeping a tractable number of joints.
function makeRope(N, baseX, baseY, opts = {}){
  const Ns = N - 1;                                      // number of segments / angles
  const chainLength   = Math.max(canvas.width * ROPE_LENGTH_FRACTION, canvas.height * ROPE_LENGTH_FRACTION_H);
  const segmentLength = opts.segmentLength ?? chainLength / Ns;
  const particleMass  = opts.particleMass  ?? M_ROPE / Ns;
  // μ_{jk} = Σ_{i ≥ max(j,k)} m_i  with uniform mass.
  // For uniform mass this is (Ns − max(j,k)) · particleMass when we index
  // angles from 0. (Angle k controls particles k..Ns−1 in 0-indexed terms.)
  // We precompute the diagonal μ_{jj} since it appears in many spots.
  const muDiag = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++){
    muDiag[j] = (Ns - j) * particleMass;
  }
  return {
    N, Ns, segmentLength, particleMass, muDiag,
    baseX, baseY,
    theta:    new Float64Array(Ns),                       // all angles = 0 → chain horizontal
    thetaDot: new Float64Array(Ns),
    // Particle positions (computed each frame for rendering).
    px: new Float64Array(N),
    py: new Float64Array(N),
    // Reusable scratch buffers for the equation solve.
    M:        new Float64Array(Ns * Ns),
    rhs:      new Float64Array(Ns),
    accel:    new Float64Array(Ns),                       // θ̈ output of the solve
    // RK4 scratch (state has 2·Ns components: θ then θ̇).
    y:        new Float64Array(2 * Ns),
    k1:       new Float64Array(2 * Ns),
    k2:       new Float64Array(2 * Ns),
    k3:       new Float64Array(2 * Ns),
    k4:       new Float64Array(2 * Ns),
    yTmp:     new Float64Array(2 * Ns),
    thetaTmp: new Float64Array(Ns),
    thetaDotTmp: new Float64Array(Ns),
    // Energy monitor state (E = (1/2) θ̇ᵀ M θ̇).
    E:        0,
    prevE:    0,
    // Coordinate-magnification monitors:
    //   maxThetaDot  = max_j |θ̇_j|              (the angular velocity our integrator actually sees)
    //   maxLThetaDot = L · max_j |θ̇_j|          (the corresponding linear velocity in the anchor frame)
    // Hypothesis test: maxThetaDot scales as 1/L across ropes; maxLThetaDot should be ~N-invariant.
    // prev* fields capture the values from the frame immediately before — useful in the
    // spike/NaN warnings to see what the state was just before the integrator failed.
    maxThetaDot:      0,
    maxLThetaDot:     0,
    prevMaxThetaDot:  0,
    prevMaxLThetaDot: 0,
    // M conditioning monitor: smallest/largest |pivot| seen during the 4
    // RK4 substeps of the most recent frame.  ratio ≈ 1/cond_number.
    pivotMin:         Infinity,
    pivotMax:         0,
    pivotRatio:       0,
    // True condition-number estimator (power iteration + inverse power
    // iteration on M).  cond = λ_max / λ_min for SPD M — the spectral
    // condition number, the actual quantity the user wants.
    condM:            new Float64Array(Ns * Ns),  // pristine copy of M, persists across iters
    condX:            new Float64Array(Ns),       // current iteration vector
    condY:            new Float64Array(Ns),       // mat-vec / linear-solve output
    condLambdaMax:    0,
    condLambdaMin:    0,
    condNum:          0,
    // Once E goes non-finite, the warning would fire every frame forever
    // (60×/sec, each a long line) and DevTools eventually freezes. Latch the
    // warning so it fires once per NaN episode; cleared by Reset or by E
    // becoming finite again.
    nanWarned:        false,
    // --- Implicit-midpoint scratch ---
    // A_raw, B_raw: M·(∂θ̈/∂θ) and M·(∂θ̈/∂θ̇) respectively, assembled at
    // the midpoint state.  K = M − (h/2)·B_raw − (h²/4)·A_raw — the reduced
    // Ns×Ns matrix whose LU we solve for Δθ each Newton iteration.
    A_raw:            new Float64Array(Ns * Ns),
    B_raw:            new Float64Array(Ns * Ns),
    K:                new Float64Array(Ns * Ns),
    M_snap:           new Float64Array(Ns * Ns),  // pristine M survives the Newton-iter linear solves
    // State buffers across one implicit step.
    thetaN:           new Float64Array(Ns),       // θ at start of step (y_n)
    thetaDotN:        new Float64Array(Ns),       // θ̇ at start of step
    thetaNew:         new Float64Array(Ns),       // current iterate of y_{n+1}
    thetaDotNew:      new Float64Array(Ns),
    thetaMid:         new Float64Array(Ns),       // (y_n + y_{n+1})/2
    thetaDotMid:      new Float64Array(Ns),
    ddtMid:           new Float64Array(Ns),       // θ̈ at midpoint (M·ddt = b_full)
    F_theta:          new Float64Array(Ns),       // residual top half
    F_thetaDot:       new Float64Array(Ns),       // residual bottom half
    dTheta:           new Float64Array(Ns),       // Newton update for θ
    dThetaDot:        new Float64Array(Ns),       // Newton update for θ̇
    Krhs:             new Float64Array(Ns),       // RHS of the K·Δθ = … solve
    tmpNs:            new Float64Array(Ns),       // general scratch
    tmpNs2:           new Float64Array(Ns),       // general scratch
    // Warm-start: realized increment (Δθ, Δθ̇) of the previous converged
    // substep, used as the next substep's Newton initial guess.  Valid only
    // after a converged step; invalidated on Reset / impulse.
    prevDTheta:       new Float64Array(Ns),
    prevDThetaDot:    new Float64Array(Ns),
    warmStartValid:   false,
    // Newton-iteration diagnostics, written by implicitMidpointStep and
    // read by update() when NEWTON_LOG_ENABLED.
    lastNewtonIters:    0,
    lastNewtonRelStep:  0,
    lastNewtonConverged: true,
  };
}

const ropes = [makeRope(N, canvas.width / 2, canvas.height * 0.5)];
for(const rope of ropes) rope.theta.fill(INITIAL_THETA);   // hang straight down at start

// Debug perturbation: add a smooth half-sine bump to the chain's θ̇ WITHOUT
// touching the anchor — a clean way to excite the chain and watch it decay in
// isolation (tests VISCOUS_DRAG without any anchor forcing). Call from the
// console: window.alex2.kickChain() (optional amplitude). The energy log then
// shows whether KE falls off or plateaus.
function kickChain(amp = 3){
  const rope = ropes[0];
  const Ns = rope.Ns;
  for(let i = 0; i < Ns; i++){
    rope.thetaDot[i] += amp * Math.sin((i + 1) * Math.PI / Ns);
  }
  rope.warmStartValid = false;   // the state jumped; don't warm-start from the old increment
  _eLogFrame = 0;                // restart the energy-log clock so t=0 is the kick
  _eLogTime  = 0;
  console.log(`[kick] chain θ̇ perturbed (amp=${amp}); watch the [E] log`);
}

// Debug perturbation: give the ANCHOR a velocity kick (px/s) and leave the
// chain at rest — isolates the anchor's spring-mass-damper. Watch |aV| in the
// [E] log: clean decay to ~0 ⇒ anchor damping is fine; a plateau / persistent
// jitter ⇒ the once-per-frame anchor integration is the energy pump we're
// hunting. Call: window.alex2.kickAnchor() (optional vx, vy).
function kickAnchor(vx = 400, vy = 0){
  anchorVx += vx;
  anchorVy += vy;
  _eLogFrame = 0;
  _eLogTime  = 0;
  console.log(`[kick] anchor velocity kicked (vx=${vx}, vy=${vy}); watch |aV| in the [E] log`);
}

// On-demand winding readout: print the current per-link bend Δθ_i = θ_{i+1}−θ_i
// (with its turn count Δθ/2π) and the raw θ values. Call window.alex2.dumpTheta()
// whenever you've set up a visual state — no flooding, one print per call. Key
// comparison: a Δθ of ~2π is two links pointing the SAME way → drawn straight,
// no visible bend, yet linear bending charges energy for it.
function dumpTheta(){
  const rope = ropes[0];
  const Ns = rope.Ns;
  const TAU = 2 * Math.PI;
  const th = Array.from(rope.theta, t => t.toFixed(3)).join(', ');
  const dth = [];
  for(let i = 0; i < Ns - 1; i++){
    const d = rope.theta[i + 1] - rope.theta[i];
    dth.push(`${d.toFixed(3)}(${(d / TAU).toFixed(2)}t)`);
  }
  console.log(`[θ]  ${th}`);
  console.log(`[Δθ] ${dth.join('  ')}`);
}

// Expose ropes on window for console-side inspection during debugging:
// `alex2.ropes[0].theta`, etc.
if(typeof window !== 'undefined') window.alex2 = { ropes, kickChain, kickAnchor, dumpTheta };

// Tracks whether the user has driven the anchor yet (via arrow keys or a
// drag). Gates NEWTON_LOG so the console isn't flooded with all-zero frames
// before the first interaction.
let anchorHasInteracted  = false;

// --- Performance HUD state (smoothed via EMA) -------------------------
let _perfLastFrameT = 0;      // performance.now() at the previous update() entry
let _perfFrameMs    = 0;      // smoothed real frame interval (ms) → FPS = 1000/this
let _perfPhysicsMs  = 0;      // smoothed integrator-only compute (ms)
let _perfRawDtMs    = 0;      // dt actually handed to update() this frame (ms)
let _perfClamped    = false;  // did dt hit main.js's 33 ms ceiling this frame
let _perfSubsteps   = 0;      // substeps taken this frame (for the HUD readout)
const _PERF_EMA     = 0.1;    // smoothing factor for the two timing readouts
// Reject-on-non-convergence counters (substeps coasted because Newton failed).
let _rejectThisFrame = 0;
let _rejectTotal     = 0;
// Step-halving counters (a failed slice retried as half-steps before coasting).
let _halveThisFrame = 0;
let _halveTotal     = 0;

// Exponential format with a fixed-width exponent (sign + 2 digits): 1.23e-09,
// 1.04e+00, so console columns line up. (toExponential gives 1.23e-9 / e+0.)
function expFix(x, mantissa = 2){
  if(!Number.isFinite(x)) return String(x);
  return x.toExponential(mantissa).replace(/e([+-])(\d+)/, (_, s, d) => `e${s}${d.padStart(2, '0')}`);
}
// Energy-decay logger bookkeeping (frame counter + elapsed physics time).
// _logMax* are PEAK-over-interval accumulators (sampled every frame, reset
// after each print) — a point sample every 30 frames aliases the fast anchor
// oscillation (~0.31 s period) and misses its amplitude.
let _eLogFrame = 0;
let _eLogTime  = 0;
let _logMaxKE          = 0;
let _logMaxAnchorSpeed = 0;

// --- Anchor state (shared across both ropes) ---------------------------

// Anchor position is offset from each rope's base by (anchorDeltaX, anchorDeltaY).
// Anchor velocity (anchorVx, anchorVy) is its own piece of state: it's
// modified by arrow keys (additive) and by drag (measured from position).
let anchorDeltaX = 0;
let anchorDeltaY = 0;
let anchorVx = 0;
let anchorVy = 0;
let prevAnchorDeltaX = 0;
let prevAnchorDeltaY = 0;

// Handle: the finger-driven grab target. Its position is its own delta from
// the rope base; idle it rides at the spring rest length below the anchor.
let handleDeltaX = 0;
let handleDeltaY = 0;

// Touch / drag input. Only one of anchorHeld / handleHeld is true at a time.
let anchorHeld   = false;   // direct mode: finger pins the anchor (testing)
let handleHeld   = false;   // spring mode: finger drives the handle (shipping)
let grabOffsetX  = 0;
let grabOffsetY  = 0;
let grabBaseX    = 0;
let grabBaseY    = 0;

// Spring rest length in px (recomputed from canvas each use — survives resize).
function springRestLength(){
  return Math.min(canvas.width, canvas.height) * SPRING_REST_FRAC;
}

inputHooks.emptyDown = (x, y) => {
  const anchorR = Math.min(canvas.width, canvas.height) * ANCHOR_GRAB_RADIUS_FRAC;
  const handleR = Math.min(canvas.width, canvas.height) * HANDLE_GRAB_RADIUS_FRAC;
  for(const rope of ropes){
    const ax = rope.baseX + anchorDeltaX;
    const ay = rope.baseY + anchorDeltaY;
    // Check the precise anchor target first (direct test mode), then the big
    // handle target (spring mode). With the spring disabled, only the anchor
    // is grabbable and behaves as before.
    if(Math.hypot(x - ax, y - ay) <= anchorR){
      grabOffsetX = ax - x;
      grabOffsetY = ay - y;
      grabBaseX   = rope.baseX;
      grabBaseY   = rope.baseY;
      anchorHeld  = true;
      return true;
    }
    if(USE_ANCHOR_SPRING){
      // Wrap-aware: the handle has no L/R clamp, so its true center may be
      // off-screen while a wrapped image is on-screen. Find the horizontal
      // image (true center shifted by k·width) nearest the finger; if the tap
      // lands on it, rebase the true center onto that image so the handle
      // comes back on-screen and stays grabbable.
      const w  = canvas.width;
      const hx = rope.baseX + handleDeltaX;
      const hy = rope.baseY + handleDeltaY;
      const k  = Math.round((x - hx) / w);
      const imageX = hx + k * w;
      if(Math.hypot(x - imageX, y - hy) <= handleR){
        // Rebase the WHOLE movable system by the same k·width — handle AND
        // anchor (the chain follows the anchor). Shifting both keeps the
        // spring stretch and all geometry identical, so grabbing the wrapped
        // image causes no jerk; the chain's true position just lands where
        // its wrap image already was.
        handleDeltaX     += k * w;
        anchorDeltaX     += k * w;
        prevAnchorDeltaX += k * w;
        grabOffsetX = imageX - x;
        grabOffsetY = hy - y;
        grabBaseX   = rope.baseX;
        grabBaseY   = rope.baseY;
        handleHeld  = true;
        return true;
      }
    }
  }
  return false;
};
inputHooks.emptyMove = (x, y) => {
  if(anchorHeld){
    anchorDeltaX = (x + grabOffsetX) - grabBaseX;
    anchorDeltaY = (y + grabOffsetY) - grabBaseY;
  } else if(handleHeld){
    handleDeltaX = (x + grabOffsetX) - grabBaseX;
    handleDeltaY = (y + grabOffsetY) - grabBaseY;
  }
};
inputHooks.emptyUp = () => {
  if(!anchorHeld && !handleHeld) return;
  anchorHeld = false;
  handleHeld = false;
  // Release: stop the anchor cleanly. The chain keeps whatever momentum the
  // drag imparted (its θ̇) and swings free; the anchor itself does not drift.
  anchorVx = 0;
  anchorVy = 0;
};

window.addEventListener('keydown', (e) => {
  let dvx = 0, dvy = 0;
  const K = ANCHOR_KEY_VELOCITY_STEP;
  switch(e.key){
    case 'ArrowLeft':  dvx = -K; break;
    case 'ArrowRight': dvx =  K; break;
    case 'ArrowUp':    dvy = -K; break;
    case 'ArrowDown':  dvy =  K; break;
  }
  if(dvx || dvy){
    anchorVx += dvx;
    anchorVy += dvy;
    applyAnchorVelocityImpulse(dvx, dvy);
    e.preventDefault();
  }
});

// --- Equations of motion -----------------------------------------------

// Build M(θ) into rope.M (row-major, size Ns × Ns).
// M_{jk} = L² · cos(θ_j − θ_k) · μ_{jk}, where μ_{jk} = (Ns − max(j,k)) · m
function buildMassMatrix(rope, theta){
  const Ns = rope.Ns;
  const L  = rope.segmentLength;
  const m  = rope.particleMass;
  const M  = rope.M;
  const L2 = L * L;
  for(let j = 0; j < Ns; j++){
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      M[j * Ns + k] = L2 * Math.cos(theta[j] - theta[k]) * mu;
    }
  }
}

// Build RHS of the equation: rhs = Q_anchor − C(θ, θ̇) + Q_bend(θ) + Q_damp(θ̇)
// Q_anchor_j = L · μ_{jj} · (sin θ_j · ax − cos θ_j · ay)
// C_j        = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²
// Q_bend     = discrete Laplacian of θ scaled by k_θ = BENDING_EI / L,
//              with free boundary conditions at both ends.
// Q_damp     = DAMPING_BEND · discrete Laplacian of θ̇, same boundary
//              conditions. Strain-rate damping integrated by RK4 like
//              every other force.
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
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      cj += L2 * mu * Math.sin(theta[j] - theta[k]) * thetaDot[k] * thetaDot[k];
    }
    // Strain-rate damping (linear, discrete Laplacian on θ̇, free ends).
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
    // Linear bending — discrete Laplacian of θ scaled by k_θ, Neumann
    // (free-end) BCs.  The previous tan(Δθ/2) anti-folding model was
    // physically wrong (periodic in Δθ, can flip the bending sign and
    // create a runaway under sustained forcing).  Linear bending grows
    // monotonically with |Δθ| → always restoring → robust under any
    // forcing, at the cost of allowing the rope to wind into loops.
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      let lapTheta;
      if(j === 0){
        lapTheta = theta[1] - theta[0];
      } else if(j === Ns - 1){
        lapTheta = theta[Ns - 2] - theta[Ns - 1];
      } else {
        lapTheta = theta[j - 1] - 2 * theta[j] + theta[j + 1];
      }
      qBend = kTheta * lapTheta;
    }
    // Gravity: generalized force from a uniform downward (+y) field.
    // Q_grav_j = g·L·μ_jj·cos θ_j (zero at θ=π/2 → straight-down equilibrium).
    const qGrav = GRAVITY !== 0 ? GRAVITY * L * muDiag[j] * Math.cos(theta[j]) : 0;
    rhs[j] = qAnchor - cj + qBend + qDamp + qGrav;
  }
}

// Module-level pivot tracking, written by gaussSolve and read after a frame
// completes.  Reset before each rk4Step call so the recorded min/max cover
// all 4 substeps within one frame.  ratio = min/max ≈ 1/cond_number.
let _solveMinPivot = Infinity;
let _solveMaxPivot = 0;
// Cumulative count of singular-pivot bails in gaussSolve (a near-zero pivot →
// the solve returns zeros). A silent numerical-safety event; surfaced in the
// Newton log so we notice if it ever fires.
let _singularBails = 0;

// Per-frame mouse-input snapshot, captured by update() at the start of
// each frame so the substep log can show "what did the mouse do this
// frame" alongside the chain's internal RHS/θ̈ response.
let _frameShiftY = 0;   // Δy = anchorDeltaY this frame − last frame  (pixels)
let _frameAy     = 0;   // smooth-delivery anchor acceleration (px/s²)

// Generic Gaussian elimination with partial pivoting on a dense N×N
// row-major matrix A and RHS vector b, writing the solution to x.
// In-place: A and b are destroyed during the elimination.
function gaussSolve(N, A, b, x){
  // Forward elimination with partial pivoting.
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
    const apivot = Math.abs(pivot);
    if(apivot < _solveMinPivot) _solveMinPivot = apivot;
    if(apivot > _solveMaxPivot) _solveMaxPivot = apivot;
    if(apivot < 1e-12){
      // Singular; bail with zeros to avoid NaN cascades.
      _singularBails++;
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
  // Back substitution.
  for(let i = N - 1; i >= 0; i--){
    let sum = b[i];
    for(let c = i + 1; c < N; c++){
      sum -= A[i * N + c] * x[c];
    }
    x[i] = sum / A[i * N + i];
  }
}

// Solve M · accel = rhs for the conservative dynamics step. In-place:
// rope.M and rope.rhs are destroyed; rope.accel is filled.
function solveLinear(rope){
  gaussSolve(rope.Ns, rope.M, rope.rhs, rope.accel);
}

// Estimate κ₂(M) = λ_max / λ_min by power iteration + inverse power
// iteration on M(θ).  Both start from a random unit vector and converge
// in ~CONDITION_ITERS iterations to the dominant / sub-dominant eigenvalue
// directions; the Rayleigh quotient gives the eigenvalue estimate.
//
// Costs per call: CONDITION_ITERS mat-vec multiplies + CONDITION_ITERS
// linear solves on M.  Each linear solve destroys M, so we keep a pristine
// copy in rope.condM and restore it before each gaussSolve.
function estimateConditionNumber(rope){
  const Ns = rope.Ns;
  // Build a fresh M(θ_current) into rope.M, then snapshot it.  Note that
  // rope.M is in a destroyed state from the last RK4 substep, so this
  // build is necessary.
  buildMassMatrix(rope, rope.theta);
  rope.condM.set(rope.M);

  const Mpristine = rope.condM;
  const x = rope.condX;
  const y = rope.condY;

  // --- Power iteration for λ_max ---
  // Start with a random unit vector.
  let n2 = 0;
  for(let i = 0; i < Ns; i++){ x[i] = Math.random() - 0.5; n2 += x[i] * x[i]; }
  let nrm = Math.sqrt(n2);
  if(nrm > 0) for(let i = 0; i < Ns; i++) x[i] /= nrm;

  let lambdaMax = 0;
  for(let iter = 0; iter < CONDITION_ITERS; iter++){
    // y = M·x
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++) s += Mpristine[i * Ns + j] * x[j];
      y[i] = s;
    }
    // Rayleigh quotient (x is unit): λ ≈ x · M · x = x · y
    lambdaMax = 0;
    for(let i = 0; i < Ns; i++) lambdaMax += x[i] * y[i];
    // Normalize: x ← y / ||y||
    n2 = 0;
    for(let i = 0; i < Ns; i++) n2 += y[i] * y[i];
    nrm = Math.sqrt(n2);
    if(!Number.isFinite(nrm) || nrm < 1e-30) break;
    for(let i = 0; i < Ns; i++) x[i] = y[i] / nrm;
  }

  // --- Inverse power iteration for λ_min ---
  // Re-initialize x with a fresh random unit vector.
  n2 = 0;
  for(let i = 0; i < Ns; i++){ x[i] = Math.random() - 0.5; n2 += x[i] * x[i]; }
  nrm = Math.sqrt(n2);
  if(nrm > 0) for(let i = 0; i < Ns; i++) x[i] /= nrm;

  let lambdaMin = 0;
  for(let iter = 0; iter < CONDITION_ITERS; iter++){
    // Solve M·y = x.  gaussSolve destroys both rope.M and rope.rhs, so
    // restore M from the pristine copy and use rope.rhs as the buffer for x.
    rope.M.set(Mpristine);
    for(let i = 0; i < Ns; i++) rope.rhs[i] = x[i];
    gaussSolve(Ns, rope.M, rope.rhs, y);
    // Rayleigh quotient on M:  M·y = x, so y·M·y = y·x.  For PD M this is
    // strictly positive — a negative value would itself be diagnostic
    // (signals M's smallest eigenvalue has dropped below roundoff
    // precision of the linear solve).  We keep the signed form for that
    // reason.
    let dotYX = 0, dotYY = 0;
    for(let i = 0; i < Ns; i++){
      dotYX += y[i] * x[i];
      dotYY += y[i] * y[i];
    }
    if(!Number.isFinite(dotYY) || dotYY < 1e-30){ lambdaMin = 0; break; }
    lambdaMin = dotYX / dotYY;
    // Normalize: x ← y / ||y||
    nrm = Math.sqrt(dotYY);
    if(!Number.isFinite(nrm) || nrm < 1e-30) break;
    for(let i = 0; i < Ns; i++) x[i] = y[i] / nrm;
  }

  rope.condLambdaMax = lambdaMax;
  rope.condLambdaMin = lambdaMin;
  rope.condNum = (lambdaMin > 0 && Number.isFinite(lambdaMax)) ? lambdaMax / lambdaMin : Infinity;
}

// Direct angular-momentum impulse from a step change in anchor velocity.
// Integrating M·θ̈ = Q_anchor over an instantaneous Δv gives
//   M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
// Solving that linear system once per rope is exactly the right "kick" to
// the chain. No finite-difference acceleration spike is needed.
function applyAnchorVelocityImpulse(dvx, dvy){
  if(dvx !== 0 || dvy !== 0) anchorHasInteracted = true;
  for(const rope of ropes){
    const Ns = rope.Ns;
    const L  = rope.segmentLength;
    const muDiag = rope.muDiag;
    const rhs = rope.rhs;
    buildMassMatrix(rope, rope.theta);
    for(let j = 0; j < Ns; j++){
      rhs[j] = L * muDiag[j] * (Math.sin(rope.theta[j]) * dvx - Math.cos(rope.theta[j]) * dvy);
    }
    solveLinear(rope);                                    // fills rope.accel = Δθ̇
    for(let j = 0; j < Ns; j++){
      rope.thetaDot[j] += rope.accel[j];
    }
    // θ̇ just jumped discontinuously — the prior substep's increment no longer
    // predicts the next one, so cold-start the next Newton solve.
    rope.warmStartValid = false;
  }
}

// Evaluate f(y) for the first-order system: y = [θ, θ̇], y' = [θ̇, θ̈].
// Writes the derivative into `out`.
function deriv(rope, theta, thetaDot, ax, ay, out){
  buildMassMatrix(rope, theta);
  buildRhs(rope, theta, thetaDot, ax, ay);
  solveLinear(rope);                                      // fills rope.accel = θ̈
  const Ns = rope.Ns;
  // Viscous drag: θ̈ ← θ̈ − α · θ̇ (uniform exponential decay
  // of every mode at rate VISCOUS_DRAG).
  if(VISCOUS_DRAG !== 0){
    for(let i = 0; i < Ns; i++){
      rope.accel[i] -= VISCOUS_DRAG * thetaDot[i];
    }
  }
  for(let i = 0; i < Ns; i++){
    out[i]      = thetaDot[i];                            // dθ/dt = θ̇
    out[Ns + i] = rope.accel[i];                          // dθ̇/dt = θ̈
  }
}

// Total kinetic energy of the chain: E = (1/2) · θ̇ᵀ · M(θ) · θ̇.
// Rebuilds M from the current θ (the M stored on the rope was destroyed by
// the most recent Gaussian elimination, so we can't reuse it).
function computeEnergy(rope){
  const Ns       = rope.Ns;
  const thetaDot = rope.thetaDot;
  buildMassMatrix(rope, rope.theta);
  const M = rope.M;
  let E = 0;
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += M[i * Ns + j] * thetaDot[j];
    E += thetaDot[i] * s;
  }
  return 0.5 * E;
}

// Coordinate-magnification metrics: writes maxThetaDot and maxLThetaDot
// to the rope. The first is what RK4 actually integrates; the second
// rescales it back to a physical (linear) velocity in the anchor frame.
function computeChainMetrics(rope){
  const Ns = rope.Ns;
  const thetaDot = rope.thetaDot;
  let maxAbs = 0;
  for(let i = 0; i < Ns; i++){
    const a = Math.abs(thetaDot[i]);
    if(!Number.isFinite(a)){          // NaN/Infinity propagates; comparison would fail silently
      rope.maxThetaDot  = a;
      rope.maxLThetaDot = a;
      return;
    }
    if(a > maxAbs) maxAbs = a;
  }
  rope.maxThetaDot  = maxAbs;
  rope.maxLThetaDot = maxAbs * rope.segmentLength;
}

// One RK4 step on (θ, θ̇) advancing by h. Anchor acceleration (ax, ay) is
// treated as constant over the step.
function rk4Step(rope, h, ax, ay){
  const Ns = rope.Ns;
  const theta = rope.theta;
  const thetaDot = rope.thetaDot;
  const thetaTmp = rope.thetaTmp;
  const thetaDotTmp = rope.thetaDotTmp;
  const k1 = rope.k1, k2 = rope.k2, k3 = rope.k3, k4 = rope.k4;

  // Reset pivot tracking for this frame; gaussSolve writes min/max across
  // all 4 substeps below, and we read them back into the rope after.
  _solveMinPivot = Infinity;
  _solveMaxPivot = 0;

  // k1 = f(y)
  deriv(rope, theta, thetaDot, ax, ay, k1);

  // k2 = f(y + h/2 · k1)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k1[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k1[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k2);

  // k3 = f(y + h/2 · k2)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k2[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k2[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k3);

  // k4 = f(y + h · k3)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + h * k3[i];
    thetaDotTmp[i] = thetaDot[i] + h * k3[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k4);

  // y_new = y + h/6 · (k1 + 2·k2 + 2·k3 + k4)
  const h6 = h / 6;
  for(let i = 0; i < Ns; i++){
    theta[i]    += h6 * (k1[i]      + 2 * k2[i]      + 2 * k3[i]      + k4[i]);
    thetaDot[i] += h6 * (k1[Ns + i] + 2 * k2[Ns + i] + 2 * k3[Ns + i] + k4[Ns + i]);
  }

  // Record worst-case M-conditioning seen across this frame's 4 substeps.
  rope.pivotMin   = _solveMinPivot;
  rope.pivotMax   = _solveMaxPivot;
  rope.pivotRatio = _solveMaxPivot > 0 ? _solveMinPivot / _solveMaxPivot : 0;
}

// --- Implicit-midpoint integrator (B3) --------------------------------

// Assembles A_raw = M·(∂θ̈/∂θ) and B_raw = M·(∂θ̈/∂θ̇) at the state
// (theta, thetaDot) with the midpoint acceleration ddt already computed.
// Reads rope.M_snap as the pristine M(theta); writes rope.A_raw, rope.B_raw.
//
// Viscous drag is folded in by treating the EOM RHS as
//   b_full = Q_anchor − C + q_bend + q_strain − α · M · θ̇,
// so M · θ̈ = b_full.  The −α·M·θ̇ piece adds −α·(∂M/∂θ_k)·θ̇ to ∂b/∂θ
// and −α·M to ∂b/∂θ̇.  Both fold into the formulas below.
function buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay){
  const Ns         = rope.Ns;
  const L          = rope.segmentLength;
  const m          = rope.particleMass;
  const muDiag     = rope.muDiag;
  const L2         = L * L;
  const kTheta     = BENDING_EI / L;
  const A          = rope.A_raw;
  const B          = rope.B_raw;
  const M          = rope.M_snap;
  const w          = rope.tmpNs;
  const S          = rope.tmpNs2;

  A.fill(0);
  B.fill(0);

  // w_j := α·θ̇_j + ddt_j — single vector to contract with (∂M/∂θ_k),
  // capturing both the −(∂M/∂θ_k)·ddt term in the A_raw formula and the
  // −α·(∂M/∂θ_k)·θ̇ piece coming from differentiating −α·M·θ̇ in b_full.
  for(let i = 0; i < Ns; i++) w[i] = VISCOUS_DRAG * thetaDot[i] + ddt[i];

  // S_i := Σ_j L²·μ_{ij}·sin(θ_i − θ_j)·w_j — used on the i==k diagonal
  // of the M-derivative contribution to A_raw.
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++){
      const mu = (Ns - Math.max(i, j)) * m;
      s += L2 * mu * Math.sin(theta[i] - theta[j]) * w[j];
    }
    S[i] = s;
  }

  // --- A_raw assembly, column by column ---
  for(let k = 0; k < Ns; k++){
    const tdk2 = thetaDot[k] * thetaDot[k];

    // ∂Q_anchor/∂θ_k = δ · L · μ_kk · (cos θ_k · ax + sin θ_k · ay) (diagonal)
    A[k * Ns + k] += L * muDiag[k] * (Math.cos(theta[k]) * ax + Math.sin(theta[k]) * ay);

    // ∂Q_grav/∂θ_k = −g · L · μ_kk · sin θ_k (diagonal). Keeps Newton's
    // Jacobian consistent with the gravity term added to buildRhs.
    if(GRAVITY !== 0) A[k * Ns + k] -= L * muDiag[k] * GRAVITY * Math.sin(theta[k]);

    // −∂C_i/∂θ_k: off-diagonal piece +L²·μ_ik·cos(θ_i−θ_k)·θ̇_k² for all i,
    // plus a diagonal correction −Σ_l L²·μ_kl·cos(θ_k−θ_l)·θ̇_l² at i = k.
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

    // −(∂M/∂θ_k)·w contribution.  (∂M/∂θ_k)_ij = L²·μ_ij·sin(θ_i−θ_j)·(δ_kj − δ_ki).
    // → row i: −L²·μ_ik·sin(θ_i−θ_k)·w_k for all i (vanishes at i=k since sin 0 = 0)
    //   plus +S_k at i = k (the δ_ki piece).
    for(let i = 0; i < Ns; i++){
      const muIK = (Ns - Math.max(i, k)) * m;
      A[i * Ns + k] -= L2 * muIK * Math.sin(theta[i] - theta[k]) * w[k];
    }
    A[k * Ns + k] += S[k];
  }

  // Linear bending: tridiagonal contribution to A_raw with constant
  // weight V''(Δθ) = kTheta.  Neumann BCs (free ends).
  if(BENDING_EI !== 0 && Ns >= 2){
    for(let i = 0; i < Ns; i++){
      if(i < Ns - 1){
        A[i * Ns + i]       -= kTheta;
        A[i * Ns + (i + 1)] += kTheta;
      }
      if(i > 0){
        A[i * Ns + i]       -= kTheta;
        A[i * Ns + (i - 1)] += kTheta;
      }
    }
  }

  // --- B_raw assembly ---
  // Dense parts: −∂C/∂θ̇_m and −α·M.
  for(let j = 0; j < Ns; j++){
    for(let mm = 0; mm < Ns; mm++){
      const muJM = (Ns - Math.max(j, mm)) * m;
      B[j * Ns + mm] -= 2 * L2 * muJM * Math.sin(theta[j] - theta[mm]) * thetaDot[mm];
      B[j * Ns + mm] -= VISCOUS_DRAG * M[j * Ns + mm];
    }
  }

  // Strain-rate damping: tridiagonal contribution (Neumann BCs).
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

// One implicit step advancing (θ, θ̇) by h, parametrized by gamma:
//   gamma = 0.5  → implicit midpoint: f evaluated at (y_n + y_new)/2,
//                  Jacobian coefficient h·gamma = h/2; A-stable but not
//                  L-stable (high-freq modes survive with bounded amplitude).
//   gamma = 1.0  → implicit Euler:    f evaluated at y_new, Jacobian
//                  coefficient h·gamma = h; both A- and L-stable
//                  (high-freq modes damped per step).
// In both cases Newton solves F(y_new) = 0 where
//   F(y_new) = y_new − y_n − h · f(y_n + gamma·(y_new − y_n))
// and the block-eliminated linear system is
//   K · Δθ = M·r_θ + h·gamma·M·r_θ̇ − h·gamma·B_raw·r_θ
// with K = M − h·gamma·B_raw − (h·gamma)²·A_raw.  Δθ̇ recovered from row 1
// as Δθ̇ = (1/(h·gamma))·(Δθ − r_θ).
// Returns true if Newton converged to NEWTON_TOL, false if it bailed at
// NEWTON_MAX_ITERS.  Anchor acceleration (ax, ay) held constant.
function implicitStep(rope, h, ax, ay, gamma){
  const Ns          = rope.Ns;
  const theta       = rope.theta;
  const thetaDot    = rope.thetaDot;
  const thetaN      = rope.thetaN;
  const thetaDotN   = rope.thetaDotN;
  const thetaNew    = rope.thetaNew;
  const thetaDotNew = rope.thetaDotNew;
  const thetaEval   = rope.thetaMid;       // f-evaluation point: y_n + gamma·(y_new − y_n)
  const thetaDotEval= rope.thetaDotMid;
  const ddtEval     = rope.ddtMid;
  const F_theta     = rope.F_theta;
  const F_thetaDot  = rope.F_thetaDot;
  const dTheta      = rope.dTheta;
  const dThetaDot   = rope.dThetaDot;
  const A           = rope.A_raw;
  const B           = rope.B_raw;
  const K           = rope.K;
  const Krhs        = rope.Krhs;
  const Msnap       = rope.M_snap;
  // r_θ = −F_theta, r_θ̇ = −F_thetaDot — read off F_* with negation at the
  // use site to save scratch (rope.tmpNs / tmpNs2 are aliased inside
  // buildJacobianBlocks, so we can't stage them there).

  _solveMinPivot = Infinity;
  _solveMaxPivot = 0;

  thetaN.set(theta);
  thetaDotN.set(thetaDot);

  // Initial guess for the Newton iterate y_{n+1}^(0).
  const usedWarm = NEWTON_WARM_START && rope.warmStartValid;
  if(usedWarm){
    // Warm start: linear extrapolation from the previous converged substep's
    // realized increment, y⁰ = y_n + Δy_prev.  Bounded physical motion, so it
    // can't overshoot Newton's basin the way h·θ̈ can; also skips the
    // explicit-Euler build+solve entirely (one fewer O(N³) solve per substep).
    const prevDTheta    = rope.prevDTheta;
    const prevDThetaDot = rope.prevDThetaDot;
    for(let i = 0; i < Ns; i++){
      thetaNew[i]    = thetaN[i]    + prevDTheta[i];
      thetaDotNew[i] = thetaDotN[i] + prevDThetaDot[i];
    }
  } else {
    // Cold start: one explicit-Euler step, y⁰ = y_n + h·f(y_n).  Used on the
    // first substep after Reset / impulse / a non-converged step.  We fold
    // viscous drag into b_full here for consistency with the Newton loop.
    buildMassMatrix(rope, thetaN);
    Msnap.set(rope.M);
    buildRhs(rope, thetaN, thetaDotN, ax, ay);
    if(VISCOUS_DRAG !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotN[j];
        rope.rhs[i] -= VISCOUS_DRAG * s;
      }
    }
    solveLinear(rope);
    for(let i = 0; i < Ns; i++){
      thetaNew[i]    = thetaN[i]    + h * thetaDotN[i];
      thetaDotNew[i] = thetaDotN[i] + h * rope.accel[i];
    }
  }

  const oneMinusGamma = 1 - gamma;
  const hg            = h * gamma;
  const hg2           = hg * hg;
  const invHg         = 1 / hg;

  let converged = false;
  let iters     = 0;
  let lastRel   = 0;
  for(let iter = 0; iter < NEWTON_MAX_ITERS; iter++){
    iters = iter + 1;
    // f-evaluation point: y_eval = (1 − γ)·y_n + γ·y_new.
    for(let i = 0; i < Ns; i++){
      thetaEval[i]    = oneMinusGamma * thetaN[i]    + gamma * thetaNew[i];
      thetaDotEval[i] = oneMinusGamma * thetaDotN[i] + gamma * thetaDotNew[i];
    }

    // Build M(eval), snapshot, then b_full, then solve for ddt_eval.
    buildMassMatrix(rope, thetaEval);
    Msnap.set(rope.M);
    buildRhs(rope, thetaEval, thetaDotEval, ax, ay);
    if(VISCOUS_DRAG !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotEval[j];
        rope.rhs[i] -= VISCOUS_DRAG * s;
      }
    }
    solveLinear(rope);
    ddtEval.set(rope.accel);

    // Residual F(y_new) = y_new − y_n − h · f(y_eval).
    for(let i = 0; i < Ns; i++){
      F_theta[i]    = thetaNew[i]    - thetaN[i]    - h * thetaDotEval[i];
      F_thetaDot[i] = thetaDotNew[i] - thetaDotN[i] - h * ddtEval[i];
    }

    // Jacobian blocks at the eval state.  Clobbers rope.tmpNs / tmpNs2.
    buildJacobianBlocks(rope, thetaEval, thetaDotEval, ddtEval, ax, ay);

    // K = M − hγ·B_raw − (hγ)²·A_raw.
    const Ns2 = Ns * Ns;
    for(let i = 0; i < Ns2; i++){
      K[i] = Msnap[i] - hg * B[i] - hg2 * A[i];
    }

    // Krhs = M·r_θ + hγ·M·r_θ̇ − hγ·B·r_θ, with r = −F.
    for(let i = 0; i < Ns; i++){
      let mTheta = 0, mThetaDot = 0, bTheta = 0;
      for(let j = 0; j < Ns; j++){
        mTheta    += Msnap[i * Ns + j] * (-F_theta[j]);
        mThetaDot += Msnap[i * Ns + j] * (-F_thetaDot[j]);
        bTheta    += B[i * Ns + j]     * (-F_theta[j]);
      }
      Krhs[i] = mTheta + hg * mThetaDot - hg * bTheta;
    }

    // Solve K·Δθ = Krhs.
    gaussSolve(Ns, K, Krhs, dTheta);

    // Recover Δθ̇ = (1/(hγ))·(Δθ + F_theta).
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

  // Commit ONLY on success. On failure, leave θ/θ̇ at the substep-start state
  // (theta itself was never modified — only the thetaNew scratch was), so the
  // caller (advanceSubstep) can retry this slice as half-steps before any
  // coast. The coast itself now lives in coastSubstep(), used as last resort.
  if(converged){
    // Warm-start seed for the next substep = this realized increment.
    const prevDTheta    = rope.prevDTheta;
    const prevDThetaDot = rope.prevDThetaDot;
    for(let i = 0; i < Ns; i++){
      prevDTheta[i]    = thetaNew[i]    - thetaN[i];
      prevDThetaDot[i] = thetaDotNew[i] - thetaDotN[i];
    }
    rope.warmStartValid = true;
    // Commit.
    theta.set(thetaNew);
    thetaDot.set(thetaDotNew);
  } else {
    rope.warmStartValid = false;   // failed seed is garbage; θ/θ̇ left unchanged
  }

  rope.pivotMin            = _solveMinPivot;
  rope.pivotMax            = _solveMaxPivot;
  rope.pivotRatio          = _solveMaxPivot > 0 ? _solveMinPivot / _solveMaxPivot : 0;
  rope.lastNewtonIters     = iters;
  rope.lastNewtonRelStep   = lastRel;
  rope.lastNewtonConverged = converged;

  return converged;
}

// Last-resort fallback when even the smallest retry can't be solved: advance
// this slice by inertia for time h, forces off, with viscous drag kept (so it
// still dissipates and can't self-sustain). θ/θ̇ are at the slice-start state.
function coastSubstep(rope, h){
  const Ns = rope.Ns;
  const damp = 1 - VISCOUS_DRAG * h;
  for(let i = 0; i < Ns; i++){
    rope.thetaDot[i] *= damp;
    rope.theta[i]    += h * rope.thetaDot[i];
  }
  rope.warmStartValid = false;
  _rejectThisFrame++;
  _rejectTotal++;
}

// Advance one slice of size h. Try the implicit step; if Newton fails, retry
// as two half-steps (recursively, up to HALVING_MAX_DEPTH) — halving h shrinks
// the Newton-basin overshoot, so the slice usually becomes solvable — and only
// coast at the deepest level as a last resort. Because implicitStep leaves
// θ/θ̇ untouched on failure, the retry just re-runs from the same state; no
// explicit save/restore needed. Returns true if solved (no coast in subtree).
function advanceSubstep(rope, h, ax, ay, gamma, depth){
  if(implicitStep(rope, h, ax, ay, gamma)) return true;
  if(USE_HALVING && depth < HALVING_MAX_DEPTH){
    _halveThisFrame++;
    _halveTotal++;
    const ok1 = advanceSubstep(rope, h * 0.5, ax, ay, gamma, depth + 1);
    const ok2 = advanceSubstep(rope, h * 0.5, ax, ay, gamma, depth + 1);
    return ok1 && ok2;
  }
  coastSubstep(rope, h);
  return false;
}

// --- Update loop -------------------------------------------------------

function updateParticlePositions(rope){
  const Ns   = rope.Ns;
  const L    = rope.segmentLength;
  const px   = rope.px;
  const py   = rope.py;
  const theta = rope.theta;
  let x = rope.baseX + anchorDeltaX;
  let y = rope.baseY + anchorDeltaY;
  px[0] = x;
  py[0] = y;
  for(let k = 0; k < Ns; k++){
    x += L * Math.cos(theta[k]);
    y += L * Math.sin(theta[k]);
    px[k + 1] = x;
    py[k + 1] = y;
  }
}

export function update(dt){
  const h = dt;
  if(h <= 0) return;

  // Perf HUD: measure the real wall-clock gap between update() calls (the
  // true frame interval, independent of the dt clamp), and record the dt we
  // were actually handed plus whether it was clamped. dt = min(0.033, real),
  // so dt ≥ 0.033 ⇔ the real interval exceeded 33 ms and physics is running
  // in slow motion.
  if(SHOW_PERF_HUD){
    const now = performance.now();
    if(_perfLastFrameT > 0){
      const interval = now - _perfLastFrameT;
      _perfFrameMs += (interval - _perfFrameMs) * _PERF_EMA;
    }
    _perfLastFrameT = now;
    _perfRawDtMs = dt * 1000;
    _perfClamped = dt >= 0.033;
  }

  // ax, ay are the anchor's smoothed acceleration over this frame, fed to
  // Q_anchor inside the substep force evaluations.  For the mouse-drag path we
  // use this smooth delivery instead of an instantaneous Δv impulse — same
  // total Δθ̇ is transferred to the chain over the frame, but distributed
  // across the substeps so the substep θ̇ values stay small (and Coriolis
  // ∝ θ̇² stays much smaller during evaluation).  Arrow keys still use the
  // impulse path inside the keydown handler.
  let ax = 0, ay = 0;
  if(!anchorHeld && USE_ANCHOR_SPRING){
    // Spring mode (shipping control): the anchor is a spring-mass-damper
    // chasing the handle. While held, the finger drives the handle; once
    // released the handle stays put and the spring keeps pulling the anchor
    // toward it until it settles. ax/ay is the spring force per unit mass —
    // bounded by the stretch (a distance), not by Δv/h, so a slow/clamped
    // frame can no longer manufacture a huge acceleration.
    const dx = handleDeltaX - anchorDeltaX;
    const dy = handleDeltaY - anchorDeltaY;
    const dist = Math.hypot(dx, dy);
    let fx = 0, fy = 0;
    if(dist > 1e-6){
      const stretch = dist - springRestLength();
      const ux = dx / dist, uy = dy / dist;
      fx = SPRING_K * stretch * ux;
      fy = SPRING_K * stretch * uy;
    }
    // Viscous damping on the anchor's own velocity.
    fx -= SPRING_DAMP * anchorVx;
    fy -= SPRING_DAMP * anchorVy;
    ax = fx / ANCHOR_MASS;
    ay = fy / ANCHOR_MASS + GRAVITY;   // gravity acts on the anchor body too
    // Semi-implicit Euler step for the anchor body (update v, then x).
    anchorVx += ax * h;
    anchorVy += ay * h;
    anchorDeltaX += anchorVx * h;
    anchorDeltaY += anchorVy * h;
    if(handleHeld || Math.abs(anchorVx) > 1e-3 || Math.abs(anchorVy) > 1e-3) anchorHasInteracted = true;
    _frameShiftY = 0;
    _frameAy     = ay;
  } else if(anchorHeld){
    // During drag: emptyMove has already updated anchorDeltaX/Y to track
    // the mouse exactly.  Measure this frame's anchor velocity from the
    // position delta, derive its acceleration vs. the previous frame, and
    // pass that to Q_anchor.
    const newAnchorVx = (anchorDeltaX - prevAnchorDeltaX) / h;
    const newAnchorVy = (anchorDeltaY - prevAnchorDeltaY) / h;
    ax = (newAnchorVx - anchorVx) / h;
    ay = (newAnchorVy - anchorVy) / h;
    if(ax !== 0 || ay !== 0) anchorHasInteracted = true;

    anchorVx = newAnchorVx;
    anchorVy = newAnchorVy;
    // Snapshot for the substep CSV's leading columns: how much the mouse
    // moved in y this frame (Δy in px) and the resulting smooth-delivery
    // acceleration (px/s²).
    _frameShiftY = anchorDeltaY - prevAnchorDeltaY;
    _frameAy     = ay;
  } else {
    // Not dragging: anchor drifts at whatever velocity arrow keys (or
    // releasing the drag) left it at.  Constant velocity → ax = ay = 0,
    // just rigid translation of the whole frame.
    anchorDeltaX += anchorVx * h;
    anchorDeltaY += anchorVy * h;
    _frameShiftY = 0;
    _frameAy     = 0;
  }

  // Keep the handle on-screen VERTICALLY only — there's no vertical wrap, so
  // an off-top/bottom handle would be unrecoverable. Horizontally it's free:
  // it wraps L↔R and grab detection is wrap-aware, so it's never lost.
  {
    const b = ropes[0];
    const hy = b.baseY + handleDeltaY;
    if(hy < 0)                  handleDeltaY = -b.baseY;
    else if(hy > canvas.height) handleDeltaY = canvas.height - b.baseY;
  }

  // Per real frame, take SUBSTEPS_PER_FRAME steps of the active integrator
  // (RK4 or implicit midpoint).  Anchor acceleration (ax, ay) is held
  // constant across substeps — the chain receives the same total impulse
  // it would have with a single h-step.
  // gamma encodes which implicit method we're running:
  // 0.5 → midpoint, 1.0 → Euler.  null means RK4 (no Newton iteration).
  const gamma    = INTEGRATOR === 'implicit-midpoint' ? 0.5
                 : INTEGRATOR === 'implicit-euler'    ? 1.0
                 : null;
  const isImplicit = gamma !== null;
  const substeps = isImplicit ? IMPLICIT_SUBSTEPS_PER_FRAME : RK4_SUBSTEPS_PER_FRAME;
  const h_sub    = h / substeps;
  _perfSubsteps  = substeps;
  // Accumulates wall-clock time spent purely in the integrator substep loop
  // (the diagnostic monitors below are excluded so this reads as the
  // shippable physics cost). EMA-folded into _perfPhysicsMs after the loop.
  let _physMsThisFrame = 0;
  _rejectThisFrame = 0;  // reset the live reject-on-non-convergence counter
  _halveThisFrame = 0;   // reset the live step-halving counter
  // Per-frame Newton log, only used when NEWTON_LOG_ENABLED.  Captures
  // (iters, relStep, converged) for every substep across every rope so we
  // can spot Newton failures or near-failures.
  const newtonItersArr   = NEWTON_LOG_ENABLED ? new Array(substeps) : null;
  const newtonRelArr     = NEWTON_LOG_ENABLED ? new Array(substeps) : null;
  let   newtonConvCount  = 0;
  for(const rope of ropes){
    const _physT0 = SHOW_PERF_HUD ? performance.now() : 0;
    for(let s = 0; s < substeps; s++){
      if(isImplicit){
        const solved = advanceSubstep(rope, h_sub, ax, ay, gamma, 0);
        if(NEWTON_LOG_ENABLED){
          newtonItersArr[s] = rope.lastNewtonIters;   // last sub-attempt's iters
          newtonRelArr[s]   = rope.lastNewtonRelStep;
          if(solved) newtonConvCount++;               // solved = no coast (possibly via halving)
        }
      } else {
        rk4Step(rope, h_sub, ax, ay);
      }
    }
    if(SHOW_PERF_HUD) _physMsThisFrame += performance.now() - _physT0;
    if(NEWTON_LOG_ENABLED && isImplicit && anchorHasInteracted){
      // Only print problem frames: a substep failed to converge, or one
      // strained close to the iteration cap (run-up to a failure).  Healthy
      // frames (all converged in few iters) stay silent so the failure
      // moment isn't buried under thousands of identical lines.
      const maxIters = newtonItersArr.reduce((a, b) => Math.max(a, b ?? 0), 0);
      const NEWTON_NEAR_FAIL_ITERS = NEWTON_MAX_ITERS - 2;   // 6 of 8 = straining
      if(newtonConvCount < substeps || maxIters >= NEWTON_NEAR_FAIL_ITERS){
        const itersStr = newtonItersArr.join(',');
        const relStr   = newtonRelArr.map(r => expFix(r)).join(',');
        console.log(`[Newton N=${rope.N}] iters=[${itersStr}] relStep=[${relStr}] converged=${newtonConvCount}/${substeps} halveΣ=${_halveTotal} rejΣ=${_rejectTotal} singBailΣ=${_singularBails} (${INTEGRATOR})`);
      }
      newtonConvCount = 0;
    }
    if(CONDITION_ESTIMATE) estimateConditionNumber(rope);
    if(ENERGY_MONITOR){
      rope.prevE             = rope.E;
      rope.prevMaxThetaDot   = rope.maxThetaDot;
      rope.prevMaxLThetaDot  = rope.maxLThetaDot;
      rope.E = computeEnergy(rope);
      computeChainMetrics(rope);
      const fmt = (x) => Number.isFinite(x) ? x.toExponential(2) : String(x);
      if(!Number.isFinite(rope.E)){
        if(!rope.nanWarned){
          console.warn(`[Alex2 E] N=${rope.N}: non-finite E=${rope.E} (prev E=${fmt(rope.prevE)}, prev |θ̇|=${fmt(rope.prevMaxThetaDot)}, prev L|θ̇|=${fmt(rope.prevMaxLThetaDot)})`);
          rope.nanWarned = true;
        }
      } else {
        rope.nanWarned = false;       // E is finite — re-arm NaN latch for next time
        if(rope.prevE > 0 && rope.E / rope.prevE > E_SPIKE_RATIO){
          console.warn(`[Alex2 E] N=${rope.N}: spike (×${(rope.E/rope.prevE).toExponential(2)})  E ${fmt(rope.prevE)}→${fmt(rope.E)}  |θ̇| ${fmt(rope.prevMaxThetaDot)}→${fmt(rope.maxThetaDot)}  L|θ̇| ${fmt(rope.prevMaxLThetaDot)}→${fmt(rope.maxLThetaDot)}`);
        }
      }
    }
    updateParticlePositions(rope);
  }

  if(SHOW_PERF_HUD){
    _perfPhysicsMs += (_physMsThisFrame - _perfPhysicsMs) * _PERF_EMA;
  }

  // Energy-decay logger: every frame, accumulate the PEAK chain KE and PEAK
  // anchor speed over the interval (point samples alias the fast anchor
  // oscillation); print + reset every ENERGY_DECAY_LOG_EVERY frames.
  if(ENERGY_DECAY_LOG){
    _eLogTime += h;
    const KE = computeEnergy(ropes[0]);
    if(KE > _logMaxKE) _logMaxKE = KE;
    const aSpeed = Math.hypot(anchorVx, anchorVy);
    if(aSpeed > _logMaxAnchorSpeed) _logMaxAnchorSpeed = aSpeed;
    if(_eLogFrame++ % ENERGY_DECAY_LOG_EVERY === 0){
      // Shape metrics (slowly-varying → point sample is fine): bending
      // potential energy ½·k_θ·Σ(Δθ)², and the sharpest single-link bend
      // max|Δθ| (a direct loop/kink detector — KE misses a frozen loop).
      const rope = ropes[0];
      const kTheta = BENDING_EI / rope.segmentLength;
      let bendPE = 0, maxDth = 0;
      for(let i = 0; i < rope.Ns - 1; i++){
        const dth = rope.theta[i + 1] - rope.theta[i];
        bendPE += dth * dth;
        const a = Math.abs(dth);
        if(a > maxDth) maxDth = a;
      }
      bendPE *= 0.5 * kTheta;
      console.log(`[E] t=${_eLogTime.toFixed(1)}s  peakKE=${expFix(_logMaxKE)}  bendPE=${expFix(bendPE)}  max|Δθ|=${maxDth.toFixed(3)}  peak|aV|=${expFix(_logMaxAnchorSpeed)}  halveΣ=${_halveTotal}  rejΣ=${_rejectTotal}`);
      _logMaxKE = 0;
      _logMaxAnchorSpeed = 0;
    }
  }

  prevAnchorDeltaX = anchorDeltaX;
  prevAnchorDeltaY = anchorDeltaY;
}

// --- Drawing -----------------------------------------------------------

function drawRopeSegments(ctx){
  ctx.lineWidth = 3;
  for(const rope of ropes){
    for(let i = 0; i < rope.Ns; i++){
      const hue = (i / Math.max(1, rope.Ns - 1)) * 360;
      ctx.strokeStyle = `hsl(${hue}, 85%, 60%)`;
      ctx.beginPath();
      ctx.moveTo(rope.px[i],     rope.py[i]);
      ctx.lineTo(rope.px[i + 1], rope.py[i + 1]);
      ctx.stroke();
    }
  }
}

function drawAnchorDot(ctx){
  const r = Math.min(canvas.width, canvas.height) * ANCHOR_MARKER_RADIUS_FRAC;
  ctx.fillStyle = ANCHOR_COLOR;
  for(const rope of ropes){
    ctx.beginPath();
    ctx.arc(rope.px[0], rope.py[0], r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The N= / energy readout is UI text, drawn once at the rope base — NOT part
// of the tiled scene (we don't want duplicated labels on wrap copies).
function drawAnchorLabel(ctx){
  const r = Math.min(canvas.width, canvas.height) * ANCHOR_MARKER_RADIUS_FRAC;
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(230, 238, 246, 0.65)';
  for(const rope of ropes){
    if(ENERGY_MONITOR){
      const eStr = Number.isFinite(rope.E) ? rope.E.toExponential(2) : String(rope.E);
      const tdStr = Number.isFinite(rope.maxThetaDot)  ? rope.maxThetaDot.toFixed(2)  : String(rope.maxThetaDot);
      const lvStr = Number.isFinite(rope.maxLThetaDot) ? rope.maxLThetaDot.toFixed(1) : String(rope.maxLThetaDot);
      ctx.fillText(`N=${rope.N}  E=${eStr}`,                     rope.baseX - r * 2, rope.baseY - 8);
      ctx.fillText(`|θ̇|=${tdStr}  L|θ̇|=${lvStr}`,                  rope.baseX - r * 2, rope.baseY + 8);
    } else {
      ctx.fillText(`N=${rope.N}`, rope.baseX - r * 2, rope.baseY);
    }
  }
}

// Spring + handle: a coil from the chain head (anchor) to the big handle the
// finger grabs. The coil has a fixed number of turns whose spacing adapts to
// the current length, so it reads as a real spring whether compressed
// (distance < rest length) or stretched.
function drawSpringHandle(ctx){
  if(!USE_ANCHOR_SPRING) return;
  const minDim = Math.min(canvas.width, canvas.height);
  const amp = minDim * SPRING_COIL_AMPLITUDE_FRAC;
  const hr  = minDim * HANDLE_MARKER_RADIUS_FRAC;
  for(const rope of ropes){
    const ax = rope.px[0], ay = rope.py[0];                 // anchor = chain head
    const hx = rope.baseX + handleDeltaX, hy = rope.baseY + handleDeltaY;
    const dx = hx - ax, dy = hy - ay;
    const len = Math.hypot(dx, dy);
    ctx.strokeStyle = SPRING_COIL_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    if(len > 1e-3){
      const ux = dx / len, uy = dy / len;                   // axis unit
      const pxn = -uy, pyn = ux;                            // perpendicular unit
      const lead = 0.12;                                    // straight lead at each end
      const turns = SPRING_COIL_TURNS;
      const seg = (1 - 2 * lead) / turns;
      ctx.lineTo(ax + ux * len * lead, ay + uy * len * lead);
      for(let i = 0; i < turns; i++){
        const t = lead + seg * (i + 0.5);
        const side = (i % 2 === 0) ? 1 : -1;
        ctx.lineTo(ax + ux * len * t + pxn * amp * side,
                   ay + uy * len * t + pyn * amp * side);
      }
      ctx.lineTo(ax + ux * len * (1 - lead), ay + uy * len * (1 - lead));
    }
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // Handle disc (semi-transparent so the string shows through it).
    ctx.fillStyle = HANDLE_COLOR;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Whole-scene toroidal wrap: draw the entire movable scene (chain + spring +
// handle + anchor dot) once per needed canvas shift via ctx.translate, and let
// the canvas clip. The off-frame part of *anything* reappears on the opposite
// edge — uniform across all elements, no per-element wrap math. Only the
// shifts whose combined bounding box crosses an edge are drawn, so it costs
// nothing when everything is on-screen.
function drawScene(ctx){
  drawAnchorDot(ctx);      // behind
  drawSpringHandle(ctx);   // behind
  drawRopeSegments(ctx);   // chain on top — so near-anchor links aren't hidden by the dot
}

function drawAlex2(ctx){
  // Horizontal-only wrap: sideways whips reappear on the opposite side, but
  // nothing ever wraps top↔bottom. With gravity the chain hangs down, so a
  // vertical wrap would teleport a fallen chain to the top — which reads
  // badly. (Drop the height term here to re-enable full toroidal wrap.)
  let oxs = [0];
  if(USE_CHAIN_WRAP){
    const w = canvas.width;
    // Include the handle's radius so a wrap copy is drawn whenever the disk
    // pokes past an edge — not only when its center crosses. Without this the
    // opposite-side image flickered (it appeared only when a chain particle
    // happened to cross the edge).
    const hr = Math.min(canvas.width, canvas.height) * HANDLE_MARKER_RADIUS_FRAC;
    let minX = Infinity, maxX = -Infinity;
    for(const rope of ropes){
      for(let i = 0; i <= rope.Ns; i++){
        const x = rope.px[i];
        if(x < minX) minX = x; if(x > maxX) maxX = x;
      }
      const hx = rope.baseX + handleDeltaX;
      if(hx - hr < minX) minX = hx - hr; if(hx + hr > maxX) maxX = hx + hr;
    }
    if(maxX > w) oxs.push(-w);
    if(minX < 0) oxs.push(w);
  }
  for(const ox of oxs){
    ctx.save();
    ctx.translate(ox, 0);
    drawScene(ctx);
    ctx.restore();
  }
  drawAnchorLabel(ctx);   // once, untiled
}

renderExtras.push(drawAlex2);

// Performance HUD — drawn as an overlay (on top of the rope) so it's always
// legible. Reads the smoothed module-level perf state captured in update().
function drawPerfHud(ctx){
  if(!SHOW_PERF_HUD) return;
  const fps     = _perfFrameMs > 0 ? 1000 / _perfFrameMs : 0;
  // Fraction of each real frame spent in physics. Near 100% → physics is the
  // bottleneck; well below → render/vsync is the limiter, not the chain.
  const physPct = _perfFrameMs > 0 ? (_perfPhysicsMs / _perfFrameMs) * 100 : 0;
  const lines = [
    `${fps.toFixed(0)} fps   ${_perfFrameMs.toFixed(1)} ms/frame`,
    `physics ${_perfPhysicsMs.toFixed(1)} ms   (${physPct.toFixed(0)}% of frame)`,
    `dt ${_perfRawDtMs.toFixed(1)} ms${_perfClamped ? '   ⚠ CLAMPED@33' : ''}`,
    `N=${N}  substeps=${_perfSubsteps}  ${INTEGRATOR}`,
    `reject ${_rejectThisFrame}/frame   (Σ${_rejectTotal})`,
  ];

  ctx.save();
  ctx.font = '13px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const pad = 8, lh = 18;
  let maxW = 0;
  for(const s of lines) maxW = Math.max(maxW, ctx.measureText(s).width);
  // Background panel for legibility over the multicolored rope.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(8, 8, maxW + pad * 2, lines.length * lh + pad * 2);
  for(let i = 0; i < lines.length; i++){
    // Amber alarm: dt-clamp line (i=2) while clamped; reject line (i=4) on any
    // frame the anti-chaos safety net coasted a non-converged substep.
    const alarm = (i === 2 && _perfClamped) || (i === 4 && _rejectThisFrame > 0);
    ctx.fillStyle = alarm ? '#e8b84b' : 'rgba(235, 242, 248, 0.92)';
    ctx.fillText(lines[i], 8 + pad, 8 + pad + i * lh);
  }
  ctx.restore();
}
renderOverlays.push(drawPerfHud);

// Initialize particle positions so the chain is visible before update() runs.
for(const rope of ropes) updateParticlePositions(rope);
// Park the handle above the anchor: with gravity the anchor hangs below the
// handle, and the chain hangs below the anchor — a natural rest pose, and a
// visible grab target before the first update() frame runs.
handleDeltaX = 0;
handleDeltaY = -springRestLength();

// Reset re-initializes both ropes to horizontal at rest, clears anchor offset.
document.getElementById('resetDisk')?.addEventListener('click', () => {
  anchorDeltaX = 0;
  anchorDeltaY = 0;
  anchorVx = 0;
  anchorVy = 0;
  prevAnchorDeltaX = 0;
  prevAnchorDeltaY = 0;
  anchorHeld = false;
  handleHeld = false;
  handleDeltaX = 0;
  handleDeltaY = -springRestLength();
  for(const rope of ropes){
    rope.theta.fill(INITIAL_THETA);
    rope.thetaDot.fill(0);
    rope.warmStartValid = false;
    rope.E = 0;
    rope.prevE = 0;
    rope.maxThetaDot     = 0;
    rope.maxLThetaDot    = 0;
    rope.prevMaxThetaDot  = 0;
    rope.prevMaxLThetaDot = 0;
    rope.nanWarned = false;
    rope.pivotMin   = Infinity;
    rope.pivotMax   = 0;
    rope.pivotRatio = 0;
    rope.condLambdaMin = 0;
    rope.condLambdaMax = 0;
    rope.condNum    = 0;
    updateParticlePositions(rope);
  }
  anchorHasInteracted  = false;
  // Reset the anti-chaos counters.
  _rejectThisFrame = 0;
  _rejectTotal     = 0;
  _halveThisFrame  = 0;
  _halveTotal      = 0;
  _eLogFrame = 0;
  _eLogTime  = 0;
});
