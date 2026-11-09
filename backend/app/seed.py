"""
Idempotent seed: creates one demo user + one demo agent + one demo restocking mandate.
Run once at startup if the DB is empty.
Why idempotent: Render free tier spins down and up — we don't want duplicate seed rows.
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from app.models import User, Agent, Mandate
from app.services.mandates import issue_mandate_token


DEMO_API_KEY = "demo-agent-key-reins-2024"


def seed(db: Session) -> None:
    """Insert demo user, agent, and restocking mandate if they don't exist yet."""
    user = db.query(User).filter(User.name == "Demo User").first()
    if not user:
        user = User(name="Demo User")
        db.add(user)
        db.flush()

    agent = db.query(Agent).filter(Agent.name == "Shopping Agent").first()
    if not agent:
        agent = Agent(
            user_id=user.id,
            name="Shopping Agent",
            api_key=DEMO_API_KEY,
        )
        db.add(agent)
        db.flush()

    if db.query(Mandate).count() == 0:
        now = datetime.now(timezone.utc)
        demo_mandate = Mandate(
            user_id=user.id,
            agent_id=agent.id,
            budget_total=300.0,
            budget_spent=0.0,
            per_purchase_cap=100.0,
            escalate_above=50.0,
            allowed_categories=[
                "shipping_supplies",
                "packaging",
                "office_supplies",
                "Shipping Supplies",
                "Packaging",
                "Office Supplies",
            ],
            blocked_merchants=["Banned Merchant", "Scam Store"],
            allowed_merchants=[],
            valid_from=now,
            valid_until=now + timedelta(days=90),
            status="pending_link",
            token="seed_pending_token",
        )
        db.add(demo_mandate)
        db.flush()

        jwt_token = issue_mandate_token(
            mandate_id=demo_mandate.id,
            user_id=demo_mandate.user_id,
            agent_id=demo_mandate.agent_id,
            version=demo_mandate.version,
        )
        demo_mandate.token = jwt_token
        db.commit()
        print(f"[seed] Demo user id={user.id}, agent api_key={DEMO_API_KEY}, mandate id={demo_mandate.id} ($300 total, $100 cap, $50 escalate)")
    else:
        db.commit()
        print(f"[seed] Database already seeded.")
