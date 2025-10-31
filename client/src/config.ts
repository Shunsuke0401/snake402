// Game Configuration Constants

// World dimensions
export const WORLD_WIDTH = 6000;
export const WORLD_HEIGHT = 6000;

// Grid settings
export const GRID_SIZE = 20;
export const GRID_COLS = WORLD_WIDTH / GRID_SIZE;
export const GRID_ROWS = WORLD_HEIGHT / GRID_SIZE;

// Snake settings
export const SNAKE_INITIAL_LENGTH = 3;
export const SNAKE_SPEED = 150; // milliseconds between moves
export const SNAKE_TURN_SPEED = 0.1; // smooth turning rate
export const SNAKE_COLOR = 0x4CAF50; // Green
export const SNAKE_HEAD_COLOR = 0x2E7D32; // Darker green

// Cursor control settings
export const BASE_SPEED = 200; // pixels per second
export const BOOST_MULTIPLIER = 1.5; // speed multiplier when boosting
export const ROTATION_SPEED = 0.1; // smooth rotation interpolation factor

// Food settings
export const FOOD_COUNT = 500; // Number of food items on the map

// Food types
export enum FoodType {
  SMALL = 'small',
  LARGE = 'large'
}

export const FOOD_TYPES = {
  [FoodType.SMALL]: {
    color: 0xFF5722, // Orange-red
    size: 20, // 1x1 grid block
    gridSize: 1,
    score: 10,
    growthAmount: 1,
    spawnChance: 0.9 // 90% chance
  },
  [FoodType.LARGE]: {
    color: 0x9C27B0, // Purple
    size: 40, // 2x2 grid blocks
    gridSize: 2,
    score: 25,
    growthAmount: 2,
    spawnChance: 0.1 // 10% chance (rare)
  }
};

// Additional colorful food variants
export const FOOD_COLORS = [
  0xFF5722, // Orange-red
  0x4CAF50, // Green
  0x2196F3, // Blue
  0xFFEB3B, // Yellow
  0xE91E63, // Pink
  0x00BCD4, // Cyan
  0xFF9800, // Orange
  0x795548  // Brown
];

// Legacy constants for backward compatibility
export const FOOD_COLOR = FOOD_TYPES[FoodType.SMALL].color;
export const FOOD_SIZE = FOOD_TYPES[FoodType.SMALL].size;
export const FOOD_SCORE = FOOD_TYPES[FoodType.SMALL].score;

// Camera settings
export const CAMERA_FOLLOW_SPEED = 0.05; // Lag factor for smooth following
export const CAMERA_ZOOM = 1;

// Game settings
export const GAME_DURATION = 60; // seconds
export const INITIAL_SCORE = 0;

// UI settings
export const UI_FONT_SIZE = '24px';
export const UI_FONT_FAMILY = 'Arial, sans-serif';
export const UI_COLOR = '#ffffff';
export const UI_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.7)';

// Colors
export const BACKGROUND_COLOR = 0x1a1a1a; // Dark background
export const GRID_LINE_COLOR = 0x333333; // Subtle grid lines

// Input settings
export const KEYS = {
  UP: ['ArrowUp', 'KeyW'],
  DOWN: ['ArrowDown', 'KeyS'],
  LEFT: ['ArrowLeft', 'KeyA'],
  RIGHT: ['ArrowRight', 'KeyD'],
  RESTART: ['Space', 'Enter']
} as const;

// Directions
export enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3
}

export const DIRECTION_VECTORS = {
  [Direction.UP]: { x: 0, y: -1 },
  [Direction.RIGHT]: { x: 1, y: 0 },
  [Direction.DOWN]: { x: 0, y: 1 },
  [Direction.LEFT]: { x: -1, y: 0 }
};