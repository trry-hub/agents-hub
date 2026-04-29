import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { CliProfile, getCliProfile } from './cliProfiles';

export interface Session {
  id: string;
  cliId: string;
  profile: CliProfile;
  process: ChildProcess;
  onOutput: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();

  getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/';
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    const profile = getCliProfile(profileId);
    if (!profile) { return false; }

    return new Promise<boolean>((resolve) => {
      const proc = spawn('which', [profile.command], {
        stdio: 'ignore',
        shell: true,
      });
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
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

  /** Start a CLI in prompt (non-interactive) mode. Stdin is kept open for multi-turn. */
  startPrompt(cliId: string): Session | null {
    const profile = getCliProfile(cliId);
    if (!profile) { return null; }

    const cwd = this.getWorkspaceRoot();
    const n = (this.counters.get(cliId) ?? 0) + 1;
    this.counters.set(cliId, n);
    const sessionId = `${cliId}-${n}`;

    const proc = spawn(profile.command, profile.promptArgs, {
      cwd,
      env: { ...process.env, ...profile.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: Session = {
      id: sessionId,
      cliId,
      profile,
      process: proc,
      onOutput: new vscode.EventEmitter<string>(),
      onError: new vscode.EventEmitter<string>(),
      onEnd: new vscode.EventEmitter<number>(),
    };

    proc.stdout?.on('data', (data: Buffer) => {
      session.onOutput.fire(data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      session.onError.fire(data.toString());
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
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
