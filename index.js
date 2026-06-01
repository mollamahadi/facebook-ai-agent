import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const PAGE_ID = process.env.PAGE_ID || "";
const AI_PAUSE_HOURS = 24;
const AI_PAUSE_MS = AI_PAUSE_HOURS * 60 * 60 * 1000;

// In-memory pause list.
// Note: Render restart হলে এই memory reset হবে।
const pausedUsers = new Map();

// AI যেসব message পাঠায়, সেগুলোর text সাময়িকভাবে রাখি,
// যাতে AI-এর নিজের echo দেখে pause না হয়।
const botSentTexts = new Map();

app.get("/", (req, res) => {
  res.send("Kairo Facebook Gemini AI Agent Running");
});

app.get("/test-ai", async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "শুধু বাংলায় উত্তর দাও: Kairo AI Assistant চালু আছে।",
    });

    res.send(response.text || "আমি Kairo AI Assistant। Bot চালু আছে।");
  } catch (error) {
    console.error("Test AI Error:", error.response?.data || error.message);
    res.send("আমি Kairo AI Assistant। Bot fallback mode-এ চালু আছে।");
  }
});

// Meta webhook verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Facebook inbox message receive
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page") return;

    cleanupPauseMemory();

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const messageText = event.message?.text;

        if (!senderId) continue;

        // Page/Admin/Bot sent message echo
        if (event.message?.is_echo) {
          handleEchoMessage(senderId, recipientId, messageText);
          continue;
        }

        if (!messageText) continue;

        if (isUserPaused(senderId)) {
          const remaining = getPauseRemainingText(senderId);
          console.log(`AI paused for user ${senderId}. Remaining: ${remaining}`);
          continue;
        }

        console.log("New customer message:", messageText);

        const reply = await generateAIReply(messageText);
        await sendFacebookMessage(senderId, reply);
      }
    }
  } catch (error) {
    console.error("Webhook Error:", error.response?.data || error.message);
  }
});

function handleEchoMessage(senderId, recipientId, messageText = "") {
  // Echo message সাধারণত Page থেকে customer-এর দিকে যায়।
  // senderId = Page ID, recipientId = Customer PSID

  const isFromPage =
    (PAGE_ID && senderId === PAGE_ID) ||
    senderId !== recipientId;

  if (!isFromPage || !recipientId) {
    console.log("Echo ignored: not a page/admin echo.");
    return;
  }

  // AI bot যে text পাঠিয়েছে, সেটার echo আসতে পারে।
  // সেটা হলে pause করব না।
  if (isBotSentText(recipientId, messageText)) {
    console.log("Bot echo ignored, AI pause not applied.");
    return;
  }

  const pauseUntil = Date.now() + AI_PAUSE_MS;
  pausedUsers.set(recipientId, pauseUntil);

  console.log(
    `Admin/Page reply detected. AI paused for user ${recipientId} for ${AI_PAUSE_HOURS} hours.`
  );
}

