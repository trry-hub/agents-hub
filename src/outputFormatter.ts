const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

const CONTROL_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const ORPHAN_ANSI_PATTERN =
  /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])/g;

const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
const INTERNAL_PROMPT_END_MARKER =
  '- If context is missing, say what is missing and proceed with the best available information.';

export function normalizeCliOutput(text: string, providerId?: string): string {
  const normalized = text
    .replace(ANSI_PATTERN, '')
    .replace(ORPHAN_ANSI_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_PATTERN, '')
    .replace(/\n{4,}/g, '\n\n\n');

  const providerNormalized = providerId === 'codex' ? normalizeCodexOutput(normalized) : normalized;
  return stripInternalPromptEcho(providerNormalized);
}

function normalizeCodexOutput(text: string): string {
  const readableError = extractCodexJsonError(text);
  if (readableError) {
    return `Error: ${readableError}\n`;
  }

  if (isCodexHtmlChallenge(text)) {
    return '';
  }

  const kept = text
    .split('\n')
    .filter((line) => !isCodexNoiseLine(line))
    .join('\n');

  return kept.replace(/\n{4,}/g, '\n\n\n');
}

function extractCodexJsonError(text: string): string | undefined {
  const match = /ERROR:\s*(\{.*"message"\s*:\s*"[^"]+".*\})/.exec(text);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]);
    return parsed?.error?.message;
  } catch {
    const messageMatch = /"message"\s*:\s*"([^"]+)"/.exec(match[1]);
    return messageMatch?.[1];
  }
}

function isCodexHtmlChallenge(text: string): boolean {
  return (
    text.includes('__cf_chl_opt') ||
    text.includes('challenge-error-text') ||
    text.includes('Cloudflare') ||
    /<html[\s>]/i.test(text)
  );
}

function isCodexNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  return (
    trimmed.length === 0 ||
    /^Reading additional input from stdin/.test(trimmed) ||
    /^WARNING: proceeding, even though we could not update PATH/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T.*\b(WARN|ERROR)\b/.test(trimmed) ||
    /^OpenAI Codex v/.test(trimmed) ||
    /^-+$/.test(trimmed) ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/.test(
      trimmed
    ) ||
    trimmed === 'user'
  );
}

function stripInternalPromptEcho(text: string): string {
  const firstContentIndex = text.search(/\S/);
  if (firstContentIndex === -1) {
    return text;
  }

  if (!text.slice(firstContentIndex).startsWith(INTERNAL_PROMPT_START)) {
    return text;
  }

  const promptEndIndex = text.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
  if (promptEndIndex === -1) {
    return text;
  }

  return text.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length).replace(/^\s+/, '');
}
