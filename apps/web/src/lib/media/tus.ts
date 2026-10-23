// Envoi par morceaux (protocole TUS 1.0.0) vers Supabase Storage, sans dépendance : un gros fichier (vidéo) part en morceaux de 6 Mio,
// reprend au bon endroit après une coupure réseau, et rend compte de sa progression. Supabase recommande ce mode au-delà de 6 Mio.
// Documentation : https://supabase.com/docs/guides/storage/uploads/resumable-uploads

export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
/** Au-delà de cette taille on utilise TUS ; en dessous, un envoi simple suffit. */
export const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;

export interface TusOptions {
  /** `<projet>.supabase.co/storage/v1/upload/resumable`. */
  endpoint: string;
  /** En-têtes d'authentification (Authorization et apikey). */
  headers: Record<string, string>;
  bucket: string;
  objectName: string;
  contentType: string;
  file: Blob;
  onProgress?: (sent: number, total: number) => void;
  chunkBytes?: number;
  /** Tentatives par morceau en cas de coupure ou de 5xx. */
  retries?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Pause entre deux tentatives (remplaçable dans les tests). */
  sleep?: (ms: number) => Promise<void>;
}

export class TusError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'TusError';
  }
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const TUS = { 'Tus-Resumable': '1.0.0' };

/** Envoie le fichier ; renvoie quand le serveur a reçu tous les octets. Lève TusError sinon. */
export async function tusUpload(o: TusOptions): Promise<void> {
  const doFetch = o.fetchImpl ?? fetch;
  const chunk = o.chunkBytes ?? TUS_CHUNK_BYTES;
  const retries = o.retries ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const total = o.file.size;

  const metadata = [`bucketName ${b64(o.bucket)}`, `objectName ${b64(o.objectName)}`, `contentType ${b64(o.contentType)}`, `cacheControl ${b64('3600')}`].join(',');
  const created = await doFetch(o.endpoint, {
    method: 'POST', signal: o.signal,
    headers: { ...o.headers, ...TUS, 'Upload-Length': String(total), 'Upload-Metadata': metadata, 'x-upsert': 'false' },
  });
  if (created.status !== 201) throw new TusError(`Création de l’envoi refusée (${created.status})`, created.status);
  const location = created.headers.get('Location');
  if (!location) throw new TusError('Réponse sans adresse d’envoi');
  const url = new URL(location, o.endpoint).toString();

  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunk, total);
    let sent = false;
    for (let attempt = 0; attempt <= retries && !sent; attempt++) {
      if (o.signal?.aborted) throw new TusError('Envoi annulé');
      try {
        const res = await doFetch(url, {
          method: 'PATCH', signal: o.signal,
          headers: { ...o.headers, ...TUS, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
          body: o.file.slice(offset, end),
        });
        if (res.status === 204 || res.status === 200) {
          const next = Number(res.headers.get('Upload-Offset'));
          offset = Number.isFinite(next) && next > offset ? next : end;
          sent = true;
        } else if (res.status >= 500 || res.status === 409 || res.status === 423) {
          throw new TusError(`Le serveur a répondu ${res.status}`, res.status);
        } else {
          throw Object.assign(new TusError(`Morceau refusé (${res.status})`, res.status), { fatal: true });
        }
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal || o.signal?.aborted || attempt === retries) throw e instanceof TusError ? e : new TusError(`Coupure réseau : ${(e as Error).message}`);
        await sleep(500 * 2 ** attempt);
        // Après une coupure, on demande au serveur où il en est : le morceau a pu arriver sans que la réponse nous parvienne.
        try {
          const head = await doFetch(url, { method: 'HEAD', signal: o.signal, headers: { ...o.headers, ...TUS } });
          const known = Number(head.headers.get('Upload-Offset'));
          if (head.ok && Number.isFinite(known) && known >= 0) offset = Math.min(known, total);
        } catch {
          /* on retente simplement le même morceau */
        }
        if (offset >= total) sent = true;
      }
    }
    o.onProgress?.(offset, total);
  }
}
