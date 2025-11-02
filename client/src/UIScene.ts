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
  private coordinatesText!: Phaser.GameObjects.Text;
  private gameOverOverlay!: Phaser.GameObjects.Container;
  private gameOverBackground!: Phaser.GameObjects.Graphics;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private finalScoreText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private restartButton!: Phaser.GameObjects.Container;
  private restartButtonBg!: Phaser.GameObjects.Graphics;
  private restartButtonText!: Phaser.GameObjects.Text;
  private gameOverRestartButton!: Phaser.GameObjects.Container;
  
  private score: number = INITIAL_SCORE;
  private length: number = 3;
  private isGameOver: boolean = false;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    this.createUI();
    this.createRestartButton();
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

    // Coordinates display (bottom-right)
    const { width, height } = this.cameras.main;
    this.coordinatesText = this.add.text(width - 20, height - 20, 'X: 0, Y: 0', {
      fontSize: UI_FONT_SIZE,
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR,
      backgroundColor: UI_BACKGROUND_COLOR,
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(100);

    // Timer removed - game now runs continuously
  }

  private createRestartButton(): void {
    const { width } = this.cameras.main;
    const buttonWidth = 200;
    const buttonHeight = 50;
    const buttonX = width - buttonWidth - 20;
    const buttonY = 20;

    // Create container for button
    this.restartButton = this.add.container(buttonX, buttonY).setScrollFactor(0).setDepth(100);

    // Button background
    this.restartButtonBg = this.add.graphics();
    this.restartButtonBg.fillStyle(0x4CAF50, 1); // Green background
    this.restartButtonBg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
    this.restartButtonBg.lineStyle(2, 0x2E7D32, 1); // Darker green border
    this.restartButtonBg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
    this.restartButton.add(this.restartButtonBg);

    // Button text
    this.restartButtonText = this.add.text(buttonWidth / 2, buttonHeight / 2, 'Restart', {
      fontSize: '20px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.restartButton.add(this.restartButtonText);

    // Make button interactive
    this.restartButton.setSize(buttonWidth, buttonHeight);
    this.restartButton.setInteractive({ useHandCursor: true });

    // Button hover effect
    this.restartButton.on('pointerover', () => {
      this.restartButtonBg.clear();
      this.restartButtonBg.fillStyle(0x66BB6A, 1); // Lighter green
      this.restartButtonBg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      this.restartButtonBg.lineStyle(2, 0x2E7D32, 1);
      this.restartButtonBg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
    });

    this.restartButton.on('pointerout', () => {
      this.restartButtonBg.clear();
      this.restartButtonBg.fillStyle(0x4CAF50, 1); // Normal green
      this.restartButtonBg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      this.restartButtonBg.lineStyle(2, 0x2E7D32, 1);
      this.restartButtonBg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
    });

    // Button click
    this.restartButton.on('pointerdown', () => {
      this.restartButtonBg.clear();
      this.restartButtonBg.fillStyle(0x388E3C, 1); // Darker green when pressed
      this.restartButtonBg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      this.restartButtonBg.lineStyle(2, 0x2E7D32, 1);
      this.restartButtonBg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
    });

    this.restartButton.on('pointerup', () => {
      // Restore hover state if still hovering, otherwise normal
      this.restartButtonBg.clear();
      this.restartButtonBg.fillStyle(0x4CAF50, 1);
      this.restartButtonBg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      this.restartButtonBg.lineStyle(2, 0x2E7D32, 1);
      this.restartButtonBg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      
      // Trigger restart
      console.log('🔄 Restart requested (button clicked)');
      this.restartGame();
    });
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
    this.gameOverTitle = this.add.text(width / 2, height / 2 - 120, 'GAME OVER', {
      fontSize: '48px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ff4444',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverOverlay.add(this.gameOverTitle);
    
    // Final score display
    this.finalScoreText = this.add.text(width / 2, height / 2 - 40, '', {
      fontSize: '32px',
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR,
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverOverlay.add(this.finalScoreText);
    
    // Restart instruction text
    this.restartText = this.add.text(width / 2, height / 2 + 40, 'Press SPACE or ENTER to restart', {
      fontSize: '20px',
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
    
    // Create restart button on game over screen
    this.createGameOverRestartButton(width, height);
    
    // Hide overlay initially
    this.gameOverOverlay.setVisible(false);
  }

  private createGameOverRestartButton(screenWidth: number, screenHeight: number): void {
    const buttonWidth = 250;
    const buttonHeight = 60;
    const buttonX = screenWidth / 2;
    const buttonY = screenHeight / 2 + 120;

    // Button container
    this.gameOverRestartButton = this.add.container(buttonX, buttonY).setScrollFactor(0);

    // Button background
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x4CAF50, 1); // Green
    buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    buttonBg.lineStyle(3, 0x2E7D32, 1);
    buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    this.gameOverRestartButton.add(buttonBg);

    // Button text
    const buttonText = this.add.text(0, 0, 'RESTART', {
      fontSize: '28px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.gameOverRestartButton.add(buttonText);

    // Make interactive
    this.gameOverRestartButton.setSize(buttonWidth, buttonHeight);
    this.gameOverRestartButton.setInteractive({ useHandCursor: true });

    // Hover effects
    this.gameOverRestartButton.on('pointerover', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x66BB6A, 1); // Lighter green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.gameOverRestartButton.on('pointerout', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x4CAF50, 1); // Normal green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.gameOverRestartButton.on('pointerdown', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x388E3C, 1); // Darker green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.gameOverRestartButton.on('pointerup', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x4CAF50, 1);
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      
      // Trigger restart
      console.log('🔄 Restart requested (game over button clicked)');
      this.restartGame();
    });

    // Add to overlay
    this.gameOverOverlay.add(this.gameOverRestartButton);
  }

  private setupInputHandlers(): void {
    // Handle restart input (works anytime, but especially for game over)
    if (!this.input.keyboard) {
      console.warn('⚠️ Keyboard input not available in UI scene');
      return;
    }

    this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
      // Check both key and code for compatibility
      const key = event.key.toLowerCase();
      const code = event.code;
      
      if (key === ' ' || key === 'enter' || code === 'Space' || code === 'Enter') {
        event.preventDefault();
        console.log('🔄 Restart requested from UI (Enter/Space)', { key, code, isGameOver: this.isGameOver });
        
        // If game over, restart via UI
        if (this.isGameOver) {
          this.restartGame();
        }
        // Otherwise, emit event for GameScene to handle
        else {
          this.events.emit('restartGame');
        }
      }
    });
  }

  public updateScore(newScore: number): void {
    this.score = newScore;
    if (this.scoreText && this.scoreText.setText) {
      this.scoreText.setText(`Score: ${this.score}`);
    }
  }

  public updateLength(newLength: number | string): void {
    if (typeof newLength === 'number') {
      this.length = newLength;
      if (this.lengthText && this.lengthText.setText) {
        this.lengthText.setText(`Length: ${this.length}`);
      }
    } else {
      // For debugging - show custom string
      if (this.lengthText && this.lengthText.setText) {
        this.lengthText.setText(`Length: ${newLength}`);
      }
    }
  }

  public updateCoordinates(x: number, y: number): void {
    if (this.coordinatesText && this.coordinatesText.setText) {
      this.coordinatesText.setText(`X: ${Math.round(x)}, Y: ${Math.round(y)}`);
    }
  }

  // Timer functionality removed - game now runs continuously

  public showGameOver(reason: string = 'Game Over'): void {
    this.isGameOver = true;
    
    // Update final score text
    if (this.finalScoreText && this.finalScoreText.setText) {
      this.finalScoreText.setText(
        `${reason}\n\nFinal Score: ${this.score}\nFinal Length: ${this.length}`
      );
    }
    
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
    
    // Reposition restart button (top-right)
    if (this.restartButton) {
      const buttonWidth = 200;
      this.restartButton.setPosition(width - buttonWidth - 20, 20);
    }
    
    // Reposition coordinates display (bottom-right)
    if (this.coordinatesText) {
      this.coordinatesText.setPosition(width - 20, height - 20);
    }
    
    // Reposition game over elements
    if (this.gameOverTitle) {
      this.gameOverTitle.setPosition(width / 2, height / 2 - 120);
    }
    if (this.finalScoreText) {
      this.finalScoreText.setPosition(width / 2, height / 2 - 40);
    }
    if (this.restartText) {
      this.restartText.setPosition(width / 2, height / 2 + 40);
    }
    if (this.gameOverRestartButton) {
      this.gameOverRestartButton.setPosition(width / 2, height / 2 + 120);
    }
  }
}