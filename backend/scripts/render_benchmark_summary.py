from __future__ import annotations

import argparse
import json
from pathlib import Path


def _format_float(value: float) -> str:
    return f"{value:.6f}" if not value.is_integer() else f"{value:.0f}"


def build_summary(report_path: Path) -> list[str]:
    payload = json.loads(report_path.read_text())
    benchmarks = payload.get("benchmarks", [])

    lines: list[str] = []
    lines.append("| Benchmark | Mean (ms) | Median (ms) | Ops/s | Rounds |")
    lines.append("| --- | --- | --- | --- | --- |")

    for bench in benchmarks:
        stats = bench.get("stats", {})
        lines.append(
            "| {name} | {mean:.3f} | {median:.3f} | {ops:.1f} | {rounds} |".format(
                name=bench.get("name", "unknown"),
                mean=float(stats.get("mean", 0.0)) * 1000,
                median=float(stats.get("median", 0.0)) * 1000,
                ops=float(stats.get("ops", 0.0)),
                rounds=int(stats.get("rounds", 0)),
            )
        )

    for bench in benchmarks:
        extra = bench.get("extra_info") or {}
        if not extra:
            continue
        lines.append("")
        lines.append(f"### {bench.get('name', 'extra')}".rstrip())
        for key in sorted(extra):
            value = extra[key]
            if isinstance(value, float):
                lines.append(f"- **{key}**: {_format_float(value)}")
            else:
                lines.append(f"- **{key}**: {value}")

    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Render benchmark report summary")
    parser.add_argument("--report", required=True, help="Path to benchmark JSON report")
    parser.add_argument("--output", required=True, help="Path to write Markdown summary")
    args = parser.parse_args()

    report_path = Path(args.report)
    output_path = Path(args.output)

    lines = build_summary(report_path)
    content = "\n".join(lines) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content)
    print(content, end="")


if __name__ == "__main__":
    main()
