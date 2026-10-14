import path from "node:path";
import type { ChangeStatus, UnmeasuredFileRow, UnmeasuredReason } from "../shared/api.ts";
import { classifyFile, isGenerated } from "./classify.ts";

export function unmeasuredFile(
  relativePath: string, reason: UnmeasuredReason, localeLevels: ReadonlySet<string>,
  status: ChangeStatus = "unchanged", previousPath: string | null = null,
): UnmeasuredFileRow {
  return {
    path: relativePath, name: path.posix.basename(relativePath),
    kind: classifyFile(relativePath, localeLevels), generated: isGenerated(relativePath),
    status, previousPath, beforeMode: null, afterMode: null, measurement: reason, language: null,
    tokens: null, lines: null, codeLines: null, commentLines: null, blankLines: null,
    beforeTokens: null, beforeLines: null, beforeCodeLines: null,
    addedTokens: null, removedTokens: null, churnTokens: null, netTokens: null,
    addedLines: null, removedLines: null, churnLines: null, netLines: null,
    addedCodeLines: null, removedCodeLines: null, churnCodeLines: null, netCodeLines: null,
    addedCommentLines: null, removedCommentLines: null,
    addedPhysicalLines: null, removedPhysicalLines: null,
    functions: null, classes: null, branches: null,
    beforeFunctions: null, beforeClasses: null, beforeBranches: null,
  };
}
