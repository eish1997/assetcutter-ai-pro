import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('vertex-genai-client', () => {
  const prevLocation = process.env.VERTEX_LOCATION;
  const prevApiVersion = process.env.VERTEX_API_VERSION;
  const prevProject = process.env.VERTEX_PROJECT_ID;

  beforeEach(async () => {
    delete process.env.VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.VERTEX_API_VERSION;
    const mod = await import('../server/vertex-genai-client.js');
    mod.resetVertexGenAIClientForTests();
  });

  afterEach(async () => {
    if (prevLocation === undefined) delete process.env.VERTEX_LOCATION;
    else process.env.VERTEX_LOCATION = prevLocation;
    if (prevApiVersion === undefined) delete process.env.VERTEX_API_VERSION;
    else process.env.VERTEX_API_VERSION = prevApiVersion;
    if (prevProject === undefined) delete process.env.VERTEX_PROJECT_ID;
    else process.env.VERTEX_PROJECT_ID = prevProject;
    const mod = await import('../server/vertex-genai-client.js');
    mod.resetVertexGenAIClientForTests();
  });

  it('defaults to us-central1 Agent Platform host and v1 API', async () => {
    const mod = await import('../server/vertex-genai-client.js');
    const { location } = mod.resolveVertexLocationFromEnv();
    expect(location).toBe('us-central1');
    expect(mod.vertexAgentPlatformHost(location)).toBe('us-central1-aiplatform.googleapis.com');
    expect(mod.vertexApiVersionFromEnv()).toBe('v1');
  });

  it('describeVertexAgentPlatformRoute marks regional Agent Platform', async () => {
    process.env.VERTEX_PROJECT_ID = 'demo-proj';
    const mod = await import('../server/vertex-genai-client.js');
    const route = mod.describeVertexAgentPlatformRoute();
    expect(route.apiHost).toBe('us-central1-aiplatform.googleapis.com');
    expect(route.agentPlatformRegional).toBe(true);
    expect(route.apiVersion).toBe('v1');
    expect(route.gemini3Location).toBe('global');
    expect(route.gemini3UsesGlobal).toBe(true);
  });

  it('routes Gemini 3 models to global by default', async () => {
    const mod = await import('../server/vertex-genai-client.js');
    expect(mod.isGemini3VertexModel('gemini-3-pro-image')).toBe(true);
    expect(mod.isGemini3VertexModel('gemini-3-flash-preview')).toBe(true);
    expect(mod.isGemini3VertexModel('gemini-3.1-flash-image')).toBe(true);
    expect(mod.isGemini3VertexModel('gemini-2.5-flash-image')).toBe(false);
    expect(mod.resolveVertexLocationForModel('gemini-3-pro-image')).toBe('global');
    expect(mod.resolveVertexLocationForModel('gemini-2.5-flash-image')).toBe('us-central1');
  });

  it('VERTEX_AIPLATFORM_REGIONAL_ONLY keeps Gemini 3 on VERTEX_LOCATION', async () => {
    process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY = 'true';
    const mod = await import('../server/vertex-genai-client.js');
    expect(mod.resolveVertexLocationForModel('gemini-3-pro-image')).toBe('us-central1');
    delete process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY;
  });
});
