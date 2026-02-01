
export enum GameStatus {
  SPLASH = 'SPLASH',
  READY = 'READY',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  GARAGE = 'GARAGE',
  LEADERBOARD = 'LEADERBOARD',
  AI_CHAT = 'AI_CHAT',
  ACADEMY = 'ACADEMY'
}

export interface GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Spaceship extends GameObject {
  velocity: number;
  rotation: number;
  rank: number;
  shieldActive: boolean;
  magnetActive: boolean;
}

export interface PipePair {
  x: number;
  topHeight: number;
  bottomY: number;
  passed: boolean;
  width: number;
  gap: number;
  glow: number;
  isBreaking?: boolean;
}

export interface SpeedBooster extends GameObject {
  active: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
}

export interface ShipDesign {
  id: number;
  name: string;
  price: number;
  primaryColor: string;
  secondaryColor: string;
  shapeType: 'interceptor' | 'cruiser' | 'scout' | 'dreadnought' | 'vanguard';
  features: string[];
  maxShields: number;
  magnetPower: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  isPlayer?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  urls?: string[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
