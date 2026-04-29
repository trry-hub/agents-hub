import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { CliManager } from './cliManager';

export function activate(context: vscode.ExtensionContext) {
  const cliManager = new CliManager();
  const sidebarProvider = new SidebarProvider(context.extensionUri, cliManager);

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
    vscode.commands.registerCommand('agentsHub.stopAll', () => {
      cliManager.stopAll();
      vscode.window.showInformationMessage('All AI CLI processes stopped.');
    })
  );

  // Clean up on deactivate
  context.subscriptions.push({
    dispose: () => {
      cliManager.stopAll();
      sidebarProvider.dispose();
    },
  });
}

export function deactivate() {
  // cleanup handled by disposables
}
