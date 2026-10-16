/** Lit les paramètres d'un lien d'e-mail Supabase : ceux de la requête (?code=…) et du fragment (#access_token=…). */
export function parseLinkParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [beforeHash, hash = ""] = url.split("#");
  const query = beforeHash.includes("?") ? beforeHash.slice(beforeHash.indexOf("?") + 1) : "";
  for (const part of [...query.split("&"), ...hash.split("&")]) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
    const value = eq === -1 ? "" : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
    out[key] = value;
  }
  return out;
}
