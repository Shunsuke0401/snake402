import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import { FoodManager } from './game/FoodManager';

const PORT = 8081;
const TICK_RATE = 30; // 30Hz server tick rate
const TICK_INTERVAL = 1000 / TICK_RATE;

// Game constants (shared with client)
const WORLD_WIDTH = 18000;
const WORLD_HEIGHT = 18000;
const GRID_SIZE = 20;
const ARENA_CENTER_X = WORLD_WIDTH / 2;
const ARENA_CENTER_Y = WORLD_HEIGHT / 2;
const ARENA_RADIUS = Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2 - 500;
const BASE_SPEED = 200; // pixels per second
const BOOST_MULTIPLIER = 1.5;
const SNAKE_INITIAL_LENGTH = 3;
const MAX_FOOD = 2500;

// Message types
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
  players: PlayerState[];
  food: FoodItem[];
}

interface InputMessage extends BaseMessage {
  type: 'input';
  angle: number;
  throttle: number; // 0 = normal, 1 = boost
}

interface FoodMessage extends BaseMessage {
  type: 'food';
  action: 'spawn' | 'despawn';
  food: FoodItem;
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
  by: string;
}

// Game state interfaces
interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  segments: Array<{ x: number; y: number }>;
  isBoosting: boolean;
  score: number;
}

interface FoodItem {
  id: string;
  x: number;
  y: number;
  type: 'small' | 'large';
  color: number;
  size: number;
  score: number;
  growthAmount: number;
}

interface Player {
  id: string;
  ws: WebSocket;
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  speed: number;
  isBoosting: boolean;
  segments: Array<{ x: number; y: number }>;
  length: number;
  score: number;
  lastInput: { angle: number; throttle: number };
  lastInputTime: number;
}

// World state
class GameWorld {
  private players: Map<string, Player> = new Map();
  private foodManager: FoodManager;


