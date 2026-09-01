# GNM 照片拟合规整头模开发计划

## 目标

做一条“单张人像照片 -> 拟合 GNM 参数 -> 导出规整拓扑白模”的本地能力链路。

第一期目标不是复刻真人级数字人，而是把流程跑通：清晰正脸或轻微侧脸照片输入后，输出一个 GNM 固定拓扑的人头白模，能在 AssetCutter 里预览、下载、复现。

第二期目标是在第一期基础上加入 mask / silhouette / 可微渲染约束，提高脸宽、下巴、嘴鼻轮廓和侧脸稳定性。

## 已下载参考项目

参考代码统一放在：

```text
F:\AI\assetcutter-ai-pro\示例项目\gnm-photo-fitting-references
```

已下载：

| 目录 | Commit | 用途 |
|---|---:|---|
| `google-GNM` | `0adc2cb` | GNM 官方模型、PyTorch/NumPy backend、68 点 landmark、mesh 导出基础 |
| `ComfyUI-GNM` | `01fefbc` | 最接近的 GNM photo-to-params 实验实现，重点参考 `lib/fitting.py` |
| `eos` | `ce98420` | 经典 3DMM landmark fitting，参考正交相机、landmark-to-vertex、轮廓 fitting 思路 |
| `photometric_optimization` | `83f84b8` | FLAME photometric fitting，参考分阶段优化、landmark loss、mask photometric loss |
| `face-parsing.PyTorch` | `d2e684c` | 第二期 face parsing / mask 参考 |

没有下载 MediaPipe 整仓，因为太大；第一期只安装 Python 包或使用轻量 landmarker 模型。

## 参考文件索引

第一期必看：

```text
示例项目/gnm-photo-fitting-references/google-GNM/gnm/shape/README.md
示例项目/gnm-photo-fitting-references/google-GNM/gnm/shape/gnm_pytorch.py
示例项目/gnm-photo-fitting-references/google-GNM/gnm/shape/gnm_xnp.py
示例项目/gnm-photo-fitting-references/google-GNM/gnm/shape/gnm_landmarks.py
示例项目/gnm-photo-fitting-references/google-GNM/gnm/shape/data/landmarks/head_sparse_68.txt
示例项目/gnm-photo-fitting-references/ComfyUI-GNM/docs/FITTING.md
示例项目/gnm-photo-fitting-references/ComfyUI-GNM/lib/fitting.py
示例项目/gnm-photo-fitting-references/eos/examples/fit-model-simple.cpp
```

第二期必看：

```text
示例项目/gnm-photo-fitting-references/photometric_optimization/photometric_fitting.py
示例项目/gnm-photo-fitting-references/photometric_optimization/util.py
示例项目/gnm-photo-fitting-references/face-parsing.PyTorch/README.md
```

## 总体架构

建议单开一个项目维护，形态参考 `script-hub`：独立 Vite 工作台 + 独立本地 Python worker + 本地伴侣导航入口。不要把 GNM 拟合代码直接塞进主站、`App.tsx` 或通用 Node 服务里。

```text
AssetCutter UI
  -> 打开“GNM 头模工作台”
  -> GNM 头模工作台上传头像照片
  -> gnm-head-studio-api / local worker 调用 Python fitting pipeline
  -> 返回 job 状态、预览图、OBJ/GLB 路径、GNM 参数 JSON
  -> GNM 头模工作台 Three.js 载入白模预览
  -> 保存资产包到 AssetCutter 工作区
```

推荐项目目录：

```text
gnm-head-studio/
  package.json
  vite.config.ts
  index.html
  src/
    App.tsx
    pages/
      FitPhotoPage.tsx
      JobDetailPage.tsx
      AssetLibraryPage.tsx
    components/
      PhotoDropzone.tsx
      LandmarkOverlay.tsx
      HeadMeshViewer.tsx
      FitQualityPanel.tsx
      JobTimeline.tsx
    services/
      gnmHeadApi.ts
      companionClient.ts
  worker/
    requirements.txt
    gnm_fit/
      cli.py
      image_io.py
      landmarks.py
      gnm_model.py
      camera.py
      losses.py
      optimizer.py
      export_mesh.py
      preview.py
      report.py
  README.md
```

