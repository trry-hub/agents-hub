(function () {
  const vscode = acquireVsCodeApi();
  const i18n = window.AssistantI18n;
  i18n.apply();

  const ORPHAN_ANSI_PATTERN = /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])/g;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
  const INTERNAL_PROMPT_END_MARKER =
    '- If context is missing, say what is missing and proceed with the best available information.';

  const saved = vscode.getState() || {};
  let profiles = [];
  let activeId = saved.activeId || '';
  let activeAgentModeByProvider = saved.activeAgentModeByProvider || {};
  let legacyWorkflowMode = saved.workflowMode || (saved.mode === 'agent' ? 'execute' : undefined);
  let threadsByProvider = normalizeSavedThreads(saved.threadsByProvider, saved.conversations);
  let activeThreadByProvider = saved.activeThreadByProvider || {};
  let contextOptions = saved.contextOptions || {
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  };
  let contextSummary = null;
  let streamTargets = {};
  let runningByProvider = {};
  let pendingByProvider = {};
  let pendingThreadByProvider = {};

  const providerSelect = document.getElementById('providerSelect');
  const providerHint = document.getElementById('providerHint');
  const agentModeSelect = document.getElementById('agentModeSelect');
  const agentModeSummaryLabel = document.getElementById('agentModeSummaryLabel');
  const actionSelect = document.getElementById('actionSelect');
  const threadSelect = document.getElementById('threadSelect');
  const deleteThreadBtn = document.getElementById('deleteThreadBtn');
  const contextSummaryLabel = document.getElementById('contextSummaryLabel');
  const slashPalette = document.getElementById('slashPalette');
  const modeMenu = document.querySelector('.mode-menu');
  const contextMenu = document.querySelector('.context-menu');
  const messages = document.getElementById('messages');
  const input = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const SLASH_COMMANDS = [
    { name: 'new', kind: 'local', local: 'new', descriptionKey: 'slash.new.desc' },
    { name: 'clear', kind: 'local', local: 'new', descriptionKey: 'slash.clear.desc' },
    { name: 'help', kind: 'local', local: 'help', descriptionKey: 'slash.help.desc' },
    { name: 'context', kind: 'local', local: 'context', descriptionKey: 'slash.context.desc' },
    { name: 'refresh', kind: 'local', local: 'refresh', descriptionKey: 'slash.refresh.desc' },
    { name: 'stop', kind: 'local', local: 'stop', descriptionKey: 'slash.stop.desc' },
    { name: 'copy', kind: 'local', local: 'copy', descriptionKey: 'slash.copy.desc' },
    {
      name: 'review',
      action: 'reviewFile',
      prompt: i18n.t('quick.review.text'),
      descriptionKey: 'slash.review.desc',
    },
    {
      name: 'explain',
      action: 'explainSelection',
      prompt: i18n.t('quick.explain.text'),
      descriptionKey: 'slash.explain.desc',
    },
    {
      name: 'tests',
      aliases: ['test'],
      action: 'generateTests',
      prompt: i18n.t('quick.tests.text'),
      descriptionKey: 'slash.tests.desc',
    },
    {
      name: 'refactor',
      action: 'refactorSelection',
      prompt: i18n.t('quick.refactor.text'),
      descriptionKey: 'slash.refactor.desc',
    },
    {
      name: 'plan',
      action: 'freeform',
      prompt: i18n.t('slash.plan.prompt'),
      modeByProvider: { claude: 'plan', codex: 'suggest', opencode: 'plan', gemini: 'plan', goose: 'plan' },
      descriptionKey: 'slash.plan.desc',
    },
    {
      name: 'init',
      action: 'freeform',
      prompt: i18n.t('slash.init.prompt'),
      descriptionKey: 'slash.init.desc',
    },
    ...[
      'add-dir',
      'agents',
      'bug',
      'compact',
      'config',
      'cost',
      'doctor',
      'login',
      'logout',
      'mcp',
      'memory',
      'model',
      'permissions',
      'pr_comments',
      'sandbox',
      'status',
      'terminal-setup',
      'usage',
      'vim',
    ].map((name) => ({ name, kind: 'native', providers: ['claude'], descriptionKey: 'slash.native.desc' })),
    ...[
      'permissions',
      'sandbox-add-read-dir',
      'agent',
      'apps',
      'plugins',
      'compact',
      'diff',
      'exit',
      'feedback',
      'logout',
      'mcp',
      'mention',
      'model',
      'fast',
      'personality',
      'ps',
      'fork',
      'side',
      'resume',
      'quit',
      'status',
      'debug-config',
      'statusline',
      'title',
      'keymap',
    ].map((name) => ({ name, kind: 'native', providers: ['codex'], descriptionKey: 'slash.native.desc' })),
    ...[
      'connect',
      'compact',
      'summarize',
      'details',
      'editor',
      'exit',
      'quit',
      'q',
      'export',
      'models',
      'redo',
      'sessions',
      'resume',
      'continue',
      'share',
      'themes',
      'thinking',
      'undo',
      'unshare',
    ].map((name) => ({ name, kind: 'native', providers: ['opencode'], descriptionKey: 'slash.native.desc' })),
    ...[
      'about',
      'agents',
      'auth',
      'bug',
      'chat',
      'commands',
      'compress',
      'directory',
      'dir',
      'docs',
      'editor',
      'extensions',
      'hooks',
      'ide',
      'mcp',
      'memory',
      'model',
      'permissions',
      'policies',
      'privacy',
      'quit',
      'exit',
      'restore',
      'rewind',
      'resume',
      'settings',
      'shells',
      'bashes',
      'setup-github',
      'skills',
      'stats',
      'terminal-setup',
      'theme',
      'tools',
      'upgrade',
      'vim',
    ].map((name) => ({ name, kind: 'native', providers: ['gemini'], descriptionKey: 'slash.native.desc' })),
    ...[
      '?',
      'builtin',
      'endplan',
      'exit',
      'quit',
      'extension',
      'mode',
      'prompt',
      'prompts',
      'recipe',
      'compact',
      'r',
      't',
    ].map((name) => ({ name, kind: 'native', providers: ['goose'], descriptionKey: 'slash.native.desc' })),
    ...[
      'add',
      'architect',
      'ask',
      'chat-mode',
      'code',
      'commit',
      'copy-context',
      'diff',
      'drop',
      'edit',
      'editor',
      'editor-model',
      'exit',
      'git',
      'lint',
      'load',
      'ls',
      'map',
      'map-refresh',
      'model',
      'models',
      'multiline-mode',
      'ok',
      'paste',
      'quit',
      'read-only',
      'reasoning-effort',
      'report',
      'reset',
      'run',
      'save',
      'settings',
      'test',
      'think-tokens',
      'tokens',
      'undo',
      'voice',
      'weak-model',
      'web',
    ].map((name) => ({ name, kind: 'native', providers: ['aider'], descriptionKey: 'slash.native.desc' })),
  ];
  let slashMatches = [];
  let slashActiveIndex = 0;
  let forceContextMenuVisible = false;

  function normalizeMessageText(text) {
    return String(text || '')
      .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
      .replace(ORPHAN_ANSI_PATTERN, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(CONTROL_PATTERN, '')
      .replace(/\n{4,}/g, '\n\n\n');
  }

  function filterInternalPromptEcho(text) {
    const normalized = normalizeMessageText(text);
    const firstContentIndex = normalized.search(/\S/);
    if (firstContentIndex === -1) {
      return { text: normalized, pending: false };
    }

    if (!normalized.slice(firstContentIndex).startsWith(INTERNAL_PROMPT_START)) {
      return { text: normalized, pending: false };
    }

    const promptEndIndex = normalized.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
    if (promptEndIndex === -1) {
      return { text: '', pending: true };
    }

    return {
      text: normalized.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length).replace(/^\s+/, ''),
      pending: false,
    };
  }

  function persist() {
    vscode.setState({
      activeId,
      activeAgentModeByProvider,
      threadsByProvider: serializeThreadsForState(threadsByProvider),
      activeThreadByProvider,
      contextOptions,
    });
  }

  function serializeThreadsForState(source) {
    const serialized = {};
    Object.entries(source || {}).forEach(([cliId, threads]) => {
      serialized[cliId] = (threads || []).map((thread) => ({
        ...thread,
        messages: (thread.messages || []).map((message) => (
          message && typeof message === 'object'
            ? { ...message, running: false }
            : message
        )),
      }));
    });
    return serialized;
  }

  function activeProfile() {
    return profiles.find((profile) => profile.id === activeId);
  }

  function installedProfiles() {
    return profiles.filter((profile) => profile.installed);
  }

  function normalizeSavedThreads(savedThreads, legacyConversations) {
    const normalized = {};

    Object.entries(savedThreads || {}).forEach(([cliId, threads]) => {
      if (!Array.isArray(threads)) {
        return;
      }

      normalized[cliId] = threads
        .filter((thread) => thread && Array.isArray(thread.messages))
        .map((thread) => ({
          id: thread.id || makeThreadId(cliId),
          title: thread.title || deriveThreadTitle(thread.messages) || i18n.t('history.untitled'),
          createdAt: Number(thread.createdAt) || Date.now(),
          updatedAt: Number(thread.updatedAt) || Date.now(),
          messages: normalizeThreadMessages(thread.messages),
        }));
    });

    Object.entries(legacyConversations || {}).forEach(([cliId, messages]) => {
      if (!Array.isArray(messages) || normalized[cliId]?.length) {
        return;
      }

      normalized[cliId] = [createThread(cliId, normalizeThreadMessages(messages))];
    });

    return normalized;
  }

  function makeThreadId(cliId) {
    return `${cliId || 'thread'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createThread(cliId, messages) {
    const now = Date.now();
    const initialMessages = Array.isArray(messages) ? messages : [];
    return {
      id: makeThreadId(cliId),
      title: deriveThreadTitle(initialMessages) || i18n.t('history.newThread'),
      createdAt: now,
      updatedAt: now,
      messages: initialMessages,
    };
  }

  function normalizeThreadMessages(threadMessages) {
    return (threadMessages || []).map((message) => {
      if (!message || typeof message !== 'object') {
        return message;
      }

      if (message.role !== 'assistant' && message.role !== 'error') {
        return message;
      }

      return {
        ...message,
        running: false,
        text: filterInternalPromptEcho(message.text).text,
      };
    });
  }

  function deriveThreadTitle(messagesOrText) {
    const source = Array.isArray(messagesOrText)
      ? messagesOrText.find((message) => message.role === 'user')?.text
      : messagesOrText;
    const title = normalizeMessageText(source || '')
      .split('\n')
      .find((line) => line.trim()) || '';

    return title.trim().replace(/\s+/g, ' ').slice(0, 42);
  }

  function ensureThreadList(cliId) {
    if (!cliId) {
      return [];
    }
    if (!threadsByProvider[cliId]) {
      threadsByProvider[cliId] = [];
    }
    return threadsByProvider[cliId];
  }

  function findThread(cliId, threadId) {
    return ensureThreadList(cliId).find((thread) => thread.id === threadId);
  }

  function ensureActiveThread(cliId) {
    if (!cliId) {
      return null;
    }

    const threads = ensureThreadList(cliId);
    let thread = findThread(cliId, activeThreadByProvider[cliId]);

    if (!thread) {
      thread = threads[0];
    }

    if (!thread) {
      thread = createThread(cliId);
      threads.unshift(thread);
    }

    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function setActiveThread(cliId, thread) {
    if (!cliId || !thread) {
      return null;
    }

    const threads = ensureThreadList(cliId);
    if (!threads.includes(thread)) {
      threads.unshift(thread);
    }
    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function startNewThread(cliId = activeId) {
    const current = ensureActiveThread(cliId);
    if (!current || current.messages.length > 0) {
      setActiveThread(cliId, createThread(cliId));
    } else {
      setActiveThread(cliId, current);
    }
    persist();
    renderAll();
  }

  function ensureThread(cliId, threadId) {
    if (!cliId) {
      return null;
    }

    if (threadId) {
      const thread = findThread(cliId, threadId);
      if (thread) {
        return thread;
      }
    }

    return ensureActiveThread(cliId);
  }

  function activeThreadId(cliId = activeId) {
    return ensureActiveThread(cliId)?.id || '';
  }

  function ensureConversation(cliId, threadId) {
    const thread = ensureThread(cliId, threadId);
    return thread?.messages || [];
  }

  function touchThread(thread, titleText) {
    if (!thread) {
      return;
    }

    thread.updatedAt = Date.now();
    const title = deriveThreadTitle(titleText);
    if (title && (!thread.title || thread.title === i18n.t('history.newThread'))) {
      thread.title = title;
    }
  }

  function setAccent(profile) {
    document.documentElement.style.setProperty(
      '--assistant-accent',
      profile?.accent || 'var(--vscode-focusBorder)'
    );
  }

  function agentModesFor(profile) {
    return Array.isArray(profile?.agentModes) && profile.agentModes.length > 0
      ? profile.agentModes
      : [
          {
            id: 'agent',
            label: 'Agent',
            description: '',
            instruction: 'Use this provider as a coding agent.',
          },
        ];
  }

  function normalizeAgentModeId(profile, value) {
    const modes = agentModesFor(profile);
    const mode = modes.find((item) => item.id === value)
      || modes.find((item) => item.id === profile?.defaultAgentMode)
      || modes[0];

    return mode.id;
  }

  function activeAgentModeId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const legacy = legacyWorkflowMode ? mapLegacyWorkflowMode(profile, legacyWorkflowMode) : undefined;
    const value = activeAgentModeByProvider[cliId] || legacy;
    const normalized = normalizeAgentModeId(profile, value);
    activeAgentModeByProvider[cliId] = normalized;
    return normalized;
  }

  function activeAgentMode(profile = activeProfile()) {
    const modes = agentModesFor(profile);
    if (!profile) {
      return modes[0];
    }

    return modes.find((mode) => mode.id === activeAgentModeId(profile.id)) || modes[0];
  }

  function mapLegacyWorkflowMode(profile, value) {
    const modes = agentModesFor(profile);
    const desired = {
      auto: profile?.defaultAgentMode,
      plan: profile?.id === 'codex' ? 'suggest' : 'plan',
      execute: profile?.defaultAgentMode,
    }[value];

    return modes.some((mode) => mode.id === desired) ? desired : undefined;
  }

  function renderProviderSelect() {
    providerSelect.innerHTML = '';
    const availableProfiles = installedProfiles();

    if (availableProfiles.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18n.t('provider.noInstalled');
      providerSelect.appendChild(option);
      activeId = '';
      providerSelect.value = '';
      providerSelect.disabled = true;
      return;
    }

    if (!availableProfiles.some((profile) => profile.id === activeId)) {
      activeId = availableProfiles[0].id;
    }

    ensureActiveThread(activeId);
    activeAgentModeId(activeId);

    for (const profile of availableProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      providerSelect.appendChild(option);
    }

    providerSelect.value = activeId;
    providerSelect.disabled = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
  }

  function renderThreadSelect() {
    threadSelect.innerHTML = '';

    const thread = ensureActiveThread(activeId);
    if (!thread) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18n.t('history.untitled');
      threadSelect.appendChild(option);
      threadSelect.disabled = true;
      deleteThreadBtn.disabled = true;
      newChatBtn.disabled = true;
      return;
    }

    const threads = ensureThreadList(activeId)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const item of threads) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title || i18n.t('history.untitled');
      threadSelect.appendChild(option);
    }

    threadSelect.value = thread.id;
    threadSelect.disabled = threads.length <= 1 && thread.messages.length === 0;
    deleteThreadBtn.disabled =
      Boolean(runningByProvider[activeId] || pendingByProvider[activeId]) ||
      (threads.length <= 1 && thread.messages.length === 0);
    newChatBtn.disabled = !activeId;
  }

  function renderProviderHint() {
    const profile = activeProfile();
    providerHint.classList.remove('is-warning');
    providerHint.textContent = '';
    providerHint.title = '';

    if (!profile) {
      providerHint.classList.add('is-warning');
      providerHint.textContent = i18n.t('provider.noInstalled');
      return;
    }

    if (!profile.installed) {
      providerHint.classList.add('is-warning');
      providerHint.textContent = i18n.t('provider.install', { hint: profile.installHint });
      return;
    }

    if (runningByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.running')} · ${activeAgentMode(profile).label}`;
      return;
    }

    if (pendingByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.preparing')} · ${activeAgentMode(profile).label}`;
      return;
    }

    providerHint.title = `${profile.name} · ${i18n.t('provider.ready')} · ${activeAgentMode(profile).label}`;
  }

  function renderContextSummary() {
    if (!contextSummary) {
      return i18n.t('context.waiting');
    }

    const parts = [];
    if (contextSummary.workspace) {
      parts.push(contextSummary.workspace);
    }
    if (contextSummary.activeFile) {
      parts.push(contextSummary.activeFile);
    }
    if (contextSummary.selection) {
      parts.push(i18n.t('context.selectionValue', { value: contextSummary.selection }));
    }
    if (contextSummary.diagnostics) {
      parts.push(i18n.t('context.problemsValue', { count: String(contextSummary.diagnostics) }));
    }

    return parts.length
      ? `${i18n.t('context.prefix')}: ${parts.join(', ')}`
      : i18n.t('context.none');
  }

  function hasSelectionContext() {
    return Boolean(contextSummary?.selection);
  }

  function actionRequiresSelection(action) {
    return action === 'explainSelection' || action === 'refactorSelection';
  }

  function actionLabel(action) {
    const option = actionSelect.querySelector(`option[value="${action}"]`);
    return option?.textContent || i18n.t(`action.${action}`) || action;
  }

  function parseSlashInput(value) {
    const text = String(value || '');
    if (!text.startsWith('/') || text.includes('\n')) {
      return null;
    }

    const match = /^\/([^\s]*)\s*([\s\S]*)$/.exec(text);
    return match
      ? { query: match[1].toLowerCase(), args: (match[2] || '').trim() }
      : null;
  }

  function slashCommandMatchesProvider(command, profile) {
    return !command.providers || command.providers.includes(profile?.id);
  }

  function slashCommandMatchesQuery(command, query) {
    if (!query) {
      return true;
    }

    const names = [command.name, ...(command.aliases || [])];
    return names.some((name) => name.toLowerCase().startsWith(query));
  }

  function slashCommandDescription(command, profile = activeProfile()) {
    return i18n.t(command.descriptionKey || 'slash.native.desc', {
      provider: profile?.name || activeId,
    });
  }

  function commandsForActiveProvider() {
    const profile = activeProfile();
    return SLASH_COMMANDS.filter((command) => slashCommandMatchesProvider(command, profile));
  }

  function renderSlashPalette() {
    if (!slashPalette) {
      return;
    }

    const parsed = parseSlashInput(input.value);
    if (!parsed || input.disabled) {
      hideSlashPalette();
      return;
    }

    const profile = activeProfile();
    slashMatches = commandsForActiveProvider()
      .filter((command) => slashCommandMatchesQuery(command, parsed.query))
      .slice(0, 10);
    slashActiveIndex = Math.max(0, Math.min(slashActiveIndex, slashMatches.length - 1));
    slashPalette.innerHTML = '';

    if (slashMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-empty';
      empty.textContent = i18n.t('slash.empty');
      slashPalette.appendChild(empty);
      slashPalette.hidden = false;
      return;
    }

    slashMatches.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `slash-command${index === slashActiveIndex ? ' is-active' : ''}`;
      button.dataset.command = command.name;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === slashActiveIndex ? 'true' : 'false');

      const name = document.createElement('span');
      name.className = 'slash-command-name';
      name.textContent = `/${command.name}`;
      button.appendChild(name);

      const body = document.createElement('span');
      body.className = 'slash-command-body';
      const title = document.createElement('span');
      title.className = 'slash-command-title';
      title.textContent = command.kind === 'native' ? profile?.name || activeId : `/${command.name}`;
      const description = document.createElement('span');
      description.className = 'slash-command-description';
      description.textContent = slashCommandDescription(command, profile);
      body.appendChild(title);
      body.appendChild(description);
      button.appendChild(body);
      slashPalette.appendChild(button);
    });

    slashPalette.hidden = false;
  }

  function hideSlashPalette() {
    slashMatches = [];
    slashActiveIndex = 0;
    if (slashPalette) {
      slashPalette.hidden = true;
      slashPalette.innerHTML = '';
    }
  }

  function slashPaletteVisible() {
    return Boolean(slashPalette && !slashPalette.hidden);
  }

  function moveSlashSelection(delta) {
    if (slashMatches.length === 0) {
      return;
    }

    slashActiveIndex = (slashActiveIndex + delta + slashMatches.length) % slashMatches.length;
    renderSlashPalette();
  }

  function buildSlashCommandPrompt(command, args) {
    if (!args) {
      return command.prompt || '';
    }

    return command.prompt ? `${command.prompt}\n\n${args}` : args;
  }

  function buildSlashHelpMessage() {
    return commandsForActiveProvider()
      .slice(0, 24)
      .map((command) => `/${command.name} - ${slashCommandDescription(command)}`)
      .join('\n');
  }

  function latestCompletedAssistantText() {
    return ensureConversation(activeId)
      .slice()
      .reverse()
      .find((message) => message.role === 'assistant' && !message.running && normalizeMessageText(message.text).trim())
      ?.text;
  }

  function executeLocalSlashCommand(command) {
    switch (command.local) {
      case 'new':
        startNewThread(activeId);
        return;
      case 'help':
        addMessage(activeId, 'system', buildSlashHelpMessage());
        renderAll();
        return;
      case 'context':
        forceContextMenuVisible = true;
        contextMenu?.classList.add('is-visible');
        if (contextMenu) {
          contextMenu.open = true;
        }
        renderContextSummaryLabel();
        return;
      case 'refresh':
        vscode.postMessage({ command: 'checkProfiles' });
        vscode.postMessage({ command: 'refreshContext', contextOptions });
        return;
      case 'stop':
        if (runningByProvider[activeId]) {
          vscode.postMessage({ command: 'stop', cliId: activeId });
        } else {
          addMessage(activeId, 'system', i18n.t('slash.noRun'));
        }
        return;
      case 'copy':
        {
          const latest = latestCompletedAssistantText();
          if (!latest) {
            addMessage(activeId, 'system', i18n.t('slash.copyEmpty'));
            return;
          }
          void navigator.clipboard?.writeText(normalizeMessageText(latest));
          addMessage(activeId, 'system', i18n.t('slash.copied'));
        }
        return;
      default:
        return;
    }
  }

  function executeSlashCommand(command) {
    if (!command) {
      addMessage(activeId, 'system', i18n.t('slash.empty'));
      hideSlashPalette();
      return;
    }

    const parsed = parseSlashInput(input.value);
    const args = parsed?.args || '';
    input.value = '';
    input.style.height = 'auto';
    hideSlashPalette();

    if (command.kind === 'local') {
      executeLocalSlashCommand(command);
      renderComposer();
      return;
    }

    if (command.kind === 'native') {
      addMessage(
        activeId,
        'system',
        i18n.t('slash.unsupported', {
          command: `/${command.name}`,
          provider: activeProfile()?.name || activeId,
        })
      );
      renderComposer();
      return;
    }

    if (command.action) {
      command.prompt = buildSlashCommandPrompt(command, args);
      send(command.action, command.prompt, command.modeByProvider?.[activeId]);
    }
  }

  function renderContextChipText() {
    if (!contextSummary) {
      return i18n.t('context.compactPending');
    }

    const parts = [];
    if (contextSummary.selection) {
      parts.push(i18n.t('context.compactSelection'));
    } else if (contextSummary.activeFile) {
      parts.push(i18n.t('context.compactFile'));
    }
    if (contextSummary.diagnostics) {
      parts.push(i18n.t('context.compactProblems'));
    }
    if (parts.length === 0 && contextSummary.workspace) {
      parts.push(i18n.t('context.compactWorkspace'));
    }

    return parts.length ? parts.slice(0, 2).join('+') : i18n.t('context.compactNone');
  }

  function renderContextSummaryLabel() {
    const summary = renderContextSummary();
    contextSummaryLabel.textContent = renderContextChipText();
    contextSummaryLabel.closest('.context-summary')?.setAttribute('title', summary);
    contextMenu?.classList.toggle(
      'is-visible',
      Boolean(
        forceContextMenuVisible ||
        (contextSummary && (contextSummary.selection || contextSummary.activeFile || contextSummary.diagnostics))
      )
    );
  }

  function renderMessages() {
    const conversation = ensureConversation(activeId);
    const activeThread = ensureActiveThread(activeId);
    const isPending = Boolean(pendingByProvider[activeId]);
    messages.innerHTML = '';

    if (!activeId) {
      appendEmptyState(i18n.t('provider.noInstalled'), i18n.t('provider.unavailable'));
      return;
    }

    if (conversation.length === 0 && !isPending) {
      appendEmptyState(i18n.t('empty.title'), i18n.t('empty.subtitle'));
      return;
    }

    for (const item of conversation) {
      const itemRunning = Boolean(item.running && runningByProvider[activeId]);
      const wrapper = document.createElement('div');
      wrapper.className = `message ${item.role}${itemRunning ? ' is-running' : ''}`;

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';

      if (item.meta && item.role !== 'user') {
        const metaText = normalizeMessageText(item.meta);
        bubble.title = metaText;
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = metaText;
        bubble.appendChild(meta);
      }

      const body = document.createElement('div');
      body.className = 'message-content';
      renderMarkdownLite(body, normalizeMessageText(item.text));
      bubble.appendChild(body);

      if (itemRunning) {
        appendMessageStatus(
          bubble,
          item.text ? i18n.t('message.generating') : i18n.t('message.thinking')
        );
      }

      wrapper.appendChild(bubble);
      messages.appendChild(wrapper);
    }

    if (isPending && activeThread?.id === pendingThreadByProvider[activeId]) {
      appendLoadingMessage(i18n.t('message.preparing'));
    }

    messages.scrollTop = messages.scrollHeight;
  }

  function appendEmptyState(titleText, subtitleText) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';

      const title = document.createElement('div');
      title.className = 'empty-title';
      title.textContent = titleText;
      empty.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.className = 'empty-subtitle';
      subtitle.textContent = subtitleText;
      empty.appendChild(subtitle);

      const suggestions = document.createElement('div');
      suggestions.className = 'suggestion-list';
      const suggestionActions = [
        ['explainSelection', 'empty.explain'],
        ['reviewFile', 'empty.review'],
        ['generateTests', 'empty.tests'],
        ['refactorSelection', 'empty.refactor'],
      ];

      for (const [action, labelKey] of suggestionActions) {
      const button = document.createElement('button');
      button.className = 'suggestion-button';
      button.dataset.action = action;
      button.textContent = i18n.t(labelKey);
      if (actionRequiresSelection(action) && !hasSelectionContext()) {
        button.disabled = true;
        button.title = i18n.t('quick.missingSelection');
      }
      suggestions.appendChild(button);
    }

      empty.appendChild(suggestions);
      messages.appendChild(empty);
  }

  function appendLoadingMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant is-running';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    appendMessageStatus(bubble, text);

    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
  }

  function appendMessageStatus(container, text) {
    const status = document.createElement('div');
    status.className = 'message-status';

    const spinner = document.createElement('span');
    spinner.className = 'message-spinner';
    status.appendChild(spinner);

    const label = document.createElement('span');
    label.textContent = text;
    status.appendChild(label);

    container.appendChild(status);
  }

  function renderWorkflowMode() {
    renderAgentModeSelect();
  }

  function renderAgentModeSelect() {
    agentModeSelect.innerHTML = '';
    const profile = activeProfile();
    const modes = agentModesFor(profile);

    modes.forEach((mode) => {
      const option = document.createElement('option');
      option.value = mode.id;
      option.textContent = mode.label;
      option.title = mode.description || mode.instruction || mode.label;
      agentModeSelect.appendChild(option);
    });

    agentModeSelect.value = activeAgentModeId(activeId);
    const mode = activeAgentMode();
    agentModeSelect.title = mode?.description || i18n.t('agentMode.label');
    if (agentModeSummaryLabel) {
      agentModeSummaryLabel.textContent = mode?.label || i18n.t('agentMode.short');
      agentModeSummaryLabel.closest('.mode-summary')?.setAttribute(
        'title',
        `${profile?.name || i18n.t('provider.label')} · ${mode?.description || mode?.label || ''}`.trim()
      );
    }
    modeMenu?.classList.toggle('is-visible', Boolean(profile && mode?.id !== profile?.defaultAgentMode));
  }

  function renderContextControls() {
    document.querySelectorAll('[data-context]').forEach((checkbox) => {
      checkbox.checked = Boolean(contextOptions[checkbox.dataset.context]);
    });
  }

  function renderComposer() {
    const profile = activeProfile();
    const canSend = Boolean(profile && profile.installed);
    const busy = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
    const hasPrompt = input.value.trim().length > 0;
    const selectedAction = actionSelect.value || 'freeform';
    const missingSelection = actionRequiresSelection(selectedAction) && !hasSelectionContext();
    const canRunAction = hasPrompt || selectedAction !== 'freeform';
    input.disabled = !canSend;
    sendBtn.disabled = !canSend || busy || !canRunAction || missingSelection;
    document.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      button.disabled = !canSend || busy || (actionRequiresSelection(action) && !hasSelectionContext());
      button.title = button.disabled && actionRequiresSelection(action)
        ? i18n.t('quick.missingSelection')
        : '';
    });
    actionSelect.disabled = !canSend || busy;
    providerSelect.disabled = installedProfiles().length === 0 || busy;
    threadSelect.disabled = !activeId || busy;
    agentModeSelect.disabled = !canSend || busy;
    input.placeholder = canSend
      ? (missingSelection
          ? i18n.t('quick.missingSelection')
          : i18n.t(
              selectedAction === 'freeform' ? 'input.placeholderProvider' : 'input.placeholderAction',
              { provider: profile.name, action: actionLabel(selectedAction) }
            ))
      : i18n.t('input.placeholderDisabled');
    const running = Boolean(runningByProvider[activeId]);
    stopBtn.classList.toggle('is-visible', running);
    sendBtn.classList.toggle('is-hidden', running);
    renderSlashPalette();
  }

  function renderAll() {
    const profile = activeProfile();
    document.body.dataset.provider = activeId || 'none';
    setAccent(profile);
    renderProviderSelect();
    renderThreadSelect();
    renderWorkflowMode();
    renderContextControls();
    renderProviderHint();
    renderContextSummaryLabel();
    renderMessages();
    renderComposer();
  }

  function send(action, text, preferredWorkflowMode) {
    const profile = activeProfile();
    if (!profile || !profile.installed) {
      addMessage(activeId, 'error', i18n.t('provider.unavailable'));
      return;
    }
    if (runningByProvider[activeId] || pendingByProvider[activeId]) {
      return;
    }

    const finalText = (text || input.value || '').trim();
    if (!finalText && action === 'freeform') {
      input.focus();
      return;
    }
    if (actionRequiresSelection(action) && !hasSelectionContext()) {
      addMessage(activeId, 'error', i18n.t('quick.missingSelection'));
      return;
    }

    pendingByProvider[activeId] = true;
    pendingThreadByProvider[activeId] = activeThreadId(activeId);
    renderAll();
    input.value = '';
    input.style.height = 'auto';

    vscode.postMessage({
      command: action === 'freeform' ? 'send' : 'quickAction',
      cliId: activeId,
      text: finalText,
      mode: 'agent',
      agentMode: preferredWorkflowMode || activeAgentModeId(activeId),
      action,
      contextOptions,
    });
  }

  function addMessage(cliId, role, text, meta, running, threadId) {
    const thread = ensureThread(cliId, threadId);
    const conversation = thread?.messages || [];
    conversation.push({ role, text, meta, running: Boolean(running) });
    touchThread(thread, role === 'user' ? text : undefined);
    persist();
    if (cliId === activeId) {
      renderMessages();
    }
    return { threadId: thread?.id || '', index: conversation.length - 1 };
  }

  function updateStream(message) {
    let target = streamTargets[message.sessionId];
    if (!target) {
      const result = addMessage(
        message.cliId,
        message.stream === 'error' ? 'error' : 'assistant',
        '',
        undefined,
        true
      );
      target = { cliId: message.cliId, threadId: result.threadId, index: result.index, buffer: '' };
      streamTargets[message.sessionId] = target;
    }

    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item) {
      return;
    }

    const buffered = `${target.buffer || item.text || ''}${normalizeMessageText(message.text)}`;
    const filtered = filterInternalPromptEcho(buffered);
    target.buffer = filtered.pending ? buffered : filtered.text;
    item.text = filtered.text;
    if (message.stream === 'error') {
      item.role = 'error';
    }
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function markSessionEnded(message) {
    const target = streamTargets[message.sessionId];
    if (target) {
      const item = ensureConversation(target.cliId, target.threadId)[target.index];
      if (item) {
        item.running = false;
        if (!normalizeMessageText(item.text).trim()) {
          ensureConversation(target.cliId, target.threadId).splice(target.index, 1);
        }
      }
      delete streamTargets[message.sessionId];
    }

    runningByProvider[message.cliId] = false;
    pendingByProvider[message.cliId] = false;
    delete pendingThreadByProvider[message.cliId];
    if (Number(message.exitCode) !== 0) {
      addMessage(
        message.cliId,
        'system',
        i18n.t('message.runFinishedCode', { code: String(message.exitCode) }),
        undefined,
        false,
        target?.threadId
      );
    }
    persist();
    renderAll();
  }

  function quickActionText(action) {
    switch (action) {
      case 'explainSelection':
        return i18n.t('quick.explain.text');
      case 'reviewFile':
        return i18n.t('quick.review.text');
      case 'generateTests':
        return i18n.t('quick.tests.text');
      case 'refactorSelection':
        return i18n.t('quick.refactor.text');
      default:
        return '';
    }
  }

  function agentModeLabel(value) {
    const profile = activeProfile();
    const mode = agentModesFor(profile).find((item) => item.id === value);
    return mode?.label || value || i18n.t('agentMode.label');
  }

  function summarizeRequestContext(summary) {
    if (!summary) {
      return undefined;
    }

    const parts = [];
    if (summary.activeFile) {
      parts.push(summary.activeFile);
    }
    if (summary.selection) {
      parts.push(summary.selection);
    }
    if (summary.diagnostics) {
      parts.push(i18n.t('context.problemsValue', { count: String(summary.diagnostics) }));
    }

    return parts.length ? `${i18n.t('context.prefix')}: ${parts.join(', ')}` : undefined;
  }

  function renderMarkdownLite(container, text) {
    const lines = String(text || '').split('\n');
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        const language = trimmed.replace(/^```/, '').trim();
        const codeLines = [];
        index += 1;

        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }

        appendCodeBlock(container, codeLines.join('\n'), language);
        index += index < lines.length ? 1 : 0;
        continue;
      }

      if (isTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        index += 2;
        while (index < lines.length && isTableRow(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        appendTable(container, tableLines);
        continue;
      }

      appendMarkdownLine(container, line);
      index += 1;
    }
  }

  function appendMarkdownLine(container, line) {
    const trimmed = line.trim();
    if (!trimmed) {
      const spacer = document.createElement('div');
      spacer.className = 'md-spacer';
      container.appendChild(spacer);
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const node = document.createElement('div');
      node.className = `md-heading level-${heading[1].length}`;
      appendInlineMarkdown(node, heading[2]);
      container.appendChild(node);
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      const rule = document.createElement('div');
      rule.className = 'md-rule';
      container.appendChild(rule);
      return;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      const node = document.createElement('div');
      node.className = 'md-blockquote';
      appendInlineMarkdown(node, quote[1]);
      container.appendChild(node);
      return;
    }

    const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (task) {
      appendListItem(container, task[1].trim() ? '✓' : '□', task[2], 'md-list-item');
      return;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      appendListItem(container, '•', bullet[1], 'md-list-item');
      return;
    }

    const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      appendListItem(container, `${numbered[1]}.`, numbered[2], 'md-numbered-item');
      return;
    }

    const paragraph = document.createElement('div');
    paragraph.className = 'md-paragraph';
    appendInlineMarkdown(paragraph, line);
    container.appendChild(paragraph);
  }

  function isTableStart(lines, index) {
    return isTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
  }

  function isTableRow(line) {
    return typeof line === 'string' && line.includes('|') && line.replace(/\|/g, '').trim();
  }

  function isTableSeparator(line) {
    if (!isTableRow(line)) {
      return false;
    }

    return splitTableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function splitTableCells(line) {
    const cells = line.trim().split('|');
    if (cells[0] === '') {
      cells.shift();
    }
    if (cells[cells.length - 1] === '') {
      cells.pop();
    }
    return cells.map((cell) => cell.trim());
  }

  function appendTable(container, lines) {
    const headers = splitTableCells(lines[0]);
    const rows = lines.slice(2).map(splitTableCells);
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';

    const table = document.createElement('table');
    table.className = 'md-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      appendInlineMarkdown(th, header);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      headers.forEach((_, cellIndex) => {
        const td = document.createElement('td');
        appendInlineMarkdown(td, row[cellIndex] || '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function appendListItem(container, marker, text, className) {
    const item = document.createElement('div');
    item.className = className;

    const markerNode = document.createElement('span');
    markerNode.className = 'md-marker';
    markerNode.textContent = marker;
    item.appendChild(markerNode);

    const content = document.createElement('span');
    appendInlineMarkdown(content, text);
    item.appendChild(content);

    container.appendChild(item);
  }

  function appendCodeBlock(container, code, language) {
    const wrap = document.createElement('div');
    wrap.className = 'md-code-wrap';

    if (language) {
      const label = document.createElement('div');
      label.className = 'md-code-label';
      label.textContent = language;
      wrap.appendChild(label);
    }

    const pre = document.createElement('pre');
    pre.className = 'md-code-block';
    pre.textContent = code;
    wrap.appendChild(pre);
    container.appendChild(wrap);
  }

  function appendInlineMarkdown(container, text) {
    const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const token = match[0];
      if (token.startsWith('[')) {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        const anchor = document.createElement('a');
        anchor.className = 'md-link';
        anchor.textContent = link?.[1] || token;
        anchor.href = link?.[2] || '#';
        anchor.title = link?.[2] || '';
        container.appendChild(anchor);
      } else if (token.startsWith('**')) {
        const strong = document.createElement('strong');
        strong.className = 'md-strong';
        strong.textContent = token.slice(2, -2);
        container.appendChild(strong);
      } else {
        const code = document.createElement('code');
        code.className = 'md-code';
        code.textContent = token.slice(1, -1);
        container.appendChild(code);
      }

      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function selectedAction() {
    return actionSelect.value || 'freeform';
  }

  function sendSelectedAction() {
    const slash = parseSlashInput(input.value);
    if (slash) {
      executeSlashCommand(slashMatches[slashActiveIndex]);
      return;
    }

    const action = selectedAction();
    send(action, input.value || quickActionText(action));
  }

  sendBtn.addEventListener('click', sendSelectedAction);

  newChatBtn.addEventListener('click', () => {
    startNewThread(activeId);
  });

  deleteThreadBtn.addEventListener('click', () => {
    if (!window.confirm(i18n.t('history.deleteConfirm'))) {
      return;
    }

    const threadId = activeThreadId(activeId);
    const threads = ensureThreadList(activeId);
    const index = threads.findIndex((thread) => thread.id === threadId);
    if (index >= 0) {
      threads.splice(index, 1);
    }

    const next = threads.sort((a, b) => b.updatedAt - a.updatedAt)[0] || createThread(activeId);
    if (!threads.includes(next)) {
      threads.push(next);
    }
    setActiveThread(activeId, next);
    persist();
    renderAll();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 104)}px`;
    renderComposer();
  });

  input.addEventListener('keydown', (event) => {
    if (slashPaletteVisible()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashSelection(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        executeSlashCommand(slashMatches[slashActiveIndex]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendSelectedAction();
    }
  });

  slashPalette?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  slashPalette?.addEventListener('click', (event) => {
    const button = event.target.closest('.slash-command');
    if (!button) {
      return;
    }

    const command = slashMatches.find((item) => item.name === button.dataset.command);
    executeSlashCommand(command);
  });

  stopBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'stop', cliId: activeId });
  });

  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'checkProfiles' });
    vscode.postMessage({ command: 'refreshContext', contextOptions });
  });

  reloadBtn?.addEventListener('click', () => {
    vscode.postMessage({ command: 'reloadWindow' });
  });

  providerSelect.addEventListener('change', () => {
    activeId = providerSelect.value;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    persist();
    renderAll();
  });

  threadSelect.addEventListener('change', () => {
    activeThreadByProvider[activeId] = threadSelect.value;
    persist();
    renderAll();
  });

  actionSelect.addEventListener('change', renderComposer);

  agentModeSelect.addEventListener('change', () => {
    activeAgentModeByProvider[activeId] = agentModeSelect.value;
    legacyWorkflowMode = undefined;
    persist();
    renderAll();
  });

  document.querySelectorAll('[data-context]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      contextOptions[checkbox.dataset.context] = checkbox.checked;
      persist();
      vscode.postMessage({ command: 'refreshContext', contextOptions });
      renderContextSummaryLabel();
    });
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      actionSelect.value = action;
      send(action, input.value || quickActionText(action));
    });
  });

  messages.addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion-button');
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    actionSelect.value = action;
    send(action, input.value || quickActionText(action));
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'profiles':
        profiles = message.profiles || [];
        {
          const availableProfiles = installedProfiles();
          const defaultProfile = availableProfiles.find(
            (profile) => profile.id === message.defaultProviderId
          );
          if (!activeId || !availableProfiles.some((profile) => profile.id === activeId)) {
            activeId = defaultProfile?.id || availableProfiles[0]?.id || '';
          }
        }
        persist();
        renderAll();
        break;
      case 'contextSummary':
        contextSummary = message.summary;
        renderProviderHint();
        renderContextSummaryLabel();
        break;
      case 'requestStarted':
        activeId = message.cliId;
        pendingByProvider[message.cliId] = false;
        runningByProvider[message.cliId] = true;
        activeAgentModeByProvider[message.cliId] = message.agentMode || activeAgentModeId(message.cliId);
        {
          const threadId = pendingThreadByProvider[message.cliId] || activeThreadId(message.cliId);
          activeThreadByProvider[message.cliId] = threadId;
          addMessage(
            message.cliId,
            'user',
            normalizeMessageText(message.text),
            `${message.actionLabel}${i18n.t('message.metaSeparator')}${agentModeLabel(message.agentMode)}`
          );
          const assistant = addMessage(
            message.cliId,
            'assistant',
            '',
            summarizeRequestContext(message.contextSummary),
            true,
            threadId
          );
          streamTargets[message.sessionId] = {
            cliId: message.cliId,
            threadId,
            index: assistant.index,
            buffer: '',
          };
        }
        persist();
        renderAll();
        break;
      case 'output':
        updateStream(message);
        break;
      case 'sessionEnd':
        markSessionEnded(message);
        break;
      case 'stopped':
        runningByProvider[message.cliId] = false;
        pendingByProvider[message.cliId] = false;
        {
          const target = streamTargets[message.sessionId];
          if (target) {
            delete streamTargets[message.sessionId];
          }
          delete pendingThreadByProvider[message.cliId];
          addMessage(message.cliId, 'system', i18n.t('message.runStopped'), undefined, false, target?.threadId);
        }
        renderAll();
        break;
      case 'error':
        runningByProvider[message.cliId || activeId] = false;
        pendingByProvider[message.cliId || activeId] = false;
        delete pendingThreadByProvider[message.cliId || activeId];
        addMessage(
          message.cliId || activeId,
          'error',
          normalizeMessageText(message.text) || i18n.t('message.unknownError')
        );
        renderAll();
        break;
    }
  });

  vscode.postMessage({ command: 'checkProfiles' });
  vscode.postMessage({ command: 'refreshContext', contextOptions });
  renderAll();
})();
