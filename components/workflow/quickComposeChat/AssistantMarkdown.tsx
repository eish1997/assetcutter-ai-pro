import React from 'react';
import {
  parseSafeMarkdown,
  type MdBlock,
  type MdInline,
} from './safeMarkdown';

function renderInline(nodes: MdInline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((n, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (n.type) {
      case 'text':
        return <React.Fragment key={key}>{n.text}</React.Fragment>;
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[12px] text-blue-100/95"
          >
            {n.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-gray-50">
            {renderInline(n.children, key)}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic text-gray-200">
            {renderInline(n.children, key)}
          </em>
        );
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-300 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-200"
          >
            {renderInline(n.children, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: MdBlock, idx: number): React.ReactNode {
  const key = `b-${idx}`;
  switch (block.type) {
    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {renderInline(block.children, key)}
        </p>
      );
    case 'heading': {
      const cls =
        block.level === 1
          ? 'text-[14px] font-bold text-gray-50'
          : block.level === 2
            ? 'text-[13px] font-bold text-gray-100'
            : 'text-[12px] font-semibold text-gray-200';
      return (
        <p key={key} className={`${cls} break-words`}>
          {renderInline(block.children, key)}
        </p>
      );
    }
    case 'code':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-gray-200 ring-1 ring-white/[0.08]"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'ul':
      return (
        <ul key={key} className="list-disc space-y-1 pl-4 text-[13px]">
          {block.items.map((item, j) => (
            <li key={`${key}-li-${j}`} className="break-words">
              {renderInline(item, `${key}-li-${j}`)}
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="list-decimal space-y-1 pl-4 text-[13px]">
          {block.items.map((item, j) => (
            <li key={`${key}-li-${j}`} className="break-words">
              {renderInline(item, `${key}-li-${j}`)}
            </li>
          ))}
        </ol>
      );
    default:
      return null;
  }
}

export type AssistantMarkdownProps = {
  text: string;
  className?: string;
};

/** 助手气泡正文：安全 Markdown；无内容时不渲染。 */
export default function AssistantMarkdown({ text, className = '' }: AssistantMarkdownProps) {
  const blocks = parseSafeMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-2 text-[13px] leading-relaxed text-gray-100 ${className}`}
      data-assistant-markdown
    >
      {blocks.map(renderBlock)}
    </div>
  );
}
