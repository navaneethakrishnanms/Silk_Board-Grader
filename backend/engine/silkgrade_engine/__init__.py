"""SilkGrade grading engine.

Pure, stateless Python package: no web, database or framework dependencies.
All colour maths lives here so it can be reused by the web API today and a
mobile app (via the same API, then ported on-device) later.
"""

__version__ = "1.1.0"

import os as _os

# The pipeline already parallelises across pieces with a thread pool. Letting
# OpenBLAS also spawn its own threads from several Python threads at once makes
# NumPy matmul crash (access violation) or hang on Windows (OpenBLAS 0.3.29).
# Must be set before NumPy is first imported; override via the environment.
for _var in ("OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "OMP_NUM_THREADS"):
    _os.environ.setdefault(_var, "1")

from .pipeline import grade_test  # noqa: E402,F401
