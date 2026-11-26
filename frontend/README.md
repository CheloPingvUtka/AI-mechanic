# Цифровой механик — Frontend Starter

Frontend-заготовка для хакатона «ИИ кузница». Проект ориентирован на веб-прототип для механика и главного механика.

## Стек

- React + TypeScript + Vite
- React Router
- Recharts
- Lucide React
- i18next (RU / UZ / HI)
- CSS без тяжёлой UI-библиотеки — проще быстро менять интерфейс под демо

## Запуск на Windows

Требуется Node.js 20.19+ или 22.12+.

```powershell
# 1. Распаковать архив и перейти в папку проекта
cd digital-mechanic-frontend

# 2. Установить зависимости
npm install

# 3. Создать локальный .env
Copy-Item .env.example .env

# 4. Запустить dev-сервер
npm run dev
```

Открыть http://localhost:5173

Проверка production-сборки:

```powershell
npm run build
npm run preview
```

## Страницы

- `/` — рабочее место механика: выбор ТС, получение результата, обработка `normal` / `anomaly` / `check_failed`, чат-помощник.
- `/tickets` — просмотр и отправка заявки на дефектовку в Mock ТОиР.
- `/fleet` — дашборд главного механика, приоритетный список ТС и динамика anomaly_score.

## Переключение с mock на backend

По умолчанию `VITE_USE_MOCKS=true`. Для подключения API:

```env
VITE_USE_MOCKS=false
VITE_ML_API_URL=http://localhost:8001
VITE_AGENT_API_URL=http://localhost:8002
VITE_TOR_API_URL=http://localhost:8003
```

Ожидаемые вызовы frontend:

- `POST {VITE_ML_API_URL}/diagnose` — `{ vehicle_id, session_id }`.
- `POST {VITE_AGENT_API_URL}/chat` — `{ message, vehicle_id }`; ожидается `{ answer, references? }`.
- `POST {VITE_TOR_API_URL}/tickets` — payload заявки по контракту ТЗ.

Если backend-команда выберет единый gateway, достаточно изменить API-клиенты в `src/lib/api/`.

## Архитектура

```text
src/
  app/                  # приложение и маршруты
  components/
    layout/              # оболочка, навигация, шапка
    ui/                  # повторно используемые элементы
  data/                  # синтетические демоданные
  features/
    diagnostics/         # рабочее место механика
    assistant/           # зарезервировано под отдельный чат-модуль
    tickets/             # заявка на дефектовку
    fleet/               # режим главного механика
  i18n/                  # RU / UZ / HI
  lib/api/               # клиенты ML, Agent, ТОиР
  styles/                # глобальные стили
  types/                 # доменные типы и API-контракты
```

## Важные правила проекта

1. Frontend не выполняет акустическую диагностику и не загружает WAV. Он передаёт `vehicle_id` и `session_id` в ML API.
2. При `check_failed` не показываем предположения о неисправности двигателя.
3. Нормативы и ремонтные рекомендации должны приходить от backend/RAG вместе с источником и PDF-страницей. Не хранить их в UI как факты.
4. В текущем mock-режиме показаны только демонстрационные значения. Источник в mock-ответе специально помечен как заглушка.
5. Не добавлять в репозиторий PDF заводских руководств, извлечённый текст руководств и RAG-индексы. Для локальной разработки использовать внешний закрытый каталог или конфигурацию backend.
6. Не логировать персональные данные и не отправлять их во внешние сервисы без согласованной схемы обработки.

## Что делать дальше

- Согласовать с backend-командой единый формат ответа Agent API: `conclusion`, `risk`, `operations`, `references`, `confidence_note`.
- Добавить OCR госномера и загрузку фото, если команда берёт этот дополнительный сценарий.
- Подключить реальный speech-to-text / text-to-speech только после основного сценария.
- Добавить журнал действий с пользователем, вопросом, ответом и источниками на backend-стороне.
