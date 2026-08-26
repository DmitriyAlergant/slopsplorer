import { countTokens as countCl100k } from "gpt-tokenizer/encoding/cl100k_base";
import { countTokens as countO200k } from "gpt-tokenizer/encoding/o200k_base";

export const TOKENIZERS = ["cl100k_base", "o200k_base"] as const;

export type TokenizerName = (typeof TOKENIZERS)[number];

export function isTokenizerName(value: string): value is TokenizerName {
  return (TOKENIZERS as readonly string[]).includes(value);
}

/**
 * Return a token counter for the named encoding.
 *
 * `cl100k_base` matches GPT-4/3.5 and is close enough to Claude's tokenizer to
 * be a useful proxy for agent context cost. `o200k_base` matches GPT-4o.
 */
export function tokenCounter(name: TokenizerName): (text: string) => number {
  const count = name === "o200k_base" ? countO200k : countCl100k;
  // Source files can contain strings that spell tokenizer control tokens.
  // Measure them as ordinary text instead of rejecting the entire scan.
  return (text) => count(text, { disallowedSpecial: new Set() });
}
