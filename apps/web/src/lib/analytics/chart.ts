// Tracés des courbes en SVG, sans bibliothèque : des chaînes `d` prêtes à poser dans un <path>. Pur, donc testable.

export interface Paths {
  /** La ligne (segments séparés là où la valeur est inconnue). */
  line: string;
  /** La surface sous la ligne, fermée sur la base. */
  area: string;
}

interface Options {
  width: number;
  height: number;
  /** Marge verticale pour que le trait ne soit pas rogné en haut et en bas. */
  pad?: number;
  /** Échelle depuis zéro (compteurs : une journée vide doit rester en bas) plutôt que du plus bas au plus haut relevé (abonnés). */
  fromZero?: boolean;
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Points reliés par des segments ; une valeur null coupe la ligne. Une série constante se pose en bas (compteur à zéro) ou au milieu. */
export function linePaths(values: readonly (number | null)[], { width, height, pad = 2, fromZero = false }: Options): Paths {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return { line: '', area: '' };
  const hi = Math.max(...known);
  const lo = fromZero ? Math.min(0, ...known) : Math.min(...known);
  const top = pad;
  const bottom = height - pad;
  const y = (v: number) => (hi === lo ? (fromZero ? bottom : (top + bottom) / 2) : bottom - ((v - lo) / (hi - lo)) * (bottom - top));
  const x = (i: number) => (values.length === 1 ? width / 2 : (i * width) / (values.length - 1));

  let line = '';
  let area = '';
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const pts = run.map((p) => `${r(p.x)} ${r(p.y)}`);
    line += `M${pts.join(' L')}`;
    if (run.length === 1) line += ` L${pts[0]}`; // un point isolé : trait de longueur nulle, rendu en point par le bout rond
    const first = run[0]!;
    const last = run[run.length - 1]!;
    area += `M${r(first.x)} ${r(bottom)} L${pts.join(' L')} L${r(last.x)} ${r(bottom)} Z`;
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null) flush();
    else run.push({ x: x(i), y: y(v) });
  });
  flush();
  return { line, area };
}

/** Hauteur d'une barre en pourcentage de la zone (une barre non nulle reste visible : 4 % au minimum). */
export const barHeight = (value: number, max: number): number => (value <= 0 || max <= 0 ? 0 : Math.max(4, (value / max) * 100));
