import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { shebangInterpreter } from "./classify.ts";
import type { CommentRange } from "./lines.ts";

const require = createRequire(import.meta.url);

/** Structural counts for one file. Zero everywhere when no grammar applies. */
export interface StructureCounts {
  functions: number;
  classes: number;
  branches: number;
  /** Spans the line classifier uses to separate comment lines from code. */
  commentRanges: CommentRange[];
}

export function emptyStructure(): StructureCounts {
  return { functions: 0, classes: 0, branches: 0, commentRanges: [] };
}

/**
 * Node types that count toward each metric, per grammar.
 *
 * These are explicit rather than pattern-matched: the numbers are the product's
 * output, so a reader needs to be able to check exactly what was counted.
 * `branches` counts decision points, so clauses that the grammar nests inside a
 * parent (`else_clause`, `catch_clause`) are omitted to avoid double counting,
 * while genuinely additional decisions (`elif_clause`) are included.
 */
interface LanguageRule {
  grammar: string;
  functions: readonly string[];
  classes: readonly string[];
  branches: readonly string[];
  /**
   * Count bare string statements as commentary.
   *
   * Python has no block-comment syntax, so docstrings carry the explanatory
   * weight that `/* ... *\/` carries elsewhere. Counting them as code would
   * understate how much of a module is prose.
   */
  docstrings?: boolean;
}

/** A statement whose whole content is a string literal, i.e. a docstring. */
function isDocstring(node: { type: string; namedChildCount: number; namedChild(index: number): { type: string } | null } | null): boolean {
  if (node === null || node.type !== "expression_statement" || node.namedChildCount !== 1) return false;
  const child = node.namedChild(0);
  return child !== null && (child.type === "string" || child.type === "concatenated_string");
}

const RULES: readonly LanguageRule[] = [
  {
    grammar: "python",
    functions: ["function_definition"],
    classes: ["class_definition"],
    branches: ["if_statement", "elif_clause", "for_statement", "while_statement", "try_statement", "match_statement", "conditional_expression"],
    docstrings: true,
  },
  {
    grammar: "javascript",
    functions: ["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function_declaration"],
    classes: ["class_declaration"],
    branches: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "ternary_expression"],
  },
  {
    grammar: "typescript",
    functions: ["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function_declaration", "function_signature", "method_signature"],
    classes: ["class_declaration", "interface_declaration", "enum_declaration"],
    branches: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "ternary_expression"],
  },
  {
    grammar: "tsx",
    functions: ["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function_declaration", "function_signature", "method_signature"],
    classes: ["class_declaration", "interface_declaration", "enum_declaration"],
    branches: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "ternary_expression"],
  },
  {
    grammar: "go",
    functions: ["function_declaration", "method_declaration", "func_literal"],
    classes: ["type_declaration"],
    branches: ["if_statement", "for_statement", "expression_switch_statement", "type_switch_statement", "select_statement"],
  },
  {
    grammar: "rust",
    functions: ["function_item", "closure_expression"],
    classes: ["struct_item", "enum_item", "trait_item", "impl_item", "union_item"],
    branches: ["if_expression", "match_expression", "for_expression", "while_expression", "loop_expression"],
  },
  {
    grammar: "java",
    functions: ["method_declaration", "constructor_declaration", "lambda_expression"],
    classes: ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"],
    branches: ["if_statement", "for_statement", "enhanced_for_statement", "while_statement", "do_statement", "switch_expression", "switch_statement", "try_statement", "ternary_expression"],
  },
  {
    grammar: "ruby",
    functions: ["method", "singleton_method"],
    classes: ["class", "singleton_class", "module"],
    branches: ["if", "unless", "while", "until", "case", "case_match", "for", "rescue", "elsif", "if_modifier", "unless_modifier", "while_modifier", "until_modifier", "conditional"],
  },
  {
    grammar: "cpp",
    functions: ["function_definition", "lambda_expression"],
    classes: ["class_specifier", "struct_specifier", "union_specifier", "enum_specifier"],
    branches: ["if_statement", "for_statement", "for_range_loop", "while_statement", "do_statement", "switch_statement", "try_statement", "conditional_expression"],
  },
  {
    grammar: "c-sharp",
    functions: ["method_declaration", "constructor_declaration", "local_function_statement", "lambda_expression"],
    classes: ["class_declaration", "struct_declaration", "interface_declaration", "enum_declaration", "record_declaration"],
    branches: ["if_statement", "for_statement", "for_each_statement", "while_statement", "do_statement", "switch_statement", "switch_expression", "try_statement", "conditional_expression"],
  },
  {
    grammar: "php",
    functions: ["function_definition", "method_declaration", "anonymous_function_creation_expression", "arrow_function"],
    classes: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
    branches: ["if_statement", "for_statement", "foreach_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "match_expression", "conditional_expression"],
  },
  {
    grammar: "bash",
    functions: ["function_definition"],
    classes: [],
    branches: ["if_statement", "elif_clause", "for_statement", "while_statement", "case_statement"],
  },
  {
    grammar: "powershell",
    functions: ["function_statement", "script_block_expression"],
    classes: ["class_statement", "enum_statement"],
    branches: ["if_statement", "elseif_clause", "for_statement", "foreach_statement", "while_statement", "do_statement", "switch_statement", "try_statement"],
  },
];

