"""Tests for ML config loading and saving."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest


class TestMLConfig:
    """Tests for ML configuration management."""

    def test_load_default_config(self, tmp_path):
        """Should return defaults when no config file exists."""
        with patch("backend.ml.config.ML_CONFIG_PATH", tmp_path / "ml_config.json"):
            from backend.ml.config import load_ml_config

            config = load_ml_config()

            assert config["confidence_threshold"] == 0.70
            assert "feature_weights" in config
            assert config["calibration_model"] is None

    def test_save_and_load_config(self, tmp_path):
        """Should persist config to disk and load it back."""
        config_path = tmp_path / "ml_config.json"

        with patch("backend.ml.config.ML_CONFIG_PATH", config_path):
            from backend.ml.config import load_ml_config, save_ml_config

            # Modify and save
            config = load_ml_config()
            config["confidence_threshold"] = 0.85
            save_ml_config(config)

            # Load fresh
            loaded = load_ml_config()
            assert loaded["confidence_threshold"] == 0.85

    def test_save_creates_backup(self, tmp_path):
        """Saving should create a timestamped backup of existing config."""
        config_path = tmp_path / "ml_config.json"

        with patch("backend.ml.config.ML_CONFIG_PATH", config_path):
            from backend.ml.config import load_ml_config, save_ml_config

            # Save initial config
            config = load_ml_config()
            save_ml_config(config)

            # Save again - should create backup
            config["confidence_threshold"] = 0.90
            save_ml_config(config)

            # Check backup exists
            backups = list(tmp_path.glob("ml_config.backup.*.json"))
            assert len(backups) >= 1
