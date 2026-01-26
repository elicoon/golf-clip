"""ML stage implementations for feedback-driven improvement."""

from typing import Any

import numpy as np
from loguru import logger


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
