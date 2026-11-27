import asyncio

import httpx

from app.core.config import settings

# Fields of an assistant message that must be echoed back in the history (reasoning_details keeps
# the model's reasoning across tool calls on OpenRouter).
_KEEP = ("role", "content", "tool_calls", "reasoning_details")


class LLMError(RuntimeError):
    pass


RETRY_STATUS = {429, 502, 503}


async def post_with_retry(url: str, headers: dict, body: dict, timeout: float, attempts: int = 3) -> httpx.Response:
    """POST that survives the short connection drops seen with OpenRouter. Only failures where the model
    did not answer are retried (connection errors, 429/502/503); a call has no side effects of its own."""
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, headers=headers, json=body)
            if response.status_code not in RETRY_STATUS or attempt == attempts - 1:
                return response
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError) as exc:
            if attempt == attempts - 1:
                raise LLMError(f"LLM недоступна: {type(exc).__name__}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM недоступна: {type(exc).__name__}") from exc
        await asyncio.sleep(1 + attempt * 2)
    raise LLMError("LLM недоступна")


class LLMClient:
    """OpenAI-compatible /chat/completions with tool calling (OpenRouter by default)."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None):
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model or settings.llm_model

    async def chat(self, messages: list[dict], tools: list[dict], tool_choice: str = "auto") -> tuple[dict, dict]:
        """Returns (assistant message to append to history, usage incl. OpenRouter `cost` in USD)."""
        if not self.api_key:
            raise LLMError("LLM_API_KEY не задан в .env")
        body = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": tool_choice,
            "temperature": 0.2,
            "max_tokens": settings.llm_max_tokens,
            "usage": {"include": True},
        }
        response = await post_with_retry(
            f"{self.base_url}/chat/completions", {"Authorization": f"Bearer {self.api_key}"}, body,
            settings.llm_timeout_seconds,
        )
        if response.status_code != 200:
            raise LLMError(f"LLM {response.status_code}: {response.text[:300]}")
        data = response.json()
        if "error" in data or not data.get("choices"):
            raise LLMError(f"LLM: {str(data.get('error', data))[:300]}")
        message = data["choices"][0]["message"]
        return {k: message[k] for k in _KEEP if message.get(k) is not None}, data.get("usage") or {}
