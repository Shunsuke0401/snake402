import Phaser from 'phaser';
import {
  GRID_SIZE,
  FOOD_COUNT,
  FOOD_COLOR,
  FOOD_SIZE,
  FOOD_SCORE,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  GRID_COLS,
  GRID_ROWS,
  FoodType,
  FOOD_TYPES,
  FOOD_COLORS,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_RADIUS,
  MAX_FOOD,
  FOOD_RESPAWN_INTERVAL
} from './config';

interface FoodData {
  gridX: number;
  gridY: number;
  type: FoodType;
  color: number;
  size: number;
  gridSize: number;
  score: number;
  growthAmount: number;
  pulsePhase: number;
}

export class FoodManager {
  private scene: Phaser.Scene;
  private foodGroup!: Phaser.GameObjects.Group;
  private occupiedPositions: Set<string> = new Set();
  private lastReplenishTime: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createFoodGroup();
    this.spawnInitialFood();
  }

  private createFoodGroup(): void {
    // Create the food texture first
    this.createFoodTexture();
    
    this.foodGroup = this.scene.add.group({
      maxSize: MAX_FOOD
    });
    
    // Pre-populate the group with sprites
    for (let i = 0; i < MAX_FOOD; i++) {
      const sprite = this.scene.add.sprite(0, 0, 'food-circle');
      sprite.setActive(false).setVisible(false);
      this.foodGroup.add(sprite);
    }
  }

  private createFoodTexture(): void {
    // Only create the texture once
    if (this.scene.textures.exists('food-circle')) {
      return;
    }

    const graphics = this.scene.add.graphics();
    graphics.fillStyle(0xffffff); // White circle that we'll tint
    graphics.fillCircle(FOOD_SIZE / 2, FOOD_SIZE / 2, FOOD_SIZE / 2);
    graphics.generateTexture('food-circle', FOOD_SIZE, FOOD_SIZE);
    graphics.destroy();
  }

  private spawnInitialFood(): void {
    for (let i = 0; i < MAX_FOOD; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    // Get an inactive sprite from the pool
    const sprite = this.foodGroup.getFirstDead(false) as Phaser.GameObjects.Sprite;
    if (!sprite) {
      return; // Pool is full
    }

    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      // Generate random position within arena bounds with uniform area distribution
      const angle = Math.random() * Math.PI * 2;
      // Use square root for uniform area distribution (compensates for increasing circumference)
      const radius = Math.sqrt(Math.random()) * (ARENA_RADIUS - 50); // Leave some margin
      const worldX = ARENA_CENTER_X + Math.cos(angle) * radius;
      const worldY = ARENA_CENTER_Y + Math.sin(angle) * radius;

      // Convert to grid coordinates
      const gridX = Math.floor(worldX / GRID_SIZE);
      const gridY = Math.floor(worldY / GRID_SIZE);

      // Check if position is valid and not occupied
      if (this.isValidPosition(gridX, gridY)) {
        // Select food type and properties
         const foodType = this.selectFoodType();
         const foodConfig = FOOD_TYPES[foodType];
         const color = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];

        const foodData: FoodData = {
          gridX,
          gridY,
          type: foodType,
          color,
          size: foodConfig.size,
          gridSize: foodConfig.gridSize,
          score: foodConfig.score,
          growthAmount: foodConfig.growthAmount,
          pulsePhase: Math.random() * Math.PI * 2
        };

        // Position and configure the sprite
        sprite.setPosition(worldX, worldY);
        sprite.setActive(true).setVisible(true);
        sprite.setData('foodData', foodData);
        this.drawFood(sprite, foodData);

        // Mark positions as occupied
        for (let dx = 0; dx < foodData.gridSize; dx++) {
          for (let dy = 0; dy < foodData.gridSize; dy++) {
            const positionKey = `${gridX + dx},${gridY + dy}`;
            this.occupiedPositions.add(positionKey);
          }
        }

        break;
      }
      
      attempts++;
    }
  }

  private drawFood(sprite: Phaser.GameObjects.Sprite, foodData: FoodData): void {
    // Calculate pulsing effect
    const pulseScale = 1 + Math.sin(foodData.pulsePhase) * 0.1;
    const currentSize = foodData.size * pulseScale;
    
    // Set sprite properties
    sprite.setTint(foodData.color);
    sprite.setScale(currentSize / FOOD_SIZE); // Scale relative to base food size
    sprite.setAlpha(1);
  }

  private selectFoodType(): FoodType {
    const rand = Math.random();
    if (rand < 0.9) return FoodType.SMALL;
    return FoodType.LARGE;
  }

  private isValidPosition(gridX: number, gridY: number): boolean {
    // Check bounds
    if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) {
      return false;
    }

    // Check if position is occupied
    const positionKey = `${gridX},${gridY}`;
    return !this.occupiedPositions.has(positionKey);
  }

  private getLighterColor(color: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    
    const lighterR = Math.min(255, r + 50);
    const lighterG = Math.min(255, g + 50);
    const lighterB = Math.min(255, b + 50);
    
    return (lighterR << 16) | (lighterG << 8) | lighterB;
  }

  public update(time: number): void {
    // Update pulsing animation for all active food
    this.foodGroup.children.entries.forEach((child) => {
      const sprite = child as Phaser.GameObjects.Sprite;
      if (sprite.active) {
        const foodData = sprite.getData('foodData') as FoodData;
        if (foodData) {
          foodData.pulsePhase += 0.1;
          this.drawFood(sprite, foodData);
        }
      }
    });

    // Maintain food density with timed replenishment
    if (time - this.lastReplenishTime > FOOD_RESPAWN_INTERVAL) {
      this.maintainFoodDensity();
      this.lastReplenishTime = time;
    }
  }

  private maintainFoodDensity(): void {
    const activeFood = this.foodGroup.countActive(true);
    const foodNeeded = MAX_FOOD - activeFood;
    
    // Spawn up to 5 food items at a time to avoid performance spikes
    const spawnCount = Math.min(foodNeeded, 5);
    for (let i = 0; i < spawnCount; i++) {
      this.spawnFood();
    }
  }

  public checkCollision(snakeHeadGridX: number, snakeHeadGridY: number): FoodData | null {
    let eatenFood: FoodData | null = null;

    this.foodGroup.children.entries.forEach((child) => {
      const sprite = child as Phaser.GameObjects.Sprite;
      if (sprite.active) {
        const foodData = sprite.getData('foodData') as FoodData;
        if (foodData) {
          // Check if snake head overlaps with any part of the food
          for (let dx = 0; dx < foodData.gridSize; dx++) {
            for (let dy = 0; dy < foodData.gridSize; dy++) {
              if (snakeHeadGridX === foodData.gridX + dx && snakeHeadGridY === foodData.gridY + dy) {
                eatenFood = foodData;
                this.recycleFoodSprite(sprite, foodData);
                return;
              }
            }
          }
        }
      }
    });

    return eatenFood;
  }

  private recycleFoodSprite(sprite: Phaser.GameObjects.Sprite, foodData: FoodData): void {
    // Remove from occupied positions
    for (let dx = 0; dx < foodData.gridSize; dx++) {
      for (let dy = 0; dy < foodData.gridSize; dy++) {
        const positionKey = `${foodData.gridX + dx},${foodData.gridY + dy}`;
        this.occupiedPositions.delete(positionKey);
      }
    }
    
    // Recycle the sprite instead of destroying it
    sprite.setActive(false).setVisible(false);
    sprite.setData('foodData', undefined);
    
    // The sprite stays in the group pool for reuse
  }

  public addOccupiedPosition(gridX: number, gridY: number): void {
    const positionKey = `${gridX},${gridY}`;
    this.occupiedPositions.add(positionKey);
  }

  public removeOccupiedPosition(gridX: number, gridY: number): void {
    const positionKey = `${gridX},${gridY}`;
    this.occupiedPositions.delete(positionKey);
  }

  public updateSnakePositions(snakeSegments: Array<{ gridX: number; gridY: number }>): void {
    // Clear previous snake positions
    this.occupiedPositions.forEach(positionKey => {
      if (positionKey.startsWith('snake_')) {
        this.occupiedPositions.delete(positionKey);
      }
    });

    // Add current snake positions
    snakeSegments.forEach(segment => {
      const positionKey = `snake_${segment.gridX},${segment.gridY}`;
      this.occupiedPositions.add(positionKey);
    });
  }

  public getFoodScore(): number {
    return FOOD_SCORE;
  }

  public destroy(): void {
    this.foodGroup.destroy();
  }
}