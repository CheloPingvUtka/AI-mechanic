import asyncio
import json
import time
from collections.abc import Callable

import httpx

from app.core.config import settings


class LLMError(RuntimeError):
    pass


RETRY_STATUS = {429, 502, 503}
OnTokens = Callable[[int], None]  # estimated output tokens of the running call so far (reasoning included)


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


def estimate_tokens(chars: int) -> int:
    """Tokens of text that is still streaming, on the low side (Russian is ~3.5 chars a token), so the exact
    count at the end only adds to it."""
    return chars // 4


class _Message:
    """Assembles an assistant message from streamed deltas: text, reasoning, tool calls."""

    def __init__(self) -> None:
        self.content: list[str] = []
        self.reasoning_details: list[dict] = []
        self.tool_calls: dict[int, dict] = {}
        self.chars = 0

    def add(self, delta: dict) -> None:
        if text := delta.get("content"):
            self.content.append(text)
            self.chars += len(text)
        if text := delta.get("reasoning"):
            self.chars += len(text)
        for detail in delta.get("reasoning_details") or []:
            same = next((d for d in self.reasoning_details
                         if d.get("index", 0) == detail.get("index", 0) and d.get("type") == detail.get("type")), None)
            if same is None:
                self.reasoning_details.append(dict(detail))
            else:
                for key in ("text", "summary", "data"):
                    if detail.get(key):
                        same[key] = (same.get(key) or "") + detail[key]
        for call in delta.get("tool_calls") or []:
            slot = self.tool_calls.setdefault(call.get("index", 0), {"id": "", "type": "function",
                                                                     "function": {"name": "", "arguments": ""}})
            slot["id"] = call.get("id") or slot["id"]
            fn = call.get("function") or {}
            slot["function"]["name"] += fn.get("name") or ""
            slot["function"]["arguments"] += fn.get("arguments") or ""
            self.chars += len(fn.get("arguments") or "")

    def message(self) -> dict:
        out: dict = {"role": "assistant", "content": "".join(self.content)}
        if self.tool_calls:
            out["tool_calls"] = [self.tool_calls[i] for i in sorted(self.tool_calls)]
        if self.reasoning_details:  # keeps the model's reasoning across tool calls on OpenRouter
            out["reasoning_details"] = self.reasoning_details
        return out


class LLMClient:
    """OpenAI-compatible /chat/completions with tool calling (OpenRouter by default), streamed, so the
    UI can show the output growing; reasoning effort from settings."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None):
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model or settings.llm_model

    async def chat(self, messages: list[dict], tools: list[dict] | None, tool_choice: str = "auto",
                   on_tokens: OnTokens | None = None) -> tuple[dict, dict]:
        """Returns (assistant message to append to history, usage incl. OpenRouter `cost` in USD and
        completion_tokens_details.reasoning_tokens). on_tokens(n) is called as the output grows."""
        if not self.api_key:
            raise LLMError("LLM_API_KEY не задан в .env")
        body = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": settings.llm_max_tokens,
            "usage": {"include": True},
            "stream": True,
        }
        if settings.llm_reasoning_effort:
            body["reasoning"] = {"effort": settings.llm_reasoning_effort}
        if tools:
            body |= {"tools": tools, "tool_choice": tool_choice}
        url, headers = f"{self.base_url}/chat/completions", {"Authorization": f"Bearer {self.api_key}"}
        timeout = httpx.Timeout(settings.llm_timeout_seconds, connect=15)
        for attempt in range(3):
            try:
                return await self._stream(url, headers, body, timeout, on_tokens)
            except _Retry as exc:
                if attempt == 2:
                    raise LLMError(f"LLM недоступна: {exc}") from exc
                await asyncio.sleep(1 + attempt * 2)
        raise LLMError("LLM недоступна")

    async def _stream(self, url: str, headers: dict, body: dict, timeout: httpx.Timeout,
                      on_tokens: OnTokens | None) -> tuple[dict, dict]:
        message, usage, last = _Message(), {}, 0.0
        try:
            async with httpx.AsyncClient(timeout=timeout) as client, \
                    client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code in RETRY_STATUS:
                    raise _Retry(f"HTTP {response.status_code}")
                if response.status_code != 200:
                    raise LLMError(f"LLM {response.status_code}: {(await response.aread()).decode()[:300]}")
                async for line in response.aiter_lines():
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue  # ": OPENROUTER PROCESSING" keep-alives and the end marker
                    chunk = json.loads(line[6:])
                    if "error" in chunk:
                        raise LLMError(f"LLM: {str(chunk['error'])[:300]}")
                    usage = chunk.get("usage") or usage
                    for choice in chunk.get("choices") or []:
                        message.add(choice.get("delta") or {})
                    if on_tokens and time.monotonic() - last > 0.25:
                        last = time.monotonic()
                        on_tokens(estimate_tokens(message.chars))
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise _Retry(type(exc).__name__) from exc
        except httpx.HTTPError as exc:  # the connection broke mid-answer: the call is lost, say so
            raise LLMError(f"LLM: связь прервалась ({type(exc).__name__})") from exc
        if on_tokens:
            on_tokens(estimate_tokens(message.chars))
        return message.message(), usage


class _Retry(Exception):
    """The model did not start answering (connection refused, 429/502/503): safe to send again."""
