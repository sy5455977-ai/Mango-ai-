import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.1-flash',
      contents: 'hello',
    });
    console.log("Success gemini-3.1-flash:", res.text);
  } catch (e: any) {
    console.error("Error 3.1-flash:", e.message);
  }
}
test();
