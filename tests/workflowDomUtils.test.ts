// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { isWorkflowLightboxHotkeySurface } from '../components/workflow/workflowDomUtils';

describe('isWorkflowLightboxHotkeySurface', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false without a lightbox stage', () => {
    expect(isWorkflowLightboxHotkeySurface()).toBe(false);
  });

  it('is true when the lightbox main stage is mounted', () => {
    const el = document.createElement('div');
    el.setAttribute('data-lightbox-main-stage', '');
    document.body.appendChild(el);
    expect(isWorkflowLightboxHotkeySurface()).toBe(true);
  });
});
