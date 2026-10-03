import React, { useState } from 'react';

const chart = { width: 720, height: 250, left: 48, right: 16, top: 20, bottom: 34 };

const average = (items, key) => items.length
  ? (items.reduce((total, item) => total + Number(item[key] || 0), 0) / items.length).toFixed(1)
  : '—';

const getPoint = (item, index, count, key) => {
  const innerWidth = chart.width - chart.left - chart.right;
  const innerHeight = chart.height - chart.top - chart.bottom;
  const score = Math.min(10, Math.max(1, Number(item[key]) || 1));
  return {
    x: count === 1 ? chart.left + innerWidth / 2 : chart.left + (index / (count - 1)) * innerWidth,
    y: chart.top + ((10 - score) / 9) * innerHeight,
    score,
    item
  };
};

export default function MoodTrendDashboard({ checkIns, loading, error, onCheckIn }) {
  const [rangeDays, setRangeDays] = useState(30);
  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const visibleCheckIns = checkIns.filter(item => new Date(item.date).getTime() >= cutoff);
  const moodPoints = visibleCheckIns.map((item, index) => getPoint(item, index, visibleCheckIns.length, 'moodScore'));
  const anxietyPoints = visibleCheckIns.map((item, index) => getPoint(item, index, visibleCheckIns.length, 'anxietyLevel'));
  const chartPath = points => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const dateLabel = date => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return <div className="dash-section mood-trend-dashboard">
    <section className="panel panel-pad">
      <div className="panel-head mood-trend-heading">
        <div><h2 className="panel-title">Your mood over time</h2><p className="panel-caption">A personal view of the check-ins you’ve recorded. It is not a diagnosis.</p></div>
        <div className="mood-range-control" role="group" aria-label="Mood trend date range">
          {[7, 30, 90].map(days => <button key={days} type="button" className={rangeDays === days ? 'is-active' : ''} aria-pressed={rangeDays === days} onClick={() => setRangeDays(days)}>{days} days</button>)}
        </div>
      </div>

      <div className="mood-summary-grid">
        <div className="mood-summary mood-summary-positive"><span>Average mood</span><strong>{average(visibleCheckIns, 'moodScore')}<small>/10</small></strong></div>
        <div className="mood-summary mood-summary-anxiety"><span>Average anxiety</span><strong>{average(visibleCheckIns, 'anxietyLevel')}<small>/10</small></strong></div>
        <div className="mood-summary mood-summary-sleep"><span>Average sleep</span><strong>{average(visibleCheckIns, 'sleepHours')}<small>hrs</small></strong></div>
        <div className="mood-summary mood-summary-count"><span>Check-ins</span><strong>{visibleCheckIns.length}<small>entries</small></strong></div>
      </div>

      {loading ? <div className="empty-state" role="status">Loading your check-in history…</div>
        : error ? <div className="auth-error" role="alert">{error}</div>
          : visibleCheckIns.length === 0 ? <div className="mood-empty-state"><p>No check-ins in this period yet.</p><span>Your trend will appear as you record how you’re feeling.</span><button className="action-button" type="button" onClick={onCheckIn}>Add a check-in</button></div>
            : <div className="mood-chart-wrap">
              <svg className="mood-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Mood and anxiety trend over the last ${rangeDays} days`}>
                {[1, 3, 5, 7, 10].map(score => {
                  const y = chart.top + ((10 - score) / 9) * (chart.height - chart.top - chart.bottom);
                  return <g key={score}><line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="mood-chart-gridline" /><text x={chart.left - 12} y={y + 4} className="mood-chart-axis-label" textAnchor="end">{score}</text></g>;
                })}
                {moodPoints.length > 1 && <path d={chartPath(moodPoints)} className="mood-chart-line mood-chart-line-mood" />}
                {anxietyPoints.length > 1 && <path d={chartPath(anxietyPoints)} className="mood-chart-line mood-chart-line-anxiety" />}
                {moodPoints.map((point, index) => <circle key={`mood-${index}`} cx={point.x} cy={point.y} r="4" className="mood-chart-point mood-chart-point-mood"><title>{`Mood ${point.score}/10 on ${dateLabel(point.item.date)}`}</title></circle>)}
                {anxietyPoints.map((point, index) => <circle key={`anxiety-${index}`} cx={point.x} cy={point.y} r="4" className="mood-chart-point mood-chart-point-anxiety"><title>{`Anxiety ${point.score}/10 on ${dateLabel(point.item.date)}`}</title></circle>)}
                {visibleCheckIns.length < 5 ? visibleCheckIns.map((item, index) => {
                  const x = getPoint(item, index, visibleCheckIns.length, 'moodScore').x;
                  return <text key={`date-${index}`} x={x} y={chart.height - 9} className="mood-chart-axis-label" textAnchor="middle">{dateLabel(item.date)}</text>;
                }) : [0, Math.floor((visibleCheckIns.length - 1) / 2), visibleCheckIns.length - 1].map(index => {
                  const x = getPoint(visibleCheckIns[index], index, visibleCheckIns.length, 'moodScore').x;
                  return <text key={`date-${index}`} x={x} y={chart.height - 9} className="mood-chart-axis-label" textAnchor="middle">{dateLabel(visibleCheckIns[index].date)}</text>;
                })}
              </svg>
              <div className="mood-chart-legend"><span><i className="mood-legend-dot mood-legend-mood" />Mood</span><span><i className="mood-legend-dot mood-legend-anxiety" />Anxiety</span><small>Higher mood scores are better; higher anxiety scores mean more anxiety.</small></div>
            </div>}
    </section>
  </div>;
}