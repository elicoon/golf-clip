"""Tests for ML config loading and saving."""

import importlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest


class TestMLConfig:
    """Tests for ML configuration management."""

    def test_load_default_config(self, tmp_path):
        """Should return defaults when no config file exists."""
        import backend.ml.config
        importlib.reload(backend.ml.config)

        with patch.object(backend.ml.config, "ML_CONFIG_PATH", tmp_path / "ml_config.json"):
            config = backend.ml.config.load_ml_config()

            assert config["confidence_threshold"] == 0.70
            assert "feature_weights" in config
            assert config["calibration_model"] is None

    def test_save_and_load_config(self, tmp_path):
        """Should persist config to disk and load it back."""
        config_path = tmp_path / "ml_config.json"

        import backend.ml.config
        importlib.reload(backend.ml.config)

        with patch.object(backend.ml.config, "ML_CONFIG_PATH", config_path):
            # Modify and save
            config = backend.ml.config.load_ml_config()
            config["confidence_threshold"] = 0.85
            backend.ml.config.save_ml_config(config)

            # Load fresh
            loaded = backend.ml.config.load_ml_config()
            assert loaded["confidence_threshold"] == 0.85

    def test_save_creates_backup(self, tmp_path):
        """Saving should create a timestamped backup of existing config."""
        config_path = tmp_path / "ml_config.json"

        import backend.ml.config
        importlib.reload(backend.ml.config)

        with patch.object(backend.ml.config, "ML_CONFIG_PATH", config_path):
            # Save initial config
            config = backend.ml.config.load_ml_config()
            backend.ml.config.save_ml_config(config)

            # Save again - should create backup
            config["confidence_threshold"] = 0.90
            backend.ml.config.save_ml_config(config)

            # Check backup exists
            backups = list(tmp_path.glob("ml_config.backup.*.json"))
            assert len(backups) >= 1
