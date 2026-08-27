import { marked, type Token, type Tokens } from "marked";
import { highlightLanguage } from "./highlight.ts";

/**
 * Schemes a link in an answer may point at.
 *
 * An answer is text a language model wrote, so the href is not ours. Anything
 * outside this list is drawn as the words it is made of and never as a target.
 */
const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];

function isSafeLink(href: string): boolean {
  // A relative href has no scheme to abuse, and the page it would open is ours.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
  const scheme = href.slice(0, href.indexOf(":") + 1).toLowerCase();
  return SAFE_LINK_SCHEMES.includes(scheme);
}

function headingOf(depth: number, children: React.ReactNode, key: string): React.JSX.Element {
  const Tag = `h${Math.min(6, Math.max(1, depth))}` as "h1";
  return <Tag key={key}>{children}</Tag>;
}

/**
 * Draw the inline tokens of one block.
 *
 * An `html` token becomes the text it is written as. The answer is not trusted
 * markup, so no branch of this file ever hands a string to the browser as HTML.
 */
function renderInline(tokens: readonly Token[] | undefined, keyPrefix: string): React.ReactNode[] {
  if (tokens === undefined) return [];
  return tokens.map((token, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (token.type) {
      case "strong":
        return <strong key={key}>{renderInline((token as Tokens.Strong).tokens, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline((token as Tokens.Em).tokens, key)}</em>;
      case "del":
        return <del key={key}>{renderInline((token as Tokens.Del).tokens, key)}</del>;
      case "codespan":
        return <code key={key} className="answer__code">{(token as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={key} />;
      case "link": {
        const link = token as Tokens.Link;
        const children = renderInline(link.tokens, key);
        if (!isSafeLink(link.href)) return <span key={key}>{children}</span>;
        return <a key={key} href={link.href} target="_blank" rel="noreferrer">{children}</a>;
      }
      case "image": {
        const image = token as Tokens.Image;
        if (!isSafeLink(image.href)) return <span key={key}>{image.text}</span>;
        return <img key={key} className="answer__image" src={image.href} alt={image.text} />;
      }
      default:
        // Plain text, an escaped character, and raw HTML all reach the page as
        // the characters they are made of. React escapes them on the way out.
        return (token as { text?: string }).text ?? "";
    }
  });
}

function renderListItem(item: Tokens.ListItem, key: string): React.JSX.Element {
  return (
    <li key={key} data-task={item.task ? true : undefined}>
      {item.task ? <input type="checkbox" checked={item.checked === true} readOnly /> : null}
      {renderBlocks(item.tokens, key)}
    </li>
  );
}

/** The alignment GitHub-flavored markdown writes into a table's divider row. */
function cellStyle(align: "center" | "left" | "right" | null): React.CSSProperties | undefined {
  return align === null ? undefined : { textAlign: align };
}

/**
 * Draw a list of block tokens.
 *
 * A block that holds one paragraph inside a list item is drawn without the
 * paragraph, so a tight list stays one line per item.
 */
function renderBlocks(tokens: readonly Token[], keyPrefix: string): React.ReactNode[] {
  return tokens.flatMap<React.ReactNode>((token, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (token.type) {
      case "space":
      case "def":
        return [];
      case "heading": {
        const heading = token as Tokens.Heading;
        return [headingOf(heading.depth, renderInline(heading.tokens, key), key)];
      }
      case "paragraph":
        return [<p key={key}>{renderInline((token as Tokens.Paragraph).tokens, key)}</p>];
      case "text": {
        // A tight list item holds its content in one of these, so it must not
        // add a wrapper: the item is already the block.
        const text = token as Tokens.Text;
        return text.tokens ? renderInline(text.tokens, key) : [text.text];
      }
      case "code": {
        const code = token as Tokens.Code;
        return [
          <pre key={key} className="answer__pre">
            <code dangerouslySetInnerHTML={{ __html: highlightLanguage(code.lang ?? "", code.text) }} />
          </pre>,
        ];
      }
      case "blockquote":
        return [<blockquote key={key}>{renderBlocks((token as Tokens.Blockquote).tokens, key)}</blockquote>];
      case "hr":
        return [<hr key={key} />];
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, position) => renderListItem(item, `${key}.${position}`));
        if (!list.ordered) return [<ul key={key}>{items}</ul>];
        const start = Number(list.start);
        return [<ol key={key} start={Number.isFinite(start) && start !== 1 ? start : undefined}>{items}</ol>];
      }
      case "table": {
        const table = token as Tokens.Table;
        return [
          <table key={key} className="answer__table">
            <thead>
              <tr>
                {table.header.map((cell, column) => (
                  <th key={`${key}.h${column}`} style={cellStyle(table.align[column] ?? null)}>
                    {renderInline(cell.tokens, `${key}.h${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, line) => (
                <tr key={`${key}.r${line}`}>
                  {row.map((cell, column) => (
                    <td key={`${key}.r${line}.${column}`} style={cellStyle(table.align[column] ?? null)}>
                      {renderInline(cell.tokens, `${key}.r${line}.${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        ];
      }
      default:
        return [<p key={key}>{(token as { text?: string }).text ?? ""}</p>];
    }
  });
}

/**
 * Draw one agent answer.
 *
 * The markdown is lexed and then built as React elements, rather than turned
 * into an HTML string and injected. A model wrote the text, so nothing in it is
 * allowed to become markup: the only string handed over as HTML is the one the
 * highlighter produced from text it had already escaped.
 */
export function renderMarkdown(markdown: string): React.ReactNode[] {
  return renderBlocks(marked.lexer(markdown), "block");
}
