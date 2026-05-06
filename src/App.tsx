/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Delete, Divide, Minus, Plus, X, Equal, RotateCcw, 
  Sun, Moon, History, Trash2, Copy, Check, 
  Pencil, Keyboard, Eraser, Sparkles, Loader2,
  Undo2, Redo2, Palette, Type, Circle, Save, Image as ImageIcon, Download, XCircle, 
  Feather, Cloud, Highlighter, ZoomIn, ZoomOut, Move, Target, RefreshCw, Menu
} from 'lucide-react';
import { evaluate } from 'mathjs';
import { GoogleGenAI } from "@google/genai";

let aiClient: any = null;

const getAI = () => {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined. Please set it in the Secrets/Settings menu or .env file.');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
};

const STORAGE_KEY = 'stellar_calc_gallery';

interface SavedSketch {
  id: string;
  dataUrl: string;
  createdAt: number;
}

const COLORS = [
  '#FFFFFF', // White
  '#000000', // Black
  '#F87171', // Red
  '#FB923C', // Orange
  '#FACC15', // Yellow
  '#4ADE80', // Green
  '#60A5FA', // Blue
  '#C084FC', // Purple
];

const BG_COLORS = [
  { name: 'Pitch Black', value: '#000000' },
  { name: 'Pure White', value: '#FFFFFF' },
  { name: 'Midnight', value: '#0F172A' },
];

type Theme = 'dark' | 'light';
type Mode = 'sketch' | 'keypad';
type BrushStyle = 'pen' | 'charcoal' | 'spray' | 'marker';

const vibrate = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(5);
  }
};

