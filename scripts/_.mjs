import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import fs from "fs";
import path from "path";

const ORIGINAL_JSON = path.resolve(process.cwd(), "translate_original/en.json");
const TRANSLATED_DIR = path.resolve(process.cwd(), "translate_translated");
const input_count = 100; // 一批翻译多少条
const BATCH_CONCURRENCY = 10; // 同时处理多少批次
const LANGUAGE_CONCURRENCY = 5; // 同时处理多少种语言
const MAX_RETRIES = 3; // 最大重试次数

const outPutList = [
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
  {
    language: "西班牙语-es",
    outputname: "es.json",
  },
];

const GEMINI_API_KEY = "AIzaSyAqaFU3fQ2NnxFamR-n72Xh2RU9H6XTTCc";
const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
const model = google("gemini-2.5-flash");

// 延迟函数
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 清理JSON响应
const cleanJsonResponse = (text) => {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/^\s*[\r\n]/gm, "")
    .trim();
};

// 基础翻译函数
const translateBatch = async (batchData, language, batchId, retryCount = 0) => {
  try {
    console.log(
      `🔄 开始翻译: ${language} - 批次${batchId} (尝试${retryCount + 1})`
    );

    const response = await generateText({
      model,
      system: `你是一个专业的翻译专家。你的任务是将JSON数据中的文本值翻译成地道的${language}。
          重要规则：
          1. 只翻译JSON中的值（引号内的文本），不要改变键名
          2. 保持JSON的完整结构和格式
          3. 直接返回可用于JSON.parse()的纯JSON格式
          4. 绝对不要添加任何markdown格式或代码块标记`,
      prompt: `请将以下JSON中的文本翻译成地道的${language}：
          ${JSON.stringify(batchData)}
          要求：返回标准JSON格式，可直接用于JSON.parse()解析，不包含任何其他字符或标记。`,
    });

    const cleanedText = cleanJsonResponse(response.text);
    const result = JSON.parse(cleanedText);

    console.log(`✅ 完成翻译: ${language} - 批次${batchId}`);
    return {
      success: true,
      data: result.data,
      batchId,
      language,
    };
  } catch (error) {
    console.error(
      `❌ 翻译失败: ${language} - 批次${batchId} (尝试${retryCount + 1}):`,
      error.message
    );

    if (retryCount < MAX_RETRIES) {
      const delayTime = 1000 * Math.pow(2, retryCount) + Math.random() * 1000;
      console.log(
        `⏳ 等待 ${Math.round(
          delayTime
        )}ms 后重试 ${language} - 批次${batchId}...`
      );
      await delay(delayTime);
      return translateBatch(batchData, language, batchId, retryCount + 1);
    }

    return {
      success: false,
      error: error.message,
      batchId,
      language,
      data: batchData.data, // 失败时返回原始数据
    };
  }
};

