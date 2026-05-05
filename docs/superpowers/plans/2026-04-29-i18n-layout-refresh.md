# AI Assistant I18n And Layout Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internationalize the VS Code extension UI and replace the current sidebar with a tighter VS Code-native assistant layout.

**Architecture:** Move manifest strings to package nls files, move webview strings to a small runtime dictionary, and split the current monolithic webview into HTML/CSS/JS resources. Keep assistant prompt internals stable while localizing user-facing UI and extension messages.

**Tech Stack:** VS Code Extension API, package.nls localization, TypeScript, static webview HTML/CSS/JS, Node test runner.

---

### Task 1: Manifest And Extension Runtime I18n

**Files:**
- Modify: `package.json`
- Create: `package.nls.json`
- Create: `package.nls.zh-cn.json`
- Create: `src/localization.ts`
- Modify: `src/extension.ts`
- Modify: `src/sidebarProvider.ts`

- [x] Replace manifest titles and descriptions with `%key%` entries.
- [x] Add English and Simplified Chinese package nls files.
- [x] Add extension-host runtime text helper.
- [x] Localize status bar labels, stop-all message, and editor action fallback text.

### Task 2: Webview Resource Split

**Files:**
- Modify: `media/main.html`
- Create: `media/main.css`
- Create: `media/i18n.js`
- Create: `media/main.js`
- Modify: `src/sidebarProvider.ts`

- [x] Reduce `main.html` to semantic DOM plus external CSS/JS.
- [x] Inject CSS and JS webview URIs with CSP-safe placeholders.
- [x] Inject VS Code locale as a data attribute.
- [x] Update `.vscodeignore` if needed so runtime media files stay packaged.

### Task 3: Layout Refresh

**Files:**
- Modify: `media/main.css`
- Modify: `media/main.js`

- [x] Replace provider tabs with compact provider select.
- [x] Move Chat/Agent mode beside the composer input.
- [x] Render context toggles as tight chips.
- [x] Simplify message cards and composer controls.
- [x] Keep accessible labels and title text localized.

### Task 4: Verification

**Files:**
- Modify: `tests/promptBuilder.test.mjs` only if required by behavior changes.

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run package`.
- [x] Confirm VSIX contains only package, dist, and media runtime assets.
