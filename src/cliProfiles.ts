export interface CliAgentMode {
  id: string;
  label: string;
  description: string;
  instruction: string;
  /** Extra CLI args inserted before the prompt */
  args?: string[];
}

export interface CliProfile {
  id: string;
  name: string;
  description: string;
  command: string;
  /** Arguments for non-interactive prompt mode */
  promptArgs: string[];
  /** Optional background server used to make subsequent non-interactive runs faster */
  backgroundServer?: {
    args: string[];
    attachArgs: string[];
    url: string;
  };
  /** How the prompt is delivered to the process */
  inputMode: 'stdin' | 'argument';
  /** Brand accent color (hex) */
  accent: string;
  /** Brand icon emoji or short label */
  icon: string;
  /** Capability labels shown in the assistant workbench */
  capabilities: string[];
  /** Provider-native agent/mode presets shown in the composer */
  agentModes: CliAgentMode[];
  defaultAgentMode: string;
  /** Install hint shown when CLI is not found */
  installHint: string;
  env?: Record<string, string>;
  installed: boolean;
}

export const CLI_PROFILES: CliProfile[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Strong project-aware coding agent for multi-file implementation and refactors.',
    command: 'claude',
    promptArgs: ['-p'],
    inputMode: 'stdin',
    accent: '#d97757',
    icon: '◆',
    capabilities: ['agent', 'multi-file', 'refactor'],
    defaultAgentMode: 'default',
    agentModes: [
      {
        id: 'default',
        label: 'Default',
        description: 'Claude Code default permission mode.',
        instruction:
          'Claude Code default mode: read freely and ask before edits or shell actions that need approval.',
        args: ['--permission-mode', 'default'],
      },
      {
        id: 'acceptEdits',
        label: 'Accept Edits',
        description: 'Claude Code can edit files without asking each time.',
        instruction:
          'Claude Code acceptEdits mode: allow file edits and common filesystem commands while still surfacing important risks.',
        args: ['--permission-mode', 'acceptEdits'],
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Claude Code analyzes and plans before changing code.',
        instruction:
          'Claude Code plan mode: inspect and propose a plan. Do not edit files unless the user explicitly approves execution.',
        args: ['--permission-mode', 'plan'],
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Claude Code auto mode when the local account supports it.',
        instruction:
          'Claude Code auto mode: proceed autonomously within Claude Code safety checks and summarize verification clearly.',
        args: ['--permission-mode', 'auto'],
      },
      {
        id: 'dontAsk',
        label: "Don't Ask",
        description: 'Claude Code only uses pre-approved tools.',
        instruction:
          'Claude Code dontAsk mode: stay within pre-approved tools and explain blockers instead of requesting broad permissions.',
        args: ['--permission-mode', 'dontAsk'],
      },
      {
        id: 'bypassPermissions',
        label: 'Bypass',
        description: 'Claude Code bypass permissions mode for isolated environments only.',
        instruction:
          'Claude Code bypassPermissions mode: act carefully, keep edits scoped, and call out risky operations explicitly.',
        args: ['--permission-mode', 'bypassPermissions'],
      },
    ],
    installHint: 'curl -fsSL https://claude.ai/install.sh | bash',
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'General coding assistant with broad model support and fast project Q&A.',
    command: 'gemini',
    promptArgs: ['-p'],
    inputMode: 'stdin',
    accent: '#4285f4',
    icon: 'G',
    capabilities: ['chat', 'analysis', 'workspace'],
    defaultAgentMode: 'assist',
    agentModes: [
      {
        id: 'assist',
        label: 'Assist',
        description: 'General Gemini CLI coding assistant.',
        instruction:
          'Gemini assist mode: answer directly, use project context, and keep changes suggested unless explicitly requested.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning and analysis without changes.',
        instruction:
          'Gemini plan mode: analyze the workspace and propose steps without making code changes.',
      },
      {
        id: 'build',
        label: 'Build',
        description: 'Implementation-focused Gemini workflow.',
        instruction:
          'Gemini build mode: implement requested changes when possible and report verification steps.',
      },
    ],
    installHint: 'npm install -g @google/gemini-cli',
    installed: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI coding agent for implementation, debugging, and code review workflows.',
    command: 'codex',
    promptArgs: ['-a', 'never', 'exec', '--color', 'never'],
    inputMode: 'argument',
    accent: '#10a37f',
    icon: 'C',
    capabilities: ['agent', 'patches', 'review'],
    defaultAgentMode: 'autoEdit',
    agentModes: [
      {
        id: 'suggest',
        label: 'Suggest',
        description: 'Read-only Codex run that suggests changes without editing files.',
        instruction:
          'Codex suggest mode: inspect the workspace and propose concrete changes without editing files or running write commands.',
        args: ['--sandbox', 'read-only'],
      },
      {
        id: 'autoEdit',
        label: 'Auto Edit',
        description: 'Codex can edit files in the workspace sandbox.',
        instruction:
          'Codex auto edit mode: make scoped workspace edits when the user asks for implementation, then report verification clearly.',
        args: ['--sandbox', 'workspace-write'],
      },
      {
        id: 'fullAuto',
        label: 'Full Auto',
        description: 'Codex full-auto sandboxed execution for longer tasks.',
        instruction:
          'Codex full auto mode: work autonomously in the sandbox, keep changes scoped, and summarize commands, edits, and verification.',
        args: ['--full-auto'],
      },
      {
        id: 'review',
        label: 'Review',
        description: 'Codex review-focused mode.',
        instruction:
          'Codex review mode: lead with findings, risks, and missing tests before summary.',
        args: ['--sandbox', 'read-only'],
      },
    ],
    installHint: 'npm install -g @openai/codex',
    installed: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Terminal-native coding agent for fast codebase operations.',
    command: 'opencode',
    promptArgs: ['run'],
    backgroundServer: {
      args: ['serve', '--hostname', '127.0.0.1', '--port', '4096'],
      attachArgs: ['--attach', 'http://127.0.0.1:4096'],
      url: 'http://127.0.0.1:4096',
    },
    inputMode: 'argument',
    accent: '#a855f7',
    icon: 'O',
    capabilities: ['agent', 'terminal', 'workspace'],
    defaultAgentMode: 'default',
    agentModes: [
      {
        id: 'default',
        label: 'Default',
        description: 'OpenCode default primary agent with full tools.',
        instruction:
          'OpenCode default agent: use the standard primary agent for development work with full tool access.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'OpenCode restricted primary agent for analysis.',
        instruction:
          'OpenCode plan agent: analyze, review, and plan without making actual code modifications.',
        args: ['--agent', 'plan'],
      },
    ],
    installHint: 'brew install opencode-ai/tap/opencode',
    installed: false,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Automation-oriented agent for tool-using development tasks.',
    command: 'goose',
    promptArgs: ['run', '-'],
    inputMode: 'stdin',
    accent: '#f97316',
    icon: '⌂',
    capabilities: ['agent', 'automation', 'tools'],
    defaultAgentMode: 'auto',
    agentModes: [
      {
        id: 'auto',
        label: 'Auto',
        description: 'Goose automation-oriented agent.',
        instruction:
          'Goose auto mode: automate the requested development task and keep the user informed about tool actions.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning-only Goose workflow.',
        instruction:
          'Goose plan mode: inspect and outline a plan before automation or file changes.',
      },
    ],
    installHint: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    installed: false,
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'Git-aware pair programmer focused on editing files with model-backed patches.',
    command: 'aider',
    promptArgs: ['--message'],
    inputMode: 'argument',
    accent: '#22c55e',
    icon: 'A',
    capabilities: ['patches', 'git', 'tests'],
    defaultAgentMode: 'edit',
    agentModes: [
      {
        id: 'edit',
        label: 'Edit',
        description: 'Aider patch-oriented workflow.',
        instruction:
          'Aider edit mode: focus on precise patch generation and explain changed files.',
      },
      {
        id: 'architect',
        label: 'Architect',
        description: 'Aider planning and design workflow.',
        instruction:
          'Aider architect mode: reason about the change first and keep implementation guidance structured.',
      },
    ],
    installHint: 'pip install aider-install && aider-install',
    installed: false,
  },
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((p) => p.id === id);
}

export function getCliAgentMode(profile: CliProfile, modeId?: string): CliAgentMode {
  return (
    profile.agentModes.find((mode) => mode.id === modeId) ??
    profile.agentModes.find((mode) => mode.id === profile.defaultAgentMode) ??
    profile.agentModes[0]
  );
}
