/** localStorage wrapper that never throws (private mode, blocked storage). */
export const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

/** Normalise ISO 639-2 codes ("eng", "ger") to 639-1 ("en", "de"). */
const THREE_TO_TWO: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", dut: "nl", nld: "nl",
  swe: "sv", nor: "no", dan: "da", fin: "fi", pol: "pl", rus: "ru", jpn: "ja", kor: "ko", chi: "zh", zho: "zh",
  ara: "ar", tur: "tr", heb: "he", hin: "hi",
};

export const normalizeLang = (code: string | null | undefined) => {
  if (!code) return null;
  const c = code.toLowerCase();
  return THREE_TO_TWO[c] ?? c.slice(0, 2);
};
