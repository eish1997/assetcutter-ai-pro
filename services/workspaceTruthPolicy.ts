/**
 * Single “who wins” table for workspace open / restore.
 * App open path must call resolveWorkspaceTruthPolicy — do not restate rules in comments elsewhere.
 *
 * | Scenario                         | Structure truth              | Media bytes     | Forbidden                          |
 * |----------------------------------|------------------------------|-----------------|------------------------------------|
 * | Companion online + dir SoT       | companion workflow.json      | companion assets| IDB steal-write; cloud merge wipe  |
 * | Cloud merge eligible             | IDB → cloud merge → PUT align| companion if on | Parallel companion prefer          |
 * | Companion online (no cloud merge)| prefer companion workflow.json| companion assets| Stale IDB autosave during boot     |
 * | Companion offline (no cloud merge)| IDB cache                   | memory_only     | UI pretending persisted locally    |
 * | R2 pin                           | objectKey projection only    | not companion   | pack deleting *CompanionKey        |
 */

export type WorkspaceTruthMode =
  | 'companion_directory_source'
  | 'cloud_merge_then_align_companion'
  | 'companion_prefer_over_idb'
  | 'idb_cache_offline';

export type WorkspaceMediaBytesSource = 'companion' | 'memory_only';

export type WorkspaceStructureSource =
  | 'companion_workflow_json'
  | 'idb_then_cloud_merge'
  | 'idb_cache';

export type WorkspaceTruthPolicy = {
  mode: WorkspaceTruthMode;
  /** Run cloud bundle reconcile on project open (caller still gates on auth session). */
  runCloudBundleMerge: boolean;
  /** After companion GET, prefer companion workflow.json over IDB (gated by preferCompanionWorkflowBundle). */
  preferCompanionWorkflowOnOpen: boolean;
  mediaBytesSource: WorkspaceMediaBytesSource;
  structureSource: WorkspaceStructureSource;
  /** Short machine tags for logs / assertions. */
  forbidden: string[];
};

export type ResolveWorkspaceTruthPolicyInput = {
  companionOnline: boolean;
  companionDirectorySourceOfTruth: boolean;
  cloudEnabled: boolean;
  cloudBundleMergeEnabled: boolean;
  canSyncProjectToCloud: boolean;
  cloudPushAllowed: boolean;
  cloudQuotaSuspended: boolean;
};

function isCloudBundleMergeEligible(input: ResolveWorkspaceTruthPolicyInput): boolean {
  return Boolean(
    input.cloudEnabled &&
      !input.companionDirectorySourceOfTruth &&
      input.cloudBundleMergeEnabled &&
      input.cloudPushAllowed &&
      !input.cloudQuotaSuspended &&
      input.canSyncProjectToCloud
  );
}

export function resolveWorkspaceTruthPolicy(
  input: ResolveWorkspaceTruthPolicyInput
): WorkspaceTruthPolicy {
  // Cloud merge wins over companion prefer (same as historical App open path).
  if (isCloudBundleMergeEligible(input)) {
    return {
      mode: 'cloud_merge_then_align_companion',
      runCloudBundleMerge: true,
      preferCompanionWorkflowOnOpen: false,
      mediaBytesSource: input.companionOnline ? 'companion' : 'memory_only',
      structureSource: 'idb_then_cloud_merge',
      forbidden: ['parallel_companion_prefer', 'pack_delete_companion_keys'],
    };
  }

  if (!input.companionOnline) {
    return {
      mode: 'idb_cache_offline',
      runCloudBundleMerge: false,
      preferCompanionWorkflowOnOpen: false,
      mediaBytesSource: 'memory_only',
      structureSource: 'idb_cache',
      forbidden: ['ui_pretend_local_persisted', 'companion_prefer_while_offline'],
    };
  }

  if (input.companionDirectorySourceOfTruth) {
    return {
      mode: 'companion_directory_source',
      runCloudBundleMerge: false,
      preferCompanionWorkflowOnOpen: true,
      mediaBytesSource: 'companion',
      structureSource: 'companion_workflow_json',
      forbidden: ['idb_steal_write_over_companion', 'cloud_merge_overwrite_local_locator'],
    };
  }

  return {
    mode: 'companion_prefer_over_idb',
    runCloudBundleMerge: false,
    preferCompanionWorkflowOnOpen: true,
    mediaBytesSource: 'companion',
    structureSource: 'companion_workflow_json',
    forbidden: ['stale_idb_autosave_during_boot', 'pack_delete_companion_keys'],
  };
}
