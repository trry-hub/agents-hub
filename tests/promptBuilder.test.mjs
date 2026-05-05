import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const { buildAssistantPrompt } = require('../.test-dist/promptBuilder.js');
const {
  resolveRuntimeLocale,
  runtimeDefaultActionText,
} = require('../.test-dist/localization.js');
const { getCliProfile } = require('../.test-dist/cliProfiles.js');
const { normalizeCliOutput } = require('../.test-dist/outputFormatter.js');
const {
  actionRequiresActiveFile,
  actionRequiresSelection,
} = require('../.test-dist/actionGuards.js');
const {
  getLoginShellLookupArgs,
  normalizeCommandPathOutput,
  shellQuote,
} = require('../.test-dist/cliPathResolver.js');

test('buildAssistantPrompt includes provider agent mode, action, user request, and selected code context', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'plan',
      label: 'Plan',
      instruction: 'Plan without editing files.',
    },
    action: 'explainSelection',
    message: 'What does this do?',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      activeFile: {
        relativePath: 'src/example.ts',
        languageId: 'typescript',
        lineCount: 12,
        text: 'export function add(a: number, b: number) { return a + b; }',
        truncated: false,
      },
      selection: {
        text: 'return a + b;',
        startLine: 1,
        endLine: 1,
        truncated: false,
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Mode: Agent/);
  assert.match(prompt, /Provider agent\/mode: Plan \(plan\)/);
  assert.match(prompt, /Plan without editing files/);
  assert.match(prompt, /Action: Explain selected code/);
  assert.match(prompt, /What does this do\?/);
  assert.match(prompt, /src\/example\.ts/);
  assert.match(prompt, /return a \+ b;/);
});

test('buildAssistantPrompt gives provider agent mode stronger implementation instructions', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'claude', name: 'Claude Code' },
    mode: 'agent',
    agentMode: {
      id: 'acceptEdits',
      label: 'Accept Edits',
      instruction: 'Allow file edits while surfacing important risks.',
    },
    action: 'reviewFile',
    message: 'Find risky issues.',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      diagnostics: [
        {
          severity: 'Error',
          message: 'Cannot find name Session',
          relativePath: 'src/sidebarProvider.ts',
          line: 20,
        },
      ],
    },
  });

  assert.match(prompt, /Mode: Agent/);
  assert.match(prompt, /Provider agent\/mode: Accept Edits \(acceptEdits\)/);
  assert.match(prompt, /Allow file edits/);
  assert.match(prompt, /Cannot find name Session/);
  assert.match(prompt, /src\/sidebarProvider\.ts:20/);
});

test('review prompt tells the agent not to replace missing file context with a workspace scan', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'review',
      label: 'Review',
      instruction: 'Review only.',
    },
    action: 'reviewFile',
    message: 'Review the current file.',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Do not review the whole workspace when current file context is unavailable/);
});

test('runtime localization resolves Simplified Chinese editor action text', () => {
  const locale = resolveRuntimeLocale('zh-cn');

  assert.equal(locale, 'zh-CN');
  assert.equal(runtimeDefaultActionText(locale, 'explainSelection'), '解释选中的代码。');
});

test('opencode profile uses run command with prompt as argument', () => {
  const profile = getCliProfile('opencode');

  assert.equal(profile.command, 'opencode');
  assert.deepEqual(profile.promptArgs, ['run']);
  assert.deepEqual(profile.backgroundServer?.args, [
    'serve',
    '--hostname',
    '127.0.0.1',
    '--port',
    '4096',
  ]);
  assert.deepEqual(profile.backgroundServer?.attachArgs, ['--attach', 'http://127.0.0.1:4096']);
  assert.equal(profile.backgroundServer?.url, 'http://127.0.0.1:4096');
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultAgentMode, 'default');
  assert.equal(profile.agentModes.find((mode) => mode.id === 'default').args, undefined);
  assert.equal(
    profile.agentModes.some((mode) => mode.args?.join(' ').includes('--agent build')),
    false
  );
  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'plan').args, ['--agent', 'plan']);
});

