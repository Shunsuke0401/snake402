// Server-side FoodManager for food collision validation and respawn logic

export interface FoodItem {
  id: string;
  x: number;
  y: number;
  type: 'small' | 'large';
  color: number;
  size: number;
  score: number;
  growthAmount: number;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  segments: Array<{ x: number; y: number }>;
  length: number;
  score: number;
}

export interface FoodEatenResult {
  success: boolean;
  food?: FoodItem;
  newFood?: FoodItem;
}

export class FoodManager {
  private food: Map<string, FoodItem> = new Map();
  private maxFood: number;
  private arenaCenter: { x: number; y: number };
  private arenaRadius: number;
  private gridSize: number;
  
  // Collision constants
  private readonly FOOD_RADIUS = 15;
  private readonly SNAKE_EAT_RADIUS = 25;

  constructor(
    maxFood: number,
    arenaCenter: { x: number; y: number },
    arenaRadius: number,
    gridSize: number
  ) {
    this.maxFood = maxFood;
    this.arenaCenter = arenaCenter;
    this.arenaRadius = arenaRadius;
    this.gridSize = gridSize;
    
    // Initialize with food
    this.initializeFood();
  }

  private initializeFood(): void {
    for (let i = 0; i < this.maxFood; i++) {
      this.spawnFood();
    }
  }

  public spawnFood(): FoodItem {
    const id = `food_${Date.now()}_${Math.random()}`;
    
    // Random position within arena using uniform distribution
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.sqrt(Math.random()) * (this.arenaRadius - 50);
    const x = this.arenaCenter.x + Math.cos(angle) * radius;
    const y = this.arenaCenter.y + Math.sin(angle) * radius;

    // 90% small food, 10% large food
    const isLarge = Math.random() < 0.1;
    const foodType = isLarge ? 'large' : 'small';

    const food: FoodItem = {
      id,
      x: Math.round(x / this.gridSize) * this.gridSize,
      y: Math.round(y / this.gridSize) * this.gridSize,
      type: foodType,
      color: isLarge ? 0x9C27B0 : 0xFF5722,
      size: isLarge ? 40 : 20,
      score: isLarge ? 25 : 10,
      growthAmount: isLarge ? 2 : 1
    };

    this.food.set(id, food);
    return food;
  }

  public validateEatAttempt(player: Player, foodId: string): FoodEatenResult {
    const food = this.food.get(foodId);
    
    if (!food) {
      console.log(`❌ Food validation failed: Food ${foodId} not found`);
      return { success: false };
    }

    if (!player.segments || player.segments.length === 0) {
      console.log(`❌ Food validation failed: Player ${player.id} has no segments`);
      return { success: false };
    }

    // Check collision with player's head
    const head = player.segments[0];
    const distance = Math.sqrt(
      Math.pow(head.x - food.x, 2) + Math.pow(head.y - food.y, 2)
    );

    const collisionDistance = this.FOOD_RADIUS + this.SNAKE_EAT_RADIUS;
    
    if (distance <= collisionDistance) {
      console.log(`✅ Food validation success: Player ${player.id} ate food ${foodId} at distance ${distance.toFixed(2)} (max: ${collisionDistance})`);
      
      // Remove the eaten food
      this.food.delete(foodId);
      
      // Spawn new food to maintain count
      const newFood = this.spawnFood();
      
      return {
        success: true,
        food,
        newFood
      };
    } else {
      console.log(`❌ Food validation failed: Player ${player.id} too far from food ${foodId} (distance: ${distance.toFixed(2)}, max: ${collisionDistance})`);
      return { success: false };
    }
  }

  public removeFood(foodId: string): boolean {
    return this.food.delete(foodId);
  }

  public getAllFood(): FoodItem[] {
    return Array.from(this.food.values());
  }

  public getFoodCount(): number {
    return this.food.size;
  }

  public maintainFoodCount(): FoodItem[] {
    const newFood: FoodItem[] = [];
    
    // Ensure we always have maxFood items
    while (this.food.size < this.maxFood) {
      newFood.push(this.spawnFood());
    }
    
    return newFood;
  }

  public getFoodById(foodId: string): FoodItem | undefined {
    return this.food.get(foodId);
  }
}