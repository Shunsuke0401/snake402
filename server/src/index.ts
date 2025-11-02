import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';

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
  private food: Map<string, FoodItem> = new Map();
  private lastTickTime: number = Date.now();

  constructor() {
    this.initializeFood();
  }

  private initializeFood(): void {
    for (let i = 0; i < MAX_FOOD; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    const id = `food_${Date.now()}_${Math.random()}`;
    
    // Random position within arena using uniform distribution
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.sqrt(Math.random()) * (ARENA_RADIUS - 50);
    const x = ARENA_CENTER_X + Math.cos(angle) * radius;
    const y = ARENA_CENTER_Y + Math.sin(angle) * radius;

    // 90% small food, 10% large food
    const isLarge = Math.random() < 0.1;
    const foodType = isLarge ? 'large' : 'small';

    const food: FoodItem = {
      id,
      x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(y / GRID_SIZE) * GRID_SIZE,
      type: foodType,
      color: isLarge ? 0x9C27B0 : 0xFF5722,
      size: isLarge ? 40 : 20,
      score: isLarge ? 25 : 10,
      growthAmount: isLarge ? 2 : 1
    };

    this.food.set(id, food);
  }

  public addPlayer(playerId: string, ws: WebSocket): Player {
    // Random spawn position within arena
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.random() * (ARENA_RADIUS * 0.3); // Spawn in inner 30% of arena
    const x = ARENA_CENTER_X + Math.cos(angle) * radius;
    const y = ARENA_CENTER_Y + Math.sin(angle) * radius;

    // Initialize with random direction
    const initialAngle = Math.random() * 2 * Math.PI;

    const player: Player = {
      id: playerId,
      ws,
      x,
      y,
      angle: initialAngle,
      targetAngle: initialAngle, // Initialize targetAngle to match angle so player moves immediately
      speed: BASE_SPEED,
      isBoosting: false,
      segments: [],
      length: SNAKE_INITIAL_LENGTH,
      score: 0,
      lastInput: { angle: initialAngle, throttle: 0 },
      lastInputTime: Date.now()
    };

    // Initialize segments
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      player.segments.push({
        x: x - i * GRID_SIZE * Math.cos(player.angle),
        y: y - i * GRID_SIZE * Math.sin(player.angle)
      });
    }

    console.log(`👤 Player ${playerId} spawned at (${x.toFixed(1)}, ${y.toFixed(1)}) with angle ${(initialAngle * 180 / Math.PI).toFixed(1)}°`);
    this.players.set(playerId, player);
    return player;
  }

  public removePlayer(playerId: string): void {
    this.players.delete(playerId);
  }

  public updatePlayerInput(playerId: string, input: { angle: number; throttle: number }): void {
    const player = this.players.get(playerId);
    if (player) {
      const oldAngle = player.targetAngle;
      const oldBoosting = player.isBoosting;
      
      player.lastInput = input;
      player.lastInputTime = Date.now();
      player.targetAngle = input.angle;
      player.isBoosting = input.throttle > 0;
      
      // Debug log occasionally to verify input is being processed
      if (Date.now() % 2000 < TICK_INTERVAL * 2) {
        console.log(`🎮 Input update for ${playerId}: angle=${(input.angle * 180 / Math.PI).toFixed(1)}° (was ${(oldAngle * 180 / Math.PI).toFixed(1)}°), throttle=${input.throttle}, boosting=${player.isBoosting}`);
      }
    } else {
      console.warn(`⚠️ updatePlayerInput called for unknown player: ${playerId}`);
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
    const oldX = player.x;
    const oldY = player.y;
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
      
      // Debug: Log if player isn't moving (potential issue)
      const actualMove = Math.sqrt(Math.pow(player.x - oldX, 2) + Math.pow(player.y - oldY, 2));
      if (actualMove < 0.1 && Date.now() % 2000 < TICK_INTERVAL * 2) {
        console.warn(`⚠️ Player ${player.id} not moving: pos=(${player.x.toFixed(1)}, ${player.y.toFixed(1)}), angle=${(player.angle * 180 / Math.PI).toFixed(1)}°, speed=${player.speed.toFixed(1)}, distance=${actualMove.toFixed(3)}`);
      }
    } else {
      // Player hit boundary - log occasionally
      if (Date.now() % 2000 < TICK_INTERVAL * 2) {
        console.log(`🚧 Player ${player.id} hit boundary at (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
      }
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

  private getAngleDifference(target: number, current: number): number {
    let diff = target - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  private checkCollisions(): void {
    for (const player of this.players.values()) {
      // Debug: Log detailed collision check for each player every 2 seconds
      const debugLog = Date.now() % 2000 < TICK_INTERVAL * 2;
      
      if (debugLog) {
        console.log(`🔍 COLLISION CHECK: Player ${player.id} at (${player.x.toFixed(1)}, ${player.y.toFixed(1)}), angle=${(player.angle * 180 / Math.PI).toFixed(1)}°, speed=${player.speed.toFixed(1)}`);
        console.log(`🔍 FOOD COUNT: ${this.food.size} food items available`);
        console.log(`🔍 PLAYER STATE: length=${player.length}, segments=${player.segments.length}, boosting=${player.isBoosting}`);
      }
      
      // Check food collisions
      let foodChecked = 0;
      let nearestFoodDistance = Infinity;
      let nearestFoodId: string | null = null;
      
      for (const [foodId, food] of this.food.entries()) {
        foodChecked++;
        
        const distance = Math.sqrt(
          Math.pow(player.x - food.x, 2) + Math.pow(player.y - food.y, 2)
        );

        // More generous collision detection - use larger radius to ensure collisions work
        const collisionRadius = food.size / 2 + GRID_SIZE * 2.5; // Increased from 2.0 to 2.5 for better detection
        
        // Track nearest food for debugging
        if (distance < nearestFoodDistance) {
          nearestFoodDistance = distance;
          nearestFoodId = foodId;
        }
        
        // Log nearest food details when debugging
        if (debugLog && foodChecked <= 5) {
          console.log(`🔍 FOOD ${foodChecked}: id=${foodId} at (${food.x.toFixed(1)}, ${food.y.toFixed(1)}), distance=${distance.toFixed(1)}, radius=${collisionRadius.toFixed(1)}, would_collide=${distance <= collisionRadius}`);
        }
        
        // Log if very close but not colliding (potential issue indicator)
        if (distance <= collisionRadius + 10 && distance > collisionRadius) {
          console.log(`⚠️ NEAR MISS: Player ${player.id} almost hit food ${foodId}: distance=${distance.toFixed(2)}, radius=${collisionRadius.toFixed(2)}, diff=${(distance - collisionRadius).toFixed(2)}`);
        }
        
        if (distance <= collisionRadius) {
          // Player ate food
          const oldLength = player.length;
          const oldSegmentCount = player.segments.length;
          console.log(`🍎 FOOD COLLISION: Player ${player.id} ate food ${foodId} at distance ${distance.toFixed(2)} (collision radius: ${collisionRadius.toFixed(2)})`);
          console.log(`🍎 PLAYER POS: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
          console.log(`🍎 FOOD POS: (${food.x.toFixed(1)}, ${food.y.toFixed(1)})`);
          console.log(`🍎 BEFORE: length=${oldLength}, segments=${oldSegmentCount}, growth=${food.growthAmount}`);
          
          player.score += food.score;
          player.length += food.growthAmount;
          
          // IMMEDIATELY update segments to match new length in the same tick
          this.updatePlayerSegments(player);
          
          console.log(`🍎 AFTER: length=${player.length}, segments=${player.segments.length}`);
          console.log(`🍎 FOOD REMOVED: ${foodId} at (${food.x}, ${food.y})`);
          console.log(`🍎 Food object before broadcast: id=${food.id}, x=${food.x}, y=${food.y}, size=${food.size}`);
          
          // IMPORTANT: Broadcast BEFORE deleting from Map to ensure food object is valid
          // The food object itself is still valid even after Map.delete()
          this.broadcastFoodUpdate('despawn', food);
          
          // Remove food from Map after broadcasting
          this.food.delete(foodId);
          
          // Spawn new food
          this.spawnFood();
          break; // Only eat one food per tick
        }
      }
      
      // Log nearest food summary when debugging
      if (debugLog && nearestFoodId) {
        const nearestFood = this.food.get(nearestFoodId);
        if (nearestFood) {
          const radius = nearestFood.size / 2 + GRID_SIZE * 2.5;
          console.log(`🔍 NEAREST: Food ${nearestFoodId} at distance ${nearestFoodDistance.toFixed(1)}px (radius: ${radius.toFixed(1)}px, ${nearestFoodDistance <= radius ? 'WOULD COLLIDE' : 'too far'})`);
        }
      }
    }
  }

  private maintainFood(): void {
    // Ensure we always have MAX_FOOD items
    while (this.food.size < MAX_FOOD) {
      this.spawnFood();
    }
  }

  private broadcastFoodUpdate(action: 'spawn' | 'despawn', food: FoodItem): void {
    const message: FoodMessage = {
      type: 'food',
      action,
      food,
      timestamp: Date.now()
    };

    console.log(`📡 Broadcasting food ${action} message for ${food.id} (pos: ${food.x.toFixed(1)}, ${food.y.toFixed(1)}, size: ${food.size}) to ${this.players.size} players`);
    console.log(`📡 Food message payload:`, JSON.stringify({ type: message.type, action: message.action, foodId: food.id, foodX: food.x, foodY: food.y }));
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
      food: Array.from(this.food.values()),
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
        
        if (message.type === 'input') {
           const inputMessage = message as InputMessage;
           console.log(`📥 Received input from ${playerId}: angle=${(inputMessage.angle * 180 / Math.PI).toFixed(1)}°, throttle=${inputMessage.throttle}`);
           gameWorld.updatePlayerInput(playerId, {
             angle: inputMessage.angle,
             throttle: inputMessage.throttle
           });
         } else if (message.type === 'debug') {
           console.log(`🐛 [${playerId}] ${message.message}`);
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
  console.log(`✅ WS server listening on :${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
  console.log(`🎮 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`⚡ Server tick rate: ${TICK_RATE}Hz`);
});