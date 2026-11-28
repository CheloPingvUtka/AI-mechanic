// Vehicle search that does not care which keyboard layout the mechanic types on.
// Plates are stored in Latin letters (M333YK47) but typed in Cyrillic (М333УК47): the twelve letters a
// Russian plate uses look the same in both alphabets. Models and engines are Cyrillic (Урал, ЯМЗ) and may be
// typed in Latin (ural, yamz). Spaces, dashes and dots do not count («Г-143» = «г143»).

const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
};
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const squash = (text: string) => text.toLowerCase().replace(/[\s\-‐–—·.,_/]+/g, "");
const map = (text: string, table: Record<string, string>) => [...text].map(c => table[c] ?? c).join("");

/** The forms a text can be found by: as written, Cyrillic look-alikes as Latin, and Latin transliteration. */
export function searchForms(text: string): string[] {
  const s = squash(text);
  return [...new Set([s, map(s, LOOKALIKE), map(s, TRANSLIT)])];
}

/** Does the query match any of the fields, whatever the layout it was typed in? */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = searchForms(query).filter(Boolean);
  if (!q.length) return true;
  const targets = fields.filter((f): f is string => !!f).flatMap(searchForms);
  return q.some(k => targets.some(t => t.includes(k)));
}
