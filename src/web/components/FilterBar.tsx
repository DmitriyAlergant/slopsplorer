import {
  ASPECTS, MEASURES, aspectDescription, aspectHeading, measureHeading,
  type AgentTool, type Aspect, type Measure, type OpenInApplication, type OpenInOption,
  type ViewRequest,
} from "../../shared/api.ts";
import { AgentPicker } from "./AgentPicker.tsx";
import { OpenInPicker } from "./OpenInPicker.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  request: ViewRequest;
  /** Only a comparison has sides, so only a comparison offers the aspect switch. */
  isDiff: boolean;
  onQueryChange: (query: string) => void;
  onMeasureChange: (measure: Measure) => void;
  onAspectChange: (aspect: Aspect) => void;
  /** The folder both actions act on, or null while no scan is loaded. */
  actionTarget: string | null;
  openInOptions: readonly OpenInOption[];
  openInApplication: OpenInApplication;
  openingIn: OpenInApplication | null;
  onOpenIn: (application: OpenInApplication) => void;
  /** Agents this host can run. No agent, no control: there is nothing to ask. */
  agents: readonly AgentTool[];
  agentId: string;
  onChooseAgent: (agentId: string) => void;
  onAsk: () => void;
}

const MEASURE_DESCRIPTIONS: Record<Measure, string> = {
  tokens: "Tokenizer count for the whole file, comments and whitespace included.",
  lines: "Every line with content, comment lines included. Blank lines are excluded.",
  codeLines: "Content lines that are not entirely comment. A line of code with a trailing comment still counts.",
};

/**
 * The quantity every figure is counted in, what is counted, and the two acts
 * that take the whole page somewhere else.
 *
 * The unit switch comes first because a scan has no side to pick: the aspect
 * switch appears only in a comparison, so putting it last keeps the units in
 * one place while the page moves between before, diff, and after. They sit
 * above the workspace because they change what every figure says.
 * Flavor controls sit above the file table with the scope totals they change.
 *
 * Open in and Ask end the row. Both act on the drilled folder, which this bar
 * scopes, and the bar holds the top of the page once the header scrolls away.
 */
export function FilterBar({
  request, isDiff, onQueryChange, onMeasureChange, onAspectChange,
  actionTarget, openInOptions, openInApplication, openingIn, onOpenIn,
  agents, agentId, onChooseAgent, onAsk,
}: Props): React.JSX.Element {
  return (
    <section className="filters" aria-label="Page controls">
      <label className="search">
        <span className="visually-hidden">Search folders and files</span>
        <input
          type="search"
          value={request.query}
          placeholder="Filter by path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="filters__switches">
        <div className="switch" role="group" aria-label="Unit every figure is expressed in">
          {MEASURES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="switch__option"
              aria-pressed={candidate === request.measure}
              onClick={() => onMeasureChange(candidate)}
              {...tooltipHandlers}
            >
              {measureHeading(candidate)}
              <Tooltip>{MEASURE_DESCRIPTIONS[candidate]}</Tooltip>
            </button>
          ))}
        </div>

        {isDiff ? (
          <div className="switch" role="group" aria-label="Side of the change every figure describes">
            {ASPECTS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="switch__option"
                aria-pressed={candidate === request.aspect}
                onClick={() => onAspectChange(candidate)}
                {...tooltipHandlers}
              >
                {aspectHeading(candidate)}
                <Tooltip>{aspectDescription(candidate)}</Tooltip>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="filters__actions">
        {openInOptions.length > 0 && actionTarget ? (
          <OpenInPicker
            options={openInOptions}
            application={openInApplication}
            targetLabel={actionTarget}
            opening={openingIn}
            onOpen={onOpenIn}
          />
        ) : null}
        {agents.length > 0 ? (
          <AgentPicker agents={agents} agentId={agentId} onChoose={onChooseAgent} onAsk={onAsk} />
        ) : null}
      </div>
    </section>
  );
}
