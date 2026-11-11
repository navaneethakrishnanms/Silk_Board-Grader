# SilkGrade — Colour fastness grading (Web App V1, mobile-ready)

AI-assisted grading of silk colour fastness to washing from photos taken **before** and **after** washing,
for the Bangalore Silk Board testing laboratory. Grades G1–G7 (colour change overall / ground / each print
colour / worst; staining per adjacent fabric / worst) on the 9-step 1–5 grey scale, with a 95 % interval,
confidence, auto/review decision, pass/fail, ΔE measurements and heat-maps.

Build brief: [docs/SilkGrade_Web_Build_Prompt.md](docs/SilkGrade_Web_Build_Prompt.md) · design: [docs/SilkGrade_V1_Design.md](docs/SilkGrade_V1_Design.md) ·
client guide: [docs/capture_guideline.md](docs/capture_guideline.md)

## Repository layout

```
Silk_Board_Grader/
├── frontend/                 React 18 + Vite + TS + Tailwind v4 + Konva + TanStack Query + Zustand  (spec "web/")
│   └── src/{app,pages,components/{ui,upload,regions,results},features/{tests,review,history,dataset,settings},lib,styles}
├── backend/
│   ├── api/                  Node + Express 5 + TS + Prisma (MySQL 8) — the single public API  (spec "api/")
│   │   ├── prisma/           schema.prisma, migrations/, seed.ts
│   │   └── src/{routes,controllers,services,middleware,clients,config,lib,utils}
│   └── engine/               Python (spec "engine/")
│       ├── silkgrade_engine/ pure grading library — no web deps (reusable by the mobile app)
│       ├── engine_svc/       internal FastAPI wrapper (/health /inspect /detect-regions /register /grade)
│       ├── tests/            pytest: ISO tables, colour vs colour-science, synthetic end-to-end, service contract
│       ├── tools/            make_synthetic.py, perf_check.py, export_dataset.py
│       ├── training/         train.py, evaluate.py, export_model.py (run on synthetic data today)
│       └── requirements.txt
├── packages/shared/          TS enums, grade tables, status machine, consensus rules, zod schemas, API types
├── docs/                     design, build prompt, capture guideline
├── storage/                  originals / derived / reports / models (gitignored, shared by api + engine)
├── docker-compose.yml        mysql · engine · api · web (nginx) · minio (optional profile)
└── .env.example              compose settings (each service also has its own .env.example)
```

## Quick start — demo mode (no MySQL, no Docker)

```powershell
conda activate torch_gpu
pip install -r backend/engine/requirements-dev.txt
npm install
npm install-scripts approve @prisma/client prisma @prisma/engines esbuild
npm rebuild @prisma/engines prisma @prisma/client esbuild
npm run demo
```

`npm run demo` starts engine-svc (:8001), the API with `DATA_MODE=memory` (:4000) and the web app
(:5173, also reachable from a phone on the same Wi-Fi — the URL is printed). It seeds 4 users, settings,
presets and 3 demo tests (plain graded, printed graded, one pending wash). Data lives in memory and resets
on restart (yellow **DEMO MODE** bar); uploaded files still go to `storage/`.

Logins: `tester@silkgrade.local / Tester@12345`, `expert@silkgrade.local / Expert@12345` (expert A),
`expert2@silkgrade.local / Expert@12345` (expert B), `admin@silkgrade.local / Admin@12345`.

## Run with MySQL (production path)


The `torch_gpu` env provides Python 3.10 **and** Node 26 / npm, so everything runs from it.

```powershell
conda activate torch_gpu

# 1. dependencies
pip install -r backend/engine/requirements-dev.txt
npm install
npm install-scripts approve @prisma/client prisma @prisma/engines esbuild   # npm 11 blocks install scripts
npm rebuild @prisma/engines prisma @prisma/client esbuild
npm run build:shared

# 2. env files (already created with dev values; edit if needed)
#    backend/api/.env   backend/engine/.env   frontend/.env   .env (compose)

# 3. MySQL 8 (Docker) — or point DATABASE_URL in backend/api/.env at an existing MySQL
docker compose up -d mysql

# 4. database schema + seed (users, presets, 3 synthetic demo tests)
cd backend/engine; python tools/make_synthetic.py --out ../../storage/demo --cases demo; cd ../..
npm run prisma:deploy -w @silkgrade/api
npm run dev:engine          # terminal 1 — engine-svc on :8001 (start before seeding so demo tests get graded)
npm run db:seed             # terminal 2
npm run dev:api             # terminal 2 — API on :4000/api/v1
npm run dev:web             # terminal 3 — web on http://localhost:5173 (proxies /api)
```

Seeded logins: `admin@silkgrade.local / Admin@12345`, `expert@silkgrade.local / Expert@12345`,
`expert2@silkgrade.local / Expert@12345`, `tester@silkgrade.local / Tester@12345` (change them in Settings).

