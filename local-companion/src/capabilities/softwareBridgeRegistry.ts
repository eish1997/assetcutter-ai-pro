import type { CapabilityPackage } from './capabilityPackages.js';
import type { ConnectionStrategy } from './connectionStrategy.js';
import {
  buildSoftwareBridgeMatchInput,
  type SoftwareBridgeDriver,
} from './softwareBridgeDriver.js';
import { blenderBridgeDriver } from './drivers/blenderBridgeDriver.js';
import { mayaBridgeDriver } from './drivers/mayaBridgeDriver.js';
import { photoshopBridgeDriver } from './drivers/photoshopBridgeDriver.js';
import { unrealBridgeDriver } from './drivers/unrealBridgeDriver.js';

const builtInDrivers: SoftwareBridgeDriver[] = [
  photoshopBridgeDriver,
  blenderBridgeDriver,
  mayaBridgeDriver,
  unrealBridgeDriver,
];
const registeredDrivers: SoftwareBridgeDriver[] = [];

export function registerSoftwareBridgeDriver(driver: SoftwareBridgeDriver): SoftwareBridgeDriver {
  const id = String(driver && driver.id ? driver.id : '').trim();
  if (!id) throw new Error('software_bridge_driver_id_required');
  if (listSoftwareBridgeDrivers().some((item) => item.id === id)) {
    throw new Error(`software_bridge_driver_duplicate:${id}`);
  }
  registeredDrivers.push(driver);
  return driver;
}

export function listSoftwareBridgeDrivers(): SoftwareBridgeDriver[] {
  return builtInDrivers.concat(registeredDrivers);
}

export function clearSoftwareBridgeDriversForTest(): void {
  registeredDrivers.splice(0, registeredDrivers.length);
}

export function resolveSoftwareBridgeDriver(pkg: CapabilityPackage | null | undefined): SoftwareBridgeDriver | null {
  if (!pkg || pkg.type !== 'software_connection') return null;
  const input = buildSoftwareBridgeMatchInput(pkg);
  return listSoftwareBridgeDrivers().find((driver) => driver.match(input)) || null;
}

export function resolveSoftwareBridgeStrategies(pkg: CapabilityPackage | null | undefined): ConnectionStrategy[] {
  if (!pkg || pkg.type !== 'software_connection') return [];
  const input = buildSoftwareBridgeMatchInput(pkg);
  return listSoftwareBridgeDrivers()
    .filter((driver) => driver.match(input))
    .flatMap((driver) => (driver.strategies ? driver.strategies(input) : []));
}
