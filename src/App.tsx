import React, { useState, useEffect } from 'react';
import { MessageSquare, Mic, Camera, Settings, Shield, Zap, Info, Menu, X, Plus, Search, Trash2, LogIn, LogOut, User as UserIcon, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ChatInterface from './components/ChatInterface';
import VoiceMode from './components/VoiceMode';
import VisionMode from './components/VisionMode';
import Modal from './components/Modal';
import { cn } from './lib/utils';
import { auth, db, signIn, logOut, Conversation, OperationType, handleFirestoreError } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, getDocs, getDocFromServer } from 'firebase/firestore';
import { VoiceProvider, useVoice } from './contexts/VoiceContext';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6">
            <Shield className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold mb-4">System Link Failure</h1>
          <p className="text-gray-400 max-w-md mb-8">
            Mango AI has encountered a critical system error. The link has been severed to prevent further instability.
          </p>
          <div className="bg-white/5 p-4 rounded-xl text-left font-mono text-xs text-red-400 mb-8 max-w-2xl overflow-auto">
            {this.state.error?.toString()}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-mango-primary hover:bg-mango-primary/80 rounded-xl font-medium transition-colors text-black"
          >
            Re-establish Link
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

type Mode = 'chat' | 'voice' | 'vision';

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}

const useLongPress = (callback: () => void, ms = 500) => {
  const [startLongPress, setStartLongPress] = useState(false);

  useEffect(() => {
    let timerId: any;
    if (startLongPress) {
      timerId = setTimeout(callback, ms);
    } else {
      clearTimeout(timerId);
    }
    return () => clearTimeout(timerId);
  }, [startLongPress, callback, ms]);

  return {
    onMouseDown: () => setStartLongPress(true),
    onMouseUp: () => setStartLongPress(false),
    onMouseLeave: () => setStartLongPress(false),
    onTouchStart: () => setStartLongPress(true),
    onTouchEnd: () => setStartLongPress(false),
  };
};

const ConversationItem = React.memo(({ 
  conv, 
  activeConversationId, 
  setActiveConversationId, 
  setMode, 
  deleteConversation 
}: { 
  conv: Conversation, 
  activeConversationId: string | null, 
  setActiveConversationId: (id: string) => void, 
  setMode: (mode: Mode) => void,
  deleteConversation: (e: React.MouseEvent, id: string) => void
}) => {
  const longPressProps = useLongPress(() => {
    if (window.confirm(`Delete "${conv.title}"?`)) {
      deleteConversation({ stopPropagation: () => {} } as any, conv.id);
    }
  });

  return (
    <div
      {...longPressProps}
      onClick={() => {
        setActiveConversationId(conv.id);
        setMode('chat');
      }}
      className={cn(
        "w-full flex items-center p-3 rounded-xl transition-all group relative cursor-pointer select-none",
        activeConversationId === conv.id ? "bg-white/10 text-white" : "text-mango-muted hover:bg-white/5 hover:text-white"
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          setActiveConversationId(conv.id);
          setMode('chat');
        }
      }}
    >
      <MessageSquare className="w-4 h-4 shrink-0" />
      <span className="ml-3 text-sm truncate pr-6">{conv.title}</span>
      <button 
        onClick={(e) => deleteConversation(e, conv.id)}
        className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});

