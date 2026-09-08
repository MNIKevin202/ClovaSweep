//! Analytics aggregation.
//!
//! All metrics are derived from the persisted sweep history — we never invent
//! numbers. App identity is taken from the stable sweep-result id, so the
//! same application is never double-counted because a path or process
//! changed.
//!
//! Pure module — fully unit-testable.

use crate::types::{AnalyticsSummary, AppCloseStat, SweepAppOutcome, SweepRecord};
use std::collections::HashMap;

pub struct AggregateOptions {
    pub top_n: usize,
    pub recent_n: usize,
}

impl Default for AggregateOptions {
    fn default() -> Self {
        AggregateOptions { top_n: 5, recent_n: 10 }
    }
}

/// Aggregate a list of sweep records (any order) into a summary. Dry-run
/// records are excluded from all statistics.
pub fn aggregate_analytics(records: &[SweepRecord], opts: AggregateOptions) -> AnalyticsSummary {
    let real: Vec<&SweepRecord> = records.iter().filter(|r| !r.dry_run).collect();
    let mut sorted = real.clone();
    sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let total_sweeps = real.len();
    let mut total_apps_closed = 0usize;
    let mut per_app: HashMap<String, AppCloseStat> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for rec in &real {
        for res in &rec.results {
            if res.outcome != SweepAppOutcome::Closed {
                continue;
            }
            total_apps_closed += 1;
            match per_app.get_mut(&res.id) {
                Some(stat) => {
                    stat.count += 1;
                    if stat.name.is_empty() && !res.name.is_empty() {
                        stat.name = res.name.clone();
                    }
                }
                None => {
                    per_app.insert(
                        res.id.clone(),
                        AppCloseStat { id: res.id.clone(), name: if res.name.is_empty() { res.id.clone() } else { res.name.clone() }, count: 1 },
                    );
                    order.push(res.id.clone());
                }
            }
        }
    }

    let mut most_closed: Vec<AppCloseStat> = order.iter().filter_map(|id| per_app.get(id).cloned()).collect();
    most_closed.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    most_closed.truncate(opts.top_n);

    let average_per_sweep = if total_sweeps == 0 { 0.0 } else { total_apps_closed as f64 / total_sweeps as f64 };
    let average_per_sweep = (average_per_sweep * 10.0).round() / 10.0;

    let last = sorted.first();

    AnalyticsSummary {
        total_sweeps,
        total_apps_closed,
        average_per_sweep,
        unique_apps_closed: per_app.len(),
        most_closed,
        last_sweep_at: last.map(|r| r.timestamp.clone()),
        last_sweep_closed: last.map(|r| r.closed_count),
        estimated_clutter_reduced: total_apps_closed,
        recent: sorted.into_iter().take(opts.recent_n).cloned().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SweepAppResult;

    fn rec(id: &str, ts: &str, closed_count: usize, dry_run: bool, results: Vec<SweepAppResult>) -> SweepRecord {
        SweepRecord { id: id.into(), timestamp: ts.into(), duration_ms: 100, closed_count, results, dry_run }
    }
    fn res(id: &str, name: &str, outcome: SweepAppOutcome) -> SweepAppResult {
        SweepAppResult { id: id.into(), name: name.into(), bundle_id: None, path: None, outcome, detail: None }
    }

    #[test]
    fn zeroed_summary_for_no_records() {
        let s = aggregate_analytics(&[], AggregateOptions::default());
        assert_eq!(s.total_sweeps, 0);
        assert_eq!(s.total_apps_closed, 0);
        assert_eq!(s.average_per_sweep, 0.0);
        assert_eq!(s.unique_apps_closed, 0);
        assert!(s.most_closed.is_empty());
        assert!(s.last_sweep_at.is_none());
    }

    #[test]
    fn counts_closed_apps_and_averages() {
        let records = vec![
            rec("1", "2026-01-01T10:00:00Z", 2, false, vec![
                res("bundle:a", "A", SweepAppOutcome::Closed),
                res("bundle:b", "B", SweepAppOutcome::Closed),
            ]),
            rec("2", "2026-01-02T10:00:00Z", 1, false, vec![
                res("bundle:a", "A", SweepAppOutcome::Closed),
                res("bundle:c", "C", SweepAppOutcome::Failed),
            ]),
        ];
        let s = aggregate_analytics(&records, AggregateOptions::default());
        assert_eq!(s.total_sweeps, 2);
        assert_eq!(s.total_apps_closed, 3);
        assert_eq!(s.average_per_sweep, 1.5);
        assert_eq!(s.unique_apps_closed, 2);
        assert_eq!(s.most_closed[0].id, "bundle:a");
        assert_eq!(s.most_closed[0].count, 2);
        assert_eq!(s.estimated_clutter_reduced, 3);
    }

    #[test]
    fn does_not_double_count_same_app_across_sweeps() {
        let records = vec![
            rec("1", "t1", 1, false, vec![res("bundle:x", "X", SweepAppOutcome::Closed)]),
            rec("2", "t2", 1, false, vec![res("bundle:x", "X", SweepAppOutcome::Closed)]),
            rec("3", "t3", 1, false, vec![res("bundle:x", "X", SweepAppOutcome::Closed)]),
        ];
        let s = aggregate_analytics(&records, AggregateOptions::default());
        assert_eq!(s.unique_apps_closed, 1);
        assert_eq!(s.most_closed[0].count, 3);
    }

    #[test]
    fn excludes_dry_runs() {
        let records = vec![
            rec("1", "t1", 5, true, vec![res("bundle:a", "A", SweepAppOutcome::Closed)]),
            rec("2", "t2", 1, false, vec![res("bundle:b", "B", SweepAppOutcome::Closed)]),
        ];
        let s = aggregate_analytics(&records, AggregateOptions::default());
        assert_eq!(s.total_sweeps, 1);
        assert_eq!(s.total_apps_closed, 1);
        assert_eq!(s.most_closed[0].id, "bundle:b");
    }

    #[test]
    fn reports_most_recent_sweep_first() {
        let records = vec![
            rec("old", "2026-01-01T00:00:00Z", 1, false, vec![]),
            rec("new", "2026-03-01T00:00:00Z", 4, false, vec![]),
        ];
        let s = aggregate_analytics(&records, AggregateOptions::default());
        assert_eq!(s.last_sweep_at.as_deref(), Some("2026-03-01T00:00:00Z"));
        assert_eq!(s.last_sweep_closed, Some(4));
        assert_eq!(s.recent[0].id, "new");
    }
}
