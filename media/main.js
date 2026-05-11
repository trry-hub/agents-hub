(function () {
  const vscode = acquireVsCodeApi();
  const i18n = window.AssistantI18n;
  i18n.apply();

  const ORPHAN_ANSI_PATTERN = /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])/g;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
  const INTERNAL_PROMPT_END_MARKER = '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';
  const MAX_IMAGE_ATTACHMENTS = 8;
  const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
  const TASK_STATUSES = ['preparing', 'running', 'completed', 'failed', 'stopped'];
  const TASK_ACTIVE_STATUSES = ['preparing', 'running'];
  const VISUAL_TASK_BOARD_ENABLED = false;
  const MESSAGE_BOTTOM_STICKY_THRESHOLD = 48;

  const saved = vscode.getState() || {};
  let profiles = [];
  let activeId = saved.activeId || '';
  let activeAgentModeByProvider = saved.activeAgentModeByProvider || {};
  let activeModelByProvider = saved.activeModelByProvider || {};
  let customModelByProvider = saved.customModelByProvider || {};
  let activeRuntimeByProvider = saved.activeRuntimeByProvider || {};
  let activePermissionByProvider = saved.activePermissionByProvider || {};
  let apiProviderSettings = { customProviders: [], defaultProviderId: '', agentProviderByCliId: {} };
  let homeAgentSettings = { visibleAgentIds: [], agentOrder: [] };
  let apiProviderEnvStatusById = {};
  let editingApiProviderId = '';
  let activeSettingsSection = 'agents';
  let claudeTerminalBannerDismissed = Boolean(saved.claudeTerminalBannerDismissed);
  let taskBoardDismissed = Boolean(saved.taskBoardDismissed);
  let legacyWorkflowMode = saved.workflowMode || (saved.mode === 'agent' ? 'execute' : undefined);
  let hasAppliedPersistentSelection = false;
  let threadsByProvider = normalizeSavedThreads(saved.threadsByProvider, saved.conversations);
  let tasks = normalizeSavedTasks(saved.tasks);
  let activeThreadByProvider = saved.activeThreadByProvider || {};
  let contextOptions = saved.contextOptions || {
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  };
  let contextSummary = null;
  let streamTargets = {};
  let taskBySessionId = {};
  let pendingTaskByProvider = {};
  let runningByProvider = {};
  let pendingByProvider = {};
  let pendingThreadByProvider = {};
  let messageStatusTimer = undefined;
  let renderedMessageThreadKey = '';
  let promptAttachments = [];

  const taskBoard = document.getElementById('taskBoard');
  const providerSelect = document.getElementById('providerSelect');
  const providerTabs = document.getElementById('providerTabs');
  const providerHint = document.getElementById('providerHint');
  const modelSelect = document.getElementById('modelSelect');
  const modelSummaryLabel = document.getElementById('modelSummaryLabel');
  const modelOptionList = document.getElementById('modelOptionList');
  const customModelField = document.getElementById('customModelField');
  const customModelInput = document.getElementById('customModelInput');
  const runtimeSelect = document.getElementById('runtimeSelect');
  const runtimeSummaryLabel = document.getElementById('runtimeSummaryLabel');
  const runtimeOptionList = document.getElementById('runtimeOptionList');
  const permissionSelect = document.getElementById('permissionSelect');
  const permissionSummaryLabel = document.getElementById('permissionSummaryLabel');
  const permissionOptionList = document.getElementById('permissionOptionList');
  const agentModeSelect = document.getElementById('agentModeSelect');
  const agentModeSummaryLabel = document.getElementById('agentModeSummaryLabel');
  const agentModeOptionList = document.getElementById('agentModeOptionList');
  const actionSelect = document.getElementById('actionSelect');
  const threadSelect = document.getElementById('threadSelect');
  const deleteThreadBtn = document.getElementById('deleteThreadBtn');
  const contextSummaryLabel = document.getElementById('contextSummaryLabel');
  const contextBudget = document.getElementById('contextBudget');
  const contextBudgetPopover = contextBudget?.querySelector('.context-budget-popover');
  const contextBudgetLabel = document.getElementById('contextBudgetLabel');
  const contextBudgetPercent = document.getElementById('contextBudgetPercent');
  const contextBudgetTokens = document.getElementById('contextBudgetTokens');
  const contextBudgetTokenizer = document.getElementById('contextBudgetTokenizer');
  const contextBudgetPolicy = document.getElementById('contextBudgetPolicy');
  const slashPalette = document.getElementById('slashPalette');
  const claudeTerminalBanner = document.getElementById('claudeTerminalBanner');
  const claudeTerminalDismiss = document.getElementById('claudeTerminalDismiss');
  const claudeContextBtn = document.getElementById('claudeContextBtn');
  const codexTerminalBanner = document.getElementById('codexTerminalBanner');
  const codexTerminalStop = document.getElementById('codexTerminalStop');
  const codexTerminalOpen = document.getElementById('codexTerminalOpen');
  const modelMenu = document.querySelector('.model-menu');
  const runtimeMenu = document.querySelector('.runtime-menu');
  const permissionMenu = document.querySelector('.permission-menu');
  const modeMenu = document.querySelector('.mode-menu');
  const contextMenu = document.querySelector('.context-menu');
  const messages = document.getElementById('messages');
  const input = document.getElementById('promptInput');
  const attachmentStrip = document.getElementById('attachmentStrip');
  const attachImageBtn = document.getElementById('attachImageBtn');
  const imageFileInput = document.getElementById('imageFileInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const composerSettingsBtn = document.getElementById('composerSettingsBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const apiSettingsPage = document.getElementById('apiProviderSettingsPage');
  const apiSettingsBack = document.getElementById('apiProviderSettingsClose');
  const settingsNav = document.getElementById('settingsNav');
  const settingsNavAgents = document.getElementById('settingsNavAgents');
  const settingsNavApiProviders = document.getElementById('settingsNavApiProviders');
  const settingsSectionAgents = document.getElementById('settingsSectionAgents');
  const settingsSectionApiProviders = document.getElementById('settingsSectionApiProviders');
  const homeAgentList = document.getElementById('homeAgentList');
  const homeAgentsReset = document.getElementById('homeAgentsReset');
  const homeAgentsSave = document.getElementById('homeAgentsSave');
  const apiProviderList = document.getElementById('apiProviderList');
  const apiProviderAdd = document.getElementById('apiProviderAdd');
  const apiProviderForm = document.getElementById('apiProviderForm');
  const apiProviderName = document.getElementById('apiProviderName');
  const apiProviderBaseUrl = document.getElementById('apiProviderBaseUrl');
  const apiProviderApiKeyEnv = document.getElementById('apiProviderApiKeyEnv');
  const apiProviderModel = document.getElementById('apiProviderModel');
  const apiProviderEnabled = document.getElementById('apiProviderEnabled');
  const apiProviderExtraEnv = document.getElementById('apiProviderExtraEnv');
  const apiProviderAddEnv = document.getElementById('apiProviderAddEnv');
  const apiProviderDefaultSelect = document.getElementById('apiProviderDefaultSelect');
  const apiProviderAgentBindings = document.getElementById('apiProviderAgentBindings');
  const apiProviderSettingsError = document.getElementById('apiProviderSettingsError');
  const apiProviderDelete = document.getElementById('apiProviderDelete');
  const apiProviderCancel = document.getElementById('apiProviderCancel');
  const SLASH_COMMANDS = [
    { name: 'new', kind: 'local', local: 'new', descriptionKey: 'slash.new.desc' },
    { name: 'clear', kind: 'local', local: 'new', descriptionKey: 'slash.clear.desc' },
    { name: 'help', kind: 'local', local: 'help', descriptionKey: 'slash.help.desc' },
    { name: 'context', kind: 'local', local: 'context', descriptionKey: 'slash.context.desc' },
    { name: 'refresh', kind: 'local', local: 'refresh', descriptionKey: 'slash.refresh.desc' },
    { name: 'stop', kind: 'local', local: 'stop', descriptionKey: 'slash.stop.desc' },
    { name: 'copy', kind: 'local', local: 'copy', descriptionKey: 'slash.copy.desc' },
    { name: 'models', aliases: ['model'], kind: 'local', local: 'models', providers: ['opencode'], descriptionKey: 'slash.models.desc' },
    { name: 'agents', aliases: ['agent'], kind: 'local', local: 'agents', providers: ['opencode'], descriptionKey: 'slash.agents.desc' },
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
      modeByProvider: { claude: 'plan', codex: 'plan', opencode: 'plan', gemini: 'plan', goose: 'plan' },
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
      activeModelByProvider,
      customModelByProvider,
      activeRuntimeByProvider,
      activePermissionByProvider,
      claudeTerminalBannerDismissed,
      taskBoardDismissed,
      threadsByProvider: serializeThreadsForState(threadsByProvider),
      tasks: serializeTasksForState(tasks),
      activeThreadByProvider,
      contextOptions,
    });
  }

  function persistedSelectionMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(([providerId, modeId]) => (
        typeof providerId === 'string' && typeof modeId === 'string'
      ))
    );
  }

  function persistUserSelection() {
    if (!activeId) {
      return;
    }

    vscode.postMessage({
      command: 'saveSelectionState',
      activeProviderId: activeId,
      activeAgentModeByProvider,
    });
  }

  function serializeThreadsForState(source) {
    const serialized = {};
    Object.entries(source || {}).forEach(([cliId, threads]) => {
      serialized[cliId] = (threads || []).map((thread) => ({
        ...thread,
        messages: (thread.messages || []).map((message) => {
          if (!message || typeof message !== 'object') {
            return message;
          }
          const { startedAt, ...rest } = message;
          return { ...rest, running: false };
        }),
      }));
    });
    return serialized;
  }

  function serializeTasksForState(source) {
    return (source || []).slice(0, 20).map((task) => ({
      ...task,
      status: task.status === 'running' || task.status === 'preparing' ? 'stopped' : task.status,
      sessionId: undefined,
    }));
  }

  function activeProfile() {
    return profiles.find((profile) => profile.id === activeId);
  }

  function installedProfiles() {
    return profiles.filter((profile) => profile.installed);
  }

  function orderedInstalledProfiles() {
    const installed = installedProfiles();
    const orderIds = normalizeHomeAgentSettings(homeAgentSettings).agentOrder;
    if (orderIds.length === 0) {
      return installed;
    }

    const byId = new Map(installed.map((profile) => [profile.id, profile]));
    const ordered = orderIds
      .map((id) => byId.get(id))
      .filter(Boolean);
    const orderedIds = new Set(ordered.map((profile) => profile.id));
    return ordered.concat(installed.filter((profile) => !orderedIds.has(profile.id)));
  }

  function visibleInstalledProfiles() {
    const installed = orderedInstalledProfiles();
    const visibleIds = normalizeHomeAgentSettings(homeAgentSettings).visibleAgentIds;
    if (visibleIds.length === 0) {
      return installed;
    }

    const visibleSet = new Set(visibleIds);
    const visible = installed.filter((profile) => visibleSet.has(profile.id));
    return visible.length > 0 ? visible : installed;
  }

  function formatProviderVersion(version) {
    const value = String(version || '').trim();
    if (!value) {
      return '';
    }

    return value.replace(/^v/i, '');
  }

  function providerIconUri(profile) {
    const icon = profile?.webviewIcon;
    if (!icon) {
      return '';
    }

    const prefersDarkIcon =
      document.body.classList.contains('vscode-dark') ||
      document.body.classList.contains('vscode-high-contrast');
    return prefersDarkIcon ? icon.dark || icon.light || '' : icon.light || icon.dark || '';
  }

  function formatTokenCount(tokens) {
    const value = Math.max(0, Math.round(Number(tokens) || 0));
    if (value >= 1000000) {
      return `${Math.round(value / 100000) / 10}m`;
    }
    if (value >= 1000) {
      return `${Math.round(value / 1000)}k`;
    }

    return String(value);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Math.round(Number(bytes) || 0));
    if (value >= 1024 * 1024) {
      const mb = value / (1024 * 1024);
      return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${value} B`;
  }

  function attachmentPayload(attachment) {
    return {
      kind: 'image',
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      dataUrl: attachment.dataUrl,
    };
  }

  function clipboardImageFiles(dataTransfer) {
    const files = [];
    Array.from(dataTransfer?.items || []).forEach((item) => {
      if (item.kind !== 'file' || !item.type?.startsWith('image/')) {
        return;
      }
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    });

    if (files.length === 0) {
      Array.from(dataTransfer?.files || []).forEach((file) => {
        if (file?.type?.startsWith('image/')) {
          files.push(file);
        }
      });
    }

    return files;
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(files) {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
    for (const file of imageFiles) {
      if (promptAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
        addMessage(activeId, 'error', i18n.t('attachment.tooMany', { count: String(MAX_IMAGE_ATTACHMENTS) }));
        break;
      }
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        addMessage(
          activeId,
          'error',
          i18n.t('attachment.tooLarge', {
            name: file.name || i18n.t('attachment.imageLabel'),
            size: formatBytes(MAX_IMAGE_ATTACHMENT_BYTES),
          })
        );
        continue;
      }

      try {
        const dataUrl = await readImageFile(file);
        promptAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'image',
          name: file.name || i18n.t('attachment.imageLabel'),
          mimeType: file.type || 'image/png',
          size: file.size,
          dataUrl,
        });
      } catch {
        addMessage(activeId, 'error', i18n.t('attachment.readFailed'));
      }
    }

    renderAttachmentStrip();
    renderComposer();
  }

  function renderAttachmentStrip() {
    if (!attachmentStrip) {
      return;
    }

    attachmentStrip.innerHTML = '';
    attachmentStrip.hidden = promptAttachments.length === 0;
    promptAttachments.forEach((attachment) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const preview = document.createElement('img');
      preview.src = attachment.dataUrl;
      preview.alt = '';
      chip.appendChild(preview);

      const label = document.createElement('span');
      label.textContent = attachment.name;
      label.title = `${attachment.name} · ${formatBytes(attachment.size)}`;
      chip.appendChild(label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.attachmentId = attachment.id;
      remove.setAttribute('aria-label', i18n.t('attachment.remove'));
      remove.title = i18n.t('attachment.remove');
      remove.textContent = 'x';
      chip.appendChild(remove);

      attachmentStrip.appendChild(chip);
    });
  }

  function normalizeMessageAttachments(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => attachment?.kind === 'image')
      .map((attachment) => ({
        kind: 'image',
        name: attachment.name || i18n.t('attachment.imageLabel'),
        mimeType: attachment.mimeType || 'image/png',
        size: Number(attachment.size) || 0,
        path: attachment.path || '',
      }));
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

  function normalizeSavedTasks(savedTasks) {
    return (Array.isArray(savedTasks) ? savedTasks : [])
      .filter((task) => task && typeof task === 'object' && task.providerId)
      .slice(0, 20)
      .map((task) => ({
        id: task.id || makeTaskId(task.providerId),
        providerId: task.providerId,
        providerName: task.providerName || task.providerId,
        title: task.title || i18n.t('task.untitled'),
        action: task.action || 'freeform',
        agentMode: task.agentMode || '',
        status: task.status === 'running' || task.status === 'preparing' ? 'stopped' : (task.status || 'completed'),
        threadId: task.threadId || '',
        createdAt: Number(task.createdAt) || Date.now(),
        updatedAt: Number(task.updatedAt) || Date.now(),
      }));
  }

  function makeThreadId(cliId) {
    return `${cliId || 'thread'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeTaskId(providerId) {
    return `${providerId || 'task'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  function conversationHistoryForSend(cliId) {
    return ensureConversation(cliId, activeThreadId(cliId))
      .filter((message) => (
        message &&
        !message.running &&
        (message.role === 'user' || message.role === 'assistant') &&
        normalizeMessageText(message.text).trim()
      ))
      .slice(-8)
      .map((message) => ({
        role: message.role,
        text: normalizeMessageText(message.text).replace(/\s+/g, ' ').trim().slice(0, 1200),
      }));
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

  function createRunTask(providerId, action, text, agentMode) {
    const profile = profiles.find((item) => item.id === providerId);
    const now = Date.now();
    const task = {
      id: makeTaskId(providerId),
      providerId,
      providerName: profile?.name || providerId,
      title: deriveThreadTitle(text) || i18n.t('task.untitled'),
      action: action || 'freeform',
      agentMode: agentMode || '',
      status: 'preparing',
      threadId: activeThreadId(providerId),
      createdAt: now,
      updatedAt: now,
    };

    tasks = [task, ...tasks.filter((item) => item.id !== task.id)].slice(0, 20);
    persist();
    renderTaskBoard();
    return task;
  }

  function updateTaskStatus(taskId, updates = {}) {
    if (!taskId) {
      return undefined;
    }

    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return undefined;
    }

    Object.assign(task, updates, { updatedAt: Date.now() });
    persist();
    renderTaskBoard();
    return task;
  }

  function setAccent(profile) {
    document.documentElement.style.setProperty(
      '--assistant-accent',
      profile?.accent || 'var(--vscode-focusBorder)'
    );
  }

  function agentModesFor(profile) {
    const modes = Array.isArray(profile?.agentModes) && profile.agentModes.length > 0
      ? profile.agentModes
      : [
          {
            id: 'agent',
            label: 'Agent',
            description: '',
            instruction: 'Use this provider as a coding agent.',
          },
        ];
    const selectableModes = modes.filter((mode) => !mode.disabled);
    return selectableModes.length > 0 ? selectableModes : modes;
  }

  function normalizeAgentModeId(profile, value) {
    const modes = agentModesFor(profile);
    const selectableModes = modes.filter((item) => !item.disabled);
    const mode = selectableModes.find((item) => item.id === value)
      || selectableModes.find((item) => item.id === profile?.defaultAgentMode)
      || selectableModes[0]
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

  function optionListFor(profile, key, fallbackLabelKey) {
    const options = Array.isArray(profile?.[key]) ? profile[key] : [];
    return options.length > 0
      ? options
      : [{ id: 'default', label: i18n.t(fallbackLabelKey), description: '' }];
  }

  function selectableOption(option) {
    return !option?.disabled && !option?.actionOnly;
  }

  function normalizeOptionId(profile, value, key, defaultKey, fallbackLabelKey) {
    const options = optionListFor(profile, key, fallbackLabelKey);
    const selectableOptions = options.filter(selectableOption);
    const pool = selectableOptions.length > 0 ? selectableOptions : options;
    const option = pool.find((item) => item.id === value)
      || pool.find((item) => item.id === profile?.[defaultKey])
      || pool[0];

    return option.id;
  }

  function modelOptionsFor(profile) {
    return optionListFor(profile, 'modelOptions', 'model.short');
  }

  function runtimeModesFor(profile) {
    return optionListFor(profile, 'runtimeModes', 'runtime.short');
  }

  function permissionModesFor(profile) {
    return optionListFor(profile, 'permissionModes', 'permission.short');
  }

  function localizedCliOption(option, group) {
    if (!option) {
      return option;
    }

    const labelKey = `option.${group}.${option.id}`;
    const descriptionKey = `${labelKey}.description`;
    const translatedLabel = i18n.t(labelKey);
    const translatedDescription = i18n.t(descriptionKey);

    return {
      ...option,
      label: translatedLabel === labelKey ? option.label : translatedLabel,
      summaryLabel: i18n.t(`${labelKey}.summary`) === `${labelKey}.summary`
        ? option.summaryLabel
        : i18n.t(`${labelKey}.summary`),
      description: translatedDescription === descriptionKey ? option.description : translatedDescription,
    };
  }

  function splitAgentModeLabel(label) {
    const value = String(label || '').replace(/\u200b/g, '').trim();
    const parts = value.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return { title: value, detail: '' };
    }

    return { title: parts[0], detail: parts.slice(1).join(' - ') };
  }

  function localizedPermissionOption(option) {
    const displayOption = localizedCliOption(option, 'permission');
    if (activeProfile()?.id === 'claude' && option?.id === 'default') {
      return {
        ...displayOption,
        label: i18n.t('claude.permission.askBeforeEdits'),
        summaryLabel: i18n.t('claude.permission.askBeforeEdits'),
      };
    }

    return displayOption;
  }

  function activeModelId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activeModelByProvider[cliId],
      'modelOptions',
      'defaultModel',
      'model.short'
    );
    activeModelByProvider[cliId] = normalized;
    return normalized;
  }

  function activeCustomModel(cliId = activeId) {
    return String(customModelByProvider[cliId] || '').trim();
  }

  function activeRuntimeId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activeRuntimeByProvider[cliId],
      'runtimeModes',
      'defaultRuntime',
      'runtime.short'
    );
    activeRuntimeByProvider[cliId] = normalized;
    return normalized;
  }

  function activePermissionId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activePermissionByProvider[cliId],
      'permissionModes',
      'defaultPermissionMode',
      'permission.short'
    );
    activePermissionByProvider[cliId] = normalized;
    return normalized;
  }

  function activeModel(profile = activeProfile()) {
    const options = modelOptionsFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activeModelId(profile?.id)) || options[0];
  }

  function activeRuntime(profile = activeProfile()) {
    const options = runtimeModesFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activeRuntimeId(profile?.id)) || options[0];
  }

  function activePermission(profile = activeProfile()) {
    const options = permissionModesFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activePermissionId(profile?.id)) || options[0];
  }

  function mapLegacyWorkflowMode(profile, value) {
    const modes = agentModesFor(profile);
    const desired = {
      auto: profile?.defaultAgentMode,
      plan: 'plan',
      execute: profile?.defaultAgentMode,
    }[value];

    return modes.some((mode) => mode.id === desired) ? desired : undefined;
  }

  function renderProviderSelect() {
    providerSelect.innerHTML = '';
    const availableProfiles = visibleInstalledProfiles();

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
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);

    for (const profile of availableProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      providerSelect.appendChild(option);
    }

    providerSelect.value = activeId;
    providerSelect.disabled = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
  }

  function renderProviderTabs() {
    if (!providerTabs) {
      return;
    }

    const availableProfiles = visibleInstalledProfiles();
    providerTabs.hidden = availableProfiles.length === 0;

    if (availableProfiles.length === 0) {
      providerTabs.innerHTML = '';
      return;
    }

    const existingButtons = new Map();
    for (const child of Array.from(providerTabs.children)) {
      if (child instanceof HTMLButtonElement && child.dataset.providerId) {
        existingButtons.set(child.dataset.providerId, child);
      }
    }

    const activeIsBusy = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);

    for (const profile of availableProfiles) {
      const isActive = profile.id === activeId;
      const versionLabel = formatProviderVersion(profile.version);
      const button = existingButtons.get(profile.id) || document.createElement('button');

      button.type = 'button';
      button.dataset.providerId = profile.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(isActive));
      button.title = `${profile.name}${versionLabel ? ` · ${versionLabel}` : ''}`;
      button.disabled = activeIsBusy && !isActive;
      button.className = 'provider-tab-button';
      if (isActive) {
        button.classList.add('is-active');
      }

      const iconUri = providerIconUri(profile);
      button.replaceChildren();
      if (iconUri) {
        const logo = document.createElement('img');
        logo.className = 'provider-tab-logo';
        logo.src = iconUri;
        logo.alt = '';
        logo.draggable = false;
        button.appendChild(logo);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'provider-tab-logo';
        fallback.textContent = profile.icon || profile.name.slice(0, 1);
        button.appendChild(fallback);
      }

      providerTabs.appendChild(button);
      existingButtons.delete(profile.id);
    }

    existingButtons.forEach((button) => button.remove());
  }

  function normalizeHomeAgentSettings(value) {
    const record = value && typeof value === 'object' ? value : {};
    const visibleAgentIds = normalizeHomeAgentIds(record.visibleAgentIds);
    const agentOrder = normalizeHomeAgentIds(record.agentOrder);
    return { visibleAgentIds, agentOrder };
  }

  function normalizeHomeAgentIds(value) {
    const rawIds = Array.isArray(value) ? value : [];
    const seen = new Set();
    return rawIds
      .map((id) => String(id || '').trim())
      .filter((id) => {
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
  }

  function openSettingsPage(section = 'agents') {
    if (!apiSettingsPage) {
      return;
    }
    activeSettingsSection = section === 'apiProviders' ? 'apiProviders' : 'agents';
    if (!editingApiProviderId) {
      editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
    }
    renderSettingsPage();
    apiSettingsPage.hidden = false;
    document.body.classList.add('is-api-settings-open');
    const focusTarget = activeSettingsSection === 'apiProviders'
      ? apiProviderName
      : homeAgentList?.querySelector('input');
    focusTarget?.focus();
  }

  function renderSettingsPage() {
    renderSettingsSection();
    renderHomeAgentSettings();
    renderApiProviderSettings();
  }

  function renderSettingsSection() {
    const isAgents = activeSettingsSection === 'agents';
    settingsNavAgents?.classList.toggle('is-active', isAgents);
    settingsNavApiProviders?.classList.toggle('is-active', !isAgents);
    settingsNavAgents?.setAttribute('aria-current', isAgents ? 'page' : 'false');
    settingsNavApiProviders?.setAttribute('aria-current', !isAgents ? 'page' : 'false');
    if (settingsSectionAgents) {
      settingsSectionAgents.hidden = !isAgents;
    }
    if (settingsSectionApiProviders) {
      settingsSectionApiProviders.hidden = isAgents;
    }
  }

  function renderHomeAgentSettings() {
    if (!homeAgentList) {
      return;
    }
    homeAgentList.innerHTML = '';
    const availableProfiles = installedProfiles();
    if (availableProfiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-provider-status';
      empty.textContent = i18n.t('provider.noInstalled');
      homeAgentList.appendChild(empty);
      return;
    }

    const selectedIds = homeAgentSelectionForUi();
    const orderedProfiles = orderedInstalledProfiles();
    orderedProfiles.forEach((profile, index) => {
      const row = document.createElement('div');
      row.className = 'home-agent-item';
      row.dataset.homeAgentId = profile.id;

      const checkbox = document.createElement('input');
      checkbox.id = `homeAgent-${profile.id}`;
      checkbox.type = 'checkbox';
      checkbox.dataset.homeAgentId = profile.id;
      checkbox.checked = selectedIds.has(profile.id);
      row.appendChild(checkbox);

      const icon = document.createElement('span');
      icon.className = 'home-agent-icon';
      const iconUri = providerIconUri(profile);
      if (iconUri) {
        const logo = document.createElement('img');
        logo.src = iconUri;
        logo.alt = '';
        logo.draggable = false;
        icon.appendChild(logo);
      } else {
        icon.textContent = profile.icon || profile.name.slice(0, 1);
      }
      row.appendChild(icon);

      const copy = document.createElement('label');
      copy.className = 'home-agent-copy';
      copy.htmlFor = checkbox.id;
      const name = document.createElement('span');
      name.className = 'home-agent-name';
      name.textContent = profile.name;
      copy.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'home-agent-meta';
      const version = formatProviderVersion(profile.version);
      meta.textContent = version
        ? i18n.t('homeAgents.installedVersion', { version })
        : i18n.t('provider.readyShort');
      copy.appendChild(meta);
      row.appendChild(copy);

      const sort = document.createElement('span');
      sort.className = 'home-agent-sort';
      sort.appendChild(createHomeAgentMoveButton(profile, 'up', index === 0));
      sort.appendChild(createHomeAgentMoveButton(profile, 'down', index === orderedProfiles.length - 1));
      row.appendChild(sort);

      homeAgentList.appendChild(row);
    });
  }

  function createHomeAgentMoveButton(profile, direction, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-agent-sort-button';
    button.dataset.homeAgentId = profile.id;
    button.dataset.homeAgentMove = direction;
    button.disabled = disabled;
    const labelKey = direction === 'up' ? 'homeAgents.moveUp' : 'homeAgents.moveDown';
    const label = i18n.t(labelKey, { name: profile.name });
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = direction === 'up'
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 9.5 8 6l3.5 3.5"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>';
    return button;
  }

  function homeAgentSelectionForUi() {
    const installedIds = orderedInstalledProfiles().map((profile) => profile.id);
    const configured = normalizeHomeAgentSettings(homeAgentSettings).visibleAgentIds;
    const selectedIds = configured.length > 0
      ? configured.filter((id) => installedIds.includes(id))
      : installedIds;
    return new Set(selectedIds.length > 0 ? selectedIds : installedIds);
  }

  function collectHomeAgentSettings() {
    const checkedIds = Array.from(homeAgentList?.querySelectorAll('input[data-home-agent-id]:checked') || [])
      .map((input) => input.dataset.homeAgentId)
      .filter(Boolean);
    const agentOrder = Array.from(homeAgentList?.querySelectorAll('.home-agent-item[data-home-agent-id]') || [])
      .map((item) => item.dataset.homeAgentId)
      .filter(Boolean);
    const installedIds = orderedInstalledProfiles().map((profile) => profile.id);
    const allSelected = installedIds.length > 0 && checkedIds.length === installedIds.length;
    return normalizeHomeAgentSettings({ visibleAgentIds: allSelected ? [] : checkedIds, agentOrder });
  }

  function moveHomeAgent(agentId, direction) {
    const settings = collectHomeAgentSettings();
    const order = settings.agentOrder.length > 0
      ? settings.agentOrder.slice()
      : orderedInstalledProfiles().map((profile) => profile.id);
    const fromIndex = order.indexOf(agentId);
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= order.length) {
      return;
    }

    [order[fromIndex], order[toIndex]] = [order[toIndex], order[fromIndex]];
    homeAgentSettings = normalizeHomeAgentSettings({ ...settings, agentOrder: order });
    renderAll();
    renderHomeAgentSettings();
    homeAgentList
      ?.querySelector(`button[data-home-agent-id="${agentId}"][data-home-agent-move="${direction}"]`)
      ?.focus();
  }

  function saveHomeAgentSettings() {
    homeAgentSettings = collectHomeAgentSettings();
    vscode.postMessage({ command: 'saveHomeAgentSettings', settings: homeAgentSettings });
    renderAll();
    renderHomeAgentSettings();
  }

  function normalizeApiProviderSettings(value) {
    const record = value && typeof value === 'object' ? value : {};
    const providers = Array.isArray(record.customProviders)
      ? record.customProviders
          .filter((provider) => provider && typeof provider === 'object')
          .map((provider, index) => ({
            id: sanitizeApiProviderId(provider.id || provider.name || `provider-${index + 1}`),
            name: String(provider.name || `Custom Provider ${index + 1}`).trim(),
            baseUrl: String(provider.baseUrl || '').trim(),
            apiKeyEnv: sanitizeEnvName(provider.apiKeyEnv || ''),
            model: String(provider.model || '').trim(),
            extraEnv: normalizeExtraEnv(provider.extraEnv),
            enabled: provider.enabled !== false,
          }))
      : [];
    const enabledIds = new Set(providers.filter((provider) => provider.enabled).map((provider) => provider.id));
    const defaultProviderId = enabledIds.has(record.defaultProviderId) ? record.defaultProviderId : '';
    const agentProviderByCliId = {};
    const bindings = record.agentProviderByCliId && typeof record.agentProviderByCliId === 'object'
      ? record.agentProviderByCliId
      : {};
    Object.entries(bindings).forEach(([cliId, providerId]) => {
      if (providerId === 'inherit' || enabledIds.has(providerId)) {
        agentProviderByCliId[cliId] = providerId;
      }
    });
    return { customProviders: providers, defaultProviderId, agentProviderByCliId };
  }

  function normalizeExtraEnv(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value).reduce((result, [key, rawValue]) => {
      const envName = sanitizeEnvName(key);
      if (envName && typeof rawValue === 'string') {
        result[envName] = rawValue;
      }
      return result;
    }, {});
  }

  function sanitizeApiProviderId(value) {
    const id = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return id || `provider-${Date.now()}`;
  }

  function sanitizeEnvName(value) {
    return String(value || '').replace(/[^A-Za-z0-9_]/g, '');
  }

  function openApiProviderSettings() {
    openSettingsPage('agents');
  }

  function closeApiProviderSettings() {
    if (apiSettingsPage) {
      apiSettingsPage.hidden = true;
    }
    document.body.classList.remove('is-api-settings-open');
    clearApiSettingsError();
  }

  function createApiProviderDraft(id) {
    return {
      id: id || `custom-${Date.now()}`,
      name: '',
      baseUrl: '',
      apiKeyEnv: '',
      model: '',
      extraEnv: {},
      enabled: true,
    };
  }

  function currentApiProvider() {
    return apiProviderSettings.customProviders.find((provider) => provider.id === editingApiProviderId)
      || apiProviderSettings.customProviders[0]
      || undefined;
  }

  function renderApiProviderSettings() {
    renderApiProviderList();
    renderApiProviderForm();
    renderApiProviderBindings();
  }

  function renderApiProviderList() {
    if (!apiProviderList) {
      return;
    }
    apiProviderList.innerHTML = '';
    if (apiProviderSettings.customProviders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-provider-status';
      empty.textContent = i18n.t('apiSettings.noProviders');
      apiProviderList.appendChild(empty);
      return;
    }

    apiProviderSettings.customProviders.forEach((provider) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `api-provider-list-item${provider.id === editingApiProviderId ? ' is-active' : ''}${provider.enabled ? '' : ' is-disabled'}`;
      button.dataset.providerId = provider.id;

      const name = document.createElement('span');
      name.textContent = provider.name || provider.id;
      button.appendChild(name);

      const status = document.createElement('span');
      status.className = 'api-provider-status';
      status.textContent = provider.enabled ? '' : i18n.t('apiSettings.disabled');
      const envStatus = apiProviderEnvStatusById[provider.id];
      if (provider.enabled && envStatus?.apiKeyEnv && envStatus.apiKeyEnvAvailable === false) {
        status.textContent = i18n.t('apiSettings.missingKeyEnv', { envName: envStatus.apiKeyEnv });
      }
      button.appendChild(status);

      apiProviderList.appendChild(button);
    });
  }

  function renderApiProviderForm() {
    const provider = currentApiProvider();
    const disabled = !provider;
    [apiProviderName, apiProviderBaseUrl, apiProviderApiKeyEnv, apiProviderModel].forEach((field) => {
      if (field) {
        field.disabled = disabled;
      }
    });
    if (apiProviderEnabled) {
      apiProviderEnabled.disabled = disabled;
    }
    if (apiProviderDelete) {
      apiProviderDelete.disabled = disabled;
    }

    if (!provider) {
      if (apiProviderName) apiProviderName.value = '';
      if (apiProviderBaseUrl) apiProviderBaseUrl.value = '';
      if (apiProviderApiKeyEnv) apiProviderApiKeyEnv.value = '';
      if (apiProviderModel) apiProviderModel.value = '';
      if (apiProviderEnabled) apiProviderEnabled.checked = true;
      renderExtraEnvRows({});
      return;
    }

    editingApiProviderId = provider.id;
    if (apiProviderName) apiProviderName.value = provider.name;
    if (apiProviderBaseUrl) apiProviderBaseUrl.value = provider.baseUrl;
    if (apiProviderApiKeyEnv) apiProviderApiKeyEnv.value = provider.apiKeyEnv;
    if (apiProviderModel) apiProviderModel.value = provider.model;
    if (apiProviderEnabled) apiProviderEnabled.checked = provider.enabled;
    renderExtraEnvRows(provider.extraEnv);
  }

  function renderExtraEnvRows(extraEnv) {
    if (!apiProviderExtraEnv) {
      return;
    }
    apiProviderExtraEnv.innerHTML = '';
    const entries = Object.entries(extraEnv);
    if (entries.length === 0) {
      entries.push(['', '']);
    }
    entries.forEach(([key, value]) => {
      apiProviderExtraEnv.appendChild(createExtraEnvRow(key, value));
    });
  }

  function createExtraEnvRow(key, value) {
    const row = document.createElement('div');
    row.className = 'api-extra-env-row';

    const keyInput = document.createElement('input');
    keyInput.dataset.envKey = 'true';
    keyInput.placeholder = 'ENV_NAME';
    keyInput.value = key;
    row.appendChild(keyInput);

    const valueInput = document.createElement('input');
    valueInput.dataset.envValue = 'true';
    valueInput.placeholder = 'value';
    valueInput.value = value;
    row.appendChild(valueInput);

    const remove = document.createElement('button');
    remove.className = 'api-env-remove';
    remove.type = 'button';
    remove.dataset.removeEnv = 'true';
    remove.textContent = '×';
    row.appendChild(remove);
    return row;
  }

  function renderApiProviderBindings() {
    renderApiProviderDefaultSelect();
    if (!apiProviderAgentBindings) {
      return;
    }
    apiProviderAgentBindings.innerHTML = '';
    profiles.forEach((profile) => {
      const row = document.createElement('label');
      row.className = 'api-agent-binding';

      const label = document.createElement('span');
      label.className = 'api-agent-binding-label';
      label.textContent = profile.name;
      row.appendChild(label);

      const select = document.createElement('select');
      select.dataset.cliId = profile.id;
      appendApiProviderOption(select, 'inherit', i18n.t('apiSettings.inherit'));
      enabledApiProviders().forEach((provider) => {
        appendApiProviderOption(select, provider.id, provider.name);
      });
      select.value = apiProviderSettings.agentProviderByCliId[profile.id] || 'inherit';
      row.appendChild(select);

      apiProviderAgentBindings.appendChild(row);
    });
  }

  function renderApiProviderDefaultSelect() {
    if (!apiProviderDefaultSelect) {
      return;
    }
    apiProviderDefaultSelect.innerHTML = '';
    appendApiProviderOption(apiProviderDefaultSelect, '', i18n.t('apiSettings.none'));
    enabledApiProviders().forEach((provider) => {
      appendApiProviderOption(apiProviderDefaultSelect, provider.id, provider.name);
    });
    apiProviderDefaultSelect.value = apiProviderSettings.defaultProviderId || '';
  }

  function appendApiProviderOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function enabledApiProviders() {
    return apiProviderSettings.customProviders.filter((provider) => provider.enabled);
  }

  function collectApiProviderForm() {
    const provider = currentApiProvider() || createApiProviderDraft(editingApiProviderId);
    const name = apiProviderName?.value.trim() || '';
    if (!name) {
      showApiSettingsError(i18n.t('apiSettings.nameRequired'));
      return undefined;
    }

    const nextProvider = {
      ...provider,
      name,
      baseUrl: apiProviderBaseUrl?.value.trim() || '',
      apiKeyEnv: sanitizeEnvName(apiProviderApiKeyEnv?.value || ''),
      model: apiProviderModel?.value.trim() || '',
      enabled: Boolean(apiProviderEnabled?.checked),
      extraEnv: collectExtraEnvRows(),
    };
    const providers = apiProviderSettings.customProviders.some((item) => item.id === nextProvider.id)
      ? apiProviderSettings.customProviders.map((item) => item.id === nextProvider.id ? nextProvider : item)
      : [...apiProviderSettings.customProviders, nextProvider];
    const enabledIds = new Set(providers.filter((item) => item.enabled).map((item) => item.id));
    const defaultProviderId = enabledIds.has(apiProviderDefaultSelect?.value || '')
      ? apiProviderDefaultSelect.value
      : '';
    const agentProviderByCliId = {};
    apiProviderAgentBindings?.querySelectorAll('select[data-cli-id]').forEach((select) => {
      if (select.value === 'inherit' || enabledIds.has(select.value)) {
        agentProviderByCliId[select.dataset.cliId] = select.value;
      }
    });

    return normalizeApiProviderSettings({
      customProviders: providers,
      defaultProviderId,
      agentProviderByCliId,
    });
  }

  function collectExtraEnvRows() {
    const result = {};
    apiProviderExtraEnv?.querySelectorAll('.api-extra-env-row').forEach((row) => {
      const key = sanitizeEnvName(row.querySelector('[data-env-key]')?.value || '');
      const value = row.querySelector('[data-env-value]')?.value || '';
      if (key) {
        result[key] = value;
      }
    });
    return result;
  }

  function showApiSettingsError(text) {
    if (!apiProviderSettingsError) {
      return;
    }
    apiProviderSettingsError.textContent = text;
    apiProviderSettingsError.hidden = false;
  }

  function clearApiSettingsError() {
    if (!apiProviderSettingsError) {
      return;
    }
    apiProviderSettingsError.textContent = '';
    apiProviderSettingsError.hidden = true;
  }

  function saveApiProviderSettings() {
    const next = collectApiProviderForm();
    if (!next) {
      return;
    }
    apiProviderSettings = next;
    clearApiSettingsError();
    vscode.postMessage({ command: 'saveApiProviderSettings', settings: apiProviderSettings });
    renderApiProviderSettings();
  }

  function providerStateLabel(profile) {
    if (!profile?.installed) {
      return i18n.t('provider.missing');
    }
    if (runningByProvider[profile.id]) {
      return i18n.t('provider.running');
    }
    if (pendingByProvider[profile.id]) {
      return i18n.t('provider.preparing');
    }
    return i18n.t('provider.ready');
  }

  function composerMenus() {
    return [modelMenu, runtimeMenu, permissionMenu, modeMenu, contextMenu].filter(Boolean);
  }

  function closeComposerMenus(exceptMenu) {
    composerMenus().forEach((menu) => {
      if (menu !== exceptMenu) {
        menu.open = false;
      }
    });
  }

  function composerPopoverFor(menu) {
    return menu?.querySelector('.option-popover, .mode-popover, .context-popover');
  }

  function scheduleComposerPopoverPosition() {
    requestAnimationFrame(positionOpenComposerPopovers);
  }

  function positionOpenComposerPopovers() {
    composerMenus().forEach((menu) => {
      if (!menu.open) {
        return;
      }
      positionComposerPopover(menu);
    });
  }

  function positionComposerPopover(menu) {
    const summary = menu?.querySelector('summary');
    const popover = composerPopoverFor(menu);
    if (!summary || !popover) {
      return;
    }

    const viewportPadding = 8;
    const gap = 6;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const triggerRect = summary.getBoundingClientRect();
    const availableWidth = Math.max(180, viewportWidth - viewportPadding * 2);

    popover.style.setProperty('--composer-popover-max-width', `${Math.round(availableWidth)}px`);
    popover.style.setProperty('--composer-popover-max-height', `${Math.max(120, viewportHeight - viewportPadding * 2)}px`);

    const popoverRect = popover.getBoundingClientRect();
    const popoverWidth = Math.min(popoverRect.width || availableWidth, availableWidth);
    const spaceAbove = Math.max(0, triggerRect.top - viewportPadding - gap);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - viewportPadding - gap);
    const openAbove = spaceAbove >= Math.min(popoverRect.height || 0, 240) || spaceAbove >= spaceBelow;
    const availableHeight = Math.max(120, openAbove ? spaceAbove : spaceBelow);
    const popoverHeight = Math.min(popoverRect.height || availableHeight, availableHeight);
    const alignToEnd = menu === modelMenu || menu === permissionMenu || menu === modeMenu || menu === runtimeMenu;

    let left = alignToEnd ? triggerRect.right - popoverWidth : triggerRect.left;
    left = Math.min(left, viewportWidth - viewportPadding - popoverWidth);
    left = Math.max(viewportPadding, left);

    let top = openAbove ? triggerRect.top - gap - popoverHeight : triggerRect.bottom + gap;
    top = Math.min(top, viewportHeight - viewportPadding - popoverHeight);
    top = Math.max(viewportPadding, top);

    popover.style.setProperty('--composer-popover-left', `${Math.round(left)}px`);
    popover.style.setProperty('--composer-popover-top', `${Math.round(top)}px`);
    popover.style.setProperty('--composer-popover-max-height', `${Math.round(availableHeight)}px`);
  }

  function refreshActiveContext() {
    if (!activeId) {
      return;
    }
    vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions });
  }

  function switchActiveProvider(providerId) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile?.installed || activeId === providerId) {
      return;
    }

    activeId = providerId;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);
    persist();
    persistUserSelection();
    renderAll();
    refreshActiveContext();
    input.focus();
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

    const versionLabel = formatProviderVersion(profile.version);

    if (runningByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.running')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
      return;
    }

    if (pendingByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.preparing')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
      return;
    }

    providerHint.title = `${profile.name} · ${i18n.t('provider.ready')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
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
    const seen = new Set();
    const commands = [];
    for (const command of SLASH_COMMANDS) {
      if (!slashCommandMatchesProvider(command, profile) || seen.has(command.name)) {
        continue;
      }

      seen.add(command.name);
      commands.push(command);
    }

    return commands;
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

      const title = document.createElement('span');
      title.className = 'slash-command-title';
      title.textContent = `/${command.name}`;
      const description = document.createElement('span');
      description.className = 'slash-command-description';
      description.textContent = slashCommandDescription(command, profile);
      button.appendChild(title);
      button.appendChild(description);
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

  function executeLocalSlashCommand(command, args = '') {
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
        vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions });
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
          vscode.postMessage({ command: 'copyMessageText', text: markdownToCopyPlainText(latest) });
          addMessage(activeId, 'system', i18n.t('slash.copied'));
        }
        return;
      case 'models':
        if (modelMenu) {
          closeComposerMenus(modelMenu);
          modelMenu.classList.add('is-visible');
          modelMenu.open = true;
        }
        renderComposer();
        return;
      case 'agents':
        if (modeMenu) {
          closeComposerMenus(modeMenu);
          modeMenu.classList.add('is-visible');
          modeMenu.open = true;
        }
        renderComposer();
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
      executeLocalSlashCommand(command, args);
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
        (
          contextSummary &&
          (
            contextSummary.selection ||
            contextSummary.activeFile ||
            contextSummary.diagnostics ||
            contextSummary.workspace
          )
        )
      )
    );
  }

  function renderContextBudget() {
    if (
      !contextBudget ||
      !contextBudgetLabel ||
      !contextBudgetPercent ||
      !contextBudgetTokens ||
      !contextBudgetTokenizer ||
      !contextBudgetPolicy
    ) {
      return;
    }

    const profile = activeProfile();
    const tokenUsage = contextSummary?.tokenUsage;
    if (!profile || !contextSummary || !tokenUsage) {
      contextBudget.hidden = true;
      contextBudgetLabel.textContent = '';
      contextBudget.title = '';
      return;
    }

    contextBudget.hidden = false;
    const isExact = tokenUsage.precision === 'exact' && Number.isFinite(Number(tokenUsage.tokens));
    contextBudget.classList.toggle('has-total', Boolean(isExact && profile.contextWindowTokens));
    contextBudget.classList.toggle('is-unavailable', !isExact);

    if (!isExact) {
      contextBudgetLabel.textContent = 'ctx';
      contextBudgetPercent.textContent = i18n.t('contextWindow.exactUnavailable', { provider: profile.name });
      contextBudgetTokens.textContent = tokenUsage.reason || i18n.t('contextWindow.providerManaged', { provider: profile.name });
      contextBudgetTokenizer.textContent = tokenUsage.tokenizer
        ? i18n.t('contextWindow.tokenizer', { tokenizer: tokenUsage.tokenizer })
        : '';
      contextBudgetPolicy.textContent = i18n.t('contextWindow.providerManaged', { provider: profile.name });
      contextBudget.title = [
        i18n.t('contextWindow.title'),
        contextBudgetPercent.textContent,
        contextBudgetTokens.textContent,
      ].filter(Boolean).join(' ');
      positionContextBudgetPopover();
      return;
    }

    const usedTokens = Math.max(0, Math.round(Number(tokenUsage.tokens) || 0));
    const totalTokens = Math.max(0, Math.round(Number(profile.contextWindowTokens) || 0));
    const hasTotal = totalTokens > 0;
    const used = formatTokenCount(usedTokens);

    if (hasTotal) {
      const usedPercent = Math.min(100, Math.max(usedTokens > 0 ? 1 : 0, Math.round((usedTokens / totalTokens) * 100)));
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const total = formatTokenCount(totalTokens);
      contextBudgetLabel.textContent = `${usedPercent}%`;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedRemaining', {
        usedPercent: String(usedPercent),
        remainingPercent: String(remainingPercent),
      });
      contextBudgetTokens.textContent = i18n.t('contextWindow.usedTotal', { used, total });
    } else {
      contextBudgetLabel.textContent = used;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedOnly', { used });
      contextBudgetTokens.textContent = '';
    }

    contextBudgetTokenizer.textContent = tokenUsage.tokenizer
      ? i18n.t('contextWindow.tokenizer', { tokenizer: tokenUsage.tokenizer })
      : '';
    contextBudgetPolicy.textContent = profile.autoCompactsContext
      ? i18n.t('contextWindow.autoCompact', { provider: profile.name })
      : i18n.t('contextWindow.providerManaged', { provider: profile.name });
    contextBudget.title = [
      i18n.t('contextWindow.title'),
      contextBudgetPercent.textContent,
      contextBudgetTokens.textContent,
      contextBudgetTokenizer.textContent,
      contextBudgetPolicy.textContent,
    ].filter(Boolean).join(' ');
    positionContextBudgetPopover();
  }

  function positionContextBudgetPopover() {
    if (!contextBudget || !contextBudgetPopover || contextBudget.hidden) {
      return;
    }

    const viewportPadding = 10;
    const triggerRect = contextBudget.getBoundingClientRect();
    const popoverWidth = contextBudgetPopover.offsetWidth;
    let left = 0;
    const rightOverflow = triggerRect.left + left + popoverWidth - (window.innerWidth - viewportPadding);
    if (rightOverflow > 0) {
      left -= rightOverflow;
    }

    const leftOverflow = triggerRect.left + left - viewportPadding;
    if (leftOverflow < 0) {
      left -= leftOverflow;
    }

    contextBudget.style.setProperty('--context-budget-popover-left', `${Math.round(left)}px`);
  }

  function taskStatusCounts(source) {
    const counts = TASK_STATUSES.reduce((result, status) => ({ ...result, [status]: 0 }), {});
    (source || []).forEach((task) => {
      const status = TASK_STATUSES.includes(task.status) ? task.status : 'completed';
      counts[status] += 1;
    });
    return counts;
  }

  function isActiveTask(task) {
    return TASK_ACTIVE_STATUSES.includes(task?.status);
  }

  function visibleTasksForBoard() {
    if (!VISUAL_TASK_BOARD_ENABLED || taskBoardDismissed) {
      return [];
    }

    const activeTasks = tasks.filter(isActiveTask);
    if (activeTasks.length === 0) {
      return [];
    }

    return activeTasks.slice(0, 12);
  }

  function renderTaskBoard() {
    if (!taskBoard) {
      return;
    }

    const visibleTasks = visibleTasksForBoard();
    taskBoard.innerHTML = '';
    taskBoard.hidden = visibleTasks.length === 0;
    if (visibleTasks.length === 0) {
      return;
    }

    const counts = taskStatusCounts(visibleTasks);
    const summary = document.createElement('div');
    summary.className = 'task-board-summary';
    summary.setAttribute('aria-label', i18n.t('taskBoard.summary'));
    TASK_STATUSES.filter((status) => counts[status] > 0).forEach((status) => {
      const pill = document.createElement('span');
      pill.className = `task-status-pill is-${status}`;
      pill.dataset.taskStatus = status;
      pill.textContent = i18n.t('taskBoard.count', {
        status: i18n.t(`task.status.${status}`),
        count: String(counts[status]),
      });
      summary.appendChild(pill);
    });
    taskBoard.appendChild(summary);

    const currentTask = visibleTasks.find(isActiveTask) || visibleTasks[0];
    const menuTasks = visibleTasks.filter((task) => task.id !== currentTask.id);
    const current = document.createElement('button');
    current.type = 'button';
    current.className = `task-board-current is-${currentTask.status}`;
    current.dataset.taskId = currentTask.id;
    current.dataset.providerId = currentTask.providerId;
    current.dataset.threadId = currentTask.threadId || '';
    current.title = [
      currentTask.providerName,
      i18n.t(`task.status.${currentTask.status}`),
      currentTask.title,
    ].filter(Boolean).join(' · ');

    const currentDot = document.createElement('span');
    currentDot.className = 'task-board-current-dot';
    currentDot.setAttribute('aria-hidden', 'true');
    current.appendChild(currentDot);

    const currentBody = document.createElement('span');
    currentBody.className = 'task-board-current-body';

    const currentTitle = document.createElement('span');
    currentTitle.className = 'task-board-current-title';
    currentTitle.textContent = currentTask.title || i18n.t('task.untitled');
    currentBody.appendChild(currentTitle);

    const currentMeta = document.createElement('span');
    currentMeta.className = 'task-board-current-meta';
    currentMeta.textContent = [
      currentTask.providerName,
      i18n.t(`task.status.${currentTask.status}`),
      currentTask.agentMode || '',
    ].filter(Boolean).join(' · ');
    currentBody.appendChild(currentMeta);
    current.appendChild(currentBody);
    taskBoard.appendChild(current);

    const menu = document.createElement('details');
    menu.className = 'task-board-menu';
    menu.hidden = menuTasks.length === 0;

    const menuSummary = document.createElement('summary');
    menuSummary.className = 'task-board-menu-summary';
    menuSummary.textContent = `+${menuTasks.length}`;
    menuSummary.title = i18n.t('taskBoard.summary');
    menu.appendChild(menuSummary);

    const popover = document.createElement('div');
    popover.className = 'task-board-popover';
    menuTasks.forEach((task) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `task-board-row is-${task.status}`;
      button.dataset.taskId = task.id;
      button.dataset.providerId = task.providerId;
      button.dataset.threadId = task.threadId || '';
      button.title = [
        task.providerName,
        i18n.t(`task.status.${task.status}`),
        task.title,
      ].filter(Boolean).join(' · ');

      const statusDot = document.createElement('span');
      statusDot.className = 'task-board-row-dot';
      statusDot.setAttribute('aria-hidden', 'true');
      button.appendChild(statusDot);

      const body = document.createElement('span');
      body.className = 'task-board-row-body';

      const title = document.createElement('span');
      title.className = 'task-board-row-title';
      title.textContent = task.title || i18n.t('task.untitled');
      body.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'task-board-row-meta';
      meta.textContent = [
        task.providerName,
        i18n.t(`task.status.${task.status}`),
        task.agentMode || '',
      ].filter(Boolean).join(' · ');
      body.appendChild(meta);

      button.appendChild(body);
      popover.appendChild(button);
    });
    menu.appendChild(popover);
    taskBoard.appendChild(menu);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'task-board-dismiss';
    dismiss.dataset.taskBoardDismiss = 'true';
    dismiss.title = i18n.t('action.dismiss');
    dismiss.setAttribute('aria-label', i18n.t('action.dismiss'));
    taskBoard.appendChild(dismiss);
  }

  function renderMessages() {
    const conversation = ensureConversation(activeId);
    const activeThread = ensureActiveThread(activeId);
    const messageThreadKey = `${activeId || 'none'}:${activeThread?.id || 'none'}`;
    const shouldStickToBottom = shouldAutoScrollMessages(messageThreadKey);
    const previousScrollTop = messages.scrollTop;
    const isPending = Boolean(pendingByProvider[activeId]);
    const selectedProfile = activeProfile();
    messages.innerHTML = '';

    if (!activeId || !selectedProfile) {
      const firstInstallHintProfile = profiles.find((profile) => profile?.installHint && !profile.installed);
      const noProviderSubtitle = firstInstallHintProfile
        ? providerUnavailableMessage(firstInstallHintProfile)
        : i18n.t('provider.unavailable');
      syncMessageStatusTimer(false);
      appendEmptyState(
        i18n.t('provider.noInstalled'),
        noProviderSubtitle,
        true,
        firstInstallHintProfile?.installHint
      );
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (conversation.length === 0 && !isPending) {
      syncMessageStatusTimer(false);
      if (!selectedProfile.installed) {
        appendEmptyState(
          i18n.t('provider.noInstalled'),
          providerUnavailableMessage(selectedProfile),
          true,
          selectedProfile.installHint
        );
        restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
        return;
      }

      appendEmptyState(i18n.t('empty.title'), i18n.t('empty.subtitle'));
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    let hasVisibleRunningMessage = false;
    for (const item of conversation) {
      const itemRunning = Boolean(item.running && runningByProvider[activeId]);
      hasVisibleRunningMessage = hasVisibleRunningMessage || itemRunning;
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

      if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        appendMessageAttachments(bubble, item.attachments);
      }

      if (item.role === 'assistant' && normalizeMessageText(item.text).trim()) {
        const copyActions = document.createElement('div');
        copyActions.className = 'message-actions';
        const copyButton = createMessageCopyButton();
        copyActions.appendChild(copyButton);
        bubble.appendChild(copyActions);
      }

      if (itemRunning) {
        appendMessageStatus(
          bubble,
          item.runningNotice ||
            runningMessageStatusText(
              item.text ? i18n.t('message.generating') : i18n.t('message.thinking'),
              item.startedAt
            )
        );
      }

      wrapper.appendChild(bubble);
      messages.appendChild(wrapper);
    }

    if (isPending && activeThread?.id === pendingThreadByProvider[activeId]) {
      appendLoadingMessage(i18n.t('message.preparing'));
    }

    syncMessageStatusTimer(hasVisibleRunningMessage);
    restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
  }

  function shouldAutoScrollMessages(threadKey) {
    if (threadKey !== renderedMessageThreadKey) {
      return true;
    }

    if (messages.scrollHeight <= messages.clientHeight) {
      return true;
    }

    const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
    return distanceFromBottom <= MESSAGE_BOTTOM_STICKY_THRESHOLD;
  }

  function restoreMessageScroll(shouldStickToBottom, previousScrollTop, threadKey) {
    if (shouldStickToBottom) {
      messages.scrollTop = messages.scrollHeight;
    } else {
      const maxScrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      messages.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
    renderedMessageThreadKey = threadKey;
  }

  function createMessageCopyButton() {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'message-copy-button';
    copyButton.dataset.messageCopy = 'true';
    copyButton.title = i18n.t('message.copy');
    copyButton.setAttribute('aria-label', i18n.t('message.copy'));
    copyButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 5.2h7v7h-7z"/><path d="M3.8 10.8h-1v-8h8v1"/></svg>';
    return copyButton;
  }

  function syncMessageStatusTimer(shouldRun) {
    if (shouldRun && !messageStatusTimer) {
      messageStatusTimer = setInterval(() => {
        renderMessages();
      }, 1000);
      return;
    }

    if (!shouldRun && messageStatusTimer) {
      clearInterval(messageStatusTimer);
      messageStatusTimer = undefined;
    }
  }

  function runningMessageStatusText(stage, startedAt) {
    const elapsed = formatElapsedTime(startedAt);
    return elapsed ? i18n.t('message.statusElapsed', { status: stage, elapsed }) : stage;
  }

  function formatElapsedTime(startedAt) {
    const start = Number(startedAt);
    if (!Number.isFinite(start) || start <= 0) {
      return '';
    }

    const totalSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}m ${seconds}s`;
  }

  function appendMessageAttachments(container, attachments) {
    const wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    normalizeMessageAttachments(attachments).forEach((attachment) => {
      const item = document.createElement('div');
      item.className = 'message-attachment';
      item.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;
      item.title = attachment.path || attachment.name;
      wrap.appendChild(item);
    });
    container.appendChild(wrap);
  }

  function appendEmptyState(titleText, subtitleText, showSetupAction = false, installHint) {
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

    const suggestionActions = showSetupAction
      ? [['openSettings', 'empty.configureProviders']]
      : [
        ['explainSelection', 'empty.explain'],
        ['reviewFile', 'empty.review'],
        ['generateTests', 'empty.tests'],
        ['refactorSelection', 'empty.refactor'],
      ];
    if (showSetupAction && installHint) {
      suggestionActions.push(['copyInstall', 'empty.copyInstall']);
    }

    for (const [action, labelKey] of suggestionActions) {
      const button = document.createElement('button');
      button.className = 'suggestion-button';
      if (action === 'openSettings') {
        button.classList.add('suggestion-button--primary');
      }
      button.dataset.action = action;
      if (action === 'copyInstall' && installHint) {
        button.dataset.installCommand = installHint;
      }
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

  function providerUnavailableMessage(profile) {
    const resolvedProfile = typeof profile === 'string'
      ? profiles.find((item) => item.id === profile)
      : profile;

    if (resolvedProfile?.installHint) {
      return i18n.t('provider.unavailableWithHint', { hint: resolvedProfile.installHint });
    }

    return i18n.t('provider.unavailable');
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
    renderModelSelect();
    renderRuntimeSelect();
    renderPermissionSelect();
    renderAgentModeSelect();
  }

  function renderOptionSelect(select, options, value, group) {
    select.innerHTML = '';
    options.filter(selectableOption).forEach((option) => {
      const displayOption = localizedCliOption(option, group);
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = displayOption.label;
      item.title = displayOption.description || displayOption.label;
      if (option.dangerous) {
        item.dataset.dangerous = 'true';
      }
      select.appendChild(item);
    });
    select.value = value;
  }

  function appendDangerBadge(button, option) {
    if (!option?.dangerous) {
      return;
    }

    const warning = document.createElement('span');
    warning.className = 'option-list-item-warning';
    warning.textContent = '!';
    warning.title = i18n.t('option.danger');
    warning.setAttribute('aria-label', i18n.t('option.danger'));
    button.appendChild(warning);
  }

  function renderRuntimeOptionList(options, selectedId) {
    if (!runtimeOptionList) {
      return;
    }

    runtimeOptionList.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'option-list-title';
    title.textContent = i18n.t('runtime.continue');
    runtimeOptionList.appendChild(title);

    options.forEach((option) => {
      const displayOption = localizedCliOption(option, 'runtime');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        option.id === selectedId ? 'is-selected' : '',
        option.disabled ? 'is-disabled' : '',
        option.actionOnly ? 'is-action' : '',
        option.external ? 'is-external' : '',
        option.dividerBefore ? 'has-divider' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.disabled = Boolean(option.disabled);
      button.setAttribute('role', selectableOption(option) ? 'menuitemradio' : 'menuitem');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const icon = document.createElement('span');
      icon.className = 'option-list-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const trailing = document.createElement('span');
      trailing.className = 'option-list-item-trailing';
      trailing.setAttribute('aria-hidden', 'true');
      trailing.textContent = option.external ? '↗' : (option.actionOnly ? '›' : '');
      button.appendChild(trailing);
      appendDangerBadge(button, option);

      runtimeOptionList.appendChild(button);
    });
  }

  function renderPermissionOptionList(options, selectedId) {
    if (!permissionOptionList) {
      return;
    }

    permissionOptionList.innerHTML = '';
    const profile = activeProfile();
    const visibleOptions = options.filter((option) => (
      profile?.id !== 'codex' || option.id !== 'readOnly' || option.id === selectedId
    ));

    visibleOptions.forEach((option) => {
      const displayOption = localizedPermissionOption(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'permission-option-item',
        option.id === selectedId ? 'is-selected' : '',
        option.dangerous ? 'is-danger' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const icon = document.createElement('span');
      icon.className = 'permission-option-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const check = document.createElement('span');
      check.className = 'permission-option-check';
      check.setAttribute('aria-hidden', 'true');
      button.appendChild(check);
      appendDangerBadge(button, option);

      permissionOptionList.appendChild(button);
    });
  }

  function renderModelOptionList(options, selectedId) {
    if (!modelOptionList) {
      return;
    }

    modelOptionList.innerHTML = '';
    options.forEach((option) => {
      const displayOption = localizedCliOption(option, 'model');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'model-option-item',
        option.id === selectedId ? 'is-selected' : '',
        option.custom ? 'is-custom' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const check = document.createElement('span');
      check.className = 'model-option-check';
      check.setAttribute('aria-hidden', 'true');
      button.appendChild(check);

      modelOptionList.appendChild(button);
    });
  }

  function renderModelSelect() {
    const profile = activeProfile();
    const options = modelOptionsFor(profile);
    const model = activeModel(profile);
    const displayModel = localizedCliOption(model, 'model');
    renderOptionSelect(modelSelect, options, model.id, 'model');
    renderModelOptionList(options, model.id);
    modelSelect.title = displayModel.description || i18n.t('model.label');
    modelSummaryLabel.textContent = model.custom && activeCustomModel(activeId)
      ? activeCustomModel(activeId)
      : displayModel.summaryLabel || displayModel.label || i18n.t('model.short');
    modelSummaryLabel.closest('.option-summary')?.setAttribute('title', displayModel.description || i18n.t('model.label'));
    modelMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    customModelField.hidden = !model.custom;
    customModelInput.value = activeCustomModel(activeId);
    customModelInput.disabled = !profile || !profile.installed;
  }

  function renderRuntimeSelect() {
    const profile = activeProfile();
    const options = runtimeModesFor(profile);
    const runtime = activeRuntime(profile);
    const displayRuntime = localizedCliOption(runtime, 'runtime');
    renderOptionSelect(runtimeSelect, options, runtime.id, 'runtime');
    renderRuntimeOptionList(options, runtime.id);
    runtimeSelect.title = displayRuntime.description || i18n.t('runtime.label');
    runtimeSummaryLabel.textContent = displayRuntime.summaryLabel || displayRuntime.label || i18n.t('runtime.short');
    runtimeSummaryLabel.closest('.option-summary')?.setAttribute(
      'title',
      [
        displayRuntime.description || i18n.t('runtime.label'),
        runtime.dangerous ? i18n.t('option.danger') : '',
      ].filter(Boolean).join(' · ')
    );
    runtimeMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    runtimeMenu?.classList.toggle('is-danger', Boolean(runtime?.dangerous));
  }

  function renderPermissionSelect() {
    const profile = activeProfile();
    const options = permissionModesFor(profile);
    const permission = activePermission(profile);
    const displayPermission = localizedPermissionOption(permission);
    renderOptionSelect(permissionSelect, options, permission.id, 'permission');
    renderPermissionOptionList(options, permission.id);
    permissionSelect.title = displayPermission.description || i18n.t('permission.label');
    permissionSummaryLabel.textContent = displayPermission.label || i18n.t('permission.short');
    permissionSummaryLabel.closest('.option-summary')?.setAttribute(
      'title',
      [
        displayPermission.description || i18n.t('permission.label'),
        permission.dangerous ? i18n.t('option.danger') : '',
      ].filter(Boolean).join(' · ')
    );
    permissionMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    permissionMenu?.classList.toggle('is-danger', Boolean(permission.dangerous));
  }

  function renderAgentModeSelect() {
    agentModeSelect.innerHTML = '';
    const profile = activeProfile();
    const modes = agentModesFor(profile);

    modes.forEach((mode) => {
      const displayMode = localizedCliOption(mode, 'agentMode');
      const option = document.createElement('option');
      option.value = mode.id;
      option.textContent = displayMode.label;
      option.title = displayMode.description || mode.instruction || displayMode.label;
      option.disabled = Boolean(mode.disabled);
      agentModeSelect.appendChild(option);
    });

    agentModeSelect.value = activeAgentModeId(activeId);
    renderAgentModeOptionList(modes, agentModeSelect.value);
    const mode = activeAgentMode();
    const displayMode = localizedCliOption(mode, 'agentMode');
    agentModeSelect.title = displayMode?.description || i18n.t('agentMode.label');
    if (agentModeSummaryLabel) {
      agentModeSummaryLabel.textContent = profile?.id === 'opencode'
        ? splitAgentModeLabel(displayMode?.label || i18n.t('agentMode.short')).title
        : (displayMode?.label || i18n.t('agentMode.short'));
      agentModeSummaryLabel.closest('.mode-summary')?.setAttribute(
        'title',
        `${profile?.name || i18n.t('provider.label')} · ${displayMode?.description || displayMode?.label || ''}`.trim()
      );
    }
    modeMenu?.classList.toggle('is-visible', Boolean(profile && (profile?.id === 'opencode' || modes.length > 1)));
  }

  function renderAgentModeOptionList(modes, selectedId) {
    if (!agentModeOptionList) {
      return;
    }

    agentModeOptionList.innerHTML = '';
    const profile = activeProfile();
    modes.forEach((mode) => {
      const displayMode = localizedCliOption(mode, 'agentMode');
      const splitMode = splitAgentModeLabel(displayMode.label);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'mode-option-item',
        mode.id === selectedId ? 'is-selected' : '',
        mode.disabled ? 'is-disabled' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = mode.id;
      button.disabled = Boolean(mode.disabled);
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', mode.id === selectedId ? 'true' : 'false');
      button.title = displayMode.description || mode.instruction || displayMode.label;

      const marker = document.createElement('span');
      marker.className = 'mode-option-marker';
      marker.setAttribute('aria-hidden', 'true');
      button.appendChild(marker);

      const label = document.createElement('span');
      label.className = 'mode-option-text';
      label.textContent = profile?.id === 'opencode' ? splitMode.title : displayMode.label;
      button.appendChild(label);

      const meta = document.createElement('span');
      meta.className = 'mode-option-meta';
      meta.textContent = profile?.id === 'opencode'
        ? splitMode.detail
        : (mode.disabled ? i18n.t('agentMode.subagent') : '');
      button.appendChild(meta);

      agentModeOptionList.appendChild(button);
    });
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
    const hasAttachments = promptAttachments.length > 0;
    const selectedAction = actionSelect.value || 'freeform';
    const missingSelection = actionRequiresSelection(selectedAction) && !hasSelectionContext();
    const missingCustomModel = activeModel()?.custom && !activeCustomModel(activeId);
    const canRunAction = hasPrompt || hasAttachments || selectedAction !== 'freeform';
    input.disabled = !canSend;
    sendBtn.disabled = !canSend || busy || !canRunAction || missingSelection || missingCustomModel;
    document.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (action === 'openSettings') {
        button.disabled = false;
        button.title = '';
        return;
      }

      button.disabled = !canSend || busy || (actionRequiresSelection(action) && !hasSelectionContext());
      button.title = button.disabled && actionRequiresSelection(action)
        ? i18n.t('quick.missingSelection')
        : '';
    });
    actionSelect.disabled = !canSend || busy;
    providerSelect.disabled = visibleInstalledProfiles().length === 0 || busy;
    threadSelect.disabled = !activeId || busy;
    modelSelect.disabled = !canSend || busy;
    runtimeSelect.disabled = !canSend || busy;
    permissionSelect.disabled = !canSend || busy;
    agentModeSelect.disabled = !canSend || busy;
    modelOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = !canSend || busy;
    });
    runtimeOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = button.classList.contains('is-disabled') || !canSend || busy;
    });
    permissionOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = !canSend || busy;
    });
    input.placeholder = canSend
      ? (profile?.id === 'claude' && !missingSelection
          ? i18n.t('claude.placeholder')
          : (missingSelection
              ? i18n.t('quick.missingSelection')
              : i18n.t(
                  selectedAction === 'freeform' ? 'input.placeholderProvider' : 'input.placeholderAction',
                  { provider: profile.name, action: actionLabel(selectedAction) }
                )))
      : i18n.t('input.placeholderDisabled');
    const running = Boolean(runningByProvider[activeId]);
    stopBtn.hidden = !running;
    sendBtn.hidden = running;
    stopBtn.classList.toggle('is-visible', running);
    sendBtn.classList.toggle('is-hidden', running);
    renderSlashPalette();
    scheduleComposerPopoverPosition();
  }

  function renderClaudeTerminalBanner() {
    if (!claudeTerminalBanner) {
      return;
    }

    claudeTerminalBanner.hidden = activeId !== 'claude' || claudeTerminalBannerDismissed;
  }

  function renderCodexTerminalBanner() {
    if (!codexTerminalBanner) {
      return;
    }

    const codexRunning = Boolean(runningByProvider.codex);
    const taskBoardVisible = visibleTasksForBoard().length > 0;
    codexTerminalBanner.hidden = activeId !== 'codex' || !codexRunning || taskBoardVisible;
  }

  function renderAll() {
    const profile = activeProfile();
    document.body.dataset.provider = activeId || 'none';
    setAccent(profile);
    renderClaudeTerminalBanner();
    renderCodexTerminalBanner();
    renderProviderSelect();
    renderProviderTabs();
    renderTaskBoard();
    renderThreadSelect();
    renderWorkflowMode();
    renderContextControls();
    renderProviderHint();
    renderContextSummaryLabel();
    renderContextBudget();
    renderMessages();
    renderAttachmentStrip();
    renderComposer();
    if (apiSettingsPage && !apiSettingsPage.hidden) {
      renderSettingsPage();
    }
  }

  function send(action, text, preferredWorkflowMode) {
    const finalText = (text || input.value || '').trim();
    const finalAttachments = promptAttachments.map(attachmentPayload);
    if (!finalText && finalAttachments.length === 0 && action === 'freeform') {
      input.focus();
      return;
    }
    if (actionRequiresSelection(action) && !hasSelectionContext()) {
      addMessage(activeId, 'error', i18n.t('quick.missingSelection'));
      return;
    }

    const profile = activeProfile();
    if (!profile?.installed) {
      addMessage(activeId, 'error', providerUnavailableMessage(profile));
      return;
    }

    if (!sendToProvider(
      activeId,
      action,
      finalText,
      preferredWorkflowMode || activeAgentModeId(activeId),
      finalAttachments
    )) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    promptAttachments = [];
    renderAttachmentStrip();
  }

  function sendToProvider(providerId, action, text, preferredWorkflowMode, attachments) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile || !profile.installed) {
      addMessage(providerId || activeId, 'error', providerUnavailableMessage(profile || providerId));
      return false;
    }
    if (runningByProvider[providerId] || pendingByProvider[providerId]) {
      return false;
    }

    const model = activeModel(profile);
    if (model?.custom && !activeCustomModel(providerId)) {
      if (providerId === activeId) {
        customModelInput.focus();
      }
      return false;
    }

    const task = createRunTask(providerId, action, text, preferredWorkflowMode);
    pendingTaskByProvider[providerId] = task.id;
    pendingByProvider[providerId] = true;
    pendingThreadByProvider[providerId] = activeThreadId(providerId);
    renderAll();

    vscode.postMessage({
      command: action === 'freeform' ? 'send' : 'quickAction',
      cliId: providerId,
      text,
      mode: 'agent',
      agentMode: preferredWorkflowMode || activeAgentModeId(providerId),
      model: activeModelId(providerId),
      customModel: activeCustomModel(providerId),
      runtime: activeRuntimeId(providerId),
      permissionMode: activePermissionId(providerId),
      action,
      attachments,
      conversationHistory: conversationHistoryForSend(providerId),
      contextOptions,
    });
    return true;
  }

  function addMessage(cliId, role, text, meta, running, threadId, attachments) {
    const thread = ensureThread(cliId, threadId);
    const conversation = thread?.messages || [];
    conversation.push({
      role,
      text,
      meta,
      running: Boolean(running),
      startedAt: running ? Date.now() : undefined,
      attachments: normalizeMessageAttachments(attachments),
    });
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
    if (normalizeMessageText(message.text).trim()) {
      delete item.runningNotice;
    }
    if (message.stream === 'error') {
      item.role = 'error';
      updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
    }
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function updateSessionNotice(message) {
    const target = streamTargets[message.sessionId];
    if (!target) {
      return;
    }

    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item || !item.running) {
      return;
    }

    item.runningNotice = normalizeMessageText(message.text);
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function markSessionEnded(message) {
    const target = streamTargets[message.sessionId];
    updateTaskStatus(taskBySessionId[message.sessionId], {
      status: Number(message.exitCode) === 0 ? 'completed' : 'failed',
    });
    delete taskBySessionId[message.sessionId];
    if (target) {
      const item = ensureConversation(target.cliId, target.threadId)[target.index];
      if (item) {
        item.running = false;
        delete item.runningNotice;
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

      const structuralTag = parseAssistantMarkupTag(trimmed);
      if (structuralTag) {
        if (!structuralTag.closing) {
          appendAssistantSectionLabel(container, structuralTag.name);
        }
        index += 1;
        continue;
      }

      const lineParts = splitAssistantMarkupTags(line);
      if (lineParts) {
        appendAssistantMarkupParts(container, lineParts);
        index += 1;
        continue;
      }

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
        appendTable(container, tableLines, 'pipe');
        continue;
      }

      const tabbedTable = readTabbedTable(lines, index);
      if (tabbedTable) {
        appendTable(container, tabbedTable.lines, tabbedTable.kind);
        index += tabbedTable.lines.length;
        continue;
      }

      appendMarkdownLine(container, line);
      index += 1;
    }
  }

  function markdownToCopyPlainText(text) {
    const lines = normalizeMessageText(text).split('\n');
    const output = [];
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (parseAssistantMarkupTag(trimmed)) {
        continue;
      }

      const lineParts = splitAssistantMarkupTags(line);
      if (lineParts) {
        const plainText = lineParts
          .filter((part) => Object.prototype.hasOwnProperty.call(part, 'text'))
          .map((part) => part.text)
          .join('')
          .trim();
        if (plainText) {
          output.push(stripInlineMarkdown(plainText));
        }
        continue;
      }

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (inCodeBlock) {
        output.push(line);
        continue;
      }

      if (!trimmed) {
        output.push('');
        continue;
      }

      if (isTableSeparator(trimmed) || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        output.push(stripInlineMarkdown(heading[2]));
        continue;
      }

      const sectionHeading = parseAssistantSectionHeading(trimmed);
      if (sectionHeading) {
        output.push(assistantSectionLabel(sectionHeading));
        continue;
      }

      const quote = /^>\s?(.*)$/.exec(trimmed);
      if (quote) {
        output.push(stripInlineMarkdown(quote[1]));
        continue;
      }

      const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
      if (task) {
        output.push(`${task[1].trim() ? '✓' : '□'} ${stripInlineMarkdown(task[2])}`);
        continue;
      }

      const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (bullet) {
        output.push(`• ${stripInlineMarkdown(bullet[1])}`);
        continue;
      }

      const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
      if (numbered) {
        output.push(`${numbered[1]}. ${stripInlineMarkdown(numbered[2])}`);
        continue;
      }

      if (isTableRow(line)) {
        output.push(splitTableCells(line).map(stripInlineMarkdown).join('\t'));
        continue;
      }

      if (isTabbedTableRow(line)) {
        output.push(splitTabbedCells(line).map(stripInlineMarkdown).join('\t'));
        continue;
      }

      output.push(stripInlineMarkdown(line));
    }

    return output.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function stripInlineMarkdown(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }

  function renderedMessagePlainText(container) {
    if (!container) {
      return '';
    }

    return Array.from(container.children)
      .map(renderedMessageLineText)
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function renderedMessageLineText(node) {
    if (!(node instanceof HTMLElement)) {
      return node?.textContent || '';
    }

    if (node.classList.contains('md-spacer') || node.classList.contains('md-rule')) {
      return '';
    }

    if (node.classList.contains('md-code-wrap')) {
      return node.querySelector('.md-code-block')?.textContent || '';
    }

    if (node.classList.contains('md-table-wrap')) {
      return Array.from(node.querySelectorAll('tr'))
        .map((row) => Array.from(row.children).map((cell) => cell.textContent || '').join('\t'))
        .join('\n');
    }

    if (node.classList.contains('md-list-item') || node.classList.contains('md-numbered-item')) {
      const marker = node.querySelector('.md-marker')?.textContent || '';
      const content = Array.from(node.children)
        .filter((child) => !child.classList.contains('md-marker'))
        .map((child) => child.textContent || '')
        .join('');
      return [marker, content].filter(Boolean).join(' ');
    }

    return node.textContent || '';
  }

  function appendMarkdownLine(container, line) {
    const trimmed = line.trim();
    if (!trimmed) {
      const spacer = document.createElement('div');
      spacer.className = 'md-spacer';
      container.appendChild(spacer);
      return;
    }

    const structuralTag = parseAssistantMarkupTag(trimmed);
    if (structuralTag) {
      if (!structuralTag.closing) {
        appendAssistantSectionLabel(container, structuralTag.name);
      }
      return;
    }

    const lineParts = splitAssistantMarkupTags(line);
    if (lineParts) {
      appendAssistantMarkupParts(container, lineParts);
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

    const sectionHeading = parseAssistantSectionHeading(trimmed);
    if (sectionHeading) {
      appendAssistantSectionLabel(container, sectionHeading);
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

    const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
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

  function parseAssistantMarkupTag(line) {
    const source = String(line || '').trim();
    const tag = /^<\/?([a-z][\w-]*)>$/i.exec(source);
    if (!tag) {
      return null;
    }

    const name = tag[1].toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(assistantSectionLabels(), name)) {
      return null;
    }

    return { name, closing: source.startsWith('</') };
  }

  function splitAssistantMarkupTags(line) {
    const source = String(line || '');
    const pattern = /<\/?([a-z][\w-]*)>/gi;
    const parts = [];
    let lastIndex = 0;
    let found = false;
    let match;

    while ((match = pattern.exec(source)) !== null) {
      const tag = parseAssistantMarkupTag(match[0]);
      if (!tag) {
        continue;
      }

      found = true;
      if (match.index > lastIndex) {
        parts.push({ text: source.slice(lastIndex, match.index) });
      }
      parts.push({ tag });
      lastIndex = pattern.lastIndex;
    }

    if (!found) {
      return null;
    }

    if (lastIndex < source.length) {
      parts.push({ text: source.slice(lastIndex) });
    }

    return parts;
  }

  function appendAssistantMarkupParts(container, parts) {
    parts.forEach((part) => {
      if (part.tag) {
        if (!part.tag.closing) {
          appendAssistantSectionLabel(container, part.tag.name);
        }
        return;
      }

      if (normalizeMessageText(part.text).trim()) {
        appendMarkdownLine(container, part.text);
      }
    });
  }

  function parseAssistantSectionHeading(line) {
    const key = String(line || '')
      .trim()
      .replace(/^[#>*\-\s•]+/, '')
      .replace(/\*\*/g, '')
      .replace(/[:：]+$/, '')
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return Object.prototype.hasOwnProperty.call(assistantSectionLabels(), key) ? key : null;
  }

  function appendAssistantSectionLabel(container, name) {
    const label = document.createElement('div');
    label.className = 'md-section-label';
    label.textContent = assistantSectionLabel(name);
    container.appendChild(label);
  }

  function assistantSectionLabel(name) {
    return assistantSectionLabels()[name] || name.replace(/[_-]+/g, ' ');
  }

  function assistantSectionLabels() {
    return {
      analysis: 'Analysis',
      results: 'Results',
      files: 'Files',
      answer: 'Answer',
      next_steps: 'Next steps',
      root_cause: 'Root cause',
      check_results: 'Check results',
      summary: 'Summary',
    };
  }

  function isTableStart(lines, index) {
    return isTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
  }

  function readTabbedTable(lines, startIndex) {
    if (!isTabbedTableRow(lines[startIndex]) || !isTabbedTableRow(lines[startIndex + 1])) {
      return null;
    }

    const tableLines = [];
    let index = startIndex;
    while (index < lines.length && isTabbedTableRow(lines[index])) {
      tableLines.push(lines[index]);
      index += 1;
    }

    return { lines: tableLines, kind: 'tabbed' };
  }

  function isTabbedTableRow(line) {
    if (typeof line !== 'string' || !line.includes('\t')) {
      return false;
    }

    return splitTabbedCells(line).length >= 2;
  }

  function splitTabbedCells(line) {
    return String(line || '')
      .split('\t')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
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

  function appendTable(container, lines, kind = 'pipe') {
    const splitCells = kind === 'tabbed' ? splitTabbedCells : splitTableCells;
    const headers = splitCells(lines[0]);
    const rows = lines.slice(kind === 'tabbed' ? 1 : 2).map(splitCells);
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
    const normalizedLanguage = normalizeCodeLanguage(language);

    if (language) {
      const label = document.createElement('div');
      label.className = 'md-code-label';
      label.textContent = language;
      wrap.appendChild(label);
    }

    const pre = document.createElement('pre');
    pre.className = 'md-code-block';
    if (normalizedLanguage) {
      pre.classList.add(`language-${normalizedLanguage}`);
    }
    appendHighlightedCode(pre, code, normalizedLanguage);
    wrap.appendChild(pre);
    container.appendChild(wrap);
  }

  function normalizeCodeLanguage(language) {
    const raw = String(language || '').trim().toLowerCase().replace(/[{}]/g, '');
    if (!raw) {
      return '';
    }

    const aliases = {
      javascript: 'js',
      typescript: 'ts',
      jsonc: 'json',
      bash: 'shell',
      sh: 'shell',
      zsh: 'shell',
      shellscript: 'shell',
      patch: 'diff',
      xml: 'html',
      html: 'html',
      css: 'css',
      scss: 'css',
    };
    return aliases[raw] || raw.replace(/[^a-z0-9+#-]/g, '');
  }

  function appendHighlightedCode(container, code, language) {
    const source = String(code || '');
    if (!source) {
      return;
    }

    if (language === 'diff') {
      appendDiffHighlightedCode(container, source);
      return;
    }

    const patterns = codeHighlightPatterns(language);
    if (patterns.length === 0) {
      container.appendChild(document.createTextNode(source));
      return;
    }

    let index = 0;
    let plainStart = 0;
    while (index < source.length) {
      let token = null;
      for (const pattern of patterns) {
        pattern.regex.lastIndex = index;
        const match = pattern.regex.exec(source);
        if (match && match.index === index && match[0]) {
          token = { className: pattern.className, text: match[0] };
          break;
        }
      }

      if (!token) {
        index += 1;
        continue;
      }

      if (plainStart < index) {
        container.appendChild(document.createTextNode(source.slice(plainStart, index)));
      }
      appendCodeToken(container, token.className, token.text);
      index += token.text.length;
      plainStart = index;
    }

    if (plainStart < source.length) {
      container.appendChild(document.createTextNode(source.slice(plainStart)));
    }
  }

  function appendCodeToken(container, className, text) {
    const token = document.createElement('span');
    token.className = `md-token ${className}`;
    token.textContent = text;
    container.appendChild(token);
  }

  function codeHighlightPatterns(language) {
    const jsKeywords =
      'abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield';

    if (['js', 'jsx', 'ts', 'tsx'].includes(language)) {
      return [
        { className: 'comment', regex: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/y },
        { className: 'keyword', regex: new RegExp(`\\b(?:${jsKeywords})\\b`, 'y') },
        { className: 'constant', regex: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y },
        { className: 'number', regex: /\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/iy },
        { className: 'function', regex: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
      ];
    }

    if (language === 'json') {
      return [
        { className: 'property', regex: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"/y },
        { className: 'constant', regex: /\b(?:true|false|null)\b/y },
        { className: 'number', regex: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy },
      ];
    }

    if (language === 'shell') {
      return [
        { className: 'comment', regex: /#[^\n]*/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'variable', regex: /\$\{[^}]+\}|\$[A-Za-z_][\w]*/y },
        { className: 'keyword', regex: /\b(?:case|cd|do|done|echo|elif|else|esac|export|fi|for|function|git|if|in|npm|pnpm|then|while|yarn)\b/y },
        { className: 'number', regex: /--?[\w-]+/y },
      ];
    }

    if (language === 'css') {
      return [
        { className: 'comment', regex: /\/\*[\s\S]*?\*\//y },
        { className: 'property', regex: /--?[\w-]+(?=\s*:)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'number', regex: /#[\da-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b/iy },
        { className: 'keyword', regex: /\b(?:auto|block|flex|grid|inline|none|relative|absolute|fixed|sticky|solid|transparent|var)\b/y },
      ];
    }

    if (language === 'html') {
      return [
        { className: 'comment', regex: /<!--[\s\S]*?-->/y },
        { className: 'keyword', regex: /<\/?[A-Za-z][\w:-]*/y },
        { className: 'property', regex: /\s[A-Za-z_:][\w:.-]*(?=\=)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      ];
    }

    return [];
  }

  function appendDiffHighlightedCode(container, code) {
    const lines = String(code || '').split('\n');
    lines.forEach((line, index) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        appendCodeToken(container, 'diff-add', line);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        appendCodeToken(container, 'diff-remove', line);
      } else if (line.startsWith('@@')) {
        appendCodeToken(container, 'diff-hunk', line);
      } else {
        container.appendChild(document.createTextNode(line));
      }

      if (index < lines.length - 1) {
        container.appendChild(document.createTextNode('\n'));
      }
    });
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

  sendBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    sendSelectedAction();
  });

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

  input.addEventListener('paste', (event) => {
    const imageFiles = clipboardImageFiles({
      items: event.clipboardData?.items,
      files: event.clipboardData?.files,
    });
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void addImageFiles(imageFiles);
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

  codexTerminalStop.addEventListener('click', () => {
    vscode.postMessage({ command: 'stop', cliId: activeId });
  });

  codexTerminalOpen.addEventListener('click', () => {
    vscode.postMessage({ command: 'openProviderExtension', cliId: activeId });
  });

  attachImageBtn?.addEventListener('click', () => {
    imageFileInput?.click();
  });

  claudeContextBtn.addEventListener('click', () => {
    executeLocalSlashCommand({ local: 'context' });
    input.focus();
  });

  claudeTerminalDismiss.addEventListener('click', () => {
    claudeTerminalBannerDismissed = true;
    persist();
    renderClaudeTerminalBanner();
  });

  imageFileInput?.addEventListener('change', () => {
    void addImageFiles(imageFileInput.files);
    imageFileInput.value = '';
  });

  attachmentStrip?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attachment-id]');
    if (!button) {
      return;
    }

    promptAttachments = promptAttachments.filter((attachment) => attachment.id !== button.dataset.attachmentId);
    renderAttachmentStrip();
    renderComposer();
  });

  reloadBtn?.addEventListener('click', () => {
    vscode.postMessage({ command: 'reloadWindow' });
  });

  composerSettingsBtn?.addEventListener('click', () => {
    vscode.postMessage({ command: 'openSettings' });
  });

  apiSettingsBack?.addEventListener('click', closeApiProviderSettings);
  apiProviderCancel?.addEventListener('click', closeApiProviderSettings);

  settingsNav?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-section]');
    if (!button) {
      return;
    }
    activeSettingsSection = button.dataset.settingsSection === 'apiProviders' ? 'apiProviders' : 'agents';
    renderSettingsPage();
  });

  homeAgentList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-home-agent-move]');
    if (!button) {
      return;
    }

    event.preventDefault();
    moveHomeAgent(button.dataset.homeAgentId, button.dataset.homeAgentMove);
  });

  homeAgentsReset?.addEventListener('click', () => {
    homeAgentList?.querySelectorAll('input[data-home-agent-id]').forEach((checkbox) => {
      checkbox.checked = true;
    });
  });

  homeAgentsSave?.addEventListener('click', saveHomeAgentSettings);

  apiProviderAdd?.addEventListener('click', () => {
    const provider = createApiProviderDraft();
    apiProviderSettings = {
      ...apiProviderSettings,
      customProviders: [...apiProviderSettings.customProviders, provider],
    };
    editingApiProviderId = provider.id;
    clearApiSettingsError();
    renderApiProviderSettings();
    apiProviderName?.focus();
  });

  apiProviderList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-provider-id]');
    if (!button) {
      return;
    }
    editingApiProviderId = button.dataset.providerId;
    clearApiSettingsError();
    renderApiProviderSettings();
  });

  apiProviderAddEnv?.addEventListener('click', () => {
    apiProviderExtraEnv?.appendChild(createExtraEnvRow('', ''));
  });

  apiProviderExtraEnv?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-env]');
    if (!button) {
      return;
    }
    const row = button.closest('.api-extra-env-row');
    row?.remove();
    if (!apiProviderExtraEnv.children.length) {
      apiProviderExtraEnv.appendChild(createExtraEnvRow('', ''));
    }
  });

  apiProviderDelete?.addEventListener('click', () => {
    const provider = currentApiProvider();
    if (!provider) {
      return;
    }
    const customProviders = apiProviderSettings.customProviders.filter((item) => item.id !== provider.id);
    const agentProviderByCliId = Object.fromEntries(
      Object.entries(apiProviderSettings.agentProviderByCliId).filter(([, providerId]) => providerId !== provider.id)
    );
    apiProviderSettings = normalizeApiProviderSettings({
      customProviders,
      defaultProviderId: apiProviderSettings.defaultProviderId === provider.id ? '' : apiProviderSettings.defaultProviderId,
      agentProviderByCliId,
    });
    editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
    clearApiSettingsError();
    vscode.postMessage({ command: 'saveApiProviderSettings', settings: apiProviderSettings });
    renderApiProviderSettings();
  });

  apiProviderForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveApiProviderSettings();
  });

  taskBoard?.addEventListener('click', (event) => {
    if (event.target.closest('[data-task-board-dismiss]')) {
      taskBoardDismissed = true;
      persist();
      renderTaskBoard();
      return;
    }

    const card = event.target.closest('[data-task-id]');
    if (!card) {
      return;
    }

    switchActiveProvider(card.dataset.providerId);
    if (card.dataset.threadId) {
      activeThreadByProvider[card.dataset.providerId] = card.dataset.threadId;
    }
    persist();
    renderAll();
  });

  providerSelect.addEventListener('change', () => {
    activeId = providerSelect.value;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);
    persist();
    persistUserSelection();
    renderAll();
    refreshActiveContext();
  });

  providerTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.provider-tab-button');
    if (!button || button.disabled) {
      return;
    }

    switchActiveProvider(button.dataset.providerId);
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
    persistUserSelection();
    renderAll();
  });

  agentModeOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    activeAgentModeByProvider[activeId] = button.dataset.value;
    agentModeSelect.value = button.dataset.value;
    legacyWorkflowMode = undefined;
    persist();
    persistUserSelection();
    renderAll();
    modeMenu.open = false;
  });

  modelSelect.addEventListener('change', () => {
    activeModelByProvider[activeId] = modelSelect.value;
    persist();
    renderAll();
  });

  modelOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    const option = modelOptionsFor(activeProfile()).find((item) => item.id === button.dataset.value);
    activeModelByProvider[activeId] = button.dataset.value;
    modelSelect.value = button.dataset.value;
    persist();
    renderAll();

    if (option?.custom) {
      modelMenu.open = true;
      customModelInput.focus();
    } else {
      modelMenu.open = false;
    }
  });

  customModelInput.addEventListener('input', () => {
    customModelByProvider[activeId] = customModelInput.value;
    persist();
    renderComposer();
  });

  runtimeSelect.addEventListener('change', () => {
    activeRuntimeByProvider[activeId] = runtimeSelect.value;
    persist();
    renderAll();
  });

  runtimeOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled || button.classList.contains('is-action')) {
      return;
    }

    activeRuntimeByProvider[activeId] = button.dataset.value;
    runtimeSelect.value = button.dataset.value;
    runtimeMenu.open = false;
    persist();
    renderAll();
  });

  permissionSelect.addEventListener('change', () => {
    activePermissionByProvider[activeId] = permissionSelect.value;
    persist();
    renderAll();
  });

  permissionOptionList.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    activePermissionByProvider[activeId] = button.dataset.value;
    permissionSelect.value = button.dataset.value;
    permissionMenu.open = false;
    persist();
    renderAll();
  });

  document.querySelectorAll('[data-context]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      contextOptions[checkbox.dataset.context] = checkbox.checked;
      persist();
      refreshActiveContext();
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
    const copyButton = event.target.closest('[data-message-copy]');
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      const body = copyButton.closest('.message-bubble')?.querySelector('.message-content');
      const text = renderedMessagePlainText(body);
      if (text.trim()) {
        vscode.postMessage({ command: 'copyMessageText', text });
      }
      return;
    }

    const button = event.target.closest('.suggestion-button');
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (action === 'openSettings') {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ command: 'openSettings', section: 'apiProviders' });
      return;
    }

    if (action === 'copyInstall') {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({
        command: 'copyInstallCommand',
        installCommand: button.dataset.installCommand,
      });
      return;
    }

    actionSelect.value = action;
    send(action, input.value || quickActionText(action));
  });

  contextBudget?.addEventListener('pointerenter', positionContextBudgetPopover);
  contextBudget?.addEventListener('focus', positionContextBudgetPopover);
  contextBudget?.addEventListener('focusin', positionContextBudgetPopover);

  composerMenus().forEach((menu) => {
    menu.addEventListener('toggle', () => {
      if (!menu.open) {
        return;
      }
      closeComposerMenus(menu);
      scheduleComposerPopoverPosition();
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const currentMenu = target?.closest('details');
    const menus = composerMenus();

    closeComposerMenus(menus.includes(currentMenu) ? currentMenu : undefined);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (apiSettingsPage && !apiSettingsPage.hidden) {
        closeApiProviderSettings();
        return;
      }
      closeComposerMenus();
    }
  });

  window.addEventListener('resize', () => {
    positionContextBudgetPopover();
    positionOpenComposerPopovers();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'profiles':
        profiles = message.profiles || [];
        {
          const availableProfiles = visibleInstalledProfiles();
          const storedAgentModes = persistedSelectionMap(message.activeAgentModeByProvider);
          activeAgentModeByProvider = hasAppliedPersistentSelection
            ? { ...storedAgentModes, ...activeAgentModeByProvider }
            : { ...activeAgentModeByProvider, ...storedAgentModes };
          const storedProviderProfile = availableProfiles.find(
            (profile) => profile.id === message.activeProviderId
          );
          const defaultProfile = availableProfiles.find(
            (profile) => profile.id === message.defaultProviderId
          );
          if (!hasAppliedPersistentSelection && storedProviderProfile) {
            activeId = storedProviderProfile.id;
          }
          hasAppliedPersistentSelection = true;
          if (!activeId || !availableProfiles.some((profile) => profile.id === activeId)) {
            activeId = defaultProfile?.id || availableProfiles[0]?.id || '';
          }
        }
        persist();
        renderAll();
        refreshActiveContext();
        break;
      case 'switchProvider':
        switchActiveProvider(message.providerId);
        break;
      case 'contextSummary':
        contextSummary = message.summary;
        renderProviderHint();
        renderContextSummaryLabel();
        renderContextBudget();
        break;
      case 'apiProviderSettings':
        apiProviderSettings = normalizeApiProviderSettings(message.settings);
        apiProviderEnvStatusById = message.envStatusByProviderId || {};
        if (!editingApiProviderId || !apiProviderSettings.customProviders.some((provider) => provider.id === editingApiProviderId)) {
          editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
        }
        renderSettingsPage();
        break;
      case 'homeAgentSettings':
        homeAgentSettings = normalizeHomeAgentSettings(message.settings);
        renderAll();
        break;
      case 'openProviderSettings':
        openSettingsPage(message.section);
        break;
      case 'requestStarted':
        if (!activeId || !installedProfiles().some((profile) => profile.id === activeId)) {
          activeId = message.cliId;
        }
        pendingByProvider[message.cliId] = false;
        runningByProvider[message.cliId] = true;
        activeAgentModeByProvider[message.cliId] = message.agentMode || activeAgentModeId(message.cliId);
        {
          const threadId = pendingThreadByProvider[message.cliId] || activeThreadId(message.cliId);
          const taskId = pendingTaskByProvider[message.cliId] || createRunTask(
            message.cliId,
            message.action,
            message.text,
            message.agentMode
          ).id;
          delete pendingTaskByProvider[message.cliId];
          taskBySessionId[message.sessionId] = taskId;
          updateTaskStatus(taskId, {
            status: 'running',
            sessionId: message.sessionId,
            threadId,
            agentMode: message.agentModeLabel || message.agentMode || '',
          });
          activeThreadByProvider[message.cliId] = threadId;
          addMessage(
            message.cliId,
            'user',
            normalizeMessageText(message.text),
            `${message.actionLabel}${i18n.t('message.metaSeparator')}${agentModeLabel(message.agentMode)}`,
            false,
            threadId,
            message.attachments
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
          if (message.apiProviderWarning) {
            addMessage(message.cliId, 'system', normalizeMessageText(message.apiProviderWarning), undefined, false, threadId);
          }
        }
        persist();
        renderAll();
        break;
      case 'output':
        updateStream(message);
        break;
      case 'sessionNotice':
        updateSessionNotice(message);
        break;
      case 'sessionEnd':
        markSessionEnded(message);
        break;
      case 'stopped':
        runningByProvider[message.cliId] = false;
        pendingByProvider[message.cliId] = false;
        {
          const target = streamTargets[message.sessionId];
          updateTaskStatus(taskBySessionId[message.sessionId], { status: 'stopped' });
          delete taskBySessionId[message.sessionId];
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
        updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
        delete taskBySessionId[message.sessionId];
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
  vscode.postMessage({ command: 'refreshApiProviderSettings' });
  refreshActiveContext();
  renderAll();
})();
