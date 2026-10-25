/** Empreinte courte d'un identifiant : un fournisseur d'IA reçoit de quoi repérer un abus ou regrouper des demandes, jamais l'identité de la personne. */
export async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`postbiz:${value}`)));
  return [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
