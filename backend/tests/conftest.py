import os
import sys

_ROOT = os.path.dirname(os.path.dirname(__file__))  # backend/
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

