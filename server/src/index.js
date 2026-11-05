import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(cors({ origin: true }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'VOID//SEND' }));
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 2 * 1024 * 1024
});

const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 60 * 60 * 1000;

function getRoom(code) {
  const room = rooms.get(code);
  if (!room || Date.now() - room.createdAt > ROOM_TTL_MS) {
    rooms.delete(code);
    return null;
  }
  return room;
}

function newCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)];
  return code;
}

io.on('connection', socket => {
  socket.on('room:create', ack => {
    let code;
    do code = newCode(); while (rooms.has(code));
    rooms.set(code, { sender: socket.id, receiver: null, createdAt: Date.now() });
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'sender';
    ack?.({ ok: true, code });
  });

  socket.on('room:join', (raw, ack) => {
    const code = String(raw || '').trim().toUpperCase();
    const room = getRoom(code);
    if (!room) return ack?.({ ok: false, error: 'Room not found or expired.' });
    if (room.sender === socket.id) return ack?.({ ok: false, error: 'You cannot join your own room.' });
    if (room.receiver && room.receiver !== socket.id) {
      return ack?.({ ok: false, error: 'Room already has a receiver.' });
    }
    room.receiver = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'receiver';
    io.to(room.sender).emit('peer:joined');
    ack?.({ ok: true });
  });

  socket.on('signal', payload => {
    const code = socket.data.room;
    const room = code && getRoom(code);
    if (!room) return;
    const target = socket.id === room.sender ? room.receiver : room.sender;
    if (target) io.to(target).emit('signal', payload);
  });

  socket.on('relay:start', meta => {
    const code = socket.data.room;
    const room = code && getRoom(code);
    if (room && socket.id === room.sender && room.receiver) {
      io.to(room.receiver).emit('relay:start', meta);
    }
  });

  socket.on('relay:chunk', data => {
    const code = socket.data.room;
    const room = code && getRoom(code);
    if (room && socket.id === room.sender && room.receiver) {
      io.to(room.receiver).emit('relay:chunk', data);
    }
  });

  socket.on('relay:end', () => {
    const code = socket.data.room;
    const room = code && getRoom(code);
    if (room && socket.id === room.sender && room.receiver) {
      io.to(room.receiver).emit('relay:end');
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    const room = code && rooms.get(code);
    if (!room) return;
    io.to(code).emit('peer:disconnected');
    if (room.sender === socket.id) rooms.delete(code);
    else if (room.receiver === socket.id) room.receiver = null;
  });
});

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`VOID//SEND listening on port ${port}`);
});