根目录脚本建议：

```json
{
  "gnm-head:dev": "npm run dev --prefix gnm-head-studio",
  "gnm-head:build": "npm run build --prefix gnm-head-studio",
  "gnm-head:typecheck": "npm run typecheck --prefix gnm-head-studio"
}
```

本地伴侣只负责三件事：

1. 在导航里显示“GNM 头模”入口。
2. 打开独立工作台 URL 或桌面壳窗口。
3. 提供 job API / 文件落盘 / 资产入库桥接。

这样主站、ScriptHub、GNM 头模工作台三者关系清楚：

| 项目 | 定位 | 依赖形态 |
|---|---|---|
| 主站 AssetCutter | 资产管理、工作流、统一预览 | 只调用结果资产 |
| ScriptHub | 脚本工具库 | 独立项目 |
| GNM Head Studio | 照片拟合规整头模 | 独立项目 + Python worker |

## 本地伴侣导航接入建议

GNM 工作台应该像 ScriptHub 一样成为伴侣里的一级入口，而不是塞进“小工具”列表。

建议导航：

```text
首页
资产工作台
脚本库
GNM 头模
本机引擎
设置
```

入口文案：

```text
GNM 头模
从照片拟合规整拓扑白模
```

伴侣运行时状态里新增一个本机引擎：

```text
id: gnm_head_fit
displayName: GNM 头模拟合
primaryEnvKey: COMPANION_GNM_HEAD_URL
healthStrategy: companion_http_probe_gnm_head
```

需要新增的环境变量：

```text
COMPANION_GNM_HEAD_URL=http://127.0.0.1:9340
COMPANION_GNM_HEAD_PYTHON=F:\AI\assetcutter-ai-pro\.venv-gnm-fit\Scripts\python.exe
COMPANION_GNM_HEAD_WORKDIR=F:\AI\assetcutter-ai-pro\.data\gnm-head-studio
```

健康检查接口：

```text
GET /health
```

返回：

```json
{
  "ok": true,
  "version": "0.1.0",
  "gnmLoaded": true,
  "device": "cuda",
  "model": "gnm-head-v3.0"
}
```

本地任务接口：

```text
POST /v1/jobs/photo-fit
GET  /v1/jobs/{jobId}
GET  /v1/jobs/{jobId}/artifacts
POST /v1/jobs/{jobId}/save-to-workspace
```

`photo-fit` 请求：

```json
{
  "imagePath": "F:\\samples\\portrait.jpg",
  "mode": "standard",
  "expressionMode": "preserve",
  "outputs": ["glb", "obj", "params", "preview"]
}
```

job 状态：

```json
{
  "jobId": "gnm_20260728_001",
  "status": "running",
  "stage": "fit_identity",
  "progress": 0.56,
  "humanStage": "拟合五官和脸型",
  "artifacts": []
}
```

第一期输出：

```text
outputs/{jobId}/input.png
outputs/{jobId}/landmarks_2d.json
outputs/{jobId}/fit_params.json
outputs/{jobId}/mesh.obj
outputs/{jobId}/mesh.glb
outputs/{jobId}/landmark_overlay.png
outputs/{jobId}/preview.png
outputs/{jobId}/report.json
```

`fit_params.json` 建议结构：

```json
{
  "model": "gnm-head",
  "version": "3.0",
  "identity": [],
  "expression": [],
  "rotations": [],
  "translation": [],
  "camera": {
    "type": "weak-perspective",
    "scale": 1.0,
    "tx": 0.0,
    "ty": 0.0,
    "rotation": [0.0, 0.0, 0.0]
  },
  "metrics": {
    "landmark_rmse_px": 0.0,
    "landmark_confidence": 0.0,
    "fit_status": "ok"
  }
}
```

