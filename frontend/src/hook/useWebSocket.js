import { useEffect, useState } from "react";

export default function useWebSocket(url) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws;

    function connect() {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("✅ Connected");
        setConnected(true);
      };

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        setData(parsed);
      };

      ws.onclose = () => {
        console.log("❌ Disconnected, retrying...");
        setConnected(false);
        setTimeout(connect, 2000); // auto reconnect
      };
    }

    connect();

    return () => ws && ws.close();
  }, [url]);

  return { data, connected };
}