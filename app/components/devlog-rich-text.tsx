import { AlertCircle } from "lucide-react";
import { Fragment, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { getDevlogWorkItemReferenceParts } from "~/lib/devlog";
import { cn } from "~/lib/utils";

type DevlogRichTextProps = {
  text: string | null | undefined;
  className?: string;
  emptyText?: string;
  referenceHrefBuilder?: (workItemId: number) => string;
  onReferenceClick?: (workItemId: number, event: ReactMouseEvent<HTMLButtonElement>) => void;
};

type DevlogRichTextBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "todo"; items: Array<{ checked: boolean; text: string }> }
  | { type: "bullet"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; code: string; language: string | null }
  | { type: "divider" }
  | { type: "callout"; text: string }
  | { type: "paragraph"; text: string };

export function DevlogRichText({
  text,
  className,
  emptyText,
  referenceHrefBuilder,
  onReferenceClick,
}: DevlogRichTextProps) {
  if (!text) {
    return emptyText ? <p className={className}>{emptyText}</p> : null;
  }

  const blocks = parseDevlogRichText(text);

  return (
    <div className={cn("space-y-3 break-words", className)}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;

        switch (block.type) {
          case "heading": {
            const headingClassName =
              block.level === 1
                ? "text-xl font-semibold text-slate-950"
                : block.level === 2
                  ? "text-lg font-semibold text-slate-900"
                  : "text-base font-semibold text-slate-900";

            return (
              <div key={key} className={headingClassName}>
                {renderTextLines(block.text, key, referenceHrefBuilder, onReferenceClick)}
              </div>
            );
          }
          case "todo":
            return (
              <ul key={key} className="space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-item-${itemIndex}`} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-[0.18rem] flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold",
                        item.checked
                          ? "border-[#94724b] bg-[#efe2ca] text-[#7b5c36]"
                          : "border-[#cdb89a] bg-white text-transparent",
                      )}
                    >
                      ✓
                    </span>
                    <span className={cn("min-w-0 flex-1", item.checked && "text-slate-400 line-through")}>
                      {renderTextLines(item.text, `${key}-item-${itemIndex}`, referenceHrefBuilder, onReferenceClick)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "bullet":
            return (
              <ul key={key} className="list-disc space-y-1.5 pl-5 marker:text-[#94724b]">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-item-${itemIndex}`}>
                    {renderTextLines(item, `${key}-item-${itemIndex}`, referenceHrefBuilder, onReferenceClick)}
                  </li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol key={key} className="list-decimal space-y-1.5 pl-5 marker:text-[#94724b]">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-item-${itemIndex}`}>
                    {renderTextLines(item, `${key}-item-${itemIndex}`, referenceHrefBuilder, onReferenceClick)}
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-[#d5c0a1] pl-4 text-slate-600">
                {renderTextLines(block.text, key, referenceHrefBuilder, onReferenceClick)}
              </blockquote>
            );
          case "code":
            return (
              <div key={key} className="overflow-hidden rounded-2xl border border-[#e7dac6] bg-[#f8f3ea]">
                {block.language ? (
                  <div className="border-b border-[#eadfce] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#94724b]">
                    {block.language}
                  </div>
                ) : null}
                <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6 text-slate-800">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          case "divider":
            return <hr key={key} className="border-[#eadfce]" />;
          case "callout":
            return (
              <div key={key} className="flex items-start gap-2 rounded-2xl bg-[#fbf4e6] px-3 py-3 text-slate-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#94724b]" />
                <div className="min-w-0 flex-1">
                  {renderTextLines(block.text, key, referenceHrefBuilder, onReferenceClick)}
                </div>
              </div>
            );
          case "paragraph":
            return (
              <p key={key} className="leading-7 text-slate-800">
                {renderTextLines(block.text, key, referenceHrefBuilder, onReferenceClick)}
              </p>
            );
        }
      })}
    </div>
  );
}

