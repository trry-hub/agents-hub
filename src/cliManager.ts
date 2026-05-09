import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CliAgentMode, CliModelOption, CliProfile, getCliProfile } from './cliProfiles';
import {
  buildCliLookupPath,
  getLoginShellLookupArgs,
  mergePathEntries,
  normalizeCommandPathOutput,
} from './cliPathResolver';
import {
  OpenCodeAgentDiscovery,
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeAgentListLine,
  parseOpenCodeModelsOutput,
} from './opencodeAgents';

export interface Session {
  id: string;
  cliId: string;
  agentModeId?: string;
  optionKey?: string;
  profile: CliProfile;
  process: ChildProcess;
  onOutput: vscode.EventEmitter<string>;
  onStderr: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
  eventStream?: OpenCodeEventStream;
}

interface BackgroundServerState {
  process?: ChildProcess;
  starting?: Promise<boolean>;
}

interface ResolvedBackgroundServer {
  key: string;
  args: string[];
  attachArgs: string[];
  host: string;
  port: number;
}

interface OpenCodeEventStream {
  close(): void;
  hasOutput(): boolean;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private commandPathCache = new Map<string, string>();
  private backgroundServers = new Map<string, BackgroundServerState>();

  getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/';
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    const profile = getCliProfile(profileId);
    if (!profile) { return false; }

