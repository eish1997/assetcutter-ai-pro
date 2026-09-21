import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Maximize2, Minimize2 } from 'lucide-react';
import { imageSizeSelectOptionsForRegistryModel } from '../services/openaiAdapter';
import { useEffectiveImageModelRows } from '../hooks/useEffectiveImageGearRows';
import { useEffectiveTextModelRows } from '../hooks/useEffectiveTextModelRows';
import { useEffectiveCapabilityModelRows } from '../hooks/useEffectiveCapabilityModelRows';
import { resolveModelParameterCapabilities } from '../services/modelRegistry/modelParameterCapabilities';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
} from '../services/workflowDragPipeline';
import {
  labelForImageModelRegistryId,
  shortLabelForImageModelRegistryId,
} from '../services/modelRegistry/imageModels';
import {
  labelForTextModelRegistryId,
  shortLabelForTextModelRegistryId,
} from '../services/modelRegistry/textModels';
import {
  WORKFLOW_QUICK_COMPOSE_BAR_SHELL,
} from './workflow/workflowSectionUiConstants';
import {
  DROPDOWN_OPTION_CHIP_ACTIVE,
  DROPDOWN_OPTION_CHIP_DISABLED,
  DROPDOWN_OPTION_CHIP_IDLE,
} from './ui/CustomDropdown';
import QuickComposeDropTray from './workflow/QuickComposeDropTray';
import QuickComposeQueueStack, {
  type QuickComposeQueueStackItem,
} from './workflow/QuickComposeQueueStack';
import QuickComposeMentionField, {
  type QuickComposeMentionFieldHandle,
} from './workflow/QuickComposeMentionField';
import {
  QUICK_COMPOSE_POPOUT_DRAG_CLASS,
  requestQuickComposePopoutWindow,
} from '../services/functionSidebarPopout';
import type {
  QuickComposeDropSlot,
  QuickComposeDropZone,
  QuickComposeMentionCandidate,
  QuickComposeSegment,
} from '../services/quickComposeMention';
import { mentionsFromSegments, mergeQuickComposeDropSlotsForMentions, newQuickComposeTextSegment } from '../services/quickComposeMention';
import { parseWorkflowAssetIdsFromClipboardData } from '../services/workflowDragPipeline';
import {
  clampQuickComposeBarPosition,
  computeQuickComposeExpandedTextMaxHeight,
  QUICK_COMPOSE_VIEW_MARGIN,
} from '../services/quickComposeBarViewport';

export type WorkspaceQuickComposeGenSettings = {
  imageModelRegistryId: string;
  onImageModelRegistryId: (v: string) => void;
  textModelRegistryId: string;
  onTextModelRegistryId: (v: string) => void;
  aspectRatio: string;
  onAspectRatio: (v: string) => void;
  imageSize: string;
  onImageSize: (v: string) => void;
  /** true = 閸忓牏鎮婄憴锝呭晙閻㈢喐鍨氶敍娌燼lse = 閻╂潙褰傞幓鎰仛鐠囧稄绱欐稉搴濇櫠閺嶅繐鍨庣紒鍕┾偓宀冃掗妴宥勭閼疯揪绱?*/
  understand: boolean;
  onUnderstand: (v: boolean) => void;
  count: number;
  onCount: (v: number) => void;
  videoModelRegistryId: string;
  onVideoModelRegistryId: (v: string) => void;
  videoDurationSeconds: string;
  onVideoDurationSeconds: (v: string) => void;
  videoAspectRatio: string;
  onVideoAspectRatio: (v: string) => void;
  videoResolution: string;
  onVideoResolution: (v: string) => void;
  videoMotionStrength: string;
  onVideoMotionStrength: (v: string) => void;
  model3dRegistryId: string;
  onModel3dRegistryId: (v: string) => void;
  model3dQuality: string;
  onModel3dQuality: (v: string) => void;
  model3dGeometryQuality: string;
  onModel3dGeometryQuality: (v: string) => void;
  model3dTextureQuality: string;
  onModel3dTextureQuality: (v: string) => void;
  model3dFormat: string;
  onModel3dFormat: (v: string) => void;
  model3dTexture: boolean;
  onModel3dTexture: (v: boolean) => void;
  model3dPbr: boolean;
  onModel3dPbr: (v: boolean) => void;
};

/** 娴犲骸濮涢懗钘夊隘/閼宠棄濮忛崚妤佸珛閸忋儲鏋冮張顒侇攱閻ㄥ嫰顣╃拋鎾呯窗鐏炴洜銇氭稉鍝勫幢閻楀浄绱濋崗銉╂Е閺冩湹绗屾潏鎾冲弳閺傚洦顢嶉崥鍫濊嫙娑撶儤褰佺粈楦跨槤 */
export type WorkspaceQuickComposePromptCard = {
  key: string;
  presetId: string;
  label: string;
  instruction: string;
};

export type WorkspaceQuickComposeComposeMode = 'text' | 'image' | 'video' | '3d' | 'auto';

export type WorkspaceQuickComposeBarProps = {
  visible: boolean;
  /**
   * `topRow`：资产列顶行文档流；`lightbox`：灯箱浮层 portal；`floating`：页内 fixed（弹出失败回退）。
   */
  placement?: 'floating' | 'lightbox' | 'topRow';
  /**
   * 娴?`lightbox`閿涙岸鈧灏惔鏇＄珶娑擃厾鍋ｉ敍鍫ｎ潒閸?CSS 閸嶅繒绀岄敍澶堚偓鍌炴姜缁岀儤妞傛潏鎾冲弳閺夛紕些閸掓媽顕氶悙閫涚瑓閺傜櫢绱盽null` 閺冭埖浠径宥夌帛鐠併倛鍒涙惔鏇炵湷娑擃厹鈧?   */
  lightboxAnchorClient?: { x: number; y: number } | null;
  /** 娴?`lightbox`閿涙岸鈧帒顤冮弮璺哄繁閸掕泛鐨㈡潏鎾冲弳閺夆€愁槻娴ｅ秴鍩屾妯款吇鐠愭潙绨抽敍鍫熷絹娴溿倕鎮楅崡铏瑜版帊缍呴敍?*/
  lightboxLayoutResetNonce?: number;
  /** 闂堢偟鈹栭弮鎯邦洬閻╂牗鐗撮幑顔侥佸蹇斿腹鐎佃偐娈戞潏鎾冲弳濡?placeholder */
  placeholderOverride?: string;
  /** 閺冪姵瀚嬮崗銉╊暕鐠佹儳宕遍悧鍥ㄦ閻㈢喐鏅ラ敍娑欐箒閸楋紕澧栭弮鑸靛絹娴溿倓浜掗崡锛勫閼宠棄濮忔稉鍝勫櫙 */
  composeMode: WorkspaceQuickComposeComposeMode;
  onComposeModeChange: (m: WorkspaceQuickComposeComposeMode) => void;
  /** 瀹稿弶瀚嬮崗銉ㄥ厴閸旀盯顣╃拋鎯у幢閻楀浄绱欐潏鎾冲弳濡楀棝顣╃拋鍙ョ喘閸忓牞绱?*/
  inputPresetsActive: boolean;
  segments: QuickComposeSegment[];
  onSegmentsChange: (next: QuickComposeSegment[]) => void;
  mentionCandidates: QuickComposeMentionCandidate[];
  /** 娑撹娴橀崠鐚寸礄濮ｅ繐绱舵稉璇叉禈 = 娑撯偓閺夆€叉崲閸旓紕娈戦崶?閿?*/
  mainDropSlots: QuickComposeDropSlot[];
  /** 閸欏倽鈧啫娴橀崠鐚寸礄閹碘偓閺堝瀵岄崶鍙ユ崲閸斺€冲彙閻㈩煉绱濋崶?閵嗕礁娴?閳ワ讣绱?*/
  referenceDropSlots: QuickComposeDropSlot[];
  onRemoveMainDropSlot: (assetId: string) => void;
  onRemoveReferenceDropSlot: (assetId: string) => void;
  /** 閹垫娲忛崘鍛珛閸旑煉绱伴崷銊ゅ瘜閸ユ儳灏?/ 閸欏倽鈧啫娴橀崠杞扮闂傚瓨宕查崠?*/
  onMoveDropSlot?: (assetId: string, toZone: QuickComposeDropZone) => void;
  /** 閸氬苯灏崘鍛珛閸斻劏鐨熼弫鎾€庢惔?*/
  onReorderDropSlot?: (assetId: string, zone: QuickComposeDropZone, toIndex: number) => void;
  /** 閸欏倽鈧啫娴橀敍鍦?瀵洜鏁ら敍澶嬫殶闁插繋绗傞梽?*/
  maxMentions: number;
  /** 缁夘垰鍨庢稉宥堝喕缁涘绱扮粋浣烘暏 composer 鏉堟挸鍙嗛敍鍫滅瑝閸氼偆鈹?draft閿?*/
  inputDisabled?: boolean;
  /** 缁夘垰鍨庢稉宥堝喕閵嗕胶鈹?draft閵嗕焦鍨ㄩ崝鈺傚鏉╂稖顢戞稉顓ㄧ窗缁備胶鏁ら崣鎴︹偓?*/
  submitDisabled?: boolean;
  submitDisabledReason?: string;
  onSubmit: () => void;
  hasSendableContent?: boolean;
  onExecutePending?: () => void;
  queueItems?: QuickComposeQueueStackItem[];
  executing?: boolean;
  executingDoneCount?: number;
  executingTotal?: number;
  onClearPending?: () => void;
  onRemoveQueueItem?: (id: string) => void;
  genSettings: WorkspaceQuickComposeGenSettings;
  /** 鐏炴洜銇氬锝勭秴 / 濮ｆ柧绶?/ 鏉堟挸鍤亸鍝勵嚟閿涘牏鏁撻崶鎯х穿閹垮函绱?*/
  showGenImageSettings: boolean;
  /** 鐏炴洜銇氶弬鍥х摟濡€崇€烽柅澶嬪閿涘牊鏋冨Ο鈥崇础閿?*/
  showGenTextSettings: boolean;
  /** 鐏炴洜銇氱憴鍡涱暥濡€崇€锋稉搴″棘閺?*/
  showGenVideoSettings: boolean;
  /** 鐏炴洜銇?3D 濡€崇€锋稉搴″棘閺?*/
  showGenModel3dSettings: boolean;
  /** 鐏炴洜銇氶悽鐔稿灇閺佷即鍣?1閿? */
  allowBatchCount: boolean;
  /** 閹锋牕鍙嗛妴灞炬瀮閺堫剚顢嬮妴宥呭隘閸╃喐妞傞敍姘瀼閹广垹鎻╅幑鐤厴閸旀稑鑻熸潻钘夊妫板嫯顔曢幓鎰仛鐠囧秴宕遍悧鍥风礄閸旂喕鍏橀崠?閼宠棄濮忛崚?MIME閿?*/
  onComposeInputCapabilityDrop?: (presetId: string) => void;
  /** 閹锋牕鍙嗗銉ょ稊閸栭缚绁禍褝绱眤one 閸栧搫鍨庢稉璇叉禈閸?/ 閸欏倽鈧啫娴橀崠?*/
  onComposeInputWorkflowDrop?: (e: React.DragEvent, zone: QuickComposeDropZone) => void;
  /** 缁鍒涢懛顏嗙級閻ｃ儱娴?閸掓銆冮妴灞筋槻閸?ID閵嗗秶娈戠挧鍕獓瀵洜鏁ら敍鍫滅瑝閺傛澘缂撻崡锛勫閿?*/
  onPasteAssetRefs?: (assetIds: string[], zone: QuickComposeDropZone) => void;
  /** 缁鍒涘鏇犳暏姒涙顓婚拃钘夊弳閻ㄥ嫭瀚嬮崗銉ュ隘閿涙稑銇囬崶楣冾暕鐟欏牅璐?reference閿涘牆缍嬮崜宥呮禈閸ュ搫鐣炬稉璇叉禈閿?*/
  pasteAssetRefZone?: QuickComposeDropZone;
  /** 娴?lightbox閿涙岸娈ｉ挊蹇庡瘜閸ユ儳灏敍鍫濈秼閸撳秶鏁鹃棃銏犲祮娑撹娴橀敍?*/
  hideMainDropZone?: boolean;
  promptCards: WorkspaceQuickComposePromptCard[];
  onRemovePromptCard: (key: string) => void;
};


