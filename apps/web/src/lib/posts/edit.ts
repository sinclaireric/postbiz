/** Insère du texte à la position du curseur (ou à la place de la sélection) et renvoie le nouveau texte et la nouvelle position du curseur. */
export function insertAt(value: string, start: number, end: number, insert: string): { value: string; cursor: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return { value: value.slice(0, from) + insert + value.slice(to), cursor: from + insert.length };
}

/** Ajoute un texte à la suite de l'existant, séparé par une ligne vide. */
export function appendText(value: string, addition: string): string {
  const base = value.trimEnd();
  return base ? `${base}\n\n${addition.trim()}` : addition.trim();
}
