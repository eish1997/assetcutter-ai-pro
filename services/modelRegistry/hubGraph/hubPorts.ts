import { DIALOG_IMAGE_REGISTRY, labelForImageModelRegistryId } from "../imageModels";
import { TEXT_MODEL_REGISTRY, labelForTextModelRegistryId } from "../textModels";
import type { HubInPort, HubOutPort } from "./types";

export function buildHubInPorts(): HubInPort[] {
  const ports: HubInPort[] = [];
  for (const e of DIALOG_IMAGE_REGISTRY) {
    ports.push({
      hubInId: `${e.registryId}:image`,
      registryId: e.registryId,
      role: "image",
    });
  }
  for (const e of TEXT_MODEL_REGISTRY) {
    ports.push({
      hubInId: `${e.registryId}:text`,
      registryId: e.registryId,
      role: "text",
    });
  }
  return ports;
}

export function buildHubOutPorts(): HubOutPort[] {
  const ports: HubOutPort[] = [];
  for (const e of DIALOG_IMAGE_REGISTRY) {
    ports.push({
      hubOutId: e.registryId,
      registryId: e.registryId,
      menuLabel: labelForImageModelRegistryId(e.registryId),
      visible: true,
    });
  }
  for (const e of TEXT_MODEL_REGISTRY) {
    ports.push({
      hubOutId: e.registryId,
      registryId: e.registryId,
      menuLabel: labelForTextModelRegistryId(e.registryId),
      visible: true,
    });
  }
  return ports;
}

export function hubInPortForRegistry(registryId: string, role: HubInPort["role"]): HubInPort | undefined {
  const id = (registryId || "").trim();
  if (!id) return undefined;
  return buildHubInPorts().find((p) => p.registryId === id && p.role === role);
}
