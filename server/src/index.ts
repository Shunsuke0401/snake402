import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { FoodManager } from './game/FoodManager';

const PORT = 8080;
const TICK_RATE = 30; // 30Hz server tick rate

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
// FoodEatenMessage removed - redundant with food_update event

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
    // Optimized for many players - no logging, minimal allocations
    
    // Pre-define constants outside loop for performance
    const FOOD_RADIUS = 20;
    const SNAKE_EAT_RADIUS = 50;
    const collisionDistance = FOOD_RADIUS + SNAKE_EAT_RADIUS; // 70px
    const collisionDistanceSquared = collisionDistance * collisionDistance; // 4900
    const searchRadius = 300;
    
    for (const player of this.players.values()) {
      if (!player.segments || player.segments.length === 0) continue;
      
      // CRITICAL: Use player.x/y for head position (always current) instead of segments[0]
      // Segments array might lag by 1 tick or have stale data with long snakes
      // Using player.x/y ensures we're checking the actual current head position
      const head = { x: player.x, y: player.y };
      
      // SPATIAL PARTITIONING: Only get food near the player's head
      const nearbyFood = this.foodManager.getFoodNearPosition(head.x, head.y, searchRadius);
      
      // Early exit if no nearby food
      if (nearbyFood.length === 0) continue;
      
      // Find closest food with early exit optimization
      let closestFood = null;
      let closestDistanceSquared = collisionDistanceSquared; // Only check within collision range
      
      for (const food of nearbyFood) {
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const distanceSquared = dx * dx + dy * dy;
        
        // Only track if closer AND within collision range
        if (distanceSquared < closestDistanceSquared) {
          closestDistanceSquared = distanceSquared;
          closestFood = food;
        }
      }
      
      // Process collision if found
      if (closestFood) {
        // Update player state (no allocations)
        player.length += closestFood.growthAmount;
        player.score += closestFood.score;
        
        // Remove old food, spawn new food
        this.foodManager.removeFood(closestFood.id);
        const newFood = this.foodManager.spawnFood();
        
        // Debug logging for long snakes (only if length > 20 to avoid spam)
        if (player.length > 20) {
          const distance = Math.sqrt(closestDistanceSquared);
          console.log(`🍎 COLLISION: Player ${player.id} (length: ${player.length}) ate food at ${distance.toFixed(1)}px`);
        }
        
        // Broadcast update (single message, no logging for performance)
        if (this.io) {
          this.io.emit('food_update', {
            type: 'food_update',
            despawn: closestFood.id,
            spawn: newFood,
            timestamp: Date.now()
          });
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
      food: this.foodManager.getAllFood(), // Full food list for initial connection
      timestamp: Date.now()
    };
  }

  // Lightweight state without food for regular 30Hz updates (95% bandwidth reduction!)
  public getPlayersOnlyState(): StateMessage {
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
      food: [], // Empty! Clients get food from food_state sync every 2 seconds
      timestamp: Date.now()
    };
  }

  // Get visible food and players for a specific player (visibility culling)
  public getVisibleStateForPlayer(playerId: string, viewRadius: number = 2000): {
    player: PlayerState;
    foods: Array<{ id: string; x: number; y: number; color: number; size: number; type: string }>;
    others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number }>;
  } | null {
    const player = this.players.get(playerId);
    if (!player || !player.segments || player.segments.length === 0) {
      return null;
    }

    const head = player.segments[0];
    const viewRadiusSquared = viewRadius * viewRadius;

    // Get nearby food using spatial partitioning
    const nearbyFood = this.foodManager.getFoodNearPosition(head.x, head.y, viewRadius);
    const visibleFoods = nearbyFood
      .filter(food => {
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        return (dx * dx + dy * dy) <= viewRadiusSquared;
      })
      .map(food => ({
        id: food.id,
        x: food.x,
        y: food.y,
        color: food.color,
        size: food.size,
        type: food.type
      }));

    // Get nearby players
    const visiblePlayers = Array.from(this.players.values())
      .filter(p => p.id !== playerId && p.segments && p.segments.length > 0)
      .filter(p => {
        const dx = head.x - p.segments[0].x;
        const dy = head.y - p.segments[0].y;
        return (dx * dx + dy * dy) <= viewRadiusSquared;
      })
      .map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        length: p.length,
        score: p.score
      }));

    return {
      player: {
        id: player.id,
        x: player.x,
        y: player.y,
        angle: player.angle,
        length: player.length,
        segments: player.segments.slice(),
        isBoosting: player.isBoosting,
        score: player.score
      },
      foods: visibleFoods,
      others: visiblePlayers
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
  connectTimeout: 45000,  // 45 seconds - max time to wait for connection
  // Performance optimizations
  perMessageDeflate: true, // Enable compression
  maxHttpBufferSize: 1e7   // 10MB max buffer size
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
  
  // Track connected player for batching
  connectedPlayerIds.add(playerId);
  
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
    connectedPlayerIds.delete(playerId); // Remove from tracking
    const dieMessage: DieMessage = { type: 'die', playerId, reason: 'disconnected', timestamp: Date.now() };
    io.emit('die', dieMessage);
  });
});

