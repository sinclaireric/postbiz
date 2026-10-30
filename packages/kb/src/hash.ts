import { createHash } from 'node:crypto';

/** L'empreinte SHA-256 d'un texte ou d'octets, en hexadécimal. À part du reste (qui sert aussi au navigateur) : elle s'appuie sur Node. */
export const sha256Hex = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex');
