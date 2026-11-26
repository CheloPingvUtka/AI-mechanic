from app.rag.indexer import chunk, clean, is_toc
from app.rag.manuals import manuals_for_engine
from app.rag.search import PageIndex
from app.rag.text import tokenize


def row(manual_id, page, text):
    return {"manual_id": manual_id, "pdf_page": page, "text": text, "tokens": tokenize(text)}


def test_every_fleet_engine_has_manuals():
    for engine in ["ЯМЗ-236М2", "ЯМЗ-536", "ЗМЗ-5234.10", "ЗМЗ-40904.10", "ЗМЗ-40905.10"]:
        assert manuals_for_engine(engine)
    assert manuals_for_engine("КАМАЗ-740") == []


def test_clean_joins_soft_hyphen_and_hyphenated_words():
    assert clean("топлив￾\nный насос") == "топливный насос"
    assert clean("выступа-\nние бурта") == "выступание бурта"
    assert clean("- пункт\n- пункт") == "- пункт\n- пункт"


def test_chunks_overlap_and_cover_all_lines():
    lines = [f"строка {i} " + "х" * 50 for i in range(40)]
    parts = chunk("\n".join(lines), size=300)
    assert len(parts) > 1
    assert all(line in "\n".join(parts) for line in lines)
    assert set(parts[0].split("\n")) & set(parts[1].split("\n"))


def test_toc_page_detected():
    toc = "\n".join(f"{i} РАЗДЕЛ НОМЕР {i}" for i in range(1, 15))
    assert is_toc(toc)
    assert not is_toc("Давление масла на прогретом двигателе должно быть 400-700 кПа.\n" * 10)


def test_search_stays_within_engine_manuals():
    index = PageIndex([
        row("yamz236_rk", 41, "Затяжку болтов крышек коренных подшипников производить с моментом 43-47 кгс*м"),
        row("yamz536_rk", 300, "Момент затяжки болтов крышек коренных подшипников 100 Н*м"),
        row("yamz236_re", 19, "Давление масла на прогретом двигателе 400-700 кПа"),
    ])
    hits = index.search("ЯМЗ-236М2", "момент затяжки крышек коренных подшипников")
    assert [(h.manual_id, h.pdf_page) for h in hits] == [("yamz236_rk", 41)]
    assert hits[0].manual == "236.01.01 РК"
    assert index.search("Неизвестный", "давление масла") == []
