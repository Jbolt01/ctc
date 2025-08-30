#!/usr/bin/env node

// Simple WebSocket test script
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost/ws/v1/market-data');

ws.on('open', function open() {
  console.log('✅ WebSocket connected successfully!');
  
  // Send subscription message
  const subscription = {
    action: 'subscribe',
    symbols: ['AAPL'],
    channels: ['quotes', 'orderbook', 'trades']
  };
  
  console.log('📤 Sending subscription:', JSON.stringify(subscription));
  ws.send(JSON.stringify(subscription));
});

ws.on('message', function message(data) {
  try {
    const parsed = JSON.parse(data.toString());
    console.log('📥 Received:', JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('📥 Received (raw):', data.toString());
  }
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', function close(code, reason) {
  console.log(`🔌 WebSocket closed: ${code} ${reason}`);
});

// Keep the script running for 30 seconds to receive messages
setTimeout(() => {
  console.log('⏰ Test complete, closing connection...');
  ws.close();
  process.exit(0);
}, 30000);

console.log('🚀 Starting WebSocket test...');
