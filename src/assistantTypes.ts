export type AssistantMode = 'agent';

export interface AssistantAgentModeRef {
  id: string;
  label: string;
  instruction: string;
}

export type AssistantActionId =
  | 'freeform'
  | 'explainSelection'
  | 'reviewFile'
  | 'generateTests'
  | 'refactorSelection';

export interface AssistantProviderRef {
  id: string;
  name: string;
}

export interface AssistantContextOptions {
  includeWorkspace: boolean;
  includeCurrentFile: boolean;
  includeSelection: boolean;
  includeDiagnostics: boolean;
}

export interface AssistantWorkspaceContext {
  name: string;
  rootPath: string;
}

export interface AssistantFileContext {
  relativePath: string;
  languageId: string;
  lineCount: number;
  text?: string;
  truncated: boolean;
}

export interface AssistantSelectionContext {
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface AssistantDiagnosticContext {
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  message: string;
  relativePath: string;
  line: number;
}

export interface AssistantContextSnapshot {
  workspace?: AssistantWorkspaceContext;
  activeFile?: AssistantFileContext;
  selection?: AssistantSelectionContext;
  diagnostics: AssistantDiagnosticContext[];
}

export interface AssistantPromptRequest {
  provider: AssistantProviderRef;
  mode: AssistantMode;
  agentMode: AssistantAgentModeRef;
  action: AssistantActionId;
  message: string;
  context: AssistantContextSnapshot;
}

export interface AssistantWebviewRequest {
  cliId?: string;
  providerId?: string;
  text?: string;
  mode?: AssistantMode;
  agentMode?: string;
  workflowMode?: string;
  action?: AssistantActionId;
  contextOptions?: Partial<AssistantContextOptions>;
}

export interface AssistantContextSummary {
  workspace?: string;
  activeFile?: string;
  selection?: string;
  diagnostics: number;
}