// High-precision game loop - no event-loop drift
let lastTickTime = performance.now();
let slowTickCount = 0;
let tickCounter = 0;
let foodSyncCounter = 0;
const FOOD_SYNC_INTERVAL = 60; // Full food sync every 60 ticks (2 seconds at 30Hz)
const TICK_BUDGET_MS = 1000 / TICK_RATE; // ~33.33ms for 30Hz

// Track connected player IDs for efficient batching
const connectedPlayerIds = new Set<string>();

function gameLoop(): void {
  const now = performance.now();
  const delta = now - lastTickTime;

  if (delta >= TICK_BUDGET_MS) {
    const tickStart = performance.now();
    
    // Update world state
    gameWorld.tick(delta);
    
    // Gather all player states with visibility culling
    const playerStates: Array<{
      id: string;
      x: number;
      y: number;
      angle: number;
      length: number;
      score: number;
      isBoosting: boolean;
      foods: Array<{ id: string; x: number; y: number; color: number; size: number; type: string }>;
      others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number }>;
    }> = [];

    for (const playerId of connectedPlayerIds) {
      const visibleState = gameWorld.getVisibleStateForPlayer(playerId, 2000);
      if (visibleState) {
        playerStates.push({
          id: visibleState.player.id,
          x: visibleState.player.x,
          y: visibleState.player.y,
          angle: visibleState.player.angle,
          length: visibleState.player.length,
          score: visibleState.player.score,
          isBoosting: visibleState.player.isBoosting,
          foods: visibleState.foods,
          others: visibleState.others
        });
      }
    }
    
    // Batch all state updates into a single emit per player
    // Send personalized state to each player (only their visible area)
    for (const playerState of playerStates) {
      const socket = io.sockets.sockets.get(playerState.id);
      if (socket && socket.connected) {
        socket.emit('state_batch', {
          tick: Date.now(),
          player: {
            id: playerState.id,
            x: playerState.x,
            y: playerState.y,
            angle: playerState.angle,
            length: playerState.length,
            segments: gameWorld.getPlayer(playerState.id)?.segments || [],
            isBoosting: playerState.isBoosting,
            score: playerState.score
          },
          foods: playerState.foods,
          others: playerState.others
        });
      }
    }
    
    // Full food sync every 2 seconds (broadcast to all)
    foodSyncCounter++;
    if (foodSyncCounter >= FOOD_SYNC_INTERVAL) {
      const foodList = gameWorld.getFoodManager().getAllFood();
      const actualFoodCount = gameWorld.getFoodManager().getFoodCount();
      
      if (foodList.length !== actualFoodCount) {
        console.error(`⚠️ FOOD COUNT MISMATCH! State has ${foodList.length}, FoodManager has ${actualFoodCount}`);
      }
      
      if (tickCounter % 300 === 0) {
        console.log(`🔄 Full food sync: broadcasting ${foodList.length} food items to ${io.engine.clientsCount} clients`);
      }
      io.emit('food_state', { foods: foodList, timestamp: Date.now() });
      foodSyncCounter = 0;
    }
    
    // Performance monitoring
    const tickDuration = performance.now() - tickStart;
    tickCounter++;
    lastTickTime = now;
    
    if (tickDuration > TICK_BUDGET_MS) {
      slowTickCount++;
      if (tickDuration > 50) { // Only warn for very slow ticks (>50ms)
        console.warn(`⚠️ Slow tick #${tickCounter}: ${tickDuration.toFixed(2)}ms (budget: ${TICK_BUDGET_MS.toFixed(2)}ms)`);
      }
    }
    
    if (tickCounter % 300 === 0) {
      const slowPercentage = ((slowTickCount / 300) * 100).toFixed(1);
      const avgTickTime = tickCounter > 0 ? (tickDuration).toFixed(2) : '0.00';
      console.log(`📊 Performance: ${slowPercentage}% slow ticks, avg: ${avgTickTime}ms`);
      console.log(`   Active food: ${gameWorld.getFoodManager().getFoodCount()}, Active players: ${gameWorld.getPlayerCount()}`);
      slowTickCount = 0;
    }
  }
  
  // Use setImmediate to prevent blocking but maintain precision
  setImmediate(gameLoop);
}

// Start the game loop
gameLoop();

httpServer.listen(PORT, () => {
  console.log(`🚀 Snake game server listening on :${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
  console.log(`🎮 Socket.IO endpoint: http://localhost:${PORT}`);
  console.log(`⚡ Server tick rate: ${TICK_RATE}Hz`);
});