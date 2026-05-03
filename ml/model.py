import os
import numpy as np
import joblib

_BASE = os.path.dirname(os.path.abspath(__file__))

# load the trained Isolation Forest and its scaler once at import time
_model = joblib.load(os.path.join(_BASE, "isoforest.joblib"))
_scaler = joblib.load(os.path.join(_BASE, "scaler.joblib"))
_norm_params = joblib.load(os.path.join(_BASE, "norm_params.joblib"))

FEATURE_COLS = ["R_ratio", "Vintage_Age", "M_flag", "T_flag"]
_SCORE_MIN = _norm_params["score_min"]
_SCORE_MAX = _norm_params["score_max"]


# Takes a dict with the four features and returns a risk score between 0 and 1.
# Higher means more suspicious. Anything above 0.7 is considered high risk.
def score_project(features: dict) -> float:
    row = np.array([[features[col] for col in FEATURE_COLS]], dtype=float)
    row_scaled = _scaler.transform(row)
    raw = _model.score_samples(row_scaled)[0]
    # isolation forest returns negative scores where lower = more anomalous
    # so we flip it and normalize to 0..1
    flipped = -raw
    flipped = float(np.clip(flipped, _SCORE_MIN, _SCORE_MAX))
    risk = (flipped - _SCORE_MIN) / (_SCORE_MAX - _SCORE_MIN)
    return round(float(risk), 4)


if __name__ == "__main__":
    test_cases = [
        {"R_ratio": 1.0,  "Vintage_Age": 10, "M_flag": 0, "T_flag": 0, "label": "Normal project"},
        {"R_ratio": 15.0, "Vintage_Age": 20, "M_flag": 1, "T_flag": 1, "label": "Very suspicious"},
        {"R_ratio": 0.5,  "Vintage_Age": 3,  "M_flag": 0, "T_flag": 0, "label": "Low issuer"},
    ]
    print("── score_project() smoke test ───────────────────────────")
    for t in test_cases:
        label = t.pop("label")
        score = score_project(t)
        print(f"  {label:25s}  →  RiskScore = {score:.4f}")
