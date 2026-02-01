
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { GameStatus, Spaceship, PipePair, Star, Particle, ShipDesign, ChatMessage, SpeedBooster, QuizQuestion } from './types';

// Difficulty constants (Challenging)
const GRAVITY = 0.28; 
const JUMP_FORCE = -5.2;         
const PIPE_SPAWN_INTERVAL_BASE = 1800; 
const BASE_PIPE_SPEED = 3.0; 
const BOOST_SPEED_MULTIPLIER = 4.5;
const PIPE_WIDTH = 26;           
const PIPE_GAP_MIN = 140; 
const PIPE_GAP_MAX = 190;            
const SHIP_WIDTH = 44;
const SHIP_HEIGHT = 28;

const SHIP_DESIGNS: ShipDesign[] = [
  { id: 0, name: "Sputnik-Prime", price: 0, primaryColor: "#94a3b8", secondaryColor: "#ef4444", shapeType: 'scout', features: ["Standard Navigation", "Basic Hull"], maxShields: 0, magnetPower: 0 },
  { id: 1, name: "Neon Drifter", price: 400, primaryColor: "#3b82f6", secondaryColor: "#60a5fa", shapeType: 'interceptor', features: ["Adaptive Shield v1", "Turbo Thrusters"], maxShields: 1, magnetPower: 0 },
  { id: 2, name: "Cosmic Flare", price: 900, primaryColor: "#f59e0b", secondaryColor: "#fbbf24", shapeType: 'cruiser', features: ["Magnetic Coil v1", "Solar Sails"], maxShields: 0, magnetPower: 200 },
  { id: 3, name: "Void Stalker", price: 1800, primaryColor: "#1e293b", secondaryColor: "#a855f7", shapeType: 'vanguard', features: ["Titanium Plating", "Dual-Layer Shielding"], maxShields: 2, magnetPower: 0 },
  { id: 4, name: "Solar Zenith", price: 3500, primaryColor: "#ef4444", secondaryColor: "#f97316", shapeType: 'dreadnought', features: ["Tri-Phase Shield", "Advanced Magnetics"], maxShields: 3, magnetPower: 300 },
  { id: 5, name: "Quantum Ghost", price: 7000, primaryColor: "#10b981", secondaryColor: "#34d399", shapeType: 'scout', features: ["Hyper-Shield v3", "Infinite Magnetron"], maxShields: 2, magnetPower: 600 },
];

