# -*- coding: utf-8 -*-
"""Qt 导入，兼容 Maya 2018 (PySide) 与 2022+ (PySide2)，与 QuickRender 一致"""

import sys

try:
    from PySide.QtWidgets import *
    from PySide.QtGui import *
    from PySide.QtCore import *
    from PySide.QtWidgets import QComboBox, QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView, QListWidget, QListWidgetItem, QSpinBox, QDoubleSpinBox, QCheckBox, QSlider, QFileDialog, QScrollArea, QFrame, QSplitter, QGroupBox, QFormLayout
    QT_BINDING = "PySide"
except ImportError:
    try:
        from PySide2.QtWidgets import *
        from PySide2.QtGui import *
        from PySide2.QtCore import *
        from PySide2.QtWidgets import QComboBox, QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView, QListWidget, QListWidgetItem, QSpinBox, QDoubleSpinBox, QCheckBox, QSlider, QFileDialog, QScrollArea, QFrame, QSplitter, QGroupBox, QFormLayout
        QT_BINDING = "PySide2"
    except ImportError:
        from PySide2.QtWidgets import *
        from PySide2.QtGui import *
        from PySide2.QtCore import *
        QT_BINDING = "PySide2"
