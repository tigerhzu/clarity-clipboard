import { memo, useMemo, type ReactNode } from "react";

const tokenPattern = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:true|false|null|undefined|const|let|var|function|return|if|else|for|while|class|interface|type|public|private|async|await|fn|mut|impl|use|pub|match|struct|enum|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|AND|OR|NOT|AS)\b)|(\b\d+(?:\.\d+)?\b)/gim;

function highlightLine(line: string, lineIndex: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  tokenPattern.lastIndex = 0;
  for (const match of line.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(line.slice(cursor, index));
    const kind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "number";
    nodes.push(<span className={`syntax-${kind}`} key={`${lineIndex}-${index}`}>{match[0]}</span>);
    cursor = index + match[0].length;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

export const CodePreview = memo(function CodePreview({ content }: { content: string }) {
  const renderedLines = useMemo(() => content.split("\n").map((line, index) => (
    <span className="code-line" key={index}>
      <span className="line-number" aria-hidden="true">{index + 1}</span>
      <code>{highlightLine(line, index)}</code>
    </span>
  )), [content]);

  return (
    <pre className="code-preview">
      {renderedLines}
    </pre>
  );
});
