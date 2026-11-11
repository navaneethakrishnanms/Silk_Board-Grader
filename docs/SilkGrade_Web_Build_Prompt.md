# SilkGrade — Complete Build Prompt (Web App V1, Mobile-Ready)

> **How to use this file:** give this whole file to an AI coding agent (Claude Code or similar) as the build brief, or follow it yourself phase by phase. Work through the phases in order; each phase ends with acceptance checks that must pass before the next starts. The companion design document is `SilkGrade_V1_Design.md`.

---

## 0. Prompt (paste this to the coding agent)

```
You are a senior full-stack engineer and computer-vision engineer.
Build "SilkGrade", a web application that grades the colour fastness of
silk fabrics to washing from photos taken BEFORE and AFTER washing.

Read this entire document before writing code. Follow the architecture,
folder structure, database schema, API contracts, grading formulas,
UI screens and phases EXACTLY as specified. Where something is marked
"VERIFY", implement it behind a config constant and add a TODO, do not
guess silently.

Rules:
1. Build in the phase order given in Section 14. Do not start a phase
   until the previous phase's acceptance checks pass.
2. The grading engine is a pure, stateless Python package with no web
   dependencies, so it can later be reused by a mobile app.
3. No real training data exists yet. The ML layer must run in
   "formula-only" mode now, with a clean plug-in point for trained
   models later. Never fake model accuracy.
4. Write tests for every engine function (Section 11). Use synthetic
   images with known colour shifts to prove the formulas.
5. Every grade must be traceable: images (SHA-256), engine version,
   model version, user, timestamps.
6. The UI must be responsive (desktop first, works on a phone browser),
   because the next step is a mobile app.
7. After each phase, print a short summary: what was built, how to run
   it, which acceptance checks pass.
```

---

## 1. Project Context

| Item | Value |
| --- | --- |
| Product | SilkGrade — AI-assisted colour fastness grading |
| Client | Bangalore Silk Board (silk testing laboratory) |
| Users | Lab testers, expert assessors, admin |
| Today | Assessors grade washed samples by eye against grey-scale cards |
| V1 target | Web app (React + Node + Python engine + MySQL) |
| V2 target | Mobile app (React Native / Expo, then on-device engine) reusing the same API and engine |
| Images | Captured by the client with a good phone or scanner; the app uploads them |
| Data | Expert-graded training data will be collected later; V1 must be built to collect it |

### 1.1 The test being graded

1. A dyed or printed silk **specimen** has white **adjacent fabric(s)** stitched to it (usually one silk + one cotton). Together they form a **composite**.
2. The composite is washed (e.g. ISO 105-C10).
3. Two things are graded on a 1–5 scale with half steps (9 grades: 5, 4-5, 4, 3-4, 3, 2-3, 2, 1-2, 1):
   - **Colour change** — original specimen vs washed specimen.
   - **Staining** — unwashed adjacent fabric vs washed adjacent fabric.

### 1.2 Everything the app grades

| Code | Grade | Compared | Notes |
| --- | --- | --- | --- |
| G1 | Colour change — overall | specimen before vs after | always |
| G2 | Colour change — ground colour | ground region before vs after | printed only |
| G3 | Colour change — each print colour | each motif colour before vs after | printed only, one per colour |
| G4 | Colour change — worst colour | min(G2, G3…) | printed only |
| G5 | Staining — adjacent 1 | adj1 unwashed vs washed | always |
| G6 | Staining — adjacent 2 | adj2 unwashed vs washed | if 2 adjacent fabrics |
| G7 | Staining — worst | min(G5, G6) | if 2 adjacent fabrics |

Each grade also returns: continuous rating, half-step grade, 95% interval, confidence level, auto-accept / needs-review decision, pass/fail against the required grade, measured ΔE, ΔL, ΔC, ΔH, and a heat-map image.

---

## 2. Research Summary — What Exists and Why We Build It This Way

| Existing approach | How it works | Strength | Weakness | What we take |
| --- | --- | --- | --- | --- |
| **Visual grading** (current lab practice) | Assessor compares fabric with grey-scale card under a viewing booth | Accepted everywhere | Subjective, tiring, cards wear out, no record | We reproduce its output (same 9 grades) |
| **Spectrophotometer + ISO 105-A04 / A05** | Measure CIELAB with an instrument, convert ΔE to grade by formula | Objective, standard | Small aperture; struggles with small, non-uniform or printed specimens | **Use the A04/A05 formulas as our grading core** |
| **Digital imaging cabinet — ISO 105-A11** (e.g. VeriVide DigiEye + DigiGrade) | Calibrated camera inside a D65 cabinet, software grades change and staining | Industrial standard for camera grading; handles non-uniform and patterned samples | Expensive dedicated hardware | Follow the A11 pipeline idea: calibrate → CIELAB → per-region measurement → grade |
| **Phone app with grey scale in frame** (e.g. Kuraray Colour Fastness App, iOS, 2022) | Photograph treated + untreated sample + grey scale under suitable light; app grades | Cheap, fast, report IDs and archive | Depends on lighting and on the physical card's condition | Before/after workflow, report ID per test, archive |
| **Grey-scale-difference method** (research) | Photograph the grey card, fit a curve from card patch differences to grades | No instrument | Card wear and camera error enter the grade directly | **Do not use** — the client's cards are worn |
| **Colour-difference conversion** (research) | CIELAB / CIEDE2000 difference fitted to grades by regression | Simple | Linear fits miss the non-linear grade scale | Use as a feature, not the final answer |
| **Imaging + learned model on colour features** (research: Luo, Cui, Rigg et al.; Liang et al. 2023, spectral reconstruction + BP neural network) | Accurate colour data → small neural network or new formula fitted to visual grades | Agreement with assessors better than plain ISO formulas | Needs a labelled dataset | **Our V1.1 ML layer: small model on colour features, trained on the lab's own grades** |
| **End-to-end CNN on photos** | Image in, grade out | No feature engineering | Needs thousands of labels; unexplainable; breaks when device changes | V2 only, if data becomes large |

