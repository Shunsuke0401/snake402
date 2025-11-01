// Client-side networking for multiplayer snake game
// Handles WebSocket communication, interpolation, and state synchronization

// Message type interfaces (matching server)
interface BaseMessage {
  type: string;
  timestamp?: number;
}

interface HelloMessage extends BaseMessage {
  type: 'hello';
  playerId: string;
  spawnPosition: { x: number; y: number };
}

interface StateMessage extends BaseMessage {
  type: 'state';
  players: NetworkPlayerState[];
  food: NetworkFoodItem[];
}

interface InputMessage extends BaseMessage {
  type: 'input';
  angle: number;
  throttle: number;
}

interface FoodMessage extends BaseMessage {
  type: 'food';
  action: 'spawn' | 'despawn';
  food: NetworkFoodItem;
}

interface SpawnMessage extends BaseMessage {
  type: 'spawn';
  playerId: string;
  position: { x: number; y: number };
}

interface DieMessage extends BaseMessage {
  type: 'die';
  playerId: string;
  reason: string;
}

interface EatAttemptMessage extends BaseMessage {
  type: 'eat_attempt';
  foodId: string;
}

interface FoodEatenMessage extends BaseMessage {
  type: 'food_eaten';
  foodId: string;
  by: string; // playerId who ate the food
}

// Network state interfaces
export interface NetworkPlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  segments: Array<{ x: number; y: number }>;
  isBoosting: boolean;
  score: number;
}

export interface NetworkFoodItem {
  id: string;
  x: number;
  y: number;
  type: 'small' | 'large';
  color: number;
  size: number;
  score: number;
  growthAmount: number;
}

// Interpolated player state for smooth rendering
interface InterpolatedPlayer {
  id: string;
  x: number;
  y: number;
  angle: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  length: number;
  segments: Array<{ x: number; y: number }>;
  isBoosting: boolean;
  score: number;
  lastUpdateTime: number;
}

export interface NetClientEvents {
  connected: (playerId: string, spawnPosition: { x: number; y: number }) => void;
  disconnected: () => void;
  playerSpawned: (playerId: string, position: { x: number; y: number }) => void;
  playerDied: (playerId: string, reason: string) => void;
  foodUpdate: (action: 'spawn' | 'despawn', food: NetworkFoodItem) => void;
  foodEaten: (foodId: string, by: string) => void;
  stateUpdate: (players: NetworkPlayerState[], food: NetworkFoodItem[]) => void;
  error: (error: string) => void;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private playerId: string | null = null;
  private serverUrl: string;
  private eventHandlers: Partial<NetClientEvents> = {};
  
  // Input state tracking
  private currentInput: { angle: number; throttle: number } = { angle: 0, throttle: 0 };
  private inputSendRate: number = 20; // 20Hz input sending for client-side prediction
  private lastInputSendTime: number = 0;
  
  // Interpolation state
  private remotePlayers: Map<string, InterpolatedPlayer> = new Map();
  private interpolationDelay: number = 100; // 100ms interpolation delay
  
  // Connection state
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000; // Start with 1 second
  
