import asyncio
from pathlib import Path

from app.runtime import initialize_phase7


class Rag:
    def __init__(self, events): self.events=events
    async def ingest(self, source, content): self.events.append((source,content)); return 1


def test_runtime_migrates_before_ingesting_markdown(tmp_path: Path):
    (tmp_path/"propulsion.md").write_text("# Propulsion\nLeak procedure",encoding="utf-8")
    events=[]
    async def migrate(_): events.append("migration")
    asyncio.run(initialize_phase7(object(),tmp_path,Rag(events),migrate))
    assert events==["migration",("propulsion.md","# Propulsion\nLeak procedure")]
