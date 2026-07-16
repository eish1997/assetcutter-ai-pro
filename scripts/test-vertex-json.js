/**
 * Vertex AI 凭证和调用路径诊断脚本
 * 用法: 
 *   1. 测试指定JSON密钥: node scripts/test-vertex-json.js <path-to-json-keyfile>
 *   2. 测试环境变量配置: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/test-vertex-json.js
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { bootstrap as bootstrapGlobalAgent } from 'global-agent';

bootstrapGlobalAgent();

const SERVICE_ACCOUNT_PATH = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

console.log('========================================');
console.log('Vertex AI 凭证和调用路径诊断');
console.log('========================================');
console.log(`时间: ${new Date().toISOString()}`);
console.log(`项目ID: ${VERTEX_PROJECT_ID || '(未配置)'}`);
console.log(`区域: ${VERTEX_LOCATION}`);
console.log(`服务账号JSON: ${SERVICE_ACCOUNT_PATH || '(未指定)'}`);
console.log('');

async function testJsonKey() {
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
      console.log('❌ JSON文件不是服务账号格式 (type应为service_account)');
      return false;
    }

    console.log('✓ JSON文件格式正确');
    console.log(`  项目ID: ${credentials.project_id}`);
    console.log(`  客户端邮箱: ${credentials.client_email}`);
    console.log(`  私钥ID: ${credentials.private_key_id}`);
    console.log('');

  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`❌ 文件不存在: ${SERVICE_ACCOUNT_PATH}`);
    } else if (err instanceof SyntaxError) {
      console.log('❌ JSON解析失败');
    } else {
      console.log(`❌ 读取文件失败: ${err.message}`);
    }
    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤2: 设置环境变量并验证');
  console.log('----------------------------------------');

  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(SERVICE_ACCOUNT_PATH);

  if (!credentials.project_id) {
    console.log('❌ JSON中缺少project_id');
    return false;
  }

  if (!credentials.private_key) {
    console.log('❌ JSON中缺少private_key');
    return false;
  }

  console.log('✓ 环境变量已设置');
  console.log('');

  console.log('----------------------------------------');
  console.log('步骤3: 初始化Vertex AI客户端');
  console.log('----------------------------------------');

  let ai;
  try {
    const effectiveProjectId = credentials.project_id || VERTEX_PROJECT_ID;

    if (!effectiveProjectId) {
      console.log('❌ 未找到有效的项目ID');
      console.log('  - JSON文件中的project_id为空');
      console.log('  - 且环境变量VERTEX_PROJECT_ID未设置');
      return false;
    }

    ai = new GoogleGenAI({
      vertexai: true,
      project: effectiveProjectId,
      location: VERTEX_LOCATION,
    });

    console.log(`✓ Vertex AI客户端初始化成功`);
    console.log(`  项目: ${effectiveProjectId}`);
    console.log(`  区域: ${VERTEX_LOCATION}`);
    console.log('');

  } catch (err) {
    console.log(`❌ Vertex AI客户端初始化失败: ${err.message}`);
    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤4: 测试文本生成 (generateContent)');
  console.log('----------------------------------------');

  try {
    console.log('发送测试请求...');
    console.log('模型: gemini-2.5-flash');

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

  } catch (err) {
    console.log(`❌ 文本生成失败: ${err.message}`);

    if (err.message.includes('PERMISSION_DENIED') || err.message.includes('403')) {
      console.log('');
      console.log('💡 可能原因:');
      console.log('  1. 该服务账号未开通Vertex AI API');
      console.log('  2. 该服务账号没有足够的权限访问项目');
      console.log('  3. 项目未启用计费');
      console.log('  4. 需要在GCP控制台为服务账号添加Vertex AI相关角色');
    }

    if (err.message.includes('not found') || err.message.includes('404')) {
      console.log('');
      console.log('💡 可能原因:');
      console.log('  1. 项目所在区域不支持该模型');
      console.log('  2. 模型ID不正确');
    }

    if (err.message.includes('UNAVAILABLE') || err.message.includes('503')) {
      console.log('');
      console.log('💡 可能原因:');
      console.log('  1. Vertex AI服务暂时不可用');
      console.log('  2. 网络连接问题');
    }

    return false;
  }

  console.log('----------------------------------------');
  console.log('步骤5: 测试图像生成 (Image Generation)');
  console.log('----------------------------------------');

  try {
    console.log('发送图像生成测试请求...');
    console.log('模型: gemini-2.5-flash-image');

    const startTime = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{
        role: 'user',
        parts: [{ text: '生成一张128x128的简单红色圆形图片。只生成图片，不要其他说明。' }]
      }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        httpOptions: { timeout: 120000 },
      },
    });

    const elapsed = Date.now() - startTime;
    const candidates = response.candidates || response.response?.candidates || [];

    console.log(`✓ 图像生成成功 (耗时: ${elapsed}ms)`);
    console.log(`  Text响应: ${(response.text || '').substring(0, 100)}...`);

    let hasImage = false;
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          hasImage = true;
          const size = (part.inlineData.data || '').length;
          console.log(`  生成的图像数据大小: ~${Math.round(size * 3/4)} bytes (base64后: ${size})`);
          break;
        }
      }
      if (hasImage) break;
    }

    if (!hasImage) {
      console.log('  ⚠ 未在响应中找到图像数据');
    }

    console.log('');

  } catch (err) {
    console.log(`⚠ 图像生成失败: ${err.message}`);
    console.log('  (文本生成已成功，图像生成可能是模型/权限问题)');
    console.log('');
  }

  console.log('========================================');
  console.log('诊断完成');
  console.log('========================================');
  console.log('');
  console.log('💡 后续步骤:');
  console.log('  1. 将服务账号JSON放到安全位置 (如 ~/.gcp/ 目录)');
  console.log('  2. 在运行ai-worker-proxy-api.js的环境中设置:');
  console.log(`     export GOOGLE_APPLICATION_CREDENTIALS="${SERVICE_ACCOUNT_PATH}"`);
  console.log(`     export VERTEX_PROJECT_ID="${credentials.project_id}"`);
  console.log('     export VERTEX_LOCATION="global"');
  console.log('  3. 启动代理: node server/ai-worker-proxy-api.js');
  console.log('  4. 在前端设置VITE_AI_WORKER_PROXY_API指向代理地址');
  console.log('');

  return true;
}

async function main() {
  try {
    const success = await testJsonKey();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('诊断过程出错:', err);
    process.exit(1);
  }
}

main();