test('cli manager warms and attaches background CLI servers when available', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /private backgroundServers = new Map/);
  assert.match(source, /const backgroundAttachArgs = await this\.getBackgroundAttachArgs/);
  assert.match(
    source,
    /\[\.\.\.profile\.promptArgs,\s*\.\.\.backgroundAttachArgs,\s*\.\.\.agentArgs,\s*initialInput\]/s
  );
  assert.match(source, /profile\.backgroundServer\.attachArgs/);
  assert.match(source, /profile\.backgroundServer\.args/);
  assert.match(source, /private async waitForTcp/);
  assert.match(source, /private stopBackgroundServers/);
  assert.match(sidebarSource, /const newSession = await this\.cliManager\.startPrompt/);
  assert.match(sidebarSource, /this\.cliManager\.stopAll\(\);/);
});

test('codex profile passes prompt as argument and disables color output', () => {
  const profile = getCliProfile('codex');

  assert.equal(profile.command, 'codex');
  assert.deepEqual(profile.promptArgs, ['-a', 'never', 'exec', '--color', 'never']);
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultAgentMode, 'autoEdit');
  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'suggest').args, [
    '--sandbox',
    'read-only',
  ]);
  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'autoEdit').args, [
    '--sandbox',
    'workspace-write',
  ]);
  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'fullAuto').args, ['--full-auto']);
  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'review').args, [
    '--sandbox',
    'read-only',
  ]);
});

test('claude profile exposes native permission modes', () => {
  const profile = getCliProfile('claude');

  assert.deepEqual(profile.agentModes.find((mode) => mode.id === 'plan').args, [
    '--permission-mode',
    'plan',
  ]);
  assert.ok(profile.agentModes.some((mode) => mode.id === 'acceptEdits'));
});

test('CLI lookup can use interactive login zsh so nvm-installed tools are visible', () => {
  assert.deepEqual(getLoginShellLookupArgs('codex', '/bin/zsh'), [
    '-lic',
    "command -v 'codex'",
  ]);
});

test('CLI path resolver keeps the first absolute command path from shell output', () => {
  assert.equal(
    normalizeCommandPathOutput('nvm startup noise\n/Users/t/.nvm/versions/node/v24.15.0/bin/codex\n'),
    '/Users/t/.nvm/versions/node/v24.15.0/bin/codex'
  );
  assert.equal(shellQuote("bad'name"), "'bad'\\''name'");
});

test('extension contributes reload window command for debugging', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commands = manifest.contributes.commands.map((command) => command.command);

  assert.ok(manifest.activationEvents.includes('onCommand:agentsHub.reloadWindow'));
  assert.ok(commands.includes('agentsHub.reloadWindow'));
});

test('workspace debug config starts the extension host with the watch task', () => {
  const launch = JSON.parse(readFileSync(new URL('../.vscode/launch.json', import.meta.url), 'utf8'));
  const tasks = JSON.parse(readFileSync(new URL('../.vscode/tasks.json', import.meta.url), 'utf8'));
  const configuration = launch.configurations.find(
    (item) => item.type === 'extensionHost' && item.request === 'launch'
  );
  const watchTask = tasks.tasks.find((item) => item.label === 'npm: watch');

  assert.ok(configuration);
  assert.equal(configuration.preLaunchTask, 'npm: watch');
  assert.deepEqual(configuration.args, ['--extensionDevelopmentPath=${workspaceFolder}']);
  assert.ok(watchTask);
  assert.equal(watchTask.script, 'watch');
  assert.equal(watchTask.isBackground, true);
  assert.equal(watchTask.problemMatcher.background.endsPattern, 'Watching for changes...');
});

test('development mode watches webview assets for live reload', () => {
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(extensionSource, /extensionMode:\s*context\.extensionMode/);
  assert.match(sidebarSource, /vscode\.ExtensionMode\.Development/);
  assert.match(sidebarSource, /createFileSystemWatcher/);
  assert.match(sidebarSource, /media\/\{main\.html,main\.css,main\.js,i18n\.js\}/);
  assert.match(sidebarSource, /webviewAssetVersion/);
  assert.match(sidebarSource, /reloadWebviewForDevelopment/);
});

