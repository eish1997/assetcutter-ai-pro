export function usePluginHost(_opts?: unknown) {
  return {
    pluginHost: {},
    renderPluginPanel: () => null,
    buildNodeToolbarItems: () => [],
  };
}
