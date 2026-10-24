import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { cropRect, nearestInstagramRatio, outputSize } from "@/lib/image-fit";
import { MAX_MEDIA_BYTES, type MediaKind } from "@/lib/media-rules";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import { uuidv4 } from "@/utils/uuid";

// Médiathèque : fichiers dans le bucket privé `media` (chemin `{org_id}/{uuid}-{nom}`, voir les migrations engine et media)
// et une ligne dans la table `media`. Même contrat que le web (apps/web/src/lib/media/upload.ts) : vignette JPEG de 480 px,
// et version JPEG pour les images qui n'en sont pas (Instagram n'accepte que le JPEG). Les URL sont signées et expirent.

export type MediaItem = {
  id: string;
  path: string;
  name: string;
  mimeType: string | null;
  kind: MediaKind;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  alt: string;
  createdAt: string;
  /** URL signée du fichier (1 h), null si indisponible. */
  url: string | null;
  /** URL signée de la vignette, null si le média n'en a pas. */
  thumbUrl: string | null;
};

const SIGNED_URL_SECONDS = 3600;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov" };
const THUMB_MAX_PX = 480;
const JPEG_MAX_PX = 4096;
const COLUMNS = "id, path, name, mime_type, kind, size_bytes, width, height, duration_seconds, alt, thumbnail_path, created_at";

type Row = Record<string, any>;

/** Nom d'affichage : retire le préfixe d'identifiant ajouté au chemin. */
const displayName = (path: string) => path.split("/").pop()!.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");

/** Nom de fichier sûr pour un chemin de stockage : sans accents, espaces ni caractères spéciaux. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const dot = cleaned.lastIndexOf(".");
  const base = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 80).replace(/[-.]+$/, "") || "fichier";
  const ext = dot > 0 ? cleaned.slice(dot + 1).slice(0, 10).toLowerCase() : "";
  return ext ? `${base}.${ext}` : base;
}

async function toItems(rows: Row[]): Promise<MediaItem[]> {
  const paths = [...new Set(rows.flatMap((r) => [r.path as string, r.thumbnail_path as string]).filter(Boolean))];
  const { data: signed } = paths.length ? await supabase.storage.from("media").createSignedUrls(paths, SIGNED_URL_SECONDS) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name ?? displayName(r.path),
    mimeType: r.mime_type ?? null,
    kind: r.kind === "video" ? "video" : "image",
    sizeBytes: r.size_bytes ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    alt: r.alt ?? "",
    createdAt: r.created_at,
    url: urls.get(r.path) ?? null,
    thumbUrl: r.thumbnail_path ? (urls.get(r.thumbnail_path) ?? null) : null,
  }));
}

export async function listMedia(orgId: string, o: { page?: number; pageSize?: number } = {}): Promise<{ items: MediaItem[]; total: number }> {
  const pageSize = o.pageSize ?? 60;
  const from = (Math.max(1, o.page ?? 1) - 1) * pageSize;
  const { data, count } = await supabase
    .from("media")
    .select(COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return { items: await toItems((data ?? []) as Row[]), total: count ?? 0 };
}

/** Médias demandés, dans l'ordre des identifiants ; ceux qui n'existent plus sont ignorés. */
export async function mediaByIds(orgId: string, ids: string[]): Promise<MediaItem[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { data } = await supabase.from("media").select(COLUMNS).eq("org_id", orgId).in("id", unique);
  const items = await toItems((data ?? []) as Row[]);
  const byId = new Map(items.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is MediaItem => !!m);
}

/** Message lisible pour une réponse d'erreur du stockage. */
function storageErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "Vous n’avez pas le droit d’ajouter des médias à cette organisation.";
  if (status === 413) return "Ce fichier dépasse la taille maximale acceptée par le stockage.";
  if (status >= 500) return "Le stockage est momentanément indisponible. Réessayez dans un instant.";
  return `Le stockage a refusé le fichier (code ${status}).`;
}

/**
 * Envoie un fichier local dans le bucket `media`, directement depuis le disque (rien n'est chargé en mémoire).
 * Le client Supabase JS ne convient pas ici : sur React Native, `storage.upload` casse avec FormData et Blob. On appelle donc
 * l'API de stockage avec le jeton de la session, en corps binaire. Renvoie null si tout va bien, sinon le message d'erreur.
 */
async function uploadFile(path: string, uri: string, type: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "Session expirée. Reconnectez-vous.";
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await FileSystem.uploadAsync(`${supabaseUrl}/storage/v1/object/media/${encodedPath}`, uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, "Content-Type": type, "x-upsert": "false", "cache-control": "max-age=3600" },
    });
    return res.status >= 200 && res.status < 300 ? null : storageErrorMessage(res.status);
  } catch {
    return "Envoi impossible. Vérifiez votre connexion.";
  }
}