/** 閸欏倽鈧啫鐖剁憴浣烘晸閸ュ彞楠囬崫渚婄窗娑撶粯鐦笟瀣╃鐞?*/
const QC_ASPECT_PRIMARY = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;

/** 韫囶偅宓庨弶鈥冲礁娓氀勫付娴犲墎绮烘稉鈧妯哄閿涘牊膩瀵?/ 濡€崇€?/ 閸欏倹鏆?pill閿?*/
const QUICK_COMPOSE_CTRL_H = 'h-6';

/** 韫囶偅宓庨弶鈥冲敶 pill 閹稿鎸抽敍鍫熌侀崹?/ 閸欏倹鏆熼敍澶岀埠娑撯偓妤傛ê瀹虫稉搴″敶鏉堢绐?*/
const QUICK_COMPOSE_PILL_TRIGGER =
  `inline-flex ${QUICK_COMPOSE_CTRL_H} min-h-6 max-h-6 shrink-0 items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 text-[9px] leading-none ring-1 ring-white/[0.08] outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45`;

/** 韫囶偅宓庨弶鈩兡佸?chip閿涘牊鏋?/ 閸?/ 3D閿?*/
const QUICK_COMPOSE_MODE_CHIP_BASE =
  `inline-flex ${QUICK_COMPOSE_CTRL_H} min-h-6 max-h-6 shrink-0 items-center justify-center rounded-md px-1.5 text-[9px] font-bold leading-none transition-colors box-border`;

const VIEW_MARGIN = QUICK_COMPOSE_VIEW_MARGIN;
/** 韫囶偅宓庨弶锟犵帛鐠併倛鍒涙惔鏇窗鎼存洝绔熺捄婵婎潒閸欙絽绨崇痪?28px閿涘牅绗岄弮褔鈧槒绶?top閳澊h閳?2閵嗕線鐝埉?4 娑撯偓閼疯揪绱?2閳?4=28閿?*/
const QUICK_COMPOSE_BAR_BOTTOM_GAP = 12;

/** 鐏?fixed 鐎规矮缍呴惃?left/top 闂勬劕鍩楅崷銊ョ秼閸撳秷顫嬮崣锝呭敶閿涘牆鎯堟稉濠冩煙濞搭喖鐪?overhang閿?*/
function clampBarToViewport(
  pos: { left: number; top: number },
  barEl: HTMLElement | null,
  vw: number,
  vh: number
): { left: number; top: number } {
  return clampQuickComposeBarPosition(pos, barEl, vw, vh, VIEW_MARGIN);
}

/**
 * 瀹搞儰缍旈崠鍝勭俺闁劌鐪虫稉顓ㄧ窗娑撳酣顣╃憴鍫濅紣閸忛攱鐖崥宀€閮寸€圭偠澹婇弶鈥虫彥閹圭柉绶崗銉幢閺€顖涘瘮婢舵艾娴橀妴浣烘晸閹存劕寮弫鐗堟喅鐟曚焦娼稉搴¤剨閸戦缚顔曠純顔衡偓? */
