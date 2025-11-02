import Phaser from 'phaser';
import { Snake } from './Snake';
import { FoodManager } from './Food';
import { UIScene } from './UIScene';
import { NetClient, NetworkPlayerState, NetworkFoodItem } from './net/NetClient';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BACKGROUND_COLOR,
  GRID_LINE_COLOR,
  GRID_SIZE,
  CAMERA_FOLLOW_SPEED,
  CAMERA_ZOOM,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_RADIUS,
  ARENA_WARNING_DISTANCE,
  ARENA_BOUNDARY_COLOR,
  ARENA_WARNING_COLOR,
  POSITION_CORRECTION_THRESHOLD
} from './config';

// Remote player visual representation
interface RemotePlayerVisual {
  id: string;
  graphics: Phaser.GameObjects.Graphics;
  segments: Phaser.GameObjects.Graphics[];
}

export class GameScene extends Phaser.Scene {
  private snake!: Snake;
  private foodManager!: FoodManager;
  private uiScene!: UIScene;
  private netClient!: NetClient;
  
  private gameStartTime: number = 0;
  private score: number = 0;
  private isGameActive: boolean = true;
  private fpsText!: Phaser.GameObjects.Text;
  private connectionText!: Phaser.GameObjects.Text;
  
  // Mouse tracking for cursor behavior// Mouse tracking (for debug purposes)
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  
  // Arena boundary graphics
  private arenaBoundary!: Phaser.GameObjects.Graphics;
  private arenaWarning!: Phaser.GameObjects.Graphics;
  
  // Networking state
  private isConnected: boolean = false;
  private playerId: string | null = null;
  private remotePlayers: Map<string, RemotePlayerVisual> = new Map();
  private networkFood: Map<string, { graphics: Phaser.GameObjects.Graphics; data: NetworkFoodItem }> = new Map();
  private hasReceivedInitialFood: boolean = false;
  
  // Input state for networking
  private currentAngle: number = 0;
  private currentThrottle: number = 0;
  private inputCallCount: number = 0;
  
  // Client-side prediction state
  private serverPosition: { x: number; y: number } | null = null;
  private lastServerUpdate: number = 0;
  private useLocalPrediction: boolean = true;
  
  // Local snake state tracking
  private lastKnownServerLength: number = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.setupWorld();
    this.setupNetworking();
    this.setupInput(); // Move after networking so netClient is available
    this.setupGame();
    this.setupCamera();
    this.setupUI();
    this.setupEventListeners();
    
