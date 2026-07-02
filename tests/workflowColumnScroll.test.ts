import { describe, expect, it } from 'vitest';
import {
  resolveWorkflowColumnScrollPort,
  scrollWorkflowColumnAtPointer,
  WORKFLOW_SCROLL_PORT_ATTR,
} from '../services/workflowColumnScroll';

describe('scrollWorkflowColumnAtPointer', () => {
  it('scrolls only the function column when pointer is over function sidebar', () => {
    if (typeof document === 'undefined') return;

    const fnCol = document.createElement('div');
    fnCol.setAttribute('data-workflow-function-sidebar', '');
    fnCol.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 160, bottom: 400, width: 160, height: 400 }) as DOMRect;

    const fnPort = document.createElement('div');
    fnPort.setAttribute(WORKFLOW_SCROLL_PORT_ATTR, 'function-catalog');
    Object.defineProperty(fnPort, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(fnPort, 'scrollHeight', { value: 800, configurable: true });
    fnPort.scrollTop = 0;
    fnCol.appendChild(fnPort);

    const assetCol = document.createElement('div');
    assetCol.setAttribute('data-workflow-asset-list', '');
    assetCol.getBoundingClientRect = () =>
      ({ left: 160, top: 0, right: 700, bottom: 400, width: 540, height: 400 }) as DOMRect;
    const assetPort = document.createElement('div');
    assetPort.setAttribute(WORKFLOW_SCROLL_PORT_ATTR, 'asset');
    Object.defineProperty(assetPort, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(assetPort, 'scrollHeight', { value: 1200, configurable: true });
    assetPort.scrollTop = 0;
    assetCol.appendChild(assetPort);

    document.body.append(fnCol, assetCol);

    const ev = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: 80 });
    Object.defineProperty(ev, 'clientY', { value: 120 });
    Object.defineProperty(ev, 'target', { value: fnPort });

    expect(resolveWorkflowColumnScrollPort(80, 120)).toBe(fnPort);
    expect(scrollWorkflowColumnAtPointer(ev)).toBe(true);
    expect(fnPort.scrollTop).toBe(40);
    expect(assetPort.scrollTop).toBe(0);

    fnCol.remove();
    assetCol.remove();
  });

  it('scrolls only the asset column when pointer is over asset list', () => {
    if (typeof document === 'undefined') return;

    const fnCol = document.createElement('div');
    fnCol.setAttribute('data-workflow-function-sidebar', '');
    fnCol.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 160, bottom: 400, width: 160, height: 400 }) as DOMRect;
    const fnPort = document.createElement('div');
    fnPort.setAttribute(WORKFLOW_SCROLL_PORT_ATTR, 'function-catalog');
    Object.defineProperty(fnPort, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(fnPort, 'scrollHeight', { value: 800, configurable: true });
    fnPort.scrollTop = 0;
    fnCol.appendChild(fnPort);

    const assetCol = document.createElement('div');
    assetCol.setAttribute('data-workflow-asset-list', '');
    assetCol.getBoundingClientRect = () =>
      ({ left: 160, top: 0, right: 700, bottom: 400, width: 540, height: 400 }) as DOMRect;
    const assetPort = document.createElement('div');
    assetPort.setAttribute(WORKFLOW_SCROLL_PORT_ATTR, 'asset');
    Object.defineProperty(assetPort, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(assetPort, 'scrollHeight', { value: 1200, configurable: true });
    assetPort.scrollTop = 0;
    assetCol.appendChild(assetPort);

    document.body.append(fnCol, assetCol);

    const ev = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: 300 });
    Object.defineProperty(ev, 'clientY', { value: 120 });
    Object.defineProperty(ev, 'target', { value: assetPort });

    expect(resolveWorkflowColumnScrollPort(300, 120)).toBe(assetPort);
    expect(scrollWorkflowColumnAtPointer(ev)).toBe(true);
    expect(assetPort.scrollTop).toBe(40);
    expect(fnPort.scrollTop).toBe(0);

    fnCol.remove();
    assetCol.remove();
  });

  it('blocks wheel on function column when it cannot scroll further', () => {
    if (typeof document === 'undefined') return;

    const fnCol = document.createElement('div');
    fnCol.setAttribute('data-workflow-function-sidebar', '');
    fnCol.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 160, bottom: 400, width: 160, height: 400 }) as DOMRect;
    const fnPort = document.createElement('div');
    fnPort.setAttribute(WORKFLOW_SCROLL_PORT_ATTR, 'function-catalog');
    Object.defineProperty(fnPort, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(fnPort, 'scrollHeight', { value: 800, configurable: true });
    fnPort.scrollTop = 600;
    fnCol.appendChild(fnPort);
    document.body.appendChild(fnCol);

    const ev = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: 80 });
    Object.defineProperty(ev, 'clientY', { value: 120 });
    Object.defineProperty(ev, 'target', { value: fnPort });

    expect(scrollWorkflowColumnAtPointer(ev)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(fnPort.scrollTop).toBe(600);

    fnCol.remove();
  });
});
