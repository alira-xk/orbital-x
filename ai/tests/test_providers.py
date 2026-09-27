import asyncio
from app.investigation.providers import OpenAIProvider

def test_missing_openai_key_fails_when_attempt_runs_not_at_configuration():
    provider=OpenAIProvider("","gpt-4o-mini",1,0,100)
    try: asyncio.run(provider.investigate("prompt"))
    except ValueError as error: assert str(error)=="OpenAI API key is not configured"
    else: raise AssertionError("missing key accepted")

def test_openai_compatible_provider_uses_custom_base_url():
    provider=OpenAIProvider("test-key","openai/gpt-oss-20b",1,0,100,"https://api.groq.com/openai/v1")
    assert str(provider.client.base_url)=="https://api.groq.com/openai/v1/"
