import json
import httpx
from openai import AsyncOpenAI

class OpenAIProvider:
    name = "openai"
    def __init__(self, key, model, timeout, temperature, max_tokens, base_url=None):
        self.key = key
        self.model, self.temperature, self.max_tokens = model, temperature, max_tokens
        self.client = AsyncOpenAI(api_key=key, timeout=timeout, base_url=base_url or None) if key and key != "your-api-key-here" else None
    async def investigate(self, prompt):
        if self.client is None: raise ValueError("OpenAI API key is not configured")
        response = await self.client.chat.completions.create(model=self.model, temperature=self.temperature,
            max_tokens=self.max_tokens, response_format={"type":"json_object"}, messages=[
                {"role":"system","content":"Return one JSON object matching the requested investigation schema."},
                {"role":"user","content":prompt}])
        return json.loads(response.choices[0].message.content or ""), response.usage.total_tokens if response.usage else None

class OllamaProvider:
    name = "ollama"
    def __init__(self, url, model, timeout, temperature):
        self.url, self.model, self.timeout, self.temperature = url.rstrip("/"), model, timeout, temperature
    async def investigate(self, prompt):
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(f"{self.url}/api/generate", json={"model":self.model,"prompt":prompt,"stream":False,"format":"json","options":{"temperature":self.temperature}})
            response.raise_for_status(); payload=response.json()
        return json.loads(payload["response"]), payload.get("eval_count")

def create_provider(settings):
    if settings.LLM_PROVIDER == "openai": return OpenAIProvider(settings.LLM_API_KEY, settings.LLM_MODEL, settings.LLM_TIMEOUT, settings.LLM_TEMPERATURE, settings.LLM_MAX_TOKENS, settings.LLM_BASE_URL)
    if settings.LLM_PROVIDER == "ollama": return OllamaProvider(settings.LLM_OLLAMA_URL, settings.LLM_MODEL, settings.LLM_TIMEOUT, settings.LLM_TEMPERATURE)
    raise ValueError("Unsupported LLM provider")
