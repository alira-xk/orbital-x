"""Tests for Redis Streams telemetry publishing."""
import logging
import sys
from types import SimpleNamespace

from src.telemetry_publisher import TelemetryPublisher, create_telemetry_publisher_from_env


class RecordingRedisClient:
    def __init__(self):
        self.calls = []

    def xadd(self, stream_name, fields):
        self.calls.append((stream_name, fields))


class FailingRedisClient:
    def xadd(self, stream_name, fields):
        raise ConnectionError("Redis is unavailable")


class RedisConstructor:
    def __init__(self):
        self.kwargs = None
        self.client = RecordingRedisClient()

    def __call__(self, **kwargs):
        self.kwargs = kwargs
        return self.client


def test_publisher_sends_a_versioned_json_envelope_to_the_configured_stream():
    """Catches a missing envelope, wrong stream, or unversioned frame."""
    client = RecordingRedisClient()
    publisher = TelemetryPublisher(client, stream_name="test:telemetry")

    assert publisher.publish({"spacecraft_id": "ORBITAL-X1", "timestamp": "2026-09-10T00:00:00+00:00"})
    assert client.calls == [
        (
            "test:telemetry",
            {
                "telemetry:frame": '{"schema_version":1,"event_type":"telemetry.frame","payload":{"spacecraft_id":"ORBITAL-X1","timestamp":"2026-09-10T00:00:00+00:00"}}',
            },
        )
    ]


def test_publisher_returns_false_and_logs_a_warning_when_redis_is_unavailable(caplog):
    """Catches failed delivery being reported as successful or silently ignored."""
    publisher = TelemetryPublisher(FailingRedisClient(), stream_name="test:telemetry")

    with caplog.at_level(logging.WARNING):
        assert not publisher.publish({"spacecraft_id": "ORBITAL-X1"})

    assert "Redis telemetry publish failed" in caplog.text


def test_factory_reads_redis_connection_and_stream_settings_from_environment(monkeypatch):
    """Catches Redis settings being hard-coded instead of supplied by the environment."""
    constructor = RedisConstructor()
    monkeypatch.setitem(sys.modules, "redis", SimpleNamespace(Redis=constructor))
    monkeypatch.setenv("TELEMETRY_REDIS_ENABLED", "true")
    monkeypatch.setenv("REDIS_HOST", "redis.internal")
    monkeypatch.setenv("REDIS_PORT", "6380")
    monkeypatch.setenv("REDIS_PASSWORD", "secret")
    monkeypatch.setenv("TELEMETRY_REDIS_STREAM", "custom:telemetry")

    publisher = create_telemetry_publisher_from_env()

    assert publisher.publish({"spacecraft_id": "ORBITAL-X1"})
    assert constructor.kwargs == {
        "host": "redis.internal",
        "port": 6380,
        "password": "secret",
        "decode_responses": True,
    }
    assert constructor.client.calls[0][0] == "custom:telemetry"


def test_factory_logs_and_returns_a_non_publishing_publisher_for_an_invalid_redis_port(monkeypatch, caplog):
    """Catches malformed environment configuration preventing simulator startup."""
    monkeypatch.setenv("TELEMETRY_REDIS_ENABLED", "true")
    monkeypatch.setenv("REDIS_PORT", "not-a-port")

    with caplog.at_level(logging.WARNING):
        publisher = create_telemetry_publisher_from_env()

    assert not publisher.publish({"spacecraft_id": "ORBITAL-X1"})
    assert "Redis telemetry publishing is unavailable" in caplog.text


def test_factory_logs_and_returns_a_non_publishing_publisher_when_redis_is_not_installed(monkeypatch, caplog):
    """Catches a missing optional redis-py dependency stopping JSONL-only operation."""
    monkeypatch.setenv("TELEMETRY_REDIS_ENABLED", "true")
    monkeypatch.setitem(sys.modules, "redis", None)

    with caplog.at_level(logging.WARNING):
        publisher = create_telemetry_publisher_from_env()

    assert not publisher.publish({"spacecraft_id": "ORBITAL-X1"})
    assert "Redis telemetry publishing is unavailable" in caplog.text