async function renditions(uri: string, width: number | null, height: number | null, isJpeg: boolean): Promise<{ thumb: string | null; jpeg: string | null }> {
  const render = async (max: number, compress: number) => {
    const longest = Math.max(width ?? 0, height ?? 0);
    const scale = longest > 0 ? Math.min(1, max / longest) : 1;
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    if (width && height && scale < 1) ctx.resize({ width: Math.max(1, Math.round(width * scale)) });
    const image = await ctx.renderAsync();
    return (await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress })).uri;
  };
  try {
    const thumb = await render(THUMB_MAX_PX, 0.8);
    const jpeg = isJpeg ? null : await render(JPEG_MAX_PX, 0.92);
    return { thumb, jpeg };
  } catch {
    return { thumb: null, jpeg: null }; // format non décodable : on envoie quand même le fichier
  }
}

export type UploadResult = Result & { items?: MediaItem[] };

type LocalAsset = {
  uri: string;
  name: string;
  mime: string;
  isVideo: boolean;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
};

/** Envoie un fichier local (avec vignette et version JPEG) et l'enregistre dans la médiathèque. */
async function storeAsset(orgId: string, userId: string, a: LocalAsset): Promise<{ id: string } | { error: string }> {
  const uuid = uuidv4();
  const base = `${orgId}/${uuid}`;
  const paths = { original: `${base}-${safeFileName(a.name)}`, thumb: `${base}-thumb.jpg`, jpeg: `${base}-instagram.jpg` };
  const uploaded: string[] = [];
  const cleanup = async () => {
    if (uploaded.length > 0) await supabase.storage.from("media").remove(uploaded);
  };
  try {
    const sendError = await uploadFile(paths.original, a.uri, a.mime);
    if (sendError) return { error: sendError };
    uploaded.push(paths.original);

    let thumb: string | null = null;
    let jpeg: string | null = null;
    if (!a.isVideo) {
      const r = await renditions(a.uri, a.width, a.height, a.mime === "image/jpeg");
      if (r.thumb && !(await uploadFile(paths.thumb, r.thumb, "image/jpeg"))) {
        uploaded.push(paths.thumb);
        thumb = paths.thumb;
      }
      if (r.jpeg && !(await uploadFile(paths.jpeg, r.jpeg, "image/jpeg"))) {
        uploaded.push(paths.jpeg);
        jpeg = paths.jpeg;
      }
    }

    const { data: row, error } = await supabase
      .from("media")
      .insert({
        org_id: orgId,
        bucket: "media",
        path: paths.original,
        name: a.name.slice(0, 255),
        mime_type: a.mime,
        size_bytes: a.sizeBytes,
        width: a.width || null,
        height: a.height || null,
        duration_seconds: a.durationSeconds,
        status: "ready",
        thumbnail_path: thumb,
        normalized_path: jpeg,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !row) {
      await cleanup();
      return { error: GENERIC_ERROR };
    }
    return { id: row.id as string };
  } catch {
    await cleanup();
    return { error: "Envoi impossible. Vérifiez votre connexion." };
  }
}

/** Choisit des images ou vidéos dans la photothèque du téléphone et les ajoute à la médiathèque. */
export async function pickAndUpload(onProgress?: (done: number, total: number) => void): Promise<UploadResult> {
  const org = useOrgStore.getState().current;
  const user = useAuthStore.getState().user;
  if (!org || !user) return fail("Session expirée. Reconnectez-vous.");
  if (!useOrgStore.getState().canWrite) return fail("Votre rôle ne permet pas d’ajouter des médias.");

  // Pas de demande d'autorisation préalable : le sélecteur système (iOS 14+, Android 13+) n'en exige pas et donne
  // accès aux seules photos choisies.
  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1,
      // iOS : HEIC converti en JPEG (les réseaux ne le lisent pas).
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
  } catch {
    return fail("Impossible d’ouvrir la photothèque. Autorisez l’accès aux photos dans les réglages du téléphone.");
  }
  if (picked.canceled || picked.assets.length === 0) return { ...ok(), items: [] };

  const createdIds: string[] = [];
  onProgress?.(0, picked.assets.length);
  for (const asset of picked.assets) {
    const isVideo = asset.type === "video" || asset.type === "pairedVideo";
    const mime = (asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg")).toLowerCase();
    // Le nom suit le type réel : iOS convertit le HEIC en JPEG mais garde parfois « IMG_0001.HEIC ».
    const ext = EXTENSIONS[mime] ?? (asset.fileName?.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    const stem = (asset.fileName ?? `${isVideo ? "video" : "photo"}-${uuidv4().slice(0, 8)}`).replace(/\.[^./]+$/, "");
    const name = ext ? `${stem}.${ext}` : stem;
    if (asset.fileSize && asset.fileSize > MAX_MEDIA_BYTES) return fail(`« ${name} » dépasse 1 Go.`);

    const stored = await storeAsset(org.id, user.id, {
      uri: asset.uri,
      name,
      mime,
      isVideo,
      width: asset.width ?? null,
      height: asset.height ?? null,
      sizeBytes: asset.fileSize ?? null,
      durationSeconds: asset.duration ? asset.duration / 1000 : null,
    });
    if ("error" in stored) return fail(stored.error);
    createdIds.push(stored.id);
    onProgress?.(createdIds.length, picked.assets.length);
  }
  return { ...ok(), items: await mediaByIds(org.id, createdIds) };
}

export type CropResult = Result & { item?: MediaItem };

/**
 * Recadre une image de la médiathèque au format `ratio` (largeur / hauteur) autour du point de vue (`fx`, `fy`, de 0 à 1),
 * et l'enregistre comme nouveau média (l'original est conservé). Sans `ratio`, le format accepté le plus proche est choisi.
 */
export async function cropMedia(item: MediaItem, o: { ratio?: number; fx?: number; fy?: number } = {}): Promise<CropResult> {
  const org = useOrgStore.getState().current;
  const user = useAuthStore.getState().user;
  if (!org || !user) return fail("Session expirée. Reconnectez-vous.");
  if (!item.url) return fail("Image introuvable dans le stockage.");

  const local = `${FileSystem.cacheDirectory}crop-${uuidv4()}`;
  let rendered: string | null = null;
  try {
    const dl = await FileSystem.downloadAsync(item.url, local);
    if (dl.status < 200 || dl.status >= 300) return fail("Impossible de récupérer l’image. Réessayez.");

    const source = await ImageManipulator.ImageManipulator.manipulate(local).renderAsync();
    const rect = cropRect(source.width, source.height, o.ratio ?? nearestInstagramRatio(source.width, source.height), o.fx, o.fy);
    const size = outputSize(rect);
    const ctx = ImageManipulator.ImageManipulator.manipulate(local).crop(rect);
    if (size.width !== rect.width || size.height !== rect.height) ctx.resize(size);
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.92 });
    rendered = saved.uri;

    const stem = item.name.replace(/\.[^./]+$/, "").replace(/-instagram$/, "");
    const stored = await storeAsset(org.id, user.id, {
      uri: saved.uri,
      name: `${stem}-instagram.jpg`,
      mime: "image/jpeg",
      isVideo: false,
      width: saved.width,
      height: saved.height,
      sizeBytes: null,
      durationSeconds: null,
    });
    if ("error" in stored) return fail(stored.error);
    const [created] = await mediaByIds(org.id, [stored.id]);
    return created ? { ...ok(), item: { ...created, alt: item.alt } } : fail(GENERIC_ERROR);
  } catch {
    return fail("Le recadrage a échoué. Réessayez.");
  } finally {
    await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {});
    if (rendered) await FileSystem.deleteAsync(rendered, { idempotent: true }).catch(() => {});
  }
}

