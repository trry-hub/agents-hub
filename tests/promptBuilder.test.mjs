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
const {
  buildCliOptionArgs,
  getCliProfile,
  getCliModelOption,
  getCliPermissionMode,
  getCliRuntimeMode,
} = require('../.test-dist/cliProfiles.js');
const {
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} = require('../.test-dist/outputFormatter.js');
const {
  actionRequiresActiveFile,
  actionRequiresSelection,
} = require('../.test-dist/actionGuards.js');
const {
  getLoginShellLookupArgs,
  normalizeCommandPathOutput,
  shellQuote,
} = require('../.test-dist/cliPathResolver.js');
const { getProviderExtensionBridge } = require('../.test-dist/providerExtensions.js');
const {
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeConfigAgents,
  parseOpenCodeAgentListOutput,
  parseOpenCodeModelsOutput,
} = require('../.test-dist/opencodeAgents.js');

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
  assert.match(prompt, /If the request involves code changes, include a compact delivery checklist:/);
  assert.match(prompt, /Files changed: list each file path and the exact change/);
});

test('buildAssistantPrompt requires delivery checklist for OpenCode freeform prompts', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '我想重构这个登录流程。',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Verification: commands or checks that confirm the change is correct/);
  assert.match(prompt, /Risks and caveats: call out assumptions, follow-up work, and edge cases/);
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

test('buildAssistantPrompt includes pasted image attachment file paths', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'build',
      label: 'Build',
      instruction: 'Implement changes.',
    },
    action: 'freeform',
    message: 'What is wrong in this screenshot?',
    attachments: [
      {
        kind: 'image',
        name: 'error-screen.png',
        mimeType: 'image/png',
        size: 2048,
        path: '/tmp/agents-hub/error-screen.png',
      },
    ],
    context: {
      diagnostics: [],
    },
  });

  assert.match(prompt, /Attached images:/);
  assert.match(prompt, /error-screen\.png \(image\/png, 2 KB\): \/tmp\/agents-hub\/error-screen\.png/);
  assert.match(prompt, /Use these local image paths when the selected provider can inspect image files/);
});

test('buildAssistantPrompt keeps OpenCode freeform chat raw when no IDE context is attached', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '你能干什么',
    context: {
      diagnostics: [],
    },
  });

  assert.equal(prompt, '你能干什么');
  assert.doesNotMatch(prompt, /You are an AI coding assistant embedded in VS Code/);
  assert.doesNotMatch(prompt, /No IDE context was attached/);
});

test('buildAssistantPrompt gives OpenCode workspace context even without an active editor', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'Sisyphus - Ultraworker',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use the configured primary agent.',
    },
    action: 'freeform',
    message: '这个项目是什么',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/Users/t/6bt/myproject/agents-hub',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /^这个项目是什么/);
  assert.match(prompt, /IDE context, use only if relevant:/);
  assert.match(prompt, /Workspace: agents-hub/);
  assert.match(prompt, /Workspace root: \/Users\/t\/6bt\/myproject\/agents-hub/);
  assert.doesNotMatch(prompt, /Provider agent\/mode/);
  assert.doesNotMatch(prompt, /No IDE context was attached/);
});

test('buildAssistantPrompt gives OpenCode recent conversation for follow-up questions', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'Sisyphus - Ultraworker',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use the configured primary agent.',
    },
    action: 'freeform',
    message: '我说的是已经聊过的内容',
    conversationHistory: [
      { role: 'user', text: '我本地装了几个 cli 呢' },
      { role: 'assistant', text: '你本地目前装了 3 个本插件支持的 CLI：gemini、codex、opencode。' },
    ],
    context: {
      diagnostics: [],
    },
  });

  assert.match(prompt, /^我说的是已经聊过的内容/);
  assert.match(prompt, /Recent conversation in this thread:/);
  assert.match(prompt, /User: 我本地装了几个 cli 呢/);
  assert.match(prompt, /Assistant: 你本地目前装了 3 个本插件支持的 CLI/);
  assert.doesNotMatch(prompt, /IDE context, use only if relevant:/);
});

test('buildAssistantPrompt gives OpenCode freeform only compact context when context exists', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '解释一下这里',
    context: {
      workspace: {
        name: 'agents-hub',
        rootPath: '/repo/agents-hub',
      },
      activeFile: {
        relativePath: 'src/example.ts',
        languageId: 'typescript',
        lineCount: 1,
        text: 'export const ok = true;',
        truncated: false,
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /^解释一下这里/);
  assert.match(prompt, /IDE context, use only if relevant:/);
  assert.match(prompt, /src\/example\.ts/);
  assert.match(prompt, /Do not inspect the project unless the request needs it/);
  assert.doesNotMatch(prompt, /Provider agent\/mode/);
});

test('runtime localization resolves Simplified Chinese editor action text', () => {
  const locale = resolveRuntimeLocale('zh-cn');

  assert.equal(locale, 'zh-CN');
  assert.equal(runtimeDefaultActionText(locale, 'explainSelection'), '解释选中的代码。');
});

test('opencode profile uses run command with prompt as argument', () => {
  const profile = getCliProfile('opencode');

  assert.equal(profile.command, 'opencode');
  assert.deepEqual(profile.promptArgs, ['run', '--format', 'json', '--thinking']);
  assert.deepEqual(profile.backgroundServer?.args, [
    'serve',
    '--hostname',
    '127.0.0.1',
    '--port',
    '{port}',
  ]);
  assert.deepEqual(profile.backgroundServer?.attachArgs, [
    '--attach',
    'http://127.0.0.1:{port}',
  ]);
  assert.equal(profile.backgroundServer?.url, 'http://127.0.0.1:{port}');
  assert.deepEqual(profile.backgroundServer?.portRange, { start: 46100, size: 200 });
  assert.equal(profile.env?.OPENCODE_DB, '{tmp}/agents-hub-opencode-{cwdHash}.db');
  assert.equal(profile.env?.OMO_DISABLE_POSTHOG, '1');
  assert.equal(profile.env?.OMO_SEND_ANONYMOUS_TELEMETRY, '0');
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultModel, 'configured');
  assert.equal(profile.defaultAgentMode, 'configured');
  assert.equal(profile.modelOptions.find((option) => option.id === 'default'), undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'default'), undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'configured').args, undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan'), undefined);
});

test('opencode agent list output is parsed into provider-native agent modes', () => {
  const modes = parseOpenCodeAgentListOutput(
    [
      'build (subagent)',
      '  [',
      '    {"permission":"*","action":"allow"}',
      '  ]',
      'plan (subagent)',
      '\u200bSisyphus - Ultraworker (primary)',
      'summary (primary)',
      'title (primary)',
      'compaction (primary)',
    ].join('\n')
  );

  assert.deepEqual(
    modes.map((mode) => [mode.id, mode.label, mode.args, mode.disabled]),
    [
      ['\u200bSisyphus - Ultraworker', 'Sisyphus - Ultraworker', ['--agent', '\u200bSisyphus - Ultraworker'], undefined],
    ]
  );
});

test('opencode models output is parsed into provider-native model options', () => {
  const options = parseOpenCodeModelsOutput(
    [
      'opencode/big-pickle',
      'mimo/mimo-v2.5-pro',
      'mimo/mimo-v2.5-pro',
      'not a model line',
    ].join('\n')
  );

  assert.deepEqual(
    options.map((option) => [option.id, option.label, option.summaryLabel, option.args]),
    [
      ['opencode/big-pickle', 'opencode/big-pickle', 'big-pickle', ['--model', 'opencode/big-pickle']],
      ['mimo/mimo-v2.5-pro', 'mimo/mimo-v2.5-pro', 'mimo-v2.5-pro', ['--model', 'mimo/mimo-v2.5-pro']],
    ]
  );
});

test('opencode server config exposes current primary and custom agents', () => {
  const discovery = parseOpenCodeConfigAgents({
    model: 'opencode/big-pickle',
    default_agent: '\u200bSisyphus - Ultraworker',
    agent: {
      build: { mode: 'subagent', description: 'Implementation helper' },
      plan: { mode: 'subagent' },
      '\u200bSisyphus - Ultraworker': {
        mode: 'primary',
        description: 'Powerful AI orchestrator with a very long description that should be truncated before it reaches the UI title and makes the composer awkward to inspect.',
      },
    },
  });

  assert.equal(discovery.defaultAgentId, '\u200bSisyphus - Ultraworker');
  assert.equal(discovery.defaultModelId, 'opencode/big-pickle');
  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.label, mode.disabled, mode.args]),
    [
      [
        '\u200bSisyphus - Ultraworker',
        'Sisyphus - Ultraworker',
        undefined,
        ['--agent', '\u200bSisyphus - Ultraworker'],
      ],
    ]
  );
});

