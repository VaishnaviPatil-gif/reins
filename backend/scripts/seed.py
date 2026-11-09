"""
Standalone script to seed the database.
Usage:
    python scripts/seed.py
"""
import sys
import os

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import engine, SessionLocal, Base
from app.models import *  # noqa: F401, F403
from app.seed import seed


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
