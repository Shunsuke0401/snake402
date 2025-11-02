// Client-side networking for multiplayer snake game
// Migrated to Socket.IO for stable communication and auto-reconnect

// Message type interfaces (matching server)
import { io, Socket } from 'socket.io-client';

interface BaseMessage { type: string; timestamp?: number }

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

// InputMessage interface removed - only sent to server, not received

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

// EatAttemptMessage interface removed - unused on client side (only sent, not received)

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
  stateBatch: (data: {
    tick: number;
    player: NetworkPlayerState;
    foods: Array<{ id: string; x: number; y: number; color: number; size: number; type: string }>;
    others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number }>;
  }) => void;
  foodState: (foods: NetworkFoodItem[]) => void;
  foodUpdateCombined: (despawnId: string, spawnFood: NetworkFoodItem) => void;
  error: (error: string) => void;
}

export class NetClient {
  private socket: Socket | null = null;
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
  
  // Connection state (Socket.io handles reconnection automatically)
  private reconnectAttempts: number = 0; // Tracks current reconnection attempt for logging
  
  constructor(serverUrl: string = 'http://localhost:8080') {
    this.serverUrl = serverUrl;
  }

  public connect(): Promise<void> {
    return new Promise((resolve) => {
      this.socket = io(this.serverUrl, { 
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 45000,           // 45 seconds - wait this long for initial connection
        // Match server's generous timeouts
        forceNew: false,          // Reuse existing connection if available
        multiplex: true           // Allow multiple namespaces on same connection
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to game server', this.socket!.id);
        this.connected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        resolve();
      });

      this.socket.on('reconnect', (attemptNumber: number) => {
        console.log(`✅ Reconnected to server after ${attemptNumber} attempts`);
        this.connected = true;
        this.reconnectAttempts = 0;
        // Don't clear playerId - it should be preserved during reconnection
        // Player state will be updated by the server's hello message
      });

      this.socket.on('reconnect_attempt', (attemptNumber: number) => {
        console.log(`🔄 Reconnection attempt ${attemptNumber}...`);
        this.reconnectAttempts = attemptNumber;
      });

      this.socket.on('reconnect_error', (error: Error) => {
        console.warn('⚠️ Reconnection error:', error.message);
      });

      this.socket.on('reconnect_failed', () => {
        console.error('❌ Reconnection failed - max attempts reached');
        this.connected = false;
        this.playerId = null;
        this.remotePlayers.clear();
        this.emit('disconnected');
        this.emit('error', 'Failed to reconnect to server');
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log(`Disconnected from game server. Reason: ${reason}`);
        
        // Only clear state if not attempting to reconnect
        // Socket.io will attempt reconnect automatically for most disconnect reasons
        if (reason === 'io server disconnect') {
          // Server forcibly disconnected - clear state (permanent)
          console.log('🔴 Permanent disconnection - clearing state');
          this.connected = false;
          this.playerId = null;
          this.remotePlayers.clear();
          this.emit('disconnected');
        } else {
          // Temporary disconnection - Socket.io will reconnect
          // Don't clear playerId or remote players to preserve state
          console.log('🟡 Temporary disconnection - waiting for reconnect...');
          this.connected = false;
          this.emit('disconnected');
        }
      });

      // Typed event handlers
      this.socket.on('hello', (msg: HelloMessage) => {
        this.handleHello(msg);
      });
      this.socket.on('state', (msg: StateMessage) => {
        this.handleState(msg);
      });
      
      // Batched state update with visibility culling (new optimized format)
      this.socket.on('state_batch', (data: {
        tick: number;
        player: NetworkPlayerState;
        foods: Array<{ id: string; x: number; y: number; color: number; size: number; type: string }>;
        others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number }>;
      }) => {
        this.emit('stateBatch', data);
      });
      this.socket.on('food', (msg: FoodMessage) => {
        this.handleFood(msg);
      });
      this.socket.on('food_eaten', (msg: FoodEatenMessage) => {
        this.handleFoodEaten(msg);
      });
      
      // Full food state sync (every 500ms) - ensures client stays in sync
      this.socket.on('food_state', (data: { foods: NetworkFoodItem[]; timestamp: number }) => {
        console.log(`🔄 Received full food sync: ${data.foods.length} items`);
        this.emit('foodState', data.foods);
      });
      
      // Combined food update (despawn + spawn in one message)
      this.socket.on('food_update', (data: { despawn: string; spawn: NetworkFoodItem; timestamp: number }) => {
        console.log(`🔄 Received food update: despawn ${data.despawn}, spawn ${data.spawn.id}`);
        this.emit('foodUpdateCombined', data.despawn, data.spawn);
      });
      
      this.socket.on('spawn', (msg: SpawnMessage) => {
        this.handleSpawn(msg);
      });
      this.socket.on('die', (msg: DieMessage) => {
        this.handleDie(msg);
      });
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.playerId = null;
    this.remotePlayers.clear();
  }

  public sendInput(angle: number, throttle: number): void {
    if (!this.connected || !this.socket) {
      console.log(`⚠️ Cannot send input: connected=${this.connected}, socket=${!!this.socket}`);
      return;
    }
    
    this.currentInput = { angle, throttle };
    
    // Send input at specified rate (20Hz for client-side prediction)
    const now = Date.now();
    if (now - this.lastInputSendTime >= 1000 / this.inputSendRate) {
      console.log(`📤 Sending input: angle=${(angle * 180 / Math.PI).toFixed(1)}°, throttle=${throttle}`);
      this.socket.emit('input', { angle, throttle });
      this.lastInputSendTime = now;
    }
  }

  public sendDebugMessage(message: string): void {
    if (!this.isConnected() || !this.socket) return;
    this.socket.emit('debug', { message });
  }

  public sendEatAttempt(foodId: string): void {
    if (!this.isConnected() || !this.socket) {
      console.log(`❌ CLIENT: Cannot send eat attempt - not connected`);
      return;
    }
    
    console.log(`📤 CLIENT: Sending eat attempt for food ${foodId}`);
    this.socket.emit('eat_attempt', { foodId });
  }

  public update(_deltaTime: number): void {
    // Update interpolation for remote players
    this.updateInterpolation();
  }

  public getRemotePlayers(): NetworkPlayerState[] {
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
  
  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
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

  // Raw message handler no longer needed (Socket.IO uses typed events)

  private handleHello(message: HelloMessage): void {
    this.playerId = message.playerId;
    console.log(`Assigned player ID: ${this.playerId}`);
    this.emit('connected', message.playerId, message.spawnPosition);
  }

  private handleState(message: StateMessage): void {
    // Update remote players (excluding self)
    
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
        existingPlayer.lastUpdateTime = Date.now();
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
          lastUpdateTime: Date.now()
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
    console.log(`📥 NetClient received food message: action=${message.action}, foodId=${message.food.id}, foodX=${message.food.x.toFixed(1)}, foodY=${message.food.y.toFixed(1)}`);
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

  private updateInterpolation(): void {
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

  // attemptReconnect() removed - Socket.io handles reconnection automatically
  // No need for manual reconnection logic as Socket.io provides built-in auto-reconnect
}