import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { FoodManager } from './game/FoodManager';

const PORT = 8080;
const TICK_RATE = 30; // 30Hz server tick rate
const TICK_INTERVAL = 1000 / TICK_RATE;

// Game constants (shared with client)
const WORLD_WIDTH = 9000; // Reduced from 18000 (half size)
const WORLD_HEIGHT = 9000; // Reduced from 18000 (half size)
const GRID_SIZE = 20;
const ARENA_CENTER_X = WORLD_WIDTH / 2;
const ARENA_CENTER_Y = WORLD_HEIGHT / 2;
const ARENA_RADIUS = Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2 - 500;
const BASE_SPEED = 200; // pixels per second
const BOOST_MULTIPLIER = 1.5;
const SNAKE_INITIAL_LENGTH = 3;
const MAX_FOOD = 500; // Optimized count for performance and good food density

// Message types
interface BaseMessage { type: string; timestamp?: number }
interface HelloMessage extends BaseMessage { type: 'hello'; playerId: string; spawnPosition: { x: number; y: number } }
interface StateMessage extends BaseMessage { type: 'state'; players: PlayerState[]; food: FoodItem[] }
// FoodMessage removed - replaced by food_state and food_update events
interface SpawnMessage extends BaseMessage { type: 'spawn'; playerId: string; position: { x: number; y: number } }
interface DieMessage extends BaseMessage { type: 'die'; playerId: string; reason: string }
interface FoodEatenMessage extends BaseMessage { type: 'food_eaten'; foodId: string; by: string }

// InputMessage and EatAttemptMessage interfaces removed - only used for incoming events (typed inline)

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
  private io: any; // Socket.io server instance

  constructor(socketIoServer?: any) {
    this.foodManager = new FoodManager(
      MAX_FOOD,
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y },
      ARENA_RADIUS,
      GRID_SIZE
    );
    this.io = socketIoServer;
  }

  public addPlayer(playerId: string): Player {
    // Random spawn position within arena
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.random() * (ARENA_RADIUS * 0.3); // Spawn in inner 30% of arena
    const x = ARENA_CENTER_X + Math.cos(angle) * radius;
    const y = ARENA_CENTER_Y + Math.sin(angle) * radius;

    const player: Player = {
      id: playerId,
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

    // Optional: other collision checks (walls, etc.)
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
    // Add new head position
    player.segments.unshift({ x: player.x, y: player.y });

    // Maintain segment count based on length
    while (player.segments.length > player.length) {
      player.segments.pop();
    }
  }

  private checkCollisions(): void {
    // Server-authoritative collision detection with SPATIAL PARTITIONING
    // Only checks food in nearby grid cells - O(nearby) instead of O(all)
    
    for (const player of this.players.values()) {
      if (!player.segments || player.segments.length === 0) continue;
      
      const head = player.segments[0];
      
      // Collision constants - INCREASED for more forgiving detection
      const FOOD_RADIUS = 20;  // Increased from 15
      const SNAKE_EAT_RADIUS = 50;  // Increased from 25 for much more forgiving collision
      const collisionDistance = FOOD_RADIUS + SNAKE_EAT_RADIUS;  // Now 70px instead of 40px
      const collisionDistanceSquared = collisionDistance * collisionDistance;
      const searchRadius = 300; // Increased from 200px to find more food candidates
      
      // SPATIAL PARTITIONING: Only get food near the player's head
      // This is MUCH faster than checking all food!
      const nearbyFood = this.foodManager.getFoodNearPosition(head.x, head.y, searchRadius);
      
      // Debug: Log how many food items we're checking
      if (nearbyFood.length > 0 && Math.random() < 0.01) {
        console.log(`🔍 Checking ${nearbyFood.length} food items near player ${player.id}`);
      }
      
      // Find closest food among nearby candidates
      let closestFood: typeof nearbyFood[0] | null = null;
      let closestDistanceSquared = Infinity;
      
      for (const food of nearbyFood) {
        // Ultra-fast distance check (squared distance, no sqrt)
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const distanceSquared = dx * dx + dy * dy;
        
        // Track closest food
        if (distanceSquared < closestDistanceSquared) {
          closestDistanceSquared = distanceSquared;
          closestFood = food;
        }
      }
      
      // Debug: Log near misses to understand why collisions are missed
      if (closestFood && closestDistanceSquared > collisionDistanceSquared && closestDistanceSquared < collisionDistanceSquared * 4) {
        const distance = Math.sqrt(closestDistanceSquared);
        console.log(`🟡 NEAR MISS: Player ${player.id} passed food at ${distance.toFixed(1)}px (collision radius: ${collisionDistance}px)`);
      }
      
      // Only process collision with the closest food if it's within range
      if (closestFood && closestDistanceSquared <= collisionDistanceSquared) {
        const distance = Math.sqrt(closestDistanceSquared);
        const food = closestFood;

        console.log(`🍎 COLLISION! Player ${player.id} ate ${food.type} food at ${distance.toFixed(1)}px (radius: ${collisionDistance}px, checked ${nearbyFood.length} nearby)`);
        
        // Update player state
        player.length += food.growthAmount;
        player.score += food.score;
        
        // Remove food and spawn replacement
        this.foodManager.removeFood(food.id);
        const newFood = this.foodManager.spawnFood();
        
        // Broadcast food_eaten event
        if (this.io) {
          const foodEatenMessage: FoodEatenMessage = {
            type: 'food_eaten',
            foodId: food.id,
            by: player.id,
            timestamp: Date.now()
          };
          this.io.emit('food_eaten', foodEatenMessage);
          
          // Broadcast food update (combined despawn + spawn)
          const foodUpdateMsg = {
            type: 'food_update',
            despawn: food.id,
            spawn: newFood,
            timestamp: Date.now()
          };
          console.log(`📡 Food update: despawn ${food.id}, spawn ${newFood.id}`);
          this.io.emit('food_update', foodUpdateMsg);
        } else {
          console.error(`❌ io not available - cannot broadcast food events!`);
        }
      }
    }
  }

  private maintainFood(): void {
    this.foodManager.maintainFoodCount();
    // Food spawns/despawns broadcasting is handled externally
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

  public getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getFoodManager(): FoodManager {
    return this.foodManager;
  }
}

// Express + HTTP + Socket.IO server
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3000' },
  // Increase timeouts to prevent disconnections during heavy server load
  pingTimeout: 60000,     // 60 seconds - wait this long for pong before considering connection dead
  pingInterval: 25000,    // 25 seconds - send ping every 25 seconds
  upgradeTimeout: 30000,  // 30 seconds - wait this long for upgrade to complete
  // Allow time for slow responses during collision detection with 2500 food items
  connectTimeout: 45000   // 45 seconds - max time to wait for connection
});

