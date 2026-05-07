import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  RotateCcw, 
  Activity,
  Send,
  Sparkles,
  ChevronDown,
  Cpu,
  Zap,
  Globe,
  Waves
} from 'lucide-react';
import { LANGUAGES, VOICES } from './constants';
import { translateText, translateAudio, generateSpeech } from './lib/gemini';

interface TranslationItem {
  id: string;
  original: string;
  translated: string;
  from: string;
  to: string;
  timestamp: number;
  type: 'text' | 'voice';
}

export default function App() {
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [mode, setMode] = useState<'translate' | 'dictate'>('translate');
  const [history, setHistory] = useState<TranslationItem[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const volumeRef = useRef<number>(0);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Typing indicator logic
  useEffect(() => {
    if (textInput.length > 0) {
      setIsTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 1500);
    } else {
      setIsTyping(false);
    }
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [textInput]);

  const startVisualizer = (stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    analyserRef.current = analyser;
    audioContextRef.current = audioContext;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        volumeRef.current = (sum / dataArray.length) / 255;
      }
      animationFrameRef.current = requestAnimationFrame(update);
    };
    update();
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          if (mode === 'dictate') {
            await handleDictation(base64);
          } else {
            await handleVoiceTranslation(base64);
          }
        };
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) audioContextRef.current.close();
      };

      mediaRecorder.start();
      setIsRecording(true);
      startVisualizer(stream);
    } catch (err) {
      setError("NEURAL SENSOR ERROR: Microphone access denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  };

  const handleDictation = async (base64: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await translateAudio(base64, "English");
      if (result && result.originalText) {
        setTextInput(prev => prev + (prev ? " " : "") + result.originalText);
      }
    } catch (err) {
      setError("DICTATION SYNC LOST.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextTranslation = async () => {
    if (!textInput.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      const translated = await translateText(textInput, sourceLang, targetLang);
      const newItem: TranslationItem = {
        id: Math.random().toString(36).substr(2, 9),
        original: textInput,
        translated,
        from: sourceLang === 'auto' ? 'Auto' : sourceLang,
        to: targetLang,
        timestamp: Date.now(),
        type: 'text'
      };
      setHistory([newItem, ...history]);
      setTextInput('');
    } catch (err) {
      setError("TEXT LINK FAILED.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVoiceTranslation = async (base64: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await translateAudio(base64, LANGUAGES.find(l => l.code === targetLang)?.name || targetLang);
      if (result) {
        const newItem: TranslationItem = {
          id: Math.random().toString(36).substr(2, 9),
          original: result.originalText,
          translated: result.translatedText,
          from: result.detectedLanguageCode || 'Auto',
          to: targetLang,
          timestamp: Date.now(),
          type: 'voice'
        };
        setHistory([newItem, ...history]);
        handleSpeak(result.translatedText);
      }
    } catch (err) {
      setError("VOCAL TRACE FAILED.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSpeak = async (text: string) => {
    try {
      const audioBase64 = await generateSpeech(text, selectedVoice as any);
      if (audioBase64) {
        const binaryString = atob(audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buffer = audioCtx.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start();
        source.onended = () => {
          setTimeout(() => audioCtx.close(), 1000);
        };
      }
    } catch (err) {
      console.error("Speech synthesis failed", err);
    }
  };

  const latestTranslation = history[0];

  return (
    <div className="min-h-screen bg-[#030303] text-slate-100 font-sans selection:bg-brand-cyan selection:text-black overflow-hidden relative">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-cyan/10 blur-[150px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-purple/10 blur-[150px] rounded-full animate-pulse [animation-delay:2s]" />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 flex flex-col min-h-screen">
        
        {/* Futuristic Header */}
        <header className="h-24 px-8 lg:px-16 flex items-center justify-between border-b border-white/5 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <div className="relative">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="w-12 h-12 border-2 border-brand-cyan/30 border-t-brand-cyan rounded-full"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu className="w-6 h-6 text-brand-cyan" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tighter text-gradient uppercase">VoxSync AI</h1>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">Kernel Active: 0.9.2-beta</span>
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-12 text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">
            {['Neural Net', 'Cloud Sync', 'Quantum Link'].map(item => (
              <motion.span 
                key={item}
                whileHover={{ textShadow: '0 0 8px rgba(0,242,255,0.5)', color: '#fff' }}
                className="cursor-pointer transition-all"
              >
                {item}
              </motion.span>
            ))}
            <div className="h-10 w-px bg-white/10" />
            <button onClick={() => setHistory([])} className="hover:text-brand-cyan transition-colors">
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content Section */}
        <main className="flex-1 flex flex-col lg:flex-row p-4 lg:p-8 gap-8 overflow-hidden">
          
          {/* Left Column: Command Center */}
          <div className="lg:w-1/2 flex flex-col gap-8">
            
            {/* Input Hub */}
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card rounded-[40px] p-8 flex flex-col gap-6 relative group"
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-brand-cyan mb-2">Input Vector</span>
                  <div className="relative">
                    <select 
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                      className="bg-white/5 text-sm font-bold outline-none appearance-none cursor-pointer px-4 py-2 border border-white/5 rounded-full pr-10 uppercase tracking-widest"
                    >
                      {LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.code} className="bg-brand-card">{lang.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div className="flex gap-2 bg-black/40 p-1 rounded-full border border-white/5">
                  {(['translate', 'dictate'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-6 py-2 rounded-full text-[10px] uppercase font-bold tracking-widest transition-all ${
                        mode === m ? 'bg-brand-cyan text-black' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative flex-1 min-h-[300px]">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={mode === 'dictate' ? "Awaiting vocal dictation..." : "Type command for sequence start..."}
                  className="w-full h-full bg-transparent p-6 text-2xl font-light text-slate-400 placeholder:text-slate-800 outline-none resize-none"
                />
                
                {/* Visualizer Overlay */}
                <AnimatePresence>
                  {isRecording && (
                    <motion.div 
                      key="viz"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-x-8 bottom-8 h-12 flex items-center justify-center gap-1"
                    >
                      {[...Array(20)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ 
                            height: [`${20 + Math.random() * 60}%`, `${10 + Math.random() * 90}%`],
                            opacity: [0.3, 1]
                          }}
                          transition={{ duration: 0.1, repeat: Infinity, repeatType: 'reverse' }}
                          className="w-1 bg-brand-cyan rounded-full shadow-[0_0_10px_rgba(0,242,255,0.5)]"
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {isTyping && !isRecording && (
                  <div className="absolute top-6 right-6 flex items-center gap-2 text-[10px] font-mono text-brand-cyan/40">
                    <Zap className="w-3 h-3 animate-pulse" />
                    NEURAL SENSING...
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 relative group/btn ${
                    isRecording 
                    ? 'bg-brand-cyan neuro-glow scale-125' 
                    : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {isRecording ? <MicOff className="w-8 h-8 text-black" /> : <Mic className="w-8 h-8 text-white" />}
                  <motion.div 
                    animate={isRecording ? { scale: [1, 1.4], opacity: [0.5, 0] } : {}}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute inset-0 rounded-full border-2 border-brand-cyan"
                  />
                </button>

                <div className="flex gap-4">
                  <button 
                    onClick={handleTextTranslation}
                    disabled={isProcessing || !textInput.trim()}
                    className="h-16 px-10 rounded-full bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan font-bold uppercase tracking-widest text-[10px] hover:bg-brand-cyan hover:text-black transition-all flex items-center gap-3 disabled:opacity-20"
                  >
                    <Send className="w-4 h-4" />
                    Engage Neural Link
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Status Feedback */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl flex items-center gap-4 text-red-400 text-[10px] font-bold uppercase tracking-widest"
                >
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: Processing & Results */}
          <div className="lg:w-1/2 flex flex-col gap-8">
            
            {/* Main Result Panel */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card rounded-[40px] p-10 flex flex-col flex-1 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-10 opacity-5">
                <Globe className="w-64 h-64 text-white" />
              </div>

              <div className="flex items-center justify-between mb-12 relative z-10">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-brand-purple mb-2">Synthesis Layer</span>
                  <div className="relative">
                    <select 
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="bg-white/5 text-sm font-bold outline-none appearance-none cursor-pointer px-4 py-2 border border-white/5 rounded-full pr-10 uppercase tracking-widest text-white"
                    >
                      {LANGUAGES.filter(l => l.code !== 'auto').map(lang => (
                        <option key={lang.code} value={lang.code} className="bg-brand-card">{lang.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">Vocal Profile</span>
                  <select 
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="bg-transparent text-[10px] font-bold tracking-widest outline-none appearance-none cursor-pointer text-brand-cyan text-right uppercase"
                  >
                    {VOICES.map(voice => (
                      <option key={voice.id} value={voice.id} className="bg-brand-card">{voice.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center relative z-10">
                <AnimatePresence mode="wait">
                  {latestTranslation ? (
                    <motion.div
                      key={latestTranslation.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      transition={{ type: 'spring', damping: 20 }}
                      className="space-y-8"
                    >
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase font-mono text-slate-600 tracking-[0.3em]">Temporal Frame: {latestTranslation.from.toUpperCase()} ➔ {latestTranslation.to.toUpperCase()}</p>
                        <p className="text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-white italic">
                          "{latestTranslation.translated}"
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <button
                          onClick={() => handleSpeak(latestTranslation.translated)}
                          className="w-16 h-16 rounded-full bg-brand-purple/20 border border-brand-purple/40 flex items-center justify-center hover:bg-brand-purple hover:scale-110 transition-all group"
                        >
                          <Volume2 className="w-6 h-6 text-white group-hover:scale-125 transition-transform" />
                        </button>
                        <div className="h-[2px] flex-1 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 0.5 }}
                            className="h-full bg-gradient-to-r from-brand-cyan to-brand-purple"
                          />
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="text-center space-y-4 opacity-20">
                      <div className="w-20 h-20 mx-auto border-4 border-dashed border-white/20 rounded-full animate-spin [animation-duration:8s]" />
                      <p className="text-sm uppercase tracking-[0.5em] font-bold">Awaiting Stream</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mini History Stream */}
              <div className="mt-12 pt-8 border-t border-white/5 grid grid-cols-3 gap-4">
                {history.slice(1, 4).map((item) => (
                  <motion.div 
                    key={item.id}
                    whileHover={{ scale: 1.05, border: '1px solid rgba(0,242,255,0.2)' }}
                    className="p-4 bg-white/5 rounded-2xl border border-transparent transition-all cursor-pointer truncate"
                  >
                    <span className="text-[8px] font-bold uppercase tracking-tighter text-slate-600 truncate block mb-1">{item.translated}</span>
                    <div className="flex items-center justify-between text-[8px] font-mono text-slate-500">
                      <span>{item.from}</span>
                      <Activity className="w-2 h-2 text-brand-cyan" />
                      <span>{item.to}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </main>

        {/* Global Footer Overlay */}
        <footer className="h-20 lg:h-24 px-8 lg:px-16 flex items-center border-t border-white/5 bg-black/40 backdrop-blur-3xl sticky bottom-0 z-50">
          <div className="flex items-center gap-10 flex-1 overflow-x-auto scrollbar-hide">
             <div className="flex flex-col min-w-[120px]">
                <span className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Latency Layer</span>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_5px_rgba(0,242,255,0.8)]" />
                  <span className="text-xs font-bold text-white">42ms QUANTUM</span>
                </div>
             </div>
             <div className="flex flex-col min-w-[150px]">
                <span className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Vocal Fidelity</span>
                <span className="text-xs font-bold text-slate-300">LO-LATENCY CLONE</span>
             </div>
             <div className="flex flex-col min-w-[120px]">
                <span className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Neural Load</span>
                <div className="h-1 w-24 bg-white/10 rounded-full mt-2 overflow-hidden">
                  <motion.div 
                    animate={{ width: ['20%', '45%', '30%'] }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="h-full bg-brand-cyan"
                  />
                </div>
             </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="h-12 w-12 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors">
              <Sparkles className="w-4 h-4 text-brand-cyan" />
            </button>
            <div className="h-12 px-8 rounded-full bg-white text-black text-[10px] uppercase font-extrabold tracking-[0.2em] hover:bg-brand-cyan transition-all cursor-pointer flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.1)]">
              Live Broadcast
            </div>
          </div>
        </footer>
      </div>

      {/* Processing Portal */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative flex flex-col items-center gap-8">
              <div className="relative">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="w-32 h-32 border-b-4 border-brand-cyan rounded-full"
                />
                <motion.div 
                  animate={{ rotate: -360 }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-2 border-r-4 border-brand-purple rounded-full opacity-60"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Activity className="w-8 h-8 text-white animate-pulse" />
                </div>
              </div>
              <motion.span 
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-[10px] uppercase font-bold tracking-[0.5em] text-white"
              >
                Syncing Neural Threads
              </motion.span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
