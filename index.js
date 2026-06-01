import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("Gemini AI Running");
});

app.get("/test-ai", async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Say hello from Kairo AI Assistant",
    });

    res.send(response.text);
  } catch (err) {
    console.error(err);
    res.status(500).send("Gemini Error");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});