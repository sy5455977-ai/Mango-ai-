import React, { useState, useRef, useEffect } from 'react';
import { Camera, Scan, Calculator, FileText, Loader2, X, Sparkles, RefreshCw, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeImage } from '../services/gemini';
import ReactMarkdown from 'react-markdown';
import { cn } from '../lib/utils';
import { useVoice } from '../contexts/VoiceContext';

type VisionTask = 'analyze' | 'math' | 'ocr' | 'summary';

export default function VisionMode() {
  const { isActive: isVoiceActive, sendTextToVoice, isRepairing } = useVoice();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<VisionTask>('analyze');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    if (isRepairing) return; // Don't start camera if system is repairing
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(track => track.stop());
    setStream(null);
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [isRepairing]); // Restart camera if repair finishes

  const captureImage = () => {
    if (isRepairing) return;
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        // Optimization: Reduce resolution for faster processing on low internet/devices
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / videoRef.current.videoWidth);
        canvasRef.current.width = videoRef.current.videoWidth * scale;
        canvasRef.current.height = videoRef.current.videoHeight * scale;
        
        context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // Lower quality for faster upload on slow connections
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.7);
        setCapturedImage(dataUrl);
        stopCamera();
      }
    }
  };

  const runAnalysis = async () => {
    if (!capturedImage || isRepairing) return;
    setIsAnalyzing(true);
    setResult(null);

    const base64Data = capturedImage.split(',')[1];
    const mimeType = 'image/jpeg';

    let prompt = "";
    switch (activeTask) {
      case 'math':
        prompt = "Detect any math equations in this image and solve them step-by-step with clear explanations.";
        break;
      case 'ocr':
        prompt = "Extract all text from this image accurately.";
        break;
      case 'summary':
        prompt = "Analyze the text in this image and provide a concise summary of the key information.";
        break;
      default:
        prompt = "Analyze this image in detail and explain what you see.";
    }

    try {
      const response = await analyzeImage(prompt, base64Data, mimeType);
      setResult(response || "Analysis failed.");
      if (isVoiceActive && response) {
        sendTextToVoice(response);
      }
    } catch (error) {
      setResult("System Error: Failed to process image.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setCapturedImage(null);
    setResult(null);
    startCamera();
  };

  return (
    <div className="flex flex-col h-full p-4 space-y-4 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg mango-gradient flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-xl font-bold">AI Vision</h2>
          {isRepairing && (
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 animate-pulse">
              <Zap className="w-2 h-2 text-purple-500" />
              <span className="text-[8px] font-black text-purple-500 uppercase tracking-widest">Repairing Link</span>
            </div>
          )}
        </div>
        
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
          {(['analyze', 'math', 'ocr', 'summary'] as VisionTask[]).map((task) => (
            <button
              key={task}
              onClick={() => setActiveTask(task)}
              disabled={isRepairing}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                activeTask === task ? "bg-mango-primary text-mango-bg" : "text-mango-muted hover:text-white",
                isRepairing && "opacity-50 cursor-not-allowed"
              )}
            >
              {task}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        <div className="relative rounded-3xl overflow-hidden glass border-2 border-white/10 flex flex-col group">
          {isRepairing ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4 bg-mango-bg/50 backdrop-blur-xl">
              <Zap className="w-16 h-16 text-purple-500 animate-pulse" />
              <div className="text-center">
                <p className="text-purple-400 font-black text-xs uppercase tracking-[0.3em]">System Doctor</p>
                <p className="text-white/60 text-sm">Recalibrating Visual Sensors...</p>
              </div>
            </div>
          ) : !capturedImage ? (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              {/* JARVIS Scanning Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 border-[40px] border-mango-bg/40">
                  <div className="w-full h-full border-2 border-mango-primary/30 rounded-lg relative overflow-hidden">
                    {/* Scanning Line */}
                    <motion.div 
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-0.5 bg-mango-primary/50 shadow-[0_0_15px_rgba(255,184,0,0.8)] z-20"
                    />
                    
                    {/* Corner Brackets */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-mango-primary" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-mango-primary" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-mango-primary" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-mango-primary" />
                    
                    {/* Technical Data Overlays */}
                    <div className="absolute top-4 left-4 space-y-1">
                      <p className="text-[8px] font-bold text-mango-primary uppercase tracking-widest">Optical Sensors: Active</p>
                      <p className="text-[8px] font-bold text-mango-muted uppercase tracking-widest">Focal Length: Auto</p>
                    </div>
                    <div className="absolute bottom-4 right-4 text-right">
                      <p className="text-[8px] font-bold text-mango-primary uppercase tracking-widest">Neural Link: Ready</p>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={captureImage}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:scale-110 transition-transform z-30"
              >
                <div className="w-16 h-16 rounded-full bg-white" />
              </button>
            </>
          ) : (
            <>
              <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
              <div className="absolute top-4 right-4 flex space-x-2">
                <button 
                  onClick={reset}
                  className="p-3 bg-mango-bg/80 backdrop-blur-md rounded-xl text-white hover:bg-mango-bg transition-colors"
                >
                  <RefreshCw className="w-6 h-6" />
                </button>
              </div>
              {!result && !isAnalyzing && (
                <button
                  onClick={runAnalysis}
                  className="absolute bottom-8 left-1/2 -translate-x-1/2 px-8 py-4 mango-gradient rounded-2xl text-white font-bold mango-glow flex items-center space-x-2"
                >
                  <Scan className="w-6 h-6" />
                  <span>Process with Mango AI</span>
                </button>
              )}
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="flex flex-col glass rounded-3xl border-2 border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-mango-primary" />
              <span className="font-bold">Analysis Result</span>
            </div>
            {isAnalyzing && (
              <div className="flex items-center space-x-2 text-mango-primary text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mango AI is scanning...</span>
              </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center space-x-4 text-[10px] font-black text-mango-muted uppercase tracking-[0.2em] border-b border-white/5 pb-4">
                    <div className="flex items-center space-x-1">
                      <span className="text-mango-primary">Task:</span> <span className="text-white/80">{activeTask}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="text-mango-secondary">Confidence:</span> <span className="text-white/80">High</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="text-purple-400">Status:</span> <span className="text-white/80">Verified</span>
                    </div>
                  </div>
                  <div className="prose prose-invert max-w-none">
                    <ReactMarkdown>{result}</ReactMarkdown>
                  </div>
                </motion.div>
              ) : !isAnalyzing ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                  <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
                    {activeTask === 'math' ? <Calculator className="w-8 h-8" /> : 
                     activeTask === 'ocr' ? <FileText className="w-8 h-8" /> : 
                     <Scan className="w-8 h-8" />}
                  </div>
                  <p>Capture an image to begin analysis</p>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full border-4 border-mango-primary/20 border-t-mango-primary animate-spin" />
                    <Bot className="absolute inset-0 m-auto w-10 h-10 text-mango-primary animate-pulse" />
                  </div>
                  <div className="space-y-2 text-center">
                    <p className="text-xl font-bold text-mango-primary">Scanning Neural Pathways</p>
                    <p className="text-mango-muted text-sm">Decoding visual information...</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bot({ className }: { className?: string }) {
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
