# needle-fbx-exporter（vendored）

- **来源**：[needle-tools/three-fbx-exporter](https://github.com/needle-tools/three-fbx-exporter) 的 `package/dist/FBXExporter.js`（未在 npm 发布，故 vendoring）。
- **依赖**：`fflate`（仓库根 `package.json` 已声明）。
- **类型**：同目录 `FBXExporter.d.ts` 为精简声明，便于 `tsc`；与上游 dist 的 `.d.ts` 可能略有差异。

升级时请从上游 `package/dist` 同步 `FBXExporter.js` 并核对 `fflate` / `three` 版本。
