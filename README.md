# Цифровой механик

Веб-прототип AI-агента для помощи механику при работе с результатами акустической диагностики двигателя.

## Структура репозитория

```text
.
├── frontend/   # React + TypeScript + Vite
├── backend/    # Python + FastAPI
└── README.md
```

**Mock ML и Mock ТОиР организаторов находятся в отдельном приватном репозитории.** Их код и тестовые данные не копируются сюда и не коммитятся. Backend обращается к ним по адресам из `backend/.env`.

PDF-руководства, извлечённый текст и RAG-индексы также должны храниться отдельно от Git.

## Быстрый запуск

### 1. Backend

Откройте терминал в `backend`:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```

Перед запуском укажите в `backend/.env` адреса приватных Mock API, путь к внешнему `vehicles.json`, папку с PDF (`KNOWLEDGE_BASE_PATH`) и ключ LLM (`LLM_API_KEY`). Один раз постройте индекс руководств: `python -m app.rag.indexer` (подробности в [backend/README.md](backend/README.md)).

### 2. Frontend

Откройте второй терминал в `frontend`:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Frontend по умолчанию запускается Vite на <http://localhost:5173>. Backend API: <http://localhost:8000/docs>.

## Развёртывание на стенде: материалы задачи

PDF-руководства и данные заглушек в репозитории не хранятся (права правообладателей). Стенд скачивает их при развёртывании по ссылке из материалов задачи. Ссылка задаётся переменной окружения `MATERIALS_URL` или той же строкой в `backend/.env` стенда, в коде её нет. Подходит прямая ссылка на zip или публичная ссылка Яндекс Диска (папка скачивается zip-архивом):

```bash
export MATERIALS_URL='<ссылка на архив из материалов задачи>'
export MATERIALS_DIR=/srv/neurodvs-materials        # вне репозитория; по умолчанию ../private-materials
# export MATERIALS_SHA256=<контрольная сумма архива>  # по желанию: архив с другой суммой не сохраняется
backend/.venv/bin/python scripts/fetch_materials.py --write-env --index
```

Скрипт:

- скачивает архив и распаковывает его в `MATERIALS_DIR`;
- распаковывает вложенный архив заглушек;
- с `--write-env` прописывает в `backend/.env` пути `KNOWLEDGE_BASE_PATH` (папка с PDF) и `VEHICLE_CATALOG_PATH` (`data/vehicles.json` заглушек);
- с `--index` строит индекс руководств. Страницы-сканы распознаются OCR (нужен `tesseract` с языком `rus`), поэтому это занимает время.

Повторный запуск с той же ссылкой ничего не скачивает. Скачать заново: `--force`. Саму ссылку скрипт не печатает и не сохраняет, потому что в ней может быть токен. Команды запуска заглушек он выводит в конце.

Ключ LLM (`LLM_API_KEY`) тоже задаётся только в `backend/.env` на стенде. Поставьте на него лимит расходов в кабинете провайдера.

## Документация частей проекта

- [Frontend](frontend/README.md)
- [Backend](backend/README.md)
- [Калькулятор стоимости](docs/cost.md) — стоимость сценария, разбивка по шагам и пересчёт на парк

## Правила работы с данными

- Не добавляйте в этот репозиторий приватный репозиторий Mock-сервисов, `vehicles.json`, `fault_types.json`, PDF-руководства, RAG-индексы и извлечённый текст.
- Не коммитьте `.env` и секреты.
- Для локальной разработки используйте `.env.example` как шаблон.