## 第一期：Landmark Fitting MVP

### 目标

输入一张清晰正脸或轻微侧脸照片，输出 GNM 固定拓扑白模。

必须做到：

- 可检测人脸和 2D landmarks。
- 可把照片 landmarks 映射到 GNM 68 点。
- 可优化 GNM `identity` / `expression` / `pose` / weak-perspective camera。
- 可导出 OBJ 和 GLB。
- 可生成 landmark overlay 和白模预览图。
- 可把拟合参数保存为 JSON，支持重复生成相同 mesh。

暂不做：

- 纹理。
- 头发几何重建。
- 眼镜、遮挡物处理。
- 强侧脸和多人照片。
- Web 端实时 fitting。

### 依赖建议

Python 侧建议单独建环境：

```powershell
cd F:\AI\assetcutter-ai-pro
py -3.11 -m venv .venv-gnm-fit
.\.venv-gnm-fit\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install numpy scipy opencv-python mediapipe trimesh pygltflib pillow tqdm
pip install -e "示例项目\gnm-photo-fitting-references\google-GNM\gnm\shape[pytorch]"
```

如果本机没有 CUDA，先用 CPU 跑通，但优化会慢；第一期可以限制图片尺寸和迭代次数。

### 模块拆分

建议新增本地能力目录：

```text
local-companion/gnm-fit/
  README.md
  requirements.txt
  gnm_fit/
    __init__.py
    cli.py
    config.py
    image_io.py
    landmarks.py
    gnm_model.py
    camera.py
    losses.py
    optimizer.py
    export_mesh.py
    preview.py
    report.py
  tests/
    fixtures/
    test_landmark_mapping.py
    test_camera_projection.py
    test_export_mesh.py
```

如果不想一开始进入正式目录，可以先放：

```text
.tmp-codex/gnm-fit-poc/
```

等 PoC 成功后再迁到 `local-companion/gnm-fit/`。

### 步骤 1：读取和标准化输入照片

实现文件：

```text
gnm_fit/image_io.py
```

输入：

```text
image_path
```

输出：

```text
RGB image
original width / height
face crop transform
normalized crop
```

要求：

- 支持 `png/jpg/jpeg/webp`。
- 保存原图副本到 job 输出目录。
- 第一版裁剪到最大边 1024 或 768，避免优化太慢。
- 如果检测到多张脸，只取最大脸，并在 `report.json` 里写 warning。

### 步骤 2：检测 2D landmarks

实现文件：

```text
gnm_fit/landmarks.py
```

第一优先级：MediaPipe Face Mesh / Face Landmarker。

输出两个文件：

```text
landmarks_mediapipe_478.json
landmarks_2d_68.json
```

注意：

- MediaPipe 输出是归一化坐标，需要转成像素坐标。
- 保存检测置信度、脸框、原图尺寸。
- 检测失败时返回明确错误：`NO_FACE_DETECTED`。

参考：

```text
ComfyUI-GNM/lib/fitting.py
  _detect_with_legacy_mediapipe
  _landmarks478_to_gnm68
  require_landmarks_68_from_image
```

### 步骤 3：建立 GNM 68 点语义映射

GNM 官方已有 68 点配置：

```text
google-GNM/gnm/shape/data/landmarks/head_sparse_68.txt
```

实现：

```text
gnm_fit/gnm_model.py
```

必须提供：

```python
load_gnm()
evaluate_vertices(params)
evaluate_landmarks_68(params)
get_landmark_indices_and_weights()
```

注意：

- GNM 的 landmark 是 barycentric，不一定是单个顶点。
- 不要自己硬编码顶点编号，直接走 `gnm_landmarks.load_landmarks()`。
- 第一版只使用 68 点，后续再加 MediaPipe 478 到 GNM 表面约束。

### 步骤 4：相机和姿态初始化

实现：

```text
gnm_fit/camera.py
```

第一版使用 weak-perspective camera：

```text
x2d = scale * R[:2] @ X3d + translation
```

