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
  POSITION_CORRECTION_THRESHOLD,
  SNAKE_INITIAL_LENGTH
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
  
  // Client-side optimistic prediction DISABLED - server is fully authoritative
  // These remain for potential future use or debugging
  private pendingFoodRemovals: Map<string, number> = new Map(); // foodId -> timestamp
  private pendingFoodData: Map<string, NetworkFoodItem> = new Map(); // foodId -> food data (for rollback)
  private pendingGrowth: number = 0; // pending segment growth count
  private pendingGrowthTimestamp: number = 0;
  private expectedLength: number = 0; // expected length after pending growth
  private collisionCheckCounter: number = 0; // Debug: verify collision check runs every frame

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
    
    this.netClient.on('foodEaten', (foodId: string, by: string) => {
      console.log(`🍎 FOOD_EATEN event: ${foodId} eaten by ${by}`);
      
      // Server-authoritative event only
      // No optimistic prediction to confirm
      // Food removal is handled by the foodUpdate('despawn') event
      // Length/score updates are handled by stateUpdate event
    });
    
    this.netClient.on('foodUpdate', (action: 'spawn' | 'despawn', food: NetworkFoodItem) => {
      console.log(`🍎 Food ${action} event received: foodId=${food.id} at (${food.x.toFixed(1)}, ${food.y.toFixed(1)})`);
      
      if (action === 'spawn') {
        console.log(`🍎 Adding food ${food.id} to client`);
        this.addNetworkFood(food);
      } else {
        // Server confirms food despawn (authoritative)
        console.log(`🍎 Server-authoritative removal of food ${food.id}`);
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

  private checkCollisions(delta?: number): void {
    if (!this.isGameActive || !this.snake) return;
    
    // ⚠️ COLLISION DETECTION IS NOW 100% SERVER-AUTHORITATIVE
    // Client no longer performs optimistic collision prediction to avoid race conditions
    // Server detects collisions at 30Hz and broadcasts food_eaten + foodUpdate events
    // This eliminates blinking and inconsistency issues
    
    // Client-side optimistic collision detection DISABLED
    // this.checkNetworkFoodCollisions();
  }
  
  private checkNetworkFoodCollisions(): void {
    if (!this.snake || !this.isGameActive) return;
    
    const head = this.snake.getHeadPosition();
    if (!head) return;

    // Debug: Track collision check frequency
    this.collisionCheckCounter++;
    
    // PREDICTIVE: Get snake's next position for earlier detection
    // Use the current frame delta from the update loop
    const frameDelta = this.game.loop.delta; // Get current frame delta in ms
    const snakeAngle = this.snake.getAngle();
    const snakeIsBoosting = this.snake.getIsBoosting();
    const snakeBaseSpeed = this.snake.getSpeed();
    const currentSpeed = snakeIsBoosting ? snakeBaseSpeed * BOOST_MULTIPLIER : snakeBaseSpeed;
    const moveDistance = (currentSpeed * frameDelta) / 1000; // Convert to pixels per frame
    
    // Calculate predicted next-frame position
    const predictedHeadX = head.x + Math.cos(snakeAngle) * moveDistance;
    const predictedHeadY = head.y + Math.sin(snakeAngle) * moveDistance;

    // Debug logging every 60 frames (about once per second)
    if (this.collisionCheckCounter % 60 === 0) {
      console.log(`🔍 COLLISION CHECK: Frame ${this.collisionCheckCounter}, foodCount=${this.networkFood.size}, snakeHead=(${head.x.toFixed(1)}, ${head.y.toFixed(1)}), predicted=(${predictedHeadX.toFixed(1)}, ${predictedHeadY.toFixed(1)})`);
    }

    // Check collisions with all visible food items
    let nearestFoodDistance = Infinity;
    let nearestFoodId: string | null = null;
    
    this.networkFood.forEach((foodItem, foodId) => {
      // Skip if already pending removal (already handled optimistically)
      if (this.pendingFoodRemovals.has(foodId)) {
        return;
      }

      const food = foodItem.data;
      
      // Calculate distance to BOTH current and predicted positions
      const currentDistance = Math.sqrt(
        Math.pow(head.x - food.x, 2) + Math.pow(head.y - food.y, 2)
      );
      const predictedDistance = Math.sqrt(
        Math.pow(predictedHeadX - food.x, 2) + Math.pow(predictedHeadY - food.y, 2)
      );

      // Track nearest food for debugging
      const minDistance = Math.min(currentDistance, predictedDistance);
      if (minDistance < nearestFoodDistance) {
        nearestFoodDistance = minDistance;
        nearestFoodId = foodId;
      }

      // Use MORE GENEROUS collision radius on client for earlier detection
      // Client uses larger radius than server for predictive detection
      const clientCollisionRadius = food.size / 2 + GRID_SIZE * 3.5; // Larger than server's 2.5
      
      // Check BOTH current and predicted positions
      const willCollide = currentDistance <= clientCollisionRadius || 
                          predictedDistance <= clientCollisionRadius;
      
      // Debug logging when close to food
      if (currentDistance < clientCollisionRadius + 50 || predictedDistance < clientCollisionRadius + 50) {
        console.log(`🔍 Collision check: Food ${foodId} current=${currentDistance.toFixed(1)}px, predicted=${predictedDistance.toFixed(1)}px, radius=${clientCollisionRadius.toFixed(1)}px, willCollide=${willCollide}`);
      }
      
      if (willCollide) {
        // ⚠️ CLIENT-SIDE OPTIMISTIC PREDICTION DISABLED
        // Server handles ALL collision detection authoritatively at 30Hz
        // This prevents race conditions, blinking, and inconsistencies
        
        console.log(`🔍 CLIENT: Collision would be detected (DISABLED - server handles this)`);
        console.log(`🔍   Current distance: ${currentDistance.toFixed(2)}px`);
        console.log(`🔍   Predicted distance: ${predictedDistance.toFixed(2)}px`);
        console.log(`🔍   Collision radius: ${clientCollisionRadius.toFixed(2)}px`);
        
        // Don't send eat_attempt - server detects automatically
        // Don't remove food optimistically - wait for server
        // Don't grow snake optimistically - wait for server
        
        return; // Only log one potential collision per check
      }
    });
    
    // Debug: Log nearest food info occasionally
    if (nearestFoodId && this.collisionCheckCounter % 30 === 0) {
      const nearestFood = this.networkFood.get(nearestFoodId);
      if (nearestFood) {
        const food = nearestFood.data;
        const distance = Math.sqrt(
          Math.pow(head.x - food.x, 2) + Math.pow(head.y - food.y, 2)
        );
        const radius = food.size / 2 + GRID_SIZE * 3.5;
        console.log(`🔍 Nearest food: ${nearestFoodId} at distance ${distance.toFixed(1)}px (radius: ${radius.toFixed(1)}px)`);
      }
    }
    
    // Check for rollback of pending removals
    this.checkPendingRemovalsRollback();
    
    // Check for rollback of pending growth
    this.checkPendingGrowthRollback();
  }
  
  private optimisticallyRemoveFood(foodId: string, food: NetworkFoodItem): void {
    const timestamp = Date.now();
    
    console.log(`⚡ Optimistically removing food ${foodId} immediately`);
    
    // Store pending removal with timestamp
    this.pendingFoodRemovals.set(foodId, timestamp);
    
    // Immediately remove food from display (optimistic)
    const foodItem = this.networkFood.get(foodId);
    if (foodItem) {
      // Store food data for potential rollback
      this.pendingFoodData.set(foodId, { ...foodItem.data });
      
      // Ensure immediate removal from scene
      // Set inactive first to remove from render list immediately
      if (foodItem.graphics && !foodItem.graphics.destroyed) {
        foodItem.graphics.setActive(false);
        foodItem.graphics.setVisible(false);
        
        // Destroy graphics for instant visual feedback
        foodItem.graphics.destroy();
        
        console.log(`⚡ Food ${foodId} graphics destroyed and removed from scene`);
      }
      
      // Remove from Map immediately
      this.networkFood.delete(foodId);
      
      // Verify removal
      if (this.networkFood.has(foodId)) {
        console.error(`❌ ERROR: Food ${foodId} still in Map after deletion!`);
      } else {
        console.log(`✅ Food ${foodId} removed from Map successfully`);
      }
      
      console.log(`⚡ Food ${foodId} destroyed immediately - Map size: ${this.networkFood.size}`);
    } else {
      console.warn(`⚠️ Food ${foodId} not found in Map for optimistic removal`);
    }
  }
  
  private optimisticallyGrowSnake(growthAmount: number): void {
    const timestamp = Date.now();
    
    console.log(`⚡ Optimistically growing snake by ${growthAmount} segments`);
    
    // Store pending growth
    this.pendingGrowth += growthAmount;
    this.pendingGrowthTimestamp = timestamp;
    this.expectedLength = this.snake.getLength() + this.pendingGrowth;
    
    // Immediately grow snake locally
    for (let i = 0; i < growthAmount; i++) {
      this.snake.grow();
    }
    
    console.log(`⚡ Snake grown immediately. Current length: ${this.snake.getLength()}, Expected: ${this.expectedLength}`);
  }
  
  private checkPendingRemovalsRollback(): void {
    const currentTime = Date.now();
    const ROLLBACK_TIMEOUT = 200; // ms
    
    // Check all pending removals
    for (const [foodId, timestamp] of this.pendingFoodRemovals.entries()) {
      const age = currentTime - timestamp;
      
      // If pending removal is older than timeout and hasn't been confirmed
      if (age > ROLLBACK_TIMEOUT) {
        console.warn(`⚠️ ROLLBACK: Food ${foodId} removal not confirmed after ${age}ms, rolling back`);
        
        // Rollback: Re-create the food graphics
        const foodData = this.pendingFoodData.get(foodId);
        if (foodData) {
          // Re-create graphics for rollback
          const graphics = this.add.graphics();
          graphics.fillStyle(foodData.color);
          graphics.fillCircle(foodData.x, foodData.y, foodData.size / 2);
          this.networkFood.set(foodId, { graphics, data: foodData });
          
          console.log(`⚠️ Food ${foodId} re-created after rollback`);
        }
        
        // Clean up pending state
        this.pendingFoodRemovals.delete(foodId);
        this.pendingFoodData.delete(foodId);
      }
    }
  }
  
  private checkPendingGrowthRollback(): void {
    const currentTime = Date.now();
    const ROLLBACK_TIMEOUT = 200; // ms
    
    // Check if pending growth is too old and hasn't been confirmed
    if (this.pendingGrowth > 0 && this.pendingGrowthTimestamp > 0) {
      const age = currentTime - this.pendingGrowthTimestamp;
      
      if (age > ROLLBACK_TIMEOUT) {
        // Note: We can't easily rollback snake growth without storing previous state
        // In practice, the server should always confirm, so this is a rare edge case
        console.warn(`⚠️ Pending snake growth not confirmed after ${age}ms`);
        // We'll let server correction handle this via handleServerLengthChange()
      }
    }
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
    
    const clientLength = this.snake.getLength();
    console.log(`🔄 SERVER LENGTH UPDATE: Server=${serverLength}, Client=${clientLength}, LastKnown=${this.lastKnownServerLength}, PendingGrowth=${this.pendingGrowth}`);
    
    // Initialize if this is the first update
    if (this.lastKnownServerLength === 0) {
      console.log(`🔄 INITIALIZING: Setting lastKnownServerLength to ${serverLength}`);
      this.lastKnownServerLength = serverLength;
      // Reset pending growth if any
      this.pendingGrowth = 0;
      this.expectedLength = serverLength;
      return;
    }
    
    // Check if we have pending growth
    if (this.pendingGrowth > 0) {
      const expectedLengthWithPending = this.lastKnownServerLength + this.pendingGrowth;
      
      // Server confirms our optimistic growth
      if (serverLength >= expectedLengthWithPending) {
        console.log(`✅ Server confirmed optimistic growth! Server=${serverLength}, Expected=${expectedLengthWithPending}`);
        // Confirm pending growth
        this.confirmPendingGrowth(this.pendingGrowth);
        this.lastKnownServerLength = serverLength;
        this.pendingGrowth = 0;
        this.expectedLength = serverLength;
        return;
      } else {
        // Server didn't confirm all our growth - partial confirmation or rollback
        const actualGrowth = serverLength - this.lastKnownServerLength;
        if (actualGrowth > 0) {
          console.log(`⚠️ Server confirmed partial growth: ${actualGrowth} out of ${this.pendingGrowth} expected`);
          // Adjust pending growth
          this.pendingGrowth -= actualGrowth;
          this.lastKnownServerLength = serverLength;
        } else {
          // Server didn't detect collision - rollback
          console.warn(`⚠️ Server didn't confirm growth! Rolling back ${this.pendingGrowth} segments`);
          this.rollbackPendingGrowth();
        }
        return;
      }
    }
    
    // No pending growth - normal update
    const lengthDifference = serverLength - this.lastKnownServerLength;
    if (lengthDifference > 0) {
      console.log(`🐍 GROWING: ${this.lastKnownServerLength} -> ${serverLength} (+${lengthDifference})`);
      
      // Grow the snake locally for each segment increase
      for (let i = 0; i < lengthDifference; i++) {
        this.snake.grow();
      }
      
      this.lastKnownServerLength = serverLength;
    } else if (lengthDifference < 0) {
      console.log(`🐍 SHRINKING: ${this.lastKnownServerLength} -> ${serverLength} (${lengthDifference})`);
      
      // Shrink the snake locally for each segment decrease
      for (let i = 0; i < Math.abs(lengthDifference); i++) {
        this.snake.shrink();
      }
      
      this.lastKnownServerLength = serverLength;
    } else {
      // Length matches - no change needed
    }
  }
  
  private confirmPendingRemoval(foodId: string): void {
    console.log(`✅ Confirming pending removal of food ${foodId}`);
    
    // Graphics already destroyed optimistically, just clean up pending state
    this.pendingFoodRemovals.delete(foodId);
    this.pendingFoodData.delete(foodId);
    
    // Verify food is not in Map (should already be removed)
    if (this.networkFood.has(foodId)) {
      console.warn(`⚠️ Food ${foodId} still in Map after confirmation, removing`);
      const foodItem = this.networkFood.get(foodId);
      if (foodItem) {
        foodItem.graphics.destroy();
        this.networkFood.delete(foodId);
      }
    }
    
    console.log(`✅ Food ${foodId} removal confirmed by server`);
  }
  
  private confirmPendingGrowth(amount: number): void {
    console.log(`✅ Confirming ${amount} pending growth segments`);
    // Growth already applied optimistically, just clear pending state
    this.pendingGrowth -= amount;
    if (this.pendingGrowth < 0) this.pendingGrowth = 0;
  }
  
  private rollbackPendingGrowth(): void {
    console.warn(`⚠️ Rolling back ${this.pendingGrowth} pending growth segments`);
    
    // Shrink snake back by pending growth amount
    for (let i = 0; i < this.pendingGrowth; i++) {
      if (this.snake && this.snake.getLength() > SNAKE_INITIAL_LENGTH) {
        this.snake.shrink();
      }
    }
    
    // Reset pending growth
    this.pendingGrowth = 0;
    this.pendingGrowthTimestamp = 0;
    this.expectedLength = this.snake ? this.snake.getLength() : 0;
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
    
    // Check collisions BEFORE snake moves (use current position for immediate feedback)
    // This ensures collision is detected as soon as snake head touches food
    this.checkCollisions();
    
    // Update local snake with client-side prediction
    if (this.snake && this.useLocalPrediction) {
      this.snake.update(delta);
    }
    
    // Local food manager disabled for networked gameplay
    // this.foodManager.update(time);
    
    // Update camera
    this.updateCamera();
    
    // Check arena proximity
    this.checkArenaProximity();
    
    // Local food manager disabled for networked gameplay
    // if (this.snake) {
    //   this.foodManager.updateSnakePositions(this.snake.getAllSegments());
    // }
  }
}