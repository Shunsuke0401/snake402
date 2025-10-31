import Phaser from 'phaser';
import {
  GRID_SIZE,
  SNAKE_INITIAL_LENGTH,
  SNAKE_COLOR,
  SNAKE_HEAD_COLOR,
  BASE_SPEED,
  BOOST_MULTIPLIER,
  ROTATION_SPEED,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BOOST_COST_RATE,
  MIN_SNAKE_LENGTH
} from './config';

interface SnakeSegment {
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
}

export class Snake {
  private scene: Phaser.Scene;
  private segments: SnakeSegment[] = [];
  private angle: number = 0; // Current movement angle in radians
  private targetAngle: number = 0; // Target angle to rotate towards
  private speed: number = BASE_SPEED;
  private isBoosting: boolean = false;
  private boostTime: number = 0; // Track time spent boosting

  constructor(scene: Phaser.Scene, startX: number, startY: number) {
    this.scene = scene;
    this.initializeSnake(startX, startY);
  }

  private initializeSnake(startX: number, startY: number): void {
    // Create initial snake segments
    const startPixelX = startX * GRID_SIZE + GRID_SIZE / 2;
    const startPixelY = startY * GRID_SIZE + GRID_SIZE / 2;
    
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
      const x = startPixelX - i * GRID_SIZE;
      const y = startPixelY;

      const graphics = this.scene.add.graphics();
      const segment: SnakeSegment = {
        x,
        y,
        graphics
      };

      this.segments.push(segment);
      this.drawSegment(segment, i === 0);
    }
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
      4 // Rounded corners
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

  public setTargetAngle(angle: number): void {
    this.targetAngle = angle;
  }

  public setBoosting(boosting: boolean): void {
    // Only allow boosting if snake is long enough
    if (boosting && this.segments.length <= MIN_SNAKE_LENGTH) {
      this.isBoosting = false;
      return;
    }
    this.isBoosting = boosting;
  }

  public update(delta: number): void {
    // Smooth rotation towards target angle
    this.updateRotation();
    
    // Handle boost cost mechanics
    if (this.isBoosting) {
      this.boostTime += delta;
      
      // Check if we should reduce snake length
      if (this.boostTime >= BOOST_COST_RATE) {
        this.shrink();
        this.boostTime = 0; // Reset boost timer
        
        // Stop boosting if snake becomes too short
        if (this.segments.length <= MIN_SNAKE_LENGTH) {
          this.isBoosting = false;
        }
      }
    } else {
      // Reset boost timer when not boosting
      this.boostTime = 0;
    }
    
    // Calculate current speed
    const currentSpeed = this.isBoosting ? this.speed * BOOST_MULTIPLIER : this.speed;
    
    // Move the head
    const head = this.segments[0];
    const moveDistance = (currentSpeed * delta) / 1000; // Convert to pixels per frame
    
    const newHeadX = head.x + Math.cos(this.angle) * moveDistance;
    const newHeadY = head.y + Math.sin(this.angle) * moveDistance;
    
    // Update segments (follow the leader)
    this.updateSegmentPositions(newHeadX, newHeadY);
    
    // Redraw all segments
    this.segments.forEach((segment, index) => {
      this.drawSegment(segment, index === 0);
    });
  }

  private updateRotation(): void {
    // Calculate the shortest angle difference
    let angleDiff = this.targetAngle - this.angle;
    
    // Normalize angle difference to [-π, π]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Smoothly interpolate towards target angle
    this.angle += angleDiff * ROTATION_SPEED;
    
    // Normalize angle to [-π, π]
    while (this.angle > Math.PI) this.angle -= 2 * Math.PI;
    while (this.angle < -Math.PI) this.angle += 2 * Math.PI;
  }

  private updateSegmentPositions(newHeadX: number, newHeadY: number): void {
    // Store previous positions
    const prevPositions = this.segments.map(segment => ({ x: segment.x, y: segment.y }));
    
    // Update head position
    this.segments[0].x = newHeadX;
    this.segments[0].y = newHeadY;
    
    // Update body segments to follow
    for (let i = 1; i < this.segments.length; i++) {
      const currentSegment = this.segments[i];
      const targetSegment = this.segments[i - 1];
      
      // Calculate distance to the segment in front
      const dx = targetSegment.x - currentSegment.x;
      const dy = targetSegment.y - currentSegment.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // If too far, move closer
      const segmentDistance = GRID_SIZE * 0.8; // Slightly closer than grid size
      if (distance > segmentDistance) {
        const ratio = segmentDistance / distance;
        currentSegment.x = targetSegment.x - dx * ratio;
        currentSegment.y = targetSegment.y - dy * ratio;
      }
    }
  }

  public grow(): void {
    // Add a new segment at the tail
    const tail = this.segments[this.segments.length - 1];
    const prevTail = this.segments[this.segments.length - 2] || tail;
    
    // Calculate position behind the tail
    const dx = tail.x - prevTail.x;
    const dy = tail.y - prevTail.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    let newX = tail.x;
    let newY = tail.y;
    
    if (distance > 0) {
      const ratio = GRID_SIZE / distance;
      newX = tail.x + dx * ratio;
      newY = tail.y + dy * ratio;
    }
    
    const graphics = this.scene.add.graphics();
    const newSegment: SnakeSegment = {
      x: newX,
      y: newY,
      graphics
    };
    
    this.segments.push(newSegment);
    this.drawSegment(newSegment, false);
  }

  public shrink(): void {
    // Don't shrink if already at minimum length
    if (this.segments.length <= MIN_SNAKE_LENGTH) {
      return;
    }
    
    // Remove the tail segment
    const tailSegment = this.segments.pop();
    if (tailSegment) {
      tailSegment.graphics.destroy();
    }
  }

  public checkSelfCollision(): boolean {
    const head = this.segments[0];
    const headRadius = GRID_SIZE / 2;
    
    // Check collision with body segments (skip first few to avoid immediate collision)
    for (let i = 4; i < this.segments.length; i++) {
      const segment = this.segments[i];
      const dx = head.x - segment.x;
      const dy = head.y - segment.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < headRadius) {
        return true;
      }
    }
    
    return false;
  }

  public checkWallCollision(): boolean {
    const head = this.segments[0];
    const margin = GRID_SIZE / 2;
    
    return (
      head.x < margin ||
      head.x >= WORLD_WIDTH - margin ||
      head.y < margin ||
      head.y >= WORLD_HEIGHT - margin
    );
  }

  public getHeadPosition(): { x: number; y: number } {
    const head = this.segments[0];
    return { x: head.x, y: head.y };
  }

  public getHeadGridPosition(): { gridX: number; gridY: number } {
    const head = this.segments[0];
    return { 
      gridX: Math.floor(head.x / GRID_SIZE), 
      gridY: Math.floor(head.y / GRID_SIZE) 
    };
  }

  public getLength(): number {
    return this.segments.length;
  }

  public getAllSegments(): Array<{ gridX: number; gridY: number }> {
    return this.segments.map(segment => ({
      gridX: Math.floor(segment.x / GRID_SIZE),
      gridY: Math.floor(segment.y / GRID_SIZE)
    }));
  }

  public destroy(): void {
    this.segments.forEach(segment => {
      segment.graphics.destroy();
    });
    this.segments = [];
  }
}