**Conclusion for efficient build:** the most efficient and defensible design is
`accurate colour measurement → ISO 105-A04/A05 formula → (later) small correction model trained on the lab's expert grades`.
It works on day one with zero training data, stays explainable to auditors, and improves as labelled data arrives.

---

## 3. Architecture

### 3.1 Services

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│  web/  React + Vite + TS  │  HTTPS │  api/  Node.js + Express + TS │
│  Tailwind, shadcn/ui      │ ─────► │  Auth (JWT), RBAC, uploads,   │
│  Konva (region editor)    │        │  tests, review, reports,      │
│  TanStack Query, Zustand  │ ◄───── │  dataset export, audit log    │
└───────────────────────────┘  JSON  └──────────┬───────────────┬───┘
                                                │ SQL           │ HTTP (internal)
                                     ┌──────────▼─────┐  ┌──────▼──────────────────┐
                                     │ MySQL 8        │  │ engine-svc/ FastAPI      │
                                     │ (Prisma ORM)   │  │ wraps silkgrade_engine   │
                                     └────────────────┘  │ (pure Python package)    │
                                                         └──────┬──────────────────┘
                                     ┌──────────────────┐       │ reads/writes
                                     │ storage/ (local   │◄─────┘
                                     │ disk or S3/MinIO) │  originals, masks,
                                     └──────────────────┘  heat-maps, PDFs
```

| Service | Responsibility |
| --- | --- |
| `web` | All UI. No grading logic. |
| `api` | Single public backend: auth, business rules, status machine, DB, files, PDFs, audit. Calls `engine-svc` for anything image/colour related. |
| `engine-svc` | Thin FastAPI wrapper. Stateless. Receives file paths + parameters, returns regions, measurements, grades, heat-maps. |
| `silkgrade_engine` | Pure Python library (NumPy, OpenCV, scikit-image, colour-science). All maths lives here. Reused later by mobile (via server, then ported). |
| `storage` | Original images (never modified), derived images, reports. |

### 3.2 Why this split

- The UI and API use the developer's stack (React, Node, Express, MySQL, Tailwind).
- Image and colour maths are far better supported in Python (OpenCV, colour-science, scikit-learn).
- Keeping the engine pure means the mobile app can call the same API now, and the engine can be ported on-device later without changing any grade.

### 3.3 Mobile path (plan now, build later)

| Step | What |
| --- | --- |
| V1 | Responsive web app; on phones, upload uses `<input type="file" accept="image/*" capture="environment">` |
| V1.5 | PWA (installable, offline queue for uploads) |
| V2 | React Native (Expo) app using the same `api` and shared TypeScript types package |
| V3 | On-device engine (port `silkgrade_engine` maths to Kotlin/C++ or ONNX) for full offline grading |

Put shared types and constants (grades, statuses, roles) in `packages/shared` from day one so the mobile app can reuse them.

---

## 4. Repository Structure

```
silkgrade/
├── README.md
├── docker-compose.yml              # mysql, api, engine-svc, web, minio (optional)
├── .env.example
├── docs/
│   ├── SilkGrade_V1_Design.md
│   ├── SilkGrade_Web_Build_Prompt.md
│   └── capture_guideline.md        # written in Phase 1 for the client
├── packages/
│   └── shared/                     # TS: enums, grade tables, zod schemas, API types
├── web/                            # React + Vite + TS + Tailwind
│   └── src/
│       ├── app/                    # routes, layout, providers
│       ├── pages/
│       ├── components/
│       │   ├── upload/             # UploadSlot, DropZone, ImageWarnings
│       │   ├── regions/            # RegionEditor (Konva), PieceLabeler
│       │   ├── results/            # GradeCard, GradeScale, HeatmapViewer, BeforeAfterSlider
│       │   └── ui/                 # shadcn components
│       ├── features/               # tests, review, history, dataset, settings
│       ├── lib/                    # api client, auth, format helpers
│       └── styles/
├── api/                            # Node + Express + TS
│   ├── prisma/schema.prisma
│   └── src/
│       ├── routes/
│       ├── controllers/
│       ├── services/               # testService, gradingService, reportService ...
│       ├── middleware/             # auth, rbac, upload, errors, audit
│       ├── clients/engineClient.ts
│       ├── reports/                # PDF templates
│       └── utils/
├── engine/
│   ├── silkgrade_engine/           # pure library
│   │   ├── __init__.py             # __version__
│   │   ├── config.py               # all constants, incl. VERIFY values
│   │   ├── io.py                   # load, EXIF, hash
│   │   ├── quality.py              # blur, clipping, glare
│   │   ├── colour.py               # sRGB→XYZ→Lab, ΔE*ab, ΔE00, ΔL ΔC ΔH
│   │   ├── reference_card.py       # optional colour-card correction
│   │   ├── segment.py              # fabric mask, edge erosion, seam mask
│   │   ├── register.py             # before/after alignment
│   │   ├── cluster.py              # print colour clustering
│   │   ├── features.py
│   │   ├── iso_grading.py          # A04 staining, A05 colour change
│   │   ├── model.py                # ML plug-in (formula-only for now)
│   │   ├── uncertainty.py
│   │   ├── heatmap.py
│   │   └── pipeline.py             # grade_test(...) end to end
│   ├── engine_svc/                 # FastAPI wrapper
│   ├── tests/
│   ├── tools/
│   │   ├── make_synthetic.py       # synthetic fabric pairs with known shifts
│   │   └── export_dataset.py
│   ├── training/                   # filled after data arrives (Section 10)
│   └── pyproject.toml
└── storage/                        # gitignored
```

---

## 5. Database Schema (MySQL 8, via Prisma)

```prisma
enum Role        { TESTER EXPERT ADMIN }
enum TestStatus  { DRAFT PENDING_WASH READY_TO_GRADE GRADING GRADED_AUTO NEEDS_REVIEW COMPLETED VOID }
enum ImageRole   { SPECIMEN_BEFORE SPECIMEN_AFTER ADJ1_BEFORE ADJ1_AFTER ADJ2_BEFORE ADJ2_AFTER COMPOSITE_BEFORE COMPOSITE_AFTER REF_CARD }
enum Piece       { SPECIMEN ADJ1 ADJ2 REF_CARD }
enum GradeKind   { CHANGE_OVERALL CHANGE_GROUND CHANGE_MOTIF CHANGE_WORST STAIN_ADJ1 STAIN_ADJ2 STAIN_WORST }
enum Decision    { AUTO REVIEW }
enum FabricType  { PLAIN PRINTED }

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
}