test('webview CSP is strict enough for VS Code webview diagnostics', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /default-src 'none'/);
  assert.match(source, /style-src \$\{webview\.cspSource\};/);
  assert.match(source, /script-src \$\{webview\.cspSource\} 'nonce-\$\{nonce\}'/);
  assert.doesNotMatch(source, /'unsafe-inline'/);
});

test('webview avoids a duplicate internal title and uses icon-only action buttons', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-i18n="app\.title"/);
  assert.match(html, /<link rel="icon" href="data:,"/);
  assert.match(html, /data-i18n-aria="toolbar\.actions"/);
  assert.match(html, /<svg viewBox="0 0 16 16"/);
});

test('webview uses provider-native mode control and keeps task routing internal', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.match(html, /class="mode-menu"/);
  assert.match(html, /class="mode-popover"/);
  assert.match(html, /id="agentModeSummaryLabel"/);
  assert.match(html, /class="select-field agent-select"/);
  assert.match(html, /id="agentModeSelect"/);
  assert.match(html, /id="actionSelect"[^>]*hidden/);
  assert.doesNotMatch(html, /class="advanced-menu"/);
  assert.doesNotMatch(html, /data-i18n="advanced\.short"/);
});

test('webview composer follows the selected provider identity', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /document\.body\.dataset\.provider = activeId \|\| 'none';/);
  assert.match(script, /agentModeSummaryLabel\.textContent = mode\?\.label \|\| i18n\.t\('agentMode\.short'\);/);
  assert.match(script, /selectedAction === 'freeform' \? 'input\.placeholderProvider' : 'input\.placeholderAction'/);
  assert.match(i18nScript, /'input\.placeholderProvider': 'Message \{provider\}…'/);
  assert.match(i18nScript, /'input\.placeholderProvider': '向 \{provider\} 发送任务\.\.\.'/);
  assert.match(css, /body\[data-provider="codex"\] \.mode-summary/);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-shell/);
});

test('webview provider selector reserves space for the selected CLI name', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.compact-select\s*\{\s*[^}]*min-width:\s*104px;/s);
  assert.match(css, /\.compact-select select\s*\{\s*[^}]*min-width:\s*0;/s);
  assert.match(css, /\.compact-select select\s*\{\s*[^}]*flex:\s*1 1 auto;/s);
});

test('webview toolbar icons and composer controls stay visually centered', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*place-items:\s*center;/s);
  assert.match(css, /\.prompt-actions\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*overflow:\s*hidden;/s);
});

test('webview uses one primary composer action slot for send and stop', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /const running = Boolean\(runningByProvider\[activeId\]\);/);
  assert.match(script, /stopBtn\.classList\.toggle\('is-visible', running\);/);
  assert.match(script, /sendBtn\.classList\.toggle\('is-hidden', running\);/);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*flex:\s*0 0 28px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*display:\s*grid;/s);
  assert.match(css, /\.send-button\.is-hidden\s*\{\s*[^}]*display:\s*none;/s);
});

test('webview empty state is visible in large blank panels', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.empty-state\s*\{\s*[^}]*margin:\s*min\(18vh,\s*96px\) auto auto;/s);
  assert.match(css, /\.empty-state\s*\{\s*[^}]*width:\s*min\(100%,\s*360px\);/s);
  assert.match(css, /\.empty-title\s*\{\s*[^}]*text-wrap:\s*balance;/s);
});

test('webview shows the selected provider without a generic picker prefix', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-i18n="provider\.short"/);
  assert.match(html, /id="providerSelect"[^>]*name="assistantProvider"/);
});

