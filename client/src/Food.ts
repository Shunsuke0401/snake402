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
  GRID_ROWS
} from './config';

interface FoodItem {
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
  pulsePhase: number; // For animation
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
    
    while (attempts < maxAttempts) {
      // Adjust random coordinates to ensure 2x2 food fits within bounds
      const gridX = Math.floor(Math.random() * (GRID_COLS - 1));
      const gridY = Math.floor(Math.random() * (GRID_ROWS - 1));
      
      // Check if all 4 positions of the 2x2 block are available
      const positions = [
        `${gridX},${gridY}`,
        `${gridX + 1},${gridY}`,
        `${gridX},${gridY + 1}`,
        `${gridX + 1},${gridY + 1}`
      ];
      
      const allPositionsAvailable = positions.every(pos => !this.occupiedPositions.has(pos));
      
      if (allPositionsAvailable) {
        // Center the food item within the 2x2 area
        const x = gridX * GRID_SIZE + GRID_SIZE;
        const y = gridY * GRID_SIZE + GRID_SIZE;
        
        const graphics = this.scene.add.graphics();
        const foodItem: FoodItem = {
          gridX,
          gridY,
          x,
          y,
          graphics,
          pulsePhase: Math.random() * Math.PI * 2 // Random starting phase
        };
        
        this.foodItems.push(foodItem);
        
        // Mark all 4 positions as occupied
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
    const size = FOOD_SIZE * pulseScale;
    
    // Main food circle
    graphics.fillStyle(FOOD_COLOR);
    graphics.fillCircle(food.x, food.y, size / 2);
    
    // Inner highlight for Chrome-Snake feel
    graphics.fillStyle(0xFFAB91); // Lighter orange
    graphics.fillCircle(food.x - size * 0.15, food.y - size * 0.15, size * 0.25);
    
    // Subtle border
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeCircle(food.x, food.y, size / 2);
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
      // Check if snake head is within the 2x2 area of the food
      return snakeHeadGridX >= food.gridX && snakeHeadGridX <= food.gridX + 1 &&
             snakeHeadGridY >= food.gridY && snakeHeadGridY <= food.gridY + 1;
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
    
    // Remove all 4 positions of the 2x2 food from occupied positions
    const positions = [
      `${food.gridX},${food.gridY}`,
      `${food.gridX + 1},${food.gridY}`,
      `${food.gridX},${food.gridY + 1}`,
      `${food.gridX + 1},${food.gridY + 1}`
    ];
    
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