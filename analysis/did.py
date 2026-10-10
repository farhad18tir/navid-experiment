#!/usr/bin/env python3
"""Clustered difference-in-differences and a 2x2 mixed ANOVA.

School gender is not entered: with school fixed effects it is not separately
identified. Area-above-median and the weighted asset index are omitted until a
regional median and weights are configured. Parent education is the ordered
code from 1 to 9. Mediation is not estimated.
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats

OUTCOMES = {
    "inhibition_cost": "ms",
    "d_prime": "d-prime",
    "switch_cost": "ms",
    "panas_positive": "score",
    "panas_negative": "score",
}

CONTROLS = [
    "age_years",
    "recent_gpa",
    "sibling_count",
    "father_education",
    "mother_education",
    "home_book_count",
    "monthly_income_per_capita",
    "home_ownership",
    "appliance_gt6",
]

CODING = {
    "treatment": "scarcity=1, control=0",
    "post": "post=1, pre=0",
    "father_education": "ordered code 1-9",
    "mother_education": "ordered code 1-9",
    "home_ownership": "owner=1, renter=0",
    "appliance_gt6": "1 if more than six listed appliances, else 0",
    "school_id": "fixed effects",
    "school_gender": "not entered; collinear with school fixed effects",
    "area_above_regional_median": "omitted; regional median is not configured",
    "asset_index": "omitted; component weights are not configured",
}

QUERY = """
SELECT s.participant_id, s.id AS session_id, p.school_id, sc.gender AS school_gender,
       CASE p.group_name WHEN 'scarcity' THEN 1 ELSE 0 END AS treatment,
       CASE s.measurement_period WHEN 'post' THEN 1 ELSE 0 END AS post,
       d.age_years, d.recent_gpa, d.sibling_count, d.father_education, d.mother_education,
       d.home_book_count, d.monthly_income_per_capita, d.home_ownership,
       d.appliance_gt6, d.area_above_regional_median, d.asset_index,
       scs.inhibition_cost, scs.inhibition_excluded, scs.d_prime, scs.switch_cost,
       scs.panas_positive, scs.panas_negative, scs.manipulation_mean
