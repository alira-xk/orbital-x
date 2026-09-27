"""Redis Streams publisher for simulator telemetry frames."""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Mapping


LOGGER = logging.getLogger(__name__)


class TelemetryPublisher:
    """Publish versioned telemetry envelopes to one Redis Stream."""

    def __init__(self, client: Any, stream_name: str, enabled: bool = True):
        self._client = client
        self._stream_name = stream_name
        self._enabled = enabled

    def publish(self, frame: Mapping[str, Any]) -> bool:
        """Publish one frame, returning whether Redis accepted it."""
        if not self._enabled or self._client is None:
            return False

        envelope = {
            "schema_version": 1,
            "event_type": "telemetry.frame",
            "payload": dict(frame),
        }
        try:
            self._client.xadd(
                self._stream_name,
                {"telemetry:frame": json.dumps(envelope, separators=(",", ":"))},
            )
        except Exception as error:
            LOGGER.warning("Redis telemetry publish failed: %s", error)
            return False
        return True


def create_telemetry_publisher_from_env() -> TelemetryPublisher:
    """Create the simulator's sole Redis client from environment settings."""
    stream_name = os.environ.get("TELEMETRY_REDIS_STREAM", "telemetry:stream")
    enabled = os.environ.get("TELEMETRY_REDIS_ENABLED", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return TelemetryPublisher(None, stream_name, enabled=False)

    try:
        import redis
        port = int(os.environ.get("REDIS_PORT", "6379"))
    except (ImportError, ValueError) as error:
        LOGGER.warning("Redis telemetry publishing is unavailable: %s", error)
        return TelemetryPublisher(None, stream_name)

    return TelemetryPublisher(
        redis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=port,
            password=os.environ.get("REDIS_PASSWORD") or None,
            decode_responses=True,
        ),
        stream_name,
    )
