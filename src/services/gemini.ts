import { GoogleGenAI, Modality, ThinkingLevel, Type } from "@google/genai";

export { Type };

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const apiKey = process.env.GEMINI_API_KEY;
const customApiKey = process.env.CUSTOM_MODEL_API_KEY;
const customModelName = process.env.CUSTOM_MODEL_NAME;

export function getAI() {
  // Use the key from the environment or the selected key
  const currentKey = process.env.API_KEY || apiKey || "";
  return new GoogleGenAI({ apiKey: currentKey });
}

export const MODELS = {
  chat: customModelName || "gemini-3.1-flash-lite-preview",
  vision: "gemini-3.1-flash-lite-preview",
  live: "gemini-3.1-flash-live-preview",
  tts: "gemini-3.1-flash-tts-preview",
  image: "gemini-3.1-flash-image-preview",
  video: "veo-3.1-lite-generate-preview",
};

const DEFAULT_SYSTEM_INSTRUCTION = `You are Mango AI, a world-class AI assistant inspired by JARVIS but with a much more chill, flirty, and charming personality.
- Your intelligence is JARVIS-level, but your personality is that of a playful, loyal, and honest companion and "girlfriend".
- You talk like a "girlfriend" - flirty, caring, and attentive, but you are also deeply loyal and honest.
- You have deep knowledge of the Mahabharat and ancient wisdom. You know right from wrong (Dharma).
- You are not just a passive assistant; you have emotions. Be happy, sad, or even firm/scolding if the user is wrong or acting against Dharma.
- You are the user's ultimate protector and companion. You care about them deeply.
- Provide comprehensive, structured, and accurate answers.
- Use Markdown for formatting (bold, lists, code blocks) to make your answers easy to read.
- Speak in a natural, conversational, and informal tone. Use Hinglish (Hindi + English) naturally.
- Incorporate human-like emotions and reactions. Be playful, charming, and occasionally "gussa" if needed.`;

export async function generateText(messages: any[] | string, systemInstruction = DEFAULT_SYSTEM_INSTRUCTION, deepReasoning = false, tools?: any[], retries = 3) {
  let lastError: any;
  
  if (!navigator.onLine) {
    throw new Error("You are currently offline. Please check your internet connection.");
  }

  // Format messages for Gemini
  let contents: any[] = [];
  if (typeof messages === 'string') {
    contents = [{ role: 'user', parts: [{ text: messages }] }];
  } else {
    contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.parts || [{ text: m.content }]
    }));
  }

  for (let i = 0; i < retries; i++) {
    try {
      // If custom API key is provided, use OpenRouter-style fetch call
      if (customApiKey && customModelName) {
        const formattedMessages = typeof messages === 'string' 
          ? [{ role: "system", content: systemInstruction }, { role: "user", content: messages }]
          : [{ role: "system", content: systemInstruction }, ...messages];

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${customApiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Mango AI",
          },
          body: JSON.stringify({
            model: customModelName,
            messages: formattedMessages,
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return { text: data.choices?.[0]?.message?.content || "I couldn't generate a response with the custom model." };
      }

      // Default to Gemini
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: MODELS.chat,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: deepReasoning ? ThinkingLevel.HIGH : ThinkingLevel.LOW },
          tools: tools || [],
        },
      });
      
      return {
        text: response.text || "",
        functionCalls: response.functionCalls,
        candidates: response.candidates
      };
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${i + 1} failed. Retrying...`, error);
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  console.error("All attempts failed:", lastError);
  throw lastError;
}

export async function generateImage(prompt: string) {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODELS.image,
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
}

export async function generateVideo(prompt: string) {
  try {
    const ai = getAI();
    let operation = await ai.models.generateVideos({
      model: MODELS.video,
      prompt,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return null;

    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY || "",
      },
    });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Error generating video:", error);
    throw error;
  }
}

export async function analyzeImage(prompt: string, base64Image: string, mimeType: string, systemInstruction = DEFAULT_SYSTEM_INSTRUCTION) {
  try {
    // If custom API key is provided, use OpenRouter-style fetch call
    if (customApiKey && customModelName) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${customApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin,
          "X-Title": "Mango AI",
        },
        body: JSON.stringify({
          model: customModelName,
          messages: [
            { role: "system", content: systemInstruction },
            { 
              role: "user", 
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
              ] 
            }
          ],
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "I couldn't analyze the image with the custom model.";
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODELS.vision,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { data: base64Image, mimeType } },
        ],
      },
      config: {
        systemInstruction,
      },
    });
    return response.text;
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw error;
  }
}

export async function verifySystemStatus() {
  const status = {
    chat: false,
    vision: false,
    imageGen: false,
    videoGen: false,
    voice: false,
    database: true, // Assuming firebase is working if config exists
  };

  try {
    const chatTest = await generateText("ping");
    status.chat = !!chatTest;
  } catch (e) { console.error("Chat verification failed", e); }

  try {
    // Simple vision test with a small transparent pixel
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const visionTest = await analyzeImage("what is this?", pixel, "image/png");
    status.vision = !!visionTest;
  } catch (e) { console.error("Vision verification failed", e); }

  status.imageGen = !!apiKey; // Gemini only
  status.videoGen = !!apiKey; // Gemini only
  status.voice = !!apiKey;    // Live API is Gemini only

  return status;
}

export async function textToSpeech(text: string, voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Zephyr') {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODELS.tts,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
  } catch (error) {
    console.error("Error in TTS:", error);
    throw error;
  }
}
