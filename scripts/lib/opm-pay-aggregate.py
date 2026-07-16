#!/usr/bin/env python3
"""Aggregate OPM Federal Workforce Data without retaining employee-level output."""

import json
import sys
from collections import defaultdict

try:
    import pandas as pd
    import pyarrow.parquet as pq
except ImportError as exc:
    raise SystemExit("This report requires Python packages pandas and pyarrow.") from exc


if len(sys.argv) != 2:
    raise SystemExit("Usage: opm-pay-aggregate.py employment.parquet")

dimensions = {
    "occupations": "occupational_series",
    "agencies": "agency",
    "states": "duty_station_state",
    "cities": "duty_station_city",
}
columns = ["annualized_adjusted_basic_pay", "count", *dimensions.values()]
groups = {key: defaultdict(lambda: [0.0, 0]) for key in dimensions}
ranges = {
    "Under $50,000": 0,
    "$50,000-$74,999": 0,
    "$75,000-$99,999": 0,
    "$100,000-$149,999": 0,
    "$150,000-$199,999": 0,
    "$200,000 and above": 0,
}
total_count = 0
published_count = 0
published_payroll = 0.0


def add_group(target, name, payroll, count):
    if not name or name == "REDACTED":
        return
    slot = target[str(name)]
    slot[0] += float(payroll)
    slot[1] += int(count)


parquet = pq.ParquetFile(sys.argv[1])
for batch in parquet.iter_batches(columns=columns, batch_size=100_000):
    frame = batch.to_pandas()
    frame["count_num"] = pd.to_numeric(frame["count"], errors="coerce").fillna(0)
    total_count += int(frame["count_num"].sum())
    frame["pay"] = pd.to_numeric(frame["annualized_adjusted_basic_pay"], errors="coerce")
    valid = frame[(frame["pay"] > 0) & (frame["count_num"] > 0)].copy()
    if valid.empty:
        continue
    valid["payroll"] = valid["pay"] * valid["count_num"]
    batch_count = int(valid["count_num"].sum())
    published_count += batch_count
    published_payroll += float(valid["payroll"].sum())

    for key, column in dimensions.items():
        summary = valid.groupby(column, dropna=True).agg(
            payroll=("payroll", "sum"), employees=("count_num", "sum")
        )
        for name, row in summary.iterrows():
            add_group(groups[key], name, row["payroll"], row["employees"])

    range_counts = [
        (valid["pay"] < 50_000),
        ((valid["pay"] >= 50_000) & (valid["pay"] < 75_000)),
        ((valid["pay"] >= 75_000) & (valid["pay"] < 100_000)),
        ((valid["pay"] >= 100_000) & (valid["pay"] < 150_000)),
        ((valid["pay"] >= 150_000) & (valid["pay"] < 200_000)),
        (valid["pay"] >= 200_000),
    ]
    for label, mask in zip(ranges, range_counts):
        ranges[label] += int(valid.loc[mask, "count_num"].sum())


def serialize(group):
    return [
        {"name": name, "employees": count, "average_salary": payroll / count}
        for name, (payroll, count) in group.items()
        if count
    ]


output = {
    "total_employees": total_count,
    "published_salary_employees": published_count,
    "published_average_salary": published_payroll / published_count if published_count else None,
    **{key: serialize(value) for key, value in groups.items()},
    "ranges": [{"name": name, "employees": count} for name, count in ranges.items()],
}
json.dump(output, sys.stdout, separators=(",", ":"))
