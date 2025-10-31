import Phaser from 'phaser';
import {
  GRID_SIZE,
  SNAKE_INITIAL_LENGTH,
  SNAKE_SPEED,
  SNAKE_TURN_SPEED,
  SNAKE_COLOR,
  SNAKE_HEAD_COLOR,
  Direction,
  DIRECTION_VECTORS,
  WORLD_WIDTH,
  WORLD_HEIGHT
} from './config';

interface SnakeSegment {
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
}

export class Snake {
  private scene: Phaser.Scene;
  private segments: SnakeSegment[] = [];
  private direction: Direction = Direction.RIGHT;
  private nextDirection: Direction = Direction.RIGHT;
  private lastMoveTime: number = 0;
  private targetDirection: number = 0; // For smooth turning
  private currentDirection: number = 0; // Current visual direction

  constructor(scene: Phaser.Scene, startX: number, startY: number) {
    this.scene = scene;
    this.initializeSnake(startX, startY);
  }

  private initializeSnake(startX: number, startY: number): void {
    // Create initial snake segments
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      const gridX = startX - i;
      const gridY = startY;
      const x = gridX * GRID_SIZE + GRID_SIZE / 2;
      const y = gridY * GRID_SIZE + GRID_SIZE / 2;

      const graphics = this.scene.add.graphics();
      const segment: SnakeSegment = {
        gridX,
        gridY,
        x,
        y,
        graphics
      };

      this.segments.push(segment);
      this.drawSegment(segment, i === 0);
    }

    this.targetDirection = this.currentDirection = this.directionToAngle(this.direction);
  }

  private drawSegment(segment: SnakeSegment, isHead: boolean = false): void {
    const graphics = segment.graphics;
    graphics.clear();
    
    const color = isHead ? SNAKE_HEAD_COLOR : SNAKE_COLOR;
    const size = GRID_SIZE - 2; // Small gap between segments
    
    graphics.fillStyle(color);
    graphics.fillRoundedRect(
      segment.x - size / 2,
      segment.y - size / 2,
      size,
      size,
      4 // Rounded corners for Chrome-Snake feel
    );

    // Add a subtle border for better visibility
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeRoundedRect(
      segment.x - size / 2,
      segment.y - size / 2,
      size,
      size,
      4
    );
  }

  private directionToAngle(direction: Direction): number {
    switch (direction) {
      case Direction.UP: return -Math.PI / 2;
      case Direction.RIGHT: return 0;
      case Direction.DOWN: return Math.PI / 2;
      case Direction.LEFT: return Math.PI;
      default: return 0;
    }
  }

  public setDirection(newDirection: Direction): void {
    // Prevent immediate reverse direction
    const oppositeDirection = (this.direction + 2) % 4;
    if (newDirection !== oppositeDirection) {
      this.nextDirection = newDirection;
      this.targetDirection = this.directionToAngle(newDirection);
    }
  }

  public update(time: number): void {
    // Smooth turning animation
    this.updateSmoothTurning();

    // Grid-based movement
    if (time - this.lastMoveTime >= SNAKE_SPEED) {
      this.move();
      this.lastMoveTime = time;
    }

    // Update visual positions for smooth movement
    this.updateVisualPositions();
  }

  private updateSmoothTurning(): void {
    // Smoothly interpolate between current and target direction
    let angleDiff = this.targetDirection - this.currentDirection;
    
    // Handle angle wrapping
    if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    this.currentDirection += angleDiff * SNAKE_TURN_SPEED;
    
    // Normalize angle
    if (this.currentDirection > Math.PI) this.currentDirection -= 2 * Math.PI;
    if (this.currentDirection < -Math.PI) this.currentDirection += 2 * Math.PI;
  }

  private move(): void {
    this.direction = this.nextDirection;
    const head = this.segments[0];
    const dirVector = DIRECTION_VECTORS[this.direction];
    
    const newGridX = head.gridX + dirVector.x;
    const newGridY = head.gridY + dirVector.y;
    
    // Create new head
    const newHead: SnakeSegment = {
      gridX: newGridX,
      gridY: newGridY,
      x: newGridX * GRID_SIZE + GRID_SIZE / 2,
      y: newGridY * GRID_SIZE + GRID_SIZE / 2,
      graphics: this.scene.add.graphics()
    };
    
    this.segments.unshift(newHead);
    this.drawSegment(newHead, true);
    
    // Remove tail (will be added back if growing)
    const tail = this.segments.pop()!;
    tail.graphics.destroy();
    
    // Redraw old head as body segment
    if (this.segments.length > 1) {
      this.drawSegment(this.segments[1], false);
    }
  }

  private updateVisualPositions(): void {
    // Update segment visual positions for smooth rendering
    this.segments.forEach((segment, index) => {
      this.drawSegment(segment, index === 0);
    });
  }

  public grow(): void {
    // Add a new segment at the tail
    const tail = this.segments[this.segments.length - 1];
    const prevTail = this.segments[this.segments.length - 2] || tail;
    
    const newSegment: SnakeSegment = {
      gridX: tail.gridX,
      gridY: tail.gridY,
      x: tail.x,
      y: tail.y,
      graphics: this.scene.add.graphics()
    };
    
    this.segments.push(newSegment);
    this.drawSegment(newSegment, false);
  }

  public checkSelfCollision(): boolean {
    const head = this.segments[0];
    
    // Check collision with body (skip head)
    for (let i = 1; i < this.segments.length; i++) {
      const segment = this.segments[i];
      if (head.gridX === segment.gridX && head.gridY === segment.gridY) {
        return true;
      }
    }
    
    return false;
  }

  public checkWallCollision(): boolean {
    const head = this.segments[0];
    return (
      head.gridX < 0 ||
      head.gridX >= WORLD_WIDTH / GRID_SIZE ||
      head.gridY < 0 ||
      head.gridY >= WORLD_HEIGHT / GRID_SIZE
    );
  }

  public getHeadPosition(): { x: number; y: number } {
    const head = this.segments[0];
    return { x: head.x, y: head.y };
  }

  public getHeadGridPosition(): { gridX: number; gridY: number } {
    const head = this.segments[0];
    return { gridX: head.gridX, gridY: head.gridY };
  }

  public getLength(): number {
    return this.segments.length;
  }

  public getAllSegments(): Array<{ gridX: number; gridY: number }> {
    return this.segments.map(segment => ({
      gridX: segment.gridX,
      gridY: segment.gridY
    }));
  }

  public destroy(): void {
    this.segments.forEach(segment => {
      segment.graphics.destroy();
    });
    this.segments = [];
  }
}