    return Boolean(await this.resolveCommandPath(profile.command));
  }

  private async resolveCommandPath(command: string): Promise<string | undefined> {
    const cached = this.commandPathCache.get(command);
    if (cached) {
      if (await this.isUsableCommandPath(cached)) {
        return cached;
      }
      this.commandPathCache.delete(command);
    }

    const directPath = await this.lookupCommandInPath(command);
    const usableDirectPath = await this.cacheUsableCommandPath(command, directPath);
    if (usableDirectPath) {
      return usableDirectPath;
    }

    if (process.platform === 'win32') {
      return undefined;
    }

    const shellPath = process.env.SHELL || '/bin/zsh';
    const shellPathResult = await this.lookupCommandInLoginShell(command, shellPath);
    const usableShellPath = await this.cacheUsableCommandPath(command, shellPathResult);
    if (usableShellPath) {
      return usableShellPath;
    }

    return undefined;
  }

  private async cacheUsableCommandPath(
    command: string,
    commandPath: string | undefined
  ): Promise<string | undefined> {
    if (!commandPath || !(await this.isUsableCommandPath(commandPath))) {
      return undefined;
    }

    this.commandPathCache.set(command, commandPath);
    return commandPath;
  }

  private async isUsableCommandPath(commandPath: string): Promise<boolean> {
    try {
      await fs.promises.access(commandPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private lookupCommandInPath(command: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
      const proc = spawn(lookupCommand, [command], {
        env: {
          ...process.env,
          PATH: buildCliLookupPath(process.env.PATH, process.env.HOME),
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  private lookupCommandInLoginShell(
    command: string,
    shellPath: string
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const proc = spawn(shellPath, getLoginShellLookupArgs(command, shellPath), {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  async getProfilesWithStatus(): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    const results = await Promise.all(
      CLI_PROFILES.map(async (p) => {
        const installed = await this.checkInstalled(p.id);
        let profile: CliProfile = {
          ...p,
          installed,
          version: installed ? await this.getCommandVersion(p) : undefined,
        };

        if (installed && p.id === 'opencode') {
          const command = await this.resolveCommandPath(p.command);
          let discovery: OpenCodeAgentDiscovery = { modes: [] };
          let discoveredModels: CliModelOption[] = [];
          if (command) {
            [discovery, discoveredModels] = await Promise.all([
              this.getOpenCodeAgentModes(command),
              this.getOpenCodeModelOptions(command),
            ]);
          }
          const agentModes = discovery.modes;
          if (agentModes.length > 0) {
            profile = {
              ...profile,
              agentModes,
              defaultAgentMode: preferredOpenCodeDefaultAgent(
                agentModes,
                discovery.defaultAgentId ?? profile.defaultAgentMode
              ),
            };
          }
          if (discoveredModels.length > 0) {
            const modelOptions = mergeOpenCodeModelOptions(profile.modelOptions ?? [], discoveredModels);
            profile = {
              ...profile,
              modelOptions,
              defaultModel: preferredOpenCodeDefaultModel(
                modelOptions,
                discovery.defaultModelId ?? profile.defaultModel
              ),
            };
          }
        }

        return profile;
      })
    );
    return results;
  }

  private async getOpenCodeAgentModes(command: string): Promise<OpenCodeAgentDiscovery> {
    const cwd = this.getWorkspaceRoot();
    const discovery = await this.getOpenCodeAgentModesFromDebugConfig(command, cwd);
    if (discovery.modes.length > 0) {
      return {
        ...discovery,
        modes: mergeOpenCodeAgentModes(
          discovery.modes,
          await this.getOpenCodeAgentModesFromCliList(command, cwd)
        ),
      };
    }

    return {
      modes: await this.getOpenCodeAgentModesFromCliList(command, cwd),
    };
  }

  private getOpenCodeAgentModesFromDebugConfig(
    command: string,
    cwd: string
  ): Promise<OpenCodeAgentDiscovery> {
    return new Promise<OpenCodeAgentDiscovery>((resolve) => {
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      const env = {
        ...process.env,
        PATH: mergePathEntries([
          commandDir,
          buildCliLookupPath(process.env.PATH, process.env.HOME),
        ]),
        OPENCODE_DB: path.join(
          os.tmpdir(),
          `agents-hub-opencode-debug-config-${stableHash(cwd).toString(16)}-${process.pid}.db`
        ),
        OMO_DISABLE_POSTHOG: '1',
        OMO_SEND_ANONYMOUS_TELEMETRY: '0',
      };
      const proc = spawn(command, ['debug', 'config'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      let settled = false;
      const finish = (discovery: OpenCodeAgentDiscovery = { modes: [] }) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(discovery);
      };

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        finish();
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.length > 2_000_000) {
          try {
            proc.kill('SIGTERM');
          } catch {
            // Process may already be gone.
          }
          finish();
        }
      });
      proc.on('close', () => {
        finish(parseOpenCodeDebugConfigOutput(output));
      });
      proc.on('error', () => finish());
    });
  }

  private getOpenCodeAgentModesFromCliList(command: string, cwd: string): Promise<CliAgentMode[]> {
    return new Promise<CliAgentMode[]>((resolve) => {
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      const env = {
        ...process.env,
        PATH: mergePathEntries([
          commandDir,
          buildCliLookupPath(process.env.PATH, process.env.HOME),
        ]),
        OPENCODE_DB: path.join(
          os.tmpdir(),
          `agents-hub-opencode-agent-list-${stableHash(cwd).toString(16)}-${process.pid}.db`
        ),
        OMO_DISABLE_POSTHOG: '1',
        OMO_SEND_ANONYMOUS_TELEMETRY: '0',
      };
      const proc = spawn(command, ['agent', 'list'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const seen = new Set<string>();
      const modes: CliAgentMode[] = [];
      let buffer = '';
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        parseLines(buffer);
        resolve(modes);
      };

      const parseLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          const mode = parseOpenCodeAgentListLine(line);
          if (!mode || seen.has(mode.id)) {
            continue;
          }

          seen.add(mode.id);
          modes.push(mode);
        }
      };

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        finish();
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        parseLines(lines.join('\n'));
      });
      proc.on('close', finish);
      proc.on('error', finish);
    });
  }

  private getOpenCodeModelOptions(command: string): Promise<CliModelOption[]> {
    const cwd = this.getWorkspaceRoot();
    return new Promise<CliModelOption[]>((resolve) => {
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      const env = {
        ...process.env,
        PATH: mergePathEntries([
          commandDir,
          buildCliLookupPath(process.env.PATH, process.env.HOME),
        ]),
        OPENCODE_DB: path.join(
          os.tmpdir(),
          `agents-hub-opencode-models-${stableHash(cwd).toString(16)}-${process.pid}.db`
        ),
        OMO_DISABLE_POSTHOG: '1',
        OMO_SEND_ANONYMOUS_TELEMETRY: '0',
      };
      const proc = spawn(command, ['models'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(parseOpenCodeModelsOutput(output));
      };

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        finish();
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.length > 1_000_000) {
          try {
            proc.kill('SIGTERM');
          } catch {
            // Process may already be gone.
          }
          finish();
        }
      });
      proc.on('close', finish);
      proc.on('error', () => finish());
    });
  }

  private getCommandVersion(profile: CliProfile): Promise<string | undefined> {
    return this.resolveCommandPath(profile.command).then((command) => {
      if (!command) {
        return undefined;
      }

      return new Promise<string | undefined>((resolve) => {
        const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
        const proc = spawn(command, profile.versionArgs ?? ['--version'], {
          env: {
            ...process.env,
            PATH: mergePathEntries([
              commandDir,
              buildCliLookupPath(process.env.PATH, process.env.HOME),
            ]),
            ...this.expandProfileEnv(profile.env, this.getWorkspaceRoot()),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const finish = (version: string | undefined) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          resolve(version);
        };
        const timeout = setTimeout(() => {
          proc.kill('SIGTERM');
          finish(undefined);
        }, 1800);

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });
        proc.stderr?.on('data', (data: Buffer) => {
          output += data.toString();
        });
        proc.on('close', () => finish(normalizeCommandVersionOutput(output)));
        proc.on('error', () => finish(undefined));
      });
    });
  }

  /** Start a CLI in prompt (non-interactive) mode. */
  async startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs: string[] = [],
    agentModeId?: string,
    optionKey?: string,
    envOverrides: Record<string, string> = {}
  ): Promise<Session | null> {
    const profile = getCliProfile(cliId);
    if (!profile) { return null; }

    const cwd = this.getWorkspaceRoot();
    const n = (this.counters.get(cliId) ?? 0) + 1;
    this.counters.set(cliId, n);
    const sessionId = `${cliId}-${n}`;
    const command = await this.resolveCommandPath(profile.command) ?? profile.command;
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const env = {
      ...process.env,
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...this.expandProfileEnv(profile.env, cwd),
      ...envOverrides,
    };
    const backgroundAttachArgs = await this.getBackgroundAttachArgs(profile, command, cwd, env);
    const args =
      profile.inputMode === 'argument' && initialInput
        ? [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs, initialInput]
        : [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs];
    const onOutput = new vscode.EventEmitter<string>();
    const onStderr = new vscode.EventEmitter<string>();
    const onError = new vscode.EventEmitter<string>();
    const onEnd = new vscode.EventEmitter<number>();
    const eventStreamUrl = this.getOpenCodeEventStreamUrl(profile, backgroundAttachArgs);
    const eventStream = eventStreamUrl
      ? this.openOpenCodeEventStream(eventStreamUrl, onOutput)
      : undefined;

    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: [profile.inputMode === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const session: Session = {
      id: sessionId,
      cliId,
      agentModeId,
      optionKey,
      profile,
      process: proc,
      onOutput,
      onStderr,
      onError,
      onEnd,
      eventStream,
    };

    proc.stdout?.on('data', (data: Buffer) => {
      if (eventStream?.hasOutput()) {
        return;
      }
      session.onOutput.fire(data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      session.onStderr.fire(data.toString());
    });

    proc.on('close', (code) => {
      session.eventStream?.close();
      session.onEnd.fire(code ?? -1);
      this.sessions.delete(sessionId);
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.commandPathCache.delete(profile.command);
      }
      session.eventStream?.close();
      session.onError.fire(`Failed to start ${profile.name}: ${err.message}`);
      session.onEnd.fire(-1);
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);

    if (profile.inputMode === 'stdin' && initialInput) {
      this.sendInput(sessionId, initialInput, !profile.keepStdinOpen);
    }

    return session;
  }

  sendInput(sessionId: string, text: string, closeAfterWrite = false): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process.stdin || session.process.stdin.destroyed) { return false; }
    session.process.stdin.write(text + '\n');
    if (closeAfterWrite) {
      session.process.stdin.end();
    }
    return true;
  }

  /** Get the active session for a specific CLI tool (latest one) */
  getSessionForCli(cliId: string): Session | undefined {
    let latest: Session | undefined;
    for (const session of this.sessions.values()) {
      if (session.cliId === cliId) {
        latest = session;
      }
    }
    return latest;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }
    try {
      session.eventStream?.close();
      session.process.kill('SIGTERM');
    } catch {
      // process may already be dead
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const [id] of this.sessions) {
      this.stop(id);
    }
    this.stopBackgroundServers();
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  private async getBackgroundAttachArgs(
    profile: CliProfile,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<string[]> {
    if (!profile.backgroundServer) {
      return [];
    }

    for (const server of this.resolveBackgroundServerCandidates(profile, cwd)) {
      const state = this.backgroundServers.get(server.key);
      const ownedProcess =
        state?.process && state.process.exitCode === null && !state.process.killed;

      if (ownedProcess && await this.waitForTcp(server.host, server.port, 120)) {
        return server.attachArgs;
      }

      if (!ownedProcess && await this.waitForTcp(server.host, server.port, 120)) {
        continue;
      }

      const nextState = state ?? {};
      this.backgroundServers.set(server.key, nextState);

      if (!nextState.starting) {
        nextState.starting = this.startBackgroundServer(
          server.key,
          command,
          server.args,
          cwd,
          env,
          server.host,
          server.port
        );
      }

      const ready = await nextState.starting;
      if (ready) {
        return server.attachArgs;
      }
    }

    return [];
  }

  private resolveBackgroundServerCandidates(
    profile: CliProfile,
    cwd: string
  ): ResolvedBackgroundServer[] {
    const server = profile.backgroundServer;
    if (!server) {
      return [];
    }

    const ports = this.backgroundServerPorts(profile.id, cwd);
    return ports
      .map((port) => {
        const url = this.expandBackgroundServerArg(server.url, cwd, port);
        const target = this.getTcpTarget(url);
        if (!target) {
          return undefined;
        }

        return {
          key: `${profile.id}:${url}`,
          args: server.args.map((arg) => this.expandBackgroundServerArg(arg, cwd, port)),
          attachArgs: server.attachArgs.map((arg) => this.expandBackgroundServerArg(arg, cwd, port)),
          host: target.host,
          port: target.port,
        };
      })
      .filter((candidate): candidate is ResolvedBackgroundServer => Boolean(candidate));
  }

  private backgroundServerPorts(profileId: string, cwd: string): number[] {
    const profile = getCliProfile(profileId);
    const range = profile?.backgroundServer?.portRange;
    if (!range) {
      const target = profile?.backgroundServer && this.getTcpTarget(profile.backgroundServer.url);
      return target ? [target.port] : [];
    }

    const size = Math.max(1, range.size);
    const offset = stableHash(`${profileId}:${cwd}`) % size;
    return Array.from({ length: size }, (_, index) => range.start + ((offset + index) % size));
  }

  private expandBackgroundServerArg(value: string, cwd: string, port: number): string {
    return value
      .replace(/\{cwd\}/g, cwd)
      .replace(/\{port\}/g, String(port));
  }

  private expandProfileEnv(
    env: Record<string, string> | undefined,
    cwd: string
  ): Record<string, string> {
    if (!env) {
      return {};
    }

    const cwdHash = stableHash(cwd).toString(16);
    const replacements: Record<string, string> = {
      cwd,
      cwdHash,
      tmp: os.tmpdir(),
    };

    return Object.fromEntries(
      Object.entries(env).map(([key, value]) => [
        key,
        value.replace(/\{(cwd|cwdHash|tmp)\}/g, (_match, token: string) => replacements[token] ?? ''),
      ])
    );
  }

  private getOpenCodeEventStreamUrl(
    profile: CliProfile,
    attachArgs: string[]
  ): string | undefined {
    if (profile.id !== 'opencode') {
      return undefined;
    }

    const attachIndex = attachArgs.indexOf('--attach');
    return attachIndex >= 0 ? attachArgs[attachIndex + 1] : undefined;
  }

  private openOpenCodeEventStream(
    serverUrl: string,
    output: vscode.EventEmitter<string>
  ): OpenCodeEventStream | undefined {
    let closed = false;
    let outputSeen = false;
    let request: http.ClientRequest | undefined;
    const partTypes = new Map<string, string>();

    try {
      const eventUrl = new URL('/event', serverUrl);
      const client = eventUrl.protocol === 'https:' ? https : http;
      request = client.get(
        eventUrl,
        { headers: { Accept: 'text/event-stream' } },
        (response) => {
          response.setEncoding('utf8');
          let buffer = '';

          response.on('data', (chunk: string) => {
            buffer += chunk.replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const rendered = this.renderOpenCodeSseBlock(block, partTypes);
              if (rendered) {
                outputSeen = true;
                output.fire(rendered);
              }
              boundary = buffer.indexOf('\n\n');
            }
          });
        }
      );

      request.on('error', () => {
        // Fall back to the CLI stdout JSON if the event stream cannot be opened.
      });
    } catch {
      return undefined;
    }

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        request?.destroy();
      },
      hasOutput: () => outputSeen,
    };
  }

  private renderOpenCodeSseBlock(
    block: string,
    partTypes: Map<string, string>
  ): string {
    const event = this.parseOpenCodeSseBlock(block);
    if (!event) {
      return '';
    }

    const type = typeof event.type === 'string' ? event.type : '';
    const properties = this.objectRecord(event.properties);

    if (type.includes('message.part.updated')) {
      const part = this.objectRecord(properties.part);
      const partId = typeof part.id === 'string' ? part.id : undefined;
      const partType = typeof part.type === 'string' ? part.type : undefined;
      if (partId && partType) {
        partTypes.set(partId, partType);
      }
      return '';
    }

    if (!type.includes('message.part.delta')) {
      return '';
    }

    const partId = typeof properties.partID === 'string' ? properties.partID : undefined;
    const partType = partId ? partTypes.get(partId) : undefined;
    if (partType === 'tool') {
      return '';
    }

    const eventWithPart = partType
      ? {
          ...event,
          properties: {
            ...properties,
            part: { type: partType },
          },
        }
      : event;

    return `${JSON.stringify(eventWithPart)}\n`;
  }

  private parseOpenCodeSseBlock(block: string): Record<string, unknown> | undefined {
    const trimmed = block.trim();
    if (!trimmed) {
      return undefined;
    }

    const lines = trimmed.split('\n');
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    const data = dataLines.length > 0 ? dataLines.join('\n') : trimmed;

    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }

      const event = parsed as Record<string, unknown>;
      return typeof event.type === 'string' || !eventName
        ? event
        : { ...event, type: eventName };
    } catch {
      return undefined;
    }
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async startBackgroundServer(
    key: string,
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    host: string,
    port: number
  ): Promise<boolean> {
    const current = this.backgroundServers.get(key);
    if (current?.process && current.process.exitCode === null && !current.process.killed) {
      return this.waitForTcp(host, port, 1800);
    }

    try {
      const proc = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      const state = this.backgroundServers.get(key) ?? {};
      state.process = proc;
      this.backgroundServers.set(key, state);

      const clearState = () => {
        const latest = this.backgroundServers.get(key);
        if (latest?.process === proc) {
          this.backgroundServers.delete(key);
        }
      };

      proc.on('exit', clearState);
      proc.on('error', clearState);
    } catch {
      this.backgroundServers.delete(key);
      return false;
    }

    const ready = await this.waitForTcp(host, port, 2200);
    if (!ready) {
      const state = this.backgroundServers.get(key);
      if (state) {
        state.starting = undefined;
      }
    }

    return ready;
  }

  private stopBackgroundServers(): void {
    for (const [, state] of this.backgroundServers) {
      if (!state.process || state.process.killed) {
        continue;
      }

      try {
        state.process.kill('SIGTERM');
      } catch {
        // background process may already be dead
      }
    }
    this.backgroundServers.clear();
  }

  private getTcpTarget(urlText: string): { host: string; port: number } | undefined {
    try {
      const url = new URL(urlText);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!url.hostname || !Number.isFinite(port)) {
        return undefined;
      }

      return { host: url.hostname, port };
    } catch {
      return undefined;
    }
  }

  private async waitForTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.canConnectTcp(host, port, 180)) {
        return true;
      }
      await this.sleep(80);
    }

    return false;
  }

  private canConnectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function preferredOpenCodeDefaultAgent(modes: CliAgentMode[], fallback: string): string {
  const runnableModes = modes.filter((mode) => !mode.disabled);
  return (
    runnableModes.find((mode) => mode.id === fallback)?.id ??
    runnableModes[0]?.id ??
    fallback
  );
}

