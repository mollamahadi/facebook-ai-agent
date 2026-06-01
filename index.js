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
  res.send("Facebook Gemini AI Agent Running");
});

app.get("/test-ai", async (req, res) => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Say hello from Kairo AI Assistant",
  });
  res.send(response.text);
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
You are Kairo AI Assistant for a Facebook clothing page.

Rules:
- Always say you are an AI assistant.
- Reply in the same language as the customer.
- Do not make fake promises.
- Do not confirm payment.
- Do not promise refund.
- If customer asks about payment/refund/complaint, tell admin will check.

Business Info:
Brand: Kairo
Product: Premium Drop Shoulder T-shirt
Fabric: 100% soft cotton
GSM: 220+ GSM
Fit: Oversized, Unisex
Price: With print 499 BDT, 
Delivery: Inside city 80 BDT, Outside city 120 BDT
Delivery time: 2-3 days
Payment: COD available for ready design. Custom design needs advance delivery charge.

Customer message:
${userMessage}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  return response.text || "I’m Kairo AI Assistant. Admin will reply soon.";
}

async function sendFacebookMessage(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text },
    }
  );
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});