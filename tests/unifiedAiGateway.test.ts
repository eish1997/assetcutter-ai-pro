import { describe, expect, it } from "vitest";
import {
  workflowGenerateVideo,
  workflowChat,
  createTripoTask,
  DEFAULT_PROMPTS,
  WorkflowVideoNotAvailableError,
  isWorkflowVideoAvailable,
  PRO_VIEW_IDS,
  startTencent3DProJob,
} from "../services/unifiedAiGateway";

describe("unifiedAiGateway", () => {
  it("exports workflowChat as a function", () => {
    expect(typeof workflowChat).toBe("function");
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
