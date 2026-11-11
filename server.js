const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const SIZE = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

function validFleet(board) {
  if (!Array.isArray(board) || board.length !== SIZE) return false;
  if (board.some(row => !Array.isArray(row) || row.length !== SIZE ||
      row.some(v => v !== 0 && v !== 1))) return false;
  const seen = new Set(), ships = [];
  for (let y=0; y<SIZE; y++) for (let x=0; x<SIZE; x++) {
    if (board[y][x] !== 1 || seen.has(`${x},${y}`)) continue;
    const stack=[[x,y]], cells=[]; seen.add(`${x},${y}`);
    while(stack.length) {
      const [cx,cy]=stack.pop(); cells.push([cx,cy]);
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
        if(nx>=0&&ny>=0&&nx<SIZE&&ny<SIZE&&board[ny][nx]===1&&!seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`); stack.push([nx,ny]);
        }
      }
    }
    const xs=cells.map(c=>c[0]), ys=cells.map(c=>c[1]);
    const straight = xs.every(v=>v===xs[0]) || ys.every(v=>v===ys[0]);
    if(!straight) return false;
    ships.push(cells.length);
  }
  ships.sort((a,b)=>b-a);
  return JSON.stringify(ships) === JSON.stringify([...FLEET].sort((a,b)=>b-a));
}
function publicState(room, player) {
  const enemy = room.players.find(p=>p.id!==player.id);
  const shots = room.shots[player.id] || [];
  const ownHits = room.shots[enemy?.id] || [];
  return {
    code: room.code, count: room.players.length,
    ready: room.players.length===2 && room.players.every(p=>p.ready),
    yourTurn: room.turn===player.id && room.started && !room.winner,
    started: room.started, winner: room.winner,
    enemyName: enemy?.name || "Ожидание игрока",
    ownBoard: room.boards[player.id] || null,
    enemyShots: ownHits,
    shots,
    message: room.message || ""
  };
}
function broadcast(room) {
  for(const p of room.players) io.to(p.id).emit("state", publicState(room,p));
}
function makeRoom() {
  let code;
  do { code=crypto.randomBytes(3).toString("hex").toUpperCase(); } while(rooms.has(code));
  const room={code,players:[],boards:{},shots:{},turn:null,started:false,winner:null,message:"Комната создана"};
  rooms.set(code,room); return room;
}
io.on("connection", socket => {
  socket.on("create", ({name}={}) => {
    const room=makeRoom(); room.players.push({id:socket.id,name:String(name||"Игрок 1").slice(0,20),ready:false});
    socket.join(room.code); socket.data.room=room.code; socket.emit("joined",{code:room.code}); broadcast(room);
  });
  socket.on("join", ({code,name}={}) => {
    code=String(code||"").trim().toUpperCase(); const room=rooms.get(code);
    if(!room) return socket.emit("errorMsg","Комната не найдена. Проверь код.");
    if(room.players.length>=2) return socket.emit("errorMsg","В этой комнате уже два игрока.");
    if(room.players.some(p=>p.id===socket.id)) return;
    room.players.push({id:socket.id,name:String(name||"Игрок 2").slice(0,20),ready:false});
    socket.join(code); socket.data.room=code; room.message="Оба игрока подключились. Расставьте корабли.";
    io.to(code).emit("joined",{code}); broadcast(room);
  });
  socket.on("ready", board => {
    const room=rooms.get(socket.data.room); if(!room||room.started) return;
    const p=room.players.find(p=>p.id===socket.id); if(!p) return;
    if(!validFleet(board)) return socket.emit("errorMsg","Неверная расстановка флота. Нужно 10 кораблей: 4, 3, 3, 2, 2, 2, 1, 1, 1, 1.");
    room.boards[socket.id]=board; p.ready=true;
    if(room.players.length===2&&room.players.every(x=>x.ready)) {
      room.started=true; room.turn=room.players[Math.floor(Math.random()*2)].id;
      room.message="Бой начался! Первым ходит случайный игрок.";
    } else room.message="Флот готов. Ждём второго игрока.";
    broadcast(room);
  });
  socket.on("fire", ({x,y}={}) => {
    const room=rooms.get(socket.data.room); if(!room||!room.started||room.winner||room.turn!==socket.id) return;
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=SIZE||y>=SIZE) return;
    const enemy=room.players.find(p=>p.id!==socket.id); if(!enemy) return;
    room.shots[socket.id] ||= [];
    if(room.shots[socket.id].some(s=>s.x===x&&s.y===y)) return;
    const hit=room.boards[enemy.id][y][x]===1;
    room.shots[socket.id].push({x,y,hit});
    const hits=room.shots[socket.id].filter(s=>s.hit).length;
    if(hits===20) { room.winner=socket.id; room.message="Все корабли противника уничтожены!"; }
    else if(!hit) { room.turn=enemy.id; room.message="Мимо! Ход соперника."; }
    else room.message="Попадание! Стреляй ещё.";
    broadcast(room);
  });
  socket.on("disconnect", () => {
    const code=socket.data.room, room=rooms.get(code); if(!room) return;
    room.players=room.players.filter(p=>p.id!==socket.id);
    if(room.players.length===0) rooms.delete(code);
    else { room.winner=room.players[0].id; room.message="Соперник отключился. Вы победили."; broadcast(room); }
  });
});
const port=process.env.PORT||3000;
server.listen(port,()=>console.log(`Морской бой запущен на порту ${port}`));