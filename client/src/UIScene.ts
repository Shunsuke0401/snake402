import Phaser from 'phaser';
import {
  UI_FONT_SIZE,
  UI_FONT_FAMILY,
  UI_COLOR,
  UI_BACKGROUND_COLOR,
  INITIAL_SCORE,
  KEYS
} from './config';

export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private lengthText!: Phaser.GameObjects.Text;
  private gameOverOverlay!: Phaser.GameObjects.Container;
  private gameOverBackground!: Phaser.GameObjects.Graphics;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private finalScoreText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  
  private score: number = INITIAL_SCORE;
  private length: number = 3;
  private isGameOver: boolean = false;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    this.createUI();
    this.createGameOverOverlay();
    this.setupInputHandlers();
  }

  private createUI(): void {
    // Timer removed - only score and length displays remain
    
    // Score display (top-left)
    this.scoreText = this.add.text(20, 20, `Score: ${this.score}`, {
      fontSize: UI_FONT_SIZE,
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR,
      backgroundColor: UI_BACKGROUND_COLOR,
      padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(100);

    // Length display (below score)
    this.lengthText = this.add.text(20, 60, `Length: ${this.length}`, {
      fontSize: UI_FONT_SIZE,
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR,
      backgroundColor: UI_BACKGROUND_COLOR,
      padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(100);

    // Timer removed - game now runs continuously
  }

  private createGameOverOverlay(): void {
    const { width, height } = this.cameras.main;
    
    // Create container for game over elements
    this.gameOverOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(200);
    
    // Semi-transparent background
    this.gameOverBackground = this.add.graphics();
    this.gameOverBackground.fillStyle(0x000000, 0.8);
    this.gameOverBackground.fillRect(0, 0, width, height);
    this.gameOverOverlay.add(this.gameOverBackground);
    
    // Game Over title
    this.gameOverTitle = this.add.text(width / 2, height / 2 - 100, 'GAME OVER', {
      fontSize: '48px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ff4444',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverOverlay.add(this.gameOverTitle);
    
    // Final score display
    this.finalScoreText = this.add.text(width / 2, height / 2 - 20, '', {
      fontSize: '32px',
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR,
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverOverlay.add(this.finalScoreText);
    
    // Restart instruction
    this.restartText = this.add.text(width / 2, height / 2 + 60, 'Press SPACE or ENTER to restart', {
      fontSize: '24px',
      fontFamily: UI_FONT_FAMILY,
      color: '#cccccc',
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverOverlay.add(this.restartText);
    
    // Add pulsing animation to restart text
    this.tweens.add({
      targets: this.restartText,
      alpha: 0.5,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    
    // Hide overlay initially
    this.gameOverOverlay.setVisible(false);
  }

  private setupInputHandlers(): void {
    // Handle restart input
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (this.isGameOver && (KEYS.RESTART as readonly string[]).includes(event.code)) {
        this.restartGame();
      }
    });
  }

  public updateScore(newScore: number): void {
    this.score = newScore;
    this.scoreText.setText(`Score: ${this.score}`);
  }

  public updateLength(newLength: number): void {
    this.length = newLength;
    this.lengthText.setText(`Length: ${this.length}`);
  }

  // Timer functionality removed - game now runs continuously

  public showGameOver(reason: string = 'Game Over'): void {
    this.isGameOver = true;
    
    // Update final score text
    this.finalScoreText.setText(
      `${reason}\n\nFinal Score: ${this.score}\nFinal Length: ${this.length}`
    );
    
    // Show overlay with animation
    this.gameOverOverlay.setVisible(true);
    this.gameOverOverlay.setAlpha(0);
    
    this.tweens.add({
      targets: this.gameOverOverlay,
      alpha: 1,
      duration: 500,
      ease: 'Power2'
    });
    
    // Emit game over event to GameScene
    this.events.emit('gameOver');
  }

  private restartGame(): void {
    this.isGameOver = false;
    
    // Reset UI values
    this.score = INITIAL_SCORE;
    this.length = 3;
    
    // Update displays
    this.updateScore(this.score);
    this.updateLength(this.length);
    
    // Hide overlay with animation
    this.tweens.add({
      targets: this.gameOverOverlay,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        this.gameOverOverlay.setVisible(false);
      }
    });
    
    // Emit restart event to GameScene
    this.events.emit('restartGame');
  }

  public getScore(): number {
    return this.score;
  }

  public getLength(): number {
    return this.length;
  }

  // Timer functionality removed

  public isGameOverState(): boolean {
    return this.isGameOver;
  }

  // Handle window resize
  public resize(width: number, height: number): void {
    // Update background size
    if (this.gameOverBackground) {
      this.gameOverBackground.clear();
      this.gameOverBackground.fillStyle(0x000000, 0.8);
      this.gameOverBackground.fillRect(0, 0, width, height);
    }
    
    // Timer text removed
    
    // Reposition game over elements
    if (this.gameOverTitle) {
      this.gameOverTitle.setPosition(width / 2, height / 2 - 100);
    }
    if (this.finalScoreText) {
      this.finalScoreText.setPosition(width / 2, height / 2 - 20);
    }
    if (this.restartText) {
      this.restartText.setPosition(width / 2, height / 2 + 60);
    }
  }
}