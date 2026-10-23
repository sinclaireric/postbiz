export interface AddChannelArgs {
  org: string;
  provider: string;
  internalId: string;
  name: string;
  token: string;
  username?: string;
  settings?: Record<string, unknown>;
}

const PROVIDERS = ['facebook', 'instagram', 'instagram_standalone', 'x', 'linkedin', 'linkedin_page', 'tiktok', 'youtube'];

/** Lit `--clé valeur` depuis la ligne de commande et valide les champs obligatoires. */
export function parseAddChannelArgs(argv: string[]): AddChannelArgs {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`Valeur manquante pour ${a}`);
      map.set(a.slice(2), v);
      i++;
    }
  }
  const need = (k: string) => {
    const v = map.get(k);
    if (!v) throw new Error(`Argument obligatoire manquant : --${k}`);
    return v;
  };
  const provider = need('provider');
  if (!PROVIDERS.includes(provider)) throw new Error(`Réseau inconnu « ${provider} ». Valeurs possibles : ${PROVIDERS.join(', ')}`);
  let settings: Record<string, unknown> | undefined;
  if (map.has('settings')) {
    try {
      settings = JSON.parse(map.get('settings')!);
    } catch {
      throw new Error('--settings doit être un JSON valide, par exemple \'{"human_agent_enabled":true}\'');
    }
  }
  return { org: need('org'), provider, internalId: need('internal-id'), name: need('name'), token: need('token'), username: map.get('username'), settings };
}

/** Lignes à insérer : le canal et son jeton chiffré (le jeton ne transite jamais en clair vers la base). */
export async function buildChannelRows(args: AddChannelArgs, encrypt: (plain: string) => Promise<string>) {
  return {
    integration: {
      org_id: args.org, provider: args.provider, internal_id: args.internalId, name: args.name,
      username: args.username ?? null, settings: args.settings ?? {}, status: 'active',
    },
    accessTokenEnc: await encrypt(args.token),
  };
}
