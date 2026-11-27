import asyncio

from app.agent import figures
from app.services.agent_service import step_key


def test_model_choice_is_mapped_to_page_and_figure_and_nonsense_is_none():
    cands = [(31, 0), (32, 0), (32, 1)]
    picks = figures._parse('```json\n{"picks": {"a": 3, "b": null, "c": 9, "d": "2"}}\n```', ["a", "b", "c", "d"], cands)
    assert picks == {"a": figures.Pick(32, 1), "b": None, "c": None, "d": None}
    assert figures._parse("не знаю", ["a"], cands) == {"a": None}


def test_one_call_per_page_then_a_second_look_elsewhere_and_cached(monkeypatch):
    calls = []

    async def fake_ask(llm, manual_id, cands, items):
        calls.append((cands[0][0], [k for k, _ in items]))
        # near page 31 only step 1 fits; the second look (page 80) finds one for step 2
        return {k: figures.Pick(cands[0][0], 0) if (k == "1" or cands[0][0] == 80) else None for k, _ in items}, \
            {"prompt_tokens": 10, "cost": 0.001}

    monkeypatch.setattr(figures, "_ask", fake_ask)
    monkeypatch.setattr(figures, "candidates", lambda m, p: [(p, 0)] if p == 31 else [])
    monkeypatch.setattr(figures, "found_elsewhere", lambda m, p, text: [(80, 0)] if "зазор" in text else [])
    figures._cache.clear()
    steps = [("1", "Снять крышку", "m", 31), ("2", "Проверить зазор", "m", 31), ("3", "Затянуть", "m", 40)]
    picks, usage = asyncio.run(figures.pick(steps))
    assert calls == [(31, ["1", "2"]), (80, ["2"])]
    assert picks == {"1": figures.Pick(31, 0), "2": figures.Pick(80, 0), "3": None} and usage["prompt_tokens"] == 20
    asyncio.run(figures.pick(steps))
    assert len(calls) == 2  # same steps again: no new calls
    figures._cache.clear()


def test_step_key_ignores_citations_bold_and_punctuation():
    assert step_key("**Снять** крышку головки (236-3902150-Б РЭ, стр. 31).") == step_key("Снять крышку головки")
