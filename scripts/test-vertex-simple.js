/**
 * Vertex AI 凭证诊断 - 简化版
 * 按照官方文档: https://googleapis.github.io/js-genai/
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVICE_ACCOUNT_PATH = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log('========================================');
console.log('Vertex AI 凭证诊断');
console.log('========================================');
console.log(`服务账号JSON: ${SERVICE_ACCOUNT_PATH || '(未指定)'}`);
console.log('');

async function main() {
  if (!SERVICE_ACCOUNT_PATH) {
    console.log('❌ 未指定服务账号JSON文件');
    console.log('用法: node scripts/test-vertex-simple.js <path-to-json>');
    return false;
  }

  // 步骤1: 验证JSON文件
  console.log('步骤1: 验证服务账号JSON...');
  let credentials;
  try {
    const content = readFileSync(SERVICE_ACCOUNT_PATH, 'utf8');
    credentials = JSON.parse(content);
    
    if (credentials.type !== 'service_account') {
      console.log('❌ 不是服务账号格式');
      return false;
    }
    
    console.log(`✓ 项目ID: ${credentials.project_id}`);
    console.log(`✓ 客户端邮箱: ${credentials.client_email}`);
  } catch (err) {
    console.log(`❌ 读取失败: ${err.message}`);
    return false;
  }

  // 步骤2: 设置环境变量
  console.log('');
  console.log('步骤2: 设置 GOOGLE_APPLICATION_CREDENTIALS...');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(SERVICE_ACCOUNT_PATH);
  console.log(`✓ 已设置为: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);

  // 步骤3: 初始化客户端
  console.log('');
  console.log('步骤3: 初始化 Vertex AI 客户端...');
  
  let ai;
  try {
    ai = new GoogleGenAI({
      vertexai: true,
      project: credentials.project_id,
      location: 'global',
    });
    console.log('✓ 客户端初始化成功');
  } catch (err) {
    console.log(`❌ 初始化失败: ${err.message}`);
    return false;
  }

  // 步骤4: 测试API调用
  console.log('');
  console.log('步骤4: 测试 generateContent...');
  
  try {
    console.log('发送请求: gemini-2.5-flash');
    const startTime = Date.now();
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello, say "OK" if you can hear me.' }] }],
    });
    
    const elapsed = Date.now() - startTime;
    const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text);
    
    console.log(`✓ 成功! (${elapsed}ms)`);
    console.log(`响应: ${text}`);
    return true;
    
  } catch (err) {
    console.log(`❌ 请求失败: ${err.message}`);
    console.log('');
    
    // 分析错误
    if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      console.log('💡 DNS解析失败 - 无法连接到 Google 服务器');
      console.log('   检查网络/代理设置');
    }
    if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
      console.log('💡 连接超时 - 网络延迟过高或被防火墙阻挡');
    }
    if (err.message.includes('UNAUTHENTICATED') || err.message.includes('401')) {
      console.log('💡 认证失败 - 检查 GOOGLE_APPLICATION_CREDENTIALS');
    }
    if (err.message.includes('PERMISSION_DENIED') || err.message.includes('403')) {
      console.log('💡 权限不足 - 检查 Vertex AI API 是否已启用');
      console.log('   访问: https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com');
    }
    
    return false;
  }
}

main().then(success => process.exit(success ? 0 : 1));