test('opencode debug config text exposes default agent without parsing full prompts', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "\\u200bSisyphus - Ultraworker",',
      '  "agent": {',
      '    "build": {',
      '      "description": "Implementation helper",',
      '      "mode": "subagent",',
      '      "prompt": "very long text with { braces }"',
      '    },',
      '    "\\u200bSisyphus - Ultraworker": {',
      '      "description": "Powerful AI orchestrator",',
      '      "mode": "primary",',
      '      "model": "mimo/mimo-v2.5-pro",',
      '      "prompt": "unfinished long prompt',
      '    }',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultAgentId, '\u200bSisyphus - Ultraworker');
  assert.equal(discovery.defaultModelId, 'mimo/mimo-v2.5-pro');
  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.disabled, mode.args]),
    [
      ['\u200bSisyphus - Ultraworker', undefined, ['--agent', '\u200bSisyphus - Ultraworker']],
    ]
  );
});

test('cli manager warms and attaches background CLI servers when available', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /getOpenCodeAgentModes/);
  assert.match(source, /\['debug', 'config'\]/);
  assert.match(source, /opencode-agent-list/);
  assert.match(source, /getOpenCodeModelOptions/);
  assert.match(source, /\['models'\]/);
  assert.match(source, /opencode-models/);
  assert.match(source, /preferredOpenCodeDefaultModel/);
  assert.match(source, /option\.id !== 'default' && option\.id !== 'configured'/);
  assert.match(source, /private backgroundServers = new Map/);
  assert.match(source, /const backgroundAttachArgs = await this\.getBackgroundAttachArgs/);
  assert.match(
    source,
    /\[\.\.\.profile\.promptArgs,\s*\.\.\.backgroundAttachArgs,\s*\.\.\.agentArgs,\s*initialInput\]/s
  );
  assert.match(source, /resolveBackgroundServerCandidates/);
  assert.match(source, /expandBackgroundServerArg/);
  assert.match(source, /expandProfileEnv/);
  assert.match(source, /os\.tmpdir\(\)/);
  assert.match(source, /getOpenCodeEventStreamUrl/);
  assert.match(source, /openOpenCodeEventStream/);
  assert.match(source, /new URL\('\/event', serverUrl\)/);
  assert.match(source, /message\.part\.delta/);
  assert.match(source, /line\.startsWith\('event:'\)/);
  assert.match(source, /partTypes\.set\(partId, partType\)/);
  assert.match(source, /partType === 'tool'/);
  assert.match(source, /eventStream\?\.hasOutput\(\)/);
  assert.match(source, /backgroundServerPorts/);
  assert.match(source, /ownedProcess && await this\.waitForTcp/);
  assert.match(source, /!ownedProcess && await this\.waitForTcp/);
  assert.match(source, /continue;/);
  assert.match(source, /stableHash\(`\$\{profileId\}:\$\{cwd\}`\)/);
  assert.match(source, /private async waitForTcp/);
  assert.match(source, /private stopBackgroundServers/);
  assert.match(sidebarSource, /const newSession = await this\.cliManager\.startPrompt/);
  assert.match(sidebarSource, /this\.cliManager\.stopAll\(\);/);
});

test('headless stdin prompts close stdin unless a profile opts into a persistent session', () => {
  const managerSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(
    managerSource,
    /sendInput\(sessionId:\s*string,\s*text:\s*string,\s*closeAfterWrite = false\)/
  );
  assert.match(managerSource, /session\.process\.stdin\.end\(\);/);
  assert.match(sidebarSource, /session\.profile\.keepStdinOpen === true/);
  assert.match(sidebarSource, /sendInput\(session\.id,\s*prompt,\s*!profile\.keepStdinOpen\)/);
});

test('codex profile passes prompt as argument and disables color output', () => {
  const profile = getCliProfile('codex');

  assert.equal(profile.command, 'codex');
  assert.deepEqual(profile.promptArgs, ['-a', 'never', 'exec', '--color', 'never', '--ephemeral']);
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultAgentMode, 'build');
  assert.equal(profile.agentModes.find((mode) => mode.id === 'build').args, undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan').args, undefined);
  assert.deepEqual(profile.modelOptions.find((mode) => mode.id === 'gpt-5.5').args, ['--model', 'gpt-5.5']);
  assert.equal(profile.defaultPermissionMode, 'workspaceWrite');
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'readOnly').args, [
    '--sandbox',
    'read-only',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'workspaceWrite').args, [
    '--sandbox',
    'workspace-write',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'fullAuto').args, ['--full-auto']);
  assert.equal(profile.permissionModes.find((mode) => mode.id === 'danger').dangerous, true);
});

test('claude profile exposes native permission modes', () => {
  const profile = getCliProfile('claude');

  assert.equal(profile.inputMode, 'argument');
  assert.deepEqual(profile.promptArgs, [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'plan').args, [
    '--permission-mode',
    'plan',
  ]);
  assert.ok(profile.permissionModes.some((mode) => mode.id === 'acceptEdits'));
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan').args, undefined);
});

test('gemini profile passes prompt as the -p argument for headless mode', () => {
  const profile = getCliProfile('gemini');

  assert.equal(profile.command, 'gemini');
  assert.deepEqual(profile.promptArgs, ['-p']);
  assert.equal(profile.inputMode, 'argument');
});

test('CLI profiles expose provider model, runtime, and permission option args', () => {
  const codex = getCliProfile('codex');

  assert.equal(codex.defaultModel, 'gpt-5.4');
  assert.equal(codex.modelOptions.find((option) => option.id === 'default'), undefined);
  assert.equal(codex.customModelArgPrefix.join(' '), '--model');
  assert.deepEqual(getCliModelOption(codex, 'gpt-5.4').args, ['--model', 'gpt-5.4']);
  assert.deepEqual(getCliModelOption(codex, 'custom').args, undefined);
  assert.equal(codex.defaultRuntime, 'localProcessing');
  assert.equal(getCliRuntimeMode(codex, 'localProcessing').summaryLabel, 'Local mode');
  assert.equal(getCliRuntimeMode(codex, 'sendCloud').id, 'localProcessing');
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'codexWeb').external, true);
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'sendCloud').disabled, true);
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'quota').actionOnly, true);
  assert.deepEqual(getCliPermissionMode(codex, 'readOnly').args, ['--sandbox', 'read-only']);
  assert.deepEqual(
    buildCliOptionArgs(codex, {
      model: 'gpt-5.4',
      runtime: 'localProcessing',
      permissionMode: 'workspaceWrite',
    }),
    ['--model', 'gpt-5.4', '--sandbox', 'workspace-write']
  );
  assert.deepEqual(
    buildCliOptionArgs(codex, {
      model: 'custom',
      customModel: 'qwen2.5-coder:14b',
      runtime: 'sendCloud',
      permissionMode: 'readOnly',
    }),
    ['--model', 'qwen2.5-coder:14b', '--sandbox', 'read-only']
  );
});

test('CLI profiles expose task routing scores for agent recommendations', () => {
  assert.ok(getCliProfile('codex').taskRouting.implementation >= 6);
  assert.ok(getCliProfile('codex').taskRouting.review >= 6);
  assert.ok(getCliProfile('claude').taskRouting.planning >= 6);
  assert.ok(getCliProfile('claude').taskRouting.refactor >= 6);
  assert.ok(getCliProfile('aider').taskRouting.tests >= 5);
  assert.equal(getCliProfile('gemini').taskRouting.explain, 5);
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

test('CLI manager revalidates cached command paths before spawning', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /const command = await this\.resolveCommandPath\(profile\.command\) \?\? profile\.command/);
  assert.doesNotMatch(source, /this\.commandPathCache\.get\(profile\.command\) \?\? profile\.command/);
});

