/**
 * Vertex AI 诊断脚本 - 使用 https-proxy-agent 处理代理
 */
import { GoogleGenAI } from '@google/genai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SERVICE_ACCOUNT_PATH = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global';
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || '';

console.log('========================================');
console.log('Vertex AI 凭证和调用路径诊断');
console.log('========================================');
console.log(`时间: ${new Date().toISOString()}`);
console.log(`项目ID: ${VERTEX_PROJECT_ID || '(未配置)'}`);
console.log(`区域: ${VERTEX_LOCATION}`);
console.log(`服务账号JSON: ${SERVICE_ACCOUNT_PATH || '(未指定)'}`);
console.log(`代理: ${PROXY_URL || '(未指定)'}`);
console.log('');

async function testWithProxy() {
  if (!SERVICE_ACCOUNT_PATH) {
    console.log('❌ 未指定服务账号JSON文件');
    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤1: 读取并验证JSON密钥文件');
  console.log('----------------------------------------');

  let credentials;
  try {
    const jsonPath = resolve(SERVICE_ACCOUNT_PATH);
    const content = readFileSync(jsonPath, 'utf8');
    credentials = JSON.parse(content);

    if (credentials.type !== 'service_account') {
      console.log('❌ JSON文件不是服务账号格式');
      return false;
    }

    console.log('✓ JSON文件格式正确');
    console.log(`  项目ID: ${credentials.project_id}`);
    console.log(`  客户端邮箱: ${credentials.client_email}`);
    console.log('');

  } catch (err) {
    console.log(`❌ 读取文件失败: ${err.message}`);
    return false;
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(SERVICE_ACCOUNT_PATH);

  if (!credentials.project_id) {
    console.log('❌ JSON中缺少project_id');
    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤2: 初始化Vertex AI客户端 (带代理)');
  console.log('----------------------------------------');

  let ai;
  try {
    const effectiveProjectId = credentials.project_id || VERTEX_PROJECT_ID;

    if (!effectiveProjectId) {
      console.log('❌ 未找到有效的项目ID');
      return false;
    }

    // 创建代理agent
    const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

    ai = new GoogleGenAI({
      vertexai: true,
      project: effectiveProjectId,
      location: VERTEX_LOCATION,
      httpOptions: agent ? { agent } : {},
    });

    console.log(`✓ Vertex AI客户端初始化成功`);
    console.log(`  项目: ${effectiveProjectId}`);
    console.log(`  区域: ${VERTEX_LOCATION}`);
    console.log(`  代理: ${agent ? PROXY_URL : '无'}`);
    console.log('');

  } catch (err) {
    console.log(`❌ Vertex AI客户端初始化失败: ${err.message}`);
    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤3: 测试文本生成 (generateContent)');
  console.log('----------------------------------------');

  try {
    console.log('发送测试请求...');

    const startTime = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: '请用一句话介绍你自己，只回答一句话。' }] }],
      config: {
        httpOptions: { timeout: 60000 },
      },
    });

    const elapsed = Date.now() - startTime;
    const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text);

    console.log(`✓ 文本生成成功 (耗时: ${elapsed}ms)`);
    console.log(`  响应: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    console.log('');
    return true;

  } catch (err) {
    console.log(`❌ 文本生成失败: ${err.message}`);

    if (err.message.includes('PERMISSION_DENIED') || err.message.includes('403')) {
      console.log('');
      console.log('💡 可能原因:');
      console.log('  1. 该服务账号未开通Vertex AI API');
      console.log('  2. 该服务账号没有足够的权限');
      console.log('  3. 项目未启用计费');
    }

    if (err.message.includes('not found') || err.message.includes('404')) {
      console.log('💡 区域不支持该模型，尝试改为 us-central1');
    }

    if (err.message.includes('fetch failed')) {
      console.log('💡 网络请求失败，检查代理配置');
    }

    return false;
  }
}

async function main() {
  try {
    const success = await testWithProxy();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('诊断过程出错:', err);
    process.exit(1);
  }
}

main();
