import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimWorkflowModelLightsAtBox } from '../services/workflowModelViewerStage';

describe('workflowModelViewerStage shadows', () => {
  it('fits the key light shadow camera tightly for tall narrow models', () => {
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1);
    const bounceFill = new THREE.DirectionalLight(0xffffff, 1);
    const box = new THREE.Box3(
      new THREE.Vector3(-0.35, 0, -0.2),
      new THREE.Vector3(0.35, 2.1, 0.2),
    );

    aimWorkflowModelLightsAtBox(keyLight, fillLight, rimLight, bounceFill, box);

    const cam = keyLight.shadow.camera as THREE.OrthographicCamera;
    const width = cam.right - cam.left;
    const height = cam.top - cam.bottom;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(Math.max(width, height)).toBeLessThan(2.1 * 3.2);
    expect(keyLight.shadow.mapSize.width).toBeGreaterThanOrEqual(512);
    expect(keyLight.shadow.normalBias).toBeGreaterThan(0);
    expect(keyLight.shadow.radius).toBeGreaterThanOrEqual(9);
    expect(keyLight.shadow.blurSamples).toBeGreaterThanOrEqual(14);
  });
});
