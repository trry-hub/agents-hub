import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AssistantActionId,
  AssistantContextOptions,
  AssistantImageAttachment,
  AssistantImageAttachmentInput,
  AssistantMode,
  AssistantWebviewRequest,
} from './assistantTypes';
import { actionRequiresActiveFile, actionRequiresSelection } from './actionGuards';
import { CliManager, Session } from './cliManager';
import {
  buildCliOptionArgs,
  CLI_PROFILES,
  getCliAgentMode,
  getCliModelOption,
  getCliPermissionMode,
  getCliProfile,
  getCliRuntimeMode,
  type CliProfile,
} from './cliProfiles';
import { AssistantContextCollector } from './contextCollector';
import { buildAssistantPrompt } from './promptBuilder';
import {
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} from './outputFormatter';
import { countContextTokens } from './tokenCounter';
import {
  resolveRuntimeLocale,
  runtimeActionLabel,
  runtimeDefaultActionText,
  runtimeT,
} from './localization';
import { getProviderExtensionBridge } from './providerExtensions';

interface SidebarProviderOptions {
  contextCollector?: AssistantContextCollector;
  extensionMode?: vscode.ExtensionMode;
  state?: vscode.Memento;
  storageUri?: vscode.Uri;
}

const MAX_IMAGE_ATTACHMENTS = 8;
const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const DEFAULT_CLI_ID = 'opencode';
const NO_OUTPUT_NOTICE_MS = 45_000;
const LAST_PROVIDER_STATE_KEY = 'agentsHub.lastProviderId';
const AGENT_MODE_STATE_KEY = 'agentsHub.agentModeByProvider';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentsHub.sidebar';

  private view?: vscode.WebviewView;
  private activeSessions = new Map<string, Session>();
  private wiredSessionIds = new Set<string>();
  private pendingRequests: AssistantWebviewRequest[] = [];
  private disposables: vscode.Disposable[] = [];
  private outputBuffers = new Map<string, string>();
  private noOutputNoticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private profilesById = new Map<string, CliProfile>();
  private webviewAssetVersion = Date.now();
  private webviewReloadTimer?: ReturnType<typeof setTimeout>;
  private readonly locale = resolveRuntimeLocale(vscode.env.language);
  private readonly contextCollector: AssistantContextCollector;
  private readonly extensionMode: vscode.ExtensionMode;
  private readonly attachmentStorageUri: vscode.Uri;
  private readonly state?: vscode.Memento;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cliManager: CliManager,
    options: SidebarProviderOptions = {}
  ) {
    this.contextCollector = options.contextCollector ?? new AssistantContextCollector();
    this.extensionMode = options.extensionMode ?? vscode.ExtensionMode.Production;
    this.state = options.state;
    this.attachmentStorageUri = options.storageUri ?? vscode.Uri.joinPath(this.extensionUri, '.agents-hub');
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
        case 'openSettings':
          await vscode.commands.executeCommand('agentsHub.openSettings');
          break;
        case 'stop':
          this.handleStop(this.resolveCliId(message));
          break;
        case 'checkProfiles':
          await this.sendProfiles();
          break;
        case 'refreshContext':
          await this.sendContextSummary(message.contextOptions, this.resolveCliId(message));
          break;
        case 'openProviderExtension':
          await this.openProviderExtension(this.resolveCliId(message));
          break;
        case 'copyInstallCommand':
          await this.copyInstallCommand(message.installCommand);
          break;
        case 'saveSelectionState':
          await this.saveSelectionState(message);
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
      permissionMode: action === 'explainSelection' ? preferredReadOnlyPermission(profile) : undefined,
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

  async switchProvider(providerId: string): Promise<void> {
    const profile = getCliProfile(providerId);
    if (!profile) {
      return;
    }

    if (!this.profilesById.has(providerId)) {
      await this.sendProfiles();
    }

    const knownProfile = this.profilesById.get(providerId);
    if (knownProfile && !knownProfile.installed) {
      vscode.window.showWarningMessage(`${knownProfile.name} is not installed.`);
      return;
    }

    await this.state?.update(LAST_PROVIDER_STATE_KEY, providerId);
    await vscode.commands.executeCommand('setContext', 'agentsHub.activeProvider', providerId);

    if (this.view) {
      this.view.show(true);
      await this.postSwitchProviderMessage(providerId);
      return;
    }

    await vscode.commands.executeCommand('agentsHub.sidebar.focus');
    await this.postSwitchProviderMessage(providerId);
  }

  private async postSwitchProviderMessage(providerId: string): Promise<void> {
    await this.view?.webview.postMessage({ command: 'switchProvider', providerId });
  }

  stopAll(): void {
    for (const [cliId, session] of this.activeSessions) {
      this.cliManager.stop(session.id);
      this.cleanupSessionState(session);
      this.view?.webview.postMessage({ command: 'stopped', cliId, sessionId: session.id });
    }
    this.cliManager.stopAll();
    this.activeSessions.clear();
    this.wiredSessionIds.clear();
    this.clearNoOutputNoticeTimers();
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
    this.profilesById.clear();
    profiles.forEach((profile) => {
      this.profilesById.set(profile.id, profile);
    });
    const storedProviderId = this.getStoredProviderId(profiles);
    await this.updateProviderTitleContexts(profiles, storedProviderId ?? this.getDefaultCliId());
    this.view?.webview.postMessage({
      command: 'profiles',
      profiles: profiles.map((profile) => ({
        ...profile,
        vscodeExtension: this.getProviderExtensionStatus(profile.id),
      })),
      defaultProviderId: this.getDefaultCliId(),
      activeProviderId: storedProviderId,
      activeAgentModeByProvider: this.getStoredAgentModeState(),
    });
  }

  private async updateProviderTitleContexts(
    profiles: CliProfile[],
    activeProviderId: string
  ): Promise<void> {
    const installedProviderIds = new Set(
      profiles.filter((profile) => profile.installed).map((profile) => profile.id)
    );

    await Promise.all([
      vscode.commands.executeCommand('setContext', 'agentsHub.activeProvider', activeProviderId),
      ...CLI_PROFILES.map((profile) => (
        vscode.commands.executeCommand(
          'setContext',
          `agentsHub.provider.${profile.id}.installed`,
          installedProviderIds.has(profile.id)
        )
      )),
    ]);
  }

  private getStoredProviderId(profiles: CliProfile[]): string | undefined {
    const providerId = this.state?.get<string>(LAST_PROVIDER_STATE_KEY);
    if (providerId && profiles.some((profile) => profile.id === providerId && profile.installed)) {
      return providerId;
    }
    return undefined;
  }

  private getStoredAgentModeState(): Record<string, string> {
    return this.normalizeAgentModeState(this.state?.get(AGENT_MODE_STATE_KEY));
  }

  private getProviderExtensionStatus(providerId: string) {
    const bridge = getProviderExtensionBridge(providerId);
    if (!bridge) {
      return undefined;
    }

    return {
      extensionId: bridge.extensionId,
      displayName: bridge.displayName,
      installed: Boolean(vscode.extensions.getExtension(bridge.extensionId)),
    };
  }

  private async sendContextSummary(
    contextOptions: Partial<AssistantContextOptions> = {},
    cliId = this.getDefaultCliId()
  ): Promise<void> {
    const options = this.resolveContextOptions(contextOptions);
    const snapshot = await this.contextCollector.collect(options, this.getContextLimits());
    const profile = getCliProfile(cliId) ?? getCliProfile(this.getDefaultCliId());
    const summary = profile
      ? {
          ...this.contextCollector.summarize(snapshot),
          tokenUsage: countContextTokens(snapshot, profile),
        }
      : this.contextCollector.summarize(snapshot);
    this.view?.webview.postMessage({
      command: 'contextSummary',
      summary,
    });
  }

  private async handleAssistantRequest(message: AssistantWebviewRequest): Promise<void> {
    const cliId = this.resolveCliId(message);
    const profile = this.profilesById.get(cliId) ?? getCliProfile(cliId);
    if (!profile) {
      this.postError(cliId, runtimeT(this.locale, 'error.unknownProvider', { provider: cliId }));
      return;
    }

    const mode = normalizeMode(message.mode);
    const action = normalizeAction(message.action);
    const agentMode = getCliAgentMode(profile, message.agentMode ?? message.workflowMode);
    const modelOption = getCliModelOption(profile, message.model);
    const runtimeMode = getCliRuntimeMode(profile, message.runtime);
    const permissionMode = getCliPermissionMode(profile, message.permissionMode);
    const optionArgs = buildCliOptionArgs(profile, {
      model: modelOption.id,
      customModel: message.customModel,
      runtime: runtimeMode.id,
      permissionMode: permissionMode.id,
    });
    const optionKey = [
      agentMode.id,
      modelOption.id,
      modelOption.custom ? (message.customModel ?? '').trim() : '',
      runtimeMode.id,
      permissionMode.id,
    ].join('|');
    const userText =
      (message.text ?? '').trim() || runtimeDefaultActionText(this.locale, action);
    const contextOptions = this.resolveContextOptionsForAction(action, message.contextOptions);

    const snapshot = await this.contextCollector.collect(contextOptions, this.getContextLimits());
    const contextSummary = {
      ...this.contextCollector.summarize(snapshot),
      tokenUsage: countContextTokens(snapshot, profile),
    };
    if (actionRequiresActiveFile(action) && !snapshot.activeFile) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingActiveFile'));
      return;
    }
    if (actionRequiresSelection(action) && !snapshot.selection) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingSelection'));
      return;
    }

    const attachments = await this.materializeImageAttachments(message.attachments);

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
      attachments,
      conversationHistory: message.conversationHistory,
      context: snapshot,
    });

    let session = this.activeSessions.get(cliId);
    const canReuseSession =
      session &&
      session.process.exitCode === null &&
      !session.process.killed &&
      session.profile.inputMode === 'stdin' &&
      session.profile.keepStdinOpen === true &&
      session.agentModeId === agentMode.id &&
      session.optionKey === optionKey;

    if (!canReuseSession) {
      if (session) {
        this.activeSessions.delete(cliId);
      }

      const newSession = await this.cliManager.startPrompt(
        cliId,
        profile.inputMode === 'argument' ? prompt : undefined,
        [...optionArgs, ...(agentMode.args ?? [])],
        agentMode.id,
        optionKey
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
      attachments,
      contextSummary,
    });
    this.armNoOutputNotice(session);

    if (profile.inputMode === 'stdin') {
      const sent = this.cliManager.sendInput(session.id, prompt, !profile.keepStdinOpen);
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
      this.clearNoOutputNoticeTimer(session.id);
      const normalized = normalizeCliOutputChunk(
        data,
        session.cliId,
        this.outputBuffers.get(session.id) ?? ''
      );
      this.outputBuffers.set(session.id, normalized.buffer);
      if (!normalized.text && normalized.status !== 'thinking') {
        return;
      }

      this.view?.webview.postMessage({
        command: 'output',
        cliId: session.cliId,
        text: normalized.text,
        sessionId: session.id,
        stream: 'stdout',
      });
    });

    const stderrDisposable = session.onStderr.event((data) => {
      this.clearNoOutputNoticeTimer(session.id);
      const text = normalizeCliOutput(data, session.cliId);
      if (!text) {
        return;
      }

      this.view?.webview.postMessage({
        command: 'output',
        cliId: session.cliId,
        text,
        sessionId: session.id,
        stream: 'stderr',
      });
    });

    const errorDisposable = session.onError.event((data) => {
      this.clearNoOutputNoticeTimer(session.id);
      this.view?.webview.postMessage({
        command: 'error',
        cliId: session.cliId,
        text: normalizeCliOutput(data, session.cliId),
        sessionId: session.id,
      });
    });

    const endDisposable = session.onEnd.event((code) => {
      this.clearNoOutputNoticeTimer(session.id);
      const buffered = this.outputBuffers.get(session.id);
      const flushed = flushCliOutputBuffer(buffered ?? '', session.cliId);
      this.outputBuffers.delete(session.id);
      if (flushed) {
        this.view?.webview.postMessage({
          command: 'output',
          cliId: session.cliId,
          text: flushed,
          sessionId: session.id,
          stream: 'stdout',
        });
      }

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
      this.cleanupSessionState(session);
      this.view?.webview.postMessage({ command: 'stopped', cliId, sessionId: session.id });
    }
  }

  private cleanupSessionState(session: Session): void {
    this.clearNoOutputNoticeTimer(session.id);
    this.outputBuffers.delete(session.id);
    this.activeSessions.delete(session.cliId);
    this.wiredSessionIds.delete(session.id);
  }

  private armNoOutputNotice(session: Session): void {
    this.clearNoOutputNoticeTimer(session.id);
    const timer = setTimeout(() => {
      this.noOutputNoticeTimers.delete(session.id);
      if (session.process.exitCode !== null || session.process.killed) {
        return;
      }

      this.view?.webview.postMessage({
        command: 'sessionNotice',
        cliId: session.cliId,
        sessionId: session.id,
        text: runtimeT(this.locale, 'warning.noOutput', {
          provider: session.profile.name,
          seconds: String(Math.round(NO_OUTPUT_NOTICE_MS / 1000)),
        }),
      });
    }, NO_OUTPUT_NOTICE_MS);
    this.noOutputNoticeTimers.set(session.id, timer);
  }

  private clearNoOutputNoticeTimer(sessionId: string): void {
    const timer = this.noOutputNoticeTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.noOutputNoticeTimers.delete(sessionId);
  }

  private clearNoOutputNoticeTimers(): void {
    for (const timer of this.noOutputNoticeTimers.values()) {
      clearTimeout(timer);
    }
    this.noOutputNoticeTimers.clear();
  }

  private async openProviderExtension(cliId: string): Promise<void> {
    const bridge = getProviderExtensionBridge(cliId);
    const profile = getCliProfile(cliId);
    if (!bridge) {
      vscode.window.showInformationMessage(
        runtimeT(this.locale, 'providerExtension.notConfigured', {
          provider: profile?.name ?? cliId,
        })
      );
      return;
    }

    const extension = vscode.extensions.getExtension(bridge.extensionId);
    if (!extension) {
      vscode.window.showWarningMessage(
        runtimeT(this.locale, 'providerExtension.notInstalled', {
          extension: bridge.displayName,
        })
      );
      await vscode.commands.executeCommand('workbench.extensions.search', `@id:${bridge.extensionId}`);
      return;
    }

    await extension.activate();
    for (const command of bridge.openCommands) {
      try {
        await vscode.commands.executeCommand(command);
        return;
      } catch {
        // Try the next public command exposed by the provider extension.
      }
    }

    vscode.window.showWarningMessage(
      runtimeT(this.locale, 'providerExtension.openFailed', { extension: bridge.displayName })
    );
  }

  private async copyInstallCommand(installCommand: unknown): Promise<void> {
    const text = typeof installCommand === 'string' ? installCommand.trim() : '';
    if (!text) {
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(runtimeT(this.locale, 'notification.installCommandCopied'));
  }

  private async saveSelectionState(message: unknown): Promise<void> {
    if (!this.state || !message || typeof message !== 'object') {
      return;
    }

    const payload = message as {
      activeProviderId?: unknown;
      activeAgentModeByProvider?: unknown;
    };
    const providerId = typeof payload.activeProviderId === 'string' ? payload.activeProviderId : '';
    if (providerId && getCliProfile(providerId)) {
      await this.state.update(LAST_PROVIDER_STATE_KEY, providerId);
      await vscode.commands.executeCommand('setContext', 'agentsHub.activeProvider', providerId);
    }

    await this.state.update(
      AGENT_MODE_STATE_KEY,
      this.normalizeAgentModeState(payload.activeAgentModeByProvider)
    );
  }

  private normalizeAgentModeState(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [providerId, modeId] of Object.entries(value)) {
      if (typeof providerId !== 'string' || typeof modeId !== 'string') {
        continue;
      }
      const profile = this.profilesById.get(providerId) ?? getCliProfile(providerId);
      const mode = profile?.agentModes.find((item) => item.id === modeId && !item.disabled);
      if (mode) {
        result[providerId] = modeId;
      }
    }
    return result;
  }

  private resolveCliId(message: AssistantWebviewRequest): string {
    return message.cliId ?? message.providerId ?? this.getDefaultCliId();
  }

  private getDefaultCliId(): string {
    const configured = vscode.workspace
      .getConfiguration('agentsHub')
      .get<string>('defaultProvider', DEFAULT_CLI_ID);

    if (configured && getCliProfile(configured)) {
      return configured;
    }

    return getCliProfile(DEFAULT_CLI_ID)?.id ?? CLI_PROFILES[0]?.id ?? DEFAULT_CLI_ID;
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

  private async materializeImageAttachments(
    inputs: AssistantImageAttachmentInput[] = []
  ): Promise<AssistantImageAttachment[]> {
    const imageInputs = inputs
      .filter(isImageAttachmentInput)
      .slice(0, MAX_IMAGE_ATTACHMENTS);

    if (imageInputs.length === 0) {
      return [];
    }

    const attachmentDir = vscode.Uri.joinPath(this.attachmentStorageUri, 'pasted-images');
    await vscode.workspace.fs.createDirectory(attachmentDir);

    const attachments: AssistantImageAttachment[] = [];
    for (const input of imageInputs) {
      const decoded = decodeImageDataUrl(input.dataUrl, input.mimeType);
      if (!decoded) {
        continue;
      }

      const name = safeAttachmentName(input.name, decoded.mimeType, attachments.length);
      const fileName = `${Date.now()}-${attachments.length + 1}-${name}`;
      const uri = vscode.Uri.joinPath(attachmentDir, fileName);
      await vscode.workspace.fs.writeFile(uri, decoded.bytes);
      attachments.push({
        kind: 'image',
        name,
        mimeType: decoded.mimeType,
        size: decoded.bytes.byteLength,
        path: uri.fsPath,
      });
    }

    return attachments;
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
    this.clearNoOutputNoticeTimers();
    this.outputBuffers.clear();
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

function preferredReadOnlyPermission(profile?: CliProfile): string | undefined {
  if (!profile) {
    return undefined;
  }

  const mode = profile.permissionModes?.find((item) => item.id === 'readOnly')
    ?? profile.permissionModes?.find((item) => item.id === 'plan');
  return mode?.id;
}

function isImageAttachmentInput(value: unknown): value is AssistantImageAttachmentInput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const input = value as Partial<AssistantImageAttachmentInput>;
  return (
    input.kind === 'image' &&
    typeof input.name === 'string' &&
    typeof input.mimeType === 'string' &&
    input.mimeType.startsWith('image/') &&
    typeof input.dataUrl === 'string' &&
    input.dataUrl.startsWith('data:image/') &&
    Number(input.size) > 0 &&
    Number(input.size) <= MAX_IMAGE_ATTACHMENT_BYTES
  );
}

function decodeImageDataUrl(
  dataUrl: string,
  expectedMimeType: string
): { mimeType: string; bytes: Uint8Array } | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    return undefined;
  }

  const mimeType = match[1] || expectedMimeType;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
    return undefined;
  }

  return { mimeType, bytes };
}

function safeAttachmentName(name: string, mimeType: string, index: number): string {
  const fallback = `pasted-image-${index + 1}${extensionForMime(mimeType)}`;
  const baseName = path.basename(String(name || fallback)).replace(/[^a-zA-Z0-9._-]/g, '-');
  const normalized = baseName.replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 80);
  if (!normalized) {
    return fallback;
  }

  return /\.[a-zA-Z0-9]{2,5}$/.test(normalized)
    ? normalized
    : `${normalized}${extensionForMime(mimeType)}`;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'image/png':
    default:
      return '.png';
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