初始化方式：

1. GNM template 取 68 个 3D landmarks。
2. 照片取 68 个 2D landmarks。
3. 用眼角、鼻尖、嘴角、下巴等稳定点做 Procrustes / Umeyama 初始化。
4. 得到初始 `scale`、`tx`、`ty`、`rotation`。

参考：

```text
ComfyUI-GNM/lib/fitting.py
  _umeyama_similarity
  fit_head_pose_to_landmarks

eos/examples/fit-model-simple.cpp
  estimate_orthographic_projection_linear
```

第一版不追求物理真实相机，目标是 landmark 投影稳定。

### 步骤 5：分阶段优化

实现：

```text
gnm_fit/optimizer.py
gnm_fit/losses.py
```

使用 GNM PyTorch backend，优化变量：

```text
identity: 253
expression: 383
root rotation: 3
optional eye/jaw/head joints: 4 x 3
translation: 3
camera scale: 1
camera tx/ty: 2
```

第一期建议阶段：

| 阶段 | 迭代 | 开启变量 | 目标 |
|---|---:|---|---|
| A | 100 | camera + root pose | 让模板头对齐照片 |
| B | 150 | camera + root pose + expression | 对齐嘴、眼、眉等表情 |
| C | 250 | camera + root pose + identity | 拟合脸宽、鼻梁、下巴等身份形状 |
| D | 150 | 全部小步微调 | 降低整体 reprojection error |

基础 loss：

```text
L = w_lm * landmark_reprojection_loss
  + w_id * identity_l2
  + w_expr * expression_l2
  + w_pose * pose_l2
  + w_cam * camera_prior
```

建议初始权重：

```text
w_lm = 1.0
w_id = 0.003
w_expr = 0.01
w_pose = 0.01
w_cam = 0.001
```

Landmark 分区权重：

| 区域 | 建议权重 | 说明 |
|---|---:|---|
| 眼角/鼻梁/鼻尖 | 2.0 | 稳定头姿和身份 |
| 嘴角/上下唇 | 1.5 | 表情敏感 |
| 下巴/脸轮廓 | 1.2 | 单图不稳定，先别过重 |
| 眉毛 | 0.8 | detector 抖动较多 |

第一期先不要上 photometric loss，避免调参面爆炸。

### 步骤 6：质量指标和失败检测

实现：

```text
gnm_fit/report.py
```

输出：

```json
{
  "fit_status": "ok",
  "warnings": [],
  "landmark_rmse_px": 7.2,
  "face_bbox_px": [0, 0, 512, 512],
  "identity_l2": 1.3,
  "expression_l2": 0.8,
  "iterations": 650
}
```

第一期失败标准：

- `NO_FACE_DETECTED`
- `MULTI_FACE_AMBIGUOUS`
- `LANDMARK_RMSE_TOO_HIGH`
- `POSE_TOO_SIDEWAYS`
- `PARAMS_OUT_OF_RANGE`

建议阈值：

```text
landmark_rmse_px > face_bbox_width * 0.035 -> warning
landmark_rmse_px > face_bbox_width * 0.06 -> failed
abs(yaw) > 35 degrees -> warning
abs(yaw) > 50 degrees -> failed
max(abs(identity)) > 4.5 -> warning
max(abs(expression)) > 4.5 -> warning
```

### 步骤 7：导出白模

实现：

```text
gnm_fit/export_mesh.py
```

输出：

```text
mesh.obj
mesh.glb
fit_params.json
```

要求：

- 使用 GNM `vertices` 和 `triangles`。
- 法线自动计算。
- 统一居中、缩放到产品内约定尺寸。
- GLB 材质用白色 clay material。
- 保留 GNM 原始顶点顺序，不能 decimate；规整拓扑的价值就在这里。

### 步骤 8：生成调试预览

实现：

```text
gnm_fit/preview.py
```

输出：

```text
landmark_overlay.png
preview_front.png
preview_3quarter.png
preview_side.png
```

