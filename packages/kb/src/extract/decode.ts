/** Les octets d'un texte, décodés : avec BOM (UTF-8, UTF-16), sinon selon le jeu de caractères annoncé, sinon UTF-8 strict, sinon Windows-1252. */
export function decodeText(bytes: Uint8Array, hint?: string | null): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const attempt = (label: string, fatal: boolean): string | null => {
    try {
      return new TextDecoder(label, { fatal }).decode(bytes);
    } catch {
      return null;
    }
  };
  if (hint) {
    // Le jeu de caractères annoncé est cru, sauf s'il donne des caractères de remplacement (l'annonce est fausse).
    const text = attempt(hint.trim().toLowerCase(), false);
    if (text !== null && !text.includes('�')) return text;
  }
  return attempt('utf-8', true) ?? new TextDecoder('windows-1252').decode(bytes);
}

/** Le jeu de caractères déclaré dans les premiers octets d'une page HTML (`<meta charset>` ou `<meta http-equiv="Content-Type">`), ou null. */
export function sniffHtmlCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4_096));
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head);
  return m?.[1]?.toLowerCase() ?? null;
}

/** Plus de 5 % d'octets nuls dans les premiers 8 Ko : ce n'est pas un texte. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return false; // UTF-16 : des octets nuls sont normaux
  const sample = bytes.subarray(0, 8_192);
  let nuls = 0;
  for (const b of sample) if (b === 0) nuls++;
  return sample.length > 0 && nuls / sample.length > 0.05;
}
