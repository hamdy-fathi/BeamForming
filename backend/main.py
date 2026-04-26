"""
FastAPI application entry point for the Beamforming Simulator backend.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.beamforming_router import router as beamforming_router
from routers.fiveg_router import router as fiveg_router
from routers.ultrasound_router import router as ultrasound_router
from routers.radar_router import router as radar_router

app = FastAPI(
    title="Beamforming Simulator API",
    description="Backend for 2D beamforming, 5G, ultrasound, and radar simulators.",
    version="1.0.0",
)

# CORS — allow Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(beamforming_router)
app.include_router(fiveg_router)
app.include_router(ultrasound_router)
app.include_router(radar_router)


@app.get("/")
async def root():
    return {"message": "Beamforming Simulator API", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}
