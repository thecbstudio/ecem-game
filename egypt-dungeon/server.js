const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { networkInterfaces } = require('os');
const GameRoom = require('./server/GameRoom');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Serve client files
app.use(express.static(path.join(__dirname, 'client')));
// Serve shared constants to client
app.get('/shared/constants.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'shared', 'constants.js'));
});
app.get('/shared/utils.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'shared', 'utils.js'));
});

// Game state
const waitingPlayers = [];
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  if (waitingPlayers.length >= 1) {
    const p1 = waitingPlayers.shift();
    clearTimeout(p1._soloTimer);
    console.log(`Starting game: ${p1.id} (Cinar/Warrior) + ${socket.id} (Ecem/Archer)`);
    const room = new GameRoom(p1, socket, io);
    activeRooms.set(room.id, room);

    p1.emit('room:joined', { playerId: p1.id, playerIndex: 0, className: 'warrior', playerName: 'Cinar', roomId: room.id });
    socket.emit('room:joined', { playerId: socket.id, playerIndex: 1, className: 'archer', playerName: 'Ecem', roomId: room.id });

    setTimeout(() => room.start(), 1000);
  } else {
    waitingPlayers.push(socket);
    socket.emit('lobby:waiting', { message: 'Waiting for your partner to connect...', playerName: 'Cinar', className: 'warrior' });
    console.log(`Player ${socket.id} waiting in lobby (will be Cinar/Warrior)`);

    // Start solo after 10 seconds if partner doesn't join
    socket._soloTimer = setTimeout(() => {
      const idx = waitingPlayers.indexOf(socket);
      if (idx > -1) {
        waitingPlayers.splice(idx, 1);
        console.log(`Starting solo game for ${socket.id}`);
        const room = new GameRoom(socket, null, io);
        activeRooms.set(room.id, room);
        socket.emit('room:joined', { playerId: socket.id, playerIndex: 0, className: 'warrior', playerName: 'Cinar', roomId: room.id });
        setTimeout(() => room.start(), 1000);
      }
    }, 10000);
  }

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const idx = waitingPlayers.indexOf(socket);
    if (idx > -1) {
      clearTimeout(socket._soloTimer);
      waitingPlayers.splice(idx, 1);
    }
    for (const [id, room] of activeRooms) {
      if (room.hasPlayer(socket.id)) {
        // GameRoom internally handles its own teardown via the
        // 'disconnect' listener it registered on the socket.
        activeRooms.delete(id);
        break;
      }
    }
  });
});

// Detect local IP
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║       TOMB OF KHAMUN — CO-OP GAME          ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Cinar (Player 1): http://localhost:${PORT}    ║`);
  console.log(`║  Ecem  (Player 2): http://${localIP}:${PORT}  ║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log('║  Both on same WiFi? Player 2 uses the IP!  ║');
  console.log('╚════════════════════════════════════════════╝\n');
});
