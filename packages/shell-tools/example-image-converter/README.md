# 示例小工具包

`image-format-converter` 用于验证 **ToolSpec v1 / PanelSpec v1** 契约与 `npm run validate:shell-tools`。

## 布局

```
example-image-converter/
  tool.json
  module/panel.json
  scripts/convert.mjs
```

安装到本机后对应 `shell-tools/image-format-converter/extracted/`（P1 实现）。

## 校验

```bash
npm run validate:shell-tools
```

## 打包（P1+）

`npm run pack:shell-tool -- image-format-converter`（待实现）。