test('webview provider status keeps transient running text out of the composer', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /pendingByProvider\[profile\.id\]/);
  assert.match(script, /runningByProvider\[profile\.id\]/);
  assert.match(script, /provider\.preparing/);
  assert.match(script, /provider\.running/);
  assert.match(script, /providerHint\.textContent = '';/);
  assert.doesNotMatch(script, /providerHint\.classList\.add\('is-busy'\)/);
  assert.doesNotMatch(script, /prompt-shell'\)\?\.classList\.toggle\('is-busy'/);
  assert.match(css, /\.provider-hint\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.provider-hint\.is-warning\s*\{\s*[^}]*display:\s*inline-flex;/s);
  assert.doesNotMatch(css, /\.provider-hint\.is-busy\s*\{/);
  assert.doesNotMatch(css, /\.prompt-shell\.is-busy\s*\{/);
});

test('webview hides low-value default composer chips', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /modeMenu\?\.classList\.toggle\('is-visible', Boolean\(profile && mode\?\.id !== profile\?\.defaultAgentMode\)\);/);
  assert.match(script, /forceContextMenuVisible \|\|\s*\(contextSummary && \(contextSummary\.selection \|\| contextSummary\.activeFile \|\| contextSummary\.diagnostics\)\)/s);
  assert.match(css, /\.mode-menu,\s*\.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.mode-menu\.is-visible,\s*\.context-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
});

test('webview conversation transcript surfaces compact metadata and readable code output', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /html\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*width:\s*100%;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*padding:\s*3px 2px 4px;/s);
  assert.ok(script.indexOf('const ORPHAN_ANSI_PATTERN') < script.indexOf('normalizeSavedThreads'));
  assert.match(script, /if \(item\.meta && item\.role !== 'user'\)/);
  assert.doesNotMatch(script, /parts\.push\(summary\.workspace\)/);
  assert.match(script, /const itemRunning = Boolean\(item\.running && runningByProvider\[activeId\]\);/);
  assert.match(script, /const meta = document\.createElement\('div'\);/);
  assert.match(script, /meta\.className = 'message-meta';/);
  assert.match(script, /bubble\.appendChild\(meta\);/);
  assert.match(css, /\.messages\s*\{\s*[^}]*padding:\s*4px 6px 6px;/s);
  assert.match(css, /\.message-meta\s*\{\s*[^}]*display:\s*inline-flex;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*border-left-width:\s*1px;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*padding:\s*0 0 5px 5px;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*border:\s*0;/s);
  assert.doesNotMatch(script, /typing-dots/);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*max-width:\s*min\(99%,\s*560px\);/s);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*border-color:\s*color-mix/s);
  assert.match(css, /\.md-code-block\s*\{\s*[^}]*line-height:\s*1\.5;/s);
  assert.match(css, /\.md-table-wrap\s*\{\s*[^}]*scrollbar-width:\s*thin;/s);
});

test('webview does not persist transient running message state', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /threadsByProvider: serializeThreadsForState\(threadsByProvider\)/);
  assert.match(script, /\? \{ \.\.\.message, running: false \}/);
  assert.match(script, /running: false,\s*text: filterInternalPromptEcho\(message\.text\)\.text/s);
  assert.match(script, /persist\(\);\s*renderAll\(\);/);
});

test('webview form controls opt out of browser autocomplete noise', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.match(html, /id="promptInput"[^>]*name="assistantPrompt"[^>]*autocomplete="off"/);
  assert.match(html, /id="providerSelect"[^>]*name="assistantProvider"/);
  assert.match(html, /id="agentModeSelect"[^>]*name="assistantAgentMode"/);
  assert.match(html, /id="actionSelect"[^>]*name="assistantAction"/);
});

test('webview exposes a provider-aware slash command palette', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="slashPalette"[^>]*role="listbox"/);
  assert.match(script, /const SLASH_COMMANDS = \[/);
  assert.match(script, /providers:\s*\['claude'\]/);
  assert.match(script, /providers:\s*\['codex'\]/);
  assert.match(script, /providers:\s*\['opencode'\]/);
  assert.match(script, /providers:\s*\['gemini'\]/);
  assert.match(script, /providers:\s*\['goose'\]/);
  assert.match(script, /providers:\s*\['aider'\]/);
  assert.match(script, /function slashCommandMatchesProvider/);
  assert.match(script, /function renderSlashPalette/);
  assert.match(script, /function executeSlashCommand/);
  assert.match(script, /event\.key === 'ArrowDown'/);
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /parseSlashInput\(input\.value\)/);
  assert.match(script, /send\(command\.action,\s*command\.prompt/);
  assert.match(script, /setActiveThread/);
  assert.match(css, /\.slash-palette\s*\{/);
  assert.match(css, /\.slash-command\.is-active\s*\{/);
  assert.match(i18nScript, /'slash\.empty'/);
  assert.match(i18nScript, /'slash\.unsupported'/);
});

test('webview reduces decorative motion when requested', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.message-spinner,\s*\.cursor\s*\{[^}]*animation:\s*none;/s);
});

