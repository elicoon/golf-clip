"""ML analysis and apply CLI."""

import argparse
import asyncio
from typing import Optional

from loguru import logger

from backend.core.database import init_db
from backend.models.job import get_all_feedback
from backend.ml.config import load_ml_config, save_ml_config
from backend.ml.stages import analyze_threshold, analyze_weights, analyze_calibration


async def run_analysis(
    stage: int,
    env_filter: str = "prod",
    dry_run: bool = True,
) -> dict:
    """Run ML analysis for a specific stage.

    Args:
        stage: Stage number (1, 2, or 3).
        env_filter: Environment filter ('prod', 'dev', 'all').
        dry_run: If True, don't apply changes.

    Returns:
        Analysis results.
    """
    logger.info(f"Starting ML analysis: stage={stage}, env={env_filter}, dry_run={dry_run}")

    await init_db()

    # Get feedback data
    all_feedback = await get_all_feedback(limit=10000)

    # Filter by environment
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    print(f"\nAnalyzing {len(all_feedback)} feedback samples ({env_filter} environment)")
    logger.info(f"Loaded {len(all_feedback)} feedback samples for analysis")

    config = load_ml_config()

    try:
        if stage == 1:
            result = analyze_threshold(all_feedback, current_threshold=config["confidence_threshold"])

            print(f"\n=== Stage 1: Threshold Tuning ===")
            print(f"Samples analyzed: {result['samples_analyzed']}")
            print(f"Current threshold: {result['current_threshold']}")
            print(f"Recommended threshold: {result['recommended_threshold']}")
            print(f"\nProjected impact:")
            print(f"  FP rate: {result['current_fp_rate']:.1%} → {result['projected_fp_rate']:.1%}")
            print(f"  TP retention: {result['projected_tp_retention']:.1%}")

            if not dry_run and result["recommended_threshold"] != config["confidence_threshold"]:
                old_threshold = config["confidence_threshold"]
                config["confidence_threshold"] = result["recommended_threshold"]
                config["update_history"].append({
                    "stage": 1,
                    "change": {"confidence_threshold": {"old": old_threshold, "new": result["recommended_threshold"]}},
                    "samples_used": result["samples_analyzed"],
                })
                save_ml_config(config)
                logger.info(f"Applied confidence_threshold: {old_threshold} -> {result['recommended_threshold']}")
                print(f"\n✓ Applied: confidence_threshold updated to {result['recommended_threshold']}")
            elif dry_run:
                print(f"\nTo apply: python -m backend.ml.analyze analyze --stage 1 --apply")

        elif stage == 2:
            result = analyze_weights(all_feedback)

            print(f"\n=== Stage 2: Weight Optimization ===")
            print(f"Samples analyzed: {result['samples_analyzed']}")

            if result["learned_weights"]:
                print(f"Model accuracy: {result['model_accuracy']:.1%}")
                print(f"\nLearned weights:")
                for name, weight in result["learned_weights"].items():
                    current = config["feature_weights"].get(name, "N/A")
                    print(f"  {name}: {current} → {weight}")

                if not dry_run:
                    old_weights = config["feature_weights"].copy()
                    config["feature_weights"] = result["learned_weights"]
                    config["update_history"].append({
                        "stage": 2,
                        "change": {"feature_weights": {"old": old_weights, "new": result["learned_weights"]}},
                        "samples_used": result["samples_analyzed"],
                    })
                    save_ml_config(config)
                    logger.info(f"Applied feature_weights update")
                    print(f"\n✓ Applied: feature_weights updated")
                elif dry_run:
                    print(f"\nTo apply: python -m backend.ml.analyze analyze --stage 2 --apply")
            else:
                print(f"Error: {result.get('error', 'Unknown error')}")

        elif stage == 3:
            result = analyze_calibration(all_feedback)

            print(f"\n=== Stage 3: Confidence Recalibration ===")
            print(f"Samples analyzed: {result['samples_analyzed']}")

            if result["calibration_map"]:
                print(f"\nSample calibrations:")
                for conf in ["0.60", "0.70", "0.80", "0.90"]:
                    if conf in result["calibration_map"]:
                        print(f"  Raw {conf} → Calibrated {result['calibration_map'][conf]}")

                if not dry_run:
                    config["calibration_model"] = result["calibration_map"]
                    config["update_history"].append({
                        "stage": 3,
                        "change": {"calibration_model": "updated"},
                        "samples_used": result["samples_analyzed"],
                    })
                    save_ml_config(config)
                    logger.info(f"Applied calibration_model update")
                    print(f"\n✓ Applied: calibration_model updated")
                elif dry_run:
                    print(f"\nTo apply: python -m backend.ml.analyze analyze --stage 3 --apply")
            else:
                print(f"Error: {result.get('error', 'Unknown error')}")

        else:
            logger.error(f"Invalid stage: {stage}")
            return {"error": f"Invalid stage: {stage}"}

    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        print(f"\nError: Analysis failed - {e}")
        return {"error": str(e)}

    return result


async def rollback(backup_file: Optional[str] = None) -> None:
    """Rollback to previous configuration.

    Args:
        backup_file: Specific backup file to restore, or None for latest.
    """
    from backend.ml.config import get_backup_files, restore_backup

    backups = get_backup_files()

    if not backups:
        print("No backups found")
        return

    if backup_file:
        from pathlib import Path
        backup_path = Path(backup_file)
        if not backup_path.exists():
            print(f"Backup file not found: {backup_file}")
            return
    else:
        backup_path = backups[0]
        print(f"Restoring latest backup: {backup_path}")

    restore_backup(backup_path)
    print(f"✓ Restored configuration from {backup_path}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ML analysis and optimization")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Run analysis")
    analyze_parser.add_argument("--stage", type=int, choices=[1, 2, 3], required=True, help="Stage to run")
    analyze_parser.add_argument("--env", choices=["prod", "dev", "all"], default="prod", help="Environment filter")
    analyze_parser.add_argument("--apply", action="store_true", help="Apply changes (default: dry run)")

    # Rollback command
    rollback_parser = subparsers.add_parser("rollback", help="Rollback to previous config")
    rollback_parser.add_argument("--file", type=str, help="Specific backup file to restore")

    args = parser.parse_args()

    if args.command == "analyze":
        asyncio.run(run_analysis(stage=args.stage, env_filter=args.env, dry_run=not args.apply))
    elif args.command == "rollback":
        asyncio.run(rollback(backup_file=args.file))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