test('CLI manager evicts stale command path cache entries', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /private async isUsableCommandPath/);
  assert.match(source, /fs\.promises\.access\(commandPath, fs\.constants\.X_OK\)/);
  assert.match(source, /this\.commandPathCache\.delete\(command\)/);
  assert.match(source, /err\.code === 'ENOENT'/);
  assert.match(source, /this\.commandPathCache\.delete\(profile\.command\)/);
});

test('CLI profiles include detected agent version status', () => {
  const profilesSource = readFileSync(new URL('../src/cliProfiles.ts', import.meta.url), 'utf8');
  const managerSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(profilesSource, /versionArgs\?: string\[\]/);
  assert.match(profilesSource, /version\?: string/);
  assert.match(profilesSource, /contextWindowTokens\?: number/);
  assert.match(profilesSource, /autoCompactsContext\?: boolean/);
  assert.match(profilesSource, /tokenizer\?: CliTokenizerConfig/);
  assert.match(profilesSource, /modelOptions\?: CliModelOption\[\]/);
  assert.match(profilesSource, /runtimeModes\?: CliRuntimeMode\[\]/);
  assert.match(profilesSource, /permissionModes\?: CliPermissionMode\[\]/);
  assert.match(profilesSource, /provider: 'openai'/);
  assert.match(profilesSource, /provider: 'anthropic'/);
  assert.match(managerSource, /version: installed \? await this\.getCommandVersion\(p\) : undefined/);
  assert.match(managerSource, /private getCommandVersion\(profile: CliProfile\)/);
  assert.match(managerSource, /profile\.versionArgs \?\? \['--version'\]/);
  assert.match(managerSource, /normalizeCommandVersionOutput/);
});

test('context summary carries provider-specific token usage without fallback estimates', () => {
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');
  const collectorSource = readFileSync(new URL('../src/contextCollector.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const counterSource = readFileSync(new URL('../src/tokenCounter.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /tokenUsage\?: AssistantTokenUsage/);
  assert.doesNotMatch(collectorSource, /estimateContextTokens/);
  assert.match(sidebarSource, /tokenUsage: countContextTokens\(snapshot, profile\)/);
  assert.match(counterSource, /encodingForModel|getEncoding/);
  assert.match(counterSource, /countAnthropicTokens/);
  assert.match(counterSource, /precision: 'exact'/);
  assert.match(counterSource, /precision: 'unavailable'/);
  assert.doesNotMatch(counterSource, /Math\.ceil\(characters \/ 4\)/);
});

test('extension contributes reload window command for debugging', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commands = manifest.contributes.commands.map((command) => command.command);

  assert.ok(manifest.activationEvents.includes('onCommand:agentsHub.reloadWindow'));
  assert.ok(commands.includes('agentsHub.reloadWindow'));
});

test('extension defaults to OpenCode as the active provider', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const previewSource = readFileSync(new URL('../scripts/preview-webview.mjs', import.meta.url), 'utf8');
  const defaultProvider = manifest.contributes.configuration.properties['agentsHub.defaultProvider'];

  assert.equal(defaultProvider.default, 'opencode');
  assert.ok(defaultProvider.enum.includes('opencode'));
  assert.match(sidebarSource, /const DEFAULT_CLI_ID = 'opencode';/);
  assert.match(sidebarSource, /get<string>\('defaultProvider', DEFAULT_CLI_ID\)/);
  assert.match(sidebarSource, /getCliProfile\(DEFAULT_CLI_ID\)\?\.id/);
  assert.match(previewSource, /defaultProviderId: 'opencode'/);
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

test('product document positions Agents Hub beyond a provider launcher', () => {
  const doc = readFileSync(new URL('../docs/product/agents-workbench.md', import.meta.url), 'utf8');

  assert.match(doc, /multi-agent workbench/i);
  assert.match(doc, /multi-task/i);
  assert.match(doc, /visual task/i);
  assert.match(doc, /not compete with Copilot on inline completion/i);
  assert.match(doc, /Task-aware routing/);
  assert.match(doc, /Immediate Development Priorities/);
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

  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="runtimeSelect"/);
  assert.match(html, /id="permissionSelect"/);
  assert.match(html, /id="customModelInput"/);
  assert.match(html, /class="mode-menu"/);
  assert.match(html, /class="mode-popover option-popover-single"/);
  assert.match(html, /id="agentModeSummaryLabel"/);
  assert.match(html, /class="select-field agent-select native-option-field"/);
  assert.match(html, /id="agentModeSelect"/);
  assert.match(html, /id="agentModeOptionList"/);
  assert.match(html, /id="actionSelect"[^>]*hidden/);
  assert.doesNotMatch(html, /class="advanced-menu"/);
  assert.doesNotMatch(html, /data-i18n="advanced\.short"/);
});

test('webview keeps local remote runtime outside the prompt input shell', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const promptShellStart = html.indexOf('<div class="prompt-shell">');
  const composerRuntimeStart = html.indexOf('<div class="composer-runtime"');

  assert.ok(promptShellStart >= 0);
  assert.ok(composerRuntimeStart > promptShellStart);
  assert.doesNotMatch(html.slice(promptShellStart, composerRuntimeStart), /runtimeSelect|runtime-menu/);
  assert.match(html.slice(composerRuntimeStart), /class="option-menu runtime-menu"/);
  assert.match(css, /\.composer-runtime\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.composer-runtime \.runtime-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
});

