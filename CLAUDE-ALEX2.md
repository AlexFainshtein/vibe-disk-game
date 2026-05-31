# CLAUDE-ALEX2.md

Alex2's variant of the Vibe Disk Game — a **rope/chain physics sandbox** in reduced (joint-angle) coordinates. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls).

Alex2 is the second of Alex's chain experiments. The first variant (see git history — branch `Alex2: new variant — Verlet rope sandbox with adaptive XPBD constraint solver`) used Verlet + position-based dynamics. This one explores the *Lagrangian / reduced-coordinate* approach instead: each rope is parameterized by its N−1 joint angles, distance constraints are exact by construction, and the equations of motion come from analytical mechanics rather than constraint projection.

## Entry page

- [alex2.html](Alex2/alex2.html) — sets `<body data-player="alex2">` so [main.js](main.js) dynamically imports `alex2-physics.js`. Single button in `#panel`: Reset. The disk and bar are deliberately disabled (`bar.hidden = true`, `inputHooks.diskGrab = false`, `setDiskRadiusFraction(0)`); the playfield exists only as a backdrop for the chain.

## What Alex2 is

Drag the small anchor dot to whip the chain around. The chain hangs from the anchor; all motion in the chain comes from anchor motion plus the chain's own dynamics (no gravity in this variant — that's an obvious add-on, deliberately left off so the dynamics tester sees only the spring/Coriolis/bending behavior).

A single chain is drawn by default (`N = 100`). The factory `makeRope` and the array-of-ropes structure are kept so the variant can be extended to a multi-rope comparison view (e.g. N=50 vs N=100, same anchor input) by pushing additional `makeRope(...)` calls into the `ropes` array — useful for verifying N-invariance after future integrator changes.

Input:
- **Mouse drag** on the anchor dot — smooth continuous driving.
- **Arrow keys** — bounded velocity impulse (`ANCHOR_KEY_VELOCITY_STEP` px/s per press) delivered as an instantaneous angular-momentum kick to the chain.

## Physics model

Each chain is parameterized by N−1 joint angles `θ_k` (one per segment). The state vector is `[θ, θ̇]`, total 2(N−1) components. Distance constraints are exact: every segment has length L, no stretching is possible by construction.

The Lagrangian equations of motion are
```
M(θ) · θ̈ + C(θ, θ̇) = Q_anchor + Q_bend + Q_damp
```

with
```
M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}            (mass matrix, dense, SPD)
C_j(θ, θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²  (Coriolis vector — see note below)
Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
μ_{jk}     = Σ_{i ≥ max(j,k)} m_i                   (lumped mass; uniform → (Ns − max(j,k))·m)
```

**Bending** is **linear**: V_pair(Δθ) = (1/2)·k_θ·Δθ², so `V'(Δθ) = k_θ·Δθ` with `k_θ = BENDING_EI / L`. The generalized bending force on θ_j is the discrete Laplacian `k_θ·(θ_{j−1} − 2·θ_j + θ_{j+1})` with Neumann (free-end) boundary conditions.

We previously had a nonlinear anti-folding model with `V'(Δθ) = 2·k_θ·tan(Δθ/2)` plus a Δθ-based clamp near ±π, intended to prevent the rope from passing through itself. It turned out to be **physically wrong** — the periodic tan(Δθ/2) form gave the bending force a sign-flip past every odd multiple of π (force "aiding" rather than "restoring"), which under sustained heavy forcing caused runaway in the integrator. Real bending energy isn't periodic in Δθ — winding around adds energy. Linear bending captures this correctly and is robust under any forcing. We accept that loops can form as a consequence; if anti-folding behavior is desired later, the right form is linear + a non-periodic soft barrier (e.g. `β·exp(c·(|Δθ| − π_max))`), NOT a periodic tan-based form. See [Alex2/tests/FINDINGS.md](Alex2/tests/FINDINGS.md) for the diagnosis.

**Strain-rate damping** is the linear discrete Laplacian on θ̇ (same Neumann BCs): pulls each joint's angular velocity toward its neighbors'. Zero effect on rigid rotation (all θ̇ equal → Laplacian = 0), suppresses high-frequency / alternating-sign modes exponentially. Coefficient `DAMPING_BEND`.

**Mass damping** subtracts `DAMPING_MASS · θ̇` from θ̈ each frame — slowly bleeds off bulk rotation. Set to 0 to coast indefinitely.

### Naming note: Coriolis vs centrifugal

We call the `C` vector "Coriolis" in the code, following the robotics/multibody-dynamics convention where the lumped `C(q,q̇)·q̇` vector is named that way. **Physically the term is centrifugal**, not Coriolis: it is quadratic in a *single* angular velocity at each k (`θ̇_k²`), and Coriolis forces are bilinear in *two distinct* velocities. The actual Coriolis-character coupling in this system lives in the cross term of the kinetic energy (`m·ȧ_anchor · L·R(θ_k)·θ̇_k`, bilinear in anchor velocity and segment angular velocity), where the anchor-velocity × segment-rotation pairing has the textbook Coriolis structure. In the 2D pure-translation case, the Euler-Lagrange algebra collapses that cross term into the `Q_anchor` acceleration coupling we have, so no explicit anchor-velocity term appears in the EOM — the Coriolis character is structural (which variables couple), not necessarily a separate surviving term. **Code keeps the conventional name; this note records the physical reading.**

## Integration

Explicit RK4 on the first-order system `y' = f(y)`, `y = [θ, θ̇]`. Each RK4 evaluation does:
1. Build M, C, Q at the current state (O(N²) for M and C).
2. Solve `M · θ̈ = Q − C` via dense Gaussian elimination with partial pivoting (O(N³)).

