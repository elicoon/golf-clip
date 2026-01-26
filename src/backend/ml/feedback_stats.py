"""Feedback statistics and trend analysis."""

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from backend.models.job import get_all_feedback


async def get_feedback_summary(env_filter: str = "all") -> dict[str, Any]:
    """Get summary of all feedback, optionally filtered by environment.

    Args:
        env_filter: 'prod', 'dev', or 'all'

    Returns:
        Summary dictionary with counts by environment.
    """
    all_feedback = await get_all_feedback(limit=10000)

    # Filter if needed
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    # Count by environment
    summary = {
        "total": len(all_feedback),
        "prod": {"total": 0, "tp": 0, "fp": 0},
        "dev": {"total": 0, "tp": 0, "fp": 0},
    }

    for f in all_feedback:
        env = f.get("environment", "prod")
        if env not in summary:
            summary[env] = {"total": 0, "tp": 0, "fp": 0}

        summary[env]["total"] += 1
        if f["feedback_type"] == "true_positive":
            summary[env]["tp"] += 1
        else:
            summary[env]["fp"] += 1

    return summary


def get_available_stages(summary: dict[str, Any]) -> dict[str, Any]:
    """Determine which ML stages are available based on sample count.

    Args:
        summary: Feedback summary from get_feedback_summary().

    Returns:
        Dictionary with stage availability and requirements.
    """
    prod_count = summary.get("prod", {}).get("total", 0)

    return {
        "stage_1": {
            "name": "Threshold Tuning",
            "min_samples": 10,
            "available": prod_count >= 10,
            "samples_needed": max(0, 10 - prod_count),
        },
        "stage_2": {
            "name": "Weight Optimization",
            "min_samples": 50,
            "available": prod_count >= 50,
            "samples_needed": max(0, 50 - prod_count),
        },
        "stage_3": {
            "name": "Confidence Recalibration",
            "min_samples": 200,
            "available": prod_count >= 200,
            "samples_needed": max(0, 200 - prod_count),
        },
    }


async def get_weekly_trend(weeks: int = 4, env_filter: str = "prod") -> list[dict[str, Any]]:
    """Get weekly FP rate trend.

    Args:
        weeks: Number of weeks to include.
        env_filter: Environment to filter by.

    Returns:
        List of weekly stats, oldest first.
    """
    all_feedback = await get_all_feedback(limit=10000)

    # Filter by environment
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    # Group by week
    weekly = defaultdict(lambda: {"tp": 0, "fp": 0})
    now = datetime.utcnow()

    for f in all_feedback:
        created = datetime.fromisoformat(f["created_at"].replace("Z", "+00:00").replace("+00:00", ""))
        days_ago = (now - created).days
        week_num = days_ago // 7

        if week_num < weeks:
            if f["feedback_type"] == "true_positive":
                weekly[week_num]["tp"] += 1
            else:
                weekly[week_num]["fp"] += 1

    # Build trend list
    trend = []
    for week_num in range(weeks - 1, -1, -1):
        data = weekly[week_num]
        total = data["tp"] + data["fp"]
        fp_rate = data["fp"] / total if total > 0 else 0

        week_start = now - timedelta(days=(week_num + 1) * 7)

        trend.append({
            "week_of": week_start.strftime("%Y-%m-%d"),
            "total": total,
            "tp": data["tp"],
            "fp": data["fp"],
            "fp_rate": round(fp_rate, 3),
        })

    return trend


def print_stats(summary: dict, stages: dict, trend: list | None = None) -> None:
    """Print formatted stats to console.

    Args:
        summary: Feedback summary.
        stages: Available stages.
        trend: Optional weekly trend data.
    """
    print(f"\nTotal feedback: {summary['total']} samples")

    for env in ["prod", "dev"]:
        data = summary.get(env, {"total": 0, "tp": 0, "fp": 0})
        if data["total"] > 0:
            precision = data["tp"] / data["total"]
            print(f"  {env}: {data['total']} ({data['tp']} TP, {data['fp']} FP) - precision {precision:.1%}")

    print("\nAvailable stages:")
    for stage_id, stage in stages.items():
        if stage["available"]:
            print(f"  ✓ {stage_id}: {stage['name']} ({stage['min_samples']}+ samples) - READY")
        else:
            print(f"  ✗ {stage_id}: {stage['name']} ({stage['min_samples']}+ samples) - need {stage['samples_needed']} more")

    if trend:
        print("\nWeekly FP Rate Trend (prod only):")
        for week in trend:
            if week["total"] > 0:
                print(f"  Week of {week['week_of']}: {week['fp_rate']:.0%} FP ({week['fp']}/{week['total']} shots skipped)")
            else:
                print(f"  Week of {week['week_of']}: no data")


async def main(show_trend: bool = False, env_filter: str = "prod") -> None:
    """Main entry point for CLI."""
    from backend.core.database import init_db

    await init_db()

    summary = await get_feedback_summary()
    stages = get_available_stages(summary)

    trend = None
    if show_trend:
        trend = await get_weekly_trend(env_filter=env_filter)

    print_stats(summary, stages, trend)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="View feedback statistics")
    parser.add_argument("--trend", action="store_true", help="Show weekly FP rate trend")
    parser.add_argument("--env", choices=["prod", "dev", "all"], default="prod", help="Environment filter")

    args = parser.parse_args()

    asyncio.run(main(show_trend=args.trend, env_filter=args.env))
