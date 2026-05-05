import {
  AssistantActionId,
  AssistantContextSnapshot,
  AssistantPromptRequest,
} from './assistantTypes';

const ACTION_LABELS: Record<AssistantActionId, string> = {
  freeform: 'Freeform request',
  explainSelection: 'Explain selected code',
  reviewFile: 'Review current file',
  generateTests: 'Generate tests',
  refactorSelection: 'Refactor selected code',
};

const ACTION_INSTRUCTIONS: Record<AssistantActionId, string> = {
  freeform: 'Answer the user request using the provided IDE context. Be concrete and reference files when useful.',
  explainSelection:
    'Explain the selected code clearly. Cover intent, important control flow, edge cases, and any risky assumptions.',
  reviewFile:
    'Review the current file for correctness, maintainability, type-safety, missing tests, and likely regressions. Lead with findings. Do not review the whole workspace when current file context is unavailable; ask the user to open a file instead.',
  generateTests:
    'Propose or implement focused tests for the selected code or current file. Prefer existing project patterns and explain how to run them.',
  refactorSelection:
    'Refactor the selected code while preserving behavior. Keep changes scoped and explain the resulting improvement.',
};

export function buildAssistantPrompt(request: AssistantPromptRequest): string {
  const agentMode = request.agentMode;
  const lines: string[] = [
    'You are an AI coding assistant embedded in VS Code.',
    `Provider: ${request.provider.name}`,
    'Mode: Agent',
    `Provider agent/mode: ${agentMode.label} (${agentMode.id})`,
    `Action: ${ACTION_LABELS[request.action]}`,
    '',
    'Agent mode is always enabled. Reason across files when helpful and be explicit about assumptions, edits, and verification.',
    agentMode.instruction,
    ACTION_INSTRUCTIONS[request.action],
    '',
    'User request:',
    request.message.trim() || defaultMessageForAction(request.action),
    '',
    renderContext(request.context),
    '',
    'Response requirements:',
    '- Be specific to the provided project context.',
    '- Use concise Markdown.',
    '- When suggesting code changes, include file paths and minimal patches or snippets.',
    '- If context is missing, say what is missing and proceed with the best available information.',
  ];

  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

export function getAssistantActionLabel(action: AssistantActionId): string {
  return ACTION_LABELS[action];
}

function defaultMessageForAction(action: AssistantActionId): string {
  switch (action) {
    case 'explainSelection':
      return 'Explain the selected code.';
    case 'reviewFile':
      return 'Review the current file.';
    case 'generateTests':
      return 'Generate focused tests.';
    case 'refactorSelection':
      return 'Refactor the selected code.';
    case 'freeform':
      return 'Help with the current coding task.';
  }
}

function renderContext(context: AssistantContextSnapshot): string {
  const sections: string[] = ['IDE context:'];

  if (context.workspace) {
    sections.push(`Workspace: ${context.workspace.name}`);
    sections.push(`Workspace root: ${context.workspace.rootPath}`);
  }

  if (context.activeFile) {
    sections.push('');
    sections.push(`Current file: ${context.activeFile.relativePath}`);
    sections.push(`Language: ${context.activeFile.languageId}`);
    sections.push(`Line count: ${context.activeFile.lineCount}`);

    if (context.activeFile.text) {
      sections.push(fencedBlock(context.activeFile.languageId, context.activeFile.text));
      if (context.activeFile.truncated) {
        sections.push('Current file context was truncated.');
      }
    }
  }

  if (context.selection) {
    sections.push('');
    sections.push(`Selection: lines ${context.selection.startLine}-${context.selection.endLine}`);
    sections.push(fencedBlock('', context.selection.text));
    if (context.selection.truncated) {
      sections.push('Selection context was truncated.');
    }
  }

  if (context.diagnostics.length > 0) {
    sections.push('');
    sections.push('Diagnostics:');
    for (const diagnostic of context.diagnostics) {
      sections.push(
        `- ${diagnostic.severity} ${diagnostic.relativePath}:${diagnostic.line} ${diagnostic.message}`
      );
    }
  }

  if (sections.length === 1) {
    sections.push('No IDE context was attached.');
  }

  return sections.join('\n');
}

function fencedBlock(languageId: string, text: string): string {
  const fenceLanguage = languageId && /^[a-zA-Z0-9_-]+$/.test(languageId) ? languageId : '';
  return `\`\`\`${fenceLanguage}\n${escapeFence(text)}\n\`\`\``;
}

function escapeFence(text: string): string {
  return text.replace(/```/g, '``\\`');
}
