"""Tests for tracer feedback ML analysis functions."""

import pytest

from backend.ml.tracer_analysis import (
    compute_delta,
    analyze_common_adjustments,
    suggest_default_params,
)


class TestComputeDelta:
    """Tests for compute_delta function."""

    def test_compute_delta_with_changes(self):
        """Test delta computation when user made changes."""
        auto_params = {
            "height": "medium",
            "shape": "straight",
            "flight_time": 3.0,
        }
        final_params = {
            "height": "high",
            "shape": "draw",
            "flight_time": 4.5,
        }

        delta = compute_delta(auto_params, final_params)

        assert delta is not None
        # Height changed: medium -> high (+1 ordinal)
        assert delta["height"]["from"] == "medium"
        assert delta["height"]["to"] == "high"
        assert delta["height"]["change"] == "+1"

        # Shape changed
        assert delta["shape"]["from"] == "straight"
        assert delta["shape"]["to"] == "draw"

        # Flight time changed
        assert delta["flight_time"]["from"] == 3.0
        assert delta["flight_time"]["to"] == 4.5
        assert delta["flight_time"]["change"] == 1.5

    def test_compute_delta_height_ordinal_up(self):
        """Test height ordinal computation for increases."""
        auto = {"height": "low"}
        final = {"height": "medium"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "+1"

        auto = {"height": "low"}
        final = {"height": "high"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "+2"

        auto = {"height": "medium"}
        final = {"height": "high"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "+1"

    def test_compute_delta_height_ordinal_down(self):
        """Test height ordinal computation for decreases."""
        auto = {"height": "high"}
        final = {"height": "medium"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "-1"

        auto = {"height": "high"}
        final = {"height": "low"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "-2"

        auto = {"height": "medium"}
        final = {"height": "low"}
        delta = compute_delta(auto, final)
        assert delta["height"]["change"] == "-1"

    def test_compute_delta_no_changes(self):
        """Test delta when params are identical."""
        params = {
            "height": "medium",
            "shape": "straight",
            "flight_time": 3.0,
        }
        delta = compute_delta(params, params.copy())
        # No changes, should return empty dict (not None)
        assert delta == {}

    def test_compute_delta_auto_accepted(self):
        """Test delta when final_params is None (auto-accepted)."""
        auto_params = {
            "height": "medium",
            "shape": "straight",
            "flight_time": 3.0,
        }
        delta = compute_delta(auto_params, None)
        assert delta is None

    def test_compute_delta_no_auto_params(self):
        """Test delta when auto_params is None."""
        final_params = {
            "height": "high",
            "shape": "draw",
            "flight_time": 4.5,
        }
        delta = compute_delta(None, final_params)
        assert delta is None

    def test_compute_delta_both_none(self):
        """Test delta when both are None."""
        delta = compute_delta(None, None)
        assert delta is None

    def test_compute_delta_partial_change(self):
        """Test delta when only some params changed."""
        auto_params = {
            "height": "medium",
            "shape": "straight",
            "flight_time": 3.0,
        }
        final_params = {
            "height": "medium",  # no change
            "shape": "draw",  # changed
            "flight_time": 3.0,  # no change
        }

        delta = compute_delta(auto_params, final_params)

        assert "height" not in delta  # unchanged, not included
        assert delta["shape"]["from"] == "straight"
        assert delta["shape"]["to"] == "draw"
        assert "flight_time" not in delta  # unchanged, not included

    def test_compute_delta_starting_line(self):
        """Test delta for starting_line parameter."""
        auto = {"starting_line": "center"}
        final = {"starting_line": "left"}
        delta = compute_delta(auto, final)

        assert delta["starting_line"]["from"] == "center"
        assert delta["starting_line"]["to"] == "left"

    def test_compute_delta_flight_time_negative_change(self):
        """Test flight_time delta with decrease."""
        auto = {"flight_time": 4.0}
        final = {"flight_time": 2.5}
        delta = compute_delta(auto, final)

        assert delta["flight_time"]["from"] == 4.0
        assert delta["flight_time"]["to"] == 2.5
        assert delta["flight_time"]["change"] == -1.5


class TestAnalyzeCommonAdjustments:
    """Tests for analyze_common_adjustments function."""

    def test_analyze_common_adjustments_basic(self):
        """Test basic adjustment analysis."""
        feedback_records = [
            {
                "auto_params": {"height": "medium", "shape": "straight"},
                "final_params": {"height": "high", "shape": "draw"},
            },
            {
                "auto_params": {"height": "medium", "shape": "straight"},
                "final_params": {"height": "high", "shape": "draw"},
            },
            {
                "auto_params": {"height": "low", "shape": "draw"},
                "final_params": {"height": "medium", "shape": "fade"},
            },
        ]

        result = analyze_common_adjustments(feedback_records)

        # Height analysis
        assert result["height"]["total_changes"] == 3
        assert result["height"]["changes_up"] == 3  # all increased
        assert result["height"]["changes_down"] == 0
        assert result["height"]["most_common"] == ("medium", "high", 2)

        # Shape analysis
        assert result["shape"]["total_changes"] == 3
        assert result["shape"]["most_common"] == ("straight", "draw", 2)

    def test_analyze_common_adjustments_mixed_directions(self):
        """Test analysis with both up and down height changes."""
        feedback_records = [
            # Height up
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
            {"auto_params": {"height": "low"}, "final_params": {"height": "medium"}},
            # Height down
            {"auto_params": {"height": "high"}, "final_params": {"height": "medium"}},
        ]

        result = analyze_common_adjustments(feedback_records)

        assert result["height"]["total_changes"] == 3
        assert result["height"]["changes_up"] == 2
        assert result["height"]["changes_down"] == 1

    def test_analyze_common_adjustments_with_auto_accepted(self):
        """Test analysis ignores auto-accepted records (final_params is None)."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
            {"auto_params": {"height": "medium"}, "final_params": None},  # auto-accepted
            {"auto_params": {"height": "low"}, "final_params": {"height": "high"}},
        ]

        result = analyze_common_adjustments(feedback_records)

        # Only 2 records have changes
        assert result["height"]["total_changes"] == 2

    def test_analyze_common_adjustments_empty_records(self):
        """Test analysis with empty records list."""
        result = analyze_common_adjustments([])
        # Should return empty dict for each parameter type
        assert result == {}

    def test_analyze_common_adjustments_all_auto_accepted(self):
        """Test analysis when all records are auto-accepted."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": None},
            {"auto_params": {"height": "low"}, "final_params": None},
        ]

        result = analyze_common_adjustments(feedback_records)
        # No changes to analyze
        assert result == {}

    def test_analyze_common_adjustments_flight_time(self):
        """Test analysis of flight_time parameter."""
        feedback_records = [
            {"auto_params": {"flight_time": 3.0}, "final_params": {"flight_time": 4.0}},
            {"auto_params": {"flight_time": 3.0}, "final_params": {"flight_time": 3.5}},
            {"auto_params": {"flight_time": 3.0}, "final_params": {"flight_time": 2.5}},
        ]

        result = analyze_common_adjustments(feedback_records)

        assert result["flight_time"]["total_changes"] == 3
        assert result["flight_time"]["changes_up"] == 2  # 2 increases
        assert result["flight_time"]["changes_down"] == 1  # 1 decrease
        # Average change or median could be computed

    def test_analyze_common_adjustments_no_change_in_param(self):
        """Test that params with no changes are not included."""
        feedback_records = [
            {
                "auto_params": {"height": "medium", "shape": "straight"},
                "final_params": {"height": "medium", "shape": "draw"},  # only shape changed
            },
        ]

        result = analyze_common_adjustments(feedback_records)

        assert "shape" in result
        assert "height" not in result  # no change


class TestSuggestDefaultParams:
    """Tests for suggest_default_params function."""

    def test_suggest_default_params_clear_pattern(self):
        """Test suggestions with clear user preference pattern."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}}
            for _ in range(20)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        assert "height" in result
        assert result["height"]["value"] == "high"
        assert result["height"]["confidence"] > 0.7
        assert result["height"]["samples"] == 20

    def test_suggest_default_params_insufficient_samples(self):
        """Test that insufficient samples returns empty dict."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}}
            for _ in range(5)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        # Not enough samples for any confident suggestions
        assert result == {}

    def test_suggest_default_params_mixed_preferences(self):
        """Test with mixed user preferences results in lower confidence."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}}
            for _ in range(6)
        ] + [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "low"}}
            for _ in range(4)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        assert "height" in result
        assert result["height"]["value"] == "high"  # majority
        # Confidence should be lower due to mixed preferences
        assert result["height"]["confidence"] < 0.8

    def test_suggest_default_params_empty_records(self):
        """Test with empty records returns empty dict."""
        result = suggest_default_params([], min_samples=10)
        assert result == {}

    def test_suggest_default_params_all_auto_accepted(self):
        """Test when all records are auto-accepted."""
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": None}
            for _ in range(15)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        # No changes made, so current defaults are good
        assert result == {}

    def test_suggest_default_params_flight_time_numeric(self):
        """Test flight_time suggestions compute average/median."""
        feedback_records = [
            {"auto_params": {"flight_time": 3.0}, "final_params": {"flight_time": 4.0}}
            for _ in range(10)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        assert "flight_time" in result
        # Should suggest 4.0 as the average/common value
        assert result["flight_time"]["value"] == 4.0
        assert result["flight_time"]["samples"] == 10

    def test_suggest_default_params_multiple_params(self):
        """Test suggestions for multiple parameters."""
        feedback_records = [
            {
                "auto_params": {"height": "medium", "shape": "straight", "flight_time": 3.0},
                "final_params": {"height": "high", "shape": "draw", "flight_time": 3.5},
            }
            for _ in range(15)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        assert "height" in result
        assert result["height"]["value"] == "high"

        assert "shape" in result
        assert result["shape"]["value"] == "draw"

        assert "flight_time" in result
        assert result["flight_time"]["value"] == 3.5

    def test_suggest_default_params_respects_min_samples_per_param(self):
        """Test that min_samples applies per parameter."""
        # 15 samples for height changes, only 5 for shape changes
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}}
            for _ in range(15)
        ] + [
            {"auto_params": {"shape": "straight"}, "final_params": {"shape": "draw"}}
            for _ in range(5)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        # height should be suggested (15 > 10)
        assert "height" in result
        # shape should NOT be suggested (5 < 10)
        assert "shape" not in result

    def test_suggest_default_params_no_change_high_confidence(self):
        """Test that if users rarely change a param, we might suggest keeping current."""
        # Many auto-accepts + few changes means current default is good
        feedback_records = [
            {"auto_params": {"height": "medium"}, "final_params": None}  # auto-accept
            for _ in range(45)
        ] + [
            {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}}
            for _ in range(5)
        ]

        result = suggest_default_params(feedback_records, min_samples=10)

        # 90% auto-accepted, only 5 changes - insufficient changes for suggestion
        assert "height" not in result


class TestIntegration:
    """Integration tests for analysis functions."""

    def test_full_analysis_workflow(self):
        """Test the complete analysis workflow."""
        # Simulate real-world feedback data
        feedback_records = [
            # Users tend to increase height and prefer draw
            {"auto_params": {"height": "medium", "shape": "straight", "flight_time": 3.0},
             "final_params": {"height": "high", "shape": "draw", "flight_time": 3.5}}
            for _ in range(25)
        ] + [
            # Some auto-accepts (happy with defaults)
            {"auto_params": {"height": "medium", "shape": "straight", "flight_time": 3.0},
             "final_params": None}
            for _ in range(10)
        ] + [
            # Some prefer fade and lower height
            {"auto_params": {"height": "medium", "shape": "straight", "flight_time": 3.0},
             "final_params": {"height": "low", "shape": "fade", "flight_time": 2.5}}
            for _ in range(5)
        ]

        # Analyze adjustments
        adjustments = analyze_common_adjustments(feedback_records)
        assert adjustments["height"]["total_changes"] == 30  # 25 + 5 (excludes auto-accepts)
        assert adjustments["height"]["changes_up"] == 25
        assert adjustments["height"]["changes_down"] == 5

        # Get suggestions
        suggestions = suggest_default_params(feedback_records, min_samples=10)
        assert suggestions["height"]["value"] == "high"  # majority preference
        assert suggestions["shape"]["value"] == "draw"  # majority preference
