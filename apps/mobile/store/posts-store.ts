import { create } from "zustand";

import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { normalizeProvider } from "@/lib/networks";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import { mediaByIds } from "@/lib/media";
import type { ChannelNetwork, PostMediaItem, PostStatus, ScheduledPost } from "@/types";
import { htmlToPlain, plainToHtml } from "@/utils/text";
import { uuidv4 } from "@/utils/uuid";

// Un client ne peut écrire que `draft` et `queued` (RLS, voir supabase/migrations/20261016000001_core.sql) :
// publishing / published / error / unknown sont posés par le worker. Les fils (thread) sont des lignes enfants
// (`parent_post_id`) publiées avec leur racine ; le calendrier n'affiche que les racines.

const HISTORY_DAYS = 90;
const MAX_ROWS = 2000;
const BLOCKED = "Cette publication est en cours d’envoi ou déjà publiée : elle ne peut plus être modifiée.";

type Row = Record<string, any>;

const one = <T extends Row>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function toStatus(state: string): PostStatus {
  switch (state) {
    case "draft":
      return "draft";
    case "published":
      return "published";
    case "error":
    case "unknown":
      return "error";
    default:
      return "scheduled"; // queued, publishing
  }
}

function buildPosts(rows: Row[], library: Map<string, PostMediaItem>): ScheduledPost[] {
  const children = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.parent_post_id) children.set(r.parent_post_id, [...(children.get(r.parent_post_id) ?? []), r]);
  }
  return rows
    .filter((r) => !r.parent_post_id && r.publish_at)
    .map((r): ScheduledPost => {
      const integ = one<Row>(r.integrations);
      const thread = [r, ...(children.get(r.id) ?? []).sort((a, b) => a.position - b.position)];
      const html = plainToHtml(r.content ?? "");
      return {
        id: r.id,
        groupId: r.group_id,
        title: htmlToPlain(html).slice(0, 40),
        content: html,
        category: "Social",
        scheduledAt: r.publish_at,
        channelId: r.integration_id,
        network: normalizeProvider(integ?.provider ?? "facebook"),
        authorName: integ?.name ?? "",
        authorAvatar: integ?.picture_url ?? "",
        status: toStatus(r.state),
        dbState: r.state,
        errorMessage: r.error ?? undefined,
        releaseUrl: r.release_url ?? undefined,
        // Un média supprimé de la médiathèque disparaît de l'affichage, pas de la publication.
        media: (Array.isArray(r.media) ? r.media : []).flatMap((m: Row): PostMediaItem[] => {
          const item = library.get(String(m.media_id));
          return item ? [{ ...item, alt: typeof m.alt === "string" ? m.alt : item.alt }] : [];
        }),
        composerPosts: thread.map((t) => ({ id: t.id, content: plainToHtml(t.content ?? ""), imageUris: [] })),
      };
    });
}

export type SaveAction = "calendar" | "draft" | "now";

export type SavePostsInput = {
  action: SaveAction;
  /** Médias joints (les mêmes pour tous les canaux), dans l'ordre d'affichage. */
  media?: { id: string; kind: "image" | "video"; alt: string }[];
  publishAt: Date;
  /** Un élément par canal ; `thread` = textes bruts, le premier est la racine. */
  items: { channelId: string; thread: string[]; /** Premier commentaire, publié sous la publication juste après elle (Facebook, LinkedIn, X) : à n'envoyer qu'à ces réseaux. */ firstComment?: string | null }[];
  /** Mode édition : id de la racine à modifier (un seul canal). */
  editPostId?: string;
};

function context(): { orgId: string; userId: string } | Result {
  const org = useOrgStore.getState().current;
  const user = useAuthStore.getState().user;
  if (!org || !user) return fail("Session expirée. Reconnectez-vous.");
  if (!useOrgStore.getState().canWrite) return fail("Votre rôle ne permet pas de modifier les publications.");
  return { orgId: org.id, userId: user.id };
}

