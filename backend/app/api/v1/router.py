from fastapi import APIRouter

from app.api.v1.endpoints import assistant, diagnostics, fleet, manuals, tickets, vehicles, work

api_router = APIRouter()
api_router.include_router(vehicles.router, prefix="/vehicles", tags=["vehicles"])
api_router.include_router(diagnostics.router, prefix="/diagnostics", tags=["diagnostics"])
api_router.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
api_router.include_router(tickets.router, prefix="/tickets", tags=["tickets"])
api_router.include_router(fleet.router, prefix="/fleet", tags=["fleet"])
api_router.include_router(manuals.router, prefix="/manuals", tags=["manuals"])
api_router.include_router(work.router, prefix="/work", tags=["work"])
