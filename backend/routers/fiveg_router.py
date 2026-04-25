"""
5G tower connectivity API router.
"""

from fastapi import APIRouter
from models.schemas import FiveGRequest, UserMoveRequest
from simulators.fiveg import FiveGSimulator

router = APIRouter(prefix="/api/fiveg", tags=["5G"])

_sim = FiveGSimulator()


@router.post("/simulate")
async def simulate_fiveg(req: FiveGRequest):
    """Run 5G connectivity simulation with given towers and users."""
    towers = [t.model_dump() for t in req.towers]
    users = [u.model_dump() for u in req.users]
    _sim.setup(towers, users)
    return _sim.simulate()


@router.post("/move-user")
async def move_user(req: UserMoveRequest):
    """Move a user and re-simulate."""
    towers = [t.model_dump() for t in req.towers]
    users = [u.model_dump() for u in req.users]

    # apply movement
    u = users[req.user_id]
    u["x"] += req.dx
    u["y"] += req.dy

    _sim.setup(towers, users)
    result = _sim.simulate()
    result["moved_user"] = req.user_id
    return result