function parseDevlogRichText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: DevlogRichTextBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = line.match(/^```(.*)$/);
    if (codeMatch) {
      const codeLines: string[] = [];
      const language = codeMatch[1]?.trim() || null;
      index += 1;

      while (index < lines.length && !lines[index]?.startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        code: codeLines.join("\n"),
        language,
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    if (/^!\s+/.test(trimmed)) {
      const calloutLines: string[] = [];
      while (index < lines.length && /^!\s+/.test(lines[index]?.trim() ?? "")) {
        calloutLines.push((lines[index] ?? "").trim().replace(/^!\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "callout", text: calloutLines.join("\n") });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]?.trim() ?? "")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    if (/^-\s+\[( |x|X)\]\s+/.test(trimmed)) {
      const items: Array<{ checked: boolean; text: string }> = [];
      while (index < lines.length) {
        const todoMatch = (lines[index] ?? "").trim().match(/^-\s+\[( |x|X)\]\s+(.+)$/);
        if (!todoMatch) {
          break;
        }
        items.push({
          checked: todoMatch[1].toLowerCase() === "x",
          text: todoMatch[2],
        });
        index += 1;
      }
      blocks.push({ type: "todo", items });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const bulletMatch = (lines[index] ?? "").trim().match(/^[-*]\s+(.+)$/);
        if (!bulletMatch || /^-\s+\[( |x|X)\]\s+/.test((lines[index] ?? "").trim())) {
          break;
        }
        items.push(bulletMatch[1]);
        index += 1;
      }
      blocks.push({ type: "bullet", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const orderedMatch = (lines[index] ?? "").trim().match(/^\d+\.\s+(.+)$/);
        if (!orderedMatch) {
          break;
        }
        items.push(orderedMatch[1]);
        index += 1;
      }
      blocks.push({ type: "ordered", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const currentLine = lines[index] ?? "";
      if (!currentLine.trim() || isDevlogRichTextBlockBoundary(currentLine)) {
        break;
      }
      paragraphLines.push(currentLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function isDevlogRichTextBlockBoundary(line: string) {
  const trimmed = line.trim();
  return (
    line.startsWith("```") ||
    /^(#{1,3})\s+/.test(line) ||
    /^(-{3,}|\*{3,})$/.test(trimmed) ||
    /^!\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^-\s+\[( |x|X)\]\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed)
  );
}

function renderTextLines(
  text: string,
  keyPrefix: string,
  referenceHrefBuilder?: (workItemId: number) => string,
  onReferenceClick?: (workItemId: number, event: ReactMouseEvent<HTMLButtonElement>) => void,
) {
  return text.split("\n").map((line, lineIndex, lines) => (
    <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
      {renderInlineContent(line, `${keyPrefix}-line-${lineIndex}`, referenceHrefBuilder, onReferenceClick)}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

function renderInlineContent(
  text: string,
  keyPrefix: string,
  referenceHrefBuilder?: (workItemId: number) => string,
  onReferenceClick?: (workItemId: number, event: ReactMouseEvent<HTMLButtonElement>) => void,
) {
  const parts = getDevlogWorkItemReferenceParts(text);
  const nodes: ReactNode[] = [];

  parts.forEach((part, index) => {
    const partKey = `${keyPrefix}-part-${index}`;

    if (part.type === "reference") {
      if (onReferenceClick) {
        nodes.push(
          <button
            key={partKey}
            type="button"
            className="font-medium text-[#8a5f36] underline underline-offset-4 hover:text-[#6d4726]"
            onClick={(event) => onReferenceClick(part.workItemId, event)}
          >
            {part.value}
          </button>,
        );
        return;
      }

      if (referenceHrefBuilder) {
        nodes.push(
          <Link
            key={partKey}
            to={referenceHrefBuilder(part.workItemId)}
            className="font-medium text-[#8a5f36] underline underline-offset-4 hover:text-[#6d4726]"
          >
            {part.value}
          </Link>,
        );
        return;
      }

      nodes.push(
        <span key={partKey} className="font-medium text-[#8a5f36]">
          {part.value}
        </span>,
      );
      return;
    }

    nodes.push(...renderInlineDecorations(part.value, partKey, referenceHrefBuilder, onReferenceClick));
  });

  return nodes;
}

function renderInlineDecorations(
  text: string,
  keyPrefix: string,
  referenceHrefBuilder?: (workItemId: number) => string,
  onReferenceClick?: (workItemId: number, event: ReactMouseEvent<HTMLButtonElement>) => void,
) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~)/g;
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > cursor) {
      nodes.push(
        <Fragment key={`${keyPrefix}-plain-${index}`}>
          {text.slice(cursor, matchIndex)}
        </Fragment>,
      );
      index += 1;
    }

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded bg-[#f3ebdf] px-1.5 py-0.5 font-mono text-[0.92em] text-[#7b5c36]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-slate-950">
          {renderInlineContent(token.slice(2, -2), `${keyPrefix}-strong-${index}`, referenceHrefBuilder, onReferenceClick)}
        </strong>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(
        <s key={`${keyPrefix}-strike-${index}`} className="text-slate-400">
          {renderInlineContent(token.slice(2, -2), `${keyPrefix}-strike-${index}`, referenceHrefBuilder, onReferenceClick)}
        </s>,
      );
    }

    cursor = matchIndex + token.length;
    index += 1;
  }

  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-tail-${index}`}>
        {text.slice(cursor)}
      </Fragment>,
    );
  }

  return nodes;
}