FROM sessions s
JOIN participants p ON p.id = s.participant_id
JOIN schools sc ON sc.id = p.school_id
LEFT JOIN demographics d ON d.participant_id = p.id
LEFT JOIN session_scores scs ON scs.session_id = s.id
"""


def load_frame(db_path: Path) -> pd.DataFrame:
    with sqlite3.connect(db_path) as connection:
        frame = pd.read_sql_query(QUERY, connection)
    if "inhibition_excluded" in frame.columns:
        frame.loc[frame["inhibition_excluded"] == 1, "inhibition_cost"] = np.nan
    return frame


def analyze(frame: pd.DataFrame) -> dict:
    exclusions = base_exclusions(frame)
    kept = frame.loc[~frame.index.isin([item["index"] for item in exclusions])].copy()
    outcomes = {name: fit_outcome(kept, name, exclusions) for name in OUTCOMES}
    return {
        "coding": CODING,
        "schoolGender": "School gender is not separately identified because school fixed effects are included.",
        "mediation": "not estimated; the proposal does not name an estimator",
        "exclusions": exclusions,
        "outcomes": outcomes,
    }


def base_exclusions(frame: pd.DataFrame) -> list[dict]:
    reasons: list[dict] = []
    duplicated = frame.duplicated(["participant_id", "post"], keep=False)
    for index in frame.index[duplicated]:
        reasons.append(record(frame.loc[index], "duplicate person-period"))
    grouped = frame.groupby("participant_id")["treatment"].nunique()
    changed = set(grouped[grouped > 1].index)
    pre_ids = set(frame.loc[frame["post"] == 0, "participant_id"])
    for index, row in frame.iterrows():
        if row["participant_id"] in changed:
            reasons.append(record(row, "group changed across waves", index))
        elif row["post"] == 1 and row["participant_id"] not in pre_ids:
            reasons.append(record(row, "no real baseline", index))
    return reasons


def fit_outcome(frame: pd.DataFrame, outcome: str, shared: list[dict]) -> dict:
    local: list[dict] = []
    usable = frame.dropna(subset=[outcome]).copy()
    missing = frame.index.difference(usable.index)
    for index in missing:
        local.append(record(frame.loc[index], "missing outcome", index))
    for column in CONTROLS:
        before = usable.index
        usable = usable.dropna(subset=[column])
        for index in before.difference(usable.index):
            local.append(record(frame.loc[index], f"missing control {column}", index))
    result = {
        "outcome": outcome,
        "unit": OUTCOMES[outcome],
        "formula": f"{outcome} ~ treatment * post + {' + '.join(CONTROLS)} + C(school_id)",
        "excluded": local,
        "sharedExclusions": [item["reason"] for item in shared],
    }
    if usable.empty or usable["treatment"].nunique() < 2 or usable["post"].nunique() < 2:
        result["status"] = "not-run"
        result["reason"] = "both groups and both waves with complete controls are required"
        result["mixedAnova"] = {"status": "not-run"}
        return result
    formula = result["formula"]
    point = smf.ols(formula, data=usable).fit()
    term = "treatment:post"
    if term not in point.params.index:
        result["status"] = "not-identified"
        result["reason"] = "the treatment by post coefficient is collinear with the other terms"
        result["mixedAnova"] = mixed_anova(frame, outcome)
        return result
    clustered = None
    cluster_error = None
    if usable["school_id"].nunique() >= 2:
        try:
            clustered = smf.ols(formula, data=usable).fit(
                cov_type="cluster",
                cov_kwds={"groups": usable["school_id"]},
            )
        except Exception as error:  # statsmodels raises when the cluster covariance is singular
            cluster_error = str(error)
    else:
        cluster_error = "fewer than 2 schools"
    used = clustered if clustered is not None and term in clustered.params.index else None
    coefficient = float(point.params[term])
    if not np.isfinite(coefficient):
        result["status"] = "not-identified"
        result["reason"] = "the treatment by post coefficient is not uniquely determined"
        result["mixedAnova"] = mixed_anova(frame.dropna(subset=[outcome]), outcome)
        return result
    standard_error = None if used is None else float(used.bse[term])
    p_value = None if used is None else float(used.pvalues[term])
    confidence = None
    if standard_error is None or p_value is None or not np.isfinite(standard_error) or not np.isfinite(p_value):
        if used is not None:
            cluster_error = cluster_error or "clustered standard error is not finite"
        standard_error = None
        p_value = None
    elif used is not None:
        lower, upper = used.conf_int().loc[term]
        confidence = [float(lower), float(upper)]
    result.update(
        {
            "status": "fit",
            "participants": int(usable["participant_id"].nunique()),
            "rows": int(len(usable)),
            "schools": int(usable["school_id"].nunique()),
            "coefficientTreatmentPost": coefficient,
            "standardError": standard_error,
            "pValue": p_value,
            "confidenceInterval": confidence,
            "cluster": "school" if standard_error is not None else None,
            "clusterError": cluster_error,
            "rank": int(point.df_model + 1),
            "residualDf": float(point.df_resid),
        }
    )
    result["mixedAnova"] = mixed_anova(frame.dropna(subset=[outcome]), outcome)
    return result


def mixed_anova(frame: pd.DataFrame, outcome: str) -> dict:
    counts = frame.groupby("participant_id")["post"].nunique()
    complete_ids = counts[counts == 2].index
    sub = frame[frame["participant_id"].isin(complete_ids)]
    if sub["treatment"].nunique() < 2 or sub.empty:
        return {"status": "not-run", "reason": "complete pairs from both groups are required"}
    table = anova_table(sub, outcome)
    return {"status": "fit", "factors": table, "note": "unadjusted group by time mixed ANOVA"}


def anova_table(frame: pd.DataFrame, outcome: str) -> list[dict]:
    groups = sorted(frame["treatment"].unique())
    grand = float(frame[outcome].mean())
    subject = frame.groupby(["treatment", "participant_id"])[outcome].mean()
    cell = frame.groupby(["treatment", "post"])[outcome].mean()
    group_mean = frame.groupby("treatment")[outcome].mean()
    time_mean = frame.groupby("post")[outcome].mean()
    n_group = frame.groupby("treatment")["participant_id"].nunique()
    n_subjects = int(frame["participant_id"].nunique())
    ss_a = float(sum(n_group[group] * 2 * (group_mean[group] - grand) ** 2 for group in groups))
    ss_sa = 0.0
    ss_error = 0.0
    for (group, person), mean_person in subject.items():
        ss_sa += 2 * (mean_person - group_mean[group]) ** 2
        person_rows = frame[(frame["participant_id"] == person)]
        for _, row in person_rows.iterrows():
            expected = mean_person + cell.loc[(group, row["post"])] - group_mean[group]
            ss_error += (row[outcome] - expected) ** 2
    ss_b = float(sum(n_subjects * (time_mean[time] - grand) ** 2 for time in time_mean.index))
    ss_ab = 0.0
    for group in groups:
        for time in time_mean.index:
            ss_ab += n_group[group] * (cell.loc[(group, time)] - group_mean[group] - time_mean[time] + grand) ** 2
    rows = []
    df_sa = n_subjects - len(groups)
    df_error = n_subjects - len(groups)
    specs = [
        ("group", ss_a, len(groups) - 1, ss_sa, df_sa),
        ("time", ss_b, 1, ss_error, df_error),
        ("group_x_time", ss_ab, 1, ss_error, df_error),
    ]
    for name, ss, df, ss_err, df_err in specs:
        ms = ss / df if df else np.nan
        ms_err = ss_err / df_err if df_err else np.nan
        f_value = ms / ms_err if ms_err else np.nan
        p_value = float(stats.f.sf(f_value, df, df_err)) if df_err and np.isfinite(f_value) else None
        rows.append({"factor": name, "sumOfSquares": ss, "df": df, "F": None if not np.isfinite(f_value) else float(f_value), "p": p_value})
    return rows


def record(row: pd.Series, reason: str, index: object | None = None) -> dict:
    return {
        "index": int(index if index is not None else row.name),
        "participantId": row["participant_id"],
        "sessionId": row.get("session_id"),
        "reason": reason,
    }


def self_test() -> None:
    rng = random.Random(1)
    rows = []
    for school in (1, 2):
        for person in range(12):
            participant = f"s{school}p{person}"
            treatment = 1 if person % 2 == 0 else 0
            covariates = {
                "age_years": rng.choice([13, 14, 15]),
                "recent_gpa": round(rng.uniform(11, 19), 2),
                "sibling_count": rng.randrange(0, 5),
                "father_education": rng.randrange(1, 10),
                "mother_education": rng.randrange(1, 10),
                "home_book_count": rng.randrange(0, 80),
                "monthly_income_per_capita": rng.randrange(400, 4000),
                "home_ownership": rng.randrange(0, 2),
                "appliance_gt6": rng.randrange(0, 2),
            }
            for post in (0, 1):
                rows.append(
                    {
                        "participant_id": participant,
                        "session_id": f"{participant}-{post}",
                        "school_id": f"school-{school}",
                        "school_gender": "girls",
                        "treatment": treatment,
                        "post": post,
                        **covariates,
                        "area_above_regional_median": None,
                        "asset_index": None,
                        "inhibition_cost": 2 + (0.3 if school == 2 else 0) + 0.8 * treatment * post,
                        "inhibition_excluded": 0,
                        "d_prime": 1,
                        "switch_cost": 20,
                        "panas_positive": 15,
                        "panas_negative": 10,
                        "manipulation_mean": 4,
                    }
                )
    rows.append({**rows[0], "participant_id": "only-post", "session_id": "only-post", "post": 1, "treatment": 1})
    rows.append({**rows[1], "participant_id": "missing-gpa", "session_id": "missing-gpa-pre", "recent_gpa": None, "post": 0})
    rows.append({**rows[1], "participant_id": "missing-gpa", "session_id": "missing-gpa-post", "recent_gpa": None, "post": 1})
    report = analyze(pd.DataFrame(rows))
    reasons = {item["reason"] for item in report["exclusions"]}
    if "no real baseline" not in reasons:
        raise SystemExit("self-test did not exclude a post-only participant")
    fit = report["outcomes"]["inhibition_cost"]
    if abs(fit["coefficientTreatmentPost"] - 0.8) > 0.05:
        raise SystemExit(f"self-test interaction was {fit['coefficientTreatmentPost']}")
    if fit["standardError"] is None or not np.isfinite(fit["standardError"]):
        raise SystemExit(f"self-test did not return a finite clustered standard error: {fit}")
    anova = fit["mixedAnova"]
    interaction = next(item for item in anova["factors"] if item["factor"] == "group_x_time")
    if interaction["p"] is None or interaction["p"] > 0.05:
        raise SystemExit(f"self-test mixed ANOVA interaction was {interaction}")
    print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/experiment.sqlite")
    parser.add_argument("--out", default="analysis/output/did-report.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    report = analyze(load_frame(Path(args.db)))
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
