# -*- coding: utf-8 -*-
"""
批量传递贴图主窗口：三列（低模 | 高模 | 贴图），仅传递高模已有贴图到低模 UV，不烘焙新图。
UI 与 QuickRender 保持一致（QGroupBox、边距、风格）。
"""

import os
import sys

try:
    from .qt_imports import *
except ImportError:
    from transfermaps.ui.qt_imports import *

from transfermaps.core.config import load_config, save_config, default_config

# 贴图尺寸固定预设
MAP_SIZE_PRESETS = [64, 128, 256, 512, 1024, 2048, 4096, 8192]


def _t(s):
    if s is None:
        return u"" if sys.version_info[0] == 2 else ""
    if sys.version_info[0] == 2:
        try:
            if isinstance(s, type(u"")):
                return s
            if isinstance(s, str):
                return s.decode("utf-8", "replace")
            return type(u"")(s)
        except Exception:
            return type(u"")(repr(s))
    return s if isinstance(s, str) else str(s)


class TextureListWidget(QListWidget):
    """支持从资源管理器拖入文件路径的贴图列表"""
    def __init__(self, parent=None):
        super(TextureListWidget, self).__init__(parent)
        self.setAcceptDrops(True)
        self.setDragDropMode(QAbstractItemView.DropOnly)

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event):
        if not event.mimeData().hasUrls():
            return
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if not path:
                continue
            path = path.strip()
            if path and path not in [self.item(i).data(Qt.UserRole) for i in range(self.count())]:
                item = QListWidgetItem(os.path.basename(path))
                item.setData(Qt.UserRole, path)
                self.addItem(item)
        event.acceptProposedAction()