/** Supprime les médias qu'aucune publication en attente n'utilise ; les autres sont gardés (comme sur le web). */
export async function deleteMedia(items: MediaItem[]): Promise<Result & { blocked?: number }> {
  const org = useOrgStore.getState().current;
  if (!org) return fail("Session expirée. Reconnectez-vous.");
  const ids = items.map((m) => m.id);
  const { data: usage } = await supabase.rpc("media_usage", { p_ids: ids });
  const used = new Set(((usage ?? []) as { media_id: string; post_count: number }[]).filter((u) => u.post_count > 0).map((u) => u.media_id));
  const free = items.filter((m) => !used.has(m.id));
  if (free.length === 0) return { ...ok(), blocked: used.size };
  const { data: rows } = await supabase.from("media").select("id, path, thumbnail_path, normalized_path").eq("org_id", org.id).in("id", free.map((m) => m.id));
  const found = (rows ?? []) as Row[];
  const { error } = await supabase.from("media").delete().eq("org_id", org.id).in("id", found.map((r) => r.id));
  if (error) return fail(GENERIC_ERROR);
  await supabase.storage.from("media").remove(found.flatMap((r) => [r.path, r.thumbnail_path, r.normalized_path].filter(Boolean) as string[]));
  return { ...ok(), blocked: used.size };
}
