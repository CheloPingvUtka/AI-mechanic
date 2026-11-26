# Цифровой механик

Общий репозиторий проекта для хакатона «ИИкузница». В репозитории находятся frontend, backend и вспомогательные mock-сервисы, которые предоставлены организаторами для проверки интеграции.

## Структура проекта

```text
 цифровой-механик/
 ├── frontend/                  # React-приложение механика
 ├── backend/                   # Основной backend проекта
 │   └── mock-services/         # Mock ML и Mock ТОиР от организаторов
 ├── .gitignore
 └── README.md
```

Папка `backend/` предназначена для основного backend команды. Сейчас в ней находится `mock-services/` — готовые заглушки для тестирования frontend. Это не реализация основного backend.

## Что нужно установить

- Git
- Node.js 20.19+ или 22.12+
- Python 3.10+

## Быстрый запуск

### 1. Frontend

Откройте терминал в папке `frontend`:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Приложение будет доступно по адресу: http://localhost:5173

Проверка сборки:

```powershell
npm run build
```

### 2. Mock ML API

Откройте отдельный терминал в корне репозитория:

```powershell
cd backend/mock-services
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn mock_ml.app:app --port 8001 --reload
```

Документация API: http://127.0.0.1:8001/docs

### 3. Mock ТОиР API

Откройте ещё один терминал в папке `backend/mock-services` и активируйте виртуальное окружение:

```powershell
cd backend/mock-services
.venv\Scripts\activate
uvicorn mock_toir.app:app --port 8002 --reload
```

Документация API: http://127.0.0.1:8002/docs

Для остановки любого сервиса нажмите `Ctrl+C` в его терминале.

## Переменные окружения frontend

Настройки находятся в `frontend/.env`. Пример значений — в `frontend/.env.example`.

```env
VITE_USE_MOCKS=false
VITE_ML_API_URL=http://localhost:8001
VITE_AGENT_API_URL=http://localhost:8003
VITE_TOR_API_URL=http://localhost:8002
```

- `VITE_ML_API_URL` — адрес сервиса диагностики.
- `VITE_TOR_API_URL` — адрес сервиса заявок ТОиР.
- `VITE_AGENT_API_URL` — адрес Agent API. В mock-наборе организаторов такого сервиса нет; порт `8003` — пример адреса для будущего сервиса команды.
- `VITE_USE_MOCKS` — переключатель локальных демонстрационных данных frontend. Для обращения к API установите `false`.

Если frontend и backend используют другие адреса или порты, обновите значения в `.env`.

## Mock-сервисы и тестовые данные

В `backend/mock-services/` находятся:

- `mock_ml/` — заглушка диагностики, `POST /diagnose`;
- `mock_toir/` — заглушка создания заявки, `POST /tickets`;
- `data/vehicles.json` — синтетические данные 50 автомобилей и история проверок;
- `data/fault_types.json` — справочник типов неисправностей;
- `openapi_ml.json`, `openapi_toir.json` — спецификации API;
- `tests/` — тесты заглушек.

Подробная документация по форматам запросов и ответов находится в `backend/mock-services/README.md`.

Mock ML не анализирует аудиозаписи: он возвращает заранее подготовленный результат по `vehicle_id` и `session_id`. Список автомобилей и история проверок берутся из JSON-файла. Mock ТОиР проверяет структуру заявки и возвращает её номер, но не хранит историю после перезапуска.

## Основные правила работы с репозиторием

1. Frontend и backend находятся в отдельных папках, но используют один Git-репозиторий.
2. Не добавляйте в Git `node_modules`, виртуальные окружения Python, сборки, локальные `.env` и временные файлы.
3. Не добавляйте в репозиторий заводские PDF-руководства, извлечённый из них текст и RAG-индексы. Храните такие материалы отдельно от репозитория.
4. Не коммитьте секреты, пароли, токены и приватные ключи.
5. Изменения API-контрактов согласовывайте между frontend и backend. При изменении маршрутов или форматов обновляйте документацию.

## Текущий статус

- Frontend — стартовый React/TypeScript проект.
- Mock ML и Mock ТОиР — заглушки организаторов для локальной интеграции.
- Основной backend и Agent API — разрабатываются отдельно командой.
