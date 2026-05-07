import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function detectLanguage(text: string) {
  if (!text.trim()) return "en";
  const response = await ai.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: `Identify the language of this text. Return ONLY the ISO 639-1 language code (e.g., 'en', 'es', 'hi'):\n\n${text}`,
  });
  return response.text?.trim().toLowerCase().slice(0, 2) || "en";
}

export async function translateText(text: string, from: string, to: string) {
  if (!text.trim()) return "";
  
  const fromPrompt = from === 'auto' ? 'detect the source language' : `from ${from}`;
  const response = await ai.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: `Translate the following text ${fromPrompt} to ${to}. Only return the translated text without any explanations or quotes:\n\n${text}`,
  });
  
  return response.text?.trim() || "";
}

export async function translateAudio(audioBase64: string, targetLanguage: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType: "audio/webm",
          data: audioBase64,
        },
      },
      {
        text: `You are a high-fidelity translator. 
               1. Transcribe the audio precisely.
               2. Translate it to ${targetLanguage}.
               3. Identify the source language.
               
               Return a JSON object:
               {
                 "originalText": "...",
                 "translatedText": "...",
                 "sourceLanguage": "...",
                 "detectedLanguageCode": "..."
               }`,
      },
    ],
    config: {
      responseMimeType: "application/json",
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return null;
  }
}

export async function generateSpeech(text: string, voiceName: 'Kore' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Kore') {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
}
