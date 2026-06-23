import { listUsageEventsByCorrelationId } from './usage-billing-store.js';
import { listWorkflowTaskEventsByTaskId } from './workflow-task-events-store.js';
import { redactTaskEvents } from './admin-task-events.js';

function summarizeUsage(events) {
  let totalCostUsdEst = 0;
  for (const ev of events || []) {
    const cost = Number(ev.costUsdEst);
    if (Number.isFinite(cost)) totalCostUsdEst += cost;
  }
  return {
    eventCount: (events || []).length,
    totalCostUsdEst,
  };
}

/** L4 读模型：按 correlationId（= workflow taskId）聚合用量与任务执行事件 */
export async function fetchObservabilityTraceByCorrelationId(correlationId, query = {}) {
  const cid = String(correlationId || '').trim();
  if (!cid) {
    return {
      correlationId: '',
      usage: { events: [], total: 0, ...summarizeUsage([]) },
      taskEvents: { events: [], total: 0 },
    };
  }
  const [usageRes, taskRes] = await Promise.all([
    listUsageEventsByCorrelationId(cid, { limit: query.limit ?? 100 }),
    listWorkflowTaskEventsByTaskId(cid, { limit: query.limit ?? 100 }),
  ]);
  const usageEvents = usageRes.events || [];
  const taskEvents = redactTaskEvents(taskRes.events || []);
  return {
    correlationId: cid,
    usage: {
      events: usageEvents,
      total: usageRes.total ?? usageEvents.length,
      ...summarizeUsage(usageEvents),
    },
    taskEvents: {
      events: taskEvents,
      total: taskRes.total ?? taskEvents.length,
    },
  };
}

export function parseObservabilityTraceQuery(searchParams) {
  return {
    correlationId: searchParams.get('correlationId') || searchParams.get('taskId') || '',
    limit: searchParams.get('limit') || '100',
  };
}
