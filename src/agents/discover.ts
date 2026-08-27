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
  /** Whether the tool answered the sign-in probe as able to reach a model. */
  signedIn: boolean;
}

/**
 * Find which of the known agents this machine can run, and which of those it
 * can answer with.
 *
 * Two questions, both asked of the tool itself rather than of its config files:
 * is it installed, and is it signed in. A tool that is not installed is left
 * out, and a tool that is installed but reports no sign-in is offered with that
 * said on its row, because the reader is the one who knows whether the probe
 * is right about them.
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
    const signedIn = auth.startFailure === null && definition.isSignedIn(auth);

    return { definition, version: definition.readVersion(version), signedIn };
  }));
  return found.filter((agent): agent is AvailableAgent => agent !== null);
}
