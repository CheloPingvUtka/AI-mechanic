import base64

from app.agent.plan import Measure, PlanItem, WorkPlan
from app.repositories import store
from app.services import agent_service, plan_service
from tests.test_agent import FakeCatalog, hit, make_result, vehicle


def test_book_entries_photos_and_disputes():
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    entry = store.add_entry("M333YK47", "note", "Заметка", "Течь масла")
    photo = store.add_photo("M333YK47", png, entry)
    [row] = store.entries("M333YK47")
    assert (row["title"], row["photos"]) == ("Заметка", [photo])
    assert store.photo_file(photo).read_bytes() == b"\x89PNG fake"
    store.add_dispute("contradiction", "РЭ стр. 19 vs РК стр. 267", "M333YK47")
    [d] = store.disputes(resolved=False)
    store.resolve_dispute(d["id"])
    assert store.disputes(resolved=False) == []


def test_conversation_survives_restart(monkeypatch):
    conv_id = "w1"
    state = agent_service.AgentState(vehicle=vehicle(), session_id="S-0005", diagnosis=make_result(),
                                     conversation_id=conv_id)
    state.hits = {"yamz236_rk:41": hit()}
    state.plan = WorkPlan(steps=[PlanItem(text="Затянуть", preliminary=False, ref="yamz236_rk:41",
                                          measure=Measure(name="Момент", unit="Н·м", min=421, max=461))])
    conv = agent_service.Conversation(state=state, messages=[{"role": "system", "content": "x"}], lang="uz")
    agent_service.save_conversation(conv_id, conv, status="active")
    agent_service.CONVERSATIONS.clear()

    restored = agent_service.restore_conversation(conv_id, FakeCatalog())
    assert restored.lang == "uz" and restored.state.diagnosis.anomaly_type == "F08"
    assert restored.state.hits["yamz236_rk:41"].pdf_page == 41
    assert restored.state.plan.steps[0].measure.max == 461
    assert [w["id"] for w in store.list_works(status="active")] == [conv_id]
    agent_service.CONVERSATIONS.clear()


def test_finish_writes_defect_repair_and_aftercare(monkeypatch):
    monkeypatch.setattr(plan_service, "JsonVehicleCatalog", FakeCatalog)
    state = agent_service.AgentState(vehicle=vehicle(), session_id="S-0005", diagnosis=make_result(),
                                     conversation_id="w2")
    step = PlanItem(text="Замерить момент", preliminary=False, measure=Measure(name="Момент", unit="Н·м", min=421, max=461))
    state.plan = WorkPlan(steps=[step], aftercare=[PlanItem(text="Через неделю проверить течи", preliminary=True)])
    conv = agent_service.Conversation(state=state)
    agent_service.save_conversation("w2", conv, status="active")
    store.update_work_data("w2", progress={"steps": {str(step.id): {"done": True, "value": "400"}}, "checks": {}})
    agent_service.CONVERSATIONS.clear()
    plan_service.WORKS.clear()

    plan_service.finish("w2")
    kinds = {e["kind"]: e for e in store.entries("M333YK47")}
    assert set(kinds) == {"defect", "repair", "recommendation"}
    assert kinds["defect"]["data"]["steps"][0]["ok"] is False  # 400 is below 421
    assert store.load_work("w2")["status"] == "done"
    agent_service.CONVERSATIONS.clear()
    plan_service.WORKS.clear()
