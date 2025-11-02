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
const SNAKE_COLLISION_RADIUS = 20; // Radius for snake-to-snake collision detection (head vs body)
const SNAKE_COLLISION_RADIUS_SQ = SNAKE_COLLISION_RADIUS * SNAKE_COLLISION_RADIUS; // 400

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
  nickname: string; // Player's display name
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
  alive: boolean; // Track if player is alive
}

// World state
class GameWorld {
  private players: Map<string, Player> = new Map();
  private foodManager: FoodManager;
  private io: any; // Socket.io server instance
  private bots: Set<string> = new Set(); // Track which players are AI bots

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
    // Random spawn position within arena, avoiding static snakes
    let attempts = 0;
    let x = ARENA_CENTER_X;
    let y = ARENA_CENTER_Y;
    let spawnAngle = Math.random() * 2 * Math.PI;
    let validSpawn = false;
    
    // Try to find a spawn position that's not too close to any static snake
    while (attempts < 50 && !validSpawn) {
      const angle = Math.random() * 2 * Math.PI;
      const radius = Math.random() * (ARENA_RADIUS * 0.3); // Spawn in inner 30% of arena
      x = ARENA_CENTER_X + Math.cos(angle) * radius;
      y = ARENA_CENTER_Y + Math.sin(angle) * radius;
      spawnAngle = Math.random() * 2 * Math.PI;
      
      // Check if too close to any static snake
      let tooClose = false;
      for (const other of this.players.values()) {
        if (other.id.startsWith('static_snake_')) {
          const dx = x - other.x;
          const dy = y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 300) { // Need at least 300px clearance from static snakes
            tooClose = true;
            break;
          }
        }
      }
      
