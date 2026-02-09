# WebSeamRepair（本机 Web 版 seam-aware 贴图修缝）

目标：解决 **UV seam 两侧贴图不一致** 导致的“接缝线”。  
输入 `OBJ + 贴图 +（可选）SP 导出的 seam mask`，输出修复后的 PNG。

> 注意：如果你遇到的是 **法线/切线空间**导致的“光照裂”，修 BaseColor 不会治本（需要检查硬边、切线空间、法线烘焙流程）。

## 目录结构

- `backend/`：FastAPI 后端 + seam-aware 修复核心
- `frontend/static/`：纯静态前端（无需打包）

## 本机运行（Windows / PowerShell）

进入后端目录：

```bash
cd "e:\UnrealProjects\Pluging_UEP\Plugins\PythonScriptManage\WebSeamRepair\backend"
```

安装依赖：

```bash
python -m pip install -r requirements.txt
```

启动服务：

```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8008
```

打开浏览器访问：

- `http://127.0.0.1:8008/`

## 使用说明

- **OBJ**：必须包含 `vt`（UV），否则无法 seam-aware 修复
- **贴图类型**：
  - **BaseColor（sRGB）**：后端会转为线性空间修复，再转回 sRGB（更少发灰/光晕）
  - **数据贴图（线性）**：Roughness/Metal/AO/Height 等，按线性数值直接修
  - **Normal（向量法线）**：按法线向量修（归一化），比把 RGB 当颜色更正确
- **Seam Mask（可选）**：
  - 白色 = 需要修复的 seam 区域
  - 建议与贴图同分辨率（不同也行，会按最近邻缩放）
- **3D 预览贴图校正（仅影响预览）**：
  - 提供左右翻转 / 上下翻转 / 旋转 0/90/180/270
  - 用来校正不同 DCC/导出约定导致的“贴图看起来方向不对”，不会影响修复结果

## 参数说明（Web 页面 / API 一致）

- **texture_kind（贴图类型）**：`basecolor` | `data` | `normal`
- **band_px（带宽）**：seam 两侧同步的像素带宽（越大越稳但更慢）
- **sample_step_px（沿边步长）**：越小越精细（1 通常比 2 更干净）
- **mode（同步模式）**：`average` | `a_to_b` | `b_to_a`
- **alpha_method（羽化 alpha）**：`distance`（距离场，推荐） | `wacc`（旧：权重推导）
- **feather_px（过渡半径）**：0 关闭羽化；建议与带宽同量级
- **alpha_edge_aware（边缘保持）**：是否对 alpha 做引导滤波（推荐开；Normal 会自动跳过）
- **guided_eps**：引导滤波强度（越小越贴边，默认 `1e-4` 一般够用）
- **color_match（颜色匹配）**：
  - `meanvar`（推荐）：全局均值/方差匹配（稳定，不易出色块）
  - `meanvar_edge`（实验）：按 seam 边逐段匹配（更“贴局部”，但可能出色块）
  - `none`：关闭
- **poisson_iters（Poisson 迭代）**：0 关闭；`100~300` 更无痕但更慢
- **only_masked_seams**：有 mask 时建议开（只修 mask 覆盖到的 seam）

## 参数建议（4K / 10w 面以内）

- **平衡（推荐）**：
  - `texture_kind=basecolor`
  - `band_px=16` `feather_px=12` `sample_step_px=1`
  - `mode=average`
  - `alpha_method=distance` `alpha_edge_aware=true` `guided_eps=1e-4`
  - `color_match=meanvar` `poisson_iters=0`
- **更快**（先看趋势）：
  - `band_px=12` `feather_px=0~6` `sample_step_px=2`
  - `alpha_edge_aware=false` `color_match=none`
- **更无痕（更慢）**：
  - 在“平衡”基础上把 `poisson_iters=100~300`（逐步加，不要一步到 600）

## 常见问题

- **出现“方块/补丁感”**：
  - 优先把 `poisson_iters` 设回 `0`
  - `color_match` 用 `meanvar`（不要用 `meanvar_edge`）
- **Lit 下仍然像“高光边”一样的缝**：
  - 这通常不是 BaseColor 的问题，建议把 Roughness/Metal/AO 用 `texture_kind=data` 也跑一遍

## 快速自检（不跑 Web）

在 `backend/` 下运行：

```bash
python smoke_test.py
```

会输出 `smoke_out.png`，用于确认核心算法能跑通。

