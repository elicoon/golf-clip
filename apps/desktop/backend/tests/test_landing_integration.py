"""Integration tests for landing point marking flow."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


def test_landing_point_flow():
    """Test the full landing point marking flow."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            # Reset the global connection state (must be done after importing)
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                async def run_flow():
                    from backend.models.job import (
                        create_job,
                        create_shots,
                        update_shot_landing,
                        get_shots_for_job
                    )

                    # Create job and shot
                    await create_job(
                        "integration-test",
                        "/test/video.mp4",
                        "/test/output",
                        True,
                        {"width": 1920, "height": 1080}
                    )
                    await create_shots("integration-test", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])

                    # Update landing point
                    result = await update_shot_landing("integration-test", 1, 0.65, 0.82)
                    assert result is True, "Landing point should be saved"

                    # Verify landing point was saved
                    shots = await get_shots_for_job("integration-test")
                    assert len(shots) == 1
                    assert shots[0]["landing_x"] == 0.65
                    assert shots[0]["landing_y"] == 0.82

                    return True

                success = loop.run_until_complete(run_flow())
                assert success

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()
