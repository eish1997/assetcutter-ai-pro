import { getEnabledChannels, isChannelReady } from "../settingsStore";
import { outletDisplayLabelForWiring } from "./channelCatalog";
import { supplierOutletLabelForChannel } from "./hubGraph/supplierOutlets";
import { labelForImageModelRegistryId } from "./imageModels";
import { resolvedBindingsForRegistry } from "./pickBinding";
import { PROVIDER_BINDINGS } from "./providerBindings";
import { labelForTextModelRegistryId } from "./textModels";
import type { ChannelId, ModelResolveRole } from "./types";

export type WiringOutletStepState = "active" | "standby" | "off" | "pending";

export type WiringOutletStep = {
  channel: ChannelId;
  label: string;
  priority: number;
  state: WiringOutletStepState;
};

export type ModelWiringRow = {
  registryId: string;
  skuLabel: string;
  role: ModelResolveRole;
  outlets: WiringOutletStep[];
  /** 当前会实际走到的输出口（已启用且 ready 的第一条） */
  pickedOutletLabel: string | null;
};

function skuLabelFor(registryId: string, role: ModelResolveRole): string {
  return role === "image" ? labelForImageModelRegistryId(registryId) : labelForTextModelRegistryId(registryId);
}

function wiringOutletSteps(
  registryId: string,
  role: ModelResolveRole,
  enabledSet: Set<ChannelId>
): { outlets: WiringOutletStep[]; picked: ChannelId | null } {
  const bindings = resolvedBindingsForRegistry(registryId, role);
  let picked: ChannelId | null = null;
  const outlets: WiringOutletStep[] = bindings.map((b) => {
    const on = enabledSet.has(b.channel);
    const ready = on && isChannelReady(b.channel);
    let state: WiringOutletStepState = "off";
    if (!on) state = "off";
    else if (!ready) state = "pending";
    else if (picked == null) {
      state = "active";
      picked = b.channel;
    } else {
      state = "standby";
    }
    const label = supplierOutletLabelForChannel(b.channel) ?? outletDisplayLabelForWiring(b.channel);
    return {
      channel: b.channel,
      label,
      priority: b.priority,
      state,
    };
  });
  return { outlets, picked };
}

/** 设置页：全部 SKU×role 的接线链与当前生效输出口 */
export function modelWiringRows(enabledChannels: readonly ChannelId[] = getEnabledChannels()): ModelWiringRow[] {
  const enabledSet = new Set(enabledChannels);
  const keys = new Map<string, { registryId: string; role: ModelResolveRole }>();
  for (const b of PROVIDER_BINDINGS) {
    keys.set(`${b.registryId}\0${b.role}`, { registryId: b.registryId, role: b.role });
  }
  const rows: ModelWiringRow[] = [];
  for (const { registryId, role } of keys.values()) {
    const { outlets, picked } = wiringOutletSteps(registryId, role, enabledSet);
    rows.push({
      registryId,
      skuLabel: skuLabelFor(registryId, role),
      role,
      outlets,
      pickedOutletLabel: picked
        ? (supplierOutletLabelForChannel(picked) ?? outletDisplayLabelForWiring(picked))
        : null,
    });
  }
  rows.sort(
    (a, b) =>
      a.role.localeCompare(b.role) ||
      a.skuLabel.localeCompare(b.skuLabel, "zh-CN") ||
      a.registryId.localeCompare(b.registryId)
  );
  return rows;
}

export function countModelWiringRows(): number {
  const seen = new Set<string>();
  for (const b of PROVIDER_BINDINGS) seen.add(`${b.registryId}\0${b.role}`);
  return seen.size;
}
