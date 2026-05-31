#!/usr/bin/env node
/**
 * Vision helper — 调用阿里云百炼千问视觉模型
 *
 * 用法:
 *   node vision.js <图片路径> [问题]
 *   node vision.js --url <图片链接> [问题]
 */
require('dotenv').config();
const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const API_KEY = process.env.DASHSCOPE_API_KEY || "";
const MODEL = "qwen-vl-max";

function parseArgs() {
  const argv = process.argv.slice(2);
  let imageSource = "", prompt = "", isUrl = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) { isUrl = true; imageSource = argv[++i]; }
    else if (!imageSource && !argv[i].startsWith("--")) imageSource = argv[i];
    else if (imageSource && !argv[i].startsWith("--")) prompt = prompt ? prompt + " " + argv[i] : argv[i];
  }
  if (!prompt) prompt = "请用中文详细描述这张图片的内容。";
  return { imageSource, prompt, isUrl };
}

async function resolveImageUrl(source, isUrl) {
  if (isUrl) return source;
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
  let buf = fs.readFileSync(resolved);
  let mime = "jpeg";

  // Compress if > 3MB
  if (buf.length > 3 * 1024 * 1024) {
    try {
      const sharp = require("sharp");
      buf = await sharp(buf).resize(1920, 1920, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      mime = "jpeg";
      console.error(`[vision] 已压缩: ${(fs.statSync(resolved).size/1048576).toFixed(1)}MB → ${(buf.length/1048576).toFixed(1)}MB`);
    } catch (e) {
      mime = buf[0] === 0x89 ? "png" : buf[0] === 0x52 ? "webp" : "jpeg";
      console.error(`[vision] 压缩跳过: ${e.message.slice(0, 40)}`);
    }
  } else {
    mime = buf[0] === 0x89 ? "png" : buf[0] === 0xff ? "jpeg" : buf[0] === 0x52 ? "webp" : "jpeg";
  }

  return `data:image/${mime};base64,${buf.toString("base64")}`;
}

function request(payload) {
  const url = new URL(BASE_URL + "/chat/completions");
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!API_KEY) {
    console.error("错误: 请设置环境变量 DASHSCOPE_API_KEY");
    console.error("      export DASHSCOPE_API_KEY=sk-xxxxx");
    process.exit(1);
  }
  const { imageSource, prompt, isUrl } = parseArgs();
  if (!imageSource) {
    console.error("用法: node vision.js <图片路径> [问题]");
    console.error("      node vision.js --url <图片链接> [问题]");
    process.exit(1);
  }
  try {
    const imageUrl = await resolveImageUrl(imageSource, isUrl);
    const result = await request({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ]}],
      stream: false,
      max_tokens: 1024,
    });
    console.log(result);
  } catch (err) {
    console.error("识图失败:", err.message);
    process.exit(1);
  }
}

main();