test('webview includes an advanced controls toggle for composer settings', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(html, /id="composerAdvancedToggle"/);
  assert.match(html, /data-i18n-title="composer\.advanced"/);
  assert.match(script, /let composerAdvancedVisible = Boolean\(saved\.composerAdvanced\);/);
  assert.match(script, /composerShell\.dataset\.advanced = composerAdvancedVisible \? 'true' : 'false';/);
  assert.match(script, /function applyComposerAdvancedState\(\)/);
  assert.match(script, /function setComposerAdvancedVisible\(next\)/);
  assert.match(script, /composerAdvancedToggle\?\.addEventListener\('click',/);
  assert.match(script, /setComposerAdvancedVisible\(true\);/);
  assert.match(css, /\.advanced-toggle\s*\{/s);
  assert.match(css, /\.prompt-shell\[data-advanced="false"\] \.option-menu,/s);
  assert.match(css, /\.suggestion-button--primary\s*\{/s);
  assert.match(i18nScript, /'composer\.advanced': 'Advanced'/);
  assert.match(i18nScript, /'composer\.advancedHide': 'Hide advanced'/);

  assert.match(script, /appendEmptyState\(titleText, subtitleText, showSetupAction = false\)/);
  assert.match(script, /const suggestionActions = showSetupAction[\s\S]*'openSettings', 'empty\.configureProviders'/);
  assert.match(script, /'openSettings'/);
  assert.match(script, /button\.classList\.add\('suggestion-button--primary'\)/);
  assert.match(sidebarSource, /case 'openSettings':/);
  assert.match(extensionSource, /agentsHub\.openSettings/);
  assert.match(i18nScript, /'empty\.configureProviders': 'Open provider settings'/);
  assert.match(i18nScript, /'empty\.configureProviders': '前往设置配置提供方'/);
});

test('webview renders the Codex local mode menu like Code X', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="runtimeOptionList"[^>]*role="menu"/);
  assert.match(script, /const runtimeOptionList = document\.getElementById\('runtimeOptionList'\);/);
  assert.match(script, /function renderRuntimeOptionList\(options, selectedId\)/);
  assert.match(script, /i18n\.t\('runtime\.continue'\)/);
  assert.match(script, /displayRuntime\.summaryLabel \|\| displayRuntime\.label/);
  assert.match(script, /function selectableOption\(option\)/);
  assert.match(script, /return !option\?\.disabled && !option\?\.actionOnly;/);
  assert.match(css, /\.runtime-option-list\s*\{/);
  assert.match(css, /\.runtime-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.option-list-item-trailing\s*\{/);
  assert.match(i18nScript, /'runtime\.continue': '继续使用'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing': '在本地处理'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing\.summary': '本地模式'/);
  assert.match(i18nScript, /'option\.runtime\.codexWeb': '关联 Codex web'/);
  assert.match(i18nScript, /'option\.runtime\.sendCloud': '发送至云端'/);
  assert.match(i18nScript, /'option\.runtime\.quota': '剩余额度'/);
  assert.doesNotMatch(i18nScript, /localOllama|localLmStudio/);
});

test('webview renders model selection as a single-layer menu', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(html, /class="select-field agent-select native-option-field"[\s\S]*id="modelSelect"/);
  assert.match(html, /id="modelOptionList"[^>]*role="menu"/);
  assert.match(script, /const modelOptionList = document\.getElementById\('modelOptionList'\);/);
  assert.match(script, /function renderModelOptionList\(options, selectedId\)/);
  assert.match(script, /function renderAgentModeOptionList\(modes, selectedId\)/);
  assert.match(script, /'model-option-item'/);
  assert.match(script, /'mode-option-item'/);
  assert.match(script, /check\.className = 'model-option-check';/);
  assert.match(script, /renderModelOptionList\(options, model\.id\);/);
  assert.match(script, /renderAgentModeOptionList\(modes, agentModeSelect\.value\);/);
  assert.match(script, /modelOptionList\?\.addEventListener\('click'/);
  assert.match(script, /agentModeOptionList\?\.addEventListener\('click'/);
  assert.match(script, /activeModelByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /activeAgentModeByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /modelMenu\.open = false;/);
  assert.match(script, /modeMenu\.open = false;/);
  assert.match(script, /if \(option\?\.custom\) \{/);
  assert.match(css, /\.model-option-list\s*\{/);
  assert.match(html, /id="agentModeOptionList"[^>]*role="menu"/);
  assert.match(css, /\.mode-option-list\s*\{/);
  assert.match(css, /\.model-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.mode-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.model-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.mode-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.model-option-list \.option-list-item:hover,\s*\.model-option-list \.option-list-item:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--assistant-hover\) 72%, transparent\);/s);
  assert.match(css, /\.mode-option-list \.option-list-item:hover,\s*\.mode-option-list \.option-list-item:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--assistant-hover\) 72%, transparent\);/s);
  assert.match(css, /\.model-option-item\.is-selected \.model-option-check\s*\{/);
  assert.match(css, /\.mode-option-item\.is-selected \.mode-option-marker\s*\{/);
  assert.match(css, /\.model-menu \.custom-model-field\s*\{/);
});

test('webview composer follows the selected provider identity', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /document\.body\.dataset\.provider = activeId \|\| 'none';/);
  assert.match(script, /agentModeSummaryLabel\.textContent = displayMode\?\.label \|\| i18n\.t\('agentMode\.short'\);/);
  assert.match(script, /displayModel\.summaryLabel \|\| displayModel\.label \|\| i18n\.t\('model\.short'\)/);
  assert.match(script, /selectedAction === 'freeform' \? 'input\.placeholderProvider' : 'input\.placeholderAction'/);
  assert.match(i18nScript, /'input\.placeholderProvider': 'Ask \{provider\}…'/);
  assert.match(i18nScript, /'input\.placeholderProvider': '向 \{provider\} 发送任务\.\.\.'/);
  assert.match(css, /body\[data-provider="codex"\] \.mode-summary/);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-shell/);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu\.is-visible,\s*body\[data-provider="opencode"\] \.mode-menu\.is-visible/s);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu \.option-summary::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-actions\s*\{\s*[^}]*border-top:/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button\s*\{[^}]*var\(--assistant-accent, #a855f7\)/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button:disabled\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button:disabled svg\s*\{[^}]*stroke-width:\s*2;/s);
});

test('webview composer uses compact Code X style controls', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*padding:\s*12px;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*border-radius:\s*18px;/s);
  assert.match(css, /\.option-summary,\s*\.mode-summary,\s*\.context-summary\s*\{\s*[^}]*border:\s*1px solid transparent;/s);
  assert.match(css, /\.option-summary,\s*\.mode-summary,\s*\.context-summary\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.permission-menu \.option-summary::before\s*\{/);
  assert.match(css, /\.model-menu \.option-summary::before\s*\{/);
  assert.match(css, /\.send-button,\s*\.stop-button\s*\{\s*[^}]*border-radius:\s*999px;/s);
  assert.match(css, /\.send-button\s*\{\s*[^}]*background:\s*color-mix\(in srgb, var\(--vscode-foreground, #1f1f1f\) 92%, transparent\);/s);
  assert.match(css, /\.stop-button\s*\{\s*[^}]*color:\s*var\(--vscode-errorForeground, #c00\);/s);
  assert.match(css, /\.stop-button\s*\{\s*[^}]*background:\s*color-mix\(in srgb, var\(--assistant-panel\) 64%, transparent\);/s);
  assert.match(css, /\.composer-runtime \.option-summary\s*\{\s*[^}]*border-color:\s*transparent;/s);
  assert.match(css, /\.composer-runtime \.option-summary::before\s*\{\s*[^}]*border:\s*1px solid currentColor;/s);
});

test('webview renders a Codex style composer when Codex is selected', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /class="codex-terminal-banner"/);
  assert.match(html, /id="codexTerminalStop"/);
  assert.match(html, /id="codexTerminalOpen"/);
  assert.match(script, /const codexTerminalBanner = document\.getElementById\('codexTerminalBanner'\);/);
  assert.match(script, /const codexTerminalOpen = document\.getElementById\('codexTerminalOpen'\);/);
  assert.match(script, /function renderCodexTerminalBanner\(\)/);
  assert.match(script, /const codexRunning = Boolean\(runningByProvider\.codex\);/);
  assert.match(script, /const taskBoardVisible = visibleTasksForBoard\(\)\.length > 0;/);
  assert.match(script, /codexTerminalBanner\.hidden = activeId !== 'codex' \|\| !codexRunning \|\| taskBoardVisible;/);
  assert.match(script, /codexTerminalStop\.addEventListener\('click'/);
  assert.match(script, /codexTerminalOpen\.addEventListener\('click'/);
  assert.match(script, /command: 'openProviderExtension', cliId: activeId/);
  assert.match(i18nScript, /'codex\.terminalRunning': 'Running 1 terminal'/);
  assert.match(i18nScript, /'codex\.terminalRunning': '正在运行 1 个终端'/);
  assert.match(css, /body\[data-provider="codex"\] \.codex-terminal-banner\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-shell\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-shell\s*\{\s*[^}]*border-radius:\s*18px;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-actions\s*\{\s*[^}]*border-top:\s*0;/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu\.is-visible\s*\{\s*[^}]*order:\s*2;/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu \.option-summary\s*\{\s*[^}]*color:\s*var\(--vscode-foreground\);/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu\.is-danger \.option-summary\s*\{\s*[^}]*color:\s*var\(--vscode-inputValidation-warningForeground, #b87500\);/s);
  assert.match(css, /body\[data-provider="codex"\] \.composer-meta\s*\{\s*[^}]*margin-left:\s*auto;/s);
  assert.match(css, /body\[data-provider="codex"\] \.model-menu\.is-visible\s*\{\s*[^}]*order:\s*7;/s);
  assert.match(css, /body\[data-provider="codex"\] \.send-button\s*\{\s*[^}]*background:\s*#8f8f8f;/s);
});

test('provider extension bridges use the corresponding VS Code extension commands', () => {
  assert.deepEqual(getProviderExtensionBridge('codex'), {
    providerId: 'codex',
    extensionId: 'openai.chatgpt',
    displayName: 'Codex',
    openCommands: ['chatgpt.newCodexPanel', 'chatgpt.openSidebar'],
  });
  assert.deepEqual(getProviderExtensionBridge('claude'), {
    providerId: 'claude',
    extensionId: 'anthropic.claude-code',
    displayName: 'Claude Code',
    openCommands: ['claude-vscode.sidebar.open', 'claude-vscode.editor.openLast'],
  });
  assert.deepEqual(getProviderExtensionBridge('opencode'), {
    providerId: 'opencode',
    extensionId: 'sst-dev.opencode',
    displayName: 'OpenCode',
    openCommands: ['opencode.openTerminal'],
  });
  assert.deepEqual(getProviderExtensionBridge('gemini'), {
    providerId: 'gemini',
    extensionId: 'google.gemini-cli-vscode-ide-companion',
    displayName: 'Gemini CLI',
    openCommands: ['gemini-cli.runGeminiCLI'],
  });
  assert.equal(getProviderExtensionBridge('aider'), undefined);
});

test('sidebar opens provider VS Code extensions through a whitelisted bridge', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /case 'openProviderExtension':/);
  assert.match(source, /await this\.openProviderExtension\(this\.resolveCliId\(message\)\);/);
  assert.match(source, /vscodeExtension: this\.getProviderExtensionStatus\(profile\.id\)/);
  assert.match(source, /const bridge = getProviderExtensionBridge\(cliId\);/);
  assert.match(source, /for \(const command of bridge\.openCommands\)/);
  assert.match(source, /await vscode\.commands\.executeCommand\(command\);/);
});

test('webview renders a Claude Code style composer when Claude is selected', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /class="claude-terminal-banner"/);
  assert.match(html, /id="claudeTerminalDismiss"/);
  assert.match(html, /id="claudeContextBtn"/);
  assert.match(html, /class="claude-permission-icon"/);
  assert.match(script, /let claudeTerminalBannerDismissed = Boolean\(saved\.claudeTerminalBannerDismissed\);/);
  assert.match(script, /i18n\.t\('claude\.placeholder'\)/);
  assert.match(script, /i18n\.t\('claude\.permission\.askBeforeEdits'\)/);
  assert.match(script, /claudeContextBtn\.addEventListener\('click'/);
  assert.match(i18nScript, /'claude\.terminalPreference': 'Prefer the Terminal experience\? Switch back in Settings\.'/);
  assert.match(i18nScript, /'claude\.placeholder': '⌘ Esc to focus or unfocus Claude'/);
  assert.match(i18nScript, /'claude\.permission\.askBeforeEdits': 'Ask before edits'/);
  assert.match(css, /body\[data-provider="claude"\] \.claude-terminal-banner\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /body\[data-provider="claude"\] \.prompt-shell\s*\{\s*[^}]*border-color:\s*#d97757;/s);
  assert.match(css, /body\[data-provider="claude"\] \.prompt-shell\s*\{\s*[^}]*border-radius:\s*8px;/s);
  assert.match(css, /body\[data-provider="claude"\] \.composer-meta,\s*body\[data-provider="claude"\] \.model-menu,\s*body\[data-provider="claude"\] \.mode-menu,\s*body\[data-provider="claude"\] \.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /body\[data-provider="claude"\] \.composer-footer\s*\{\s*[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /body\[data-provider="claude"\] \.compact-select,\s*body\[data-provider="claude"\] \.composer-meta/s);
  assert.match(css, /body\[data-provider="claude"\] \.permission-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
  assert.match(css, /body\[data-provider="claude"\] \.claude-permission-icon\s*\{\s*[^}]*display:\s*block;/s);
  assert.match(css, /body\[data-provider="claude"\] \.send-button\s*\{\s*[^}]*border-radius:\s*6px;/s);
});

test('webview supports pasted image attachments in the composer', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="attachmentStrip"/);
  assert.match(html, /id="attachImageBtn"/);
  assert.match(html, /id="imageFileInput"[^>]*accept="image\/\*"/);
  assert.match(script, /let promptAttachments = \[\];/);
  assert.match(script, /input\.addEventListener\('paste'/);
  assert.match(script, /event\.clipboardData\?\.items/);
  assert.match(script, /function addImageFiles/);
  assert.match(script, /new FileReader\(\)/);
  assert.match(script, /const finalAttachments = promptAttachments\.map\(attachmentPayload\);/);
  assert.match(script, /const hasAttachments = promptAttachments\.length > 0;/);
  assert.match(script, /promptAttachments = \[\];/);
  assert.match(css, /\.attachment-strip\s*\{/);
  assert.match(css, /\.attachment-chip img\s*\{/);
  assert.match(css, /\.attach-button\s*\{/);
  assert.match(i18nScript, /'attachment\.add': 'Attach image'/);
  assert.match(i18nScript, /'attachment\.add': '添加图片'/);
});

test('webview renders permissions as a Code X style option menu', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(html, /id="permissionOptionList"[^>]*role="menu"/);
  assert.match(script, /const permissionOptionList = document\.getElementById\('permissionOptionList'\);/);
  assert.match(script, /function renderPermissionOptionList\(options, selectedId\)/);
  assert.match(script, /const visibleOptions = options\.filter\(\(option\) => \(/);
  assert.match(script, /profile\?\.id !== 'codex' \|\| option\.id !== 'readOnly' \|\| option\.id === selectedId/);
  assert.match(script, /'permission-option-item'/);
  assert.match(script, /icon\.className = 'permission-option-icon';/);
  assert.match(script, /check\.className = 'permission-option-check';/);
  assert.match(script, /permissionOptionList\.addEventListener\('click'/);
  assert.match(script, /activePermissionByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /permissionMenu\.open = false;/);
  assert.match(css, /\.permission-option-list\s*\{/);
  assert.match(css, /\.permission-option-list \.option-list-item\s*\{\s*[^}]*grid-template-columns:\s*14px minmax\(0,\s*1fr\) 12px;/s);
  assert.match(css, /\.permission-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.permission-option-item\.is-selected \.permission-option-check\s*\{/);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu \.option-summary/);
});

test('webview provider selector reserves space for the selected CLI name', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.composer-provider-dock \.compact-select\s*\{\s*[^}]*min-width:\s*76px;/s);
  assert.match(css, /\.composer-provider-dock \.compact-select\s*\{\s*[^}]*max-width:\s*116px;/s);
  assert.match(css, /\.composer-provider-dock \.compact-select select\s*\{\s*[^}]*min-width:\s*0;/s);
  assert.match(css, /\.composer-provider-dock \.compact-select select\s*\{\s*[^}]*flex:\s*1 1 auto;/s);
});

test('webview moves provider selector and version into a low emphasis footer dock', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(html, /<div class="composer-footer"[\s\S]*<div class="composer-runtime"[\s\S]*<div class="composer-provider-dock">[\s\S]*id="providerSelect"[\s\S]*id="providerHint"[\s\S]*<\/div>/);
  assert.doesNotMatch(html, /<div class="prompt-selectors">[\s\S]*id="providerSelect"[\s\S]*<\/div>\s*<div class="prompt-tools"/);
  assert.match(css, /\.composer-footer\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.composer-footer\s*\{\s*[^}]*justify-content:\s*space-between;/s);
  assert.match(css, /\.composer-provider-dock\s*\{\s*[^}]*margin-left:\s*auto;/s);
  assert.match(css, /\.composer-provider-dock\s*\{\s*[^}]*opacity:\s*0\.62;/s);
  assert.match(css, /\.composer-provider-dock:hover,\s*\.composer-provider-dock:focus-within\s*\{\s*[^}]*opacity:\s*0\.9;/s);
  assert.match(css, /\.composer-provider-dock \.provider-hint\.has-version\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.context-budget\s*\{\s*[^}]*height:\s*20px;/s);
  assert.match(css, /\.context-budget\s*\{\s*[^}]*max-width:\s*48px;/s);
});

test('webview toolbar icons and composer controls stay visually centered', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*place-items:\s*center;/s);
  assert.match(css, /\.prompt-actions\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 30px;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*overflow:\s*visible;/s);
});

test('webview composer popovers avoid viewport clipping', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.composer\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-content:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-items:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-auto-rows:\s*max-content;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*align-self:\s*start;/s);
  assert.match(script, /function positionContextBudgetPopover\(\)/);
  assert.match(script, /const rightOverflow = triggerRect\.left \+ left \+ popoverWidth - \(window\.innerWidth - viewportPadding\);/);
  assert.match(script, /contextBudget\.style\.setProperty\('--context-budget-popover-left'/);
  assert.match(script, /contextBudget\?\.addEventListener\('pointerenter', positionContextBudgetPopover\);/);
  assert.match(script, /function composerPopoverFor\(menu\)/);
  assert.match(script, /function positionComposerPopover\(menu\)/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-left'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-top'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-max-height'/);
  assert.match(script, /menu\.addEventListener\('toggle'/);
  assert.match(script, /closeComposerMenus\(menu\);/);
  assert.match(script, /window\.addEventListener\('resize', \(\) => \{[\s\S]*positionOpenComposerPopovers\(\);[\s\S]*\}\);/);
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*left:\s*var\(--context-budget-popover-left, 0px\);/s);
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*right:\s*auto;/s);
  assert.doesNotMatch(css, /\.context-budget-popover\s*\{[^}]*translateX\(-50%\)/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*position:\s*fixed;/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*left:\s*var\(--composer-popover-left, 8px\);/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*top:\s*var\(--composer-popover-top, 8px\);/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*max-height:\s*var\(--composer-popover-max-height/s);
  assert.doesNotMatch(css, /\.model-menu \.option-popover,\s*\.permission-menu \.option-popover\s*\{\s*[^}]*right:\s*0;/s);
  assert.match(css, /\.context-budget:hover \.context-budget-popover,\s*\.context-budget:focus \.context-budget-popover,\s*\.context-budget:focus-within \.context-budget-popover\s*\{[^}]*transform:\s*translateY\(0\);/s);
});

test('webview pins composer to the bottom when task board is hidden', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"toolbar"\s*"messages"\s*"composer";/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*grid-template-rows:\s*max-content minmax\(0,\s*1fr\) max-content;/s);
  assert.match(css, /\.toolbar\s*\{\s*[^}]*grid-area:\s*toolbar;/s);
  assert.doesNotMatch(css, /\.task-board\s*\{\s*[^}]*grid-area:/s);
  assert.match(css, /\.messages\s*\{\s*[^}]*grid-area:\s*messages;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-area:\s*composer;/s);
});

test('webview composer controls wrap before narrow sidebars clip the send button', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.prompt-selectors\s*\{[\s\S]*?flex-wrap:\s*wrap;/s);
  assert.match(css, /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.provider-hint\.has-version\s*\{[\s\S]*?max-width:\s*44px;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*min-width:\s*0;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*min-width:\s*0;/s);
});

test('webview uses one primary composer action slot for send and stop', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /const running = Boolean\(runningByProvider\[activeId\]\);/);
  assert.match(script, /stopBtn\.hidden = !running;/);
  assert.match(script, /sendBtn\.hidden = running;/);
  assert.match(script, /stopBtn\.classList\.toggle\('is-visible', running\);/);
  assert.match(script, /sendBtn\.classList\.toggle\('is-hidden', running\);/);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*flex:\s*0 0 28px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*width:\s*30px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*display:\s*grid;/s);
  assert.match(css, /\.send-button\.is-hidden\s*\{\s*[^}]*display:\s*none;/s);
});

test('webview refreshes context after a concrete provider is active', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function refreshActiveContext\(\) \{\s*if \(!activeId\) \{\s*return;\s*\}\s*vscode\.postMessage\(\{ command: 'refreshContext', cliId: activeId, contextOptions \}\);\s*\}/);
  assert.match(script, /providerSelect\.addEventListener\('change', \(\) => \{[\s\S]*renderAll\(\);\s*refreshActiveContext\(\);[\s\S]*\}\);/);
  assert.match(script, /case 'profiles':[\s\S]*renderAll\(\);\s*refreshActiveContext\(\);[\s\S]*break;/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'checkProfiles' \}\);\s*refreshActiveContext\(\);\s*renderAll\(\);/);
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

test('webview sends to only the active provider at send time', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /id="agentRail"/);
  assert.doesNotMatch(script, /renderAgentRail/);
  assert.doesNotMatch(script, /agentRail\?\.addEventListener/);
  assert.doesNotMatch(html, /id="agentPicker"/);
  assert.doesNotMatch(script, /selectedAgentIds/);
  assert.doesNotMatch(script, /normalizeSavedAgentIds/);
  assert.doesNotMatch(script, /selectedProviderIdsForSend/);
  assert.doesNotMatch(script, /function renderAgentPicker/);
  assert.doesNotMatch(script, /TASK_ROUTING_RULES/);
  assert.doesNotMatch(script, /recommendedProviderIds/);
  assert.doesNotMatch(css, /\.agent-picker/);
  assert.doesNotMatch(css, /\.agent-choice/);
  assert.doesNotMatch(i18nScript, /agentPicker\./);
  assert.match(script, /const profile = activeProfile\(\);\s*if \(!profile\?\.installed\) \{/);
  assert.match(script, /sendToProvider\(\s*activeId,\s*action,\s*finalText,/s);
  assert.doesNotMatch(script, /providerIds\.forEach/);
});

test('webview sends recent thread conversation as provider context', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const providerSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /interface AssistantConversationHistoryMessage/);
  assert.match(typesSource, /conversationHistory\?: AssistantConversationHistoryMessage\[\]/);
  assert.match(script, /function conversationHistoryForSend\(cliId\)/);
  assert.match(script, /ensureConversation\(cliId, activeThreadId\(cliId\)\)/);
  assert.match(script, /\.slice\(-8\)/);
  assert.match(script, /conversationHistory: conversationHistoryForSend\(providerId\)/);
  assert.match(providerSource, /conversationHistory: message\.conversationHistory/);
});

test('webview closes composer menus when clicking outside or pressing escape', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function composerMenus\(\)/);
  assert.match(script, /\[modelMenu, runtimeMenu, permissionMenu, modeMenu, contextMenu\]\.filter\(Boolean\)/);
  assert.match(script, /function closeComposerMenus\(exceptMenu\)/);
  assert.match(script, /menu\.open = false;/);
  assert.match(script, /document\.addEventListener\('click', \(event\) => \{/);
  assert.match(script, /const currentMenu = target\?\.closest\('details'\);/);
  assert.match(script, /closeComposerMenus\(menus\.includes\(currentMenu\) \? currentMenu : undefined\);/);
  assert.match(script, /window\.addEventListener\('keydown', \(event\) => \{/);
  assert.match(script, /event\.key === 'Escape'/);
});

test('webview removes multi-agent compare planning', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /name: 'compare'/);
  assert.doesNotMatch(script, /sendComparePlan/);
  assert.doesNotMatch(script, /selectedProfilesForComparison/);
  assert.doesNotMatch(script, /recommendedProfilesForIntent/);
  assert.doesNotMatch(i18nScript, /slash\.compare/);
});

test('webview keeps the visual task board disabled while single-agent flows stabilize', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(html, /id="taskBoard"[^>]*class="task-board"/);
  assert.match(html, /id="taskBoard"[^>]*hidden/);
  assert.match(script, /const VISUAL_TASK_BOARD_ENABLED = false;/);
  assert.match(script, /let tasks = normalizeSavedTasks\(saved\.tasks\);/);
  assert.match(script, /let taskBoardDismissed = Boolean\(saved\.taskBoardDismissed\);/);
  assert.match(script, /taskBoardDismissed,/);
  assert.match(script, /let taskBySessionId = \{\};/);
  assert.match(script, /function createRunTask/);
  assert.doesNotMatch(script, /taskBoardDismissed = false;/);
  assert.doesNotMatch(script, /makeTaskGroupId/);
  assert.doesNotMatch(script, /groupId/);
  assert.match(script, /function updateTaskStatus/);
  assert.match(script, /function visibleTasksForBoard\(\)/);
  assert.match(script, /if \(!VISUAL_TASK_BOARD_ENABLED \|\| taskBoardDismissed\) \{\s*return \[\];\s*\}/);
  assert.match(script, /const activeTasks = tasks\.filter\(isActiveTask\);/);
  assert.match(script, /function renderTaskBoard\(\)/);
  assert.match(script, /const visibleTasks = visibleTasksForBoard\(\);/);
  assert.match(script, /taskBySessionId\[message\.sessionId\]/);
  assert.match(script, /renderTaskBoard\(\);\s*renderThreadSelect\(\);/);
  assert.match(script, /status: 'preparing'/);
  assert.match(script, /status: Number\(message\.exitCode\) === 0 \? 'completed' : 'failed'/);
});

test('webview provider status keeps transient running text out of the composer', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /pendingByProvider\[profile\.id\]/);
  assert.match(script, /runningByProvider\[profile\.id\]/);
  assert.match(script, /provider\.preparing/);
  assert.match(script, /provider\.running/);
  assert.match(script, /providerHint\.textContent = '';/);
  assert.match(script, /formatProviderVersion\(profile\.version\)/);
  assert.match(script, /providerHint\.classList\.toggle\('has-version', Boolean\(versionLabel\)\)/);
  assert.doesNotMatch(script, /providerHint\.classList\.add\('is-busy'\)/);
  assert.doesNotMatch(script, /prompt-shell'\)\?\.classList\.toggle\('is-busy'/);
  assert.match(css, /\.provider-hint\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.provider-hint\.is-warning\s*\{\s*[^}]*display:\s*inline-flex;/s);
  assert.match(css, /\.provider-hint\.has-version\s*\{\s*[^}]*display:\s*inline-flex;/s);
  assert.doesNotMatch(css, /\.provider-hint\.is-busy\s*\{/);
  assert.doesNotMatch(css, /\.prompt-shell\.is-busy\s*\{/);
});

test('webview displays attached context window usage details', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="contextBudget"/);
  assert.match(html, /id="contextBudgetLabel"/);
  assert.match(html, /id="contextBudgetTokenizer"/);
  assert.match(script, /const contextBudgetPopover = contextBudget\?\.querySelector\('\.context-budget-popover'\);/);
  assert.match(script, /function renderContextBudget/);
  assert.match(script, /positionContextBudgetPopover\(\);/);
  assert.match(script, /profile\.contextWindowTokens/);
  assert.match(script, /contextSummary\?\.tokenUsage/);
  assert.match(script, /case 'contextSummary':[\s\S]*renderContextBudget\(\);[\s\S]*break;/);
  assert.match(script, /contextWindow\.usedRemaining/);
  assert.match(script, /contextWindow\.autoCompact/);
  assert.match(script, /tokenUsage\.precision === 'exact'/);
  assert.match(script, /contextWindow\.exactUnavailable/);
  assert.match(css, /\.context-budget\s*\{/);
  assert.match(css, /\.context-budget-popover\s*\{/);
  assert.match(css, /\.context-budget:hover \.context-budget-popover/);
  assert.match(i18nScript, /'contextWindow\.title'/);
  assert.match(i18nScript, /'contextWindow\.usedTotal'/);
  assert.match(i18nScript, /'contextWindow\.tokenizer'/);
});

test('webview hides low-value default composer chips', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /modeMenu\?\.classList\.toggle\('is-visible', Boolean\(profile && modes\.length > 1\)\);/);
  assert.match(script, /forceContextMenuVisible/);
  assert.match(script, /contextSummary\.workspace/);
  assert.match(css, /\.mode-menu,\s*\.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.mode-menu\.is-visible,\s*\.context-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
});

test('webview conversation transcript surfaces compact metadata and readable code output', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(css, /html\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*width:\s*100%;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*padding:\s*8px 8px 7px;/s);
  assert.ok(script.indexOf('const ORPHAN_ANSI_PATTERN') < script.indexOf('normalizeSavedThreads'));
  assert.match(script, /if \(item\.meta && item\.role !== 'user'\)/);
  assert.doesNotMatch(script, /parts\.push\(summary\.workspace\)/);
  assert.match(script, /const itemRunning = Boolean\(item\.running && runningByProvider\[activeId\]\);/);
  assert.match(script, /const meta = document\.createElement\('div'\);/);
  assert.match(script, /meta\.className = 'message-meta';/);
  assert.match(script, /bubble\.appendChild\(meta\);/);
  assert.match(css, /\.messages\s*\{\s*[^}]*padding:\s*14px clamp\(16px,\s*2\.8vw,\s*22px\) 24px;/s);
  assert.match(css, /\.message-meta\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /\.message\.assistant \.message-bubble\s*\{[^}]*border-left-width/s);
  assert.match(css, /\.message\.error \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s);
  assert.match(css, /\.message\.error \.message-bubble\s*\{\s*[^}]*padding:\s*8px 10px 8px 32px;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*border:\s*0;/s);
  assert.match(script, /function syncMessageStatusTimer\(shouldRun\)/);
  assert.match(script, /messageStatusTimer = setInterval\(\(\) => \{\s*renderMessages\(\);[\s\S]*?\}, 1000\);/);
  assert.match(script, /function runningMessageStatusText\(stage, startedAt\)/);
  assert.match(script, /i18n\.t\('message\.statusElapsed', \{ status: stage, elapsed \}\)/);
  assert.match(script, /item\.runningNotice \|\|[\s\S]*item\.text \? i18n\.t\('message\.generating'\) : i18n\.t\('message\.thinking'\),\s*item\.startedAt/s);
  assert.doesNotMatch(script, /typing-dots/);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*max-width:\s*min\(72%,\s*520px\);/s);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*border-color:\s*var\(--assistant-soft-border\);/s);
  assert.match(css, /\.message-content\s*\{\s*[^}]*gap:\s*2px;/s);
  assert.match(css, /\.message-content\s*\{\s*[^}]*line-height:\s*1\.36;/s);
  assert.match(css, /\.md-spacer\s*\{\s*[^}]*height:\s*1px;/s);
  assert.match(css, /\.md-heading\s*\{\s*[^}]*margin:\s*2px 0 0;/s);
  assert.match(css, /\.md-paragraph,\s*\.md-list-item,\s*\.md-numbered-item\s*\{\s*[^}]*min-height:\s*1\.28em;/s);
  assert.match(css, /\.md-code-block\s*\{\s*[^}]*line-height:\s*1\.36;/s);
  assert.match(css, /\.md-table-wrap\s*\{\s*[^}]*scrollbar-width:\s*thin;/s);
  assert.match(i18nScript, /'message\.statusElapsed': '\{status\} · \{elapsed\}'/);
});

