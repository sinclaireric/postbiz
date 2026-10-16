/** N'accepte qu'un chemin interne du site (pas d'URL externe, pas de `//`), sinon renvoie `fallback`. */
export function safeNext(value: string | null | undefined, fallback = '/app'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
