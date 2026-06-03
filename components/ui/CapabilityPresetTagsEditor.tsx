import React, { useState } from 'react';
import { MAX_CAPABILITY_PRESET_TAGS } from '../../services/capabilityPresetTags';

type Props = {
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxTags?: number;
};

function parseDraftTags(raw: string): string[] {
  return raw
    .split(/[,，、;；\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function CapabilityPresetTagsEditor({
  tags,
  onChange,
  placeholder = '输入标签后回车或逗号添加',
  maxTags = MAX_CAPABILITY_PRESET_TAGS,
}: Props) {
  const [draft, setDraft] = useState('');

  const appendTags = (incoming: string[]) => {
    if (incoming.length === 0) return;
    const seen = new Set(tags);
    const next = [...tags];
    for (const tag of incoming) {
      if (seen.has(tag) || next.length >= maxTags) continue;
      seen.add(tag);
      next.push(tag);
    }
    if (next.length !== tags.length) onChange(next);
  };

  const commitDraft = () => {
    const incoming = parseDraftTags(draft);
    if (incoming.length === 0) {
      setDraft('');
      return;
    }
    appendTags(incoming);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#314767] bg-[#182235] text-[8px] text-blue-200/95"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="text-blue-300/70 hover:text-blue-100 leading-none"
                aria-label={`移除标签 ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={tags.length >= maxTags ? `最多 ${maxTags} 个标签` : placeholder}
        disabled={tags.length >= maxTags}
        className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-45"
      />
    </div>
  );
}
