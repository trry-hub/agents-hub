export interface CliProfile {
  id: string;
  name: string;
  command: string;
  /** Arguments for non-interactive prompt mode */
  promptArgs: string[];
  /** Brand accent color (hex) */
  accent: string;
  /** Brand icon emoji or short label */
  icon: string;
  /** Install hint shown when CLI is not found */
  installHint: string;
  env?: Record<string, string>;
  installed: boolean;
}

export const CLI_PROFILES: CliProfile[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    promptArgs: ['-p'],
    accent: '#d97757',
    icon: '◆',
    installHint: 'curl -fsSL https://claude.ai/install.sh | bash',
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    promptArgs: ['-p'],
    accent: '#4285f4',
    icon: 'G',
    installHint: 'npm install -g @google/gemini-cli',
    installed: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    promptArgs: ['exec'],
    accent: '#10a37f',
    icon: 'C',
    installHint: 'npm install -g @openai/codex',
    installed: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    promptArgs: ['-p'],
    accent: '#a855f7',
    icon: 'O',
    installHint: 'brew install opencode-ai/tap/opencode',
    installed: false,
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose',
    promptArgs: ['run', '-'],
    accent: '#f97316',
    icon: '⌂',
    installHint: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    installed: false,
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    promptArgs: ['--message'],
    accent: '#22c55e',
    icon: 'A',
    installHint: 'pip install aider-install && aider-install',
    installed: false,
  },
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((p) => p.id === id);
}
