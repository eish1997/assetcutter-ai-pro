# 将预设推到 assetcutter-ai-pro-store 仓库

本目录 `store-for-github/store/` 下已生成：

- **catalog.json**：商店目录（保留原有 Starter 包条目，并新增「AssetCutter AI Pro 官方预设」）
- **assetcutter_ai_pro_official.json**：官方预设包（8 个能力：拆分组件、转风格、多视角、切割图片、线稿、色块、白模、线稿色块）

## 推送到 GitHub 的步骤

1. **克隆或打开仓库**（若已克隆则进入该目录）：
   ```bash
   git clone https://github.com/eish1997/assetcutter-ai-pro-store.git
   cd assetcutter-ai-pro-store
   ```

2. **把本项目的 store 文件拷过去**：
   - 将 `assetcutter-ai-pro/store-for-github/store/catalog.json` 覆盖到 `assetcutter-ai-pro-store/store/catalog.json`
   - 将 `assetcutter-ai-pro/store-for-github/store/assetcutter_ai_pro_official.json` 复制到 `assetcutter-ai-pro-store/store/`

3. **提交并推送**（若推送需走代理，先设置再 push）：
   ```bash
   git config --global http.proxy http://127.0.0.1:7890
   git config --global https.proxy http://127.0.0.1:7890
   git add store/
   git commit -m "feat: add official capability presets pack"
   git push origin main
   ```

4. **在应用中使用**：  
   设置 → 通用 → 能力商店 GitHub 地址设为：  
   `https://eish1997.github.io/assetcutter-ai-pro-store/store/catalog.json`  
   即可在「能力」页看到并安装「AssetCutter AI Pro 官方预设」。
