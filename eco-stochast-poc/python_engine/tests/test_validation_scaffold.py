from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validation.scaffold import (
    ALERT_SCORE,
    build_synthetic_presence_only_dataset,
    build_validation_report,
    compare_against_a25,
    missed_event_rate,
    rainfall_event_backtest_windows,
    temporal_train_test_split,
)


class ValidationScaffoldTests(unittest.TestCase):
    def test_temporal_split_uses_year_cutoff_and_warns_against_random_split(self) -> None:
        examples, _ = build_synthetic_presence_only_dataset(seed=11, days=800)

        split = temporal_train_test_split(examples, test_start_year=2027)

        self.assertTrue(all(example.day.year < 2027 for example in split.train))
        self.assertTrue(all(example.day.year >= 2027 for example in split.test))
        self.assertIn("random split is prohibited", split.warning)

    def test_report_contains_required_metrics_and_omits_naive_accuracy(self) -> None:
        examples, a25_records = build_synthetic_presence_only_dataset(seed=7, days=900)
        labels = {example.day: example.observed_label for example in examples}
        windows = rainfall_event_backtest_windows(a25_records, labels)

        report = build_validation_report(examples, windows)
        metrics = report["metrics"]

        self.assertIn("precision", metrics)
        self.assertIn("recall", metrics)
        self.assertIn("pr_auc", metrics)
        self.assertIn("brier_score", metrics)
        self.assertIn("calibration_curve", metrics)
        self.assertIn("lead_time_days", metrics)
        self.assertIn("false_alarm_rate", metrics)
        self.assertIn("missed_event_rate", metrics)
        self.assertIn("alert_thresholds", metrics)
        self.assertIn("uncertainty_coverage", metrics)
        self.assertNotIn("accuracy", metrics)
        self.assertIn("a25_baseline", report["a25_comparison"])

    def test_a25_comparison_declares_claim_bar(self) -> None:
        examples, _ = build_synthetic_presence_only_dataset(seed=5, days=500)

        comparison = compare_against_a25(examples)

        self.assertIn("beat_a25", comparison)
        self.assertIn("Tier 0 A25", comparison["claim_bar"])

    def test_event_windows_are_backtesting_units(self) -> None:
        examples, a25_records = build_synthetic_presence_only_dataset(seed=7, days=900)
        labels = {example.day: example.observed_label for example in examples}

        windows = rainfall_event_backtest_windows(a25_records, labels, event_threshold_mm=200.0)

        self.assertTrue(all(window.start_day <= window.end_day for window in windows))
        self.assertTrue(all(window.peak_a25_mm >= 200.0 for window in windows))

    def test_missed_event_rate_counts_observed_events_only(self) -> None:
        examples, _ = build_synthetic_presence_only_dataset(seed=7, days=900)
        rate = missed_event_rate(examples, threshold=ALERT_SCORE["HIGH"])

        self.assertGreaterEqual(rate, 0.0)
        self.assertLessEqual(rate, 1.0)


if __name__ == "__main__":
    unittest.main()

