import os
import numpy as np
import joblib

basePath = os.path.dirname(os.path.abspath(__file__))

# load the trained Isolation Forest and its scaler once at import time
model = joblib.load(os.path.join(basePath, "isoforest.joblib"))
scaler = joblib.load(os.path.join(basePath, "scaler.joblib"))
normParams = joblib.load(os.path.join(basePath, "norm_params.joblib"))

featureCols = ["R_ratio", "Vintage_Age", "M_flag", "T_flag"]
scoreMin = normParams["score_min"]
scoreMax = normParams["score_max"]


# Takes a dict with the four features and returns a risk score between 0 and 1.
# Higher means more suspicious. Anything above 0.7 is considered high risk.
def scoreProject(features: dict) -> float:
    row = np.array([[features[col] for col in featureCols]], dtype=float)
    rowScaled = scaler.transform(row)
    raw = model.score_samples(rowScaled)[0]
    # isolation forest returns negative scores where lower = more anomalous
    # so we flip it and normalize to 0..1
    flipped = -raw
    flipped = float(np.clip(flipped, scoreMin, scoreMax))
    risk = (flipped - scoreMin) / (scoreMax - scoreMin)
    return round(float(risk), 4)


if __name__ == "__main__":
    testCases = [
        {"R_ratio": 1.0,  "Vintage_Age": 10, "M_flag": 0, "T_flag": 0, "label": "Normal project"},
        {"R_ratio": 15.0, "Vintage_Age": 20, "M_flag": 1, "T_flag": 1, "label": "Very suspicious"},
        {"R_ratio": 0.5,  "Vintage_Age": 3,  "M_flag": 0, "T_flag": 0, "label": "Low issuer"},
    ]
    print("── scoreProject() smoke test ───────────────────────────")
    for t in testCases:
        label = t.pop("label")
        score = scoreProject(t)
        print(f"  {label:25s}  →  RiskScore = {score:.4f}")