      if (!tooClose) {
        validSpawn = true;
      }
      attempts++;
    }
    
    // If we couldn't find a safe spot, spawn anyway (collision will be detected)
    if (!validSpawn) {
      const angle = Math.random() * 2 * Math.PI;
      const radius = Math.random() * (ARENA_RADIUS * 0.3);
      x = ARENA_CENTER_X + Math.cos(angle) * radius;
      y = ARENA_CENTER_Y + Math.sin(angle) * radius;
      spawnAngle = Math.random() * 2 * Math.PI;
    }

    const player: Player = {
      id: playerId,
      nickname: 'Player', // Default nickname, will be updated by client
      x,
      y,
      angle: spawnAngle,
      targetAngle: spawnAngle,
      speed: BASE_SPEED,
      isBoosting: false,
      segments: [],
      length: SNAKE_INITIAL_LENGTH,
      score: 0,
      lastInput: { angle: spawnAngle, throttle: 0 },
      lastInputTime: Date.now(),
      alive: true
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
    this.bots.delete(playerId); // Remove from bots set if it was a bot
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
    // Update all alive players
    for (const player of this.players.values()) {
      if (player.alive) {
        // Skip static snakes (they have speed 0)
        if (player.speed === 0 || player.id.startsWith('static_snake_')) {
          continue; // Don't update static test snakes
        }
        
        // Update bot AI before movement
        if (this.bots.has(player.id)) {
          this.updateBotAI(player);
        }
        this.updatePlayer(player, deltaTime);
      }
    }

    // Check for food collisions (only alive players)
    this.checkCollisions();

    // Update segments again after collision detection to reflect length changes
    for (const player of this.players.values()) {
      if (player.alive) {
        // Skip static snakes
        if (player.speed === 0 || player.id.startsWith('static_snake_')) {
          continue;
        }
        this.updatePlayerSegments(player);
      }
    }

    // Check for deaths (wall collisions, snake-to-snake collisions)
    this.checkDeaths();

    // Maintain food count
    this.maintainFood();
  }

  private updateBotAI(player: Player): void {
    // Check if this is a test bot with specific behavior
    if (player.id.startsWith('test_bot_')) {
      this.updateTestBotAI(player);
      return;
    }

    // Original AI behavior for regular bots
    // Find nearest other player to chase
    let nearestPlayer: Player | null = null;
    let nearestDist = Infinity;
    
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.alive) continue;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = other;
      }
    }
    
    if (nearestPlayer) {
      // Move toward nearest player
      const dx = nearestPlayer.x - player.x;
      const dy = nearestPlayer.y - player.y;
      player.targetAngle = Math.atan2(dy, dx);
      player.isBoosting = true; // Boost toward target
    } else {
      // No target, move in random direction
      player.targetAngle = Math.random() * 2 * Math.PI;
      player.isBoosting = false;
    }
  }

  private updateTestBotAI(player: Player): void {
    const botType = player.nickname; // Store bot type in nickname
    
    switch (botType) {
      case 'Aggressive Bot':
        this.updateAggressiveBotAI(player);
        break;
      case 'Passive Bot':
        this.updatePassiveBotAI(player);
        break;
      case 'Circling Bot':
        this.updateCirclingBotAI(player);
        break;
      case 'Random Bot':
        this.updateRandomBotAI(player);
        break;
      default:
        // Fallback to original AI
        this.updateOriginalBotAI(player);
    }
  }

  private updateAggressiveBotAI(player: Player): void {
    // Always chase the nearest human player (non-bot)
    let nearestHuman: Player | null = null;
    let nearestDist = Infinity;
    
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.alive || this.bots.has(other.id)) continue;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestHuman = other;
      }
    }
    
    if (nearestHuman) {
      const dx = nearestHuman.x - player.x;
      const dy = nearestHuman.y - player.y;
      player.targetAngle = Math.atan2(dy, dx);
      player.isBoosting = true; // Always boost when chasing
    } else {
      // No human players, move randomly
      player.targetAngle = Math.random() * 2 * Math.PI;
      player.isBoosting = false;
    }
  }

  private updatePassiveBotAI(player: Player): void {
    // Move away from other players, never boost
    let nearestPlayer: Player | null = null;
    let nearestDist = Infinity;
    
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.alive) continue;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = other;
      }
    }
    
    if (nearestPlayer && nearestDist < 500) {
      // Move away from nearest player
      const dx = nearestPlayer.x - player.x;
      const dy = nearestPlayer.y - player.y;
      player.targetAngle = Math.atan2(-dy, -dx); // Opposite direction
      player.isBoosting = false; // Never boost
    } else {
      // Move slowly in current direction
      player.isBoosting = false;
    }
  }

  private updateCirclingBotAI(player: Player): void {
    // Circle around the arena center
    const dx = player.x - ARENA_CENTER_X;
    const dy = player.y - ARENA_CENTER_Y;
    const currentAngle = Math.atan2(dy, dx);
    
    // Move perpendicular to radius (creates circular motion)
    player.targetAngle = currentAngle + Math.PI / 2;
    player.isBoosting = Math.random() < 0.3; // Occasionally boost
  }

  private updateRandomBotAI(player: Player): void {
    // Change direction randomly every few seconds
    if (!player.lastInputTime || Date.now() - player.lastInputTime > 2000 + Math.random() * 3000) {
      player.targetAngle = Math.random() * 2 * Math.PI;
      player.lastInputTime = Date.now();
    }
    player.isBoosting = Math.random() < 0.2; // 20% chance to boost
  }

  private updateOriginalBotAI(player: Player): void {
    // Original AI behavior
    let nearestPlayer: Player | null = null;
    let nearestDist = Infinity;
    
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.alive) continue;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = other;
      }
    }
    
    if (nearestPlayer) {
      const dx = nearestPlayer.x - player.x;
      const dy = nearestPlayer.y - player.y;
      player.targetAngle = Math.atan2(dy, dx);
      player.isBoosting = true;
    } else {
      player.targetAngle = Math.random() * 2 * Math.PI;
      player.isBoosting = false;
    }
  }

  public setBotMode(playerId: string, isBot: boolean): void {
    if (isBot) {
      this.bots.add(playerId);
      console.log(`🤖 Bot mode enabled for ${playerId}`);
    } else {
      this.bots.delete(playerId);
    }
  }

  public spawnTestBot(botType: string = 'Aggressive Bot', position?: { x: number; y: number }): string {
    const botId = `test_bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Find a safe spawn position
    let x, y;
    if (position) {
      x = position.x;
      y = position.y;
    } else {
      let attempts = 0;
      do {
        const angle = Math.random() * 2 * Math.PI;
        const radius = Math.random() * ARENA_RADIUS * 0.3; // Spawn in inner 30% like regular players
        x = ARENA_CENTER_X + Math.cos(angle) * radius;
        y = ARENA_CENTER_Y + Math.sin(angle) * radius;
        attempts++;
      } while (attempts < 10 && this.isPositionTooCloseToOthers(x, y, 300));
    }

    const spawnAngle = Math.random() * 2 * Math.PI;
    const bot: Player = {
      id: botId,
      nickname: botType,
      x,
      y,
      angle: spawnAngle,
      targetAngle: spawnAngle,
      speed: BASE_SPEED,
      isBoosting: false,
      segments: [],
      length: SNAKE_INITIAL_LENGTH,
      score: 0,
      lastInput: { angle: spawnAngle, throttle: 0 },
      lastInputTime: Date.now(),
      alive: true
    };

    // Initialize segments
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      bot.segments.push({
        x: bot.x - i * GRID_SIZE * Math.cos(bot.angle),
        y: bot.y - i * GRID_SIZE * Math.sin(bot.angle)
      });
    }

    this.players.set(botId, bot);
    this.bots.add(botId);
    
    console.log(`🤖 Spawned ${botType} with ID: ${botId} at (${x.toFixed(1)}, ${y.toFixed(1)})`);
    
    // Broadcast spawn
    if (this.io) {
      this.io.emit('spawn', {
        type: 'spawn',
        playerId: botId,
        position: { x: bot.x, y: bot.y },
        timestamp: Date.now()
      });
    }
    
    return botId;
  }

  public removeTestBot(botId: string): boolean {
    if (!botId.startsWith('test_bot_') || !this.players.has(botId)) {
      return false;
    }
    
    this.players.delete(botId);
    this.bots.delete(botId);
    
    // Broadcast removal
    if (this.io) {
      this.io.emit('die', {
        type: 'die',
        playerId: botId,
        reason: 'removed',
        timestamp: Date.now()
      });
    }
    
    console.log(`🗑️ Removed test bot: ${botId}`);
    return true;
  }

  public clearAllTestBots(): number {
    let removedCount = 0;
    const botsToRemove: string[] = [];
    
    for (const [playerId, player] of this.players) {
      if (playerId.startsWith('test_bot_')) {
        botsToRemove.push(playerId);
      }
    }
    
    for (const botId of botsToRemove) {
      this.players.delete(botId);
      this.bots.delete(botId);
      
      // Broadcast removal
      if (this.io) {
        this.io.emit('die', {
          type: 'die',
          playerId: botId,
          reason: 'cleared',
          timestamp: Date.now()
        });
      }
      
      removedCount++;
    }
    
    console.log(`🧹 Cleared ${removedCount} test bots`);
    return removedCount;
  }

  private isPositionTooCloseToOthers(x: number, y: number, minDistance: number): boolean {
    for (const player of this.players.values()) {
      const dx = player.x - x;
      const dy = player.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDistance) {
        return true;
      }
    }
    return false;
  }

  public addStaticTestSnake(x: number, y: number, angle: number, length: number = 10): Player {
    const snakeId = `static_snake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const player: Player = {
      id: snakeId,
      nickname: 'Static Snake', // Test snake nickname
      x,
      y,
      angle,
      targetAngle: angle,
      speed: 0, // Static - no movement
      isBoosting: false,
      segments: [],
      length,
      score: 0,
      lastInput: { angle, throttle: 0 },
      lastInputTime: Date.now(),
      alive: true
    };

    // Initialize segments in a line
    for (let i = 0; i < length; i++) {
      player.segments.push({
        x: x - i * GRID_SIZE * Math.cos(angle),
        y: y - i * GRID_SIZE * Math.sin(angle)
      });
    }

    this.players.set(snakeId, player);
    this.bots.add(snakeId); // Mark as bot (static snakes are tracked as bots)
    return player;
  }

  public spawnStaticTestSnakes(): void {
    console.log('🎯 Spawning static test snakes for collision testing...');
    
    // Spawn snakes in a grid pattern around the arena center
    const positions = [
      // North
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y - 1000, angle: Math.PI / 2 }, // Facing south
      // South
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y + 1000, angle: -Math.PI / 2 }, // Facing north
      // East
      { x: ARENA_CENTER_X + 1000, y: ARENA_CENTER_Y, angle: Math.PI }, // Facing west
      // West
      { x: ARENA_CENTER_X - 1000, y: ARENA_CENTER_Y, angle: 0 }, // Facing east
      // Northeast
      { x: ARENA_CENTER_X + 700, y: ARENA_CENTER_Y - 700, angle: -Math.PI / 4 },
      // Northwest
      { x: ARENA_CENTER_X - 700, y: ARENA_CENTER_Y - 700, angle: Math.PI / 4 },
      // Southeast
      { x: ARENA_CENTER_X + 700, y: ARENA_CENTER_Y + 700, angle: 3 * Math.PI / 4 },
      // Southwest
      { x: ARENA_CENTER_X - 700, y: ARENA_CENTER_Y + 700, angle: -3 * Math.PI / 4 },
      // Close positions for easy testing (moved further out to avoid spawn zone)
      { x: ARENA_CENTER_X - 400, y: ARENA_CENTER_Y, angle: 0 }, // Close left (moved from 200 to 400)
      { x: ARENA_CENTER_X + 400, y: ARENA_CENTER_Y, angle: Math.PI }, // Close right
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y - 400, angle: Math.PI / 2 }, // Close top
      { x: ARENA_CENTER_X, y: ARENA_CENTER_Y + 400, angle: -Math.PI / 2 }, // Close bottom
    ];

    positions.forEach((pos, index) => {
      const snake = this.addStaticTestSnake(pos.x, pos.y, pos.angle, 15); // 15 segments for better visibility
      console.log(`   Static snake ${index + 1}: ${snake.id} at (${pos.x}, ${pos.y})`);
      
      // Broadcast spawn
      if (this.io) {
        this.io.emit('spawn', {
          type: 'spawn',
          playerId: snake.id,
          position: { x: snake.x, y: snake.y },
          timestamp: Date.now()
        });
      }
    });

    console.log(`✅ Spawned ${positions.length} static test snakes`);
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

    // Check arena boundaries (movement still allowed, death checked separately)
    const distanceFromCenter = Math.sqrt(
      Math.pow(newX - ARENA_CENTER_X, 2) + Math.pow(newY - ARENA_CENTER_Y, 2)
    );

    if (distanceFromCenter <= ARENA_RADIUS) {
      player.x = newX;
      player.y = newY;

      // Update segments
      this.updatePlayerSegments(player);
    } else {
      // Still update position even if outside (death will be detected in checkDeaths)
      player.x = newX;
      player.y = newY;
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

  private checkDeaths(): void {
    // Check all alive players for death conditions
    const playersToKill: Array<{ player: Player; reason: string }> = [];

    for (const player of this.players.values()) {
      if (!player.alive || !player.segments || player.segments.length === 0) continue;

      const head = { x: player.x, y: player.y };

      // 1. Wall/Boundary collision - check if head is outside arena
      const distanceFromCenter = Math.sqrt(
        Math.pow(head.x - ARENA_CENTER_X, 2) + Math.pow(head.y - ARENA_CENTER_Y, 2)
      );

      if (distanceFromCenter > ARENA_RADIUS) {
        playersToKill.push({ player, reason: 'wall' });
        continue;
      }

      // 2. Collision with other snakes' bodies (skip self)
      for (const other of this.players.values()) {
        // Skip self, dead players, and invalid snakes
        if (!other.alive || other.id === player.id || !other.segments || other.segments.length === 0) {
          continue;
        }

        // IMPORTANT: Skip the head segment (segments[0]) - only check body segments (segments[1+])
        // Head-to-head collision is allowed, only head-to-body causes death
        const bodySegmentsStartIndex = 1;
        
        // Check collision with BODY segments only (skip head)
        for (let i = bodySegmentsStartIndex; i < other.segments.length; i++) {
          const body = other.segments[i];
          const dx = head.x - body.x;
          const dy = head.y - body.y;
          const dist2 = dx * dx + dy * dy;
          
          if (dist2 < SNAKE_COLLISION_RADIUS_SQ) {
            const actualDistance = Math.sqrt(dist2);
            
            // Debug logging
            console.log(`🔍 COLLISION DETECTED:`);
            console.log(`   Player: ${player.id} (head: ${head.x.toFixed(1)}, ${head.y.toFixed(1)})`);
            console.log(`   Hit Other: ${other.id} (body segment ${i}: ${body.x.toFixed(1)}, ${body.y.toFixed(1)})`);
            console.log(`   Distance: ${actualDistance.toFixed(1)}px (threshold: ${SNAKE_COLLISION_RADIUS}px)`);
            console.log(`   Distance²: ${dist2.toFixed(1)} (threshold²: ${SNAKE_COLLISION_RADIUS_SQ})`);
            console.log(`   Other is static: ${other.id.startsWith('static_snake_')}`);
            console.log(`   Self-check: player.id=${player.id}, other.id=${other.id}, match=${player.id === other.id}`);
            
            playersToKill.push({ player, reason: 'snake' });
            break;
          }
        }

        // If this player is already marked for death, don't check other snakes
        if (playersToKill.some(k => k.player.id === player.id)) break;
      }
    }

    // Handle all deaths
    for (const { player, reason } of playersToKill) {
      this.handleDeath(player, reason);
    }
  }

  private handleDeath(player: Player, reason: string): void {
    if (!player.alive) return; // Already dead

    console.log(`💀 Player ${player.id} died by ${reason} (length: ${player.length})`);

    // Mark as dead
    player.alive = false;

    // Calculate food drops (1 food per 5 length units, minimum 1)
    const dropCount = Math.max(1, Math.floor(player.length / 5));
    const foodDrops: FoodItem[] = [];

    // Get death position (use head position)
    const deathX = player.x;
    const deathY = player.y;

    // Spawn food drops scattered around death position
    for (let i = 0; i < dropCount; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const radius = 50 + Math.random() * 80; // 50-130px from death position
      
      const foodX = deathX + Math.cos(angle) * radius;
      const foodY = deathY + Math.sin(angle) * radius;

      // Make sure food is within arena bounds
      const distanceFromCenter = Math.sqrt(
        Math.pow(foodX - ARENA_CENTER_X, 2) + Math.pow(foodY - ARENA_CENTER_Y, 2)
      );

      if (distanceFromCenter <= ARENA_RADIUS) {
        // Spawn food using FoodManager
        const foodId = `food_${Date.now()}_${Math.random()}`;
        const isLarge = Math.random() < 0.2; // 20% chance for large food

        const food: FoodItem = {
          id: foodId,
          x: Math.round(foodX / GRID_SIZE) * GRID_SIZE,
          y: Math.round(foodY / GRID_SIZE) * GRID_SIZE,
          type: isLarge ? 'large' : 'small',
          color: isLarge ? 0x9C27B0 : 0xFF5722,
          size: isLarge ? 40 : 20,
          score: isLarge ? 25 : 10,
          growthAmount: isLarge ? 2 : 1
        };

        // Add to food manager directly (bypassing spawnFood to set exact position)
        const foodManagerAny = this.foodManager as any;
        if (foodManagerAny.food) {
          foodManagerAny.food.set(food.id, food);
          if (foodManagerAny.addToSpatialGrid) {
            foodManagerAny.addToSpatialGrid(food);
          }
          // Broadcast spawn for this dropped food
          if (this.io) {
            this.io.emit('food', {
              type: 'food',
              action: 'spawn',
              food,
              timestamp: Date.now()
            });
          }
        }

        foodDrops.push(food);
      }
    }

    // Broadcast death event with dropped food
    if (this.io) {
      this.io.emit('player_died', {
        playerId: player.id,
        reason,
        food: foodDrops,
        timestamp: Date.now()
      });
    }

    // Schedule respawn after 2 seconds
    setTimeout(() => {
      this.respawnPlayer(player.id);
    }, 2000);
  }

  private respawnPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return; // Player already removed

    console.log(`🔄 Respawning player ${playerId}`);

    // Reset player state
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.random() * (ARENA_RADIUS * 0.3);
    player.x = ARENA_CENTER_X + Math.cos(angle) * radius;
    player.y = ARENA_CENTER_Y + Math.sin(angle) * radius;
    player.angle = Math.random() * 2 * Math.PI;
    player.targetAngle = player.angle;
    player.length = SNAKE_INITIAL_LENGTH;
    player.score = 0;
    player.alive = true;
    player.segments = [];

    // Reinitialize segments
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      player.segments.push({
        x: player.x - i * GRID_SIZE * Math.cos(player.angle),
        y: player.y - i * GRID_SIZE * Math.sin(player.angle)
      });
    }

    // Broadcast respawn
    if (this.io) {
      this.io.emit('player_respawned', {
        playerId: player.id,
        position: { x: player.x, y: player.y },
        timestamp: Date.now()
      });
    }
  }

  private maintainFood(): void {
    this.foodManager.maintainFoodCount();
    // Food spawns/despawns broadcasting is handled externally
  }

  public getState(): StateMessage {
    const players: PlayerState[] = Array.from(this.players.values())
      .filter(player => player.alive) // Only return alive players
      .map(player => ({
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
    const players: PlayerState[] = Array.from(this.players.values())
      .filter(player => player.alive) // Only return alive players
      .map(player => ({
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
    others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number; segments: Array<{ x: number; y: number }> }>;
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

    // Get nearby players (only alive players)
    // Static snakes are always visible regardless of distance
    const visiblePlayers = Array.from(this.players.values())
      .filter(p => p.alive && p.id !== playerId && p.segments && p.segments.length > 0)
      .filter(p => {
        // Always include static snakes
        if (p.id.startsWith('static_snake_')) {
          return true;
        }
        // For regular players, use distance check
        const dx = head.x - p.x;
        const dy = head.y - p.y;
        return (dx * dx + dy * dy) <= viewRadiusSquared;
      })
      .map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        length: p.length,
        score: p.score,
        segments: p.segments.slice() // Include segments for proper rendering
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

// Add CORS middleware for Express routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Allow all origins for development
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ['http://localhost:3000', 'http://localhost:3001'] },
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

// Spawn static test snakes for collision testing
// gameWorld.spawnStaticTestSnakes(); // Commented out - these were causing false collision detections

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

  // Handle nickname update
  socket.on('set_nickname', (data: { nickname: string }) => {
    const player = gameWorld.getPlayer(playerId);
    if (player) {
      // Validate and sanitize nickname
      let nickname = data.nickname.trim();
      if (!nickname || nickname.length === 0) {
        nickname = 'Player';
      }
      if (nickname.length > 20) {
        nickname = nickname.substring(0, 20);
      }
      player.nickname = nickname;
      console.log(`👤 Player ${playerId} set nickname to: ${nickname}`);
    }
  });

  // Simple admin command for collision testing
  socket.on('admin_spawn_test_snake', () => {
    console.log(`🔥 ADMIN COMMAND RECEIVED: admin_spawn_test_snake from ${playerId}`);
    console.log(`🐍 Admin command: spawn test snake at fixed coordinate from ${playerId}`);
    // Spawn at exact coordinate (4500, 4500) with length 5
    const x = 4500;
    const y = 4500;
    const angle = 0; // Facing right
    const length = 5;
    const snake = gameWorld.addStaticTestSnake(x, y, angle, length);
    
    console.log(`🐍 Test snake created:`, {
      id: snake.id,
      x: snake.x,
      y: snake.y,
      length: snake.length,
      segments: snake.segments,
      segmentCount: snake.segments.length
    });
    
    socket.emit('test_snake_spawned', { 
      snakeId: snake.id, 
      position: { x, y }, 
      length,
      coordinate: `(${x}, ${y})`
    });
    console.log(`✅ Spawned test snake with length ${length} at coordinate (${x}, ${y})`);
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
      others: Array<{ id: string; x: number; y: number; angle: number; length: number; score: number; segments: Array<{ x: number; y: number }> }>;
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
        // Log static snakes being sent to clients
        const staticSnakes = playerState.others.filter(p => p.id.startsWith('static_snake_'));
        if (staticSnakes.length > 0) {
          console.log(`🐍 Sending ${staticSnakes.length} static snakes to player ${playerState.id}:`);
          staticSnakes.forEach(snake => {
            console.log(`  - Snake ${snake.id} at (${snake.x}, ${snake.y}) with ${snake.segments?.length || 0} segments`);
            if (snake.segments && snake.segments.length > 0) {
              console.log(`    First segment: (${snake.segments[0].x}, ${snake.segments[0].y})`);
              console.log(`    Last segment: (${snake.segments[snake.segments.length - 1].x}, ${snake.segments[snake.segments.length - 1].y})`);
            }
          });
        }
        
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