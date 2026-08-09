from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import aiosqlite

DEMO_EMAIL = "demo@amplifier.local"
DEMO_PASSWORD = "amplifier-demo"
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
DATABASE_PATH = Path(__file__).resolve().parents[1] / "amplifier_accounts.db"
_schema_lock = asyncio.Lock()
_schema_ready = False


@dataclass(frozen=True)
class StoredAccount:
    id: str
    email: str
    name: str
    password_hash: str
    salt: str


async def create_account(email_input: str, password: str, name_input: str) -> dict[str, str]:
    email = normalize_email(email_input)
    name = name_input.strip()
    validate_account(email, password, name)
    await ensure_schema()
    if await read_account(email):
        raise ValueError("An account with this email already exists")
    account = await new_stored_account(email, password, name)
    try:
        await write_account(account)
    except sqlite3.IntegrityError as error:
        raise ValueError("An account with this email already exists") from error
    return public_account(account)


async def authenticate_account(email_input: str, password: str) -> dict[str, str] | None:
    email = normalize_email(email_input)
    await ensure_schema()
    if email == DEMO_EMAIL:
        await ensure_demo_account()
    account = await read_account(email)
    if not account or not await verify_password(password, account):
        return None
    return public_account(account)


async def ensure_demo_account() -> dict[str, str]:
    await ensure_schema()
    account = await read_account(DEMO_EMAIL)
    if not account:
        candidate = await new_stored_account(DEMO_EMAIL, DEMO_PASSWORD, "Demo")
        try:
            await write_account(candidate)
            account = candidate
        except sqlite3.IntegrityError:
            account = await read_account(DEMO_EMAIL)
    if not account:
        raise RuntimeError("Could not create the demo account")
    return public_account(account)


async def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_lock:
        if _schema_ready:
            return
        async with aiosqlite.connect(DATABASE_PATH) as database:
            await database.execute("PRAGMA foreign_keys = ON")
            await database.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL)")
            await database.execute("CREATE TABLE IF NOT EXISTS workspaces (account_id TEXT PRIMARY KEY, workspace_json TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE)")
            await database.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE)")
            await database.execute("CREATE INDEX IF NOT EXISTS projects_account_id ON projects(account_id)")
            await database.execute("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, project_id TEXT NOT NULL, asset_json TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)")
            await database.execute("CREATE INDEX IF NOT EXISTS assets_project_id ON assets(project_id)")
            cursor = await database.execute("SELECT account_id, workspace_json FROM workspaces")
            for account_id, encoded in await cursor.fetchall():
                await _sync_registry(database, account_id, json.loads(encoded), remove_missing=False)
            await database.commit()
        _schema_ready = True


