import type { WorkflowSkill } from '../workflows/runtime/workflowSkills.js';
import { readCapabilityPackageDraft } from './capabilityPackageStore.js';
import { findMayaWorkflowConnection } from './mayaWorkflowConnection.js';
import { deriveSoftwareConnectionState } from './softwareConnectionState.js';

export type WorkflowConnectorSummary = {
  action: 'open_connection_page' | 'probe_connection' | 'repair_connection';
  capabilityPackageId: string;
  id: string;
  label: string;
  severity: 'ok' | 'warning' | 'blocked' | 'unknown';
  status: 'ok' | 'warning' | 'blocked' | 'unknown';
  title: string;
};

export function summarizeWorkflowConnectors(workflow: WorkflowSkill): WorkflowConnectorSummary[] {
  return (workflow.systemContract.requiredConnectors ?? []).map((connector) => {
    const resolved = connector.capabilityPackageId === 'maya' || /maya/i.test(connector.id + connector.title)
      ? findMayaWorkflowConnection(connector.capabilityPackageId)
      : null;
    const draft = resolved?.draft || readCapabilityPackageDraft(connector.capabilityPackageId);
    if (!draft || draft.type !== 'software_connection') {
      return {
        action: 'open_connection_page',
        capabilityPackageId: connector.capabilityPackageId,
        id: connector.id,
        label: '连接未配置',
        severity: 'unknown',
        status: 'unknown',
        title: connector.title,
      };
    }

    const state = deriveSoftwareConnectionState(draft);
    const status = connectorStatusFromMaturity(state.maturity);
    return {
      action: status === 'ok' ? 'probe_connection' : 'repair_connection',
      capabilityPackageId: draft.id,
      id: connector.id,
      label: state.label || state.maturity || '连接状态未知',
      severity: status,
      status,
      title: connector.title || draft.name,
    };
  });
}

function connectorStatusFromMaturity(maturity: string | undefined): WorkflowConnectorSummary['status'] {
  if (maturity === 'connected') return 'ok';
  if (maturity === 'template_missing') return 'blocked';
  if (maturity === 'draft') return 'unknown';
  if (maturity === 'path_ready' || maturity === 'bridge_supported' || maturity === 'probe_failed') return 'warning';
  return 'unknown';
}
