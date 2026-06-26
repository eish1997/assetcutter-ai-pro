import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardSceneAsset, StoryboardTableRow } from '../../types';
import { storyboardInputRowDomId } from './storyboardTableDom';
import StoryboardTableBulkInput, {
  type StoryboardTableBulkInputHandle,
} from './StoryboardTableBulkInput';
import StoryboardRoleAssetStrip from './StoryboardRoleAssetStrip';
import { resolveStoryboardSceneAssetDisplaySrc } from '../../services/storyboardSceneAssets';
import {
  STORYBOARD_INPUT_MAIN,
  STORYBOARD_INPUT_MAIN_INNER,
  STORYBOARD_INPUT_VIEW_GRID,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

export type StoryboardTableInputViewHandle = {
  scrollToRow: (rowId: string) => void;
};

type InputCompletionGuide = { kind: 'parse'; rowCount: number; appended: boolean };

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  roleAssets: StoryboardRoleAsset[];
  roleAssetBusyId?: string | null;
  sceneAssets: StoryboardSceneAsset[];
  sceneAssetBusyId?: string | null;
  readOnly?: boolean;
  onImportRows: (result: {
    catalog: StoryboardParseFieldDef[];
    rows: StoryboardTableRow[];
  }) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
  onGoToEdit?: () => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onAddRoleAsset: () => void;
  onRemoveRoleAsset: (id: string) => void;
  onRenameRoleAsset: (id: string, name: string) => void;
  onAssignRoleAssetImage: (id: string, file: File) => void;
  onAssignRoleAssetImages?: (startAssetId: string | null, files: File[]) => void | Promise<void>;
  onClearRoleAssetImage: (id: string) => void;
  onPreviewRoleAssetImage?: (src: string) => void;
  onAddSceneAsset: () => void;
  onRemoveSceneAsset: (id: string) => void;
  onRenameSceneAsset: (id: string, name: string) => void;
  onAssignSceneAssetImage: (id: string, file: File) => void;
  onAssignSceneAssetImages?: (startAssetId: string | null, files: File[]) => void | Promise<void>;
  onClearSceneAssetImage: (id: string) => void;
  onPreviewSceneAssetImage?: (src: string) => void;
};

const StoryboardTableInputView = forwardRef<StoryboardTableInputViewHandle, Props>(
  function StoryboardTableInputView(
    {
      assetId,
      rows,
      fieldCatalog,
      roleAssets,
      roleAssetBusyId = null,
      sceneAssets,
      sceneAssetBusyId = null,
      readOnly = false,
      onImportRows,
      companionBaseUrl = '',
      companionProjectId = '',
      onGoToEdit,
      onNotify,
      onAddRoleAsset,
      onRemoveRoleAsset,
      onRenameRoleAsset,
      onAssignRoleAssetImage,
      onAssignRoleAssetImages,
      onClearRoleAssetImage,
      onPreviewRoleAssetImage,
      onAddSceneAsset,
      onRemoveSceneAsset,
      onRenameSceneAsset,
      onAssignSceneAssetImage,
      onAssignSceneAssetImages,
      onClearSceneAssetImage,
      onPreviewSceneAssetImage,
    },
    ref
  ) {
    const [completionGuide, setCompletionGuide] = useState<InputCompletionGuide | null>(null);
    const bulkInputRef = useRef<StoryboardTableBulkInputHandle>(null);

    const scrollToRow = useCallback((rowId: string) => {
      const el = document.getElementById(storyboardInputRowDomId(rowId));
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToRow }), [scrollToRow]);

    const guideMessage = completionGuide
      ? `解析完成 · ${completionGuide.appended ? '已合并' : '已写入'} ${completionGuide.rowCount} 镜`
      : '';

    return (
      <div className={`${STORYBOARD_INPUT_VIEW_GRID} ${STORYBOARD_PAD_PANEL} pt-1`}>
        {completionGuide ? (
          <div className="flex shrink-0 justify-center px-1 pt-2 sm:px-2">
            <div className={`${STORYBOARD_INPUT_MAIN_INNER} !gap-0 !py-0`}>
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.08] px-3 py-2"
                role="status"
              >
                <p className="truncate text-[11px] text-emerald-100/90">{guideMessage}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {onGoToEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCompletionGuide(null);
                        onGoToEdit();
                      }}
                      className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-7 px-3 text-[10px]`}
                    >
                      前往编辑
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setCompletionGuide(null)}
                    className="text-[10px] text-emerald-200/70 transition-colors hover:text-emerald-100"
                    aria-label="关闭提示"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className={STORYBOARD_INPUT_MAIN}>
          <div className={STORYBOARD_INPUT_MAIN_INNER}>
            <StoryboardTableBulkInput
              ref={bulkInputRef}
              assetId={assetId}
              rows={rows}
              fieldCatalog={fieldCatalog}
              readOnly={readOnly}
              onImport={onImportRows}
              onParseComplete={(detail) =>
                setCompletionGuide({ kind: 'parse', rowCount: detail.rowCount, appended: detail.appended })
              }
              onNotify={onNotify}
              companionBaseUrl={companionBaseUrl}
              companionProjectId={companionProjectId}
            />

            <div
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
              data-no-global-image-drop
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-gray-300">角色资产</span>
                <span className="text-[9px] text-gray-500">{roleAssets.length} 个</span>
              </div>
              <StoryboardRoleAssetStrip
                assets={roleAssets}
                readOnly={readOnly}
                busyId={roleAssetBusyId}
                onAdd={onAddRoleAsset}
                onRemove={onRemoveRoleAsset}
                onRename={onRenameRoleAsset}
                onAssignImage={onAssignRoleAssetImage}
                onAssignImages={onAssignRoleAssetImages}
                onClearImage={onClearRoleAssetImage}
                onPreviewImage={onPreviewRoleAssetImage}
              />
            </div>

            <div
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
              data-no-global-image-drop
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-gray-300">场景资产</span>
                <span className="text-[9px] text-gray-500">{sceneAssets.length} 个</span>
              </div>
              <StoryboardRoleAssetStrip
                assets={sceneAssets}
                readOnly={readOnly}
                busyId={sceneAssetBusyId}
                namePlaceholder="场景名"
                addLabel="添加场景"
                removeAriaLabel="删除场景"
                resolveDisplaySrc={resolveStoryboardSceneAssetDisplaySrc}
                onAdd={onAddSceneAsset}
                onRemove={onRemoveSceneAsset}
                onRename={onRenameSceneAsset}
                onAssignImage={onAssignSceneAssetImage}
                onAssignImages={onAssignSceneAssetImages}
                onClearImage={onClearSceneAssetImage}
                onPreviewImage={onPreviewSceneAssetImage}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export default StoryboardTableInputView;
