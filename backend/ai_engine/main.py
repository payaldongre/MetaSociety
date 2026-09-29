"""
main.py
=======
FastAPI entry point for the AI Town Policy Engine.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from ai_engine.graph import run_graph, load_data
from ai_engine.dashboard_extractor import build_chart_extracts


# ─────────────────────── APP INITIALIZATION ──────────────────────────────────

app = FastAPI(
    title="AI Town – Policy Engine",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────── REQUEST MODEL ───────────────────────────────────────

class PolicyRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Query message cannot be empty.")
        return v.strip()


# ─────────────────────── ROUTES ──────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "service": "AI Town Policy Engine v2"}


@app.post("/policy")
def get_policy(request: PolicyRequest):
    """
    Run the full pipeline:
    load data → extract dashboards → insights → policy
    """
    result = run_graph(request.message)
    return {
        "response": result["policies"],
        "chart_extracts": result["chart_extracts"],
        "warnings": result["errors"],
    }


@app.get("/extracts/{dataset_name}")
def get_extract(dataset_name: str):
    valid = {
        "economy", "demographics", "education",
        "healthcare", "infrastructure", "governance"
    }

    if dataset_name not in valid:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{dataset_name}'. Valid: {sorted(valid)}"
        )

    data = load_data()
    extracts = build_chart_extracts(data)

    return extracts.get(dataset_name, {})