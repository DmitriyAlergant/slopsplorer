import type { AskRequest, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, FLAVOR_DETAILS, weightName } from "../shared/api.ts";
import type { ScanIndex } from "../scanner/scan.ts";
import { buildView } from "./aggregate.ts";

/** What is asked when the reader types nothing: the brief already names a subject. */
const UNASKED_QUESTION = "Tell me what I am looking at here, and what stands out about it.";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Net is the one signed quantity, and an unsigned net figure means nothing. */
function formatWeight(value: number, signed: boolean): string {
  if (!signed || value === 0) return formatCount(value);
  return value < 0 ? formatCount(value) : `+${formatCount(value)}`;
}

/** The flavors the switches keep, named as the switches name them. */
function describeFlavors(request: ViewRequest): string {
  const kept = FILE_KINDS.filter((kind) => request.kinds.includes(kind))
    .map((kind) => FLAVOR_DETAILS[kind].label);
  const flavors = kept.length === 0 ? "none" : kept.join(", ");
  return request.showGenerated ? `${flavors}, and generated files` : flavors;
}

/** What the tree selection is about: a folder and everything under it, or its own files. */
function describeSelection(request: ViewRequest): string {
  const path = request.selected.path === "" ? "the project root" : request.selected.path;
  return request.selected.rowKind === "files" ? `the files directly in ${path}` : path;
}

/**
 * Everything one ask sends: what the reader is looking at, then what they asked.
 *
 * Built here and not in the browser, because the figures in it must be the
 * figures the page draws, and the server is what produces those. The whole text
 * stays on the task, so the page can show exactly what the agent was given.
 */
export function composeBrief(index: ScanIndex, ask: AskRequest): string {
  const view = buildView(index, ask.view);
  const { meta } = index;
  const isDiff = meta.diff !== null;
  const unit = weightName(view.measure, view.aspect, isDiff);
  const signed = isDiff && view.aspect === "net";

  const facts: string[] = [];
  facts.push(meta.diff === null
    ? `Subject: a scan of ${meta.rootPath}`
    : `Subject: a comparison of ${meta.diff.base} against ${meta.diff.target}, in ${meta.rootPath}.`
      + ` It was asked for as "${meta.diff.spec}".`);
  facts.push(`Unit on screen: ${unit}, counted with the ${meta.tokenizer} tokenizer`);
  facts.push(`Drilled into: ${ask.view.drillPath === "" ? "the whole project" : ask.view.drillPath}`);
  facts.push(`Selected: ${describeSelection(ask.view)}`);
  facts.push(`Flavors counted: ${describeFlavors(ask.view)}`);
  if (ask.view.query !== "") facts.push(`Path filter: "${ask.view.query}"`);
  if (ask.lastViewedPath !== null) facts.push(`Last file they opened: ${ask.lastViewedPath}`);
  facts.push(
    `The selection holds ${formatCount(view.detail.files)} files`
    + ` and ${formatWeight(view.detail.weight, signed)} ${unit}.`
    + ` What they have on screen, filters applied, holds ${formatCount(view.summary.selectedFiles)} files`
    + ` and ${formatWeight(view.summary.selectedWeight, signed)} ${unit}.`,
  );

  const question = ask.question.trim() === "" ? UNASKED_QUESTION : ask.question.trim();

  return [
    "You are answering a question from a person who is reading a codebase in Slopsplorer.",
    "Slopsplorer measures every file of a source tree by tokens, by lines, and by structure,"
    + " and it draws a map of where the weight of the tree sits.",
    "",
    "## What they are looking at",
    "",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "## Their question",
    "",
    question,
    "",
    "Answer in Markdown, and keep it as short as the question allows."
    + " Read any file you need. Do not change any file.",
    "",
  ].join("\n");
}