model Sample {
  id           String  @id            // e.g. BSB-2026-00123
  batchId      String?
  customer     String?
  fibre        String  @default("silk")
  construction String?               // satin, crepe, georgette, plain weave
  fabricType   FabricType
  baseShade    String?               // light | medium | dark
  dominantHue  String?
  dyeClass     String?
  notes        String?
  tests        Test[]
}

model Test {
  id               String     @id @default(uuid())
  reportNo         String     @unique         // SG-2026-000123
  sampleId         String
  sample           Sample     @relation(fields: [sampleId], references: [id])
  washMethod       String                      // e.g. ISO 105-C10 A
  washTempC        Float?
  washTimeMin      Float?
  adjCount         Int        @default(2)
  adj1Fibre        String     @default("silk")
  adj2Fibre        String?    @default("cotton")
  reqGradeChange   Float?                      // e.g. 4.0
  reqGradeStain    Float?                      // e.g. 3.5
  status           TestStatus @default(DRAFT)
  datasetMode      Boolean    @default(false)
  captureDevice    String?
  createdById      String
  createdAt        DateTime   @default(now())
  completedAt      DateTime?
  images           Image[]
  grades           Grade[]
}

model Image {
  id          String    @id @default(uuid())
  testId      String
  test        Test      @relation(fields: [testId], references: [id])
  role        ImageRole
  path        String
  sha256      String
  width       Int
  height      Int
  device      String?                    // from EXIF
  warnings    Json                       // {blur, clipping, glare, lowRes, noRefCard}
  uploadedBy  String
  uploadedAt  DateTime  @default(now())
  regions     Region[]
}

model Region {
  id          String   @id @default(uuid())
  imageId     String
  image       Image    @relation(fields: [imageId], references: [id])
  piece       Piece
  polygon     Json                       // [[x,y],...] in image pixels
  maskPath    String?
  autoDetected Boolean @default(true)
  editedBy    String?
  stats       Json?                      // median L,a,b; area; valid pixel share
}

model Grade {
  id             String    @id @default(uuid())
  testId         String
  test           Test      @relation(fields: [testId], references: [id])
  kind           GradeKind
  label          String?                 // e.g. "motif 1 (teal)"
  isoRating      Float
  modelRating    Float?                  // null in formula-only mode
  finalRating    Float
  halfGrade      Float                   // 1.0 … 5.0 step 0.5
  ciLow          Float
  ciHigh         Float
  confidence     String                  // HIGH | MEDIUM | LOW
  decision       Decision
  pass           Boolean?
  features       Json                    // dE, dE00, dL, dC, dH, p10, p50, p90, areaShare ...
  heatmapPath    String?
  engineVersion  String
  modelVersion   String                  // "formula-only" until trained
  createdAt      DateTime  @default(now())
  expertGrades   ExpertGrade[]
}

model ExpertGrade {
  id         String   @id @default(uuid())
  gradeId    String
  grade      Grade    @relation(fields: [gradeId], references: [id])
  userId     String
  halfGrade  Float
  reason     String?
  blind      Boolean  @default(false)      // true in dataset mode
  createdAt  DateTime @default(now())
}