第一版可以用 `trimesh` 或 `pyrender`。如果本地渲染环境麻烦，至少生成 landmark overlay，并让前端 Three.js 负责白模预览。

### CLI 设计

第一期先做 CLI，便于脱离 UI 调试：

```powershell
python -m gnm_fit.cli fit-photo `
  --input "F:\samples\portrait.jpg" `
  --output "F:\AI\assetcutter-ai-pro\.tmp-codex\gnm-fit-output\job-001" `
  --device cuda `
  --max-size 768 `
  --iterations 650
```

成功后输出：

```text
fit_status=ok
mesh=...\mesh.glb
params=...\fit_params.json
preview=...\preview_front.png
```

### 第一期验收

准备 10 张测试图：

- 5 张正脸。
- 3 张轻微侧脸。
- 2 张失败样本：遮挡、多人或低清晰度。

验收标准：

- 8/10 能完成任务或给出合理失败原因。
- 正脸 landmark overlay 误差肉眼可接受。
- 输出 GLB 能在 Three.js 中打开。
- 同一张图重复运行结果基本一致。
- `fit_params.json` 能重新生成相同 mesh。
- GNM 顶点数保持 `17821`，三角面保持 `35324`。

## 第二期：Mask / Silhouette / 可微渲染增强

### 目标

提高“像本人”的几何感，尤其是：

- 脸宽。
- 下颌线。
- 下巴。
- 鼻翼外轮廓。
- 轻微侧脸轮廓。

第二期仍然只输出白模，不做真实纹理。

### 新增依赖

可选：

```powershell
pip install segmentation-models-pytorch
pip install face-alignment
```

可微渲染二选一：

```text
PyTorch3D：成熟，但 Windows 安装成本高
nvdiffrast：快，但 CUDA / 编译要求更强
```

如果 Windows 环境太痛苦，第二期可先只做 non-differentiable silhouette score，用于筛选和报告，不反向优化。

### 步骤 1：Face parsing / skin mask

实现：

```text
gnm_fit/face_mask.py
```

输入照片，输出：

```text
face_mask.png
skin_mask.png
hair_mask.png
occlusion_mask.png
```

参考：

```text
face-parsing.PyTorch
photometric_optimization/photometric_fitting.py
```

第一版 mask 只用于 silhouette，不参与颜色 photometric loss。

### 步骤 2：GNM silhouette render

实现：

```text
gnm_fit/silhouette.py
```

输出：

```text
rendered_silhouette.png
silhouette_iou
```

做法：

1. 用当前拟合参数生成 GNM vertices。
2. 用同一 camera 投影。
3. 渲染 head/skin 相关面片 silhouette。
4. 和 `face_mask` 比较 IoU / Chamfer distance。

### 步骤 3：加入 silhouette loss

第二期 loss：

```text
L = L_landmark
  + L_silhouette
  + L_identity_reg
  + L_expression_reg
  + L_pose_reg
