"""Token counter of one request (all its model calls) for the UI, like a console agent's: ↑ prompt tokens the
provider actually processed (what it served from its cache is not counted), ↓ output tokens with the reasoning
included. ↓ grows while a call streams (a low estimate, so the exact number at the end only adds); ↑ is added
when a call ends, since only then is it known how much was cached. The numbers never go back."""
from collections.abc import Callable

from app.integrations.llm_client import LLMClient


class TokenMeter:
    def __init__(self, emit: Callable[[dict], None]) -> None:
        self.emit = emit
        self.up = self.down = self.reasoning = 0
        self._live: dict[int, int] = {}  # output so far of the running calls (the plan and its pictures go in parallel)
        self._next = 0

    def totals(self) -> dict:
        return {"type": "tokens", "up": self.up, "down": self.down + sum(self._live.values()), "reasoning": self.reasoning}

    def _send(self) -> None:
        self.emit(self.totals())

    async def call(self, llm: LLMClient, messages: list[dict], tools: list[dict] | None,
                   tool_choice: str = "auto") -> tuple[dict, dict]:
        key, self._next = self._next, self._next + 1
        self._live[key] = 0

        def grow(estimate: int) -> None:
            self._live[key] = estimate
            self._send()

        try:
            message, usage = await llm.chat(messages, tools, tool_choice, on_tokens=grow)
        except Exception:
            self._live.pop(key)
            self._send()
            raise
        streamed = self._live.pop(key)
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
        self.up += max(0, (usage.get("prompt_tokens") or 0) - cached)
        self.down += max(usage.get("completion_tokens") or 0, streamed)
        self.reasoning += (usage.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
        self._send()
        return message, usage
