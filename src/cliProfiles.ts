export interface CliProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  installed: boolean;
}

export const CLI_PROFILES: CliProfile[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    installed: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    installed: false,
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    args: [],
    installed: false,
  },
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((p) => p.id === id);
}
