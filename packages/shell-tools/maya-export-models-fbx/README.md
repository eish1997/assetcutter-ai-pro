# Maya Export Models FBX

Exports each Maya model to a separate FBX file.

Use the AssetCutter tool window to open this package in Maya. In Maya, choose an output folder, choose either selected models or all top-level scene models, then click `Export FBX Files`.

The exporter loads Maya's `fbxmaya` plugin, exports one transform at a time with `FBXExport -s`, and restores the original selection when finished.