test('webview does not persist transient running message state', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const providerSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(providerSource, /private profilesById = new Map<string, CliProfile>/);
  assert.match(providerSource, /this\.profilesById\.set\(profile\.id, profile\)/);
  assert.match(providerSource, /this\.profilesById\.get\(cliId\) \?\? getCliProfile\(cliId\)/);
  assert.match(providerSource, /const NO_OUTPUT_NOTICE_MS = 45_000;/);
  assert.match(providerSource, /private noOutputNoticeTimers = new Map/);
  assert.match(providerSource, /command:\s*'sessionNotice'/);
  assert.match(providerSource, /runtimeT\(this\.locale,\s*'warning\.noOutput'/);
  assert.match(script, /threadsByProvider: serializeThreadsForState\(threadsByProvider\)/);
  assert.match(script, /const \{ startedAt, \.\.\.rest \} = message;/);
  assert.match(script, /return \{ \.\.\.rest, running: false \};/);
  assert.match(script, /running: false,\s*text: filterInternalPromptEcho\(message\.text\)\.text/s);
  assert.match(script, /case 'sessionNotice':\s*updateSessionNotice\(message\);/);
  assert.match(script, /item\.runningNotice = normalizeMessageText\(message\.text\);/);
  assert.match(script, /delete item\.runningNotice;/);
  assert.match(providerSource, /normalized\.status !== 'thinking'/);
  assert.match(script, /persist\(\);\s*renderAll\(\);/);
});

