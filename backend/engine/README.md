# SilkGrade engine

* `silkgrade_engine/` — pure Python grading library (no web deps). Entry point: `grade_test(request, output_dir)`.
* `engine_svc/` — internal FastAPI wrapper (`/health`, `/inspect`, `/detect-regions`, `/grade`).
* `tools/` — `make_synthetic.py` (synthetic fabric pairs), `perf_check.py` (12 MP < 5 s), `export_dataset.py`.
* `training/` — `train.py`, `evaluate.py`, `export_model.py` (run on synthetic data now).

```bash
conda activate torch_gpu
pip install -r requirements-dev.txt
pytest                                   # engine + service tests
python tools/perf_check.py               # performance budget
uvicorn engine_svc.main:app --port 8001  # run the service
```

All constants live in `silkgrade_engine/config.py`; values marked **VERIFY** are pinned by
`tests/test_config_pinned.py` and must be confirmed against the purchased ISO standards.
