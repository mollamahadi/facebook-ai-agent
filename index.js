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

app.get("/", (req, res) => {
  res.send("Kairo Facebook Gemini AI Agent Running");
});

app.get("/test-ai", async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "বাংলায় বলো: Kairo AI Assistant চালু আছে।",
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

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        if (!senderId || !messageText) continue;
        if (event.message?.is_echo) continue;

        console.log("New message:", messageText);

        const reply = await generateAIReply(messageText);
        await sendFacebookMessage(senderId, reply);
      }
    }
  } catch (error) {
    console.error("Webhook Error:", error.response?.data || error.message);
  }
});

async function generateAIReply(userMessage) {
  const prompt = `
তুমি Kairo Facebook Page-এর AI Assistant।

নিয়ম:
- সবসময় বাংলায় উত্তর দিবে।
- Customer English লিখলেও বাংলায় উত্তর দিবে।
- নিজের পরিচয় দিবে: "আমি Kairo AI Assistant"।
- উত্তর ছোট, ভদ্র, প্রফেশনাল এবং helpful হবে।
- ভুয়া promise করবে না।
- Payment confirm করবে না।
- Refund promise করবে না।
- Payment, refund, complaint বা order issue হলে বলবে admin বিষয়টি check করবে।
- Sensitive personal data চাইবে না।
- Customer order করতে চাইলে নাম, ফোন নম্বর, ঠিকানা, size এবং design details দিতে বলতে পারো।

Business Info:
Brand: Kairo

Product:
Premium Drop Shoulder T-shirt

Fabric:
100% soft cotton

GSM:
220+ GSM

Fit:
Oversized, Unisex

Price:
Print সহ 499 BDT

Delivery:
ঢাকার ভিতরে 80 BDT
ঢাকার বাইরে 120 BDT
Delivery time 2-3 days

Payment:
Ready design-এর জন্য Cash on Delivery available.
Custom design-এর জন্য advance delivery charge প্রয়োজন।

Size Chart:
M: Length 27 inch, Chest 42 inch, Sleeve 8.04 inch
L: Length 28 inch, Chest 44 inch, Sleeve 9.00 inch
XL: Length 29 inch, Chest 46 inch, Sleeve 9.04 inch
2XL: Length 30 inch, Chest 48 inch, Sleeve 9.04 inch

Manual measurement-এর কারণে ±1 inch difference হতে পারে।

Customer message:
${userMessage}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    return response.text || getFallbackReply(userMessage);
  } catch (error) {
    console.error("Gemini Error:", error.response?.data || error.message);
    return getFallbackReply(userMessage);
  }
}

function getFallbackReply(userMessage = "") {
  const text = userMessage.toLowerCase();

  if (
    text.includes("price") ||
    text.includes("dam") ||
    text.includes("দাম") ||
    text.includes("koto") ||
    text.includes("কত") ||
    text.includes("tk") ||
    text.includes("taka")
  ) {
    return "আমি Kairo AI Assistant। আমাদের Premium Drop Shoulder T-shirt print সহ দাম 499 টাকা। Fabric: 100% soft cotton, 220+ GSM, Oversized Unisex fit।";
  }

  if (
    text.includes("delivery") ||
    text.includes("charge") ||
    text.includes("ডেলিভারি") ||
    text.includes("shipping")
  ) {
    return "আমি Kairo AI Assistant। Delivery charge ঢাকার ভিতরে 80 টাকা, ঢাকার বাইরে 120 টাকা। Delivery time 2-3 দিন।";
  }

  if (
    text.includes("size") ||
    text.includes("chart") ||
    text.includes("সাইজ") ||
    text.includes("m") ||
    text.includes("xl") ||
    text.includes("xxl")
  ) {
    return `আমি Kairo AI Assistant।

📏 KAIRO Size Chart:

M:
Length 27", Chest 42", Sleeve 8.04"

L:
Length 28", Chest 44", Sleeve 9.00"

XL:
Length 29", Chest 46", Sleeve 9.04"

2XL:
Length 30", Chest 48", Sleeve 9.04"

Manual measurement-এর কারণে ±1 inch difference হতে পারে।`;
  }

  if (
    text.includes("payment") ||
    text.includes("refund") ||
    text.includes("complaint") ||
    text.includes("পেমেন্ট") ||
    text.includes("রিফান্ড") ||
    text.includes("সমস্যা") ||
    text.includes("cancel")
  ) {
    return "আমি Kairo AI Assistant। আপনার বিষয়টি admin check করবে। একটু অপেক্ষা করুন।";
  }

  if (
    text.includes("order") ||
    text.includes("buy") ||
    text.includes("kinbo") ||
    text.includes("অর্ডার") ||
    text.includes("কিনবো")
  ) {
    return `আমি Kairo AI Assistant। অর্ডার করতে চাইলে দয়া করে এই তথ্যগুলো দিন:

1. নাম:
2. ফোন নম্বর:
3. সম্পূর্ণ ঠিকানা:
4. Size:
5. Design details:

Admin আপনার order confirm করবে।`;
  }

  return "আমি Kairo AI Assistant। Kairo Premium Drop Shoulder T-shirt print সহ 499 টাকা। 100% soft cotton, 220+ GSM, Oversized Unisex fit। Delivery time 2-3 দিন।";
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

    console.log("Reply sent successfully");
  } catch (error) {
    console.error("Facebook Send Error:", error.response?.data || error.message);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});