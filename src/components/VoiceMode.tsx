import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Loader2, Phone, PhoneOff, Sparkles, X, Zap, MessageSquare, Image as ImageIcon, Send, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useVoice } from '../contexts/VoiceContext';

export default function VoiceMode() {
  const { 
    isActive, isMuted, status, errorMessage, isRepairing, lastTool,
    startSession, stopSession, setIsMuted, sendTextToVoice, setStatus, setErrorMessage 
  } = useVoice();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-12 relative overflow-hidden">
      {/* Background JARVIS Grid Effect */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(#ffB800_1px,transparent_1px)] [background-size:40px_40px]" />
      </div>

      <div className="relative">
        {/* Arc Reactor Outer Rings */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className={cn(
            "absolute -inset-8 border rounded-full border-dashed transition-colors duration-500",
            isRepairing ? "border-purple-500/40" : "border-mango-primary/20"
          )}
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className={cn(
            "absolute -inset-4 border rounded-full border-dotted transition-colors duration-500",
            isRepairing ? "border-purple-400/40" : "border-mango-secondary/20"
          )}
        />
        
        <motion.div
          animate={{
            scale: (status === 'speaking' || isRepairing) ? [1, 1.1, 1] : 1,
            opacity: (status === 'speaking' || isRepairing) ? [0.3, 0.6, 0.3] : 0.2,
            backgroundColor: isRepairing ? "#a855f7" : "#ffB800"
          }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute inset-0 rounded-full blur-3xl"
        />
        
        <div className={cn(
          "w-64 h-64 rounded-full glass flex items-center justify-center relative z-10 border-2 transition-all duration-500",
          status === 'speaking' ? "border-mango-primary mango-glow" : "border-white/10",
          status === 'listening' ? "border-mango-secondary shadow-[0_0_30px_rgba(255,184,0,0.2)]" : "",
          isRepairing ? "border-purple-500 shadow-[0_0_40px_rgba(168,85,247,0.3)]" : ""
        )}>
          {/* Inner Arc Reactor Core */}
          <div className="absolute inset-2 border border-white/5 rounded-full" />
          
          <AnimatePresence mode="wait">
            {isRepairing && (
              <motion.div
                key="repairing"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex flex-col items-center space-y-4"
              >
                <div className="relative">
                  <Zap className="w-16 h-16 text-purple-500 animate-pulse" />
                  <motion.div 
                    animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0.5, 0.2] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="absolute inset-0 blur-xl bg-purple-500/40 rounded-full"
                  />
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-purple-400 font-black text-[10px] uppercase tracking-[0.3em]">System Doctor</p>
                  <p className="text-white/80 font-bold text-xs">Auto-Repairing Link...</p>
                </div>
              </motion.div>
            )}

            {!isRepairing && status === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-4"
              >
                <div className="relative">
                  <Sparkles className="w-16 h-16 mx-auto text-mango-primary opacity-50" />
                  <motion.div 
                    animate={{ opacity: [0.2, 0.5, 0.2] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 blur-xl bg-mango-primary/30 rounded-full"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-mango-muted font-bold text-[10px] uppercase tracking-[0.3em]">Neural Link</p>
                  <p className="text-white/80 font-medium">Ready for Command</p>
                </div>
              </motion.div>
            )}
            
            {(status === 'listening' || status === 'speaking') && (
              <motion.div
                key="active"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center justify-center space-x-2"
              >
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      height: status === 'speaking' ? [15, 90, 15] : [10, 40, 10],
                      opacity: status === 'speaking' ? [0.5, 1, 0.5] : [0.3, 0.6, 0.3],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.4,
                      delay: i * 0.05,
                    }}
                    className="w-1.5 mango-gradient rounded-full"
                  />
                ))}
              </motion.div>
            )}

            {status === 'connecting' && (
              <motion.div key="connecting" className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <Loader2 className="w-12 h-12 animate-spin text-mango-primary" />
                  <div className="absolute inset-0 blur-lg bg-mango-primary/20 animate-pulse" />
                </div>
                <p className="text-mango-primary font-bold text-[10px] uppercase tracking-[0.2em]">Initializing...</p>
              </motion.div>
            )}

            {status === 'error' && (
              <motion.div key="error" className="flex flex-col items-center space-y-4 px-6 text-center">
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <X className="w-8 h-8 text-red-500" />
                </div>
                <div className="space-y-1">
                  <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest">Link Error</p>
                  <p className="text-red-400/80 text-xs">{errorMessage}</p>
                </div>
                <button 
                  onClick={() => setStatus('idle')}
                  className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
                >
                  Retry Link
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="text-center space-y-3 z-10">
        <AnimatePresence>
          {lastTool && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-center space-x-2 mb-4"
            >
              <div className={cn(
                "px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest flex items-center space-x-2",
                lastTool.status === 'executing' ? "bg-mango-primary/10 border-mango-primary/30 text-mango-primary" :
                lastTool.status === 'success' ? "bg-green-500/10 border-green-500/30 text-green-500" :
                "bg-red-500/10 border-red-500/30 text-red-500"
              )}>
                {lastTool.status === 'executing' && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>{lastTool.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center justify-center space-x-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-mango-primary animate-pulse" />
          <span className="text-[10px] font-black text-mango-primary uppercase tracking-[0.4em]">Mango AI Core</span>
        </div>
        <h2 className="text-4xl font-black tracking-tighter uppercase italic">
          {status === 'idle' ? "Standby Mode" : 
           status === 'connecting' ? "Booting System" : 
           status === 'listening' ? "Awaiting Command" : 
           status === 'speaking' ? "Transmitting" :
           "System Failure"}
        </h2>
        <p className="text-mango-muted max-w-sm mx-auto text-sm font-medium leading-relaxed">
          {status === 'idle' ? "Neural interface ready. Awaiting authorization to begin session." : 
           status === 'listening' ? "Biometric audio sensors active. Speak clearly, I'm listening." :
           status === 'speaking' ? "Processing request and transmitting response via neural link." :
           "Mango AI is ready to assist you with Jarvis-level precision."}
        </p>
      </div>

      <div className="flex items-center space-x-6">
        <button
          onClick={() => setIsMuted(!isMuted)}
          disabled={!isActive}
          className={cn(
            "p-4 rounded-2xl transition-all",
            isMuted ? "bg-red-500/20 text-red-500" : "glass text-mango-muted hover:text-mango-primary",
            !isActive && "opacity-50 cursor-not-allowed"
          )}
        >
          {isMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
        </button>

        <button
          onClick={isActive ? stopSession : startSession}
          className={cn(
            "w-20 h-20 rounded-full flex items-center justify-center transition-all mango-glow",
            isActive ? "bg-red-500 hover:bg-red-600" : "mango-gradient hover:scale-105"
          )}
        >
          {isActive ? <PhoneOff className="w-10 h-10 text-white" /> : <Phone className="w-10 h-10 text-white" />}
        </button>

        <button
          className="p-4 rounded-2xl glass text-mango-muted hover:text-mango-primary transition-all"
        >
          <Volume2 className="w-8 h-8" />
        </button>
      </div>
    </div>
  );
}
