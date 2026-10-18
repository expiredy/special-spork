"""In-memory WebSocket rooms for a single-process local/internal deployment."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket

class ProcessRoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, process_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            self.rooms.setdefault(process_id, set()).add(websocket)

    async def disconnect(self, process_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            self.rooms.get(process_id, set()).discard(websocket)
            if not self.rooms.get(process_id):
                self.rooms.pop(process_id, None)

    async def broadcast(self, process_id: str, message: dict[str, Any], sender: WebSocket | None = None) -> None:
        async with self.lock:
            sockets = list(self.rooms.get(process_id, set()))
        for socket in sockets:
            if socket is sender:
                continue
            try:
                await socket.send_json(message)
            except Exception:
                await self.disconnect(process_id, socket)

    async def presence(self, process_id: str) -> int:
        async with self.lock:
            return len(self.rooms.get(process_id, set()))


process_rooms = ProcessRoomManager()
