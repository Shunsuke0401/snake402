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
  FOOD_COLORS
} from './config';

interface FoodItem {
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
  pulsePhase: number; // For animation
  type: FoodType;
  color: number;
  size: number;
  gridSize: number;
  score: number;
  growthAmount: number;
}

export class FoodManager {
  private scene: Phaser.Scene;
  private foodItems: FoodItem[] = [];
  private occupiedPositions: Set<string> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.spawnInitialFood();
  }

  private spawnInitialFood(): void {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    let attempts = 0;
    const maxAttempts = 100;
    
    // Determine food type based on spawn chance
    const random = Math.random();
    const foodType = random < FOOD_TYPES[FoodType.SMALL].spawnChance ? FoodType.SMALL : FoodType.LARGE;
    const foodConfig = FOOD_TYPES[foodType];
    
    // Select a random color from the color palette
    const colorIndex = Math.floor(Math.random() * FOOD_COLORS.length);
    const foodColor = FOOD_COLORS[colorIndex];
    
    while (attempts < maxAttempts) {
      // Adjust random coordinates based on food size
      const maxGridX = GRID_COLS - foodConfig.gridSize;
      const maxGridY = GRID_ROWS - foodConfig.gridSize;
      const gridX = Math.floor(Math.random() * maxGridX);
      const gridY = Math.floor(Math.random() * maxGridY);
      
      // Generate positions based on food grid size
      const positions: string[] = [];
      for (let dx = 0; dx < foodConfig.gridSize; dx++) {
        for (let dy = 0; dy < foodConfig.gridSize; dy++) {
          positions.push(`${gridX + dx},${gridY + dy}`);
        }
      }
      
      const allPositionsAvailable = positions.every(pos => !this.occupiedPositions.has(pos));
      
      if (allPositionsAvailable) {
        // Center the food item within its grid area
        const x = gridX * GRID_SIZE + (foodConfig.gridSize * GRID_SIZE) / 2;
        const y = gridY * GRID_SIZE + (foodConfig.gridSize * GRID_SIZE) / 2;
        
        const graphics = this.scene.add.graphics();
        const foodItem: FoodItem = {
          gridX,
          gridY,
          x,
          y,
          graphics,
          pulsePhase: Math.random() * Math.PI * 2, // Random starting phase
          type: foodType,
          color: foodColor,
          size: foodConfig.size,
          gridSize: foodConfig.gridSize,
          score: foodConfig.score,
          growthAmount: foodConfig.growthAmount
        };
        
        this.foodItems.push(foodItem);
        
        // Mark all positions as occupied
        positions.forEach(pos => this.occupiedPositions.add(pos));
        
        this.drawFood(foodItem);
        break;
      }
      
      attempts++;
    }
  }

  private drawFood(food: FoodItem): void {
    const graphics = food.graphics;
    graphics.clear();
    
    // Pulsing animation
    const pulseScale = 0.8 + 0.2 * Math.sin(food.pulsePhase);
    const size = food.size * pulseScale;
    
    // Main food circle with food's color
    graphics.fillStyle(food.color);
    graphics.fillCircle(food.x, food.y, size / 2);
    
    // Inner highlight for visual appeal - lighter version of the main color
    const highlightColor = this.getLighterColor(food.color);
    graphics.fillStyle(highlightColor);
    graphics.fillCircle(food.x - size * 0.15, food.y - size * 0.15, size * 0.25);
    
    // Different visual effects for different food types
    if (food.type === FoodType.LARGE) {
      // Add sparkle effect for rare food
      graphics.fillStyle(0xFFFFFF);
      const sparkleSize = size * 0.1;
      graphics.fillCircle(food.x + size * 0.2, food.y - size * 0.2, sparkleSize);
      graphics.fillCircle(food.x - size * 0.3, food.y + size * 0.1, sparkleSize * 0.7);
    }
    
    // Subtle border
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeCircle(food.x, food.y, size / 2);
  }

  private getLighterColor(color: number): number {
    // Extract RGB components
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    
    // Make each component lighter
    const lighterR = Math.min(255, r + 60);
    const lighterG = Math.min(255, g + 60);
    const lighterB = Math.min(255, b + 60);
    
    // Combine back to hex
    return (lighterR << 16) | (lighterG << 8) | lighterB;
  }

  public update(time: number): void {
    // Update food animations
    this.foodItems.forEach(food => {
      food.pulsePhase += 0.05; // Pulse speed
      this.drawFood(food);
    });
  }

  public checkCollision(snakeHeadGridX: number, snakeHeadGridY: number): FoodItem | null {
    const foodIndex = this.foodItems.findIndex(food => {
      // Check if snake head is within the food's grid area
      return snakeHeadGridX >= food.gridX && snakeHeadGridX < food.gridX + food.gridSize &&
             snakeHeadGridY >= food.gridY && snakeHeadGridY < food.gridY + food.gridSize;
    });
    
    if (foodIndex !== -1) {
      const eatenFood = this.foodItems[foodIndex];
      this.removeFood(foodIndex);
      this.spawnFood(); // Spawn new food to maintain count
      return eatenFood;
    }
    
    return null;
  }

  private removeFood(index: number): void {
    const food = this.foodItems[index];
    
    // Remove all positions of the food from occupied positions based on its grid size
    const positions: string[] = [];
    for (let dx = 0; dx < food.gridSize; dx++) {
      for (let dy = 0; dy < food.gridSize; dy++) {
        positions.push(`${food.gridX + dx},${food.gridY + dy}`);
      }
    }
    
    positions.forEach(pos => this.occupiedPositions.delete(pos));
    food.graphics.destroy();
    this.foodItems.splice(index, 1);
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
    // Clear old snake positions
    this.occupiedPositions.forEach(pos => {
      if (pos.includes('snake_')) {
        this.occupiedPositions.delete(pos);
      }
    });
    
    // Add current snake positions
    snakeSegments.forEach((segment, index) => {
      const positionKey = `snake_${segment.gridX},${segment.gridY}`;
      this.occupiedPositions.add(positionKey);
    });
  }

  public getFoodScore(): number {
    return FOOD_SCORE;
  }

  public destroy(): void {
    this.foodItems.forEach(food => {
      food.graphics.destroy();
    });
    this.foodItems = [];
    this.occupiedPositions.clear();
  }
}