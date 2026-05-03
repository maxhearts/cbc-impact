/**
 * Languages selectable in the header pair picker. The list is intentionally
 * generous; the LLM handles whatever you throw at it.
 */

export interface Language {
  code: string;     // BCP-47-ish short code, just for keys
  name: string;     // English name, sent verbatim to the LLM
  flag?: string;    // emoji flag, displayed in the option
}

export const LANGUAGES: Language[] = [
  { code: "en",    name: "English",         flag: "🇬🇧" },
  { code: "es",    name: "Spanish",         flag: "🇪🇸" },
  { code: "fr",    name: "French",          flag: "🇫🇷" },
  { code: "de",    name: "German",          flag: "🇩🇪" },
  { code: "it",    name: "Italian",         flag: "🇮🇹" },
  { code: "pt",    name: "Portuguese",      flag: "🇵🇹" },
  { code: "pt-br", name: "Brazilian Portuguese", flag: "🇧🇷" },
  { code: "nl",    name: "Dutch",           flag: "🇳🇱" },
  { code: "sv",    name: "Swedish",         flag: "🇸🇪" },
  { code: "no",    name: "Norwegian",       flag: "🇳🇴" },
  { code: "da",    name: "Danish",          flag: "🇩🇰" },
  { code: "fi",    name: "Finnish",         flag: "🇫🇮" },
  { code: "pl",    name: "Polish",          flag: "🇵🇱" },
  { code: "cs",    name: "Czech",           flag: "🇨🇿" },
  { code: "ru",    name: "Russian",         flag: "🇷🇺" },
  { code: "uk",    name: "Ukrainian",       flag: "🇺🇦" },
  { code: "tr",    name: "Turkish",         flag: "🇹🇷" },
  { code: "el",    name: "Greek",           flag: "🇬🇷" },
  { code: "ar",    name: "Arabic",          flag: "🇸🇦" },
  { code: "he",    name: "Hebrew",          flag: "🇮🇱" },
  { code: "fa",    name: "Persian",         flag: "🇮🇷" },
  { code: "hi",    name: "Hindi",           flag: "🇮🇳" },
  { code: "bn",    name: "Bengali",         flag: "🇧🇩" },
  { code: "ur",    name: "Urdu",            flag: "🇵🇰" },
  { code: "ta",    name: "Tamil",           flag: "🇮🇳" },
  { code: "th",    name: "Thai",            flag: "🇹🇭" },
  { code: "vi",    name: "Vietnamese",      flag: "🇻🇳" },
  { code: "id",    name: "Indonesian",      flag: "🇮🇩" },
  { code: "ms",    name: "Malay",           flag: "🇲🇾" },
  { code: "tl",    name: "Tagalog",         flag: "🇵🇭" },
  { code: "ja",    name: "Japanese",        flag: "🇯🇵" },
  { code: "ko",    name: "Korean",          flag: "🇰🇷" },
  { code: "zh",    name: "Mandarin Chinese",flag: "🇨🇳" },
  { code: "yue",   name: "Cantonese",       flag: "🇭🇰" },
  { code: "sw",    name: "Swahili",         flag: "🇰🇪" },
  { code: "la",    name: "Latin",           flag: "🏛️" },
];

export const DEFAULT_NATIVE = "en";
export const DEFAULT_TARGET = "ja";

export function findLang(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
