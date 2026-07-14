/**
 * Project Agent services — Phase 1–5 (P0 + U3 + U4: child-run cards + auto mode).
 * Boundary: do not import from components/WorkflowSection.
 */

export { planTools } from './planTools';
export { resolveComposerMode } from './autoMode';
export type { ResolvedComposerMode } from './autoMode';
export { formatPlanTemplate } from './planTemplate';
export { buildProjectAgentIntent } from './intent';
export { createProjectAgentRuntime } from './runtime';
export {
  PROJECT_AGENT_CANCELLED_MESSAGE,
  PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE,
  PROJECT_AGENT_TURN_IN_FLIGHT_MESSAGE,
} from './runtime';
export type { ProjectAgentRuntime } from './runtime';
export { PROJECT_AGENT_TOOL_REGISTRY, getToolDefinition } from './tools/registry';
export { createMemoryHostPort } from './host/memoryHostPort';
export {
  canSubmitNewTurn,
  createInitialTurnState,
  isCancelledTurn,
  isTerminalTurnStatus,
  transitionTurn,
  type TurnStateMachine,
} from './runtime/turnState';
export {
  applyPlanToTrace,
  applyPlannerTrace,
  createEmptyTurnTrace,
  finalizeTurnTrace,
  serializeTurnTrace,
  traceStatusFromTurn,
} from './runtime/trace';
export {
  deriveAssistantTimeline,
  resolveAssistantPlanLabels,
} from './assistantTimeline';
export type {
  AssistantTimelineModel,
  AssistantTimelineStep,
  AssistantTimelineStepState,
} from './assistantTimeline';
export {
  buildChildRunsFromPlan,
  patchChildRunsFromTasks,
} from './childRuns';
export type {
  BuildChildRunsFromPlanOpts,
  PatchChildRunsContext,
} from './childRuns';
export {
  PROJECT_AGENT_THREAD_MAX_MESSAGES,
  appendProjectAgentThreadTurn,
  archiveAndResetProjectAgentThread,
  createProjectAgentThread,
  loadOrCreateProjectAgentThread,
  loadProjectAgentThread,
  projectAgentThreadStorageKey,
  saveProjectAgentThread,
  trimProjectAgentThreadMessages,
} from './threadStore';
export type { ProjectAgentThread, ProjectAgentThreadStoreKey } from './threadStore';
export {
  cancelPendingProjectAgentHotBackup,
  flushProjectAgentBackupRetryQueue,
  hydrateProjectAgentThreadFromCloud,
  mergeProjectAgentThreadLww,
  pullProjectAgentThreadArchive,
  pullProjectAgentThreadHot,
  scheduleProjectAgentThreadArchiveBackup,
  scheduleProjectAgentThreadBackup,
} from './threadCloudSync';
export type { ProjectAgentCloudSyncKey } from './threadCloudSync';
export {
  estimateProjectAgentThreadBytes,
  saveProjectAgentThreadGuarded,
  trimProjectAgentThreadForQuota,
} from './persist/quotas';
export type { SaveProjectAgentThreadGuardedResult } from './persist/quotas';

// Phase 5 / U4 — 5C load earlier + export
export {
  buildProjectAgentExportFilename,
  downloadProjectAgentThreadSlimJson,
  exportProjectAgentThreadSlimJson,
  slimMessageForExport,
  stripBase64FromExportValue,
} from './threadExport';
export {
  PROJECT_AGENT_COLD_BAG_MAX,
  PROJECT_AGENT_LOCAL_ARCHIVE_MAX,
  fetchEarlierMessagesFromKnownArchives,
  hasEarlierMessagesLocal,
  listEarlierMessagesLocal,
  listLocalThreadArchives,
  loadEarlierMessagesIntoHot,
  loadLocalThreadArchive,
  mergeEarlierMessages,
  saveLocalThreadArchive,
  stashColdOverflowMessages,
  stashMessagesDroppedFromHot,
} from './threadColdLoad';
export type { LocalThreadArchiveMeta } from './threadColdLoad';

// Phase 4 / U3
export {
  EXPERT_BRIEF_OUTLINER_ID,
  EXPERT_PROMPT_SMITH_ID,
  __resetExpertRegistryForTests,
  applyExpertProfilePatch,
  getExpertProfile,
  listExpertProfiles,
  resolveExpertByMention,
} from './experts/registry';
export {
  EXPERT_MEMORY_INJECT_CHAR_BUDGET,
  __resetExpertMemoryStoreForTests,
  addExpertMemory,
  clearExpertMemories,
  deleteExpertMemory,
  expertMemoryStorageKey,
  formatExpertMemoriesForContext,
  listExpertMemories,
  retrieveExpertMemoriesForInject,
} from './experts/memoryStore';
export type {
  ExpertMemoryStoreKey,
  RetrieveExpertMemoryOptions,
  RetrieveExpertMemoryResult,
} from './experts/memoryStore';
export { invokeExpert } from './experts/invoke';
export {
  buildExpertDeterministicDraft,
  buildExpertSystemPrompt,
  buildExpertUserPrompt,
} from './experts/invoke';
export {
  applyConfirmedMemoryProposal,
  detectExpertTuneProposals,
} from './experts/tuneProtocol';
export {
  PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET,
  __resetProjectAgentKnowledgeForTests,
  addProjectAgentKnowledge,
  deleteProjectAgentKnowledge,
  formatProjectAgentKnowledgeForContext,
  listProjectAgentKnowledge,
  projectAgentKnowledgeStorageKey,
  retrieveProjectAgentKnowledgeForInject,
  setProjectAgentKnowledgeEnabled,
} from './knowledgeStore';

export type {
  AddProjectAgentKnowledgeInput,
  ProjectAgentKnowledgeStoreKey,
  RetrieveProjectAgentKnowledgeOptions,
  RetrieveProjectAgentKnowledgeResult,
} from './knowledgeStore';

export {
  __resetAgentSkillRegistryForTests,
  agentSkillRegistryStorageKey,
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  listEnabledAgentSkills,
  previewAgentSkillImport,
  resolveAgentSkillsForIntent,
  setAgentSkillEnabled,
} from './skillRegistry';

export type {
  AgentSkillImportInput,
  AgentSkillRegistryScope,
  InstallAgentSkillOptions,
} from './skillRegistry';

export {
  createControlledPlan,
  validateControlledPlan,
} from './planner';

export type {
  ControlledPlannerResult,
} from './planner';

export {
  __resetProjectAgentArtifactsForTests,
  artifactTextForQuickCompose,
  emitProjectAgentArtifact,
  getProjectAgentArtifact,
  listProjectAgentArtifacts,
  projectAgentArtifactStorageKey,
  tryRunArtifactAsPrompt,
} from './artifacts';
export type { ArtifactStoreKey } from './artifacts';
export { promoteProjectAgentArtifact } from './promote';
export type { PromoteArtifactResult } from './promote';
export {
  PROJECT_AGENT_COMPACTION_KEEP_RECENT,
  loadProjectAgentCompaction,
  maybeCompactProjectAgentThread,
  saveProjectAgentCompaction,
} from './compaction';
export type { CompactionStoreKey } from './compaction';
export {
  assembleProjectAgentContext,
  formatAssembledContextPrefix,
  injectAssembledContextIntoUserText,
  planNeedsConversationContext,
  PROJECT_AGENT_CONTEXT_INJECT_TOOL_IDS,
} from './contextAssembly';
export type { AssembleProjectAgentContextInput } from './contextAssembly';