model ModelVersion {
  id          String   @id @default(uuid())
  name        String                       // m1_change, m2_stain
  version     String
  path        String
  sha256      String
  metrics     Json
  active      Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model Setting {
  key   String @id                          // required grade presets, thresholds ...
  value Json
}

model AuditLog {
  id        BigInt   @id @default(autoincrement())
  userId    String?
  action    String                          // CREATE_TEST, UPLOAD, GRADE, OVERRIDE, EXPORT ...
  entity    String
  entityId  String
  details   Json?
  createdAt DateTime @default(now())
}
```

**Rules:** grades are never updated after creation — an override adds an `ExpertGrade`. Images are never overwritten. `AuditLog` is insert-only.

---

## 6. API Contract (Express, `/api/v1`)

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | all | Email + password → JWT (access + refresh) |
| POST | `/auth/refresh` | all | Refresh token |
| GET | `/me` | all | Current user |
| GET | `/dashboard` | all | Counts: pending wash, needs review, today's tests, pass rate |
| POST | `/samples` | tester+ | Create/update sample |
| GET | `/samples/:id` | all | Sample with tests |
| POST | `/tests` | tester+ | Create test (status DRAFT) |
| GET | `/tests` | all | List/filter: status, sample, batch, customer, date range, pass/fail |
| GET | `/tests/:id` | all | Full test: images, regions, grades, expert grades |
| PATCH | `/tests/:id` | tester+ | Edit details while DRAFT / PENDING_WASH |
| POST | `/tests/:id/images` | tester+ | Multipart upload: `role`, `file` → stores, hashes, calls engine `/inspect` |
| DELETE | `/tests/:id/images/:imageId` | tester+ | Only before grading |
| POST | `/tests/:id/regions/detect` | tester+ | Engine auto-detects regions on uploaded images |
| PUT | `/tests/:id/regions` | tester+ | Save confirmed/edited regions |
| POST | `/tests/:id/mark-before-done` | tester+ | DRAFT → PENDING_WASH |
| POST | `/tests/:id/mark-after-done` | tester+ | PENDING_WASH → READY_TO_GRADE |
| POST | `/tests/:id/grade` | tester+ | Run engine; → GRADED_AUTO or NEEDS_REVIEW |
| GET | `/review` | expert+ | Review queue |
| POST | `/grades/:gradeId/expert` | expert+ | Add expert grade (accept or override + reason) |
| POST | `/tests/:id/complete` | expert+ / auto | Lock; generate PDF; → COMPLETED |
| POST | `/tests/:id/void` | admin | → VOID with reason |
| GET | `/tests/:id/report.pdf` | all | Download PDF |
| GET | `/export/tests.csv` | expert+ | CSV of results |
| GET | `/export/dataset.zip` | admin | Dataset export (Section 10.2) |
| GET/PUT | `/settings` | admin | Thresholds, required grade presets, capture guideline text |
| GET/POST | `/users` | admin | Manage users |
| GET | `/models` | admin | Model versions; activate one |
| GET | `/files/:id` | auth | Signed access to images, heat-maps |

Status machine (enforce in `testService`):

```
DRAFT ─(before images + regions)─► PENDING_WASH ─(after images + regions)─► READY_TO_GRADE
READY_TO_GRADE ─grade─► GRADING ─► GRADED_AUTO ──complete──► COMPLETED
                                └► NEEDS_REVIEW ─expert grades all REVIEW items─► COMPLETED
any (except COMPLETED) ─admin─► VOID
```

In `datasetMode`, the API **hides** engine grades from the client until every grade has a blind expert grade.

---

## 7. Engine Service Contract (FastAPI, internal only)

| Method | Path | Input | Output |
| --- | --- | --- | --- |
| GET | `/health` | — | `{engine_version, model_versions}` |
| POST | `/inspect` | `{path}` | `{width, height, device, warnings{blur, clipping, glare, lowRes, noRefCard}, preview_path}` |
| POST | `/detect-regions` | `{path, expected_pieces:[...]}` | `{regions:[{piece_guess, polygon, confidence}]}` |
| POST | `/grade` | `GradeRequest` (below) | `GradeResponse` (below) |

```jsonc
// GradeRequest
{
  "test_id": "uuid",
  "fabric_type": "PRINTED",
  "adj_count": 2,
  "adj_fibres": ["silk", "cotton"],
  "required": { "change": 4.0, "stain": 3.5 },
  "pairs": {
    "specimen": { "before": {"path": "...", "polygon": [[x,y]]}, "after": {"path": "...", "polygon": [[x,y]]} },
    "adj1":     { "before": {...}, "after": {...} },
    "adj2":     { "before": {...}, "after": {...} }
  },
  "ref_card": { "before": {...} | null, "after": {...} | null },
  "options": { "stain_statistic": "p90", "change_rule": "area_weighted" }
}

// GradeResponse
{
  "engine_version": "1.0.0",
  "model_version": "formula-only",
  "grades": [
    {
      "kind": "CHANGE_OVERALL", "label": null,
      "iso_rating": 4.31, "model_rating": null, "final_rating": 4.31,
      "half_grade": 4.5, "ci": [4.12, 4.48], "confidence": "MEDIUM",
      "decision": "REVIEW", "pass": true,
      "features": { "dE_ab": 1.2, "dE00": 0.9, "dE_F": 1.17, "dL": 0.8, "dC": -0.6, "dH": 0.4,
                    "p10": 0.5, "p50": 1.1, "p90": 1.9, "area_share": 1.0 },
      "heatmap_path": "..."
    }
  ],
  "warnings": ["DIFFERENT_DEVICE_BEFORE_AFTER"],
  "registration": { "method": "AKAZE", "inliers": 412, "ok": true }
}
```

---

## 8. Grading Engine — Exact Specification

> All constants live in `config.py`. Every value marked **VERIFY** must be checked against the purchased ISO standards before the client uses results; add a unit test pinning each value.

### 8.1 Grade tables

```python
GRADES = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]          # class index 0..8
GRADE_LABEL = {5.0:"5", 4.5:"4-5", 4.0:"4", 3.5:"3-4", 3.0:"3",
               2.5:"2-3", 2.0:"2", 1.5:"1-2", 1.0:"1"}

