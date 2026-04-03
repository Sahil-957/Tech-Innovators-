/*
 * Smart Waste Management System - ESP32 Firmware v3.0
 * =====================================================
 * Two-way SMS: Send STATUS / BIN A / BIN B / HELP from your phone
 * US-100 UART ultrasonic sensors (NOT HC-SR04)
 * WebSocket server port 81 — no broker needed
 *
 * PIN MAP:
 *   GPIO4  ← US-100 Bin B TX   (Serial1 RX)
 *   GPIO5  → US-100 Bin B RX   (Serial1 TX)
 *   GPIO16 ← US-100 Bin A TX   (Serial2 RX)
 *   GPIO17 → US-100 Bin A RX   (Serial2 TX)
 *   GPIO26 ← SIM800L TX        (SW Serial RX)
 *   GPIO27 → SIM800L RX        (SW Serial TX)
 *   GPIO34 ← MQ4 Bin A analog
 *   GPIO35 ← MQ4 Bin B analog
 *
 * IMPORTANT: UART0 (GPIO1/3) is NOT touched — it stays as USB/Serial Monitor
 * GSM uses SoftwareSerial so USB debug always works
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <SoftwareSerial.h>

// ─── WiFi ──────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Realme 5G";
const char* WIFI_PASSWORD = "12345678";

// ─── Your phone number ─────────────────────────────────────────────────────
const char* ALERT_PHONE   = "+918010084268";

// ─── US-100 pins ───────────────────────────────────────────────────────────
#define US_A_RX   16
#define US_A_TX   17
#define US_B_RX    4
#define US_B_TX    5

// ─── MQ4 gas sensor ADC pins ───────────────────────────────────────────────
#define BIN_A_GAS  34
#define BIN_B_GAS  35

// ─── GSM SIM800L pins ──────────────────────────────────────────────────────
#define GSM_RX    26
#define GSM_TX    27

// ─── Serial objects ────────────────────────────────────────────────────────
// UART0 = USB/Serial Monitor  → NEVER reassign
// UART1 = Bin B US-100
// UART2 = Bin A US-100
// SoftwareSerial = GSM (9600 baud is fine for SW serial)
HardwareSerial sensorA(2);
HardwareSerial sensorB(1);
SoftwareSerial gsmSerial(GSM_RX, GSM_TX);

WebSocketsClient webSocket;

// ─── Bin config ────────────────────────────────────────────────────────────
#define BIN_HEIGHT_CM_A     36
#define BIN_HEIGHT_CM_B     25
#define FULL_THRESHOLD     85
#define WARNING_THRESHOLD  70
#define GAS_THRESHOLD      2500
#define GAS_WARMUP_MS      60000

// ─── US-100 protocol ───────────────────────────────────────────────────────
#define US100_CMD         0x55
#define US100_TIMEOUT_MS  150
#define US100_MIN_MM      20
#define US100_MAX_MM      4500

// ─── Timing ────────────────────────────────────────────────────────────────
#define SENSOR_INTERVAL_MS    2000
#define BROADCAST_INTERVAL_MS 3000
#define SMS_CHECK_INTERVAL_MS 5000
#define SMS_COOLDOWN_MS       300000

// ─── Bin state ─────────────────────────────────────────────────────────────
struct BinData {
  int           fillPercent;
  float         distanceCm;
  int           gasRaw;
  bool          gasDetected;
  bool          isFull;
  bool          isWarning;
  float         fillRate;
  bool          sensorError;
  unsigned long lastFullSmsMs;
  unsigned long lastGasSmsMs;
};

BinData binA = {0, 0.0f, 0, false, false, false, 0.0f, false, 0, 0};
BinData binB = {0, 0.0f, 0, false, false, false, 0.0f, false, 0, 0};

struct FillHistory { int v[6]; unsigned long t[6]; int head; int count; };
FillHistory histA = {{0},{0},0,0};
FillHistory histB = {{0},{0},0,0};

unsigned long lastSensorRead  = 0;
unsigned long lastBroadcast   = 0;
unsigned long lastSmsCheck    = 0;
bool          gsmReady        = false;
int           wsClients       = 0;

// ═══════════════════════════════════════════════════════════════════════════
//  US-100 SENSOR
// ═══════════════════════════════════════════════════════════════════════════

float readUS100(HardwareSerial &port) {
  while (port.available()) port.read();
  port.write((uint8_t)US100_CMD);
  unsigned long t0 = millis();
  while (port.available() < 2) {
    if (millis() - t0 > US100_TIMEOUT_MS) return -1.0f;
  }
  int hi = port.read();
  int lo = port.read();
  int mm = (hi << 8) | lo;
  if (mm < US100_MIN_MM || mm > US100_MAX_MM) return -1.0f;
  return mm / 10.0f;
}

int distToFillPctA(float distCm) {
  if (distCm < 0) return -1;
  float frac = (BIN_HEIGHT_CM_A - distCm) / BIN_HEIGHT_CM_A;
  return constrain((int)(frac * 100.0f), 0, 100);
}

int distToFillPctB(float distCm) {
  if (distCm < 0) return -1;
  float frac = (BIN_HEIGHT_CM_B - distCm) / BIN_HEIGHT_CM_B;
  return constrain((int)(frac * 100.0f), 0, 100);
}

float estimateFillRate(FillHistory &h, int fill, unsigned long nowMs) {
  h.v[h.head] = fill;
  h.t[h.head] = nowMs;
  h.head = (h.head + 1) % 6;
  if (h.count < 6) h.count++;
  if (h.count < 2) return 0.0f;
  int oldIdx = h.head % 6;
  int newIdx = (h.head + h.count - 1) % 6;
  unsigned long dt = h.t[newIdx] - h.t[oldIdx];
  if (dt < 1000) return 0.0f;
  return (float)(h.v[newIdx] - h.v[oldIdx]) / (dt / 3600000.0f);
}

void readAllSensors() {
  unsigned long nowMs = millis();

  float dA = readUS100(sensorA);
  binA.sensorError = (dA < 0);
  if (!binA.sensorError) {
    binA.distanceCm = dA;
    int pct = distToFillPctA(dA);
    if (pct >= 0) binA.fillPercent = pct;
  } else {
    Serial.println("[Bin A] ERROR: US-100 no response");
  }
  binA.gasRaw      = analogRead(BIN_A_GAS);
  binA.gasDetected = (nowMs > GAS_WARMUP_MS) && (binA.gasRaw > GAS_THRESHOLD);
  binA.isFull      = !binA.sensorError && (binA.fillPercent >= FULL_THRESHOLD);
  binA.isWarning   = !binA.sensorError && (binA.fillPercent >= WARNING_THRESHOLD) && !binA.isFull;
  binA.fillRate    = estimateFillRate(histA, binA.fillPercent, nowMs);

  delay(50);

  float dB = readUS100(sensorB);
  binB.sensorError = (dB < 0);
  if (!binB.sensorError) {
    binB.distanceCm = dB;
    int pct = distToFillPctB(dB);
    if (pct >= 0) binB.fillPercent = pct;
  } else {
    Serial.println("[Bin B] ERROR: US-100 no response");
  }
  binB.gasRaw      = analogRead(BIN_B_GAS);
  binB.gasDetected = (nowMs > GAS_WARMUP_MS) && (binB.gasRaw > GAS_THRESHOLD);
  binB.isFull      = !binB.sensorError && (binB.fillPercent >= FULL_THRESHOLD);
  binB.isWarning   = !binB.sensorError && (binB.fillPercent >= WARNING_THRESHOLD) && !binB.isFull;
  binB.fillRate    = estimateFillRate(histB, binB.fillPercent, nowMs);

  Serial.printf("[Bin A] %s  Fill:%3d%%  Dist:%6.1f cm  Gas:%4d%s\n",
    binA.sensorError ? "ERR" : " OK",
    binA.fillPercent, binA.distanceCm, binA.gasRaw,
    binA.gasDetected ? " !!GAS!!" : "");
  Serial.printf("[Bin B] %s  Fill:%3d%%  Dist:%6.1f cm  Gas:%4d%s\n",
    binB.sensorError ? "ERR" : " OK",
    binB.fillPercent, binB.distanceCm, binB.gasRaw,
    binB.gasDetected ? " !!GAS!!" : "");
}

// ═══════════════════════════════════════════════════════════════════════════
//  GSM — SEND
// ═══════════════════════════════════════════════════════════════════════════

String gsmCmd(const char *cmd, unsigned int waitMs = 1000) {
  while (gsmSerial.available()) gsmSerial.read();
  gsmSerial.println(cmd);
  delay(waitMs);
  String resp = "";
  while (gsmSerial.available()) resp += (char)gsmSerial.read();
  Serial.print("[GSM] << "); Serial.println(resp);
  return resp;
}

bool initGSM() {
  Serial.println("[GSM] Starting SIM800L on GPIO26(RX)/27(TX)...");
  gsmSerial.begin(9600);
  delay(3000);
  gsmCmd("AT");
  gsmCmd("AT+CMGF=1");
  gsmCmd("AT+CSCS=\"GSM\"");
  gsmCmd("AT+CNMI=1,2,0,0,0");  // Push incoming SMS to serial immediately
  gsmCmd("AT+CMGD=1,4");        // Clear inbox on startup
  Serial.println("[GSM] Ready");
  return true;
}

void sendSMS(const char *number, const String &msg) {
  if (!gsmReady) { Serial.println("[GSM] Not ready"); return; }
  Serial.println("[GSM] Sending to " + String(number) + ": " + msg);
  gsmSerial.print("AT+CMGS=\"");
  gsmSerial.print(number);
  gsmSerial.println("\"");
  delay(500);
  gsmSerial.print(msg);
  delay(100);
  gsmSerial.write(26);  // Ctrl+Z
  delay(4000);
  Serial.println("[GSM] SMS sent");
}

// ═══════════════════════════════════════════════════════════════════════════
//  GSM — BUILD REPLY MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

String binStatusTag(BinData &b) {
  if (b.sensorError) return "[SENSOR ERR]";
  if (b.isFull)      return "[FULL!]";
  if (b.isWarning)   return "[WARNING]";
  return "[OK]";
}

String gasTag(BinData &b) {
  return b.gasDetected ? "GAS DETECTED!" : "Air normal";
}

String buildBinLine(const char *label, BinData &b) {
  String line = String(label) + ": ";
  if (b.sensorError) {
    line += "SENSOR ERROR";
  } else {
    line += String(b.fillPercent) + "% full";
    line += " (" + String(b.distanceCm, 1) + "cm)";
    line += " " + binStatusTag(b);
    line += "\nGas: " + gasTag(b);
    if (b.fillRate > 0.1f) {
      float hoursLeft = (100.0f - b.fillPercent) / b.fillRate;
      if (hoursLeft < 48)
        line += "\nFull in: " + String(hoursLeft, 1) + " hrs";
    }
  }
  return line;
}

String buildStatusReply() {
  String msg = "=SmartWaste Status=\n";
  msg += buildBinLine("Bin A", binA);
  msg += "\n\n";
  msg += buildBinLine("Bin B", binB);
  msg += "\n\nUptime: " + String(millis() / 60000) + " min";
  return msg;
}

String buildHelpReply() {
  return "=SmartWaste Commands=\n"
         "STATUS - Full report\n"
         "BIN A  - Bin A only\n"
         "BIN B  - Bin B only\n"
         "HELP   - This list";
}

// ═══════════════════════════════════════════════════════════════════════════
//  GSM — RECEIVE & PARSE INCOMING SMS
// ═══════════════════════════════════════════════════════════════════════════

String extractSender(const String &line) {
  int first  = line.indexOf('"');
  if (first  == -1) return ALERT_PHONE;
  int second = line.indexOf('"', first + 1);
  if (second == -1) return ALERT_PHONE;
  return line.substring(first + 1, second);
}

String extractBodyFromCMT(const String &block) {
  int nl = block.indexOf('\n');
  if (nl == -1) return "";
  String body = block.substring(nl + 1);
  body.trim();
  return body;
}

void processCommand(const String &rawCmd, const String &senderNumber) {
  String cmd = rawCmd;
  cmd.toUpperCase();
  cmd.trim();
  Serial.println("[SMS-IN] From:" + senderNumber + " Cmd:[" + cmd + "]");

  String reply = "";
  if      (cmd == "STATUS")              reply = buildStatusReply();
  else if (cmd == "BIN A" || cmd == "BINA") reply = buildBinLine("Bin A", binA);
  else if (cmd == "BIN B" || cmd == "BINB") reply = buildBinLine("Bin B", binB);
  else if (cmd == "HELP"  || cmd == "?") reply = buildHelpReply();
  else reply = "Unknown: \"" + rawCmd + "\"\nSend HELP for commands.";

  sendSMS(senderNumber.c_str(), reply);
}

void handleCMT(const String &buffer) {
  int idx = buffer.indexOf("+CMT:");
  if (idx == -1) return;
  String block  = buffer.substring(idx);
  String sender = extractSender(block);
  String body   = extractBodyFromCMT(block);
  if (body.length() > 0) processCommand(body, sender);
}

void pollInboxSMS() {
  if (!gsmReady) return;
  while (gsmSerial.available()) gsmSerial.read();
  gsmSerial.println("AT+CMGL=\"REC UNREAD\"");
  delay(1500);
  String response = "";
  while (gsmSerial.available()) response += (char)gsmSerial.read();
  if (response.indexOf("+CMGL:") == -1) return;

  Serial.println("[GSM] Inbox: " + response);
  int pos = 0;
  while (true) {
    int idx = response.indexOf("+CMGL:", pos);
    if (idx == -1) break;
    int lineEnd   = response.indexOf('\n', idx);
    String header = response.substring(idx, lineEnd);
    String sender = extractSender(header.substring(7));
    int bodyStart = lineEnd + 1;
    int bodyEnd   = response.indexOf('\n', bodyStart);
    String body   = (bodyEnd == -1)
                    ? response.substring(bodyStart)
                    : response.substring(bodyStart, bodyEnd);
    body.trim();
    if (body.length() > 0 && body != "OK") processCommand(body, sender);
    pos = (bodyEnd == -1) ? response.length() : bodyEnd + 1;
  }
  gsmCmd("AT+CMGD=1,4", 500);  // Delete all after processing
}

void checkIncomingSMS() {
  // Part 1: read any buffered +CMT unsolicited data
  String gsmBuf = "";
  unsigned long t0 = millis();
  while (millis() - t0 < 200) {
    if (gsmSerial.available()) {
      gsmBuf += (char)gsmSerial.read();
      t0 = millis();
    }
  }
  if (gsmBuf.length() > 0) {
    Serial.print("[GSM raw] "); Serial.println(gsmBuf);
    if (gsmBuf.indexOf("+CMT:") != -1) {
      handleCMT(gsmBuf);
      gsmCmd("AT+CMGD=1,4", 300);
    }
  }
  // Part 2: active inbox poll (catches anything missed by CMT)
  pollInboxSMS();
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTO ALERTS (outgoing, triggered by sensor thresholds)
// ═══════════════════════════════════════════════════════════════════════════

void checkAutoAlerts(BinData &b, char name, unsigned long nowMs) {
  if (b.sensorError) return;
  if (b.isFull && (nowMs - b.lastFullSmsMs > SMS_COOLDOWN_MS)) {
    sendSMS(ALERT_PHONE,
      String("[SmartWaste] Bin ") + name + " FULL (" +
      b.fillPercent + "%). Collect now!");
    b.lastFullSmsMs = nowMs;
  }
  if (b.gasDetected && (nowMs - b.lastGasSmsMs > SMS_COOLDOWN_MS)) {
    sendSMS(ALERT_PHONE,
      String("[SmartWaste] Bin ") + name + " gas detected! ADC=" +
      b.gasRaw + ". Check immediately.");
    b.lastGasSmsMs = nowMs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

void broadcastData() {
 StaticJsonDocument<200> doc;

 doc["bin1"]["level"] = binA.fillPercent;
 doc["bin1"]["gas"]   = binA.gasRaw;

 doc["bin2"]["level"] = binB.fillPercent;
 doc["bin2"]["gas"]   = binB.gasRaw;

 String json;
 serializeJson(doc, json);

 webSocket.sendTXT(json);
}
 
 void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
   switch(type) {
     case WStype_CONNECTED:
       Serial.println("✅ Connected to Node server");
       break;

     case WStype_DISCONNECTED:
       Serial.println("❌ Disconnected — retrying...");
       break;

     case WStype_ERROR:
       Serial.println("⚠️ WebSocket error");
       break;

     default:
      break;
   }
 }

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP & LOOP
// ═══════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  Serial.println("\n=================================");
  Serial.println("  SmartWaste v3.0  |  2-way SMS");
  Serial.println("=================================");

  // US-100 sensors
  sensorA.begin(9600, SERIAL_8N1, US_A_RX, US_A_TX);
  Serial.println("[Sensor A] UART2 GPIO16(RX)/17(TX)");
  sensorB.begin(9600, SERIAL_8N1, US_B_RX, US_B_TX);
  Serial.println("[Sensor B] UART1 GPIO4(RX)/5(TX)");

  // MQ4 ADC
  analogSetPinAttenuation(BIN_A_GAS, ADC_11db);
  analogSetPinAttenuation(BIN_B_GAS, ADC_11db);

  // WiFi — force STA mode, clear stale config
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(200);

  Serial.printf("[WiFi] Connecting to \"%s\" ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - wifiStart > 20000) {
      Serial.println("\n[WiFi] FAILED — check SSID/password, restarting...");
      delay(3000);
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }

  delay(500);  // Let DHCP finalise before reading IP

  Serial.println("\n");
  Serial.println("************************************");
  Serial.println("*      WiFi Connected!             *");
  Serial.print  ("*  IP: ");
  Serial.println(WiFi.localIP());
  Serial.println("*  Enter IP in dashboard           *");
  Serial.println("************************************");

  // WebSocket
  webSocket.begin("10.244.233.132", 8080, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
  
  Serial.println("[WS] Connecting to Node server...");

  // GSM last (needs 3s+ init time)
  gsmReady = initGSM();

  Serial.println("\n--- SMS Commands ---");
  Serial.println("STATUS / BIN A / BIN B / HELP");
  Serial.println("--------------------\n");

  delay(2000);
  Serial.println("[System] Ready");
}

void loop() {
  webSocket.loop();
  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    readAllSensors();
    checkAutoAlerts(binA, 'A', now);
    checkAutoAlerts(binB, 'B', now);
  }

  if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
    lastBroadcast = now;
    broadcastData();
  }

  if (now - lastSmsCheck >= SMS_CHECK_INTERVAL_MS) {
    lastSmsCheck = now;
    checkIncomingSMS();
  }
}