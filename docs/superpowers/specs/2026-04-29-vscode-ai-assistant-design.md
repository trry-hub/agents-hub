# VS Code AI Assistant Design

## Goal

Build a VS Code extension that feels like a VS Code version of JetBrains AI Assistant: a context-aware assistant panel that can chat about the current project, run agent-style tasks through external AI CLIs, and expose common editor actions such as explaining selected code, reviewing the current file, and generating tests.

## Product Shape

The extension should keep the current "AI CLI Hub" provider flexibility, but the primary mental model becomes "AI Assistant" rather than "terminal wrapper". Users choose a provider, choose Chat or Agent mode, attach IDE context, send a request, and see streamed results in the sidebar.

The first version supports:

- Context-aware sidebar chat.
- Chat and Agent modes.
- Provider tabs for installed AI CLIs.
- Context controls for selection, current file, diagnostics, and workspace metadata.
- Editor commands for explain selection, review file, generate tests, and open assistant.
- Safe process lifecycle controls: stop one run or stop all.

## Architecture

The extension follows a small hexagonal shape:

- `extension.ts` is the VS Code integration shell. It wires commands, status bar entry, configuration, and provider lifecycle.
- `SidebarProvider` owns webview state and translates UI messages into assistant requests.
- `AssistantContextCollector` gathers IDE context from VS Code APIs. It has no UI responsibility.
- `PromptBuilder` converts a user request, assistant mode, action, provider, and context snapshot into a provider-neutral prompt.
- `CliManager` remains the provider adapter layer. It knows how to find CLIs, spawn them, stream output, send input, and stop sessions.
- `cliProfiles.ts` defines provider metadata and capabilities.
- `media/main.html` renders the Assistant workbench.

Dependencies point outward from orchestration to adapters: the prompt builder and context collector do not import the webview; the webview provider coordinates them.

## Data Flow

1. User sends a message or invokes an editor command.
2. `SidebarProvider` determines the provider, mode, and context options.
3. `AssistantContextCollector` captures current IDE context.
4. `PromptBuilder` formats a concise, bounded prompt.
5. `CliManager` starts or reuses a provider process and streams output.
6. `SidebarProvider` forwards streamed chunks back to the webview.
7. The webview renders user, assistant, system, and error messages.

## Context Policy

Context must be useful but bounded. The collector includes relative paths where possible, truncates large files and selections, and summarizes diagnostics. The UI lets users toggle the highest-impact context sources.

Default context sources:

- Workspace root and active file metadata.
- Current selection, when present.
- Current file excerpt.
- Diagnostics for the active file.

## Error Handling

- Missing CLIs are shown as unavailable providers with install hints.
- Spawn failures are surfaced as assistant errors.
- Process exits are shown as session-end system messages.
- Stopping a session clears active UI state for that provider.
- Context collection failures degrade to a smaller snapshot rather than blocking a prompt.

## Testing And Verification

The repository currently has no unit test harness. Verification for this first delivery is:

- TypeScript build via `npm run build`.
- Manual compile-time validation of extension command registration and message contracts.
- UI contract review in `media/main.html` for command names and payload shapes.

