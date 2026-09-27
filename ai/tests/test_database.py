import asyncio

from app.core import database


def test_query_one_delegates_to_query(monkeypatch):
    async def fake_query(statement, *args):
        assert statement == "SELECT $1::int AS value"
        assert args == (7,)
        return [{"value": 7}]

    monkeypatch.setattr(database, "query", fake_query)

    assert asyncio.run(database.query_one("SELECT $1::int AS value", 7)) == {"value": 7}
