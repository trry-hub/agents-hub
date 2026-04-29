import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { CliProfile, getCliProfile } from './cliProfiles';

export interface Session {
  id: string;
  profile: CliProfile;
  process: ChildProcess;
  onOutput: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counter = 0;

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

  start(profileId: string): Session | null {
    const profile = getCliProfile(profileId);
    if (!profile) { return null; }

    const cwd = this.getWorkspaceRoot();
    const sessionId = `${profileId}-${++this.counter}`;

    const proc = spawn(profile.command, profile.args, {
      cwd,
      env: {
        ...process.env,
        ...profile.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const session: Session = {
      id: sessionId,
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
    if (!session || !session.process.stdin) { return false; }
    session.process.stdin.write(text + '\n');
    return true;
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
