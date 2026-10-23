// La base stocke le texte brut (c'est ce que le worker envoie aux réseaux) ; l'éditeur riche manipule du HTML.

/** HTML de l'éditeur -> texte brut. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<\/div>\s*<div[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Texte brut -> HTML pour l'éditeur et les aperçus. */
export function plainToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

/** Majuscule à la première lettre seulement (les dates de date-fns en français sont en minuscules : « vendredi 23 octobre »). */
export function capFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