# Nominal CIELAB colour difference per step — VERIFY (ISO 105-A02 / A03)
CHANGE_SCALE_DE = {5.0:0.0, 4.5:0.8, 4.0:1.7, 3.5:2.5, 3.0:3.4, 2.5:4.8, 2.0:6.8, 1.5:9.6, 1.0:13.6}
STAIN_SCALE_DE  = {5.0:0.0, 4.5:2.2, 4.0:4.3, 3.5:6.0, 3.0:8.5, 2.5:12.0, 2.0:16.9, 1.5:24.0, 1.0:34.1}
```

### 8.2 Pipeline (`pipeline.grade_test`)

| Step | Function | Detail |
| --- | --- | --- |
| 1 | `io.load` | Read with EXIF orientation; keep 16-bit if present; SHA-256 |
| 2 | `quality.check` | Blur: variance of Laplacian < `BLUR_MIN`; clipping: > 0.5% of region pixels at 255 in any channel; glare: connected blobs with L\* > 95 and C\* < 3 inside fabric; low-res: region < 3 MP-equivalent area |
| 3 | `reference_card.correct` (optional) | If a reference card region is given: fit a 3×3 (then root-polynomial) matrix from measured patches to known Lab/XYZ; apply to the whole image. Store residual ΔE00. If absent: assume sRGB, add `noRefCard` warning |
| 4 | `colour.to_lab` | sRGB → linear → XYZ (D65) → CIELAB via `colour-science` |
| 5 | `segment.fabric_mask` | Within the confirmed polygon: Otsu/Lab threshold vs background, morphology open/close |
| 6 | `segment.clean` | Erode edge by `EDGE_ERODE_MM` (default 3 mm, px via image DPI or polygon size); detect seam lines (ridge filter + Hough) and mask a band; mask glare pixels |
| 7 | `register.align` | Specimen only: AKAZE features + RANSAC homography after→before; fail if inliers < `MIN_INLIERS` → return `registration.ok=false` (UI asks for 2 matching points) |
| 8 | `colour.smooth` | Gaussian blur, sigma ≈ 1 mm in pixels (texture averaging) |
| 9 | `cluster.print_colours` | Printed only: k-means in Lab on the original, k = 2..5 chosen by silhouette; largest cluster = ground; apply labels to the aligned washed image; erode cluster boundaries by 2 px |
| 10 | `features.build` | Per region/cluster: median Lab before/after, ΔE\*ab, ΔE00, ΔL, ΔC, ΔH, per-pixel ΔE p10/p50/p90, std, area share |
| 11 | `iso_grading` | Ratings (8.3, 8.4) |
| 12 | `model.correct` | Formula-only now: `model_rating = None`, `final = iso` |
| 13 | `uncertainty.interval` | 8.5 |
| 14 | `decide` | 8.6 |
| 15 | `heatmap.render` | Per-pixel ΔE → colour map PNG overlaid on the after image |

### 8.3 Staining — ISO 105-A04 (VERIFY constants)

```python
def stain_rating(dE_ab: float, dL: float) -> float:
    dE_gs = dE_ab - 0.4 * math.sqrt(max(dE_ab**2 - dL**2, 0.0))
    if dE_gs <= 1e-6:
        return 5.0
    ssr = 6.1 - 1.45 * math.log(dE_gs)
    if ssr > 4.0:
        ssr = 5.0 - 0.23 * dE_gs
    return min(max(ssr, 1.0), 5.0)
```

- Compute on the median pixel difference **and** on the p90 difference.
- `options.stain_statistic` ("p90" default, or "median") selects the official one; store both in `features`.

### 8.4 Colour change — ISO 105-A05 (VERIFY constants and ΔE_F definition)

```python
def change_rating(dE_F: float) -> float:
    if dE_F <= 3.4:
        r = 5.0 - dE_F / 1.7
    else:
        r = 5.0 - math.log(dE_F / 0.85) / math.log(2.0)
    return min(max(r, 1.0), 5.0)
```

- `dE_F` is the ISO 105-A05 weighted colour difference. Implement it in `colour.delta_e_f()` exactly as defined in the standard. Until verified, use CIEDE2000 as a placeholder, set `features.dE_F_is_placeholder = true`, and show a "provisional" badge in the UI.
- Printed fabrics: rating per cluster; `CHANGE_GROUND` = ground cluster; one `CHANGE_MOTIF` per other cluster; `CHANGE_WORST` = min; `CHANGE_OVERALL` = area-weighted mean of cluster ratings (or worst, per `options.change_rule`).

### 8.5 Uncertainty

1. Bootstrap 200 random sub-patches (each 20% of the valid region) → 200 ratings.
2. `ci = percentile(2.5), percentile(97.5)`.
3. Widen by the reference-card residual (if present) and by a fixed penalty per warning.
4. `confidence`: HIGH if CI width ≤ 0.25, MEDIUM if ≤ 0.5, else LOW.

### 8.6 Decision and pass/fail

```
half_grade = round(final_rating * 2) / 2
REVIEW if: CI crosses a half-grade boundary
        or any warning present
        or |final_rating - required| < 0.5
        or registration failed
        or dE_F placeholder in use