// 批量并发处理函数
const processBatchesConcurrently = async (
  batches,
  processor,
  concurrency,
  description
) => {
  const results = [];
  const executing = [];

  console.log(
    `🚀 开始${description}: ${batches.length}个任务，并发度${concurrency}`
  );

  for (const batch of batches) {
    const promise = processor(batch).then((result) => {
      // 从正在执行的数组中移除
      const index = executing.indexOf(promise);
      if (index > -1) {
        executing.splice(index, 1);
      }
      return result;
    });

    results.push(promise);
    executing.push(promise);

    // 如果达到并发限制，等待至少一个完成
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  // 等待所有任务完成
  const finalResults = await Promise.all(results);
  console.log(`✅ ${description}完成: ${finalResults.length}个任务`);

  return finalResults;
};

// 创建所有翻译任务
const createTranslationTasks = (originalData) => {
  const keys = Object.keys(originalData.data);
  const totalBatches = Math.ceil(keys.length / input_count);

  console.log(`📊 数据统计: ${keys.length}个翻译项，分为${totalBatches}个批次`);

  // 创建所有批次数据
  const batches = [];
  for (let i = 0; i < keys.length; i += input_count) {
    const batchKeys = keys.slice(i, i + input_count);
    const batchData = { data: {} };
    batchKeys.forEach((key) => {
      batchData.data[key] = originalData.data[key];
    });

    batches.push({
      id: Math.floor(i / input_count) + 1,
      data: batchData,
      keys: batchKeys,
    });
  }

  // 创建所有翻译任务 (批次 × 语言)
  const allTasks = [];
  for (const languageConfig of outPutList) {
    for (const batch of batches) {
      allTasks.push({
        language: languageConfig.language,
        outputname: languageConfig.outputname,
        batchId: batch.id,
        batchData: batch.data,
        taskId: `${languageConfig.language}-batch${batch.id}`,
      });
    }
  }

  console.log(
    `📋 创建翻译任务: ${allTasks.length}个 (${outPutList.length}种语言 × ${batches.length}个批次)`
  );
  return { allTasks, totalBatches };
};

// 实时进度跟踪
class RealTimeProgress {
  constructor(totalTasks, languages, batches) {
    this.totalTasks = totalTasks;
    this.completed = 0;
    this.failed = 0;
    this.languages = languages;
    this.batches = batches;
    this.languageProgress = {};
    this.startTime = Date.now();

    // 初始化语言进度
    languages.forEach((lang) => {
      this.languageProgress[lang] = { completed: 0, failed: 0, total: batches };
    });

    this.printHeader();
  }

  printHeader() {
    console.log("\n" + "=".repeat(80));
    console.log(`🎯 实时翻译进度 - 总任务: ${this.totalTasks}`);
    console.log(
      `⚙️  并发配置: ${BATCH_CONCURRENCY}批次 × ${LANGUAGE_CONCURRENCY}语言`
    );
    console.log("=".repeat(80));
  }

  update(result) {
    if (result.success) {
      this.completed++;
      this.languageProgress[result.language].completed++;
    } else {
      this.failed++;
      this.languageProgress[result.language].failed++;
    }

    this.printProgress(result);
  }

  printProgress(result) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const totalProcessed = this.completed + this.failed;
    const overallProgress = ((totalProcessed / this.totalTasks) * 100).toFixed(
      1
    );
    const speed = (totalProcessed / parseFloat(elapsed)).toFixed(1);

    const status = result.success ? "✅" : "❌";
    console.log(
      `${status} ${result.language.padEnd(12)} 批次${result.batchId
        .toString()
        .padStart(3)} | 总进度: ${overallProgress}% (${totalProcessed}/${
        this.totalTasks
      }) | 速度: ${speed}/s | 耗时: ${elapsed}s`
    );

    // 每完成50个任务显示一次详细统计
    if (totalProcessed % 50 === 0) {
      this.printDetailedStats();
    }
  }

  printDetailedStats() {
    console.log("\n📊 各语言进度详情:");
    Object.entries(this.languageProgress).forEach(([lang, progress]) => {
      const total = progress.completed + progress.failed;
      const percentage =
        total > 0
          ? ((progress.completed / this.batches) * 100).toFixed(1)
          : "0";
      console.log(
        `   ${lang.padEnd(12)}: ${progress.completed}/${
          this.batches
        } (${percentage}%) 失败: ${progress.failed}`
      );
    });
    console.log();
  }

  printFinalReport() {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const avgSpeed = (this.totalTasks / parseFloat(totalTime)).toFixed(1);

    console.log("\n" + "=".repeat(80));
    console.log("🎉 翻译任务完成!");
    console.log("=".repeat(80));
    console.log(`⏱️  总耗时: ${totalTime}秒`);
    console.log(`🚀 平均速度: ${avgSpeed}任务/秒`);
    console.log(
      `✅ 成功: ${this.completed}/${this.totalTasks} (${(
        (this.completed / this.totalTasks) *
        100
      ).toFixed(1)}%)`
    );
    console.log(`❌ 失败: ${this.failed}/${this.totalTasks}`);

    console.log("\n📋 各语言完成情况:");
    Object.entries(this.languageProgress).forEach(([lang, progress]) => {
      const successRate = ((progress.completed / this.batches) * 100).toFixed(
        1
      );
      console.log(
        `   ${lang.padEnd(12)}: ${progress.completed}/${
          this.batches
        } (${successRate}%)`
      );
    });

    return {
      totalTime,
      avgSpeed,
      successRate: ((this.completed / this.totalTasks) * 100).toFixed(1),
      languageProgress: this.languageProgress,
    };
  }
}

