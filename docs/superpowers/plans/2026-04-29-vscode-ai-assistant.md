# VS Code AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current AI CLI Hub into a VS Code version of JetBrains AI Assistant with context-aware chat, agent mode, editor actions, and provider adapters.

**Architecture:** Keep the extension small and layered. VS Code APIs live in the extension shell and context collector, prompt construction is isolated, CLI execution remains behind `CliManager`, and the webview sends structured assistant actions instead of raw terminal-like messages.

**Tech Stack:** VS Code Extension API, TypeScript, Node child processes, static webview HTML/CSS/JS, esbuild.

---

### Task 1: Context And Prompt Core

**Files:**
- Create: `src/assistantTypes.ts`
- Create: `src/contextCollector.ts`
- Create: `src/promptBuilder.ts`
- Modify: `src/cliProfiles.ts`

- [x] Define shared assistant request, mode, action, and context types.
- [x] Implement an assistant context collector for workspace, active file, selection, diagnostics, and bounds.
- [x] Implement provider-neutral prompt formatting for chat, agent, and quick editor actions.
- [x] Extend CLI profile metadata with provider descriptions and capability labels.

### Task 2: Extension Shell And Commands

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/sidebarProvider.ts`

- [x] Add configuration for default provider and context limits.
- [x] Register editor commands for explain selection, review file, and generate tests.
- [x] Add a status bar entry that opens the assistant.
- [x] Route command invocations through the sidebar provider.

### Task 3: Assistant Sidebar Orchestration

**Files:**
- Modify: `src/sidebarProvider.ts`
- Modify: `src/cliManager.ts`

- [x] Accept structured webview messages with provider, mode, context options, and action.
- [x] Collect context per request and build a bounded prompt.
- [x] Stream output back to the webview with session IDs.
- [x] Preserve stop and stop-all lifecycle behavior.

### Task 4: Assistant Workbench UI

**Files:**
- Modify: `media/main.html`

- [x] Replace the simple CLI tab UI with an AI Assistant workbench.
- [x] Add provider tabs, Chat/Agent segmented control, context toggles, quick actions, and install hints.
- [x] Keep VS Code theme variables and CSP-safe inline behavior with the injected nonce.
- [x] Maintain responsive sidebar behavior without external assets.

### Task 5: Verification

**Files:**
- No source changes expected.

- [x] Run `npm run build`.
- [x] Fix TypeScript or bundle errors.
- [x] Review git diff for accidental unrelated changes.
