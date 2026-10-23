import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { MAX_MEDIA_BYTES, type MediaKind } from "@/lib/media-rules";
import { supabase } from "@/lib/supabase";
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

/** Envoie un fichier local (sans le charger en mémoire : le corps est lu depuis le disque par la couche native). */
async function uploadFile(path: string, uri: string, name: string, type: string): Promise<boolean> {
  const form = new FormData();
  form.append("files", { uri, name, type } as unknown as Blob);
  const { error } = await supabase.storage.from("media").upload(path, form, { upsert: false });
  return !error;
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

/** Choisit des images ou vidéos dans la photothèque du téléphone et les ajoute à la médiathèque. */
export async function pickAndUpload(): Promise<UploadResult> {
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
  for (const asset of picked.assets) {
    const uuid = uuidv4();
    const ext = (asset.fileName?.split(".").pop() ?? asset.uri.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    const isVideo = asset.type === "video";
    const mime = asset.mimeType ?? (isVideo ? "video/mp4" : ext === "png" ? "image/png" : "image/jpeg");
    const name = asset.fileName ?? `${isVideo ? "video" : "photo"}-${uuid.slice(0, 8)}.${ext || (isVideo ? "mp4" : "jpg")}`;
    if (asset.fileSize && asset.fileSize > MAX_MEDIA_BYTES) return fail(`« ${name} » dépasse 1 Go.`);

    const base = `${org.id}/${uuid}`;
    const paths = { original: `${base}-${safeFileName(name)}`, thumb: `${base}-thumb.jpg`, jpeg: `${base}-instagram.jpg` };
    const uploaded: string[] = [];
    const cleanup = async () => {
      if (uploaded.length > 0) await supabase.storage.from("media").remove(uploaded);
    };
    try {
      if (!(await uploadFile(paths.original, asset.uri, name, mime))) return fail(`L’envoi de « ${name} » a échoué. Vérifiez votre connexion.`);
      uploaded.push(paths.original);

      let thumb: string | null = null;
      let jpeg: string | null = null;
      if (!isVideo) {
        const r = await renditions(asset.uri, asset.width ?? null, asset.height ?? null, mime === "image/jpeg");
        if (r.thumb && (await uploadFile(paths.thumb, r.thumb, "thumb.jpg", "image/jpeg"))) {
          uploaded.push(paths.thumb);
          thumb = paths.thumb;
        }
        if (r.jpeg && (await uploadFile(paths.jpeg, r.jpeg, "instagram.jpg", "image/jpeg"))) {
          uploaded.push(paths.jpeg);
          jpeg = paths.jpeg;
        }
      }

      const { data: row, error } = await supabase
        .from("media")
        .insert({
          org_id: org.id,
          bucket: "media",
          path: paths.original,
          name: name.slice(0, 255),
          mime_type: mime,
          size_bytes: asset.fileSize ?? null,
          width: asset.width || null,
          height: asset.height || null,
          duration_seconds: asset.duration ? asset.duration / 1000 : null,
          status: "ready",
          thumbnail_path: thumb,
          normalized_path: jpeg,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error || !row) {
        await cleanup();
        return fail(GENERIC_ERROR);
      }
      createdIds.push(row.id as string);
    } catch {
      await cleanup();
      return fail("Envoi impossible. Vérifiez votre connexion.");
    }
  }
  return { ...ok(), items: await mediaByIds(org.id, createdIds) };
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
