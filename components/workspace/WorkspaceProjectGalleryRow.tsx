import React, { useEffect, useRef, useState } from 'react';
import { getCompanionManifest } from '../../services/companionClient';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from '../../services/companionLocalPrefs';
import type { WorkspaceProject } from '../../services/workspaceProjectStore';
import {
  loadWorkspaceProjectPreviews,
  loadWorkspaceProjectPreviewsResolved,
} from '../../services/workspaceProjectPreviews';
import { loadWorkflowBundle, type WorkspacePersistUserId } from '../../services/workspaceProjectStore';
import {
  computeWorkspaceProjectTotalBytes,
  formatWorkspaceProjectByteSize,
  loadWorkspaceProjectTotalBytes,
  sumCompanionManifestBytes,
} from '../../services/workspaceProjectSize';
import AppIcon from '../ui/AppIcon';
import WorkspaceProjectPreviewStrip from './WorkspaceProjectPreviewStrip';

type Props = {
  project: WorkspaceProject;
  persistUserId?: WorkspacePersistUserId;
  onOpen: (id: string) => void;
  onRename: (project: WorkspaceProject) => void;
  onDelete: (id: string) => void;
  onExport?: (id: string) => void;
};

const TOOL_ICON =
  'shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

const TOOL_ICON_DANGER =
  'shrink-0 p-1.5 rounded-lg text-red-400/60 hover:text-red-300 hover:bg-[#3a1818]/50 transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-500/40';

export default function WorkspaceProjectGalleryRow({
  project,
  persistUserId = null,
  onOpen,
  onRename,
  onDelete,
  onExport,
}: Props) {
  const [previewData, setPreviewData] = useState(() =>
    loadWorkspaceProjectPreviews(project.id, persistUserId)
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const companionBlobUrlsRef = useRef<string[]>([]);
  const [totalBytes, setTotalBytes] = useState(() =>
    loadWorkspaceProjectTotalBytes(project.id, persistUserId)
  );

  const revokeCompanionBlobUrls = () => {
    for (const url of companionBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    companionBlobUrlsRef.current = [];
  };

  useEffect(() => {
    revokeCompanionBlobUrls();
    setPreviewData(loadWorkspaceProjectPreviews(project.id, persistUserId));
    const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
    if (!base) {
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void loadWorkspaceProjectPreviewsResolved(project.id, persistUserId, { companionBaseUrl: base })
      .then((next) => {
        if (cancelled) {
          for (const item of next.items) {
            if (item.src.startsWith('blob:')) URL.revokeObjectURL(item.src);
          }
          return;
        }
        companionBlobUrlsRef.current = next.items
          .map((item) => item.src)
          .filter((src) => src.startsWith('blob:'));
        setPreviewData(next);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
      revokeCompanionBlobUrls();
    };
  }, [project.id, persistUserId]);

  useEffect(() => {
    setTotalBytes(loadWorkspaceProjectTotalBytes(project.id, persistUserId));
    const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
    if (!base) return;
    let cancelled = false;
    void getCompanionManifest(base, project.id).then((res) => {
      if (cancelled || !res.ok) return;
      const bundle = loadWorkflowBundle(project.id, persistUserId);
      setTotalBytes(computeWorkspaceProjectTotalBytes(bundle, sumCompanionManifestBytes(res.data)));
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, persistUserId]);

  return (
    <div className="group/row rounded-2xl bg-[#141416] ring-1 ring-white/[0.06] transition-[background-color,box-shadow] duration-200 hover:bg-[#151518] hover:ring-white/[0.12]">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 lg:px-4">
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-[15rem] lg:w-[16rem]">
          <div className="min-w-0">
            <button
              type="button"
              className="max-w-full truncate text-left text-[13px] font-semibold text-white transition-colors hover:text-blue-200/95 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-sm"
              title={`${project.name}（点击重命名）`}
              onClick={(e) => {
                e.stopPropagation();
                onRename(project);
              }}
            >
              {project.name}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono">
              <span className="truncate text-gray-500">{new Date(project.createdAt).toLocaleString()}</span>
              <span className="text-gray-600">·</span>
              <span className="shrink-0 tabular-nums text-gray-400" title="画布根资产数">
                {previewData.rootAssetCount} 资产
              </span>
              <span className="text-gray-600">·</span>
              <span className="shrink-0 tabular-nums text-gray-400" title="项目总大小（本地估算）">
                {formatWorkspaceProjectByteSize(totalBytes)}
              </span>
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-0.5 rounded-xl bg-white/[0.03] px-1 py-1 ring-1 ring-white/[0.05]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={TOOL_ICON}
              title="导出项目"
              aria-label={`导出 ${project.name}`}
              onClick={() => onExport?.(project.id)}
            >
              <AppIcon name="download" className="w-4 h-4" />
            </button>
            <button
              type="button"
              className={TOOL_ICON_DANGER}
              title="删除项目"
              aria-label={`删除 ${project.name}`}
              onClick={() => onDelete(project.id)}
            >
              <AppIcon name="trash" className="w-4 h-4" />
            </button>
          </div>
        </div>

        <WorkspaceProjectPreviewStrip
          items={previewData.items}
          totalEligible={previewData.totalEligible}
          loading={previewLoading && previewData.items.length === 0}
          onOpen={() => onOpen(project.id)}
        />
      </div>
    </div>
  );
}
