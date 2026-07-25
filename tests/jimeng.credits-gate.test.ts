import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREDITS_EXCEEDED_CODE,
  LOGIN_REQUIRED_CODE,
  proxyGateMinCreditsForJob,
} from "../shared/credits";
import { HttpRequestError } from "../services/httpClient";

vi.mock("../services/geminiFairnessBridge", () => ({
  getGeminiFairnessUserId: vi.fn(() => null),
}));

vi.mock("../services/creditsApi", () => ({
  assertCreditBalanceAtLeast: vi.fn(),
  prechargePlatformCredits: vi.fn(),
  fetchCreditBalance: vi.fn(),
}));

vi.mock("../services/settingsStore", () => ({
  getTencentCreds: vi.fn(() => ({ secretId: "", secretKey: "" })),
  getTripoApiKey: vi.fn(() => null),
  getUserApiKey: vi.fn(() => null),
}));

import { getGeminiFairnessUserId } from "../services/geminiFairnessBridge";
import { assertCreditBalanceAtLeast, prechargePlatformCredits } from "../services/creditsApi";
import {
  assertUnifiedProxyCreditsGate,
  isPlatformAiSubmitBlocked,
} from "../services/proxyCreditsGate";
import { isPlatformMeteredJobKind } from "../services/platformAiPath";
import { resolveBillingSkuForJimeng } from "../services/usageBillingSku";

describe("jimeng credits gate", () => {
  beforeEach(() => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue(null);
    vi.mocked(assertCreditBalanceAtLeast).mockReset();
    vi.mocked(prechargePlatformCredits).mockReset();
  });

  it("proxyGateMinCreditsForJob returns catalog-aligned defaults for jimeng kinds", () => {
    expect(proxyGateMinCreditsForJob("workflow_jimeng_image")).toBe(50);
    expect(proxyGateMinCreditsForJob("workflow_jimeng_video")).toBe(250);
  });

  it("isPlatformMeteredJobKind includes jimeng workflow kinds", () => {
    expect(isPlatformMeteredJobKind("workflow_jimeng_image")).toBe(true);
    expect(isPlatformMeteredJobKind("workflow_jimeng_video")).toBe(true);
  });

  it("assertUnifiedProxyCreditsGate blocks when not logged in", async () => {
    await expect(assertUnifiedProxyCreditsGate("workflow_jimeng_image")).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
    expect(assertCreditBalanceAtLeast).not.toHaveBeenCalled();
  });

  it("assertUnifiedProxyCreditsGate precharges for jimeng video", async () => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue("u1");
    vi.mocked(prechargePlatformCredits).mockResolvedValue({
      prechargeKey: "pc:v",
      reserveKey: "pc:v",
      amount: 250,
      remaining: 250,
    });
    await assertUnifiedProxyCreditsGate("workflow_jimeng_video");
    expect(prechargePlatformCredits).toHaveBeenCalledWith(250, undefined);
  });

  it("blocks zero balance for jimeng video", async () => {
    vi.mocked(prechargePlatformCredits).mockRejectedValue(
      new HttpRequestError("积分不足", 403, CREDITS_EXCEEDED_CODE)
    );
    vi.mocked(getGeminiFairnessUserId).mockReturnValue("u1");
    await expect(assertUnifiedProxyCreditsGate("workflow_jimeng_video")).rejects.toMatchObject({
      code: CREDITS_EXCEEDED_CODE,
    });
    expect(prechargePlatformCredits).toHaveBeenCalledWith(250, undefined);
  });

  it("isPlatformAiSubmitBlocked uses jimeng minimum credits", () => {
    expect(isPlatformAiSubmitBlocked("u1", 49, false, "workflow_jimeng_image").blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked("u1", 50, false, "workflow_jimeng_image").blocked).toBe(false);
    expect(isPlatformAiSubmitBlocked("u1", 249, false, "workflow_jimeng_video").blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked("u1", 250, false, "workflow_jimeng_video").blocked).toBe(false);
  });

  it("resolveBillingSkuForJimeng maps registryId prefixes", () => {
    expect(resolveBillingSkuForJimeng("jimeng-image-t2i-v40")).toBe("image.jimeng.t2i-v40");
    expect(resolveBillingSkuForJimeng("jimeng-video-ti2v-v30-pro")).toBe("video.jimeng.ti2v-v30-pro");
  });
});