That's 4 builds + 4 solves per RK4 step. At N=100 this is ~4M ops per step; fits comfortably in a frame.

**Internal substepping** (`RK4_SUBSTEPS_PER_FRAME = 16`): each real frame, the integrator does that many small RK4 steps of size `h / RK4_SUBSTEPS_PER_FRAME`. Total physics time per real frame is unchanged (= h), so anchor and chain stay in lockstep — no anchor-vs-chain time mismatch.

Refining h is the **B2** robustness lever: smaller h reduces RK4's substep-amplification of the nonlinear Coriolis term, raising the |θ̇| threshold at which the integrator blows up.

### Smooth anchor delivery

Mouse-drag velocity changes are converted to a smooth anchor acceleration:
```
ax = Δv_x / h,   ay = Δv_y / h
```
which is passed to `Q_anchor` during the RK4 evaluations (constant across the N internal substeps within one real frame). This delivers the same total angular-momentum impulse but spreads it across the chain's integration, so the quadratic Coriolis term doesn't see a Δv-induced velocity jump at every substep. Without this smoothing, mouse impulses caused the chain to explode much more easily.

Arrow-key kicks bypass this entirely: they apply an exact angular-momentum impulse `M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δv_x − cos θ_j · Δv_y)` directly inside the keydown handler. Cheap and stable.

## Tunables (top of [alex2-physics.js](Alex2/alex2-physics.js))

| Constant | Default | Role |
|---|---|---|
| `N` | 100 | Number of particles in the chain (joints = N − 1) |
| `ROPE_LENGTH_FRACTION` | 0.45 | Chain's total length as a fraction of canvas width |
| `M_ROPE` | 1 | Total chain mass (excluding anchor) |
| `RK4_SUBSTEPS_PER_FRAME` | 16 | Internal RK4 substeps per real frame (the B2 robustness lever) |
| `ANCHOR_KEY_VELOCITY_STEP` | 50 px/s | Arrow-key impulse magnitude |
| `BENDING_EI` | 100 | Continuum flexural rigidity; `k_θ = BENDING_EI / L` |
| `DAMPING_BEND` | 1 | Strain-rate (discrete Laplacian on θ̇) damping coefficient |
| `DAMPING_MASS` | 0.1 | Mass-proportional damping coefficient |

### Diagnostic flags (all currently false; flip individually to investigate)

| Flag | What it logs |
|---|---|
| `ENERGY_MONITOR` | E = ½ θ̇ᵀ M θ̇ per frame; spike/NaN warnings when E_new / E_prev > `E_SPIKE_RATIO` |
| `TRACE_ENABLED` | Per-frame θ_j values (head + tail) for `TRACE_DURATION_FRAMES`; stops on NaN |
| `CONDITION_ESTIMATE` | Spectral κ₂(M) via power iteration (λ_max) + inverse power iteration (λ_min). Confirmed M conditioning is **not** the cause of explosions — κ stayed ~1.5e4 throughout failures |
| `SUBSTEP_LOG_ENABLED` | Per-substep RHS and θ̈ for the first `SUBSTEP_LOG_HEAD` joints, every RK4 substep. Used to confirm RK4's intermediate-substep amplification of nonlinear Coriolis growth |
| `INPUT_LOG_ENABLED` | Per-frame anchor position / velocity / acceleration in px-per-frame units (same scale as L ≈ 4 px), gated alongside the trace so frame indices align with the substep log |

All diagnostic outputs go to the console; substep log dumps to a CSV when tracing stops.

## Known limitations

- **RK4 sensitivity to θ̈·h²** — the failure mode is not linear instability but nonlinear: inside one RK4 step, the four k_i evaluations each see the previous one's overshoot, and once θ̈·h² becomes comparable to a characteristic angle, the four k_i diverge geometrically within a single step. `RK4_SUBSTEPS_PER_FRAME = 16` raises the threshold significantly but hard mouse drags can still crash the chain (NaN).
- **Long-persistent "chaos"** at default damping — brief mouse inputs can trigger a regime where the chain keeps moving for *much longer* than the mass-damping time-constant (~10 sec at `α = 0.1`) would predict. Open question as of 2026-05-30: what amplifies the response beyond simple linear-mode decay. Higher damping suppresses it but at the cost of sluggish feel; investigation pending.
- **No gravity / no friction / no collisions** — by design. The point is to stress-test the integrator and bending, not to build a complete sandbox.

## Future directions

- **B3 (implicit midpoint / Newmark)** — the promising next step for stability. Implicit methods are A-stable: the next state is solved self-consistently with the *next-state* forces, breaking the RK4 substep-amplification loop. Cost is a Newton iteration per step (2–4 iters, each one linear solve), so ~3–4× the per-step cost, but with stable h values 10–100× larger. Discussed but not implemented.
- **B4 (symplectic Verlet / Yoshida)** — fundamentally still explicit, same θ̈·h² sensitivity as RK4. Wins long-term energy preservation, not robustness to stiff spikes. Not promising for this problem on its own; the cloth/rope-sim trick is Verlet + iterative constraint projection (Jakobsen), which is a separate technique.

## Sizing

Chain length is `canvas.width * ROPE_LENGTH_FRACTION`; segment length `L = (canvas.width · ROPE_LENGTH_FRACTION) / (N − 1)`. Anchor marker radius `ANCHOR_MARKER_RADIUS_FRAC` (visible dot) and grab radius `ANCHOR_GRAB_RADIUS_FRAC` (touch target) are fractions of the canvas dimension.

## Reset behavior

The Reset button (handler in [controls.js](controls.js)) resets the anchor to its initial position and zeros all `θ` and `θ̇`. Tracing/logging buffers also restart so a Reset gives clean repeatable runs.