type PostsState = {
  posts: ScheduledPost[];
  loaded: boolean;
  error: string | null;
  /** Posé par l'écran de création pour que le calendrier se place sur la date de la publication. */
  navigateToDate: string | null;

  load: (orgId: string) => Promise<void>;
  /** Renvoie les ids des publications racines créées ou modifiées. */
  savePosts: (input: SavePostsInput) => Promise<Result & { ids?: string[] }>;
  deletePost: (id: string) => Promise<Result>;
  reschedulePost: (id: string, newScheduledAt: string) => Promise<Result>;
  duplicatePost: (id: string) => Promise<Result & { id?: string }>;
  setNavigateToDate: (iso: string | null) => void;
  reset: () => void;
};

export const usePostsStore = create<PostsState>((set, get) => {
  const reload = async () => {
    const org = useOrgStore.getState().current;
    if (org) await get().load(org.id);
  };

  return {
    posts: [],
    loaded: false,
    error: null,
    navigateToDate: null,

    load: async (orgId) => {
      const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("posts")
        .select("id, group_id, integration_id, parent_post_id, position, content, publish_at, state, error, release_url, media, integrations(provider, name, picture_url)")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .gte("publish_at", since)
        .order("publish_at", { ascending: true })
        .limit(MAX_ROWS);
      if (error) {
        set({ error: "Impossible de charger les publications.", loaded: true });
        return;
      }
      // Médias joints : un seul aller-retour pour tout le calendrier (vignettes signées).
      const wanted = [...new Set((data ?? []).flatMap((r: Row) => (Array.isArray(r.media) ? r.media : []).map((m: Row) => String(m.media_id))))] as string[];
      const library = new Map<string, PostMediaItem>(
        (await mediaByIds(orgId, wanted).catch(() => [])).map((m) => [m.id, { id: m.id, kind: m.kind, name: m.name, alt: m.alt, thumbUrl: m.thumbUrl ?? (m.kind === "image" ? m.url : null) }]),
      );
      set({ posts: buildPosts(data ?? [], library), loaded: true, error: null });
    },

    savePosts: async ({ action, publishAt, items, editPostId, media = [] }) => {
      const ctx = context();
      if ("ok" in ctx) return ctx;
      const { orgId, userId } = ctx;

      const state = action === "draft" ? "draft" : "queued";
      // « Publier maintenant » = mise en file avec une date d'échéance immédiate : c'est le worker qui envoie.
      const when = (action === "now" ? new Date() : publishAt).toISOString();

      for (const item of items) {
        if (item.thread.every((t) => !t.trim()) && media.length === 0) return fail("Écrivez un texte ou ajoutez un média avant d’enregistrer.");
      }
      if (action === "calendar" && publishAt.getTime() < Date.now() + 60_000) {
        return fail("La date de publication doit être dans le futur.");
      }

      // Forme attendue par la base et le worker : [{ media_id, type, alt? }] (le chemin du fichier est relu au moment de publier).
      const mediaJson = media.map((m) => ({ media_id: m.id, type: m.kind, ...(m.alt.trim() ? { alt: m.alt.trim().slice(0, 1500) } : {}) }));

      const threadRows = (rootId: string, integrationId: string, groupId: string, thread: string[]) =>
        thread.slice(1).map((content, i) => ({
          id: uuidv4(),
          org_id: orgId,
          integration_id: integrationId,
          group_id: groupId,
          parent_post_id: rootId,
          position: i + 1,
          content: content.trim(),
          publish_at: when,
          state,
          created_by: userId,
        }));

      let ids: string[] = [];
      try {
        if (editPostId) {
          const item = items[0];
          const { data: updated, error } = await supabase
            .from("posts")
            .update({ content: (item.thread[0] ?? "").trim(), publish_at: when, state, media: mediaJson })
            .eq("id", editPostId)
            .select("id, integration_id, group_id");
          if (error) return fail(GENERIC_ERROR);
          if (!updated || updated.length === 0) return fail(BLOCKED);
          // On remplace le fil : plus simple et plus sûr que de rapprocher les anciens et nouveaux messages.
          const { error: delError } = await supabase.from("posts").delete().eq("parent_post_id", editPostId);
          if (delError) return fail(GENERIC_ERROR);
          ids = [editPostId];
          const kids = threadRows(editPostId, updated[0].integration_id, updated[0].group_id, item.thread);
          if (kids.length > 0) {
            const { error: insError } = await supabase.from("posts").insert(kids);
            if (insError) return fail(GENERIC_ERROR);
          }
        } else {
          const groupId = uuidv4();
          const roots = items.map((item) => ({
            id: uuidv4(),
            org_id: orgId,
            integration_id: item.channelId,
            group_id: groupId,
            content: (item.thread[0] ?? "").trim(),
            // L'état du commentaire (« pending ») est posé par la base à l'insertion ; le worker le publie après la publication.
            ...(item.firstComment?.trim() ? { first_comment: item.firstComment.trim() } : {}),
            media: mediaJson,
            publish_at: when,
            state,
            created_by: userId,
          }));
          const { error } = await supabase.from("posts").insert(roots);
          if (error) return fail(GENERIC_ERROR);
          ids = roots.map((r) => r.id);
          const kids = items.flatMap((item, i) => threadRows(roots[i].id, item.channelId, groupId, item.thread));
          if (kids.length > 0) {
            const { error: kidsError } = await supabase.from("posts").insert(kids);
            if (kidsError) return fail("Le premier message est enregistré, mais pas la suite du fil. Rouvrez la publication pour la compléter.");
          }
        }
      } finally {
        await reload();
      }
      return { ...ok(), ids };
    },

    deletePost: async (id) => {
      const ctx = context();
      if ("ok" in ctx) return ctx;
      // Suppression logique (comme le web) : la ligne reste pour l'historique, les requêtes filtrent `deleted_at is null`.
      const { data, error } = await supabase
        .from("posts")
        .update({ deleted_at: new Date().toISOString() })
        .or(`id.eq.${id},parent_post_id.eq.${id}`)
        .in("state", ["draft", "queued", "error", "unknown"])
        .select("id");
      if (error) return fail(GENERIC_ERROR);
      if (!data || data.length === 0) return fail(BLOCKED);
      set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
      return ok();
    },

    reschedulePost: async (id, newScheduledAt) => {
      const ctx = context();
      if ("ok" in ctx) return ctx;
      if (!newScheduledAt) return fail("Choisissez une date valide.");
      const previous = get().posts;
      set((s) => ({ posts: s.posts.map((p) => (p.id === id ? { ...p, scheduledAt: newScheduledAt } : p)) }));
      const { data, error } = await supabase
        .from("posts")
        .update({ publish_at: newScheduledAt })
        .or(`id.eq.${id},parent_post_id.eq.${id}`)
        .in("state", ["draft", "queued"])
        .select("id");
      if (error || !data || data.length === 0) {
        set({ posts: previous });
        return fail(error ? GENERIC_ERROR : "Seuls les brouillons et les publications programmées peuvent être déplacés.");
      }
      return ok();
    },

    duplicatePost: async (id) => {
      const source = get().posts.find((p) => p.id === id);
      if (!source) return fail("Publication introuvable.");
      const thread = (source.composerPosts ?? [{ id, content: source.content, imageUris: [] }]).map((t) => htmlToPlain(t.content));
      // Une copie est toujours un brouillon : elle ne part jamais sans que l'utilisateur la relise.
      const result = await get().savePosts({
        action: "draft",
        publishAt: new Date(source.scheduledAt),
        media: (source.media ?? []).map((m) => ({ id: m.id, kind: m.kind, alt: m.alt })),
        items: [{ channelId: source.channelId, thread }],
      });
      if (!result.ok) return result;
      return { ok: true, id: result.ids?.[0] };
    },

    setNavigateToDate: (iso) => set({ navigateToDate: iso }),
    reset: () => set({ posts: [], loaded: false, error: null }),
  };
});
