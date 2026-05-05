import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AssistantActionId,
  AssistantContextOptions,
  AssistantMode,
  AssistantWebviewRequest,
} from './assistantTypes';
import { actionRequiresActiveFile, actionRequiresSelection } from './actionGuards';
import { CliManager, Session } from './cliManager';
import { CLI_PROFILES, getCliAgentMode, getCliProfile, type CliProfile } from './cliProfiles';
import { AssistantContextCollector } from './contextCollector';
import { buildAssistantPrompt } from './promptBuilder';
import { normalizeCliOutput } from './outputFormatter';
import {
  resolveRuntimeLocale,
  runtimeActionLabel,
  runtimeDefaultActionText,
  runtimeT,
} from './localization';

interface SidebarProviderOptions {
  contextCollector?: AssistantContextCollector;
  extensionMode?: vscode.ExtensionMode;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentsHub.sidebar';

  private view?: vscode.WebviewView;
  private activeSessions = new Map<string, Session>();
  private wiredSessionIds = new Set<string>();
  private pendingRequests: AssistantWebviewRequest[] = [];
  private disposables: vscode.Disposable[] = [];
  private webviewAssetVersion = Date.now();
  private webviewReloadTimer?: ReturnType<typeof setTimeout>;
  private readonly locale = resolveRuntimeLocale(vscode.env.language);
  private readonly contextCollector: AssistantContextCollector;
  private readonly extensionMode: vscode.ExtensionMode;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cliManager: CliManager,
    options: SidebarProviderOptions = {}
  ) {
    this.contextCollector = options.contextCollector ?? new AssistantContextCollector();
    this.extensionMode = options.extensionMode ?? vscode.ExtensionMode.Production;
    this.registerDevelopmentWebviewWatcher();
  }

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
    void this.sendProfiles();
    void this.sendContextSummary();
    void this.flushPendingRequests();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'send':
        case 'quickAction':
          await this.handleAssistantRequest(message);
          break;
        case 'stop':
          this.handleStop(this.resolveCliId(message));
          break;
        case 'checkProfiles':
          await this.sendProfiles();
          break;
        case 'refreshContext':
          await this.sendContextSummary(message.contextOptions);
          break;
        case 'reloadWindow':
          await vscode.commands.executeCommand('agentsHub.reloadWindow');
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }

  async runEditorAction(action: AssistantActionId): Promise<void> {
    const cliId = this.getDefaultCliId();
    const profile = getCliProfile(cliId);
    const request: AssistantWebviewRequest = {
      cliId,
      action,
      mode: 'agent',
      agentMode: action === 'explainSelection' ? preferredReadOnlyMode(profile) : undefined,
      text: runtimeDefaultActionText(this.locale, action),
      contextOptions: {
        includeWorkspace: true,
        includeCurrentFile: true,
        includeSelection: true,
        includeDiagnostics: true,
      },
    };

    this.pendingRequests.push(request);
    await vscode.commands.executeCommand('agentsHub.sidebar.focus');

    if (this.view) {
      await this.flushPendingRequests();
    }
  }

  stopAll(): void {
    for (const [cliId, session] of this.activeSessions) {
      this.cliManager.stop(session.id);
      this.view?.webview.postMessage({ command: 'stopped', cliId, sessionId: session.id });
    }
    this.cliManager.stopAll();
    this.activeSessions.clear();
    this.wiredSessionIds.clear();
  }

  private async flushPendingRequests(): Promise<void> {
    while (this.view && this.pendingRequests.length > 0) {
      const request = this.pendingRequests.shift();
      if (request) {
        await this.handleAssistantRequest(request);
      }
    }
  }

  private async sendProfiles(): Promise<void> {
    const profiles = await this.cliManager.getProfilesWithStatus();
    this.view?.webview.postMessage({
      command: 'profiles',
      profiles,
      defaultProviderId: this.getDefaultCliId(),
    });
  }

  private async sendContextSummary(
    contextOptions: Partial<AssistantContextOptions> = {}
  ): Promise<void> {
    const options = this.resolveContextOptions(contextOptions);
    const snapshot = await this.contextCollector.collect(options, this.getContextLimits());
    this.view?.webview.postMessage({
      command: 'contextSummary',
      summary: this.contextCollector.summarize(snapshot),
    });
  }

  private async handleAssistantRequest(message: AssistantWebviewRequest): Promise<void> {
    const cliId = this.resolveCliId(message);
    const profile = getCliProfile(cliId);
    if (!profile) {
      this.postError(cliId, runtimeT(this.locale, 'error.unknownProvider', { provider: cliId }));
      return;
    }

    const mode = normalizeMode(message.mode);
    const action = normalizeAction(message.action);
    const agentMode = getCliAgentMode(profile, message.agentMode ?? message.workflowMode);
    const userText =
      (message.text ?? '').trim() || runtimeDefaultActionText(this.locale, action);
    const contextOptions = this.resolveContextOptionsForAction(action, message.contextOptions);

    const snapshot = await this.contextCollector.collect(contextOptions, this.getContextLimits());
    const contextSummary = this.contextCollector.summarize(snapshot);
    if (actionRequiresActiveFile(action) && !snapshot.activeFile) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingActiveFile'));
      return;
    }
    if (actionRequiresSelection(action) && !snapshot.selection) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingSelection'));
      return;
    }

    const prompt = buildAssistantPrompt({
      provider: { id: profile.id, name: profile.name },
      mode,
      agentMode: {
        id: agentMode.id,
        label: agentMode.label,
        instruction: agentMode.instruction,
      },
      action,
      message: userText,
      context: snapshot,
    });

    let session = this.activeSessions.get(cliId);
    const canReuseSession =
      session &&
      session.process.exitCode === null &&
      !session.process.killed &&
      session.profile.inputMode === 'stdin' &&
      session.agentModeId === agentMode.id;

    if (!canReuseSession) {
      if (session) {
        this.activeSessions.delete(cliId);
      }

      const newSession = await this.cliManager.startPrompt(
        cliId,
        profile.inputMode === 'argument' ? prompt : undefined,
        agentMode.args,
        agentMode.id
      );

      if (!newSession) {
        this.postError(
          cliId,
          runtimeT(this.locale, 'error.startFailed', { provider: profile.name })
        );
        return;
      }

      session = newSession;
      this.activeSessions.set(cliId, session);
      this.wireSession(session);
    }

    if (!session) {
      this.postError(cliId, runtimeT(this.locale, 'error.startFailed', { provider: profile.name }));
      return;
    }

    this.view?.webview.postMessage({
      command: 'requestStarted',
      cliId,
      sessionId: session.id,
      text: userText,
      mode,
      agentMode: agentMode.id,
      agentModeLabel: agentMode.label,
      action,
      actionLabel: runtimeActionLabel(this.locale, action),
      contextSummary,
    });

    if (profile.inputMode === 'stdin') {
      const sent = this.cliManager.sendInput(session.id, prompt);
      if (!sent) {
        this.postError(cliId, runtimeT(this.locale, 'error.sendFailed'));
      }
    }
  }

  private wireSession(session: Session): void {
    if (this.wiredSessionIds.has(session.id)) {
      return;
    }

    this.wiredSessionIds.add(session.id);

    const outputDisposable = session.onOutput.event((data) => {
      this.view?.webview.postMessage({
        command: 'output',
        cliId: session.cliId,
        text: normalizeCliOutput(data, session.cliId),
        sessionId: session.id,
        stream: 'stdout',
      });
    });

    const stderrDisposable = session.onStderr.event((data) => {
      this.view?.webview.postMessage({
        command: 'output',
        cliId: session.cliId,
        text: normalizeCliOutput(data, session.cliId),
        sessionId: session.id,
        stream: 'stderr',
      });
    });

    const errorDisposable = session.onError.event((data) => {
      this.view?.webview.postMessage({
        command: 'error',
        cliId: session.cliId,
        text: normalizeCliOutput(data, session.cliId),
        sessionId: session.id,
      });
    });

    const endDisposable = session.onEnd.event((code) => {
      this.view?.webview.postMessage({
        command: 'sessionEnd',
        cliId: session.cliId,
        exitCode: code,
        sessionId: session.id,
      });
      this.activeSessions.delete(session.cliId);
      this.wiredSessionIds.delete(session.id);
    });

    this.disposables.push(outputDisposable, stderrDisposable, errorDisposable, endDisposable);
  }

  private handleStop(cliId: string): void {
    const session = this.activeSessions.get(cliId);
    if (session) {
      this.cliManager.stop(session.id);
      this.activeSessions.delete(cliId);
      this.view?.webview.postMessage({ command: 'stopped', cliId, sessionId: session.id });
    }
  }

  private resolveCliId(message: AssistantWebviewRequest): string {
    return message.cliId ?? message.providerId ?? this.getDefaultCliId();
  }

  private getDefaultCliId(): string {
    const configured = vscode.workspace
      .getConfiguration('agentsHub')
      .get<string>('defaultProvider', 'codex');

    if (configured && getCliProfile(configured)) {
      return configured;
    }

    return CLI_PROFILES[0]?.id ?? 'codex';
  }

  private resolveContextOptions(
    overrides: Partial<AssistantContextOptions> = {}
  ): AssistantContextOptions {
    const config = vscode.workspace.getConfiguration('agentsHub.context');
    return {
      includeWorkspace: config.get<boolean>('includeWorkspace', true),
      includeCurrentFile: config.get<boolean>('includeCurrentFile', true),
      includeSelection: config.get<boolean>('includeSelection', true),
      includeDiagnostics: config.get<boolean>('includeDiagnostics', true),
      ...overrides,
    };
  }

  private resolveContextOptionsForAction(
    action: AssistantActionId,
    overrides: Partial<AssistantContextOptions> = {}
  ): AssistantContextOptions {
    const options = this.resolveContextOptions(overrides);
    if (actionRequiresActiveFile(action)) {
      options.includeCurrentFile = true;
    }

    return options;
  }

  private getContextLimits() {
    const config = vscode.workspace.getConfiguration('agentsHub.context');
    return {
      maxFileChars: config.get<number>('maxFileChars', 12000),
      maxSelectionChars: config.get<number>('maxSelectionChars', 8000),
      maxDiagnostics: config.get<number>('maxDiagnostics', 12),
    };
  }

  private postError(cliId: string, text: string): void {
    this.view?.webview.postMessage({
      command: 'error',
      cliId,
      text,
    });
  }

  private registerDevelopmentWebviewWatcher(): void {
    if (this.extensionMode !== vscode.ExtensionMode.Development) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      this.extensionUri,
      'media/{main.html,main.css,main.js,i18n.js}'
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const scheduleReload = () => this.scheduleWebviewReloadForDevelopment();

    this.disposables.push(
      watcher,
      watcher.onDidChange(scheduleReload),
      watcher.onDidCreate(scheduleReload),
      watcher.onDidDelete(scheduleReload)
    );
  }

  private scheduleWebviewReloadForDevelopment(): void {
    if (this.webviewReloadTimer) {
      clearTimeout(this.webviewReloadTimer);
    }

    this.webviewReloadTimer = setTimeout(() => {
      this.webviewReloadTimer = undefined;
      this.reloadWebviewForDevelopment();
    }, 120);
  }

  private reloadWebviewForDevelopment(): void {
    if (!this.view) {
      return;
    }

    this.webviewAssetVersion = Date.now();
    this.view.webview.html = this.getHtml(this.view.webview);
    void this.sendProfiles();
    void this.sendContextSummary();
  }

  private getWebviewUri(webview: vscode.Webview, ...paths: string[]): string {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...paths)).toString();
    if (this.extensionMode !== vscode.ExtensionMode.Development) {
      return uri;
    }

    const separator = uri.includes('?') ? '&' : '?';
    return `${uri}${separator}v=${this.webviewAssetVersion}`;
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'main.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const nonce = getNonce();
    const csp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} data: https:;`,
      `style-src ${webview.cspSource};`,
      `script-src ${webview.cspSource} 'nonce-${nonce}';`,
      `font-src ${webview.cspSource};`,
      `base-uri 'none';`,
      `form-action 'none';`,
    ].join(' ');

    html = html.replace('__CSP__', csp);
    html = html.replace(/__NONCE__/g, nonce);
    html = html.replace(/__LOCALE__/g, this.locale);
    html = html.replace(
      /__MAIN_CSS_URI__/g,
      this.getWebviewUri(webview, 'media', 'main.css')
    );
    html = html.replace(
      /__I18N_JS_URI__/g,
      this.getWebviewUri(webview, 'media', 'i18n.js')
    );
    html = html.replace(
      /__MAIN_JS_URI__/g,
      this.getWebviewUri(webview, 'media', 'main.js')
    );
    return html;
  }

  dispose(options: { disposeContextCollector?: boolean } = {}): void {
    if (this.webviewReloadTimer) {
      clearTimeout(this.webviewReloadTimer);
      this.webviewReloadTimer = undefined;
    }
    for (const [, session] of this.activeSessions) {
      this.cliManager.stop(session.id);
    }
    if (options.disposeContextCollector) {
      this.contextCollector.dispose();
    }
    this.activeSessions.clear();
    this.wiredSessionIds.clear();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this.view = undefined;
  }
}

function normalizeMode(mode?: AssistantMode): AssistantMode {
  return 'agent';
}

function normalizeAction(action?: AssistantActionId): AssistantActionId {
  switch (action) {
    case 'explainSelection':
    case 'reviewFile':
    case 'generateTests':
    case 'refactorSelection':
    case 'freeform':
      return action;
    default:
      return 'freeform';
  }
}

function preferredReadOnlyMode(profile?: CliProfile): string | undefined {
  if (!profile) {
    return undefined;
  }

  const mode = profile.agentModes.find((item) => item.id === 'plan')
    ?? profile.agentModes.find((item) => item.id === 'suggest');
  return mode?.id;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
