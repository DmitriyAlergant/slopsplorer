import { measureLines, measureLinesByMarkers, type LineMetrics } from "./lines.ts";
import { grammarForFile, type StructureAnalyzer, type StructureCounts } from "./structure.ts";

/** Everything one file's content yields, before path-derived attributes. */
export interface FileMeasurement {
  /** The grammar that produced the structure counts, or `null`. */
  grammar: string | null;
  structure: StructureCounts;
  lines: LineMetrics;
}

/**
 * Measure one file's structure and line split.
 *
 * The two paths are chosen here rather than at the call site so that the
 * scanner and the tests cannot drift apart on which files get exact comment
 * spans and which get marker detection.
 */
export async function measureFile(
  analyzer: StructureAnalyzer,
  fileName: string,
  text: string,
): Promise<FileMeasurement> {
  const grammar = grammarForFile(fileName, text);
  const structure = await analyzer.analyze(grammar, text);
  // A grammar gives exact comment spans anywhere in the file. Everything else
  // falls back to comment markers, which report every content line as code for
  // a format with no known comment syntax rather than reporting nothing.
  const lines = grammar
    ? measureLines(text, structure.commentRanges)
    : measureLinesByMarkers(text, fileName);
  return { grammar, structure, lines };
}
