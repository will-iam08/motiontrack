import { useEffect, useRef, useState } from 'react';
import { useWidth } from '../hooks/useWidth.js';
import { bpmCheck, bpmRangeLabel, hasBpmTarget } from '../lib/carePlan.js';
import { formatDateTime, formatDurationWords } from '../lib/format.js';
import { formatDateKey } from '../lib/progress.js';

function niceStep(range, targetTicks, steps) {
  const rough = range / targetTicks;
  return steps.find(step => step >= rough) ?? steps[steps.length - 1];
}

const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 1000000];
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

function fitTooltipLine(line, maxChars) {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, Math.max(1, maxChars - 1))}…`;
}

function Tooltip({ x, y, width, lines }) {
  const maxBoxWidth = Math.max(120, width - 4);
  const maxChars = Math.max(12, Math.floor((maxBoxWidth - 20) / 8.4));
  const fittedLines = lines.map(line => fitTooltipLine(line, maxChars));
  const boxWidth = Math.min(maxBoxWidth, Math.max(...fittedLines.map(line => line.length)) * 8.4 + 20);
  const boxHeight = fittedLines.length * 20 + 12;
  const left = Math.max(2, Math.min(x - boxWidth / 2, width - boxWidth - 2));
  const top = Math.max(y - boxHeight - 12, 2);
  return (
    <g pointerEvents="none" className="chart-tip">
      <rect className="chart-tip-box" x={left} y={top} width={boxWidth} height={boxHeight} rx="6" />
      {fittedLines.map((line, index) => (
        <text key={`${index}-${line}`} className={index === 0 ? 'chart-tip-strong' : 'chart-tip-text'} x={left + 10} y={top + 22 + index * 20}>{line}</text>
      ))}
    </g>
  );
}

function metricValue(metric, value) {
  return metric === 'duration_seconds' ? formatDurationWords(value) : String(value);
}

function adjacentFocusIndex(index, key, isInteractive, length) {
  if (key === 'ArrowRight') {
    for (let i = index + 1; i < length; i += 1) if (isInteractive(i)) return i;
    return null;
  }
  if (key === 'ArrowLeft') {
    for (let i = index - 1; i >= 0; i -= 1) if (isInteractive(i)) return i;
    return null;
  }
  if (key === 'Home') {
    for (let i = 0; i < length; i += 1) if (isInteractive(i)) return i;
    return null;
  }
  if (key === 'End') {
    for (let i = length - 1; i >= 0; i -= 1) if (isInteractive(i)) return i;
    return null;
  }
  return null;
}

function interactiveProps({ index, active, setActive, ariaLabel, itemRefs, isInteractive, length }) {
  const toggle = () => setActive(prev => (prev === index ? null : index));
  return {
    ref: el => { itemRefs.current[index] = el; },
    className: 'chart-bar-wrap',
    tabIndex: 0,
    role: 'button',
    'aria-label': ariaLabel,
    'aria-pressed': active === index,
    onPointerEnter: () => setActive(index),
    onFocus: () => setActive(index),
    onBlur: () => setActive(prev => (prev === index ? null : prev)),
    onClick: toggle,
    onKeyDown: event => {
      if (event.key === 'Escape') {
        setActive(null);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      } else {
        const nextIndex = adjacentFocusIndex(index, event.key, isInteractive, length);
        if (nextIndex !== null) {
          event.preventDefault();
          itemRefs.current[nextIndex]?.focus();
        }
      }
    },
  };
}

// One bar per day (or month) for the chosen progress measure.
export function ProgressBarChart({ buckets, metric, metricLabel }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    setActive(null);
  }, [buckets, metric]);

  if (!buckets?.length) return null;

  const height = 280;
  const margin = { top: 28, right: 12, bottom: 36, left: width < 360 ? 44 : 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  // Time is charted in minutes so the axis has clean numbers.
  const scaled = buckets.map(bucket => (metric === 'duration_seconds' ? bucket[metric] / 60 : bucket[metric]));
  const max = Math.max(1, ...scaled);
  const step = niceStep(max, 4, metric === 'duration_seconds' ? [0.5, ...COUNT_STEPS] : COUNT_STEPS);
  const top = Math.ceil(max / step) * step;
  const band = plotW / buckets.length;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = value => margin.top + plotH - (value / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 70))));
  const ticks = [];
  for (let tick = 0; tick <= top + step / 1000; tick += step) ticks.push(tick);
  const peak = scaled.indexOf(Math.max(...scaled));
  const unit = metric === 'duration_seconds' ? 'Minutes' : metricLabel;
  const activeBucket = active !== null ? buckets[active] : null;
  const isInteractive = i => scaled[i] > 0;

  return (
    <div ref={ref} className="chart">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Bar chart of ${metricLabel.toLowerCase()} over time. The same numbers are in the table below.`}
        onPointerLeave={() => setActive(null)}
      >
        <text className="chart-axis-label" x={margin.left} y={14}>{unit}</text>
        {ticks.map(tick => (
          <g key={tick}>
            <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={margin.left - 8} y={y(tick) + 5} textAnchor="end">{tick}</text>
          </g>
        ))}
        {buckets.map((bucket, index) => {
          const value = scaled[index];
          const cx = margin.left + band * index + band / 2;
          const barH = (value / top) * plotH;
          const radius = Math.min(4, barW / 2, barH);
          const left = cx - barW / 2;
          const bottom = margin.top + plotH;
          const valueLabel = metricValue(metric, bucket[metric]);
          const interactivity = value > 0
            ? interactiveProps({
              index,
              active,
              setActive,
              ariaLabel: `${bucket.label}: ${metricLabel} ${valueLabel}`,
              itemRefs,
              isInteractive,
              length: buckets.length,
            })
            : { onPointerEnter: () => setActive(index) };
          return (
            <g key={`${metric}-${bucket.key}`} {...interactivity}>
              <rect x={margin.left + band * index} y={margin.top} width={band} height={plotH} fill="transparent" />
              {value > 0 && (
                <path
                  className={active === index ? 'chart-bar chart-bar-hover chart-bar-enter' : 'chart-bar chart-bar-enter'}
                  style={{ animationDelay: `${Math.min(index * 16, 180)}ms` }}
                  d={`M${left},${bottom} V${bottom - barH + radius} Q${left},${bottom - barH} ${left + radius},${bottom - barH} H${left + barW - radius} Q${left + barW},${bottom - barH} ${left + barW},${bottom - barH + radius} V${bottom} Z`}
                />
              )}
              {index === peak && value > 0 && active === null && (
                <text className="chart-value" x={Math.min(Math.max(cx, margin.left + 30), width - 40)} y={bottom - barH - 6} textAnchor="middle">{valueLabel}</text>
              )}
              {index % labelEvery === 0 && (
                <text className="chart-tick" x={cx} y={height - margin.bottom + 22} textAnchor="middle">{bucket.label}</text>
              )}
            </g>
          );
        })}
        <line className="chart-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotH} y2={margin.top + plotH} />
        {activeBucket && (
          <Tooltip
            x={margin.left + band * active + band / 2}
            y={y(scaled[active])}
            width={width}
            lines={[activeBucket.label, `${metricLabel}: ${metricValue(metric, activeBucket[metric])}`]}
          />
        )}
      </svg>
    </div>
  );
}

