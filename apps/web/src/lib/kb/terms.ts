import { KB } from './types';

/**
 * Mots courants (français, anglais, espagnol, allemand, italien, portugais) : ils ne disent rien du sujet d'une question et feraient « trouver » presque
 * tous les passages. Les langues sans espaces (japonais, chinois…) n'ont pas de mots à extraire ainsi : la recherche par le sens prend le relais.
 */
const STOPWORDS = new Set((
  'the and for are but not you your with have has had was were will would can could should from that this these those what when where which who whom how why there their them they then than into about ' +
  'les des une aux est sont pas pour avec dans sur par que qui quoi quel quelle quels quelles quand comment pourquoi vous votre vos nous notre nos mon mes ton tes son ses leur leurs cette ces cet ' +
  'est être avoir fait faire peut puis plus moins très aussi donc mais ainsi chez sans sous entre vers ' +
  'los las una unos unas del con por para como que cuando donde quien cual son ser está están hay pero más muy sin sobre entre ' +
  'der die das den dem des ein eine einen einem einer und oder aber nicht mit für auf von zu ist sind war wie was wer wann wo warum ich sie wir ihr ' +
  'gli uno una dei delle degli con per come che quando dove chi quale sono essere ma più molto senza sopra tra fra ' +
  'uma uns umas dos das com para como quando onde quem qual são ser mas mais muito sem sobre entre'
).split(/\s+/));

/**
 * Les mots d'une question qui servent à chercher dans le texte : en minuscules, sans les mots courants ni les mots trop courts (sauf les nombres : un prix,
 * une heure), sans doublon, `KB.maxTerms` au plus, les plus longs d'abord quand il y en a trop (ils sont les plus précis).
 */
export function queryTerms(query: string, max: number = KB.maxTerms): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || seen.has(raw)) continue;
    const length = [...raw].length;
    const isNumber = /^\p{N}+$/u.test(raw);
    if (!isNumber && (length < 3 || STOPWORDS.has(raw))) continue;
    if (isNumber && length > 20) continue;
    seen.add(raw);
    terms.push(raw);
  }
  if (terms.length <= max) return terms;
  const keep = new Set([...terms].sort((a, b) => [...b].length - [...a].length).slice(0, max));
  return terms.filter((t) => keep.has(t));
}