    this.gameStartTime = this.time.now;
  }

  private setupWorld(): void {
    // Set world bounds
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    
    // Create background
    const background = this.add.graphics();
    background.fillStyle(BACKGROUND_COLOR);
    background.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    
    // Draw grid lines for visual reference
    this.drawGrid();
    
    // Create arena boundary
    this.createArenaBoundary();
  }

  private drawGrid(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GRID_LINE_COLOR, 0.3);
    
    // Vertical lines
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, WORLD_HEIGHT);
    }
    
    // Horizontal lines
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
      graphics.moveTo(0, y);
      graphics.lineTo(WORLD_WIDTH, y);
    }
    
    graphics.strokePath();
  }

  private createArenaBoundary(): void {
    // Create the main boundary circle (initially invisible)
    this.arenaBoundary = this.add.graphics();
    this.arenaBoundary.lineStyle(8, ARENA_BOUNDARY_COLOR, 1);
    this.arenaBoundary.strokeCircle(ARENA_CENTER_X, ARENA_CENTER_Y, ARENA_RADIUS);
    this.arenaBoundary.setVisible(false);
    
    // Create the warning circle (initially invisible)
    this.arenaWarning = this.add.graphics();
    this.arenaWarning.lineStyle(4, ARENA_WARNING_COLOR, 0.6);
    this.arenaWarning.strokeCircle(ARENA_CENTER_X, ARENA_CENTER_Y, ARENA_RADIUS);
    this.arenaWarning.setVisible(false);
  }

  private setupInput(): void {
    console.log('🔧 Setting up input...');
    
    // Enable mouse input
    this.input.mouse!.enabled = true;
    console.log('🔧 Mouse enabled:', this.input.mouse!.enabled);
    
    // Send setup confirmation to server
    this.netClient.sendDebugMessage('🔧 Input setup started');
    
    // Track mouse movement
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Send a test message to server to verify events are working
      this.netClient.sendDebugMessage(`🖱️ MOVE: (${pointer.worldX.toFixed(0)}, ${pointer.worldY.toFixed(0)})`);
      
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      
      // Update last mouse position for debug purposes
      this.lastMouseX = worldX;
      this.lastMouseY = worldY;
      console.log(`🖱️ Mouse moved to world: (${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);
    });
    
    // Track mouse clicks for debugging
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.netClient.sendDebugMessage(`🖱️ DOWN: (${pointer.worldX.toFixed(0)}, ${pointer.worldY.toFixed(0)})`);
      console.log(`🖱️ Mouse down at world: (${pointer.worldX.toFixed(1)}, ${pointer.worldY.toFixed(1)})`);
    });
    
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.netClient.sendDebugMessage(`🖱️ UP: (${pointer.worldX.toFixed(0)}, ${pointer.worldY.toFixed(0)})`);
      console.log(`🖱️ Mouse up at world: (${pointer.worldX.toFixed(1)}, ${pointer.worldY.toFixed(1)})`);
    });
    
    this.netClient.sendDebugMessage('🔧 Input setup complete');
    console.log('🔧 Input setup complete');
  }

  private setupNetworking(): void {
    this.netClient = new NetClient();
    
    // Set up event handlers
    this.netClient.on('connected', (playerId: string, spawnPosition: { x: number; y: number }) => {
      console.log(`Connected as player ${playerId}`);
      this.playerId = playerId;
      this.isConnected = true;
      this.updateConnectionStatus('Connected');
      
      // Initialize local snake at server-provided spawn position
      this.snake = new Snake(this, 
        Math.floor(spawnPosition.x / GRID_SIZE), 
        Math.floor(spawnPosition.y / GRID_SIZE)
      );
      this.setupCamera();
      
      // Reset food loading flag and clear existing food
      this.hasReceivedInitialFood = false;
      this.clearNetworkFood();
    });
    
    this.netClient.on('disconnected', () => {
      console.log('Disconnected from server');
      this.isConnected = false;
      this.playerId = null;
      this.updateConnectionStatus('Disconnected - Reconnecting...');
      this.clearRemotePlayers();
      this.clearNetworkFood();
    });
    
    this.netClient.on('playerSpawned', (playerId: string, position: { x: number; y: number }) => {
      console.log(`Player ${playerId} spawned`);
      // Remote player spawning is handled in state updates
    });
    
    this.netClient.on('playerDied', (playerId: string, reason: string) => {
      console.log(`Player ${playerId} died: ${reason}`);
      this.removeRemotePlayer(playerId);
    });
    
    this.netClient.on('foodUpdate', (action: 'spawn' | 'despawn', food: NetworkFoodItem) => {
      console.log(`🍎 Food ${action} event received: foodId=${food.id} at (${food.x.toFixed(1)}, ${food.y.toFixed(1)})`);
      console.log(`🍎 Current networkFood Map size: ${this.networkFood.size}`);
      console.log(`🍎 Available food IDs:`, Array.from(this.networkFood.keys()).slice(0, 10));
      
      if (action === 'spawn') {
        console.log(`🍎 Adding food ${food.id} to client`);
        this.addNetworkFood(food);
      } else {
        console.log(`🍎 DESPAWN: Attempting to remove food ${food.id} from client`);
        console.log(`🍎 Food exists in Map? ${this.networkFood.has(food.id)}`);
        this.removeNetworkFood(food.id);
      }
    });
    
    this.netClient.on('stateUpdate', (players: NetworkPlayerState[], food: NetworkFoodItem[]) => {
      this.updateRemotePlayers(players);
      
      // Update local player's UI and apply position correction if needed
      if (this.playerId && this.snake) {
        const localPlayer = players.find(p => p.id === this.playerId);
        if (localPlayer) {
          this.uiScene.updateScore(localPlayer.score);
          // Show both server length and actual client length for debugging
          const clientLength = this.snake.getLength();
          this.uiScene.updateLength(`${localPlayer.length} (client: ${clientLength})`);
          
          // Store server position for reference
          if (localPlayer.segments.length > 0) {
            this.serverPosition = { x: localPlayer.x, y: localPlayer.y };
            this.lastServerUpdate = Date.now();
            
            // Handle snake growth based on server length changes
            this.handleServerLengthChange(localPlayer.length);
            
            // Trust local prediction completely - no position corrections
          }
        }
      }
      
      // Load initial food from first state update, then rely on individual food updates
      // IMPORTANT: After initial load, we only use individual foodUpdate events to avoid race conditions
      if (!this.hasReceivedInitialFood) {
        console.log(`🍎 Loading initial food: ${food.length} items`);
        this.updateNetworkFood(food);
        this.hasReceivedInitialFood = true;
        console.log(`🍎 Initial food loaded. Will now rely on individual foodUpdate events only.`);
      } else {
        // After initial load, stateUpdate should NOT update food to prevent race conditions
        // Individual foodUpdate events handle all food spawn/despawn
        // We can use stateUpdate food list for validation/debugging, but don't sync it
      }
    });
    
    this.netClient.on('error', (error: string) => {
      console.error('Network error:', error);
      this.updateConnectionStatus(`Error: ${error}`);
    });
    
    // Connect to server
    this.netClient.connect().catch((error) => {
      console.error('Failed to connect to server:', error);
      this.updateConnectionStatus('Failed to connect');
    });
  }

  private setupGame(): void {
    // Initialize food manager (disabled for networked gameplay)
    this.foodManager = new FoodManager(this);
    
    // Reset game state
    this.score = 0;
    this.isGameActive = true;
    
    // Note: Snake initialization is now handled in networking connection
  }

  private setupCamera(): void {
    if (this.snake) {
      // Set camera to follow snake with smooth movement
      const snakeHead = this.snake.getHeadPosition();
      this.cameras.main.setZoom(CAMERA_ZOOM);
      this.cameras.main.centerOn(snakeHead.x, snakeHead.y);
    }
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  private setupUI(): void {
    // Launch UI scene
    this.scene.launch('UIScene');
    this.uiScene = this.scene.get('UIScene') as UIScene;
    
    // Add FPS counter
    this.fpsText = this.add.text(10, 10, 'FPS: 0', { 
      fontSize: '16px', 
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: 5, y: 2 }
    }).setScrollFactor(0).setDepth(150);
    
    // Add connection status
    this.connectionText = this.add.text(10, 35, 'Connecting...', { 
      fontSize: '14px', 
      color: '#ffff00',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: 5, y: 2 }
    }).setScrollFactor(0).setDepth(150);
  }

  private setupEventListeners(): void {
    // Listen for UI events
    this.uiScene.events.on('restartGame', this.restartGame, this);
    this.uiScene.events.on('gameOver', this.handleGameOver, this);
  }

  private handleInput(): void {
    this.inputCallCount++;
    
    if (!this.isGameActive || !this.isConnected || !this.snake) {
      if (this.inputCallCount % 60 === 0) { // Log every 60 calls (about once per second)
        console.log(`⚠️ Input blocked: gameActive=${this.isGameActive}, connected=${this.isConnected}, snake=${!!this.snake}`);
      }
      return;
    }
    
    const pointer = this.input.activePointer;
    
    // Always update angle based on current mouse position
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;
    
    // Get snake head position
    const headPos = this.snake.getHeadPosition();
    
    // Calculate angle from snake head to cursor
    const dx = worldX - headPos.x;
    const dy = worldY - headPos.y;
    const targetAngle = Math.atan2(dy, dx);
    
    // Only log occasionally to avoid spam
    if (this.inputCallCount % 30 === 0) {
      console.log(`🎯 Angle: ${(targetAngle * 180 / Math.PI).toFixed(1)}° (cursor: ${worldX.toFixed(1)}, ${worldY.toFixed(1)}, head: ${headPos.x.toFixed(1)}, ${headPos.y.toFixed(1)})`);
    }
    
    // Set snake target angle (for local prediction)
    this.snake.setTargetAngle(targetAngle);
    this.currentAngle = targetAngle;
    
    // Handle boosting
    const isBoosting = pointer.isDown;
    if (this.inputCallCount % 30 === 0) {
      console.log(`🚀 Boost: ${isBoosting ? 'ON' : 'OFF'}`);
    }
    this.snake.setBoosting(isBoosting);
    this.currentThrottle = isBoosting ? 1 : 0;
    
    // Send input to server
    this.netClient.sendInput(this.currentAngle, this.currentThrottle);
  }

  private updateCamera(): void {
    if (!this.snake) return;
    
    const snakeHead = this.snake.getHeadPosition();
    const camera = this.cameras.main;
    
    // Smooth camera following with lag
    const targetX = snakeHead.x;
    const targetY = snakeHead.y;
    
    const currentX = camera.scrollX + camera.width / 2;
    const currentY = camera.scrollY + camera.height / 2;
    
    const newX = currentX + (targetX - currentX) * CAMERA_FOLLOW_SPEED;
    const newY = currentY + (targetY - currentY) * CAMERA_FOLLOW_SPEED;
    
    camera.centerOn(newX, newY);
  }

  private checkCollisions(): void {
    if (!this.isGameActive || !this.snake) return;
    
    // Note: Collision detection is now handled server-side
    // This method is kept for potential local prediction or effects
    
    // Also check network food collisions for immediate feedback
    this.checkNetworkFoodCollisions();
  }
  
  private checkNetworkFoodCollisions(): void {
    // Client-side collision detection removed to prevent inconsistencies
    // Server is now fully authoritative for food collisions
    // This prevents race conditions and ensures consistent behavior
    return;
  }

  // Timer removed - game now runs continuously without time limit

  private checkArenaProximity(): void {
    if (!this.snake) return;
    
    const headPos = this.snake.getHeadPosition();
    const distanceFromCenter = Math.sqrt(
      Math.pow(headPos.x - ARENA_CENTER_X, 2) + 
      Math.pow(headPos.y - ARENA_CENTER_Y, 2)
    );
    
    const distanceFromBoundary = ARENA_RADIUS - distanceFromCenter;
    
    if (distanceFromBoundary <= ARENA_WARNING_DISTANCE) {
      // Show warning
      this.arenaWarning.setVisible(true);
      
      if (distanceFromBoundary <= 0) {
        // Show boundary
        this.arenaBoundary.setVisible(true);
      } else {
        this.arenaBoundary.setVisible(false);
      }
    } else {
      // Hide both warning and boundary
      this.arenaWarning.setVisible(false);
      this.arenaBoundary.setVisible(false);
    }
  }

  private updateConnectionStatus(status: string): void {
    if (this.connectionText && this.connectionText.setText) {
      this.connectionText.setText(status);
      
      // Color coding
      if (status.includes('Connected')) {
        this.connectionText.setColor('#00ff00');
      } else if (status.includes('Error') || status.includes('Failed')) {
        this.connectionText.setColor('#ff0000');
      } else {
        this.connectionText.setColor('#ffff00');
      }
    }
  }

  private handleServerLengthChange(serverLength: number): void {
    if (!this.snake || !this.useLocalPrediction) {
      return;
    }
    
    console.log(`🔄 SERVER LENGTH UPDATE: Server=${serverLength}, Client=${this.snake.getLength()}, LastKnown=${this.lastKnownServerLength}`);
    
    // Initialize if this is the first update
    if (this.lastKnownServerLength === 0) {
      console.log(`🔄 INITIALIZING: Setting lastKnownServerLength to ${serverLength}`);
      this.lastKnownServerLength = serverLength;
      return;
    }
    
    // Check if snake should grow
    const lengthDifference = serverLength - this.lastKnownServerLength;
    if (lengthDifference > 0) {
      console.log(`🐍 GROWING: ${this.lastKnownServerLength} -> ${serverLength} (+${lengthDifference})`);
      console.log(`🐍 BEFORE GROW: Client segments = ${this.snake.getLength()}`);
      
      // Grow the snake locally for each segment increase
      for (let i = 0; i < lengthDifference; i++) {
        this.snake.grow();
      }
      
      console.log(`🐍 AFTER GROW: Client segments = ${this.snake.getLength()}`);
      this.lastKnownServerLength = serverLength;
    } else if (lengthDifference < 0) {
      console.log(`🐍 SHRINKING: ${this.lastKnownServerLength} -> ${serverLength} (${lengthDifference})`);
      
      // Shrink the snake locally for each segment decrease
      for (let i = 0; i < Math.abs(lengthDifference); i++) {
        this.snake.shrink();
      }
      
      this.lastKnownServerLength = serverLength;
    } else {
      console.log(`🔄 NO CHANGE: Server and client lengths match at ${serverLength}`);
    }
  }





  private updateRemotePlayers(players: NetworkPlayerState[]): void {
    // Update existing remote players and add new ones
    for (const playerState of players) {
      if (playerState.id === this.playerId) continue; // Skip own player
      
      let remotePlayer = this.remotePlayers.get(playerState.id);
      
      if (!remotePlayer) {
        // Create new remote player visual
        remotePlayer = this.createRemotePlayerVisual(playerState.id);
        this.remotePlayers.set(playerState.id, remotePlayer);
      }
      
      // Update visual representation
      this.updateRemotePlayerVisual(remotePlayer, playerState);
    }
    
    // Remove players that are no longer in the state
    const currentPlayerIds = new Set(players.map(p => p.id));
    for (const [playerId] of this.remotePlayers) {
      if (!currentPlayerIds.has(playerId)) {
        this.removeRemotePlayer(playerId);
      }
    }
  }

  private createRemotePlayerVisual(playerId: string): RemotePlayerVisual {
    const graphics = this.add.graphics();
    return {
      id: playerId,
      graphics,
      segments: []
    };
  }

  private updateRemotePlayerVisual(remotePlayer: RemotePlayerVisual, state: NetworkPlayerState): void {
    // Clear previous drawing
    remotePlayer.graphics.clear();
    
    // Draw snake segments
    for (let i = 0; i < state.segments.length; i++) {
      const segment = state.segments[i];
      const isHead = i === 0;
      
      // Use different colors for remote players
      const color = isHead ? 0x2196F3 : 0x64B5F6; // Blue tones for remote players
      
      remotePlayer.graphics.fillStyle(color);
      remotePlayer.graphics.fillCircle(segment.x, segment.y, GRID_SIZE / 2);
    }
  }

  private removeRemotePlayer(playerId: string): void {
    const remotePlayer = this.remotePlayers.get(playerId);
    if (remotePlayer) {
      remotePlayer.graphics.destroy();
      this.remotePlayers.delete(playerId);
    }
  }

  private clearRemotePlayers(): void {
    for (const [playerId] of this.remotePlayers) {
      this.removeRemotePlayer(playerId);
    }
  }

  private updateNetworkFood(food: NetworkFoodItem[]): void {
    // Create a set of current food IDs from server
    const serverFoodIds = new Set(food.map(f => f.id));
    
    // Remove food that's no longer on the server
    for (const [foodId] of this.networkFood) {
      if (!serverFoodIds.has(foodId)) {
        this.removeNetworkFood(foodId);
      }
    }
    
    // Add new food from server
    for (const foodItem of food) {
      if (!this.networkFood.has(foodItem.id)) {
        this.addNetworkFood(foodItem);
      }
    }
  }

  private addNetworkFood(food: NetworkFoodItem): void {
    // Check if food already exists
    if (this.networkFood.has(food.id)) {
      console.warn(`⚠️ Food ${food.id} already exists in Map, skipping add`);
      return;
    }
    
    console.log(`🍎 Adding food ${food.id} at (${food.x.toFixed(1)}, ${food.y.toFixed(1)})`);
    const graphics = this.add.graphics();
    graphics.fillStyle(food.color);
    graphics.fillCircle(food.x, food.y, food.size / 2);
    this.networkFood.set(food.id, { graphics, data: food });
    console.log(`🍎 Food added. New count: ${this.networkFood.size}`);
  }

  private removeNetworkFood(foodId: string): void {
    console.log(`🍎 removeNetworkFood called for foodId=${foodId}`);
    console.log(`🍎 Current networkFood Map size: ${this.networkFood.size}`);
    console.log(`🍎 All available food IDs:`, Array.from(this.networkFood.keys()));
    
    const foodItem = this.networkFood.get(foodId);
    if (foodItem) {
      console.log(`✅ Found food ${foodId} in Map, removing...`);
      
      // Check if graphics is valid before destroying
      if (foodItem.graphics && !foodItem.graphics.destroyed) {
        console.log(`🍎 Destroying graphics for food ${foodId}`);
        foodItem.graphics.destroy();
      } else {
        console.warn(`⚠️ Graphics for food ${foodId} is already destroyed or invalid`);
      }
      
      const deleted = this.networkFood.delete(foodId);
      console.log(`🍎 Delete operation result: ${deleted}`);
      console.log(`🍎 Food removed. New count: ${this.networkFood.size}`);
      
      // Verify removal
      if (this.networkFood.has(foodId)) {
        console.error(`❌ ERROR: Food ${foodId} still exists in Map after deletion!`);
      } else {
        console.log(`✅ Food ${foodId} successfully removed from Map`);
      }
    } else {
      console.warn(`⚠️ Food ${foodId} not found in networkFood Map`);
      console.warn(`⚠️ Map size: ${this.networkFood.size}`);
      console.warn(`⚠️ First 10 IDs in Map:`, Array.from(this.networkFood.keys()).slice(0, 10));
      
      // Check if ID format matches
      const allIds = Array.from(this.networkFood.keys());
      const similarIds = allIds.filter(id => id.includes(foodId.slice(0, 20)));
      if (similarIds.length > 0) {
        console.warn(`⚠️ Found similar IDs (first 20 chars match):`, similarIds);
      }
    }
  }

  private clearNetworkFood(): void {
    for (const [foodId] of this.networkFood) {
      this.removeNetworkFood(foodId);
    }
  }

  private gameOver(reason: string): void {
    this.isGameActive = false;
    this.uiScene.showGameOver(reason);
  }

  private handleGameOver(): void {
    // Additional game over handling if needed
  }

  private restartGame(): void {
    // Disconnect and reconnect for a fresh start
    this.netClient.disconnect();
    
    // Clear all game objects
    if (this.snake) {
      this.snake.destroy();
    }
    this.foodManager.destroy();
    this.clearRemotePlayers();
    this.clearNetworkFood();
    
    // Reset game state
    this.score = 0;
    this.isGameActive = true;
    this.gameStartTime = this.time.now;
    
    // Reconnect to server
    this.setupNetworking();
  }

  update(time: number, delta: number): void {
    // Update FPS display
    if (this.fpsText && this.fpsText.setText) {
      this.fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    }
    
    if (!this.isGameActive) return;
    
    // Update networking
    if (this.netClient) {
      this.netClient.update(delta);
    }
    
    // Handle input
    this.handleInput();
    

    
    // Update local snake with client-side prediction
    if (this.snake && this.useLocalPrediction) {
      this.snake.update(delta);
    }
    
    // Local food manager disabled for networked gameplay
    // this.foodManager.update(time);
    
    // Update camera
    this.updateCamera();
    
    // Check collisions (local prediction)
    this.checkCollisions();
    
    // Check arena proximity
    this.checkArenaProximity();
    
    // Local food manager disabled for networked gameplay
    // if (this.snake) {
    //   this.foodManager.updateSnakePositions(this.snake.getAllSegments());
    // }
  }
}