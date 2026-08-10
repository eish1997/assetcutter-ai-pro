import type { WorkflowToolBridgeClient } from './workflowExecution.js';
import { runMayaExportWorkflow } from './workflowExecution.js';
import type { WorkflowRun, WorkflowRunInput } from './workflowRuns.js';
import { workflowSkills, type WorkflowSkill } from './workflowSkills.js';

export type WorkflowFunctionCard = {
  examples: WorkflowRunInput[];
  functionId: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  repairHints: string[];
  requiredCapability: string;
  risk: string;
  stepId: string;
  tags: string[];
  title: string;
  whenToUse: string;
  workflowId: string;
  workflowVersion: string;
};

export type WorkflowFunctionSearchFilters = {
  requiredCapability?: string;
  tags?: string[];
};

export function searchFunctions(
  query: string,
  filters: WorkflowFunctionSearchFilters = {},
): WorkflowFunctionCard[] {
  const normalizedQuery = query.trim().toLowerCase();

  return buildFunctionCards()
    .filter((card) => matchesFilters(card, filters))
    .filter((card) => {
      if (!normalizedQuery) return true;
      return [
        card.functionId,
        card.title,
        card.whenToUse,
        card.requiredCapability,
        ...card.tags,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
}

export function getFunction(functionId: string) {
  return buildFunctionCards().find((card) => card.functionId === functionId);
}

export async function runFunction(input: {
  checkOutputExists?: (outputPath: string) => boolean | Promise<boolean>;
  client: WorkflowToolBridgeClient;
  connectorStatus?: Parameters<typeof runMayaExportWorkflow>[1]['connectorStatus'];
  functionId: string;
  runInput: WorkflowRunInput;
}): Promise<WorkflowRun> {
  const card = getFunction(input.functionId);
  if (!card) {
    throw new Error(`Unknown workflow function: ${input.functionId}`);
  }

  if (input.functionId === 'function.maya.export_selection_fbx') {
    return runMayaExportWorkflow(input.runInput, {
      checkOutputExists: input.checkOutputExists,
      client: input.client,
      connectorStatus: input.connectorStatus,
    });
  }

  throw new Error(`Workflow function is not runnable yet: ${input.functionId}`);
}

function buildFunctionCards(): WorkflowFunctionCard[] {
  return workflowSkills.flatMap((workflow) => workflow.aiContract.steps.map((step) => toFunctionCard(workflow, step)));
}

function toFunctionCard(
  workflow: WorkflowSkill,
  step: WorkflowSkill['aiContract']['steps'][number],
): WorkflowFunctionCard {
  const requiredCapability = workflow.systemContract.requiredCapabilities[0] ?? step.toolName;

  return {
    examples: [{
      file_name: 'selected_asset',
      output_dir: 'project://exports',
      overwrite: false,
    }],
    functionId: step.toolName === 'workflow.maya.export_selection_fbx'
      ? 'function.maya.export_selection_fbx'
      : `function.${step.id}`,
    inputSchema: workflow.aiContract.inputSchema,
    outputSchema: workflow.aiContract.outputSchema,
    repairHints: workflow.aiContract.repairActions.map((action) => action.message),
    requiredCapability,
    risk: workflow.systemContract.riskLevel,
    stepId: step.id,
    tags: ['maya', 'fbx', 'export', 'workflow'],
    title: step.title,
    whenToUse: workflow.aiContract.whenToUse,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
  };
}

function matchesFilters(card: WorkflowFunctionCard, filters: WorkflowFunctionSearchFilters) {
  if (filters.requiredCapability && card.requiredCapability !== filters.requiredCapability) {
    return false;
  }

  if (filters.tags?.length) {
    return filters.tags.every((tag) => card.tags.includes(tag));
  }

  return true;
}
