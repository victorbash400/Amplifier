from __future__ import annotations

import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Iterable

import aiosqlite
import asyncpg

from app.config import settings


_pool: asyncpg.Pool | None = None


class PostgresCursor:
    def __init__(self, rows: list[asyncpg.Record] | None = None, rowcount: int = 0):
        self._rows = rows or []
        self.rowcount = rowcount

    async def fetchone(self) -> asyncpg.Record | None:
        return self._rows[0] if self._rows else None

    async def fetchall(self) -> list[asyncpg.Record]:
        return self._rows


class PostgresConnection:
    def __init__(self, connection: asyncpg.Connection):
        self.connection = connection
        self.transaction = connection.transaction()
        self.ended = False
        self.row_factory: object | None = None

    async def start(self) -> None:
        await self.transaction.start()

    async def execute(self, query: str, parameters: Iterable[Any] = ()) -> PostgresCursor:
        normalized = _postgres_query(query)
        values = tuple(parameters)
        if not normalized:
            return PostgresCursor()
        if normalized.lstrip().upper().startswith(("SELECT", "WITH")):
            return PostgresCursor(list(await self.connection.fetch(normalized, *values)))
        status = await self.connection.execute(normalized, *values)
        return PostgresCursor(rowcount=_affected_rows(status))

    async def executemany(self, query: str, parameters: Iterable[Iterable[Any]]) -> PostgresCursor:
        values = [tuple(row) for row in parameters]
        if values:
            await self.connection.executemany(_postgres_query(query), values)
        return PostgresCursor(rowcount=len(values))

    async def commit(self) -> None:
        if not self.ended:
            await self.transaction.commit()
            self.ended = True

    async def rollback(self) -> None:
        if not self.ended:
            await self.transaction.rollback()
            self.ended = True


async def _postgres_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        options: dict[str, Any] = {
            "min_size": 1,
            "max_size": settings.database_pool_size,
            "command_timeout": 30,
        }
        if settings.app_database_url:
            options["dsn"] = settings.app_database_url
        else:
            options.update(
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name,
                host=settings.database_socket,
            )
        _pool = await asyncpg.create_pool(**options)
    return _pool


@asynccontextmanager
async def connect(sqlite_path: str | Path) -> AsyncIterator[aiosqlite.Connection | PostgresConnection]:
    if not settings.app_database_url and not settings.database_socket:
        async with aiosqlite.connect(sqlite_path) as database:
            yield database
        return
    pool = await _postgres_pool()
    async with pool.acquire() as raw:
        database = PostgresConnection(raw)
        await database.start()
        try:
            yield database
        finally:
            if not database.ended:
                await database.rollback()


def _postgres_query(query: str) -> str:
    stripped = query.strip()
    if stripped.upper().startswith("PRAGMA ") or stripped.upper() == "BEGIN IMMEDIATE":
        return ""
    stripped = stripped.replace("datetime('now')", "CURRENT_TIMESTAMP")
    stripped = stripped.replace("CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP::text")
    index = 0

    def parameter(_: re.Match[str]) -> str:
        nonlocal index
        index += 1
        return f"${index}"

    return re.sub(r"\?", parameter, stripped)


def _affected_rows(status: str) -> int:
    final = status.rsplit(" ", 1)[-1]
    return int(final) if final.isdigit() else 0


async def lock_project(database: aiosqlite.Connection | PostgresConnection, project_id: str, account_id: str) -> None:
    if isinstance(database, PostgresConnection):
        await database.execute(
            "SELECT id FROM projects WHERE id = ? AND account_id = ? FOR UPDATE",
            (project_id, account_id),
        )
        return
    await database.execute("BEGIN IMMEDIATE")
