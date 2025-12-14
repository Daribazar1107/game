const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const path = require('path');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// In-memory rooms storage
const rooms = {};

// Generate random 6-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[code]);
  return code;
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // HOST: Create a new game
  socket.on('createGame', () => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      hostId: socket.id,
      players: [],
      started: false,
      currentQuestion: 0
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;

    socket.emit('gameCreated', { roomCode });
    console.log(`Room ${roomCode} created by ${socket.id}`);
  });

  // PLAYER: Join existing game
  socket.on('joinGame', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('error', { message: 'Өрөө олдсонгүй!' });
      return;
    }

    if (room.started) {
      socket.emit('error', { message: 'Тоглоом аль хэдийн эхэлсэн байна!' });
      return;
    }

    // Check if name already exists
    const nameExists = room.players.some(p => p.name === playerName);
    if (nameExists) {
      socket.emit('error', { message: 'Энэ нэр аль хэдийн ашиглагдаж байна!' });
      return;
    }

    // Add player to room
    const player = {
      id: socket.id,
      name: playerName,
      score: 0
    };

    room.players.push(player);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;
    socket.isHost = false;

    // Notify everyone in room about updated player list
    io.to(roomCode).emit('playerList', { 
      players: room.players,
      count: room.players.length 
    });

    socket.emit('joinedGame', { roomCode, playerName });
    console.log(`${playerName} joined room ${roomCode}`);
  });

  // HOST: Start the game
  socket.on('startGame', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) {
      socket.emit('error', { message: 'Зөвхөн зохион байгуулагч тоглоом эхлүүлэх боломжтой!' });
      return;
    }

    if (room.players.length === 0) {
      socket.emit('error', { message: 'Тоглогч байхгүй байна!' });
      return;
    }

    room.started = true;

    // Notify all players that game is starting
    io.to(roomCode).emit('gameStarted', { 
      message: 'Тоглоом эхэллээ!',
      players: room.players 
    });

    console.log(`Game started in room ${roomCode}`);
  });

  // PLAYER: Submit answer
  socket.on('submitAnswer', ({ questionIndex, points }) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.score += points;

    // Notify room of updated score
    io.to(roomCode).emit('scoreUpdated', {
      playerId: socket.id,
      playerName: player.name,
      score: player.score
    });
  });

  // HOST: End game and show leaderboard
  socket.on('endGame', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) return;

    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);

    io.to(roomCode).emit('gameEnded', {
      leaderboard: sortedPlayers
    });

    console.log(`Game ended in room ${roomCode}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.isHost) {
      // Host disconnected - end game for everyone
      io.to(roomCode).emit('hostDisconnected', { 
        message: 'Зохион байгуулагч салсан тул тоглоом дууслаа!' 
      });
      delete rooms[roomCode];
      console.log(`Room ${roomCode} deleted - host disconnected`);
    } else {
      // Player disconnected - remove from list
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        io.to(roomCode).emit('playerList', { 
          players: room.players,
          count: room.players.length 
        });

        console.log(`${playerName} left room ${roomCode}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📂 Serving files from: ${path.join(__dirname, '../public')}`);
});