"""SilkGrade grading engine.

Pure, stateless Python package: no web, database or framework dependencies.
All colour maths lives here so it can be reused by the web API today and a
mobile app (via the same API, then ported on-device) later.
"""

__version__ = "1.1.0"

from .pipeline import grade_test  # noqa: E402,F401
