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

Перед запуском укажите в `backend/.env` адреса приватных Mock API и путь к внешнему `vehicles.json`.

### 2. Frontend

Откройте второй терминал в `frontend`:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Frontend по умолчанию запускается Vite на <http://localhost:5173>. Backend API: <http://localhost:8000/docs>.

## Документация частей проекта

- [Frontend](frontend/README.md)
- [Backend](backend/README.md)

## Правила работы с данными

- Не добавляйте в этот репозиторий приватный репозиторий Mock-сервисов, `vehicles.json`, `fault_types.json`, PDF-руководства, RAG-индексы и извлечённый текст.
- Не коммитьте `.env` и секреты.
- Для локальной разработки используйте `.env.example` как шаблон.
