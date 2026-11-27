import base64
import binascii
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.integrations import speech

router = APIRouter()


class TranscribeRequest(BaseModel):
    audio: str = Field(min_length=1, max_length=4_000_000, description="WAV в base64 (до ~90 с моно 16 кГц)")
    lang: Literal["ru", "uz", "ko"] = "ru"


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    lang: Literal["ru", "uz", "ko"] = "ru"


@router.post("/transcribe", summary="Речь механика → текст")
async def transcribe(payload: TranscribeRequest):
    try:
        wav = base64.b64decode(payload.audio, validate=True)
    except binascii.Error as exc:
        raise HTTPException(status_code=422, detail="audio: не base64") from exc
    if not wav.startswith(b"RIFF"):
        raise HTTPException(status_code=422, detail="audio: нужен WAV")
    try:
        text, cost = await speech.transcribe(wav, payload.lang)
    except speech.SpeechError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"text": text, "cost_usd": cost}


@router.post("/speak", summary="Текст → речь (WAV), только если модель прочитала его дословно")
async def speak(payload: SpeakRequest):
    try:
        wav, cost = await speech.speak(payload.text.strip(), payload.lang)
    except speech.SpeechError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(wav, media_type="audio/wav", headers={"X-Cost-USD": f"{cost:.6f}"})
