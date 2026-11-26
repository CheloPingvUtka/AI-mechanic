import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ru: { translation: {
    workspace: "Рабочее место", fleet: "Автопарк", tickets: "Дефектовки", history: "История проверок",
    mechanic: "Механик", systemReady: "Система доступна", selectedVehicle: "Транспортное средство",
    getResult: "Получить результат диагностики", assistant: "Помощник механика", ask: "Спросить помощника…",
    createTicket: "Создать заявку на дефектовку", normal: "Норма", anomaly: "Отклонение", failed: "Сбой проверки",
    ready: "Готовы к работе", attention: "Требуют внимания", quarantine: "В карантине"
  }},
  uz: { translation: {
    workspace: "Ish joyi", fleet: "Avtopark", tickets: "Nuqson dalolatnomalari", history: "Tekshiruvlar tarixi",
    mechanic: "Mexanik", systemReady: "Tizim tayyor", selectedVehicle: "Transport vositasi",
    getResult: "Diagnostika natijasini olish", assistant: "Mexanik yordamchisi", ask: "Savol bering…",
    createTicket: "Nuqson dalolatnomasini yaratish", normal: "Me'yor", anomaly: "Og'ish", failed: "Tekshiruv xatosi",
    ready: "Ishga tayyor", attention: "E'tibor talab qiladi", quarantine: "Karantinda"
  }},
  hi: { translation: {
    workspace: "कार्यस्थल", fleet: "वाहन बेड़ा", tickets: "निरीक्षण अनुरोध", history: "जाँच इतिहास",
    mechanic: "मैकेनिक", systemReady: "सिस्टम उपलब्ध", selectedVehicle: "वाहन",
    getResult: "निदान परिणाम प्राप्त करें", assistant: "मैकेनिक सहायक", ask: "अपना प्रश्न लिखें…",
    createTicket: "निरीक्षण अनुरोध बनाएँ", normal: "सामान्य", anomaly: "विचलन", failed: "जाँच विफल",
    ready: "काम के लिए तैयार", attention: "ध्यान आवश्यक", quarantine: "क्वारंटीन"
  }},
};

void i18n.use(initReactI18next).init({
  resources, lng: "ru", fallbackLng: "ru", interpolation: { escapeValue: false },
});

export default i18n;