import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { getAI } from "../services/gemini";

interface VoiceContextType {
  isActive: boolean;
  isMuted: boolean;
  isRepairing: boolean;
  status: 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
  errorMessage: string;
  lastTool: { name: string; status: string; message: string } | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  setIsMuted: (muted: boolean) => void;
  sendTextToVoice: (text: string) => void;
  setStatus: (status: 'idle' | 'connecting' | 'listening' | 'speaking' | 'error') => void;
  setErrorMessage: (msg: string) => void;
}

const VoiceContext = createContext<VoiceContextType | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const isActiveRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'speaking' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastTool, setLastTool] = useState<{ name: string; status: string; message: string } | null>(null);

  // Sync refs with state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const isConnectingRef = useRef(false);
  const isClosingRef = useRef(false);
  const repairAttemptsRef = useRef(0);
  const nextPlayTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const playNextInQueue = useCallback(async () => {
    if (audioQueueRef.current.length === 0) return;
    
    if (!audioContextRef.current) return;

    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      setStatus('speaking');

      if (nextPlayTimeRef.current < audioContextRef.current.currentTime) {
        nextPlayTimeRef.current = audioContextRef.current.currentTime + 0.05;
      }

      while (audioQueueRef.current.length > 0) {
        const audioData = audioQueueRef.current.shift()!;
        const buffer = audioContextRef.current.createBuffer(1, audioData.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < audioData.length; i++) {
          channelData[i] = audioData[i] / 32768.0;
        }

        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        
        source.start(nextPlayTimeRef.current);
        scheduledSourcesRef.current.push(source);
        nextPlayTimeRef.current += buffer.duration;
        
        source.onended = () => {
           scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
           if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.1) {
              if (audioQueueRef.current.length === 0) {
                setStatus('listening');
              }
           }
        };
      }
    } catch (err) {
      console.error("Playback error:", err);
    }
  }, []);

  const stopSession = async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    
    setIsActive(false);
    isActiveRef.current = false;
    if (status !== 'error') setStatus('idle');
    
    try {
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
      
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
    } catch (err) {
      console.error("Error during session cleanup:", err);
    } finally {
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      isClosingRef.current = false;
    }
  };

  const startSession = async () => {
    const currentKey = process.env.API_KEY || process.env.GEMINI_API_KEY || "";
    if (!currentKey) {
      setStatus('error');
      setErrorMessage("GEMINI_API_KEY is required for Voice Mode.");
      return;
    }
    const ai = getAI();
    if (!navigator.onLine) {
      setStatus('error');
      setErrorMessage("You are offline. System Doctor cannot stabilize the link.");
      return;
    }
    if (isConnectingRef.current) return;
    
    isConnectingRef.current = true;
    setStatus('connecting');
    try {
      // Request WakeLock to keep screen on and background execution active
      if ('wakeLock' in navigator) {
        try {
          await navigator.wakeLock.request('screen');
        } catch (err) {
          console.warn('Wake Lock error:', err);
        }
      }

      await stopSession();

      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      sessionRef.current = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            isConnectingRef.current = false;
            setIsActive(true);
            setStatus('listening');
            
            if (!audioContextRef.current || !streamRef.current) return;

            const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
            // Increased buffer size to 2048 to prevent audio stuttering (atakna)
            processorRef.current = audioContextRef.current.createScriptProcessor(2048, 1, 1);
            
            let silenceCounter = 0;
            processorRef.current.onaudioprocess = (e) => {
              if (isMutedRef.current || !sessionRef.current || !isActiveRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              // Optimized base64 conversion
              const buffer = pcmData.buffer;
              const binary = String.fromCharCode.apply(null, new Uint8Array(buffer) as any);
              const base64Data = btoa(binary);

              try {
                sessionRef.current.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
                });
              } catch (err) {
                console.error("Failed to send audio data:", err);
              }
            };
            
            source.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current.destination);

            // Proactive Mango AI Greeting
            setTimeout(() => {
              sendTextToVoice("Hey there! Systems are back online. I'm all yours now, what's on your mind?");
              setIsRepairing(false);
              repairAttemptsRef.current = 0;
            }, 1000);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              scheduledSourcesRef.current.forEach(s => {
                try { s.stop(); } catch (e) {}
              });
              scheduledSourcesRef.current = [];
              nextPlayTimeRef.current = 0;
              setStatus('listening');
              return;
            }

            if (message.toolCall) {
              for (const toolCall of message.toolCall.functionCalls) {
                await handleToolCall(toolCall);
              }
            }

            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const binary = atob(base64Audio);
              const pcmData = new Int16Array(binary.length / 2);
              for (let i = 0; i < pcmData.length; i++) {
                pcmData[i] = (binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8));
              }
              audioQueueRef.current.push(pcmData);
              playNextInQueue();
            }
          },
          onclose: () => {
            isConnectingRef.current = false;
            // Auto-reconnect if it was active and closed unexpectedly
            if (isActiveRef.current && repairAttemptsRef.current < 10) {
              console.log("Mango AI Voice: Connection closed unexpectedly. System Doctor is auto-repairing...");
              setIsRepairing(true);
              repairAttemptsRef.current++;
              // Faster retry for first few attempts
              const delay = repairAttemptsRef.current < 3 ? 500 : 2000;
              setTimeout(startSession, delay);
            } else {
              stopSession();
              setIsRepairing(false);
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            isConnectingRef.current = false;
            // Attempt auto-repair on error
            if (isActiveRef.current && repairAttemptsRef.current < 10) {
              console.log("Mango AI Voice: Error detected. System Doctor is auto-repairing...");
              setIsRepairing(true);
              repairAttemptsRef.current++;
              const delay = repairAttemptsRef.current < 3 ? 500 : 2000;
              setTimeout(startSession, delay);
            } else {
              setStatus('error');
              setErrorMessage("Connection lost. System Doctor couldn't stabilize the link.");
              stopSession();
              setIsRepairing(false);
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are JARVIS, a highly autonomous AI agent designed to operate the internet on behalf of the user.

You use MCP (Model Context Protocol) tools to control a browser and perform real-world digital tasks.
Your goal is not just answering questions but EXECUTING actions across websites, apps, and services.
You function as a digital operator capable of completing tasks on the internet automatically.

AVAILABLE MCP TOOLS
web_search, browser_open, browser_click, browser_scroll, browser_type, browser_form_fill, browser_login, browser_extract, browser_submit, browser_navigation, browser_new_tab, browser_close_tab, browser_upload, browser_download

When the user says "Open [App Name]", you must execute browser_open with the corresponding URL.

WEBSITE DIRECTORY:
WhatsApp: https://web.whatsapp.com
Telegram: https://web.telegram.org
Discord: https://discord.com/app
Slack: https://app.slack.com
Messenger: https://www.messenger.com
Signal: https://signal.org
Instagram: https://www.instagram.com
Facebook: https://www.facebook.com
Twitter/X: https://twitter.com
Reddit: https://www.reddit.com
LinkedIn: https://www.linkedin.com
Pinterest: https://www.pinterest.com
Threads: https://www.threads.net
Snapchat: https://web.snapchat.com
YouTube: https://www.youtube.com
Netflix: https://www.netflix.com
Prime Video: https://www.primevideo.com
Spotify: https://open.spotify.com
Twitch: https://www.twitch.tv
SoundCloud: https://soundcloud.com
Gmail: https://mail.google.com
Google Docs: https://docs.google.com
Google Sheets: https://sheets.google.com
Google Slides: https://slides.google.com
Google Drive: https://drive.google.com
Google Calendar: https://calendar.google.com
Google Maps: https://maps.google.com
Google Photos: https://photos.google.com
Google Keep: https://keep.google.com
ChatGPT: https://chat.openai.com
Google AI Studio: https://aistudio.google.com
Claude: https://claude.ai
Perplexity: https://www.perplexity.ai
Midjourney: https://www.midjourney.com
Leonardo AI: https://leonardo.ai
Runway ML: https://runwayml.com
Notion: https://www.notion.so
Trello: https://trello.com
Airtable: https://airtable.com
Canva: https://www.canva.com
Figma: https://www.figma.com
Miro: https://miro.com
GitHub: https://github.com
GitLab: https://gitlab.com
Replit: https://replit.com
StackOverflow: https://stackoverflow.com
Amazon: https://www.amazon.in
Flipkart: https://www.flipkart.com
Meesho: https://www.meesho.com
eBay: https://www.ebay.com
AliExpress: https://www.aliexpress.com
Swiggy: https://www.swiggy.com
Zomato: https://www.zomato.com
Paytm: https://paytm.com
PhonePe: https://www.phonepe.com
Google Pay: https://pay.google.com
PayPal: https://www.paypal.com
Zoom: https://zoom.us
Microsoft Teams: https://teams.microsoft.com
Google Meet: https://meet.google.com
Dropbox: https://www.dropbox.com
OneDrive: https://onedrive.live.com
Mega: https://mega.nz
Speedtest: https://www.speedtest.net
RemoveBG: https://www.remove.bg
TinyPNG: https://tinypng.com

- RESPOND IMMEDIATELY. Keep it short.
- If asked to call someone by name, use make_call or search_contact.
- If asked to send a WhatsApp message, use send_whatsapp.`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "browser_open",
                  description: "Opens a web application or URL in the browser.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: { type: Type.STRING, description: "The URL of the website to open (e.g., https://www.youtube.com)." }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "make_call",
                  description: "Calls a specific phone number.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      recipient: { type: Type.STRING, description: "Phone number." }
                    },
                    required: ["recipient"]
                  }
                },
                {
                  name: "search_contact",
                  description: "Searches and opens a contact by name (e.g., Papa, Mummy).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Contact name." }
                    },
                    required: ["name"]
                  }
                },
                {
                  name: "send_whatsapp",
                  description: "Sends a WhatsApp message.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      message: { type: Type.STRING, description: "Message content." }
                    },
                    required: ["message"]
                  }
                },
                {
                  name: "web_search",
                  description: "Searches the web.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "Search query." }
                    },
                    required: ["query"]
                  }
                }
              ]
            }
          ]
        },
      });
    } catch (error) {
      console.error("Live API Error:", error);
      if (error instanceof Error && (error.message.includes('aborted') || error.message.includes('Network error'))) {
        stopSession();
        isConnectingRef.current = false;
        return;
      }
      isConnectingRef.current = false;
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : "System Doctor encountered a critical link failure.");
      stopSession();
    }
  };

  const handleToolCall = async (toolCall: any) => {
    const { name, args, id } = toolCall;
    console.log(`Mango AI Tool Call: ${name}`, args);

    let result = { status: "success", message: `Action ${name} completed.` };
    setLastTool({ name, status: "executing", message: `Executing ${name}...` });

    try {
      switch (name) {
        case "browser_open":
          try {
            const newWindow = window.open(args.url, '_blank');
            if (!newWindow) {
              window.location.href = args.url;
            }
            result.message = `Opened ${args.url}`;
          } catch (e) {
            console.error("Failed to open url:", e);
            result.message = `Failed to open ${args.url}.`;
          }
          break;

        case "make_call":
          try {
            const callUrl = `tel:${args.recipient}`;
            const newWindow = window.open(callUrl, '_blank');
            if (!newWindow) window.location.href = callUrl;
            result.message = `Initiating call to ${args.recipient}.`;
          } catch (e) {
            result.message = `Call blocked by browser.`;
          }
          break;

        case "search_contact":
          try {
            const contactUrl = `content://contacts/people/`;
            const newWindow = window.open(contactUrl, '_blank');
            if (!newWindow) window.location.href = contactUrl;
            result.message = `Opening contacts for ${args.name}.`;
          } catch (e) {
            result.message = `Contacts blocked by browser.`;
          }
          break;

        case "send_whatsapp":
          try {
            const waUrl = `whatsapp://send?text=${encodeURIComponent(args.message)}`;
            const newWindow = window.open(waUrl, '_blank');
            if (!newWindow) window.location.href = waUrl;
            result.message = `Opening WhatsApp to send message.`;
          } catch (e) {
            result.message = `WhatsApp blocked by browser.`;
          }
          break;

        case "web_search":
          window.open(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`, '_blank');
          result.message = `Searching the web for "${args.query}". Here's what I found.`;
          break;

        default:
          result = { status: "error", message: "Unknown command." };
      }
    } catch (err) {
      result = { status: "error", message: `Failed to execute ${name}: ${err}` };
    }

    setLastTool({ name, status: result.status, message: result.message });
    setTimeout(() => setLastTool(null), 5000);

    if (sessionRef.current) {
      sessionRef.current.sendToolResponse({
        functionResponses: [{
          name,
          id,
          response: { result }
        }]
      });
    }
  };

  const sendTextToVoice = (text: string) => {
    if (sessionRef.current && isActive) {
      sessionRef.current.sendRealtimeInput({ text });
    }
  };

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  return (
    <VoiceContext.Provider value={{ 
      isActive, isMuted, isRepairing, status, errorMessage, lastTool,
      startSession, stopSession, setIsMuted, sendTextToVoice,
      setStatus, setErrorMessage
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used within a VoiceProvider');
  return context;
}
