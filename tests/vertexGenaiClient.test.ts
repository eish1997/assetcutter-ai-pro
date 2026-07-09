import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('vertex-genai-client', () => {
  const prevLocation = process.env.VERTEX_LOCATION;
  const prevRegionalOnly = process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY;
  const prevAllowGlobal = process.env.VERTEX_ALLOW_GLOBAL_ENDPOINT;
  const prevProject = process.env.VERTEX_PROJECT_ID;

  beforeEach(async () => {
    delete process.env.VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY = 'true';
    delete process.env.VERTEX_ALLOW_GLOBAL_ENDPOINT;
    const mod = await import('../server/vertex-genai-client.js');
    mod.resetVertexGenAIClientForTests();
  });

  afterEach(async () => {
    if (prevLocation === undefined) delete process.env.VERTEX_LOCATION;
    else process.env.VERTEX_LOCATION = prevLocation;
    if (prevRegionalOnly === undefined) delete process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY;
    else process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY = prevRegionalOnly;
    if (prevAllowGlobal === undefined) delete process.env.VERTEX_ALLOW_GLOBAL_ENDPOINT;
    else process.env.VERTEX_ALLOW_GLOBAL_ENDPOINT = prevAllowGlobal;
    if (prevProject === undefined) delete process.env.VERTEX_PROJECT_ID;
    else process.env.VERTEX_PROJECT_ID = prevProject;
    const mod = await import('../server/vertex-genai-client.js');
    mod.resetVertexGenAIClientForTests();
  });

  it('defaults to us-central1 regional Agent Platform host', async () => {
    const mod = await import('../server/vertex-genai-client.js');
    const { location, coercedFromGlobal } = mod.resolveVertexLocationFromEnv();
    expect(location).toBe('us-central1');
    expect(coercedFromGlobal).toBe(false);
    expect(mod.vertexAgentPlatformHost(location)).toBe('us-central1-aiplatform.googleapis.com');
  });

  it('coerces global to us-central1 when regional-only', async () => {
    process.env.VERTEX_LOCATION = 'global';
    const mod = await import('../server/vertex-genai-client.js');
    const { location, coercedFromGlobal } = mod.resolveVertexLocationFromEnv();
    expect(location).toBe('us-central1');
    expect(coercedFromGlobal).toBe(true);
  });

  it('allows global when VERTEX_ALLOW_GLOBAL_ENDPOINT=true', async () => {
    process.env.VERTEX_LOCATION = 'global';
    process.env.VERTEX_ALLOW_GLOBAL_ENDPOINT = 'true';
    const mod = await import('../server/vertex-genai-client.js');
    const { location, coercedFromGlobal } = mod.resolveVertexLocationFromEnv();
    expect(location).toBe('global');
    expect(coercedFromGlobal).toBe(false);
    expect(mod.vertexAgentPlatformHost(location)).toBe('aiplatform.googleapis.com');
  });

  it('describeVertexAgentPlatformRoute exposes api host', async () => {
    process.env.VERTEX_PROJECT_ID = 'demo-proj';
    process.env.VERTEX_LOCATION = 'europe-west4';
    const mod = await import('../server/vertex-genai-client.js');
    const route = mod.describeVertexAgentPlatformRoute();
    expect(route.apiHost).toBe('europe-west4-aiplatform.googleapis.com');
    expect(route.regionalAgentPlatformOnly).toBe(true);
    expect(route.usesGlobalExpressEndpoint).toBe(false);
  });
});