class TransferMapsWindow(QMainWindow):
    """数据：_texture_sets = [ {"name": "GunSet", "groups": [ {"low": str, "pairs": [ {"high": str, "textures": [path]} ]} ]}, ... ]，贴图集=共用一套贴图的命名"""
    def __init__(self, parent=None):
        super(TransferMapsWindow, self).__init__(parent)
        self.setWindowTitle(u"批量传递贴图")
        self.setMinimumSize(920, 560)
        self._texture_sets = []  # 贴图集列表，每个集只是一个命名，表示其下低模共用一套贴图
        self._current_set_index = -1
        self._current_low_index = -1
        self._current_high_index = -1
        self._updating_from_high = False  # 标记：当前是否由高模选择驱动低模联动，避免重复刷新贴图列表
        self._config = load_config()
        self._transfer_running = False
        self._transfer_cancel_requested = False
        self._transfer_jobs = []
        self._transfer_index = 0
        self._transfer_done_singles = 0
        self._transfer_total_singles = 0
        self._transfer_timer = QTimer(self)
        self._transfer_timer.setSingleShot(True)
        self._transfer_timer.timeout.connect(self._transfer_step)
        self._setup_ui()
        self._apply_config_to_ui()

    def _current_groups(self):
        """当前选中的贴图集下的 (低模,高模,贴图) 列表"""
        if self._current_set_index < 0 or self._current_set_index >= len(self._texture_sets):
            return []
        return self._texture_sets[self._current_set_index].get("groups", [])

    def _refresh_high_list(self):
        """根据当前贴图集，重建高模列表：展示该集内所有 (低模, 高模) 对。

        每一项的 Qt.UserRole 存储 (low_idx, pair_idx)，用于后续定位到具体 high 与 textures。
        """
        self.list_high.clear()
        groups = self._current_groups()
        for low_idx, g in enumerate(groups):
            for pair_idx, p in enumerate(g.get("pairs", [])):
                high = p.get("high") or ""
                high_name = high.split("|")[-1].split(":")[-1]
                item = QListWidgetItem(high_name)
                item.setData(Qt.UserRole, (low_idx, pair_idx))
                self.list_high.addItem(item)

    def _expanded_paths_for_high(self, high_transform, cached_textures=None):
        """获取高模贴图路径（UDIM 全部象限展开）。"""
        if not high_transform:
            return []
        try:
            from transfermaps.core.transfer_core import get_expanded_texture_paths_for_high
            return get_expanded_texture_paths_for_high(high_transform, cached_textures)
        except Exception:
            return list(cached_textures or [])

    def _refresh_texture_list(self):
        """根据当前贴图集内所有高模，展示全部贴图（UDIM 按象限展开显示）。"""
        self.list_textures.clear()
        groups = self._current_groups()
        if not groups:
            return
        seen = set()
        try:
            from transfermaps.core.transfer_core import texture_display_label
        except Exception:
            texture_display_label = os.path.basename
        for g in groups:
            for pair in g.get("pairs", []):
                high = pair.get("high")
                paths = self._expanded_paths_for_high(high, pair.get("textures"))
                for path in paths:
                    if not path:
                        continue
                    key = os.path.normpath(os.path.abspath(path))
                    if key in seen:
                        continue
                    seen.add(key)
                    item = QListWidgetItem(texture_display_label(path))
                    item.setData(Qt.UserRole, path)
                    item.setToolTip(path)
                    self.list_textures.addItem(item)
        self._highlight_textures_for_current_high()

    def _highlight_textures_for_current_high(self):
        """根据当前选中的高模，在贴图列表中高亮该高模的贴图。"""
        groups = self._current_groups()
        if self._current_low_index < 0 or self._current_high_index < 0 or self._current_low_index >= len(groups):
            self.list_textures.clearSelection()
            return
        g = groups[self._current_low_index]
        if self._current_high_index >= len(g.get("pairs", [])):
            self.list_textures.clearSelection()
            return
        tex_set = set()
        high = g["pairs"][self._current_high_index].get("high")
        cached = g["pairs"][self._current_high_index].get("textures", [])
        for path in self._expanded_paths_for_high(high, cached):
            if path:
                tex_set.add(os.path.normpath(os.path.abspath(path)))
        for i in range(self.list_textures.count()):
            item = self.list_textures.item(i)
            path = item.data(Qt.UserRole)
            key = os.path.normpath(os.path.abspath(path)) if path else ""
            item.setSelected(key in tex_set)

    def _on_texture_selected(self, item):
        """单击某个贴图时，高亮所有使用到该贴图的高模（类似「反向链接」）。"""
        if not item:
            return
        path = item.data(Qt.UserRole)
        if not path:
            return
        key = os.path.normpath(os.path.abspath(path))
        groups = self._current_groups()
        # 遍历高模列表，根据每个高模的 textures 是否包含该贴图来决定是否选中
        for i in range(self.list_high.count()):
            hi = self.list_high.item(i)
            data = hi.data(Qt.UserRole)
            if not data or not isinstance(data, tuple) or len(data) < 2:
                hi.setSelected(False)
                continue
            low_idx, pair_idx = data
            if low_idx < 0 or low_idx >= len(groups):
                hi.setSelected(False)
                continue
            g = groups[low_idx]
            if pair_idx < 0 or pair_idx >= len(g.get("pairs", [])):
                hi.setSelected(False)
                continue
            tex_paths = self._expanded_paths_for_high(
                g["pairs"][pair_idx].get("high"),
                g["pairs"][pair_idx].get("textures", []),
            )
            has_tex = False
            for p in tex_paths:
                if not p:
                    continue
                if os.path.normpath(os.path.abspath(p)) == key:
                    has_tex = True
                    break
            hi.setSelected(has_tex)

    def _setup_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(8, 8, 8, 8)

        # ----- 四列：贴图集 | 低模 | 高模 | 贴图（贴图集=命名，表示这些低模共用一套贴图） -----
        grp_lists = QGroupBox(u"贴图集 → 低模 → 高模 → 贴图（贴图集仅命名：该集内多个低模共用一套贴图，传递全部类型）")
        layout_lists = QHBoxLayout(grp_lists)

        # 贴图集（命名：这套低模共用一套贴图）
        col_set = QVBoxLayout()
        col_set.addWidget(QLabel(u"贴图集"))
        self.list_sets = QListWidget()
        self.list_sets.setMinimumWidth(100)
        self.list_sets.setMinimumHeight(220)
        self.list_sets.setSelectionMode(QAbstractItemView.SingleSelection)
        self.list_sets.currentRowChanged.connect(self._on_set_selected)
        col_set.addWidget(self.list_sets, 1)
        row_btn_set = QHBoxLayout()
        self.btn_add_set = QPushButton(u"添加")
        self.btn_add_set.setToolTip(u"添加贴图集并命名（如 GunSet、角色A），表示这些低模共用一套贴图")
        self.btn_add_set.clicked.connect(self._add_set)
        self.btn_remove_set = QPushButton(u"移除")
        self.btn_remove_set.clicked.connect(self._remove_set)
        row_btn_set.addWidget(self.btn_add_set)
        row_btn_set.addWidget(self.btn_remove_set)
        col_set.addLayout(row_btn_set)
        layout_lists.addLayout(col_set)

        # 低模
        col_low = QVBoxLayout()
        col_low.addWidget(QLabel(u"低模（目标）"))
        self.list_low = QListWidget()
        self.list_low.setMinimumWidth(160)
        self.list_low.setMinimumHeight(220)
        self.list_low.setSelectionMode(QAbstractItemView.SingleSelection)
        self.list_low.currentRowChanged.connect(self._on_low_selected)
        self.list_low.itemDoubleClicked.connect(self._on_low_double_clicked)
        col_low.addWidget(self.list_low, 1)
        row_btn_low = QHBoxLayout()
        self.btn_add_low = QPushButton(u"添加选定对象")
        self.btn_add_low.clicked.connect(self._add_low_from_selection)
        self.btn_remove_low = QPushButton(u"移除选定")
        self.btn_remove_low.clicked.connect(self._remove_low)
        self.btn_clear_low = QPushButton(u"清除全部")
        self.btn_clear_low.clicked.connect(self._clear_lows)
        row_btn_low.addWidget(self.btn_add_low)
        row_btn_low.addWidget(self.btn_remove_low)
        row_btn_low.addWidget(self.btn_clear_low)
        col_low.addLayout(row_btn_low)
        layout_lists.addLayout(col_low)

        # 中：高模
        col_high = QVBoxLayout()
        col_high.addWidget(QLabel(u"高模（源）"))
        self.list_high = QListWidget()
        self.list_high.setMinimumWidth(160)
        self.list_high.setMinimumHeight(220)
        # 允许一次高亮多个高模以表示与当前低模的链接关系
        self.list_high.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.list_high.currentRowChanged.connect(self._on_high_selected)
        self.list_high.itemDoubleClicked.connect(self._on_high_double_clicked)
        col_high.addWidget(self.list_high, 1)
        row_btn_high = QHBoxLayout()
        self.btn_add_high = QPushButton(u"添加选定对象")
        self.btn_add_high.clicked.connect(self._add_high_from_selection)
        self.btn_remove_high = QPushButton(u"移除选定")
        self.btn_remove_high.clicked.connect(self._remove_high)
        self.btn_clear_high = QPushButton(u"清除全部")
        self.btn_clear_high.clicked.connect(self._clear_highs)
        row_btn_high.addWidget(self.btn_add_high)
        row_btn_high.addWidget(self.btn_remove_high)
        row_btn_high.addWidget(self.btn_clear_high)
        col_high.addLayout(row_btn_high)
        layout_lists.addLayout(col_high)

        # 右：贴图
        col_tex = QVBoxLayout()
        col_tex.addWidget(QLabel(u"贴图列表（当前贴图集内所有高模的贴图；选高模高亮其贴图，选贴图高亮对应高模）"))
        # 贴图列表仅作预览，不再支持拖入/手动添加，因此用普通 QListWidget
        self.list_textures = QListWidget()
        self.list_textures.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.list_textures.setMinimumWidth(220)
        self.list_textures.setMinimumHeight(220)
        self.list_textures.itemClicked.connect(self._on_texture_selected)
        self.list_textures.itemDoubleClicked.connect(self._on_texture_double_clicked)
        col_tex.addWidget(self.list_textures, 1)
        # 贴图列表无需按钮：根据当前选中高模自动扫描并展示
        layout_lists.addLayout(col_tex)

        main_layout.addWidget(grp_lists)

        # ----- Maya 公用输出 -----
        grp_common = QGroupBox(u"Maya 公用输出")
        form = QFormLayout(grp_common)
        row_res = QHBoxLayout()
        self.cb_width = QComboBox()
        self.cb_height = QComboBox()
        for size in MAP_SIZE_PRESETS:
            self.cb_width.addItem(str(size), size)
            self.cb_height.addItem(str(size), size)
        self.cb_width.setCurrentIndex(MAP_SIZE_PRESETS.index(256))  # 默认 256
        self.cb_height.setCurrentIndex(MAP_SIZE_PRESETS.index(256))
        self.cb_width.currentIndexChanged.connect(self._on_width_or_height_changed)
        self.cb_height.currentIndexChanged.connect(self._on_width_or_height_changed)
        row_res.addWidget(QLabel(u"宽度:"))
        row_res.addWidget(self.cb_width)
        row_res.addWidget(QLabel(u"高度:"))
        row_res.addWidget(self.cb_height)
        row_res.addStretch()
        form.addRow(u"贴图尺寸:", row_res)
        self.cb_keep_aspect = QCheckBox(u"保持纵横比")
        self.cb_keep_aspect.setChecked(True)
        form.addRow("", self.cb_keep_aspect)
        self.cb_transfer_in = QComboBox()
        self.cb_transfer_in.addItem(u"世界空间", "world")
        self.cb_transfer_in.addItem(u"对象空间", "object")
        form.addRow(u"传入:", self.cb_transfer_in)
        self.cb_sample_quality = QComboBox()
        self.cb_sample_quality.addItem(u"低(2x2)", "low")
        self.cb_sample_quality.addItem(u"中(3x3)", "medium")
        self.cb_sample_quality.addItem(u"高(4x4)", "high")
        self.cb_sample_quality.setToolTip(u"若传递结果有小点点/破面，可改为「中」或「高」")
        form.addRow(u"采样质量:", self.cb_sample_quality)
        row_filter = QHBoxLayout()
        self.spin_filter_size = QDoubleSpinBox()
        self.spin_filter_size.setRange(0.1, 20.0)
        self.spin_filter_size.setValue(5.0)
        self.spin_filter_size.setToolTip(u"若传递结果有小点点/破面，可适当增大（如 5～8）")
        self.cb_filter_type = QComboBox()
        self.cb_filter_type.addItem(u"高斯", "gaussian")
        self.cb_filter_type.addItem(u"方形", "box")
        self.cb_filter_type.addItem(u"三角形", "triangle")
        self.cb_filter_type.addItem(u"二次", "quadratic")
        row_filter.addWidget(self.spin_filter_size)
        row_filter.addWidget(QLabel(u" 类型:"))
        row_filter.addWidget(self.cb_filter_type)
        row_filter.addStretch()
        form.addRow(u"过滤器大小:", row_filter)
        # 包裹距离 / 最大搜索距离：用于限制射线搜索范围，避免打到模型「另一侧」导致小点点/破面
        self.spin_max_search_distance = QDoubleSpinBox()
        self.spin_max_search_distance.setRange(0.0, 1000000.0)
        self.spin_max_search_distance.setDecimals(3)
        self.spin_max_search_distance.setSingleStep(0.1)
        self.spin_max_search_distance.setToolTip(
            u"0 = 不限制；若贴图上出现来自模型另一侧的小点点/破面，可设置为约等于模型半径的数值"
        )
        form.addRow(u"最大搜索距离(包裹距离):", self.spin_max_search_distance)
        self.spin_fill_seams = QSpinBox()
        self.spin_fill_seams.setRange(0, 20)
        self.spin_fill_seams.setValue(1)
        form.addRow(u"填充纹理接缝:", self.spin_fill_seams)
        self.cb_ignore_mirrored = QCheckBox(u"忽略镜像面")
        form.addRow("", self.cb_ignore_mirrored)
        row_flip = QHBoxLayout()
        self.cb_flip_u = QCheckBox(u"翻转 U")
        self.cb_flip_v = QCheckBox(u"翻转 V")
        row_flip.addWidget(self.cb_flip_u)
        row_flip.addWidget(self.cb_flip_v)
        row_flip.addStretch()
        form.addRow("", row_flip)
        row_out = QHBoxLayout()
        self.le_output_dir = QLineEdit()
        self.le_output_dir.setPlaceholderText(u"输出目录（空则使用场景目录或临时）")
        self.btn_browse_output = QPushButton(u"...")
        self.btn_browse_output.setFixedWidth(36)
        self.btn_browse_output.clicked.connect(self._browse_output_dir)
        row_out.addWidget(self.le_output_dir)
        row_out.addWidget(self.btn_browse_output)
        form.addRow(u"输出目录:", row_out)
        # 是否按贴图集将多低模的贴图按 UV 叠合为一套
        self.cb_merge_to_single = QCheckBox(u"同一贴图集内多低模：按 UV 叠合为一套贴图（实验功能）")
        form.addRow("", self.cb_merge_to_single)
        main_layout.addWidget(grp_common)

        self.log_text = QPlainTextEdit()
        self.log_text.setMaximumHeight(80)
        self.log_text.setPlaceholderText(u"运行日志")
        main_layout.addWidget(self.log_text)

        # ----- 底部按钮 -----
        row_bottom = QHBoxLayout()
        self.btn_transfer = QPushButton(u"传递")
        self.btn_transfer.setStyleSheet("background-color: #2d5a27; color: white; font-weight: bold;")
        self.btn_transfer.clicked.connect(self._do_transfer)
        self.btn_cancel_transfer = QPushButton(u"取消整批")
        self.btn_cancel_transfer.setStyleSheet("background-color: #8b2e2e; color: white; font-weight: bold;")
        self.btn_cancel_transfer.clicked.connect(self._request_transfer_cancel)
        self.btn_cancel_transfer.setVisible(False)
        self.btn_close = QPushButton(u"关闭")
        self.btn_close.clicked.connect(self.close)
        row_bottom.addWidget(self.btn_transfer)
        row_bottom.addWidget(self.btn_cancel_transfer)
        row_bottom.addWidget(self.btn_close)
        row_bottom.addStretch()
        main_layout.addLayout(row_bottom)

        self._syncing_size = False  # 防止保持纵横比时循环联动

    def _on_width_or_height_changed(self):
        if self._syncing_size or not self.cb_keep_aspect.isChecked():
            return
        self._syncing_size = True
        try:
            sender = self.sender()
            if sender == self.cb_width:
                idx = self.cb_width.currentIndex()
                self.cb_height.setCurrentIndex(min(idx, self.cb_height.count() - 1))
            else:
                idx = self.cb_height.currentIndex()
                self.cb_width.setCurrentIndex(min(idx, self.cb_width.count() - 1))
        finally:
            self._syncing_size = False

    def _apply_config_to_ui(self):
        c = self._config
        w = int(c.get("map_width", 256))
        h = int(c.get("map_height", 256))
        if w not in MAP_SIZE_PRESETS:
            w = 256
        if h not in MAP_SIZE_PRESETS:
            h = 256
        iw = MAP_SIZE_PRESETS.index(w)
        ih = MAP_SIZE_PRESETS.index(h)
        self._syncing_size = True
        try:
            self.cb_width.setCurrentIndex(min(iw, self.cb_width.count() - 1))
            self.cb_height.setCurrentIndex(min(ih, self.cb_height.count() - 1))
        finally:
            self._syncing_size = False
        self.cb_keep_aspect.setChecked(bool(c.get("keep_aspect_ratio", True)))
        idx = self.cb_transfer_in.findData(c.get("transfer_in", "world"))
        if idx >= 0:
            self.cb_transfer_in.setCurrentIndex(idx)
        idx = self.cb_sample_quality.findData(c.get("sample_quality", "medium"))
        if idx >= 0:
            self.cb_sample_quality.setCurrentIndex(idx)
        self.spin_filter_size.setValue(float(c.get("filter_size", 5.0)))
        idx = self.cb_filter_type.findData(c.get("filter_type", "gaussian"))
        if idx >= 0:
            self.cb_filter_type.setCurrentIndex(idx)
        self.spin_fill_seams.setValue(int(c.get("fill_texture_seams", 1)))
        self.spin_max_search_distance.setValue(float(c.get("max_search_distance", 0.0)))
        self.cb_ignore_mirrored.setChecked(bool(c.get("ignore_mirrored_faces", False)))
        self.cb_flip_u.setChecked(bool(c.get("flip_u", False)))
        self.cb_flip_v.setChecked(bool(c.get("flip_v", False)))
        self.le_output_dir.setText(_t(c.get("output_dir", "")))
        self.cb_merge_to_single.setChecked(bool(c.get("merge_to_single", False)))

    def _combo_data(self, combo, default):
        """兼容 PySide/PySide2：取当前项 data"""
        try:
            if hasattr(combo, "currentData") and callable(getattr(combo, "currentData")):
                v = combo.currentData()
            else:
                v = combo.itemData(combo.currentIndex())
            return v if v is not None else default
        except Exception:
            return default

    def _save_common_config(self):
        self._config["map_width"] = self._combo_data(self.cb_width, 256)
        self._config["map_height"] = self._combo_data(self.cb_height, 256)
        self._config["keep_aspect_ratio"] = self.cb_keep_aspect.isChecked()
        self._config["transfer_in"] = self._combo_data(self.cb_transfer_in, "world")
        self._config["sample_quality"] = self._combo_data(self.cb_sample_quality, "medium")
        self._config["filter_size"] = self.spin_filter_size.value()
        self._config["filter_type"] = self._combo_data(self.cb_filter_type, "gaussian")
        self._config["fill_texture_seams"] = self.spin_fill_seams.value()
        self._config["max_search_distance"] = self.spin_max_search_distance.value()
        self._config["ignore_mirrored_faces"] = self.cb_ignore_mirrored.isChecked()
        self._config["flip_u"] = self.cb_flip_u.isChecked()
        self._config["flip_v"] = self.cb_flip_v.isChecked()
        self._config["output_dir"] = self.le_output_dir.text().strip()
        self._config["merge_to_single"] = self.cb_merge_to_single.isChecked()
        save_config(self._config)

    def _browse_output_dir(self):
        path = QFileDialog.getExistingDirectory(self, u"选择输出目录", self.le_output_dir.text() or "")
        if path:
            self.le_output_dir.setText(path)
            self._save_common_config()

    def _on_set_selected(self, row):
        self._current_set_index = row
        self._current_low_index = -1
        self._current_high_index = -1
        self.list_low.clear()
        self.list_high.clear()
        self.list_textures.clear()
        if row < 0 or row >= len(self._texture_sets):
            return
        groups = self._current_groups()
        for g in groups:
            name = (g.get("low") or "").split("|")[-1].split(":")[-1]
            item = QListWidgetItem(name)
            item.setData(Qt.UserRole, g.get("low"))
            self.list_low.addItem(item)
        # 贴图集选定后，高模列表展示该集内所有高模，贴图列表展示该集内所有高模的贴图
        self._refresh_high_list()
        self._refresh_texture_list()

    def _add_set(self):
        name, ok = QInputDialog.getText(self, u"贴图集", u"贴图集名称（如 GunSet、角色A），表示这些低模共用一套贴图：", text=u"Set1")
        if not ok or not (name or "").strip():
            return
        name = name.strip()
        for ts in self._texture_sets:
            if (ts.get("name") or "") == name:
                self._log(u"已存在同名贴图集: %s" % name)
                return
        self._texture_sets.append({"name": name, "groups": []})
        self.list_sets.addItem(QListWidgetItem(name))
        self.list_sets.setCurrentRow(len(self._texture_sets) - 1)

    def _remove_set(self):
        row = self.list_sets.currentRow()
        if row < 0 or row >= len(self._texture_sets):
            return
        self._texture_sets.pop(row)
        self.list_sets.takeItem(row)
        self._current_set_index = min(row, len(self._texture_sets) - 1)
        if self._current_set_index >= 0:
            self.list_sets.setCurrentRow(self._current_set_index)
        self._on_set_selected(self._current_set_index)

    def _get_selected_mesh_transforms(self):
        """从当前选区解析出带 mesh 的 transform 节点（视口选中多为 transform，不是 shape）"""
        try:
            import maya.cmds as cmds
            sel = cmds.ls(selection=True, long=True) or []
            transforms = set()
            for node in sel:
                if not node:
                    continue
                try:
                    nt = cmds.nodeType(node)
                except Exception:
                    continue
                if nt == "mesh":
                    parents = cmds.listRelatives(node, parent=True, fullPath=True)
                    if parents:
                        transforms.add(parents[0])
                elif nt == "transform":
                    shapes = cmds.listRelatives(node, shapes=True, noIntermediate=True, fullPath=True) or []
                    for s in shapes:
                        if cmds.nodeType(s) == "mesh":
                            transforms.add(node)
                            break
            return sorted(transforms)
        except Exception:
            return []

    def _add_low_from_selection(self):
        if self._current_set_index < 0 or self._current_set_index >= len(self._texture_sets):
            self._log(u"请先选择或添加一个贴图集")
            return
        try:
            import maya.cmds as cmds
            transforms = self._get_selected_mesh_transforms()
            if not transforms:
                self._log(u"请在视口中选中至少一个带网格的物体（选 transform 或 shape 均可）")
                return
            groups = self._texture_sets[self._current_set_index]["groups"]
            for t in transforms:
                name = t.split("|")[-1].split(":")[-1]
                if any(g["low"] == t for g in groups):
                    continue
                groups.append({"low": t, "pairs": []})
            # 低模列表与高模列表都需要整体刷新
            self._on_set_selected(self._current_set_index)
        except Exception as e:
            self._log(str(e))

    def _remove_low(self):
        row = self.list_low.currentRow()
        groups = self._current_groups()
        if row < 0 or row >= len(groups):
            return
        groups.pop(row)
        # 重新根据贴图集刷新低模 / 高模列表
        self._on_set_selected(self._current_set_index)

    def _clear_lows(self):
        if self._current_set_index >= 0 and self._current_set_index < len(self._texture_sets):
            self._texture_sets[self._current_set_index]["groups"] = []
        self._on_set_selected(self._current_set_index)

    def _on_low_selected(self, row):
        # 若是由高模选择联动触发，则只更新当前低模索引，不清空贴图列表，避免重复刷新
        if getattr(self, "_updating_from_high", False):
            self._current_low_index = row
            return
        self._current_low_index = row
        self._current_high_index = -1
        groups = self._current_groups()
        if row < 0 or row >= len(groups):
            self.list_high.clearSelection()
            self._refresh_texture_list()
            return
        # 高亮所有与该低模链接的高模项
        for i in range(self.list_high.count()):
            item = self.list_high.item(i)
            data = item.data(Qt.UserRole)
            if not data or not isinstance(data, tuple) or len(data) < 2:
                item.setSelected(False)
                continue
            low_idx, pair_idx = data[0], data[1]
            item.setSelected(low_idx == row)
        # 选中低模后，贴图列表显示该低模下所有高模的贴图合集（此时不高亮任何高模）
        self._refresh_texture_list()

    def _add_high_from_selection(self):
        groups = self._current_groups()
        if self._current_low_index < 0 or self._current_low_index >= len(groups):
            self._log(u"请先选择左侧一个低模")
            return
        try:
            transforms = self._get_selected_mesh_transforms()
            if not transforms:
                self._log(u"请在视口中选中至少一个带网格的物体（选 transform 或 shape 均可）")
                return
            g = groups[self._current_low_index]
            added_indices = []
            for t in transforms:
                if any(p["high"] == t for p in g["pairs"]):
                    continue
                g["pairs"].append({"high": t, "textures": []})
                added_indices.append(len(g["pairs"]) - 1)
            # 为新添加的高模自动扫描材质贴图，使贴图列表立即包含新高模的贴图
            try:
                from transfermaps.core.transfer_core import get_expanded_texture_paths_for_high
                for pair_idx in added_indices:
                    high_transform = g["pairs"][pair_idx]["high"]
                    expanded = get_expanded_texture_paths_for_high(high_transform)
                    if expanded:
                        g["pairs"][pair_idx]["textures"] = expanded
            except Exception:
                pass
            # 重新构建高模列表并刷新贴图列表（_on_low_selected 会调用 _refresh_texture_list）
            self._refresh_high_list()
            self._on_low_selected(self._current_low_index)
        except Exception as e:
            self._log(str(e))

    def _remove_high(self):
        row = self.list_high.currentRow()
        if row < 0:
            return
        groups = self._current_groups()
        item = self.list_high.item(row)
        data = item.data(Qt.UserRole)
        if not data or not isinstance(data, tuple) or len(data) < 2:
            return
        low_idx, pair_idx = data[0], data[1]
        if low_idx < 0 or low_idx >= len(groups):
            return
        g = groups[low_idx]
        if pair_idx < 0 or pair_idx >= len(g["pairs"]):
            return
        g["pairs"].pop(pair_idx)
        self._current_high_index = -1
        # 重新刷新高模列表，保持当前贴图集/低模视图一致
        self._refresh_high_list()
        if self._current_low_index == low_idx:
            self._on_low_selected(self._current_low_index)

    def _clear_highs(self):
        groups = self._current_groups()
        if self._current_low_index >= 0 and self._current_low_index < len(groups):
            groups[self._current_low_index]["pairs"] = []
        self._current_high_index = -1
        self._refresh_high_list()
        self._refresh_texture_list()

    def _on_high_selected(self, row):
        groups = self._current_groups()
        if row < 0 or row >= self.list_high.count():
            self._current_high_index = -1
            return
        item = self.list_high.item(row)
        data = item.data(Qt.UserRole)
        if not data or not isinstance(data, tuple) or len(data) < 2:
            self._current_high_index = -1
            return
        low_idx, pair_idx = data[0], data[1]
        if low_idx < 0 or low_idx >= len(groups):
            self._current_high_index = -1
            return
        g = groups[low_idx]
        if pair_idx < 0 or pair_idx >= len(g["pairs"]):
            self._current_high_index = -1
            return
        # 更新当前 low/high 索引，并让对应低模高亮（类似灯光链接）
        self._current_low_index = low_idx
        self._current_high_index = pair_idx
        try:
            self._updating_from_high = True
            self.list_low.setCurrentRow(low_idx)
        finally:
            self._updating_from_high = False
        # 若该高模尚未有贴图缓存，或仍含未展开的 UDIM 模板路径，则自动扫描
        tex_list = g["pairs"][pair_idx].get("textures") or []
        needs_scan = not tex_list
        if tex_list:
            try:
                from transfermaps.core.transfer_core import _is_udim_template
                needs_scan = any(_is_udim_template(p) for p in tex_list)
            except Exception:
                pass
        if needs_scan:
            self._scan_high_textures()
        # 贴图列表展示当前低模下所有高模的贴图合集，同时高亮当前高模使用到的贴图
        self._refresh_texture_list()

    def _on_low_double_clicked(self, item):
        """双击低模列表项：在视口中选中该模型"""
        if not item:
            return
        transform = item.data(Qt.UserRole)
        if not transform:
            return
        try:
            import maya.cmds as cmds
            if cmds.objExists(transform):
                cmds.select(transform, replace=True)
        except Exception:
            pass

    def _on_high_double_clicked(self, item):
        """双击高模列表项：在视口中选中该模型"""
        if not item:
            return
        data = item.data(Qt.UserRole)
        if not data or not isinstance(data, tuple) or len(data) < 2:
            return
        low_idx, pair_idx = data[0], data[1]
        groups = self._current_groups()
        if low_idx < 0 or low_idx >= len(groups):
            return
        g = groups[low_idx]
        if pair_idx < 0 or pair_idx >= len(g["pairs"]):
            return
        transform = g["pairs"][pair_idx]["high"]
        try:
            import maya.cmds as cmds
            if cmds.objExists(transform):
                cmds.select(transform, replace=True)
        except Exception:
            pass

    def _on_texture_double_clicked(self, item):
        """双击贴图列表项：弹出预览图"""
        if not item:
            return
        path = item.data(Qt.UserRole)
        if not path or not os.path.isfile(path):
            return
        pix = QPixmap(path)
        if pix.isNull():
            self._log(u"无法预览该贴图: %s" % path)
            return
        max_preview = 512
        if pix.width() > max_preview or pix.height() > max_preview:
            pix = pix.scaled(max_preview, max_preview, Qt.KeepAspectRatio, Qt.SmoothTransformation)
        dlg = QDialog(self)
        dlg.setWindowTitle(os.path.basename(path))
        layout = QVBoxLayout(dlg)
        lbl = QLabel()
        lbl.setPixmap(pix)
        layout.addWidget(lbl)
        btn = QPushButton(u"关闭")
        btn.clicked.connect(dlg.accept)
        layout.addWidget(btn)
        dlg.exec_()

    def _scan_high_textures(self):
        """仅扫描当前选中的高模，用该高模的贴图替换其自己的贴图列表（不合并到统一列表）；每个高模单独显示、单独传递。

        本函数不再由按钮触发，而是在选中高模时自动调用（若该高模尚未缓存贴图）。
        """
        groups = self._current_groups()
        low_idx = self._current_low_index
        high_idx = self._current_high_index
        if low_idx < 0 or high_idx < 0:
            self._log(u"请先选择左侧低模和中间高模")
            return
        if low_idx >= len(groups) or high_idx >= len(groups[low_idx]["pairs"]):
            return
        high_transform = groups[low_idx]["pairs"][high_idx]["high"]
        try:
            from transfermaps.core.transfer_core import (
                get_expanded_texture_paths_for_high,
                _udim_from_resolved_path,
            )
            expanded = get_expanded_texture_paths_for_high(high_transform)
        except Exception as e:
            self._log(u"扫描失败: %s" % str(e))
            return
        if not expanded:
            self._log(u"该高模未找到已连接的贴图文件")
            return
        g = groups[low_idx]
        high_entry = g["pairs"][high_idx]
        high_entry["textures"] = expanded
        high_name = high_transform.split("|")[-1].split(":")[-1]
        udim_nums = sorted(set(
            _udim_from_resolved_path(p) for p in expanded if _udim_from_resolved_path(p)
        ))
        if udim_nums:
            self._log(
                u"已为高模「%s」找到 %d 张贴图（UDIM %s，按磁盘文件命名）"
                % (high_name, len(expanded), ", ".join(str(t) for t in udim_nums))
            )
        else:
            self._log(u"已为高模「%s」找到 %d 张贴图" % (high_name, len(expanded)))
        self._refresh_texture_list()

    def _add_texture_browse(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, u"选择贴图文件",
            "",
            u"图像 (*.png *.jpg *.jpeg *.tga *.tif *.tiff *.exr *.bmp);;所有 (*.*)"
        )
        if not paths:
            return
        self._add_texture_paths(paths)

    def _add_texture_paths(self, paths):
        groups = self._current_groups()
        low_idx = self._current_low_index
        high_idx = self._current_high_index
        if low_idx < 0 or high_idx < 0:
            self._log(u"请先选择左侧低模和中间高模")
            return
        if low_idx >= len(groups) or high_idx >= len(groups[low_idx]["pairs"]):
            return
        g = groups[low_idx]
        existing = set(g["pairs"][high_idx]["textures"])
        for path in paths:
            path = path.strip()
            if path and path not in existing:
                existing.add(path)
                g["pairs"][high_idx]["textures"].append(path)
                item = QListWidgetItem(os.path.basename(path))
                item.setData(Qt.UserRole, path)
                self.list_textures.addItem(item)

    def _remove_texture(self):
        row = self.list_textures.currentRow()
        groups = self._current_groups()
        low_idx = self._current_low_index
        high_idx = self._current_high_index
        if row < 0 or low_idx < 0 or high_idx < 0:
            return
        if low_idx >= len(groups) or high_idx >= len(groups[low_idx]["pairs"]):
            return
        g = groups[low_idx]
        path = self.list_textures.item(row).data(Qt.UserRole)
        if path in g["pairs"][high_idx]["textures"]:
            g["pairs"][high_idx]["textures"].remove(path)
        self.list_textures.takeItem(row)

    def _clear_textures(self):
        groups = self._current_groups()
        low_idx = self._current_low_index
        high_idx = self._current_high_index
        if low_idx >= 0 and high_idx >= 0 and low_idx < len(groups):
            g = groups[low_idx]
            if high_idx < len(g["pairs"]):
                g["pairs"][high_idx]["textures"] = []
        self.list_textures.clear()

    def _sync_textures_from_list_to_data(self):
        """从右侧贴图列表同步回「当前记录的」低模/高模对应的 textures（用于切换前保存）。
        必须用 _current_low_index / _current_high_index，不能用 list 的 currentRow()：
        切换高模时信号触发后 list_high.currentRow() 已是新行，用它会误把列表内容写入新高模导致贴图错乱或消失。"""
        groups = self._current_groups()
        if self._current_low_index < 0 or self._current_high_index < 0 or self._current_low_index >= len(groups):
            return
        g = groups[self._current_low_index]
        # 防止 -1 等负索引误写入最后一个 high
        if self._current_high_index < 0 or self._current_high_index >= len(g["pairs"]):
            return
        paths = []
        for i in range(self.list_textures.count()):
            item = self.list_textures.item(i)
            if item and item.data(Qt.UserRole):
                paths.append(item.data(Qt.UserRole))
        g["pairs"][self._current_high_index]["textures"] = paths

    def _set_transfer_ui_busy(self, busy):
        self.btn_transfer.setEnabled(not busy)
        self.btn_cancel_transfer.setVisible(busy)
        self.btn_cancel_transfer.setEnabled(busy)
        for w in (
            self.btn_add_set, self.btn_remove_set,
            self.btn_add_low, self.btn_remove_low, self.btn_clear_low,
            self.btn_add_high, self.btn_remove_high, self.btn_clear_high,
            self.btn_browse_output,
        ):
            w.setEnabled(not busy)

    def _update_transfer_title(self, status=None):
        if not self._transfer_running:
            self.setWindowTitle(u"批量传递贴图")
            return
        if self._transfer_total_singles > 0:
            title = u"批量传递贴图 (%d/%d)" % (
                self._transfer_done_singles, self._transfer_total_singles,
            )
        else:
            title = u"批量传递贴图"
        if status:
            title = u"%s — %s" % (title, status)
        self.setWindowTitle(title)

    def _pump_transfer_ui(self):
        app = QApplication.instance()
        if app:
            app.processEvents()

    def _is_transfer_cancelled(self):
        return self._transfer_cancel_requested

    def _request_transfer_cancel(self):
        if self._transfer_cancel_requested:
            return
        self._transfer_cancel_requested = True
        self.btn_cancel_transfer.setEnabled(False)
        self._update_transfer_title(u"正在取消…")
        if self._transfer_jobs is not None:
            remaining = max(0, len(self._transfer_jobs) - self._transfer_index)
            self._transfer_jobs = self._transfer_jobs[: self._transfer_index]
            if remaining > 0:
                self._log(u"已取消整批传递：剩余 %d 项将全部跳过" % remaining)

    def _job_status_text(self, job):
        if not job:
            return u"处理中…"
        jtype = job.get("type")
        if jtype == "single":
            udim = job.get("udim_tile")
            udim_s = u" UDIM %d" % int(udim) if udim else u""
            name = os.path.basename(job.get("tex_path") or u"")
            return u"正在传递 %s%s …" % (name, udim_s)
        if jtype == "merge":
            return u"正在合并通道: %s" % os.path.basename(job.get("output_path") or u"")
        if jtype == "assemble":
            return u"正在组装材质: %s" % (job.get("set_name") or u"")
        if jtype == "log":
            return job.get("message") or u""
        return u"处理中…"

    def _schedule_transfer_step(self):
        self._pump_transfer_ui()
        try:
            import maya.utils as maya_utils
            maya_utils.executeDeferred(self._transfer_step)
        except Exception:
            self._transfer_timer.start(0)

    def _log(self, msg):
        try:
            if hasattr(self, "log_text"):
                self.log_text.appendPlainText(_t(msg))
        except Exception:
            pass

    def _do_transfer(self):
        if self._transfer_running:
            return
        self._save_common_config()
        self._transfer_cancel_requested = False
        self._transfer_running = True
        self._transfer_jobs = None
        self._transfer_index = 0
        self._transfer_done_singles = 0
        self._transfer_total_singles = 0
        self._set_transfer_ui_busy(True)
        self._update_transfer_title(u"正在启动…")
        self._schedule_transfer_step()

    def _transfer_step(self):
        self._pump_transfer_ui()
        if self._is_transfer_cancelled():
            self._finish_transfer(cancelled=True)
            return

        # 阶段 1：延迟构建任务列表（避免点击「传递」后立刻卡死）
        if self._transfer_jobs is None:
            self._update_transfer_title(u"正在分析任务…")
            try:
                from transfermaps.core.transfer_core import build_all_transfer_jobs
                self._transfer_jobs = build_all_transfer_jobs(
                    self._texture_sets,
                    self._config,
                    log_fn=self._log,
                    event_pump=self._pump_transfer_ui,
                )
            except Exception as e:
                import traceback
                self._log(_t(str(e)))
                traceback.print_exc()
                self._finish_transfer(cancelled=True)
                return
            if self._is_transfer_cancelled():
                self._finish_transfer(cancelled=True)
                return
            if not self._transfer_jobs:
                self._log(u"没有可传递的任务，请先配置贴图集、低模与高模")
                self._finish_transfer(cancelled=True)
                return
            self._transfer_total_singles = sum(
                1 for j in self._transfer_jobs if j.get("type") == "single"
            )
            self._update_transfer_title()
            self._log(
                u"开始整批传递（共 %d 张贴图）；可点「取消整批」中止"
                % self._transfer_total_singles
            )
            self._schedule_transfer_step()
            return

        if self._transfer_index >= len(self._transfer_jobs):
            self._finish_transfer(cancelled=False)
            return

        job = self._transfer_jobs[self._transfer_index]
        self._update_transfer_title(self._job_status_text(job))

        if self._is_transfer_cancelled():
            self._finish_transfer(cancelled=True)
            return

        try:
            from transfermaps.core.transfer_core import execute_transfer_job
            result = execute_transfer_job(
                job,
                self._log,
                cancel_check=self._is_transfer_cancelled,
            )
        except Exception as e:
            import traceback
            self._log(_t(str(e)))
            traceback.print_exc()
            self._finish_transfer(cancelled=True)
            return

        self._transfer_index += 1
        if self._is_transfer_cancelled() or result == "cancelled":
            self._finish_transfer(cancelled=True)
            return
        if job.get("type") == "single" and result == "ok":
            self._transfer_done_singles += 1
            self._update_transfer_title()
        self._schedule_transfer_step()

    def _finish_transfer(self, cancelled=False):
        self._transfer_timer.stop()
        self._transfer_running = False
        self._transfer_cancel_requested = False
        self._transfer_jobs = None
        self._set_transfer_ui_busy(False)
        self.setWindowTitle(u"批量传递贴图")
        if cancelled:
            self._log(
                u"整批传递已取消：已完成 %d/%d 张贴图。"
                % (self._transfer_done_singles, max(self._transfer_total_singles, 1))
            )
        else:
            self._log(u"整批传递完成，共 %d 张贴图。" % self._transfer_done_singles)

    def closeEvent(self, event):
        if self._transfer_running:
            self._request_transfer_cancel()
            self._transfer_timer.stop()
            self._finish_transfer(cancelled=True)
        super(TransferMapsWindow, self).closeEvent(event)