  constructor(serverUrl: string = 'ws://localhost:8081') {
    this.serverUrl = serverUrl;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.onopen = () => {
          console.log('Connected to game server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.ws.onclose = () => {
          console.log('Disconnected from game server');
          this.connected = false;
          this.playerId = null;
          this.remotePlayers.clear();
          
          this.emit('disconnected');
          
          // Attempt reconnection
          this.attemptReconnect();
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', 'Connection error');
          reject(new Error('Failed to connect to server'));
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.playerId = null;
    this.remotePlayers.clear();
  }

  public sendInput(angle: number, throttle: number): void {
    if (!this.connected || !this.ws) {
      console.log(`⚠️ Cannot send input: connected=${this.connected}, ws=${!!this.ws}`);
      return;
    }
    
    this.currentInput = { angle, throttle };
    
    // Send input at specified rate (20Hz for client-side prediction)
    const now = Date.now();
    if (now - this.lastInputSendTime >= 1000 / this.inputSendRate) {
      const message: InputMessage = {
        type: 'input',
        angle,
        throttle,
        timestamp: now
      };
      
      console.log(`📤 Sending input: angle=${(angle * 180 / Math.PI).toFixed(1)}°, throttle=${throttle}`);
      this.ws.send(JSON.stringify(message));
      this.lastInputSendTime = now;
    }
  }

  public sendDebugMessage(message: string): void {
    if (!this.isConnected() || !this.ws) return;
    
    const debugMessage = {
      type: 'debug',
      message
    };
    
    this.ws.send(JSON.stringify(debugMessage));
  }

  public sendEatAttempt(foodId: string): void {
    if (!this.isConnected() || !this.ws) {
      console.log(`❌ CLIENT: Cannot send eat attempt - not connected`);
      return;
    }
    
    const eatMessage: EatAttemptMessage = {
      type: 'eat_attempt',
      foodId,
      timestamp: Date.now()
    };
    
    console.log(`📤 CLIENT: Sending eat attempt for food ${foodId}`);
    this.ws.send(JSON.stringify(eatMessage));
  }

  public update(deltaTime: number): void {
    // Update interpolation for remote players
    this.updateInterpolation(deltaTime);
  }

  public getRemotePlayers(): NetworkPlayerState[] {
    const now = Date.now();
    return Array.from(this.remotePlayers.values()).map(player => ({
      id: player.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      length: player.length,
      segments: player.segments,
      isBoosting: player.isBoosting,
      score: player.score
    }));
  }

  public getPlayerId(): string | null {
    return this.playerId;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getCurrentInput(): { angle: number; throttle: number } {
    return { ...this.currentInput };
  }

  public on<K extends keyof NetClientEvents>(event: K, handler: NetClientEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  public off<K extends keyof NetClientEvents>(event: K): void {
    delete this.eventHandlers[event];
  }

  private emit<K extends keyof NetClientEvents>(event: K, ...args: any[]): void {
    const handler = this.eventHandlers[event];
    if (handler) {
      (handler as any)(...args);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as BaseMessage;
      
      switch (message.type) {
        case 'hello':
          this.handleHello(message as HelloMessage);
          break;
        case 'state':
          this.handleState(message as StateMessage);
          break;
        case 'food':
          this.handleFood(message as FoodMessage);
          break;
        case 'food_eaten':
          this.handleFoodEaten(message as FoodEatenMessage);
          break;
        case 'spawn':
          this.handleSpawn(message as SpawnMessage);
          break;
        case 'die':
          this.handleDie(message as DieMessage);
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error parsing server message:', error);
    }
  }

  private handleHello(message: HelloMessage): void {
    this.playerId = message.playerId;
    console.log(`Assigned player ID: ${this.playerId}`);
    this.emit('connected', message.playerId, message.spawnPosition);
  }

  private handleState(message: StateMessage): void {
    // Update remote players (excluding self)
    const now = Date.now();
    
    for (const playerState of message.players) {
      if (playerState.id === this.playerId) continue; // Skip own player
      
      const existingPlayer = this.remotePlayers.get(playerState.id);
      
      if (existingPlayer) {
        // Update interpolation targets
        existingPlayer.targetX = playerState.x;
        existingPlayer.targetY = playerState.y;
        existingPlayer.targetAngle = playerState.angle;
        existingPlayer.length = playerState.length;
        existingPlayer.segments = playerState.segments;
        existingPlayer.isBoosting = playerState.isBoosting;
        existingPlayer.score = playerState.score;
        existingPlayer.lastUpdateTime = now;
      } else {
        // New remote player
        const interpolatedPlayer: InterpolatedPlayer = {
          id: playerState.id,
          x: playerState.x,
          y: playerState.y,
          angle: playerState.angle,
          targetX: playerState.x,
          targetY: playerState.y,
          targetAngle: playerState.angle,
          length: playerState.length,
          segments: playerState.segments,
          isBoosting: playerState.isBoosting,
          score: playerState.score,
          lastUpdateTime: now
        };
        this.remotePlayers.set(playerState.id, interpolatedPlayer);
      }
    }
    
    // Remove players that are no longer in the state
    const currentPlayerIds = new Set(message.players.map(p => p.id));
    for (const [playerId] of this.remotePlayers) {
      if (!currentPlayerIds.has(playerId)) {
        this.remotePlayers.delete(playerId);
      }
    }
    
    this.emit('stateUpdate', message.players, message.food);
  }

  private handleFood(message: FoodMessage): void {
    this.emit('foodUpdate', message.action, message.food);
  }

  private handleFoodEaten(message: FoodEatenMessage): void {
    console.log(`🍎 Food eaten: ${message.foodId} by ${message.by}`);
    this.emit('foodEaten', message.foodId, message.by);
  }

  private handleSpawn(message: SpawnMessage): void {
    this.emit('playerSpawned', message.playerId, message.position);
  }

  private handleDie(message: DieMessage): void {
    // Remove player from remote players
    this.remotePlayers.delete(message.playerId);
    this.emit('playerDied', message.playerId, message.reason);
  }

  private updateInterpolation(deltaTime: number): void {
    const interpolationSpeed = 0.1; // Smooth interpolation factor
    
    for (const player of this.remotePlayers.values()) {
      // Interpolate position
      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      player.x += dx * interpolationSpeed;
      player.y += dy * interpolationSpeed;
      
      // Interpolate angle (handle wrapping)
      const angleDiff = this.getAngleDifference(player.targetAngle, player.angle);
      player.angle += angleDiff * interpolationSpeed;
      
      // Normalize angle
      while (player.angle > Math.PI) player.angle -= 2 * Math.PI;
      while (player.angle < -Math.PI) player.angle += 2 * Math.PI;
    }
  }

  private getAngleDifference(target: number, current: number): number {
    let diff = target - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      this.emit('error', 'Failed to reconnect to server');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect().catch(() => {
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
      });
    }, this.reconnectDelay);
  }
}