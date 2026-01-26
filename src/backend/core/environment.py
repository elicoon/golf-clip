"""Environment detection for feedback tagging."""

import os

from backend.core.config import settings


def get_environment() -> str:
    """Determine if running in dev or prod environment.

    Returns:
        'dev' if any dev indicator is present, 'prod' otherwise.
    """
    # Explicit environment override
    if os.getenv("GOLFCLIP_ENV") == "dev":
        return "dev"

    # Debug mode indicates development
    if settings.debug:
        return "dev"

    return "prod"