```

注意：

- silhouette 权重不能太大，否则会为了脸外轮廓牺牲五官。
- 头发会严重干扰，必须尽量只取 skin/face mask。
- 耳朵和后脑单图不可见，不要强拟合。

建议初始策略：

| 阶段 | 变量 | loss |
|---|---|---|
| A | 读取第一期结果 | 不重新从零开始 |
| B | identity + camera | landmark + silhouette |
| C | identity + expression + pose 小步 | landmark + silhouette + reg |

### 步骤 4：加入 contour 动态对应

68 点里的脸轮廓点对侧脸不稳定，因为真实可见轮廓不是固定顶点。

参考 eos：

```text
eos/examples/fit-model.cpp
eos/examples/fit-model-multi.cpp
```

第二期可以实现：

- 根据当前 yaw 选择 GNM mesh 外轮廓候选边。
- 把照片 face mask 的外轮廓采样成 2D points。
- 用最近点或 soft correspondence 做 contour loss。

这一步很重要，但建议放在第二期后半段，不要和 mask 渲染同时开。

### 第二期验收

在第一期同一组图片上比较：

- landmark RMSE 不变差超过 10%。
- silhouette IoU 提升。
- 正脸脸宽和下颌线肉眼更贴近。
- 侧脸不再明显模板化。
- 参数不飘：identity/expression 仍在合理范围。

## 风险和应对

| 风险 | 表现 | 应对 |
|---|---|---|
| 单图无法确定后脑和耳朵 | 后脑模板感强 | 产品文案定位为“照片拟合基础白模”，不承诺完整扫描 |
| identity/expression 混淆 | 笑脸照片会把 identity 拉歪 | 分阶段优化，先 expression 后 identity，或提供“中性表情优先”提示 |
| landmark detector 抖动 | 嘴角、眉毛不稳定 | 分区权重、异常点剔除、多 detector 对比 |
| silhouette 被头发污染 | 脸型变宽/变怪 | 使用 skin mask，不用 hair mask |
| PyTorch3D Windows 安装难 | 第二期卡环境 | 先用 CPU/非可微 silhouette 评分，再决定是否上 Linux worker |
| 商业许可证 | FLAME/DECA/MICA 不能直接产品化 | 只参考算法，不引入其模型或权重；核心输出使用 Apache 2.0 的 GNM |

## 开发任务清单

### 第一期任务

1. 建 Python PoC 目录和环境。
2. 安装 GNM PyTorch backend，确认能导出 template OBJ。
3. 实现 MediaPipe landmark 检测，保存 478 点和 68 点 JSON。
4. 读取 GNM `head_sparse_68`，实现 3D landmarks evaluate。
5. 实现 weak-perspective projection。
6. 实现 camera / pose 初始化。
7. 实现 landmark reprojection loss。
8. 实现四阶段优化。
9. 实现 OBJ/GLB 导出。
10. 实现 overlay 和 report。
11. 准备 10 张本地测试图。
12. 写本地 companion 调用包装。
13. 接 AssetCutter UI 的任务入口和预览。

### 第二期任务

1. 加 face parsing / skin mask。
2. 渲染 GNM silhouette。
3. 计算 silhouette IoU 和边界距离。
4. 接入可微渲染或先做非可微评分。
5. 将 silhouette loss 加入第二阶段优化。
6. 实现动态 contour 对应。
7. 优化失败检测。
8. 增加批量对比报告。
9. 对比第一期和第二期效果。

## 推荐里程碑

| 里程碑 | 产物 | 建议耗时 |
|---|---|---:|
| M0 | GNM template OBJ/GLB 导出 | 0.5 天 |
| M1 | 照片 landmarks -> overlay | 1 天 |
| M2 | GNM 68 点投影 overlay | 1 天 |
| M3 | camera + pose 初始化成功 | 1 天 |
| M4 | identity/expression landmark fitting 跑通 | 3-5 天 |
| M5 | CLI + report + GLB 预览 | 2 天 |
| M6 | 接入 AssetCutter 本地任务入口 | 2-3 天 |
| M7 | mask/silhouette 增强 | 5-8 天 |

## 第一版完成后的产品形态

UI 里建议叫：

```text
照片拟合 GNM 白模
```

输入区：

- 上传照片。
- 选择质量模式：快速 / 标准。
- 选择是否拟合表情：保留照片表情 / 尽量中性。

输出区：

- 白模 3D 预览。
- Landmark overlay。
- 拟合质量分数。
- 下载 OBJ / GLB。
- 下载 GNM 参数 JSON。

失败时不要只报错，要给用户可执行提示：

```text
没有检测到清晰人脸。请换一张正脸、无遮挡、光线均匀的人像照片。
```

## 关键决策

第一期坚持只做 landmark fitting，不做 texture 和 photometric fitting。这样可以最快得到可用白模，也能把工程风险控制在 GNM 参数优化本身。

第二期再加 mask/silhouette，因为它会引入渲染、分割模型、更多调参和环境复杂度。两期分开，能避免一开始陷进“全都想要但没有稳定输出”的泥潭。
