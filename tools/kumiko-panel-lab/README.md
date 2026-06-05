# Kumiko 分格实验室

本地试用 [Kumiko](https://github.com/njean42/kumiko) 漫画/拼图分格检测，评估是否可用于分镜表切分。

## 准备

```powershell
npm run setup:kumiko-panel-lab
```

会：clone `vendor/kumiko`、pip 安装依赖、对 `simple.png` 跑 smoke。

## 启动 Web UI

```powershell
npm run dev:kumiko-panel-lab
```

浏览器打开 **http://127.0.0.1:18083**，上传 PNG/JPG，查看分格框叠加与 JSON。

**影视分镜表**（无清晰漫画黑框）通常 Kumiko 只会得到整图 1 格——请填写与实际拼图一致的 **列×行**（如 3×2），模式选「均匀网格」或「自动」。

环境变量：`KUMIKO_LAB_PORT`（默认 `18083`）。

## CLI 对比（可选）

```powershell
cd tools/kumiko-panel-lab/vendor/kumiko
python kumiko -i tests/images/000-common-page-templates/simple.png -b firefox
```

## 目录

| 路径 | 说明 |
|------|------|
| `app/main.py` | FastAPI + 上传 API |
| `static/index.html` | 测试页 |
| `vendor/kumiko` | 上游（setup 时 clone，不提交 git） |
