"""ML stage implementations for feedback-driven improvement."""

from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


# Feature names in order
FEATURE_NAMES = ["height", "flatness", "centroid", "prominence", "rise", "decay", "zcr"]

# Mapping from detection_features keys to our normalized names
FEATURE_KEY_MAP = {
    "peak_height": "height",
    "spectral_flatness": "flatness",
    "frequency_centroid": "centroid",
    "onset_strength": "prominence",  # Using onset_strength as prominence proxy
    "decay_ratio": "decay",
    "zero_crossing_rate": "zcr",
}


def analyze_threshold(
    feedback: list[dict[str, Any]],
    current_threshold: float = 0.70,
    target_tp_retention: float = 0.95,
) -> dict[str, Any]:
    """Stage 1: Analyze feedback to find optimal confidence threshold.

    Args:
        feedback: List of feedback records with confidence_snapshot.
        current_threshold: Current confidence threshold.
        target_tp_retention: Minimum TP retention rate to maintain.

    Returns:
        Analysis results with recommended threshold.
    """
    if not feedback:
        return {
            "samples_analyzed": 0,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Extract confidence scores by type
    tp_scores = [
        f["confidence_snapshot"]
        for f in feedback
        if f["feedback_type"] == "true_positive" and f.get("confidence_snapshot") is not None
    ]
    fp_scores = [
        f["confidence_snapshot"]
        for f in feedback
        if f["feedback_type"] == "false_positive" and f.get("confidence_snapshot") is not None
    ]

    total = len(tp_scores) + len(fp_scores)
    if total == 0:
        return {
            "samples_analyzed": 0,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Current rates (assuming all samples passed current threshold)
    current_fp_rate = len(fp_scores) / total
    current_tp_rate = len(tp_scores) / total

    # If no FPs, keep current threshold
    if len(fp_scores) == 0:
        return {
            "samples_analyzed": total,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 1.0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Search for optimal threshold
    # Try thresholds from 0.50 to 0.95 in 0.01 increments
    best_threshold = current_threshold
    best_fp_rate = current_fp_rate
    best_tp_retention = 1.0

    for thresh in np.arange(0.50, 0.96, 0.01):
        # Count how many would pass at this threshold
        tp_passing = sum(1 for s in tp_scores if s >= thresh)
        fp_passing = sum(1 for s in fp_scores if s >= thresh)

        # Calculate rates
        tp_retention = tp_passing / len(tp_scores) if tp_scores else 1.0
        new_total = tp_passing + fp_passing
        new_fp_rate = fp_passing / new_total if new_total > 0 else 0

        # Check if this threshold meets our constraints and improves FP rate
        if tp_retention >= target_tp_retention and new_fp_rate < best_fp_rate:
            best_threshold = thresh
            best_fp_rate = new_fp_rate
            best_tp_retention = tp_retention

    return {
        "samples_analyzed": total,
        "current_threshold": current_threshold,
        "recommended_threshold": round(best_threshold, 2),
        "current_fp_rate": round(current_fp_rate, 3),
        "current_tp_rate": round(current_tp_rate, 3),
        "projected_fp_rate": round(best_fp_rate, 3),
        "projected_tp_retention": round(best_tp_retention, 3),
    }


def analyze_weights(
    feedback: list[dict[str, Any]],
    min_samples: int = 50,
) -> dict[str, Any]:
    """Stage 2: Learn optimal feature weights using logistic regression.

    Args:
        feedback: List of feedback records with detection_features.
        min_samples: Minimum samples required for training.

    Returns:
        Analysis results with learned weights.
    """
    # Filter to samples with detection features
    valid_feedback = [
        f for f in feedback
        if f.get("detection_features") and isinstance(f["detection_features"], dict)
    ]

    if len(valid_feedback) < min_samples:
        return {
            "samples_analyzed": len(valid_feedback),
            "learned_weights": None,
            "error": f"Insufficient samples: {len(valid_feedback)} < {min_samples} required",
        }

    # Build feature matrix and labels
    X = []
    y = []

    for f in valid_feedback:
        features = f["detection_features"]

        # Extract features in consistent order
        row = []
        for key, name in FEATURE_KEY_MAP.items():
            value = features.get(key, 0.5)  # Default to 0.5 if missing
            row.append(value)

        X.append(row)
        y.append(1 if f["feedback_type"] == "true_positive" else 0)

    X = np.array(X)
    y = np.array(y)

    # Standardize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train logistic regression
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_scaled, y)

    # Convert coefficients to weights (normalize to sum to 1)
    coefs = np.abs(model.coef_[0])
    weights = coefs / coefs.sum()

    # Build weight dictionary
    learned_weights = {}
    for i, name in enumerate(FEATURE_KEY_MAP.values()):
        learned_weights[name] = round(float(weights[i]), 3)

    # Calculate model accuracy on training data
    accuracy = model.score(X_scaled, y)

    return {
        "samples_analyzed": len(valid_feedback),
        "learned_weights": learned_weights,
        "model_accuracy": round(accuracy, 3),
        "feature_importances": {
            name: round(float(coefs[i]), 3)
            for i, name in enumerate(FEATURE_KEY_MAP.values())
        },
    }