function pointLabel(point) {
  if (point.recorded_at) {
    const formatted = formatDateTime(point.recorded_at);
    if (formatted !== '—') return formatted;
  }
  return point.date ? formatDateKey(point.date) : 'Session';
}

function buildHeartRateAria(point, check) {
  const parts = [pointLabel(point)];
  if (point.exercise_name) parts.push(point.exercise_name);
  if (isFiniteNumber(point.before_bpm)) parts.push(`Before ${point.before_bpm} bpm`);
  if (isFiniteNumber(point.after_bpm)) parts.push(`After ${point.after_bpm} bpm`);
  if (check) parts.push(check.label);
  return parts.join(', ');
}

function buildHeartRateTooltipLines(point, check, plan) {
  const header = point.exercise_name ? `${pointLabel(point)} · ${point.exercise_name}` : pointLabel(point);
  const lines = [header];
  const hasBefore = isFiniteNumber(point.before_bpm);
  const hasAfter = isFiniteNumber(point.after_bpm);
  if (hasBefore) lines.push(`Before: ${point.before_bpm} bpm`);
  if (hasAfter) {
    const delta = hasBefore ? point.after_bpm - point.before_bpm : null;
    const deltaText = delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta} bpm)` : '';
    lines.push(`After: ${point.after_bpm} bpm${deltaText}`);
  }
  if (check) {
    const stateLabel = check.state === 'above'
      ? 'Above target'
      : check.state === 'below'
        ? 'Below target'
        : check.state === 'in'
          ? 'In target range'
          : null;
    const targetText = bpmRangeLabel(plan);
    if (stateLabel) lines.push(targetText ? `${stateLabel} (${targetText})` : stateLabel);
  }
  return lines;
}

// Chronological before/after heart rate per completed workout, with optional
// care-plan target band and out-of-range markers.
export function HeartRateChart({ points = [], plan = null }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const pointRefs = useRef([]);

  useEffect(() => {
    setActive(null);
  }, [points]);

  if (!points?.length) return null;

  const hasTarget = hasBpmTarget(plan);
  const minTarget = isFiniteNumber(plan?.target_bpm_min) ? plan.target_bpm_min : null;
  const maxTarget = isFiniteNumber(plan?.target_bpm_max) ? plan.target_bpm_max : null;

  const bpmValues = [];
  for (const point of points) {
    if (isFiniteNumber(point?.before_bpm)) bpmValues.push(point.before_bpm);
    if (isFiniteNumber(point?.after_bpm)) bpmValues.push(point.after_bpm);
  }
  if (minTarget !== null) bpmValues.push(minTarget);
  if (maxTarget !== null) bpmValues.push(maxTarget);
  if (bpmValues.length === 0) return null;

  const rawMin = Math.min(...bpmValues);
  const rawMax = Math.max(...bpmValues);
  const paddedMin = Math.max(20, rawMin - 10);
  const paddedMax = rawMax + 10;
  const step = niceStep(Math.max(20, paddedMax - paddedMin), 5, [10, 20]);
  const yMin = Math.max(0, Math.floor(paddedMin / step) * step);
  const yMax = Math.max(yMin + step * 2, Math.ceil(paddedMax / step) * step);
  const ticks = [];
  for (let tick = yMin; tick <= yMax; tick += step) ticks.push(tick);

  const height = 280;
  const margin = { top: 28, right: 16, bottom: 36, left: width < 360 ? 44 : 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const band = plotW / points.length;
  const y = bpm => margin.top + plotH - ((bpm - yMin) / (yMax - yMin)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 76))));

  const hasOut = points.some(point => {
    if (!isFiniteNumber(point?.after_bpm)) return false;
    const check = bpmCheck({ after_bpm: point.after_bpm }, plan);
    return check?.state === 'above' || check?.state === 'below';
  });

  const bandTop = maxTarget !== null ? y(maxTarget) : margin.top;
  const bandBottom = minTarget !== null ? y(minTarget) : margin.top + plotH;
  const activePoint = active !== null ? points[active] : null;
  const activeCheck = activePoint && isFiniteNumber(activePoint.after_bpm)
    ? bpmCheck({ after_bpm: activePoint.after_bpm }, plan)
    : null;
  const activeTopY = activePoint
    ? Math.min(
      isFiniteNumber(activePoint.before_bpm) ? y(activePoint.before_bpm) : margin.top + plotH,
      isFiniteNumber(activePoint.after_bpm) ? y(activePoint.after_bpm) : margin.top + plotH,
    )
    : margin.top;

  return (
    <div ref={ref} className="chart">
      <div className="chart-legend" role="list" aria-label="Heart rate chart legend">
        <span className="chart-legend-item" role="listitem">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle className="hr-dot-before" cx="7" cy="7" r="4.5" fill="#fff" stroke="currentColor" strokeWidth="2" />
          </svg>
          Before exercise
        </span>
        <span className="chart-legend-item" role="listitem">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle className="hr-dot-after" cx="7" cy="7" r="5" fill="currentColor" />
          </svg>
          After exercise
        </span>
        {hasTarget && (
          <span className="chart-legend-item" role="listitem">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect className="hr-band" x="1" y="2" width="12" height="10" rx="2" fill="currentColor" fillOpacity="0.18" />
            </svg>
            Target range ({bpmRangeLabel(plan)})
          </span>
        )}
        {hasOut && (
          <span className="chart-legend-item" role="listitem">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <polygon className="hr-dot-out" points="7,1 13,7 7,13 1,7" fill="currentColor" />
            </svg>
            Outside target
          </span>
        )}
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Heart rate chart across ${points.length} completed ${points.length === 1 ? 'exercise' : 'exercises'}. The same numbers are in the table below.`}
        onPointerLeave={() => setActive(null)}
      >
        <text className="chart-axis-label" x={margin.left} y={14}>BPM</text>
        {ticks.map(tick => (
          <g key={tick}>
            <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={margin.left - 8} y={y(tick) + 5} textAnchor="end">{tick}</text>
          </g>
        ))}

        {hasTarget && (
          <g>
            <rect
              className="hr-band"
              x={margin.left}
              y={bandTop}
              width={plotW}
              height={Math.max(0, bandBottom - bandTop)}
            />
            {maxTarget !== null && (
              <line className="hr-band-line" x1={margin.left} x2={width - margin.right} y1={y(maxTarget)} y2={y(maxTarget)} />
            )}
            {minTarget !== null && (
              <line className="hr-band-line" x1={margin.left} x2={width - margin.right} y1={y(minTarget)} y2={y(minTarget)} />
            )}
            <text
              className="hr-band-label"
              x={width - margin.right - 4}
              y={Math.min(bandBottom - 6, Math.max(margin.top + 14, bandTop + 14))}
              textAnchor="end"
            >
              Target {bpmRangeLabel(plan)}
            </text>
          </g>
        )}

        {points.map((point, index) => {
          const cx = margin.left + band * index + band / 2;
          const hasBefore = isFiniteNumber(point.before_bpm);
          const hasAfter = isFiniteNumber(point.after_bpm);
          const check = hasAfter ? bpmCheck({ after_bpm: point.after_bpm }, plan) : null;
          const isOut = check?.state === 'above' || check?.state === 'below';
          const by = hasBefore ? y(point.before_bpm) : null;
          const ay = hasAfter ? y(point.after_bpm) : null;

          const hrProps = interactiveProps({
            index,
            active,
            setActive,
            ariaLabel: buildHeartRateAria(point, check),
            itemRefs: pointRefs,
            isInteractive: () => true,
            length: points.length,
          });
          return (
            <g
              key={point.id ?? `${point.recorded_at ?? point.date}-${index}`}
              {...hrProps}
              className="chart-bar-wrap hr-point-enter"
              style={{ animationDelay: `${Math.min(index * 20, 200)}ms` }}
            >
              <rect x={margin.left + band * index} y={margin.top} width={band} height={plotH} fill="transparent" />
              {active === index && (
                <line className="chart-crosshair" x1={cx} x2={cx} y1={margin.top} y2={margin.top + plotH} />
              )}
              {hasBefore && hasAfter && (
                <line className="hr-connector" x1={cx} x2={cx} y1={by} y2={ay} />
              )}
              {hasBefore && (
                <circle className="hr-dot-before" cx={cx} cy={by} r="5" />
              )}
              {hasAfter && (isOut ? (
                <polygon
                  className="hr-dot-out"
                  points={`${cx},${ay - 7} ${cx + 7},${ay} ${cx},${ay + 7} ${cx - 7},${ay}`}
                />
              ) : (
                <circle className="hr-dot-after" cx={cx} cy={ay} r="5.5" />
              ))}
              {index % labelEvery === 0 && point.date && (
                <text className="chart-tick" x={cx} y={height - margin.bottom + 22} textAnchor="middle">{formatDateKey(point.date)}</text>
              )}
            </g>
          );
        })}

        <line className="chart-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotH} y2={margin.top + plotH} />

        {activePoint && (
          <Tooltip
            x={margin.left + band * active + band / 2}
            y={activeTopY}
            width={width}
            lines={buildHeartRateTooltipLines(activePoint, activeCheck, plan)}
          />
        )}
      </svg>
    </div>
  );
}
