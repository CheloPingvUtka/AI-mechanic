import json
from typing import ClassVar

import pytest

from app.agent import tools
from app.agent.checks import answer_problems, render_citations
from app.agent.tools import AgentState, create_ticket
from app.rag.search import Hit
from app.schemas.assistant import ChatRequest
from app.schemas.tickets import TicketCreated
from app.schemas.vehicles import Vehicle
from app.services import agent_service
from app.services.agent_service import AgentService
from tests.test_diagnostic_rules import make_result

FRAGMENT = "Затяжку болтов крепления крышек производить с моментом 421-461 Н*м (43-47 кгс*м)."
BAN = "Эксплуатация двигателя с неисправной системой смазки запрещается."


def hit(page=41, text=FRAGMENT):
    return Hit("yamz236_rk", "236.01.01 РК", page, 1.0, text)


def vehicle():
    return Vehicle.model_validate({
        "vehicle_id": "M333YK47", "garage_no": "Г-1", "make": "МАЗ", "model": "МАЗ-5337",
        "vehicle_type": "грузовой", "engine_model": "ЯМЗ-236М2", "fuel": "дизель",
        "sessions": [{**make_result().model_dump(), "checked_at": "2026-10-29T10:00:00+03:00"}],
    })


def test_answer_numbers_must_come_from_cited_fragment():
    hits = {"yamz236_rk:41": hit()}
    assert answer_problems("Момент 421-461 Н·м [yamz236_rk:41].", hits, "") == []
    assert answer_problems("Момент 421-461 Н·м.", hits, "")  # number without citation
    assert answer_problems("Момент 500 Н·м [yamz236_rk:41].", hits, "")  # number not in fragment
    assert answer_problems("См. [yamz536_rk:10].", hits, "")  # citation never retrieved
    assert answer_problems("Двигатель ЯМЗ-236М2, машина M333YK47, уверенность 0.73.", hits, "0.73") == []


def test_render_citations():
    text, used = render_citations("Момент 421 Н·м [yamz236_rk:41]; источник yamz236_rk:41", {"yamz236_rk:41": hit()})
    assert text == "Момент 421 Н·м (236.01.01 РК, стр. 41); источник (236.01.01 РК, стр. 41)"
    assert [h.pdf_page for h in used] == [41]


class FakeToir:
    sent: ClassVar[list] = []

    def __init__(self, *a):
        pass

    async def create_ticket(self, payload):
        FakeToir.sent.append(payload)
        return TicketCreated(ticket_id=f"TKT-{len(FakeToir.sent):04d}", status="created")


@pytest.fixture
def state(monkeypatch):
    monkeypatch.setattr(tools, "MockToirClient", FakeToir)
    FakeToir.sent = []
    s = AgentState(vehicle=vehicle(), session_id="S-0005", diagnosis=make_result())
    s.hits = {"yamz236_rk:41": hit(), "yamz236_rk:50": hit(50, BAN)}
    return s


async def test_ticket_created_with_verified_reference(state):
    result = await create_ticket(
        state, "Подозрение на износ", ["Затянуть болты моментом 421-461 Н*м"], [],
        [{"ref": "yamz236_rk:41", "quote": "производить с моментом 421-461 Н*м"}],
    )
    assert result["ticket_id"] == "TKT-0001"
    sent = FakeToir.sent[0]
    assert (sent.anomaly_type, sent.urgency, sent.references[0].pdf_page) == ("F08", "medium", 41)


@pytest.mark.parametrize(
    "refs,ops",
    [
        ([{"ref": "yamz236_rk:41", "quote": "моментом 500 Н*м по инструкции"}], ["Затянуть"]),  # not verbatim
        ([{"ref": "yamz536_rk:7", "quote": "производить с моментом 421-461 Н*м"}], ["Затянуть"]),  # unknown
        ([{"ref": "yamz236_rk:41", "quote": "производить с моментом 421-461 Н*м"}], ["Затянуть 500 Н*м"]),
        ([], ["Затянуть"]),
    ],
)
async def test_ticket_rejected_without_proof(state, refs, ops):
    result = await create_ticket(state, "Диагноз", ops, [], refs)
    assert "error" in result and not FakeToir.sent


async def test_ticket_blocked_by_rules_even_if_llm_insists(state):
    state.diagnosis = make_result(quality="warning")
    refs = [{"ref": "yamz236_rk:41", "quote": "производить с моментом 421-461 Н*м"}]
    assert "error" in await create_ticket(state, "Д", ["Затянуть"], [], refs)
    state.warning_confirmed = True
    assert "ticket_id" in await create_ticket(state, "Д", ["Затянуть"], [], refs)


async def test_operation_ban_raises_urgency_only_with_real_quote(state):
    refs = [{"ref": "yamz236_rk:41", "quote": "производить с моментом 421-461 Н*м"}]
    fake_ban = {"ref": "yamz236_rk:41", "quote": "производить с моментом 421-461 Н*м"}
    assert "error" in await create_ticket(state, "Д", ["Затянуть"], [], refs, fake_ban)
    ban = {"ref": "yamz236_rk:50", "quote": "с неисправной системой смазки запрещается"}
    result = await create_ticket(state, "Д", ["Затянуть"], [], refs, ban)
    assert result["urgency"] == "high"


class ScriptedLLM:
    """Plays back assistant messages; records what the agent sent."""

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    async def chat(self, messages, tools, tool_choice="auto"):
        self.calls.append((list(messages), tool_choice))
        return self.replies.pop(0), {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001}


def tool_call(name, args):
    return {"role": "assistant", "tool_calls": [
        {"id": name, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
    ]}


class FakeCatalog:
    def get_vehicle(self, vehicle_id):
        return vehicle() if vehicle_id == "M333YK47" else None


async def test_agent_loop_runs_tools_and_rejects_unsourced_numbers(monkeypatch):
    async def fake_search(state, query):
        state.hits["yamz236_rk:41"] = hit()
        return {"found": [{"ref": "yamz236_rk:41", "text": FRAGMENT}]}

    monkeypatch.setitem(tools.HANDLERS, "search_manual", fake_search)
    llm = ScriptedLLM([
        tool_call("search_manual", {"query": "момент затяжки"}),
        {"role": "assistant", "content": "Момент 999 Н·м."},  # invented number
        {"role": "assistant", "content": "Момент 421-461 Н·м [yamz236_rk:41]."},
    ])
    service = AgentService(catalog=FakeCatalog(), llm=llm)
    response = await service.chat(ChatRequest(vehicle_id="M333YK47", message="Какой момент затяжки?"))

    assert response.answer == "Момент 421-461 Н·м (236.01.01 РК, стр. 41)."
    assert [s.manual for s in response.sources] == ["236.01.01 РК"]
    assert [s.name for s in response.steps] == ["llm:search_manual", "search_manual", "llm:answer", "llm:fix"]
    assert response.cost_usd == pytest.approx(0.003)
    assert llm.calls[-1][1] == "none"  # the fix-up pass may not call tools
    agent_service.CONVERSATIONS.clear()
