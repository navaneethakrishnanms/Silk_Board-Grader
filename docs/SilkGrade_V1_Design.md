# SilkGrade — V1 Total Design

**AI-Assisted Colour Fastness Grading (Before / After Wash) for Bangalore Silk Board**

| Item | Value |
| --- | --- |
| Document version | V1.0 |
| Date | 04 Nov 2026 |
| Prepared by | Arunprasath P |
| Client | Bangalore Silk Board (silk testing laboratory) |
| Status | Design complete — data collection pending |
| Platform | Android (offline-first) + Python research/training harness |

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Client Context and Requirement](#2-client-context-and-requirement)
3. [Domain Background — How Colour Fastness Is Tested Today](#3-domain-background--how-colour-fastness-is-tested-today)
4. [What We Grade — Complete List](#4-what-we-grade--complete-list)
5. [Grey Scales and Grade System](#5-grey-scales-and-grade-system)
6. [Observations From the Client's Sample Scans](#6-observations-from-the-clients-sample-scans)
7. [V1 Scope](#7-v1-scope)
8. [Requirements](#8-requirements)
9. [Core Design Decision](#9-core-design-decision)
10. [System Architecture](#10-system-architecture)
11. [Image Input Requirements](#11-image-input-requirements)
12. [Image Processing Pipeline](#12-image-processing-pipeline)
13. [Grading Engine](#13-grading-engine)
14. [Machine Learning Design](#14-machine-learning-design)
15. [Dataset Design](#15-dataset-design)
16. [Target Labels](#16-target-labels)
17. [Training Plan](#17-training-plan)
18. [Evaluation and Acceptance Criteria](#18-evaluation-and-acceptance-criteria)
19. [Tester (User) Flow](#19-tester-user-flow)
20. [App Screens](#20-app-screens)
21. [Data Model](#21-data-model)
22. [Technology Stack](#22-technology-stack)
23. [Repository Structure](#23-repository-structure)
24. [Report Format](#24-report-format)
25. [Optional Sync API (Post-V1)](#25-optional-sync-api-post-v1)
26. [Security, Audit and Traceability](#26-security-audit-and-traceability)
27. [Project Roadmap](#27-project-roadmap)
28. [Risks and Mitigations](#28-risks-and-mitigations)
29. [Open Questions for the Client](#29-open-questions-for-the-client)
30. [Assumptions](#30-assumptions)
31. [Glossary](#31-glossary)
32. [Version History](#32-version-history)

---

## 1. Project Summary

SilkGrade is an Android application that grades the **colour fastness of fabrics to washing** from photographs taken **before and after washing**. It gives the same 1–5 grey-scale grades that trained assessors give today, but in a repeatable, recorded and auditable way.

The app produces two kinds of grade:

- **Colour change** — how much the original (dyed or printed) fabric changed after washing.
- **Staining (bleeding)** — how much dye transferred onto the white adjacent fabric stitched to the specimen.

Both are reported on the standard **9-step grey scale**: 5, 4-5, 4, 3-4, 3, 2-3, 2, 1-2, 1.

**Core principle:** the photos are converted into accurate colour measurements (CIELAB). The grade is computed with the published ISO instrumental formulas (ISO 105-A05 for colour change, ISO 105-A04 for staining). A machine-learning layer, trained on the client's expert grades, corrects any systematic difference between the formula and the lab's assessors. Every grade is explainable, traceable and works fully offline.

---

## 2. Client Context and Requirement

### 2.1 Client

- Bangalore Silk Board — a silk testing laboratory.
- Today they grade washed silk samples **manually, by eye**, against physical grey-scale cards.

### 2.2 What the client asked for (latest)

1. Grade the cloth **before and after wash** on a **1 to 5** scale.
2. **The client will take the photos** — with a phone or any other device that captures correctly. Image quality is their responsibility.
3. Our scope is the **grading**: dataset design, labels, training, the model and the tester workflow in the app.
4. Data will be **collected later**; V1 is the complete design.

### 2.3 Current manual process

1. A dyed or printed silk specimen is cut.
2. White adjacent fabric(s) are stitched to the back of the specimen, forming a **composite**.
3. The composite is washed according to the test method.
4. The assessor compares:
   - the **white adjacent fabric** (washed vs unwashed) with the **Grey Scale for Staining**, giving the staining grade;
   - the **specimen** (original vs washed) with the **Grey Scale for Change in Colour**, giving the colour change grade.
5. Grades are written down manually.

### 2.4 Problems with the manual process

- Different assessors give different grades for the same sample.
- Grades depend on room lighting, viewing angle and fatigue.
- The physical grey-scale cards wear out; the client's cards are visibly damaged (see Section 6).
- There is no image record, so a disputed grade cannot be re-checked later.
- There are no batch-level statistics or trends.

---

## 3. Domain Background — How Colour Fastness Is Tested Today

| Concept | Meaning |
| --- | --- |
| Specimen | The original dyed or printed fabric being tested |
| Adjacent fabric | Undyed white fabric stitched to the specimen to catch bleeding dye |
| Composite | Specimen plus adjacent fabric(s) stitched together |
| Colour change | Difference between the original specimen and the washed specimen |
| Staining | Colour picked up by the white adjacent fabric during washing |
| Grey scale | Card of grey patch pairs, each pair representing one grade |
| Grade 5 | No change / no staining (best) |
| Grade 1 | Severe change / heavy staining (worst) |

### Relevant standards

| Standard | Purpose |
| --- | --- |
| ISO 105-A01 | General principles of colour fastness testing; adjacent fabric pairing |
| ISO 105-A02 | Grey Scale for assessing **change in colour** |
| ISO 105-A03 | Grey Scale for assessing **staining** |
| ISO 105-A04 | **Instrumental** assessment of staining (formula) |
| ISO 105-A05 | **Instrumental** assessment of change in colour (formula) |
| ISO 105-A11 | Determination of colour fastness grades by **digital imaging** |
| ISO 105-C10 | Colour fastness to washing with soap (common wash method) |

The lab's exact wash method and its Indian (IS) equivalents are to be confirmed (see Section 29).

---

## 4. What We Grade — Complete List

For **every composite** tested, SilkGrade outputs the following.

### 4.1 Grades

| # | Grade | Compared images | Scale | Method |
| --- | --- | --- | --- | --- |
| G1 | **Colour change — overall** | Original specimen vs washed specimen | Change in Colour (ISO 105-A02) | ISO 105-A05 + ML correction |
| G2 | **Colour change — ground colour** (printed fabrics) | Ground region before vs after | Change in Colour | ISO 105-A05 per region |
| G3 | **Colour change — each print colour** (printed fabrics) | Each motif colour before vs after | Change in Colour | ISO 105-A05 per region |
| G4 | **Colour change — worst colour** (printed fabrics) | Minimum of G2 and G3 | Change in Colour | Rule |
| G5 | **Staining — adjacent fabric 1** (e.g. silk) | Unwashed adjacent 1 vs washed adjacent 1 | Staining (ISO 105-A03) | ISO 105-A04 + ML correction |
| G6 | **Staining — adjacent fabric 2** (e.g. cotton) | Unwashed adjacent 2 vs washed adjacent 2 | Staining | ISO 105-A04 + ML correction |
| G7 | **Staining — worst adjacent** | Minimum of G5 and G6 | Staining | Rule |

For **plain (solid colour) fabrics**, G2–G4 collapse into G1.

For a composite with **one adjacent fabric**, G6 and G7 are not applicable.

### 4.2 Supporting outputs (shown with every grade)

| Output | Purpose |
| --- | --- |
| Continuous rating (e.g. 3.72) | Exact value before rounding to a half grade |
| Half-step grade (e.g. 3-4) | Official reported grade |
| Confidence / 95% interval | How certain the grade is |
| Decision: Auto-accept or Needs review | Routes uncertain results to an expert |
| Pass / Fail | Against the customer's minimum required grade |
| Staining heat-map | Shows where dye transferred (often near seams and edges) |
| Colour-change map | Shows which regions changed most |
| Colour measurements | ΔE, ΔL, ΔC, ΔH per region, for audit |
| Expert override (if any) | Assessor's grade and reason |

### 4.3 Grades from the overall colour shift (diagnostic, not official)

These are recorded to help the lab understand *how* the colour changed:

- **Lightness shift (ΔL):** lighter (fading) or darker.
- **Chroma shift (ΔC):** duller or brighter.
- **Hue shift (ΔH):** hue changed (e.g. bluer, greener).

---

## 5. Grey Scales and Grade System

### 5.1 The 9 grades

| Class index | Grade | Meaning |
| --- | --- | --- |
| 8 | 5 | No change / no staining |
| 7 | 4-5 | Negligible |
| 6 | 4 | Slight |
| 5 | 3-4 | Slight to noticeable |
| 4 | 3 | Noticeable |
| 3 | 2-3 | Noticeable to considerable |
| 2 | 2 | Considerable |
| 1 | 1-2 | Considerable to severe |
| 0 | 1 | Severe |

On the client's cards, half grades are printed as "4/5", "3/4", "2/3", "1/2".

### 5.2 Nominal colour difference of each grade step

These are the CIELAB colour differences each grey-scale pair represents. They are used as **reference values in the software** instead of photographing the physical card.

> **Verify every value against the purchased ISO standards before coding.**

| Grade | Change in Colour ΔE (ISO 105-A02) | Staining ΔE (ISO 105-A03) |
| --- | --- | --- |
| 5 | 0 | 0 |
| 4-5 | 0.8 | 2.2 |
| 4 | 1.7 | 4.3 |
| 3-4 | 2.5 | 6.0 |
| 3 | 3.4 | 8.5 |
| 2-3 | 4.8 | 12.0 |
| 2 | 6.8 | 16.9 |
| 1-2 | 9.6 | 24.0 |
| 1 | 13.6 | 34.1 |

The staining scale is about 2.5× wider than the change scale, which is why the two grades must never share one model or threshold table.

---

## 6. Observations From the Client's Sample Scans

The client shared three scans: one composite / fabric sheet and two grey-scale cards.

| # | Observation | Design consequence |
| --- | --- | --- |
| O1 | All three are **flatbed scans** on A4 (uniform light, white page, scanner edge marks). | The lab already has a repeatable capture device. The app must accept **scanner images** as well as phone photos. |
| O2 | The composite appears to be **three pieces**: a white lustrous (silk-like) strip, a plain light-blue strip, and a strip of the printed specimen. | Most likely **two adjacent fabrics** — silk and cotton (the usual pairing for silk) — with the light-blue strip being heavily stained cotton. **Grade each adjacent fabric separately** (G5, G6). |
| O3 | The specimen is a **printed fabric**: light cyan ground, dark teal flowers, green stems and leaves. | Colour change must be measured **per colour region**, on matched before/after regions (G2–G4). |
| O4 | The white silk adjacent fabric is **lustrous** (satin sheen). | Sheen highlights can read as "less stained". Glare must be detected and masked. |
| O5 | Both grey-scale cards are **worn**: chipped corners; the staining card has spots, smudges and a yellowed grade-1 patch. | The physical card is **not** used as the grading reference. Software uses the nominal ΔE values (Section 5.2). Recommend the client buys new cards for manual checks. |
| O6 | White areas in the scan look **clipped to pure white** (scanner auto-levels). | Faint staining (grades 4-5, 4) lives in the top few lightness units. The client must **disable auto-correction** on the scanner, otherwise staining is erased. |
| O7 | The colour change card is the darker card (ISO 105-A02); the white/grey card is the staining scale (ISO 105-A03). Both follow the 9-step layout split across two cards. | Confirms the 9-class label design. |
| O8 | Fabric edges are frayed and seams are visible. | Frayed borders and stitching must be excluded from measurement. |

---

## 7. V1 Scope

### 7.1 In scope

- Android app, fully offline.
- Import or capture of before-wash and after-wash images.
- Grades G1–G7 with supporting outputs.
- Plain and printed fabrics.
- One or two adjacent fabrics per composite.
- Expert review and override workflow.
- Local storage, history, PDF and CSV reports.
- Dataset collection mode (to build the training set).
- Python training and evaluation harness.

### 7.2 Out of scope for V1

- Cloud server and multi-lab sync (planned post-V1, Section 25).
- Multifibre adjacent strips (six-fibre strips) — V2.
- Light, rubbing or perspiration fastness tests — V2 (same engine can be reused).
- Formal accreditation (NABL / ISO 17025) — the lab's responsibility after validation.
- Building or certifying capture hardware — the client captures the images.

---

## 8. Requirements

### 8.1 Functional

| ID | Requirement |
| --- | --- |
| F1 | Create a test with sample ID, fabric details, wash method and required minimum grade. |
| F2 | Capture or import before-wash images of the specimen and each unwashed adjacent fabric. |
| F3 | Save the test as **Pending wash** until after-wash images are added. |
| F4 | Capture or import after-wash images of the specimen and each washed adjacent fabric. |
| F5 | Automatically detect the fabric region and exclude background, seams and frayed edges. |
| F6 | Let the tester adjust the detected region if needed. |
| F7 | Compute grades G1–G7 with continuous rating, half grade and confidence. |
| F8 | Mark each result **Auto-accepted** or **Needs review**. |
| F9 | Allow an expert to confirm or override any grade with a reason. |
| F10 | Show pass/fail against the required grade. |
| F11 | Generate and store a PDF report; export CSV. |
| F12 | Search history by sample, batch, customer, date. |
| F13 | **Dataset mode:** record expert grades blind (before seeing the app's grade) for training. |
| F14 | Export the dataset (images + labels + metadata) for training. |
| F15 | Load updated model files without reinstalling the app. |

### 8.2 Non-functional

| ID | Requirement |
| --- | --- |
| N1 | Works with **no internet** for all core features. |
| N2 | Grade computed in under 5 seconds on a mid-range Android phone. |
| N3 | Supports Android 10 and above. |
| N4 | Every grade traceable to its images, model version and user. |
| N5 | Audit log is append-only. |
| N6 | Images stored at full resolution; never re-compressed. |
| N7 | The same algorithm code runs on the phone and in the training harness. |

---

## 9. Core Design Decision

**Measure colour first, then grade. Do not train a black-box classifier directly on photos.**

| Option | Verdict | Reason |
| --- | --- | --- |
| A. CNN: photo → grade | Not for V1 | Needs thousands of labelled samples, cannot explain a disputed grade, breaks when device or lighting changes |
| B. ISO formula only | Baseline | Standard and explainable, but may differ slightly from this lab's assessors |
| **C. ISO formula + ML correction on colour features** | **Chosen** | Works with a few hundred samples, explainable, matches the lab's own experts |
| D. Siamese CNN on before/after pairs | V2 option | Only when thousands of samples exist |

---

## 10. System Architecture

### 10.1 Layered view

```
┌──────────────────────────────────────────────────────────────────┐
│                    ANDROID APP (offline)                         │
│                                                                  │
│  UI Layer (Jetpack Compose)                                      │
│   New Test · Before Wash · After Wash · Result · Review ·        │
│   History · Dataset Mode · Settings                              │
│                              │                                   │
│  Application Layer (ViewModels, Use cases)                       │
│   TestManager · GradingService · ReviewService · ReportService   │
│                              │                                   │
│  ┌───────────────── SilkGrade Engine (C++ / OpenCV, JNI) ──────┐ │
│  │ 1 Image intake & checks                                     │ │
│  │ 2 Colour conversion (sRGB/linear → XYZ D65 → CIELAB)        │ │
│  │ 3 Region detection & masking                                │ │
│  │ 4 Before/after registration                                 │ │
│  │ 5 Colour clustering (printed fabrics)                       │ │
│  │ 6 Feature extraction (ΔE, ΔL, ΔC, ΔH, percentiles)          │ │
│  │ 7 ISO formula grading (A04 / A05)                           │ │
│  │ 8 ML correction model (TFLite / ONNX / embedded weights)    │ │
│  │ 9 Uncertainty & decision                                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  Data Layer                                                      │
│   Room (SQLite) · Image store · Model store · PDF/CSV export     │
└──────────────────────────────────────────────────────────────────┘
                               │ (export, USB / later Wi-Fi sync)
┌──────────────────────────────────────────────────────────────────┐
│            RESEARCH & TRAINING HARNESS (Python, laptop)          │
│  Same C++ engine via Python bindings · Dataset loader ·          │
│  Feature builder · Model training · Evaluation reports ·         │
│  Model export (versioned) → copied into the app                  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.2 Grading data flow

```
Before images ─┐
               ├─► Checks ─► CIELAB ─► Regions ─► Register ─► Clusters
After images ──┘                                                 │
                                                                 ▼
                                   Features (ΔE, ΔL, ΔC, ΔH, p50, p90)
                                                                 │
                                       ┌─────────────────────────┤
                                       ▼                         ▼
                              ISO formula rating        ML correction model
                                       └──────────┬──────────────┘
                                                  ▼
                                Final rating + confidence interval
                                                  ▼
                           Round to half grade · Pass/Fail · Auto/Review
                                                  ▼
                              Store · Report · Expert review (if needed)
```

### 10.3 Key architecture decision

The grading engine is **one C++ library** used by both the Android app (via JNI) and the Python harness (via bindings). Training, testing and production therefore run exactly the same maths.

---

## 11. Image Input Requirements

The client is responsible for capture quality. To grade correctly, the images must still meet these conditions (shared with the client as a capture guideline).

| # | Requirement | Why |
| --- | --- | --- |
| C1 | Before and after images taken with the **same device** | Different cameras render colour differently |
| C2 | Same **lighting** for before and after (ideally D65 viewing booth) | A lighting change looks like a colour change |
| C3 | **Auto-enhancement, HDR, beauty and filters OFF**; scanner auto-levels OFF | Processing alters colour and clips whites |
| C4 | No clipped whites on the white adjacent fabric | Faint staining is lost when whites clip |
| C5 | Fabric flat, no folds, no shadows | Folds change measured colour |
| C6 | Neutral grey or black background | Easier segmentation; white background confuses white fabric |
| C7 | Recommended: a small **colour reference card** in every image | Lets the app correct small lighting and device differences |
| C8 | Recommended: an **unwashed piece of each adjacent fabric** imaged with the after-wash set | The staining baseline |
| C9 | Resolution: at least 3 MP of fabric area; format JPEG (max quality), PNG, TIFF or DNG | Enough pixels to average texture |
| C10 | One image per piece, or all pieces in one image with clear gaps | Both supported |

The app **warns** (does not block) when it detects clipping, strong glare, blur or a missing reference card, and stores the warning with the grade.

---

## 12. Image Processing Pipeline

| Step | Name | What happens |
| --- | --- | --- |
| P1 | Intake | Load image, read EXIF (device, exposure), keep original untouched |
| P2 | Checks | Blur (variance of Laplacian), clipped pixels, glare blobs, size; record warnings |
| P3 | Colour normalisation | If reference card present: fit correction matrix from card patches to their known values. Otherwise: use device/session profile |
| P4 | Colour conversion | sRGB (or linear RAW) → CIE XYZ (D65, 10° observer) → CIELAB |
| P5 | Fabric segmentation | Separate fabric from background (Lab threshold + morphology); optional ML segmentation model later |
| P6 | Clean-up masks | Erode 3–5 mm from edges (frayed threads); detect and mask seams/stitching; mask glare pixels |
| P7 | Piece identification | Label each region: specimen, adjacent 1, adjacent 2; confirmed by tester once |
| P8 | Registration | Align washed specimen to original (ORB/AKAZE features + RANSAC homography); fallback: tester taps two matching points |
| P9 | Texture smoothing | Gaussian blur at yarn scale (~1 mm) so weave and print dots do not dominate |
| P10 | Colour clustering (prints) | k-means on original specimen in CIELAB; k chosen by silhouette (typically 2–4): ground + motif colours; masks applied to washed image |
| P11 | Feature extraction | Per region / cluster: median L\*, a\*, b\*; ΔE\*ab, ΔE00, ΔL, ΔC, ΔH; 10th/50th/90th percentile differences; area share; uniformity |

---

## 13. Grading Engine

> The formula constants below are written from memory of ISO 105-A04 / A05. **Check each constant against the purchased standards before implementation.**

### 13.1 Staining (G5, G6) — ISO 105-A04

Compare the **washed adjacent fabric** with the **unwashed piece of the same fabric**.

1. Compute ΔE\*ab and ΔL\* between the two.
2. Grey-scale colour difference:

```
ΔE_GS = ΔE*ab − 0.4 × sqrt( (ΔE*ab)² − (ΔL*)² )
```

3. Staining rating:

```
SSR = 6.1 − 1.45 × ln(ΔE_GS)
if SSR > 4:  SSR = 5 − 0.23 × ΔE_GS
```

4. Clip to the range 1–5.

Sanity check: ΔE_GS = 4.3 gives ≈ 4.0; ΔE_GS = 34.1 gives ≈ 1.0 — matching the staining grey scale.

**Which pixels:** staining is often uneven (heavier near seams and edges). Compute the rating on:
- the **median** difference of the valid region, and
- the **90th percentile** (most stained representative area).

The official statistic is chosen by the lab (Question Q5). Default: 90th percentile, matching common assessor practice of grading the most stained area.

### 13.2 Colour change (G1–G4) — ISO 105-A05

Compare the **washed specimen** with the **original specimen** on matched regions.

1. Compute the ISO 105-A05 colour difference ΔE_F (a weighted CIELAB difference defined in the standard).
2. Colour change rating:

```
if ΔE_F ≤ 3.4:  GS_C = 5 − ΔE_F / 1.7
if ΔE_F > 3.4:  GS_C = 5 − log(ΔE_F / 0.85) / log(2)
```

3. Clip to 1–5.

Sanity check: ΔE_F = 3.4 gives 3; ΔE_F = 13.6 gives 1 — matching the change grey scale.

**Printed fabrics:**
- G2 = rating for the ground cluster.
- G3 = rating for each motif cluster.
- G4 = worst of G2, G3.
- G1 = area-weighted rating, or worst colour (lab's choice, Question Q5).

### 13.3 ML correction

The formula gives a continuous rating. A small model trained on the lab's expert grades adjusts it (Section 14).

### 13.4 Rounding

```
half_grade = round(rating × 2) / 2     → 1.0, 1.5, … 5.0
display    = "4-5" for 4.5, "3-4" for 3.5, etc.
```

### 13.5 Uncertainty and decision

1. **Bootstrap:** recompute the rating on 200 random sub-patches of the region → distribution of ratings.
2. Add model uncertainty (from the correction model's validation error).
3. Add an image-quality penalty if warnings were raised in P2.
4. **95% interval** from the combined spread.

| Condition | Decision |
| --- | --- |
| Interval stays within one half-grade bin, no warnings | **Auto-accept** |
| Interval crosses a half-grade boundary | **Needs review** |
| Any image warning | **Needs review** |
| Result is within half a grade of the customer's minimum | **Needs review** |
| Fabric type never seen in training | **Needs review** |

### 13.6 Pass / Fail

```
PASS if final_grade ≥ required_minimum_grade (per grade type)
```

The required grade is set per test or per customer (e.g. staining ≥ 3-4, change ≥ 4).

---

## 14. Machine Learning Design

### 14.1 Models in V1

| Model | Task | Input | Output | Type | Needed when |
| --- | --- | --- | --- | --- | --- |
| M1 | Colour change correction | Colour-change features + ISO rating | Grade (9 ordinal classes) | Ordinal logistic regression or LightGBM (ordinal) | V1 |
| M2 | Staining correction | Staining features + ISO rating | Grade (9 ordinal classes) | Ordinal logistic regression or LightGBM (ordinal) | V1 |
| M3 | Fabric segmentation | Image | Mask: background / fabric / seam / fray | Lightweight U-Net or DeepLabV3+ (MobileNetV3), INT8 TFLite, ~3–6 MB | Only if classical masking fails in testing |
| M4 | Glare / defect detector | Image patch | OK / glare / fold / shadow | Small CNN | Only if rule-based checks fail |

### 14.2 V2 model (when data is large)

| Model | Task | Architecture |
| --- | --- | --- |
| M5 | End-to-end before/after grading | Siamese CNN (shared EfficientNet-B0 / MobileNetV3 backbone) → difference of embeddings + ISO features → ordinal head (CORAL), 2 heads (change, staining) |

Use M5 only if it beats M1/M2 on the same frozen test set **and** needs at least ~3,000 labelled composites.

### 14.3 Why features + small model for V1

- Works with 400–600 samples.
- Each feature has a physical meaning, so every grade can be explained.
- Robust to device changes once colour is normalised.
- Fast and tiny on the phone.

---

## 15. Dataset Design

### 15.1 Unit of data

One **record = one tested composite** (one sample through one wash).

### 15.2 Images per record

| File | Content | Required |
| --- | --- | --- |
| `specimen_before.*` | Original specimen, before wash | Yes |
| `specimen_after.*` | Washed specimen | Yes |
| `adj1_before.*` | Unwashed adjacent fabric 1 (e.g. silk) | Yes |
| `adj1_after.*` | Washed adjacent fabric 1 | Yes |
| `adj2_before.*` | Unwashed adjacent fabric 2 (e.g. cotton) | If used |
| `adj2_after.*` | Washed adjacent fabric 2 | If used |
| `ref_card_before.*` / `ref_card_after.*` | Colour reference card (or inside the above images) | Recommended |
| `composite_after.*` | Whole composite after wash, as stitched | Optional (context) |

### 15.3 Labels per record

| Label | Values | Given by |
| --- | --- | --- |
| `grade_change_overall` | 1, 1-2, 2, 2-3, 3, 3-4, 4, 4-5, 5 | Expert consensus |
| `grade_change_ground` | same | Expert (printed fabrics) |
| `grade_change_worst` | same | Expert (printed fabrics) |
| `grade_stain_adj1` | same | Expert consensus |
| `grade_stain_adj2` | same | Expert consensus (if used) |
| `assessor_A_*`, `assessor_B_*` | same | Each assessor separately |
| `consensus_method` | agreed / third_assessor | System |

### 15.4 Metadata per record

| Field | Example |
| --- | --- |
| `sample_id` | BSB-2026-00123 |
| `batch_id` | B-1107 |
| `customer` | (optional) |
| `fibre` | mulberry silk |
| `construction` | satin / crepe / georgette / plain weave |
| `fabric_type` | plain or printed |
| `base_shade` | light / medium / dark |
| `dominant_hue` | blue |
| `dye_class` | acid / reactive / unknown |
| `wash_method` | ISO 105-C10 A |
| `wash_temp_c` / `wash_time_min` | 40 / 30 |
| `adj1_fibre` / `adj2_fibre` | silk / cotton |
| `capture_device` | phone model or scanner model |
| `capture_date_before` / `capture_date_after` | ISO dates |
| `ref_card_present` | true/false |
| `assessor_ids` | A, B, (C) |

### 15.5 Folder structure

```
dataset/
├── metadata.csv                 # one row per record (all labels + metadata)
├── splits.csv                   # record_id → train / val / test
├── reference_cards.json         # known values of the colour reference card
└── records/
    └── BSB-2026-00123/
        ├── specimen_before.jpg
        ├── specimen_after.jpg
        ├── adj1_before.jpg
        ├── adj1_after.jpg
        ├── adj2_before.jpg
        ├── adj2_after.jpg
        ├── masks/               # optional manual masks (for M3)
        └── record.json          # same data as the metadata row
```

### 15.6 How much data

| Target | Amount |
| --- | --- |
| Minimum to start V1 | **400–600 composites** |
| Per grade | **≥ 40 examples of each of the 9 grades**, for each grade type |
| Plain vs printed | At least 30% printed |
| Shades | Light, medium and dark all represented |
| Constructions | Every construction the lab tests regularly |
| Devices | Every device that will be used in production |
| Repeat captures | 30 composites photographed 5 times each (repeatability set) |
| Historical quick start | 50 old composites with recorded grades, for an early feasibility check |

Low grades (1, 1-2, 2) are rare in routine testing. **Collect them deliberately** — e.g. known poor-fastness fabrics or harsher washes — otherwise the model never learns them.

### 15.7 Labelling protocol

1. Two trained assessors grade each composite **independently** under the standard viewing conditions, without seeing each other's grade or the app's grade.
2. If they agree → that is the label.
3. If they differ by half a grade → a third assessor decides.
4. If they differ by more → re-examine; record the disagreement.
5. Store all individual grades (used to measure human agreement as the benchmark).

### 15.8 Data quality rules

- Never mix two composites in one record.
- Never label from the photo — label from the physical fabric.
- Keep the original images; never edit them.
- One device change mid-collection = record it in metadata.

---

## 16. Target Labels

### 16.1 Encoding

| Grade | 1 | 1-2 | 2 | 2-3 | 3 | 3-4 | 4 | 4-5 | 5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Numeric | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 4.5 | 5.0 |
| Class index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |

### 16.2 Label type

- **Ordinal** — grades have order; an error of half a grade is much smaller than an error of three grades.
- Not plain multi-class classification.

### 16.3 Separate targets

| Target | Model |
| --- | --- |
| `grade_change_*` | M1 (colour change) |
| `grade_stain_*` | M2 (staining) — one model shared by adj1 and adj2, with adjacent fibre as an input feature |

---

## 17. Training Plan

### 17.1 Features (input to M1 and M2)

| Group | Features |
| --- | --- |
| ISO baseline | ISO rating (A05 or A04), ΔE_F or ΔE_GS |
| Colour differences | ΔE\*ab, ΔE00, ΔL\*, ΔC\*, ΔH\* |
| Distribution | p10, p50, p90 of per-pixel ΔE; standard deviation; share of pixels above thresholds |
| Base colour | L\*, a\*, b\*, C\*, h of the original (or unwashed adjacent) |
| Printed | number of clusters; area share; ratings per cluster; worst-cluster rating |
| Fabric | construction, fibre, adjacent fibre (one-hot) |
| Quality | warning flags, reference-card fit residual |

### 17.2 Models and loss

| Model | Algorithm | Loss / objective |
| --- | --- | --- |
| Baseline 0 | ISO formula only, rounded | none (no training) |
| M1 / M2 v1 | Ordinal logistic regression (proportional odds) | Ordinal log-likelihood |
| M1 / M2 v2 | LightGBM with ordinal target (regression + rounding, or cumulative binary) | MAE on numeric grade / cumulative logistic |
| M5 (V2) | Siamese CNN + CORAL head | CORAL ordinal loss |

Pick the simplest model that beats the ISO baseline on validation.

### 17.3 Data split

| Split | Share | Use |
| --- | --- | --- |
| Train | 70% | Fit the model |
| Validation | 15% | Choose model, tune thresholds |
| Test (frozen) | 15% (≥ 150 composites as data grows) | Final report only — opened once |

- **Split by composite (and by batch where possible), never by image.**
- Stratify by grade so every split contains every grade.
- 5-fold cross-validation inside Train + Validation while the dataset is small.

### 17.4 Training steps

1. Load `metadata.csv` and images.
2. Run the C++ engine (Python bindings) → features per record.
3. Compute the ISO baseline; evaluate on validation.
4. Train M1 and M2; compare with the baseline.
5. Calibrate confidence (does a "95% interval" really contain the expert grade 95% of the time?).
6. Set review thresholds to hit the target review rate.
7. Freeze: model files + engine version + thresholds.
8. Evaluate **once** on the test set; write the evaluation report.
9. Export models (versioned, e.g. `m1_change_v1.0.onnx`, `m2_stain_v1.0.onnx` or JSON coefficients) into the app.

### 17.5 Continuous improvement

- Every expert override in the app becomes a new labelled record.
- Retrain periodically (e.g. every 200 new records).
- A new model ships only if it beats the current one on the frozen test set.
- The model version is stored with every grade.

---

## 18. Evaluation and Acceptance Criteria

### 18.1 Metrics

| Metric | Meaning |
| --- | --- |
| Exact agreement | Predicted half grade = expert grade |
| Within ±0.5 | Predicted within one half step |
| Quadratic weighted kappa | Agreement that respects grade order |
| MAE (grade units) | Average error |
| Pass/fail agreement | Same pass/fail decision as experts |
| Review rate | Share of results sent to an expert |
| Repeatability | Same grade across repeated photos of one composite |
| Human benchmark | Assessor A vs Assessor B on the same metrics |

Report **colour change and staining separately**, and broken down by plain/printed, shade and construction.

### 18.2 Proposed acceptance criteria (agree with the client before data is collected)

| Criterion | Target |
| --- | --- |
| Within ±0.5 grade of consensus (auto-accepted results) | ≥ 95% |
| Weighted kappa, app vs consensus | ≥ assessor A vs assessor B kappa |
| Pass/fail agreement | ≥ 98% |
| Repeatability (same half grade across repeat photos) | ≥ 95% |
| Review rate | ≤ 20% |
| Traceability | 100% of grades linked to images, model version and user |

### 18.3 Go-live rule

- Phase 1: **shadow mode** — experts grade manually; the app grades in parallel; nobody sees the app grade before giving their own.
- Phase 2: **assisted grading** — app grades, experts review "Needs review" results and spot-check 10% of auto-accepted results.
- Phase 3: **primary grading** — only after acceptance criteria hold on fresh data for an agreed period.

---

## 19. Tester (User) Flow

### 19.1 Roles

| Role | Can do |
| --- | --- |
| Tester | Create tests, capture images, view grades |
| Expert assessor | Everything a tester can + review/override grades, dataset labelling |
| Admin | Users, required grades, model updates, exports |

### 19.2 Main flow

```
[Login]
   │
[1. New Test] ── sample ID (scan/type), fabric details, wash method,
   │             number of adjacent fabrics, required grade
   │
[2. Before Wash] ── photo/import: specimen, adjacent fabric(s) unwashed
   │                app checks images, detects regions → tester confirms
   │
   ├── Test saved as "PENDING WASH"
   │
   │   ...... composite is washed in the lab ......
   │
[3. After Wash] ── open pending test → photo/import: washed specimen,
   │               washed adjacent fabric(s)
   │               app checks images, detects & aligns regions → tester confirms
   │
[4. Grading] ── engine runs (< 5 s, offline)
   │
[5. Result]
   │   Colour change ......... 4-5   (ground 4-5, worst print colour 4)
   │   Staining – silk ....... 4
   │   Staining – cotton ..... 3-4
   │   Confidence ............ High / Medium / Low
   │   Pass / Fail ........... PASS (required: 3-4)
   │   Decision .............. AUTO-ACCEPTED or NEEDS REVIEW
   │   Heat-maps (staining, colour change)
   │
   ├── AUTO-ACCEPTED ──► [7. Report]
   │
   └── NEEDS REVIEW ──► [6. Expert Review]
                           expert sees images + app grade,
                           accepts or overrides (grade + reason)
                           ──► override saved as new training data
                           ──► [7. Report]

[7. Report] ── PDF saved offline · CSV export · test status = COMPLETED
```

### 19.3 Dataset mode flow (for building the training set)

```
Same as main flow, but at step 5:
   → app grade is HIDDEN
   → Assessor A enters grades → Assessor B enters grades (blind)
   → if they differ → Assessor C decides
   → app grade revealed only after labels are locked
   → record exported to the dataset
```

### 19.4 Test statuses

| Status | Meaning |
| --- | --- |
| DRAFT | Created, no images |
| PENDING_WASH | Before images saved |
| READY_TO_GRADE | After images saved |
| GRADED_AUTO | Auto-accepted |
| NEEDS_REVIEW | Waiting for expert |
| COMPLETED | Final grade locked, report generated |
| VOID | Cancelled (kept for audit) |

---

## 20. App Screens

| # | Screen | Contents |
| --- | --- | --- |
| S1 | Login | User + PIN (offline) |
| S2 | Home / Dashboard | Pending wash list, needs-review count, today's tests, quick "New Test" |
| S3 | New Test | Sample ID (QR scan), fabric details, wash method, adjacent fabrics (1 or 2 + fibre), required grades |
| S4 | Before Wash Capture | Camera or import; slots: specimen, adjacent 1, adjacent 2; image warnings |
| S5 | Region Confirm | Detected regions drawn on image; drag to adjust; label pieces |
| S6 | After Wash Capture | Same as S4 for washed pieces |
| S7 | Alignment Confirm | Before/after overlay; tap two points if auto-alignment fails |
| S8 | Result | All grades G1–G7, confidence, pass/fail, auto/review badge, heat-maps, measurements (expandable) |
| S9 | Review Queue | List of NEEDS_REVIEW tests |
| S10 | Review Detail | Side-by-side images, app grade, enter expert grade + reason |
| S11 | History | Search/filter by sample, batch, customer, date, status |
| S12 | Report Viewer | PDF preview, share/export |
| S13 | Dataset Mode | Blind labelling flow, export dataset |
| S14 | Settings | Devices, reference card values, required grade presets, model version, users |

---

## 21. Data Model

### 21.1 Entities (Room / SQLite)

```sql
User(
  user_id TEXT PK, name TEXT, role TEXT,          -- tester | expert | admin
  pin_hash TEXT, active INTEGER, created_at TEXT )

Sample(
  sample_id TEXT PK, batch_id TEXT, customer TEXT,
  fibre TEXT, construction TEXT, fabric_type TEXT, -- plain | printed
  base_shade TEXT, dominant_hue TEXT, dye_class TEXT, notes TEXT )

Test(
  test_id TEXT PK, sample_id TEXT FK, wash_method TEXT,
  wash_temp_c REAL, wash_time_min REAL,
  adj_count INTEGER, adj1_fibre TEXT, adj2_fibre TEXT,
  req_grade_change REAL, req_grade_stain REAL,
  status TEXT, dataset_mode INTEGER,
  created_by TEXT FK, created_at TEXT, completed_at TEXT )

Image(
  image_id TEXT PK, test_id TEXT FK,
  role TEXT,      -- specimen_before | specimen_after | adj1_before | adj1_after
                  -- adj2_before | adj2_after | ref_card | composite
  file_path TEXT, sha256 TEXT, device TEXT, width INTEGER, height INTEGER,
  warnings TEXT,  -- JSON: blur, clipping, glare, no_ref_card
  captured_at TEXT )

Region(
  region_id TEXT PK, image_id TEXT FK,
  piece TEXT,     -- specimen | adj1 | adj2
  cluster TEXT,   -- all | ground | motif_1 | motif_2 ...
  mask_path TEXT, area_share REAL,
  L REAL, a REAL, b REAL, edited_by_user INTEGER )

Grade(
  grade_id TEXT PK, test_id TEXT FK,
  kind TEXT,      -- change_overall | change_ground | change_motif_n
                  -- change_worst | stain_adj1 | stain_adj2 | stain_worst
  iso_rating REAL, model_rating REAL, final_rating REAL,
  half_grade REAL, ci_low REAL, ci_high REAL,
  decision TEXT,  -- auto | review
  pass INTEGER,
  features TEXT,  -- JSON: dE, dL, dC, dH, p10, p50, p90 ...
  engine_version TEXT, model_version TEXT, created_at TEXT )

ExpertGrade(
  expert_grade_id TEXT PK, grade_id TEXT FK, user_id TEXT FK,
  half_grade REAL, reason TEXT, blind INTEGER, created_at TEXT )

ModelRegistry(
  model_id TEXT PK, name TEXT, version TEXT, file_path TEXT,
  sha256 TEXT, metrics TEXT, active INTEGER, installed_at TEXT )

AuditLog(
  log_id INTEGER PK AUTOINCREMENT, user_id TEXT, action TEXT,
  entity TEXT, entity_id TEXT, details TEXT, created_at TEXT )
```

### 21.2 Relationships

```
Sample 1──* Test 1──* Image 1──* Region
              │
              └──* Grade 1──* ExpertGrade
User ──< Test, ExpertGrade, AuditLog
ModelRegistry ──< Grade (by model_version)
```

---

## 22. Technology Stack

| Layer | Technology |
| --- | --- |
| Language (app) | Kotlin |
| UI | Jetpack Compose, Material 3 |
| Architecture | MVVM, Clean architecture (UI / domain / data), Hilt DI |
| Camera | CameraX (+ Camera2 interop for manual settings, RAW where supported) |
| Import | Android Storage Access Framework (scanner images, gallery, USB) |
| Image engine | C++17, OpenCV 4.x (Android SDK / NDK), JNI bridge |
| Colour maths | Own C++ module: sRGB/linear → XYZ → CIELAB, ΔE\*ab, ΔE00, ISO 105-A04/A05 |
| ML runtime | ONNX Runtime Mobile or TFLite/LiteRT (M3–M5); M1/M2 can run as embedded coefficients / tree JSON |
| Database | Room (SQLite); SQLCipher if encryption is required |
| Background work | Kotlin coroutines, WorkManager |
| Reports | Android PdfDocument; CSV writer |
| QR / barcode | ML Kit Barcode Scanning (on-device) |
| Training harness | Python 3.11, pybind11 bindings to the C++ engine, NumPy, pandas, scikit-learn, LightGBM, mord (ordinal), PyTorch (V2), Jupyter |
| Experiment tracking | MLflow (local) or a simple versioned results folder |
| Version control | Git + GitHub |
| Testing | JUnit, Compose UI tests, GoogleTest (C++), pytest |
| Post-V1 server | Node.js + Express (or FastAPI) + PostgreSQL |

---

## 23. Repository Structure

```
silkgrade/
├── README.md
├── docs/
│   ├── SilkGrade_V1_Design.md
│   ├── capture_guideline_for_client.md
│   └── evaluation_reports/
├── engine/                        # shared C++ grading engine
│   ├── include/silkgrade/
│   ├── src/
│   │   ├── intake.cpp             # P1–P2
│   │   ├── colour.cpp             # P3–P4, ΔE, ISO formulas
│   │   ├── segment.cpp            # P5–P7
│   │   ├── register.cpp           # P8
│   │   ├── cluster.cpp            # P10
│   │   ├── features.cpp           # P11
│   │   ├── grade.cpp              # 13.x
│   │   └── uncertainty.cpp
│   ├── tests/                     # GoogleTest, incl. grey-scale sanity tests
│   └── CMakeLists.txt
├── android/
│   ├── app/
│   │   ├── src/main/java/.../ui/
│   │   ├── src/main/java/.../domain/
│   │   ├── src/main/java/.../data/
│   │   ├── src/main/cpp/          # JNI bridge → engine
│   │   └── src/main/assets/models/
│   └── build.gradle.kts
├── research/
│   ├── silkgrade_py/              # pybind11 bindings
│   ├── notebooks/
│   ├── train.py
│   ├── evaluate.py
│   ├── export_model.py
│   └── configs/
└── dataset/                       # not committed; see Section 15.5
```

---

## 24. Report Format

Each completed test produces a one- or two-page PDF.

| Section | Contents |
| --- | --- |
| Header | Lab name, report number, date, app version |
| Sample | Sample ID, batch, customer, fibre, construction, plain/printed |
| Test | Wash method, temperature, time, adjacent fabrics |
| Images | Before/after thumbnails of specimen and each adjacent fabric |
| Grades | Table of G1–G7: grade, required grade, pass/fail |
| Decision | Auto-accepted / reviewed by (name), override reason if any |
| Measurements | ΔE, ΔL, ΔC, ΔH per region (appendix) |
| Heat-maps | Staining and colour-change maps |
| Traceability | Engine version, model version, image hashes, tester, timestamps |
| Note | "Instrument-assisted grading" until the lab completes formal validation |

---

## 25. Optional Sync API (Post-V1)

Not required for V1 (fully offline). When Wi-Fi is available later:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/tests` | Upload completed test + grades |
| POST | `/api/tests/{id}/images` | Upload images |
| GET | `/api/models/latest` | Download newest approved model |
| GET | `/api/samples?batch=` | Batch lookup |
| GET | `/api/stats` | Lab-level statistics |

Sync is one-way upload for records plus model download; the phone remains the source of truth for each test.

---

## 26. Security, Audit and Traceability

- Offline login with PIN per user; roles enforced in the app.
- Original images stored with SHA-256 hash; any change is detectable.
- Grades are never edited — an override creates a new ExpertGrade record.
- Every action (create, capture, grade, override, export, model update) written to the append-only AuditLog.
- Model files verified by hash before activation.
- Optional database encryption (SQLCipher).
- Each grade stores engine version and model version, so any result can be recomputed.

---

## 27. Project Roadmap

| Phase | Weeks | Work | Gate at end |
| --- | --- | --- | --- |
| 0. Discovery | 1–2 | Client answers open questions; capture guideline agreed; 50 historical composites collected | Requirements signed off |
| 1. Engine v0 | 3–5 | C++ engine: colour conversion, segmentation, ISO A04/A05, features; Python bindings; feasibility test on 50 historical composites | ISO baseline produces sensible grades |
| 2. App MVP + data collection | 6–9 | Android app: test flow, capture/import, result, review, dataset mode, storage, PDF; start blind data collection | App usable by lab; collection running |
| 3. Training & tuning | 10–13 | Data collection continues to 400–600 composites; train M1/M2; tune review thresholds; build M3 only if needed | Algorithm and thresholds frozen |
| 4. Blind test & decision | 14–16 | Evaluate on frozen test set; acceptance report | Acceptance criteria met → assisted grading go-live |
| 5. Assisted grading | 17+ | Live use with expert review + 10% spot-checks; retraining from overrides | Agreed period stable → primary grading |

If the test fails at phase 4: fix, re-freeze, and test on **fresh** composites — never re-use the old test set.

---

## 28. Risks and Mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Before and after photos taken under different light or device | Capture guideline (Section 11); reference card; device recorded per image; review flag when devices differ |
| R2 | Phone/scanner auto-processing alters colour or clips whites | Guideline to disable it; clipping detection |
| R3 | Silk sheen reads as lighter / less stained | Glare masking; percentile statistics; review flag |
| R4 | Faint staining (4-5) close to image noise | Large measurement area; repeat-capture checks; review near 4-5/5 boundary |
| R5 | Printed specimens mis-aligned before/after | Feature registration + boundary erosion + tester confirmation |
| R6 | Too few low-grade samples | Deliberate collection of poor-fastness fabrics |
| R7 | Assessors disagree among themselves | Measure it; use consensus labels; use human agreement as the benchmark |
| R8 | Worn grey-scale cards bias the expert labels | Recommend new cards before labelling starts |
| R9 | ISO formula constants mis-remembered | Verify against purchased standards; unit tests on grey-scale values |
| R10 | Model overfits small dataset | Simple models; cross-validation; frozen test set |
| R11 | Device replaced in production | Re-run repeatability set on the new device before use |
| R12 | Accreditation not automatic | Report labelled "instrument-assisted" until the lab validates the method |

---

## 29. Open Questions for the Client

| # | Question |
| --- | --- |
| Q1 | Exact organisation and lab name (Central Silk Board lab, CSTRI, or state silk body)? |
| Q2 | Which wash methods are used (ISO 105-C10 A–E, IS equivalents, customer methods)? |
| Q3 | Which adjacent fabrics — silk + cotton single-fibre, or a multifibre strip? Is an unwashed piece kept for each test? |
| Q4 | Daily and peak sample volume? Number of assessors? |
| Q5 | Official rule for uneven staining (most stained area or average) and for prints (worst colour or area-dominant)? |
| Q6 | Which capture devices will be used (phone model / scanner model)? Can auto-correction be switched off? |
| Q7 | Can a colour reference card be placed in every image? |
| Q8 | Required minimum grades per customer / product? |
| Q9 | Is a spectrophotometer available on site or at CSTRI for cross-checks? |
| Q10 | Do results need to connect to an existing LIMS / ERP later? |
| Q11 | Can we get 50 historical composites with recorded grades now? |
| Q12 | Who signs off acceptance criteria and the go-live decision? |

---

## 30. Assumptions

1. The client captures images of sufficient quality and follows the capture guideline.
2. Before and after images of a test are captured on the same device under the same lighting.
3. An unwashed piece of each adjacent fabric is available for every test.
4. Trained assessors are available to label 400–600 composites blind.
5. The grading scale is the 9-step ISO grey scale (1 to 5 with half grades).
6. V1 runs on Android only, fully offline.
7. The "20–100 samples per day" figure is unconfirmed (Q4).

---

## 31. Glossary

| Term | Meaning |
| --- | --- |
| CIELAB (L\*, a\*, b\*) | Colour space approximating human perception: L\* lightness, a\* green–red, b\* blue–yellow |
| ΔE\*ab | Straight-line colour difference in CIELAB |
| ΔE00 | CIEDE2000, a more perceptual colour difference |
| ΔL, ΔC, ΔH | Differences in lightness, chroma (saturation) and hue |
| D65 | Standard daylight illuminant used for colour assessment |
| Ordinal label | Category with a natural order (grades 1 < … < 5) |
| CORAL | Ordinal regression loss for neural networks |
| Siamese network | Two identical networks sharing weights, comparing two inputs |
| Shadow mode | App grades in parallel without influencing human grades |
| Composite | Specimen with adjacent fabrics stitched together |
| Weighted kappa | Agreement measure for ordered categories |

---

## 32. Version History

| Version | Date | Changes |
| --- | --- | --- |
| V1.0 | 04 Nov 2026 | First complete design: problem analysis, sample-scan observations, grades G1–G7, ISO-based grading engine, ML correction models, dataset and label design, training and evaluation plan, tester flow, screens, data model, tech stack, roadmap, risks and open questions. Client confirmed they will capture images; data collection to follow. |
