/**
 * Agents IA qui pourront piloter Postbiz. Chaque agent a sa page (`/<slug>`), son habillage de couleur et ses médias de hero
 * (public/agents/hero/<hero>.webm + .webp). Les noms sont des marques : jamais traduits.
 *
 * Rien ici ne dit que l'intégration existe : le serveur MCP, la ligne de commande et l'API publique de Postbiz sont en
 * préparation. Les pages le disent (« Bientôt »), voir `agents.*` dans les messages.
 */

/** Façon dont on parle à l'agent : détermine les phrases génériques de la page (messages `agents.kind.<kind>`). */
export type AgentKind = 'chat' | 'editor' | 'terminal' | 'autonomous' | 'workspace';

/** Palettes de dégradé des heros (7 familles de couleur). */
export type AgentTheme = 'teal' | 'orange' | 'slate' | 'purple' | 'blue' | 'pink' | 'green';

export interface AiAgent {
  /** Adresse : `/<slug>`. */
  slug: string;
  name: string;
  /** Icône carrée arrondie (public/agents/). */
  icon: string;
  theme: AgentTheme;
  kind: AgentKind;
  /** Texte de présentation : français et anglais (les autres langues affichent l'anglais, comme les articles du blog). */
  what: { fr: string; en: string };
}

export const AI_AGENTS: AiAgent[] = [
  {
    slug: 'chatgpt', name: 'ChatGPT', icon: '/agents/chatgpt.svg', theme: 'teal', kind: 'chat',
    what: {
      fr: 'ChatGPT est l’assistant d’OpenAI. Il peut se brancher à des applications extérieures par le protocole MCP et agir à votre place, pas seulement répondre à des questions.',
      en: 'ChatGPT is OpenAI’s assistant. It can plug into outside apps through the MCP protocol and take actions for you, not just answer questions.',
    },
  },
  {
    slug: 'dots', name: 'OpenAI dots', icon: '/agents/dots.svg', theme: 'purple', kind: 'autonomous',
    what: {
      fr: 'OpenAI dots est un agent personnel construit sur ChatGPT : il garde les plugins de ChatGPT, travaille en continu et demande votre accord selon les règles que vous fixez.',
      en: 'OpenAI dots is a personal agent built on ChatGPT: it keeps ChatGPT’s plugins, works continuously and asks for your approval according to the rules you set.',
    },
  },
  {
    slug: 'claude', name: 'Claude', icon: '/agents/claude.svg', theme: 'orange', kind: 'chat',
    what: {
      fr: 'Claude est l’assistant d’Anthropic. Il se connecte à des applications extérieures (connecteurs, MCP) sur le web, sur ordinateur et sur mobile.',
      en: 'Claude is Anthropic’s assistant. It connects to outside apps (connectors, MCP) on the web, on desktop and on mobile.',
    },
  },
  {
    slug: 'claude-cowork', name: 'Claude Cowork', icon: '/agents/claude-cowork.svg', theme: 'orange', kind: 'workspace',
    what: {
      fr: 'Claude Cowork est l’assistant agentique d’Anthropic pour le travail de bureau : sans terminal, dans l’application Claude, il lit des fichiers, utilise des connecteurs et enchaîne des tâches en plusieurs étapes.',
      en: 'Claude Cowork is Anthropic’s agentic assistant for office work: no terminal, inside the Claude app, it reads files, uses connectors and chains multi-step tasks.',
    },
  },
  {
    slug: 'claude-code', name: 'Claude Code', icon: '/agents/claude-code.svg', theme: 'orange', kind: 'terminal',
    what: {
      fr: 'Claude Code est l’outil de programmation agentique d’Anthropic. Il vit dans votre terminal, comprend votre code, lance des commandes et appelle des outils MCP.',
      en: 'Claude Code is Anthropic’s agentic coding tool. It lives in your terminal, understands your code, runs commands and calls MCP tools.',
    },
  },
  {
    slug: 'codex', name: 'Codex', icon: '/agents/codex.svg', theme: 'slate', kind: 'terminal',
    what: {
      fr: 'Codex est l’agent de programmation d’OpenAI. En ligne de commande, dans l’éditeur ou dans le cloud, il exécute des commandes dans un bac à sable et peut appeler des serveurs MCP.',
      en: 'Codex is OpenAI’s coding agent. In the command line, in your editor or in the cloud, it runs commands in a sandbox and can call MCP servers.',
    },
  },
  {
    slug: 'cursor', name: 'Cursor', icon: '/agents/cursor.svg', theme: 'blue', kind: 'editor',
    what: {
      fr: 'Cursor est un éditeur de code à agent IA, édité par Anysphere. Son agent lance des commandes dans le terminal intégré, modifie vos fichiers et peut utiliser des outils extérieurs.',
      en: 'Cursor is an AI code editor made by Anysphere. Its agent runs commands in the integrated terminal, edits your files and can use outside tools.',
    },
  },
  {
    slug: 'gemini', name: 'Gemini', icon: '/agents/gemini.svg', theme: 'blue', kind: 'chat',
    what: {
      fr: 'Gemini est l’assistant de Google. Gemini CLI regroupe des extensions (serveurs MCP, commandes, compétences) et l’application web accepte aussi des applications personnalisées.',
      en: 'Gemini is Google’s assistant. Gemini CLI bundles extensions (MCP servers, commands, skills) and the web app also accepts custom apps.',
    },
  },
  {
    slug: 'openclaw', name: 'OpenClaw', icon: '/agents/openclaw.svg', theme: 'blue', kind: 'autonomous',
    what: {
      fr: 'OpenClaw est une passerelle open source, auto-hébergée, qui relie vos messageries (WhatsApp, Telegram, Slack, Discord…) à des agents IA.',
      en: 'OpenClaw is an open-source, self-hosted gateway that connects your messaging apps (WhatsApp, Telegram, Slack, Discord…) to AI agents.',
    },
  },
  {
    slug: 'hermes', name: 'Hermes Agent', icon: '/agents/hermes.svg', theme: 'pink', kind: 'autonomous',
    what: {
      fr: 'Hermes Agent est un agent IA que vous installez sur votre machine et que vous étendez avec des compétences (skills).',
      en: 'Hermes Agent is an AI agent you install on your own machine and extend with skills.',
    },
  },
  {
    slug: 'grok-bot', name: 'Grok Bot', icon: '/agents/grok-bot.svg', theme: 'slate', kind: 'autonomous',
    what: {
      fr: 'Grok Bot est le coéquipier IA toujours actif de xAI et Cursor : des Bots nommés, chacun avec son ordinateur dans le cloud, qui suivent des routines et demandent votre accord avant d’agir.',
      en: 'Grok Bot is the always-on AI teammate from xAI and Cursor: named Bots, each with its own cloud computer, that follow routines and ask for your approval before acting.',
    },
  },
  {
    slug: 'grok-build', name: 'Grok Build', icon: '/agents/grok-build.svg', theme: 'slate', kind: 'terminal',
    what: {
      fr: 'Grok Build est l’agent de programmation et l’interface en ligne de commande de xAI : il planifie et exécute des tâches en plusieurs étapes, et confie les plus longues à des sous-agents.',
      en: 'Grok Build is xAI’s coding agent and command-line tool: it plans and carries out multi-step work, and hands longer tasks to sub-agents.',
    },
  },
  {
    slug: 'deepseek', name: 'DeepSeek', icon: '/agents/deepseek.svg', theme: 'blue', kind: 'terminal',
    what: {
      fr: 'DeepSeek est un laboratoire de modèles d’IA. Son environnement d’agent (DeepSeek Harness) accepte des plugins pour agir sur des outils extérieurs.',
      en: 'DeepSeek is an AI model lab. Its agent environment (DeepSeek Harness) accepts plugins to act on outside tools.',
    },
  },
  {
    slug: 'kimi', name: 'Kimi K3', icon: '/agents/kimi.svg', theme: 'pink', kind: 'terminal',
    what: {
      fr: 'Kimi est l’assistant de Moonshot AI. Kimi Code CLI sait ajouter lui-même un serveur MCP et agir sur des outils extérieurs.',
      en: 'Kimi is Moonshot AI’s assistant. Kimi Code CLI can add an MCP server by itself and act on outside tools.',
    },
  },
  {
    slug: 'muse', name: 'Muse', icon: '/agents/muse.svg', theme: 'purple', kind: 'chat',
    what: {
      fr: 'Meta Muse AI est un agent personnel de Meta : il agit pour vous au lieu de seulement répondre, et atteint les applications extérieures par des connecteurs.',
      en: 'Meta Muse AI is a personal agent from Meta: it takes actions for you instead of only answering, and reaches outside apps through connectors.',
    },
  },
  {
    slug: 'manus', name: 'Manus', icon: '/agents/manus.svg', theme: 'slate', kind: 'autonomous',
    what: {
      fr: 'Manus est un agent IA généraliste qui mène des tâches de bout en bout et se branche à des applications par un répertoire de connecteurs.',
      en: 'Manus is a general-purpose AI agent that carries tasks through from start to finish and plugs into apps through a directory of connectors.',
    },
  },
  {
    slug: 'cue', name: 'Cue', icon: '/agents/cue.svg', theme: 'purple', kind: 'autonomous',
    what: {
      fr: 'Cue est une application d’agents personnels de l’équipe Manus : chaque agent a ses outils et ses permissions, et continue de travailler quand vous vous déconnectez.',
      en: 'Cue is a personal-agent app from the Manus team: each agent has its own tools and permissions, and keeps working after you log off.',
    },
  },
  {
    slug: 'perplexity-computer', name: 'Perplexity Computer', icon: '/agents/perplexity.svg', theme: 'teal', kind: 'workspace',
    what: {
      fr: 'Perplexity Computer est l’espace de travail agentique de Perplexity : vous donnez un objectif, il le découpe en sous-tâches, utilise des connecteurs et livre un résultat.',
      en: 'Perplexity Computer is Perplexity’s agentic workspace: you give it a goal, it breaks it into subtasks, uses connectors and delivers a result.',
    },
  },
  {
    slug: 'nanoclaw', name: 'NanoClaw', icon: '/agents/nanoclaw.svg', theme: 'green', kind: 'autonomous',
    what: {
      fr: 'NanoClaw est un assistant IA open source qui fait tourner chaque groupe d’agents dans son propre conteneur Docker et se branche à WhatsApp, Telegram, Slack, Discord…',
      en: 'NanoClaw is an open-source AI assistant that runs each agent group in its own Docker container and connects to WhatsApp, Telegram, Slack, Discord…',
    },
  },
  {
    slug: 'paperclip', name: 'Paperclip', icon: '/agents/paperclip.svg', theme: 'slate', kind: 'workspace',
    what: {
      fr: 'Paperclip est une plateforme open source pour gérer des équipes d’agents IA : organigramme, budgets, circuits de validation et tâches planifiées.',
      en: 'Paperclip is an open-source platform for managing teams of AI agents: org chart, budgets, approval flows and scheduled tasks.',
    },
  },
];