### Everything in Docker

```bash
cp .env.example .env          # set real secrets
docker compose up --build     # web on http://localhost:8080
docker compose exec api npm run seed
```

## Tests

| Layer | Command | Covers |
|---|---|---|
| Lint | `npm run lint` | ESLint (frontend, api, shared) + Ruff (engine) |
| Engine | `npm run test:engine` (pytest) | Section 8.7 sanity tables, VERIFY constants pinned, colour vs colour-science, synthetic cases, model plug-in (all bundle types, ONNX == Python), training pipeline end to end + test-set lock, white-paper segmentation / stitched pieces / satin glare / print clusters / grey-scale checker, service contract |
| Performance | `python backend/engine/tools/perf_check.py` | 12 MP pair graded < 5 s |
| Shared | `npm test -w @silkgrade/shared` | status machine, grade rounding, schemas, consensus rules (third assessor), weighted kappa |
| API | `npm test -w @silkgrade/api` | auth, refresh rotation/revocation, RBAC, status machine, upload validation, blind mode, grade immutability, signed URLs, in-memory DB, PDF (every Section 13 item), CSV, dataset zip (Section 10.2), storage drivers, pilot tools, model bundles, job recovery |
| Web | `npm test -w @silkgrade/web` | UploadSlot, RegionEditor, GradeCard, review controls, QR fallback, grade chips |
| E2E | `npx playwright install chromium`, `npm run demo`, then `npm run e2e` | full flow create → upload → regions → pending → after → align → grade → review/override → complete → PDF, on desktop and a phone (Pixel 7) |
| PWA | `npm run build -w @silkgrade/web`, `npx vite preview --port 4173` (frontend/), `PWA_URL=http://localhost:4173 npx playwright test e2e/pwa.spec.ts --project=desktop` | Chrome installability (no errors) + offline app shell |

## Grading pipeline (engine)

`load (EXIF, 16-bit, SHA-256) → quality (blur, clipping, glare, low-res) → optional reference-card correction →
sRGB→XYZ(D65)→CIELAB → fabric mask in the confirmed polygon → edge erosion 3 mm, seam & glare masking →
specimen registration (AKAZE/SIFT + RANSAC; 2-point manual fallback) → 1 mm texture smoothing →
print-colour k-means (printed) → features (median Lab, ΔE*ab, ΔE00, ΔL ΔC ΔH, p10/p50/p90) →
ISO 105-A04 staining / A05 colour change → model correction (formula-only now) → bootstrap CI (200 patches) →
decision (AUTO / REVIEW) → heat-maps.`

### Values still to verify (do not block the build)

All live in `backend/engine/silkgrade_engine/config.py`, are pinned by `tests/test_config_pinned.py`, and are flagged in the UI:

* grey-scale ΔE steps (ISO 105-A02/A03) and the A04/A05 formula constants;
* **ΔE_F** (ISO 105-A05) — CIEDE2000 is used as a placeholder, so every colour-change grade shows **Provisional** and goes to review until `DE_F_VERIFIED = True`;
* stain statistic (p90 "most-stained area" vs median) and printed-fabric rule (area-weighted vs worst) — admin-selectable in Settings;
* wash methods and required-grade presets (Settings); colour-card reference values.

## Mobile readiness

Responsive UI (sidebar on desktop, bottom tabs on phones, camera capture inputs), PWA manifest + service worker,
and `packages/shared` holds every enum, schema and API type for the future React Native (Expo) app, which will use
the same `/api/v1`. The engine is a pure library so it can later be ported on-device.

## Training (ready for real data)

```bash
cd backend/engine
python -m training.run --dataset dataset.zip --out runs/2026-12-01_1000        # from GET /export/dataset.zip
python -m training.run --dataset dataset.zip --out runs/2026-12-01_1100 --final # test split, once per split
python -m training.run --synthetic 160 --out runs/synthetic_demo                # SYNTHETIC — proves the chain
```

unzip → validate → features from the engine → split by sample (70/15/15, stratified; 5-fold CV under 300
records) → candidates (ISO baseline, linear, ordinal logistic, LightGBM regressor, LightGBM cumulative
ordinal) → simplest model beating the baseline on weighted kappa (and not worse on ±0.5) → calibrated 95 %
interval → review threshold → `report.md` / `report.json` / confusion matrices → `model/<m1_change|m2_stain>/bundle.json`.
Upload the bundle in **Settings → Models**, press **Compare** to run it on past expert-graded records, then
**Activate**: new grades carry its version; old grades are never changed.

## Pilot tools and tuning

* **Pilot tools** page (expert/admin): repeatability, device comparison, data coverage (target 400–600), shadow mode.
* `docs/tuning/CHANGELOG.md`: every engine threshold change with evidence; `backend/engine/tools/tune_client_scans.py`
  and `tools/measure_grey_scale.py` run on the client scans in `docs/client_samples/`.