export default function WorkspaceQuickComposeBar({
  visible,
  placement = 'floating',
  lightboxAnchorClient = null,
  lightboxLayoutResetNonce = 0,
  placeholderOverride,
  composeMode,
  onComposeModeChange,
  inputPresetsActive,
  segments,
  onSegmentsChange,
  mentionCandidates,
  mainDropSlots,
  referenceDropSlots,
  onRemoveMainDropSlot,
  onRemoveReferenceDropSlot,
  onMoveDropSlot,
  onReorderDropSlot,
  maxMentions,
  onSubmit,
  hasSendableContent = false,
  onExecutePending,
  queueItems = [],
  executing = false,
  executingDoneCount = 0,
  executingTotal = 0,
  onClearPending,
  onRemoveQueueItem,
  inputDisabled: inputDisabledProp,
  submitDisabled = false,
  submitDisabledReason,
  genSettings,
  showGenImageSettings,
  showGenTextSettings,
  showGenVideoSettings,
  showGenModel3dSettings,
  allowBatchCount,
  onComposeInputCapabilityDrop,
  onComposeInputWorkflowDrop,
  onPasteAssetRefs,
  pasteAssetRefZone = 'main',
  hideMainDropZone = false,
  promptCards,
  onRemovePromptCard,
}: WorkspaceQuickComposeBarProps) {
  const mentions = useMemo(() => mentionsFromSegments(segments), [segments]);
  const mentionFieldRef = useRef<QuickComposeMentionFieldHandle | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const textModelTriggerRef = useRef<HTMLButtonElement>(null);
  const videoModelTriggerRef = useRef<HTMLButtonElement>(null);
  const model3dTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelAnchor, setPanelAnchor] = useState<'model' | 'textModel' | 'videoModel' | 'model3dModel' | 'params'>('params');
  /** 鐏炴洖绱戞潏鎾冲弳閸栧搫澧犵拋鏉跨秿閺夆€宠埌鐎圭懓娅掓惔鏇＄珶閿涘牐顫嬮崣?Y閿涘绱濋悽銊ょ艾婢х偤鐝弮璺烘祼鐎规艾绨虫潏骞库偓浣告倻娑撳﹤娆㈡导?*/
  const expandAnchorBottomRef = useRef<number | null>(null);
  /** 閺€鎯版崳閸撳秷顔囪ぐ鏇炵俺鏉堢櫢绱濋悽銊ょ艾閸欐鐓弮璺烘祼鐎规艾绨虫潏骞库偓浣告倻娑撳﹥鏁归崥鍫礄娑撳骸鐫嶅鈧€靛湱袨閿?*/
  const collapseAnchorBottomRef = useRef<number | null>(null);
  /** 鐏炴洖绱戦張鐔兼？閸ュ搫鐣炬惔鏇＄珶閿涘矁绶崗銉ヮ杻妤傛ɑ妞傞崥鎴滅瑐瀵ゆ湹鍑犳稉鏂剧瑝鐡掑懎鍤憴鍡楀經 */
  const expandedBarBottomRef = useRef<number | null>(null);
  const prevInputExpandedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 鐏炴洖绱戦敍姘崇翻閸忋儱灏崣姗€鐝妴浣规殻閺夆€冲綁缁愬嫸绱濇笟澶哥艾缂傛牞绶梹鎸庢瀮濡?*/
  const [inputExpanded, setInputExpanded] = useState(false);
  const [composeTextMaxHeightPx, setComposeTextMaxHeightPx] = useState<number | undefined>(undefined);
  const [panelPos, setPanelPos] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
    maxWidth?: number;
  } | null>(null);

  const { rows: effectiveModelRows, coerceModelId } = useEffectiveImageModelRows();
  const { rows: effectiveTextModelRows, coerceModelId: coerceTextModelId } = useEffectiveTextModelRows();
  const { rows: effectiveVideoModelRows, firstReadyRegistryId: firstVideoModelId } = useEffectiveCapabilityModelRows('video');
  const { rows: effectiveModel3dRows, firstReadyRegistryId: firstModel3dId } = useEffectiveCapabilityModelRows('model3d');
  /** 閸曞灝鐨㈤弫鎾暭 `genSettings` 閺€鎹愮箻 deps閿涙氨鍩楃痪褎鐦″▎?render 闁姤妲搁弬鏉款嚠鐠炩槄绱濇导姘嚤閼?layout effect 濮ｅ繐鎶氱捄鎴滅闁秴鑻熼崣顖濆厴缁狙嗕粓 setState 閳?閺嶅牊瀛╅崙鎭掆偓?*/
  const coerceModelTargetId = genSettings.imageModelRegistryId;
  const onImageModelChange = genSettings.onImageModelRegistryId;
  const coerceTextModelTargetId = genSettings.textModelRegistryId;
  const onTextModelChange = genSettings.onTextModelRegistryId;

  useLayoutEffect(() => {
    if (!showGenImageSettings) return;
    const next = coerceModelId(coerceModelTargetId);
    if (next !== coerceModelTargetId) onImageModelChange(next);
  }, [showGenImageSettings, coerceModelId, coerceModelTargetId, onImageModelChange]);

  useLayoutEffect(() => {
    if (!showGenTextSettings) return;
    const next = coerceTextModelId(coerceTextModelTargetId);
    if (next !== coerceTextModelTargetId) onTextModelChange(next);
  }, [showGenTextSettings, coerceTextModelId, coerceTextModelTargetId, onTextModelChange]);

  useLayoutEffect(() => {
    if (!showGenVideoSettings) return;
    const current = genSettings.videoModelRegistryId;
    if (current && effectiveVideoModelRows.some((row) => row.registryId === current && !row.disabled)) return;
    if (firstVideoModelId) genSettings.onVideoModelRegistryId(firstVideoModelId);
  }, [showGenVideoSettings, effectiveVideoModelRows, firstVideoModelId, genSettings.videoModelRegistryId, genSettings.onVideoModelRegistryId]);

  useLayoutEffect(() => {
    if (!showGenModel3dSettings) return;
    const current = genSettings.model3dRegistryId;
    if (current && effectiveModel3dRows.some((row) => row.registryId === current && !row.disabled)) return;
    if (firstModel3dId) genSettings.onModel3dRegistryId(firstModel3dId);
  }, [showGenModel3dSettings, effectiveModel3dRows, firstModel3dId, genSettings.model3dRegistryId, genSettings.onModel3dRegistryId]);

  const resetToDefaultPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = barRef.current;
    const maxWCollapsed = Math.min(704, Math.max(280, vw - 24));
    const maxWExpanded = Math.min(448, Math.max(280, vw - 24));
    let w: number;
    let h: number;
    if (el) {
      const r = el.getBoundingClientRect();
      w = r.width > 1 ? Math.round(r.width) : inputExpanded ? maxWExpanded : maxWCollapsed;
      h = r.height > 1 ? Math.round(r.height) : inputExpanded ? 140 : 64;
    } else {
      w = inputExpanded ? maxWExpanded : maxWCollapsed;
      h = inputExpanded ? 140 : 64;
    }
    const left = Math.max(VIEW_MARGIN, Math.floor((vw - w) / 2));
    const top = vh - QUICK_COMPOSE_BAR_BOTTOM_GAP - h;
    setPosition(clampBarToViewport({ left, top }, el, vw, vh));
  }, [inputExpanded]);

  const isLightbox = placement === 'lightbox';
  const isTopRow = placement === 'topRow';
  const [popoutMode, setPopoutMode] = useState<'docked' | 'pip' | 'overlay'>('docked');
  const [popoutTarget, setPopoutTarget] = useState<HTMLElement | null>(null);
  const [popoutStack, setPopoutStack] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  const poppingRef = useRef(false);
  const popoutBoundsSavedRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [popoutBarHold, setPopoutBarHold] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const restoreQuickComposePopoutBounds = useCallback(() => {
    const saved = popoutBoundsSavedRef.current;
    popoutBoundsSavedRef.current = null;
    const win = pipWindowRef.current;
    if (!saved || !win || win.closed) return;
    try {
      if (win.screenX !== saved.x || win.screenY !== saved.y) win.moveTo(saved.x, saved.y);
      if (win.outerWidth !== saved.w || win.outerHeight !== saved.h) win.resizeTo(saved.w, saved.h);
    } catch {
      /* ignore */
    }
  }, []);
  const skipFixedLayout = isTopRow && popoutMode !== 'overlay';

  const closeComposePopoutWindow = useCallback(() => {
    const win = pipWindowRef.current;
    pipWindowRef.current = null;
    setPopoutTarget(null);
    if (win && !win.closed) {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const dockComposeBack = useCallback(() => {
    closeComposePopoutWindow();
    setPopoutMode('docked');
    setPosition(null);
  }, [closeComposePopoutWindow]);

  const requestComposePopout = useCallback(() => {
    if (!isTopRow || popoutMode !== 'docked' || poppingRef.current) return;
    poppingRef.current = true;
    const rect = barRef.current?.getBoundingClientRect();
    const width = Math.max(760, Math.round(rect?.width ?? 760));
    const height = Math.max(160, Math.round(rect?.height ?? 160));
    void requestQuickComposePopoutWindow({ width, height })
      .then((win) => {
        if (!win) {
          if (typeof window !== 'undefined' && (window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench) return;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          setPosition(
            clampBarToViewport(
              { left: Math.max(VIEW_MARGIN, Math.floor((vw - width) / 2)), top: 48 },
              barRef.current,
              vw,
              vh,
            ),
          );
          setPopoutTarget(null);
          setPopoutMode('overlay');
          return;
        }
        pipWindowRef.current = win;
        const dockIfThisWindow = () => {
          if (pipWindowRef.current === win) {
            pipWindowRef.current = null;
            setPopoutTarget(null);
            setPopoutMode('docked');
            setPosition(null);
          }
        };
        win.addEventListener('pagehide', dockIfThisWindow);
        win.addEventListener('unload', dockIfThisWindow);
        setPopoutTarget(win.document.body);
        setPopoutMode('pip');
      })
      .finally(() => {
        poppingRef.current = false;
      });
  }, [isTopRow, popoutMode]);

  useLayoutEffect(() => {
    return () => {
      closeComposePopoutWindow();
    };
  }, [closeComposePopoutWindow]);

  useEffect(() => {
    if (queueItems.length === 0) setQueueOpen(false);
  }, [queueItems.length]);

  const modeLockedByInputPresets = inputPresetsActive;
  const modeChipCls = (active: boolean) =>
    `${QUICK_COMPOSE_MODE_CHIP_BASE} ${
      modeLockedByInputPresets
        ? 'cursor-not-allowed opacity-40 ring-1 ring-white/[0.06] text-gray-500'
        : active
          ? 'bg-white text-[#0a0a0c] ring-1 ring-white'
          : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1]'
    }`;

  const dragHasWorkflowExport = useCallback((e: React.DragEvent) => {
    try {
      const t = e.dataTransfer?.types;
      if (!t) return false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === DT_AC_WORKFLOW_EXPORT) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const readDroppedCapabilityPresetId = useCallback((dt: DataTransfer | null): string => {
    if (!dt) return '';
    try {
      return (
        dt.getData(DT_AC_CAPABILITY_FROM_EDITOR) ||
        dt.getData(DT_AC_CAPABILITY_ACTION) ||
        dt.getData('text/plain') ||
        ''
      ).trim();
    } catch {
      return '';
    }
  }, []);

  const handleComposeInputDragOver = useCallback(
    (e: React.DragEvent) => {
      const allowCap = Boolean(onComposeInputCapabilityDrop);
      const allowWf = Boolean(onComposeInputWorkflowDrop) && dragHasWorkflowExport(e);
      if (!allowCap && !allowWf) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* ignore */
      }
    },
    [dragHasWorkflowExport, onComposeInputCapabilityDrop, onComposeInputWorkflowDrop]
  );

  const handleComposeInputDrop = useCallback(
    (e: React.DragEvent, zone: QuickComposeDropZone = 'main') => {
      if (onComposeInputWorkflowDrop && dragHasWorkflowExport(e)) {
        e.preventDefault();
        e.stopPropagation();
        onComposeInputWorkflowDrop(e, zone);
        return;
      }
      if (onComposeInputCapabilityDrop) {
        const id = readDroppedCapabilityPresetId(e.dataTransfer);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          onComposeInputCapabilityDrop(id);
        }
      }
    },
    [
      dragHasWorkflowExport,
      onComposeInputCapabilityDrop,
      onComposeInputWorkflowDrop,
      readDroppedCapabilityPresetId,
    ]
  );
  const handleMainZoneDragOver = useCallback(
    (e: React.DragEvent) => {
      const allowCap = Boolean(onComposeInputCapabilityDrop);
      const allowWf = Boolean(onComposeInputWorkflowDrop) && dragHasWorkflowExport(e);
      if (!allowCap && !allowWf) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* ignore */
      }
    },
    [dragHasWorkflowExport, onComposeInputCapabilityDrop, onComposeInputWorkflowDrop]
  );

  const handlePresetOnlyDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onComposeInputCapabilityDrop) return;
      const id = readDroppedCapabilityPresetId(e.dataTransfer);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      onComposeInputCapabilityDrop(id);
    },
    [onComposeInputCapabilityDrop, readDroppedCapabilityPresetId]
  );

  const bindQuickComposeDropZone = useCallback(
    (zone: QuickComposeDropZone) => ({
      onDragOver: isLightbox
        ? undefined
        : (e: React.DragEvent) => {
            e.stopPropagation();
            handleMainZoneDragOver(e);
          },
      onDrop: isLightbox
        ? undefined
        : (e: React.DragEvent) => {
            e.stopPropagation();
            handleComposeInputDrop(e, zone);
          },
    }),
    [handleComposeInputDrop, handleMainZoneDragOver, isLightbox]
  );

  const pasteRefZone: QuickComposeDropZone =
    pasteAssetRefZone ?? (hideMainDropZone ? 'reference' : 'main');

  const handlePasteAssetRefs = useCallback(
    (e: React.ClipboardEvent, zone: QuickComposeDropZone = pasteRefZone) => {
      if (!onPasteAssetRefs) return;
      const assetIds = parseWorkflowAssetIdsFromClipboardData(e.clipboardData);
      if (assetIds.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onPasteAssetRefs(assetIds, zone);
    },
    [onPasteAssetRefs, pasteRefZone]
  );

  const handleDropSlotClick = useCallback(
    (slot: QuickComposeDropSlot) => {
      mentionFieldRef.current?.stashCaretBeforeBlur();
      const merged = mergeQuickComposeDropSlotsForMentions(mainDropSlots, referenceDropSlots);
      const mergedSlot = merged.find((s) => s.assetId === slot.assetId);
      const fromCandidates = mentionCandidates.find(
        (c): c is Extract<QuickComposeMentionCandidate, { kind: 'asset' }> =>
          c.kind === 'asset' && c.assetId === slot.assetId
      );
      const candidate: QuickComposeMentionCandidate = fromCandidates ?? {
        kind: 'asset',
        assetId: slot.assetId,
        label: mergedSlot?.label ?? slot.label,
        previewSrc: slot.previewSrc,
      };
      mentionFieldRef.current?.insertMentionCandidate(candidate);
    },
    [mainDropSlots, referenceDropSlots, mentionCandidates]
  );

  /** 娴犲懎婀張澶嬪珛閸忋儱娴橀悧鍥ㄦ鐏炴洜銇氭稉璇叉禈/閸欏倽鈧啫娴樻稉銈呭隘閿涙稑銇囬崶鐐佸蹇擃潗缂佸牆鐫嶇粈鍝勫棘閼板啫娴橀崠鐚寸礄瑜版挸澧犻崶鎯ф祼鐎规矮璐熸稉璇叉禈閿?*/
  const showSplitDropZones =
    hideMainDropZone || mainDropSlots.length > 0 || referenceDropSlots.length > 0;

  const hasMainDropSlots = mainDropSlots.length > 0;
  const hasReferenceDropSlots = referenceDropSlots.length > 0;
  /** 閸欏倽鈧啫灏張澶婃禈閺冨爼娓舵穱婵堟殌娑撹灏担婊嗘硶閸栫儤瀚嬮弨鍓ф窗閺嶅浄绱辨稉璇插隘閺堝娴橀弮鏈电箽閻ｆ瑥寮懓鍐ㄥ隘娴ｆ粎鈹栭幏鏍у弳娴?*/
  const showMainDropColumn = !hideMainDropZone && (hasMainDropSlots || hasReferenceDropSlots);
  const showReferenceDropColumn =
    hideMainDropZone || hasReferenceDropSlots || (!hideMainDropZone && hasMainDropSlots);
  /** 閸欏苯鍨敮鍐ㄧ湰閺冭泛顫愮紒鍫熸▔缁€鍝勫瀻閸撹尙鍤庨敍鍫濇儓娴犲懍绔存笟褎婀侀崶淇扁偓浣稿綗娑撯偓娓氀傝礋缁岀儤瀚嬮崗銉ょ秴閿?*/
  const showZoneDivider =
    !hideMainDropZone && showMainDropColumn && showReferenceDropColumn;
  const splitDropZoneGridCols = hideMainDropZone
    ? 'grid-cols-1'
    : showZoneDivider
      ? 'grid-cols-[auto_2px_auto]'
      : 'grid-cols-1';

  const hasDropZones = showSplitDropZones || promptCards.length > 0;

  useEffect(() => {
    if (!visible) {
      setSettingsOpen(false);
      return;
    }
    if (placement === 'lightbox' || skipFixedLayout) return;
    if (position) return;
    resetToDefaultPosition();
  }, [position, resetToDefaultPosition, visible, placement, skipFixedLayout]);

  useLayoutEffect(() => {
    if (!visible || placement !== 'lightbox') return;
    if (lightboxAnchorClient) return;
    resetToDefaultPosition();
  }, [visible, placement, lightboxAnchorClient, lightboxLayoutResetNonce, resetToDefaultPosition]);

  const lightboxAnchorRef = useRef(lightboxAnchorClient);
  lightboxAnchorRef.current = lightboxAnchorClient;

  const applyLightboxBarToAnchor = useCallback(() => {
    const anchor = lightboxAnchorRef.current;
    if (!visible || placement !== 'lightbox' || !anchor) return;
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = barRef.current;
    const r = el?.getBoundingClientRect();
    const w = r && r.width > 1 ? r.width : Math.min(576, Math.max(320, vw - 24));
    const left = anchor.x - w / 2;
    const top = anchor.y + gap;
    const next = clampBarToViewport({ left, top }, el ?? null, vw, vh);
    setPosition((prev) => {
      if (prev != null && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.top - next.top) < 1) return prev;
      return next;
    });
  }, [visible, placement]);

  useLayoutEffect(() => {
    if (!visible || placement !== 'lightbox' || !lightboxAnchorClient) return;
    applyLightboxBarToAnchor();
    const raf = requestAnimationFrame(() => applyLightboxBarToAnchor());
    return () => cancelAnimationFrame(raf);
  }, [visible, placement, lightboxAnchorClient, lightboxLayoutResetNonce, inputExpanded, applyLightboxBarToAnchor]);

  useEffect(() => {
    if (!visible || placement !== 'lightbox' || !lightboxAnchorClient) return;
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => applyLightboxBarToAnchor());
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, placement, lightboxAnchorClient, applyLightboxBarToAnchor]);

  const clampPositionToViewport = useCallback(() => {
    setPosition((prev) => {
      if (!prev) return prev;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return clampBarToViewport(prev, barRef.current, vw, vh);
    });
  }, []);

  const syncExpandedBarViewport = useCallback(() => {
    const el = barRef.current;
    if (!el || !inputExpanded || skipFixedLayout) {
      setComposeTextMaxHeightPx(undefined);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    const maxBottom = vh - VIEW_MARGIN;

    if (placement === 'lightbox') {
      setComposeTextMaxHeightPx(
        computeQuickComposeExpandedTextMaxHeight(el, {
          anchorBottom: Math.min(rect.bottom, maxBottom),
        })
      );
      if (lightboxAnchorRef.current) {
        applyLightboxBarToAnchor();
      } else {
        clampPositionToViewport();
      }
      return;
    }

    if (expandedBarBottomRef.current == null) {
      expandedBarBottomRef.current = Math.min(rect.bottom, maxBottom);
    }
    const bottom = Math.min(expandedBarBottomRef.current, maxBottom);
    const h = rect.height;
    const nextTop = bottom - h;

    setComposeTextMaxHeightPx(
      computeQuickComposeExpandedTextMaxHeight(el, { anchorBottom: bottom })
    );

    setPosition((prev) => {
      if (!prev) return prev;
      const clamped = clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
      expandedBarBottomRef.current = Math.min(clamped.top + h, maxBottom);
      if (Math.abs(clamped.top - prev.top) < 0.5 && Math.abs(clamped.left - prev.left) < 0.5) {
        return prev;
      }
      return clamped;
    });
  }, [inputExpanded, placement, applyLightboxBarToAnchor, clampPositionToViewport, skipFixedLayout]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const offset = dragOffsetRef.current;
      if (!offset) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rawLeft = e.clientX - offset.x;
      const rawTop = e.clientY - offset.y;
      setPosition(
        clampBarToViewport({ left: rawLeft, top: rawTop }, barRef.current, vw, vh)
      );
    };
    const onUp = () => {
      dragOffsetRef.current = null;
      setDragging(false);
      if (inputExpanded && barRef.current) {
        expandedBarBottomRef.current = barRef.current.getBoundingClientRect().bottom;
        syncExpandedBarViewport();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, inputExpanded, syncExpandedBarViewport]);

  const activeGenPanelTriggerRef =
    panelAnchor === 'model'
      ? modelTriggerRef
      : panelAnchor === 'textModel'
        ? textModelTriggerRef
        : panelAnchor === 'videoModel'
          ? videoModelTriggerRef
          : panelAnchor === 'model3dModel'
            ? model3dTriggerRef
            : settingsTriggerRef;

  useLayoutEffect(() => {
    if (!settingsOpen || typeof window === 'undefined') return;
    const margin = 8;
    const gap = 6;
    const measure = () => {
      const tr = activeGenPanelTriggerRef.current;
      if (!tr) return;
      const view = tr.ownerDocument.defaultView ?? window;
      const rect = tr.getBoundingClientRect();
      const panel = panelRef.current;
      const menuH = Math.ceil(Math.min(Math.max(panel?.scrollHeight ?? 0, panel?.getBoundingClientRect().height ?? 0, 120), 320));
      const menuW = Math.ceil(Math.min(Math.max(panel?.scrollWidth ?? 0, panel?.getBoundingClientRect().width ?? 0, 160), 320));
      const pipWin = popoutMode === 'pip' ? pipWindowRef.current : null;
      const isPip = Boolean(pipWin && !pipWin.closed);

      const roomBelow = view.innerHeight - rect.bottom - gap;
      const placeBelow = roomBelow >= menuH || roomBelow >= rect.top - gap;
      let top = Math.round(placeBelow ? rect.bottom + gap : rect.top - gap - menuH);
      let left = Math.round(rect.left + rect.width / 2 - menuW / 2);

      if (isPip && pipWin) {
        // 窗口左上角不动，只往右、往下加透明区。上移再加高会让整页跳一帧。
        const placeLeft = Math.round(Math.max(margin, rect.left + rect.width / 2 - menuW / 2));
        const placeTop = Math.round(rect.bottom + gap);
        const overflowRight = Math.ceil(Math.max(0, placeLeft + menuW + margin - view.innerWidth));
        const overflowBottom = Math.ceil(Math.max(0, placeTop + menuH + margin - view.innerHeight));
        if (
          !popoutBoundsSavedRef.current &&
          panel &&
          (overflowRight > 0 || overflowBottom > 0)
        ) {
          const bar = barRef.current;
          const barRect = bar?.getBoundingClientRect();
          const hold = {
            left: barRect?.left ?? 0,
            top: barRect?.top ?? 0,
            width: barRect?.width ?? view.innerWidth,
            height: barRect?.height ?? view.innerHeight,
          };
          popoutBoundsSavedRef.current = {
            x: pipWin.screenX,
            y: pipWin.screenY,
            w: pipWin.outerWidth,
            h: pipWin.outerHeight,
          };
          if (bar) {
            bar.style.position = 'absolute';
            bar.style.left = `${hold.left}px`;
            bar.style.top = `${hold.top}px`;
            bar.style.bottom = 'auto';
            bar.style.width = `${hold.width}px`;
            bar.style.height = `${hold.height}px`;
            bar.style.maxWidth = `${hold.width}px`;
            bar.style.maxHeight = `${hold.height}px`;
          }
          setPopoutBarHold(hold);
          try {
            pipWin.resizeTo(
              pipWin.outerWidth + overflowRight,
              pipWin.outerHeight + overflowBottom,
            );
          } catch {
            popoutBoundsSavedRef.current = null;
            setPopoutBarHold(null);
          }
          return;
        }
        setPanelPos((prev) =>
          prev &&
          prev.left === placeLeft &&
          prev.top === placeTop &&
          prev.maxHeight === 320 &&
          prev.maxWidth === 320
            ? prev
            : { left: placeLeft, top: placeTop, maxHeight: 320, maxWidth: 320 },
        );
        return;
      }

      const maxTop = Math.max(margin, view.innerHeight - margin - 80);
      top = Math.round(Math.min(Math.max(margin, top), maxTop));
      const room = Math.max(80, view.innerHeight - top - margin);
      const maxHeight = Math.min(320, room);
      const maxWidth = Math.min(320, Math.max(160, view.innerWidth - margin * 2));
      const maxLeft = Math.max(margin, view.innerWidth - menuW - margin);
      left = Math.round(Math.min(Math.max(margin, left), maxLeft));
      setPanelPos((prev) =>
        prev &&
        prev.left === left &&
        prev.top === top &&
        prev.maxHeight === maxHeight &&
        prev.maxWidth === maxWidth
          ? prev
          : { left, top, maxHeight, maxWidth },
      );
    };
    measure();
    const view = activeGenPanelTriggerRef.current?.ownerDocument.defaultView ?? window;
    const rafId = view.requestAnimationFrame(() => measure());
    view.addEventListener('resize', measure);
    const panelEl = panelRef.current;
    const resizeObserver = panelEl ? new ResizeObserver(() => measure()) : null;
    if (panelEl && resizeObserver) resizeObserver.observe(panelEl);
    return () => {
      view.cancelAnimationFrame(rafId);
      view.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [settingsOpen, position, panelAnchor, popoutTarget, popoutMode, popoutBarHold, panelPos]);

  /** 菜单关闭时把弹出窗收回打开前的大小。圆角条还钉着时再缩，避免满高铺开闪一下。 */
  useEffect(() => {
    if (settingsOpen) return () => restoreQuickComposePopoutBounds();
    setPanelPos(null);
    setPopoutBarHold(null);
    restoreQuickComposePopoutBounds();
  }, [settingsOpen, restoreQuickComposePopoutBounds]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    const views = new Set<Window>([window]);
    const popView = popoutTarget?.ownerDocument?.defaultView;
    if (popView) views.add(popView);
    for (const view of views) {
      view.addEventListener('keydown', onKey);
      view.addEventListener('mousedown', onDown, true);
    }
    return () => {
      for (const view of views) {
        view.removeEventListener('keydown', onKey);
        view.removeEventListener('mousedown', onDown, true);
      }
    };
  }, [settingsOpen, popoutTarget]);

  useLayoutEffect(() => {
    if (!visible || skipFixedLayout) return;
    const el = barRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wasExpanded = prevInputExpandedRef.current;
    prevInputExpandedRef.current = inputExpanded;

    if (inputExpanded && !wasExpanded) {
      const bottom = expandAnchorBottomRef.current;
      expandAnchorBottomRef.current = null;
      if (bottom != null) expandedBarBottomRef.current = bottom;
      setPosition((prev) => {
        if (bottom == null || prev == null) return prev;
        const h = el.getBoundingClientRect().height;
        const nextTop = bottom - h;
        return clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
      });
      requestAnimationFrame(() => syncExpandedBarViewport());
      return;
    }

    if (!inputExpanded && wasExpanded) {
      expandedBarBottomRef.current = null;
      setComposeTextMaxHeightPx(undefined);
      const bottom = collapseAnchorBottomRef.current;
      collapseAnchorBottomRef.current = null;
      if (bottom != null) {
        setPosition((prev) => {
          if (prev == null) return prev;
          const h = el.getBoundingClientRect().height;
          const nextTop = bottom - h;
          return clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
        });
        return;
      }
    }

    clampPositionToViewport();
  }, [inputExpanded, visible, clampPositionToViewport, syncExpandedBarViewport, skipFixedLayout]);

  useLayoutEffect(() => {
    if (!visible || !inputExpanded || skipFixedLayout) return;
    const el = barRef.current;
    if (!el) return;
    syncExpandedBarViewport();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncExpandedBarViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, inputExpanded, syncExpandedBarViewport, segments, skipFixedLayout]);

  useEffect(() => {
    if (!visible || !inputExpanded || skipFixedLayout) return;
    const onResize = () => syncExpandedBarViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visible, inputExpanded, syncExpandedBarViewport, skipFixedLayout]);

  useEffect(() => {
    if (!visible || skipFixedLayout) return;

    const RESIZE_RESET_DEBOUNCE_MS = 400;
    const RESIZE_RESET_MIN_DELTA_PX = 16;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCommittedVw = window.innerWidth;
    let lastCommittedVh = window.innerHeight;

    const scheduleClamp = () => {
      requestAnimationFrame(() => clampPositionToViewport());
    };

    const scheduleResetToDefaultOnResize = () => {
      if (dragOffsetRef.current !== null) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (
        Math.abs(vw - lastCommittedVw) < RESIZE_RESET_MIN_DELTA_PX &&
        Math.abs(vh - lastCommittedVh) < RESIZE_RESET_MIN_DELTA_PX
      ) {
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        lastCommittedVw = window.innerWidth;
        lastCommittedVh = window.innerHeight;
        if (placement === 'lightbox' && lightboxAnchorRef.current) {
          applyLightboxBarToAnchor();
        } else if (isTopRow && popoutMode === 'overlay') {
          clampPositionToViewport();
        } else {
          resetToDefaultPosition();
        }
      }, RESIZE_RESET_DEBOUNCE_MS);
    };

    window.addEventListener('resize', scheduleResetToDefaultOnResize);
    const vv = typeof window !== 'undefined' && window.visualViewport;
    vv?.addEventListener('resize', scheduleClamp);
    vv?.addEventListener('scroll', scheduleClamp);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', scheduleResetToDefaultOnResize);
      vv?.removeEventListener('resize', scheduleClamp);
      vv?.removeEventListener('scroll', scheduleClamp);
    };
  }, [
    visible,
    placement,
    skipFixedLayout,
    isTopRow,
    popoutMode,
    clampPositionToViewport,
    resetToDefaultPosition,
    applyLightboxBarToAnchor,
  ]);

  const imageSizeOptions = useMemo(
    () => imageSizeSelectOptionsForRegistryModel(genSettings.imageModelRegistryId),
    [genSettings.imageModelRegistryId]
  );

  useLayoutEffect(() => {
    if (!visible) return;
    const allowed = imageSizeOptions.map((s) => s.value);
    if (genSettings.imageSize && !allowed.includes(genSettings.imageSize)) {
      genSettings.onImageSize('');
    }
  }, [visible, genSettings.imageModelRegistryId, genSettings.imageSize, genSettings.onImageSize, imageSizeOptions]);

  if (!visible) return null;

  const inputDisabled = inputDisabledProp === true;
  const controlsDisabled = inputDisabled;
  const submitDisabledTitle = submitDisabled ? submitDisabledReason : undefined;
  const mergeSendExecute = isTopRow;
  const sendOrExecuteDisabled = mergeSendExecute
    ? !hasSendableContent && queueItems.length === 0 && !executing
    : submitDisabled;
  const sendOrExecuteTitle = mergeSendExecute
    ? executing
      ? `执行中 ${executingDoneCount}/${executingTotal}`
      : hasSendableContent
        ? (submitDisabledTitle ?? '加入队列并执行')
        : queueItems.length > 0
          ? `执行待处理队列（${queueItems.length}）`
          : '没有可发送内容或待处理任务'
    : (submitDisabledTitle ?? '加入队列并执行');
  const handleSendOrExecute = () => {
    if (mergeSendExecute && !hasSendableContent) {
      onExecutePending?.();
      return;
    }
    onSubmit();
  };
  const trimmedOverride = placeholderOverride?.trim();
  const placeholder = trimmedOverride
    ? trimmedOverride
    : (() => {
        if (composeMode === '3d') return '描述 3D，可 @';
        if (composeMode === 'video') return '描述视频，可 @';
        if (composeMode === 'text') return '说说你想整理什么';
        if (composeMode === 'auto') return '说说你想完成什么';
        return '说说你想完成什么，可 @';
      })();
  const aspectSummary =
    genSettings.aspectRatio === 'adaptive' ? '\u81ea\u9002\u5e94' : genSettings.aspectRatio || '\u81ea\u9002\u5e94';
  const sizeSummary =
    genSettings.imageSize && imageSizeOptions.some((s) => s.value === genSettings.imageSize)
      ? genSettings.imageSize
      : '';
  const countSummary = allowBatchCount ? Math.min(4, Math.max(1, genSettings.count)) : 1;
  const understandSummary = showGenImageSettings ? (genSettings.understand ? '\u7406\u89e3' : '\u76f4\u53d1') : '';

  /** 缁楊兛绔寸悰宀嬬礄濮ｆ柧绶ラ敍澶涚窗閼奉亞鍔х€硅棄瀹抽敍灞肩瑢閺佺銆冮崥灞筋啍閸氬簼缍旀稉鎭掆偓灞炬付鐎瑰€燁攽閵嗗秴鐔€閸?*/
  const chipCls = (on: boolean) =>
    `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-bold tabular-nums ring-1 transition-colors ${
      on ? 'bg-white/[0.16] text-white ring-white/[0.22]' : 'bg-white/[0.04] text-gray-400 ring-white/[0.07] hover:bg-white/[0.08]'
    }`;

  /** 閸忔湹缍戠悰宀嬬窗娑撳氦銆冮崥灞筋啍閿涘矁濮遍悧鍥ф綆閸掑棗锝炲鈽呯礄瀹革箑褰哥€靛綊缍堥敍?*/
  const chipClsStretch = (on: boolean) =>
    `flex min-h-[1.5rem] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-md px-1 py-0.5 text-[9px] font-bold tabular-nums ring-1 transition-colors ${
      on ? 'bg-white/[0.16] text-white ring-white/[0.22]' : 'bg-white/[0.04] text-gray-400 ring-white/[0.07] hover:bg-white/[0.08]'
    }`;

  const countChipClsStretch = (on: boolean) =>
    `flex min-h-[1.5rem] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-md px-1 py-0.5 text-[9px] font-black ring-1 transition-colors ${
      on ? 'bg-white text-[#0a0a0c] ring-white' : 'bg-white/[0.05] text-gray-300 ring-white/[0.07] hover:bg-white/[0.1]'
    }`;

  const activeVideoModel = effectiveVideoModelRows.find((row) => row.registryId === genSettings.videoModelRegistryId);
  const activeModel3d = effectiveModel3dRows.find((row) => row.registryId === genSettings.model3dRegistryId);
  const imageCapability = resolveModelParameterCapabilities({ registryId: genSettings.imageModelRegistryId, modality: 'image' });
  const videoCapability = resolveModelParameterCapabilities({ registryId: genSettings.videoModelRegistryId, modality: 'video' });
  const model3dCapability = resolveModelParameterCapabilities({ registryId: genSettings.model3dRegistryId, modality: 'model3d' });
  const supportsCap = (
    caps: ReturnType<typeof resolveModelParameterCapabilities>,
    key: string
  ): boolean => caps.supported.some((cap) => cap.key === key);
  const capOptions = (
    caps: ReturnType<typeof resolveModelParameterCapabilities>,
    key: string
  ): Array<{ value: string; label: string }> =>
    caps.supported.find((cap) => cap.key === key)?.options ?? [];
  const fallbackOptions = (
    caps: ReturnType<typeof resolveModelParameterCapabilities>,
    key: string,
    fallback: Array<{ value: string; label: string }>
  ) => {
    const options = capOptions(caps, key);
    return options.length > 0 ? options : fallback;
  };
  const displayParamLabel = (value: string): string => {
    const raw = String(value || '');
    if (!raw.includes('\\u')) return raw;
    try {
      return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    } catch {
      return raw;
    }
  };
  const imageAspectOptions = fallbackOptions(
    imageCapability,
    'aspectRatio',
    QC_ASPECT_PRIMARY.map((value) => ({ value, label: value }))
  );

  const modelShortLabel = shortLabelForImageModelRegistryId(genSettings.imageModelRegistryId);
  const modelFullLabel = labelForImageModelRegistryId(genSettings.imageModelRegistryId);
  const textModelShortLabel = shortLabelForTextModelRegistryId(genSettings.textModelRegistryId);
  const textModelFullLabel = labelForTextModelRegistryId(genSettings.textModelRegistryId);

  const modelPickerControl = showGenImageSettings ? (
    <button
      ref={modelTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('model');
        setSettingsOpen((open) => (open && panelAnchor === 'model' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-gray-300`}
      title={`\u751f\u56fe\u6a21\u578b\uff1a${modelFullLabel}`}
      aria-expanded={settingsOpen && panelAnchor === 'model'}
      aria-haspopup="dialog"
    >
      <span className="tabular-nums font-semibold text-gray-200" title={modelFullLabel}>
        {modelShortLabel}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'model' ? '\u25b2' : '\u25bc'}
      </span>
    </button>
  ) : null;

  const textModelPickerControl = showGenTextSettings ? (
    <button
      ref={textModelTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('textModel');
        setSettingsOpen((open) => (open && panelAnchor === 'textModel' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-emerald-300/90`}
      title={`\u6587\u5b57\u6a21\u578b\uff1a${textModelFullLabel}`}
      aria-expanded={settingsOpen && panelAnchor === 'textModel'}
      aria-haspopup="dialog"
    >
      <span className="tabular-nums font-semibold text-emerald-200/90" title={textModelFullLabel}>
        {textModelShortLabel}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'textModel' ? '\u25b2' : '\u25bc'}
      </span>
    </button>
  ) : null;

  const videoModelPickerControl = showGenVideoSettings ? (
    <button
      ref={videoModelTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('videoModel');
        setSettingsOpen((open) => (open && panelAnchor === 'videoModel' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-sky-300/90`}
      title={`\u89c6\u9891\u6a21\u578b\uff1a${activeVideoModel?.label || genSettings.videoModelRegistryId || '\u672a\u9009\u62e9'}`}
      aria-expanded={settingsOpen && panelAnchor === 'videoModel'}
      aria-haspopup="dialog"
    >
      <span className="max-w-[4.5rem] truncate tabular-nums font-semibold text-sky-200/90">
        {activeVideoModel?.label?.replace(/^.*?(Seedance|Jimeng)/i, '$1') || '\u89c6\u9891'}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'videoModel' ? '\u25b2' : '\u25bc'}
      </span>
    </button>
  ) : null;

  const model3dPickerControl = showGenModel3dSettings ? (
    <button
      ref={model3dTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('model3dModel');
        setSettingsOpen((open) => (open && panelAnchor === 'model3dModel' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-violet-300/90`}
      title={`3D \u6a21\u578b\uff1a${activeModel3d?.label || genSettings.model3dRegistryId || '\u672a\u9009\u62e9'}`}
      aria-expanded={settingsOpen && panelAnchor === 'model3dModel'}
      aria-haspopup="dialog"
    >
      <span className="max-w-[4.5rem] truncate tabular-nums font-semibold text-violet-200/90">
        {activeModel3d?.label?.replace(/^Tripo\s*/i, '') || '3D'}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'model3dModel' ? '\u25b2' : '\u25bc'}
      </span>
    </button>
  ) : null;

  const modelOptionChipCls = (on: boolean, disabled?: boolean) =>
    disabled ? DROPDOWN_OPTION_CHIP_DISABLED : on ? DROPDOWN_OPTION_CHIP_ACTIVE : DROPDOWN_OPTION_CHIP_IDLE;

  const openGenParamsPanel = () => {
    setPanelAnchor('params');
    setSettingsOpen((open) => (open && panelAnchor === 'params' ? false : true));
  };

  const genParamsSummary = (
    <>
      {showGenImageSettings ? (
        <>
          {supportsCap(imageCapability, 'aspectRatio') ? (
            <span className="shrink-0 text-[9px] text-gray-400">{aspectSummary}</span>
          ) : null}
          {supportsCap(imageCapability, 'imageSize') && sizeSummary ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] font-mono text-gray-400">{sizeSummary}</span>
            </>
          ) : null}
          {understandSummary ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] font-semibold text-gray-400">{understandSummary}</span>
            </>
          ) : null}
        </>
      ) : null}
      {showGenVideoSettings ? (
        <>
          <span className="shrink-0 text-[9px] text-gray-400">{genSettings.videoDurationSeconds || '5'}s</span>
          <span className="shrink-0 text-[9px] text-gray-600">/</span>
          <span className="shrink-0 text-[9px] text-gray-400">{genSettings.videoAspectRatio || '16:9'}</span>
          {genSettings.videoResolution ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">{genSettings.videoResolution}</span>
            </>
          ) : null}
          {genSettings.videoMotionStrength ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">运动{genSettings.videoMotionStrength}</span>
            </>
          ) : null}
        </>
      ) : null}
      {showGenModel3dSettings ? (
        <>
          {supportsCap(model3dCapability, 'quality') ? (
            <span className="shrink-0 text-[9px] text-gray-400">{genSettings.model3dQuality || '默认'}</span>
          ) : null}
          {supportsCap(model3dCapability, 'geometryQuality') && genSettings.model3dGeometryQuality ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">几何{genSettings.model3dGeometryQuality}</span>
            </>
          ) : null}
          {supportsCap(model3dCapability, 'textureQuality') && genSettings.model3dTextureQuality ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">纹理{genSettings.model3dTextureQuality}</span>
            </>
          ) : null}
          {supportsCap(model3dCapability, 'format') && genSettings.model3dFormat ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">{genSettings.model3dFormat}</span>
            </>
          ) : null}
          {supportsCap(model3dCapability, 'texture') ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">{genSettings.model3dTexture ? '贴图' : '无贴图'}</span>
            </>
          ) : null}
          {supportsCap(model3dCapability, 'pbr') ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">/</span>
              <span className="shrink-0 text-[9px] text-gray-400">{genSettings.model3dPbr ? 'PBR' : '无 PBR'}</span>
            </>
          ) : null}
        </>
      ) : null}
      {allowBatchCount ? (
        <>
          {showGenImageSettings || showGenVideoSettings || showGenModel3dSettings ? (
            <span className="shrink-0 text-[9px] text-gray-600">/</span>
          ) : null}
          <span className="shrink-0 text-[9px] font-bold tabular-nums text-gray-400">x{countSummary}</span>
        </>
      ) : null}
    </>
  );
  const genActionControls = (
    <div className="flex shrink-0 items-center gap-2.5">
      <div
        className="flex shrink-0 items-center gap-0.5"
        title={
          modeLockedByInputPresets
            ? '\u5df2\u62d6\u5165\u9884\u8bbe\u5361\u7247\uff0c\u63d0\u4ea4\u65f6\u4ee5\u5361\u7247\u80fd\u529b\u4e3a\u51c6\uff08\u6a21\u5f0f\u5df2\u9501\u5b9a\uff09'
            : '\u5feb\u6377\u6a21\u5f0f\uff1a\u6587 / \u56fe / \u89c6\u9891 / 3D / \u81ea\u52a8'
        }
      >
        {(['text', 'image', 'video', '3d', 'auto'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={controlsDisabled || modeLockedByInputPresets}
            onClick={() => {
              if (modeLockedByInputPresets) return;
              onComposeModeChange(m);
            }}
            className={modeChipCls(composeMode === m)}
          >
            {m === 'text' ? '\u6587' : m === 'image' ? '\u56fe' : m === 'video' ? '\u89c6\u9891' : m === '3d' ? '3D' : '\u81ea\u52a8'}
          </button>
        ))}
      </div>

      {modelPickerControl}
      {textModelPickerControl}
      {videoModelPickerControl}
      {model3dPickerControl}

      <button
        ref={settingsTriggerRef}
        type="button"
        disabled={controlsDisabled}
        onClick={openGenParamsPanel}
        className={`${QUICK_COMPOSE_PILL_TRIGGER} max-w-[min(11rem,36vw)] overflow-hidden text-left`}
        title="\u751f\u6210\u53c2\u6570"
        aria-expanded={settingsOpen && panelAnchor === 'params'}
        aria-haspopup="dialog"
      >
        {genParamsSummary}
        <span className="ml-px shrink-0 text-[7px] leading-none text-gray-600">
          {settingsOpen && panelAnchor === 'params' ? '\u25b2' : '\u25bc'}
        </span>
      </button>
    </div>
  );
  const settingsPanel =
    settingsOpen && panelPos && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              ref={panelRef}
              className="fixed z-[2601] inline-table max-w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(70vh,320px)] border-separate border-spacing-y-1 border-spacing-x-0 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12] p-1.5 shadow-xl ring-1 ring-white/[0.05]"
              style={{
                left: panelPos.left,
                top: panelPos.top,
                maxHeight: panelPos.maxHeight,
                maxWidth: panelPos.maxWidth,
                WebkitAppRegion: 'no-drag',
              }}
              role="dialog"
              aria-label={
                panelAnchor === 'model'
                  ? '\u9009\u62e9\u751f\u56fe\u6a21\u578b'
                  : panelAnchor === 'textModel'
                    ? '\u9009\u62e9\u6587\u5b57\u6a21\u578b'
                    : panelAnchor === 'videoModel'
                      ? '\u9009\u62e9\u89c6\u9891\u6a21\u578b'
                      : panelAnchor === 'model3dModel'
                        ? '\u9009\u62e9 3D \u6a21\u578b'
                        : '\u672c\u6b21\u751f\u6210\u53c2\u6570'
              }
            >
              {panelAnchor === 'model' && showGenImageSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveModelRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onImageModelRegistryId(g.registryId);
                            const allowed = imageSizeSelectOptionsForRegistryModel(g.registryId).map((s) => s.value);
                            if (genSettings.imageSize && !allowed.includes(genSettings.imageSize)) {
                              genSettings.onImageSize('');
                            }
                            const nextImageCaps = resolveModelParameterCapabilities({ registryId: g.registryId, modality: 'image' });
                            const allowedRatios = capOptions(nextImageCaps, 'aspectRatio').map((s) => s.value);
                            if (
                              genSettings.aspectRatio &&
                              genSettings.aspectRatio !== 'adaptive' &&
                              allowedRatios.length > 0 &&
                              !allowedRatios.includes(genSettings.aspectRatio)
                            ) {
                              genSettings.onAspectRatio('adaptive');
                            }
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(genSettings.imageModelRegistryId === g.registryId, g.disabled)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'textModel' && showGenTextSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveTextModelRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onTextModelRegistryId(g.registryId);
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(genSettings.textModelRegistryId === g.registryId, g.disabled)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'videoModel' && showGenVideoSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveVideoModelRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onVideoModelRegistryId(g.registryId);
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(genSettings.videoModelRegistryId === g.registryId, g.disabled)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'model3dModel' && showGenModel3dSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveModel3dRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onModel3dRegistryId(g.registryId);
                            const nextModel3dCaps = resolveModelParameterCapabilities({ registryId: g.registryId, modality: 'model3d' });
                            if (!supportsCap(nextModel3dCaps, 'quality')) genSettings.onModel3dQuality('');
                            if (!supportsCap(nextModel3dCaps, 'format')) genSettings.onModel3dFormat('');
                            if (!supportsCap(nextModel3dCaps, 'geometryQuality')) genSettings.onModel3dGeometryQuality('');
                            if (!supportsCap(nextModel3dCaps, 'textureQuality')) genSettings.onModel3dTextureQuality('');
                            if (!supportsCap(nextModel3dCaps, 'pbr')) genSettings.onModel3dPbr(false);
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(genSettings.model3dRegistryId === g.registryId, g.disabled)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'params' && showGenImageSettings ? (
                <>
                  {supportsCap(imageCapability, 'aspectRatio') ? (
                    <div className="table-row">
                      <div className="table-cell p-0 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          <button type="button" onClick={() => genSettings.onAspectRatio('adaptive')} className={chipCls(genSettings.aspectRatio === 'adaptive')}>
                            自适应
                          </button>
                          {imageAspectOptions.map((r) => (
                            <button key={r.value} type="button" onClick={() => genSettings.onAspectRatio(r.value)} className={chipCls(genSettings.aspectRatio === r.value)}>
                              {displayParamLabel(r.label)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {supportsCap(imageCapability, 'imageSize') ? (
                    <div className="table-row">
                      <div className="table-cell w-full min-w-0 p-0 align-middle">
                        <div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                          <button type="button" onClick={() => genSettings.onImageSize('')} className={chipClsStretch(!genSettings.imageSize)} title="\u4e0d\u6307\u5b9a\u8f93\u51fa\u5c3a\u5bf8">
                            -
                          </button>
                          {imageSizeOptions.map((s) => (
                            <button key={s.value} type="button" onClick={() => genSettings.onImageSize(s.value)} className={chipClsStretch(genSettings.imageSize === s.value)}>
                              {displayParamLabel(s.label)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="table-row">
                    <div className="table-cell w-full min-w-0 p-0 align-middle">
                      <div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                        <button type="button" onClick={() => genSettings.onUnderstand(true)} className={chipClsStretch(genSettings.understand)} title="\u5148\u7406\u89e3\u610f\u56fe\uff0c\u518d\u751f\u6210\u753b\u9762">
                          理解
                        </button>
                        <button type="button" onClick={() => genSettings.onUnderstand(false)} className={chipClsStretch(!genSettings.understand)} title="\u8df3\u8fc7\u7406\u89e3\uff0c\u76f4\u63a5\u53d1\u9001\u63d0\u793a\u8bcd\u751f\u6210">
                          直发
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {panelAnchor === 'params' && showGenVideoSettings ? (
                <>
                  {supportsCap(videoCapability, 'durationSeconds') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      {capOptions(videoCapability, 'durationSeconds').map((s) => (
                        <button key={s.value} type="button" onClick={() => genSettings.onVideoDurationSeconds(s.value)} className={chipClsStretch((genSettings.videoDurationSeconds || '5') === s.value)}>{displayParamLabel(s.label)}</button>
                      ))}
                    </div></div></div>
                  ) : null}
                  {supportsCap(videoCapability, 'aspectRatio') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      {capOptions(videoCapability, 'aspectRatio').map((s) => (
                        <button key={s.value} type="button" onClick={() => genSettings.onVideoAspectRatio(s.value)} className={chipClsStretch((genSettings.videoAspectRatio || '16:9') === s.value)}>{displayParamLabel(s.label)}</button>
                      ))}
                    </div></div></div>
                  ) : null}
                  {supportsCap(videoCapability, 'resolution') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      {capOptions(videoCapability, 'resolution').map((s) => (
                        <button key={s.value} type="button" onClick={() => genSettings.onVideoResolution(s.value)} className={chipClsStretch((genSettings.videoResolution || '1080p') === s.value)}>{displayParamLabel(s.label)}</button>
                      ))}
                    </div></div></div>
                  ) : null}
                  {supportsCap(videoCapability, 'motionStrength') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      {fallbackOptions(videoCapability, 'motionStrength', [
                        { value: '0.25', label: '\u8fd0\u52a8\u5f31' },
                        { value: '0.5', label: '\u8fd0\u52a8\u4e2d' },
                        { value: '0.75', label: '\u8fd0\u52a8\u5f3a' },
                        { value: '1', label: '\u8fd0\u52a8\u6ee1' },
                      ]).map((s) => (
                        <button key={s.value} type="button" onClick={() => genSettings.onVideoMotionStrength(s.value)} className={chipClsStretch(genSettings.videoMotionStrength === s.value)}>{displayParamLabel(s.label)}</button>
                      ))}
                    </div></div></div>
                  ) : null}
                </>
              ) : null}

              {panelAnchor === 'params' && showGenModel3dSettings ? (
                <>
                  {supportsCap(model3dCapability, 'quality') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dQuality('')} className={chipClsStretch(!genSettings.model3dQuality)}>默认</button>
                      {capOptions(model3dCapability, 'quality').map((s) => <button key={s.value} type="button" onClick={() => genSettings.onModel3dQuality(s.value)} className={chipClsStretch(genSettings.model3dQuality === s.value)}>{displayParamLabel(s.label)}</button>)}
                    </div></div></div>
                  ) : null}
                  {supportsCap(model3dCapability, 'format') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dFormat('')} className={chipClsStretch(!genSettings.model3dFormat)}>默认</button>
                      {capOptions(model3dCapability, 'format').slice(0, 5).map((s) => <button key={s.value} type="button" onClick={() => genSettings.onModel3dFormat(s.value)} className={chipClsStretch(genSettings.model3dFormat === s.value)}>{displayParamLabel(s.label)}</button>)}
                    </div></div></div>
                  ) : null}
                  {supportsCap(model3dCapability, 'geometryQuality') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dGeometryQuality('')} className={chipClsStretch(!genSettings.model3dGeometryQuality)}>几何默认</button>
                      {capOptions(model3dCapability, 'geometryQuality').map((s) => <button key={s.value} type="button" onClick={() => genSettings.onModel3dGeometryQuality(s.value)} className={chipClsStretch(genSettings.model3dGeometryQuality === s.value)}>{displayParamLabel(s.label)}</button>)}
                    </div></div></div>
                  ) : null}
                  {supportsCap(model3dCapability, 'textureQuality') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dTextureQuality('')} className={chipClsStretch(!genSettings.model3dTextureQuality)}>纹理默认</button>
                      {capOptions(model3dCapability, 'textureQuality').map((s) => <button key={s.value} type="button" onClick={() => genSettings.onModel3dTextureQuality(s.value)} className={chipClsStretch(genSettings.model3dTextureQuality === s.value)}>{displayParamLabel(s.label)}</button>)}
                    </div></div></div>
                  ) : null}
                  {supportsCap(model3dCapability, 'texture') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dTexture(true)} className={chipClsStretch(genSettings.model3dTexture)}>贴图</button>
                      <button type="button" onClick={() => genSettings.onModel3dTexture(false)} className={chipClsStretch(!genSettings.model3dTexture)}>无贴图</button>
                    </div></div></div>
                  ) : null}
                  {supportsCap(model3dCapability, 'pbr') ? (
                    <div className="table-row"><div className="table-cell w-full min-w-0 p-0 align-middle"><div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      <button type="button" onClick={() => genSettings.onModel3dPbr(true)} className={chipClsStretch(genSettings.model3dPbr)}>PBR</button>
                      <button type="button" onClick={() => genSettings.onModel3dPbr(false)} className={chipClsStretch(!genSettings.model3dPbr)}>无 PBR</button>
                    </div></div></div>
                  ) : null}
                </>
              ) : null}

              {panelAnchor === 'params' && allowBatchCount ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex min-w-0 w-full flex-wrap items-stretch gap-1">
                      {([1, 2, 3, 4] as const).map((n) => (
                        <button key={n} type="button" onClick={() => genSettings.onCount(n)} className={countChipClsStretch(genSettings.count === n)}>
                          {n === 1 ? '1x' : `x${n}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'params' && mentions.length > 0 ? (
                <div className="table-row">
                  <div className="table-cell p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        onSegmentsChange([newQuickComposeTextSegment('')]);
                        setSettingsOpen(false);
                      }}
                      className="mt-0.5 w-full rounded-md py-1 text-[9px] font-semibold text-gray-500 ring-1 ring-white/[0.07] hover:bg-white/[0.05] hover:text-gray-300"
                    >
                      清空 @ 引用
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>,
          (popoutMode === 'pip' && popoutTarget ? popoutTarget : document.body)
        )
      : null;
  const barPositionStyle: React.CSSProperties | undefined =
    skipFixedLayout || popoutMode === 'pip'
      ? undefined
      : position
        ? { left: `${position.left}px`, top: `${position.top}px`, userSelect: dragging ? 'none' : 'auto' }
        : isLightbox
          ? { visibility: 'hidden' as const }
          : undefined;

  const isComposePopout = popoutMode === 'pip';
  useLayoutEffect(() => {
    if (!isComposePopout) {
      setPopoutStack(false);
      return;
    }
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      if (popoutBoundsSavedRef.current) return;
      const rect = el.getBoundingClientRect();
      const stack = rect.width < 576 || rect.height >= 144;
      setPopoutStack((prev) => (prev === stack ? prev : stack));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isComposePopout, popoutTarget]);
  const topRowShellClass = isComposePopout
    ? `pointer-events-auto h-full min-h-0 w-full overflow-hidden rounded-2xl bg-[#0f0f12] ${QUICK_COMPOSE_POPOUT_DRAG_CLASS}`
    : popoutMode === 'overlay'
      ? 'pointer-events-auto fixed z-[1600] max-w-[96vw] px-2 w-[min(44rem,calc(100vw-1.5rem))]'
      : 'pointer-events-auto relative z-20 w-full min-w-0 overflow-visible';

  const barShell = (
      <div
        ref={barRef}
        data-workflow-quick-compose-bar
        data-ac-block-workflow-marquee
        data-quick-compose-placement={placement}
        data-quick-compose-popout={isTopRow ? popoutMode : undefined}
        className={
          isTopRow
            ? topRowShellClass
            : `pointer-events-auto fixed max-w-[96vw] px-2 w-[min(44rem,calc(100vw-1.5rem))] ${isLightbox ? 'z-[2500]' : 'z-[1600]'}`
        }
        style={
          popoutBarHold
            ? {
                position: 'absolute',
                left: popoutBarHold.left,
                top: popoutBarHold.top,
                bottom: 'auto',
                width: popoutBarHold.width,
                height: popoutBarHold.height,
                maxWidth: popoutBarHold.width,
                maxHeight: popoutBarHold.height,
              }
            : barPositionStyle
        }
        onClick={isLightbox ? (e) => e.stopPropagation() : undefined}
        onWheel={isLightbox ? (e) => e.stopPropagation() : undefined}
        onPasteCapture={(e) => handlePasteAssetRefs(e, pasteRefZone)}
        {...(isLightbox ? ({ 'data-image-preview-no-wheel': '' } as const) : {})}
      >
        <div
          className={`relative min-w-0 ${
            isComposePopout ? 'flex h-full min-h-0 flex-col' : 'overflow-visible'
          }`}
        >
          {hasDropZones ? (
            <div
              className={
                isTopRow
                  ? 'pointer-events-auto absolute top-full left-0 right-0 z-[1] mt-2 flex flex-col items-center gap-2 px-0.5'
                  : 'pointer-events-auto absolute bottom-full left-0 right-0 z-[1] mb-2 flex flex-col items-center gap-2 px-0.5'
              }
              data-quick-compose-above
              onDragOver={
                isLightbox || showSplitDropZones ? undefined : handleMainZoneDragOver
              }
              onDrop={isLightbox ? undefined : showSplitDropZones ? handlePresetOnlyDrop : (e) => handleComposeInputDrop(e, 'main')}
            >
              {promptCards.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {promptCards.map((c) => (
                    <div
                      key={c.key}
                      className={`group inline-flex max-w-[min(18rem,calc(100vw-3rem))] min-w-0 shrink-0 items-center gap-1.5 px-2.5 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
                      title={c.instruction.trim() ? c.instruction : c.label}
                    >
                      <span className="min-w-0 truncate text-[13px] text-gray-100">{c.label}</span>
                      <button
                        type="button"
                        onClick={() => onRemovePromptCard(c.key)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                        aria-label={`\u79fb\u9664 ${c.label}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          aria-hidden
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {showSplitDropZones ? (
                <div className={`grid gap-x-0 gap-y-1 px-0.5 py-1 ${splitDropZoneGridCols}`}>
                  {showMainDropColumn ? (
                    hasMainDropSlots ? (
                      <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">{hideMainDropZone ? '\u53c2\u8003\u56fe\uff08\u5f53\u524d\u56fe\u4e3a\u4e3b\u56fe\uff09' : '\u53c2\u8003\u56fe'}</span>
                    ) : (
                      <div className="px-1.5" aria-hidden />
                    )
                  ) : null}
                  {showZoneDivider ? <div className="pointer-events-none" aria-hidden /> : null}
                  {showReferenceDropColumn ? (
                    <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">{hideMainDropZone ? '\u53c2\u8003\u56fe\uff08\u5f53\u524d\u56fe\u4e3a\u4e3b\u56fe\uff09' : '\u53c2\u8003\u56fe'}</span>
                  ) : null}

                  {showMainDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="main"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('main')}
                    >
                      <QuickComposeDropTray
                        zone="main"
                        slots={mainDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveMainDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'main', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot ? (assetId) => onMoveDropSlot(assetId, 'reference') : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint="\u62d6\u5165\u4e3b\u56fe"
                      />
                    </div>
                  ) : null}
                  {showZoneDivider ? (
                    <div
                      className="pointer-events-none mx-0.5 w-[2px] self-stretch justify-self-center rounded-full bg-white/35 shadow-[0_0_6px_rgba(255,255,255,0.12)]"
                      aria-hidden
                    />
                  ) : null}
                  {showReferenceDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="reference"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('reference')}
                    >
                      <QuickComposeDropTray
                        zone="reference"
                        slots={referenceDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveReferenceDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'reference', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot && showMainDropColumn
                            ? (assetId) => onMoveDropSlot(assetId, 'main')
                            : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint={hideMainDropZone ? '\u53c2\u8003\u56fe\uff08\u5f53\u524d\u56fe\u4e3a\u4e3b\u56fe\uff09' : '\u53c2\u8003\u56fe'}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

            <div
              data-quick-compose-row={isComposePopout ? '' : undefined}
              data-quick-compose-layout={isComposePopout ? (popoutStack ? 'stack' : 'bar') : undefined}
              className={
                isComposePopout
                  ? popoutStack
                    ? 'flex h-full min-h-0 w-full min-w-0 flex-col gap-2 px-2 py-1.5'
                    : 'flex h-full min-h-0 w-full min-w-0 items-center gap-2 px-2 py-1.5'
                  : `flex w-full min-w-0 items-center gap-2 px-2 py-1.5 ${
                      isTopRow && popoutMode === 'docked'
                        ? 'rounded-md bg-white/[0.04]'
                        : WORKFLOW_QUICK_COMPOSE_BAR_SHELL
                    } ${isTopRow && inputExpanded ? 'items-center' : ''}`
              }
              role="search"
            >
              <div
                data-quick-compose-tools={popoutStack ? '' : undefined}
                className={popoutStack ? 'order-2 flex w-full shrink-0 flex-nowrap items-center gap-2' : 'contents'}
              >
              <button
                type="button"
                data-quick-compose-grab
                onDoubleClick={() => {
                  if (isTopRow && popoutMode !== 'docked') {
                    dockComposeBack();
                    return;
                  }
                  if (isTopRow) return;
                  dragOffsetRef.current = null;
                  setDragging(false);
                  resetToDefaultPosition();
                }}
                onPointerDown={(e) => {
                  if (isTopRow && popoutMode === 'docked') {
                    e.preventDefault();
                    requestComposePopout();
                    return;
                  }
                  if (isTopRow && popoutMode === 'pip') return;
                  const rect = barRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  setSettingsOpen(false);
                  setDragging(true);
                }}
                className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white active:cursor-grabbing disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                title={
                  isTopRow
                    ? popoutMode === 'docked'
                      ? '拖出独立输入窗'
                      : popoutMode === 'overlay'
                        ? '拖动；双击贴回顶行'
                        : '空白处拖动窗口；关闭窗口贴回顶行'
                    : '拖动输入框（双击回到默认位置）'
                }
                aria-label={isTopRow ? '弹出输入行' : '拖动输入框'}
              >
                <span className="select-none text-xs leading-none">::</span>
              </button>
              {popoutStack ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (inputExpanded) {
                        setInputExpanded(false);
                        return;
                      }
                      setSettingsOpen(false);
                      setInputExpanded(true);
                    }}
                    className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    data-quick-compose-expand=""
                    title={inputExpanded ? '收起多行输入' : '展开多行输入区；多行时 Ctrl+Enter 提交'}
                    aria-label={inputExpanded ? '收起输入区' : '展开输入区'}
                    aria-pressed={inputExpanded}
                  >
                    {inputExpanded ? (
                      <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                    ) : (
                      <Maximize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                    )}
                  </button>
                  {genActionControls}
                  {isTopRow ? (
                    <QuickComposeQueueStack
                      compact
                      items={queueItems}
                      open={queueOpen}
                      executing={executing}
                      onToggle={() => setQueueOpen((open) => !open)}
                      onClear={onClearPending}
                      onRemoveItem={onRemoveQueueItem}
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={sendOrExecuteDisabled}
                    onClick={handleSendOrExecute}
                    className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
                    title={sendOrExecuteTitle}
                    aria-label={sendOrExecuteTitle}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                    {mergeSendExecute && executing ? (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#0a0a0c] px-1 text-[8px] font-black tabular-nums text-white">
                        {executingDoneCount}/{executingTotal}
                      </span>
                    ) : null}
                  </button>
                </>
              ) : null}
              </div>
              {isLightbox ? (
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-400"
                  title="\u8f93\u5165 @ \u53ef\u5f15\u7528\u5f53\u524d\u753b\u9762\u6216\u5176\u5b83\u8d44\u4ea7"
                >
                  <ImageIcon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} aria-hidden />
                </div>
              ) : null}

              <div
                data-quick-compose-field={isComposePopout ? '' : undefined}
                className={
                  popoutStack
                    ? 'order-1 flex min-h-[3.5rem] min-w-0 w-full flex-1 flex-col'
                    : isComposePopout
                      ? 'flex min-w-[8rem] flex-1'
                      : 'contents'
                }
              >
              <QuickComposeMentionField
                ref={mentionFieldRef}
                segments={segments}
                onSegmentsChange={onSegmentsChange}
                mentionCandidates={mentionCandidates}
                maxMentions={maxMentions}
                placeholder={placeholder}
                disabled={inputDisabled}
                multiline={isTopRow && inputExpanded}
                fillHeight={popoutStack}
                rows={isTopRow && inputExpanded ? 3 : undefined}
                multilineMaxHeightPx={isTopRow && inputExpanded ? 84 : undefined}
                ariaLabel={isLightbox ? '\u5927\u56fe\u9884\u89c8\u5feb\u6377\u751f\u6210\u63cf\u8ff0' : '\u5feb\u6377\u751f\u6210\u63cf\u8ff0'}
                onSubmit={onSubmit}
                onDragOver={handleComposeInputDragOver}
                onDrop={(e) => handleComposeInputDrop(e, 'main')}
              />
              </div>

              {popoutStack || !isTopRow ? null : (
              <button
                type="button"
                onClick={() => {
                  if (isTopRow && inputExpanded) {
                    setInputExpanded(false);
                    return;
                  }
                  const r = barRef.current?.getBoundingClientRect();
                  expandAnchorBottomRef.current = r != null && r.height > 0 ? r.bottom : null;
                  setSettingsOpen(false);
                  setInputExpanded(true);
                }}
                className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                data-quick-compose-expand={isComposePopout ? '' : undefined}
                title={isTopRow && inputExpanded ? '收起多行输入' : '展开多行输入区；多行时 Ctrl+Enter 提交'}
                aria-label={isTopRow && inputExpanded ? '收起输入区' : '展开输入区'}
                aria-pressed={isTopRow && inputExpanded}
              >
                {isTopRow && inputExpanded ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                )}
              </button>
              )}

              {popoutStack ? null : (
              <div
                data-quick-compose-tools={isComposePopout ? '' : undefined}
                className="ml-2 flex shrink-0 items-center gap-3"
              >
                {genActionControls}

                {isTopRow ? (
                  <QuickComposeQueueStack
                    compact={isComposePopout}
                    items={queueItems}
                    open={queueOpen}
                    executing={executing}
                    onToggle={() => setQueueOpen((open) => !open)}
                    onClear={onClearPending}
                    onRemoveItem={onRemoveQueueItem}
                  />
                ) : null}

                <button
                  type="button"
                  disabled={sendOrExecuteDisabled}
                  onClick={handleSendOrExecute}
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
                  title={sendOrExecuteTitle}
                  aria-label={sendOrExecuteTitle}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                  {mergeSendExecute && executing ? (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#0a0a0c] px-1 text-[8px] font-black tabular-nums text-white">
                      {executingDoneCount}/{executingTotal}
                    </span>
                  ) : null}
                </button>
              </div>
              )}
            </div>
        </div>
      </div>
  );

  const hostedBar =
    popoutMode === 'pip' && popoutTarget
      ? createPortal(barShell, popoutTarget)
      : popoutMode === 'overlay' && typeof document !== 'undefined'
        ? createPortal(barShell, document.body)
        : barShell;

  return (
    <>
      {hostedBar}
      {settingsPanel}
    </>
  );
}