test('preview webview streams markdown with real line breaks', () => {
  const script = readFileSync(new URL('../scripts/preview-webview.mjs', import.meta.url), 'utf8');

  assert.match(script, /\.join\('\\\\n'\)/);
  assert.doesNotMatch(script, /\.join\('\\\\\\\\n'\)/);
  assert.match(script, /'\\\\u001b\[0m'/);
  assert.doesNotMatch(script, /'\\\\\\\\u001b\[0m'/);
});

test('webview disables freeform send until the prompt has text', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /const hasPrompt = input\.value\.trim\(\)\.length > 0;/);
  assert.match(script, /const canRunAction = hasPrompt \|\| selectedAction !== 'freeform';/);
  assert.match(script, /sendBtn\.disabled = !canSend \|\| busy \|\| !canRunAction \|\| missingSelection;/);
});

test('agent mode select is persisted per provider', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /activeAgentModeByProvider/);
  assert.match(script, /agentModeSelect\.addEventListener\('change'/);
  assert.match(script, /agentMode: preferredWorkflowMode \|\| activeAgentModeId\(activeId\)/);
  assert.doesNotMatch(script, /opencode'\s*\?\s*'build'/);
});

test('webview front-end explains and blocks selection-only actions without selection', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function actionRequiresSelection\(action\)/);
  assert.match(script, /function hasSelectionContext\(\)/);
  assert.match(script, /actionRequiresSelection\(selectedAction\) && !hasSelectionContext\(\)/);
  assert.match(script, /quick\.missingSelection/);
});

test('webview confirms deleting conversation history', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /window\.confirm\(i18n\.t\('history\.deleteConfirm'\)\)/);
});

test('webview does not add noisy success system message after every run', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /Number\(message\.exitCode\) !== 0/);
  assert.doesNotMatch(script, /const text = Number\(message\.exitCode\) === 0/);
});

test('webview context chip renders a live context summary', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function renderContextChipText\(\)/);
  assert.match(script, /contextSummaryLabel\.textContent = renderContextChipText\(\);/);
});

test('webview visually distinguishes disabled suggested actions', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.suggestion-button:disabled/);
  assert.match(css, /cursor: not-allowed/);
});

test('normalizeCliOutput strips ANSI terminal control codes', () => {
  assert.equal(normalizeCliOutput('\u001b[0m> Sisyphus\u001b[0m\r\n'), '> Sisyphus\n');
});

test('normalizeCliOutput strips orphan ANSI fragments left by chunk splits', () => {
  assert.equal(normalizeCliOutput('[0m\n> Sisyphus - Ultraworker\n[0m'), '\n> Sisyphus - Ultraworker\n');
});

test('normalizeCliOutput condenses Codex JSON errors into a readable message', () => {
  assert.equal(
    normalizeCliOutput(
      'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Upgrade Codex first."}}\n',
      'codex'
    ),
    'Error: Upgrade Codex first.\n'
  );
});

test('normalizeCliOutput hides Codex internal telemetry and challenge noise', () => {
  assert.equal(
    normalizeCliOutput('2026-04-29T10:23:36.865183Z  WARN codex_analytics::client: events failed\n', 'codex'),
    ''
  );
  assert.equal(
    normalizeCliOutput('<html><script>window._cf_chl_opt = {}</script></html>', 'codex'),
    ''
  );
});

