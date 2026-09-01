# 地图添加地点

whenToUse：用户说「地图里加上 Maya / 把某某软件加到地图 / 还没有这个地点 / 帮我添加目标地点」。没说加地点不要创建。已知名宿主被技能 / 发送到 / host_invoke 碰到时会自动建点。

步骤：

1. 碰到已知名宿主（Maya / Blender / Photoshop / Unreal）先 `connection_list`。已有同名地点 → 用返回的 draftId 做 `connection_probe` 或 `host_invoke_primitive`。不要再 `connection_create`，不要另猜 exe / 端口。
2. 用户明确要加地点且名单没有：先 `workspace_open_surface`，surface=`connections`（人进地图后才能上地点）。
3. 没有 → `connection_create`，只传软件名（如 Maya）。不要编 exe 路径，不要假装扫了整台电脑。
4. 创建后 `connection_discover`，再对返回的 draftId `connection_probe`。
5. probe 失败：请用户打开该软件，或把快捷方式/exe 拖到地图上。禁止循环乱试其它工具、禁止发明安装目录。
6. 地点只表示「能送到哪」。配送走壳顶栏「发送到」，不要在地图页办送货。
