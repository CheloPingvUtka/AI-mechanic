import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ru: { translation: {
    workspace: "Рабочее место", fleet: "Автопарк", tickets: "Дефектовки", history: "История проверок",
    mechanic: "Механик", systemReady: "Система доступна", selectedVehicle: "Транспортное средство",
    getResult: "Получить результат диагностики", assistant: "Помощник механика", ask: "Спросить помощника…",
    createTicket: "Создать заявку на дефектовку", normal: "Норма", anomaly: "Отклонение", check_failed: "Сбой проверки",
    ready: "Готовы к работе", attention: "Требуют внимания", quarantine: "В карантине",
    page: "стр.",
    plan: {
      starting: "Готовлю рабочий план…", eyebrow: "РАБОЧИЙ ПЛАН", title: "Что подготовить и что делать",
      status_building: "собирается", status_ready: "готов", status_failed: "ошибка",
      tools: "Инструмент", materials: "Запчасти и материалы", safety: "Безопасность", steps: "Шаги",
      preliminary: "предварительно", new: "новое", norm: "Норма", ok: "в норме", outOfNorm: "вне нормы",
      doneYes: "Сделано", doneNo: "Отметить", report: "Отправить результаты агенту",
      reportHeader: "Результаты работ по плану:",
    },
    close: "Закрыть", openPdf: "PDF на этой странице", officialSite: "Официальный сайт", figure: "Рисунок",
    sources: "Источники", openPage: "Открыть страницу", quote: "Цитата", scanCheck: "скан: сверить числа",
    photoQuestion: "Что на фото? Это то место, которое надо проверить?", remove: "Убрать", attachPhoto: "Сфотографировать", send: "Отправить",
    progress: {
      thinking: "Думаю…", working: "Работаю…",
      search: "Ищу в руководстве: «{{q}}»", found: "нашёл: {{pages}}", notFound: "в руководстве не найдено",
      diagnosis: "Запрашиваю результат проверки", ticket: "Формирую заявку в ТОиР", ticketDone: "заявка {{id}} создана",
      viewPage: "Смотрю страницу руководства {{page}}",
      checking: "Сверяю числа с найденными страницами руководства", fixing: "Нашёл число без источника — переписываю ответ",
      how: "Как я искал ответ ({{n}} шагов)",
    },
  }},
  uz: { translation: {
    workspace: "Ish joyi", fleet: "Avtopark", tickets: "Nuqson dalolatnomalari", history: "Tekshiruvlar tarixi",
    mechanic: "Mexanik", systemReady: "Tizim tayyor", selectedVehicle: "Transport vositasi",
    getResult: "Diagnostika natijasini olish", assistant: "Mexanik yordamchisi", ask: "Savol bering…",
    createTicket: "Nuqson dalolatnomasini yaratish", normal: "Me'yor", anomaly: "Og'ish", check_failed: "Tekshiruv xatosi",
    ready: "Ishga tayyor", attention: "E'tibor talab qiladi", quarantine: "Karantinda",
    page: "bet",
    plan: {
      starting: "Ish rejasini tayyorlayapman…", eyebrow: "ISH REJASI", title: "Nima tayyorlash va nima qilish kerak",
      status_building: "tuzilmoqda", status_ready: "tayyor", status_failed: "xato",
      tools: "Asboblar", materials: "Ehtiyot qismlar va materiallar", safety: "Xavfsizlik", steps: "Qadamlar",
      preliminary: "taxminiy", new: "yangi", norm: "Me’yor", ok: "me’yorda", outOfNorm: "me’yordan tashqari",
      doneYes: "Bajarildi", doneNo: "Belgilash", report: "Natijalarni yordamchiga yuborish",
      reportHeader: "Reja bo‘yicha ish natijalari:",
    },
    close: "Yopish", openPdf: "Shu sahifadagi PDF", officialSite: "Rasmiy sayt", figure: "Rasm",
    sources: "Manbalar", openPage: "Sahifani ochish", quote: "Iqtibos", scanCheck: "skan: raqamlarni tekshiring",
    photoQuestion: "Rasmda nima bor? Tekshirish kerak bo‘lgan joy shumi?", remove: "Olib tashlash", attachPhoto: "Suratga olish", send: "Yuborish",
    progress: {
      thinking: "O‘ylayapman…", working: "Ishlayapman…",
      search: "Qo‘llanmadan qidiryapman: «{{q}}»", found: "topildi: {{pages}}", notFound: "qo‘llanmada topilmadi",
      diagnosis: "Tekshiruv natijasini so‘rayapman", ticket: "Ta’mirlash tizimiga ariza tayyorlayapman", ticketDone: "{{id}} raqamli ariza yaratildi",
      viewPage: "Qo‘llanma sahifasini ko‘ryapman {{page}}",
      checking: "Raqamlarni topilgan qo‘llanma sahifalari bilan solishtiryapman", fixing: "Manbasiz raqam topildi — javobni qayta yozyapman",
      how: "Javobni qanday qidirdim ({{n}} qadam)",
    },
  }},
  hi: { translation: {
    workspace: "कार्यस्थल", fleet: "वाहन बेड़ा", tickets: "निरीक्षण अनुरोध", history: "जाँच इतिहास",
    mechanic: "मैकेनिक", systemReady: "सिस्टम उपलब्ध", selectedVehicle: "वाहन",
    getResult: "निदान परिणाम प्राप्त करें", assistant: "मैकेनिक सहायक", ask: "अपना प्रश्न लिखें…",
    createTicket: "निरीक्षण अनुरोध बनाएँ", normal: "सामान्य", anomaly: "विचलन", check_failed: "जाँच विफल",
    ready: "काम के लिए तैयार", attention: "ध्यान आवश्यक", quarantine: "क्वारंटीन"
  }},
};

void i18n.use(initReactI18next).init({
  resources, lng: "ru", fallbackLng: "ru", interpolation: { escapeValue: false },
});

export default i18n;