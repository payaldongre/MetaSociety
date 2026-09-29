from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Dict
import pandas as pd
import os
import json
import re
import hashlib
import time

from openai import OpenAI
from dotenv import load_dotenv

from ai_engine.dashboard_extractor import build_chart_extracts


# ─────────────────────────── ENV ─────────────────────────────────────────────
load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    raise EnvironmentError("GROQ_API_KEY not set in .env")

client = OpenAI(
    api_key=api_key,
    base_url="https://api.groq.com/openai/v1"
)


# ─────────────────────────── CACHE + RETRY ───────────────────────────────────
_cache: Dict[str, str] = {}

def _cache_key(prompt: str) -> str:
    return hashlib.md5(prompt.encode()).hexdigest()

def _cached_generate(prompt: str, retries: int = 3, delay: float = 1.5) -> str:
    key = _cache_key(prompt)
    if key in _cache:
        return _cache[key]

    last_err = None
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                # model="llama-3.1-8b-instant",
                model="openai/gpt-oss-20b",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1024,
            )
            text = response.choices[0].message.content
            _cache[key] = text
            return text

        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(delay * (attempt + 1))

    raise RuntimeError(f"Groq failed after {retries} attempts: {last_err}")


# ─────────────────────────── STATE ───────────────────────────────────────────
class GraphState(TypedDict):
    user_query: str
    town_data: dict
    chart_extracts: dict
    insights: str
    policies: List[Dict]
    errors: List[str]


# ─────────────────────────── DATA LOADING ────────────────────────────────────
_DATASETS = ["economy", "demographics", "education",
             "healthcare", "infrastructure", "governance"]

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "..", "data")

def load_data() -> Dict[str, pd.DataFrame]:
    data = {}
    for name in _DATASETS:
        path = os.path.join(DATA_PATH, f"{name}.csv")
        try:
            data[name] = pd.read_csv(path)
        except FileNotFoundError:
            data[name] = pd.DataFrame()
    return data


# ─────────────────────────── NODE 1 ──────────────────────────────────────────
def extract_dashboards(state: GraphState) -> GraphState:
    try:
        state["chart_extracts"] = build_chart_extracts(state["town_data"])
    except Exception as e:
        state["errors"].append(f"extract_dashboards: {e}")
        state["chart_extracts"] = {}
    return state


# ─────────────────────────── NODE 2 ──────────────────────────────────────────
def _build_insight_context(chart_extracts: dict) -> str:
    lines = []
    for name, extract in chart_extracts.items():
        lines.append(f"[{name.upper()}]")
        lines.append(f"Summary: {extract.get('nl_summary', 'N/A')}")

        for h in extract.get("highlights", []):
            lines.append(f"Signal: {h}")

        for col, info in extract.get("anomalies", {}).items():
            lines.append(
                f"ANOMALY: {col} is {info['direction']} mean "
                f"({info['deviation_sigmas']}σ)"
            )
        lines.append("")
    return "\n".join(lines)


_INSIGHTS_PROMPT = """You are an urban data analyst.

Data:
{context}

User query: {user_query}

Give EXACTLY 3 insights.
"""

def generate_insights(state: GraphState) -> GraphState:
    context = _build_insight_context(state["chart_extracts"])

    prompt = _INSIGHTS_PROMPT.format(
        context=context[:5000],
        user_query=state["user_query"]
    )

    try:
        state["insights"] = _cached_generate(prompt)
    except Exception as e:
        state["errors"].append(f"generate_insights: {e}")
        state["insights"] = "Fallback insights used."

    return state


# ─────────────────────────── NODE 3 ──────────────────────────────────────────

_POLICY_PROMPT = """You are a policy advisor.

Insights:
{insights}

User query: {user_query}

Generate 3 policies in JSON format.

Each policy should include:
- name
- description
- benefits
- risks
- affected

Return ONLY JSON array.
"""

def _extract_json(text: str) -> str:
    match = re.search(r"\[\s*{.*}\s*\]", text, re.DOTALL)
    if match:
        return match.group(0)
    return text.strip()


def generate_policy(state: GraphState) -> GraphState:
    prompt = _POLICY_PROMPT.format(
        insights=state["insights"],
        user_query=state["user_query"]
    )

    try:
        raw = _cached_generate(prompt)
        clean = _extract_json(raw)

        # ✅ Safe JSON parsing
        try:
            parsed = json.loads(clean)
        except Exception:
            state["errors"].append("Invalid JSON from LLM")
            state["policies"] = []
            return state

        # ✅ Safe normalization with fallback values
        if isinstance(parsed, list):
            fixed = []
            for p in parsed:
                if isinstance(p, dict):
                    fixed.append({
                        "name": p.get("name") or p.get("title", "N/A"),
                        "description": p.get("description", ""),
                        "benefits": p.get("benefits") or "Improves outcomes based on policy implementation",
                        "risks": p.get("risks") or "May face implementation and resource challenges",
                        "affected": p.get("affected") or "General population"
                    })
            state["policies"] = fixed
        else:
            state["policies"] = parsed

    except Exception as e:
        state["errors"].append(f"generate_policy: {e}")
        state["policies"] = []

    return state


# ─────────────────────────── GRAPH ───────────────────────────────────────────
def build_graph():
    builder = StateGraph(GraphState)

    builder.add_node("extract_dashboards", extract_dashboards)
    builder.add_node("generate_insights", generate_insights)
    builder.add_node("generate_policy", generate_policy)

    builder.set_entry_point("extract_dashboards")
    builder.add_edge("extract_dashboards", "generate_insights")
    builder.add_edge("generate_insights", "generate_policy")
    builder.add_edge("generate_policy", END)

    return builder.compile()


graph = build_graph()


# ─────────────────────────── RUNNER ──────────────────────────────────────────
def run_graph(user_query: str) -> dict:
    state: GraphState = {
        "user_query": user_query,
        "town_data": load_data(),
        "chart_extracts": {},
        "insights": "",
        "policies": [],
        "errors": [],
    }

    result = graph.invoke(state)

    return {
        "policies": result["policies"],
        "chart_extracts": result["chart_extracts"],
        "errors": result["errors"],
    }