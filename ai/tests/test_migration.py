import asyncio

from app.investigation.migration import run_phase7_migration


class Connection:
    def __init__(self):
        self.sql = ""

    async def execute(self, sql):
        self.sql = sql


class Acquire:
    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_):
        return None

    def __init__(self, connection):
        self.connection = connection


class Pool:
    def __init__(self):
        self.connection = Connection()

    def acquire(self):
        return Acquire(self.connection)


def test_migration_is_idempotent_and_adds_vector_identity():
    pool = Pool()
    asyncio.run(run_phase7_migration(pool))
    sql = pool.connection.sql
    assert "CREATE EXTENSION IF NOT EXISTS vector" in sql
    assert "embedding vector(384)" in sql
    assert "CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_source_fingerprint" in sql
