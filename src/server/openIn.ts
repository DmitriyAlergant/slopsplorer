import { execFile } from "node:child_process";
import type { OpenInApplication, OpenInOption } from "../shared/api.ts";

export interface OpenInPlan {
  command: string;
  arguments: string[];
}

/** The menu is fixed. Only the native file manager's name varies by host. */
export function buildOpenInOptions(platform: NodeJS.Platform): OpenInOption[] {
  const fileManagerLabel = platform === "darwin"
    ? "Finder"
    : platform === "win32"
      ? "File Explorer"
      : "File manager";
  return [
    { id: "cursor", label: "Cursor" },
    { id: "vscode", label: "VS Code" },
    { id: "fileManager", label: fileManagerLabel },
  ];
}

/** Build one argument list with no shell, so a path cannot become a command. */
export function buildOpenInPlan(
  platform: NodeJS.Platform,
  application: OpenInApplication,
  targetPath: string,
): OpenInPlan {
  if (platform === "darwin") {
    if (application === "cursor") return { command: "open", arguments: ["-a", "Cursor", targetPath] };
    if (application === "vscode") {
      return { command: "open", arguments: ["-a", "Visual Studio Code", targetPath] };
    }
    return { command: "open", arguments: [targetPath] };
  }
  if (application === "cursor") return { command: "cursor", arguments: [targetPath] };
  if (application === "vscode") return { command: "code", arguments: [targetPath] };
  return platform === "win32"
    ? { command: "explorer.exe", arguments: [targetPath] }
    : { command: "xdg-open", arguments: [targetPath] };
}

/** Start the chosen application and report a missing launcher or rejected path. */
export function launchOpenIn(
  platform: NodeJS.Platform,
  application: OpenInApplication,
  targetPath: string,
): Promise<void> {
  const plan = buildOpenInPlan(platform, application, targetPath);
  return new Promise((resolve, reject) => {
    execFile(plan.command, plan.arguments, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(detail || error.message));
    });
  });
}
