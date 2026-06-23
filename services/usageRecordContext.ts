/** @deprecated 请使用 services/observability/correlationContext */
export {
  setCorrelationContext,
  clearCorrelationContext,
  peekCorrelationContext,
  setUsageRecordContext,
  clearUsageRecordContext,
  peekUsageRecordContext,
} from './observability/correlationContext';

export type { CorrelationContext } from '../shared/observability/correlation';
export type { CorrelationContext as UsageRecordContext } from '../shared/observability/correlation';
