import Phaser from 'phaser';
import { Snake } from './Snake';
import { FoodManager } from './Food';
import { UIScene } from './UIScene';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BACKGROUND_COLOR,
  GRID_LINE_COLOR,
  GRID_SIZE,
  CAMERA_FOLLOW_SPEED,
  CAMERA_ZOOM,
  GAME_DURATION,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_RADIUS,
  ARENA_WARNING_DISTANCE,
  ARENA_BOUNDARY_COLOR,
  ARENA_WARNING_COLOR
} from './config';

export class GameScene extends Phaser.Scene {
  private snake!: Snake;
  private foodManager!: FoodManager;
  private uiScene!: UIScene;
  
  private gameStartTime: number = 0;
  private score: number = 0;
  private isGameActive: boolean = true;
  private fpsText!: Phaser.GameObjects.Text;
  
  // Mouse tracking for cursor behavior
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private hasMouseMoved: boolean = false;
  
  // Arena boundary graphics
  private arenaBoundary!: Phaser.GameObjects.Graphics;
  private arenaWarning!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.setupWorld();
    this.setupInput();
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
    // Enable mouse input
    this.input.mouse!.enabled = true;
    
    // Track mouse movement
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      
      // Check if mouse actually moved
      if (Math.abs(worldX - this.lastMouseX) > 1 || Math.abs(worldY - this.lastMouseY) > 1) {
        this.hasMouseMoved = true;
        this.lastMouseX = worldX;
        this.lastMouseY = worldY;
      }
    });
  }

  private setupGame(): void {
    // Initialize snake at center of world
    const startX = Math.floor(WORLD_WIDTH / GRID_SIZE / 2);
    const startY = Math.floor(WORLD_HEIGHT / GRID_SIZE / 2);
    this.snake = new Snake(this, startX, startY);
    
    // Initialize food manager
    this.foodManager = new FoodManager(this);
    
    // Reset game state
    this.score = 0;
    this.isGameActive = true;
  }

  private setupCamera(): void {
    // Set camera to follow snake with smooth movement
    const snakeHead = this.snake.getHeadPosition();
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.centerOn(snakeHead.x, snakeHead.y);
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
  }

  private setupEventListeners(): void {
    // Listen for UI events
    this.uiScene.events.on('restartGame', this.restartGame, this);
    this.uiScene.events.on('gameOver', this.handleGameOver, this);
  }

  private handleInput(): void {
    if (!this.isGameActive) return;
    
    const pointer = this.input.activePointer;
    
    // Only update snake direction if mouse has moved
    if (this.hasMouseMoved) {
      // Get cursor position in world coordinates
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      
      // Get snake head position
      const headPos = this.snake.getHeadPosition();
      
      // Calculate angle from snake head to cursor
      const dx = worldX - headPos.x;
      const dy = worldY - headPos.y;
      const targetAngle = Math.atan2(dy, dx);
      
      // Set snake target angle
      this.snake.setTargetAngle(targetAngle);
      
      // Reset mouse moved flag
      this.hasMouseMoved = false;
    }
    
    // Always handle boosting regardless of mouse movement
    this.snake.setBoosting(pointer.isDown);
  }

  private updateCamera(): void {
    const snakeHead = this.snake.getHeadPosition();
    const camera = this.cameras.main;
    
    // Smooth camera following with lag
    const targetX = snakeHead.x;
    const targetY = snakeHead.y;
    const currentX = camera.scrollX + camera.width / 2;
    const currentY = camera.scrollY + camera.height / 2;
    
    const newX = Phaser.Math.Linear(currentX, targetX, CAMERA_FOLLOW_SPEED);
    const newY = Phaser.Math.Linear(currentY, targetY, CAMERA_FOLLOW_SPEED);
    
    camera.centerOn(newX, newY);
  }

  private checkCollisions(): void {
    if (!this.isGameActive) return;
    
    const headGridPos = this.snake.getHeadGridPosition();
    
    // Check food collision
    const eatenFood = this.foodManager.checkCollision(headGridPos.gridX, headGridPos.gridY);
    if (eatenFood) {
      // Grow snake based on food's growth amount
      for (let i = 0; i < eatenFood.growthAmount; i++) {
        this.snake.grow();
      }
      this.score += eatenFood.score;
      this.uiScene.updateScore(this.score);
      this.uiScene.updateLength(this.snake.getLength());
    }
    
    // Check arena boundary collision
    const head = this.snake.getHeadPosition();
    const dx = head.x - ARENA_CENTER_X;
    const dy = head.y - ARENA_CENTER_Y;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    
    if (distanceFromCenter >= ARENA_RADIUS) {
      this.gameOver('Hit the wall!');
      return;
    }
    
    // Self collision disabled - players can pass through their own body
  }

  private updateTimer(): void {
    if (!this.isGameActive) return;
    
    const elapsed = (this.time.now - this.gameStartTime) / 1000;
    const timeRemaining = GAME_DURATION - elapsed;
    
    this.uiScene.updateTimer(timeRemaining);
  }

  private checkArenaProximity(): void {
    const head = this.snake.getHeadPosition();
    
    // Calculate distance from snake head to arena center
    const dx = head.x - ARENA_CENTER_X;
    const dy = head.y - ARENA_CENTER_Y;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    
    // Check if snake is approaching the boundary
    const distanceFromBoundary = ARENA_RADIUS - distanceFromCenter;
    
    if (distanceFromBoundary <= ARENA_WARNING_DISTANCE) {
      // Show warning circle when approaching boundary
      this.arenaWarning.setVisible(true);
      
      // Show red boundary when very close
      if (distanceFromBoundary <= 100) {
        this.arenaBoundary.setVisible(true);
      } else {
        this.arenaBoundary.setVisible(false);
      }
    } else {
      // Hide both circles when far from boundary
      this.arenaWarning.setVisible(false);
      this.arenaBoundary.setVisible(false);
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
    // Destroy current game objects
    this.snake.destroy();
    this.foodManager.destroy();
    
    // Reset game
    this.setupGame();
    this.setupCamera();
    
    // Reset timer
    this.gameStartTime = this.time.now;
  }

  update(time: number, delta: number): void {
    // Update FPS display
    this.fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    
    if (!this.isGameActive) return;
    
    // Handle input
    this.handleInput();
    
    // Update game objects
    this.snake.update(delta);
    this.foodManager.update(time);
    
    // Update camera
    this.updateCamera();
    
    // Check collisions
    this.checkCollisions();
    
    // Check arena proximity
    this.checkArenaProximity();
    
    // Update timer
    this.updateTimer();
    
    // Update food manager with snake positions to avoid spawning on snake
    this.foodManager.updateSnakePositions(this.snake.getAllSegments());
  }
}