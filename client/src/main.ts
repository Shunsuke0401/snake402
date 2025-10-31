import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { UIScene } from './UIScene';

// Health check function to verify server connectivity
async function healthCheck(): Promise<void> {
  try {
    const response = await fetch('http://localhost:8081/health');
    const data = await response.json();
    console.log('Server health check:', data);
  } catch (error) {
    console.error('Server health check failed:', error);
  }
}

// Phaser game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  parent: 'game-container',
  backgroundColor: '#1a1a1a',
  scene: [GameScene, UIScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0, x: 0 },
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

// Initialize the game
const game = new Phaser.Game(config);

// Perform health check on startup
healthCheck();