async def read_account(email: str) -> StoredAccount | None:
    async with aiosqlite.connect(DATABASE_PATH) as database:
        database.row_factory = aiosqlite.Row
        cursor = await database.execute("SELECT id, email, name, password_hash, salt FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
    return StoredAccount(**dict(row)) if row else None


async def write_account(account: StoredAccount) -> None:
    async with aiosqlite.connect(DATABASE_PATH) as database:
        await database.execute("INSERT INTO users (id, email, name, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", (account.id, account.email, account.name, account.password_hash, account.salt))
        await database.commit()


async def new_stored_account(email: str, password: str, name: str) -> StoredAccount:
    salt = os.urandom(16).hex()
    password_hash = await hash_password(password, salt)
    return StoredAccount(id=str(uuid4()), email=email, name=name, password_hash=password_hash, salt=salt)


async def hash_password(password: str, salt: str) -> str:
    return await asyncio.to_thread(lambda: hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex())


async def verify_password(password: str, account: StoredAccount) -> bool:
    return hmac.compare_digest(await hash_password(password, account.salt), account.password_hash)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_account(email: str, password: str, name: str) -> None:
    if not EMAIL.fullmatch(email):
        raise ValueError("Enter a valid email address")
    if not name or len(name) > 80:
        raise ValueError("Enter a name under 80 characters")
    if len(password) < 8 or len(password) > 128:
        raise ValueError("Password must be 8 to 128 characters")


def public_account(account: StoredAccount) -> dict[str, str]:
    return {"id": account.id, "email": account.email, "name": account.name}


async def load_workspace(account_id: str) -> dict[str, list[dict[str, object]]]:
    await ensure_schema()
    async with aiosqlite.connect(DATABASE_PATH) as database:
        cursor = await database.execute("SELECT workspace_json FROM workspaces WHERE account_id = ?", (account_id,))
        row = await cursor.fetchone()
    if not row:
        return {"projects": [], "folders": [], "files": []}
    workspace = json.loads(row[0])
    validate_workspace(workspace)
    return workspace


async def save_workspace(account_id: str, workspace: dict[str, object]) -> None:
    await ensure_schema()
    validate_workspace(workspace)
    async with aiosqlite.connect(DATABASE_PATH) as database:
        await database.execute("PRAGMA foreign_keys = ON")
        cursor = await database.execute("SELECT id FROM users WHERE id = ?", (account_id,))
        if not await cursor.fetchone():
            raise ValueError("Account does not exist")
        await _sync_registry(database, account_id, workspace, remove_missing=True)
        await database.execute(
            "INSERT INTO workspaces (account_id, workspace_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(account_id) DO UPDATE SET workspace_json = excluded.workspace_json, updated_at = excluded.updated_at",
            (account_id, json.dumps(workspace, separators=(",", ":"))),
        )
        await database.commit()


async def account_owns_project(account_id: str, project_id: str) -> bool:
    await ensure_schema()
    async with aiosqlite.connect(DATABASE_PATH) as database:
        cursor = await database.execute("SELECT 1 FROM projects WHERE id = ? AND account_id = ?", (project_id, account_id))
        return bool(await cursor.fetchone())


async def project_asset(account_id: str, project_id: str, asset_id: str) -> dict[str, object] | None:
    await ensure_schema()
    async with aiosqlite.connect(DATABASE_PATH) as database:
        cursor = await database.execute("SELECT asset_json FROM assets WHERE id = ? AND project_id = ? AND account_id = ?", (asset_id, project_id, account_id))
        row = await cursor.fetchone()
    return json.loads(row[0]) if row else None


async def project_assets(account_id: str, project_id: str) -> list[dict[str, object]]:
    await ensure_schema()
    async with aiosqlite.connect(DATABASE_PATH) as database:
        cursor = await database.execute("SELECT asset_json FROM assets WHERE project_id = ? AND account_id = ? ORDER BY updated_at, id", (project_id, account_id))
        rows = await cursor.fetchall()
    return [json.loads(row[0]) for row in rows]


async def register_project_asset(account_id: str, project_id: str, asset: dict[str, object]) -> None:
    if not await account_owns_project(account_id, project_id):
        raise ValueError("Project not found")
    asset_id = str(asset.get("id") or "")
    if not asset_id or asset.get("projectId") != project_id:
        raise ValueError("Generated asset metadata is invalid")
    await ensure_schema()
    async with aiosqlite.connect(DATABASE_PATH) as database:
        await database.execute("PRAGMA foreign_keys = ON")
        cursor = await database.execute("SELECT account_id FROM assets WHERE id = ?", (asset_id,))
        owner = await cursor.fetchone()
        if owner and owner[0] != account_id:
            raise ValueError("An asset identifier belongs to another account")
        encoded = json.dumps(asset, separators=(",", ":"))
        await database.execute("INSERT INTO assets (id, account_id, project_id, asset_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET asset_json = excluded.asset_json, updated_at = excluded.updated_at WHERE assets.account_id = excluded.account_id", (asset_id, account_id, project_id, encoded))
        cursor = await database.execute("SELECT workspace_json FROM workspaces WHERE account_id = ?", (account_id,))
        row = await cursor.fetchone()
        workspace = json.loads(row[0]) if row else {"projects": [], "folders": [], "files": []}
        workspace["files"] = [item for item in workspace["files"] if not isinstance(item, dict) or item.get("id") != asset_id]
        workspace["files"].append(asset)
        await database.execute("INSERT INTO workspaces (account_id, workspace_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(account_id) DO UPDATE SET workspace_json = excluded.workspace_json, updated_at = excluded.updated_at", (account_id, json.dumps(workspace, separators=(",", ":"))))
        await database.commit()


async def _sync_registry(database: aiosqlite.Connection, account_id: str, workspace: dict[str, object], *, remove_missing: bool) -> None:
    projects = [item for item in workspace.get("projects", []) if isinstance(item, dict) and isinstance(item.get("id"), str)]
    files = [item for item in workspace.get("files", []) if isinstance(item, dict) and isinstance(item.get("id"), str) and isinstance(item.get("projectId"), str)]
    project_ids = {str(item["id"]) for item in projects}
    for project in projects:
        project_id = str(project["id"])
        cursor = await database.execute("SELECT account_id FROM projects WHERE id = ?", (project_id,))
        owner = await cursor.fetchone()
        if owner and owner[0] != account_id:
            raise ValueError("A project identifier belongs to another account")
        await database.execute("INSERT INTO projects (id, account_id, name, created_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET name = excluded.name WHERE projects.account_id = excluded.account_id", (project_id, account_id, str(project.get("name") or "Untitled project")))
    for asset in files:
        project_id = str(asset["projectId"])
        if project_id not in project_ids:
            raise ValueError("A workspace asset references an unknown project")
        asset_id = str(asset["id"])
        cursor = await database.execute("SELECT account_id FROM assets WHERE id = ?", (asset_id,))
        owner = await cursor.fetchone()
        if owner and owner[0] != account_id:
            raise ValueError("An asset identifier belongs to another account")
        await database.execute("INSERT INTO assets (id, account_id, project_id, asset_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, asset_json = excluded.asset_json, updated_at = excluded.updated_at WHERE assets.account_id = excluded.account_id", (asset_id, account_id, project_id, json.dumps(asset, separators=(",", ":"))))
    if not remove_missing:
        return
    if project_ids:
        placeholders = ",".join("?" for _ in project_ids)
        await database.execute(f"DELETE FROM projects WHERE account_id = ? AND id NOT IN ({placeholders})", (account_id, *sorted(project_ids)))
    else:
        await database.execute("DELETE FROM projects WHERE account_id = ?", (account_id,))
    asset_ids = {str(item["id"]) for item in files}
    if asset_ids:
        placeholders = ",".join("?" for _ in asset_ids)
        await database.execute(f"DELETE FROM assets WHERE account_id = ? AND id NOT IN ({placeholders})", (account_id, *sorted(asset_ids)))
    else:
        await database.execute("DELETE FROM assets WHERE account_id = ?", (account_id,))


def validate_workspace(workspace: object) -> None:
    if not isinstance(workspace, dict) or any(not isinstance(workspace.get(key), list) for key in ("projects", "folders", "files")):
        raise ValueError("The Amplifier workspace is invalid")