const SUBJECTS = ["Mathematics", "Science", "English", "Social Studies", "Physics", "Chemistry", "Biology"];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const velocityTextRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<GameStatus>(GameStatus.SPLASH);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(() => parseInt(localStorage.getItem('sd_coins') || '0', 10));
  const [inventory, setInventory] = useState<number[]>(() => JSON.parse(localStorage.getItem('sd_inv') || '[0]'));
  const [selectedShipId, setSelectedShipId] = useState(() => parseInt(localStorage.getItem('sd_ship') || '0', 10));
  const [highScore, setHighScore] = useState(() => parseInt(localStorage.getItem('sd_hs') || '0', 10));
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('sd_voice') !== 'false');

  // Academy States
  const [academyMode, setAcademyMode] = useState<'HOME' | 'MOCK' | 'BOARDS' | 'QUIZ' | 'REVIEW' | 'BOARD_CONTENT' | 'BOARD_SOLVED'>('HOME');
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [boardContent, setBoardContent] = useState<{ title: string; pages: string[]; solution: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [paperScale, setPaperScale] = useState(1.0);
  const [isPaperEnlarged, setIsPaperEnlarged] = useState(false);
  
  // Timer States
  const [timerSeconds, setTimerSeconds] = useState(10800); // 3 hours
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const gameState = useRef({
    spaceship: { x: 50, y: 0, width: SHIP_WIDTH, height: SHIP_HEIGHT, velocity: 0, rotation: 0, rank: 0, shieldActive: false, magnetActive: false } as Spaceship,
    pipes: [] as PipePair[],
    stars: [] as Star[],
    fireBalls: [] as any[], 
    particles: [] as Particle[],
    speedBooster: null as SpeedBooster | null,
    isBoosting: false,
    boostPillarsBroken: 0,
    lastPipeSpawn: 0,
    currentScore: 0,
    speedMultiplier: 1,
    frameCount: 0,
    width: 0,
    height: 0,
    remainingShields: 0
  });

  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('sd_coins', coins.toString());
    localStorage.setItem('sd_inv', JSON.stringify(inventory));
    localStorage.setItem('sd_ship', selectedShipId.toString());
    localStorage.setItem('sd_hs', highScore.toString());
    localStorage.setItem('sd_voice', voiceEnabled.toString());
  }, [coins, inventory, selectedShipId, highScore, voiceEnabled]);

  // Timer Logic
  useEffect(() => {
    let interval: any;
    if (isTimerRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const initStars = (width: number, height: number) => {
    const stars: Star[] = [];
    for (let i = 0; i < 150; i++) {
      stars.push({
        x: Math.random() * width, y: Math.random() * height,
        size: Math.random() * 2, speed: Math.random() * 0.3 + 0.1,
        opacity: Math.random()
      });
    }
    gameState.current.stars = stars;
  };

  const handleResize = useCallback(() => {
    if (canvasRef.current) {
      const { innerWidth, innerHeight } = window;
      canvasRef.current.width = innerWidth;
      canvasRef.current.height = innerHeight;
      gameState.current.width = innerWidth;
      gameState.current.height = innerHeight;
      initStars(innerWidth, innerHeight);
      gameState.current.spaceship.y = innerHeight / 2;
    }
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const startGame = () => {
    setStatus(GameStatus.PLAYING);
    gameState.current.currentScore = 0;
    setScore(0);
    gameState.current.pipes = [];
    gameState.current.fireBalls = [];
    gameState.current.particles = [];
    gameState.current.spaceship.y = gameState.current.height / 2;
    gameState.current.spaceship.velocity = 0;
    gameState.current.speedMultiplier = 1;
    gameState.current.lastPipeSpawn = performance.now();
  };

  const handleJump = useCallback(() => {
    if (status === GameStatus.PLAYING) {
      gameState.current.spaceship.velocity = JUMP_FORCE;
    }
  }, [status]);

  const fetchBoardContent = async () => {
    if (!selectedClass || !selectedSubject) return;
    setIsQuizLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Act as an expert Board Exam Paper Setter for Class ${selectedClass}. Generate a highly predictable Board Mock Exam for ${selectedSubject}.
      The paper must strictly follow this structure:
      1. Section A: Objective (Multiple Choice & One Word)
      2. Section B: Short Answers
      3. Section C: Long Answers
      
      CRITICAL FORMATTING RULES:
      - Use clean text. AVOID symbols like $, *, /, @. 
      - Use "--- PAGE BREAK ---" as a marker to separate the content into 3-4 distinct logical pages.
      - Include "--- SOLUTION START ---" at the very end for a detailed solved answer key.
      - Questions must be "High Yield" based on actual Board trends.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });

      const fullText = response.text || "";
      const [mainContent, solution] = fullText.split('--- SOLUTION START ---');
      const pages = mainContent.split('--- PAGE BREAK ---').map(p => p.trim());

      setBoardContent({ 
        title: `${selectedSubject} - Class ${selectedClass} Board Mock`, 
        pages: pages,
        solution: solution || "Solution not provided."
      });
      setCurrentPage(0);
      setAcademyMode('BOARD_CONTENT');
      setIsTimerRunning(true);
      setTimerSeconds(10800); // Reset timer to 3 hours
    } catch (e) {
      console.error("Board content fetch failed", e);
    } finally {
      setIsQuizLoading(false);
    }
  };

  const update = (time: number) => {
    const { spaceship, pipes, stars, width, height, speedMultiplier } = gameState.current;
    if (status === GameStatus.PLAYING) {
      stars.forEach(star => {
        star.x -= star.speed * speedMultiplier;
        if (star.x < 0) star.x = width;
      });

      spaceship.velocity += GRAVITY;
      spaceship.y += spaceship.velocity;
      spaceship.rotation = lerp(spaceship.rotation, Math.min(Math.PI / 4, Math.max(-Math.PI / 6, spaceship.velocity * 0.1)), 0.1);
      
      // Update Velocity UI
      if (velocityTextRef.current) {
        const displayVel = (Math.abs(spaceship.velocity) * 100).toFixed(0);
        velocityTextRef.current.innerText = displayVel;
      }

      if (spaceship.y < -50 || spaceship.y + spaceship.height > height + 50) setStatus(GameStatus.GAME_OVER);

      if (time - gameState.current.lastPipeSpawn > (PIPE_SPAWN_INTERVAL_BASE / speedMultiplier)) {
        const h = Math.random() * (height - PIPE_GAP_MAX - 200) + 100;
        pipes.push({ x: width, topHeight: h, bottomY: h + PIPE_GAP_MIN, passed: false, width: PIPE_WIDTH, gap: PIPE_GAP_MIN, glow: 0 });
        gameState.current.lastPipeSpawn = time;
      }

      for (let i = 0; i < pipes.length; i++) {
        const pipe = pipes[i];
        pipe.x -= BASE_PIPE_SPEED * speedMultiplier;
        if (spaceship.x + spaceship.width > pipe.x && spaceship.x < pipe.x + pipe.width) {
          if (spaceship.y < pipe.topHeight || spaceship.y + spaceship.height > pipe.bottomY) setStatus(GameStatus.GAME_OVER);
        }
        if (!pipe.passed && pipe.x + pipe.width < spaceship.x) {
          pipe.passed = true;
          setScore(s => s + 1);
        }
      }
      if (pipes.length > 0 && pipes[0].x + pipes[0].width < -100) pipes.shift();
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const { stars, pipes, width, height } = gameState.current;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#010413'; ctx.fillRect(0, 0, width, height);
    stars.forEach(s => {
      ctx.fillStyle = `rgba(255, 255, 255, ${s.opacity})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
    });
    if (status === GameStatus.PLAYING) {
      pipes.forEach(p => {
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(p.x, 0, p.width, p.topHeight);
        ctx.fillRect(p.x, p.bottomY, p.width, height - p.bottomY);
      });
      const { spaceship } = gameState.current;
      ctx.save();
      ctx.translate(spaceship.x + SHIP_WIDTH/2, spaceship.y + SHIP_HEIGHT/2);
      ctx.rotate(spaceship.rotation);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(SHIP_WIDTH/2, 0); ctx.lineTo(-SHIP_WIDTH/2, -SHIP_HEIGHT/2); ctx.lineTo(-SHIP_WIDTH/4, 0); ctx.lineTo(-SHIP_WIDTH/2, SHIP_HEIGHT/2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  };

  const animate = (time: number) => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) { update(time); draw(ctx); }
    }
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [status]);

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden touch-none bg-slate-950 font-sans" onPointerDown={handleJump}>
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Persistent Timer - Small Top Right */}
      {(boardContent && status === GameStatus.ACADEMY && (academyMode === 'BOARD_CONTENT' || academyMode === 'BOARD_SOLVED')) && (
        <div className="absolute top-4 right-4 z-[300] flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-700 shadow-xl pointer-events-auto">
          <div className={`text-sm font-black font-mono tracking-wider ${timerSeconds < 300 ? 'text-red-500 animate-pulse' : 'text-blue-400'}`}>
            {formatTimer(timerSeconds)}
          </div>
          <button onClick={() => setIsTimerRunning(!isTimerRunning)} className={`w-6 h-6 rounded flex items-center justify-center text-white text-[10px] transition-all ${isTimerRunning ? 'bg-red-500' : 'bg-emerald-500'}`}>
            <i className={`fa-solid ${isTimerRunning ? 'fa-pause' : 'fa-play'}`}></i>
          </button>
        </div>
      )}

      {/* Main Home Screen */}
      {status === GameStatus.SPLASH && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-3xl p-6 text-center animate-fade-in">
          <div className="mb-16">
            <h1 className="text-white text-7xl font-black italic tracking-tighter mb-2 drop-shadow-2xl">STELLAR<span className="text-blue-500">EVO</span></h1>
            <p className="text-slate-500 text-xs font-black tracking-[0.5em] uppercase opacity-70">Study & Conquer the Stars</p>
          </div>
          <div className="flex flex-row gap-6 w-full max-w-2xl px-4">
            <button onClick={() => setStatus(GameStatus.READY)} className="flex-1 bg-blue-600 text-white p-10 rounded-3xl font-black text-2xl shadow-blue-500/20 shadow-2xl hover:bg-blue-500 transition-all flex flex-col items-center gap-4">
              <i className="fa-solid fa-shuttle-space text-4xl"></i>
              <span>START FLIGHT</span>
            </button>
            <button onClick={() => { setStatus(GameStatus.ACADEMY); setAcademyMode('HOME'); }} className="flex-1 bg-emerald-600 text-white p-10 rounded-3xl font-black text-2xl shadow-emerald-500/20 shadow-2xl hover:bg-emerald-500 transition-all flex flex-col items-center gap-4">
              <i className="fa-solid fa-graduation-cap text-4xl"></i>
              <span>ACADEMY</span>
            </button>
          </div>
        </div>
      )}

      {/* Academy UI */}
      {status === GameStatus.ACADEMY && (
        <div className="absolute inset-0 z-[60] bg-slate-900 flex flex-col pointer-events-auto overflow-hidden">
          <div className="p-6 bg-slate-950 border-b border-slate-800 flex justify-between items-center relative">
             <div className="flex items-center gap-4">
                <button onClick={() => setStatus(GameStatus.SPLASH)} className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-white text-xl hover:bg-slate-700 transition-colors"><i className="fa-solid fa-house"></i></button>
                <h2 className="text-white text-2xl font-black italic uppercase tracking-tighter">Stellar <span className="text-emerald-500">Academy</span></h2>
             </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col p-6">
            {academyMode === 'HOME' && (
              <div className="flex-1 flex flex-col items-center justify-center gap-8 max-w-4xl mx-auto w-full animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-full">
                  <button onClick={() => setAcademyMode('BOARDS')} className="bg-slate-800 border border-slate-700 p-12 rounded-[2rem] text-white flex flex-col items-center gap-6 group hover:border-emerald-500 transition-all hover:bg-slate-800/50">
                    <i className="fa-solid fa-book-open text-6xl text-emerald-500 group-hover:scale-110 transition-transform"></i>
                    <span className="text-2xl font-black block tracking-tighter">BOARD PREP</span>
                    <span className="text-slate-500 text-sm font-bold uppercase">Mock Exam Lab</span>
                  </button>
                  <button onClick={() => setAcademyMode('MOCK')} className="bg-slate-800 border border-slate-700 p-12 rounded-[2rem] text-white flex flex-col items-center gap-6 group hover:border-blue-500 transition-all hover:bg-slate-800/50">
                    <i className="fa-solid fa-file-circle-check text-6xl text-blue-500 group-hover:scale-110 transition-transform"></i>
                    <span className="text-2xl font-black block tracking-tighter">MOCK QUIZ</span>
                    <span className="text-slate-500 text-sm font-bold uppercase">Interactive suite</span>
                  </button>
                </div>
              </div>
            )}

            {academyMode === 'BOARDS' && (
              <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col justify-between py-10 animate-fade-in">
                <div className="flex flex-col gap-8">
                  <h3 className="text-white text-xs font-black uppercase tracking-[0.3em] opacity-50 text-center">Step 1: Choose Subject</h3>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {SUBJECTS.map(s => (
                      <button key={s} onClick={() => setSelectedSubject(s)} className={`px-8 py-4 rounded-2xl font-black text-sm transition-all border-2 active:scale-95 ${selectedSubject === s ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>{s}</button>
                    ))}
                  </div>
                </div>

                {selectedSubject && (
                  <div className="space-y-6 animate-fade-in flex flex-col items-center">
                    <h3 className="text-white text-xs font-black uppercase tracking-[0.3em] opacity-50 text-center">Step 2: Select Class</h3>
                    <div className="flex gap-10 justify-center w-full">
                      {[10, 12].map(g => (
                        <button 
                          key={g} 
                          onClick={() => setSelectedClass(g)} 
                          className={`w-48 py-10 rounded-[2.5rem] font-black text-4xl transition-all border-4 shadow-2xl active:scale-90 ${selectedClass === g ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                        >
                          {g}th
                        </button>
                      ))}
                    </div>
                    {selectedClass && (
                      <button onClick={fetchBoardContent} className="w-full max-w-md bg-white text-slate-950 py-6 rounded-3xl font-black text-xl shadow-2xl hover:bg-emerald-500 hover:text-white active:scale-[0.98] transition-all flex items-center justify-center gap-4 mt-8">
                        <i className="fa-solid fa-wand-magic-sparkles"></i> GENERATE PAPER
                      </button>
                    )}
                  </div>
                )}
                
                <div className="text-center">
                  <button onClick={() => setAcademyMode('HOME')} className="text-slate-600 hover:text-white transition-colors uppercase font-black tracking-widest text-xs">Return Home</button>
                </div>
              </div>
            )}

            {academyMode === 'BOARD_CONTENT' && boardContent && (
              <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
                <div className="flex flex-wrap justify-between items-center mb-4 px-4 gap-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setPaperScale(s => Math.max(0.5, s - 0.1))} className="w-10 h-10 bg-slate-800 text-white rounded-xl border border-slate-700 flex items-center justify-center hover:bg-slate-700"><i className="fa-solid fa-minus"></i></button>
                    <span className="text-white font-mono text-sm w-12 text-center">{Math.round(paperScale * 100)}%</span>
                    <button onClick={() => setPaperScale(s => Math.min(2.0, s + 0.1))} className="w-10 h-10 bg-slate-800 text-white rounded-xl border border-slate-700 flex items-center justify-center hover:bg-slate-700"><i className="fa-solid fa-plus"></i></button>
                  </div>
                  <div className="flex items-center gap-3">
                    <button disabled={currentPage === 0} onClick={() => setCurrentPage(p => p - 1)} className="px-6 py-2.5 bg-slate-800 text-white rounded-xl disabled:opacity-30 font-black border border-slate-700"><i className="fa-solid fa-chevron-left"></i></button>
                    <span className="text-white font-black px-4 bg-slate-950/50 py-2 rounded-xl">PAGE {currentPage + 1} / {boardContent.pages.length}</span>
                    <button disabled={currentPage === boardContent.pages.length - 1} onClick={() => setCurrentPage(p => p + 1)} className="px-6 py-2.5 bg-slate-800 text-white rounded-xl disabled:opacity-30 font-black border border-slate-700"><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                </div>

                <div className={`flex-1 flex justify-center p-6 bg-slate-950 overflow-auto custom-scrollbar relative transition-all duration-500`}>
                  <div 
                    onClick={() => setIsPaperEnlarged(true)}
                    className="relative cursor-zoom-in transition-all duration-300 transform-gpu origin-top bg-white p-12 sm:p-20 shadow-2xl border border-slate-200 min-h-[141%] w-full max-w-[850px] font-serif text-slate-900 select-text hover:shadow-emerald-500/10"
                    style={{ transform: `scale(${paperScale})` }}
                  >
                    <div className="text-center border-b-2 border-slate-900 pb-8 mb-10">
                      <h1 className="text-3xl font-black uppercase tracking-tight">{boardContent.title}</h1>
                      <div className="flex justify-between text-sm mt-4 font-sans font-black uppercase">
                        <span className="bg-slate-100 px-3 py-1 rounded">M.M: 80</span>
                        <span className="bg-slate-100 px-3 py-1 rounded text-red-600">TIME: 3 HRS</span>
                      </div>
                    </div>
                    <div className="text-2xl leading-relaxed whitespace-pre-wrap px-4">
                      {boardContent.pages[currentPage]}
                    </div>
                    <div className="absolute bottom-8 left-0 w-full text-center text-slate-300 font-sans text-[10px] font-black uppercase tracking-[0.4em]">
                      Page {currentPage + 1}
                    </div>
                  </div>
                </div>

                {isPaperEnlarged && (
                  <div className="fixed inset-0 z-[500] bg-slate-950/98 p-6 flex flex-col items-center pointer-events-auto backdrop-blur-2xl animate-fade-in">
                    <div className="w-full max-w-4xl flex justify-between items-center mb-6">
                      <div className="text-white bg-slate-900 px-6 py-3 rounded-2xl border border-slate-700 font-mono text-2xl font-black">
                        {formatTimer(timerSeconds)}
                      </div>
                      <button onClick={() => setIsPaperEnlarged(false)} className="bg-red-500 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-2xl text-2xl active:scale-90"><i className="fa-solid fa-compress"></i></button>
                    </div>
                    <div className="w-full max-w-4xl h-full bg-white p-16 rounded-[3rem] border-8 border-slate-200 overflow-y-auto text-slate-900 font-serif leading-loose whitespace-pre-wrap cursor-zoom-out shadow-2xl" onClick={() => setIsPaperEnlarged(false)}>
                      <h3 className="text-4xl font-black mb-12 uppercase text-center border-b-8 border-double border-slate-800 pb-8">{boardContent.title}</h3>
                      <div className="text-2xl px-10">{boardContent.pages[currentPage]}</div>
                    </div>
                  </div>
                )}

                <div className="p-6 bg-slate-950 border-t border-slate-800 flex justify-center gap-6">
                  <button onClick={() => setAcademyMode('BOARD_SOLVED')} className="bg-emerald-600 text-white px-12 py-5 rounded-[2.5rem] font-black shadow-xl hover:bg-emerald-500 transition-all flex items-center gap-3 text-lg uppercase tracking-widest active:scale-95">
                    <i className="fa-solid fa-check-double"></i> SOLVED PAPER
                  </button>
                </div>
              </div>
            )}

            {academyMode === 'BOARD_SOLVED' && boardContent && (
              <div className="flex-1 flex flex-col overflow-hidden animate-fade-in max-w-5xl mx-auto w-full">
                <div className="flex justify-between items-center mb-6">
                   <button onClick={() => setAcademyMode('BOARD_CONTENT')} className="text-slate-500 font-black hover:text-white transition-colors flex items-center gap-2 uppercase text-xs tracking-widest"><i className="fa-solid fa-arrow-left"></i> BACK TO EXAM</button>
                </div>
                <div className="flex-1 bg-emerald-50 border-4 border-emerald-100 p-12 rounded-[3.5rem] overflow-y-auto font-serif leading-loose text-emerald-950 shadow-inner">
                  <h3 className="text-3xl font-black mb-8 text-center border-b-4 border-emerald-300 pb-4 uppercase tracking-tighter">ANSWERS & SOLUTIONS</h3>
                  <div className="text-2xl whitespace-pre-wrap px-8 py-4 bg-emerald-100/30 rounded-3xl">
                    {boardContent.solution}
                  </div>
                </div>
                <div className="py-10 flex justify-center">
                  <button onClick={() => {setAcademyMode('HOME'); setIsTimerRunning(false);}} className="bg-slate-800 text-white px-16 py-5 rounded-full font-black shadow-2xl hover:bg-slate-700 transition-all uppercase tracking-[0.3em] active:scale-95">EXIT ACADEMY</button>
                </div>
              </div>
            )}
          </div>

          {isQuizLoading && (
            <div className="absolute inset-0 z-[200] bg-slate-950/98 backdrop-blur-2xl flex flex-col items-center justify-center animate-fade-in">
              <div className="w-28 h-28 border-[14px] border-emerald-500 border-t-transparent rounded-full animate-spin shadow-2xl shadow-emerald-500/40"></div>
              <h3 className="text-emerald-500 text-3xl font-black uppercase tracking-[0.4em] animate-pulse mt-10">SETTING PAPER</h3>
            </div>
          )}
        </div>
      )}

      {/* Gameplay HUD */}
      {status === GameStatus.PLAYING && (
        <>
          {/* Top Score */}
          <div className="absolute top-8 left-8 z-30 pointer-events-none animate-fade-in">
            <div className="text-white text-8xl font-black italic drop-shadow-2xl tracking-tighter">{score}</div>
          </div>

          {/* Bottom Left Velocity */}
          <div className="absolute bottom-8 left-8 z-30 pointer-events-none animate-fade-in flex flex-col">
            <div className="bg-slate-900/80 px-5 py-3 rounded-2xl border border-blue-500/30 flex items-center gap-3 shadow-2xl backdrop-blur-sm">
              <div className="flex flex-col">
                <span className="text-blue-500 text-[9px] font-black uppercase tracking-[0.2em] mb-0.5">Velocity</span>
                <div className="flex items-baseline gap-1">
                   <span ref={velocityTextRef} className="text-white text-3xl font-black italic tabular-nums leading-none">0</span>
                   <span className="text-blue-400 text-[10px] font-bold uppercase opacity-60">km/s</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <i className="fa-solid fa-gauge-high text-blue-500"></i>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Ready Screen */}
      {status === GameStatus.READY && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <div className="bg-slate-900/95 p-12 rounded-[4rem] border-2 border-slate-800 shadow-2xl flex flex-col items-center gap-10 max-w-md w-full">
            <button onClick={startGame} className="bg-blue-600 text-white w-full py-8 rounded-[2.5rem] font-black text-3xl shadow-blue-500/40 shadow-2xl hover:bg-blue-500 transition-all active:scale-95 uppercase tracking-widest">LAUNCH</button>
            <button onClick={() => setStatus(GameStatus.SPLASH)} className="text-slate-600 font-black uppercase tracking-[0.3em] text-xs hover:text-white transition-colors">Abort</button>
          </div>
        </div>
      )}

      {/* Game Over */}
      {status === GameStatus.GAME_OVER && (
        <div className="absolute inset-0 z-[800] flex flex-col items-center justify-center bg-red-950/98 p-10 text-center animate-fade-in backdrop-blur-3xl">
          <div className="bg-slate-950/95 p-12 rounded-[4rem] border-2 border-slate-800 shadow-2xl mb-12 w-full max-w-sm relative z-10">
             <span className="text-slate-600 font-black uppercase tracking-[0.4em] text-[10px]">Report</span>
             <p className="text-white text-[9rem] font-black mb-6 leading-none italic tracking-tighter">{score}</p>
          </div>
          <div className="flex flex-col gap-6 w-full max-w-sm relative z-10">
            <button onClick={startGame} className="bg-blue-600 text-white py-8 rounded-[3rem] font-black text-3xl hover:bg-blue-500 active:scale-95 transition-all shadow-2xl shadow-blue-500/20 tracking-widest uppercase">RE-LAUNCH</button>
            <button onClick={() => setStatus(GameStatus.SPLASH)} className="bg-slate-900 text-white py-5 rounded-[2rem] text-xs font-black uppercase tracking-[0.4em] border border-slate-800 hover:bg-slate-800 transition-all">Return Home</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 20px; border: 2px solid transparent; background-clip: content-box; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
};

export default App;