test('webview form controls opt out of browser autocomplete noise', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.match(html, /id="promptInput"[^>]*name="assistantPrompt"[^>]*autocomplete="off"/);
  assert.match(html, /id="providerSelect"[^>]*name="assistantProvider"/);
  assert.match(html, /id="modelSelect"[^>]*name="assistantModel"/);
  assert.match(html, /id="customModelInput"[^>]*name="assistantCustomModel"[^>]*autocomplete="off"/);
  assert.match(html, /id="runtimeSelect"[^>]*name="assistantRuntime"/);
  assert.match(html, /id="permissionSelect"[^>]*name="assistantPermission"/);
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
  assert.match(script, /local:\s*'models',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /local:\s*'agents',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /seen\.has\(command\.name\)/);
  assert.match(script, /case 'models':/);
  assert.match(script, /modelMenu\.open = true/);
  assert.match(script, /case 'agents':/);
  assert.match(script, /modeMenu\.open = true/);
  assert.match(script, /function renderSlashPalette/);
  assert.match(script, /function executeSlashCommand/);
  assert.match(script, /event\.key === 'ArrowDown'/);
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /sendBtn\.addEventListener\('click', \(event\) => \{\s*event\.stopPropagation\(\);/s);
  assert.match(script, /parseSlashInput\(input\.value\)/);
  assert.match(script, /send\(command\.action,\s*command\.prompt/);
  assert.match(script, /setActiveThread/);
  assert.match(css, /\.slash-palette\s*\{/);
  assert.match(css, /\.slash-command\.is-active\s*\{/);
  assert.match(i18nScript, /'slash\.empty'/);
  assert.match(i18nScript, /'slash\.unsupported'/);
  assert.match(i18nScript, /'slash\.models\.desc'/);
  assert.match(i18nScript, /'slash\.agents\.desc'/);
});

test('webview slash command palette shows each command label once', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /slash-command-name/);
  assert.doesNotMatch(css, /\.slash-command-name\s*\{/);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(58px,/);
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
  assert.match(script, /const hasAttachments = promptAttachments\.length > 0;/);
  assert.match(script, /const missingCustomModel = activeModel\(\)\?\.custom && !activeCustomModel\(activeId\);/);
  assert.match(script, /const canRunAction = hasPrompt \|\| hasAttachments \|\| selectedAction !== 'freeform';/);
  assert.match(script, /sendBtn\.disabled = !canSend \|\| busy \|\| !canRunAction \|\| missingSelection \|\| missingCustomModel;/);
});

test('agent mode select is persisted per provider', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /activeAgentModeByProvider/);
  assert.match(script, /activeModelByProvider/);
  assert.match(script, /activeRuntimeByProvider/);
  assert.match(script, /activePermissionByProvider/);
  assert.match(script, /agentModeSelect\.addEventListener\('change'/);
  assert.match(script, /modelSelect\.addEventListener\('change'/);
  assert.match(script, /modelOptionList\?\.addEventListener\('click'/);
  assert.match(script, /runtimeSelect\.addEventListener\('change'/);
  assert.match(script, /permissionSelect\.addEventListener\('change'/);
  assert.match(script, /customModelInput\.addEventListener\('input'/);
  assert.match(script, /agentMode: preferredWorkflowMode \|\| activeAgentModeId\(providerId\)/);
  assert.match(script, /model: activeModelId\(providerId\)/);
  assert.match(script, /customModel: activeCustomModel\(providerId\)/);
  assert.match(script, /runtime: activeRuntimeId\(providerId\)/);
  assert.match(script, /permissionMode: activePermissionId\(providerId\)/);
  assert.doesNotMatch(script, /opencode'\s*\?\s*'build'/);
});

test('webview localizes provider option labels in composer controls', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /function localizedCliOption\(option, group\)/);
  assert.match(script, /renderOptionSelect\(modelSelect, options, model\.id, 'model'\)/);
  assert.match(script, /renderOptionSelect\(runtimeSelect, options, runtime\.id, 'runtime'\)/);
  assert.match(script, /renderOptionSelect\(permissionSelect, options, permission\.id, 'permission'\)/);
  assert.match(script, /localizedCliOption\(mode, 'agentMode'\)/);
  assert.match(i18nScript, /'option\.model\.default': '默认'/);
  assert.match(i18nScript, /'option\.model\.configured': '当前配置'/);
  assert.match(i18nScript, /'option\.model\.custom': '自定义'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing': '在本地处理'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing\.summary': '本地模式'/);
  assert.match(i18nScript, /'option\.permission\.readOnly': '只读'/);
  assert.match(i18nScript, /'option\.permission\.workspaceWrite': '默认权限'/);
  assert.match(i18nScript, /'option\.permission\.fullAuto': '自动审查'/);
  assert.match(i18nScript, /'option\.permission\.danger': '完全访问权限'/);
  assert.match(i18nScript, /'option\.agentMode\.configured': '当前配置'/);
  assert.match(i18nScript, /'option\.agentMode\.build': '执行'/);
  assert.match(i18nScript, /'option\.agentMode\.plan': '规划'/);
  assert.match(i18nScript, /'agentMode\.subagent': '子代理'/);
});

test('webview front-end explains and blocks selection-only actions without selection', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function actionRequiresSelection\(action\)/);
  assert.match(script, /function hasSelectionContext\(\)/);
  assert.match(script, /actionRequiresSelection\(selectedAction\) && !hasSelectionContext\(\)/);
  assert.match(script, /quick\.missingSelection/);
  assert.match(
    script,
    /if \(action === 'openSettings'\) \{\s*button\.disabled = false;\s*button\.title = '';\s*return;/
  );
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

test('normalizeCliOutput hides OpenCode run banners before response text', () => {
  assert.equal(
    normalizeCliOutput('\u001b[0m\n> \u200bSisyphus - Ultraworker · mimo-v2.5-pro\n\u001b[0m', 'opencode'),
    ''
  );
  assert.equal(
    normalizeCliOutput(
      '\u001b[0m\n> \u200bSisyphus - Ultraworker · mimo-v2.5-pro\n\u001b[0m我是Sisyphus。\n',
      'opencode'
    ),
    '我是Sisyphus。\n'
  );
});

test('normalizeCliOutput condenses OpenCode model errors into a readable message', () => {
  assert.equal(
    normalizeCliOutput(
      [
        'ProviderModelNotFoundError: ProviderModelNotFoundError',
        ' data: {',
        '  providerID: "mimo",',
        '  modelID: "mimo-v2-pro",',
        '  suggestions: [ "mimo-v2.5-pro" ],',
        '},',
        '',
        '      at <anonymous> (/$bunfs/root/chunk-erdf7dmy.js:553:62143)',
        '',
        '\u001b[91m\u001b[1mError: \u001b[0mModel not found: mimo/mimo-v2-pro. Did you mean: mimo-v2.5-pro?',
        '',
      ].join('\n'),
      'opencode'
    ),
    'Error: Model not found: mimo/mimo-v2-pro. Did you mean: mimo-v2.5-pro?\n'
  );
});

test('normalizeCliOutput hides OpenCode terminal tool traces', () => {
  assert.equal(
    normalizeCliOutput(
      [
        '⚙ neural-memory_nmem_context',
        '{"limit":5,"fresh_only":true}',
        '⚙ session_read',
        '{"limit":10,"session_id":"ses_123"}',
        '⚙ neural-memory_nmem_recall {"query":"慢 slow performance speed"}',
        '',
        '我很好，随时准备干活！',
      ].join('\n'),
      'opencode'
    ),
    '我很好，随时准备干活！'
  );
});

test('normalizeCliOutputChunk streams OpenCode JSON event deltas', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"你"}}\n',
      'opencode'
    ),
    { text: '你', buffer: '' }
  );

  const partial = normalizeCliOutputChunk(
    '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"好',
    'opencode'
  );
  assert.deepEqual(partial, {
    text: '',
    buffer: '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"好',
  });
  assert.deepEqual(normalizeCliOutputChunk('。"}}\n', 'opencode', partial.buffer), {
    text: '好。',
    buffer: '',
  });
});

test('normalizeCliOutputChunk streams Claude Code partial text deltas', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}}\n',
      'claude'
    ),
    { text: '你', buffer: '' }
  );

  const partial = normalizeCliOutputChunk(
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"好',
    'claude'
  );
  assert.deepEqual(partial, {
    text: '',
    buffer:
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"好',
  });
  assert.deepEqual(normalizeCliOutputChunk('。"}}}\n', 'claude', partial.buffer), {
    text: '好。',
    buffer: '',
  });
});

