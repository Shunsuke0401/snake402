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
  Direction,
  KEYS,
  GAME_DURATION
} from './config';

export class GameScene extends Phaser.Scene {
  private snake!: Snake;
  private foodManager!: FoodManager;
  private uiScene!: UIScene;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { [key: string]: Phaser.Input.Keyboard.Key };
  
  private gameStartTime: number = 0;
  private score: number = 0;
  private isGameActive: boolean = true;
  private fpsText!: Phaser.GameObjects.Text;

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

  private setupInput(): void {
    // Arrow keys
    this.cursors = this.input.keyboard!.createCursorKeys();
    
    // WASD keys
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    };
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
    
    // Check for direction changes
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) {
      this.snake.setDirection(Direction.UP);
    } else if (this.cursors.down.isDown || this.wasdKeys.S.isDown) {
      this.snake.setDirection(Direction.DOWN);
    } else if (this.cursors.left.isDown || this.wasdKeys.A.isDown) {
      this.snake.setDirection(Direction.LEFT);
    } else if (this.cursors.right.isDown || this.wasdKeys.D.isDown) {
      this.snake.setDirection(Direction.RIGHT);
    }
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
      this.snake.grow();
      this.score += this.foodManager.getFoodScore();
      this.uiScene.updateScore(this.score);
      this.uiScene.updateLength(this.snake.getLength());
    }
    
    // Check wall collision
    if (this.snake.checkWallCollision()) {
      this.gameOver('Hit the wall!');
      return;
    }
  }

  private updateTimer(): void {
    if (!this.isGameActive) return;
    
    const elapsed = (this.time.now - this.gameStartTime) / 1000;
    const timeRemaining = GAME_DURATION - elapsed;
    
    this.uiScene.updateTimer(timeRemaining);
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

  update(time: number): void {
    // Update FPS display
    this.fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    
    if (!this.isGameActive) return;
    
    // Handle input
    this.handleInput();
    
    // Update game objects
    this.snake.update(time);
    this.foodManager.update(time);
    
    // Update camera
    this.updateCamera();
    
    // Check collisions
    this.checkCollisions();
    
    // Update timer
    this.updateTimer();
    
    // Update food manager with snake positions to avoid spawning on snake
    this.foodManager.updateSnakePositions(this.snake.getAllSegments());
  }
}