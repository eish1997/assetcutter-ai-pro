/**
 * 网站侧访问本机伴侣 HTTP 的统一入口（与总规范 §7 `companion-client` 对齐，P1 起集中扩展）。
 */
export { probeCompanionHealth, probeCompanionCapabilities, normalizeCompanionBaseUrl, type CompanionProbeResult } from './probe';
export {
  listCompanionProjects,
  getCompanionManifest,
  getCompanionAssetMeta,
  deleteCompanionAsset,
  putCompanionAsset,
  fetchCompanionAssetBlob,
  type CompanionProjectListV1,
  type CompanionManifestV1,
  type CompanionAssetMetaV1,
} from './storage';
export {
  submitCompanionJob,
  submitCompanionSeamRepairJob,
  listCompanionJobs,
  getCompanionJob,
  cancelCompanionJob,
  listCompanionJobEvents,
  createCompanionJobEventStream,
  type CompanionJobRecordV1,
  type CompanionJobEventV1,
  type CompanionSubmitJobBody,
  type CompanionSeamRepairInputsV1,
} from './compute';
export { companionFetchJson, type CompanionClientResult } from './fetch';
export {
  probeRelayFromCapabilities,
  type CompanionRelayCapabilityV1,
} from './relay';
export { getCompanionLocalBaseUrl, setCompanionLocalBaseUrl } from '../companionLocalPrefs';
