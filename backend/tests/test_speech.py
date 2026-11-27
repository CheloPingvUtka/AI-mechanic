from app.integrations.speech import said_the_same


def test_verbatim_reading_passes_and_paraphrase_fails():
    src = "Moy bosimi past. Avval moy darajasini tekshiring, keyin manometr bilan bosimni o‘lchang. Me’yor: 400–700 kPa."
    assert said_the_same(src, "Moy bosimi past. Avval moy darajasini tekshiring, keyin manometr bilan bosimni o'lchang. Me'yor 400-700 kPa.")
    # what gpt-audio-mini actually said for this text: an answer, not a reading
    assert not said_the_same(src, "Albatta, hozir darajani tekshirib, keyin manometr bilan bosimni o‘lchayman. Me’yor 400–700 kPa bo’lishi kerak.")
    assert not said_the_same("Момент 421–461 Н·м", "Момент 421–460 Н·м")  # a wrong number is never OK


def test_sentences_and_silence_trim():
    from app.integrations.speech import SAMPLE_RATE, sentences, trim_silence

    assert sentences("Раз. Два! Три?") == ["Раз. Два! Три?"]
    long = "Первое предложение довольно длинное. " * 6
    assert all(len(p) <= 140 for p in sentences(long)) and len(sentences(long)) > 1
    loud, quiet = (b"\x10\x27" * SAMPLE_RATE), (b"\x00\x00" * SAMPLE_RATE * 5)
    assert len(trim_silence(loud + quiet)) == len(loud) + SAMPLE_RATE // 5 * 2
