# ALLO — Model Card

**ALLO — Adaptive Landslide Learning Observatory**
*Stochastic and agentic monitoring for climate-related landslide risk.*

Status: research prototype (v1 target). Initial case: Manizales, Colombian coffee region (Andes).
This document is the **scientific ground truth** for ALLO. Any implementation (human or agent) MUST
conform to it. It defines what ALLO models, what it does *not*, and the invariants that must not be
violated. When in doubt, this file wins over code comments, README copy, or intuition.

---

## 1. Purpose and scope

ALLO estimates, with quantified uncertainty, the **probability that a hillslope unit exceeds critical
soil-saturation conditions** under observed and forecast rainfall, and translates that into calibrated,
auditable alert levels for decision support.

ALLO is **not** a deterministic landslide predictor. It does not claim to predict the exact time,
location, or occurrence of an individual landslide. It is a probabilistic, uncertainty-aware monitoring
and decision-support tool.

### In scope (v1)
- Rainfall-triggered shallow landslides on urbanized Andean hillslopes.
- A latent soil-saturation state with multi-week memory, forced by real rainfall.
- Terrain-conditioned hazard, propagated by Monte Carlo, mapped to alert levels.

### Out of scope (v1) — state explicitly in any talk/paper
- Seismically or volcanically triggered mass movements (Nevado del Ruiz activity excluded).
- Deep-seated landslides and debris-flow runout modeling.
- Sub-daily pinpoint prediction of a specific failure surface.

---

## 2. Risk decomposition

ALLO adopts the standard, defensible decomposition and is explicit about which factor it models:

```
Risk  =  Susceptibility(X_terrain)   ×   Hazard(S_t | rainfall)   ×   Exposure(V)
         [static, terrain]               [dynamic, STOCHASTIC]        [socio-environmental]
                                          <-- ALLO's core -->
```

ALLO rigorously models the **dynamic hazard** (rainfall-driven latent saturation `S_t`), conditions it
on **static susceptibility** (terrain covariates `X`), and communicates in terms of **exposure** (`V`).

---

## 3. State variable

- `S_t ∈ [0, 1]` — **latent** effective degree of soil saturation for a hillslope unit
  (0 = dry, 1 = fully saturated). It aggregates a complex soil-moisture profile into one scalar
  (declared simplification).
- **`S_t` is NOT directly observed.** The monitoring network measures rainfall and stream levels, not
  dense soil moisture. `S_t` is calibrated *indirectly* against the landslide inventory. This is a
  primary source of structural uncertainty and must be stated.
- `S_t` has **memory**: it is the continuous-time stochastic generalization of the operational **A25
  index** (25-day accumulated rainfall) used by Manizales' early-warning system. The relaxation rate is
  calibrated so effective memory ≈ 25 days.

**Persistence requirement:** `S_t` MUST persist between invocations (stored per site). A fresh
simulation MUST start from the site's last estimated `S_0`, never from a hardcoded constant. Re-initializing
the state on every call is a correctness bug, not a simplification.

---

## 4. Baseline stochastic model (v1 MVP — REQUIRED)

Rainfall-forced saturation SDE on `[0, 1]` with a Jacobi (Wright–Fisher) diffusion:

$$
dS_t = \Big[\, \kappa(X)\,\rho(R_t)\,(1-S_t) \;-\; \lambda(X)\,S_t \,\Big]\,dt
       \;+\; \sigma\,\sqrt{S_t(1-S_t)}\;dW_t
$$

| Term | Meaning |
|---|---|
| `κ(X)·ρ(R_t)·(1−S_t)` | **Wetting / infiltration.** Rainfall enters as an *input flux*, not as a shift of the reversion mean. `ρ(R_t)` is a saturating function of rainfall intensity. The `(1−S_t)` factor reduces intake as soil approaches saturation and guarantees `S ≤ 1`. `κ(X)` = infiltration rate (higher for permeable volcanic andosols). |
| `λ(X)·S_t` | **Drainage + evapotranspiration.** Relaxation toward dry. The `S_t` factor guarantees `S ≥ 0`. `λ(X)` increases with slope/TWI (well-drained steep slopes) and temperature (ET). |
| `σ·√(S_t(1−S_t))·dW_t` | **Jacobi diffusion.** Vanishes at both boundaries, so `S_t` stays in `[0,1]` **by construction — no clamping as a physical mechanism.** Stationary law is Beta. |

**Boundary non-attainment (Feller-type) conditions** to keep the process in the open interval:
`κ·ρ ≥ σ²/2` near `S=0` and `λ ≥ σ²/2` near `S=1`. Calibration MUST respect these or document violation.

### Rainfall → landslide probability (hazard link)

$$
h(S_t, X) = h_0(X)\,\exp\!\big(\beta\,(S_t - S_c(X))_+\big),
\qquad
P(\text{failure in } [t, t{+}\Delta]) = 1 - \exp\!\Big(-\!\int_t^{t+\Delta} h\, ds\Big)
$$

- `S_c(X)` = terrain-dependent **critical saturation**, lower for steeper slopes and weaker lithology
  (infinite-slope factor-of-safety intuition).
- `h_0, β, S_c` are **calibrated against the SIMMA/local inventory + rainfall record** (which rainfall
  episodes did / did not produce logged landslides). They are NOT free tuning knobs chosen for nice output.

