/**
 * Startup greetings, indexed by the user's native-language code. Each
 * greeting is a function that takes the target-language English name and
 * returns a localized hello. Unknown native codes fall back to English.
 *
 * Keep these short and warm — they're the first thing the user sees.
 */

import { findLang } from "./languages.js";

type Greeter = (targetEnglishName: string) => string;

const en: Greeter = (t) => `Hi! I'm Maxx. Ready to practice some ${t}?`;

const TABLE: Record<string, Greeter> = {
  en,
  es: (t) => `¡Hola! Soy Maxx. ¿Listo para practicar ${t}?`,
  fr: (t) => `Salut ! Je suis Maxx. Prêt à pratiquer le ${t} ?`,
  de: (t) => `Hallo! Ich bin Maxx. Bereit, ${t} zu üben?`,
  it: (t) => `Ciao! Sono Maxx. Pronto a fare un po' di ${t}?`,
  pt: (t) => `Olá! Sou o Maxx. Pronto para praticar ${t}?`,
  "pt-br": (t) => `Oi! Eu sou o Maxx. Bora praticar ${t}?`,
  nl: (t) => `Hoi! Ik ben Maxx. Zin om ${t} te oefenen?`,
  sv: (t) => `Hej! Jag heter Maxx. Redo att öva ${t}?`,
  no: (t) => `Hei! Jeg heter Maxx. Klar for å øve ${t}?`,
  da: (t) => `Hej! Jeg hedder Maxx. Klar til at øve ${t}?`,
  fi: (t) => `Hei! Olen Maxx. Valmiina harjoittelemaan ${t}?`,
  pl: (t) => `Cześć! Jestem Maxx. Gotowy poćwiczyć ${t}?`,
  cs: (t) => `Ahoj! Jsem Maxx. Připraven cvičit ${t}?`,
  ru: (t) => `Привет! Я Макс. Готов попрактиковать ${t}?`,
  uk: (t) => `Привіт! Я Макс. Готовий повчити ${t}?`,
  tr: (t) => `Selam! Ben Maxx. ${t} pratik yapmaya hazır mısın?`,
  el: (t) => `Γεια! Με λένε Μαξ. Έτοιμος να εξασκηθούμε στα ${t};`,
  ar: (t) => `مرحبًا! أنا ماكس. جاهز لممارسة ${t}؟`,
  he: (t) => `היי! אני מקס. מוכן לתרגל ${t}?`,
  fa: (t) => `سلام! من مَکس هستم. آماده‌ای ${t} تمرین کنیم؟`,
  hi: (t) => `नमस्ते! मैं मैक्स हूँ। ${t} का अभ्यास करने के लिए तैयार?`,
  bn: (t) => `হ্যালো! আমি ম্যাক্স। ${t} অনুশীলন করতে প্রস্তুত?`,
  ur: (t) => `ہیلو! میں میکس ہوں۔ کیا ${t} کی مشق کے لیے تیار ہیں؟`,
  ta: (t) => `வணக்கம்! நான் மேக்ஸ். ${t} பயிற்சி செய்ய தயாரா?`,
  th: (t) => `สวัสดี! ฉันชื่อแม็กซ์ พร้อมฝึก${t}แล้วหรือยัง?`,
  vi: (t) => `Chào bạn! Mình là Maxx. Sẵn sàng luyện ${t} chưa?`,
  id: (t) => `Halo! Aku Maxx. Siap latihan ${t}?`,
  ms: (t) => `Hai! Saya Maxx. Sedia berlatih ${t}?`,
  tl: (t) => `Kumusta! Ako si Maxx. Handa nang mag-practice ng ${t}?`,
  ja: (t) => `こんにちは！マックスです。${t}の練習、始めましょうか？`,
  ko: (t) => `안녕! 나는 맥스야. ${t} 연습할 준비 됐어?`,
  zh: (t) => `你好！我是麦克斯。准备好练习${t}了吗？`,
  yue: (t) => `你好！我係Maxx。準備好練習${t}未呀？`,
  sw: (t) => `Habari! Mimi ni Maxx. Uko tayari kufanya mazoezi ya ${t}?`,
  xh: (t) => `Molo! NdinguMaxx. Ulungele ukuziqhelisa i-${t}?`,
  la: (t) => `Salve! Maxx sum. Esne paratus ${t} exercere?`,
};

export function greet(nativeCode: string, targetCode: string): string {
  const targetName = findLang(targetCode)?.name ?? targetCode;
  const fn = TABLE[nativeCode] ?? en;
  return fn(targetName);
}
