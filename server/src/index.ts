import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';

const PORT = 8081;

// Create HTTP server for health endpoint
const server = createServer((req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  
  // Enable CORS for client requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`New WebSocket connection from ${req.socket.remoteAddress}`);
  
  // Send welcome message
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Slither game server' }));
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received message:', message);
      
      // Echo back for now (no gameplay logic yet)
      ws.send(JSON.stringify({ type: 'echo', data: message }));
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 WS server listening on :${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
});