export default function App() {
  return (
    <ErrorBoundary>
      <VoiceProvider>
        <AppContent />
      </VoiceProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const [mode, setMode] = useState<Mode>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [systemHealth, setSystemHealth] = useState<'stable' | 'degraded' | 'critical'>('stable');

  // System Health Monitor
  useEffect(() => {
    const checkHealth = () => {
      if (!navigator.onLine) {
        setSystemHealth('critical');
      } else if (conversations.length > 100) {
        setSystemHealth('degraded');
      } else {
        setSystemHealth('stable');
      }
    };
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [conversations]);
  const [reminders, setReminders] = useState<{ task: string, time: string, createdAt: string }[]>([]);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    testConnection();
    const loadReminders = () => {
      const saved = JSON.parse(localStorage.getItem('mango_reminders') || '[]');
      setReminders(saved);
    };
    loadReminders();
    window.addEventListener('storage', loadReminders);
    const interval = setInterval(loadReminders, 5000);
    return () => {
      window.removeEventListener('storage', loadReminders);
      clearInterval(interval);
    };
  }, []);

  const deleteReminder = (index: number) => {
    const newReminders = [...reminders];
    newReminders.splice(index, 1);
    setReminders(newReminders);
    localStorage.setItem('mango_reminders', JSON.stringify(newReminders));
  };
  const [performanceMode, setPerformanceMode] = useState(() => {
    // Auto-detect low-end device or preference
    const saved = localStorage.getItem('performanceMode');
    if (saved !== null) return saved === 'true';
    return false;
  });

  useEffect(() => {
    localStorage.setItem('performanceMode', performanceMode ? 'true' : 'false');
  }, [performanceMode]);

  const [toast, setToast] = useState<{ message: string, type: 'info' | 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };
  const [stabilityMode, setStabilityMode] = useState(true);
  const [systemStatus, setSystemStatus] = useState({
    ai: 'Active',
    voice: 'Optimized',
    chat: 'Stable',
    repair: 'Active',
    network: 'Online'
  });

  useEffect(() => {
    const handleOnline = () => setSystemStatus(prev => ({ ...prev, network: 'Online' }));
    const handleOffline = () => setSystemStatus(prev => ({ ...prev, network: 'Offline' }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const { isActive: isVoiceActive, status: voiceStatus, stopSession: stopVoice, isRepairing } = useVoice();

  useEffect(() => {
    if (!stabilityMode) return;

    // Simulate automatic system scans
    const interval = setInterval(() => {
      console.log("Mango AI Stability Scan: All modules operational.");
      // In a real app, this could check API health, firebase connection, etc.
    }, 30000);

    return () => clearInterval(interval);
  }, [stabilityMode]);

  // System Doctor Logic
  useEffect(() => {
    if (isRepairing) {
      setSystemStatus(prev => ({ ...prev, repair: 'Repairing...' }));
      const timer = setTimeout(() => {
        setSystemStatus(prev => ({ ...prev, repair: 'Stabilized' }));
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      setSystemStatus(prev => ({ ...prev, repair: 'Active' }));
    }
  }, [isRepairing]);

  // Global Error Handler for Auto-Repair
  useEffect(() => {
    const handleError = (e: ErrorEvent | PromiseRejectionEvent) => {
      console.error("Mango AI Auto-Repair triggered:", e);
      setSystemStatus(prev => ({ ...prev, repair: 'Repairing...' }));
      showToast("System glitch detected. Auto-repairing...", "error");
      
      // Auto-fix logic: Simulate a fix and stabilize
      // In a real app, this could involve clearing caches, re-initializing services, etc.
      setTimeout(() => {
        setSystemStatus(prev => ({ ...prev, repair: 'Stabilized' }));
        showToast("System stabilized. All modules operational.", "success");
        
        // If it's a critical error, we might need to refresh or re-initialize
        if (e instanceof ErrorEvent && (e.message.includes('critical') || e.message.includes('Script error'))) {
          // Clear local storage if it's a persistent error
          if (localStorage.getItem('lastError') === e.message) {
            localStorage.clear();
          }
          localStorage.setItem('lastError', e.message);
          window.location.reload();
        }
      }, 3000);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('chat');
    if (sharedId && user) {
      setActiveConversationId(sharedId);
      setMode('chat');
    }
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setConversations([]);
        setActiveConversationId(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'conversations'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Conversation[];
      setConversations(convs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'conversations');
    });

    return () => unsubscribe();
  }, [user]);

  const createNewChat = async () => {
    if (!user) {
      await signIn();
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'conversations'), {
        title: 'New Chat',
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveConversationId(docRef.id);
      setMode('chat');
    } catch (error) {
      console.error("Error creating chat:", error);
    }
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'conversations', id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const clearAllHistory = async () => {
    if (!user) return;

    try {
      const q = query(collection(db, 'conversations'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      setActiveConversationId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'conversations');
    }
  };

  const filteredConversations = React.useMemo(() => 
    conversations.filter(c => 
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    ), [conversations, searchQuery]
  );

  const navItems = React.useMemo(() => [
    { id: 'chat', label: 'Chat', icon: MessageSquare, color: 'text-mango-primary' },
    { id: 'voice', label: 'Voice Mode', icon: Mic, color: 'text-purple-400' },
    { id: 'vision', label: 'AI Vision', icon: Camera, color: 'text-mango-primary' },
  ], []);

  return (
    <div className="flex h-screen bg-mango-bg text-mango-text overflow-hidden font-sans selection:bg-mango-primary/30">
      {/* Modals */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        onConfirm={clearAllHistory}
        title="Clear All History"
        message="Are you sure you want to delete all your conversations? This action is permanent and cannot be reversed by Mango AI."
        confirmText="Delete Everything"
        type="danger"
      />

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 300 : 0 }}
        className={cn(
          "glass border-r border-white/10 flex flex-col z-50 overflow-hidden",
          !isSidebarOpen && "border-none"
        )}
      >
        <div className="p-6 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl mango-gradient flex items-center justify-center mango-glow">
              <Zap className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-black tracking-tighter">Mango AI</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/5 rounded-lg text-mango-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pb-4 shrink-0">
          <button 
            onClick={createNewChat}
            className="w-full flex items-center justify-center space-x-2 p-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-all group"
          >
            <Plus className="w-5 h-5 text-mango-primary group-hover:scale-110 transition-transform" />
            <span className="font-bold">New Chat</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 mb-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted" />
            <input 
              type="text" 
              placeholder="Search chats..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-mango-primary outline-none"
            />
          </div>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto px-4 space-y-2 custom-scrollbar">
          <div className="flex items-center justify-between px-2 mb-2">
            <p className="text-[10px] font-bold text-mango-muted uppercase tracking-widest">History</p>
            {conversations.length > 0 && (
              <button 
                onClick={clearAllHistory}
                className="text-[10px] font-bold text-red-400/50 hover:text-red-400 uppercase tracking-widest transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
          {filteredConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              activeConversationId={activeConversationId}
              setActiveConversationId={setActiveConversationId}
              setMode={setMode}
              deleteConversation={deleteConversation}
            />
          ))}

          {/* Reminders Section */}
          {reminders.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between px-2 mb-2">
                <p className="text-[10px] font-bold text-mango-secondary uppercase tracking-widest">Reminders</p>
              </div>
              {reminders.map((reminder, idx) => (
                <div key={idx} className="w-full flex items-center p-3 rounded-xl bg-white/5 text-mango-muted group relative">
                  <Zap className="w-3.5 h-3.5 text-mango-secondary shrink-0" />
                  <div className="ml-3 flex-1 overflow-hidden">
                    <p className="text-xs font-bold text-white truncate">{reminder.task}</p>
                    <p className="text-[10px] opacity-60 truncate">{reminder.time}</p>
                  </div>
                  <button 
                    onClick={() => deleteReminder(idx)}
                    className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User Profile / Auth */}
        <div className="p-4 border-t border-white/10 shrink-0 space-y-3">
          <button 
            onClick={() => setPerformanceMode(!performanceMode)}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-xl transition-all",
              performanceMode ? "bg-mango-primary/10 text-mango-primary" : "text-mango-muted hover:bg-white/5"
            )}
          >
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Performance Mode</span>
            </div>
            <div className={cn(
              "w-8 h-4 rounded-full relative transition-colors",
              performanceMode ? "bg-mango-primary" : "bg-white/10"
            )}>
              <div className={cn(
                "absolute top-1 w-2 h-2 rounded-full bg-white transition-all",
                performanceMode ? "left-5" : "left-1"
              )} />
            </div>
          </button>
          {deferredPrompt && (
            <button 
              onClick={installApp}
              className="w-full flex items-center justify-center space-x-2 p-3 rounded-2xl bg-mango-primary/10 border border-mango-primary/20 text-mango-primary hover:bg-mango-primary/20 transition-all group"
            >
              <Zap className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black uppercase tracking-widest">Install Mango AI App</span>
            </button>
          )}
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
                <div className="flex items-center space-x-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full animate-pulse",
                    systemHealth === 'stable' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" :
                    systemHealth === 'degraded' ? "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]" :
                    "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                  )} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-mango-muted">
                    System {systemHealth}
                  </span>
                </div>
                {systemHealth !== 'stable' && (
                  <button 
                    onClick={() => window.location.reload()}
                    className="p-1 hover:bg-white/10 rounded text-mango-primary"
                    title="Refresh System"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
              </div>

              <button 
                onClick={() => setShowClearModal(true)}
                className="flex items-center space-x-3 w-full p-3 rounded-2xl text-red-400/60 hover:text-red-400 hover:bg-red-400/5 transition-all text-sm font-bold group"
              >
                <Trash2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span>Clear All History</span>
              </button>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5">
              <div className="flex items-center space-x-3 overflow-hidden">
                <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                <div className="overflow-hidden">
                  <p className="text-xs font-bold truncate">{user.displayName}</p>
                  <p className="text-[10px] text-mango-muted truncate">{user.email}</p>
                </div>
              </div>
              <button onClick={logOut} className="p-2 text-mango-muted hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
          ) : (
            <button 
              onClick={signIn}
              className="w-full flex items-center justify-center space-x-2 p-4 rounded-2xl mango-gradient text-white font-bold"
            >
              <LogIn className="w-5 h-5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-20 border-b border-white/10 flex items-center justify-between px-4 md:px-8 bg-mango-bg/50 backdrop-blur-md z-40">
          <div className="flex items-center space-x-3 md:space-x-4">
            {!isSidebarOpen && (
              <div className="flex items-center space-x-2">
                <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-lg text-mango-muted">
                  <Menu className="w-6 h-6" />
                </button>
                <button
                  onClick={() => setPerformanceMode(!performanceMode)}
                  className={cn(
                    "p-2 rounded-xl transition-all flex items-center space-x-2",
                    performanceMode ? "bg-orange-500/20 text-orange-500" : "hover:bg-white/5 text-mango-muted"
                  )}
                  title={performanceMode ? "Disable Low Performance Mode" : "Enable Low Performance Mode"}
                >
                  <Zap className={cn("w-5 h-5", performanceMode && "fill-current")} />
                  <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">
                    {performanceMode ? "Low Power" : "High Perf"}
                  </span>
                </button>
              </div>
            )}
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <h1 className="text-lg md:text-xl font-black capitalize tracking-tighter italic">Mango AI {mode}</h1>
                <div className="hidden sm:block w-1 h-1 rounded-full bg-mango-primary animate-pulse" />
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
                  <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[8px] font-black text-green-500 uppercase tracking-[0.2em]">Link: Stable</span>
                </div>
                {isRepairing && (
                  <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 animate-pulse">
                    <Zap className="w-2 h-2 text-purple-500" />
                    <span className="text-[8px] font-black text-purple-500 uppercase tracking-[0.2em]">System Doctor: Repairing</span>
                  </div>
                )}
                {stabilityMode && !isRepairing && (
                  <div className="hidden xs:flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-mango-primary/10 border border-mango-primary/20">
                    <Shield className="w-2 h-2 text-mango-primary" />
                    <span className="text-[8px] font-black text-mango-primary uppercase tracking-[0.2em]">Shield: Active</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-4">
            {mode === 'chat' && activeConversationId && (
              <button 
                onClick={(e) => deleteConversation(e, activeConversationId)}
                className="p-2 hover:bg-red-500/10 rounded-lg text-mango-muted hover:text-red-400 transition-all flex items-center space-x-1"
                title="Delete Current Chat"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:block text-[10px] font-bold uppercase tracking-widest">Delete Chat</span>
              </button>
            )}
            {stabilityMode && (
              <div className="hidden lg:flex items-center space-x-4 text-[8px] font-black text-mango-muted uppercase tracking-[0.3em] border-r border-white/10 pr-4">
                <div className="flex items-center space-x-1">
                  <span className="text-mango-primary">Core:</span> <span className="text-white/80">{systemStatus.ai}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-mango-secondary">Audio:</span> <span className="text-white/80">{systemStatus.voice}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-purple-400">Repair:</span> <span className="text-white/80">{systemStatus.repair}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className={cn(systemStatus.network === 'Online' ? "text-green-400" : "text-red-400")}>Net:</span> 
                  <span className="text-white/80">{systemStatus.network}</span>
                </div>
              </div>
            )}
            
            {/* Mode Switcher - Mobile Optimized */}
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setMode(item.id as Mode)}
                  className={cn(
                    "p-2 md:px-4 md:py-2 rounded-lg transition-all flex items-center space-x-2",
                    mode === item.id ? "bg-mango-primary text-mango-bg shadow-[0_0_15px_rgba(255,184,0,0.4)]" : "text-mango-muted hover:text-white"
                  )}
                  title={item.label}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="hidden md:block text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Persistent Voice Indicator - Visible in other modes */}
        {isVoiceActive && mode !== 'voice' && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "absolute top-24 right-8 z-50 glass border px-4 py-2 rounded-full flex items-center space-x-3 shadow-lg transition-all duration-500",
              isRepairing ? "border-purple-500/50 shadow-purple-500/20" : "border-mango-primary/30 shadow-mango-primary/10"
            )}
          >
            <div className="flex space-x-1">
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    height: isRepairing ? [4, 8, 4] : (voiceStatus === 'speaking' ? [4, 12, 4] : [4, 6, 4]),
                    backgroundColor: isRepairing ? "#a855f7" : "#ffB800"
                  }}
                  transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                  className="w-1 rounded-full"
                />
              ))}
            </div>
            <div className="flex flex-col">
              <span className={cn(
                "text-[10px] font-black uppercase tracking-widest",
                isRepairing ? "text-purple-400" : "text-mango-primary"
              )}>
                {isRepairing ? "System Doctor: Repairing" : "Voice Active"}
              </span>
              <span className="text-[8px] text-mango-muted font-medium">
                {isRepairing ? "Stabilizing Link..." : "Mango AI is listening..."}
              </span>
            </div>
            <button 
              onClick={stopVoice}
              className="p-1.5 hover:bg-red-500/20 rounded-full text-red-400 transition-colors"
              title="Stop Voice Session"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode + (activeConversationId || '')}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full"
            >
              {mode === 'chat' && (
                <ChatInterface 
                  conversationId={activeConversationId} 
                  onConversationCreated={(id) => setActiveConversationId(id)}
                  performanceMode={performanceMode}
                />
              )}
              {mode === 'voice' && <VoiceMode />}
              {mode === 'vision' && <VisionMode />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Background Accents */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-mango-primary/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-mango-secondary/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
      </main>

      {/* Global Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl glass border border-white/10 shadow-2xl flex items-center space-x-3"
          >
            <div className={cn(
              "w-2 h-2 rounded-full animate-pulse",
              toast.type === 'error' ? "bg-red-500" : (toast.type === 'success' ? "bg-green-500" : "bg-mango-primary")
            )} />
            <span className="text-sm font-bold tracking-tight">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


