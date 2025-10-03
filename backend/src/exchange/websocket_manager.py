from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        # Store active connections with their subscriptions
        self.connections: dict[WebSocket, dict[str, Any]] = {}

    def connect(self, websocket: WebSocket) -> None:
        """Register a new WebSocket connection."""
        self.connections[websocket] = {"symbols": [], "channels": []}

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        if websocket in self.connections:
            del self.connections[websocket]

    def subscribe(
        self,
        websocket: WebSocket,
        symbols: Sequence[str],
        channels: Sequence[str],
    ) -> None:
        """Subscribe a connection to specific symbols and channels."""
        if websocket in self.connections:
            self.connections[websocket]["symbols"] = list(symbols)
            self.connections[websocket]["channels"] = list(channels)

    def unsubscribe(self, websocket: WebSocket) -> None:
        """Unsubscribe a connection from all channels."""
        if websocket in self.connections:
            self.connections[websocket]["symbols"] = []
            self.connections[websocket]["channels"] = []

    async def send_to_connection(self, websocket: WebSocket, data: dict[str, Any]) -> bool:
        """Send data to a specific connection."""
        try:
            await websocket.send_json(data)
            return True
        except Exception as exc:  # pragma: no cover - network errors
            print(f"Failed to send to WebSocket connection: {exc}")
            if "connection" in str(exc).lower() or "closed" in str(exc).lower():
                self.disconnect(websocket)
            return False

    async def broadcast_to_symbol(self, symbol: str, channel: str, data: dict[str, Any]) -> None:
        """Broadcast data to all connections subscribed to a symbol and channel."""
        disconnected: list[WebSocket] = []

        for websocket, subscription in self.connections.items():
            if symbol in subscription["symbols"] and channel in subscription["channels"]:
                try:
                    await websocket.send_json(data)
                except Exception:
                    disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(websocket)

    async def notify_order_book_update(
        self,
        symbol: str,
        bids: Sequence[tuple[float, int]],
        asks: Sequence[tuple[float, int]],
    ) -> None:
        """Notify subscribers of an updated order book snapshot."""
        timestamp = datetime.now(tz=UTC).isoformat()
        bids_payload = [
            {"price": float(price), "quantity": int(quantity)}
            for price, quantity in bids
        ]
        asks_payload = [
            {"price": float(price), "quantity": int(quantity)}
            for price, quantity in asks
        ]

        await self.broadcast_to_symbol(
            symbol,
            "orderbook",
            {
                "type": "orderbook",
                "symbol": symbol,
                "bids": bids_payload,
                "asks": asks_payload,
                "timestamp": timestamp,
            },
        )

        if bids_payload or asks_payload:
            await self.broadcast_to_symbol(
                symbol,
                "quotes",
                {
                    "type": "quote",
                    "symbol": symbol,
                    "bid": bids_payload[0]["price"] if bids_payload else None,
                    "ask": asks_payload[0]["price"] if asks_payload else None,
                    "bid_size": bids_payload[0]["quantity"] if bids_payload else 0,
                    "ask_size": asks_payload[0]["quantity"] if asks_payload else 0,
                    "timestamp": timestamp,
                },
            )

    async def notify_trade(self, symbol: str, price: float, quantity: int, timestamp: str) -> None:
        """Notify all subscribers of a new trade."""
        await self.broadcast_to_symbol(
            symbol,
            "trades",
            {
                "type": "trade",
                "symbol": symbol,
                "price": price,
                "quantity": quantity,
                "timestamp": timestamp,
            },
        )


# Global WebSocket manager instance
websocket_manager = WebSocketManager()