// Initialize game world with socket.io instance for broadcasting
const gameWorld = new GameWorld(io);

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), players: gameWorld.getPlayerCount() });
});

io.on('connection', (socket) => {
  const playerId = socket.id;
  console.log(`✅ Player connected: ${playerId} (total players: ${gameWorld.getPlayerCount() + 1})`);
  const player = gameWorld.addPlayer(playerId);
  
  // Monitor connection health (logging disabled for performance)
  // socket.on('ping', () => {
  //   console.log(`📡 Ping received from ${playerId}`);
  // });

  const helloMessage: HelloMessage = { type: 'hello', playerId, spawnPosition: { x: player.x, y: player.y }, timestamp: Date.now() };
  socket.emit('hello', helloMessage);
  
  const initialState = gameWorld.getState();
  console.log(`📤 Sending initial state to ${playerId}: ${initialState.players.length} players, ${initialState.food.length} food items`);
  socket.emit('state', initialState);

  const spawnMessage: SpawnMessage = { type: 'spawn', playerId, position: { x: player.x, y: player.y }, timestamp: Date.now() };
  socket.broadcast.emit('spawn', spawnMessage);

  socket.on('input', (data: { angle: number; throttle: number }) => {
    gameWorld.updatePlayerInput(playerId, { angle: data.angle, throttle: data.throttle });
  });

  // eat_attempt handler removed - server handles all collision detection automatically
  // socket.on('eat_attempt', (data: { foodId: string }) => {
  //   // Server's checkCollisions() handles all collision detection
  // });

  socket.on('disconnect', (reason: string) => {
    console.log(`❌ Player disconnected: ${playerId}, reason: ${reason} (remaining players: ${gameWorld.getPlayerCount() - 1})`);
    gameWorld.removePlayer(playerId);
    const dieMessage: DieMessage = { type: 'die', playerId, reason: 'disconnected', timestamp: Date.now() };
    io.emit('die', dieMessage);
  });
});

// Game loop - 30Hz tick rate with performance monitoring
let lastTickTime = Date.now();
let slowTickCount = 0;
let tickCounter = 0;
let foodSyncCounter = 0;
const FOOD_SYNC_INTERVAL = 15; // Full food sync every 15 ticks (~500ms at 30Hz)

setInterval(() => {
  const tickStart = Date.now();
  const deltaTime = tickStart - lastTickTime;
  lastTickTime = tickStart;
  
  // Update world state
  gameWorld.tick(deltaTime);
  
  // Broadcast state to all players
  const stateMessage = gameWorld.getState();
  io.emit('state', stateMessage);
  
  // Full food sync every 500ms to ensure client stays in sync
  foodSyncCounter++;
  if (foodSyncCounter >= FOOD_SYNC_INTERVAL) {
    const foodList = stateMessage.food;
    const actualFoodCount = gameWorld.getFoodManager().getFoodCount();
    
    // DEBUG: Warn if food count doesn't match
    if (foodList.length !== actualFoodCount) {
      console.error(`⚠️ FOOD COUNT MISMATCH! State has ${foodList.length}, FoodManager has ${actualFoodCount}`);
    }
    
    console.log(`🔄 Full food sync: broadcasting ${foodList.length} food items (expected: ${MAX_FOOD}) to ${io.engine.clientsCount} clients`);
    io.emit('food_state', { foods: foodList, timestamp: Date.now() });
    foodSyncCounter = 0;
  }
  
  // Monitor tick performance
  const tickDuration = Date.now() - tickStart;
  tickCounter++;
  
  // Warn if tick takes longer than budget (33ms for 30Hz)
  if (tickDuration > TICK_INTERVAL) {
    slowTickCount++;
    console.warn(`⚠️ Slow tick #${tickCounter}: ${tickDuration}ms (budget: ${TICK_INTERVAL}ms)`);
  }
  
  // Report performance every 300 ticks (~10 seconds at 30Hz)
  if (tickCounter % 300 === 0) {
    const slowPercentage = ((slowTickCount / 300) * 100).toFixed(1);
    console.log(`📊 Performance: ${slowPercentage}% slow ticks in last 10s (${slowTickCount}/300)`);
    console.log(`   Active food: ${stateMessage.food.length}, Active players: ${stateMessage.players.length}`);
    slowTickCount = 0;
  }
}, TICK_INTERVAL);

httpServer.listen(PORT, () => {
  console.log(`🚀 Snake game server listening on :${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
  console.log(`🎮 Socket.IO endpoint: http://localhost:${PORT}`);
  console.log(`⚡ Server tick rate: ${TICK_RATE}Hz`);
});