test('normalizeCliOutputChunk hides Claude Code final JSON messages after partial streaming', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"完整内容"}]}}\n',
      'claude'
    ),
    { text: '', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"先思考"}}}\n',
      'claude'
    ),
    { text: '', buffer: '', status: 'thinking' }
  );
});

test('normalizeCliOutputChunk hides OpenCode thinking details from transcript text', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"reasoning"},"delta":"先分析\\n再回答"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"reasoning"},"delta":"The user is asking"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking' }
  );
});

test('normalizeCliOutputChunk handles OpenCode run JSON text events', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"OK"}}\n',
      'opencode'
    ),
    { text: 'OK', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"reasoning","timestamp":1,"sessionID":"ses_1","part":{"type":"reasoning","text":"先想一下"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking' }
  );
});

test('flushCliOutputBuffer emits a complete buffered OpenCode JSON event', () => {
  assert.equal(
    flushCliOutputBuffer(
      '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"OK"}}',
      'opencode'
    ),
    'OK'
  );
});

test('normalizeCliOutput explains OpenCode database lock errors', () => {
  assert.equal(
    normalizeCliOutput(
      "Error: Unexpected error\n\nFailed to run the query 'PRAGMA wal_checkpoint(PASSIVE)'",
      'opencode'
    ),
    'Error: OpenCode local database is locked by another running OpenCode server. Close that server or run this workspace from the same OpenCode server, then retry.\n'
  );
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
  assert.match(source, /permissionMode: action === 'explainSelection' \? preferredReadOnlyPermission\(profile\) : undefined/);
  assert.match(source, /item\.id === 'plan'/);
  assert.match(source, /item\.id === 'suggest'/);
  assert.match(source, /item\.id === 'readOnly'/);
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