else AUTO
pass = half_grade >= required (if a required grade is set)
```

### 8.7 Sanity tests the engine must pass

| Input | Expected |
| --- | --- |
| `stain_rating` with neutral ΔE = each `STAIN_SCALE_DE` value (ΔL = ΔE) | Within ±0.15 of that step's grade |
| `change_rating` with ΔE_F = each `CHANGE_SCALE_DE` value | Within ±0.15 of that step's grade (exact at 3.4 → 3 and 13.6 → 1) |
| Synthetic identical before/after | Grade 5, AUTO |
| Synthetic plain fabric with Lab shift of ΔE 3.4 (lightness only) | Change grade 3 ± 0.5 |
| Synthetic white fabric stained to ΔE 8.5 | Stain grade 3 ± 0.5 |
| Synthetic printed fabric where only the motif fades | Ground ≈ 5, motif < 5, worst = motif |
| Synthetic shifted/rotated after image | Registration ok, same grade as unshifted |
| Image with clipped whites | `clipping` warning, decision REVIEW |

---

## 9. UI / UX Design

### 9.1 Design direction

- **Feel:** a calm laboratory instrument — precise, neutral, trustworthy. Colour is reserved for meaning, because the product is about colour.
- **Neutral UI chrome** (greys) so the fabric images are judged against neutral surroundings, like a viewing booth.
- **Typography:** Inter (UI), JetBrains Mono (numbers and measurements).
- **Grade colours** (used only for grade chips and pass/fail):

| Grade | Chip colour |
| --- | --- |
| 5, 4-5 | Green 600 |
| 4, 3-4 | Lime 600 |
| 3, 2-3 | Amber 600 |
| 2, 1-2 | Orange 600 |
| 1 | Red 600 |

- Decision badges: **Auto-accepted** (slate outline), **Needs review** (amber solid), **Provisional** (violet outline, when a VERIFY placeholder is active).
- Light and dark theme; image panels always on a mid-grey (#808080 equivalent) background.
- Desktop: left sidebar navigation. Phone: bottom tab bar. Breakpoints: `sm` 640, `md` 768, `lg` 1024.
- Accessibility: WCAG AA contrast, every grade also shown as text, keyboard-navigable wizard.

### 9.2 Navigation

`Dashboard · New Test · Pending Wash · Review Queue · History · Dataset · Settings` (Dataset and Settings visible to admin/expert only).

### 9.3 Screens

| # | Screen | Key elements |
| --- | --- | --- |
| S1 | **Login** | Email, password, lab logo |
| S2 | **Dashboard** | KPI cards (pending wash, needs review, completed today, pass rate 30 days); "New Test" primary button; recent tests table; grade distribution chart |
| S3 | **New Test — Step 1: Details** | Sample ID (text + QR scan on phone), batch, customer, fabric type (Plain/Printed toggle), construction, shade, wash method (select), temp/time, number of adjacent fabrics (1/2) + fibres, required grades (prefilled from presets), dataset-mode switch (expert/admin) |
| S4 | **Step 2: Before-wash upload** | Upload mode toggle: **Separate pieces** (one slot per piece: Specimen, Adjacent 1 unwashed, Adjacent 2 unwashed, optional Reference card) or **Single image** (one photo with all pieces). Each slot: drag-and-drop zone, "Browse", "Take photo" (phone), thumbnail, file name, size, resolution, device, warnings chips (Blur / Clipped whites / Glare / Low resolution / No reference card). Capture-guideline drawer with the 10 rules |
| S5 | **Step 3: Confirm regions** | Large image canvas (Konva): auto-detected polygons per piece, colour-coded and labelled; drag vertices, draw new polygon, delete; piece labeller dropdown; zoom/pan; "Looks right" button. Save → status PENDING_WASH, toast "Saved. Come back after washing." |
| S6 | **Pending Wash list** | Table of tests waiting for after-wash images; age in days; "Add after-wash images" action |
| S7 | **Step 4: After-wash upload** | Same as S4 with washed pieces; banner if the device differs from before-wash |
| S8 | **Step 5: Confirm regions + alignment** | Region editor as S5; specimen before/after **overlay slider** to check alignment; if auto-alignment failed: "tap the same point on both images" (2 points) |
| S9 | **Grading** | Progress steps (Checking images → Measuring colour → Aligning → Grading → Done), < 5 s target |
| S10 | **Result** | Header: sample, report no., overall Pass/Fail. **Colour change card:** big grade chip, continuous rating, CI bar drawn on a 1–5 grey-scale strip, confidence, decision badge; for printed: rows for ground, each motif (with swatch of before/after colour), worst. **Staining cards:** one per adjacent fabric, same layout. **Viewer tabs:** Before/After slider · Staining heat-map · Colour-change heat-map · Regions. **Measurements** accordion (ΔE, ΔE00, ΔL lighter/darker, ΔC duller/brighter, ΔH, p50, p90). Actions: Send to review · Complete & generate report · Download PDF |
| S11 | **Review Queue** | Table: sample, grade kinds needing review, reason (boundary / warning / near limit / registration), age; filter |
| S12 | **Review Detail** | Same as Result, plus for each REVIEW grade: app grade, "Accept" or "Override" (grade picker 1–5 half steps + reason, required on override). Complete when all reviewed |
| S13 | **History** | Search + filters (date, status, batch, customer, pass/fail, grade range); table; CSV export; open test |
| S14 | **Dataset** | Counts per grade per grade-type (bar chart, highlights grades with < 40 samples); blind-labelling progress; "Export dataset" (zip); inter-assessor agreement table once data exists |
| S15 | **Settings** | Users & roles; required grade presets per customer/product; decision thresholds; wash methods list; capture guideline text; model versions (activate); engine health |
| S16 | **Report preview** | PDF preview in-app |

### 9.4 Dataset (blind) mode in the UI

- On S10 the engine grades are hidden behind "Grades hidden — blind labelling".
- Expert A enters grades → Expert B enters grades (cannot see A's) → if they differ by more than 0.5, Expert C decides.
- Only then are the engine grades revealed and the record marked "labelled".

---

## 10. ML Layer and Dataset (build the plumbing now; train later)

### 10.1 Model plug-in (now)

```python
class GradeModel(Protocol):
    name: str          # "m1_change" | "m2_stain"
    version: str
    def predict(self, features: dict) -> tuple[float, float]:  # rating, std
        ...

