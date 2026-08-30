import type { OpenInApplication } from "../../shared/api.ts";
import { AgentMark } from "./AgentMark.tsx";

interface Props {
  application: OpenInApplication;
  size?: number;
}

/** Fixed local marks for the three applications in the Open in menu. */
export function OpenInMark({ application, size = 16 }: Props): React.JSX.Element {
  if (application === "cursor") {
    return <AgentMark agentId="cursor" size={size} />;
  }
  if (application === "vscode") {
    return (
      <svg className="open-in-mark open-in-mark--vscode" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path fill="currentColor" d="m17.8 2.4-8.2 7.2-4.8-3.7L2 8.6l4.8 3.7L2 16l2.8 2.7 4.8-3.7 8.2 7.1 4.2-2V4.4Zm0 5.1v9.7l-5.6-4.8Z" />
      </svg>
    );
  }
  return (
    <svg className="open-in-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M2.5 7.5h7l2-2h10v14h-19Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
