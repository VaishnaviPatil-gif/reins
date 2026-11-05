"""
Idempotent seed: creates one demo user + one demo agent.
Run once at startup if the DB is empty.
Why idempotent: Render free tier spins down and up — we don't want duplicate seed rows.
"""
import secrets
from sqlalchemy.orm import Session
from app.models import User, Agent


DEMO_API_KEY = "demo-agent-key-reins-2024"


def seed(db: Session) -> None:
    """Insert demo user and agent if they don't exist yet."""
    if db.query(User).filter(User.name == "Demo User").first():
        return  # Already seeded

    user = User(name="Demo User")
    db.add(user)
    db.flush()  # Get user.id without committing

    agent = Agent(
        user_id=user.id,
        name="Shopping Agent",
        api_key=DEMO_API_KEY,
    )
    db.add(agent)
    db.commit()
    print(f"[seed] Demo user id={user.id}, agent api_key={DEMO_API_KEY}")
