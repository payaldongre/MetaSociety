"""
dashboard_extractor.py
======================
Transforms raw CSVs into structured "chart extracts" — the same signals
a dashboard chart would communicate visually, encoded as JSON so the LLM
can reason over them precisely instead of raw tabular text.

Each extract contains:
  - trend_direction   : "rising" | "falling" | "stable" | "volatile"
  - stats             : {mean, std, min, max, p25, p50, p75} per numeric column
  - anomalies         : columns whose latest value is > 1.5 std from mean
  - highlights        : top-3 notable signals as plain-language strings
  - nl_summary        : one-sentence natural-language description of the dataset

These are fed directly into the LangGraph insight/policy prompts, replacing
the old raw stats dump.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any


# ──────────────────────────── HELPERS ────────────────────────────────────────

def _trend(series: pd.Series) -> str:
    """Classify the overall trend of a numeric time-series."""
    if len(series) < 3:
        return "stable"
    clean = series.dropna()
    if len(clean) < 2:
        return "stable"

    # Linear regression slope via polyfit
    x = np.arange(len(clean))
    slope = np.polyfit(x, clean.values, 1)[0]
    std   = clean.std()
    if std == 0:
        return "stable"

    normalised = slope / std          # slope in units of standard deviations per step
    if   normalised >  0.1:  return "rising"
    elif normalised < -0.1:  return "falling"

    # High variance with no clear direction → volatile
    cv = std / abs(clean.mean()) if clean.mean() != 0 else 0
    return "volatile" if cv > 0.3 else "stable"


def _column_stats(col: pd.Series) -> Dict[str, float]:
    """Return the core descriptive stats for one numeric column."""
    clean = col.dropna()
    if clean.empty:
        return {}
    q = clean.quantile([0.25, 0.50, 0.75])
    return {
        "mean": round(float(clean.mean()),  3),
        "std":  round(float(clean.std()),   3),
        "min":  round(float(clean.min()),   3),
        "max":  round(float(clean.max()),   3),
        "p25":  round(float(q[0.25]),       3),
        "p50":  round(float(q[0.50]),       3),
        "p75":  round(float(q[0.75]),       3),
        "trend": _trend(clean),
    }


def _detect_anomalies(df: pd.DataFrame, threshold: float = 1.5) -> Dict[str, Any]:
    """
    Flag columns where the latest data-point is more than `threshold`
    standard deviations away from the column mean.
    Returns {column_name: {latest, mean, deviation_sigmas}}.
    """
    anomalies = {}
    numeric = df.select_dtypes(include="number")
    for col in numeric.columns:
        clean = numeric[col].dropna()
        if len(clean) < 4:
            continue
        mean, std = clean.mean(), clean.std()
        if std == 0:
            continue
        latest = clean.iloc[-1]
        sigmas = abs((latest - mean) / std)
        if sigmas > threshold:
            anomalies[col] = {
                "latest":          round(float(latest), 3),
                "mean":            round(float(mean),   3),
                "deviation_sigmas": round(float(sigmas), 2),
                "direction":       "above" if latest > mean else "below",
            }
    return anomalies


def _highlights(df: pd.DataFrame, dataset_name: str) -> list[str]:
    """
    Generate up to 3 plain-language highlight strings that capture the
    most important signals — the kind a data analyst would narrate on a
    dashboard call.
    """
    notes = []
    numeric = df.select_dtypes(include="number")
    if numeric.empty:
        return [f"{dataset_name}: no numeric data available"]

    # Highlight 1: strongest rising column
    trends = {col: _trend(numeric[col]) for col in numeric.columns}
    rising  = [c for c, t in trends.items() if t == "rising"]
    falling = [c for c, t in trends.items() if t == "falling"]

    if rising:
        top = max(rising, key=lambda c: numeric[c].pct_change().mean())
        notes.append(
            f"{dataset_name}: '{top}' shows a sustained upward trend "
            f"(mean={round(numeric[top].mean(), 2)})"
        )
    if falling:
        top = min(falling, key=lambda c: numeric[c].pct_change().mean())
        notes.append(
            f"{dataset_name}: '{top}' is declining — "
            f"current value near {round(numeric[top].iloc[-1], 2)} "
            f"vs mean {round(numeric[top].mean(), 2)}"
        )

    # Highlight 2: highest-variance column (instability signal)
    if len(numeric.columns) > 0:
        cv_scores = {
            col: (numeric[col].std() / abs(numeric[col].mean()))
            for col in numeric.columns
            if numeric[col].mean() != 0
        }
        if cv_scores:
            volatile_col = max(cv_scores, key=cv_scores.get)
            cv = round(cv_scores[volatile_col] * 100, 1)
            notes.append(
                f"{dataset_name}: '{volatile_col}' is the most variable metric "
                f"(coefficient of variation {cv}%)"
            )

    return notes[:3]


def _nl_summary(df: pd.DataFrame, dataset_name: str, stats: dict) -> str:
    """
    One-sentence natural language summary of the dataset's headline figure.
    """
    numeric = df.select_dtypes(include="number")
    if numeric.empty:
        return f"The {dataset_name} dataset has no numeric columns."

    # pick the column whose name contains a signal keyword, else first column
    keywords = ["rate", "index", "score", "total", "count", "pct", "ratio", "percent"]
    chosen = next(
        (c for kw in keywords for c in numeric.columns if kw.lower() in c.lower()),
        numeric.columns[0]
    )
    s = stats.get(chosen, {})
    trend = s.get("trend", "stable")
    mean  = s.get("mean",  "N/A")
    return (
        f"The {dataset_name} dataset spans {len(df)} records; "
        f"'{chosen}' is {trend} with a mean of {mean}."
    )


# ──────────────────────────── MAIN ENTRY POINT ───────────────────────────────

def extract_dashboard(name: str, df: pd.DataFrame) -> Dict[str, Any]:
    """
    Build a full structured extract for one dataset.

    Parameters
    ----------
    name : str
        Dataset label ("economy", "healthcare", etc.)
    df   : pd.DataFrame
        The raw loaded dataframe (may be empty if CSV is missing).

    Returns
    -------
    Dict with keys:
        dataset, rows, columns, stats, anomalies, highlights, nl_summary
    """
    if df.empty:
        return {
            "dataset":    name,
            "rows":       0,
            "columns":    [],
            "stats":      {},
            "anomalies":  {},
            "highlights": [f"{name}: dataset not available"],
            "nl_summary": f"The {name} dataset is missing.",
        }

    numeric = df.select_dtypes(include="number")
    col_stats = {col: _column_stats(numeric[col]) for col in numeric.columns}

    return {
        "dataset":    name,
        "rows":       len(df),
        "columns":    list(df.columns),
        "stats":      col_stats,
        "anomalies":  _detect_anomalies(df),
        "highlights": _highlights(df, name),
        "nl_summary": _nl_summary(df, name, col_stats),
    }


def build_chart_extracts(town_data: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
    """
    Run extract_dashboard over all six datasets and return a unified dict.
    Called once per pipeline run; output is stored in GraphState.
    """
    return {name: extract_dashboard(name, df) for name, df in town_data.items()}