class FormulaOnly(GradeModel):     # active in V1
    version = "formula-only"
    def predict(self, features): return features["iso_rating"], 0.0
```

`model.load_active()` reads the active `ModelVersion` (ONNX or JSON coefficients). If none, use `FormulaOnly`.

### 10.2 Dataset export format (`/export/dataset.zip`)

```
dataset/
├── metadata.csv            # one row per completed labelled test
├── splits.csv              # empty until training; filled by training script
└── records/<sample_id>__<test_id>/
    ├── specimen_before.jpg   specimen_after.jpg
    ├── adj1_before.jpg       adj1_after.jpg
    ├── adj2_before.jpg       adj2_after.jpg   (if any)
    ├── regions.json          # confirmed polygons
    ├── features.json         # engine features per grade kind
    └── labels.json           # assessor A, B, C, consensus per grade kind
```

`metadata.csv` columns: `test_id, sample_id, batch_id, fabric_type, construction, base_shade, dominant_hue, dye_class, wash_method, adj1_fibre, adj2_fibre, device_before, device_after, ref_card, grade_change_overall, grade_change_ground, grade_change_worst, grade_stain_adj1, grade_stain_adj2, assessorA_*, assessorB_*, assessorC_*, engine_version`.

### 10.3 Training (after data arrives — write stubs now)

| Item | Plan |
| --- | --- |
| Target | 9 ordinal classes (1.0 … 5.0, step 0.5) |
| Models | M1 colour change, M2 staining (adjacent fibre as a feature) |
| Features | ISO rating, ΔE\*ab, ΔE00, ΔE_F, ΔL, ΔC, ΔH, p10/p50/p90, std, base L\*a\*b\*, cluster stats, fabric one-hots, warning flags |
| Algorithms | Baseline = ISO formula; then ordinal logistic regression (`mord`), then LightGBM; keep the simplest that beats baseline |
| Split | By test/sample (never by image), stratified by grade: 70 / 15 / 15; 5-fold CV while small |
| Metrics | Exact agreement, within ±0.5, quadratic weighted kappa, MAE, pass/fail agreement, review rate; vs assessor-A-vs-B baseline |
| Export | ONNX or JSON coefficients + metrics JSON → upload in Settings → activate |
| V2 | Siamese CNN (before/after) with CORAL ordinal head — only with ≥ 3,000 labelled tests |

Create `engine/training/train.py`, `evaluate.py`, `export_model.py` as working scripts that run end to end on **synthetic** data now, so the pipeline is proven before real data arrives.

---

## 11. Testing

| Layer | Tool | Must cover |
| --- | --- | --- |
| Engine | pytest | Section 8.7 sanity tests; every colour conversion against `colour-science` reference values; ISO constants pinned |
| Synthetic data | `tools/make_synthetic.py` | Plain, printed (2–4 colours), stained white, shifted/rotated, clipped, glare; known ground-truth grades |
| Engine service | pytest + httpx | Contract tests for `/inspect`, `/detect-regions`, `/grade` |
| API | Vitest/Jest + Supertest | Auth, RBAC, status machine, upload validation, blind mode hiding, audit entries, immutability of grades |
| Web | Vitest + React Testing Library; Playwright E2E | Full flow: create → before upload → regions → pending → after upload → grade → review → complete → PDF |
| Performance | script | Grade of a 12 MP pair < 5 s on a laptop CPU |

---

## 12. Non-Functional Requirements

| Area | Requirement |
| --- | --- |
| Upload | JPEG, PNG, TIFF (8/16-bit), HEIC (convert on server), max 40 MB per file; originals stored untouched |
| Security | JWT access (15 min) + refresh (7 days), bcrypt passwords, RBAC on every route, signed file URLs, rate limiting on auth, Helmet, CORS whitelist |
| Audit | Every create/upload/grade/override/complete/export/void → AuditLog |
| Traceability | Grade row stores engine + model version; images store SHA-256; PDF prints both |
| Performance | API p95 < 300 ms (non-grading); grading < 5 s for a 12 MP pair |
| Reliability | Grading runs as a job; UI polls `/tests/:id` status; failed jobs show the error and allow retry |
| Config | All thresholds in DB `Setting` or `config.py`; nothing hard-coded in UI |
| Deploy | `docker-compose up` brings up MySQL, api, engine-svc, web; seed script creates admin, sample presets and 3 synthetic demo tests |

---

## 13. PDF Report (generated by `api`)

1. Header: lab name, report number, date, app version.
2. Sample and test details (fibre, construction, plain/printed, wash method, temperature, time, adjacent fabrics).
3. Thumbnails: before/after for specimen and each adjacent fabric.
4. Grades table G1–G7: grade, required, pass/fail, decision, reviewer.
5. Heat-maps (staining, colour change).
6. Measurements appendix (ΔE, ΔE00, ΔL, ΔC, ΔH per region).
7. Traceability: engine version, model version, image hashes, tester, reviewer, timestamps.
8. Footer: "Instrument-assisted grading. Provisional until the laboratory completes method validation."

---

## 14. Build Phases and Acceptance Checks

| Phase | Build | Acceptance checks |
| --- | --- | --- |
| **P1 — Foundations** | Monorepo, docker-compose, `packages/shared`, Prisma schema + migrations + seed, Express skeleton with auth/RBAC/audit, React shell with routing, theme, layout, login | `docker-compose up` works; admin can log in; RBAC blocks a tester from Settings; audit row on login |
| **P2 — Engine core** | `silkgrade_engine`: io, quality, colour, iso_grading, features, uncertainty, synthetic generator, all Section 8.7 tests | All engine tests green; ISO sanity tables pass |
| **P3 — Engine advanced** | segment, register, cluster, heatmap, reference_card, pipeline, FastAPI service + contract tests | Synthetic printed/shifted/stained cases graded as expected; `/grade` < 5 s |
| **P4 — Test workflow** | S3–S8: test creation, uploads with warnings, region editor, pending wash, status machine | Full flow to READY_TO_GRADE in browser and phone browser; images hashed; regions saved |
| **P5 — Grading & results** | S9–S10: grading job, results UI, heat-maps, before/after slider, pass/fail, provisional badge | Synthetic demo tests show correct grades and decisions |
| **P6 — Review, reports, history** | S11–S13, S16: review/override, completion, PDF, CSV, history search | Override creates ExpertGrade (grade row unchanged); PDF contains all Section 13 items |
| **P7 — Dataset & ML plumbing** | Blind mode, S14, dataset export, model plug-in, training scripts on synthetic data, model upload/activate in S15 | Blind mode hides grades; exported zip matches 10.2; a synthetic-trained model can be activated and its version appears on new grades |
| **P8 — Hardening** | E2E Playwright suite, performance check, security headers, PWA manifest, README with run/deploy steps, `capture_guideline.md` for the client | All tests green; Lighthouse PWA installable; README lets a new developer run it in 15 minutes |

---

## 15. Definition of Done (V1 web)

- [ ] A tester can create a test, upload before-wash images, confirm regions and leave it pending.
- [ ] After washing, they upload after-wash images, confirm regions and alignment, and get grades G1–G7 within 5 seconds.
- [ ] Every grade shows rating, half grade, interval, confidence, decision, pass/fail and heat-map.
- [ ] Uncertain results go to the review queue; experts can accept or override with a reason.
- [ ] Completed tests produce a PDF and appear in history and CSV export.
- [ ] Dataset mode collects blind expert labels and exports a training-ready zip.
- [ ] The ML layer runs formula-only now and accepts a trained model later without code changes.
- [ ] All VERIFY constants are isolated in config, tested, and flagged in the UI until confirmed.
- [ ] The same API and shared types are ready for the React Native mobile app.

---

## 16. Inputs Still Needed From the Client (do not block the build)

| # | Needed for | Question |
| --- | --- | --- |
| 1 | ISO constants | Purchase ISO 105-A02, A03, A04, A05, A11 to verify formulas and step values |
| 2 | Wash methods list | Which wash methods and conditions are used? |
| 3 | Adjacent fabrics | Silk + cotton single-fibre? Is an unwashed piece kept each time? |
| 4 | Grading rules | Uneven staining: most-stained area or average? Prints: worst colour or area-weighted? |
| 5 | Capture | Which phone/scanner? Can auto-enhance be disabled? Can a colour reference card be included? |
| 6 | Pass/fail | Required minimum grades per customer/product |
| 7 | Data | 50 historical composites with recorded grades for an early check |
| 8 | Branding | Lab name and logo for the UI and PDF |

---

## 17. Sources

- [ISO 105-A11:2012 — Determination of colour fastness grades by digital imaging techniques (ISO)](https://www.iso.org/standard/42329.html) — last reviewed and confirmed in 2023.
- [ISO 105-A03:2019 — Grey scale for assessing staining (ISO)](https://committee.iso.org/standard/75985.html)
- [ISO 105-A02 — Grey scale for assessing change in colour (ANSI webstore)](https://webstore.ansi.org/standards/iso/iso105a021993) — 5 essential steps plus 4 half-steps (9 steps).
- [VeriVide DigiGrade — automatic digital colour fastness grading in the DigiEye cabinet](https://www.directindustry.com/prod/verivide/product-172698-2505900.html)
- [Kuraray Colour Fastness App — phone-based colour fastness assessment (textiletechnology.net)](https://www.textiletechnology.net/news/determine-color-fastness-of-textiles-via-app-203100)
- [Luo, Cui, Rigg, Dakin — A New Method for Assessing Textile Fastness Based on Digital Imaging, CGIV 2004](https://library.imaging.org/cgiv/articles/2/1/art00096)
- [Liang et al. — Digital Grading the Color Fastness to Rubbing of Fabrics Based on Spectral Reconstruction and BP Neural Network, J. Imaging 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10672307/)
- [AATCC — Gray Scale for Staining and Gray Scale for Color Change (CIELAB-defined steps)](https://members.aatcc.org/4DCGI/productinfo/Gray%20Scale.htm)