export const agentBySlug = (slug: string) => AI_AGENTS.find((a) => a.slug === slug);

/** Les trois accès prévus pour un agent (aucun n'existe encore). */
export const ACCESS_ROUTES = ['mcp', 'cli', 'api'] as const;
export type AccessRoute = (typeof ACCESS_ROUTES)[number];

/** Dégradés des heros : un dégradé de fond et un halo derrière la mascotte, par palette. */
export const THEMES: Record<AgentTheme, { bg: string; glow: string }> = {
  teal: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #2fd3b0 0%, #128f7a 32%, #0b5c53 62%, #063632 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #1aa88f 0%, #0d6b5f 45%, #04302c 100%)',
  },
  orange: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #ff9a5c 0%, #e2622a 32%, #9c3a12 62%, #521c07 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #f0703a 0%, #a8411a 45%, #4a1a08 100%)',
  },
  slate: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #6b7a99 0%, #3d4a66 32%, #232c40 62%, #12172a 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #55638a 0%, #2d3752 45%, #11162a 100%)',
  },
  purple: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #8a4dff 0%, #5a1fd9 32%, #3a0fa0 62%, #22065e 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #6a2ee8 0%, #3b109f 45%, #1d0552 100%)',
  },
  blue: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #4f8dff 0%, #2456e6 32%, #1433a3 62%, #0b1b5e 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #3b6ff0 0%, #1d3fb0 45%, #0a1650 100%)',
  },
  pink: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #ff7ae9 0%, #d61fb5 32%, #8a0f75 62%, #47063e 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #e63bc6 0%, #9a1483 45%, #44073a 100%)',
  },
  green: {
    bg: 'radial-gradient(110% 80% at 88% 12%, #6ee07a 0%, #22a03a 32%, #14662a 62%, #083a18 100%)',
    glow: 'radial-gradient(60% 70% at 50% 45%, #33b34c 0%, #1a7030 45%, #072f14 100%)',
  },
};
