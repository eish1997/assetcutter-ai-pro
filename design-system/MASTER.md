# AssetCutter Design System

视觉真源。改壳 / 工作台 / 下拉之前先读本文件；页面特例见 `design-system/pages/`。静态预览：作坊 [`preview.html`](preview.html) · 工具架 [`preview-tools.html`](preview-tools.html)（顶栏可切钨丝 / 蓝）。

**产品**：本机 3D / 游戏素材 DAM（对标独立软件 Connecter，不是通讯室连接页）。  
**观众**：在桌面壳里逛自己文件夹的美术。  
**这一屏的工作**：左树找货、中间图墙认货、顶栏送出。图墙是主角，铬件闭嘴。

## 怎么来的（不要再用自动生成稿）

`ui-ux-pro-max --design-system` 对「DAM / 3D / desktop」吐出的是浅色 Indigo 落地页（Poppins、#EEF2FF、横向旅程 CTA）。**整份作废。**

采用的是：现有 compose 深色 + 密度仪表盘（8–12px 垫、11–12px 字）+ OLED 石墨底 + **一层**玻璃（只给弹层）。字体沿用产品已有的 Plus Jakarta Sans / JetBrains Mono。

`frontend-design` 校准：不做奶油衬线、不做黑底酸绿、不做报纸栏。壳已经接近「黑底 + 一抹亮色」这条 AI 默认，所以亮色从 SaaS 蓝改成**摄影钨丝灯**，理由在「签名」一节。

## 色（6 个名字）

| Token | Hex | 用途 |
|---|---|---|
| `ink` | `#0b0b0d` | 窗底。统一网页 `#050505` 与壳 `#0c0c0e` |
| `slate` | `#121214` | 侧栏、顶栏、面板 |
| `graphite` | `#0f0f12` | 下拉列表、图墙空地 |
| `paper` | `#e8e6e1` | 主字。略暖，让缩略图更像打在灰卡上 |
| `quiet` | `#8b8b93` | 次要字。比壳上 `#71717a` 略亮，够 AA |
| `tungsten` | `#c9a36a` | **唯一品牌色**：选中环、焦点环、当前房间、送出主按钮 |

语义色（不是品牌）：`ok` `#22c55e` · `warn` `#eab308` · `bad` `#f87171`。

铬件表面继续用现有 compose 配方，不要换成实色 `#2e2e32` 边（设置页 `tone="settings"` 除外）：

- 触发器 / 输入：`bg-white/[0.05]` + `ring-white/[0.08]`
- hover：`bg-white/[0.1]`
- 选中 chip：`bg-white/[0.16]` + `ring-white/[0.22]`
- 焦点：`ring-2` + `tungsten` 约 45% 透明，**不要** `blue-500`

## 字

| 角色 | 字体 | 用法 |
|---|---|---|
| Display | Plus Jakarta Sans 600–800 | 房间名、空态一句。少用 |
| Body | Plus Jakarta Sans 400–500 | 按钮、树、卡片名。默认 11–12px |
| Utility | JetBrains Mono 400–500 | 路径、版本号、文件名后缀 |
| CJK | 系统：苹方 / 微软雅黑 | Jakarta 不含汉字时的回退 |

不要换 Inter / Poppins / Open Sans。不要用等宽当界面正文字体。

## 布局（信息架构冻结）

不改房间、不改左树 / 中墙 / 右管家、不加落地页 Hero / Bento / 底栏 CTA。

```
+--------+---------------------------+----------+
| 房间   | 30px 标题栏 · 送出        | 收管家   |
+--------+---------------------------+----------+
| 文件树 | ######## 缩略图墙 ####### | dsh      |
| 窄栏   | （货在这里发光）          | 可收     |
+--------+---------------------------+----------+
```

密度：树宽约 220–260px；格 gap 8px；卡片内边 8–12px；圆角 `rounded-xl`（12px）与现下拉一致。全页不要 backdrop-blur；blur 只给下拉 / 灯箱 / dock。

## 签名（只大胆这一处）

**图墙上被选中的那一张卡：一圈细钨丝灯。**

货是彩色的，壳是石墨的。选中不用蓝霓虹、不用赛博绿，用影棚钨丝（暖琥珀 `#c9a36a`）。这是 3D 资产世界里的灯，不是 SaaS 按钮色。

周围全部安静：树、标题栏、空态都不要再加第二套高饱和强调。

## 动效

- 颜色 / 透明度 150–200ms；不要 scale 造成位移
- 已有 workflow dock 动效保留，并尊重 `prefers-reduced-motion`
- 图墙虚拟滚动：不要给每张卡入场动画

## 文案

控件按用户动作命名（「应用」「送出」「指定库目录」），不要系统词当按钮。空态给下一步，不道歉、不说明书。

## 硬约束

- 禁止原生 `<select>`；compose 下拉见 `.cursor/skills/dropdown-ui-style`
- 图标用 SVG（Lucide / 现有），禁止 emoji 当图标
- 可点元素 `cursor-pointer`；键盘焦点可见
- 不把缩略图写进用户文件夹（宪章 §3.12）

## 明确不要

浅色文档风、Indigo CTA、酸绿终端、扫描线、新拟态、Bento 展示墙、奶油衬线、大段 onboarding、把项目卡当主索引。

## 实施顺序（改代码时）

1. Token：网页 `index.html :root` 与壳 `companion-desktop/shell/index.html :root` 对齐上表；焦点环改 tungsten。
2. 下拉：`CustomDropdown` compose 焦点从 `blue-500` 改 tungsten；`dropdown-ui-style` skill 同步。
3. 作坊图墙选中环（见 `pages/workshop.md`）。
4. 壳顶栏当前房间 / 送出主按钮（见 `pages/shell.md`）。
5. 再用 `web-design-guidelines` 扫改过的文件。

未改信息架构之前，不要重写 `App.tsx` 导航结构。
