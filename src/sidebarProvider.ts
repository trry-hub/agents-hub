import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CliManager, Session } from './cliManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentsHub.sidebar';

  private view?: vscode.WebviewView;
  /** Active prompt session per CLI id */
  private activeSessions = new Map<string, Session>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cliManager: CliManager
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.sendProfiles();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'send':
          await this.handleSend(message.cliId, message.text);
          break;
        case 'stop':
          this.handleStop(message.cliId);
          break;
        case 'checkProfiles':
          this.sendProfiles();
          break;
      }
    });

    webviewView.onDidDispose(() => { this.dispose(); });
  }

  private async sendProfiles() {
    const profiles = await this.cliManager.getProfilesWithStatus();
    this.view?.webview.postMessage({ command: 'profiles', profiles });
  }

  private async handleSend(cliId: string, text: string) {
    let session = this.activeSessions.get(cliId);

    // Start a new prompt session if none exists or previous ended
    if (!session || session.process.exitCode !== null) {
      if (session) { this.activeSessions.delete(cliId); }
      const newSession = this.cliManager.startPrompt(cliId);
      if (!newSession) {
        this.view?.webview.postMessage({
          command: 'error', cliId,
          text: `Failed to start ${cliId}`,
        });
        return;
      }
      session = newSession;
      this.activeSessions.set(cliId, newSession);

      // Wire streaming output
      const d1 = newSession.onOutput.event((data) => {
        this.view?.webview.postMessage({
          command: 'output', cliId, text: data, sessionId: newSession.id,
        });
      });
      const d2 = newSession.onError.event((data) => {
        this.view?.webview.postMessage({
          command: 'output', cliId, text: data, sessionId: newSession.id, isError: true,
        });
      });
      const d3 = newSession.onEnd.event((code) => {
        this.view?.webview.postMessage({
          command: 'sessionEnd', cliId, exitCode: code, sessionId: newSession.id,
        });
        this.activeSessions.delete(cliId);
      });
      this.disposables.push(d1, d2, d3);
    }

    // Send input
    const sent = this.cliManager.sendInput(session.id, text);
    if (!sent) {
      this.view?.webview.postMessage({
        command: 'error', cliId,
        text: 'Failed to send input to CLI process',
      });
    }
  }

  private handleStop(cliId: string) {
    const session = this.activeSessions.get(cliId);
    if (session) {
      this.cliManager.stop(session.id);
      this.activeSessions.delete(cliId);
      this.view?.webview.postMessage({ command: 'stopped', cliId });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'main.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    html = html.replace('__CSP__', csp);
    html = html.replace(/__NONCE__/g, nonce);
    return html;
  }

  dispose() {
    for (const [, session] of this.activeSessions) {
      this.cliManager.stop(session.id);
    }
    this.activeSessions.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
