import React, { createContext, useContext } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';

export type StoryboardRowInteractionValue = {
  rowCount: number;
  readOnly: boolean;
  timelineLayerCount: number;
  fieldCatalog: StoryboardParseFieldDef[];
  hasRedrawHandler: boolean;
  hasParseHandler: boolean;
  hasOptimizeHandler: boolean;
  allowOptimizeDialogue: boolean;
  focusRow: (rowId: string) => void;
  patchRow: (rowId: string, patch: Partial<StoryboardTableRow>) => void;
  moveRow: (rowId: string, dir: -1 | 1) => void;
  removeRow: (rowId: string) => void;
  openFileForRow: (rowId: string) => void;
  clearRowImage: (rowId: string) => void;
  assignFrameImageFromDrop: (rowId: string, e: React.DragEvent) => void;
  assignFrameImageFromPaste: (rowId: string, e: React.ClipboardEvent) => void;
  runRedraw: (rowId: string) => void;
  runParse: (rowId: string) => void;
  runOptimize: (rowId: string) => void;
  previewImage: (src: string) => void;
  redrawDisabledReason: (row: StoryboardTableRow) => string | undefined;
};

const StoryboardRowInteractionContext = createContext<StoryboardRowInteractionValue | null>(null);

export function StoryboardRowInteractionProvider({
  value,
  children,
}: {
  value: StoryboardRowInteractionValue;
  children: React.ReactNode;
}) {
  return (
    <StoryboardRowInteractionContext.Provider value={value}>
      {children}
    </StoryboardRowInteractionContext.Provider>
  );
}

export function useStoryboardRowInteraction(): StoryboardRowInteractionValue {
  const ctx = useContext(StoryboardRowInteractionContext);
  if (!ctx) {
    throw new Error('useStoryboardRowInteraction must be used within StoryboardRowInteractionProvider');
  }
  return ctx;
}
