import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const previewRoot = '/tmp/agents-hub-preview';
const outputPath = path.join(previewRoot, 'agents-hub-preview.html');

let html = fs.readFileSync(path.join(root, 'media/main.html'), 'utf8');

fs.mkdirSync(previewRoot, { recursive: true });
for (const file of ['main.css', 'main.js', 'i18n.js']) {
  fs.copyFileSync(path.join(root, 'media', file), path.join(previewRoot, file));
}

const i18nUri = './i18n.js';
const mainJsUri = './main.js';
const cssUri = './main.css';

const codexModes = [
  { id: 'suggest', label: 'Suggest', description: 'Codex read-only suggestion mode', instruction: 'Suggest without editing files.', args: ['--sandbox', 'read-only'] },
  { id: 'autoEdit', label: 'Auto Edit', description: 'Codex workspace edit mode', instruction: 'Implement scoped changes.', args: ['--sandbox', 'workspace-write'] },
  { id: 'fullAuto', label: 'Full Auto', description: 'Codex sandboxed full auto mode', instruction: 'Work autonomously in the sandbox.', args: ['--full-auto'] },
  { id: 'review', label: 'Review', description: 'Codex review mode', instruction: 'Lead with findings.' },
];
const opencodeModes = [
  { id: 'build', label: 'Build', description: 'OpenCode build primary agent', instruction: 'Use the build agent.' },
  { id: 'plan', label: 'Plan', description: 'OpenCode plan primary agent', instruction: 'Use the plan agent.' },
];

const vscodeStub = `
<script>
const codexModes = ${JSON.stringify(codexModes)};
const opencodeModes = ${JSON.stringify(opencodeModes)};
window.__messages = [];
window.acquireVsCodeApi = () => ({
  getState() { return window.__state || {}; },
  setState(state) { window.__state = state; },
  postMessage(message) {
    window.__messages.push(message);
    if (message.command === 'checkProfiles') {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'profiles',
        defaultProviderId: 'codex',
        profiles: [
          { id: 'codex', name: 'Codex CLI', accent: '#10a37f', installed: true, installHint: 'npm install -g @openai/codex', defaultAgentMode: 'autoEdit', agentModes: codexModes },
          { id: 'opencode', name: 'OpenCode', accent: '#a855f7', installed: true, installHint: 'brew install opencode-ai/tap/opencode', defaultAgentMode: 'build', agentModes: opencodeModes },
          { id: 'missing', name: 'Missing CLI', accent: '#d97757', installed: false, installHint: 'install missing-cli' }
        ],
      }})), 20);
    }
    if (message.command === 'refreshContext') {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'contextSummary',
        summary: {
          workspace: 'agents-hub',
          activeFile: 'src/extension.ts',
          selection: 'lines 1-8',
          diagnostics: 2,
        },
      }})), 20);
    }
    if (message.command === 'send' || message.command === 'quickAction') {
      const sessionId = 'preview-' + Date.now();
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'requestStarted',
        cliId: message.cliId,
        sessionId,
        text: message.text,
        mode: message.mode,
        agentMode: message.agentMode,
        action: message.action,
        actionLabel: message.action === 'freeform' ? '自由提问' : message.action,
        contextSummary: { workspace: 'agents-hub', activeFile: 'src/extension.ts', diagnostics: 2 },
      }})), 10);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'output',
        cliId: message.cliId,
        sessionId,
        stream: 'stdout',
        text: [
          '## 能力',
          '- **代码修改**：支持 \`TypeScript\`。',
          '- **项目理解**：读取当前上下文。',
          '1. 分析结构',
          '2. 生成补丁',
          '',
          '| 项目 | 状态 |',
          '| --- | --- |',
          '| Markdown | 已渲染 |',
          '> 流式输出会显示加载状态。',
          '\\u001b[0m',
          '\`\`\`ts',
          'const ok = true;',
          '\`\`\`',
        ].join('\\n'),
      }})), 40);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'sessionEnd',
        cliId: message.cliId,
        sessionId,
        exitCode: 0,
      }})), 120);
    }
  },
});
</script>`;

html = html
  .replace('<meta http-equiv="Content-Security-Policy" content="__CSP__">', '')
  .replace('__MAIN_CSS_URI__', cssUri)
  .replace('__I18N_JS_URI__', i18nUri)
  .replace('__MAIN_JS_URI__', mainJsUri)
  .replace(/__NONCE__/g, 'preview')
  .replace(/__LOCALE__/g, 'zh-CN')
  .replace(`<script nonce="preview" src="${i18nUri}"></script>`, `${vscodeStub}\n  <script nonce="preview" src="${i18nUri}"></script>`);

fs.writeFileSync(outputPath, html);
console.log(outputPath);
