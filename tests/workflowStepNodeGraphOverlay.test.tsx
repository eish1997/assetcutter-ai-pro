// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowStepNodeGraphOverlay } from '../components/WorkflowStepNodeGraphOverlay';
import type { WorkflowAsset } from '../types';

vi.mock('../components/workflow/AssetCardPreviewRenderer', () => ({
  AssetCardPreviewRenderer: ({ asset }: { asset: WorkflowAsset }) => (
    <div data-testid="node-model-preview">{asset.displayKey}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkflowStepNodeGraphOverlay', () => {
  function modelAsset(): WorkflowAsset {
    return {
      id: 'asset-1',
      original: 'data:image/svg+xml;base64,PLACEHOLDER',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelUrls: { original: ['blob:local-model'] },
      stepModelFormats: { original: ['fbx'] },
      modelUrls: ['blob:local-model'],
      modelSourceName: 'model.fbx',
      vgp: {
        schema_version: 1,
        originalVersionId: 'v-original',
        headVersionId: 'v-original',
        versionOrder: ['v-original'],
        versionsById: {
          'v-original': {
            id: 'v-original',
            role: 'original',
            stepKey: 'original',
            stepIndex: 0,
            createdAt: 1,
            parentVersionId: null,
            semanticStateId: 's-original',
            promptSnapshotId: null,
            imageRef: { kind: 'original_field' },
            lineageRootId: 'v-original',
          },
        },
        semanticsById: {
          's-original': {
            id: 's-original',
            target: {},
            constraints: [],
          },
        },
        promptsById: {},
      },
    };
  }

  it('renders model nodes with the model preview renderer', async () => {
    const asset = modelAsset();

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
      />
    );

    expect(await screen.findByTestId('node-model-preview')).toBeTruthy();
    expect(screen.getByText('original')).toBeTruthy();
    const overlay = screen.getByTestId('workflow-step-node-graph-overlay');
    expect(overlay.style.width).toBe('100vw');
    expect(overlay.style.height).toBe('100vh');
  });

  it('does not reselect the already displayed version node in asset mode', async () => {
    const onSelectDisplayKey = vi.fn();
    render(
      <WorkflowStepNodeGraphOverlay
        asset={modelAsset()}
        getStepLabel={(key) => key}
        onSelectDisplayKey={onSelectDisplayKey}
      />
    );

    fireEvent.click(await screen.findByTitle(/original/));

    expect(onSelectDisplayKey).not.toHaveBeenCalled();
  });

  it('anchors the generating placeholder to the task input node instead of the selected node', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    class ResizeObserverStub {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const asset = {
      ...modelAsset(),
      displayKey: 'step_a',
      results: { step_a: 'data:image/png;base64,STEP_A' },
      resultOrder: ['step_a'],
      vgp: {
        ...modelAsset().vgp!,
        headVersionId: 'v-step-a',
        versionOrder: ['v-original', 'v-step-a'],
        versionsById: {
          ...modelAsset().vgp!.versionsById,
          'v-step-a': {
            id: 'v-step-a',
            role: 'generated',
            stepKey: 'step_a',
            stepIndex: 1,
            createdAt: 2,
            parentVersionId: 'v-original',
            semanticStateId: 's-original',
            imageRef: { kind: 'result_key', key: 'step_a' },
            lineageRootId: 'v-original',
          },
        },
      },
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        pixelBusy
        pixelBusyInputDisplayKeys={['original']}
      />
    );

    const placeholder = await screen.findByRole('status');
    expect(placeholder.style.top).toBe('76px');
  });

  it('toggles canvas mode from the preview tab event', async () => {
    render(
      <WorkflowStepNodeGraphOverlay
        asset={modelAsset()}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
      />
    );

    expect(await screen.findByTestId('node-model-preview')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-ac-preview-canvas-mode')).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-ac-preview-canvas-mode')).toBe('true');
    });
    const overlay = screen.getByTestId('workflow-step-node-graph-overlay');
    expect(overlay.style.width).toBe('100vw');
    expect(overlay.style.height).toBe('100vh');
  });

  it('zooms the fullscreen canvas viewport with the wheel', async () => {
    render(
      <WorkflowStepNodeGraphOverlay
        asset={modelAsset()}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
      />
    );
    expect(await screen.findByTestId('node-model-preview')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-ac-preview-canvas-mode')).toBe('true');
    });

    const viewport = screen.getByTestId('workflow-step-node-graph-viewport');
    viewport.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const transform = screen.getByTestId('workflow-step-node-graph-transform');
    expect(transform.style.transform).toContain('scale(1)');

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -120, clientX: 50, clientY: 50 });
    });

    await waitFor(() => {
      expect(transform.style.transform).not.toContain('scale(1)');
    });
  });

  it('renders shared pbr textures as one input node', async () => {
    const sharedTexture = 'data:image/png;base64,ORM_TEXTURE';
    const onPreviewTexture = vi.fn();
    const asset: WorkflowAsset = {
      id: 'asset-1',
      original: 'data:image/svg+xml;base64,PLACEHOLDER',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelUrls: { original: ['blob:local-model'] },
      stepModelFormats: { original: ['fbx'] },
      modelUrls: ['blob:local-model'],
      modelSourceName: 'model.fbx',
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 2,
        materials: {
          'mat-0': {
            slots: {
              ao: {
                dataUrl: sharedTexture,
                fileName: 'crate_orm.png',
                channel: 'r',
                colorSpace: 'linear',
                enabled: true,
                updatedAt: 2,
              },
              roughness: {
                dataUrl: sharedTexture,
                fileName: 'crate_orm.png',
                channel: 'g',
                colorSpace: 'linear',
                enabled: true,
                updatedAt: 2,
              },
              metallic: {
                dataUrl: sharedTexture,
                fileName: 'crate_orm.png',
                channel: 'b',
                colorSpace: 'linear',
                enabled: true,
                updatedAt: 2,
              },
            },
          },
        },
      },
      vgp: {
        schema_version: 1,
        originalVersionId: 'v-original',
        headVersionId: 'v-original',
        versionOrder: ['v-original'],
        versionsById: {
          'v-original': {
            id: 'v-original',
            role: 'original',
            stepKey: 'original',
            stepIndex: 0,
            createdAt: 1,
            parentVersionId: null,
            semanticStateId: 's-original',
            promptSnapshotId: null,
            imageRef: { kind: 'original_field' },
            lineageRootId: 'v-original',
          },
        },
        semanticsById: {
          's-original': {
            id: 's-original',
            target: {},
            constraints: [],
          },
        },
        promptsById: {},
      },
    };

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onPreviewTexture={onPreviewTexture}
      />
    );

    expect(await screen.findByText('ORM')).toBeTruthy();
    const textureNode = screen.getByTitle(/crate_orm\.png/);
    expect(screen.getAllByTitle(/crate_orm\.png/)).toHaveLength(1);
    fireEvent.click(textureNode);
    expect(onPreviewTexture).toHaveBeenCalledWith(sharedTexture);
  });

  it('does not re-preview the already displayed texture node in asset mode', async () => {
    const sharedTexture = 'data:image/png;base64,ORM_TEXTURE';
    const onPreviewTexture = vi.fn();
    const asset = {
      ...modelAsset(),
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 2,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: sharedTexture,
                fileName: 'crate_base.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 2,
              },
            },
          },
        },
      },
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onPreviewTexture={onPreviewTexture}
        activePreviewTextureSrc={sharedTexture}
      />
    );

    fireEvent.click(await screen.findByTitle(/crate_base\.png/));

    expect(onPreviewTexture).not.toHaveBeenCalled();
  });

  it('selects texture nodes in canvas mode without previewing them', async () => {
    const sharedTexture = 'data:image/png;base64,ORM_TEXTURE';
    const onPreviewTexture = vi.fn();
    const asset = {
      ...modelAsset(),
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 2,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: sharedTexture,
                fileName: 'crate_base.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 2,
              },
            },
          },
        },
      },
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onPreviewTexture={onPreviewTexture}
      />
    );

    const textureNode = await screen.findByTitle(/crate_base\.png/);
    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });

    fireEvent.click(textureNode);

    expect(onPreviewTexture).not.toHaveBeenCalled();
    expect(textureNode.className).toContain('rgba(255,255,255,0.95)');
  });

  it('box-selects version and texture nodes in canvas mode', async () => {
    const sharedTexture = 'data:image/png;base64,ORM_TEXTURE';
    const asset = {
      ...modelAsset(),
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 2,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: sharedTexture,
                fileName: 'crate_base.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 2,
              },
            },
          },
        },
      },
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
      />
    );

    const textureNode = await screen.findByTitle(/crate_base\.png/);
    const versionNode = screen.getByTitle(/original/);
    const viewport = screen.getByTestId('workflow-step-node-graph-viewport');
    viewport.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 1000, clientY: 1000 });
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 1000 });

    await waitFor(() => {
      expect(textureNode.className).toContain('rgba(255,255,255,0.95)');
      expect(versionNode.className).toContain('rgba(255,255,255,0.95)');
    });
  });

  it('opens the canvas node menu for version nodes', async () => {
    const onNodeMenuAction = vi.fn();
    render(
      <WorkflowStepNodeGraphOverlay
        asset={modelAsset()}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onNodeMenuAction={onNodeMenuAction}
      />
    );

    const versionNode = await screen.findByTitle(/original/);
    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });
    fireEvent.contextMenu(versionNode, { clientX: 24, clientY: 32 });

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(5);
    fireEvent.click(menuItems[4]!);

    expect(onNodeMenuAction).toHaveBeenCalledWith(
      'show-current',
      expect.objectContaining({ kind: 'version', displayKey: 'original', versionId: 'v-original' })
    );
  });

  it('opens the node menu for version nodes in asset mode', async () => {
    const onNodeMenuAction = vi.fn();
    const onSelectDisplayKey = vi.fn();
    render(
      <WorkflowStepNodeGraphOverlay
        asset={modelAsset()}
        getStepLabel={(key) => key}
        onSelectDisplayKey={onSelectDisplayKey}
        onNodeMenuAction={onNodeMenuAction}
      />
    );

    const versionNode = await screen.findByTitle(/original/);
    fireEvent.contextMenu(versionNode, { clientX: 24, clientY: 32 });

    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(onSelectDisplayKey).not.toHaveBeenCalled();
  });

  it('opens the canvas node menu for texture nodes', async () => {
    const sharedTexture = 'data:image/png;base64,ORM_TEXTURE';
    const onNodeMenuAction = vi.fn();
    const asset = {
      ...modelAsset(),
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 2,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: sharedTexture,
                fileName: 'crate_base.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 2,
              },
            },
          },
        },
      },
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onNodeMenuAction={onNodeMenuAction}
      />
    );

    const textureNode = await screen.findByTitle(/crate_base\.png/);
    act(() => {
      window.dispatchEvent(new CustomEvent('asset-preview:canvas-mode-toggle'));
    });
    fireEvent.contextMenu(textureNode, { clientX: 24, clientY: 32 });
    fireEvent.click(screen.getAllByRole('menuitem')[4]!);

    expect(onNodeMenuAction).toHaveBeenCalledWith(
      'show-current',
      expect.objectContaining({ kind: 'texture', src: sharedTexture, textureId: 'pbr-texture-0' })
    );
  });

  it('renders generated texture rewrite nodes between source texture and the model', async () => {
    const sourceTexture = 'data:image/png;base64,SOURCE_TEXTURE';
    const resultTexture = 'data:image/png;base64,RESULT_TEXTURE';
    const onPreviewTexture = vi.fn();
    const asset = {
      ...modelAsset(),
      modelPbrEdits: {
        version: 1,
        assetId: 'asset-1',
        modelKey: 'blob:local-model',
        updatedAt: 3,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: resultTexture,
                fileName: 'base-regen.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 3,
              },
            },
          },
        },
      },
      modelPbrTextureLineage: [
        {
          id: 'lineage-1',
          assetId: 'asset-1',
          sourceTextureSrc: sourceTexture,
          resultTextureSrc: resultTexture,
          slots: ['baseColor'],
          materialIds: ['mat-0'],
          textureLabel: 'Base',
          actionType: 'quick_i2i',
          createdAt: 3,
        },
      ],
    } satisfies WorkflowAsset;

    render(
      <WorkflowStepNodeGraphOverlay
        asset={asset}
        getStepLabel={(key) => key}
        onSelectDisplayKey={vi.fn()}
        onPreviewTexture={onPreviewTexture}
      />
    );

    const rewriteNodes = await screen.findAllByTitle(/Base -> quick_i2i/);
    expect(rewriteNodes).toHaveLength(2);

    fireEvent.click(rewriteNodes[1]!);

    expect(onPreviewTexture).toHaveBeenCalledWith(resultTexture);
  });
});
