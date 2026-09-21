/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowCapabilityHoverPreview } from '../components/WorkflowCapabilityHoverPreview';

afterEach(() => {
  cleanup();
});

describe('WorkflowCapabilityHoverPreview', () => {
  it('portals into the popout document instead of the opener body', () => {
    const pipDoc = document.implementation.createHTMLDocument('popup');
    render(
      <WorkflowCapabilityHoverPreview
        label="线稿"
        x={24}
        y={40}
        original="https://example.com/orig.jpg"
        generated="https://example.com/gen.jpg"
        portalRoot={pipDoc.body}
      />,
    );
    expect(pipDoc.body.querySelector('[data-capability-hover-preview]')).toBeTruthy();
    expect(document.body.querySelector('[data-capability-hover-preview]')).toBeNull();
  });
});
