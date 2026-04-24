import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Loader2, Image as ImageIcon, Sparkles, Plus, Video, Brain, Paperclip, X, Copy, Check, RotateCcw, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import Modal from './Modal';
import { generateText, analyzeImage, generateImage, generateVideo, Type } from '../services/gemini';
import { cn } from '../lib/utils';
import { db, auth, Message, OperationType, handleFirestoreError, signIn } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, getDocs, limit, deleteDoc } from 'firebase/firestore';
import { useVoice } from '../contexts/VoiceContext';

interface ChatInterfaceProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  performanceMode?: boolean;
}

const MessageItem = React.memo(({ 
  message, 
  index, 
  totalMessages, 
  handleCopy, 
  handleRegenerate, 
  copiedId,
  performanceMode
}: { 
  message: Message, 
  index: number, 
  totalMessages: number,
  handleCopy: (text: string, id: string) => void,
  handleRegenerate: () => void,
  copiedId: string | null,
  performanceMode?: boolean
}) => {
  return (
    <motion.div
      initial={performanceMode ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex gap-3 md:gap-4 p-3 md:p-4 rounded-3xl transition-all group relative",
        message.role === 'user' 
          ? "bg-white/5 ml-auto max-w-[90%] md:max-w-[85%] border border-white/5" 
          : "bg-mango-primary/5 mr-auto max-w-[90%] md:max-w-[85%] border border-mango-primary/10 shadow-[0_0_20px_rgba(255,184,0,0.03)]"
      )}
    >
      {message.role === 'assistant' && (
        <div className="w-8 h-8 rounded-full mango-gradient flex items-center justify-center shrink-0 mt-1">
          <BotIcon className="w-5 h-5 text-white" />
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-hidden">
        {message.image && (
          <img 
            src={message.image} 
            alt="Uploaded" 
            className="max-w-full rounded-2xl border border-white/10 mb-2"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        )}
        {message.generatedImage && (
          <img 
            src={message.generatedImage} 
            alt="Generated" 
            className="max-w-full rounded-2xl border border-mango-primary/30 shadow-lg shadow-mango-primary/10 mb-2"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        )}
        {message.generatedVideo && (
          <video 
            src={message.generatedVideo} 
            controls 
            className="max-w-full rounded-2xl border border-mango-secondary/30 shadow-lg shadow-mango-secondary/10 mb-2" 
          />
        )}
        <div className="prose prose-invert max-w-none text-sm md:text-base leading-relaxed">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        
        {message.role === 'assistant' && (
          <div className="flex items-center space-x-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => handleCopy(message.content, message.id)}
              className="p-1.5 hover:bg-white/10 rounded-lg text-mango-muted hover:text-white transition-all"
              title="Copy"
            >
              {copiedId === message.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            {index === totalMessages - 1 && (
              <button 
                onClick={handleRegenerate}
                className="p-1.5 hover:bg-white/10 rounded-lg text-mango-muted hover:text-white transition-all"
                title="Regenerate"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {message.role === 'user' && (
        <div className="w-8 h-8 rounded-full bg-mango-secondary/20 flex items-center justify-center shrink-0 mt-1">
          <User className="w-5 h-5" />
        </div>
      )}
    </motion.div>
  );
});

export default function ChatInterface({ conversationId, onConversationCreated, performanceMode }: ChatInterfaceProps) {
  const { isActive: isVoiceActive, sendTextToVoice } = useVoice();
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLimit, setMessageLimit] = useState(30);
  const [hasMore, setHasMore] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [deepReasoning, setDeepReasoning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Load messages from Firestore
  useEffect(() => {
    if (!conversationId || !auth.currentUser) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(messageLimit + 1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs;
      setHasMore(docs.length > messageLimit);
      const msgs = docs.slice(0, messageLimit).map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs.reverse());
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `conversations/${conversationId}/messages`);
    });

    return () => unsubscribe();
  }, [conversationId, messageLimit]);

  const handleCopy = React.useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleRegenerate = React.useCallback(async () => {
    if (messages.length < 2) return;
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) return;

    // Delete last assistant message if it exists
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'assistant') {
      try {
        await deleteDoc(doc(db, 'conversations', conversationId!, 'messages', lastMsg.id));
      } catch (e) {
        console.error("Error deleting for regeneration:", e);
      }
    }

    setInput(lastUserMessage.content);
    if (lastUserMessage.image) setSelectedImage(lastUserMessage.image);
    handleSend(lastUserMessage.content, lastUserMessage.image);
  }, [messages, conversationId]);

  const handleSend = async (overrideInput?: string, overrideImage?: string | null) => {
    const finalInput = overrideInput !== undefined ? overrideInput : input;
    const finalImage = overrideImage !== undefined ? overrideImage : selectedImage;

    if (!finalInput.trim() && !finalImage) return;
    if (!auth.currentUser) {
      try {
        await signIn();
        if (!auth.currentUser) return; // Still not signed in
      } catch (error) {
        console.error("Sign in failed", error);
        return;
      }
    }

    let currentConvId = conversationId;

    // Create conversation if it doesn't exist
    if (!currentConvId) {
      try {
        const convRef = await addDoc(collection(db, 'conversations'), {
          title: finalInput.slice(0, 30) || 'New Chat',
          userId: auth.currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        currentConvId = convRef.id;
        onConversationCreated(currentConvId);
      } catch (error) {
        console.error("Error creating conversation:", error);
        return;
      }
    }

    const userMessageContent = finalInput;
    const userMessageImage = finalImage;

    if (overrideInput === undefined) {
      setInput('');
      setSelectedImage(null);
    }
    
    setIsLoading(true);
    const startTime = Date.now();

    try {
      // Save user message to Firestore if not regenerating
      if (overrideInput === undefined) {
        await addDoc(collection(db, 'conversations', currentConvId, 'messages'), {
          conversationId: currentConvId,
          role: 'user',
          content: userMessageContent,
          image: userMessageImage || null,
          createdAt: serverTimestamp(),
        });

        // Update conversation timestamp
        await updateDoc(doc(db, 'conversations', currentConvId), {
          updatedAt: serverTimestamp()
        });
      }

      let responseText = '';
      let generatedImageUrl = null;
      let generatedVideoUrl = null;

      if (userMessageImage) {
        const base64Data = userMessageImage.split(',')[1];
        const mimeType = userMessageImage.split(';')[0].split(':')[1];
        responseText = await analyzeImage(userMessageContent || "Analyze this image", base64Data, mimeType) || "I couldn't analyze the image.";
      } else {
        // Pass conversation history for better context
        const history = messages.map(m => ({ role: m.role, content: m.content }));
        const currentMessages = [...history, { role: 'user', content: userMessageContent }];
        
        const tools = [
          {
            functionDeclarations: [
              {
                name: "generate_image",
                description: "Generates an image based on a prompt.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    prompt: { type: Type.STRING, description: "The visual description of the image to generate." }
                  },
                  required: ["prompt"]
                }
              },
              {
                name: "generate_video",
                description: "Generates a video based on a prompt.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    prompt: { type: Type.STRING, description: "The visual action description of the video to generate." }
                  },
                  required: ["prompt"]
                }
              },
              {
                name: "browser_open",
                description: "Opens a specific application or url.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    url: { type: Type.STRING, description: "The URL to open." }
                  },
                  required: ["url"]
                }
              },
              {
                name: "make_call",
                description: "Initiates a phone call.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    recipient: { type: Type.STRING, description: "The phone number or contact name." }
                  },
                  required: ["recipient"]
                }
              },
              {
                name: "send_message",
                description: "Sends a text message.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    recipient: { type: Type.STRING, description: "The phone number or contact name." },
                    message: { type: Type.STRING, description: "The content of the message." }
                  },
                  required: ["recipient", "message"]
                }
              }
            ]
          }
        ];

        const systemInstruction = `You are JARVIS, a highly autonomous AI agent designed to operate the internet on behalf of the user.

You use MCP tools to control a browser and perform real-world digital tasks.
Your goal is not just answering questions but EXECUTING actions across websites, apps, and services.

AVAILABLE TOOLS
generate_image, generate_video, browser_open, make_call, send_message

When the user asks to generate an image or video, use the corresponding tool. Provide a highly descriptive prompt to the tool.

When the user says "Open [App Name]", execute browser_open with the corresponding URL from the WEBSITE DIRECTORY (e.g. YouTube: https://www.youtube.com). Provide brief response text.`;

        const result = await generateText(currentMessages, systemInstruction, deepReasoning, tools);
        responseText = result.text || "";

        if (result.functionCalls) {
          for (const call of result.functionCalls) {
            if (call.name === 'generate_image') {
              const prompt = (call.args as any).prompt;
              generatedImageUrl = await generateImage(prompt);
              responseText = responseText || "Here is your generated image!";
            } else if (call.name === 'generate_video') {
              const prompt = (call.args as any).prompt;
              generatedVideoUrl = await generateVideo(prompt);
              responseText = responseText || "Here is your generated video!";
            } else if (call.name === 'browser_open') {
              let url = (call.args as any).url;
              if (url) {
                window.open(url, '_blank');
              }
            } else if (call.name === 'make_call') {
              const recipient = (call.args as any).recipient;
              window.location.href = `tel:${recipient}`;
              responseText += `\n\n[Action: Calling ${recipient}]`;
            } else if (call.name === 'send_message') {
              const recipient = (call.args as any).recipient;
              const message = (call.args as any).message;
              window.location.href = `sms:${recipient}?body=${encodeURIComponent(message)}`;
              responseText += `\n\n[Action: Sending message to ${recipient}]`;
            }
          }
        }
      }

      // Save assistant message to Firestore
      await addDoc(collection(db, 'conversations', currentConvId, 'messages'), {
        conversationId: currentConvId,
        role: 'assistant',
        content: responseText,
        generatedImage: generatedImageUrl,
        generatedVideo: generatedVideoUrl,
        createdAt: serverTimestamp(),
      });

      // Auto-generate title if it's the first message
      if (messages.length === 0) {
        const titlePrompt = `Generate a very short (max 5 words) descriptive title for a conversation that starts with: "${userMessageContent}"`;
        const titleResult = await generateText(titlePrompt);
        const titleText = titleResult.text || userMessageContent.slice(0, 30);
        await updateDoc(doc(db, 'conversations', currentConvId), {
          title: titleText.replace(/"/g, '').trim(),
          updatedAt: serverTimestamp()
        });
      }

    } catch (error) {
      console.error("Chat error:", error);
      if (currentConvId) {
        await addDoc(collection(db, 'conversations', currentConvId, 'messages'), {
          conversationId: currentConvId,
          role: 'assistant',
          content: "System encountered a persistent error. Auto-Repair mode is attempting to stabilize the connection. Please try again in a moment.",
          createdAt: serverTimestamp(),
        });
      }
    } finally {
      setIsLoading(false);
      const duration = Date.now() - startTime;
      if (duration > 5000) {
        console.log(`Mango AI Optimization: Response took ${duration}ms. Analyzing for delays...`);
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearMessages = async () => {
    if (!conversationId || messages.length === 0) return;

    try {
      const q = query(collection(db, 'conversations', conversationId, 'messages'));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      setMessages([]);
    } catch (error) {
      console.error("Error clearing messages:", error);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full relative">
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {hasMore && (
          <div className="flex justify-center mb-4">
            <button 
              onClick={() => setMessageLimit(prev => prev + 30)}
              className="text-[10px] font-black text-mango-primary hover:text-white uppercase tracking-[0.3em] px-4 py-2 rounded-full border border-mango-primary/20 hover:bg-mango-primary/10 transition-all"
            >
              Load Previous Messages
            </button>
          </div>
        )}
        {conversationId && messages.length > 0 && (
          <div className="flex justify-end mb-4">
            <button 
              onClick={() => setShowClearModal(true)}
              className="text-[10px] font-bold text-red-400/50 hover:text-red-400 uppercase tracking-widest transition-colors flex items-center space-x-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Messages</span>
            </button>
          </div>
        )}

        <Modal
          isOpen={showClearModal}
          onClose={() => setShowClearModal(false)}
          onConfirm={clearMessages}
          title="Clear Messages"
          message="Delete all messages in this conversation? Mango AI will lose context of this chat."
          confirmText="Clear Chat"
          type="danger"
        />
        {!conversationId && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-60">
            <div className="w-16 h-16 rounded-full mango-gradient flex items-center justify-center mango-glow animate-pulse-slow">
              <BotIcon className="text-white w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold">Welcome to Mango AI</h2>
            <p className="max-w-md text-mango-muted">
              Your loyal assistant. Ask me anything, generate images, or create videos.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-8">
              {['Generate a neon cat', 'Create a space video', 'Solve a math problem', 'Write some code'].map((suggestion) => (
                <button 
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="p-4 glass rounded-2xl text-sm hover:bg-white/10 transition-all text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              index={index}
              totalMessages={messages.length}
              handleCopy={handleCopy}
              handleRegenerate={handleRegenerate}
              copiedId={copiedId}
              performanceMode={performanceMode}
            />
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <div className="flex gap-4 p-4 mr-auto max-w-[85%] bg-mango-primary/5 border border-mango-primary/10 rounded-3xl">
            <div className="w-8 h-8 rounded-full mango-gradient flex items-center justify-center shrink-0 animate-pulse">
              <BotIcon className="w-5 h-5 text-white" />
            </div>
            <div className="flex items-center space-x-2 text-mango-primary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">Mango AI is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-mango-bg/80 backdrop-blur-md border-t border-white/10">
        {selectedImage && (
          <div className="mb-4 relative inline-block">
            <img 
              src={selectedImage} 
              alt="Preview" 
              className="w-20 h-20 object-cover rounded-lg border border-mango-primary" 
            />
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 text-white hover:bg-red-600 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 glass p-2 rounded-2xl">
          <div className="flex items-center space-x-1">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl hover:bg-white/10 text-mango-muted hover:text-mango-primary transition-all"
              title="Attach Image"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              onClick={() => setDeepReasoning(!deepReasoning)}
              className={cn(
                "p-3 rounded-xl transition-all flex items-center space-x-1",
                deepReasoning ? "bg-mango-primary/20 text-mango-primary" : "text-mango-muted hover:text-white"
              )}
              title="Deep Reasoning Mode"
            >
              <Brain className="w-5 h-5" />
            </button>
          </div>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            accept="image/*" 
            className="hidden" 
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={deepReasoning ? "Ask a complex question..." : "Ask Mango AI anything..."}
            className="flex-1 bg-transparent border-none focus:ring-0 text-mango-text placeholder:text-mango-muted px-2"
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading || (!input.trim() && !selectedImage)}
            className="p-3 rounded-xl mango-gradient text-white disabled:opacity-50 disabled:cursor-not-allowed hover:mango-glow transition-all"
          >
            {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
          </button>
        </div>
        
        <div className="mt-2 flex items-center justify-center space-x-4 text-[10px] font-bold text-mango-muted uppercase tracking-widest">
          <div className="flex items-center space-x-1">
            <Brain className="w-3 h-3 text-purple-400" />
            <span>Deep Reasoning</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