  constructor() {
    this.foodManager = new FoodManager(
      MAX_FOOD,
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y },
      ARENA_RADIUS,
      GRID_SIZE
    );
  }



  public addPlayer(playerId: string, ws: WebSocket): Player {
    // Random spawn position within arena
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.random() * (ARENA_RADIUS * 0.3); // Spawn in inner 30% of arena
    const x = ARENA_CENTER_X + Math.cos(angle) * radius;
    const y = ARENA_CENTER_Y + Math.sin(angle) * radius;

    const player: Player = {
      id: playerId,
      ws,
      x,
      y,
      angle: Math.random() * 2 * Math.PI,
      targetAngle: 0,
      speed: BASE_SPEED,
      isBoosting: false,
      segments: [],
      length: SNAKE_INITIAL_LENGTH,
      score: 0,
      lastInput: { angle: 0, throttle: 0 },
      lastInputTime: Date.now()
    };

    // Initialize segments
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      player.segments.push({
        x: x - i * GRID_SIZE * Math.cos(player.angle),
        y: y - i * GRID_SIZE * Math.sin(player.angle)
      });
    }

    this.players.set(playerId, player);
    return player;
  }

  public removePlayer(playerId: string): void {
    this.players.delete(playerId);
  }

  public updatePlayerInput(playerId: string, input: { angle: number; throttle: number }): void {
    const player = this.players.get(playerId);
    if (player) {
      player.lastInput = input;
      player.lastInputTime = Date.now();
      player.targetAngle = input.angle;
      player.isBoosting = input.throttle > 0;
    }
  }

  public tick(deltaTime: number): void {
    // Update all players
    for (const player of this.players.values()) {
      this.updatePlayer(player, deltaTime);
    }

    // Check collisions
    this.checkCollisions();

    // Update segments again after collision detection to reflect length changes
    for (const player of this.players.values()) {
      this.updatePlayerSegments(player);
    }

    // Maintain food count
    this.maintainFood();
  }

  private updatePlayer(player: Player, deltaTime: number): void {
    // Apply target angle immediately for responsive control
    player.angle = player.targetAngle;

    // Update speed based on boosting
    player.speed = player.isBoosting ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;

    // Move player
    const moveDistance = (player.speed * deltaTime) / 1000;
    const newX = player.x + Math.cos(player.angle) * moveDistance;
    const newY = player.y + Math.sin(player.angle) * moveDistance;

    // Check arena boundaries
    const distanceFromCenter = Math.sqrt(
      Math.pow(newX - ARENA_CENTER_X, 2) + Math.pow(newY - ARENA_CENTER_Y, 2)
    );

    if (distanceFromCenter <= ARENA_RADIUS) {
      player.x = newX;
      player.y = newY;

      // Update segments
      this.updatePlayerSegments(player);
    }
  }

  private updatePlayerSegments(player: Player): void {
    const beforeSegmentCount = player.segments.length;
    
    // Add new head position
    player.segments.unshift({ x: player.x, y: player.y });

    // Maintain segment count based on length
    while (player.segments.length > player.length) {
      player.segments.pop();
    }
    
    // Log when segments sync up with length after food eating
    if (beforeSegmentCount < player.length && player.segments.length === player.length) {
      console.log(`✅ Player ${player.id} segments synced: length=${player.length}, segments=${player.segments.length}`);
    }
  }



  private checkCollisions(): void {
    // Debug: Log collision check for first player every 2 seconds
    if (this.players.size > 0 && Date.now() % 2000 < TICK_INTERVAL * 2) {
      const firstPlayer = Array.from(this.players.values())[0];
      console.log(`🔍 COLLISION CHECK: Player ${firstPlayer.id} at (${firstPlayer.x.toFixed(1)}, ${firstPlayer.y.toFixed(1)}), length=${firstPlayer.length}, segments=${firstPlayer.segments.length}`);
      console.log(`🔍 FOOD COUNT: ${this.foodManager.getFoodCount()} food items available`);
      
      const allFood = this.foodManager.getAllFood();
      if (allFood.length > 0) {
        let nearestFood = null;
        let nearestDistance = Infinity;
        for (const food of allFood) {
          const distance = Math.sqrt(
            Math.pow(firstPlayer.x - food.x, 2) + Math.pow(firstPlayer.y - food.y, 2)
          );
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestFood = food;
          }
        }
        if (nearestFood) {
          console.log(`🔍 NEAREST FOOD: at (${nearestFood.x}, ${nearestFood.y}), distance: ${nearestDistance.toFixed(1)}, collision radius: ${(nearestFood.size / 2 + GRID_SIZE * 2).toFixed(1)}`);
        }
      }
    }
    
    // Note: Food collision detection is now handled by eat_attempt messages
    // This method is kept for potential future collision types (walls, other players, etc.)
  }

  private maintainFood(): void {
    // Ensure we always have MAX_FOOD items
    const newFood = this.foodManager.maintainFoodCount();
    
    // Broadcast any new food that was spawned
    for (const food of newFood) {
      this.broadcastFoodUpdate('spawn', food);
    }
  }

  private broadcastFoodUpdate(action: 'spawn' | 'despawn', food: FoodItem): void {
    const message: FoodMessage = {
      type: 'food',
      action,
      food,
      timestamp: Date.now()
    };

    console.log(`📡 Broadcasting food ${action} message for ${food.id} to ${this.players.size} players`);
    this.broadcast(message);
  }

  public getState(): StateMessage {
    const players: PlayerState[] = Array.from(this.players.values()).map(player => ({
      id: player.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      length: player.length,
      segments: player.segments.slice(),
      isBoosting: player.isBoosting,
      score: player.score
    }));

    return {
      type: 'state',
      players,
      food: this.foodManager.getAllFood(),
      timestamp: Date.now()
    };
  }

  public broadcast(message: any, excludePlayerId?: string): void {
    for (const player of this.players.values()) {
      if (excludePlayerId && player.id === excludePlayerId) continue;
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(message));
      }
    }
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public handleEatAttempt(playerId: string, foodId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      console.log(`❌ Eat attempt failed: Player ${playerId} not found`);
      return;
    }

    // Convert player to FoodManager format
    const playerForValidation = {
      id: player.id,
      x: player.x,
      y: player.y,
      segments: player.segments,
      length: player.length,
      score: player.score
    };

    // Validate the eat attempt
    const result = this.foodManager.validateEatAttempt(playerForValidation, foodId);
    
    if (result.success && result.food) {
      // Update player stats
      player.score += result.food.score;
      player.length += result.food.growthAmount;
      
      // IMMEDIATELY update segments to match new length in the same tick
      this.updatePlayerSegments(player);
      
      console.log(`✅ Food eaten validated: Player ${playerId} ate food ${foodId}, new length: ${player.length}`);
      
      // Broadcast food_eaten message to all clients
      const foodEatenMessage: FoodEatenMessage = {
        type: 'food_eaten',
        foodId,
        by: playerId,
        timestamp: Date.now()
      };
      this.broadcast(foodEatenMessage);
      
      // Broadcast food despawn
      this.broadcastFoodUpdate('despawn', result.food);
      
      // Broadcast new food spawn if one was created
      if (result.newFood) {
        this.broadcastFoodUpdate('spawn', result.newFood);
      }
    } else {
      console.log(`❌ Food eaten validation failed: Player ${playerId} cannot eat food ${foodId}`);
    }
  }
}

