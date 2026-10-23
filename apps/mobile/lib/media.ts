import * as ImagePicker from "expo-image-picker";

import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import { uuidv4 } from "@/utils/uuid";

// Médiathèque : fichiers dans le bucket privé `media` (chemin `{org_id}/{fichier}`, voir la migration engine)
// et une ligne dans la table `media`. Les URL sont signées et expirent : on ne stocke jamais d'URL publique.

export type MediaItem = {
  id: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: "uploaded" | "processing" | "ready" | "failed";
  createdAt: string;
  /** URL signée (1 h), vide si elle n'a pas pu être créée. */
  url: string;
};

const SIGNED_URL_SECONDS = 3600;

export async function listMedia(orgId: string): Promise<MediaItem[]> {
  const { data, error } = await supabase
    .from("media")
    .select("id, path, normalized_path, thumbnail_path, mime_type, size_bytes, status, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];

  const paths = data.map((m) => (m.thumbnail_path ?? m.normalized_path ?? m.path) as string);
  const { data: signed } = await supabase.storage.from("media").createSignedUrls(paths, SIGNED_URL_SECONDS);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((m, i) => ({
    id: m.id as string,
    path: m.path as string,
    mimeType: (m.mime_type as string | null) ?? null,
    sizeBytes: (m.size_bytes as number | null) ?? null,
    status: m.status as MediaItem["status"],
    createdAt: m.created_at as string,
    url: urls.get(paths[i]) ?? "",
  }));
}

/** Choisit des images ou vidéos dans la photothèque et les envoie. Renvoie le nombre de fichiers envoyés. */
export async function pickAndUpload(): Promise<Result & { count?: number }> {
  const org = useOrgStore.getState().current;
  const user = useAuthStore.getState().user;
  if (!org || !user) return fail("Session expirée. Reconnectez-vous.");
  if (!useOrgStore.getState().canWrite) return fail("Votre rôle ne permet pas d’ajouter des médias.");

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return fail("Autorisez l’accès à vos photos dans les réglages du téléphone.");

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 1,
  });
  if (picked.canceled) return { ...ok(), count: 0 };

  let count = 0;
  for (const asset of picked.assets) {
    const ext = (asset.fileName?.split(".").pop() ?? asset.uri.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    const mime = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
    const path = `${org.id}/${uuidv4()}.${ext}`;
    try {
      const body = await (await fetch(asset.uri)).arrayBuffer();
      const { error: uploadError } = await supabase.storage.from("media").upload(path, body, { contentType: mime, upsert: false });
      if (uploadError) return fail(count > 0 ? `${count} fichier(s) envoyé(s), puis une erreur est survenue.` : GENERIC_ERROR);
      const { error: rowError } = await supabase.from("media").insert({
        org_id: org.id,
        path,
        mime_type: mime,
        size_bytes: asset.fileSize ?? body.byteLength,
        width: asset.width,
        height: asset.height,
        duration_seconds: asset.duration ? asset.duration / 1000 : null,
        created_by: user.id,
      });
      if (rowError) {
        await supabase.storage.from("media").remove([path]);
        return fail(GENERIC_ERROR);
      }
      count += 1;
    } catch {
      return fail("Envoi impossible. Vérifiez votre connexion.");
    }
  }
  return { ...ok(), count };
}

export async function deleteMedia(item: MediaItem): Promise<Result> {
  const { error } = await supabase.from("media").delete().eq("id", item.id);
  if (error) return fail(GENERIC_ERROR);
  await supabase.storage.from("media").remove([item.path]);
  return ok();
}