test('normalizeCliOutput removes an echoed internal assistant prompt before display', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'exec',
      label: 'Exec',
      instruction: 'Implement scoped changes.',
    },
    action: 'explainSelection',
    message: '解释选中的代码。',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      diagnostics: [],
    },
  });

  assert.equal(normalizeCliOutput(prompt), '');
  assert.equal(normalizeCliOutput(`${prompt}\n\n## 结果\n真实回答`), '## 结果\n真实回答');
});

test('normalizeCliOutput preserves incomplete prompt chunks for the webview stream buffer', () => {
  assert.equal(
    normalizeCliOutput('You are an AI coding assistant embedded in VS Code.\nProvider: Codex CLI'),
    'You are an AI coding assistant embedded in VS Code.\nProvider: Codex CLI'
  );
});

test('selection-only actions are known before starting a CLI process', () => {
  assert.equal(actionRequiresSelection('explainSelection'), true);
  assert.equal(actionRequiresSelection('refactorSelection'), true);
  assert.equal(actionRequiresSelection('reviewFile'), false);
  assert.equal(actionRequiresSelection('generateTests'), false);
  assert.equal(actionRequiresSelection('freeform'), false);
});

test('current-file actions are known before starting a CLI process', () => {
  assert.equal(actionRequiresActiveFile('reviewFile'), true);
  assert.equal(actionRequiresActiveFile('explainSelection'), false);
  assert.equal(actionRequiresActiveFile('generateTests'), false);
  assert.equal(actionRequiresActiveFile('freeform'), false);
});

test('sidebar blocks selection-only actions before building a CLI prompt', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /actionRequiresSelection\(action\) && !snapshot\.selection/);
  assert.match(source, /error\.missingSelection/);
});

test('sidebar blocks current-file actions before building a CLI prompt', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /actionRequiresActiveFile\(action\) && !snapshot\.activeFile/);
  assert.match(source, /error\.missingActiveFile/);
});

test('editor explain action prefers provider read-only mode', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /agentMode: action === 'explainSelection' \? preferredReadOnlyMode\(profile\) : undefined/);
  assert.match(source, /item\.id === 'plan'/);
  assert.match(source, /item\.id === 'suggest'/);
});

test('context collector keeps the last active editor when the sidebar has focus', async () => {
  const workspaceFolder = {
    name: 'agents-hub',
    uri: { fsPath: '/repo/agents-hub' },
  };
  const editor = {
    document: {
      uri: { fsPath: '/repo/agents-hub/src/current.ts' },
      languageId: 'typescript',
      lineCount: 1,
      getText: () => 'export const current = true;',
    },
    selection: {
      isEmpty: true,
    },
  };
  const fakeVscode = createFakeVscode(workspaceFolder, editor);
  const { AssistantContextCollector } = loadContextCollectorWithVscode(fakeVscode);
  const collector = new AssistantContextCollector();

  fakeVscode.window.activeTextEditor = undefined;
  fakeVscode.emitActiveTextEditor(undefined);

  const snapshot = await collector.collect({
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  });

  assert.equal(snapshot.workspace?.name, 'agents-hub');
  assert.equal(snapshot.activeFile?.relativePath, 'src/current.ts');
  assert.equal(snapshot.activeFile?.text, 'export const current = true;');
});

function createFakeVscode(workspaceFolder, activeTextEditor) {
  let activeTextEditorListener = () => {};

  return {
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    window: {
      activeTextEditor,
      onDidChangeActiveTextEditor(listener) {
        activeTextEditorListener = listener;
        return { dispose() {} };
      },
    },
    workspace: {
      workspaceFolders: [workspaceFolder],
      getWorkspaceFolder(uri) {
        return uri.fsPath.startsWith(workspaceFolder.uri.fsPath) ? workspaceFolder : undefined;
      },
    },
    languages: {
      getDiagnostics: () => [],
    },
    emitActiveTextEditor(editor) {
      activeTextEditorListener(editor);
    },
  };
}

function loadContextCollectorWithVscode(fakeVscode) {
  const previousLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return fakeVscode;
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('../.test-dist/contextCollector.js')];
    return require('../.test-dist/contextCollector.js');
  } finally {
    Module._load = previousLoad;
  }
}
