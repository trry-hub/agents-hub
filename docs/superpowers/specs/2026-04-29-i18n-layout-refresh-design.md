# AI Assistant I18n And Layout Refresh Design

## Goal

Refresh the AI Assistant sidebar so it feels like a polished VS Code-native utility window, and make user-facing text internationalized for English and Simplified Chinese.

## Layout Direction

Use a compact IDE workbench layout:

- Header: title, refresh button, and provider dropdown.
- Context rail: small chips for Workspace, File, Selection, and Problems.
- Message area: full-height conversation surface with calm assistant responses and restrained user messages.
- Composer: quick action toolbar, Chat/Agent execution mode switch, fixed prompt input, and run/stop controls.

The provider detail card is removed. Chat and Agent are not treated as top-level destinations; they are execution styles for the next request, so the switch lives beside the composer. Provider metadata is exposed through the dropdown option label, status indicator, and compact hint text. Provider brand color is used only as a thin accent, focus ring, and status mark.

## Visual Style

The interface should use VS Code theme variables first. The tone is refined utility: dense, quiet, and clear. Controls use 4-6px radii, subtle borders, and minimal color. No large marketing cards, decorative gradients, or heavy provider color blocks.

## Internationalization

Manifest text moves to `%key%` entries in `package.json`, with:

- `package.nls.json` for English.
- `package.nls.zh-cn.json` for Simplified Chinese.

Webview text is handled by `media/i18n.js` with `en` and `zh-CN` dictionaries. `SidebarProvider` injects `vscode.env.language` into the webview, and the webview uses `t(key)` for labels, placeholders, status text, tooltips, and quick actions.

Prompt instructions sent to providers remain English for predictable model behavior. User-visible fallback action text is localized in the extension host.

## File Structure

- `media/main.html`: static semantic shell and resource links.
- `media/main.css`: VS Code-native layout and visual styling.
- `media/i18n.js`: webview dictionaries and locale resolver.
- `media/main.js`: UI state, events, rendering, and extension message handling.
- `src/localization.ts`: extension-host runtime strings.
- `package.nls.json`, `package.nls.zh-cn.json`: manifest localization.
