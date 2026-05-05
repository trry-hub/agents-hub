import * as path from 'path';

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getLoginShellLookupArgs(command: string, shellPath: string): string[] {
  const lookup = `command -v ${shellQuote(command)}`;
  const shellName = path.basename(shellPath);
  return shellName.includes('zsh') ? ['-lic', lookup] : ['-lc', lookup];
}

export function normalizeCommandPathOutput(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => isCommandPath(line));
}

export function buildCliLookupPath(envPath = '', home = ''): string {
  const candidates = [
    envPath,
    home && path.join(home, '.local', 'bin'),
    home && path.join(home, '.npm-global', 'bin'),
    home && path.join(home, '.yarn', 'bin'),
    home && path.join(home, '.bun', 'bin'),
    home && path.join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  return mergePathEntries(candidates.flatMap((entry) => String(entry || '').split(path.delimiter)));
}

export function mergePathEntries(entries: Array<string | undefined>): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const entry of entries) {
    const value = String(entry || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    merged.push(value);
  }

  return merged.join(path.delimiter);
}

function isCommandPath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}
