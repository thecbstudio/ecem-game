// Main Phaser game configuration
const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 600,
  backgroundColor: '#0A0600',
  parent: 'game-container',
  scene: [
    BootScene,
    MenuScene,
    LobbyScene,
    GameScene,
    GameOverScene
  ],
  scale: {
    // Scale the 960×600 canvas to fill the window while preserving aspect.
    // The HUD/minimap positions stay correct because they live inside the
    // logical 960×600 coordinate space.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    parent: 'game-container',
    width: 960,
    height: 600
  },
  render: {
    pixelArt: true,
    antialias: false,
    roundPixels: true
  },
  autoFocus: true
};

const game = new Phaser.Game(config);
// Expose for debugging (devtools / automated tests). Harmless in prod.
window.game = game;

// Global socket (created in MenuScene)
window.gameSocket = null;
window.myPlayerId = null;
window.myPlayerIndex = 0;
window.myClass = 'warrior';