const ToolbarButton = ({ 
  onClick, 
  icon, 
  title = "", 
  disabled = false, 
  isActive = false 
}: { 
  onClick: () => void; 
  icon: React.ReactNode; 
  title?: string;
  disabled?: boolean;
  isActive?: boolean;
}) => (
  <motion.button
    title={title}
    whileHover={!disabled ? { scale: 1.1 } : {}}
    whileTap={!disabled ? { scale: 0.95 } : {}}
    onClick={() => { if (!disabled) { vibrate(); onClick(); } }}
    disabled={disabled}
    className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 ${
      disabled ? 'opacity-30 cursor-not-allowed' : 
      isActive ? 'bg-emerald-500/10 text-emerald-500 shadow-inner' :
      'text-zinc-500 hover:bg-zinc-500/10 hover:text-white'
    }`}
  >
    {icon}
  </motion.button>
);

export default function App() {
  const [display, setDisplay] = useState('0');
  const [isWaitingForNext, setIsWaitingForNext] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [bgColor, setBgColor] = useState('#000000');
  const [mode, setMode] = useState<Mode>('sketch');
  const [memory, setMemory] = useState<number>(0);
  const [history, setHistory] = useState<{ id: string; expression: string; result: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState(false);

  // Drawing State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<{ x: number, y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#FFFFFF');
  const [isEraser, setIsEraser] = useState(false);
  const [brushStyle, setBrushStyle] = useState<BrushStyle>('pen');
  const [brushSize, setBrushSize] = useState(4);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showBrushPicker, setShowBrushPicker] = useState(false);
  const [savedSketches, setSavedSketches] = useState<SavedSketch[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showMobileCalc, setShowMobileCalc] = useState(false);

  // Zoom & Pan State
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState(false);
  const lastPanPos = useRef<{ x: number, y: number } | null>(null);

  const isLight = theme === 'light';

  // Load sketches on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSavedSketches(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse gallery:", e);
      }
    }
  }, []);

  // Persist sketches when they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSketches));
  }, [savedSketches]);

  // Initialize Canvas on Mount & Resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const tempImage = canvas.toDataURL();
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        
        if (ctx) {
          ctx.scale(dpr, dpr);
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
          img.src = tempImage;
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const saveState = useCallback(() => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL();
      setUndoStack(prev => [...prev, dataUrl]);
      setRedoStack([]);
    }
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentState = canvas.toDataURL();
    setRedoStack(prev => [...prev, currentState]);

    const previousStates = [...undoStack];
    const prevState = previousStates.pop()!;
    setUndoStack(previousStates);

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = prevState;
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentState = canvas.toDataURL();
    setUndoStack(prev => [...prev, currentState]);

    const redoStates = [...redoStack];
    const nextState = redoStates.pop()!;
    setRedoStack(redoStates);

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = nextState;
  }, [redoStack]);

  const saveToGallery = useCallback(() => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL();
    const newSketch: SavedSketch = {
      id: crypto.randomUUID(),
      dataUrl,
      createdAt: Date.now()
    };
    setSavedSketches(prev => [newSketch, ...prev]);
    // Show a brief notification could be nice, but for now just success
  }, []);

  const loadFromGallery = useCallback((sketch: SavedSketch) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    saveState(); // Allow undoing the load

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = sketch.dataUrl;
    setShowGallery(false);
  }, [saveState]);

  const deleteFromGallery = useCallback((id: string) => {
    setSavedSketches(prev => prev.filter(s => s.id !== id));
  }, []);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const toggleMode = () => setMode(prev => prev === 'keypad' ? 'sketch' : 'keypad');
  const toggleHistory = () => setShowHistory(prev => !prev);
  const clearHistory = () => setHistory([]);

  const copyToClipboard = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const handleMemoryClear = useCallback(() => setMemory(0), []);
  const handleMemoryRecall = useCallback(() => {
    setDisplay(prev => prev === '0' ? String(memory) : prev + String(memory));
    setIsWaitingForNext(false);
  }, [memory]);
  const handleMemoryAdd = useCallback(() => {
    try {
      const sanitized = display.replace(/×/g, '*').replace(/÷/g, '/').replace(/√(\d+\.?\d*)/g, 'sqrt($1)');
      const current = evaluate(sanitized);
      setMemory(prev => prev + Number(current));
      setIsWaitingForNext(true);
    } catch { /* Ignore */ }
  }, [display]);
  const handleMemorySubtract = useCallback(() => {
    try {
      const sanitized = display.replace(/×/g, '*').replace(/÷/g, '/').replace(/√(\d+\.?\d*)/g, 'sqrt($1)');
      const current = evaluate(sanitized);
      setMemory(prev => prev - Number(current));
      setIsWaitingForNext(true);
    } catch { /* Ignore */ }
  }, [display]);

  const handleNumber = useCallback((num: string) => {
    if (isWaitingForNext) {
      setDisplay(num);
      setIsWaitingForNext(false);
    } else {
      setDisplay(prev => prev === '0' ? num : prev + num);
    }
  }, [isWaitingForNext]);

  const handleSymbol = useCallback((symbol: string) => {
    if (isWaitingForNext) {
      setIsWaitingForNext(false);
    }
    setDisplay(prev => prev === '0' && !['(', '√'].includes(symbol) ? symbol : (prev === '0' ? symbol : prev + symbol));
  }, [isWaitingForNext]);

  const handlePercent = useCallback(() => {
    if (/^\-?\d*\.?\d*$/.test(display) && display !== '0') {
      try {
        const result = parseFloat(display) / 100;
        const resultStr = String(Number(result.toFixed(10)));
        
        setHistory(prev => [
          { id: crypto.randomUUID(), expression: `${display}%`, result: resultStr },
          ...prev.slice(0, 49)
        ]);

        setDisplay(resultStr);
        setIsWaitingForNext(true);
        return;
      } catch { /* fallback to symbol */ }
    }
    handleSymbol('%');
  }, [display, handleSymbol]);

  const handleEqual = useCallback(() => {
    try {
      const rawExpression = display
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/√(\d+\.?\d*)/g, 'sqrt($1)')
        ;
      
      const result = evaluate(rawExpression);
      const absResult = Math.abs(Number(result));
      let resultStr;

      if (absResult !== 0 && (absResult >= 1e12 || absResult < 1e-7)) {
        resultStr = Number(result).toExponential(6).replace(/\.0+e/, 'e');
      } else {
        resultStr = String(Number(Number(result).toFixed(10)));
      }
      
      setHistory(prev => [
        { id: crypto.randomUUID(), expression: display, result: resultStr },
        ...prev.slice(0, 49)
      ]);

      setDisplay(resultStr);
      setIsWaitingForNext(true);
    } catch (e) {
      setDisplay("Error");
      setIsWaitingForNext(true);
    }
  }, [display]);

  const clear = useCallback(() => {
    setDisplay('0');
    setIsWaitingForNext(false);
    setUndoStack([]);
    setRedoStack([]);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  const deleteLast = useCallback(() => {
    setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
  }, []);

  const handleDecimal = useCallback(() => {
    if (isWaitingForNext) {
      setDisplay('0.');
      setIsWaitingForNext(false);
      return;
    }
    setDisplay(prev => prev + '.');
  }, [isWaitingForNext]);

  const midPointBtw = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
    return {
      x: p1.x + (p2.x - p1.x) / 2,
      y: p1.y + (p2.y - p1.y) / 2
    };
  };

  const draw = useCallback((e: React.PointerEvent, forceDrawing = false) => {
    if ((!isDrawing && !forceDrawing) || !canvasRef.current) return;
    
    // Handle Panning
    if (isPanMode && isDrawing && lastPanPos.current) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (isPanMode) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    
    // Map screen coordinates to absolute canvas coordinates
    // When the canvas is transformed, clientX/offset are in screen pixels.
    // We need to divide by zoom and subtract the relative offset.
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    const pressure = e.pressure || 0.5;

    const points = pointsRef.current;
    points.push({ x, y });

    if (points.length < 3) {
      if (points.length === 2) {
        // Just draw a small line for the start
        const dynamicSize = isEraser ? brushSize * 6 : brushSize * (pressure * 2);
        ctx.lineWidth = Math.max(1, dynamicSize);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = isEraser ? bgColor : color;
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
      }
      return;
    }

    const dynamicSize = isEraser ? brushSize * 6 : brushSize * (pressure * 2);
    ctx.lineWidth = Math.max(1, dynamicSize);
    ctx.lineCap = isEraser ? 'round' : (brushStyle === 'marker' ? 'butt' : 'round');
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isEraser ? bgColor : color;
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';

    if (isEraser) {
        const pPrev = points[points.length - 3];
        const pCurr = points[points.length - 2];
        const pNext = points[points.length - 1];
        const mid1 = midPointBtw(pPrev, pCurr);
        const mid2 = midPointBtw(pCurr, pNext);
        ctx.beginPath();
        ctx.moveTo(mid1.x, mid1.y);
        ctx.quadraticCurveTo(pCurr.x, pCurr.y, mid2.x, mid2.y);
        ctx.stroke();
        return;
    }

    switch (brushStyle) {
      case 'charcoal': {
        const pPrev = points[points.length - 3];
        const pCurr = points[points.length - 2];
        const pNext = points[points.length - 1];
        const mid1 = midPointBtw(pPrev, pCurr);
        const mid2 = midPointBtw(pCurr, pNext);

        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.globalAlpha = 0.2 + (Math.random() * 0.3);
          ctx.lineWidth = brushSize * (0.5 + Math.random());
          const offsetX = (Math.random() - 0.5) * brushSize * 0.5;
          const offsetY = (Math.random() - 0.5) * brushSize * 0.5;
          ctx.moveTo(mid1.x + offsetX, mid1.y + offsetY);
          ctx.quadraticCurveTo(pCurr.x + offsetX, pCurr.y + offsetY, mid2.x + offsetX, mid2.y + offsetY);
          ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
        break;
      }
      case 'spray': {
        const radius = brushSize * 2;
        const count = brushSize * 2;
        const pCurr = points[points.length - 1];
        for (let i = 0; i < count; i++) {
          const offsetX = (Math.random() - 0.5) * 2 * radius;
          const offsetY = (Math.random() - 0.5) * 2 * radius;
          if (offsetX * offsetX + offsetY * offsetY <= radius * radius) {
            ctx.fillStyle = color;
            ctx.fillRect(pCurr.x + offsetX, pCurr.y + offsetY, 1, 1);
          }
        }
        break;
      }
      case 'marker': {
        const pPrev = points[points.length - 3];
        const pCurr = points[points.length - 2];
        const pNext = points[points.length - 1];
        const mid1 = midPointBtw(pPrev, pCurr);
        const mid2 = midPointBtw(pCurr, pNext);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(mid1.x, mid1.y);
        ctx.quadraticCurveTo(pCurr.x, pCurr.y, mid2.x, mid2.y);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        break;
      }
      default: {
        const pPrev = points[points.length - 3];
        const pCurr = points[points.length - 2];
        const pNext = points[points.length - 1];
        const mid1 = midPointBtw(pPrev, pCurr);
        const mid2 = midPointBtw(pCurr, pNext);
        ctx.beginPath();
        ctx.moveTo(mid1.x, mid1.y);
        ctx.quadraticCurveTo(pCurr.x, pCurr.y, mid2.x, mid2.y);
        ctx.stroke();
        break;
      }
    }
  }, [isDrawing, color, isEraser, brushSize, bgColor, brushStyle]);

  const startDrawing = (e: React.PointerEvent) => {
    if (isPanMode) {
      setIsDrawing(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    saveState();
    setIsDrawing(true);
    
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      pointsRef.current = [{ x, y }];
    }
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    pointsRef.current = [];
    lastPanPos.current = null;
  };

  const handleZoom = (delta: number) => {
    setZoom(prev => {
      const newZoom = Math.min(Math.max(0.5, prev + delta), 4);
      return newZoom;
    });
  };

  const resetView = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const solveSketch = async () => {
    if (!canvasRef.current || isSolving) return;
    setIsSolving(true);

    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];

      const ai = getAI();
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              { text: "You are a math expert. Transcribe and solve the handwritten mathematical expression in this image. It may include arithmetic, trigonometry (sin, cos, tan), roots (sqrt, cbrt), exponents (powers like x^2, x^y), logarithms (log, ln), factorials (!), decimals, and negative numbers. Return a JSON object with 'expression' (the LaTeX or text transcription) and 'result' (the final numerical answer or simplified expression). Format: { \"expression\": string, \"result\": string }. Provide only the final result." },
              { inlineData: { data: base64Data, mimeType: 'image/png' } }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      const data = JSON.parse(response.text || '{}');
      if (data.expression && data.result) {
        setDisplay(String(data.result));
        setHistory(prev => [
          { id: crypto.randomUUID(), expression: data.expression, result: String(data.result) },
          ...prev.slice(0, 49)
        ]);
        setIsWaitingForNext(true);
      } else {
        setDisplay("No math found");
      }
    } catch (error) {
      console.error("AI Solve Error:", error);
      setDisplay("AI Error");
    } finally {
      setIsSolving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode === 'sketch') return;
      if (/[0-9]/.test(e.key)) handleNumber(e.key);
      if (['+', '-', '*', '/'].includes(e.key)) {
        const symbol = e.key === '*' ? '×' : e.key === '/' ? '÷' : e.key;
        handleSymbol(symbol);
      }
      if (e.key === 'Enter' || e.key === '=') handleEqual();
      if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') clear();
      if (e.key === 'Backspace') deleteLast();
      if (e.key === '.') handleDecimal();
      if (e.key === '(' || e.key === ')') handleSymbol(e.key);
      if (e.key === '^') handleSymbol('^');
      if (e.key === '%') handlePercent();
      if (e.key === 's' || e.key === 'S') handleSymbol('√');
      if (e.key === '!') handleSymbol('!');
      if (e.key === 'm') handleMemoryRecall();
      if (e.key === 'M') handleMemoryClear();
      if (e.key === 'h' || e.key === 'H') toggleHistory();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, handleNumber, handleSymbol, handleEqual, clear, deleteLast, handleDecimal, handleMemoryRecall, handleMemoryClear, toggleHistory, handlePercent]);

    const Button = ({ 
      children, 
      onClick, 
      className = "", 
      variant = "default" 
    }: { 
      children: React.ReactNode; 
      onClick: () => void; 
      className?: string; 
      variant?: "default" | "operator" | "utility" | "equal" 
    }) => {
      const variants = {
        default: isLight 
          ? "bg-zinc-100 text-zinc-900 active:bg-zinc-200" 
          : "bg-zinc-800 text-zinc-100 active:bg-zinc-700",
        operator: "bg-orange-500 text-white active:bg-orange-400",
        utility: isLight
          ? "bg-zinc-200 text-zinc-600 active:bg-zinc-300"
          : "bg-zinc-700 text-zinc-300 active:bg-zinc-600",
        equal: "bg-emerald-500 text-white active:bg-emerald-400"
      };

      return (
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => { vibrate(); onClick(); }}
          className={`flex h-14 items-center justify-center rounded-2xl text-xl font-medium transition-all duration-200 shadow-sm active:shadow-inner ${variants[variant]} ${className}`}
        >
          {children}
        </motion.button>
      );
    };

  return (
    <div className="fixed inset-0 overflow-hidden font-sans transition-colors duration-500"
      style={{ backgroundColor: bgColor }}
    >
      
      {/* Top Left Menu */}
      <div className="fixed left-6 top-6 z-50">
        <ToolbarButton 
          onClick={() => setShowMobileCalc(!showMobileCalc)} 
          icon={showMobileCalc ? <XCircle size={18} /> : <Menu size={18} />} 
          isActive={showMobileCalc}
          title="Open Calculator"
        />
      </div>

      {/* Canvas Layer */}
      <div className="absolute inset-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerUp={endDrawing}
          onPointerOut={endDrawing}
          onPointerMove={(e) => draw(e)}
          style={{ 
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
          className={`absolute h-full w-full touch-none ${isPanMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        />
      </div>

      {/* Floating Toolbar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-8 flex flex-col items-center gap-4 px-4 sm:bottom-12">
        
        {/* Results Badge */}
        <AnimatePresence>
          {display !== '0' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`pointer-events-auto rounded-2xl border px-6 py-3 shadow-xl backdrop-blur-md ${isLight ? 'bg-white/80 border-zinc-200 text-zinc-900' : 'bg-zinc-900/80 border-zinc-800 text-white'}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Result</span>
                <span className="text-2xl font-mono font-bold">{display}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Toolbar */}
        <div className={`pointer-events-auto flex items-center gap-1 rounded-3xl border p-1 shadow-2xl backdrop-blur-xl max-w-full overflow-x-auto no-scrollbar scroll-smooth ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}>
          <div className="flex items-center gap-1 min-w-max px-1">
            <ToolbarButton onClick={clear} title="Clear Canvas" icon={<RotateCcw size={18} className="text-orange-500" />} />
            
            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
            
            <div className="flex items-center gap-1">
              <ToolbarButton 
                onClick={() => handleZoom(0.1)} 
                title="Zoom In" 
                icon={<ZoomIn size={18} />} 
                disabled={zoom >= 4}
              />
              <div className="flex w-10 flex-col items-center justify-center">
                <span className="text-[10px] font-bold text-zinc-500">{Math.round(zoom * 100)}%</span>
              </div>
              <ToolbarButton 
                onClick={() => handleZoom(-0.1)} 
                title="Zoom Out" 
                icon={<ZoomOut size={18} />} 
                disabled={zoom <= 0.5}
              />
              <ToolbarButton 
                onClick={resetView} 
                title="Reset View" 
                icon={<Target size={18} />} 
              />
              <ToolbarButton 
                onClick={() => setIsPanMode(!isPanMode)} 
                isActive={isPanMode}
                title="Pan Tool" 
                icon={<Move size={18} />} 
              />
            </div>

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
            
            <ToolbarButton onClick={undo} disabled={undoStack.length === 0} title="Undo" icon={<Undo2 size={18} />} />
            <ToolbarButton onClick={redo} disabled={redoStack.length === 0} title="Redo" icon={<Redo2 size={18} />} />

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
            
            <div className="flex items-center gap-1 p-1">
              {BG_COLORS.map(bg => (
                <button
                  key={bg.value}
                  onClick={() => setBgColor(bg.value)}
                  title={`Background: ${bg.name}`}
                  className={`h-6 w-6 rounded-md border-2 transition-all shrink-0 ${bgColor === bg.value ? 'border-emerald-500 scale-110 shadow-sm' : 'border-zinc-500/20'}`}
                  style={{ backgroundColor: bg.value }}
                />
              ))}
            </div>

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />

            <ToolbarButton 
              onClick={() => { 
                  setIsEraser(false); 
                  setShowColorPicker(!showColorPicker); 
                  setShowSizePicker(false);
                  setShowBrushPicker(false);
              }} 
              isActive={!isEraser && showColorPicker}
              title="Brush Color"
              icon={<div className="h-4 w-4 rounded-full border border-zinc-500/40 shadow-inner" style={{ backgroundColor: color }} />} 
            />

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />

            <ToolbarButton 
              onClick={() => {
                  setIsEraser(false);
                  setShowBrushPicker(!showBrushPicker);
                  setShowColorPicker(false);
                  setShowSizePicker(false);
              }} 
              isActive={!isEraser && showBrushPicker}
              title="Brush Style"
              icon={
                brushStyle === 'pen' ? <Pencil size={18} /> :
                brushStyle === 'charcoal' ? <Feather size={18} /> :
                brushStyle === 'marker' ? <Highlighter size={18} /> :
                <Cloud size={18} />
              } 
            />

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />

            <ToolbarButton 
              onClick={() => { 
                  setShowSizePicker(!showSizePicker); 
                  setShowColorPicker(false); 
                  setShowBrushPicker(false);
              }} 
              isActive={showSizePicker}
              title="Brush Size"
              icon={
                <div className="relative flex items-center justify-center">
                  <Circle size={18} className="text-zinc-500" />
                  <div 
                    className="absolute rounded-full bg-zinc-500" 
                    style={{ width: Math.max(2, brushSize * 0.6), height: Math.max(2, brushSize * 0.6) }} 
                  />
                </div>
              } 
            />
            
            <ToolbarButton 
              onClick={() => { 
                  setIsEraser(true); 
                  setShowColorPicker(false); 
                  setShowSizePicker(false); 
                  setShowBrushPicker(false);
              }} 
              isActive={isEraser}
              title="Eraser"
              icon={<Eraser size={18} />} 
            />

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />

            <ToolbarButton 
              onClick={saveToGallery}
              title="Save to Gallery"
              icon={<Save size={18} className="text-blue-500" />} 
            />

            <div className={`mx-1 h-6 w-px ${isLight ? 'bg-zinc-200' : 'bg-zinc-800'}`} />

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={solveSketch}
              disabled={isSolving}
              className={`flex items-center gap-2 rounded-[20px] px-6 py-2.5 font-bold transition-all duration-300 shadow-lg shrink-0 ${
                isSolving 
                  ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' 
                  : 'bg-emerald-500 text-white hover:bg-emerald-400 hover:shadow-emerald-500/20'
              }`}
            >
              {isSolving ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              <span className="text-sm">Solve</span>
            </motion.button>
          </div>
        </div>

        {/* Brush Style Popup */}
        <AnimatePresence>
          {showBrushPicker && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`pointer-events-auto flex items-center gap-2 rounded-2xl border p-2 shadow-xl backdrop-blur-xl ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}
            >
              {[
                { id: 'pen', icon: Pencil, label: 'Pen' },
                { id: 'charcoal', icon: Feather, label: 'Charcoal' },
                { id: 'marker', icon: Highlighter, label: 'Marker' },
                { id: 'spray', icon: Cloud, label: 'Spray' }
              ].map((style) => (
                <button
                  key={style.id}
                  onClick={() => {
                    setBrushStyle(style.id as BrushStyle);
                    setShowBrushPicker(false);
                  }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${
                    brushStyle === style.id 
                    ? (isLight ? 'bg-emerald-50 text-emerald-600' : 'bg-emerald-500/10 text-emerald-400')
                    : 'text-zinc-500 hover:bg-zinc-500/5'
                  }`}
                >
                  <style.icon size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-tighter">{style.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Size Picker Popup */}
        <AnimatePresence>
          {showSizePicker && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`pointer-events-auto flex items-center gap-4 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-xl ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}
            >
              <button 
                onClick={() => setBrushSize(Math.max(1, brushSize - 1))}
                className="p-1 text-zinc-500 hover:text-emerald-500 transition-colors"
                title="Decrease Size"
              >
                <Minus size={18} />
              </button>
              
              <div className="flex flex-col items-center gap-1">
                <input 
                  type="range" 
                  min="1" 
                  max="30" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-32 accent-emerald-500 cursor-pointer"
                />
                <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Size: {brushSize}px</span>
              </div>

              <button 
                onClick={() => setBrushSize(Math.min(30, brushSize + 1))}
                className="p-1 text-zinc-500 hover:text-emerald-500 transition-colors"
                title="Increase Size"
              >
                <Plus size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Color Palette Popup */}
        <AnimatePresence>
          {showColorPicker && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`pointer-events-auto flex items-center gap-2 rounded-2xl border p-2 shadow-xl backdrop-blur-xl ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}
            >
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { setColor(c); setIsEraser(false); setShowColorPicker(false); }}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all hover:scale-110 active:scale-95 ${color === c && !isEraser ? 'border-emerald-500 scale-110 shadow-lg' : 'border-white/10'}`}
                  style={{ backgroundColor: c }}
                >
                  {color === c && !isEraser && (
                    <Check size={14} className={(c === '#FFFFFF' || c === '#FACC15') ? 'text-black' : 'text-white'} />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Meta Options */}
      <div className="fixed right-6 top-6 flex flex-col gap-3">
        <ToolbarButton onClick={toggleTheme} icon={isLight ? <Moon size={18} /> : <Sun size={18} />} />
        <ToolbarButton onClick={() => { setShowGallery(!showGallery); setShowHistory(false); }} isActive={showGallery} icon={<ImageIcon size={18} />} />
        <ToolbarButton onClick={() => { setShowHistory(!showHistory); setShowGallery(false); }} isActive={showHistory} icon={<History size={18} />} />
      </div>

      {/* History Sidebar */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className={`fixed right-6 top-24 z-50 w-72 max-w-[calc(100vw-48px)] rounded-3xl border p-4 shadow-2xl backdrop-blur-xl ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}
          >
            <div className="flex items-center justify-between p-2 border-b border-zinc-500/10 mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">History</span>
              <button onClick={clearHistory} className="text-zinc-500 hover:text-red-500"><Trash2 size={14}/></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {history.length === 0 ? (
                <p className="text-center text-xs text-zinc-500 py-4 italic">No states solved yet</p>
              ) : (
                history.map(item => (
                   <div key={item.id} className="flex flex-col items-end p-2 rounded-xl hover:bg-zinc-500/5 transition-colors group">
                      <span className="text-[10px] font-mono text-zinc-500">{item.expression}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono font-bold ${isLight ? 'text-zinc-900' : 'text-zinc-100'}`}>= {item.result}</span>
                        <button onClick={() => copyToClipboard(item.id, item.result)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                           {copiedId === item.id ? <Check size={12} className="text-emerald-500"/> : <Copy size={12} className="text-zinc-400"/>}
                        </button>
                      </div>
                   </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Gallery Sidebar */}
      <AnimatePresence>
        {showGallery && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className={`fixed right-6 top-24 z-50 w-80 max-w-[calc(100vw-48px)] rounded-3xl border p-4 shadow-2xl backdrop-blur-xl ${isLight ? 'bg-white/90 border-zinc-200' : 'bg-zinc-900/90 border-zinc-800'}`}
          >
            <div className="flex items-center justify-between p-2 border-b border-zinc-500/10 mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Sketch Gallery</span>
              <button 
                onClick={() => setShowGallery(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <XCircle size={16} />
              </button>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin grid grid-cols-2 gap-2">
              {savedSketches.length === 0 ? (
                <p className="col-span-2 text-center text-xs text-zinc-500 py-8 italic">Your gallery is empty</p>
              ) : (
                savedSketches.map(sketch => (
                  <div key={sketch.id} className="relative group overflow-hidden rounded-xl border border-zinc-500/10 hover:border-emerald-500/50 transition-all aspect-square bg-zinc-800/20">
                    <img 
                      src={sketch.dataUrl} 
                      alt="Sketch preview" 
                      className="h-full w-full object-contain cursor-pointer"
                      onClick={() => loadFromGallery(sketch)}
                    />
                    <div className="absolute inset-x-0 bottom-0 p-1.5 flex justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => deleteFromGallery(sketch.id)}
                        className="p-1 px-2 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                        title="Delete Sketch"
                      >
                        <Trash2 size={12}/>
                      </button>
                      <button 
                         onClick={() => {
                           const link = document.createElement('a');
                           link.download = `sketch-${new Date(sketch.createdAt).getTime()}.png`;
                           link.href = sketch.dataUrl;
                           link.click();
                         }}
                         className="p-1 px-2 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
                         title="Download PNG"
                      >
                         <Download size={12}/>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analyzing Overlay */}
      {isSolving && (
        <div className="pointer-events-none fixed inset-0 flex flex-col items-center justify-center bg-black/5 backdrop-blur-[1px]">
          <Loader2 className="animate-spin text-emerald-500 mb-4" size={48} />
          <p className="text-emerald-500 font-bold tracking-widest text-sm uppercase animate-pulse">Analyzing Mathematical Ink...</p>
        </div>
      )}
      
      {/* Mobile-style Phone Calculator Drawer */}
      <AnimatePresence>
        {showMobileCalc && (
          <motion.div
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed left-6 top-24 z-50 w-72 max-w-[calc(100vw-48px)] rounded-[32px] border p-5 shadow-2xl backdrop-blur-2xl ${isLight ? 'bg-white/95 border-zinc-200' : 'bg-zinc-900/95 border-zinc-800'}`}
          >
            {/* Phone Speaker/Notch area sim */}
            <div className="mx-auto mb-6 h-1 w-12 rounded-full bg-zinc-500/20" />
            
            <div className="mb-4 flex flex-col items-end overflow-hidden px-2">
              <span className="h-6 text-xs text-zinc-500 font-mono truncate w-full text-right">
                {memory !== 0 ? `M: ${memory}` : ''}
              </span>
              <div className="w-full overflow-hidden text-right">
                <motion.span 
                  key={display}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className={`block text-4xl font-bold tracking-tight truncate ${isLight ? 'text-zinc-900' : 'text-white'}`}
                >
                  {display}
                </motion.span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Button onClick={clear} variant="utility" className="text-orange-500">AC</Button>
              <Button onClick={deleteLast} variant="utility"><RotateCcw size={18}/></Button>
              <Button onClick={handlePercent} variant="utility">%</Button>
              <Button onClick={() => handleSymbol('÷')} variant="operator">÷</Button>

              <Button onClick={() => handleNumber('7')}>7</Button>
              <Button onClick={() => handleNumber('8')}>8</Button>
              <Button onClick={() => handleNumber('9')}>9</Button>
              <Button onClick={() => handleSymbol('×')} variant="operator">×</Button>

              <Button onClick={() => handleNumber('4')}>4</Button>
              <Button onClick={() => handleNumber('5')}>5</Button>
              <Button onClick={() => handleNumber('6')}>6</Button>
              <Button onClick={() => handleSymbol('-')} variant="operator">-</Button>

              <Button onClick={() => handleNumber('1')}>1</Button>
              <Button onClick={() => handleNumber('2')}>2</Button>
              <Button onClick={() => handleNumber('3')}>3</Button>
              <Button onClick={() => handleSymbol('+')} variant="operator">+</Button>

              <Button onClick={() => handleNumber('0')} className="col-span-2 text-left px-7">0</Button>
              <Button onClick={handleDecimal}>.</Button>
              <Button onClick={handleEqual} variant="equal"><Equal size={22}/></Button>
            </div>

            <div className="mt-6 flex justify-between px-2">
              <div className="flex gap-2">
                <button onClick={handleMemoryClear} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300">MC</button>
                <button onClick={handleMemoryRecall} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300">MR</button>
                <button onClick={handleMemoryAdd} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300">M+</button>
                <button onClick={handleMemorySubtract} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300">M-</button>
              </div>
              <button 
                onClick={() => setMode(mode === 'sketch' ? 'keypad' : 'sketch')}
                className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400"
              >
                {mode === 'sketch' ? 'ENABLE SHORTCUTS' : 'shortcuts on'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}


