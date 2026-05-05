import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { CliProfile, getCliProfile } from './cliProfiles';
import {
  buildCliLookupPath,
  getLoginShellLookupArgs,
  mergePathEntries,
  normalizeCommandPathOutput,
} from './cliPathResolver';

export interface Session {
  id: string;
  cliId: string;
  agentModeId?: string;
  profile: CliProfile;
  process: ChildProcess;
  onOutput: vscode.EventEmitter<string>;
  onStderr: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
}

interface BackgroundServerState {
  process?: ChildProcess;
  starting?: Promise<boolean>;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private commandPathCache = new Map<string, string>();
  private backgroundServers = new Map<string, BackgroundServerState>();

  getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/';
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    const profile = getCliProfile(profileId);
    if (!profile) { return false; }

    return Boolean(await this.resolveCommandPath(profile.command));
  }

  private async resolveCommandPath(command: string): Promise<string | undefined> {
    const cached = this.commandPathCache.get(command);
    if (cached) {
      return cached;
    }

    const directPath = await this.lookupCommandInPath(command);
    if (directPath) {
      this.commandPathCache.set(command, directPath);
      return directPath;
    }

    if (process.platform === 'win32') {
      return undefined;
    }

    const shellPath = process.env.SHELL || '/bin/zsh';
    const shellPathResult = await this.lookupCommandInLoginShell(command, shellPath);
    if (shellPathResult) {
      this.commandPathCache.set(command, shellPathResult);
      return shellPathResult;
    }

    return undefined;
  }

  private lookupCommandInPath(command: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
      const proc = spawn(lookupCommand, [command], {
        env: {
          ...process.env,
          PATH: buildCliLookupPath(process.env.PATH, process.env.HOME),
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  private lookupCommandInLoginShell(
    command: string,
    shellPath: string
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const proc = spawn(shellPath, getLoginShellLookupArgs(command, shellPath), {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  async getProfilesWithStatus(): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    const results = await Promise.all(
      CLI_PROFILES.map(async (p) => ({
        ...p,
        installed: await this.checkInstalled(p.id),
      }))
    );
    return results;
  }

  /** Start a CLI in prompt (non-interactive) mode. Stdin is kept open when supported. */
  async startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs: string[] = [],
    agentModeId?: string
  ): Promise<Session | null> {
    const profile = getCliProfile(cliId);
    if (!profile) { return null; }

    const cwd = this.getWorkspaceRoot();
    const n = (this.counters.get(cliId) ?? 0) + 1;
    this.counters.set(cliId, n);
    const sessionId = `${cliId}-${n}`;
    const command = this.commandPathCache.get(profile.command) ?? profile.command;
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const env = {
      ...process.env,
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...profile.env,
    };
    const backgroundAttachArgs = await this.getBackgroundAttachArgs(profile, command, cwd, env);
    const args =
      profile.inputMode === 'argument' && initialInput
        ? [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs, initialInput]
        : [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs];

    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: [profile.inputMode === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const session: Session = {
      id: sessionId,
      cliId,
      agentModeId,
      profile,
      process: proc,
      onOutput: new vscode.EventEmitter<string>(),
      onStderr: new vscode.EventEmitter<string>(),
      onError: new vscode.EventEmitter<string>(),
      onEnd: new vscode.EventEmitter<number>(),
    };

    proc.stdout?.on('data', (data: Buffer) => {
      session.onOutput.fire(data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      session.onStderr.fire(data.toString());
    });

    proc.on('close', (code) => {
      session.onEnd.fire(code ?? -1);
      this.sessions.delete(sessionId);
    });

    proc.on('error', (err) => {
      session.onError.fire(`Failed to start ${profile.name}: ${err.message}`);
      session.onEnd.fire(-1);
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);

    if (profile.inputMode === 'stdin' && initialInput) {
      this.sendInput(sessionId, initialInput);
    }

    return session;
  }

  sendInput(sessionId: string, text: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process.stdin || session.process.stdin.destroyed) { return false; }
    session.process.stdin.write(text + '\n');
    return true;
  }

  /** Get the active session for a specific CLI tool (latest one) */
  getSessionForCli(cliId: string): Session | undefined {
    let latest: Session | undefined;
    for (const session of this.sessions.values()) {
      if (session.cliId === cliId) {
        latest = session;
      }
    }
    return latest;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }
    try {
      session.process.kill('SIGTERM');
    } catch {
      // process may already be dead
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const [id] of this.sessions) {
      this.stop(id);
    }
    this.stopBackgroundServers();
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  private async getBackgroundAttachArgs(
    profile: CliProfile,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<string[]> {
    if (!profile.backgroundServer) {
      return [];
    }

    const target = this.getTcpTarget(profile.backgroundServer.url);
    if (!target) {
      return [];
    }

    if (await this.waitForTcp(target.host, target.port, 120)) {
      return profile.backgroundServer.attachArgs;
    }

    const key = `${profile.id}:${profile.backgroundServer.url}`;
    const state = this.backgroundServers.get(key) ?? {};
    this.backgroundServers.set(key, state);

    if (!state.starting) {
      state.starting = this.startBackgroundServer(
        key,
        command,
        profile.backgroundServer.args,
        cwd,
        env,
        target.host,
        target.port
      );
    }

    const ready = await state.starting;
    return ready ? profile.backgroundServer.attachArgs : [];
  }

  private async startBackgroundServer(
    key: string,
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    host: string,
    port: number
  ): Promise<boolean> {
    const current = this.backgroundServers.get(key);
    if (current?.process && current.process.exitCode === null && !current.process.killed) {
      return this.waitForTcp(host, port, 1800);
    }

    try {
      const proc = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      const state = this.backgroundServers.get(key) ?? {};
      state.process = proc;
      this.backgroundServers.set(key, state);

      const clearState = () => {
        const latest = this.backgroundServers.get(key);
        if (latest?.process === proc) {
          this.backgroundServers.delete(key);
        }
      };

      proc.on('exit', clearState);
      proc.on('error', clearState);
    } catch {
      this.backgroundServers.delete(key);
      return false;
    }

    const ready = await this.waitForTcp(host, port, 2200);
    if (!ready) {
      const state = this.backgroundServers.get(key);
      if (state) {
        state.starting = undefined;
      }
    }

    return ready;
  }

  private stopBackgroundServers(): void {
    for (const [, state] of this.backgroundServers) {
      if (!state.process || state.process.killed) {
        continue;
      }

      try {
        state.process.kill('SIGTERM');
      } catch {
        // background process may already be dead
      }
    }
    this.backgroundServers.clear();
  }

  private getTcpTarget(urlText: string): { host: string; port: number } | undefined {
    try {
      const url = new URL(urlText);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!url.hostname || !Number.isFinite(port)) {
        return undefined;
      }

      return { host: url.hostname, port };
    } catch {
      return undefined;
    }
  }

  private async waitForTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.canConnectTcp(host, port, 180)) {
        return true;
      }
      await this.sleep(80);
    }

    return false;
  }

  private canConnectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