function rememberBotSentText(userId, text) {
  if (!userId || !text) return;

  const key = String(userId);
  const list = botSentTexts.get(key) || [];

  list.push({
    text: normalizeText(text),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  botSentTexts.set(key, list.slice(-10));
}

function isBotSentText(userId, text = "") {
  const key = String(userId);
  const list = botSentTexts.get(key) || [];
  const normalized = normalizeText(text);

  const now = Date.now();
  const validList = list.filter((item) => item.expiresAt > now);
  botSentTexts.set(key, validList);

  return validList.some((item) => item.text === normalized);
}

function normalizeText(text = "") {
  return String(text).trim().replace(/\s+/g, " ");
}

function isUserPaused(userId) {
  const pauseUntil = pausedUsers.get(userId);

  if (!pauseUntil) return false;

  if (pauseUntil <= Date.now()) {
    pausedUsers.delete(userId);
    return false;
  }

  return true;
}

function getPauseRemainingText(userId) {
  const pauseUntil = pausedUsers.get(userId);
  if (!pauseUntil) return "0 মিনিট";

  const remainingMs = Math.max(0, pauseUntil - Date.now());
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) return `${hours} ঘণ্টা ${minutes} মিনিট`;
  return `${minutes} মিনিট`;
}

function cleanupPauseMemory() {
  const now = Date.now();

  for (const [userId, pauseUntil] of pausedUsers.entries()) {
    if (pauseUntil <= now) pausedUsers.delete(userId);
  }

  for (const [userId, list] of botSentTexts.entries()) {
    const validList = list.filter((item) => item.expiresAt > now);

    if (validList.length === 0) {
      botSentTexts.delete(userId);
    } else {
      botSentTexts.set(userId, validList);
    }
  }
}

async function generateAIReply(userMessage) {
  const quickReply = getQuickReply(userMessage);
  if (quickReply) return quickReply;

  const prompt = `
তুমি Kairo Facebook Page-এর AI Assistant।

কঠোর নিয়ম:
- সব উত্তর শুধু বাংলায় দিবে।
- ইংরেজি শব্দ যতটা সম্ভব এড়িয়ে চলবে।
- Customer English লিখলেও বাংলায় উত্তর দিবে।
- নিজের পরিচয় দিবে: "আমি Kairo AI Assistant"।
- উত্তর ছোট, ভদ্র, প্রফেশনাল এবং helpful হবে।
- ভুয়া promise করবে না।
- Payment confirm করবে না।
- Refund promise করবে না।
- Payment, refund, complaint বা order issue হলে বলবে admin বিষয়টি check করবে।
- Sensitive personal data চাইবে না।

Business Info:
Brand: Kairo

পণ্য:
প্রিমিয়াম ড্রপ শোল্ডার টি-শার্ট

তথ্য:
- ১০০% সফট কটন
- 220+ GSM
- ওভারসাইজড ইউনিসেক্স ফিট

দাম:
- প্রিন্টসহ ৪৯৯ টাকা

ডেলিভারি:
- ঢাকার ভিতরে ৮০ টাকা
- ঢাকার বাইরে ১২০ টাকা
- সময় ২-৩ দিন

পেমেন্ট:
- রেডি ডিজাইনে Cash on Delivery আছে
- কাস্টম ডিজাইনের ক্ষেত্রে অগ্রিম ডেলিভারি চার্জ প্রয়োজন

সাইজ চার্ট:
M: লেন্থ ২৭ ইঞ্চি, চেস্ট ৪২ ইঞ্চি, স্লিভ ৮.০৪ ইঞ্চি
L: লেন্থ ২৮ ইঞ্চি, চেস্ট ৪৪ ইঞ্চি, স্লিভ ৯.০০ ইঞ্চি
XL: লেন্থ ২৯ ইঞ্চি, চেস্ট ৪৬ ইঞ্চি, স্লিভ ৯.০৪ ইঞ্চি
2XL: লেন্থ ৩০ ইঞ্চি, চেস্ট ৪৮ ইঞ্চি, স্লিভ ৯.০৪ ইঞ্চি

Manual measurement-এর কারণে ±১ ইঞ্চি পার্থক্য হতে পারে।

Customer message:
${userMessage}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    return response.text || getDefaultReply();
  } catch (error) {
    console.error("Gemini Error:", error.response?.data || error.message);
    return getDefaultReply();
  }
}

function getQuickReply(userMessage = "") {
  const text = userMessage.toLowerCase().trim();

  if (
    text === "hi" ||
    text === "hello" ||
    text === "hey" ||
    text === "hii" ||
    text === "helo" ||
    text === "হাই" ||
    text === "হ্যালো" ||
    text === "আসসালামু আলাইকুম" ||
    text === "সালাম"
  ) {
    return `আমি Kairo AI Assistant। 😊

Kairo-তে আপনাকে স্বাগতম।

আমাদের প্রিমিয়াম ড্রপ শোল্ডার টি-শার্ট:
✔️ ১০০% সফট কটন
✔️ 220+ GSM
✔️ ওভারসাইজড ইউনিসেক্স ফিট
✔️ দাম ৪৯৯ টাকা

📌 দ্রুত তথ্য পেতে নিচের যেকোনো একটি লিখুন:

💰 Price → পণ্যের দাম
📏 Size → সাইজ চার্ট
🚚 Delivery → ডেলিভারি চার্জ ও সময়
🛒 Order → অর্ডার করার নিয়ম
🎨 Custom → কাস্টম ডিজাইন সম্পর্কে তথ্য

আপনার প্রশ্ন লিখুন, আমি সাহায্য করার চেষ্টা করব।`;
  }

  if (
    text.includes("price") ||
    text.includes("dam") ||
    text.includes("দাম") ||
    text.includes("koto") ||
    text.includes("কত") ||
    text.includes("tk") ||
    text.includes("taka") ||
    text.includes("টাকা")
  ) {
    return "আমি Kairo AI Assistant। আমাদের প্রিমিয়াম ড্রপ শোল্ডার টি-শার্ট প্রিন্টসহ দাম ৪৯৯ টাকা। কাপড় ১০০% সফট কটন, 220+ GSM এবং ওভারসাইজড ইউনিসেক্স ফিট।";
  }

  if (
    text.includes("delivery") ||
    text.includes("charge") ||
    text.includes("shipping") ||
    text.includes("ডেলিভারি") ||
    text.includes("চার্জ")
  ) {
    return "আমি Kairo AI Assistant। ডেলিভারি চার্জ ঢাকার ভিতরে ৮০ টাকা এবং ঢাকার বাইরে ১২০ টাকা। ডেলিভারি সময় সাধারণত ২-৩ দিন।";
  }

  if (
    text.includes("size") ||
    text.includes("chart") ||
    text.includes("সাইজ") ||
    text.includes("medium") ||
    text.includes("large") ||
    text.includes("xl") ||
    text.includes("xxl")
  ) {
    return `আমি Kairo AI Assistant।

📏 KAIRO সাইজ চার্ট:

M:
লেন্থ ২৭", চেস্ট ৪২", স্লিভ ৮.০৪"

L:
লেন্থ ২৮", চেস্ট ৪৪", স্লিভ ৯.০০"

XL:
লেন্থ ২৯", চেস্ট ৪৬", স্লিভ ৯.০৪"

2XL:
লেন্থ ৩০", চেস্ট ৪৮", স্লিভ ৯.০৪"

Manual measurement-এর কারণে ±১ ইঞ্চি পার্থক্য হতে পারে।`;
  }

  if (
    text.includes("payment") ||
    text.includes("refund") ||
    text.includes("complaint") ||
    text.includes("cancel") ||
    text.includes("পেমেন্ট") ||
    text.includes("রিফান্ড") ||
    text.includes("সমস্যা") ||
    text.includes("ক্যানসেল")
  ) {
    return "আমি Kairo AI Assistant। আপনার বিষয়টি admin check করবে। একটু অপেক্ষা করুন।";
  }

  if (
    text.includes("order") ||
    text.includes("buy") ||
    text.includes("kinbo") ||
    text.includes("অর্ডার") ||
    text.includes("কিনবো") ||
    text.includes("নিবো")
  ) {
    return `আমি Kairo AI Assistant। অর্ডার করতে চাইলে দয়া করে এই তথ্যগুলো দিন:

১. নাম:
২. ফোন নম্বর:
৩. সম্পূর্ণ ঠিকানা:
৪. সাইজ:
৫. ডিজাইন details:

Admin আপনার অর্ডার confirm করবে।`;
  }

  if (
    text.includes("custom") ||
    text.includes("design") ||
    text.includes("কাস্টম") ||
    text.includes("ডিজাইন")
  ) {
    return "আমি Kairo AI Assistant। Custom design করা যাবে। কাস্টম ডিজাইনের ক্ষেত্রে অগ্রিম ডেলিভারি চার্জ প্রয়োজন। আপনার ডিজাইন/লোগো/রেফারেন্স ছবি পাঠাতে পারেন।";
  }

  return null;
}

function getDefaultReply() {
  return "আমি Kairo AI Assistant। Kairo-এর প্রিমিয়াম ড্রপ শোল্ডার টি-শার্ট প্রিন্টসহ ৪৯৯ টাকা। ১০০% সফট কটন, 220+ GSM, ওভারসাইজড ইউনিসেক্স ফিট। ডেলিভারি সময় ২-৩ দিন।";
}

async function sendFacebookMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: { text },
      }
    );

    rememberBotSentText(senderId, text);

    console.log("Reply sent successfully");
  } catch (error) {
    console.error("Facebook Send Error:", error.response?.data || error.message);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});