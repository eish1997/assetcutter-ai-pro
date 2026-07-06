/** 全局跳转「设置」页并可选滚动到锚点（如 `settings-usage`） */
export const AC_NAVIGATE_SETTINGS_EVENT = 'ac:navigate-settings' as const;

export type NavigateSettingsDetail = {
  sectionId?: string;
};

export function navigateToSettingsSection(sectionId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(AC_NAVIGATE_SETTINGS_EVENT, { detail: { sectionId: sectionId?.trim() || undefined } })
    );
  } catch {
    /* ignore */
  }
}
