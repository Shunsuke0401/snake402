// Game Configuration Constants

// World dimensions
export const WORLD_WIDTH = 18000;
export const WORLD_HEIGHT = 18000;

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

// Boost cost settings
export const BOOST_COST_RATE = 1000; // milliseconds of boosting to lose 1 segment
export const MIN_SNAKE_LENGTH = 2; // minimum length before boost is disabled

// Arena boundary settings
export const ARENA_CENTER_X = WORLD_WIDTH / 2;
export const ARENA_CENTER_Y = WORLD_HEIGHT / 2;
export const ARENA_RADIUS = Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2 - 500; // Much larger arena
export const ARENA_WARNING_DISTANCE = 300; // Distance from boundary to show warning
export const ARENA_BOUNDARY_COLOR = 0xFF0000; // Red
export const ARENA_WARNING_COLOR = 0xFF4444; // Lighter red for warning

// Food settings
// Food pooling system for performance optimization
export const MAX_FOOD = 2500; // Fixed maximum number of active food items
export const FOOD_RESPAWN_INTERVAL = 1000; // Check for food replenishment every 1 second (milliseconds)

// Legacy dynamic food count calculation (kept for reference)
const FOOD_DENSITY_BLOCK_SIZE = 10; // 10x10 grid blocks per food
const ARENA_AREA_IN_PIXELS = Math.PI * ARENA_RADIUS * ARENA_RADIUS;
const BLOCK_SIZE_IN_PIXELS = FOOD_DENSITY_BLOCK_SIZE * GRID_SIZE; // 200x200 pixels per block
const BLOCK_AREA = BLOCK_SIZE_IN_PIXELS * BLOCK_SIZE_IN_PIXELS;
export const FOOD_COUNT = Math.floor(ARENA_AREA_IN_PIXELS / BLOCK_AREA); // Dynamic food count based on arena area

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

// Networking settings for client-side prediction
export const CLIENT_INPUT_RATE = 20; // Hz - send input to server at 20Hz
export const SERVER_TICK_RATE = 30; // Hz - server broadcasts state at 30Hz
export const POSITION_CORRECTION_THRESHOLD = 30; // pixels - threshold for server position corrections

// Game settings
// export const GAME_DURATION = 60; // seconds - REMOVED: Game now runs continuously
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