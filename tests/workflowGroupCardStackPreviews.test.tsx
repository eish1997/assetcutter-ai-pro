// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import WorkflowGroupCardStackPreviews from '../components/workflow/WorkflowGroupCardStackPreviews';
import type { WorkflowAsset } from '../types';

afterEach(() => {
  cleanup();
});

function groupAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'g1',
    isGroup: true,
    assetIds: [],
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

describe('WorkflowGroupCardStackPreviews', () => {
  it('paints empty stack layers for disk folders even without members', () => {
    const { container } = render(
      <WorkflowGroupCardStackPreviews
        groupAsset={groupAsset()}
        allAssets={[]}
        getDisplayImage={() => ''}
        forceStack
      />
    );
    expect(container.querySelectorAll('[aria-hidden]').length).toBe(2);
  });

  it('does not paint stack for a single-member group without forceStack', () => {
    const { container } = render(
      <WorkflowGroupCardStackPreviews
        groupAsset={groupAsset({ assetIds: ['a'] })}
        allAssets={[]}
        getDisplayImage={() => ''}
      />
    );
    expect(container.querySelectorAll('[aria-hidden]').length).toBe(0);
  });
});
