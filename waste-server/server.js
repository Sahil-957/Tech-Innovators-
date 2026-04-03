const WebSocket = require("ws");

const wss = new WebSocket.Server({
  port: 8080,
  host: "0.0.0.0",
});

console.log("WebSocket server running on ws://0.0.0.0:8080");

let latestData = {
  bin1: { level: 0, gas: 0 },
  bin2: { level: 0, gas: 0 },
};

function normalizeBinData(data = {}) {
  return {
    bin1: {
      level: Number(data.bin1?.level ?? latestData.bin1.level ?? 0),
      gas: Number(data.bin1?.gas ?? latestData.bin1.gas ?? 0),
    },
    bin2: {
      level: Number(data.bin2?.level ?? latestData.bin2.level ?? 0),
      gas: Number(data.bin2?.gas ?? latestData.bin2.gas ?? 0),
    },
  };
}

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on("connection", (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`Client connected: ${clientIP}`);

  ws.send(JSON.stringify(latestData));

  ws.on("message", (message) => {
    try {
      const parsedData = JSON.parse(message.toString());
      latestData = normalizeBinData(parsedData);

      console.log("Data received from client:", latestData);
      broadcast(latestData);
    } catch (error) {
      console.log("Invalid JSON received:", message.toString());
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${clientIP}`);
  });

  ws.on("error", (error) => {
    console.log("WebSocket error:", error.message);
  });
});