function mergeOpenCodeAgentModes(...groups: CliAgentMode[][]): CliAgentMode[] {
  const seen = new Set<string>();
  const merged: CliAgentMode[] = [];
  for (const group of groups) {
    for (const mode of group) {
      if (seen.has(mode.id)) {
        continue;
      }

      seen.add(mode.id);
      merged.push(mode);
    }
  }
  return merged;
}

function preferredOpenCodeDefaultModel(options: CliModelOption[], fallback: string | undefined): string {
  const selectableOptions = options.filter((option) => !option.disabled && !option.actionOnly);
  return (
    selectableOptions.find((option) => option.id === fallback)?.id ??
    selectableOptions[0]?.id ??
    fallback ??
    'configured'
  );
}

function mergeOpenCodeModelOptions(
  baseOptions: CliModelOption[],
  discoveredOptions: CliModelOption[]
): CliModelOption[] {
  const baseVisibleOptions = discoveredOptions.length > 0
    ? baseOptions.filter((option) => option.id !== 'default' && option.id !== 'configured')
    : baseOptions;
  const defaultOptions = baseVisibleOptions.filter((option) => !option.custom);
  const customOptions = baseVisibleOptions.filter((option) => option.custom);
  const seen = new Set<string>();
  const merged: CliModelOption[] = [];

  for (const option of [...defaultOptions, ...discoveredOptions, ...customOptions]) {
    if (seen.has(option.id)) {
      continue;
    }

    seen.add(option.id);
    merged.push(option);
  }

  return merged;
}

function normalizeCommandVersionOutput(output: string): string | undefined {
  const firstLine = output
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return undefined;
  }

  const version = firstLine.match(/\bv?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?\b/);
  return (version?.[0] ?? firstLine.slice(0, 40)).replace(/^v(?=\d)/, '');
}
