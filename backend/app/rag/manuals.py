"""Registry of factory manuals: which PDF covers which engine and how to cite it.

`title` is the designation from section 3 of the ТЗ; it goes into ticket `references[].manual`.
`short` is what the mechanic sees next to a citation.
PDF files themselves live outside Git, in KNOWLEDGE_BASE_PATH.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Manual:
    id: str
    file: str
    title: str
    engines: tuple[str, ...]
    short: str = ""
    official_url: str | None = None  # manufacturer's page for this document, if one exists
    official_note: str | None = None  # e.g. the site has another edition

    def __post_init__(self):
        if not self.short:
            object.__setattr__(self, "short", self.title)


MANUALS = (
    # Official links checked 27.11.2026 by opening each PDF cover. ymzmotor.ru answers 401 to non-browser
    # clients (bot protection) but opens fine in a browser.
    Manual("yamz236_re", "ЯМЗ_236_руководство по эксплуатации.pdf", "236-3902150-Б РЭ", ("ЯМЗ-236М2",),
           official_url="https://www.ymzmotor.ru/service/manuals/rukovodstvo-po-ekspluatatsii-dvigateley-yamz-236m2-yamz-238m2-2016g-pdf-6-mb/",
           official_note="На сайте ЯМЗ — издание 2024 г.; страницы могут отличаться от издания 2010 г."),
    Manual("yamz236_rk", "ЯМЗ_236_руководство по РЕМОНТУ.pdf", "236.01.01 РК", ("ЯМЗ-236М2",),
           official_url="https://www.ymzmotor.ru/service/repair_manual/rukovodstvo-po-remontu-dvigateley-yamz-236m2-238m2/"),
    Manual("yamz536_re", "yamz-536_re_2016.pdf", "536.3902150 РЭ", ("ЯМЗ-536",),
           official_url="https://www.ymzmotor.ru/upload/iblock/c7e/re-dvigateli-yamz-536.3902150-_5361_5362_5363_5364.pdf"),
    Manual("yamz536_rk", "yamz-536_rk_2013.pdf", "536.01.02 РК", ("ЯМЗ-536",),
           official_url="https://www.ymzmotor.ru/service/repair_manual/rukovodstvo-po-remontu-dvigateley-yamz-536-yamz-5361-yamz-5363-yamz-53602-yamz-53622-yamz-53642/"),
    Manual(
        "zmz5234_rk",
        "zmz-5234_rk_2025.pdf",
        "Двигатели ЗМЗ-5234.10 со сцеплением. Руководство по ремонту",
        ("ЗМЗ-5234.10",),
        "Руководство по ремонту ЗМЗ-5234.10",
        official_url="https://zmz.ru/upload/iblock/3ec/nxzg12gumsvodx6st97csn99mom3y3d4.pdf",
    ),
    Manual(
        "zmz409_rk",
        "zmz-40904-40905_rk_2025.pdf",
        "Двигатели ЗМЗ-40904.10 и ЗМЗ-40905.10. Руководство по эксплуатации, "
        "техническому обслуживанию и ремонту",
        ("ЗМЗ-40904.10", "ЗМЗ-40905.10"),
        "Руководство ЗМЗ-40904.10/40905.10",
        official_url="https://zmz.ru/upload/iblock/4a9/qgze41rjacdbg864ger49nvaoonw2oio.pdf",
    ),
)

BY_ID = {m.id: m for m in MANUALS}


def manuals_for_engine(engine_model: str) -> list[Manual]:
    return [m for m in MANUALS if engine_model in m.engines]