/** A rule with its node-type lists turned into sets, built once per process. */
interface CompiledRule {
  functions: ReadonlySet<string>;
  classes: ReadonlySet<string>;
  branches: ReadonlySet<string>;
  docstrings: boolean;
}

const RULES_BY_GRAMMAR: ReadonlyMap<string, CompiledRule> = new Map(
  RULES.map((rule) => [rule.grammar, {
    functions: new Set(rule.functions),
    classes: new Set(rule.classes),
    branches: new Set(rule.branches),
    docstrings: rule.docstrings === true,
  }]),
);

/** File extension to grammar name. Extensions absent here get no structure metrics. */
const GRAMMAR_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  [".py", "python"], [".pyi", "python"],
  [".ts", "typescript"], [".tsx", "tsx"],
  [".js", "javascript"], [".jsx", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
  [".rb", "ruby"],
  [".c", "cpp"], [".h", "cpp"], [".cc", "cpp"], [".cpp", "cpp"], [".hpp", "cpp"],
  [".cs", "c-sharp"],
  [".php", "php"],
  [".sh", "bash"], [".zsh", "bash"], [".bash", "bash"], [".ksh", "bash"], [".bats", "bash"],
  [".ps1", "powershell"],
]);

/**
 * Shebang interpreters the bash grammar can parse well enough.
 *
 * Shell scripts routinely carry no extension, so the `#!` line is the only
 * thing left to identify them by. Only the Bourne family is listed: `ksh`,
 * `dash`, and `zsh` differ from bash in ways the grammar tolerates, while fish
 * is a different language and takes the marker fallback instead.
 */
const GRAMMAR_BY_SHEBANG: ReadonlyMap<string, string> = new Map([
  ["sh", "bash"], ["bash", "bash"], ["zsh", "bash"], ["ksh", "bash"],
  ["dash", "bash"], ["ash", "bash"], ["mksh", "bash"],
]);

/**
 * The grammar for one file, by extension first and by `#!` line second.
 *
 * The extension wins so that a `.py` script with a `#!/bin/sh` wrapper line is
 * still parsed as Python.
 */
export function grammarForFile(fileName: string, text: string): string | null {
  const byExtension = GRAMMAR_BY_EXTENSION.get(path.posix.extname(fileName).toLowerCase());
  if (byExtension !== undefined) return byExtension;
  const interpreter = shebangInterpreter(text);
  if (interpreter === null) return null;
  return GRAMMAR_BY_SHEBANG.get(interpreter) ?? null;
}

/**
 * Lazily loads tree-sitter grammars and counts structural nodes.
 *
 * Grammars are loaded on first use, so scanning a pure-Python repository never
 * pays to initialise the Rust or Java parsers.
 */
export class StructureAnalyzer {
  private initialized = false;
  private readonly parsers = new Map<string, Parser | null>();
  private readonly used = new Set<string>();

  /** Grammars that actually produced counts, for reporting in scan metadata. */
  get usedGrammars(): string[] {
    return [...this.used].sort();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await Parser.init();
    this.initialized = true;
  }

  private async parserFor(grammar: string): Promise<Parser | null> {
    const cached = this.parsers.get(grammar);
    if (cached !== undefined) return cached;
    let parser: Parser | null = null;
    try {
      const wasmPath = require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${grammar}.wasm`);
      const language = await Language.load(await readFile(wasmPath));
      parser = new Parser();
      parser.setLanguage(language);
    } catch {
      // A missing or ABI-incompatible grammar degrades to zero counts rather
      // than failing the scan. The file still contributes tokens and lines.
      parser = null;
    }
    this.parsers.set(grammar, parser);
    return parser;
  }

  /**
   * Count functions, classes, branches, and comment spans in one file.
   *
   * Comment spans come from the grammar rather than a line-prefix guess, so
   * block comments, nested comments, and doc comments are all handled without
   * per-language parsing rules.
   */
  async analyze(grammar: string | null, text: string): Promise<StructureCounts> {
    if (!grammar) return emptyStructure();
    const rule = RULES_BY_GRAMMAR.get(grammar);
    if (!rule) return emptyStructure();
    await this.ensureInitialized();
    const parser = await this.parserFor(grammar);
    if (!parser) return emptyStructure();

    const tree = parser.parse(text);
    if (!tree) return emptyStructure();
    try {
      const result = emptyStructure();
      const cursor = tree.walk();
      try {
        let descend = true;
        for (;;) {
          if (descend) {
            const type = cursor.nodeType;
            if (rule.functions.has(type)) result.functions += 1;
            else if (rule.classes.has(type)) result.classes += 1;
            else if (rule.branches.has(type)) result.branches += 1;

            if (type.includes("comment") || (rule.docstrings && isDocstring(cursor.currentNode))) {
              const start = cursor.startPosition;
              const end = cursor.endPosition;
              result.commentRanges.push({
                startRow: start.row,
                startColumn: start.column,
                endRow: end.row,
                endColumn: end.column,
              });
            }
          }
          if (descend && cursor.gotoFirstChild()) continue;
          if (cursor.gotoNextSibling()) { descend = true; continue; }
          if (!cursor.gotoParent()) break;
          descend = false;
        }
      } finally {
        cursor.delete();
      }
      this.used.add(grammar);
      return result;
    } finally {
      tree.delete();
    }
  }

  /** Release every loaded grammar and parser. */
  dispose(): void {
    for (const parser of this.parsers.values()) parser?.delete();
    this.parsers.clear();
  }
}
