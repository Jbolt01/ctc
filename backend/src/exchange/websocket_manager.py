from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Set
from uuid import UUID

from fastapi import WebSocket
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Order as OrderModel, Symbol as SymbolModel, Trade as TradeModel


class WebSocketManager:
    def __init__(self):
        # Store active connections with their subscriptions
        self.connections: Dict[WebSocket, Dict[str, Any]] = {}
    
    def connect(self, websocket: WebSocket):
        """Register a new WebSocket connection"""
        self.connections[websocket] = {
            "symbols": [],
            "channels": []
        }
    
    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.connections:
            del self.connections[websocket]
    
    def subscribe(self, websocket: WebSocket, symbols: List[str], channels: List[str]):
        """Subscribe a connection to specific symbols and channels"""
        if websocket in self.connections:
            self.connections[websocket]["symbols"] = symbols
            self.connections[websocket]["channels"] = channels
    
    def unsubscribe(self, websocket: WebSocket):
        """Unsubscribe a connection from all channels"""
        if websocket in self.connections:
            self.connections[websocket]["symbols"] = []
            self.connections[websocket]["channels"] = []
    
    async def send_to_connection(self, websocket: WebSocket, data: dict):
        """Send data to a specific connection"""
        try:
            await websocket.send_json(data)
            return True
        except Exception as e:
            print(f"Failed to send to WebSocket connection: {e}")
            # Only disconnect if it's a connection error, not other errors
            if "connection" in str(e).lower() or "closed" in str(e).lower():
                self.disconnect(websocket)
            return False
    
    async def broadcast_to_symbol(self, symbol: str, channel: str, data: dict):
        """Broadcast data to all connections subscribed to a symbol and channel"""
        disconnected = []
        
        for websocket, subscription in self.connections.items():
            if symbol in subscription["symbols"] and channel in subscription["channels"]:
                try:
                    await websocket.send_json(data)
                except Exception:
                    # Connection is closed, mark for removal
                    disconnected.append(websocket)
        
        # Remove disconnected connections
        for websocket in disconnected:
            self.disconnect(websocket)
    
    async def get_order_book(self, symbol: str, session: AsyncSession):
        """Get real order book from database"""
        # Get symbol_id
        symbol_result = await session.scalar(
            select(SymbolModel.id).where(SymbolModel.symbol == symbol)
        )
        if not symbol_result:
            return {"bids": [], "asks": []}
        
        # Get open buy orders (bids) - highest price first
        bids_query = select(OrderModel.price, func.sum(OrderModel.quantity - OrderModel.filled_quantity).label("total_quantity"))\
            .where(
                OrderModel.symbol_id == symbol_result,
                OrderModel.side == "buy",
                OrderModel.status.in_(["pending", "partially_filled"]),
                OrderModel.price.is_not(None)
            )\
            .group_by(OrderModel.price)\
            .order_by(OrderModel.price.desc())\
            .limit(10)
        
        bids_result = await session.execute(bids_query)
        bids = [{"price": float(row.price), "quantity": int(row.total_quantity)} 
                for row in bids_result.fetchall()]
        
        # Get open sell orders (asks) - lowest price first
        asks_query = select(OrderModel.price, func.sum(OrderModel.quantity - OrderModel.filled_quantity).label("total_quantity"))\
            .where(
                OrderModel.symbol_id == symbol_result,
                OrderModel.side == "sell", 
                OrderModel.status.in_(["pending", "partially_filled"]),
                OrderModel.price.is_not(None)
            )\
            .group_by(OrderModel.price)\
            .order_by(OrderModel.price.asc())\
            .limit(10)
        
        asks_result = await session.execute(asks_query)
        asks = [{"price": float(row.price), "quantity": int(row.total_quantity)} 
                for row in asks_result.fetchall()]
        
        return {"bids": bids, "asks": asks}
    
    async def notify_order_book_update(self, symbol: str, session: AsyncSession):
        """Notify all subscribers of order book changes"""
        from datetime import datetime, timezone
        
        order_book = await self.get_order_book(symbol, session)
        timestamp = datetime.now(tz=timezone.utc).isoformat()
        
        # Send order book update
        await self.broadcast_to_symbol(symbol, "orderbook", {
            "type": "orderbook",
            "symbol": symbol,
            "bids": order_book["bids"],
            "asks": order_book["asks"],
            "timestamp": timestamp,
        })
        
        # Send quote update (best bid/ask)
        bid = order_book["bids"][0]["price"] if order_book["bids"] else None
        ask = order_book["asks"][0]["price"] if order_book["asks"] else None
        bid_size = order_book["bids"][0]["quantity"] if order_book["bids"] else 0
        ask_size = order_book["asks"][0]["quantity"] if order_book["asks"] else 0
        
        if bid is not None or ask is not None:
            await self.broadcast_to_symbol(symbol, "quotes", {
                "type": "quote",
                "symbol": symbol,
                "bid": bid,
                "ask": ask,
                "bid_size": bid_size,
                "ask_size": ask_size,
                "timestamp": timestamp,
            })
    
    async def notify_trade(self, symbol: str, price: float, quantity: int, timestamp: str):
        """Notify all subscribers of a new trade"""
        await self.broadcast_to_symbol(symbol, "trades", {
            "type": "trade",
            "symbol": symbol,
            "price": price,
            "quantity": quantity,
            "timestamp": timestamp,
        })


# Global WebSocket manager instance
websocket_manager = WebSocketManager()
