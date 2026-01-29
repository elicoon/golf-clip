"""Tracer feedback ML analysis functions.

Analyzes user corrections to auto-generated trajectory parameters
to suggest better defaults and identify patterns.
"""

from collections import Counter, defaultdict
from typing import Any, Optional


# Height ordinal mapping for computing change direction
HEIGHT_ORDINAL = {"low": 0, "medium": 1, "high": 2}


def compute_delta(
    auto_params: Optional[dict[str, Any]],
    final_params: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Compute the difference between auto-generated and user-configured params.

    Args:
        auto_params: The auto-generated trajectory parameters.
        final_params: The user's final configured parameters.

    Returns:
        Dict with changes for each modified parameter, or None if:
        - final_params is None (auto-accepted)
        - auto_params is None (no auto-generation occurred)
        - both are None

        For unchanged params, returns an empty dict.

    Example:
        >>> auto = {"height": "medium", "shape": "straight", "flight_time": 3.0}
        >>> final = {"height": "high", "shape": "draw", "flight_time": 4.5}
        >>> compute_delta(auto, final)
        {
            "height": {"from": "medium", "to": "high", "change": "+1"},
            "shape": {"from": "straight", "to": "draw"},
            "flight_time": {"from": 3.0, "to": 4.5, "change": 1.5}
        }
    """
    if auto_params is None or final_params is None:
        return None

    deltas = {}
    all_keys = set(auto_params.keys()) | set(final_params.keys())

    for key in all_keys:
        auto_val = auto_params.get(key)
        final_val = final_params.get(key)

        if auto_val == final_val:
            continue  # No change

        delta_entry: dict[str, Any] = {
            "from": auto_val,
            "to": final_val,
        }

        # Compute ordinal change for height
        if key == "height" and auto_val in HEIGHT_ORDINAL and final_val in HEIGHT_ORDINAL:
            change = HEIGHT_ORDINAL[final_val] - HEIGHT_ORDINAL[auto_val]
            delta_entry["change"] = f"+{change}" if change > 0 else str(change)

        # Compute numeric change for flight_time
        elif key == "flight_time" and isinstance(auto_val, (int, float)) and isinstance(final_val, (int, float)):
            delta_entry["change"] = round(final_val - auto_val, 2)

        deltas[key] = delta_entry

    return deltas


def analyze_common_adjustments(feedback_records: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze patterns in how users adjust auto-generated params.

    Args:
        feedback_records: List of feedback records, each containing:
            - auto_params: The auto-generated parameters
            - final_params: The user's final parameters (None if auto-accepted)

    Returns:
        Dict with per-parameter statistics:
        {
            "height": {
                "total_changes": 45,
                "changes_up": 35,     # medium->high, low->medium, etc.
                "changes_down": 10,   # high->medium, etc.
                "most_common": ("medium", "high", 25),  # from, to, count
            },
            "shape": {
                "total_changes": 30,
                "most_common": ("straight", "draw", 18),
            },
            ...
        }

        Returns empty dict if no changes found.
    """
    # Track changes per parameter
    param_changes: dict[str, list[tuple[Any, Any]]] = defaultdict(list)

    for record in feedback_records:
        auto_params = record.get("auto_params")
        final_params = record.get("final_params")

        delta = compute_delta(auto_params, final_params)
        if delta is None or not delta:
            continue

        for param_name, change_info in delta.items():
            from_val = change_info["from"]
            to_val = change_info["to"]
            param_changes[param_name].append((from_val, to_val))

    if not param_changes:
        return {}

    result = {}

    for param_name, changes in param_changes.items():
        total_changes = len(changes)

        # Count transition patterns
        transition_counts = Counter(changes)
        most_common_transition = transition_counts.most_common(1)[0]
        most_common = (
            most_common_transition[0][0],  # from
            most_common_transition[0][1],  # to
            most_common_transition[1],     # count
        )

        param_result: dict[str, Any] = {
            "total_changes": total_changes,
            "most_common": most_common,
        }

        # Compute direction for ordinal/numeric params
        if param_name == "height":
            changes_up = 0
            changes_down = 0
            for from_val, to_val in changes:
                if from_val in HEIGHT_ORDINAL and to_val in HEIGHT_ORDINAL:
                    change = HEIGHT_ORDINAL[to_val] - HEIGHT_ORDINAL[from_val]
                    if change > 0:
                        changes_up += 1
                    elif change < 0:
                        changes_down += 1
            param_result["changes_up"] = changes_up
            param_result["changes_down"] = changes_down

        elif param_name == "flight_time":
            changes_up = sum(1 for f, t in changes if isinstance(f, (int, float)) and isinstance(t, (int, float)) and t > f)
            changes_down = sum(1 for f, t in changes if isinstance(f, (int, float)) and isinstance(t, (int, float)) and t < f)
            param_result["changes_up"] = changes_up
            param_result["changes_down"] = changes_down

        result[param_name] = param_result

    return result


def suggest_default_params(
    feedback_records: list[dict[str, Any]],
    min_samples: int = 10,
) -> dict[str, Any]:
    """Suggest better default params based on user feedback patterns.

    Analyzes what values users most commonly change parameters TO,
    and suggests those as new defaults.

    Args:
        feedback_records: List of feedback records with auto_params and final_params.
        min_samples: Minimum number of samples needed for a confident suggestion.

    Returns:
        Suggested defaults with confidence for each parameter:
        {
            "height": {"value": "high", "confidence": 0.78, "samples": 45},
            "shape": {"value": "draw", "confidence": 0.60, "samples": 30},
            "flight_time": {"value": 3.5, "confidence": 0.65, "samples": 50},
        }

        Returns empty dict if insufficient samples or no clear patterns.
    """
    if not feedback_records:
        return {}

    # Track what values users change parameters TO
    param_target_values: dict[str, list[Any]] = defaultdict(list)

    for record in feedback_records:
        auto_params = record.get("auto_params")
        final_params = record.get("final_params")

        delta = compute_delta(auto_params, final_params)
        if delta is None or not delta:
            continue

        for param_name, change_info in delta.items():
            to_val = change_info["to"]
            param_target_values[param_name].append(to_val)

    if not param_target_values:
        return {}

    suggestions = {}

    for param_name, target_values in param_target_values.items():
        samples = len(target_values)

        # Skip if insufficient samples
        if samples < min_samples:
            continue

        # For numeric params (flight_time), compute most common value
        if param_name == "flight_time":
            value_counts = Counter(target_values)
            most_common_val, most_common_count = value_counts.most_common(1)[0]
            confidence = most_common_count / samples
            suggestions[param_name] = {
                "value": most_common_val,
                "confidence": round(confidence, 2),
                "samples": samples,
            }
        else:
            # For categorical params, use mode (most common value)
            value_counts = Counter(target_values)
            most_common_val, most_common_count = value_counts.most_common(1)[0]
            confidence = most_common_count / samples

            suggestions[param_name] = {
                "value": most_common_val,
                "confidence": round(confidence, 2),
                "samples": samples,
            }

    return suggestions