// Initialize game world
const gameWorld = new GameWorld();

// Create HTTP server for health endpoint
const server = createServer((req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  
  // Enable CORS for client requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      players: gameWorld.getPlayerCount()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`New player connected: ${playerId} from ${req.socket.remoteAddress}`);
  
  // Add player to world
  const player = gameWorld.addPlayer(playerId, ws);
  
  // Send hello message with player ID and spawn position
  const helloMessage: HelloMessage = {
    type: 'hello',
    playerId,
    spawnPosition: { x: player.x, y: player.y },
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(helloMessage));

  // Send initial world state
  ws.send(JSON.stringify(gameWorld.getState()));

  // Broadcast spawn to other players
  const spawnMessage: SpawnMessage = {
    type: 'spawn',
    playerId,
    position: { x: player.x, y: player.y },
    timestamp: Date.now()
  };
  gameWorld.broadcast(spawnMessage, playerId);
  
  ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Debug: Log all message types
        if (message.type !== 'input') {
          console.log(`📨 Received message from ${playerId}: type=${message.type}`);
        }
        
        if (message.type === 'input') {
           const inputMessage = message as InputMessage;
           console.log(`📥 Received input from ${playerId}: angle=${(inputMessage.angle * 180 / Math.PI).toFixed(1)}°, throttle=${inputMessage.throttle}`);
           gameWorld.updatePlayerInput(playerId, {
             angle: inputMessage.angle,
             throttle: inputMessage.throttle
           });
         } else if (message.type === 'eat_attempt') {
           const eatMessage = message as EatAttemptMessage;
           console.log(`🍎 Received eat_attempt from ${playerId}: foodId=${eatMessage.foodId}`);
           gameWorld.handleEatAttempt(playerId, eatMessage.foodId);
         } else if (message.type === 'debug') {
           console.log(`🐛 [${playerId}] ${message.message}`);
         } else {
           console.log(`❓ Unknown message type from ${playerId}: ${message.type}`);
         }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
  
  ws.on('close', () => {
    console.log(`Player disconnected: ${playerId}`);
    gameWorld.removePlayer(playerId);
    
    // Broadcast player death to remaining players
    const dieMessage: DieMessage = {
      type: 'die',
      playerId,
      reason: 'disconnected',
      timestamp: Date.now()
    };
    gameWorld.broadcast(dieMessage);
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${playerId}:`, error);
  });
});

// Game loop - 30Hz tick rate
let lastTickTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const deltaTime = now - lastTickTime;
  lastTickTime = now;
  
  // Update world state
  gameWorld.tick(deltaTime);
  
  // Broadcast state to all players
  const stateMessage = gameWorld.getState();
  gameWorld.broadcast(stateMessage);
}, TICK_INTERVAL);

server.listen(PORT, () => {
  console.log(`🚀 Snake game server listening on :${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
  console.log(`🎮 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`⚡ Server tick rate: ${TICK_RATE}Hz`);
});