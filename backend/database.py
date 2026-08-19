"""
MongoDB connection handling for the Fund Dashboard application.
Uses Motor, the async driver for MongoDB, so calls do not block FastAPI's event loop.
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME")

client: AsyncIOMotorClient = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB_NAME]

# Collections
funds_collection = db["funds"]
clients_collection = db["clients"]
corpus_movements_collection = db["corpus_movements"]
schemes_collection = db["schemes"]
categories_collection = db["categories"]
nav_records_collection = db["nav_records"]
soa_records_collection = db["soa_records"]
dashboard_records_collection = db["dashboard_records"]
validation_docs_collection = db["validation_docs"]


async def ping_database() -> bool:
    """Simple connectivity check used by the /api/health endpoint."""
    try:
        await client.admin.command("ping")
        return True
    except Exception:
        return False
