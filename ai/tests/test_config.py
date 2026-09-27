import os, subprocess, sys
from pathlib import Path

def test_unrelated_debug_environment_cannot_break_ai_settings():
    environment={**os.environ,"DEBUG":"release"}
    result=subprocess.run([sys.executable,"-c","from app.core.config import settings; print(settings.DEBUG)"],capture_output=True,text=True,env=environment)
    assert result.returncode==0, result.stderr
    assert result.stdout.strip()=="True"

def test_runtime_database_driver_is_declared():
    requirements=(Path(__file__).parents[1]/"requirements.txt").read_text()
    assert "asyncpg==" in requirements
