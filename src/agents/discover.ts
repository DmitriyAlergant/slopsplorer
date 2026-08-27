import type { AgentDefinition } from "./definitions.ts";
import { runCommand } from "./process.ts";

/**
 * Long enough for a cold CLI to start and answer, short enough that a hung one
 * cannot hold up the page the reader is waiting for.
 */
const PROBE_TIMEOUT_MS = 10_000;

/** One agent this host can run, with the version it reported. */
export interface AvailableAgent {
  definition: AgentDefinition;
  version: string;
}

/**
 * Find which of the known agents this machine can actually answer with.
 *
 * Two questions, both asked of the tool itself rather than of its config files:
 * is it installed, and is it signed in. A tool that fails either is left out,
 * because offering it would put a button on the page that fails only after the
 * reader has typed a question.
 */
export async function discoverAgents(
  definitions: readonly AgentDefinition[], cwd: string,
): Promise<AvailableAgent[]> {
  const found = await Promise.all(definitions.map(async (definition) => {
    const version = await runCommand(
      definition.command, definition.versionArguments, { cwd, timeoutMs: PROBE_TIMEOUT_MS },
    ).finished;
    if (version.startFailure !== null || version.code !== 0) return null;

    const auth = await runCommand(
      definition.command, definition.authArguments, { cwd, timeoutMs: PROBE_TIMEOUT_MS },
    ).finished;
    if (auth.startFailure !== null || !definition.isSignedIn(auth)) return null;

    return { definition, version: definition.readVersion(version) };
  }));
  return found.filter((agent): agent is AvailableAgent => agent !== null);
}
