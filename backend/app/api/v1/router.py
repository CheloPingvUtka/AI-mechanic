from fastapi import APIRouter

from app.api.v1.endpoints import assistant, diagnostics, tickets, vehicles

api_router = APIRouter()
api_router.include_router(vehicles.router, prefix="/vehicles", tags=["vehicles"])
api_router.include_router(diagnostics.router, prefix="/diagnostics", tags=["diagnostics"])
api_router.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
api_router.include_router(tickets.router, prefix="/tickets", tags=["tickets"])
