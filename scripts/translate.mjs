import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import fs from "fs";
import path from "path";

// ========== 配置变量 ==========
const ORIGINAL_JSON = path.resolve(process.cwd(), "translate_original/en.json");
const TRANSLATED_DIR = path.resolve(process.cwd(), "translate_translated");
const INPUT_COUNT = 100; // 一批翻译多少条
const PARALLEL_BATCHES = 10; // 并行处理的批次数量
const MAX_RETRIES = 3; // 最大重试次数
const RETRY_DELAY = 1000; // 重试延迟时间 (毫秒)

const OUTPUT_LIST = [
  {
    language: "德语-de",
    outputname: "de.json",
  },
  {
    language: "法语-fr",
    outputname: "fr.json",
  },
  {
    language: "日语-ja",
    outputname: "ja.json",
  },
  {
    language: "韩语-ko",
    outputname: "ko.json",
  },
];

const GEMINI_API_KEY = "AIzaSyAqaFU3fQ2NnxFamR-n72Xh2RU9H6XTTCc";
const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
const model = google("gemini-2.5-flash");

// ========== 辅助函数 ==========
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 带重试的翻译函数
const translateWithRetry = async (prompt, language, retries = MAX_RETRIES) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await generateText({
        model,
        system: `你是一个专业的翻译专家。你的任务是将JSON数据中的文本值翻译成地道的${language}。
            重要规则：
            1. 只翻译JSON中的值（引号内的文本），不要改变键名
            2. 保持JSON的完整结构和格式
            3. 直接返回可用于JSON.parse()的纯JSON格式
            4. 绝对不要添加任何markdown格式或代码块标记
            示例输入：
            {
            "data": {
                "t1": "Hello",
                "t2": "World",
                "t3": "Welcome"
            }
            }
            示例输出：
            {
            "data": {
                "t1": "你好",
                "t2": "世界", 
                "t3": "欢迎"
            }
            }`,
        prompt: `请将以下JSON中的文本翻译成地道的${language}：
            ${prompt}
            要求：返回标准JSON格式，可直接用于JSON.parse()解析，不包含任何其他字符或标记。`,
      });
      
      const cleanText = response.text.replace(/```json/g, "").replace(/```/g, "");
      return JSON.parse(cleanText);
    } catch (error) {
      console.error(`翻译失败 (尝试 ${attempt}/${retries}): ${error.message}`);
      
      if (attempt === retries) {
        throw new Error(`翻译失败，已重试 ${retries} 次: ${error.message}`);
      }
      
      // 等待一段时间再重试
      await delay(RETRY_DELAY * attempt);
    }
  }
};

// 并行处理批次的函数
const processBatchesInParallel = async (batches, language, outputPath) => {
  const results = {};
  const totalBatches = batches.length;
  
  // 将批次分组进行并行处理
  for (let i = 0; i < totalBatches; i += PARALLEL_BATCHES) {
    const currentBatches = batches.slice(i, i + PARALLEL_BATCHES);
    const batchPromises = currentBatches.map(async (batch, index) => {
      const actualIndex = i + index;
      try {
        console.log(`开始翻译 ${language}: 第${actualIndex + 1}批数据`);
        const prompt = JSON.stringify(batch);
        const result = await translateWithRetry(prompt, language);
        console.log(`完成翻译 ${language}: 第${actualIndex + 1}批数据`);
        return { index: actualIndex, data: result.data };
      } catch (error) {
        console.error(`翻译 ${language} 第${actualIndex + 1}批数据失败:`, error.message);
        return { index: actualIndex, data: null, error: error.message };
      }
    });
    
    // 等待当前组的所有批次完成
    const batchResults = await Promise.all(batchPromises);
    
    // 合并结果
    batchResults.forEach(({ index, data, error }) => {
      if (data) {
        Object.assign(results, data);
      } else {
        console.error(`批次 ${index + 1} 翻译失败: ${error}`);
      }
    });
    
    // 实时保存进度
    const outputData = { data: results };
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`${language} 已完成 ${Math.min(i + PARALLEL_BATCHES, totalBatches)}/${totalBatches} 批次`);
    
    // 如果不是最后一组，稍微延迟一下避免API限制
    if (i + PARALLEL_BATCHES < totalBatches) {
      await delay(500);
    }
  }
  
  return results;
};

// 准备数据批次
const prepareBatches = (originalData) => {
  const keys = Object.keys(originalData.data);
  const batches = [];
  
  for (let i = 0; i < keys.length; i += INPUT_COUNT) {
    const batchData = {};
    keys.slice(i, i + INPUT_COUNT).forEach((key) => {
      batchData[key] = originalData.data[key];
    });
    batches.push({ data: batchData });
  }
  
  return batches;
};

// 主函数
const start = async () => {
  // 确保输出目录存在
  if (!fs.existsSync(TRANSLATED_DIR)) {
    fs.mkdirSync(TRANSLATED_DIR, { recursive: true });
  }
  
  try {
    // 读取原始数据
    const originalJson = fs.readFileSync(ORIGINAL_JSON, "utf-8");
    const originalData = JSON.parse(originalJson);
    const batches = prepareBatches(originalData);
    
    console.log(`准备翻译 ${batches.length} 个批次，每批次 ${INPUT_COUNT} 条数据`);
    console.log(`并行处理 ${PARALLEL_BATCHES} 批次，最大重试次数 ${MAX_RETRIES}`);
    
    // 并行处理所有语言
    const languagePromises = OUTPUT_LIST.map(async ({ language, outputname }) => {
      try {
        console.log(`\n开始翻译：${language}`);
        const outputPath = path.join(TRANSLATED_DIR, outputname);
        
        const startTime = Date.now();
        await processBatchesInParallel(batches, language, outputPath);
        const endTime = Date.now();
        
        console.log(`✅ ${language} 翻译完成，耗时: ${((endTime - startTime) / 1000).toFixed(2)}秒`);
        return { language, success: true };
      } catch (error) {
        console.error(`❌ ${language} 翻译失败:`, error.message);
        return { language, success: false, error: error.message };
      }
    });
    
    // 等待所有语言翻译完成
    const results = await Promise.all(languagePromises);
    
    // 输出结果摘要
    console.log("\n========== 翻译结果摘要 ==========");
    results.forEach(({ language, success, error }) => {
      if (success) {
        console.log(`✅ ${language}: 成功`);
      } else {
        console.log(`❌ ${language}: 失败 - ${error}`);
      }
    });
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\n翻译结束🎉 成功: ${successCount}/${results.length} 种语言`);
    
  } catch (error) {
    console.error("翻译过程中发生错误:", error);
  }
};

start();
