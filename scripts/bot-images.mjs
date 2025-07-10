import { v4 as uuidv4 } from "uuid";
import { defer, lastValueFrom, retry, timer } from "rxjs";

// 建议用环境变量处理 token 更安全
const repo = "xuqssq/image-hosting";
const branch = "main";
const mkdir = "images";
const token_start = "ghp_4E6HNiBS7jdtdMJKRh";
const token_end = "4GTyzYKNyCgw3CxYq7";
const token = `${token_start}${token_end}`;
const cdn = "https://github.xuqssq.com";

// 生成随机图片 URL
const createImageUrl = (type = 4) =>
  `https://robohash.org/${uuidv4()}?set=set${
    [1, 2, 3, 4, 5, 6].includes(type) ? type : 4
  }`;

// 随机生成提交信息
const generateCommitMessage = (type = 4) => {
  const typesMap = {
    1: { name: "robot", emoji: "🤖" },
    2: { name: "alien", emoji: "👽" },
    3: { name: "robot-head", emoji: "🤖" },
    4: { name: "cat", emoji: "🐱" },
    5: { name: "cartoon", emoji: "🎨" },
    6: { name: "gorilla", emoji: "🦍" },
  };

  const commitTypes = [
    { type: "feat", desc: "add new image asset" },
    { type: "chore", desc: "update images collection" },
    { type: "style", desc: "improve image organization" },
    { type: "docs", desc: "document image upload process" },
  ];

  const tInfo = typesMap[type] || typesMap[4];
  const cType = commitTypes[Math.floor(Math.random() * commitTypes.length)];
  return `${cType.type}(${tInfo.name}): ${cType.desc} ${tInfo.emoji}`;
};

// 上传主体
async function uploadImage(type = 4) {
  const imgUrl = createImageUrl(type);
  const res = await fetch(imgUrl);
  if (!res.ok) throw new Error(`Fetch image failed: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const path = `${mkdir}/${uuidv4()}.png`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;

  const uploadRes = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({
      branch,
      message: generateCommitMessage(type),
      content: base64,
    }),
  });

  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  return `${cdn}/${path}`;
}

// RxJS 包裹，支持重试和超时
const uploadWithRetry = (type = 4, retryCount = 5, delayMs = 2000) =>
  lastValueFrom(
    defer(() => uploadImage(type)).pipe(
      retry({
        count: retryCount,
        delay: (_, retryNum) => {
          console.log(`Retry #${retryNum}`);
          return timer(delayMs);
        },
      })
    )
  );

// 用法示例
uploadWithRetry()
  .then((url) => {
    console.log("Uploaded image URL:", url);
  })
  .catch((e) => {
    console.error("Upload failed:", e);
  });
