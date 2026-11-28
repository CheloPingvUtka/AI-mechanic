# API для интерфейса (новое)

Все пути — под `/api/v1`. Фото отправляются как `data:image/jpeg;base64,…` (сжатые на устройстве, `shrinkPhoto` в `lib/api.ts`).

## Работы по проверке (сохраняются, можно продолжить)

План — только диагностика: шаги проверки по руководству (осмотр, замеры, проверка работы). Ремонт в шаги не входит: он делается по заявке на дефектовку, в плане он только рекомендация (`aftercare`).

`work_id` = `conversation_id` чата: план и чат одной проверки — одна сессия.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/work` `{vehicle_id, session_id, lang}` | начать работу по проверке → `{work_id}`; план строится в фоне. Если по этой проверке уже есть незавершённая работа на том же языке с планом по текущим правилам — возвращается она (повторно не платим) |
| POST | `/work/{id}/rebuild` | собрать план заново, если `plan.status = failed` (старые отметки сбрасываются) |
| GET | `/work?status=active[&vehicle_id=]` | незавершённые работы: `[{id, vehicle_id, session_id, status, lang, created_at, updated_at, diagnosis, steps_total, steps_done, stage}]` |
| GET | `/work/{id}` | всё, чтобы продолжить: `{work_id, vehicle_id, session_id, status, lang, plan, progress, diagnosis, chat, created_at, updated_at}` |
| GET | `/work/{id}/stream` | SSE: `plan` (снимок), `thinking`/`tool`/`tool_result`, `done` |
| PUT | `/work/{id}/progress` | сохранить прогресс механика (см. ниже); вызывать при каждом изменении (с задержкой ~1 с) |
| POST | `/work/{id}/finish` | завершить диагностику: в сервисную книжку пишутся замеры против нормы, выполненные проверки с чек-листом, рекомендации → `{entries: [id…]}` |

`progress`: `{"steps": {"<step id>": {"done": true, "value": "4.5"}}, "checks": {"<item id>": true}, "stage": "prep"|"work"|"check"|"after"}`. `checks` — галочки в списках подготовки (tools, materials, safety, disassembly, prep) и проверки качества (quality).

`chat` в `/work/{id}`: `[{role: "user", text, images: <count>}, {role: "assistant", text, sources, ticket, cost}]` — показать прошлую переписку при возврате к работе.

## План (WorkPlan)

```
tools, materials, safety, disassembly, prep   — этап 1 «Подготовка»
steps                                          — этап 2 «Шаги»: только проверки, без ремонта
quality                                        — этап 3 «Проверка» (чек-лист после диагностики)
aftercare                                      — «После диагностики» (рекомендации: какой ремонт указать в заявке, за чем следить)
conflicts: [{note, sides: [{manual_id, manual, pdf_page, quote}], official: [{manual, url}]}]
status: building | ready | failed, note, note_code, version
(failed — в т.ч. если сервер перезапустили во время сборки; тогда показать «Собрать заново»)
```

Пункт (`PlanItem`): `{id, text, preliminary, ref, quote, manual_id, manual, pdf_page, figures, measure: {name, unit, min, max} | null}`. `preliminary=true` — по опыту, не из руководства (показывать как «предварительно»). Старые сохранённые планы могут не иметь новых разделов — считать пустыми.

## Сервисная книжка

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/book/{vehicle_id}` | `{vehicle, entries, works}` — записи новые сверху |
| POST | `/book/{vehicle_id}/entries` `{kind: "note", title?, text, photos: [dataurl…], work_id?}` | заметка механика с фото → `{id, photos: [photo_id…]}` |
| GET | `/photos/{photo_id}` | файл фото |

Запись: `{id, vehicle_id, work_id, session_id, created_at (unix, сек), kind, title, text, data, photos: [photo_id…], source?}`.
`kind`: `diagnosis` (проверка; `source: "history"` — из истории парка), `recheck` (повторная проверка — после заявки на дефектовку), `ticket` (заявка, `data` — заявка), `defect` (замеры диагностики: `data.steps[] = {n, text, done, value, measure, ok, manual, pdf_page}`), `checks` (выполненные проверки, `data.quality[] = {text, ok}`; в старых записях — `repair`), `recommendation` (после диагностики, `data.items[]` — пункты плана), `note`.

## Журнал спорных ситуаций

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/disputes[?resolved=false][&vehicle_id=]` | `[{id, vehicle_id, work_id, created_at, kind, detail, data, resolved}]` |
| PATCH | `/disputes/{id}` `{resolved: true}` | отметить разобранной |

`kind`: `contradiction` (руководства расходятся), `unverified_numbers` (в ответе остались числа без источника), `ticket_rejected` (заявка отклонена проверкой), `low_confidence`, `fuel_mismatch` (тип неисправности невозможен для двигателя), `photo_mismatch` (фото не того двигателя).

## Чат: новое в запросе и ответе

Запрос `/assistant/chat/stream` дополнительно принимает `context: {stage, step_index, step_text}` — где механик в инструкции (чтобы «объясни шаг 3» работало).

Ответ (`done.response`) дополнительно содержит:
- `photo_check: {shows, matches: "yes"|"no"|"unclear", reason, engine} | null` — что на фото и похоже ли на двигатель этой машины;
- `contradictions: [{note, sides: [{manual_id, manual, pdf_page, quote}], official: [{manual, url}]}]` — расхождения в руководствах: показать оба варианта и ссылки на производителя.

## Страница руководства с выделенной цитатой

`/manuals/{manual_id}/pages/{n}.png?w=1200&hl=<текст>` — строки текста `hl` выделены жёлтым. Для источника ответа передавать его `excerpt` (или `quote` пункта плана).
