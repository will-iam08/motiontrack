import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView.js';
import {
  SIM_EXERCISES,
  createSimState,
  getSimExercise,
  stepSimAngle,
} from '../lib/repSimulator.js';
import { AnimatedNumber } from './AnimatedNumber.jsx';
import { Icon } from './common.jsx';

const PIVOT_X = 92;
const PIVOT_Y = 148;
const ARC_RADIUS = 84;
const REST_ANGLE = 12;

const CHAPTERS = [
  {
    title: '01 · Forearm Wearable',
    body: 'IMU state machine runs directly on ESP32 and keeps counting even if Bluetooth drops.',
  },
  {
    title: '02 · Motion Track App',
    body: 'Pairs over BLE, captures before/after camera PPG heart rate, and queues offline sets safely.',
  },
  {
    title: '03 · Clinical Portal',
    body: 'Patients track BPM zones and progress; clinicians triage cohorts and tune care plans live.',
  },
];

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function polarPoint(deg, radius = ARC_RADIUS) {
  const rad = (-deg * Math.PI) / 180;
  return {
    x: Number((PIVOT_X + radius * Math.cos(rad)).toFixed(2)),
    y: Number((PIVOT_Y + radius * Math.sin(rad)).toFixed(2)),
  };
}

function describeArc(startDeg, endDeg, radius = ARC_RADIUS) {
  const start = polarPoint(startDeg, radius);
  const end = polarPoint(endDeg, radius);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function InteractiveShowcase() {
  const [state, setState] = useState(() => createSimState('arm_curl'));
  const [isSimulating, setIsSimulating] = useState(false);
  const [chaptersRef, chaptersInView] = useInView();
  const simRafRef = useRef(null);

  const ex = getSimExercise(state.exerciseId);
  const reducedMotion = prefersReducedMotion();

  const cancelSim = () => {
    if (simRafRef.current !== null) {
      cancelAnimationFrame(simRafRef.current);
      simRafRef.current = null;
    }
    setIsSimulating(false);
  };

  useEffect(() => () => cancelSim(), []);

  const handleSelectExercise = (exerciseId) => {
    cancelSim();
    setState(createSimState(exerciseId));
  };

  const handleReset = () => {
    cancelSim();
    setState(createSimState(state.exerciseId));
  };

  const handleSliderChange = (event) => {
    cancelSim();
    const nextAngle = Number(event.target.value);
    setState((prev) => stepSimAngle(prev, nextAngle));
  };

  const runMotionSequence = (peakAngle) => {
    cancelSim();

    const applyCleanStart = (prev) => ({
      ...prev,
      angle: REST_ANGLE,
      stage: 'ready',
      reachedThreshold: false,
    });

    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setState((prev) => {
        let next = applyCleanStart(prev);
        next = stepSimAngle(next, peakAngle);
        next = stepSimAngle(next, 15);
        return next;
      });
      return;
    }

    setIsSimulating(true);
    setState((prev) => stepSimAngle(applyCleanStart(prev), REST_ANGLE));

    const totalMs = 950;
    const upShare = 0.54;
    let startTime = null;
    let hitPeak = false;

    const frame = (now) => {
      if (startTime === null) startTime = now;
      const progress = Math.min(1, (now - startTime) / totalMs);

      let angle;
      if (progress < upShare) {
        const t = progress / upShare;
        const eased = 1 - Math.pow(1 - t, 3);
        angle = REST_ANGLE + (peakAngle - REST_ANGLE) * eased;
      } else {
        if (!hitPeak) {
          hitPeak = true;
          setState((prev) => stepSimAngle(prev, peakAngle));
        }
        const t = (progress - upShare) / (1 - upShare);
        const eased = 1 - Math.pow(1 - t, 3);
        angle = peakAngle + (15 - peakAngle) * eased;
      }

      setState((prev) => stepSimAngle(prev, angle));

      if (progress < 1) {
        simRafRef.current = requestAnimationFrame(frame);
      } else {
        simRafRef.current = null;
        setState((prev) => stepSimAngle(prev, 15));
        setIsSimulating(false);
      }
    };

    simRafRef.current = requestAnimationFrame(frame);
  };

  const thresholdMet = state.reachedThreshold || state.stage === 'counted';
  const thresholdPoint = polarPoint(ex.thresholdDeg, ARC_RADIUS);
  const thresholdLabelPoint = polarPoint(ex.thresholdDeg, ARC_RADIUS + 16);
  const thresholdArcPath = describeArc(REST_ANGLE, ex.thresholdDeg, ARC_RADIUS);
  const fullRangeArcPath = describeArc(0, ex.maxDeg, ARC_RADIUS);

  const stage1Active = state.stage === 'lifting';
  const stage1Done =
    state.stage === 'lifting' ||
    state.reachedThreshold ||
    state.stage === 'threshold' ||
    state.stage === 'counted';

  const stage2Active = state.stage === 'threshold';
  const stage2Done =
    state.reachedThreshold || state.stage === 'threshold' || state.stage === 'counted';

  const stage3Active = state.stage === 'counted';
  const stage3Done = state.stage === 'counted' || state.completed;

  const progressScale = Math.min(1, state.reps / ex.targetReps);
  const ledColor = thresholdMet
    ? '#30d158'
    : state.stage === 'partial'
      ? '#ff9f0a'
      : '#0a84ff';

  return (
    <section
      id="interactive-demo"
      className="showcase-section"
      aria-labelledby="showcase-heading"
    >
      <div className="showcase-stage">
        <div className="showcase-header">
          <div>
            <p className="showcase-eyebrow">
              <Icon name="pulse" />
              Interactive Wearable Demo
            </p>
            <h2 id="showcase-heading">
              Feel the 3-stage rep sensor before you strap it on.
            </h2>
            <p className="showcase-lead">
              Drag the forearm angle or run a simulated lift to see how Motion Track filters partial swings and syncs heart-rate targets.
            </p>
          </div>

          <div className="showcase-pills" role="group" aria-label="Choose exercise">
            {SIM_EXERCISES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="showcase-pill"
                aria-pressed={item.id === state.exerciseId}
                onClick={() => handleSelectExercise(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <div className="showcase-grid">
          <div className="showcase-wearable">
            <svg
              className="showcase-arm-svg"
              viewBox="0 0 320 210"
              aria-hidden="true"
            >
              <defs>
                <filter id="showcase-threshold-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Full range guide arc */}
              <path
                d={fullRangeArcPath}
                fill="none"
                stroke="rgba(255, 255, 255, 0.1)"
                strokeWidth="2"
                strokeDasharray="3 5"
              />

              {/* Threshold target arc */}
              <path
                d={thresholdArcPath}
                fill="none"
                stroke={thresholdMet ? '#30d158' : 'rgba(10, 132, 255, 0.55)'}
                strokeWidth={thresholdMet ? '5' : '3.5'}
                strokeLinecap="round"
                filter={thresholdMet ? 'url(#showcase-threshold-glow)' : undefined}
              />

              {/* Threshold target ray and degree tag */}
              <line
                x1={PIVOT_X}
                y1={PIVOT_Y}
                x2={thresholdPoint.x}
                y2={thresholdPoint.y}
                stroke={thresholdMet ? 'rgba(48, 209, 88, 0.7)' : 'rgba(255, 255, 255, 0.2)'}
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <circle
                cx={thresholdPoint.x}
                cy={thresholdPoint.y}
                r="4"
                fill={thresholdMet ? '#30d158' : '#0a84ff'}
              />
              <text
                x={thresholdLabelPoint.x}
                y={thresholdLabelPoint.y}
                fill={thresholdMet ? '#6ee794' : 'rgba(255, 255, 255, 0.68)'}
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {ex.thresholdDeg}°
              </text>

              {/* Fixed upper-arm hub */}
              <line
                x1="74"
                y1="44"
                x2={PIVOT_X}
                y2={PIVOT_Y}
                stroke="rgba(255, 255, 255, 0.22)"
                strokeWidth="20"
                strokeLinecap="round"
              />
              <line
                x1="74"
                y1="44"
                x2={PIVOT_X}
                y2={PIVOT_Y}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="12"
                strokeLinecap="round"
              />

              {/* Rotating forearm link + strapped OLED sensor */}
              <g
                style={{
                  transform: `rotate(${-state.angle}deg)`,
                  transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`,
                  transformBox: 'view-box',
                  transition:
                    isSimulating || reducedMotion
                      ? 'none'
                      : 'transform 140ms var(--ease-out)',
                }}
              >
                <line
                  x1={PIVOT_X}
                  y1={PIVOT_Y}
                  x2="220"
                  y2={PIVOT_Y}
                  stroke="rgba(255, 255, 255, 0.28)"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <circle
                  cx="224"
                  cy={PIVOT_Y}
                  r="10"
                  fill="rgba(255, 255, 255, 0.24)"
                />

                {/* Forearm strap */}
                <rect
                  x="144"
                  y={PIVOT_Y - 11}
                  width="28"
                  height="22"
                  rx="4"
                  fill="rgba(255, 255, 255, 0.16)"
                />

                {/* Motion Track OLED module (MPU6050) */}
                <rect
                  x="136"
                  y={PIVOT_Y - 22}
                  width="44"
                  height="20"
                  rx="5"
                  fill="#0b1220"
                  stroke={thresholdMet ? '#30d158' : 'rgba(255, 255, 255, 0.35)'}
                  strokeWidth="1.5"
                />
                <text
                  x="154"
                  y={PIVOT_Y - 12}
                  fill="rgba(255, 255, 255, 0.85)"
                  fontSize="6.5"
                  fontWeight="600"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  letterSpacing="0.04em"
                >
                  MPU6050
                </text>
                <circle cx="174" cy={PIVOT_Y - 12} r="2.2" fill={ledColor} />
              </g>

              {/* Elbow pivot cap */}
              <circle
                cx={PIVOT_X}
                cy={PIVOT_Y}
                r="11"
                fill="#141821"
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth="2"
              />
              <circle cx={PIVOT_X} cy={PIVOT_Y} r="3.5" fill="rgba(255, 255, 255, 0.8)" />
            </svg>

            <div className="showcase-oled">
              <div className="showcase-oled-head">
                <span>Motion Track</span>
                <span>
                  {state.angle}° · {ex.thresholdDeg}° target
                </span>
              </div>
              <div className="showcase-oled-main">
                <span className="showcase-oled-reps num">
                  <AnimatedNumber value={state.reps} />
                </span>
                <span>/ {ex.targetReps} reps</span>
              </div>
              <div className="showcase-oled-bar">
                <div
                  className="showcase-oled-bar-fill"
                  style={{ transform: `scaleX(${progressScale})` }}
                />
              </div>
              <p className="showcase-oled-status" aria-live="polite">{state.lastEvent}</p>
            </div>

            <div className="showcase-controls">
              <label htmlFor="sim-angle-slider">
                Forearm angle: <strong className="num">{state.angle}°</strong>
              </label>
              <input
                id="sim-angle-slider"
                className="showcase-slider"
                type="range"
                min={0}
                max={ex.maxDeg}
                value={state.angle}
                onChange={handleSliderChange}
              />
              <div className="showcase-btn-row">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => runMotionSequence(ex.thresholdDeg + 12)}
                >
                  Simulate 1 rep
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => runMotionSequence(ex.thresholdDeg - 18)}
                >
                  Try shallow lift
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleReset}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div className="showcase-telemetry">
            <ol className="showcase-stages" aria-label="3-stage rep detection">
              <li
                className="showcase-stage-item"
                data-active={stage1Active ? 'true' : 'false'}
                data-done={stage1Done ? 'true' : 'false'}
              >
                <strong>Detect lift</strong>
                <span>angle &gt;= {ex.returnDeg + 10}°</span>
              </li>
              <li
                className="showcase-stage-item"
                data-active={stage2Active ? 'true' : 'false'}
                data-done={stage2Done ? 'true' : 'false'}
              >
                <strong>Check range</strong>
                <span>cross &gt;= {ex.thresholdDeg}°</span>
              </li>
              <li
                className="showcase-stage-item"
                data-active={stage3Active ? 'true' : 'false'}
                data-done={stage3Done ? 'true' : 'false'}
              >
                <strong>Count on return</strong>
                <span>return &lt; {ex.returnDeg}°</span>
              </li>
            </ol>

            <div className="showcase-telemetry-card">
              <div className="showcase-telemetry-head">
                <div>
                  <h3>{ex.name}</h3>
                  <span className="showcase-placement-pill">{ex.placement}</span>
                </div>
                <span
                  className="showcase-sync-pill"
                  data-completed={state.completed ? 'true' : 'false'}
                >
                  {state.completed ? 'Set complete · synced' : 'Motion Track preview'}
                </span>
              </div>

              <div className="showcase-metrics">
                <div className="showcase-metric">
                  <span>Counted reps</span>
                  <strong className="num">
                    <AnimatedNumber value={state.reps} /> / {ex.targetReps}
                  </strong>
                </div>
                <div className="showcase-metric">
                  <span>Rejected partials</span>
                  <strong className="num">
                    <AnimatedNumber value={state.partialAttempts} />
                  </strong>
                </div>
                <div className="showcase-metric">
                  <span>Before / Current BPM</span>
                  <strong className="num">
                    {ex.restBpm} → <AnimatedNumber value={state.bpm} /> bpm
                  </strong>
                </div>
                <div className="showcase-metric">
                  <span>Care plan check</span>
                  <strong>65–120 bpm · In range</strong>
                </div>
              </div>

              <svg
                className="showcase-ecg-line"
                viewBox="0 0 280 42"
                aria-hidden="true"
              >
                <path
                  className="showcase-ecg-base"
                  d="M0 24 H36 L44 20 L50 24 H64 L69 27 L75 7 L81 36 L87 21 L92 24 H136 L144 19 L150 24 H164 L169 27 L175 7 L181 36 L187 21 L192 24 H236 L244 20 L250 24 H280"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.14)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="showcase-ecg-sweep"
                  d="M0 24 H36 L44 20 L50 24 H64 L69 27 L75 7 L81 36 L87 21 L92 24 H136 L144 19 L150 24 H164 L169 27 L175 7 L181 36 L187 21 L192 24 H236 L244 20 L250 24 H280"
                  fill="none"
                  stroke="#30d158"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div ref={chaptersRef} className="showcase-chapters">
        {CHAPTERS.map((chapter, index) => (
          <article
            key={chapter.title}
            className={chaptersInView ? 'showcase-chapter is-visible' : 'showcase-chapter'}
            style={{ '--chapter-index': index }}
          >
            <h3>{chapter.title}</h3>
            <p>{chapter.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
