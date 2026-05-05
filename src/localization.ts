import { AssistantActionId } from './assistantTypes';

export type RuntimeLocale = 'en' | 'zh-CN';

type RuntimeMessageKey =
  | 'statusBar.text'
  | 'statusBar.tooltip'
  | 'notification.stoppedAll'
  | 'error.unknownProvider'
  | 'error.startFailed'
  | 'error.sendFailed'
  | 'error.missingSelection'
  | 'error.missingActiveFile';

const RUNTIME_MESSAGES: Record<RuntimeLocale, Record<RuntimeMessageKey, string>> = {
  en: {
    'statusBar.text': '$(sparkle) AI Assistant',
    'statusBar.tooltip': 'Open AI Assistant',
    'notification.stoppedAll': 'All AI CLI processes stopped.',
    'error.unknownProvider': 'Unknown provider: {provider}',
    'error.startFailed': 'Failed to start {provider}',
    'error.sendFailed': 'Failed to send input to CLI process',
    'error.missingSelection': 'Select code in the editor before running this action.',
    'error.missingActiveFile': 'Open a file in the editor before running this action.',
  },
  'zh-CN': {
    'statusBar.text': '$(sparkle) AI 助手',
    'statusBar.tooltip': '打开 AI 助手',
    'notification.stoppedAll': '已停止所有 AI CLI 进程。',
    'error.unknownProvider': '未知提供方：{provider}',
    'error.startFailed': '启动 {provider} 失败',
    'error.sendFailed': '无法向 CLI 进程发送输入',
    'error.missingSelection': '请先在编辑器中选中代码，再运行这个动作。',
    'error.missingActiveFile': '请先在编辑器中打开一个文件，再运行这个动作。',
  },
};

const ACTION_LABELS: Record<RuntimeLocale, Record<AssistantActionId, string>> = {
  en: {
    freeform: 'Freeform request',
    explainSelection: 'Explain selected code',
    reviewFile: 'Review current file',
    generateTests: 'Generate tests',
    refactorSelection: 'Refactor selected code',
  },
  'zh-CN': {
    freeform: '自由提问',
    explainSelection: '解释选中代码',
    reviewFile: '审查当前文件',
    generateTests: '生成测试',
    refactorSelection: '重构选中代码',
  },
};

const ACTION_DEFAULT_TEXT: Record<RuntimeLocale, Record<AssistantActionId, string>> = {
  en: {
    freeform: 'Help with the current coding task.',
    explainSelection: 'Explain the selected code.',
    reviewFile: 'Review the current file for bugs, maintainability issues, and missing tests.',
    generateTests: 'Generate focused tests for the selected code or current file.',
    refactorSelection: 'Refactor the selected code while preserving behavior.',
  },
  'zh-CN': {
    freeform: '帮我处理当前编码任务。',
    explainSelection: '解释选中的代码。',
    reviewFile: '审查当前文件中的缺陷、可维护性问题和缺失测试。',
    generateTests: '为选中代码或当前文件生成聚焦的测试。',
    refactorSelection: '在保持行为不变的前提下重构选中代码。',
  },
};

export function resolveRuntimeLocale(language: string): RuntimeLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function runtimeT(
  locale: RuntimeLocale,
  key: RuntimeMessageKey,
  values: Record<string, string> = {}
): string {
  let message = RUNTIME_MESSAGES[locale][key] ?? RUNTIME_MESSAGES.en[key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replace(`{${name}}`, value);
  }
  return message;
}

export function runtimeActionLabel(locale: RuntimeLocale, action: AssistantActionId): string {
  return ACTION_LABELS[locale][action] ?? ACTION_LABELS.en[action];
}

export function runtimeDefaultActionText(locale: RuntimeLocale, action: AssistantActionId): string {
  return ACTION_DEFAULT_TEXT[locale][action] ?? ACTION_DEFAULT_TEXT.en[action];
}
