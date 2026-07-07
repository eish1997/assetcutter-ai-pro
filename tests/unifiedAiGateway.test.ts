import { describe, expect, it, vi } from "vitest";
import {
  workflowGenerateVideo,
  workflowChat,
  createTripoTask,
  getDialogTextResponse,
  processTexture,
  detectObjectsInImage,
  DEFAULT_PROMPTS,
  WorkflowVideoNotAvailableError,
  isWorkflowVideoAvailable,
  PRO_VIEW_IDS,
  startTencent3DProJob,
} from "../services/unifiedAiGateway";

vi.mock("../services/aiDispatchGate", () => ({
  gateBeforeUpstream: vi.fn(async (params: { jobKind: string }) => ({
    routeKind: "platform",
    minCredits: 10,
    jobKind: params.jobKind,
    registryId: params.jobKind,
    role: "text",
  })),
}));

describe("unifiedAiGateway", () => {
  it("exports workflowChat as a function", () => {
    expect(typeof workflowChat).toBe("function");
  });

  it("exports metered dialog wrappers", () => {
    expect(typeof getDialogTextResponse).toBe("function");
    expect(typeof processTexture).toBe("function");
    expect(typeof detectObjectsInImage).toBe("function");
  });

  it("re-exports Tripo createTask", () => {
    expect(typeof createTripoTask).toBe("function");
  });

  it("re-exports Tencent 3D surface (PRO_VIEW_IDS, startTencent3DProJob)", () => {
    expect(Array.isArray(PRO_VIEW_IDS)).toBe(true);
    expect(PRO_VIEW_IDS.length).toBeGreaterThan(0);
    expect(typeof startTencent3DProJob).toBe("function");
  });

  it("re-exports DEFAULT_PROMPTS", () => {
    expect(typeof DEFAULT_PROMPTS).toBe("object");
  });

  it("workflowGenerateVideo throws when VITE_WORKFLOW_VIDEO_API_URL 未配置", async () => {
    expect(isWorkflowVideoAvailable()).toBe(false);
    await expect(workflowGenerateVideo({ prompt: "test" })).rejects.toThrow(WorkflowVideoNotAvailableError);
  });
});
