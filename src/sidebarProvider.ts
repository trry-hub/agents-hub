import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CliManager, Session } from './cliManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentsHub.sidebar';

  private view?: vscode.WebviewView;
  private activeSession?: Session;
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

    // Send available profiles
    this.sendProfiles();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'send':
          await this.handleSend(message.cliId, message.text);
          break;
        case 'stop':
          this.handleStop();
          break;
        case 'checkProfiles':
          this.sendProfiles();
          break;
        case 'openTerminal':
          this.openInTerminal(message.cliId);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }

  private async sendProfiles() {
    const profiles = await this.cliManager.getProfilesWithStatus();
    this.view?.webview.postMessage({
      command: 'profiles',
      profiles,
    });
  }

  private async handleSend(cliId: string, text: string) {
    // If we have an active session for a different CLI, stop it
    if (this.activeSession && this.activeSession.profile.id !== cliId) {
      this.cliManager.stop(this.activeSession.id);
      this.activeSession = undefined;
    }

    // If no active session, start one
    if (!this.activeSession) {
      const session = this.cliManager.start(cliId);
      if (!session) {
        this.view?.webview.postMessage({
          command: 'error',
          text: `Failed to start ${cliId}`,
        });
        return;
      }
      this.activeSession = session;

      // Wire up output streaming
      this.disposables.push(
        session.onOutput.event((data) => {
          this.view?.webview.postMessage({
            command: 'output',
            text: data,
            sessionId: session.id,
          });
        })
      );
      this.disposables.push(
        session.onError.event((data) => {
          this.view?.webview.postMessage({
            command: 'output',
            text: data,
            sessionId: session.id,
            isError: true,
          });
        })
      );
      this.disposables.push(
        session.onEnd.event((code) => {
          this.view?.webview.postMessage({
            command: 'sessionEnd',
            exitCode: code,
            sessionId: session.id,
          });
          this.activeSession = undefined;
        })
      );
    }

    // Send user input to CLI
    const sent = this.cliManager.sendInput(this.activeSession.id, text);
    if (!sent) {
      this.view?.webview.postMessage({
        command: 'error',
        text: 'Failed to send input to CLI process',
      });
    }
  }

  private handleStop() {
    if (this.activeSession) {
      this.cliManager.stop(this.activeSession.id);
      this.activeSession = undefined;
      this.view?.webview.postMessage({
        command: 'stopped',
      });
    }
  }

  private openInTerminal(cliId: string) {
    const terminal = vscode.window.createTerminal(`AI CLI: ${cliId}`);
    terminal.show();
    terminal.sendText(cliId);
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'main.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const nonce = getNonce();

    // Inject CSP
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
    if (this.activeSession) {
      this.cliManager.stop(this.activeSession.id);
      this.activeSession = undefined;
    }
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
