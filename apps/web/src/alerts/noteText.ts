import type { TFunction } from "i18next";
import { isDemo } from "@/demo/mode";

/** Préfixe des notes que la graine de démonstration écrit en code, jamais en phrase. */
const DEMO_NOTE_PREFIX = "demo:";

/**
 * Le texte affiché de la note d'une alerte manuelle. La note d'un vrai compte est un texte
 * libre, rendu tel quel. En démonstration seulement, la graine écrit un code (`demo:support`)
 * que cette fonction traduit dans la langue de l'interface (`demo.alertNotes.*`) : une note
 * stockée en français resterait en français dans l'interface anglaise. Un code inconnu reste
 * tel quel.
 */
export function alertNoteText(note: string | null, t: TFunction): string | null {
  if (note === null || !isDemo() || !note.startsWith(DEMO_NOTE_PREFIX)) return note;
  const key = `demo.alertNotes.${note.slice(DEMO_NOTE_PREFIX.length)}`;
  const text = t(key);
  return text === key ? note : text;
}
