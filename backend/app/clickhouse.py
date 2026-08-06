from __future__ import annotations

import clickhouse_connect

from app.config import settings


async def clickhouse_client():
    if not settings.clickhouse_host or not settings.clickhouse_password:
        raise RuntimeError("ClickHouse credentials are not configured")
    return await clickhouse_connect.get_async_client(
        host=settings.clickhouse_host,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
        secure=True,
    )


async def check_clickhouse() -> None:
    client = await clickhouse_client()
    try:
        await client.command("SELECT 1")
    finally:
        await client.close()
