/**
 * Tools → 桥接管理：Maya Command Port 一键安装 / 探测 / 卸载。
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parsePort(el) {
    const n = Number(el && el.value != null ? el.value : 7001);
    if (!Number.isFinite(n) || n < 1 || n > 65535) return 7001;
    return Math.floor(n);
  }

  function parsePortWithDefault(el, fallback) {
    const n = Number(el && el.value != null ? el.value : fallback);
    if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
    return Math.floor(n);
  }

  const HOST_CENTER_CANDIDATES = [
    {
      id: 'blender',
      name: 'Blender',
      status: '可用',
      sub: 'Python startup / local HTTP 一键桥接。',
      tags: ['建模', 'Python', '开源'],
      actions: ['安装插件', '探测连接'],
    },
    {
      id: 'unreal',
      name: 'Unreal',
      status: '可用',
      sub: 'Project plugin / Python HTTP 一键桥接。',
      tags: ['引擎', 'Python', '资产导入'],
      actions: ['安装插件', '探测连接'],
    },
    {
      id: 'max',
      name: '3ds Max',
      status: '可用',
      sub: 'MaxScript startup / Python HTTP 一键桥接。',
      tags: ['DCC', 'MaxScript', '导出'],
      actions: ['安装插件', '探测连接'],
    },
    {
      id: 'photoshop',
      name: 'Photoshop',
      status: '可用',
      sub: 'ExtendScript heartbeat 一键桥接。',
      tags: ['图像', 'ExtendScript', '批处理'],
      actions: ['安装插件', '探测连接'],
    },
    {
      id: 'substance-painter',
      name: 'Substance Painter',
      status: '可用',
      sub: 'Python plugin / local HTTP 一键桥接。',
      tags: ['贴图', '材质', '导出'],
      actions: ['安装插件', '探测连接'],
    },
    {
      id: 'houdini',
      name: 'Houdini',
      status: '可用',
      sub: 'pythonrc.py / local HTTP 一键桥接。',
      tags: ['程序化', 'HDA', '批处理'],
      actions: ['安装插件', '探测连接'],
    },
  ];

  const HOST_CENTER_FALLBACK_CATALOG = [
    { id: 'blender', name: 'Blender', category: '3d', connector: 'Python startup / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click startup bridge using a local Blender Python HTTP probe.', tags: ['DCC', 'Python', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 20 },
    { id: '3ds-max', name: '3ds Max', category: '3d', connector: 'MaxScript startup / Python HTTP', status: 'ready', installMode: 'one_click', description: 'One-click startup bridge using MaxScript plus a Python HTTP probe.', tags: ['DCC', 'MaxScript', 'Export'], actions: ['One-click install', 'Probe connection'], priority: 30 },
    { id: 'cinema-4d', name: 'Cinema 4D', category: '3d', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['DCC', 'Motion Graphics', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 40 },
    { id: 'houdini', name: 'Houdini', category: '3d', connector: 'pythonrc.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click pythonrc.py bridge using a local HTTP probe.', tags: ['Procedural', 'HDA', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 50 },
    { id: 'zbrush', name: 'ZBrush', category: '3d', connector: 'ZScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ZScript bridge using a local heartbeat probe.', tags: ['Sculpt', 'ZScript', 'Export'], actions: ['One-click install', 'Probe connection'], priority: 60 },
    { id: 'substance-painter', name: 'Substance Painter', category: 'paint', connector: 'Python plugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python plugin bridge using a local HTTP probe.', tags: ['Texture', 'Material', 'Export'], actions: ['One-click install', 'Probe connection'], priority: 70 },
    { id: 'substance-designer', name: 'Substance Designer', category: 'paint', connector: 'Python plugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python plugin bridge using a local HTTP probe.', tags: ['Material', 'Graph', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 70.5 },
    { id: 'mari', name: 'Mari', category: 'paint', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['Texture', 'Lookdev', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 71 },
    { id: 'krita', name: 'Krita', category: 'paint', connector: 'Python plugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python plugin bridge using a local HTTP probe.', tags: ['Paint', 'Python', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 72 },
    { id: 'gimp', name: 'GIMP', category: 'paint', connector: 'Python-Fu plugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python-Fu plugin bridge using a local HTTP probe.', tags: ['Image', 'Python-Fu', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 73 },
    { id: 'aseprite', name: 'Aseprite', category: 'paint', connector: 'Lua script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Lua script bridge using a local heartbeat probe.', tags: ['Pixel Art', 'Animation', 'Lua'], actions: ['One-click install', 'Probe connection'], priority: 74 },
    { id: 'moho', name: 'Moho', category: 'paint', connector: 'Lua menu script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Lua menu script bridge using a local heartbeat probe.', tags: ['2D Animation', 'Rigging', 'Lua'], actions: ['One-click install', 'Probe connection'], priority: 74.5 },
    { id: 'toon-boom-harmony', name: 'Toon Boom Harmony', category: 'paint', connector: 'JavaScript script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click JavaScript bridge using a local heartbeat probe.', tags: ['2D Animation', 'Storyboard', 'JavaScript'], actions: ['One-click install', 'Probe connection'], priority: 74.7 },
    { id: 'opentoonz', name: 'OpenToonz', category: 'paint', connector: 'ToonzScript JavaScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ToonzScript JavaScript bridge using a local heartbeat probe.', tags: ['2D Animation', 'Open Source', 'JavaScript'], actions: ['One-click install', 'Probe connection'], priority: 74.8 },
    { id: 'cavalry', name: 'Cavalry', category: 'paint', connector: 'JavaScript UI Script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click JavaScript UI Script bridge using a local heartbeat probe.', tags: ['2D Animation', 'Motion Design', 'JavaScript'], actions: ['One-click install', 'Probe connection'], priority: 74.9 },
    { id: 'tvpaint', name: 'TVPaint Animation', category: 'paint', connector: 'George script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click George script bridge using a local heartbeat probe.', tags: ['2D Animation', 'George', 'Storyboard'], actions: ['One-click install', 'Probe connection'], priority: 74.95 },
    { id: 'rhino', name: 'Rhino', category: '3d', connector: 'Rhino Python / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Rhino Python script bridge using a local HTTP probe.', tags: ['DCC', 'NURBS', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 75 },
    { id: 'sketchup', name: 'SketchUp', category: '3d', connector: 'Ruby plugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Ruby plugin bridge using a local HTTP probe.', tags: ['DCC', 'Architecture', 'Ruby'], actions: ['One-click install', 'Probe connection'], priority: 76 },
    { id: 'marvelous-designer', name: 'Marvelous Designer', category: '3d', connector: 'Python Script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Python Script bridge using a local heartbeat probe.', tags: ['Cloth', 'Garment', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 77 },
    { id: 'clo', name: 'CLO', category: '3d', connector: 'Python Script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Python Script bridge using a local heartbeat probe.', tags: ['Cloth', 'Fashion', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 78 },
    { id: 'rizomuv', name: 'RizomUV', category: '3d', connector: 'Lua script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Lua script bridge using a local heartbeat probe.', tags: ['UV', 'Unwrap', 'Lua'], actions: ['One-click install', 'Probe connection'], priority: 79 },
    { id: 'daz-studio', name: 'Daz Studio', category: '3d', connector: 'DzScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click DzScript bridge using a local heartbeat probe.', tags: ['Character', 'Render', 'DzScript'], actions: ['One-click install', 'Probe connection'], priority: 79.2 },
    { id: 'poser', name: 'Poser', category: '3d', connector: 'Python ScriptsMenu / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Python ScriptsMenu bridge using a local heartbeat probe.', tags: ['Character', 'Animation', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 79.4 },
    { id: 'iclone', name: 'iClone', category: '3d', connector: 'OpenPlugin Python / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click OpenPlugin Python bridge using a local heartbeat probe.', tags: ['Character', 'Animation', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 79.6 },
    { id: 'character-creator', name: 'Character Creator', category: '3d', connector: 'OpenPlugin Python / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click OpenPlugin Python bridge using a local heartbeat probe.', tags: ['Character', 'Rigging', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 79.8 },
    { id: 'metashape', name: 'Metashape', category: '3d', connector: 'Autorun Python scripts / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click autorun Python bridge using a local heartbeat probe.', tags: ['Photogrammetry', 'Python', 'Scan'], actions: ['One-click install', 'Probe connection'], priority: 79.85 },
    { id: '3dequalizer', name: '3DEqualizer', category: 'post', connector: 'py_scripts Python / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click py_scripts Python bridge using a local heartbeat probe.', tags: ['Matchmove', 'VFX', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 79.9 },
    { id: 'katana', name: 'Katana', category: 'compositing', connector: 'KATANA_RESOURCES Startup/init.py / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click KATANA_RESOURCES startup bridge using a local heartbeat probe.', tags: ['Lookdev', 'Lighting', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 79.95 },
    { id: 'motionbuilder', name: 'MotionBuilder', category: '3d', connector: 'PythonStartup / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python startup bridge using a local HTTP probe.', tags: ['DCC', 'Animation', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 82 },
    { id: 'godot', name: 'Godot', category: 'engine', connector: 'EditorPlugin / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click project EditorPlugin bridge using a local HTTP probe.', tags: ['Engine', 'GDScript', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 85 },
    { id: 'fusion-360', name: 'Fusion 360', category: '3d', connector: 'API AddIn / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click API AddIn bridge using a local HTTP probe.', tags: ['CAD', 'Autodesk', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 87 },
    { id: 'keyshot', name: 'KeyShot', category: '3d', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['Render', 'Python', 'Lookdev'], actions: ['One-click install', 'Probe connection'], priority: 88 },
    { id: 'marmoset-toolbag', name: 'Marmoset Toolbag', category: '3d', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['Render', 'Baking', 'Lookdev'], actions: ['One-click install', 'Probe connection'], priority: 89 },
    { id: 'modo', name: 'Modo', category: '3d', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['DCC', 'Modeling', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 91 },
    { id: 'lightwave', name: 'LightWave 3D', category: '3d', connector: 'Python script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python script bridge using a local HTTP probe.', tags: ['DCC', 'Modeling', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 92 },
    { id: 'freecad', name: 'FreeCAD', category: '3d', connector: 'Workbench InitGui.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Workbench bridge using InitGui.py and a local HTTP probe.', tags: ['CAD', 'Python', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 93 },
    { id: 'autocad', name: 'AutoCAD', category: '3d', connector: 'AutoLISP acaddoc.lsp / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click AutoLISP acaddoc.lsp bridge using a local heartbeat probe.', tags: ['CAD', 'AutoLISP', 'Drafting'], actions: ['One-click install', 'Probe connection'], priority: 94 },
    { id: 'unity', name: 'Unity', category: 'engine', connector: 'Editor script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click project Editor script bridge using a local HTTP probe.', tags: ['Engine', 'C#', 'Import'], actions: ['One-click install', 'Probe connection'], priority: 90 },
    { id: 'photoshop', name: 'Photoshop', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Image', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 100 },
    { id: 'illustrator', name: 'Illustrator', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Vector', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 105 },
    { id: 'inkscape', name: 'Inkscape', category: 'post', connector: 'Python extension / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Python extension bridge using a local HTTP probe.', tags: ['Vector', 'Extension', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 106 },
    { id: 'after-effects', name: 'After Effects', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Motion', 'Comp', 'Render'], actions: ['One-click install', 'Probe connection'], priority: 110 },
    { id: 'premiere', name: 'Premiere Pro', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Video', 'Timeline', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 120 },
    { id: 'indesign', name: 'InDesign', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Layout', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 121 },
    { id: 'audition', name: 'Audition', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Audio', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 122 },
    { id: 'media-encoder', name: 'Media Encoder', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Encode', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 123 },
    { id: 'animate', name: 'Animate', category: 'post', connector: 'ExtendScript / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript bridge using a local heartbeat probe.', tags: ['Animation', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 124 },
    { id: 'adobe-bridge', name: 'Adobe Bridge', category: 'post', connector: 'ExtendScript Startup Scripts / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ExtendScript Startup Scripts bridge using a local heartbeat probe.', tags: ['Asset Browser', 'ExtendScript', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 124.5 },
    { id: 'lightroom-classic', name: 'Lightroom Classic', category: 'post', connector: 'Lua .lrplugin / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Lua .lrplugin bridge using a local heartbeat probe.', tags: ['Photo', 'Lua', 'Batch'], actions: ['One-click install', 'Probe connection'], priority: 125 },
    { id: 'darktable', name: 'darktable', category: 'post', connector: 'luarc Lua / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click luarc Lua bridge using a local heartbeat probe.', tags: ['Photo', 'Lua', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 125.5 },
    { id: 'davinci-resolve', name: 'DaVinci Resolve', category: 'post', connector: 'Resolve script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Resolve/Fusion Python script bridge using a local HTTP probe.', tags: ['Video', 'Color', 'Render'], actions: ['One-click install', 'Probe connection'], priority: 130 },
    { id: 'fusion-studio', name: 'Fusion Studio', category: 'compositing', connector: 'Fusion script / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Fusion Python script bridge using a local HTTP probe.', tags: ['Compositing', 'VFX', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 135 },
    { id: 'nuke', name: 'Nuke', category: 'compositing', connector: 'init.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click init.py bridge using a local HTTP probe.', tags: ['Compositing', 'Python', 'Render'], actions: ['One-click install', 'Probe connection'], priority: 140 },
    { id: 'nuke-studio', name: 'Nuke Studio', category: 'compositing', connector: 'Foundry init.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Foundry init.py bridge using a local HTTP probe.', tags: ['Timeline', 'VFX', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 141 },
    { id: 'hiero', name: 'Hiero', category: 'compositing', connector: 'Foundry init.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click Foundry init.py bridge using a local HTTP probe.', tags: ['Timeline', 'Review', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 142 },
    { id: 'natron', name: 'Natron', category: 'compositing', connector: 'initGui.py / local HTTP', status: 'ready', installMode: 'one_click', description: 'One-click initGui.py bridge using a local HTTP probe.', tags: ['Compositing', 'Python', 'Open Source'], actions: ['One-click install', 'Probe connection'], priority: 145 },
    { id: 'obs-studio', name: 'OBS Studio', category: 'post', connector: 'Lua script / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Lua script bridge using a local heartbeat probe.', tags: ['Capture', 'Streaming', 'Lua'], actions: ['One-click install', 'Probe connection'], priority: 150 },
    { id: 'reaper', name: 'REAPER', category: 'post', connector: 'ReaScript Lua / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click ReaScript Lua bridge using a local heartbeat probe.', tags: ['Audio', 'DAW', 'Lua'], actions: ['One-click install', 'Probe connection'], priority: 155 },
    { id: 'vegas-pro', name: 'VEGAS Pro', category: 'post', connector: 'C# Script Menu / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click C# Script Menu bridge using a local heartbeat probe.', tags: ['Video', 'Editing', 'C#'], actions: ['One-click install', 'Probe connection'], priority: 156 },
    { id: 'synfig', name: 'Synfig Studio', category: 'paint', connector: 'Python plug-in / heartbeat', status: 'ready', installMode: 'one_click', description: 'One-click Python plug-in bridge using a local heartbeat probe.', tags: ['2D Animation', 'Open Source', 'Python'], actions: ['One-click install', 'Probe connection'], priority: 157 },
  ];

  window.ShellToolsBridges = {
    _shell: null,
    _mayaStatus: null,
    _blenderStatus: null,
    _maxStatus: null,
    _substanceStatus: null,
    _substanceDesignerStatus: null,
    _mariStatus: null,
    _kritaStatus: null,
    _gimpStatus: null,
    _asepriteStatus: null,
    _mohoStatus: null,
    _toonBoomHarmonyStatus: null,
    _openToonzStatus: null,
    _houdiniStatus: null,
    _nukeStatus: null,
    _nukeStudioStatus: null,
    _hieroStatus: null,
    _natronStatus: null,
    _obsStudioStatus: null,
    _reaperStatus: null,
    _cinema4dStatus: null,
    _davinciStatus: null,
    _photoshopStatus: null,
    _illustratorStatus: null,
    _inkscapeStatus: null,
    _afterEffectsStatus: null,
    _premiereStatus: null,
    _indesignStatus: null,
    _auditionStatus: null,
    _mediaEncoderStatus: null,
    _animateStatus: null,
    _adobeBridgeStatus: null,
    _unityStatus: null,
    _fusionStudioStatus: null,
    _godotStatus: null,
    _motionBuilderStatus: null,
    _fusion360Status: null,
    _keyShotStatus: null,
    _marmosetToolbagStatus: null,
    _modoStatus: null,
    _lightWaveStatus: null,
    _freeCADStatus: null,
    _autoCADStatus: null,
    _zbrushStatus: null,
    _unrealStatus: null,
    _rhinoStatus: null,
    _sketchupStatus: null,
    _marvelousDesignerStatus: null,
    _cloStatus: null,
    _rizomUvStatus: null,
    _dazStudioStatus: null,
    _poserStatus: null,
    _icloneStatus: null,
    _characterCreatorStatus: null,
    _metashapeStatus: null,
    _threeDequalizerStatus: null,
    _katanaStatus: null,
    _lightroomStatus: null,
    _darktableStatus: null,
    _vegasProStatus: null,
    _synfigStatus: null,
    _probe: null,
    _busy: false,
    _bulkProgress: null,
    _bulkSummary: null,
    _selectedVersionIds: null,
    _bridgeCatalog: [],
    _acceptanceSummary: null,
    _bridgeFilter: 'all',
    _bridgeSoftwareFilter: 'all',
    _bridgeSearchQuery: '',
    _isAdmin: false,
    _cloudSyncSummary: null,

    applyHostCenterLabels() {
      const link = document.querySelector('.tools-section-nav a[data-tools-section="bridges"]');
      if (link) link.textContent = '\u5bbf\u4e3b\u4e2d\u5fc3';
      const title = document.querySelector('#tools-bridges .bridges-page-header h1');
      if (title) title.textContent = '\u5bbf\u4e3b\u4e2d\u5fc3';
      const refresh = $('btnBridgesRefresh');
      if (refresh) {
        refresh.title = '\u5237\u65b0\u5bbf\u4e3b\u72b6\u6001';
        refresh.setAttribute('aria-label', '\u5237\u65b0\u5bbf\u4e3b');
      }
    },

    showSection(section) {
      this.applyHostCenterLabels();
      const next = section === 'rack' ? 'rack' : 'bridges';
      document.querySelectorAll('.tools-section-nav a[data-tools-section]').forEach((link) => {
        const on = link.getAttribute('data-tools-section') === next;
        link.classList.toggle('active', on);
        if (on) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      document.querySelectorAll('.tools-section-panel[data-tools-section-panel]').forEach((panel) => {
        const on = panel.getAttribute('data-tools-section-panel') === next;
        panel.classList.toggle('is-active', on);
        panel.hidden = !on;
      });
      return next;
    },

    bind(shell) {
      this._shell = shell;
      this.applyHostCenterLabels();
      document.querySelectorAll('.tools-section-nav a[data-tools-section]').forEach((link) => {
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          const sec = this.showSection(link.getAttribute('data-tools-section'));
          if (sec === 'bridges') void this.reload(shell);
          else if (window.ShellToolsPage) void window.ShellToolsPage.reloadAll(shell);
        });
      });
      $('btnBridgesRefresh')?.addEventListener('click', () => void this.reload(shell));
    },

    async onViewShown(shell) {
      this._shell = shell;
      this.applyHostCenterLabels();
      this.showSection('bridges');
      await this.reload(shell);
    },

    async reload(shell) {
      if (this._busy) return;
      this._shell = shell || this._shell;
      if (!this._shell) return;
      await this.refreshBridgeAccount(this._shell);
      await this.syncBridgeCloudCatalog(this._shell);
      await this.refreshBridgeCatalog(this._shell);
      await this.refreshMaya(this._shell);
      await this.refreshBlender(this._shell);
      await this.refreshMax(this._shell);
      await this.refreshSubstancePainter(this._shell);
      await this.refreshSubstanceDesigner(this._shell);
      await this.refreshMari(this._shell);
      await this.refreshKrita(this._shell);
      await this.refreshGimp(this._shell);
      await this.refreshAseprite(this._shell);
      await this.refreshMoho(this._shell);
      await this.refreshToonBoomHarmony(this._shell);
      await this.refreshOpenToonz(this._shell);
      await this.refreshCavalry(this._shell);
      await this.refreshTvPaint(this._shell);
      await this.refreshHoudini(this._shell);
      await this.refreshNuke(this._shell);
      await this.refreshFoundryTimeline(this._shell, 'nuke-studio');
      await this.refreshFoundryTimeline(this._shell, 'hiero');
      await this.refreshNatron(this._shell);
      await this.refreshObsStudio(this._shell);
      await this.refreshReaper(this._shell);
      await this.refreshCinema4D(this._shell);
      await this.refreshDavinciResolve(this._shell);
      await this.refreshAdobeBridge(this._shell, 'photoshop');
      await this.refreshAdobeBridge(this._shell, 'illustrator');
      await this.refreshInkscape(this._shell);
      await this.refreshAdobeBridge(this._shell, 'after-effects');
      await this.refreshAdobeBridge(this._shell, 'premiere');
      await this.refreshAdobeBridge(this._shell, 'indesign');
      await this.refreshAdobeBridge(this._shell, 'audition');
      await this.refreshAdobeBridge(this._shell, 'media-encoder');
      await this.refreshAdobeBridge(this._shell, 'animate');
      await this.refreshAdobeBridge(this._shell, 'adobe-bridge');
      await this.refreshUnity(this._shell);
      await this.refreshFusionStudio(this._shell);
      await this.refreshGodot(this._shell);
      await this.refreshMotionBuilder(this._shell);
      await this.refreshFusion360(this._shell);
      await this.refreshKeyShot(this._shell);
      await this.refreshMarmosetToolbag(this._shell);
      await this.refreshModo(this._shell);
      await this.refreshLightWave(this._shell);
      await this.refreshFreeCAD(this._shell);
      await this.refreshAutoCAD(this._shell);
      await this.refreshZBrush(this._shell);
      await this.refreshUnreal(this._shell);
      await this.refreshRhino(this._shell);
      await this.refreshSketchUp(this._shell);
      await this.refreshCloMarvelous(this._shell, 'marvelous-designer');
      await this.refreshCloMarvelous(this._shell, 'clo');
      await this.refreshRizomUv(this._shell);
      await this.refreshDazStudio(this._shell);
      await this.refreshPoser(this._shell);
      await this.refreshReallusion(this._shell, 'iclone');
      await this.refreshReallusion(this._shell, 'character-creator');
      await this.refreshMetashape(this._shell);
      await this.refreshThreeDequalizer(this._shell);
      await this.refreshKatana(this._shell);
      await this.refreshVegasPro(this._shell);
      await this.refreshLightroom(this._shell);
      await this.refreshDarktable(this._shell);
      await this.refreshSynfig(this._shell);
      this.render();
    },

    async refreshBridgeAccount(shell) {
      try {
        if (!shell || typeof shell.accountStatus !== 'function') {
          this._isAdmin = false;
          return;
        }
        const status = await shell.accountStatus();
        const user = status && status.user && typeof status.user === 'object' ? status.user : {};
        this._isAdmin = Boolean(status && status.loggedIn && String(user.role || '') === 'admin');
      } catch {
        this._isAdmin = false;
      }
    },

    async syncBridgeCloudCatalog(shell) {
      try {
        if (shell && typeof shell.syncHostBridgesFromCloud === 'function') {
          const result = await shell.syncHostBridgesFromCloud();
          this._cloudSyncSummary = result && result.ok
            ? {
                synced: Number(result.synced) || 0,
                skipped: Number(result.skipped) || 0,
                remoteCount: Number(result.remoteCount) || 0,
              }
            : null;
        }
      } catch {
        this._cloudSyncSummary = null;
        /* keep local host center usable when cloud sync is unavailable */
      }
    },

    async refreshBridgeCatalog(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges', null);
        const list = r && r.ok && r.json && Array.isArray(r.json.bridges) ? r.json.bridges : [];
        this._bridgeCatalog = list
          .filter((item) => item && item.id && item.name)
          .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
        this._acceptanceSummary =
          r && r.ok && r.json && r.json.acceptanceSummary && typeof r.json.acceptanceSummary === 'object'
            ? r.json.acceptanceSummary
            : null;
      } catch {
        this._bridgeCatalog = [];
        this._acceptanceSummary = null;
      }
    },

    async refreshMaya(shell) {
      let statusR;
      try {
        statusR = await shell.api('GET', '/v1/bridges/maya', null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || '加载失败');
        const offline = /ECONNREFUSED|ECONNRESET|fetch failed|network|timeout/i.test(msg);
        this._mayaStatus = {
          error: offline
            ? '本机伴侣未就绪（' + msg + '）。请确认桌面壳已启动本地伴侣，或托盘「重启本地伴侣」后再刷新。'
            : msg,
          versions: [],
          defaultPort: 7001,
          port: 7001,
          installed: false,
          bridgeSourcePath: null,
          companionOffline: offline,
        };
        this._probe = null;
        return;
      }
      if (statusR.ok && statusR.json) {
        this._mayaStatus = statusR.json;
        if (!this._selectedVersionIds) {
          this._selectedVersionIds = new Set(
            (statusR.json.versions || []).map((v) => v.id).filter(Boolean),
          );
        }
      } else {
        const errText =
          (statusR.json && (statusR.json.message || statusR.json.error)) || statusR.error || '加载失败';
        const offline = /ECONNREFUSED|ECONNRESET|Companion|18765/i.test(String(errText));
        this._mayaStatus = {
          error: offline
            ? '本机伴侣未就绪（' + errText + '）。请托盘「重启本地伴侣」或先关掉占用 18765 的旧进程后再试。'
            : errText,
          versions: [],
          defaultPort: 7001,
          port: 7001,
          installed: false,
          bridgeSourcePath: null,
          companionOffline: offline,
        };
        this._probe = null;
        return;
      }

      const port = this._mayaStatus.port || this._mayaStatus.defaultPort || 7001;
      const probeR = await shell.api(
        'GET',
        '/v1/script-connectors?mayaHost=127.0.0.1&mayaPort=' + encodeURIComponent(String(port)) + '&bustCache=1',
        null,
      );
      this._probe = probeR.ok && probeR.json ? probeR.json : null;
    },

    async refreshBlender(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/blender', null);
        this._blenderStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._blenderStatus = null;
      }
    },

    async refreshMax(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/3ds-max', null);
        this._maxStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._maxStatus = null;
      }
    },

    async refreshSubstancePainter(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/substance-painter', null);
        this._substanceStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._substanceStatus = null;
      }
    },

    async refreshSubstanceDesigner(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/substance-designer', null);
        this._substanceDesignerStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._substanceDesignerStatus = null;
      }
    },

    async refreshMari(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/mari', null);
        this._mariStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._mariStatus = null;
      }
    },

    async refreshKrita(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/krita', null);
        this._kritaStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._kritaStatus = null;
      }
    },

    async refreshGimp(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/gimp', null);
        this._gimpStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._gimpStatus = null;
      }
    },

    async refreshAseprite(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/aseprite', null);
        this._asepriteStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._asepriteStatus = null;
      }
    },

    async refreshMoho(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/moho', null);
        this._mohoStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._mohoStatus = null;
      }
    },

    async refreshToonBoomHarmony(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/toon-boom-harmony', null);
        this._toonBoomHarmonyStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._toonBoomHarmonyStatus = null;
      }
    },

    async refreshOpenToonz(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/opentoonz', null);
        this._openToonzStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._openToonzStatus = null;
      }
    },

    async refreshCavalry(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/cavalry', null);
        this._cavalryStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._cavalryStatus = null;
      }
    },

    async refreshTvPaint(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/tvpaint', null);
        this._tvPaintStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._tvPaintStatus = null;
      }
    },

    async refreshCloMarvelous(shell, id) {
      try {
        const r = await shell.api('GET', '/v1/bridges/' + encodeURIComponent(id), null);
        if (id === 'marvelous-designer') this._marvelousDesignerStatus = r && r.ok && r.json ? r.json : null;
        if (id === 'clo') this._cloStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        if (id === 'marvelous-designer') this._marvelousDesignerStatus = null;
        if (id === 'clo') this._cloStatus = null;
      }
    },

    async refreshRizomUv(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/rizomuv', null);
        this._rizomUvStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._rizomUvStatus = null;
      }
    },

    async refreshDazStudio(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/daz-studio', null);
        this._dazStudioStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._dazStudioStatus = null;
      }
    },

    async refreshPoser(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/poser', null);
        this._poserStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._poserStatus = null;
      }
    },

    async refreshReallusion(shell, id) {
      try {
        const r = await shell.api('GET', '/v1/bridges/' + encodeURIComponent(id), null);
        if (id === 'iclone') this._icloneStatus = r && r.ok && r.json ? r.json : null;
        if (id === 'character-creator') this._characterCreatorStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        if (id === 'iclone') this._icloneStatus = null;
        if (id === 'character-creator') this._characterCreatorStatus = null;
      }
    },

    async refreshMetashape(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/metashape', null);
        this._metashapeStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._metashapeStatus = null;
      }
    },

    async refreshThreeDequalizer(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/3dequalizer', null);
        this._threeDequalizerStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._threeDequalizerStatus = null;
      }
    },

    async refreshKatana(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/katana', null);
        this._katanaStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._katanaStatus = null;
      }
    },

    async refreshLightroom(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/lightroom-classic', null);
        this._lightroomStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._lightroomStatus = null;
      }
    },

    async refreshDarktable(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/darktable', null);
        this._darktableStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._darktableStatus = null;
      }
    },

    async refreshVegasPro(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/vegas-pro', null);
        this._vegasProStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._vegasProStatus = null;
      }
    },

    async refreshSynfig(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/synfig', null);
        this._synfigStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._synfigStatus = null;
      }
    },

    async refreshInkscape(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/inkscape', null);
        this._inkscapeStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._inkscapeStatus = null;
      }
    },

    async refreshHoudini(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/houdini', null);
        this._houdiniStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._houdiniStatus = null;
      }
    },

    async refreshNuke(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/nuke', null);
        this._nukeStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._nukeStatus = null;
      }
    },

    async refreshFoundryTimeline(shell, id) {
      try {
        const r = await shell.api('GET', '/v1/bridges/' + encodeURIComponent(id), null);
        if (id === 'hiero') this._hieroStatus = r && r.ok && r.json ? r.json : null;
        else this._nukeStudioStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        if (id === 'hiero') this._hieroStatus = null;
        else this._nukeStudioStatus = null;
      }
    },

    async refreshNatron(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/natron', null);
        this._natronStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._natronStatus = null;
      }
    },

    async refreshObsStudio(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/obs-studio', null);
        this._obsStudioStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._obsStudioStatus = null;
      }
    },

    async refreshReaper(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/reaper', null);
        this._reaperStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._reaperStatus = null;
      }
    },

    async refreshCinema4D(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/cinema-4d', null);
        this._cinema4dStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._cinema4dStatus = null;
      }
    },

    async refreshDavinciResolve(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/davinci-resolve', null);
        this._davinciStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._davinciStatus = null;
      }
    },

    async refreshFusionStudio(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/fusion-studio', null);
        this._fusionStudioStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._fusionStudioStatus = null;
      }
    },

    isAdobeBridge(id) {
      return id === 'photoshop' || id === 'illustrator' || id === 'after-effects' || id === 'premiere' || id === 'indesign' || id === 'audition' || id === 'media-encoder' || id === 'animate' || id === 'adobe-bridge';
    },

    adobeStatusKey(id) {
      if (id === 'photoshop') return '_photoshopStatus';
      if (id === 'illustrator') return '_illustratorStatus';
      if (id === 'after-effects') return '_afterEffectsStatus';
      if (id === 'premiere') return '_premiereStatus';
      if (id === 'indesign') return '_indesignStatus';
      if (id === 'audition') return '_auditionStatus';
      if (id === 'media-encoder') return '_mediaEncoderStatus';
      if (id === 'adobe-bridge') return '_adobeBridgeStatus';
      return '_animateStatus';
    },

    async refreshAdobeBridge(shell, id) {
      const key = this.adobeStatusKey(id);
      try {
        const r = await shell.api('GET', '/v1/bridges/' + id, null);
        this[key] = r && r.ok && r.json ? r.json : null;
      } catch {
        this[key] = null;
      }
    },

    async refreshUnity(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/unity', null);
        this._unityStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._unityStatus = null;
      }
    },

    async refreshGodot(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/godot', null);
        this._godotStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._godotStatus = null;
      }
    },

    async refreshMotionBuilder(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/motionbuilder', null);
        this._motionBuilderStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._motionBuilderStatus = null;
      }
    },

    async refreshFusion360(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/fusion-360', null);
        this._fusion360Status = r && r.ok && r.json ? r.json : null;
      } catch {
        this._fusion360Status = null;
      }
    },

    async refreshKeyShot(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/keyshot', null);
        this._keyShotStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._keyShotStatus = null;
      }
    },

    async refreshMarmosetToolbag(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/marmoset-toolbag', null);
        this._marmosetToolbagStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._marmosetToolbagStatus = null;
      }
    },

    async refreshModo(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/modo', null);
        this._modoStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._modoStatus = null;
      }
    },

    async refreshLightWave(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/lightwave', null);
        this._lightWaveStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._lightWaveStatus = null;
      }
    },

    async refreshFreeCAD(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/freecad', null);
        this._freeCADStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._freeCADStatus = null;
      }
    },

    async refreshAutoCAD(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/autocad', null);
        this._autoCADStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._autoCADStatus = null;
      }
    },

    async refreshZBrush(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/zbrush', null);
        this._zbrushStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._zbrushStatus = null;
      }
    },

    async refreshUnreal(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/unreal', null);
        this._unrealStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._unrealStatus = null;
      }
    },

    async refreshRhino(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/rhino', null);
        this._rhinoStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._rhinoStatus = null;
      }
    },

    async refreshSketchUp(shell) {
      try {
        const r = await shell.api('GET', '/v1/bridges/sketchup', null);
        this._sketchupStatus = r && r.ok && r.json ? r.json : null;
      } catch {
        this._sketchupStatus = null;
      }
    },

    mayaConnector() {
      const list = this._probe && Array.isArray(this._probe.connectors) ? this._probe.connectors : [];
      return list.find((c) => c && (c.targetType === 'maya' || c.id === 'maya.command_port@v1')) || null;
    },

    mayaUiState() {
      const st = this._mayaStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const hasMarker = versions.some((v) => v.hasUserSetupMarker);
      const maya = this.mayaConnector();
      const connected = Boolean(maya && maya.status === 'ok');
      const occupied = Boolean(maya && maya.status === 'occupied');
      const probeErr = maya && maya.message ? String(maya.message) : '';

      if (connected) {
        return { key: 'connected', label: '已连接', pill: 'is-ok', detail: 'Command Port 可探测' };
      }
      if (occupied) {
        return {
          key: 'occupied',
          label: '忙碌中',
          pill: 'is-warn',
          detail: probeErr || 'Maya 正在执行脚本，探针暂不可用（属正常）',
        };
      }
      if (hasMarker || st.installed) {
        return {
          key: 'pending',
          label: '已写入 · 待重启',
          pill: 'is-warn',
          detail: probeErr
            ? '已安装桥接，但当前连不上：' + probeErr + '。请打开/重启 Maya 后再探测。'
            : '已写入 userSetup。请打开或重启 Maya，再点「探测连接」。',
        };
      }
      if (!versions.length) {
        return {
          key: 'no_dir',
          label: '未发现 Maya',
          pill: 'is-err',
          detail: '未找到 Documents/maya/*/scripts。可手动选择 scripts 目录后安装。',
        };
      }
      return {
        key: 'not_installed',
        label: '未安装',
        pill: '',
        detail: '一键安装会复制 Workflow Bridge 并写入 userSetup（启动时开端口）。',
      };
    },

    blenderUiState() {
      const st = this._blenderStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Blender bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Blender, then probe connection.' };
      const versions = Array.isArray(st.versions) ? st.versions : [];
      if (!versions.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Blender startup folder was found. Choose scripts/startup manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter startup bridge. Restart Blender after install.' };
    },

    maxUiState() {
      const st = this._maxStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || '3ds Max bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart 3ds Max, then probe connection.' };
      const versions = Array.isArray(st.versions) ? st.versions : [];
      if (!versions.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No 3ds Max scripts/startup folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes MaxScript + Python bridge files. Restart 3ds Max after install.' };
    },

    substancePainterUiState() {
      const st = this._substanceStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Substance Painter bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Enable or restart the plugin in Substance Painter, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Substance Painter python/plugins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python plugin. Enable or restart it after install.' };
    },

    substanceDesignerUiState() {
      const st = this._substanceDesignerStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Substance Designer bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Designer or run the installed script, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Substance Designer scripts/plugins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Substance Designer Python bridge.' };
    },

    mariUiState() {
      const st = this._mariStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Mari bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in Mari, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Mari scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Mari Python bridge script.' };
    },

    kritaUiState() {
      const st = this._kritaStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Krita bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Enable the AssetCutter Bridge plugin and restart Krita, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Krita pykrita folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Krita Python plugin.' };
    },

    gimpUiState() {
      const st = this._gimpStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'GIMP bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart GIMP and run Filters > AssetCutter > AssetCutter Bridge, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No GIMP plug-ins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter GIMP Python-Fu plugin.' };
    },

    asepriteUiState() {
      const st = this._asepriteStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Aseprite bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Rescan Scripts and run the AssetCutter script, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Aseprite scripts folder was found. Choose it manually from File > Scripts > Open Scripts Folder.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Aseprite Lua heartbeat script.' };
    },

    mohoUiState() {
      const st = this._mohoStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Moho bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Moho and run Scripts > AssetCutter Bridge, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Moho Scripts/Menu folder was found. Choose the Custom Content Scripts/Menu folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Moho Lua menu script.' };
    },

    toonBoomHarmonyUiState() {
      const st = this._toonBoomHarmonyStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Harmony bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Add and run the AssetCutter script from Harmony Scripts, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Toon Boom Harmony scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Harmony JavaScript heartbeat script.' };
    },

    openToonzUiState() {
      const st = this._openToonzStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'OpenToonz bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script from OpenToonz Run Script, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No OpenToonz script folder was found. Choose the OpenToonz stuff/library/script folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter OpenToonz JavaScript heartbeat script.' };
    },

    cavalryUiState() {
      const st = this._cavalryStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Cavalry bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run AssetCutter Cavalry Bridge from Cavalry Window > Scripts, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Cavalry Scripts folder was found. Choose it manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Cavalry JavaScript heartbeat script.' };
    },

    tvPaintUiState() {
      const st = this._tvPaintStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'TVPaint bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter George script inside TVPaint, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No TVPaint George Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter TVPaint George heartbeat script.' };
    },

    houdiniUiState() {
      const st = this._houdiniStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Houdini bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Houdini, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Houdini preferences folder was found. Choose a houdiniXX.X folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes a pythonrc.py startup bridge. Restart Houdini after install.' };
    },

    nukeUiState() {
      const st = this._nukeStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Nuke bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Nuke, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Nuke user script folder was found. Choose the .nuke folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an init.py startup bridge. Restart Nuke after install.' };
    },

    foundryTimelineUiState(id) {
      const name = id === 'hiero' ? 'Hiero' : 'Nuke Studio';
      const st = id === 'hiero' ? (this._hieroStatus || {}) : (this._nukeStudioStatus || {});
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || name + ' bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart ' + name + ', then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Foundry .nuke user script folder was found. Choose it manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes a Foundry init.py startup bridge. Restart ' + name + ' after install.' };
    },

    natronUiState() {
      const st = this._natronStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Natron bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Natron, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Natron user scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an initGui.py startup bridge. Restart Natron after install.' };
    },

    obsStudioUiState() {
      const st = this._obsStudioStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'OBS Studio bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Add or reload the Lua script in OBS Tools > Scripts, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No OBS Studio scripts folder was found. Choose or create one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter OBS Lua heartbeat script.' };
    },

    reaperUiState() {
      const st = this._reaperStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'REAPER bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Load and run the Lua script from REAPER Actions, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No REAPER Scripts folder was found. Choose the resource Scripts folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter REAPER Lua heartbeat script.' };
    },

    cinema4dUiState() {
      const st = this._cinema4dStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Cinema 4D bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in Cinema 4D, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Cinema 4D scripts folder was found. Choose a library/scripts folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python script into Cinema 4D scripts.' };
    },

    davinciResolveUiState() {
      const st = this._davinciStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'DaVinci Resolve bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in DaVinci Resolve, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No DaVinci Resolve scripts folder was found. Choose a Resolve/Fusion Scripts folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python script into Resolve/Fusion Scripts.' };
    },

    fusionStudioUiState() {
      const st = this._fusionStudioStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Fusion Studio bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in Fusion Studio, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Fusion Studio scripts folder was found. Choose a Fusion Scripts folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python script into Fusion Scripts.' };
    },

    adobeUiState(id) {
      const st = this[this.adobeStatusKey(id)] || {};
      const probe = st.probe || {};
      const meta = this.adobeHostMeta(id);
      const name = st.name || meta.name;
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || name + ' bridge heartbeat detected.' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run or restart the installed script, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No ' + name + ' scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter ExtendScript heartbeat bridge.' };
    },

    inkscapeUiState() {
      const st = this._inkscapeStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Inkscape bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Inkscape and run Extensions > AssetCutter > AssetCutter Bridge, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Inkscape extensions folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Inkscape extension.' };
    },

    unityUiState() {
      const st = this._unityStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Unity bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Open or recompile the Unity project, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Unity project folder was found. Choose a Unity project root manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an Editor script into the selected Unity project.' };
    },

    godotUiState() {
      const st = this._godotStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Godot bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Enable the AssetCutter Bridge plugin in Godot Project Settings, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Godot project folder was found. Choose a folder containing project.godot manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an EditorPlugin into the selected Godot project.' };
    },

    motionBuilderUiState() {
      const st = this._motionBuilderStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'MotionBuilder bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart MotionBuilder, then probe connection.' };
      const versions = Array.isArray(st.versions) ? st.versions : [];
      if (!versions.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No MotionBuilder PythonStartup folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python startup bridge.' };
    },

    fusion360UiState() {
      const st = this._fusion360Status || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Fusion 360 bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Fusion 360 or enable the AddIn, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Fusion 360 AddIns folder was found. Choose API/AddIns manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Fusion 360 API AddIn.' };
    },

    modoUiState() {
      const st = this._modoStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Modo bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in Modo, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Modo Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python script into Modo Scripts.' };
    },

    lightWaveUiState() {
      const st = this._lightWaveStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'LightWave bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in LightWave, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No LightWave Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Python script into LightWave Scripts.' };
    },

    freeCADUiState() {
      const st = this._freeCADStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'FreeCAD bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart FreeCAD, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No FreeCAD Mod folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Workbench into FreeCAD Mod.' };
    },

    autoCADUiState() {
      const st = this._autoCADStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'AutoCAD bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart AutoCAD or run ASSETCUTTERBRIDGE, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No AutoCAD Support folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AutoLISP bridge and acaddoc.lsp loader.' };
    },

    zbrushUiState() {
      const st = this._zbrushStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'ZBrush bridge heartbeat detected.' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the installed ZScript in ZBrush, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No ZBrush scripts folder was found. Choose a ZStartup/ZScripts or ZPlugs64 folder manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter ZScript heartbeat bridge.' };
    },

    unrealUiState() {
      const st = this._unrealStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Unreal bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Enable the plugin/Python plugin and restart the Unreal project, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Unreal project folder was found. Choose a folder containing a .uproject file manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter project plugin with an Unreal Python bridge.' };
    },

    rhinoUiState() {
      const st = this._rhinoStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Rhino bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter Rhino script in Rhino, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Rhino scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Rhino Python bridge script.' };
    },

    sketchUpUiState() {
      const st = this._sketchupStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'SketchUp bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart SketchUp, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No SketchUp Plugins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an auto-loaded SketchUp Ruby plugin.' };
    },

    cloMarvelousUiState(id) {
      const st = id === 'clo' ? this._cloStatus || {} : this._marvelousDesignerStatus || {};
      const name = id === 'clo' ? 'CLO' : 'Marvelous Designer';
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || name + ' bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter Python script inside ' + name + ', then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No ' + name + ' Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter ' + name + ' Python heartbeat script.' };
    },

    rizomUvUiState() {
      const st = this._rizomUvStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'RizomUV bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter Lua script inside RizomUV, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No RizomUV Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter RizomUV Lua heartbeat script.' };
    },

    dazStudioUiState() {
      const st = this._dazStudioStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Daz Studio bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script inside Daz Studio, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Daz Studio Scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Daz Studio DzScript heartbeat script.' };
    },

    poserUiState() {
      const st = this._poserStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Poser bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter Python script from Poser Scripts menu, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Poser ScriptsMenu folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Poser Python ScriptsMenu bridge.' };
    },

    reallusionUiState(id) {
      const name = id === 'iclone' ? 'iClone' : 'Character Creator';
      const st = id === 'iclone' ? (this._icloneStatus || {}) : (this._characterCreatorStatus || {});
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || name + ' bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run AssetCutterBridge from the Reallusion Plug-in menu, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No ' + name + ' OpenPlugin folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter ' + name + ' OpenPlugin Python bridge.' };
    },

    metashapeUiState() {
      const st = this._metashapeStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Metashape bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Metashape Pro, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Metashape Pro scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Metashape autorun Python bridge.' };
    },

    threeDequalizerUiState() {
      const st = this._threeDequalizerStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || '3DEqualizer bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run AssetCutter Bridge from the 3DEqualizer script menu, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No 3DEqualizer py_scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter 3DEqualizer py_scripts Python bridge.' };
    },

    katanaUiState() {
      const st = this._katanaStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Katana bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Katana with the AssetCutter resource root enabled, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Katana resource root was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Katana Startup/init.py bridge.' };
    },

    lightroomUiState() {
      const st = this._lightroomStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Lightroom Classic bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Lightroom Classic, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Lightroom Classic Modules folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Lightroom Classic .lrplugin bridge.' };
    },

    darktableUiState() {
      const st = this._darktableStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'darktable bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Start darktable with Lua enabled, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No darktable config folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes a Lua bridge and luarc startup block for darktable.' };
    },

    vegasProUiState() {
      const st = this._vegasProStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'VEGAS Pro bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run AssetCutterVegasBridge from VEGAS Tools > Scripting, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No VEGAS Pro Script Menu folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter VEGAS Pro C# Script Menu bridge.' };
    },

    synfigUiState() {
      const st = this._synfigStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Synfig bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Restart Synfig if needed, run AssetCutter Bridge from Plug-ins, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Synfig plugins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Synfig Python plug-in bridge.' };
    },

    keyShotUiState() {
      const st = this._keyShotStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'KeyShot bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in KeyShot, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No KeyShot scripts folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter KeyShot Python bridge script.' };
    },

    marmosetToolbagUiState() {
      const st = this._marmosetToolbagStatus || {};
      const probe = st.probe || {};
      if (probe.ok) return { key: 'connected', label: 'Connected', pill: 'is-ok', detail: probe.message || 'Marmoset Toolbag bridge connected' };
      if (st.installed) return { key: 'pending', label: 'Installed', pill: 'is-warn', detail: probe.message || 'Run the AssetCutter script in Toolbag, then probe connection.' };
      const targets = Array.isArray(st.targets) ? st.targets : [];
      if (!targets.length) return { key: 'no_dir', label: 'Not found', pill: 'is-err', detail: 'No Marmoset Toolbag scripts/plugins folder was found. Choose one manually.' };
      return { key: 'not_installed', label: 'Not installed', pill: '', detail: 'One-click install writes an AssetCutter Marmoset Toolbag Python bridge script.' };
    },

    renderTags(tags) {
      const items = (tags || []).map((tag) => '<span class="bridge-tag">' + esc(this.translateBridgeText(tag)) + '</span>');
      return items.length ? '<div class="bridge-tags">' + items.join('') + '</div>' : '';
    },

    translateBridgeText(value) {
      let text = String(value || '');
      if (!text) return text;
      const exact = {
        Connected: '\u5df2\u8fde\u63a5',
        Installed: '\u5df2\u5b89\u88c5',
        'Not installed': '\u672a\u5b89\u88c5',
        'Not found': '\u672a\u627e\u5230',
        Ready: '\u53ef\u7528',
        'One-click': '\u4e00\u952e',
        'One-click install': '\u4e00\u952e\u5b89\u88c5',
        'Probe connection': '\u63a2\u6d4b\u8fde\u63a5',
        'Choose startup...': '\u9009\u62e9\u542f\u52a8\u76ee\u5f55...',
        'Choose scripts...': '\u9009\u62e9\u811a\u672c\u76ee\u5f55...',
        'Choose Plugins...': '\u9009\u62e9\u63d2\u4ef6\u76ee\u5f55...',
        Uninstall: '\u5378\u8f7d',
        Port: '\u7aef\u53e3',
        'Install targets': '\u5b89\u88c5\u76ee\u6807',
        'Last verified': '\u6700\u8fd1\u9a8c\u8bc1',
        'Last failed': '\u6700\u8fd1\u5931\u8d25',
        'Open Source': '\u5f00\u6e90',
        Export: '\u5bfc\u51fa',
        Texture: '\u6750\u8d28',
        Material: '\u6750\u8d28',
        Paint: '\u7ed8\u5236',
        Image: '\u56fe\u50cf',
        Animation: '\u52a8\u753b',
        '2D Animation': '2D \u52a8\u753b',
        'Motion Graphics': '\u52a8\u6001\u56fe\u5f62',
        Procedural: '\u7a0b\u5e8f\u5316',
        Sculpt: '\u96d5\u523b',
        Engine: '\u5f15\u64ce',
        Render: '\u6e32\u67d3',
        Modeling: '\u5efa\u6a21',
        Architecture: '\u5efa\u7b51',
        Cloth: '\u5e03\u6599',
        Garment: '\u670d\u88c5',
        Fashion: '\u65f6\u88c5',
        Character: '\u89d2\u8272',
        Rigging: '\u7ed1\u5b9a',
        Photogrammetry: '\u6444\u5f71\u6d4b\u91cf',
        Scan: '\u626b\u63cf',
        Matchmove: '\u5339\u914d\u79fb\u52a8',
        Lookdev: '\u89c6\u89c9\u5f00\u53d1',
        Lighting: '\u706f\u5149',
        Compositing: '\u5408\u6210',
        Timeline: '\u65f6\u95f4\u7ebf',
        Review: '\u5ba1\u770b',
        Capture: '\u91c7\u96c6',
        Streaming: '\u76f4\u64ad',
        Audio: '\u97f3\u9891',
        Video: '\u89c6\u9891',
        Vector: '\u77e2\u91cf',
        Motion: '\u52a8\u6548',
        Layout: '\u6392\u7248',
        Encode: '\u7f16\u7801',
        Batch: '\u6279\u5904\u7406',
        Color: '\u8c03\u8272',
        'Asset Browser': '\u8d44\u4ea7\u6d4f\u89c8',
        Photo: '\u7167\u7247',
        Baking: '\u70d8\u7119',
        Drafting: '\u5236\u56fe',
        Import: '\u5bfc\u5165',
      };
      if (Object.prototype.hasOwnProperty.call(exact, text)) return exact[text];
      const replacements = [
        [/One-click install/g, '\u4e00\u952e\u5b89\u88c5'],
        [/Probe connection/g, '\u63a2\u6d4b\u8fde\u63a5'],
        [/Choose startup\.\.\./g, '\u9009\u62e9\u542f\u52a8\u76ee\u5f55...'],
        [/Choose scripts\.\.\./g, '\u624b\u52a8\u6dfb\u52a0\u7248\u672c'],
        [/Choose project\.\.\./g, '\u624b\u52a8\u6dfb\u52a0\u7248\u672c'],
        [/Choose Plugins\.\.\./g, '\u9009\u62e9\u63d2\u4ef6\u76ee\u5f55...'],
        [/Uninstall/g, '\u5378\u8f7d'],
        [/Not installed/g, '\u672a\u5b89\u88c5'],
        [/Not found/g, '\u672a\u627e\u5230'],
        [/Connected/g, '\u5df2\u8fde\u63a5'],
        [/Installed/g, '\u5df2\u5b89\u88c5'],
        [/Ready/g, '\u53ef\u7528'],
        [/Port/g, '\u7aef\u53e3'],
        [/Install targets/g, '\u5b89\u88c5\u76ee\u6807'],
        [/Install failed/g, '\u5b89\u88c5\u5931\u8d25'],
        [/Uninstall failed/g, '\u5378\u8f7d\u5931\u8d25'],
        [/Current shell cannot choose folders\./g, '\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u9009\u62e9\u76ee\u5f55\u3002'],
        [/Choose at least one ([^,.]+), or use ([^.]+)\./g, '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a $1\uff0c\u6216\u4f7f\u7528 $2\u3002'],
        [/installed/g, '\u5df2\u5b89\u88c5'],
        [/Python startup bridge/g, 'Python \u542f\u52a8\u6865'],
        [/Python script bridge/g, 'Python \u811a\u672c\u6865'],
        [/Python plugin bridge/g, 'Python \u63d2\u4ef6\u6865'],
        [/MaxScript startup \+ Python bridge/g, 'MaxScript \u542f\u52a8 + Python \u6865'],
        [/Resolve\/Fusion script bridge/g, 'Resolve\/Fusion \u811a\u672c\u6865'],
        [/Editor script bridge/g, '\u7f16\u8f91\u5668\u811a\u672c\u6865'],
        [/EditorPlugin bridge/g, '\u7f16\u8f91\u5668\u63d2\u4ef6\u6865'],
        [/Project plugin \+ Python bridge/g, '\u9879\u76ee\u63d2\u4ef6 + Python \u6865'],
        [/ZScript heartbeat bridge/g, 'ZScript \u5fc3\u8df3\u6865'],
        [/ExtendScript heartbeat bridge/g, 'ExtendScript \u5fc3\u8df3\u6865'],
        [/heartbeat bridge/g, '\u5fc3\u8df3\u6865'],
        [/local HTTP probe/g, '\u672c\u5730 HTTP \u63a2\u6d4b'],
        [/heartbeat probe/g, '\u5fc3\u8df3\u63a2\u6d4b'],
        [/Restart ([^,.]+) after install\./g, '\u5b89\u88c5\u540e\u91cd\u542f $1\u3002'],
        [/Restart ([^,.]+), then probe connection\./g, '\u91cd\u542f $1 \u540e\u518d\u63a2\u6d4b\u8fde\u63a5\u3002'],
        [/Run the installed script in ([^,.]+) after install\./g, '\u5b89\u88c5\u540e\u5728 $1 \u4e2d\u8fd0\u884c\u5df2\u5b89\u88c5\u7684\u811a\u672c\u3002'],
        [/Run the AssetCutter script in ([^,.]+), then probe connection\./g, '\u5728 $1 \u4e2d\u8fd0\u884c AssetCutter \u811a\u672c\u540e\u518d\u63a2\u6d4b\u8fde\u63a5\u3002'],
        [/Enable or restart the plugin/g, '\u542f\u7528\u6216\u91cd\u542f\u63d2\u4ef6'],
        [/then probe connection\./g, '\u7136\u540e\u518d\u63a2\u6d4b\u8fde\u63a5\u3002'],
        [/Choose one manually\./g, '\u8bf7\u624b\u52a8\u9009\u62e9\u4e00\u4e2a\u76ee\u5f55\u3002'],
        [/Choose .* manually\./g, '\u8bf7\u624b\u52a8\u9009\u62e9\u76ee\u5f55\u3002'],
        [/No ([^.]+) folder was found\./g, '\u672a\u627e\u5230 $1 \u76ee\u5f55\u3002'],
        [/One-click install writes an AssetCutter ([^.]+)\./g, '\u4e00\u952e\u5b89\u88c5\u4f1a\u5199\u5165 AssetCutter $1\u3002'],
        [/One-click install writes ([^.]+)\./g, '\u4e00\u952e\u5b89\u88c5\u4f1a\u5199\u5165 $1\u3002'],
        [/Open or recompile the project after install\./g, '\u5b89\u88c5\u540e\u6253\u5f00\u6216\u91cd\u65b0\u7f16\u8bd1\u9879\u76ee\u3002'],
        [/Enable the plugin in Project Settings after install\./g, '\u5b89\u88c5\u540e\u5728\u9879\u76ee\u8bbe\u7f6e\u4e2d\u542f\u7528\u63d2\u4ef6\u3002'],
        [/Run or restart the installed script after install\./g, '\u5b89\u88c5\u540e\u8fd0\u884c\u6216\u91cd\u542f\u5df2\u5b89\u88c5\u7684\u811a\u672c\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) bridge returned HTTP (\d+)/g, '$1 \u6865\u63a5\u8fd4\u56de HTTP $2\uff0c\u8bf7\u786e\u8ba4\u5bbf\u4e3b\u5185\u6865\u63a5\u811a\u672c\u5df2\u542f\u52a8\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) bridge connected(\s*\([^)]+\))?/g, '$1 \u6865\u63a5\u5df2\u8fde\u63a5$2'],
        [/([A-Za-z0-9 ._+\-/]+) bridge heartbeat detected\./g, '$1 \u5fc3\u8df3\u5df2\u8fde\u63a5\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) bridge response is invalid/g, '$1 \u6865\u63a5\u54cd\u5e94\u65e0\u6548\uff0c\u8bf7\u91cd\u542f\u5bbf\u4e3b\u540e\u91cd\u65b0\u63a2\u6d4b\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) bridge is not reachable on 127\.0\.0\.1:(\d+):\s*(.+)/g, '$1 \u6865\u63a5\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5\uff08\u7aef\u53e3 $2\uff09\u3002\u8bf7\u5148\u6253\u5f00\u5bbf\u4e3b\u5e76\u52a0\u8f7d\u6865\u63a5\u811a\u672c\u540e\u518d\u63a2\u6d4b\u3002\u539f\u56e0\uff1a$3'],
        [/([A-Za-z0-9 ._+\-/]+) heartbeat file was not found/g, '$1 \u5c1a\u672a\u4ea7\u751f\u5fc3\u8df3\u6587\u4ef6\uff0c\u8bf7\u6253\u5f00\u5bbf\u4e3b\u5e76\u8fd0\u884c\u6865\u63a5\u811a\u672c\u540e\u518d\u63a2\u6d4b\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) heartbeat connected/g, '$1 \u5fc3\u8df3\u5df2\u8fde\u63a5'],
        [/([A-Za-z0-9 ._+\-/]+) heartbeat is stale/g, '$1 \u5fc3\u8df3\u5df2\u8fc7\u671f\uff0c\u8bf7\u5728\u5bbf\u4e3b\u5185\u91cd\u65b0\u8fd0\u884c\u6865\u63a5\u811a\u672c\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) heartbeat is invalid/g, '$1 \u5fc3\u8df3\u5185\u5bb9\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u8fd0\u884c\u6865\u63a5\u811a\u672c\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) heartbeat belongs to ([A-Za-z0-9 ._+\-/]+)/g, '$1 \u5fc3\u8df3\u5c5e\u4e8e $2\uff0c\u8bf7\u786e\u8ba4\u9009\u62e9\u7684\u662f\u5f53\u524d\u5bbf\u4e3b\u76ee\u5f55\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) command port probe timed out/g, '$1 \u547d\u4ee4\u7aef\u53e3\u63a2\u6d4b\u8d85\u65f6\uff0c\u8bf7\u786e\u8ba4\u5bbf\u4e3b\u5df2\u542f\u52a8\u5e76\u5f00\u542f\u6865\u63a5\u7aef\u53e3\u3002'],
        [/([A-Za-z0-9 ._+\-/]+) command port connected/g, '$1 \u547d\u4ee4\u7aef\u53e3\u5df2\u8fde\u63a5'],
        [/([A-Za-z0-9 ._+\-/]+) command port is not reachable:\s*(.+)/g, '$1 \u547d\u4ee4\u7aef\u53e3\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5\uff0c\u8bf7\u5148\u6253\u5f00\u5bbf\u4e3b\u540e\u518d\u63a2\u6d4b\u3002\u539f\u56e0\uff1a$2'],
      ];
      replacements.forEach(([pattern, replacement]) => {
        text = text.replace(pattern, replacement);
      });
      return text;
    },

    notifyBridge(message) {
      window.alert(this.translateBridgeText(message));
    },

    hostAcceptanceGuide(groupId, hostId) {
      const id = String(hostId || '').trim();
      const name = this.hostName(id) || id || '当前宿主';
      const guides = {
        maya: '验收建议：确认 scripts 目录，安装桥接，打开或重启 ' + name + '，再探测 Command Port。',
        adobe: '验收建议：安装 ExtendScript 桥接，重启或运行 JSX，确认 heartbeat 新鲜且属于 ' + name + '。',
        python_dcc: '验收建议：安装 Python HTTP 桥接，打开或重启 ' + name + '，确认 /health 返回真实宿主信息。',
        lua_heartbeat: '验收建议：安装 Lua/脚本桥接，在 ' + name + ' 内运行脚本，再确认 heartbeat 新鲜且 host id 匹配。',
        project_plugin: '验收建议：选择真实项目目录，安装项目插件，打开项目并加载插件后，再探测 HTTP health 或插件回调。',
        manual_script_dir: '验收建议：选择 ' + name + ' 的真实脚本目录，排除上级目录、缓存目录和其它软件目录，运行脚本后再探测 heartbeat。',
        paired_software: '验收建议：确认当前目录只属于 ' + name + '，安装、探测、卸载都不能覆盖成对软件的文件。',
      };
      return guides[String(groupId || '').trim()] || '';
    },

    bridgeCopilotContext(hostId) {
      const id = String(hostId || '').trim();
      const entry = (this._bridgeCatalog || []).find((item) => item && item.id === id) || {};
      const status = this.statusForBridge(id) || {};
      const probe = status.probe && typeof status.probe === 'object' ? status.probe : {};
      const acceptance = status.acceptance && typeof status.acceptance === 'object' ? status.acceptance : {};
      const groups = this.acceptanceSummaryGroups()
        .filter((group) => Array.isArray(group.hosts) && group.hosts.indexOf(id) >= 0)
        .map((group) => ({
          id: group.id,
          label: group.label || group.id,
          guide: this.hostAcceptanceGuide(group.id, id),
        }))
        .filter(Boolean);
      const groupLabels = groups.map((group) => group.label).filter(Boolean);
      const guideLines = groups.map((group) => group.guide).filter(Boolean);
      const lines = [
        '\u5f53\u524d\u5bf9\u8bdd\u7ed1\u5b9a\u5230\u4e00\u4e2a\u5bbf\u4e3b\u8fde\u63a5\u3002',
        '\u5bbf\u4e3b ID: ' + id,
        '\u5bbf\u4e3b\u540d\u79f0: ' + (this.hostName(id) || id),
        '\u5206\u7c7b: ' + (entry.category || ''),
        '\u8fde\u63a5\u65b9\u5f0f: ' + (entry.connector || entry.connectorLabel || ''),
        '\u5b89\u88c5\u6a21\u5f0f: ' + (entry.installMode || ''),
        '\u6765\u6e90: ' + (entry.source || ''),
        '\u4e91\u7aef\u7248\u672c: ' + (entry.cloudVersion || ''),
        '\u95e8\u7981\u7ec4: ' + groupLabels.join(', '),
        guideLines.join('\n'),
        '\u63a2\u6d4b\u72b6\u6001: ' + (probe.ok === true ? 'connected' : probe.ok === false ? 'failed' : 'unknown'),
        '\u63a2\u6d4b\u4fe1\u606f: ' + (probe.message || status.error || ''),
        '\u9a8c\u6536\u72b6\u6001: ' + (acceptance.ok === true ? 'passed' : acceptance.ok === false ? 'failed' : 'not_recorded'),
        '\u9a8c\u6536\u8bc1\u636e: ' + (acceptance.message || ''),
        '\u5982\u679c\u7528\u6237\u8981\u5b89\u88c5\u3001\u542f\u52a8\u3001\u5173\u95ed\u3001\u63a2\u6d4b\u6216\u4fee\u590d\u8fd9\u4e2a\u5bbf\u4e3b\uff0c\u4f18\u5148\u4f7f\u7528 ac.companion.host_bridge.* \u5de5\u5177\uff0c\u6210\u529f\u9a8c\u6536\u5fc5\u987b\u6765\u81ea\u771f\u5b9e\u8f6f\u4ef6\u8fde\u63a5\u4fe1\u53f7\u3002',
      ];
      return lines.filter((x) => String(x || '').trim()).join('\n');
    },

    openBridgeCopilotSession(id) {
      const hostId = String(id || '').trim();
      if (!hostId || typeof window.__acOpenCopilotObjectSession !== 'function') return;
      void window.__acOpenCopilotObjectSession({
        type: 'host',
        id: hostId,
        label: this.hostName(hostId) || hostId,
        contextPrompt: this.bridgeCopilotContext(hostId),
      });
    },

    localizeBridgeCards() {
      const root = $('bridgesList');
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const original = node.nodeValue || '';
        const next = this.translateBridgeText(original);
        if (next !== original) node.nodeValue = next;
      });
    },

    statusForBridge(id) {
      if (id === 'maya') return this._mayaStatus || {};
      if (id === 'blender') return this._blenderStatus || {};
      if (id === '3ds-max') return this._maxStatus || {};
      if (id === 'cinema-4d') return this._cinema4dStatus || {};
      if (id === 'substance-painter') return this._substanceStatus || {};
      if (id === 'substance-designer') return this._substanceDesignerStatus || {};
      if (id === 'mari') return this._mariStatus || {};
      if (id === 'krita') return this._kritaStatus || {};
      if (id === 'gimp') return this._gimpStatus || {};
      if (id === 'aseprite') return this._asepriteStatus || {};
      if (id === 'moho') return this._mohoStatus || {};
      if (id === 'toon-boom-harmony') return this._toonBoomHarmonyStatus || {};
      if (id === 'opentoonz') return this._openToonzStatus || {};
      if (id === 'cavalry') return this._cavalryStatus || {};
      if (id === 'tvpaint') return this._tvPaintStatus || {};
      if (id === 'houdini') return this._houdiniStatus || {};
      if (id === 'nuke') return this._nukeStatus || {};
      if (id === 'nuke-studio') return this._nukeStudioStatus || {};
      if (id === 'hiero') return this._hieroStatus || {};
      if (id === 'natron') return this._natronStatus || {};
      if (id === 'obs-studio') return this._obsStudioStatus || {};
      if (id === 'reaper') return this._reaperStatus || {};
      if (id === 'davinci-resolve') return this._davinciStatus || {};
      if (id === 'fusion-studio') return this._fusionStudioStatus || {};
      if (id === 'inkscape') return this._inkscapeStatus || {};
      if (this.isAdobeBridge(id)) return this[this.adobeStatusKey(id)] || {};
      if (id === 'unity') return this._unityStatus || {};
      if (id === 'godot') return this._godotStatus || {};
      if (id === 'motionbuilder') return this._motionBuilderStatus || {};
      if (id === 'fusion-360') return this._fusion360Status || {};
      if (id === 'keyshot') return this._keyShotStatus || {};
      if (id === 'marmoset-toolbag') return this._marmosetToolbagStatus || {};
      if (id === 'modo') return this._modoStatus || {};
      if (id === 'lightwave') return this._lightWaveStatus || {};
      if (id === 'freecad') return this._freeCADStatus || {};
      if (id === 'autocad') return this._autoCADStatus || {};
      if (id === 'zbrush') return this._zbrushStatus || {};
      if (id === 'unreal') return this._unrealStatus || {};
      if (id === 'rhino') return this._rhinoStatus || {};
      if (id === 'sketchup') return this._sketchupStatus || {};
      if (id === 'marvelous-designer') return this._marvelousDesignerStatus || {};
      if (id === 'clo') return this._cloStatus || {};
      if (id === 'rizomuv') return this._rizomUvStatus || {};
      if (id === 'daz-studio') return this._dazStudioStatus || {};
      if (id === 'poser') return this._poserStatus || {};
      if (id === 'iclone') return this._icloneStatus || {};
      if (id === 'character-creator') return this._characterCreatorStatus || {};
      if (id === 'metashape') return this._metashapeStatus || {};
      if (id === '3dequalizer') return this._threeDequalizerStatus || {};
      if (id === 'katana') return this._katanaStatus || {};
      if (id === 'lightroom-classic') return this._lightroomStatus || {};
      if (id === 'darktable') return this._darktableStatus || {};
      if (id === 'vegas-pro') return this._vegasProStatus || {};
      if (id === 'synfig') return this._synfigStatus || {};
      return {};
    },

    formatAcceptanceTime(value) {
      if (!value) return '';
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return String(value);
      return d.toLocaleString();
    },

    acceptanceGroupLabel(group) {
      const id = String((group && group.id) || '');
      const labels = {
        maya: 'Maya',
        adobe: 'Adobe',
        python_dcc: 'Python DCC',
        lua_heartbeat: 'Lua/heartbeat',
        project_plugin: '\u9879\u76ee\u63d2\u4ef6',
        manual_script_dir: '\u624b\u52a8\u811a\u672c\u76ee\u5f55',
        paired_software: '\u6210\u5bf9\u8f6f\u4ef6',
      };
      return labels[id] || (group && group.label) || id || '\u672a\u77e5\u95e8\u7981';
    },

    acceptanceSummaryGroups() {
      const summary = this._acceptanceSummary;
      return summary && Array.isArray(summary.groups) ? summary.groups : [];
    },

    renderAcceptanceGateSummary() {
      const summary = this._acceptanceSummary;
      const groups = this.acceptanceSummaryGroups();
      if (!summary || !groups.length) return '';
      const accepted = Number(summary.acceptedGroups || 0);
      const required = Number(summary.requiredGroups || groups.length || 0);
      const gateState = summary.ok ? '\u5df2\u8fbe\u6210' : '\u5f85\u9a8c\u6536';
      const groupHtml = groups
        .map((group) => {
          const acceptedHosts = Array.isArray(group.acceptedHosts) ? group.acceptedHosts : [];
          const missingHosts = Array.isArray(group.missingHosts) ? group.missingHosts : [];
          const sampleHosts = (group.ok ? acceptedHosts : missingHosts).slice(0, 3).map((id) => this.hostName(id));
          const jumpHost = (group.ok ? acceptedHosts[0] : missingHosts[0]) || '';
          const title =
            (group.ok ? '\u5df2\u901a\u8fc7\uff1a' : '\u5f85\u9a8c\u6536\uff1a') +
            (sampleHosts.length ? sampleHosts.join('\u3001') : '-');
          return (
            '<button type="button" class="bridges-acceptance-gate-item ' +
            (group.ok ? 'ok' : 'todo') +
            '"' +
            (jumpHost ? ' data-bridge-jump="' + esc(jumpHost) + '"' : '') +
            (!group.ok && jumpHost ? ' data-bridge-acceptance-guide="1"' : '') +
            ' title="' +
            esc(title) +
            '">' +
            esc(this.acceptanceGroupLabel(group)) +
            '<small>' +
            esc(group.ok ? '\u5df2\u9a8c\u6536' : '\u5f85\u9a8c\u6536') +
            '</small></button>'
          );
        })
        .join('');
      return (
        '<div class="bridges-acceptance-gate">' +
        '<div class="bridges-acceptance-gate-head"><strong>\u771f\u5b9e\u8f6f\u4ef6\u9a8c\u6536 ' +
        esc(String(accepted)) +
        '/' +
        esc(String(required)) +
        '</strong><span>' +
        esc(gateState) +
        '</span></div><div class="bridges-acceptance-gate-list">' +
        groupHtml +
        '</div></div>'
      );
    },

    detailWithAcceptance(id, detail) {
      const st = this.statusForBridge(id);
      const rec = st && st.acceptance;
      const localizedDetail = this.translateBridgeText(detail || '');
      if (!rec || !rec.checkedAt) return localizedDetail || '';
      const label = rec.ok ? 'Last verified' : 'Last failed';
      const parts = [localizedDetail || '', this.translateBridgeText(label + ': ' + this.formatAcceptanceTime(rec.checkedAt))];
      if (rec.message) parts.push(this.translateBridgeText(rec.message));
      return parts.filter(Boolean).join('\n');
    },

    async recordBridgeProbe(shell, id, ui) {
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/acceptance', {
          ok: ui && ui.key === 'connected',
          message: ui && ui.detail ? String(ui.detail) : '',
        });
        if (r && r.ok) {
          const st = this.statusForBridge(id);
          if (st && r.json && r.json.acceptance) st.acceptance = r.json.acceptance;
        }
      } catch {
        /* acceptance is best-effort; probing result still matters */
      }
    },

    hostOrder() {
      return [
        'maya',
        'blender',
        '3ds-max',
        'cinema-4d',
        'houdini',
        'zbrush',
        'substance-painter',
        'substance-designer',
        'mari',
        'krita',
        'gimp',
        'aseprite',
        'moho',
        'toon-boom-harmony',
        'opentoonz',
        'cavalry',
        'tvpaint',
        'rhino',
        'sketchup',
        'marvelous-designer',
        'clo',
        'rizomuv',
        'daz-studio',
        'poser',
        'iclone',
        'character-creator',
        'metashape',
        '3dequalizer',
        'katana',
        'unreal',
        'motionbuilder',
        'godot',
        'fusion-360',
        'keyshot',
        'marmoset-toolbag',
        'modo',
        'lightwave',
        'freecad',
        'autocad',
        'unity',
        'photoshop',
        'illustrator',
        'inkscape',
        'after-effects',
        'premiere',
        'indesign',
        'audition',
        'media-encoder',
        'animate',
        'adobe-bridge',
        'lightroom-classic',
        'darktable',
        'davinci-resolve',
        'fusion-studio',
        'nuke',
        'nuke-studio',
        'hiero',
        'natron',
        'obs-studio',
        'reaper',
        'vegas-pro',
        'synfig',
      ];
    },

    bridgeFilterOptions() {
      return [
        { id: 'all', label: '\u5168\u90e8' },
        { id: '3d', label: '3D' },
        { id: 'paint', label: '\u7ed8\u5236/\u6750\u8d28' },
        { id: 'engine', label: '\u5f15\u64ce' },
        { id: 'post', label: '\u540e\u671f' },
        { id: 'compositing', label: '\u5408\u6210' },
      ];
    },

    categoryForBridge(id) {
      const key = String(id || '');
      const catalog = []
        .concat(this._bridgeCatalog || [])
        .concat(HOST_CENTER_FALLBACK_CATALOG || []);
      const found = catalog.find((item) => item && item.id === key && item.category);
      if (found) return found.category;
      if (key === 'maya') return '3d';
      return '';
    },

    bridgeSoftwareFilterOptions(category) {
      const activeCategory = category || this._bridgeFilter || 'all';
      const ids = this.hostOrder().filter((id) => {
        return activeCategory === 'all' || this.categoryForBridge(id) === activeCategory;
      });
      return [{ id: 'all', label: '\u5168\u90e8\u8f6f\u4ef6' }].concat(
        ids.map((id) => ({ id, label: this.hostName(id) })),
      );
    },

    renderBridgeFilters() {
      const bar = $('bridgesFilterBar');
      if (!bar) return;
      const active = this.bridgeFilterOptions().some((item) => item.id === this._bridgeFilter) ? this._bridgeFilter : 'all';
      this._bridgeFilter = active;
      const softwareOptions = this.bridgeSoftwareFilterOptions(active);
      if (!softwareOptions.some((item) => item.id === this._bridgeSoftwareFilter)) this._bridgeSoftwareFilter = 'all';
      const activeSoftware = this._bridgeSoftwareFilter || 'all';
      bar.innerHTML =
        '<div class="bridges-search-row">' +
        '<input type="search" class="bridges-search-input" id="bridgesSearchInput" placeholder="\u641c\u7d22\u5bbf\u4e3b\u6216\u8fde\u63a5\u65b9\u5f0f" value="' +
        esc(this._bridgeSearchQuery || '') +
        '" />' +
        '</div>' +
        '<div class="bridges-filter-row"><div class="bridges-filter-tabs" role="tablist" aria-label="Host category filters">' +
        this.bridgeFilterOptions()
          .map((item) => {
            const on = item.id === active;
            return (
              '<button type="button" class="bridges-filter-tab' +
              (on ? ' is-active' : '') +
              '" data-bridge-filter="' +
              esc(item.id) +
              '" aria-pressed="' +
              (on ? 'true' : 'false') +
              '">' +
              esc(item.label) +
              '</button>'
            );
          })
          .join('') +
        '</div><div class="bridges-filter-count" id="bridgesFilterCount"></div></div>' +
        '<div class="bridges-filter-row software"><div class="bridges-filter-tabs software" role="tablist" aria-label="Host software filters">' +
        softwareOptions
          .map((item) => {
            const on = item.id === activeSoftware;
            return (
              '<button type="button" class="bridges-filter-tab' +
              (on ? ' is-active' : '') +
              '" data-bridge-software-filter="' +
              esc(item.id) +
              '" aria-pressed="' +
              (on ? 'true' : 'false') +
              '">' +
              esc(item.label) +
              '</button>'
            );
          })
          .join('') +
        '</div></div>';
      bar.querySelectorAll('[data-bridge-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._bridgeFilter = btn.getAttribute('data-bridge-filter') || 'all';
          this._bridgeSoftwareFilter = 'all';
          this.renderBridgeFilters();
          this.applyBridgeFilter();
        });
      });
      const search = $('bridgesSearchInput');
      if (search) {
        search.addEventListener('input', () => {
          this._bridgeSearchQuery = String(search.value || '');
          this.applyBridgeFilter();
        });
      }
      bar.querySelectorAll('[data-bridge-software-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._bridgeSoftwareFilter = btn.getAttribute('data-bridge-software-filter') || 'all';
          this.renderBridgeFilters();
          this.applyBridgeFilter();
        });
      });
    },

    applyBridgeFilter() {
      const active = this._bridgeFilter || 'all';
      const activeSoftware = this._bridgeSoftwareFilter || 'all';
      const query = String(this._bridgeSearchQuery || '').trim().toLowerCase();
      const cards = Array.from(document.querySelectorAll('#bridgesList .bridge-card[data-bridge-id]'));
      let visible = 0;
      cards.forEach((card) => {
        const id = card.getAttribute('data-bridge-id');
        const category = this.categoryForBridge(id);
        const categoryMatch = active === 'all' || category === active;
        const softwareMatch = activeSoftware === 'all' || id === activeSoftware;
        const searchable = [
          id,
          category,
          this.hostName(id),
          card.textContent || '',
        ].join(' ').toLowerCase();
        const searchMatch = !query || searchable.indexOf(query) >= 0;
        const show = categoryMatch && softwareMatch && searchMatch;
        card.setAttribute('data-bridge-category', category || 'other');
        card.hidden = !show;
        card.style.display = show ? '' : 'none';
        if (show) visible += 1;
      });
      const count = $('bridgesFilterCount');
      if (count) count.textContent = String(visible) + ' / ' + String(cards.length);
    },

    hostName(id) {
      const found = (this._bridgeCatalog || []).find((item) => item && item.id === id);
      if (found && found.name) return found.name;
      if (id === 'maya') return 'Maya';
      if (id === '3ds-max') return '3ds Max';
      if (id === 'cinema-4d') return 'Cinema 4D';
      if (id === 'substance-painter') return 'Substance Painter';
      if (id === 'substance-designer') return 'Substance Designer';
      if (id === 'mari') return 'Mari';
      if (id === 'krita') return 'Krita';
      if (id === 'gimp') return 'GIMP';
      if (id === 'aseprite') return 'Aseprite';
      if (id === 'moho') return 'Moho';
      if (id === 'toon-boom-harmony') return 'Toon Boom Harmony';
      if (id === 'opentoonz') return 'OpenToonz';
      if (id === 'cavalry') return 'Cavalry';
      if (id === 'tvpaint') return 'TVPaint Animation';
      if (id === 'godot') return 'Godot';
      if (id === 'motionbuilder') return 'MotionBuilder';
      if (id === 'fusion-360') return 'Fusion 360';
      if (id === 'keyshot') return 'KeyShot';
      if (id === 'marmoset-toolbag') return 'Marmoset Toolbag';
      if (id === 'modo') return 'Modo';
      if (id === 'lightwave') return 'LightWave 3D';
      if (id === 'freecad') return 'FreeCAD';
      if (id === 'autocad') return 'AutoCAD';
      if (id === 'illustrator') return 'Illustrator';
      if (id === 'inkscape') return 'Inkscape';
      if (id === 'after-effects') return 'After Effects';
      if (id === 'premiere') return 'Premiere Pro';
      if (id === 'indesign') return 'InDesign';
      if (id === 'audition') return 'Audition';
      if (id === 'media-encoder') return 'Media Encoder';
      if (id === 'animate') return 'Animate';
      if (id === 'adobe-bridge') return 'Adobe Bridge';
      if (id === 'davinci-resolve') return 'DaVinci Resolve';
      if (id === 'fusion-studio') return 'Fusion Studio';
      if (id === 'nuke-studio') return 'Nuke Studio';
      if (id === 'hiero') return 'Hiero';
      if (id === 'natron') return 'Natron';
      if (id === 'obs-studio') return 'OBS Studio';
      if (id === 'reaper') return 'REAPER';
      if (id === 'rhino') return 'Rhino';
      if (id === 'sketchup') return 'SketchUp';
      if (id === 'marvelous-designer') return 'Marvelous Designer';
      if (id === 'clo') return 'CLO';
      if (id === 'rizomuv') return 'RizomUV';
      if (id === 'daz-studio') return 'Daz Studio';
      if (id === 'poser') return 'Poser';
      if (id === 'iclone') return 'iClone';
      if (id === 'character-creator') return 'Character Creator';
      if (id === 'metashape') return 'Metashape';
      if (id === '3dequalizer') return '3DEqualizer';
      if (id === 'katana') return 'Katana';
      if (id === 'lightroom-classic') return 'Lightroom Classic';
      if (id === 'darktable') return 'darktable';
      if (id === 'vegas-pro') return 'VEGAS Pro';
      if (id === 'synfig') return 'Synfig Studio';
      return String(id || '').replace(/(^|-)([a-z])/g, (_m, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());
    },

    uiStateForBridge(id) {
      if (id === 'maya') return this.mayaUiState();
      if (id === 'blender') return this.blenderUiState();
      if (id === '3ds-max') return this.maxUiState();
      if (id === 'cinema-4d') return this.cinema4dUiState();
      if (id === 'houdini') return this.houdiniUiState();
      if (id === 'zbrush') return this.zbrushUiState();
      if (id === 'substance-painter') return this.substancePainterUiState();
      if (id === 'substance-designer') return this.substanceDesignerUiState();
      if (id === 'mari') return this.mariUiState();
      if (id === 'krita') return this.kritaUiState();
      if (id === 'gimp') return this.gimpUiState();
      if (id === 'aseprite') return this.asepriteUiState();
      if (id === 'moho') return this.mohoUiState();
      if (id === 'toon-boom-harmony') return this.toonBoomHarmonyUiState();
      if (id === 'opentoonz') return this.openToonzUiState();
      if (id === 'cavalry') return this.cavalryUiState();
      if (id === 'tvpaint') return this.tvPaintUiState();
      if (id === 'unreal') return this.unrealUiState();
      if (id === 'unity') return this.unityUiState();
      if (id === 'godot') return this.godotUiState();
      if (id === 'motionbuilder') return this.motionBuilderUiState();
      if (id === 'fusion-360') return this.fusion360UiState();
      if (id === 'keyshot') return this.keyShotUiState();
      if (id === 'marmoset-toolbag') return this.marmosetToolbagUiState();
      if (id === 'modo') return this.modoUiState();
      if (id === 'lightwave') return this.lightWaveUiState();
      if (id === 'freecad') return this.freeCADUiState();
      if (id === 'autocad') return this.autoCADUiState();
      if (id === 'inkscape') return this.inkscapeUiState();
      if (this.isAdobeBridge(id)) return this.adobeUiState(id);
      if (id === 'davinci-resolve') return this.davinciResolveUiState();
      if (id === 'fusion-studio') return this.fusionStudioUiState();
      if (id === 'nuke') return this.nukeUiState();
      if (id === 'nuke-studio' || id === 'hiero') return this.foundryTimelineUiState(id);
      if (id === 'natron') return this.natronUiState();
      if (id === 'obs-studio') return this.obsStudioUiState();
      if (id === 'reaper') return this.reaperUiState();
      if (id === 'rhino') return this.rhinoUiState();
      if (id === 'sketchup') return this.sketchUpUiState();
      if (id === 'marvelous-designer' || id === 'clo') return this.cloMarvelousUiState(id);
      if (id === 'rizomuv') return this.rizomUvUiState();
      if (id === 'daz-studio') return this.dazStudioUiState();
      if (id === 'poser') return this.poserUiState();
      if (id === 'iclone' || id === 'character-creator') return this.reallusionUiState(id);
      if (id === 'metashape') return this.metashapeUiState();
      if (id === '3dequalizer') return this.threeDequalizerUiState();
      if (id === 'katana') return this.katanaUiState();
      if (id === 'lightroom-classic') return this.lightroomUiState();
      if (id === 'darktable') return this.darktableUiState();
      if (id === 'vegas-pro') return this.vegasProUiState();
      if (id === 'synfig') return this.synfigUiState();
      return { key: 'pending', label: 'Pending', detail: '' };
    },

    buildBridgeAcceptanceReport() {
      const lines = [];
      lines.push('AssetCutter 宿主中心验收报告');
      lines.push('生成时间：' + new Date().toLocaleString());
      lines.push('');
      const summary = this._acceptanceSummary;
      const groups = this.acceptanceSummaryGroups();
      if (summary && groups.length) {
        lines.push('真实软件验收：' + Number(summary.acceptedGroups || 0) + '/' + Number(summary.requiredGroups || groups.length));
        for (const group of groups) {
          const acceptedHosts = Array.isArray(group.acceptedHosts) ? group.acceptedHosts : [];
          const missingHosts = Array.isArray(group.missingHosts) ? group.missingHosts : [];
          const hosts = (group.ok ? acceptedHosts : missingHosts).slice(0, 6).map((id) => this.hostName(id));
          lines.push(
            '  ' +
              this.acceptanceGroupLabel(group) +
              ': ' +
              (group.ok ? '已验收' : '待验收') +
              (hosts.length ? ' - ' + hosts.join(', ') : ''),
          );
        }
        lines.push('');
      }
      for (const id of this.hostOrder()) {
        const st = this.statusForBridge(id);
        const ui = this.uiStateForBridge(id);
        const rec = st && st.acceptance;
        const installed = st && st.installed ? '已安装' : '未安装';
        const verified = rec && rec.ok ? '已验收' : rec && rec.checkedAt ? '失败' : '未验收';
        lines.push(this.hostName(id) + ' [' + id + ']');
        lines.push('  status: ' + (ui.label || ui.key || '未知'));
        lines.push('  install: ' + installed);
        lines.push('  acceptance: ' + verified + (rec && rec.checkedAt ? ' at ' + this.formatAcceptanceTime(rec.checkedAt) : ''));
        if (rec && rec.message) lines.push('  message: ' + rec.message);
        else if (ui.detail) lines.push('  message: ' + ui.detail);
        lines.push('');
      }
      return lines.join('\n').trim();
    },

    copyAcceptanceReport(shell) {
      const text = this.buildBridgeAcceptanceReport();
      if (shell && typeof shell.copyText === 'function') {
        shell.copyText(text);
        window.alert('宿主验收报告已复制。');
        return;
      }
      window.alert(text);
    },

    jumpToBridgeCard(id, opts) {
      const card = document.querySelector('.bridge-card[data-bridge-id="' + String(id || '').replace(/"/g, '\\"') + '"]');
      if (!card) return;
      if (card.hidden) {
        this._bridgeFilter = 'all';
        this._bridgeSoftwareFilter = 'all';
        this._bridgeSearchQuery = '';
        this.renderBridgeFilters();
        this.applyBridgeFilter();
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('is-jump-focus');
      window.setTimeout(() => card.classList.remove('is-jump-focus'), 1200);
      if (typeof window.__acOpenCopilotObjectSession === 'function') {
        const hostId = String(id || '').trim();
        const prompt =
          opts && opts.acceptanceGuide
            ? '\u5e26\u6211\u5b8c\u6210\u8fd9\u4e2a\u5bbf\u4e3b\u7684\u771f\u5b9e\u8f6f\u4ef6\u9a8c\u6536\uff0c\u5148\u68c0\u67e5\u5f53\u524d\u72b6\u6001\uff0c\u518d\u5f15\u5bfc\u6211\u5b89\u88c5\u3001\u542f\u52a8\u548c\u63a2\u6d4b\u3002'
            : '';
        void window.__acOpenCopilotObjectSession({
          type: 'host',
          id: hostId,
          label: this.hostName(hostId) || hostId,
          contextPrompt: this.bridgeCopilotContext(hostId),
          prompt,
        });
      }
    },

    async refreshBridgeById(shell, id) {
      if (id === 'maya') {
        await this.refreshMaya(shell);
        const port = parsePort($('mayaBridgePort')) || ((this._mayaStatus || {}).port || 7001);
        const probeR = await shell.api(
          'GET',
          '/v1/script-connectors?mayaHost=127.0.0.1&mayaPort=' + encodeURIComponent(String(port)) + '&bustCache=1',
          null,
        );
        this._probe = probeR.ok && probeR.json ? probeR.json : null;
        return;
      }
      if (id === 'blender') return this.refreshBlender(shell);
      if (id === '3ds-max') return this.refreshMax(shell);
      if (id === 'cinema-4d') return this.refreshCinema4D(shell);
      if (id === 'houdini') return this.refreshHoudini(shell);
      if (id === 'zbrush') return this.refreshZBrush(shell);
      if (id === 'substance-painter') return this.refreshSubstancePainter(shell);
      if (id === 'substance-designer') return this.refreshSubstanceDesigner(shell);
      if (id === 'mari') return this.refreshMari(shell);
      if (id === 'krita') return this.refreshKrita(shell);
      if (id === 'gimp') return this.refreshGimp(shell);
      if (id === 'aseprite') return this.refreshAseprite(shell);
      if (id === 'moho') return this.refreshMoho(shell);
      if (id === 'toon-boom-harmony') return this.refreshToonBoomHarmony(shell);
      if (id === 'opentoonz') return this.refreshOpenToonz(shell);
      if (id === 'cavalry') return this.refreshCavalry(shell);
      if (id === 'tvpaint') return this.refreshTvPaint(shell);
      if (id === 'unreal') return this.refreshUnreal(shell);
      if (id === 'rhino') return this.refreshRhino(shell);
      if (id === 'sketchup') return this.refreshSketchUp(shell);
      if (id === 'marvelous-designer' || id === 'clo') return this.refreshCloMarvelous(shell, id);
      if (id === 'rizomuv') return this.refreshRizomUv(shell);
      if (id === 'daz-studio') return this.refreshDazStudio(shell);
      if (id === 'poser') return this.refreshPoser(shell);
      if (id === 'iclone' || id === 'character-creator') return this.refreshReallusion(shell, id);
      if (id === 'metashape') return this.refreshMetashape(shell);
      if (id === '3dequalizer') return this.refreshThreeDequalizer(shell);
      if (id === 'katana') return this.refreshKatana(shell);
      if (id === 'godot') return this.refreshGodot(shell);
      if (id === 'motionbuilder') return this.refreshMotionBuilder(shell);
      if (id === 'fusion-360') return this.refreshFusion360(shell);
      if (id === 'keyshot') return this.refreshKeyShot(shell);
      if (id === 'marmoset-toolbag') return this.refreshMarmosetToolbag(shell);
      if (id === 'modo') return this.refreshModo(shell);
      if (id === 'lightwave') return this.refreshLightWave(shell);
      if (id === 'freecad') return this.refreshFreeCAD(shell);
      if (id === 'autocad') return this.refreshAutoCAD(shell);
      if (id === 'unity') return this.refreshUnity(shell);
      if (id === 'inkscape') return this.refreshInkscape(shell);
      if (this.isAdobeBridge(id)) return this.refreshAdobeBridge(shell, id);
      if (id === 'lightroom-classic') return this.refreshLightroom(shell);
      if (id === 'darktable') return this.refreshDarktable(shell);
      if (id === 'davinci-resolve') return this.refreshDavinciResolve(shell);
      if (id === 'fusion-studio') return this.refreshFusionStudio(shell);
      if (id === 'nuke') return this.refreshNuke(shell);
      if (id === 'nuke-studio' || id === 'hiero') return this.refreshFoundryTimeline(shell, id);
      if (id === 'natron') return this.refreshNatron(shell);
      if (id === 'obs-studio') return this.refreshObsStudio(shell);
      if (id === 'reaper') return this.refreshReaper(shell);
      if (id === 'vegas-pro') return this.refreshVegasPro(shell);
      if (id === 'synfig') return this.refreshSynfig(shell);
    },

    async probeBridgeById(shell, id) {
      await this.refreshBridgeById(shell, id);
      const ui = this.uiStateForBridge(id);
      await this.recordBridgeProbe(shell, id, ui);
      return { id, ui };
    },

    async probeAllBridges(shell) {
      if (this._busy) return;
      this._busy = true;
      this._bulkProgress = { mode: '批量探测', index: 0, total: this.hostOrder().length, host: '' };
      const results = [];
      try {
        const ids = this.hostOrder();
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          this._bulkProgress = { mode: '批量探测', index: i + 1, total: ids.length, host: this.hostName(id) };
          this.render();
          try {
            const result = await this.probeBridgeById(shell, id);
            results.push(result);
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e || '探测失败');
            const ui = { key: 'failed', label: '失败', detail };
            await this.recordBridgeProbe(shell, id, ui);
            results.push({ id, ui });
          }
          this.render();
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        const ok = results.filter((x) => x.ui && x.ui.key === 'connected').length;
        const failed = results.length - ok;
        const failedHosts = results
          .filter((x) => !(x.ui && x.ui.key === 'connected'))
          .map((x) => this.hostName(x.id))
          .slice(0, 6);
        this._bulkSummary = { mode: '批量探测', ok, failed, skipped: 0, total: results.length, hosts: failedHosts };
        window.alert('批量探测完成：' + ok + '/' + results.length + ' 已验收。');
      } finally {
        this._busy = false;
        this._bulkProgress = null;
        await this.reload(shell);
      }
    },

    bridgePort(id) {
      const st = this.statusForBridge(id);
      if (id === 'maya') return Number(st.port || st.defaultPort || 7001);
      if (id === 'blender') return Number(st.port || st.defaultPort || 7011);
      if (id === '3ds-max') return Number(st.port || st.defaultPort || 7021);
      if (id === 'substance-painter') return Number(st.port || st.defaultPort || 7031);
      if (id === 'substance-designer') return Number(st.port || st.defaultPort || 7341);
      if (id === 'mari') return Number(st.port || st.defaultPort || 7231);
      if (id === 'krita') return Number(st.port || st.defaultPort || 7221);
      if (id === 'gimp') return Number(st.port || st.defaultPort || 7251);
      if (id === 'aseprite') return Number(st.port || st.defaultPort || 7381);
      if (id === 'moho') return Number(st.port || st.defaultPort || 7401);
      if (id === 'toon-boom-harmony') return Number(st.port || st.defaultPort || 7411);
      if (id === 'opentoonz') return Number(st.port || st.defaultPort || 7421);
      if (id === 'cavalry') return Number(st.port || st.defaultPort || 7431);
      if (id === 'tvpaint') return Number(st.port || st.defaultPort || 7481);
      if (id === 'houdini') return Number(st.port || st.defaultPort || 7041);
      if (id === 'nuke') return Number(st.port || st.defaultPort || 7051);
      if (id === 'natron') return Number(st.port || st.defaultPort || 7261);
      if (id === 'obs-studio') return Number(st.port || st.defaultPort || 7351);
      if (id === 'reaper') return Number(st.port || st.defaultPort || 7361);
      if (id === 'cinema-4d') return Number(st.port || st.defaultPort || 7061);
      if (id === 'davinci-resolve') return Number(st.port || st.defaultPort || 7071);
      if (id === 'fusion-studio') return Number(st.port || st.defaultPort || 7391);
      if (id === 'nuke-studio') return Number(st.port || st.defaultPort || 7581);
      if (id === 'hiero') return Number(st.port || st.defaultPort || 7591);
      if (id === 'photoshop') return Number(st.port || st.defaultPort || 7081);
      if (id === 'illustrator') return Number(st.port || st.defaultPort || 7161);
      if (id === 'inkscape') return Number(st.port || st.defaultPort || 7241);
      if (id === 'after-effects') return Number(st.port || st.defaultPort || 7091);
      if (id === 'premiere') return Number(st.port || st.defaultPort || 7101);
      if (id === 'indesign') return Number(st.port || st.defaultPort || 7301);
      if (id === 'audition') return Number(st.port || st.defaultPort || 7311);
      if (id === 'media-encoder') return Number(st.port || st.defaultPort || 7321);
      if (id === 'animate') return Number(st.port || st.defaultPort || 7331);
      if (id === 'adobe-bridge') return Number(st.port || st.defaultPort || 7601);
      if (id === 'lightroom-classic') return Number(st.port || st.defaultPort || 7561);
      if (id === 'darktable') return Number(st.port || st.defaultPort || 7611);
      if (id === 'unity') return Number(st.port || st.defaultPort || 7111);
      if (id === 'zbrush') return Number(st.port || st.defaultPort || 7121);
      if (id === 'unreal') return Number(st.port || st.defaultPort || 7131);
      if (id === 'rhino') return Number(st.port || st.defaultPort || 7141);
      if (id === 'sketchup') return Number(st.port || st.defaultPort || 7151);
      if (id === 'marvelous-designer') return Number(st.port || st.defaultPort || 7441);
      if (id === 'clo') return Number(st.port || st.defaultPort || 7451);
      if (id === 'rizomuv') return Number(st.port || st.defaultPort || 7461);
      if (id === 'daz-studio') return Number(st.port || st.defaultPort || 7501);
      if (id === 'poser') return Number(st.port || st.defaultPort || 7511);
      if (id === 'iclone') return Number(st.port || st.defaultPort || 7521);
      if (id === 'character-creator') return Number(st.port || st.defaultPort || 7531);
      if (id === 'metashape') return Number(st.port || st.defaultPort || 7541);
      if (id === '3dequalizer') return Number(st.port || st.defaultPort || 7551);
      if (id === 'katana') return Number(st.port || st.defaultPort || 7571);
      if (id === 'godot') return Number(st.port || st.defaultPort || 7171);
      if (id === 'motionbuilder') return Number(st.port || st.defaultPort || 7181);
      if (id === 'fusion-360') return Number(st.port || st.defaultPort || 7191);
      if (id === 'keyshot') return Number(st.port || st.defaultPort || 7201);
      if (id === 'marmoset-toolbag') return Number(st.port || st.defaultPort || 7211);
      if (id === 'modo') return Number(st.port || st.defaultPort || 7271);
      if (id === 'lightwave') return Number(st.port || st.defaultPort || 7281);
      if (id === 'freecad') return Number(st.port || st.defaultPort || 7291);
      if (id === 'autocad') return Number(st.port || st.defaultPort || 7371);
      if (id === 'vegas-pro') return Number(st.port || st.defaultPort || 7471);
      if (id === 'synfig') return Number(st.port || st.defaultPort || 7491);
      return 7001;
    },

    installPayloadForBridge(id) {
      const st = this.statusForBridge(id);
      const port = this.bridgePort(id);
      if (id === 'maya' || id === 'blender' || id === '3ds-max' || id === 'motionbuilder') {
        const versions = Array.isArray(st.versions) ? st.versions.map((x) => x && x.id).filter(Boolean) : [];
        return versions.length ? { payload: { versions, port }, count: versions.length } : null;
      }
      const targets = Array.isArray(st.targets) ? st.targets.map((x) => x && x.id).filter(Boolean) : [];
      return targets.length ? { payload: { targets, port }, count: targets.length } : null;
    },

    async installBridgeById(shell, id) {
      const prepared = this.installPayloadForBridge(id);
      if (!prepared) return { id, skipped: true, ok: false, message: '未检测到可安装目标。' };
      const r = await shell.api('POST', '/v1/bridges/' + id + '/install', prepared.payload);
      if (!r.ok) {
        return {
          id,
          skipped: false,
          ok: false,
          message: (r.json && (r.json.message || r.json.error)) || r.error || '安装失败',
        };
      }
      return {
        id,
        skipped: false,
        ok: true,
        message: (r.json && r.json.message) || '已安装',
      };
    },

    async installAllDetectedBridges(shell) {
      if (this._busy) return;
      if (!window.confirm('将 AssetCutter 桥接安装到所有已检测到的宿主目标？未检测到目录或项目的宿主会跳过。')) return;
      this._busy = true;
      this._bulkProgress = { mode: '批量安装', index: 0, total: this.hostOrder().length, host: '' };
      const results = [];
      try {
        const ids = this.hostOrder();
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          this._bulkProgress = { mode: '批量安装', index: i + 1, total: ids.length, host: this.hostName(id) };
          this.render();
          try {
            results.push(await this.installBridgeById(shell, id));
          } catch (e) {
            results.push({
              id,
              skipped: false,
              ok: false,
              message: e instanceof Error ? e.message : String(e || '安装失败'),
            });
          }
          this.render();
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        const installed = results.filter((x) => x.ok).length;
        const skipped = results.filter((x) => x.skipped).length;
        const failed = results.filter((x) => !x.ok && !x.skipped).length;
        const focusHosts = results
          .filter((x) => !x.ok)
          .map((x) => this.hostName(x.id))
          .slice(0, 6);
        this._bulkSummary = { mode: '批量安装', ok: installed, failed, skipped, total: results.length, hosts: focusHosts };
        window.alert('批量安装完成：已安装 ' + installed + '，已跳过 ' + skipped + '，失败 ' + failed + '。');
      } finally {
        this._busy = false;
        this._bulkProgress = null;
        await this.reload(shell);
      }
    },

    renderAcceptanceSummary() {
      const el = $('bridgesAcceptanceSummary');
      if (!el) return;
      const rows = this.hostOrder().map((id) => {
        const st = this.statusForBridge(id);
        const rec = st && st.acceptance;
        const ui = this.uiStateForBridge(id);
        const state = rec && rec.ok ? 'ok' : rec && rec.checkedAt ? 'fail' : 'todo';
        return { id, name: this.hostName(id), state, ui, rec };
      });
      const ok = rows.filter((x) => x.state === 'ok').length;
      const fail = rows.filter((x) => x.state === 'fail').length;
      const todo = rows.length - ok - fail;
      const gateHtml = this.renderAcceptanceGateSummary();
      const progress = this._bulkProgress;
      const progressHtml = progress
        ? '<div class="bridges-acceptance-progress">' +
          esc(progress.mode + ' ' + progress.index + '/' + progress.total + (progress.host ? ' · ' + progress.host : '')) +
          '</div>'
        : '';
      const summary = this._bulkSummary;
      const summaryText = summary
        ? summary.mode +
          ': ' +
          summary.ok +
          '/' +
          summary.total +
          ' 成功' +
          (summary.skipped ? '，跳过 ' + summary.skipped : '') +
          (summary.failed ? '，失败 ' + summary.failed : '') +
          (summary.hosts && summary.hosts.length ? ' · ' + summary.hosts.join(', ') : '')
        : '';
      const summaryHtml = summaryText ? '<div class="bridges-acceptance-progress">' + esc(summaryText) + '</div>' : '';
      const cloudSync = this._cloudSyncSummary;
      const cloudSyncHtml =
        cloudSync && cloudSync.skipped
          ? '<div class="bridges-acceptance-progress">' +
            esc('云端同步跳过 ' + cloudSync.skipped + ' 个版本。请检查这些版本的宿主 id、模板和写入路径。') +
            '</div>'
          : '';
      const focus = rows.filter((x) => x.state !== 'ok').slice(0, 8);
      const list = (focus.length ? focus : rows.slice(0, 8))
        .map((x) => {
          const label = x.state === 'ok' ? '已验收' : x.state === 'fail' ? '失败' : x.ui.key === 'connected' ? '当前已连接' : '未验收';
          const title = x.rec && x.rec.message ? x.rec.message : x.ui.detail || '';
          return (
            '<button type="button" class="bridges-acceptance-item ' +
            esc(x.state) +
            '" data-bridge-jump="' +
            esc(x.id) +
            '" title="' +
            esc(title) +
            '">' +
            esc(x.name + ' · ' + label) +
            '</button>'
          );
        })
        .join('');
      el.innerHTML =
        '<div class="bridges-acceptance-head">' +
        '<div class="bridges-acceptance-title">宿主验收</div>' +
        '<div class="bridges-acceptance-actions"><div class="bridges-acceptance-meter">' +
        '<span class="bridges-acceptance-stat ok">' +
        esc(String(ok)) +
        ' 已验收</span>' +
        '<span class="bridges-acceptance-stat fail">' +
        esc(String(fail)) +
        ' 失败</span>' +
        '<span class="bridges-acceptance-stat todo">' +
        esc(String(todo)) +
        ' 待验收</span>' +
        '</div><button type="button" class="bridge-btn primary" id="btnBridgesInstallAll"' +
        (this._busy ? ' disabled' : '') +
        '>安装全部已检测</button><button type="button" class="bridge-btn primary" id="btnBridgesProbeAll"' +
        (this._busy ? ' disabled' : '') +
        '>探测全部</button><button type="button" class="bridge-btn" id="btnBridgesCopyReport">复制报告</button></div></div>' +
        '<div class="bridges-acceptance-list">' +
        list +
        '</div>' +
        gateHtml +
        progressHtml +
        cloudSyncHtml +
        summaryHtml;
    },

    renderCandidateHostCard(host) {
      const isDraft = host && host.source === 'draft';
      const isCloud = host && host.source === 'cloud';
      const validation = host && host.validation && typeof host.validation === 'object' ? host.validation : null;
      const validationOk = Boolean(validation && validation.ok);
      const cloudVersions = Array.isArray(host && host.cloudVersions) ? host.cloudVersions : [];
      const status = isDraft ? (validationOk ? '已校验' : '待验收') : isCloud ? '云端版本' : 'Ready';
      const mode = 'One-click';
      const tags = (isDraft ? ['本地草稿', validationOk ? '已校验' : '待验收'] : isCloud ? ['云端', host.cloudVersion ? 'v' + host.cloudVersion : '云端版本'] : [])
        .concat([host.category, host.connector, mode])
        .concat(host.tags || [])
        .filter(Boolean);
      const draftMessages = validation && Array.isArray(validation.messages) ? validation.messages.filter(Boolean) : [];
      const detail = isDraft
        ? (draftMessages.length
            ? draftMessages.join('；')
            : 'Copilot 已创建本地宿主草稿。完成安装和真实探测后，管理员才能提交云端。')
        : isCloud
          ? '云端宿主版本' + (host.cloudVersion ? ' v' + host.cloudVersion : '') + '。版本切换只使用云端已有版本。'
        : (host.description || '');
      const actions = isDraft
        ? [
            '<button type="button" class="bridge-btn" data-bridge-draft-pick="' + esc(host.id) + '">手动添加版本</button>',
            '<button type="button" class="bridge-btn primary" data-bridge-draft-install="' + esc(host.id) + '">一键安装</button>',
            '<button type="button" class="bridge-btn" data-bridge-draft-probe="' + esc(host.id) + '">探测连接</button>',
            '<button type="button" class="bridge-btn" data-bridge-draft-uninstall="' + esc(host.id) + '">卸载</button>',
            this._isAdmin
              ? '<button type="button" class="bridge-btn primary" data-bridge-cloud-publish="' + esc(host.id) + '">提交云端</button>'
              : '',
            '<button type="button" class="bridge-btn danger" data-bridge-draft-delete="' + esc(host.id) + '">删除草稿</button>',
          ].join('')
        : isCloud
          ? [
              '<button type="button" class="bridge-btn" data-bridge-host-launch="' + esc(host.id) + '">启动宿主</button>',
              '<button type="button" class="bridge-btn" data-bridge-host-close="' + esc(host.id) + '">关闭宿主</button>',
              '<button type="button" class="bridge-btn" data-bridge-cloud-pick="' + esc(host.id) + '">手动添加版本</button>',
              '<button type="button" class="bridge-btn primary" data-bridge-cloud-install="' + esc(host.id) + '">一键安装</button>',
              '<button type="button" class="bridge-btn" data-bridge-cloud-probe="' + esc(host.id) + '">探测连接</button>',
              '<button type="button" class="bridge-btn" data-bridge-cloud-uninstall="' + esc(host.id) + '">卸载</button>',
              cloudVersions.length && this._isAdmin
                ? '<button type="button" class="bridge-btn" data-bridge-cloud-version="' + esc(host.id) + '">选择版本</button>'
                : '',
            ].join('')
        : [
            '<button type="button" class="bridge-btn" data-bridge-host-launch="' + esc(host.id) + '">启动宿主</button>',
            '<button type="button" class="bridge-btn" data-bridge-host-close="' + esc(host.id) + '">关闭宿主</button>',
          ]
            .concat((host.actions || []).map((label) => '<button type="button" class="bridge-btn" disabled>' + esc(label) + '</button>'))
            .join('');
      const cloudVersionList =
        isCloud && this._isAdmin && cloudVersions.length
          ? '<div class="bridge-versions" data-bridge-cloud-version-list="' +
            esc(host.id) +
            '">' +
            '<div class="bridge-card-sub" style="margin:6px 0">云端版本</div>' +
            cloudVersions
              .map((version) => {
                const label = 'v' + (version.semver || '-') + (version.active ? '锛堝綋鍓嶏級' : '');
                return (
                  '<button type="button" class="bridge-btn' +
                  (version.active ? ' primary' : '') +
                  '" data-bridge-cloud-version-id="' +
                  esc(host.id) +
                  '" data-cloud-version-id="' +
                  esc(version.id || '') +
                  '"' +
                  (version.active ? ' disabled' : '') +
                  '>' +
                  esc(label) +
                  '</button>' +
                  (version.note ? '<div class="bridge-version-path">' + esc(version.note) + '</div>' : '')
                );
              })
              .join('') +
            '</div>'
          : '';
      return (
        '<article class="bridge-card' +
        (isDraft ? '' : ' is-disabled') +
        '" data-bridge-id="' +
        esc(host.id) +
        '">' +
        '<div class="bridge-card-head">' +
        '<div><h2 class="bridge-card-title">' +
        esc(host.name) +
        '</h2>' +
        '<p class="bridge-card-sub">' +
        esc(host.sub) +
        '</p></div>' +
        '<span class="bridge-status-pill">' +
        esc(status) +
        '</span></div>' +
        this.renderTags(tags) +
        '<p class="bridge-meta">' +
        esc(detail) +
        '</p>' +
        '<div class="bridge-actions">' +
        actions +
        '</div>' +
        cloudVersionList +
        '</article>'
      );
    },

    renderBlenderCard() {
      const st = this._blenderStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const ui = this.blenderUiState();
      const port = st.port || st.defaultPort || 7011;
      const versionList = versions.length
        ? '<ul class="bridge-versions" id="blenderBridgeVersions">' +
          versions
            .map((v) => {
              const checked = v.hasStartupBridge || !st.installed ? ' checked' : '';
              const mark = v.hasStartupBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-blender-version="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.startupDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Blender startup folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="blender">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Blender</h2>' +
        '<p class="bridge-card-sub">Python startup bridge (127.0.0.1:7011). Restart Blender after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="blenderBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="blenderBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        versionList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('blender', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'Python startup', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnBlenderBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnBlenderBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnBlenderBridgePickDir">\u624b\u52a8\u6dfb\u52a0\u7248\u672c</button>' +
        '<button type="button" class="bridge-btn danger" id="btnBlenderBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderMaxCard() {
      const st = this._maxStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const ui = this.maxUiState();
      const port = st.port || st.defaultPort || 7021;
      const versionList = versions.length
        ? '<ul class="bridge-versions" id="maxBridgeVersions">' +
          versions
            .map((v) => {
              const checked = v.hasStartupBridge || !st.installed ? ' checked' : '';
              const mark = v.hasStartupBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-max-version="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.startupDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No 3ds Max startup folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="3ds-max">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">3ds Max</h2>' +
        '<p class="bridge-card-sub">MaxScript startup + Python bridge (127.0.0.1:7021). Restart 3ds Max after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="maxBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="maxBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        versionList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('3ds-max', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'MaxScript', 'Python', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnMaxBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnMaxBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnMaxBridgePickDir">Choose startup...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnMaxBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderSubstancePainterCard() {
      const st = this._substanceStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.substancePainterUiState();
      const port = st.port || st.defaultPort || 7031;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="substancePainterBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasPluginBridge || !st.installed ? ' checked' : '';
              const mark = v.hasPluginBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-substance-painter-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.pluginDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Substance Painter python/plugins folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="substance-painter">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Substance Painter</h2>' +
        '<p class="bridge-card-sub">Python plugin bridge (127.0.0.1:7031). Enable or restart the plugin after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="substancePainterBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="substancePainterBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('substance-painter', ui.detail)) +
        '</p>' +
        this.renderTags(['Texture', 'Python plugin', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnSubstancePainterBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnSubstancePainterBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnSubstancePainterBridgePickDir">Choose plugins...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnSubstancePainterBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderHoudiniCard() {
      const st = this._houdiniStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.houdiniUiState();
      const port = st.port || st.defaultPort || 7041;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="houdiniBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasPythonrcMarker || v.hasBridgePy || !st.installed ? ' checked' : '';
              const marks = [];
              if (v.hasPythonrcMarker) marks.push('pythonrc');
              if (v.hasBridgePy) marks.push('bridge');
              const mark = marks.length ? ' / ' + marks.join(' + ') : '';
              return (
                '<li><label><input type="checkbox" data-houdini-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.prefsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Houdini preferences folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="houdini">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Houdini</h2>' +
        '<p class="bridge-card-sub">pythonrc.py startup bridge (127.0.0.1:7041). Restart Houdini after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="houdiniBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="houdiniBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('houdini', ui.detail)) +
        '</p>' +
        this.renderTags(['Procedural', 'Python startup', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnHoudiniBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnHoudiniBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnHoudiniBridgePickDir">Choose prefs...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnHoudiniBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderNukeCard() {
      const st = this._nukeStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.nukeUiState();
      const port = st.port || st.defaultPort || 7051;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="nukeBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasInitMarker || v.hasBridgePy || !st.installed ? ' checked' : '';
              const marks = [];
              if (v.hasInitMarker) marks.push('init.py');
              if (v.hasBridgePy) marks.push('bridge');
              const mark = marks.length ? ' / ' + marks.join(' + ') : '';
              return (
                '<li><label><input type="checkbox" data-nuke-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.userDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Nuke user script folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="nuke">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Nuke</h2>' +
        '<p class="bridge-card-sub">init.py startup bridge (127.0.0.1:7051). Restart Nuke after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="nukeBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="nukeBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('nuke', ui.detail)) +
        '</p>' +
        this.renderTags(['Compositing', 'Python startup', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnNukeBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnNukeBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnNukeBridgePickDir">Choose .nuke...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnNukeBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderCinema4DCard() {
      const st = this._cinema4dStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.cinema4dUiState();
      const port = st.port || st.defaultPort || 7061;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="cinema4dBridgeTargets">' +
          targets
            .map((v) => {
              const hasBridge = v.hasScriptBridge || v.hasBridgePy || v.hasInitMarker;
              const checked = hasBridge || !st.installed ? ' checked' : '';
              const mark = hasBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-cinema4d-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || v.configDir || v.userDir || v.pluginDir || v.projectDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Cinema 4D scripts folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="cinema-4d">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Cinema 4D</h2>' +
        '<p class="bridge-card-sub">Python script bridge (127.0.0.1:7061). Run the script in Cinema 4D after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="cinema4dBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="cinema4dBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('cinema-4d', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'Python script', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnCinema4DBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnCinema4DBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnCinema4DBridgePickDir">Choose scripts...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnCinema4DBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderDavinciResolveCard() {
      const st = this._davinciStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.davinciResolveUiState();
      const port = st.port || st.defaultPort || 7071;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="davinciResolveBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-davinci-resolve-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No DaVinci Resolve scripts folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="davinci-resolve">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">DaVinci Resolve</h2>' +
        '<p class="bridge-card-sub">Resolve/Fusion script bridge (127.0.0.1:7071). Run the script in Resolve after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="davinciResolveBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="davinciResolveBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('davinci-resolve', ui.detail)) +
        '</p>' +
        this.renderTags(['Video', 'Resolve script', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnDavinciResolveBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnDavinciResolveBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnDavinciResolveBridgePickDir">Choose Scripts...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnDavinciResolveBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    adobeHostMeta(id) {
      if (id === 'photoshop') return { name: 'Photoshop', port: 7081, tag: 'Image', label: 'Photoshop Scripts' };
      if (id === 'illustrator') return { name: 'Illustrator', port: 7161, tag: 'Vector', label: 'Illustrator Scripts' };
      if (id === 'after-effects') return { name: 'After Effects', port: 7091, tag: 'Motion', label: 'After Effects Scripts' };
      if (id === 'premiere') return { name: 'Premiere Pro', port: 7101, tag: 'Video', label: 'Premiere Scripts' };
      if (id === 'indesign') return { name: 'InDesign', port: 7301, tag: 'Layout', label: 'InDesign Scripts' };
      if (id === 'audition') return { name: 'Audition', port: 7311, tag: 'Audio', label: 'Audition Scripts' };
      if (id === 'media-encoder') return { name: 'Media Encoder', port: 7321, tag: 'Encode', label: 'Media Encoder Scripts' };
      if (id === 'adobe-bridge') return { name: 'Adobe Bridge', port: 7601, tag: 'Asset Browser', label: 'Adobe Bridge Startup Scripts' };
      return { name: 'Animate', port: 7331, tag: 'Animation', label: 'Animate Scripts' };
    },

    renderAdobeCard(id) {
      const st = this[this.adobeStatusKey(id)] || {};
      const meta = this.adobeHostMeta(id);
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.adobeUiState(id);
      const port = st.port || st.defaultPort || meta.port;
      const safeId = id.replace(/[^a-z0-9]/g, '');
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="' + safeId + 'BridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-adobe-target="' +
                esc(id) +
                '" data-adobe-target-id="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label || meta.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No ' + esc(meta.name) + ' scripts folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="' +
        esc(id) +
        '">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">' +
        esc(meta.name) +
        '</h2>' +
        '<p class="bridge-card-sub">ExtendScript heartbeat bridge. Run or restart the installed script after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="' + safeId + 'BridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="' +
        safeId +
        'BridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance(id, ui.detail)) +
        '</p>' +
        this.renderTags([meta.tag, 'ExtendScript', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" data-adobe-action="install" data-adobe-id="' + esc(id) + '">One-click install</button>' +
        '<button type="button" class="bridge-btn" data-adobe-action="probe" data-adobe-id="' + esc(id) + '">Probe connection</button>' +
        '<button type="button" class="bridge-btn" data-adobe-action="pick" data-adobe-id="' + esc(id) + '">手动添加版本</button>' +
        '<button type="button" class="bridge-btn danger" data-adobe-action="uninstall" data-adobe-id="' +
        esc(id) +
        '"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderUnityCard() {
      const st = this._unityStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.unityUiState();
      const port = st.port || st.defaultPort || 7111;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="unityBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-unity-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.projectDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Unity project folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="unity">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Unity</h2>' +
        '<p class="bridge-card-sub">Editor script bridge (127.0.0.1:7111). Open or recompile the project after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="unityBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="unityBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('unity', ui.detail)) +
        '</p>' +
        this.renderTags(['Engine', 'Editor script', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnUnityBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnUnityBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnUnityBridgePickDir">Choose project...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnUnityBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderGodotCard() {
      const st = this._godotStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.godotUiState();
      const port = st.port || st.defaultPort || 7171;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="godotBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasPluginBridge || !st.installed ? ' checked' : '';
              const mark = v.hasPluginBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-godot-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.projectDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Godot project folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="godot">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Godot</h2>' +
        '<p class="bridge-card-sub">EditorPlugin bridge (127.0.0.1:7171). Enable the plugin in Project Settings after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="godotBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="godotBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('godot', ui.detail)) +
        '</p>' +
        this.renderTags(['Engine', 'EditorPlugin', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnGodotBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnGodotBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnGodotBridgePickDir">Choose project...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnGodotBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderMotionBuilderCard() {
      const st = this._motionBuilderStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const ui = this.motionBuilderUiState();
      const port = st.port || st.defaultPort || 7181;
      const versionList = versions.length
        ? '<ul class="bridge-versions" id="motionBuilderBridgeVersions">' +
          versions
            .map((v) => {
              const checked = v.hasStartupBridge || !st.installed ? ' checked' : '';
              const mark = v.hasStartupBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-motionbuilder-version="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.startupDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No MotionBuilder PythonStartup folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="motionbuilder">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">MotionBuilder</h2>' +
        '<p class="bridge-card-sub">PythonStartup bridge (127.0.0.1:7181). Restart MotionBuilder after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="motionBuilderBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="motionBuilderBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        versionList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('motionbuilder', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'Animation', 'Python', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnMotionBuilderBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnMotionBuilderBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnMotionBuilderBridgePickDir">Choose PythonStartup...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnMotionBuilderBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderFusion360Card() {
      const st = this._fusion360Status || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.fusion360UiState();
      const port = st.port || st.defaultPort || 7191;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="fusion360BridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasAddinBridge || !st.installed ? ' checked' : '';
              const mark = v.hasAddinBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-fusion-360-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.addinsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Fusion 360 AddIns folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="fusion-360">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Fusion 360</h2>' +
        '<p class="bridge-card-sub">API AddIn bridge (127.0.0.1:7191). Restart Fusion 360 or enable the AddIn after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="fusion360BridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="fusion360BridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('fusion-360', ui.detail)) +
        '</p>' +
        this.renderTags(['CAD', 'API AddIn', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnFusion360BridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnFusion360BridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnFusion360BridgePickDir">Choose AddIns...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnFusion360BridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderZBrushCard() {
      const st = this._zbrushStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.zbrushUiState();
      const port = st.port || st.defaultPort || 7121;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="zbrushBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-zbrush-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No ZBrush scripts folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="zbrush">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">ZBrush</h2>' +
        '<p class="bridge-card-sub">ZScript heartbeat bridge. Run the installed ZScript in ZBrush after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="zbrushBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="zbrushBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('zbrush', ui.detail)) +
        '</p>' +
        this.renderTags(['Sculpt', 'ZScript', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnZBrushBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnZBrushBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnZBrushBridgePickDir">Choose ZScripts...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnZBrushBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderUnrealCard() {
      const st = this._unrealStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.unrealUiState();
      const port = st.port || st.defaultPort || 7131;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="unrealBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasPluginBridge || !st.installed ? ' checked' : '';
              const mark = v.hasPluginBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-unreal-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.projectDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Unreal project folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="unreal">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Unreal</h2>' +
        '<p class="bridge-card-sub">Project plugin + Python bridge (127.0.0.1:7131). Enable plugin and restart project after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="unrealBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="unrealBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('unreal', ui.detail)) +
        '</p>' +
        this.renderTags(['Engine', 'Python plugin', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnUnrealBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnUnrealBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnUnrealBridgePickDir">Choose project...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnUnrealBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderRhinoCard() {
      const st = this._rhinoStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.rhinoUiState();
      const port = st.port || st.defaultPort || 7141;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="rhinoBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-rhino-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No Rhino scripts folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="rhino">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">Rhino</h2>' +
        '<p class="bridge-card-sub">Rhino Python bridge (127.0.0.1:7141). Run the installed script in Rhino after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="rhinoBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="rhinoBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('rhino', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'Rhino Python', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnRhinoBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnRhinoBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnRhinoBridgePickDir">Choose scripts...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnRhinoBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderSketchUpCard() {
      const st = this._sketchupStatus || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.sketchUpUiState();
      const port = st.port || st.defaultPort || 7151;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="sketchupBridgeTargets">' +
          targets
            .map((v) => {
              const checked = v.hasPluginBridge || !st.installed ? ' checked' : '';
              const mark = v.hasPluginBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-sketchup-target="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.pluginDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">No SketchUp Plugins folder detected.</p>';
      return (
        '<article class="bridge-card" data-bridge-id="sketchup">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">SketchUp</h2>' +
        '<p class="bridge-card-sub">Ruby plugin bridge (127.0.0.1:7151). Restart SketchUp after install.</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="sketchupBridgePort">Port</label>' +
        '<input type="number" class="bridge-port-input" id="sketchupBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance('sketchup', ui.detail)) +
        '</p>' +
        this.renderTags(['DCC', 'Ruby plugin', 'Ready']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnSketchUpBridgeInstall">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="btnSketchUpBridgeProbe">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="btnSketchUpBridgePickDir">Choose Plugins...</button>' +
        '<button type="button" class="bridge-btn danger" id="btnSketchUpBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderScriptBridgeCard(opts) {
      const st = this.statusForBridge(opts.id) || {};
      const targets = Array.isArray(st.targets) ? st.targets : [];
      const ui = this.uiStateForBridge(opts.id);
      const port = st.port || st.defaultPort || opts.defaultPort;
      const targetList = targets.length
        ? '<ul class="bridge-versions" id="' +
          esc(opts.targetsId) +
          '">' +
          targets
            .map((v) => {
              const checked = v.hasScriptBridge || !st.installed ? ' checked' : '';
              const mark = v.hasScriptBridge ? ' / installed' : '';
              return (
                '<li><label><input type="checkbox" data-' +
                esc(opts.dataAttr) +
                '="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span><div class="bridge-version-path">' +
                esc(v.scriptsDir || '') +
                '</div></label></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="bridge-meta">' + esc(opts.emptyText) + '</p>';
      return (
        '<article class="bridge-card" data-bridge-id="' +
        esc(opts.id) +
        '">' +
        '<div class="bridge-card-head"><div><h2 class="bridge-card-title">' +
        esc(opts.name) +
        '</h2>' +
        '<p class="bridge-card-sub">' +
        esc(opts.sub) +
        '</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row"><label class="bridge-field-label" for="' +
        esc(opts.portId) +
        '">Port</label>' +
        '<input type="number" class="bridge-port-input" id="' +
        esc(opts.portId) +
        '" min="1" max="65535" value="' +
        esc(String(port)) +
        '" /></div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">Install targets</div>' +
        targetList +
        '</div><p class="bridge-meta">' +
        esc(this.detailWithAcceptance(opts.id, ui.detail)) +
        '</p>' +
        this.renderTags(opts.tags) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="' +
        esc(opts.installBtn) +
        '">One-click install</button>' +
        '<button type="button" class="bridge-btn" id="' +
        esc(opts.probeBtn) +
        '">Probe connection</button>' +
        '<button type="button" class="bridge-btn" id="' +
        esc(opts.pickBtn) +
        '">Choose scripts...</button>' +
        '<button type="button" class="bridge-btn danger" id="' +
        esc(opts.uninstallBtn) +
        '"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>Uninstall</button>' +
        '</div></article>'
      );
    },

    renderKeyShotCard() {
      return this.renderScriptBridgeCard({
        id: 'keyshot',
        name: 'KeyShot',
        sub: 'Python script bridge (127.0.0.1:7201). Run the installed script in KeyShot after install.',
        defaultPort: 7201,
        portId: 'keyShotBridgePort',
        targetsId: 'keyShotBridgeTargets',
        dataAttr: 'keyshot-target',
        installBtn: 'btnKeyShotBridgeInstall',
        probeBtn: 'btnKeyShotBridgeProbe',
        pickBtn: 'btnKeyShotBridgePickDir',
        uninstallBtn: 'btnKeyShotBridgeUninstall',
        emptyText: 'No KeyShot scripts folder detected.',
        tags: ['Render', 'Python script', 'Ready'],
      });
    },

    renderKritaCard() {
      return this.renderScriptBridgeCard({
        id: 'krita',
        name: 'Krita',
        sub: 'Python plugin bridge (127.0.0.1:7221). Enable the plugin and restart Krita after install.',
        defaultPort: 7221,
        portId: 'kritaBridgePort',
        targetsId: 'kritaBridgeTargets',
        dataAttr: 'krita-target',
        installBtn: 'btnKritaBridgeInstall',
        probeBtn: 'btnKritaBridgeProbe',
        pickBtn: 'btnKritaBridgePickDir',
        uninstallBtn: 'btnKritaBridgeUninstall',
        emptyText: 'No Krita pykrita folder detected.',
        tags: ['Paint', 'Python plugin', 'Ready'],
      });
    },

    renderGimpCard() {
      return this.renderScriptBridgeCard({
        id: 'gimp',
        name: 'GIMP',
        sub: 'Python-Fu plugin bridge (127.0.0.1:7251). Restart GIMP and run the plugin after install.',
        defaultPort: 7251,
        portId: 'gimpBridgePort',
        targetsId: 'gimpBridgeTargets',
        dataAttr: 'gimp-target',
        installBtn: 'btnGimpBridgeInstall',
        probeBtn: 'btnGimpBridgeProbe',
        pickBtn: 'btnGimpBridgePickDir',
        uninstallBtn: 'btnGimpBridgeUninstall',
        emptyText: 'No GIMP plug-ins folder detected.',
        tags: ['Image', 'Python-Fu', 'Ready'],
      });
    },

    renderAsepriteCard() {
      return this.renderScriptBridgeCard({
        id: 'aseprite',
        name: 'Aseprite',
        sub: 'Lua heartbeat bridge (127.0.0.1:7381). Rescan Scripts and run the script from File > Scripts after install.',
        defaultPort: 7381,
        portId: 'asepriteBridgePort',
        targetsId: 'asepriteBridgeTargets',
        dataAttr: 'aseprite-target',
        installBtn: 'btnAsepriteBridgeInstall',
        probeBtn: 'btnAsepriteBridgeProbe',
        pickBtn: 'btnAsepriteBridgePickDir',
        uninstallBtn: 'btnAsepriteBridgeUninstall',
        emptyText: 'No Aseprite scripts folder detected.',
        tags: ['Pixel Art', 'Lua script', 'Ready'],
      });
    },

    renderMohoCard() {
      return this.renderScriptBridgeCard({
        id: 'moho',
        name: 'Moho',
        sub: 'Lua menu script heartbeat bridge (127.0.0.1:7401). Restart Moho and run Scripts > AssetCutter Bridge after install.',
        defaultPort: 7401,
        portId: 'mohoBridgePort',
        targetsId: 'mohoBridgeTargets',
        dataAttr: 'moho-target',
        installBtn: 'btnMohoBridgeInstall',
        probeBtn: 'btnMohoBridgeProbe',
        pickBtn: 'btnMohoBridgePickDir',
        uninstallBtn: 'btnMohoBridgeUninstall',
        emptyText: 'No Moho Scripts/Menu folder detected.',
        tags: ['2D Animation', 'Lua script', 'Ready'],
      });
    },

    renderToonBoomHarmonyCard() {
      return this.renderScriptBridgeCard({
        id: 'toon-boom-harmony',
        name: 'Toon Boom Harmony',
        sub: 'JavaScript heartbeat bridge (127.0.0.1:7411). Add and run the script from Harmony Scripts after install.',
        defaultPort: 7411,
        portId: 'toonBoomHarmonyBridgePort',
        targetsId: 'toonBoomHarmonyBridgeTargets',
        dataAttr: 'toon-boom-harmony-target',
        installBtn: 'btnToonBoomHarmonyBridgeInstall',
        probeBtn: 'btnToonBoomHarmonyBridgeProbe',
        pickBtn: 'btnToonBoomHarmonyBridgePickDir',
        uninstallBtn: 'btnToonBoomHarmonyBridgeUninstall',
        emptyText: 'No Toon Boom Harmony scripts folder detected.',
        tags: ['2D Animation', 'JavaScript', 'Ready'],
      });
    },

    renderOpenToonzCard() {
      return this.renderScriptBridgeCard({
        id: 'opentoonz',
        name: 'OpenToonz',
        sub: 'ToonzScript JavaScript heartbeat bridge (127.0.0.1:7421). Run it from OpenToonz Run Script after install.',
        defaultPort: 7421,
        portId: 'openToonzBridgePort',
        targetsId: 'openToonzBridgeTargets',
        dataAttr: 'opentoonz-target',
        installBtn: 'btnOpenToonzBridgeInstall',
        probeBtn: 'btnOpenToonzBridgeProbe',
        pickBtn: 'btnOpenToonzBridgePickDir',
        uninstallBtn: 'btnOpenToonzBridgeUninstall',
        emptyText: 'No OpenToonz script folder detected.',
        tags: ['2D Animation', 'JavaScript', 'Ready'],
      });
    },

    renderCavalryCard() {
      return this.renderScriptBridgeCard({
        id: 'cavalry',
        name: 'Cavalry',
        sub: 'JavaScript UI Script heartbeat bridge (127.0.0.1:7431). Run it from Cavalry Window > Scripts after install.',
        defaultPort: 7431,
        portId: 'cavalryBridgePort',
        targetsId: 'cavalryBridgeTargets',
        dataAttr: 'cavalry-target',
        installBtn: 'btnCavalryBridgeInstall',
        probeBtn: 'btnCavalryBridgeProbe',
        pickBtn: 'btnCavalryBridgePickDir',
        uninstallBtn: 'btnCavalryBridgeUninstall',
        emptyText: 'No Cavalry Scripts folder detected.',
        tags: ['2D Animation', 'Motion Design', 'Ready'],
      });
    },

    renderTvPaintCard() {
      return this.renderScriptBridgeCard({
        id: 'tvpaint',
        name: 'TVPaint Animation',
        sub: 'George script heartbeat bridge (127.0.0.1:7481). Run the installed George script inside TVPaint after install.',
        defaultPort: 7481,
        portId: 'tvPaintBridgePort',
        targetsId: 'tvPaintBridgeTargets',
        dataAttr: 'tvpaint-target',
        installBtn: 'btnTvPaintBridgeInstall',
        probeBtn: 'btnTvPaintBridgeProbe',
        pickBtn: 'btnTvPaintBridgePickDir',
        uninstallBtn: 'btnTvPaintBridgeUninstall',
        emptyText: 'No TVPaint George Scripts folder detected.',
        tags: ['2D Animation', 'George', 'Ready'],
      });
    },

    renderCloMarvelousCard(id) {
      const isClo = id === 'clo';
      return this.renderScriptBridgeCard({
        id,
        name: isClo ? 'CLO' : 'Marvelous Designer',
        sub: (isClo ? 'CLO' : 'Marvelous Designer') + ' Python Script heartbeat bridge (127.0.0.1:' + (isClo ? '7451' : '7441') + '). Run the installed Python script inside the host after install.',
        defaultPort: isClo ? 7451 : 7441,
        portId: isClo ? 'cloBridgePort' : 'marvelousDesignerBridgePort',
        targetsId: isClo ? 'cloBridgeTargets' : 'marvelousDesignerBridgeTargets',
        dataAttr: isClo ? 'clo-target' : 'marvelous-designer-target',
        installBtn: isClo ? 'btnCloBridgeInstall' : 'btnMarvelousDesignerBridgeInstall',
        probeBtn: isClo ? 'btnCloBridgeProbe' : 'btnMarvelousDesignerBridgeProbe',
        pickBtn: isClo ? 'btnCloBridgePickDir' : 'btnMarvelousDesignerBridgePickDir',
        uninstallBtn: isClo ? 'btnCloBridgeUninstall' : 'btnMarvelousDesignerBridgeUninstall',
        emptyText: 'No ' + (isClo ? 'CLO' : 'Marvelous Designer') + ' Scripts folder detected.',
        tags: ['Cloth', 'Python Script', 'Ready'],
      });
    },

    renderRizomUvCard() {
      return this.renderScriptBridgeCard({
        id: 'rizomuv',
        name: 'RizomUV',
        sub: 'Lua script heartbeat bridge (127.0.0.1:7461). Run the installed Lua script inside RizomUV after install.',
        defaultPort: 7461,
        portId: 'rizomUvBridgePort',
        targetsId: 'rizomUvBridgeTargets',
        dataAttr: 'rizomuv-target',
        installBtn: 'btnRizomUvBridgeInstall',
        probeBtn: 'btnRizomUvBridgeProbe',
        pickBtn: 'btnRizomUvBridgePickDir',
        uninstallBtn: 'btnRizomUvBridgeUninstall',
        emptyText: 'No RizomUV Scripts folder detected.',
        tags: ['UV', 'Lua script', 'Ready'],
      });
    },

    renderDazStudioCard() {
      return this.renderScriptBridgeCard({
        id: 'daz-studio',
        name: 'Daz Studio',
        sub: 'DzScript heartbeat bridge (127.0.0.1:7501). Run the installed script inside Daz Studio after install.',
        defaultPort: 7501,
        portId: 'dazStudioBridgePort',
        targetsId: 'dazStudioBridgeTargets',
        dataAttr: 'daz-studio-target',
        installBtn: 'btnDazStudioBridgeInstall',
        probeBtn: 'btnDazStudioBridgeProbe',
        pickBtn: 'btnDazStudioBridgePickDir',
        uninstallBtn: 'btnDazStudioBridgeUninstall',
        emptyText: 'No Daz Studio Scripts folder detected.',
        tags: ['Character', 'DzScript', 'Ready'],
      });
    },

    renderPoserCard() {
      return this.renderScriptBridgeCard({
        id: 'poser',
        name: 'Poser',
        sub: 'Python ScriptsMenu heartbeat bridge (127.0.0.1:7511). Run the installed script from Poser Scripts menu after install.',
        defaultPort: 7511,
        portId: 'poserBridgePort',
        targetsId: 'poserBridgeTargets',
        dataAttr: 'poser-target',
        installBtn: 'btnPoserBridgeInstall',
        probeBtn: 'btnPoserBridgeProbe',
        pickBtn: 'btnPoserBridgePickDir',
        uninstallBtn: 'btnPoserBridgeUninstall',
        emptyText: 'No Poser ScriptsMenu folder detected.',
        tags: ['Character', 'Python', 'Ready'],
      });
    },

    renderReallusionCard(id) {
      const isIclone = id === 'iclone';
      const name = isIclone ? 'iClone' : 'Character Creator';
      return this.renderScriptBridgeCard({
        id,
        name,
        sub: name + ' OpenPlugin Python heartbeat bridge (127.0.0.1:' + (isIclone ? '7521' : '7531') + '). Run AssetCutterBridge from the Reallusion Plug-in menu after install.',
        defaultPort: isIclone ? 7521 : 7531,
        portId: isIclone ? 'icloneBridgePort' : 'characterCreatorBridgePort',
        targetsId: isIclone ? 'icloneBridgeTargets' : 'characterCreatorBridgeTargets',
        dataAttr: isIclone ? 'iclone-target' : 'character-creator-target',
        installBtn: isIclone ? 'btnIcloneBridgeInstall' : 'btnCharacterCreatorBridgeInstall',
        probeBtn: isIclone ? 'btnIcloneBridgeProbe' : 'btnCharacterCreatorBridgeProbe',
        pickBtn: isIclone ? 'btnIcloneBridgePickDir' : 'btnCharacterCreatorBridgePickDir',
        uninstallBtn: isIclone ? 'btnIcloneBridgeUninstall' : 'btnCharacterCreatorBridgeUninstall',
        emptyText: 'No ' + name + ' OpenPlugin folder detected.',
        tags: ['Character', 'OpenPlugin', 'Ready'],
      });
    },

    renderMetashapeCard() {
      return this.renderScriptBridgeCard({
        id: 'metashape',
        name: 'Metashape',
        sub: 'Autorun Python heartbeat bridge (127.0.0.1:7541). Restart Metashape Pro after install, then probe connection.',
        defaultPort: 7541,
        portId: 'metashapeBridgePort',
        targetsId: 'metashapeBridgeTargets',
        dataAttr: 'metashape-target',
        installBtn: 'btnMetashapeBridgeInstall',
        probeBtn: 'btnMetashapeBridgeProbe',
        pickBtn: 'btnMetashapeBridgePickDir',
        uninstallBtn: 'btnMetashapeBridgeUninstall',
        emptyText: 'No Metashape Pro scripts folder detected.',
        tags: ['Photogrammetry', 'Python autorun', 'Ready'],
      });
    },

    renderThreeDequalizerCard() {
      return this.renderScriptBridgeCard({
        id: '3dequalizer',
        name: '3DEqualizer',
        sub: 'py_scripts Python heartbeat bridge (127.0.0.1:7551). Run AssetCutter Bridge from the 3DEqualizer script menu after install.',
        defaultPort: 7551,
        portId: 'threeDequalizerBridgePort',
        targetsId: 'threeDequalizerBridgeTargets',
        dataAttr: '3dequalizer-target',
        installBtn: 'btnThreeDequalizerBridgeInstall',
        probeBtn: 'btnThreeDequalizerBridgeProbe',
        pickBtn: 'btnThreeDequalizerBridgePickDir',
        uninstallBtn: 'btnThreeDequalizerBridgeUninstall',
        emptyText: 'No 3DEqualizer py_scripts folder detected.',
        tags: ['Matchmove', 'Python script', 'Ready'],
      });
    },

    renderKatanaCard() {
      return this.renderScriptBridgeCard({
        id: 'katana',
        name: 'Katana',
        sub: 'KATANA_RESOURCES Startup/init.py heartbeat bridge (127.0.0.1:7571). Restart Katana with the resource root enabled after install.',
        defaultPort: 7571,
        portId: 'katanaBridgePort',
        targetsId: 'katanaBridgeTargets',
        dataAttr: 'katana-target',
        installBtn: 'btnKatanaBridgeInstall',
        probeBtn: 'btnKatanaBridgeProbe',
        pickBtn: 'btnKatanaBridgePickDir',
        uninstallBtn: 'btnKatanaBridgeUninstall',
        emptyText: 'No Katana resource root detected.',
        tags: ['Lookdev', 'Startup script', 'Ready'],
      });
    },

    renderFoundryTimelineCard(id) {
      const isHiero = id === 'hiero';
      const name = isHiero ? 'Hiero' : 'Nuke Studio';
      return this.renderScriptBridgeCard({
        id,
        name,
        sub: name + ' Foundry init.py bridge (127.0.0.1:' + (isHiero ? '7591' : '7581') + '). Restart ' + name + ' after install, then probe connection.',
        defaultPort: isHiero ? 7591 : 7581,
        portId: isHiero ? 'hieroBridgePort' : 'nukeStudioBridgePort',
        targetsId: isHiero ? 'hieroBridgeTargets' : 'nukeStudioBridgeTargets',
        dataAttr: isHiero ? 'hiero-target' : 'nuke-studio-target',
        installBtn: isHiero ? 'btnHieroBridgeInstall' : 'btnNukeStudioBridgeInstall',
        probeBtn: isHiero ? 'btnHieroBridgeProbe' : 'btnNukeStudioBridgeProbe',
        pickBtn: isHiero ? 'btnHieroBridgePickDir' : 'btnNukeStudioBridgePickDir',
        uninstallBtn: isHiero ? 'btnHieroBridgeUninstall' : 'btnNukeStudioBridgeUninstall',
        emptyText: 'No Foundry .nuke folder detected.',
        tags: ['Timeline', 'Foundry init.py', 'Ready'],
      });
    },

    renderLightroomCard() {
      return this.renderScriptBridgeCard({
        id: 'lightroom-classic',
        name: 'Lightroom Classic',
        sub: 'Lua .lrplugin heartbeat bridge (127.0.0.1:7561). Restart Lightroom Classic after install, then probe connection.',
        defaultPort: 7561,
        portId: 'lightroomBridgePort',
        targetsId: 'lightroomBridgeTargets',
        dataAttr: 'lightroom-classic-target',
        installBtn: 'btnLightroomBridgeInstall',
        probeBtn: 'btnLightroomBridgeProbe',
        pickBtn: 'btnLightroomBridgePickDir',
        uninstallBtn: 'btnLightroomBridgeUninstall',
        emptyText: 'No Lightroom Classic Modules folder detected.',
        tags: ['Photo', 'Lua plugin', 'Ready'],
      });
    },

    renderDarktableCard() {
      return this.renderScriptBridgeCard({
        id: 'darktable',
        name: 'darktable',
        sub: 'luarc Lua heartbeat bridge (127.0.0.1:7611). Start darktable with Lua enabled after install.',
        defaultPort: 7611,
        portId: 'darktableBridgePort',
        targetsId: 'darktableBridgeTargets',
        dataAttr: 'darktable-target',
        installBtn: 'btnDarktableBridgeInstall',
        probeBtn: 'btnDarktableBridgeProbe',
        pickBtn: 'btnDarktableBridgePickDir',
        uninstallBtn: 'btnDarktableBridgeUninstall',
        emptyText: 'No darktable config folder detected.',
        tags: ['Photo', 'Lua luarc', 'Ready'],
      });
    },

    renderVegasProCard() {
      return this.renderScriptBridgeCard({
        id: 'vegas-pro',
        name: 'VEGAS Pro',
        sub: 'C# Script Menu heartbeat bridge (127.0.0.1:7471). Run AssetCutterVegasBridge from VEGAS Tools > Scripting after install.',
        defaultPort: 7471,
        portId: 'vegasProBridgePort',
        targetsId: 'vegasProBridgeTargets',
        dataAttr: 'vegas-pro-target',
        installBtn: 'btnVegasProBridgeInstall',
        probeBtn: 'btnVegasProBridgeProbe',
        pickBtn: 'btnVegasProBridgePickDir',
        uninstallBtn: 'btnVegasProBridgeUninstall',
        emptyText: 'No VEGAS Pro Script Menu folder detected.',
        tags: ['Video', 'C# Script', 'Ready'],
      });
    },

    renderSynfigCard() {
      return this.renderScriptBridgeCard({
        id: 'synfig',
        name: 'Synfig Studio',
        sub: 'Python plug-in heartbeat bridge (127.0.0.1:7491). Restart Synfig if needed and run AssetCutter Bridge from Plug-ins.',
        defaultPort: 7491,
        portId: 'synfigBridgePort',
        targetsId: 'synfigBridgeTargets',
        dataAttr: 'synfig-target',
        installBtn: 'btnSynfigBridgeInstall',
        probeBtn: 'btnSynfigBridgeProbe',
        pickBtn: 'btnSynfigBridgePickDir',
        uninstallBtn: 'btnSynfigBridgeUninstall',
        emptyText: 'No Synfig plugins folder detected.',
        tags: ['2D Animation', 'Python plug-in', 'Ready'],
      });
    },

    renderMariCard() {
      return this.renderScriptBridgeCard({
        id: 'mari',
        name: 'Mari',
        sub: 'Python script bridge (127.0.0.1:7231). Run the installed script in Mari after install.',
        defaultPort: 7231,
        portId: 'mariBridgePort',
        targetsId: 'mariBridgeTargets',
        dataAttr: 'mari-target',
        installBtn: 'btnMariBridgeInstall',
        probeBtn: 'btnMariBridgeProbe',
        pickBtn: 'btnMariBridgePickDir',
        uninstallBtn: 'btnMariBridgeUninstall',
        emptyText: 'No Mari scripts folder detected.',
        tags: ['Texture', 'Lookdev', 'Ready'],
      });
    },

    renderSubstanceDesignerCard() {
      return this.renderScriptBridgeCard({
        id: 'substance-designer',
        name: 'Substance Designer',
        sub: 'Python plugin bridge (127.0.0.1:7341). Restart Designer or run the installed script after install.',
        defaultPort: 7341,
        portId: 'substanceDesignerBridgePort',
        targetsId: 'substanceDesignerBridgeTargets',
        dataAttr: 'substance-designer-target',
        installBtn: 'btnSubstanceDesignerBridgeInstall',
        probeBtn: 'btnSubstanceDesignerBridgeProbe',
        pickBtn: 'btnSubstanceDesignerBridgePickDir',
        uninstallBtn: 'btnSubstanceDesignerBridgeUninstall',
        emptyText: 'No Substance Designer scripts/plugins folder detected.',
        tags: ['Material', 'Graph', 'Ready'],
      });
    },

    renderInkscapeCard() {
      return this.renderScriptBridgeCard({
        id: 'inkscape',
        name: 'Inkscape',
        sub: 'Python extension bridge (127.0.0.1:7241). Restart Inkscape and run the extension after install.',
        defaultPort: 7241,
        portId: 'inkscapeBridgePort',
        targetsId: 'inkscapeBridgeTargets',
        dataAttr: 'inkscape-target',
        installBtn: 'btnInkscapeBridgeInstall',
        probeBtn: 'btnInkscapeBridgeProbe',
        pickBtn: 'btnInkscapeBridgePickDir',
        uninstallBtn: 'btnInkscapeBridgeUninstall',
        emptyText: 'No Inkscape extensions folder detected.',
        tags: ['Vector', 'Extension', 'Ready'],
      });
    },

    renderNatronCard() {
      return this.renderScriptBridgeCard({
        id: 'natron',
        name: 'Natron',
        sub: 'initGui.py bridge (127.0.0.1:7261). Restart Natron after install.',
        defaultPort: 7261,
        portId: 'natronBridgePort',
        targetsId: 'natronBridgeTargets',
        dataAttr: 'natron-target',
        installBtn: 'btnNatronBridgeInstall',
        probeBtn: 'btnNatronBridgeProbe',
        pickBtn: 'btnNatronBridgePickDir',
        uninstallBtn: 'btnNatronBridgeUninstall',
        emptyText: 'No Natron user scripts folder detected.',
        tags: ['Compositing', 'initGui.py', 'Ready'],
      });
    },

    renderFusionStudioCard() {
      return this.renderScriptBridgeCard({
        id: 'fusion-studio',
        name: 'Fusion Studio',
        sub: 'Fusion Python script bridge (127.0.0.1:7391). Run the installed script in Fusion Studio after install.',
        defaultPort: 7391,
        portId: 'fusionStudioBridgePort',
        targetsId: 'fusionStudioBridgeTargets',
        dataAttr: 'fusion-studio-target',
        installBtn: 'btnFusionStudioBridgeInstall',
        probeBtn: 'btnFusionStudioBridgeProbe',
        pickBtn: 'btnFusionStudioBridgePickDir',
        uninstallBtn: 'btnFusionStudioBridgeUninstall',
        emptyText: 'No Fusion Studio scripts folder detected.',
        tags: ['Compositing', 'Python script', 'Ready'],
      });
    },

    renderObsStudioCard() {
      return this.renderScriptBridgeCard({
        id: 'obs-studio',
        name: 'OBS Studio',
        sub: 'Lua heartbeat bridge (127.0.0.1:7351). Add or reload the script in OBS Tools > Scripts after install.',
        defaultPort: 7351,
        portId: 'obsStudioBridgePort',
        targetsId: 'obsStudioBridgeTargets',
        dataAttr: 'obs-studio-target',
        installBtn: 'btnObsStudioBridgeInstall',
        probeBtn: 'btnObsStudioBridgeProbe',
        pickBtn: 'btnObsStudioBridgePickDir',
        uninstallBtn: 'btnObsStudioBridgeUninstall',
        emptyText: 'No OBS Studio scripts folder detected.',
        tags: ['Capture', 'Lua script', 'Ready'],
      });
    },

    renderReaperCard() {
      return this.renderScriptBridgeCard({
        id: 'reaper',
        name: 'REAPER',
        sub: 'ReaScript Lua heartbeat bridge (127.0.0.1:7361). Load and run the script from REAPER Actions after install.',
        defaultPort: 7361,
        portId: 'reaperBridgePort',
        targetsId: 'reaperBridgeTargets',
        dataAttr: 'reaper-target',
        installBtn: 'btnReaperBridgeInstall',
        probeBtn: 'btnReaperBridgeProbe',
        pickBtn: 'btnReaperBridgePickDir',
        uninstallBtn: 'btnReaperBridgeUninstall',
        emptyText: 'No REAPER Scripts folder detected.',
        tags: ['Audio', 'ReaScript', 'Ready'],
      });
    },

    renderMarmosetToolbagCard() {
      return this.renderScriptBridgeCard({
        id: 'marmoset-toolbag',
        name: 'Marmoset Toolbag',
        sub: 'Python script bridge (127.0.0.1:7211). Run the installed script in Toolbag after install.',
        defaultPort: 7211,
        portId: 'marmosetToolbagBridgePort',
        targetsId: 'marmosetToolbagBridgeTargets',
        dataAttr: 'marmoset-toolbag-target',
        installBtn: 'btnMarmosetToolbagBridgeInstall',
        probeBtn: 'btnMarmosetToolbagBridgeProbe',
        pickBtn: 'btnMarmosetToolbagBridgePickDir',
        uninstallBtn: 'btnMarmosetToolbagBridgeUninstall',
        emptyText: 'No Marmoset Toolbag scripts/plugins folder detected.',
        tags: ['Render', 'Baking', 'Ready'],
      });
    },

    renderModoCard() {
      return this.renderScriptBridgeCard({
        id: 'modo',
        name: 'Modo',
        sub: 'Python script bridge (127.0.0.1:7271). Run the installed script in Modo after install.',
        defaultPort: 7271,
        portId: 'modoBridgePort',
        targetsId: 'modoBridgeTargets',
        dataAttr: 'modo-target',
        installBtn: 'btnModoBridgeInstall',
        probeBtn: 'btnModoBridgeProbe',
        pickBtn: 'btnModoBridgePickDir',
        uninstallBtn: 'btnModoBridgeUninstall',
        emptyText: 'No Modo Scripts folder detected.',
        tags: ['DCC', 'Python script', 'Ready'],
      });
    },

    renderLightWaveCard() {
      return this.renderScriptBridgeCard({
        id: 'lightwave',
        name: 'LightWave 3D',
        sub: 'Python script bridge (127.0.0.1:7281). Run the installed script in LightWave after install.',
        defaultPort: 7281,
        portId: 'lightWaveBridgePort',
        targetsId: 'lightWaveBridgeTargets',
        dataAttr: 'lightwave-target',
        installBtn: 'btnLightWaveBridgeInstall',
        probeBtn: 'btnLightWaveBridgeProbe',
        pickBtn: 'btnLightWaveBridgePickDir',
        uninstallBtn: 'btnLightWaveBridgeUninstall',
        emptyText: 'No LightWave Scripts folder detected.',
        tags: ['DCC', 'Python script', 'Ready'],
      });
    },

    renderFreeCADCard() {
      return this.renderScriptBridgeCard({
        id: 'freecad',
        name: 'FreeCAD',
        sub: 'Workbench bridge (127.0.0.1:7291). Restart FreeCAD after install.',
        defaultPort: 7291,
        portId: 'freeCADBridgePort',
        targetsId: 'freeCADBridgeTargets',
        dataAttr: 'freecad-target',
        installBtn: 'btnFreeCADBridgeInstall',
        probeBtn: 'btnFreeCADBridgeProbe',
        pickBtn: 'btnFreeCADBridgePickDir',
        uninstallBtn: 'btnFreeCADBridgeUninstall',
        emptyText: 'No FreeCAD Mod folder detected.',
        tags: ['CAD', 'Workbench', 'Ready'],
      });
    },

    renderAutoCADCard() {
      return this.renderScriptBridgeCard({
        id: 'autocad',
        name: 'AutoCAD',
        sub: 'AutoLISP acaddoc.lsp heartbeat bridge (127.0.0.1:7371). Restart AutoCAD or run ASSETCUTTERBRIDGE after install.',
        defaultPort: 7371,
        portId: 'autoCADBridgePort',
        targetsId: 'autoCADBridgeTargets',
        dataAttr: 'autocad-target',
        installBtn: 'btnAutoCADBridgeInstall',
        probeBtn: 'btnAutoCADBridgeProbe',
        pickBtn: 'btnAutoCADBridgePickDir',
        uninstallBtn: 'btnAutoCADBridgeUninstall',
        emptyText: 'No AutoCAD Support folder detected.',
        tags: ['CAD', 'AutoLISP', 'Ready'],
      });
    },

    render() {
      const host = $('bridgesList');
      if (!host) return;
      this.renderAcceptanceSummary();
      const st = this._mayaStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const ui = this.mayaUiState();
      const port = st.port || st.defaultPort || 7001;
      const selected = this._selectedVersionIds || new Set();
      const catalog = (this._bridgeCatalog && this._bridgeCatalog.length ? this._bridgeCatalog : HOST_CENTER_FALLBACK_CATALOG)
        .filter((item) => item && this.hostOrder().indexOf(item.id) < 0)
        .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));

      let versionsHtml = '';
      if (versions.length) {
        versionsHtml =
          '<ul class="bridge-versions" id="mayaBridgeVersions">' +
          versions
            .map((v) => {
              const checked = selected.has(v.id) ? ' checked' : '';
              const marks = [];
              if (v.hasUserSetupMarker) marks.push('已写入');
              if (v.hasBridgePy) marks.push('有 bridge.py');
              const mark = marks.length ? ' · ' + marks.join(' · ') : '';
              const dirHint = v.scriptsDir ? '<div class="bridge-version-path">' + esc(v.scriptsDir) + '</div>' : '';
              return (
                '<li><label><input type="checkbox" data-maya-version="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span>' +
                dirHint +
                '</label></li>'
              );
            })
            .join('') +
          '</ul>';
      } else {
        versionsHtml = '<p class="bridge-meta">暂无检测到的版本目录</p>';
      }

      const dirs = versions.map((v) => v.scriptsDir).filter(Boolean);
      const metaLines = [];
      if (st.error) metaLines.push('错误：' + st.error);
      if (!st.companionOffline) {
        if (st.bridgeSourcePath) metaLines.push('安装源：' + st.bridgeSourcePath);
        else metaLines.push('安装源：未找到 script_hub_bridge.py（需安装含桥接资源的桌面壳 ≥0.2.3）');
        if (st.install && st.install.installedAt) {
          metaLines.push('上次安装：' + st.install.installedAt + ' · port ' + (st.install.port || port));
        }
        if (dirs[0]) metaLines.push('示例路径：' + dirs[0]);
        metaLines.push(this.detailWithAcceptance('maya', ui.detail));
      }

      host.innerHTML =
        '<article class="bridge-card" data-bridge-id="maya">' +
        '<div class="bridge-card-head">' +
        '<div><h2 class="bridge-card-title">Maya</h2>' +
        '<p class="bridge-card-sub">Command Port 桥（默认 127.0.0.1:7001）。装完需重启 Maya。</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row">' +
        '<label class="bridge-field-label" for="mayaBridgePort">端口</label>' +
        '<input type="number" class="bridge-port-input" id="mayaBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" />' +
        '</div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">安装到版本</div>' +
        versionsHtml +
        '</div>' +
        '<p class="bridge-meta">' +
        esc(metaLines.join('\n')) +
        '</p>' +
        this.renderTags(['DCC', 'Command Port', '可用']) +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnMayaBridgeInstall">一键安装</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgeProbe">探测连接</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgePickDir">选择 scripts…</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgeOpenDir"' +
        (dirs[0] ? '' : ' disabled') +
        '>打开目录</button>' +
        '<button type="button" class="bridge-btn danger" id="btnMayaBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>卸载标记</button>' +
        '</div></article>' +
        this.renderBlenderCard() +
        this.renderMaxCard() +
        this.renderCinema4DCard() +
        this.renderSubstancePainterCard() +
        this.renderSubstanceDesignerCard() +
        this.renderMariCard() +
        this.renderKritaCard() +
        this.renderGimpCard() +
        this.renderAsepriteCard() +
        this.renderMohoCard() +
        this.renderToonBoomHarmonyCard() +
        this.renderOpenToonzCard() +
        this.renderCavalryCard() +
        this.renderTvPaintCard() +
        this.renderRhinoCard() +
        this.renderSketchUpCard() +
        this.renderCloMarvelousCard('marvelous-designer') +
        this.renderCloMarvelousCard('clo') +
        this.renderRizomUvCard() +
        this.renderDazStudioCard() +
        this.renderPoserCard() +
        this.renderReallusionCard('iclone') +
        this.renderReallusionCard('character-creator') +
        this.renderMetashapeCard() +
        this.renderThreeDequalizerCard() +
        this.renderKatanaCard() +
        this.renderMotionBuilderCard() +
        this.renderHoudiniCard() +
        this.renderZBrushCard() +
        this.renderUnrealCard() +
        this.renderGodotCard() +
        this.renderFusion360Card() +
        this.renderKeyShotCard() +
        this.renderMarmosetToolbagCard() +
        this.renderModoCard() +
        this.renderLightWaveCard() +
        this.renderFreeCADCard() +
        this.renderAutoCADCard() +
        this.renderUnityCard() +
        this.renderAdobeCard('photoshop') +
        this.renderAdobeCard('illustrator') +
        this.renderInkscapeCard() +
        this.renderAdobeCard('after-effects') +
        this.renderAdobeCard('premiere') +
        this.renderAdobeCard('indesign') +
        this.renderAdobeCard('audition') +
        this.renderAdobeCard('media-encoder') +
        this.renderAdobeCard('animate') +
        this.renderAdobeCard('adobe-bridge') +
        this.renderLightroomCard() +
        this.renderDarktableCard() +
        this.renderDavinciResolveCard() +
        this.renderFusionStudioCard() +
        this.renderNukeCard() +
        this.renderFoundryTimelineCard('nuke-studio') +
        this.renderFoundryTimelineCard('hiero') +
        this.renderNatronCard() +
        this.renderObsStudioCard() +
        this.renderReaperCard() +
        this.renderVegasProCard() +
        this.renderSynfigCard() +
        catalog.map((item) => this.renderCandidateHostCard(item)).join('');

      this.localizeBridgeCards();
      this.injectHostProcessActions();
      this.renderBridgeFilters();
      this.applyBridgeFilter();
      this.bindMayaCardActions();
    },

    injectHostProcessActions() {
      document.querySelectorAll('#bridgesList .bridge-card[data-bridge-id]').forEach((card) => {
        const id = card.getAttribute('data-bridge-id');
        if (!id) return;
        const actions = card.querySelector('.bridge-actions');
        if (!actions) return;
        if (!card.querySelector('[data-bridge-host-chat]')) {
          const chat = document.createElement('button');
          chat.type = 'button';
          chat.className = 'bridge-btn';
          chat.setAttribute('data-bridge-host-chat', id);
          chat.textContent = '\u5bf9\u8bdd';
          actions.prepend(chat);
        }
        if (card.querySelector('[data-bridge-host-launch]')) return;
        const launch = document.createElement('button');
        launch.type = 'button';
        launch.className = 'bridge-btn';
        launch.setAttribute('data-bridge-host-launch', id);
        const discover = document.createElement('button');
        discover.type = 'button';
        discover.className = 'bridge-btn';
        discover.setAttribute('data-bridge-host-discover-running', id);
        discover.textContent = '\u8bc6\u522b\u5df2\u6253\u5f00\u8f6f\u4ef6';
        launch.textContent = '启动宿主';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bridge-btn';
        close.setAttribute('data-bridge-host-close', id);
        close.textContent = '关闭宿主';
        actions.prepend(close);
        actions.prepend(discover);
        actions.prepend(launch);
      });
    },

    selectedVersionsFromDom() {
      const ids = [];
      document.querySelectorAll('#mayaBridgeVersions input[data-maya-version]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-maya-version'));
      });
      this._selectedVersionIds = new Set(ids);
      return ids;
    },

    bindMayaCardActions() {
      const shell = this._shell;
      if (!shell) return;

      document.querySelectorAll('#mayaBridgeVersions input[data-maya-version]').forEach((el) => {
        el.addEventListener('change', () => this.selectedVersionsFromDom());
      });

      $('btnMayaBridgeInstall')?.addEventListener('click', () => void this.installMaya(shell));
      $('btnMayaBridgeProbe')?.addEventListener('click', () => void this.probeMaya(shell));
      $('btnMayaBridgeUninstall')?.addEventListener('click', () => void this.uninstallMaya(shell));
      $('btnMayaBridgeOpenDir')?.addEventListener('click', () => void this.openScriptsDir(shell));
      $('btnMayaBridgePickDir')?.addEventListener('click', () => void this.pickScriptsDir(shell));
      $('btnBridgesInstallAll')?.addEventListener('click', () => void this.installAllDetectedBridges(shell));
      $('btnBridgesProbeAll')?.addEventListener('click', () => void this.probeAllBridges(shell));
      $('btnBridgesCopyReport')?.addEventListener('click', () => this.copyAcceptanceReport(shell));
      document.querySelectorAll('[data-bridge-jump]').forEach((el) => {
        el.addEventListener('click', () =>
          this.jumpToBridgeCard(el.getAttribute('data-bridge-jump'), {
            acceptanceGuide: el.getAttribute('data-bridge-acceptance-guide') === '1',
          }),
        );
      });
      document.querySelectorAll('[data-bridge-draft-delete]').forEach((el) => {
        el.addEventListener('click', () => void this.deleteBridgeDraft(shell, el.getAttribute('data-bridge-draft-delete')));
      });
      document.querySelectorAll('[data-bridge-draft-pick]').forEach((el) => {
        el.addEventListener('click', () => void this.pickBridgeDraftTarget(shell, el.getAttribute('data-bridge-draft-pick')));
      });
      document.querySelectorAll('[data-bridge-draft-install]').forEach((el) => {
        el.addEventListener('click', () => void this.installBridgeDraft(shell, el.getAttribute('data-bridge-draft-install')));
      });
      document.querySelectorAll('[data-bridge-draft-probe]').forEach((el) => {
        el.addEventListener('click', () => void this.probeBridgeDraft(shell, el.getAttribute('data-bridge-draft-probe')));
      });
      document.querySelectorAll('[data-bridge-draft-uninstall]').forEach((el) => {
        el.addEventListener('click', () => void this.uninstallBridgeDraft(shell, el.getAttribute('data-bridge-draft-uninstall')));
      });
      document.querySelectorAll('[data-bridge-cloud-publish]').forEach((el) => {
        el.addEventListener('click', () => void this.publishBridgeDraftToCloud(shell, el.getAttribute('data-bridge-cloud-publish')));
      });
      document.querySelectorAll('[data-bridge-cloud-version]').forEach((el) => {
        el.addEventListener('click', () => void this.chooseBridgeCloudVersion(shell, el.getAttribute('data-bridge-cloud-version')));
      });
      document.querySelectorAll('[data-bridge-cloud-version-id]').forEach((el) => {
        el.addEventListener('click', () =>
          void this.chooseBridgeCloudVersion(
            shell,
            el.getAttribute('data-bridge-cloud-version-id'),
            el.getAttribute('data-cloud-version-id'),
          ),
        );
      });
      document.querySelectorAll('[data-bridge-cloud-pick]').forEach((el) => {
        el.addEventListener('click', () => void this.pickBridgeDraftTarget(shell, el.getAttribute('data-bridge-cloud-pick')));
      });
      document.querySelectorAll('[data-bridge-cloud-install]').forEach((el) => {
        el.addEventListener('click', () => void this.installBridgeDraft(shell, el.getAttribute('data-bridge-cloud-install')));
      });
      document.querySelectorAll('[data-bridge-cloud-probe]').forEach((el) => {
        el.addEventListener('click', () => void this.probeBridgeDraft(shell, el.getAttribute('data-bridge-cloud-probe')));
      });
      document.querySelectorAll('[data-bridge-cloud-uninstall]').forEach((el) => {
        el.addEventListener('click', () => void this.uninstallBridgeDraft(shell, el.getAttribute('data-bridge-cloud-uninstall')));
      });
      document.querySelectorAll('[data-bridge-host-launch]').forEach((el) => {
        el.addEventListener('click', () => void this.launchHostApp(shell, el.getAttribute('data-bridge-host-launch')));
      });
      document.querySelectorAll('[data-bridge-host-discover-running]').forEach((el) => {
        el.addEventListener('click', () => void this.discoverRunningHostApp(shell, el.getAttribute('data-bridge-host-discover-running')));
      });
      document.querySelectorAll('[data-bridge-host-close]').forEach((el) => {
        el.addEventListener('click', () => void this.closeHostApp(shell, el.getAttribute('data-bridge-host-close')));
      });
      document.querySelectorAll('[data-bridge-host-chat]').forEach((el) => {
        el.addEventListener('click', () => this.openBridgeCopilotSession(el.getAttribute('data-bridge-host-chat')));
      });
      $('btnBlenderBridgeInstall')?.addEventListener('click', () => void this.installBlender(shell));
      $('btnBlenderBridgeProbe')?.addEventListener('click', () => void this.probeBlender(shell));
      $('btnBlenderBridgePickDir')?.addEventListener('click', () => void this.pickBlenderStartupDir(shell));
      $('btnBlenderBridgeUninstall')?.addEventListener('click', () => void this.uninstallBlender(shell));
      $('btnMaxBridgeInstall')?.addEventListener('click', () => void this.installMax(shell));
      $('btnMaxBridgeProbe')?.addEventListener('click', () => void this.probeMax(shell));
      $('btnMaxBridgePickDir')?.addEventListener('click', () => void this.pickMaxStartupDir(shell));
      $('btnMaxBridgeUninstall')?.addEventListener('click', () => void this.uninstallMax(shell));
      $('btnSubstancePainterBridgeInstall')?.addEventListener('click', () => void this.installSubstancePainter(shell));
      $('btnSubstancePainterBridgeProbe')?.addEventListener('click', () => void this.probeSubstancePainter(shell));
      $('btnSubstancePainterBridgePickDir')?.addEventListener('click', () => void this.pickSubstancePainterPluginDir(shell));
      $('btnSubstancePainterBridgeUninstall')?.addEventListener('click', () => void this.uninstallSubstancePainter(shell));
      $('btnSubstanceDesignerBridgeInstall')?.addEventListener('click', () => void this.installSubstanceDesigner(shell));
      $('btnSubstanceDesignerBridgeProbe')?.addEventListener('click', () => void this.probeSubstanceDesigner(shell));
      $('btnSubstanceDesignerBridgePickDir')?.addEventListener('click', () => void this.pickSubstanceDesignerScriptsDir(shell));
      $('btnSubstanceDesignerBridgeUninstall')?.addEventListener('click', () => void this.uninstallSubstanceDesigner(shell));
      $('btnMariBridgeInstall')?.addEventListener('click', () => void this.installMari(shell));
      $('btnMariBridgeProbe')?.addEventListener('click', () => void this.probeMari(shell));
      $('btnMariBridgePickDir')?.addEventListener('click', () => void this.pickMariScriptsDir(shell));
      $('btnMariBridgeUninstall')?.addEventListener('click', () => void this.uninstallMari(shell));
      $('btnKritaBridgeInstall')?.addEventListener('click', () => void this.installKrita(shell));
      $('btnKritaBridgeProbe')?.addEventListener('click', () => void this.probeKrita(shell));
      $('btnKritaBridgePickDir')?.addEventListener('click', () => void this.pickKritaPykritaDir(shell));
      $('btnKritaBridgeUninstall')?.addEventListener('click', () => void this.uninstallKrita(shell));
      $('btnGimpBridgeInstall')?.addEventListener('click', () => void this.installGimp(shell));
      $('btnGimpBridgeProbe')?.addEventListener('click', () => void this.probeGimp(shell));
      $('btnGimpBridgePickDir')?.addEventListener('click', () => void this.pickGimpPluginDir(shell));
      $('btnGimpBridgeUninstall')?.addEventListener('click', () => void this.uninstallGimp(shell));
      $('btnAsepriteBridgeInstall')?.addEventListener('click', () => void this.installAseprite(shell));
      $('btnAsepriteBridgeProbe')?.addEventListener('click', () => void this.probeAseprite(shell));
      $('btnAsepriteBridgePickDir')?.addEventListener('click', () => void this.pickAsepriteScriptsDir(shell));
      $('btnAsepriteBridgeUninstall')?.addEventListener('click', () => void this.uninstallAseprite(shell));
      $('btnMohoBridgeInstall')?.addEventListener('click', () => void this.installMoho(shell));
      $('btnMohoBridgeProbe')?.addEventListener('click', () => void this.probeMoho(shell));
      $('btnMohoBridgePickDir')?.addEventListener('click', () => void this.pickMohoScriptsDir(shell));
      $('btnMohoBridgeUninstall')?.addEventListener('click', () => void this.uninstallMoho(shell));
      $('btnToonBoomHarmonyBridgeInstall')?.addEventListener('click', () => void this.installToonBoomHarmony(shell));
      $('btnToonBoomHarmonyBridgeProbe')?.addEventListener('click', () => void this.probeToonBoomHarmony(shell));
      $('btnToonBoomHarmonyBridgePickDir')?.addEventListener('click', () => void this.pickToonBoomHarmonyScriptsDir(shell));
      $('btnToonBoomHarmonyBridgeUninstall')?.addEventListener('click', () => void this.uninstallToonBoomHarmony(shell));
      $('btnOpenToonzBridgeInstall')?.addEventListener('click', () => void this.installOpenToonz(shell));
      $('btnOpenToonzBridgeProbe')?.addEventListener('click', () => void this.probeOpenToonz(shell));
      $('btnOpenToonzBridgePickDir')?.addEventListener('click', () => void this.pickOpenToonzScriptsDir(shell));
      $('btnOpenToonzBridgeUninstall')?.addEventListener('click', () => void this.uninstallOpenToonz(shell));
      $('btnCavalryBridgeInstall')?.addEventListener('click', () => void this.installCavalry(shell));
      $('btnCavalryBridgeProbe')?.addEventListener('click', () => void this.probeCavalry(shell));
      $('btnCavalryBridgePickDir')?.addEventListener('click', () => void this.pickCavalryScriptsDir(shell));
      $('btnCavalryBridgeUninstall')?.addEventListener('click', () => void this.uninstallCavalry(shell));
      $('btnTvPaintBridgeInstall')?.addEventListener('click', () => void this.installTvPaint(shell));
      $('btnTvPaintBridgeProbe')?.addEventListener('click', () => void this.probeTvPaint(shell));
      $('btnTvPaintBridgePickDir')?.addEventListener('click', () => void this.pickTvPaintScriptsDir(shell));
      $('btnTvPaintBridgeUninstall')?.addEventListener('click', () => void this.uninstallTvPaint(shell));
      $('btnRhinoBridgeInstall')?.addEventListener('click', () => void this.installRhino(shell));
      $('btnRhinoBridgeProbe')?.addEventListener('click', () => void this.probeRhino(shell));
      $('btnRhinoBridgePickDir')?.addEventListener('click', () => void this.pickRhinoScriptsDir(shell));
      $('btnRhinoBridgeUninstall')?.addEventListener('click', () => void this.uninstallRhino(shell));
      $('btnSketchUpBridgeInstall')?.addEventListener('click', () => void this.installSketchUp(shell));
      $('btnSketchUpBridgeProbe')?.addEventListener('click', () => void this.probeSketchUp(shell));
      $('btnSketchUpBridgePickDir')?.addEventListener('click', () => void this.pickSketchUpPluginDir(shell));
      $('btnSketchUpBridgeUninstall')?.addEventListener('click', () => void this.uninstallSketchUp(shell));
      $('btnMarvelousDesignerBridgeInstall')?.addEventListener('click', () => void this.installCloMarvelous(shell, 'marvelous-designer'));
      $('btnMarvelousDesignerBridgeProbe')?.addEventListener('click', () => void this.probeCloMarvelous(shell, 'marvelous-designer'));
      $('btnMarvelousDesignerBridgePickDir')?.addEventListener('click', () => void this.pickCloMarvelousScriptsDir(shell, 'marvelous-designer'));
      $('btnMarvelousDesignerBridgeUninstall')?.addEventListener('click', () => void this.uninstallCloMarvelous(shell, 'marvelous-designer'));
      $('btnCloBridgeInstall')?.addEventListener('click', () => void this.installCloMarvelous(shell, 'clo'));
      $('btnCloBridgeProbe')?.addEventListener('click', () => void this.probeCloMarvelous(shell, 'clo'));
      $('btnCloBridgePickDir')?.addEventListener('click', () => void this.pickCloMarvelousScriptsDir(shell, 'clo'));
      $('btnCloBridgeUninstall')?.addEventListener('click', () => void this.uninstallCloMarvelous(shell, 'clo'));
      $('btnRizomUvBridgeInstall')?.addEventListener('click', () => void this.installRizomUv(shell));
      $('btnRizomUvBridgeProbe')?.addEventListener('click', () => void this.probeRizomUv(shell));
      $('btnRizomUvBridgePickDir')?.addEventListener('click', () => void this.pickRizomUvScriptsDir(shell));
      $('btnRizomUvBridgeUninstall')?.addEventListener('click', () => void this.uninstallRizomUv(shell));
      $('btnDazStudioBridgeInstall')?.addEventListener('click', () => void this.installDazStudio(shell));
      $('btnDazStudioBridgeProbe')?.addEventListener('click', () => void this.probeDazStudio(shell));
      $('btnDazStudioBridgePickDir')?.addEventListener('click', () => void this.pickDazStudioScriptsDir(shell));
      $('btnDazStudioBridgeUninstall')?.addEventListener('click', () => void this.uninstallDazStudio(shell));
      $('btnPoserBridgeInstall')?.addEventListener('click', () => void this.installPoser(shell));
      $('btnPoserBridgeProbe')?.addEventListener('click', () => void this.probePoser(shell));
      $('btnPoserBridgePickDir')?.addEventListener('click', () => void this.pickPoserScriptsDir(shell));
      $('btnPoserBridgeUninstall')?.addEventListener('click', () => void this.uninstallPoser(shell));
      $('btnIcloneBridgeInstall')?.addEventListener('click', () => void this.installReallusion(shell, 'iclone'));
      $('btnIcloneBridgeProbe')?.addEventListener('click', () => void this.probeReallusion(shell, 'iclone'));
      $('btnIcloneBridgePickDir')?.addEventListener('click', () => void this.pickReallusionOpenPluginDir(shell, 'iclone'));
      $('btnIcloneBridgeUninstall')?.addEventListener('click', () => void this.uninstallReallusion(shell, 'iclone'));
      $('btnCharacterCreatorBridgeInstall')?.addEventListener('click', () => void this.installReallusion(shell, 'character-creator'));
      $('btnCharacterCreatorBridgeProbe')?.addEventListener('click', () => void this.probeReallusion(shell, 'character-creator'));
      $('btnCharacterCreatorBridgePickDir')?.addEventListener('click', () => void this.pickReallusionOpenPluginDir(shell, 'character-creator'));
      $('btnCharacterCreatorBridgeUninstall')?.addEventListener('click', () => void this.uninstallReallusion(shell, 'character-creator'));
      $('btnMetashapeBridgeInstall')?.addEventListener('click', () => void this.installMetashape(shell));
      $('btnMetashapeBridgeProbe')?.addEventListener('click', () => void this.probeMetashape(shell));
      $('btnMetashapeBridgePickDir')?.addEventListener('click', () => void this.pickMetashapeScriptsDir(shell));
      $('btnMetashapeBridgeUninstall')?.addEventListener('click', () => void this.uninstallMetashape(shell));
      $('btnThreeDequalizerBridgeInstall')?.addEventListener('click', () => void this.installThreeDequalizer(shell));
      $('btnThreeDequalizerBridgeProbe')?.addEventListener('click', () => void this.probeThreeDequalizer(shell));
      $('btnThreeDequalizerBridgePickDir')?.addEventListener('click', () => void this.pickThreeDequalizerScriptsDir(shell));
      $('btnThreeDequalizerBridgeUninstall')?.addEventListener('click', () => void this.uninstallThreeDequalizer(shell));
      $('btnKatanaBridgeInstall')?.addEventListener('click', () => void this.installKatana(shell));
      $('btnKatanaBridgeProbe')?.addEventListener('click', () => void this.probeKatana(shell));
      $('btnKatanaBridgePickDir')?.addEventListener('click', () => void this.pickKatanaResourceDir(shell));
      $('btnKatanaBridgeUninstall')?.addEventListener('click', () => void this.uninstallKatana(shell));
      $('btnMotionBuilderBridgeInstall')?.addEventListener('click', () => void this.installMotionBuilder(shell));
      $('btnMotionBuilderBridgeProbe')?.addEventListener('click', () => void this.probeMotionBuilder(shell));
      $('btnMotionBuilderBridgePickDir')?.addEventListener('click', () => void this.pickMotionBuilderStartupDir(shell));
      $('btnMotionBuilderBridgeUninstall')?.addEventListener('click', () => void this.uninstallMotionBuilder(shell));
      $('btnHoudiniBridgeInstall')?.addEventListener('click', () => void this.installHoudini(shell));
      $('btnHoudiniBridgeProbe')?.addEventListener('click', () => void this.probeHoudini(shell));
      $('btnHoudiniBridgePickDir')?.addEventListener('click', () => void this.pickHoudiniPrefsDir(shell));
      $('btnHoudiniBridgeUninstall')?.addEventListener('click', () => void this.uninstallHoudini(shell));
      $('btnNukeBridgeInstall')?.addEventListener('click', () => void this.installNuke(shell));
      $('btnNukeBridgeProbe')?.addEventListener('click', () => void this.probeNuke(shell));
      $('btnNukeBridgePickDir')?.addEventListener('click', () => void this.pickNukeUserDir(shell));
      $('btnNukeBridgeUninstall')?.addEventListener('click', () => void this.uninstallNuke(shell));
      $('btnNukeStudioBridgeInstall')?.addEventListener('click', () => void this.installFoundryTimeline(shell, 'nuke-studio'));
      $('btnNukeStudioBridgeProbe')?.addEventListener('click', () => void this.probeFoundryTimeline(shell, 'nuke-studio'));
      $('btnNukeStudioBridgePickDir')?.addEventListener('click', () => void this.pickFoundryTimelineUserDir(shell, 'nuke-studio'));
      $('btnNukeStudioBridgeUninstall')?.addEventListener('click', () => void this.uninstallFoundryTimeline(shell, 'nuke-studio'));
      $('btnHieroBridgeInstall')?.addEventListener('click', () => void this.installFoundryTimeline(shell, 'hiero'));
      $('btnHieroBridgeProbe')?.addEventListener('click', () => void this.probeFoundryTimeline(shell, 'hiero'));
      $('btnHieroBridgePickDir')?.addEventListener('click', () => void this.pickFoundryTimelineUserDir(shell, 'hiero'));
      $('btnHieroBridgeUninstall')?.addEventListener('click', () => void this.uninstallFoundryTimeline(shell, 'hiero'));
      $('btnNatronBridgeInstall')?.addEventListener('click', () => void this.installNatron(shell));
      $('btnNatronBridgeProbe')?.addEventListener('click', () => void this.probeNatron(shell));
      $('btnNatronBridgePickDir')?.addEventListener('click', () => void this.pickNatronUserDir(shell));
      $('btnNatronBridgeUninstall')?.addEventListener('click', () => void this.uninstallNatron(shell));
      $('btnObsStudioBridgeInstall')?.addEventListener('click', () => void this.installObsStudio(shell));
      $('btnObsStudioBridgeProbe')?.addEventListener('click', () => void this.probeObsStudio(shell));
      $('btnObsStudioBridgePickDir')?.addEventListener('click', () => void this.pickObsStudioScriptsDir(shell));
      $('btnObsStudioBridgeUninstall')?.addEventListener('click', () => void this.uninstallObsStudio(shell));
      $('btnReaperBridgeInstall')?.addEventListener('click', () => void this.installReaper(shell));
      $('btnReaperBridgeProbe')?.addEventListener('click', () => void this.probeReaper(shell));
      $('btnReaperBridgePickDir')?.addEventListener('click', () => void this.pickReaperScriptsDir(shell));
      $('btnReaperBridgeUninstall')?.addEventListener('click', () => void this.uninstallReaper(shell));
      $('btnVegasProBridgeInstall')?.addEventListener('click', () => void this.installVegasPro(shell));
      $('btnVegasProBridgeProbe')?.addEventListener('click', () => void this.probeVegasPro(shell));
      $('btnVegasProBridgePickDir')?.addEventListener('click', () => void this.pickVegasProScriptsDir(shell));
      $('btnVegasProBridgeUninstall')?.addEventListener('click', () => void this.uninstallVegasPro(shell));
      $('btnSynfigBridgeInstall')?.addEventListener('click', () => void this.installSynfig(shell));
      $('btnSynfigBridgeProbe')?.addEventListener('click', () => void this.probeSynfig(shell));
      $('btnSynfigBridgePickDir')?.addEventListener('click', () => void this.pickSynfigPluginsDir(shell));
      $('btnSynfigBridgeUninstall')?.addEventListener('click', () => void this.uninstallSynfig(shell));
      $('btnCinema4DBridgeInstall')?.addEventListener('click', () => void this.installCinema4D(shell));
      $('btnCinema4DBridgeProbe')?.addEventListener('click', () => void this.probeCinema4D(shell));
      $('btnCinema4DBridgePickDir')?.addEventListener('click', () => void this.pickCinema4DScriptsDir(shell));
      $('btnCinema4DBridgeUninstall')?.addEventListener('click', () => void this.uninstallCinema4D(shell));
      $('btnDavinciResolveBridgeInstall')?.addEventListener('click', () => void this.installDavinciResolve(shell));
      $('btnDavinciResolveBridgeProbe')?.addEventListener('click', () => void this.probeDavinciResolve(shell));
      $('btnDavinciResolveBridgePickDir')?.addEventListener('click', () => void this.pickDavinciResolveScriptsDir(shell));
      $('btnDavinciResolveBridgeUninstall')?.addEventListener('click', () => void this.uninstallDavinciResolve(shell));
      $('btnFusionStudioBridgeInstall')?.addEventListener('click', () => void this.installFusionStudio(shell));
      $('btnFusionStudioBridgeProbe')?.addEventListener('click', () => void this.probeFusionStudio(shell));
      $('btnFusionStudioBridgePickDir')?.addEventListener('click', () => void this.pickFusionStudioScriptsDir(shell));
      $('btnFusionStudioBridgeUninstall')?.addEventListener('click', () => void this.uninstallFusionStudio(shell));
      document.querySelectorAll('[data-adobe-action][data-adobe-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-adobe-id');
          const action = el.getAttribute('data-adobe-action');
          if (!id) return;
          if (action === 'install') void this.installAdobeBridge(shell, id);
          else if (action === 'probe') void this.probeAdobeBridge(shell, id);
          else if (action === 'pick') void this.pickAdobeScriptsDir(shell, id);
          else if (action === 'uninstall') void this.uninstallAdobeBridge(shell, id);
        });
      });
      $('btnLightroomBridgeInstall')?.addEventListener('click', () => void this.installLightroom(shell));
      $('btnLightroomBridgeProbe')?.addEventListener('click', () => void this.probeLightroom(shell));
      $('btnLightroomBridgePickDir')?.addEventListener('click', () => void this.pickLightroomModulesDir(shell));
      $('btnLightroomBridgeUninstall')?.addEventListener('click', () => void this.uninstallLightroom(shell));
      $('btnDarktableBridgeInstall')?.addEventListener('click', () => void this.installDarktable(shell));
      $('btnDarktableBridgeProbe')?.addEventListener('click', () => void this.probeDarktable(shell));
      $('btnDarktableBridgePickDir')?.addEventListener('click', () => void this.pickDarktableConfigDir(shell));
      $('btnDarktableBridgeUninstall')?.addEventListener('click', () => void this.uninstallDarktable(shell));
      $('btnUnityBridgeInstall')?.addEventListener('click', () => void this.installUnity(shell));
      $('btnUnityBridgeProbe')?.addEventListener('click', () => void this.probeUnity(shell));
      $('btnUnityBridgePickDir')?.addEventListener('click', () => void this.pickUnityProjectDir(shell));
      $('btnUnityBridgeUninstall')?.addEventListener('click', () => void this.uninstallUnity(shell));
      $('btnGodotBridgeInstall')?.addEventListener('click', () => void this.installGodot(shell));
      $('btnGodotBridgeProbe')?.addEventListener('click', () => void this.probeGodot(shell));
      $('btnGodotBridgePickDir')?.addEventListener('click', () => void this.pickGodotProjectDir(shell));
      $('btnGodotBridgeUninstall')?.addEventListener('click', () => void this.uninstallGodot(shell));
      $('btnFusion360BridgeInstall')?.addEventListener('click', () => void this.installFusion360(shell));
      $('btnFusion360BridgeProbe')?.addEventListener('click', () => void this.probeFusion360(shell));
      $('btnFusion360BridgePickDir')?.addEventListener('click', () => void this.pickFusion360AddinsDir(shell));
      $('btnFusion360BridgeUninstall')?.addEventListener('click', () => void this.uninstallFusion360(shell));
      $('btnKeyShotBridgeInstall')?.addEventListener('click', () => void this.installKeyShot(shell));
      $('btnKeyShotBridgeProbe')?.addEventListener('click', () => void this.probeKeyShot(shell));
      $('btnKeyShotBridgePickDir')?.addEventListener('click', () => void this.pickKeyShotScriptsDir(shell));
      $('btnKeyShotBridgeUninstall')?.addEventListener('click', () => void this.uninstallKeyShot(shell));
      $('btnMarmosetToolbagBridgeInstall')?.addEventListener('click', () => void this.installMarmosetToolbag(shell));
      $('btnMarmosetToolbagBridgeProbe')?.addEventListener('click', () => void this.probeMarmosetToolbag(shell));
      $('btnMarmosetToolbagBridgePickDir')?.addEventListener('click', () => void this.pickMarmosetToolbagScriptsDir(shell));
      $('btnMarmosetToolbagBridgeUninstall')?.addEventListener('click', () => void this.uninstallMarmosetToolbag(shell));
      $('btnModoBridgeInstall')?.addEventListener('click', () => void this.installModo(shell));
      $('btnModoBridgeProbe')?.addEventListener('click', () => void this.probeModo(shell));
      $('btnModoBridgePickDir')?.addEventListener('click', () => void this.pickModoScriptsDir(shell));
      $('btnModoBridgeUninstall')?.addEventListener('click', () => void this.uninstallModo(shell));
      $('btnLightWaveBridgeInstall')?.addEventListener('click', () => void this.installLightWave(shell));
      $('btnLightWaveBridgeProbe')?.addEventListener('click', () => void this.probeLightWave(shell));
      $('btnLightWaveBridgePickDir')?.addEventListener('click', () => void this.pickLightWaveScriptsDir(shell));
      $('btnLightWaveBridgeUninstall')?.addEventListener('click', () => void this.uninstallLightWave(shell));
      $('btnFreeCADBridgeInstall')?.addEventListener('click', () => void this.installFreeCAD(shell));
      $('btnFreeCADBridgeProbe')?.addEventListener('click', () => void this.probeFreeCAD(shell));
      $('btnFreeCADBridgePickDir')?.addEventListener('click', () => void this.pickFreeCADModDir(shell));
      $('btnFreeCADBridgeUninstall')?.addEventListener('click', () => void this.uninstallFreeCAD(shell));
      $('btnAutoCADBridgeInstall')?.addEventListener('click', () => void this.installAutoCAD(shell));
      $('btnAutoCADBridgeProbe')?.addEventListener('click', () => void this.probeAutoCAD(shell));
      $('btnAutoCADBridgePickDir')?.addEventListener('click', () => void this.pickAutoCADSupportDir(shell));
      $('btnAutoCADBridgeUninstall')?.addEventListener('click', () => void this.uninstallAutoCAD(shell));
      $('btnInkscapeBridgeInstall')?.addEventListener('click', () => void this.installInkscape(shell));
      $('btnInkscapeBridgeProbe')?.addEventListener('click', () => void this.probeInkscape(shell));
      $('btnInkscapeBridgePickDir')?.addEventListener('click', () => void this.pickInkscapeExtensionsDir(shell));
      $('btnInkscapeBridgeUninstall')?.addEventListener('click', () => void this.uninstallInkscape(shell));
      $('btnZBrushBridgeInstall')?.addEventListener('click', () => void this.installZBrush(shell));
      $('btnZBrushBridgeProbe')?.addEventListener('click', () => void this.probeZBrush(shell));
      $('btnZBrushBridgePickDir')?.addEventListener('click', () => void this.pickZBrushScriptsDir(shell));
      $('btnZBrushBridgeUninstall')?.addEventListener('click', () => void this.uninstallZBrush(shell));
      $('btnUnrealBridgeInstall')?.addEventListener('click', () => void this.installUnreal(shell));
      $('btnUnrealBridgeProbe')?.addEventListener('click', () => void this.probeUnreal(shell));
      $('btnUnrealBridgePickDir')?.addEventListener('click', () => void this.pickUnrealProjectDir(shell));
      $('btnUnrealBridgeUninstall')?.addEventListener('click', () => void this.uninstallUnreal(shell));
    },

    bridgeCatalogEntry(id) {
      return (this._bridgeCatalog || []).find((item) => item && item.id === id) || null;
    },

    async pickBridgeDraftTarget(shell, id) {
      if (!id || this._busy) return null;
      if (typeof shell.pickPath !== 'function') {
        window.alert('当前环境不支持选择目录。');
        return null;
      }
      const name = this.hostName(id);
      const r = await shell.pickPath({ pick: 'directory', title: '选择 ' + name + ' 脚本或插件目录' });
      if (!r || r.canceled || !r.path) return null;
      return r.path;
    },

    async installBridgeDraft(shell, id, targetDir) {
      if (!id || this._busy) return;
      const picked = targetDir || (await this.pickBridgeDraftTarget(shell, id));
      if (!picked) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/install', { targetDir: picked });
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '安装草稿失败');
          return;
        }
        window.alert('本地草稿已安装。请启动或重启宿主后再探测连接。');
        await this.reload(shell);
      } catch (err) {
        window.alert('安装草稿失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    selectedLaunchTargetForBridge(id) {
      const cards = Array.from(document.querySelectorAll('#bridgesList .bridge-card[data-bridge-id]'));
      const card = cards.find((item) => item.getAttribute('data-bridge-id') === id);
      if (!card) return {};
      const inputs = Array.from(card.querySelectorAll('.bridge-versions input[type="checkbox"]'));
      const checked = inputs.filter((input) => input.checked);
      const input = checked[0] || inputs[0];
      if (!input) return {};
      if (checked.length > 1) {
        this.notifyBridge('\u5df2\u9009\u62e9\u591a\u4e2a\u7248\u672c\uff0c\u5c06\u542f\u52a8\u7b2c\u4e00\u4e2a\u52fe\u9009\u7248\u672c\u3002');
      }
      const attrs = Array.from(input.attributes || []);
      const attr = attrs.find((item) => {
        if (!item || !item.name || !item.value) return false;
        if (item.name === 'data-adobe-target-id') return true;
        return /^data-.+-(version|target)$/.test(item.name);
      });
      const targetId = attr && attr.value ? String(attr.value).trim() : '';
      return targetId ? { versionId: targetId, targetId } : {};
    },

    async launchHostApp(shell, id) {
      if (!id || this._busy) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/launch', this.selectedLaunchTargetForBridge(id));
        this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || (r.ok ? '已启动宿主。' : '启动宿主失败。'));
        await this.refreshBridgeById(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async discoverRunningHostApp(shell, id) {
      if (!id || this._busy) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/discover-running', {});
        const msg = (r.json && (r.json.message || r.json.error)) || r.error || (r.ok ? '\u5df2\u8bc6\u522b\u5df2\u6253\u5f00\u8f6f\u4ef6\u3002' : '\u672a\u627e\u5230\u6b63\u5728\u8fd0\u884c\u7684\u5bbf\u4e3b\u3002');
        this.notifyBridge(r.json && r.json.nextStep && !String(msg).includes(r.json.nextStep) ? msg + ' ' + r.json.nextStep : msg);
        await this.refreshBridgeById(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async closeHostApp(shell, id) {
      if (!id || this._busy) return;
      if (!window.confirm('要关闭 ' + this.hostName(id) + ' 吗？未保存的内容可能会丢失。')) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/close', {});
        this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || (r.ok ? '已请求关闭宿主。' : '关闭宿主失败。'));
        await this.refreshBridgeById(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeBridgeDraft(shell, id) {
      if (!id || this._busy) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/probe', {});
        const msg = (r.json && (r.json.message || r.json.error)) || r.error || '探测完成';
        if (!r.ok) {
          window.alert('探测失败：' + msg);
          return;
        }
        window.alert(r.json && r.json.connected ? '连接成功：' + msg : '尚未连通：' + msg);
        await this.reload(shell);
      } catch (err) {
        window.alert('探测失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    async uninstallBridgeDraft(shell, id) {
      if (!id || this._busy) return;
      const name = this.hostName(id);
      const ok = window.confirm('确认卸载“' + name + '”本地草稿桥接？只会移除草稿安装记录中的生成文件。');
      if (!ok) return;
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/uninstall', {});
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '卸载草稿失败');
          return;
        }
        window.alert('本地草稿桥接已卸载。');
        await this.reload(shell);
      } catch (err) {
        window.alert('卸载草稿失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    async publishBridgeDraftToCloud(shell, id) {
      if (!id || this._busy) return;
      if (!this._isAdmin) {
        window.alert('当前登录账号不是管理员，无法提交云端。');
        return;
      }
      const name = this.hostName(id);
      const note = window.prompt('填写“' + name + '”云端版本说明');
      if (note == null) return;
      if (!String(note || '').trim()) {
        window.alert('版本说明不能为空。');
        return;
      }
      const semver = window.prompt('填写云端版本号，例如 1.0.0。留空则自动生成。', '');
      if (semver == null) return;
      this._busy = true;
      try {
        const r =
          typeof shell.publishHostBridgeToCloud === 'function'
            ? await shell.publishHostBridgeToCloud({
                hostId: id,
                note: String(note || '').trim(),
                semver: String(semver || '').trim(),
              })
            : await shell.api('POST', '/v1/bridges/' + encodeURIComponent(id) + '/cloud/publish', {
                note: String(note || '').trim(),
                semver: String(semver || '').trim(),
              });
        if (!r.ok) {
          if (r.error === 'not_logged_in') {
            if (typeof shell.setShellView === 'function') {
              try {
                await shell.setShellView('workbench');
              } catch {
                /* ignore */
              }
            }
            window.alert('请先在工作台登录管理员账号，然后回到宿主中心再提交云端。');
            return;
          }
          if (r.error === 'admin_required') {
            window.alert('当前登录账号不是管理员，无法提交云端。');
            return;
          }
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '提交云端失败');
          return;
        }
        const version = (r.json && r.json.version) || r.version;
        window.alert('已提交云端' + (version && version.semver ? '：v' + version.semver : '。'));
        await this.reload(shell);
      } catch (err) {
        window.alert('提交云端失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    async chooseBridgeCloudVersion(shell, id, versionId) {
      if (!id || this._busy) return;
      const entry = this.bridgeCatalogEntry(id);
      const versions = Array.isArray(entry && entry.cloudVersions) ? entry.cloudVersions : [];
      if (!versions.length) {
        window.alert('云端暂无可切换版本。');
        return;
      }
      let version = versionId ? versions.find((item) => item && item.id === versionId) : null;
      if (!version) {
        const lines = versions.map((item, index) => String(index + 1) + '. v' + (item.semver || '-') + (item.active ? '（当前）' : '') + (item.note ? ' · ' + item.note : ''));
        const picked = window.prompt('选择云端版本：\n' + lines.join('\n') + '\n\n请输入序号');
        if (picked == null) return;
        const index = Number(picked) - 1;
        version = versions[index];
      }
      if (!version || !version.id) {
        window.alert('版本序号无效。');
        return;
      }
      this._busy = true;
      try {
        const r =
          typeof shell.activateHostBridgeCloudVersion === 'function'
            ? await shell.activateHostBridgeCloudVersion({ hostId: id, versionId: version.id })
            : await shell.api(
                'POST',
                '/v1/bridges/' + encodeURIComponent(id) + '/cloud/versions/' + encodeURIComponent(version.id) + '/activate',
                {},
              );
        if (!r.ok) {
          if (r.error === 'not_logged_in') {
            if (typeof shell.setShellView === 'function') {
              try {
                await shell.setShellView('workbench');
              } catch {
                /* ignore */
              }
            }
            window.alert('请先在工作台登录管理员账号，然后回到宿主中心再切换版本。');
            return;
          }
          if (r.error === 'admin_required') {
            window.alert('当前登录账号不是管理员，无法切换云端版本。');
            return;
          }
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '切换版本失败');
          return;
        }
        window.alert('已切换到云端版本 v' + (version.semver || ''));
        await this.reload(shell);
      } catch (err) {
        window.alert('切换版本失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    async deleteBridgeDraft(shell, id) {
      if (!id || this._busy) return;
      const name = this.hostName(id);
      const ok = window.confirm('确认删除“' + name + '”本地草稿？这不会影响内置宿主或云端版本。');
      if (!ok) return;
      this._busy = true;
      try {
        const r = await shell.api('DELETE', '/v1/bridges/drafts/' + encodeURIComponent(id), null);
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '删除草稿失败');
          return;
        }
        window.alert('本地草稿已删除。');
        await this.reload(shell);
      } catch (err) {
        window.alert('删除草稿失败：' + (err && err.message ? err.message : String(err)));
      } finally {
        this._busy = false;
      }
    },

    async installMaya(shell) {
      if (this._busy) return;
      const versions = this.selectedVersionsFromDom();
      const port = parsePort($('mayaBridgePort'));
      if (!versions.length && !(this._mayaStatus && this._mayaStatus.versions && this._mayaStatus.versions.length)) {
        // Allow install via pick-only path: ask user to pick
        const ok = window.confirm('未勾选版本。是否改为选择一个 Maya scripts 目录进行安装？');
        if (!ok) return;
        await this.pickScriptsDir(shell, { installAfter: true, port });
        return;
      }
      if (!versions.length) {
        window.alert('请至少勾选一个 Maya 版本，或使用「选择 scripts…」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/maya/install', { versions, port });
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '安装失败');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启或打开 Maya，再点「探测连接」。');
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedBlenderVersionsFromDom() {
      const ids = [];
      document.querySelectorAll('#blenderBridgeVersions input[data-blender-version]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-blender-version'));
      });
      return ids;
    },

    async installBlender(shell) {
      if (this._busy) return;
      const versions = this.selectedBlenderVersionsFromDom();
      const port = parsePortWithDefault($('blenderBridgePort'), 7011);
      if (!versions.length && !(this._blenderStatus && this._blenderStatus.versions && this._blenderStatus.versions.length)) {
        const ok = window.confirm('\u672a\u627e\u5230 Blender \u7248\u672c\u3002\u8981\u624b\u52a8\u6dfb\u52a0\u4e00\u4e2a\u7248\u672c\u6216\u76ee\u5f55\u5417\uff1f');
        if (!ok) return;
        await this.pickBlenderStartupDir(shell, { port });
        return;
      }
      if (!versions.length) {
        window.alert('请至少选择一个 Blender 启动目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/blender/install', { versions, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 Blender 后再点「探测连接」。');
        await this.refreshBlender(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeBlender(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshBlender(shell);
        this.render();
        const ui = this.blenderUiState();
        await this.recordBridgeProbe(shell, 'blender', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallBlender(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Blender 启动桥接吗？')) return;
      this._busy = true;
      try {
        const versions = this.selectedBlenderVersionsFromDom();
        const r = await shell.api('POST', '/v1/bridges/blender/uninstall', versions.length ? { versions } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshBlender(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickBlenderStartupDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '\u9009\u62e9 Blender \u5b89\u88c5\u76ee\u5f55\u6216 scripts/startup \u76ee\u5f55' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('blenderBridgePort'), 7011);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/blender/install', {
          startupDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 Blender 后再点「探测连接」。');
        await this.refreshBlender(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedMaxVersionsFromDom() {
      const ids = [];
      document.querySelectorAll('#maxBridgeVersions input[data-max-version]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-max-version'));
      });
      return ids;
    },

    async installMax(shell) {
      if (this._busy) return;
      const versions = this.selectedMaxVersionsFromDom();
      const port = parsePortWithDefault($('maxBridgePort'), 7021);
      if (!versions.length && !(this._maxStatus && this._maxStatus.versions && this._maxStatus.versions.length)) {
        const ok = window.confirm('未找到 3ds Max 启动目录。要手动选择 scripts/startup 目录吗？');
        if (!ok) return;
        await this.pickMaxStartupDir(shell, { port });
        return;
      }
      if (!versions.length) {
        window.alert('请至少选择一个 3ds Max 启动目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/3ds-max/install', { versions, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 3ds Max 后再点「探测连接」。');
        await this.refreshMax(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeMax(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshMax(shell);
        this.render();
        const ui = this.maxUiState();
        await this.recordBridgeProbe(shell, '3ds-max', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallMax(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter 3ds Max 启动桥接吗？')) return;
      this._busy = true;
      try {
        const versions = this.selectedMaxVersionsFromDom();
        const r = await shell.api('POST', '/v1/bridges/3ds-max/uninstall', versions.length ? { versions } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshMax(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickMaxStartupDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 3ds Max scripts/startup 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('maxBridgePort'), 7021);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/3ds-max/install', {
          startupDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 3ds Max 后再点「探测连接」。');
        await this.refreshMax(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedSubstancePainterTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#substancePainterBridgeTargets input[data-substance-painter-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-substance-painter-target'));
      });
      return ids;
    },

    async installSubstancePainter(shell) {
      if (this._busy) return;
      const targets = this.selectedSubstancePainterTargetsFromDom();
      const port = parsePortWithDefault($('substancePainterBridgePort'), 7031);
      if (!targets.length && !(this._substanceStatus && this._substanceStatus.targets && this._substanceStatus.targets.length)) {
        const ok = window.confirm('未找到 Substance Painter python/plugins 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickSubstancePainterPluginDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Substance Painter 插件目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/substance-painter/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 Substance Painter 中启用或重启插件后，再点「探测连接」。');
        await this.refreshSubstancePainter(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeSubstancePainter(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshSubstancePainter(shell);
        this.render();
        const ui = this.substancePainterUiState();
        await this.recordBridgeProbe(shell, 'substance-painter', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallSubstancePainter(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Substance Painter 插件桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedSubstancePainterTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/substance-painter/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshSubstancePainter(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickSubstancePainterPluginDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Substance Painter python/plugins 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('substancePainterBridgePort'), 7031);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/substance-painter/install', {
          pluginDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 Substance Painter 中启用或重启插件后，再点「探测连接」。');
        await this.refreshSubstancePainter(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedRhinoTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#rhinoBridgeTargets input[data-rhino-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-rhino-target'));
      });
      return ids;
    },

    async installRhino(shell) {
      if (this._busy) return;
      const targets = this.selectedRhinoTargetsFromDom();
      const port = parsePortWithDefault($('rhinoBridgePort'), 7141);
      if (!targets.length && !(this._rhinoStatus && this._rhinoStatus.targets && this._rhinoStatus.targets.length)) {
        const ok = window.confirm('未找到 Rhino scripts 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickRhinoScriptsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Rhino 脚本目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/rhino/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 Rhino 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshRhino(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeRhino(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshRhino(shell);
        this.render();
        const ui = this.rhinoUiState();
        await this.recordBridgeProbe(shell, 'rhino', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallRhino(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Rhino 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedRhinoTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/rhino/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshRhino(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickRhinoScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Rhino scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('rhinoBridgePort'), 7141);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/rhino/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 Rhino 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshRhino(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedSketchUpTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#sketchupBridgeTargets input[data-sketchup-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-sketchup-target'));
      });
      return ids;
    },

    async installSketchUp(shell) {
      if (this._busy) return;
      const targets = this.selectedSketchUpTargetsFromDom();
      const port = parsePortWithDefault($('sketchupBridgePort'), 7151);
      if (!targets.length && !(this._sketchupStatus && this._sketchupStatus.targets && this._sketchupStatus.targets.length)) {
        const ok = window.confirm('未找到 SketchUp Plugins 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickSketchUpPluginDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 SketchUp 插件目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/sketchup/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 SketchUp 后再点「探测连接」。');
        await this.refreshSketchUp(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeSketchUp(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshSketchUp(shell);
        this.render();
        const ui = this.sketchUpUiState();
        await this.recordBridgeProbe(shell, 'sketchup', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallSketchUp(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter SketchUp 插件桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedSketchUpTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/sketchup/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshSketchUp(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickSketchUpPluginDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 SketchUp Plugins 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('sketchupBridgePort'), 7151);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/sketchup/install', {
          pluginDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 SketchUp 后再点「探测连接」。');
        await this.refreshSketchUp(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedMotionBuilderVersionsFromDom() {
      const ids = [];
      document.querySelectorAll('#motionBuilderBridgeVersions input[data-motionbuilder-version]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-motionbuilder-version'));
      });
      return ids;
    },

    async installMotionBuilder(shell) {
      if (this._busy) return;
      const versions = this.selectedMotionBuilderVersionsFromDom();
      const port = parsePortWithDefault($('motionBuilderBridgePort'), 7181);
      if (!versions.length && !(this._motionBuilderStatus && this._motionBuilderStatus.versions && this._motionBuilderStatus.versions.length)) {
        const ok = window.confirm('未找到 MotionBuilder PythonStartup 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickMotionBuilderStartupDir(shell, { port });
        return;
      }
      if (!versions.length) {
        window.alert('请至少选择一个 MotionBuilder PythonStartup 目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/motionbuilder/install', { versions, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 MotionBuilder 后再点「探测连接」。');
        await this.refreshMotionBuilder(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeMotionBuilder(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshMotionBuilder(shell);
        this.render();
        const ui = this.motionBuilderUiState();
        await this.recordBridgeProbe(shell, 'motionbuilder', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallMotionBuilder(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter MotionBuilder 启动桥接吗？')) return;
      this._busy = true;
      try {
        const versions = this.selectedMotionBuilderVersionsFromDom();
        const r = await shell.api('POST', '/v1/bridges/motionbuilder/uninstall', versions.length ? { versions } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshMotionBuilder(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickMotionBuilderStartupDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 MotionBuilder PythonStartup 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('motionBuilderBridgePort'), 7181);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/motionbuilder/install', {
          startupDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 MotionBuilder 后再点「探测连接」。');
        await this.refreshMotionBuilder(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedHoudiniTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#houdiniBridgeTargets input[data-houdini-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-houdini-target'));
      });
      return ids;
    },

    async installHoudini(shell) {
      if (this._busy) return;
      const targets = this.selectedHoudiniTargetsFromDom();
      const port = parsePortWithDefault($('houdiniBridgePort'), 7041);
      if (!targets.length && !(this._houdiniStatus && this._houdiniStatus.targets && this._houdiniStatus.targets.length)) {
        const ok = window.confirm('未找到 Houdini 偏好设置目录。要手动选择 houdiniXX.X 目录吗？');
        if (!ok) return;
        await this.pickHoudiniPrefsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Houdini 偏好设置目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/houdini/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 Houdini 后再点「探测连接」。');
        await this.refreshHoudini(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeHoudini(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshHoudini(shell);
        this.render();
        const ui = this.houdiniUiState();
        await this.recordBridgeProbe(shell, 'houdini', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallHoudini(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Houdini 启动桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedHoudiniTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/houdini/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshHoudini(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickHoudiniPrefsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Houdini 偏好设置目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('houdiniBridgePort'), 7041);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/houdini/install', {
          prefsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 Houdini 后再点「探测连接」。');
        await this.refreshHoudini(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedNukeTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#nukeBridgeTargets input[data-nuke-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-nuke-target'));
      });
      return ids;
    },

    async installNuke(shell) {
      if (this._busy) return;
      const targets = this.selectedNukeTargetsFromDom();
      const port = parsePortWithDefault($('nukeBridgePort'), 7051);
      if (!targets.length && !(this._nukeStatus && this._nukeStatus.targets && this._nukeStatus.targets.length)) {
        const ok = window.confirm('未找到 Nuke 用户脚本目录。要手动选择 .nuke 目录吗？');
        if (!ok) return;
        await this.pickNukeUserDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Nuke .nuke 目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/nuke/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 Nuke 后再点「探测连接」。');
        await this.refreshNuke(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeNuke(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshNuke(shell);
        this.render();
        const ui = this.nukeUiState();
        await this.recordBridgeProbe(shell, 'nuke', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallNuke(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Nuke 启动桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedNukeTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/nuke/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshNuke(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickNukeUserDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Nuke .nuke 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('nukeBridgePort'), 7051);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/nuke/install', {
          userDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 Nuke 后再点「探测连接」。');
        await this.refreshNuke(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedCinema4DTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#cinema4dBridgeTargets input[data-cinema4d-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-cinema4d-target'));
      });
      return ids;
    },

    async installCinema4D(shell) {
      if (this._busy) return;
      const targets = this.selectedCinema4DTargetsFromDom();
      const port = parsePortWithDefault($('cinema4dBridgePort'), 7061);
      if (!targets.length && !(this._cinema4dStatus && this._cinema4dStatus.targets && this._cinema4dStatus.targets.length)) {
        const ok = window.confirm('未找到 Cinema 4D scripts 目录。要手动选择 library/scripts 目录吗？');
        if (!ok) return;
        await this.pickCinema4DScriptsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Cinema 4D 脚本目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/cinema-4d/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 Cinema 4D 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshCinema4D(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeCinema4D(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshCinema4D(shell);
        this.render();
        const ui = this.cinema4dUiState();
        await this.recordBridgeProbe(shell, 'cinema-4d', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallCinema4D(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Cinema 4D 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedCinema4DTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/cinema-4d/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshCinema4D(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickCinema4DScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Cinema 4D library/scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('cinema4dBridgePort'), 7061);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/cinema-4d/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 Cinema 4D 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshCinema4D(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedDavinciResolveTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#davinciResolveBridgeTargets input[data-davinci-resolve-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-davinci-resolve-target'));
      });
      return ids;
    },

    async installDavinciResolve(shell) {
      if (this._busy) return;
      const targets = this.selectedDavinciResolveTargetsFromDom();
      const port = parsePortWithDefault($('davinciResolveBridgePort'), 7071);
      if (!targets.length && !(this._davinciStatus && this._davinciStatus.targets && this._davinciStatus.targets.length)) {
        const ok = window.confirm('未找到 DaVinci Resolve Scripts 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickDavinciResolveScriptsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 DaVinci Resolve Scripts 目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/davinci-resolve/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 DaVinci Resolve 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshDavinciResolve(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeDavinciResolve(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshDavinciResolve(shell);
        this.render();
        const ui = this.davinciResolveUiState();
        await this.recordBridgeProbe(shell, 'davinci-resolve', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallDavinciResolve(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter DaVinci Resolve 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedDavinciResolveTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/davinci-resolve/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshDavinciResolve(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickDavinciResolveScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 DaVinci Resolve Scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('davinciResolveBridgePort'), 7071);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/davinci-resolve/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 DaVinci Resolve 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshDavinciResolve(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    adobePortInputId(id) {
      return id.replace(/[^a-z0-9]/g, '') + 'BridgePort';
    },

    selectedAdobeTargetsFromDom(id) {
      const ids = [];
      document.querySelectorAll('input[data-adobe-target="' + id + '"][data-adobe-target-id]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-adobe-target-id'));
      });
      return ids;
    },

    async installAdobeBridge(shell, id) {
      if (this._busy) return;
      const targets = this.selectedAdobeTargetsFromDom(id);
      const meta = this.adobeHostMeta(id);
      const status = this[this.adobeStatusKey(id)] || {};
      const port = parsePortWithDefault($(this.adobePortInputId(id)), meta.port);
      if (!targets.length && !(status.targets && status.targets.length)) {
        const ok = window.confirm('未找到 ' + meta.name + ' 脚本目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickAdobeScriptsDir(shell, id, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 ' + meta.name + ' 脚本目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + id + '/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请运行或重启已安装脚本后，再点「探测连接」。');
        await this.refreshAdobeBridge(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeAdobeBridge(shell, id) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshAdobeBridge(shell, id);
        this.render();
        const ui = this.adobeUiState(id);
        await this.recordBridgeProbe(shell, id, ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallAdobeBridge(shell, id) {
      if (this._busy) return;
      const meta = this.adobeHostMeta(id);
      if (!window.confirm('要卸载 AssetCutter ' + meta.name + ' 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedAdobeTargetsFromDom(id);
        const r = await shell.api('POST', '/v1/bridges/' + id + '/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshAdobeBridge(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickAdobeScriptsDir(shell, id, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const meta = this.adobeHostMeta(id);
      const r = await shell.pickPath({ pick: 'directory', title: '选择 ' + meta.name + ' 安装目录或脚本目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($(this.adobePortInputId(id)), meta.port);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/' + id + '/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请运行或重启已安装脚本后，再点「探测连接」。');
        await this.refreshAdobeBridge(shell, id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedUnityTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#unityBridgeTargets input[data-unity-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-unity-target'));
      });
      return ids;
    },

    async installUnity(shell) {
      if (this._busy) return;
      const targets = this.selectedUnityTargetsFromDom();
      const port = parsePortWithDefault($('unityBridgePort'), 7111);
      if (!targets.length && !(this._unityStatus && this._unityStatus.targets && this._unityStatus.targets.length)) {
        const ok = window.confirm('未找到 Unity 项目目录。要手动选择一个项目吗？');
        if (!ok) return;
        await this.pickUnityProjectDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Unity 项目，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/unity/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请打开或重新编译 Unity 项目后，再点「探测连接」。');
        await this.refreshUnity(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeUnity(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshUnity(shell);
        this.render();
        const ui = this.unityUiState();
        await this.recordBridgeProbe(shell, 'unity', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallUnity(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Unity 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedUnityTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/unity/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshUnity(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickUnityProjectDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Unity 项目根目录（需要包含 Assets 文件夹）' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('unityBridgePort'), 7111);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/unity/install', {
          projectDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请打开或重新编译 Unity 项目后，再点「探测连接」。');
        await this.refreshUnity(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedGodotTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#godotBridgeTargets input[data-godot-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-godot-target'));
      });
      return ids;
    },

    async installGodot(shell) {
      if (this._busy) return;
      const targets = this.selectedGodotTargetsFromDom();
      const port = parsePortWithDefault($('godotBridgePort'), 7171);
      if (!targets.length && !(this._godotStatus && this._godotStatus.targets && this._godotStatus.targets.length)) {
        const ok = window.confirm('未找到 Godot 项目目录。要手动选择一个项目吗？');
        if (!ok) return;
        await this.pickGodotProjectDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Godot 项目，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/godot/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 Godot 项目设置中启用 AssetCutter Bridge 插件后，再点「探测连接」。');
        await this.refreshGodot(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeGodot(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshGodot(shell);
        this.render();
        const ui = this.godotUiState();
        await this.recordBridgeProbe(shell, 'godot', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallGodot(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Godot 插件桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedGodotTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/godot/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshGodot(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickGodotProjectDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Godot 项目根目录（需要包含 project.godot）' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('godotBridgePort'), 7171);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/godot/install', {
          projectDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 Godot 项目设置中启用 AssetCutter Bridge 插件后，再点「探测连接」。');
        await this.refreshGodot(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedFusion360TargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#fusion360BridgeTargets input[data-fusion-360-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-fusion-360-target'));
      });
      return ids;
    },

    async installFusion360(shell) {
      if (this._busy) return;
      const targets = this.selectedFusion360TargetsFromDom();
      const port = parsePortWithDefault($('fusion360BridgePort'), 7191);
      if (!targets.length && !(this._fusion360Status && this._fusion360Status.targets && this._fusion360Status.targets.length)) {
        const ok = window.confirm('未找到 Fusion 360 API/AddIns 目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickFusion360AddinsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Fusion 360 AddIns 目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/fusion-360/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启 Fusion 360 或启用 AddIn 后，再点「探测连接」。');
        await this.refreshFusion360(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeFusion360(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshFusion360(shell);
        this.render();
        const ui = this.fusion360UiState();
        await this.recordBridgeProbe(shell, 'fusion-360', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallFusion360(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Fusion 360 AddIn 桥接吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedFusion360TargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/fusion-360/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshFusion360(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickFusion360AddinsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Fusion 360 API/AddIns 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('fusion360BridgePort'), 7191);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/fusion-360/install', {
          addinsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启 Fusion 360 或启用 AddIn 后，再点「探测连接」。');
        await this.refreshFusion360(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    scriptBridgeTargetIdsFromDom(targetsId, dataAttr) {
      const ids = [];
      document.querySelectorAll('#' + targetsId + ' input[data-' + dataAttr + ']').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-' + dataAttr));
      });
      return ids;
    },

    async installScriptBridge(shell, opts) {
      if (this._busy) return;
      const targets = this.scriptBridgeTargetIdsFromDom(opts.targetsId, opts.dataAttr);
      const port = parsePortWithDefault($(opts.portId), opts.defaultPort);
      const st = this.statusForBridge(opts.id);
      if (!targets.length && !(st && st.targets && st.targets.length)) {
        const ok = window.confirm('未找到 ' + opts.name + ' 脚本目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickScriptBridgeDir(shell, opts, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 ' + opts.name + ' 脚本目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/' + opts.id + '/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 ' + opts.name + ' 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshBridgeById(shell, opts.id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeScriptBridge(shell, opts) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshBridgeById(shell, opts.id);
        this.render();
        const ui = this.uiStateForBridge(opts.id);
        await this.recordBridgeProbe(shell, opts.id, ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallScriptBridge(shell, opts) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter ' + opts.name + ' 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.scriptBridgeTargetIdsFromDom(opts.targetsId, opts.dataAttr);
        const r = await shell.api('POST', '/v1/bridges/' + opts.id + '/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshBridgeById(shell, opts.id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickScriptBridgeDir(shell, opts, pickOpts) {
      pickOpts = pickOpts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 ' + opts.name + ' scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = pickOpts.port != null ? pickOpts.port : parsePortWithDefault($(opts.portId), opts.defaultPort);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/' + opts.id + '/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 ' + opts.name + ' 中运行 AssetCutter 脚本后，再点「探测连接」。');
        await this.refreshBridgeById(shell, opts.id);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    keyShotBridgeOptions() {
      return {
        id: 'keyshot',
        name: 'KeyShot',
        defaultPort: 7201,
        portId: 'keyShotBridgePort',
        targetsId: 'keyShotBridgeTargets',
        dataAttr: 'keyshot-target',
      };
    },

    marmosetToolbagBridgeOptions() {
      return {
        id: 'marmoset-toolbag',
        name: 'Marmoset Toolbag',
        defaultPort: 7211,
        portId: 'marmosetToolbagBridgePort',
        targetsId: 'marmosetToolbagBridgeTargets',
        dataAttr: 'marmoset-toolbag-target',
      };
    },

    modoBridgeOptions() {
      return {
        id: 'modo',
        name: 'Modo',
        defaultPort: 7271,
        portId: 'modoBridgePort',
        targetsId: 'modoBridgeTargets',
        dataAttr: 'modo-target',
      };
    },

    lightWaveBridgeOptions() {
      return {
        id: 'lightwave',
        name: 'LightWave 3D',
        defaultPort: 7281,
        portId: 'lightWaveBridgePort',
        targetsId: 'lightWaveBridgeTargets',
        dataAttr: 'lightwave-target',
      };
    },

    freeCADBridgeOptions() {
      return {
        id: 'freecad',
        name: 'FreeCAD',
        defaultPort: 7291,
        portId: 'freeCADBridgePort',
        targetsId: 'freeCADBridgeTargets',
        dataAttr: 'freecad-target',
      };
    },

    autoCADBridgeOptions() {
      return {
        id: 'autocad',
        name: 'AutoCAD',
        defaultPort: 7371,
        portId: 'autoCADBridgePort',
        targetsId: 'autoCADBridgeTargets',
        dataAttr: 'autocad-target',
      };
    },

    kritaBridgeOptions() {
      return {
        id: 'krita',
        name: 'Krita',
        defaultPort: 7221,
        portId: 'kritaBridgePort',
        targetsId: 'kritaBridgeTargets',
        dataAttr: 'krita-target',
      };
    },

    gimpBridgeOptions() {
      return {
        id: 'gimp',
        name: 'GIMP',
        defaultPort: 7251,
        portId: 'gimpBridgePort',
        targetsId: 'gimpBridgeTargets',
        dataAttr: 'gimp-target',
      };
    },

    asepriteBridgeOptions() {
      return {
        id: 'aseprite',
        name: 'Aseprite',
        defaultPort: 7381,
        portId: 'asepriteBridgePort',
        targetsId: 'asepriteBridgeTargets',
        dataAttr: 'aseprite-target',
      };
    },

    mohoBridgeOptions() {
      return {
        id: 'moho',
        name: 'Moho',
        defaultPort: 7401,
        portId: 'mohoBridgePort',
        targetsId: 'mohoBridgeTargets',
        dataAttr: 'moho-target',
      };
    },

    toonBoomHarmonyBridgeOptions() {
      return {
        id: 'toon-boom-harmony',
        name: 'Toon Boom Harmony',
        defaultPort: 7411,
        portId: 'toonBoomHarmonyBridgePort',
        targetsId: 'toonBoomHarmonyBridgeTargets',
        dataAttr: 'toon-boom-harmony-target',
      };
    },

    openToonzBridgeOptions() {
      return {
        id: 'opentoonz',
        name: 'OpenToonz',
        defaultPort: 7421,
        portId: 'openToonzBridgePort',
        targetsId: 'openToonzBridgeTargets',
        dataAttr: 'opentoonz-target',
      };
    },

    cavalryBridgeOptions() {
      return {
        id: 'cavalry',
        name: 'Cavalry',
        defaultPort: 7431,
        portId: 'cavalryBridgePort',
        targetsId: 'cavalryBridgeTargets',
        dataAttr: 'cavalry-target',
      };
    },

    tvPaintBridgeOptions() {
      return {
        id: 'tvpaint',
        name: 'TVPaint Animation',
        defaultPort: 7481,
        portId: 'tvPaintBridgePort',
        targetsId: 'tvPaintBridgeTargets',
        dataAttr: 'tvpaint-target',
      };
    },

    cloMarvelousBridgeOptions(id) {
      const isClo = id === 'clo';
      return {
        id,
        name: isClo ? 'CLO' : 'Marvelous Designer',
        defaultPort: isClo ? 7451 : 7441,
        portId: isClo ? 'cloBridgePort' : 'marvelousDesignerBridgePort',
        targetsId: isClo ? 'cloBridgeTargets' : 'marvelousDesignerBridgeTargets',
        dataAttr: isClo ? 'clo-target' : 'marvelous-designer-target',
      };
    },

    rizomUvBridgeOptions() {
      return {
        id: 'rizomuv',
        name: 'RizomUV',
        defaultPort: 7461,
        portId: 'rizomUvBridgePort',
        targetsId: 'rizomUvBridgeTargets',
        dataAttr: 'rizomuv-target',
      };
    },

    dazStudioBridgeOptions() {
      return {
        id: 'daz-studio',
        name: 'Daz Studio',
        defaultPort: 7501,
        portId: 'dazStudioBridgePort',
        targetsId: 'dazStudioBridgeTargets',
        dataAttr: 'daz-studio-target',
      };
    },

    poserBridgeOptions() {
      return {
        id: 'poser',
        name: 'Poser',
        defaultPort: 7511,
        portId: 'poserBridgePort',
        targetsId: 'poserBridgeTargets',
        dataAttr: 'poser-target',
      };
    },

    reallusionBridgeOptions(id) {
      const isIclone = id === 'iclone';
      return {
        id,
        name: isIclone ? 'iClone' : 'Character Creator',
        defaultPort: isIclone ? 7521 : 7531,
        portId: isIclone ? 'icloneBridgePort' : 'characterCreatorBridgePort',
        targetsId: isIclone ? 'icloneBridgeTargets' : 'characterCreatorBridgeTargets',
        dataAttr: isIclone ? 'iclone-target' : 'character-creator-target',
      };
    },

    metashapeBridgeOptions() {
      return {
        id: 'metashape',
        name: 'Metashape',
        defaultPort: 7541,
        portId: 'metashapeBridgePort',
        targetsId: 'metashapeBridgeTargets',
        dataAttr: 'metashape-target',
      };
    },

    threeDequalizerBridgeOptions() {
      return {
        id: '3dequalizer',
        name: '3DEqualizer',
        defaultPort: 7551,
        portId: 'threeDequalizerBridgePort',
        targetsId: 'threeDequalizerBridgeTargets',
        dataAttr: '3dequalizer-target',
      };
    },

    katanaBridgeOptions() {
      return {
        id: 'katana',
        name: 'Katana',
        defaultPort: 7571,
        portId: 'katanaBridgePort',
        targetsId: 'katanaBridgeTargets',
        dataAttr: 'katana-target',
      };
    },

    foundryTimelineBridgeOptions(id) {
      const isHiero = id === 'hiero';
      return {
        id,
        name: isHiero ? 'Hiero' : 'Nuke Studio',
        defaultPort: isHiero ? 7591 : 7581,
        portId: isHiero ? 'hieroBridgePort' : 'nukeStudioBridgePort',
        targetsId: isHiero ? 'hieroBridgeTargets' : 'nukeStudioBridgeTargets',
        dataAttr: isHiero ? 'hiero-target' : 'nuke-studio-target',
      };
    },

    lightroomBridgeOptions() {
      return {
        id: 'lightroom-classic',
        name: 'Lightroom Classic',
        defaultPort: 7561,
        portId: 'lightroomBridgePort',
        targetsId: 'lightroomBridgeTargets',
        dataAttr: 'lightroom-classic-target',
      };
    },

    darktableBridgeOptions() {
      return {
        id: 'darktable',
        name: 'darktable',
        defaultPort: 7611,
        portId: 'darktableBridgePort',
        targetsId: 'darktableBridgeTargets',
        dataAttr: 'darktable-target',
      };
    },

    vegasProBridgeOptions() {
      return {
        id: 'vegas-pro',
        name: 'VEGAS Pro',
        defaultPort: 7471,
        portId: 'vegasProBridgePort',
        targetsId: 'vegasProBridgeTargets',
        dataAttr: 'vegas-pro-target',
      };
    },

    synfigBridgeOptions() {
      return {
        id: 'synfig',
        name: 'Synfig Studio',
        defaultPort: 7491,
        portId: 'synfigBridgePort',
        targetsId: 'synfigBridgeTargets',
        dataAttr: 'synfig-target',
      };
    },

    substanceDesignerBridgeOptions() {
      return {
        id: 'substance-designer',
        name: 'Substance Designer',
        defaultPort: 7341,
        portId: 'substanceDesignerBridgePort',
        targetsId: 'substanceDesignerBridgeTargets',
        dataAttr: 'substance-designer-target',
      };
    },

    mariBridgeOptions() {
      return {
        id: 'mari',
        name: 'Mari',
        defaultPort: 7231,
        portId: 'mariBridgePort',
        targetsId: 'mariBridgeTargets',
        dataAttr: 'mari-target',
      };
    },

    inkscapeBridgeOptions() {
      return {
        id: 'inkscape',
        name: 'Inkscape',
        defaultPort: 7241,
        portId: 'inkscapeBridgePort',
        targetsId: 'inkscapeBridgeTargets',
        dataAttr: 'inkscape-target',
      };
    },

    natronBridgeOptions() {
      return {
        id: 'natron',
        name: 'Natron',
        defaultPort: 7261,
        portId: 'natronBridgePort',
        targetsId: 'natronBridgeTargets',
        dataAttr: 'natron-target',
      };
    },

    fusionStudioBridgeOptions() {
      return {
        id: 'fusion-studio',
        name: 'Fusion Studio',
        defaultPort: 7391,
        portId: 'fusionStudioBridgePort',
        targetsId: 'fusionStudioBridgeTargets',
        dataAttr: 'fusion-studio-target',
      };
    },

    obsStudioBridgeOptions() {
      return {
        id: 'obs-studio',
        name: 'OBS Studio',
        defaultPort: 7351,
        portId: 'obsStudioBridgePort',
        targetsId: 'obsStudioBridgeTargets',
        dataAttr: 'obs-studio-target',
      };
    },

    reaperBridgeOptions() {
      return {
        id: 'reaper',
        name: 'REAPER',
        defaultPort: 7361,
        portId: 'reaperBridgePort',
        targetsId: 'reaperBridgeTargets',
        dataAttr: 'reaper-target',
      };
    },

    installKeyShot(shell) {
      return this.installScriptBridge(shell, this.keyShotBridgeOptions());
    },

    probeKeyShot(shell) {
      return this.probeScriptBridge(shell, this.keyShotBridgeOptions());
    },

    uninstallKeyShot(shell) {
      return this.uninstallScriptBridge(shell, this.keyShotBridgeOptions());
    },

    pickKeyShotScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.keyShotBridgeOptions(), opts);
    },

    installMarmosetToolbag(shell) {
      return this.installScriptBridge(shell, this.marmosetToolbagBridgeOptions());
    },

    probeMarmosetToolbag(shell) {
      return this.probeScriptBridge(shell, this.marmosetToolbagBridgeOptions());
    },

    uninstallMarmosetToolbag(shell) {
      return this.uninstallScriptBridge(shell, this.marmosetToolbagBridgeOptions());
    },

    pickMarmosetToolbagScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.marmosetToolbagBridgeOptions(), opts);
    },

    installModo(shell) {
      return this.installScriptBridge(shell, this.modoBridgeOptions());
    },

    probeModo(shell) {
      return this.probeScriptBridge(shell, this.modoBridgeOptions());
    },

    uninstallModo(shell) {
      return this.uninstallScriptBridge(shell, this.modoBridgeOptions());
    },

    pickModoScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.modoBridgeOptions(), opts);
    },

    installLightWave(shell) {
      return this.installScriptBridge(shell, this.lightWaveBridgeOptions());
    },

    probeLightWave(shell) {
      return this.probeScriptBridge(shell, this.lightWaveBridgeOptions());
    },

    uninstallLightWave(shell) {
      return this.uninstallScriptBridge(shell, this.lightWaveBridgeOptions());
    },

    pickLightWaveScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.lightWaveBridgeOptions(), opts);
    },

    installFreeCAD(shell) {
      return this.installScriptBridge(shell, this.freeCADBridgeOptions());
    },

    probeFreeCAD(shell) {
      return this.probeScriptBridge(shell, this.freeCADBridgeOptions());
    },

    uninstallFreeCAD(shell) {
      return this.uninstallScriptBridge(shell, this.freeCADBridgeOptions());
    },

    pickFreeCADModDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.freeCADBridgeOptions(), opts);
    },

    installAutoCAD(shell) {
      return this.installScriptBridge(shell, this.autoCADBridgeOptions());
    },

    probeAutoCAD(shell) {
      return this.probeScriptBridge(shell, this.autoCADBridgeOptions());
    },

    uninstallAutoCAD(shell) {
      return this.uninstallScriptBridge(shell, this.autoCADBridgeOptions());
    },

    pickAutoCADSupportDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.autoCADBridgeOptions(), opts);
    },

    installKrita(shell) {
      return this.installScriptBridge(shell, this.kritaBridgeOptions());
    },

    probeKrita(shell) {
      return this.probeScriptBridge(shell, this.kritaBridgeOptions());
    },

    uninstallKrita(shell) {
      return this.uninstallScriptBridge(shell, this.kritaBridgeOptions());
    },

    pickKritaPykritaDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.kritaBridgeOptions(), opts);
    },

    installGimp(shell) {
      return this.installScriptBridge(shell, this.gimpBridgeOptions());
    },

    probeGimp(shell) {
      return this.probeScriptBridge(shell, this.gimpBridgeOptions());
    },

    uninstallGimp(shell) {
      return this.uninstallScriptBridge(shell, this.gimpBridgeOptions());
    },

    pickGimpPluginDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.gimpBridgeOptions(), opts);
    },

    installAseprite(shell) {
      return this.installScriptBridge(shell, this.asepriteBridgeOptions());
    },

    probeAseprite(shell) {
      return this.probeScriptBridge(shell, this.asepriteBridgeOptions());
    },

    uninstallAseprite(shell) {
      return this.uninstallScriptBridge(shell, this.asepriteBridgeOptions());
    },

    pickAsepriteScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.asepriteBridgeOptions(), opts);
    },

    installMoho(shell) {
      return this.installScriptBridge(shell, this.mohoBridgeOptions());
    },

    probeMoho(shell) {
      return this.probeScriptBridge(shell, this.mohoBridgeOptions());
    },

    uninstallMoho(shell) {
      return this.uninstallScriptBridge(shell, this.mohoBridgeOptions());
    },

    pickMohoScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.mohoBridgeOptions(), opts);
    },

    installToonBoomHarmony(shell) {
      return this.installScriptBridge(shell, this.toonBoomHarmonyBridgeOptions());
    },

    probeToonBoomHarmony(shell) {
      return this.probeScriptBridge(shell, this.toonBoomHarmonyBridgeOptions());
    },

    uninstallToonBoomHarmony(shell) {
      return this.uninstallScriptBridge(shell, this.toonBoomHarmonyBridgeOptions());
    },

    pickToonBoomHarmonyScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.toonBoomHarmonyBridgeOptions(), opts);
    },

    installOpenToonz(shell) {
      return this.installScriptBridge(shell, this.openToonzBridgeOptions());
    },

    probeOpenToonz(shell) {
      return this.probeScriptBridge(shell, this.openToonzBridgeOptions());
    },

    uninstallOpenToonz(shell) {
      return this.uninstallScriptBridge(shell, this.openToonzBridgeOptions());
    },

    pickOpenToonzScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.openToonzBridgeOptions(), opts);
    },

    installCavalry(shell) {
      return this.installScriptBridge(shell, this.cavalryBridgeOptions());
    },

    probeCavalry(shell) {
      return this.probeScriptBridge(shell, this.cavalryBridgeOptions());
    },

    uninstallCavalry(shell) {
      return this.uninstallScriptBridge(shell, this.cavalryBridgeOptions());
    },

    pickCavalryScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.cavalryBridgeOptions(), opts);
    },

    installTvPaint(shell) {
      return this.installScriptBridge(shell, this.tvPaintBridgeOptions());
    },

    probeTvPaint(shell) {
      return this.probeScriptBridge(shell, this.tvPaintBridgeOptions());
    },

    uninstallTvPaint(shell) {
      return this.uninstallScriptBridge(shell, this.tvPaintBridgeOptions());
    },

    pickTvPaintScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.tvPaintBridgeOptions(), opts);
    },

    installCloMarvelous(shell, id) {
      return this.installScriptBridge(shell, this.cloMarvelousBridgeOptions(id));
    },

    probeCloMarvelous(shell, id) {
      return this.probeScriptBridge(shell, this.cloMarvelousBridgeOptions(id));
    },

    uninstallCloMarvelous(shell, id) {
      return this.uninstallScriptBridge(shell, this.cloMarvelousBridgeOptions(id));
    },

    pickCloMarvelousScriptsDir(shell, id, opts) {
      return this.pickScriptBridgeDir(shell, this.cloMarvelousBridgeOptions(id), opts);
    },

    installRizomUv(shell) {
      return this.installScriptBridge(shell, this.rizomUvBridgeOptions());
    },

    probeRizomUv(shell) {
      return this.probeScriptBridge(shell, this.rizomUvBridgeOptions());
    },

    uninstallRizomUv(shell) {
      return this.uninstallScriptBridge(shell, this.rizomUvBridgeOptions());
    },

    pickRizomUvScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.rizomUvBridgeOptions(), opts);
    },

    installDazStudio(shell) {
      return this.installScriptBridge(shell, this.dazStudioBridgeOptions());
    },

    probeDazStudio(shell) {
      return this.probeScriptBridge(shell, this.dazStudioBridgeOptions());
    },

    uninstallDazStudio(shell) {
      return this.uninstallScriptBridge(shell, this.dazStudioBridgeOptions());
    },

    pickDazStudioScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.dazStudioBridgeOptions(), opts);
    },

    installPoser(shell) {
      return this.installScriptBridge(shell, this.poserBridgeOptions());
    },

    probePoser(shell) {
      return this.probeScriptBridge(shell, this.poserBridgeOptions());
    },

    uninstallPoser(shell) {
      return this.uninstallScriptBridge(shell, this.poserBridgeOptions());
    },

    pickPoserScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.poserBridgeOptions(), opts);
    },

    installReallusion(shell, id) {
      return this.installScriptBridge(shell, this.reallusionBridgeOptions(id));
    },

    probeReallusion(shell, id) {
      return this.probeScriptBridge(shell, this.reallusionBridgeOptions(id));
    },

    uninstallReallusion(shell, id) {
      return this.uninstallScriptBridge(shell, this.reallusionBridgeOptions(id));
    },

    pickReallusionOpenPluginDir(shell, id, opts) {
      return this.pickScriptBridgeDir(shell, this.reallusionBridgeOptions(id), opts);
    },

    installMetashape(shell) {
      return this.installScriptBridge(shell, this.metashapeBridgeOptions());
    },

    probeMetashape(shell) {
      return this.probeScriptBridge(shell, this.metashapeBridgeOptions());
    },

    uninstallMetashape(shell) {
      return this.uninstallScriptBridge(shell, this.metashapeBridgeOptions());
    },

    pickMetashapeScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.metashapeBridgeOptions(), opts);
    },

    installThreeDequalizer(shell) {
      return this.installScriptBridge(shell, this.threeDequalizerBridgeOptions());
    },

    probeThreeDequalizer(shell) {
      return this.probeScriptBridge(shell, this.threeDequalizerBridgeOptions());
    },

    uninstallThreeDequalizer(shell) {
      return this.uninstallScriptBridge(shell, this.threeDequalizerBridgeOptions());
    },

    pickThreeDequalizerScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.threeDequalizerBridgeOptions(), opts);
    },

    installKatana(shell) {
      return this.installScriptBridge(shell, this.katanaBridgeOptions());
    },

    probeKatana(shell) {
      return this.probeScriptBridge(shell, this.katanaBridgeOptions());
    },

    uninstallKatana(shell) {
      return this.uninstallScriptBridge(shell, this.katanaBridgeOptions());
    },

    pickKatanaResourceDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.katanaBridgeOptions(), opts);
    },

    installFoundryTimeline(shell, id) {
      return this.installScriptBridge(shell, this.foundryTimelineBridgeOptions(id));
    },

    probeFoundryTimeline(shell, id) {
      return this.probeScriptBridge(shell, this.foundryTimelineBridgeOptions(id));
    },

    uninstallFoundryTimeline(shell, id) {
      return this.uninstallScriptBridge(shell, this.foundryTimelineBridgeOptions(id));
    },

    pickFoundryTimelineUserDir(shell, id, opts) {
      return this.pickScriptBridgeDir(shell, this.foundryTimelineBridgeOptions(id), opts);
    },

    installLightroom(shell) {
      return this.installScriptBridge(shell, this.lightroomBridgeOptions());
    },

    probeLightroom(shell) {
      return this.probeScriptBridge(shell, this.lightroomBridgeOptions());
    },

    uninstallLightroom(shell) {
      return this.uninstallScriptBridge(shell, this.lightroomBridgeOptions());
    },

    pickLightroomModulesDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.lightroomBridgeOptions(), opts);
    },

    installDarktable(shell) {
      return this.installScriptBridge(shell, this.darktableBridgeOptions());
    },

    probeDarktable(shell) {
      return this.probeScriptBridge(shell, this.darktableBridgeOptions());
    },

    uninstallDarktable(shell) {
      return this.uninstallScriptBridge(shell, this.darktableBridgeOptions());
    },

    pickDarktableConfigDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.darktableBridgeOptions(), opts);
    },

    installVegasPro(shell) {
      return this.installScriptBridge(shell, this.vegasProBridgeOptions());
    },

    probeVegasPro(shell) {
      return this.probeScriptBridge(shell, this.vegasProBridgeOptions());
    },

    uninstallVegasPro(shell) {
      return this.uninstallScriptBridge(shell, this.vegasProBridgeOptions());
    },

    pickVegasProScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.vegasProBridgeOptions(), opts);
    },

    installSynfig(shell) {
      return this.installScriptBridge(shell, this.synfigBridgeOptions());
    },

    probeSynfig(shell) {
      return this.probeScriptBridge(shell, this.synfigBridgeOptions());
    },

    uninstallSynfig(shell) {
      return this.uninstallScriptBridge(shell, this.synfigBridgeOptions());
    },

    pickSynfigPluginsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.synfigBridgeOptions(), opts);
    },

    installSubstanceDesigner(shell) {
      return this.installScriptBridge(shell, this.substanceDesignerBridgeOptions());
    },

    probeSubstanceDesigner(shell) {
      return this.probeScriptBridge(shell, this.substanceDesignerBridgeOptions());
    },

    uninstallSubstanceDesigner(shell) {
      return this.uninstallScriptBridge(shell, this.substanceDesignerBridgeOptions());
    },

    pickSubstanceDesignerScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.substanceDesignerBridgeOptions(), opts);
    },

    installMari(shell) {
      return this.installScriptBridge(shell, this.mariBridgeOptions());
    },

    probeMari(shell) {
      return this.probeScriptBridge(shell, this.mariBridgeOptions());
    },

    uninstallMari(shell) {
      return this.uninstallScriptBridge(shell, this.mariBridgeOptions());
    },

    pickMariScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.mariBridgeOptions(), opts);
    },

    installInkscape(shell) {
      return this.installScriptBridge(shell, this.inkscapeBridgeOptions());
    },

    probeInkscape(shell) {
      return this.probeScriptBridge(shell, this.inkscapeBridgeOptions());
    },

    uninstallInkscape(shell) {
      return this.uninstallScriptBridge(shell, this.inkscapeBridgeOptions());
    },

    pickInkscapeExtensionsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.inkscapeBridgeOptions(), opts);
    },

    installNatron(shell) {
      return this.installScriptBridge(shell, this.natronBridgeOptions());
    },

    probeNatron(shell) {
      return this.probeScriptBridge(shell, this.natronBridgeOptions());
    },

    uninstallNatron(shell) {
      return this.uninstallScriptBridge(shell, this.natronBridgeOptions());
    },

    pickNatronUserDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.natronBridgeOptions(), opts);
    },

    installFusionStudio(shell) {
      return this.installScriptBridge(shell, this.fusionStudioBridgeOptions());
    },

    probeFusionStudio(shell) {
      return this.probeScriptBridge(shell, this.fusionStudioBridgeOptions());
    },

    uninstallFusionStudio(shell) {
      return this.uninstallScriptBridge(shell, this.fusionStudioBridgeOptions());
    },

    pickFusionStudioScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.fusionStudioBridgeOptions(), opts);
    },

    installObsStudio(shell) {
      return this.installScriptBridge(shell, this.obsStudioBridgeOptions());
    },

    probeObsStudio(shell) {
      return this.probeScriptBridge(shell, this.obsStudioBridgeOptions());
    },

    uninstallObsStudio(shell) {
      return this.uninstallScriptBridge(shell, this.obsStudioBridgeOptions());
    },

    pickObsStudioScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.obsStudioBridgeOptions(), opts);
    },

    installReaper(shell) {
      return this.installScriptBridge(shell, this.reaperBridgeOptions());
    },

    probeReaper(shell) {
      return this.probeScriptBridge(shell, this.reaperBridgeOptions());
    },

    uninstallReaper(shell) {
      return this.uninstallScriptBridge(shell, this.reaperBridgeOptions());
    },

    pickReaperScriptsDir(shell, opts) {
      return this.pickScriptBridgeDir(shell, this.reaperBridgeOptions(), opts);
    },

    selectedZBrushTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#zbrushBridgeTargets input[data-zbrush-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-zbrush-target'));
      });
      return ids;
    },

    async installZBrush(shell) {
      if (this._busy) return;
      const targets = this.selectedZBrushTargetsFromDom();
      const port = parsePortWithDefault($('zbrushBridgePort'), 7121);
      if (!targets.length && !(this._zbrushStatus && this._zbrushStatus.targets && this._zbrushStatus.targets.length)) {
        const ok = window.confirm('未找到 ZBrush 脚本目录。要手动选择一个目录吗？');
        if (!ok) return;
        await this.pickZBrushScriptsDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 ZBrush 脚本目录，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/zbrush/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请在 ZBrush 中运行已安装的 ZScript 后，再点「探测连接」。');
        await this.refreshZBrush(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeZBrush(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshZBrush(shell);
        this.render();
        const ui = this.zbrushUiState();
        await this.recordBridgeProbe(shell, 'zbrush', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallZBrush(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter ZBrush 桥接脚本吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedZBrushTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/zbrush/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshZBrush(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickZBrushScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 ZBrush ZScripts 或 ZPlugs64 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('zbrushBridgePort'), 7121);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/zbrush/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请在 ZBrush 中运行已安装的 ZScript 后，再点「探测连接」。');
        await this.refreshZBrush(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    selectedUnrealTargetsFromDom() {
      const ids = [];
      document.querySelectorAll('#unrealBridgeTargets input[data-unreal-target]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-unreal-target'));
      });
      return ids;
    },

    async installUnreal(shell) {
      if (this._busy) return;
      const targets = this.selectedUnrealTargetsFromDom();
      const port = parsePortWithDefault($('unrealBridgePort'), 7131);
      if (!targets.length && !(this._unrealStatus && this._unrealStatus.targets && this._unrealStatus.targets.length)) {
        const ok = window.confirm('未找到 Unreal 项目目录。要手动选择一个项目吗？');
        if (!ok) return;
        await this.pickUnrealProjectDir(shell, { port });
        return;
      }
      if (!targets.length) {
        window.alert('请至少选择一个 Unreal 项目，或点击「手动添加版本」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/unreal/install', { targets, port });
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Install failed');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请启用插件或 Python 插件并重启项目后，再点「探测连接」。');
        await this.refreshUnreal(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeUnreal(shell) {
      if (this._busy) return;
      this._busy = true;
      try {
        await this.refreshUnreal(shell);
        this.render();
        const ui = this.unrealUiState();
        await this.recordBridgeProbe(shell, 'unreal', ui);
        this.render();
        this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async uninstallUnreal(shell) {
      if (this._busy) return;
      if (!window.confirm('要卸载 AssetCutter Unreal 项目插件吗？')) return;
      this._busy = true;
      try {
        const targets = this.selectedUnrealTargetsFromDom();
        const r = await shell.api('POST', '/v1/bridges/unreal/uninstall', targets.length ? { targets } : {});
        if (!r.ok) {
          this.notifyBridge((r.json && (r.json.message || r.json.error)) || r.error || 'Uninstall failed');
          return;
        }
        await this.refreshUnreal(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async pickUnrealProjectDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        this.notifyBridge('Current shell cannot choose folders.');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Unreal 项目根目录（需要包含 .uproject 文件）' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePortWithDefault($('unrealBridgePort'), 7131);
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/unreal/install', {
          projectDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          this.notifyBridge((ir.json && (ir.json.message || ir.json.error)) || ir.error || 'Install failed');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请启用插件或 Python 插件并重启项目后，再点「探测连接」。');
        await this.refreshUnreal(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async uninstallMaya(shell) {
      if (this._busy) return;
      if (!window.confirm('确定移除 userSetup 中的 AssetCutter Maya Bridge 标记块？\n（保留 script_hub_bridge.py）')) {
        return;
      }
      const versions = this.selectedVersionsFromDom();
      this._busy = true;
      try {
        const body = versions.length ? { versions } : {};
        const r = await shell.api('POST', '/v1/bridges/maya/uninstall', body);
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '卸载失败');
          return;
        }
        window.alert((r.json && r.json.message) || '已卸载标记块');
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeMaya(shell) {
      if (this._busy) return;
      const port = parsePort($('mayaBridgePort'));
      this._busy = true;
      try {
        const probeR = await shell.api(
          'GET',
          '/v1/script-connectors?mayaHost=127.0.0.1&mayaPort=' + encodeURIComponent(String(port)) + '&bustCache=1',
          null,
        );
        this._probe = probeR.ok && probeR.json ? probeR.json : null;
        this.render();
        const ui = this.mayaUiState();
        await this.recordBridgeProbe(shell, 'maya', ui);
        this.render();
        if (ui.key === 'connected') window.alert('探测成功：Maya Command Port 已连接。');
        else this.notifyBridge(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async openScriptsDir(shell) {
      const versions = Array.isArray(this._mayaStatus && this._mayaStatus.versions)
        ? this._mayaStatus.versions
        : [];
      const selected = this.selectedVersionsFromDom();
      let dir =
        (selected[0] && versions.find((v) => v.id === selected[0]) && versions.find((v) => v.id === selected[0]).scriptsDir) ||
        (versions[0] && versions[0].scriptsDir) ||
        '';
      if (!dir) {
        window.alert('没有可打开的 scripts 目录');
        return;
      }
      if (typeof shell.openFolderPath !== 'function') {
        window.alert('当前壳不支持打开文件夹');
        return;
      }
      const r = await shell.openFolderPath(dir);
      if (r && r.ok === false) window.alert('无法打开：' + (r.error || dir));
    },

    async pickScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        window.alert('当前壳不支持选择路径');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Maya scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePort($('mayaBridgePort'));
      if (opts.installAfter === false) {
        // Just remember as selected extra — install immediately for practicality.
      }
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/maya/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          window.alert((ir.json && (ir.json.message || ir.json.error)) || ir.error || '安装失败');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启或打开 Maya，再点「探测连接」。');
        this._selectedVersionIds = null;
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },
  };
})();
