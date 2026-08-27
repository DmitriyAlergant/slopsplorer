import { spawn } from "node:child_process";
import path from "node:path";

/** What a finished child process left behind. */
export interface ProcessResult {
  /** Exit code, or `null` when a signal ended it or it never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Why the process never started, or `null` when it ran. */
  startFailure: string | null;
  /** Whether the run reached its ceiling and was stopped for it. */
  timedOut: boolean;
}

/** Ceiling on what one process may buffer, so a runaway agent cannot fill memory. */
const MAX_CAPTURED_BYTES = 4 * 1024 * 1024;

/** How long a stopped process is given to end itself before it is killed. */
const STOP_GRACE_MS = 3000;

export interface RunningProcess {
  /** Resolves when the process ends, however it ends. It never rejects. */
  finished: Promise<ProcessResult>;
  /** End it now, if it still runs. */
  stop(): void;
}

/**
 * `PATH` as the person's own shell has it.
 *
 * npm puts every ancestor `node_modules/.bin` at the front of `PATH` for a
 * script it runs, and `npx slopsplorer` is a script it runs. A stale copy of a
 * coding agent in one of those folders would then be chosen over the one the
 * person installed and signed in, so those entries come off before an agent is
 * resolved. Nothing else is changed: the agent gets the environment it would
 * have had if it had been started by hand.
 */
export function pathOutsidePackageBins(pathValue: string): string {
  const binSuffix = `${path.sep}node_modules${path.sep}.bin`;
  return pathValue
    .split(path.delimiter)
    .filter((entry) => !entry.endsWith(binSuffix))
    .join(path.delimiter);
}

export interface RunOptions {
  /** Directory the process runs in. */
  cwd: string;
  /** Ceiling on the run. Reaching it stops the process the way a reader would. */
  timeoutMs: number;
}

/**
 * Run one command with an argument list, and collect what it writes.
 *
 * Never through a shell, so a question typed into the page is one argument and
 * can never become part of a command line. Both callers use this: discovery
 * awaits the result, and an ask keeps the handle so the reader can stop it.
 */
export function runCommand(
  command: string, commandArguments: readonly string[], options: RunOptions,
): RunningProcess {
  const inheritedPath = process.env["PATH"];
  const child = spawn(command, [...commandArguments], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    // Its own process group, so stopping an ask stops the tools the agent
    // itself started. Signalling the agent alone would leave them running.
    detached: process.platform !== "win32",
    env: inheritedPath === undefined
      ? process.env
      : { ...process.env, PATH: pathOutsidePackageBins(inheritedPath) },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length < MAX_CAPTURED_BYTES) stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_CAPTURED_BYTES) stderr += chunk;
  });

  /**
   * End the agent and everything it started.
   *
   * An agent runs its own tools as child processes, so the target is the group
   * and not the one process. Windows has no group to signal, so `taskkill`
   * walks the tree there instead.
   */
  const endTree = (force: boolean): void => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      const arguments_ = ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])];
      spawn("taskkill", arguments_, { stdio: "ignore", shell: false }).unref();
      return;
    }
    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch (cause) {
      // The group ended between the check and the signal, which is the outcome
      // asked for. Anything else is a real failure and belongs to the caller.
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
  };

  let killTimer: NodeJS.Timeout | null = null;
  let timedOut = false;
  const stop = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    endTree(false);
    // A tool that ignores SIGTERM would otherwise stay "running" forever on a
    // page where the reader has already dismissed it.
    killTimer = setTimeout(() => endTree(true), STOP_GRACE_MS);
    killTimer.unref();
  };

  const finished = new Promise<ProcessResult>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const settle = (result: ProcessResult): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    child.on("error", (error: Error) => {
      settle({ code: null, stdout, stderr, startFailure: error.message, timedOut });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr, startFailure: null, timedOut });
    });
  });

  return { finished, stop };
}
