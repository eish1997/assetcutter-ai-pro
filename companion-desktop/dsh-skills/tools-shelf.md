# 工具货架

whenToUse：用户说「装一个工具 / 货架上有没有 / 帮我安装示例 / 看工具页」。没说上架或安装不要装。

步骤：

1. 先 `workspace_open_surface`，surface=`tools`（人进五金铺后才能动货架）。
2. `shell_tool_list`。已经在货架上 → 说明已装，不要再装一份。
3. 未装且用户要装 → `shell_tool_install`。示例可用 exampleId（如 image-format-converter）；云端包用 url。不要编下载地址。
4. 安装失败把错误码原样告诉用户。不要循环乱试。
5. 打开、卸载、导出仍是人在货架上点。不要假装点了网页按钮。
