import re

import snowballstemmer

_ru = snowballstemmer.stemmer("russian")
_WORD = re.compile(r"[а-яёa-z]+|\d+(?:[.,]\d+)?")


def tokenize(text: str) -> list[str]:
    words = _WORD.findall(text.lower().replace("ё", "е"))
    return [w if w[0].isdigit() else _ru.stemWord(w) for w in words]
