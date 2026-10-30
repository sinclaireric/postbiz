// Quelles adresses IP un serveur de Postbiz a le droit de contacter pour lire un site. Tout ce qui n'est pas une adresse publique est refusé : réseau local,
// boucle locale, adresses de liaison (dont les services de métadonnées des clouds : 169.254.169.254, fd00:ec2::254), partage d'adresses des opérateurs,
// multicast, réservées, documentation. Pour IPv6, seule la plage « unicast global » (2000::/3) est permise, moins les sous-plages qui n'ont rien de public.

/** Une adresse IPv4 en notation décimale pointée stricte (quatre nombres de 0 à 255, sans zéro de tête), en octets ; sinon null. */
export function parseIPv4(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Une adresse IPv6 (sans crochets ni identifiant de zone, avec `::` et IPv4 intégrée admis), en 16 octets ; sinon null. */
export function parseIPv6(input: string): number[] | null {
  if (!/^[0-9A-Fa-f:.]+$/.test(input) || !input.includes(':')) return null;
  let text = input;
  let tail: number[] = [];
  // IPv4 intégrée à la fin (::ffff:1.2.3.4) : deux groupes de 16 bits.
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const group = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = group(halves[0]!);
  const rest = halves.length === 2 ? group(halves[1]!) : [];
  if (!head || !rest) return null;
  let words: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    words = [...head, ...Array<number>(missing).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    words = head;
  }
  if (tail.length === 2) {
    words[6] = tail[0]!;
    words[7] = tail[1]!;
  }
  return words.flatMap((w) => [w >> 8, w & 0xff]);
}

/** Les `prefix` premiers bits de `bytes` sont ceux de `base` ? */
function inCidr(bytes: readonly number[], base: readonly number[], prefix: number): boolean {
  for (let i = 0; i < prefix; i += 8) {
    const bits = Math.min(8, prefix - i);
    const mask = (0xff << (8 - bits)) & 0xff;
    if (((bytes[i / 8]! ^ base[i / 8]!) & mask) !== 0) return false;
  }
  return true;
}

const cidr = (base: string, prefix: number) => ({ base: parseIPv4(base)!, prefix });

/** Plages IPv4 non publiques. */
const PRIVATE_V4 = [
  cidr('0.0.0.0', 8), // ce réseau
  cidr('10.0.0.0', 8), // privé
  cidr('100.64.0.0', 10), // partage d'adresses des opérateurs (dont 100.100.100.200, métadonnées d'Alibaba Cloud)
  cidr('127.0.0.0', 8), // boucle locale
  cidr('169.254.0.0', 16), // liaison locale (dont 169.254.169.254, métadonnées d'AWS, GCP, Azure, DigitalOcean…)
  cidr('172.16.0.0', 12), // privé
  cidr('192.0.0.0', 24), // protocoles IETF (dont 192.0.0.192, métadonnées d'Oracle Cloud)
  cidr('192.0.2.0', 24), // documentation
  cidr('192.88.99.0', 24), // relais 6to4
  cidr('192.168.0.0', 16), // privé
  cidr('198.18.0.0', 15), // mesures de performance
  cidr('198.51.100.0', 24), // documentation
  cidr('203.0.113.0', 24), // documentation
  cidr('224.0.0.0', 4), // multicast
  cidr('240.0.0.0', 4), // réservé, dont la diffusion générale 255.255.255.255
  cidr('168.63.129.16', 32), // service d'infrastructure d'Azure (adresse publique, mais interne à la plateforme)
];

export function isPublicIPv4(bytes: readonly number[]): boolean {
  return !PRIVATE_V4.some((r) => inCidr(bytes, r.base, r.prefix));
}

const v6 = (...words: number[]): number[] => words.flatMap((w) => [w >> 8, w & 0xff]);

/** Sous-plages de 2000::/3 qui n'ont rien de public. */
const PRIVATE_V6 = [
  { base: v6(0x2001, 0), prefix: 23 }, // protocoles IETF : Teredo, ORCHID, mesures, etc.
  { base: v6(0x2001, 0x0db8), prefix: 32 }, // documentation
  { base: v6(0x2002), prefix: 16 }, // 6to4 (adresse IPv4 intégrée, abandonné)
  { base: v6(0x3ffe), prefix: 16 }, // ancien réseau d'essai 6bone
  { base: v6(0x3fff), prefix: 20 }, // documentation
];

export function isPublicIPv6(bytes: readonly number[]): boolean {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  // IPv4 transportée dans IPv6 : l'adresse IPv4 décide.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicIPv4(bytes.slice(12, 16)); // ::ffff:a.b.c.d
  if (inCidr(bytes, v6(0x64, 0xff9b), 96)) return isPublicIPv4(bytes.slice(12, 16)); // NAT64 64:ff9b::/96
  if (!inCidr(bytes, v6(0x2000), 3)) return false; // tout sauf l'unicast global : ::, ::1, ::a.b.c.d, fc00::/7, fe80::/10, ff00::/8, 64:ff9b:1::/48, 100::/64…
  return !PRIVATE_V6.some((r) => inCidr(bytes, r.base, r.prefix));
}

/** Vrai pour une adresse IP (v4 ou v6, avec ou sans crochets) qu'on a le droit de contacter. Faux pour toute autre chaîne. */
export function isPublicIp(input: string): boolean {
  const text = input.trim().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(text);
  if (v4) return isPublicIPv4(v4);
  const v6bytes = parseIPv6(text);
  return v6bytes ? isPublicIPv6(v6bytes) : false;
}

/** Cette chaîne est-elle une adresse IP (v4 ou v6, avec ou sans crochets) ? */
export function isIpLiteral(input: string): boolean {
  const text = input.trim().replace(/^\[|\]$/g, '');
  return parseIPv4(text) !== null || parseIPv6(text) !== null;
}
