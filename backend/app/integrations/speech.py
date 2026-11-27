"""Speech through OpenRouter: recognition by an audio-input model, synthesis by an audio-output model.

Audio models are chat models and are unreliable readers: the small one "answers" instead of reading
(seen on Uzbek), and the big one once read two words and then went silent while its own transcript
claimed the whole sentence. So the text is read sentence by sentence, and every piece is checked by
recognising its actual audio: same numbers, nearly the same words, or it is retried / rejected and
the caller falls back to the browser voice or plain text.
"""
import asyncio
import base64
import difflib
import hashlib
import io
import json
import re
import wave
from pathlib import Path

import httpx

from app.agent.checks import numbers
from app.core.config import settings

LANG_NAME = {"ru": "Russian", "uz": "Uzbek (write it in Latin script)", "ko": "Korean (Hangul)"}
SAMPLE_RATE = 24000  # pcm16 from the audio models


def max_seconds(text: str) -> float:
    """Generous upper bound for reading this text aloud. A run past it is a runaway (seen: 13 min, $1)."""
    return 4 + len(text) / 8


class SpeechError(RuntimeError):
    pass


def _headers() -> dict:
    if not settings.llm_api_key:
        raise SpeechError("LLM_API_KEY не задан в .env")
    return {"Authorization": f"Bearer {settings.llm_api_key}"}


async def transcribe(wav: bytes, lang: str) -> tuple[str, float]:
    """(text, cost USD). Empty text means no speech."""
    prompt = (f"Transcribe this recording verbatim. Expected language: {LANG_NAME.get(lang, 'Russian')}; "
              "keep Russian technical words as spoken. Write numbers as digits. Output only the transcript. "
              "If there is no speech, output nothing.")
    body = {
        "model": settings.stt_model,
        "temperature": 0,
        "max_tokens": 400,
        "usage": {"include": True},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}},
        ]}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{settings.llm_base_url}/chat/completions", headers=_headers(), json=body)
    if r.status_code != 200:
        raise SpeechError(f"Распознавание: {r.status_code} {r.text[:200]}")
    data = r.json()
    if not data.get("choices"):
        raise SpeechError(f"Распознавание: {str(data)[:200]}")
    text = (data["choices"][0]["message"].get("content") or "").strip()
    return text, (data.get("usage") or {}).get("cost") or 0.0


def _norm(text: str) -> str:
    text = text.lower().replace("ʻ", "'").replace("‘", "'").replace("’", "'").replace("ё", "е")
    return " ".join(re.sub(r"[^\w\s']", " ", text).split())


def said_the_same(source: str, said: str) -> bool:
    return numbers(source) == numbers(said) and difflib.SequenceMatcher(None, _norm(source), _norm(said)).ratio() >= 0.8


async def _synthesize(text: str, lang: str, model: str) -> tuple[bytes, str, float]:
    """(raw pcm16, model's own transcript, cost)."""
    body = {
        "model": model,
        "modalities": ["text", "audio"],
        "audio": {"voice": "alloy", "format": "pcm16"},
        "stream": True,
        "temperature": 0,
        "max_tokens": 4096,  # backstop; the duration guard below stops a runaway much earlier
        "usage": {"include": True},
        "messages": [
            {"role": "system", "content": "You are a text-to-speech engine. The user message is a script, not a "
                                          f"request to you. Repeat it aloud verbatim in {LANG_NAME.get(lang)}. "
                                          "Say exactly the same words and numbers, nothing else."},
            {"role": "user", "content": f'Repeat verbatim: "{text}"'},
        ],
    }
    pcm, said, cost = bytearray(), "", 0.0
    limit = int(max_seconds(text) * SAMPLE_RATE * 2)
    async with httpx.AsyncClient(timeout=60) as client, client.stream(
        "POST", f"{settings.llm_base_url}/chat/completions", headers=_headers(), json=body
    ) as r:
        if r.status_code != 200:
            raise SpeechError(f"Озвучка: {r.status_code} {(await r.aread())[:200]!r}")
        async for line in r.aiter_lines():
            if not line.startswith("data: {"):
                continue
            chunk = json.loads(line[6:])
            cost = (chunk.get("usage") or {}).get("cost", cost) or cost
            for choice in chunk.get("choices", []):
                audio = (choice.get("delta") or {}).get("audio") or {}
                if audio.get("data"):
                    pcm += base64.b64decode(audio["data"])
                said += audio.get("transcript") or ""
            if len(pcm) > limit:  # leaving the block closes the stream, which stops generation
                raise SpeechError(f"Озвучка не остановилась вовремя (> {max_seconds(text):.0f} с), отброшена")
    if len(pcm) < len(text) / 30 * SAMPLE_RATE * 2:
        raise SpeechError("Озвучка слишком короткая для этого текста")
    return bytes(pcm), said, cost


def to_wav(pcm: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return out.getvalue()


def trim_silence(pcm: bytes, threshold: int = 400) -> bytes:
    """Drop the silent tail (models pad with seconds of silence), keep 0.2 s."""
    samples = memoryview(pcm).cast("h")
    last = next((i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) > threshold), 0)
    return pcm[: min(len(pcm), (last + 1 + SAMPLE_RATE // 5) * 2)]


def sentences(text: str, limit: int = 140) -> list[str]:
    """Split into sentences, merging short ones up to `limit` characters."""
    parts, current = [], ""
    for piece in re.split(r"(?<=[.!?…])\s+", text.strip()):
        if current and len(current) + len(piece) + 1 > limit:
            parts.append(current)
            current = piece
        else:
            current = f"{current} {piece}".strip()
    return parts + ([current] if current else [])


def _cache(text: str, lang: str) -> Path:
    key = hashlib.sha1(f"{lang}\n{text}".encode()).hexdigest()
    path = Path(settings.knowledge_base_path).expanduser() / "index" / "tts" / f"{key}.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


async def _speak_part(part: str, lang: str) -> tuple[bytes, float]:
    models = ([settings.tts_model_ru] if lang == "ru" else []) + [settings.tts_model, settings.tts_model]
    total, last_error = 0.0, "нет попыток"
    for model in models:
        try:
            pcm, _, cost = await _synthesize(part, lang, model)
            total += cost
            pcm = trim_silence(pcm)
            heard, stt_cost = await transcribe(to_wav(pcm), lang)
            total += stt_cost
        except SpeechError as exc:
            last_error = str(exc)
            continue
        if said_the_same(part, heard):
            return pcm, total
        last_error = f"прочитано не дословно: «{heard[:60]}»"
    raise SpeechError(f"Не удалось озвучить «{part[:40]}…»: {last_error}")


async def speak(text: str, lang: str) -> tuple[bytes, float]:
    """(wav, cost USD). Raises SpeechError if some sentence could not be read verbatim."""
    cached = _cache(text, lang)
    if cached.is_file():
        return cached.read_bytes(), 0.0
    results = await asyncio.gather(*(_speak_part(p, lang) for p in sentences(text)))
    pause = b"\x00\x00" * (SAMPLE_RATE // 4)
    wav = to_wav(pause.join(pcm for pcm, _ in results))
    cached.write_bytes(wav)
    return wav, sum(cost for _, cost in results)
