"""ML configuration loading and saving."""

import copy
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

# Config file location
ML_CONFIG_PATH = Path.home() / ".golfclip" / "ml_config.json"

# Default configuration
DEFAULT_CONFIG = {
    "version": 1,
    "confidence_threshold": 0.70,
    "feature_weights": {
        "height": 0.20,
        "flatness": 0.10,
        "centroid": 0.15,
        "prominence": 0.15,
        "rise": 0.10,
        "decay": 0.20,
        "zcr": 0.10,
    },
    "calibration_model": None,
    "updated_at": None,
    "update_history": [],
}


def load_ml_config() -> dict[str, Any]:
    """Load ML configuration from disk, or return defaults.

    Returns:
        Configuration dictionary.
    """
    if ML_CONFIG_PATH.exists():
        try:
            with open(ML_CONFIG_PATH) as f:
                config = json.load(f)
                logger.debug(f"Loaded ML config from {ML_CONFIG_PATH}")
                return config
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Failed to load ML config: {e}, using defaults")

    return copy.deepcopy(DEFAULT_CONFIG)


def save_ml_config(config: dict[str, Any]) -> None:
    """Save ML configuration to disk, creating backup of existing.

    Args:
        config: Configuration dictionary to save.
    """
    ML_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Create backup if file exists
    if ML_CONFIG_PATH.exists():
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
        backup_path = ML_CONFIG_PATH.parent / f"ml_config.backup.{timestamp}.json"
        ML_CONFIG_PATH.rename(backup_path)
        logger.info(f"Created backup: {backup_path}")

    # Update timestamp
    config["updated_at"] = datetime.utcnow().isoformat()

    # Save
    with open(ML_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

    logger.info(f"Saved ML config to {ML_CONFIG_PATH}")


def get_backup_files() -> list[Path]:
    """Get list of backup config files, sorted by date (newest first).

    Returns:
        List of backup file paths.
    """
    if not ML_CONFIG_PATH.parent.exists():
        return []

    backups = list(ML_CONFIG_PATH.parent.glob("ml_config.backup.*.json"))
    return sorted(backups, reverse=True)


def restore_backup(backup_path: Path) -> dict[str, Any]:
    """Restore configuration from a backup file.

    Args:
        backup_path: Path to backup file.

    Returns:
        Restored configuration dictionary.
    """
    with open(backup_path) as f:
        config = json.load(f)

    save_ml_config(config)
    logger.info(f"Restored config from {backup_path}")

    return config
