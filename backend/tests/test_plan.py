from app.agent.plan import WorkPlan, update_plan
from app.rag.search import Hit

FRAGMENT = "Давление масла на прогретом двигателе должно быть 400-700 кПа (4-7 кгс/см2) при 2100 об/мин."
HITS = {"yamz236_re:19": Hit("yamz236_re", "236-3902150-Б РЭ", 19, 1.0, FRAGMENT)}


def test_preliminary_items_have_no_numbers_and_steps_need_the_manual():
    plan = WorkPlan()
    r = update_plan(plan, HITS, "tools", True, [{"text": "Контрольный манометр"}, {"text": "Ключ на 17"}])
    assert [i.text for i in plan.tools] == ["Контрольный манометр"] and len(r["rejected"]) == 1
    r = update_plan(plan, HITS, "steps", True, [{"text": "Проверить давление"}])
    assert not plan.steps and r["rejected"]


def test_step_with_measure_comes_from_the_quoted_fragment():
    plan = WorkPlan()
    quote = "должно быть 400-700 кПа"
    ok = {"text": "Замерить давление масла манометром: 400–700 кПа", "ref": "yamz236_re:19", "quote": quote,
          "measure": {"name": "Давление масла", "unit": "кПа", "min": 400, "max": 700}}
    bad_norm = {**ok, "text": "Замерить давление", "measure": {"name": "Давление", "unit": "кПа", "min": 350, "max": 700}}
    bad_quote = {**ok, "text": "Замерить", "quote": "давление 500 кПа", "measure": None}
    r = update_plan(plan, HITS, "steps", False, [ok, bad_norm, bad_quote])
    assert len(plan.steps) == 1 and len(r["rejected"]) == 2
    step = plan.steps[0]
    assert (step.pdf_page, step.measure.min, step.measure.max) == (19, 400, 700)


def test_replace_swaps_preliminary_list_and_skips_duplicates():
    plan = WorkPlan()
    update_plan(plan, HITS, "tools", True, [{"text": "Манометр"}])
    update_plan(plan, HITS, "tools", True, [{"text": "манометр"}])
    assert len(plan.tools) == 1
    update_plan(plan, HITS, "tools", False, [{"text": "Контрольный манометр", "ref": "yamz236_re:19",
                                              "quote": "Давление масла на прогретом двигателе"}], replace=True)
    assert [(i.text, i.preliminary) for i in plan.tools] == [("Контрольный манометр", False)]


def test_tolerance_bounds_count_as_from_the_fragment():
    hits = {"yamz236_re:37": Hit("yamz236_re", "236-3902150-Б РЭ", 37, 1.0,
                                 "отрегулировать на давление начала впрыскивания 22,6+0,8 МПа (230+8 кгс/см2)")}
    plan = WorkPlan()
    item = {"text": "Проверить давление начала впрыскивания", "ref": "yamz236_re:37",
            "quote": "давление начала впрыскивания 22,6+0,8 МПа",
            "measure": {"name": "Давление", "unit": "МПа", "min": 22.6, "max": 23.4}}
    assert update_plan(plan, hits, "steps", False, [item])["accepted"] == 1
    item["measure"] = {"name": "Давление", "unit": "МПа", "min": 22.6, "max": 25}
    assert update_plan(plan, hits, "steps", False, [{**item, "text": "Ещё раз"}])["rejected"]


def test_items_sent_as_strings_are_read_not_crashed_on():
    plan = WorkPlan()
    update_plan(plan, HITS, "tools", True, ["Манометр", {"text": "Ключи"}, 5])
    update_plan(plan, HITS, "materials", True, '[{"text": "Ветошь"}]')
    update_plan(plan, HITS, "prep", True, ['[{"text": "Заглушить двигатель"}, {"text": "Остудить"}]'])
    assert [i.text for i in plan.tools] == ["Манометр", "Ключи"] and [i.text for i in plan.materials] == ["Ветошь"]
    assert [i.text for i in plan.prep] == ["Заглушить двигатель", "Остудить"]
