export interface Parsed {
  data: Record<string, string>;
  body: string;
}

/**
 * Frontmatter minimal d'un article : des lignes `clé: valeur` entre deux lignes `---`, en tête de fichier.
 * Pas de YAML complet (ni listes ni objets) : un fichier qui sort de ce cadre échoue au build, pas en production.
 */
export function parseFrontmatter(source: string): Parsed {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { data: {}, body: text };

  const data: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`Frontmatter invalide : « ${line} »`);
    let value = line.slice(colon + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    data[line.slice(0, colon).trim()] = value;
  }
  return { data, body: text.slice(match[0].length) };
}