### Alert mapping (anchored, not asserted)

Run Monte Carlo, obtain the exceedance probability of `S_c` over the horizon, map to bands, and
**cross-calibrate the bands against the operational A25 thresholds**:

| A25 (25-day accumulated rainfall) | Operational alert | ALLO band anchor |
|---|---|---|
| ≥ 200 mm | Yellow | LOW → MEDIUM boundary region |
| ≥ 300 mm | Orange | MEDIUM → HIGH |
| ≥ 400 mm | Red | HIGH → CRITICAL |

Alert thresholds on the Monte Carlo exceedance probability MUST be justified against these anchors and
the backtest (Section 7), never chosen arbitrarily.

---

## 5. Model tiers and data verdicts

| Tier | Model | Data required | Available? | Verdict |
|---|---|---|---|---|
| 0 | A25 deterministic threshold | Daily rainfall + thresholds | ✅ IDEA/SIMAC | Reimplement as **reference baseline** |
| 1 | **Jacobi rainfall-forced SDE + hazard** (Section 4) | Rainfall series + terrain + inventory (calibration) | ✅ IDEA + DEM/GEE + SIMMA | ✅ **v1 MVP** |
| 2 | Hybrid Neural SDE (physics skeleton + small neural residual / neural `κ,λ,S_c`) | Tier 1 data + richer covariates | ✅ (labels sparse, manageable) | ✅ **Paper target** |
| 3 | Spatial / multi-site Neural SDE (state per cell/microbasin, terrain embeddings, drainage-graph coupling) | Gridded rainfall + per-cell labels | ⚠️ per-cell labels insufficient | 🔶 **Scaffold only, do not promise** |
| — | Pure Neural SDE (fully learned drift + diffusion) | Observed state trajectories | ❌ state is latent | ❌ **Rejected for v1** |

### Hybrid Neural SDE (Tier 2, paper target)

$$
dS_t = \Big[\underbrace{\kappa\rho(R_t)(1-S_t) - \lambda S_t}_{\text{physical skeleton}}
       + \underbrace{f_\theta(S_t, R_t, X)}_{\text{small neural residual}}\Big] dt
       + \sigma\sqrt{S_t(1-S_t)}\, dW_t
$$

Inductive biases that MUST be preserved: monotonicity (more rain → more wetting), boundary behavior,
bounded/regularized residual. Trained by hazard likelihood on the inventory.

---

## 6. Assumptions (v1)

1. Effective saturation `S_t ∈ [0,1]` summarizes the hydrological state relevant to shallow stability.
2. Triggering is rainfall-dominated for the Manizales case.
3. Static susceptibility is constant over the forecast horizon (days).
4. The landslide inventory, though biased and incomplete, is informative enough for indirect calibration.

---

## 7. Calibration & validation (summary — see validation protocol)

- **Presence-only, biased, incomplete labels.** The inventory over-reports near roads/urban areas and
  has temporal gaps. Do NOT treat this as balanced classification; do NOT report naive accuracy.
- **Temporal split** (train on earlier years, test on recent) + **event-based backtesting** over rainfall
  episodes. No random splits (leakage).
- Report: precision/recall, PR-AUC, Brier score, calibration curves, lead time, false-alarm rate,
  missed-event rate, per-threshold alert evaluation, predictive-uncertainty coverage.
- Always compare against Tier 0 (A25) as the reference. Beating A25 is the minimum bar for a claim.

---

## 8. Limitations — state these explicitly (this is what earns credibility)

- `S_t` is **latent**; calibrated indirectly, not against soil-moisture sensors → structural uncertainty.
- Inventory is **presence-only and incomplete** → true false-negative rate is unknown.
- Spatial resolution limited by DEM (30 m) and station density.
- Satellite rainfall (CHIRPS/IMERG, ~5–11 km) is coarser than many individual hillslopes → used for
  *regional extension*, not for the fine Manizales case.
- ALLO estimates probability of exceeding critical saturation conditions per spatial unit; it does not
  predict the timing or exact location of an individual failure.

---

## 9. Invariants for implementers (human or agent) — DO NOT VIOLATE

1. Rainfall enters as **forcing (input flux)**, never as a shift of an equilibrium/mean level.
2. State `S_t` **persists** across invocations and starts from the real last estimate.
3. `S_t` stays in `[0,1]` **by the diffusion structure**, not by ad-hoc clamping as a physical mechanism
   (numeric `clip` only to absorb floating-point error).
4. Simulations are **seeded and reproducible**.
5. Alert thresholds are **calibrated/anchored** (A25 + backtest), never magic numbers.
6. The output probability has an explicit definition (exceedance of `S_c`); it is never an unlabeled
   fraction crossing an arbitrary constant.
7. Do not introduce data sources not listed in `DATA_SOURCES.md`. If a new source is needed, add it there
   first, with verified access.
8. Do not upgrade the model tier (e.g. add a Neural SDE) unless its data verdict in Section 5 is met.

---

## 10. Provenance

- Operational A25 index and 200/300/400 mm thresholds: IDEA-UNAL / SIMAC, Manizales early-warning system.
- Model formulation: co-designed against verified data availability (see `DATA_SOURCES.md`).
- This card supersedes prior "CIR soil-saturation" descriptions in legacy EcoAgent documentation.
