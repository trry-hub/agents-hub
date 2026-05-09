import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { CliManager } from './cliManager';
import { CLI_PROFILES } from './cliProfiles';
import { resolveRuntimeLocale, runtimeT } from './localization';

export function activate(context: vscode.ExtensionContext) {
  const locale = resolveRuntimeLocale(vscode.env.language);
  const cliManager = new CliManager();
  const sidebarProvider = new SidebarProvider(context.extensionUri, cliManager, {
    extensionMode: context.extensionMode,
    state: context.globalState,
    storageUri: context.globalStorageUri,
  });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.text = runtimeT(locale, 'statusBar.text');
  statusBar.tooltip = runtimeT(locale, 'statusBar.tooltip');
  statusBar.command = 'agentsHub.openPanel';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Register sidebar webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.openPanel', () => {
      vscode.commands.executeCommand('agentsHub.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.reloadWindow', async () => {
      sidebarProvider.stopAll();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'agentsHub');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.stopAll', () => {
      sidebarProvider.stopAll();
      vscode.window.showInformationMessage(runtimeT(locale, 'notification.stoppedAll'));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.explainSelection', () => {
      void sidebarProvider.runEditorAction('explainSelection');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.reviewFile', () => {
      void sidebarProvider.runEditorAction('reviewFile');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.generateTests', () => {
      void sidebarProvider.runEditorAction('generateTests');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentsHub.refactorSelection', () => {
      void sidebarProvider.runEditorAction('refactorSelection');
    })
  );

  for (const profile of CLI_PROFILES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`agentsHub.switchProvider.${profile.id}`, () => {
        void sidebarProvider.switchProvider(profile.id);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(`agentsHub.switchProviderActive.${profile.id}`, () => {
        void sidebarProvider.switchProvider(profile.id);
      })
    );
  }

  // Clean up on deactivate
  context.subscriptions.push({
    dispose: () => {
      cliManager.stopAll();
      sidebarProvider.dispose({ disposeContextCollector: true });
    },
  });
}

export function deactivate() {
  // cleanup handled by disposables
}