// 合并和保存结果
const saveResults = (results, originalTasksLength) => {
  console.log(`\n💾 开始保存翻译结果...`);

  // 按语言分组结果
  const resultsByLanguage = {};

  results.forEach((result) => {
    if (!resultsByLanguage[result.language]) {
      resultsByLanguage[result.language] = [];
    }
    resultsByLanguage[result.language].push(result);
  });

  // 为每种语言保存文件
  const saveResults = [];
  Object.entries(resultsByLanguage).forEach(([language, languageResults]) => {
    // 找到对应的输出文件名
    const languageConfig = outPutList.find(
      (config) => config.language === language
    );
    if (!languageConfig) {
      console.error(`❌ 未找到语言配置: ${language}`);
      return;
    }

    // 合并所有批次的数据
    const mergedData = { data: {} };
    languageResults
      .sort((a, b) => a.batchId - b.batchId) // 按批次ID排序
      .forEach((result) => {
        if (result.data) {
          Object.assign(mergedData.data, result.data);
        }
      });

    // 保存文件
    const outputPath = path.join(TRANSLATED_DIR, languageConfig.outputname);
    try {
      fs.writeFileSync(outputPath, JSON.stringify(mergedData, null, 2), "utf8");

      const successCount = languageResults.filter((r) => r.success).length;
      const totalCount = languageResults.length;

      console.log(
        `💾 ${language}: 已保存 ${
          Object.keys(mergedData.data).length
        } 项翻译 (${successCount}/${totalCount}批次成功)`
      );

      saveResults.push({
        language,
        filePath: outputPath,
        itemCount: Object.keys(mergedData.data).length,
        successBatches: successCount,
        totalBatches: totalCount,
      });
    } catch (error) {
      console.error(`❌ 保存文件失败 [${language}]:`, error.message);
    }
  });

  return saveResults;
};

// 主函数
const start = async () => {
  console.log(`🌟 开始大规模并行翻译任务!`);
  console.log(
    `⚡ 并发配置: ${BATCH_CONCURRENCY}批次同时处理 × ${LANGUAGE_CONCURRENCY}语言同时处理`
  );

  // 创建输出目录
  if (!fs.existsSync(TRANSLATED_DIR)) {
    fs.mkdirSync(TRANSLATED_DIR, { recursive: true });
  }

  try {
    // 读取原始数据
    const originalJson = fs.readFileSync(ORIGINAL_JSON, "utf-8");
    const originalData = JSON.parse(originalJson);

    // 创建所有翻译任务
    const { allTasks, totalBatches } = createTranslationTasks(originalData);

    // 初始化进度跟踪
    const progress = new RealTimeProgress(
      allTasks.length,
      outPutList.map((item) => item.language),
      totalBatches
    );

    // 创建任务处理器
    const taskProcessor = async (task) => {
      const result = await translateBatch(
        task.batchData,
        task.language,
        task.batchId
      );

      progress.update(result);
      return result;
    };

    // 第一层并发：同时处理多种语言
    // 第二层并发：每种语言内同时处理多个批次
    const maxConcurrency = BATCH_CONCURRENCY * LANGUAGE_CONCURRENCY;

    console.log(`🔥 开始并行翻译: 最大并发度 ${maxConcurrency}`);

    // 执行所有翻译任务
    const results = await processBatchesConcurrently(
      allTasks,
      taskProcessor,
      maxConcurrency,
      "并行翻译"
    );

    // 输出最终报告
    const finalStats = progress.printFinalReport();

    // 保存结果
    const saveStats = saveResults(results, allTasks.length);

    // 生成详细报告
    const detailedReport = {
      timestamp: new Date().toISOString(),
      configuration: {
        batchConcurrency: BATCH_CONCURRENCY,
        languageConcurrency: LANGUAGE_CONCURRENCY,
        maxConcurrency: maxConcurrency,
        inputCount: input_count,
        maxRetries: MAX_RETRIES,
      },
      performance: finalStats,
      results: saveStats,
      tasks: {
        total: allTasks.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    };

    // 保存执行报告
    fs.writeFileSync(
      path.join(TRANSLATED_DIR, "detailed_translation_report.json"),
      JSON.stringify(detailedReport, null, 2)
    );

    console.log(
      `\n🎉🎉🎉 大规模并行翻译完成! 报告已保存到 detailed_translation_report.json`
    );
  } catch (error) {
    console.error("💥 翻译任务发生严重错误:", error);
  }
};

// 优雅处理退出
process.on("SIGINT", () => {
  console.log("\n⚠️  收到中断信号，等待当前任务完成...");
  process.exit(0);
});

start();
