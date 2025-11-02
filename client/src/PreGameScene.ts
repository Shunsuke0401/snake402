import Phaser from 'phaser';
import { UI_FONT_FAMILY, UI_COLOR } from './config';

export class PreGameScene extends Phaser.Scene {
  private nicknameInputElement!: HTMLInputElement;
  private startButton!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private background!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'PreGameScene' });
  }

  create(): void {
    const { width, height } = this.cameras.main;
    
    console.log('🎮 PreGameScene create() called', { width, height });

    // Set camera background color
    this.cameras.main.setBackgroundColor('#1a1a1a');

    // Background overlay
    this.background = this.add.graphics();
    this.background.fillStyle(0x000000, 1);
    this.background.fillRect(0, 0, width, height);
    this.background.setScrollFactor(0);

    // Title
    this.titleText = this.add.text(width / 2, height / 2 - 200, 'SNAKE GAME', {
      fontSize: '64px',
      fontFamily: UI_FONT_FAMILY,
      color: '#00ff00',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);

    // Add pulsing animation to title
    this.tweens.add({
      targets: this.titleText,
      scale: 1.1,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Label
    const label = this.add.text(width / 2, height / 2 - 80, 'Enter Your Nickname:', {
      fontSize: '24px',
      fontFamily: UI_FONT_FAMILY,
      color: UI_COLOR
    }).setOrigin(0.5).setScrollFactor(0);

    // Create native HTML input element and position it over the canvas
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      const inputElement = document.createElement('input');
      inputElement.type = 'text';
      inputElement.placeholder = 'Player';
      inputElement.maxLength = 20;
      inputElement.value = '';
      inputElement.id = 'nickname-input';
      
      // Get canvas position to center input
      const canvas = this.game.canvas;
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = gameContainer.getBoundingClientRect();
      
      inputElement.style.cssText = `
        position: absolute;
        left: ${(canvasRect.left - containerRect.left + width / 2 - 200)}px;
        top: ${(canvasRect.top - containerRect.top + height / 2 - 25)}px;
        width: 400px;
        height: 50px;
        font-size: 24px;
        text-align: center;
        border: 3px solid #4CAF50;
        border-radius: 8px;
        background-color: rgba(0, 0, 0, 0.9);
        color: #ffffff;
        font-family: ${UI_FONT_FAMILY};
        outline: none;
        padding: 10px;
        box-sizing: border-box;
        z-index: 100;
      `;
      
      gameContainer.appendChild(inputElement);
      this.nicknameInputElement = inputElement;
      
      // Focus input
      this.time.delayedCall(200, () => {
        inputElement.focus();
      });
      
      // Handle Enter key in input field
      inputElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          console.log('⌨️ Enter pressed in input field');
          this.startGame();
        }
      });
      
      // Add click handler directly to input as test
      inputElement.addEventListener('click', () => {
        console.log('🖱️ Input field clicked');
      });
    }

    // Error text (hidden initially)
    this.errorText = this.add.text(width / 2, height / 2 + 50, '', {
      fontSize: '18px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ff4444',
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    // Start button
    this.createStartButton(width, height);

    // Also handle Enter key globally as backup - use 'on' instead of 'once' for better reliability
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.code === 'Enter') {
          event.preventDefault();
          console.log('⌨️ Enter key pressed (global handler)');
          this.startGame();
        }
      });
    }
    
    console.log('✅ PreGameScene elements created');
    console.log('💡 Press Enter or click START GAME to begin');
  }

  private handleStartButtonClick(buttonBg: Phaser.GameObjects.Graphics, buttonWidth: number, buttonHeight: number): void {
    console.log('🎮 handleStartButtonClick() called');
    buttonBg.clear();
    buttonBg.fillStyle(0x4CAF50, 1);
    buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    buttonBg.lineStyle(3, 0x2E7D32, 1);
    buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    
    // Start game
    try {
      this.startGame();
    } catch (error) {
      console.error('❌ Error starting game:', error);
    }
  }

  private createStartButton(screenWidth: number, screenHeight: number): void {
    const buttonWidth = 250;
    const buttonHeight = 60;
    const buttonX = screenWidth / 2;
    const buttonY = screenHeight / 2 + 120;

    // Button container
    this.startButton = this.add.container(buttonX, buttonY).setScrollFactor(0);

    // Button background
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x4CAF50, 1); // Green
    buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    buttonBg.lineStyle(3, 0x2E7D32, 1);
    buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    buttonBg.setScrollFactor(0);
    this.startButton.add(buttonBg);

    // Button text
    const buttonText = this.add.text(0, 0, 'START GAME', {
      fontSize: '28px',
      fontFamily: UI_FONT_FAMILY,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.startButton.add(buttonText);

    // Make interactive - set depth high and ensure it's on top
    this.startButton.setSize(buttonWidth, buttonHeight);
    this.startButton.setDepth(2000); // Very high depth to ensure it's above input field
    
    // Enable input on button
    this.startButton.setInteractive(new Phaser.Geom.Rectangle(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight), Phaser.Geom.Rectangle.Contains);
    this.input.setDraggable(this.startButton, false);
    this.input.setDefaultCursor('pointer');
    
    // Debug: Log button creation
    console.log('🔘 Start button created at:', buttonX, buttonY, 'size:', buttonWidth, buttonHeight);
    console.log('🔘 Button interactive:', !!this.startButton.input);
    console.log('🔘 Button hitArea:', this.startButton.input?.hitArea);

    // Hover effects
    this.startButton.on('pointerover', () => {
      console.log('🖱️ Button hover');
      buttonBg.clear();
      buttonBg.fillStyle(0x66BB6A, 1); // Lighter green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.startButton.on('pointerout', () => {
      console.log('🖱️ Button hover out');
      buttonBg.clear();
      buttonBg.fillStyle(0x4CAF50, 1); // Normal green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    // Multiple click handlers to ensure it works
    this.startButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      console.log('🔘 Button pointerdown event');
      buttonBg.clear();
      buttonBg.fillStyle(0x388E3C, 1); // Darker green
      buttonBg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      buttonBg.lineStyle(3, 0x2E7D32, 1);
      buttonBg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.startButton.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      console.log('🔘 START GAME button clicked (pointerup)!', pointer.x, pointer.y);
      this.handleStartButtonClick(buttonBg, buttonWidth, buttonHeight);
    });
    
    // Global click listener as last resort - check world coordinates
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // Check if click was on button area using world coordinates
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const buttonRect = new Phaser.Geom.Rectangle(
        buttonX - buttonWidth / 2,
        buttonY - buttonHeight / 2,
        buttonWidth,
        buttonHeight
      );
      
      console.log('🖱️ Global click at:', worldX, worldY, 'button area:', buttonRect);
      
      if (buttonRect.contains(worldX, worldY)) {
        console.log('🔘 Click detected in button area (global listener)');
        this.handleStartButtonClick(buttonBg, buttonWidth, buttonHeight);
      }
    });
  }

  private startGame(): void {
    console.log('🎮 startGame() called');
    
    // Get nickname from input
    let nickname = '';
    if (this.nicknameInputElement) {
      nickname = this.nicknameInputElement.value.trim();
      console.log('📝 Nickname from input:', nickname);
    } else {
      console.warn('⚠️ Input element not found, using default');
    }

    // Validate nickname
    if (!nickname || nickname.length === 0) {
      nickname = 'Player'; // Default nickname
      console.log('📝 Using default nickname:', nickname);
    }

    if (nickname.length > 20) {
      console.warn('⚠️ Nickname too long:', nickname.length);
      this.showError('Nickname must be 20 characters or less');
      return;
    }

    // Hide error if valid
    this.errorText.setVisible(false);

    // Store nickname in game registry to pass to GameScene
    this.registry.set('playerNickname', nickname);
    console.log('💾 Stored nickname in registry:', nickname);

    // Remove input element
    if (this.nicknameInputElement && this.nicknameInputElement.parentNode) {
      this.nicknameInputElement.parentNode.removeChild(this.nicknameInputElement);
      console.log('🗑️ Removed input element');
    }

    console.log(`🎮 Starting GameScene with nickname: ${nickname}`);
    
    // Check if GameScene exists - try multiple ways
    const gameScene = this.scene.get('GameScene');
    console.log('🔍 Checking for GameScene:', gameScene ? 'found' : 'not found');
    console.log('🔍 All scenes:', this.scene.manager.scenes.map((s: any) => s.scene?.key || 'unknown'));
    
    // Force start GameScene - don't check if it exists first
    console.log('🎮 Attempting to start GameScene...');
    
    try {
      // Method 1: Stop current scene and start new one
      console.log('📝 Method 1: stop() then start()');
      this.scene.stop();
      this.scene.start('GameScene');
      console.log('✅ Method 1 completed');
    } catch (error1) {
      console.error('❌ Method 1 failed:', error1);
      
      try {
        // Method 2: Just start without stopping
        console.log('📝 Method 2: start() without stop()');
        this.scene.start('GameScene');
        console.log('✅ Method 2 completed');
      } catch (error2) {
        console.error('❌ Method 2 failed:', error2);
        
        try {
          // Method 3: Launch instead of start
          console.log('📝 Method 3: launch() instead');
          this.scene.launch('GameScene');
          this.scene.stop();
          console.log('✅ Method 3 completed');
        } catch (error3) {
          console.error('❌ Method 3 failed:', error3);
          console.error('❌ All methods failed - cannot start GameScene');
        }
      }
    }
  }
  
  destroy(): void {
    // Clean up input element when scene is destroyed
    if (this.nicknameInputElement && this.nicknameInputElement.parentNode) {
      this.nicknameInputElement.parentNode.removeChild(this.nicknameInputElement);
    }
    super.destroy();
  }

  private showError(message: string): void {
    this.errorText.setText(message);
    this.errorText.setVisible(true);
    
    // Hide error after 3 seconds
    this.time.delayedCall(3000, () => {
      this.errorText.setVisible(false);
    });
  }
}

