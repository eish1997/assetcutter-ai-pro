import type { SiteConnector } from "./siteConnector.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<string, SiteConnector>();

  register(connector: SiteConnector): void {
    this.connectors.set(connector.id, connector);
  }

  resolve(connectorId: string): SiteConnector | undefined {
    for (const connector of this.connectors.values()) {
      if (connector.match({ connectorId })) {
        return connector;
      }
    }
    return undefined;
  }

  list(): SiteConnector[] {
    return [...this.connectors.values()];
  }
}
