import { create } from "zustand";

import { DEMO } from "@/lib/demo";
import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";

export type OrgRole = "admin" | "member" | "viewer";
export type Org = { id: string; name: string; role: OrgRole };

type OrgState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  orgs: Org[];
  /** Organisation active (la première pour l'instant ; pas encore de sélecteur). */
  current: Org | null;
  /** Les viewers lisent mais n'écrivent pas : l'interface masque l'écriture. */
  canWrite: boolean;

  load: () => Promise<void>;
  createOrganization: (name: string) => Promise<Result>;
  reset: () => void;
};

export const useOrgStore = create<OrgState>((set, get) => ({
  status: "idle",
  orgs: [],
  current: null,
  canWrite: false,

  load: async () => {
    if (DEMO) {
      const org: Org = { id: "demo-org", name: "Boulangerie Martin", role: "admin" };
      set({ status: "ready", orgs: [org], current: org, canWrite: true });
      return;
    }
    set({ status: "loading" });
    const { data, error } = await supabase
      .from("memberships")
      .select("role, created_at, organizations(id, name)")
      .order("created_at", { ascending: true });
    if (error) {
      set({ status: "error" });
      return;
    }
    const orgs: Org[] = (data ?? []).flatMap((m) => {
      const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return o ? [{ id: o.id as string, name: o.name as string, role: m.role as OrgRole }] : [];
    });

    // Première connexion après une inscription : on crée l'organisation avec le nom saisi dans le formulaire.
    if (orgs.length === 0) {
      const company = useAuthStore.getState().user?.user_metadata?.company;
      if (typeof company === "string" && company.trim()) {
        const created = await get().createOrganization(company);
        if (created.ok) return;
      }
      set({ status: "empty", orgs: [], current: null, canWrite: false });
      return;
    }
    const current = get().current && orgs.find((o) => o.id === get().current?.id) ? get().current : orgs[0];
    const resolved = orgs.find((o) => o.id === current?.id) ?? orgs[0];
    set({ status: "ready", orgs, current: resolved, canWrite: resolved.role !== "viewer" });
  },

  createOrganization: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return fail("Donnez un nom à votre organisation.");
    if (trimmed.length > 120) return fail("Le nom est limité à 120 caractères.");
    const { error } = await supabase.rpc("create_organization", { p_name: trimmed });
    if (error) return fail(GENERIC_ERROR);
    await get().load();
    return ok();
  },

  reset: () => set({ status: "idle", orgs: [], current: null, canWrite: false }),
}));
