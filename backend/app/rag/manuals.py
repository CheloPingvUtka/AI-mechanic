"""Registry of factory manuals: which PDF covers which engine and how to cite it.

`title` is the designation from section 3 of the ТЗ; it goes into ticket `references[].manual`.
PDF files themselves live outside Git, in KNOWLEDGE_BASE_PATH.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Manual:
    id: str
    file: str
    title: str
    engines: tuple[str, ...]


MANUALS = (
    Manual("yamz236_re", "ЯМЗ_236_руководство по эксплуатации.pdf", "236-3902150-Б РЭ", ("ЯМЗ-236М2",)),
    Manual("yamz236_rk", "ЯМЗ_236_руководство по РЕМОНТУ.pdf", "236.01.01 РК", ("ЯМЗ-236М2",)),
    Manual("yamz536_re", "yamz-536_re_2016.pdf", "536.3902150 РЭ", ("ЯМЗ-536",)),
    Manual("yamz536_rk", "yamz-536_rk_2013.pdf", "536.01.02 РК", ("ЯМЗ-536",)),
    Manual(
        "zmz5234_rk",
        "zmz-5234_rk_2025.pdf",
        "Двигатели ЗМЗ-5234.10 со сцеплением. Руководство по ремонту",
        ("ЗМЗ-5234.10",),
    ),
    Manual(
        "zmz409_rk",
        "zmz-40904-40905_rk_2025.pdf",
        "Двигатели ЗМЗ-40904.10 и ЗМЗ-40905.10. Руководство по эксплуатации, "
        "техническому обслуживанию и ремонту",
        ("ЗМЗ-40904.10", "ЗМЗ-40905.10"),
    ),
)

BY_ID = {m.id: m for m in MANUALS}


def manuals_for_engine(engine_model: str) -> list[Manual]:
    return [m for m in MANUALS if engine_model in m.engines]
