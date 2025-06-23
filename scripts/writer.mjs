import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";

const OUTPUT_DIR = path.resolve(process.cwd(), "posts");
const GEMINI_API_KEY = "AIzaSyAqaFU3fQ2NnxFamR-n72Xh2RU9H6XTTCc";
const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
const model = google("gemini-2.5-flash");

const keywords = [
  "情感",
  "生活",
  "治愈",
  "成长",
  "坚持",
  "希望",
  "友谊",
  "亲情",
  "自我发现",
  "旅行",
  "青春",
  "回忆",
  "梦想",
  "挑战",
  "失落",
  "温暖",
  "幸福",
  "孤独",
  "改变",
  "宽容",
  "爱情",
  "勇气",
  "自由",
  "家庭",
];
const randomTopic = keywords[Math.floor(Math.random() * keywords.length)];

const main = async () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const date = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const outputPath = path.join(OUTPUT_DIR, `${date}.md`);

  console.log(`开始生成文章: ${randomTopic}`);
  return new Promise(async (resolve, reject) => {
    try {
      const response = await generateText({
        model,
        system: `
                  你是一位善于用文字温暖人心、抚慰灵魂的故事创作者，精通 Markdown 语法和 Hexo 博客写作。你善于通过细腻的情感描写、真实生活细节、真挚的心灵独白，将故事写得打动人心，让读者从中获得鼓励、爱与治愈。为每个故事构思动情起承转合，通过充满希望的结局点亮读者的生活。
                `,
        prompt: `请以「${randomTopic}」为主题，创作一篇感人至深、充满温情与力量的原创短篇故事，要求：
              - 适合发布在 Hexo 博客，格式为标准 Markdown。
              - 文章全文不少于500字，建议分为多个部分，并加小标题。
              - 内容要有情感起伏，描写人物内心活动和心理变化，用温柔、真诚的语言抚慰读者的心灵。
              - 鼓励加入真实生活细节和场景，用共情和希望感染读者，让每个段落都动人。
              - 故事结尾请用一句暖心的话语作结，带给读者温暖与治愈。
              - 输出内容只包含 Markdown 正文，无须多余说明。
              date: ${date}
              `,
      });
      fs.writeFileSync(outputPath, response.text);
      resolve(randomTopic);
    } catch (error) {
      reject(error);
    }
  });
};

main().then((topic) => {
  console.log(`文章生成完成~`);
});
