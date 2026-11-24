import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView.js';
import {
  SIM_EXERCISES,
  createSimState,
  getSimExercise,
  stepSimValue,
} from '../lib/repSimulator.js';
import { AnimatedNumber } from './AnimatedNumber.jsx';
import { Icon } from './common.jsx';

const CURL_PIVOT_X = 92;
const CURL_PIVOT_Y = 148;
const CURL_ARC_RADIUS = 76;

const CHAPTERS = [
  {
    title: '01 · Wrist-Strapped Sensor',
    body: 'MPU6050 strapped snugly just above the wrist runs on-device angle and displacement checks with "Hold wrist still" calibration.',
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

/**
 * Polar point relative to a forearm hanging straight down at 0°
 * and rotating counter-clockwise (forward-up) as deg increases.
 */
function curlPolarPoint(deg, radius = CURL_ARC_RADIUS) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Number((CURL_PIVOT_X + radius * Math.sin(rad)).toFixed(2)),
    y: Number((CURL_PIVOT_Y + radius * Math.cos(rad)).toFixed(2)),
  };
}

function describeCurlArc(startDeg, endDeg, radius = CURL_ARC_RADIUS) {
  const start = curlPolarPoint(startDeg, radius);
  const end = curlPolarPoint(endDeg, radius);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function WristSensorModule({ x, y, angleDeg = 0, thresholdMet, ledColor }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angleDeg})`}>
      {/* Snug teal wrist strap */}
      <rect
        x="-11"
        y="-7"
        width="22"
        height="14"
        rx="4"
        fill="#14b8a6"
        fillOpacity="0.34"
        stroke="#14b8a6"
        strokeWidth="1.5"
      />
      {/* MPU6050 housing */}
      <rect
        x="-18"
        y="-22"
        width="36"
        height="16"
        rx="4"
        fill="#0b1220"
        stroke={thresholdMet ? '#30d158' : '#14b8a6'}
        strokeWidth="1.4"
      />
      <text
        x="-3"
        y="-14"
        fill="rgba(255, 255, 255, 0.9)"
        fontSize="5.8"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
        letterSpacing="0.04em"
      >
        MPU6050
      </text>
      <circle cx="13" cy="-14" r="2.1" fill={ledColor} />
    </g>
  );
}

function ArmCurlSvg({ ex, state, thresholdMet, ledColor, transitionStyle }) {
  const returnEnd = curlPolarPoint(ex.returnValue, CURL_ARC_RADIUS);
  const returnSectorPath = `M ${CURL_PIVOT_X} ${CURL_PIVOT_Y} L ${CURL_PIVOT_X} ${
    CURL_PIVOT_Y + CURL_ARC_RADIUS
  } A ${CURL_ARC_RADIUS} ${CURL_ARC_RADIUS} 0 0 0 ${returnEnd.x} ${returnEnd.y} Z`;
  const returnArcPath = describeCurlArc(0, ex.returnValue, CURL_ARC_RADIUS);
  const fullRangeArcPath = describeCurlArc(0, ex.maxValue, CURL_ARC_RADIUS);
  const thresholdArcPath = describeCurlArc(
    ex.returnValue,
    ex.thresholdValue,
    CURL_ARC_RADIUS
  );
  const thresholdPoint = curlPolarPoint(ex.thresholdValue, CURL_ARC_RADIUS);
  const thresholdLabelPoint = curlPolarPoint(ex.thresholdValue, CURL_ARC_RADIUS + 18);
  const returnLabelPoint = curlPolarPoint(ex.returnValue / 2, CURL_ARC_RADIUS + 17);

  return (
    <svg
      className="showcase-arm-svg"
      viewBox="0 0 320 250"
      aria-hidden="true"
    >
      <defs>
        <filter
          id="showcase-threshold-glow"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Standing torso silhouette */}
      <circle cx="72" cy="36" r="14" fill="rgba(255, 255, 255, 0.1)" />
      <path
        d="M 54 62 C 54 54, 96 54, 98 66 L 96 168 L 56 168 Z"
        fill="rgba(255, 255, 255, 0.08)"
      />

      {/* Full range guide arc */}
      <path
        d={fullRangeArcPath}
        fill="none"
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth="2"
        strokeDasharray="3 5"
      />

      {/* Dashed <= 20° return sector */}
      <path
        d={returnSectorPath}
        fill="rgba(20, 184, 166, 0.09)"
        stroke="rgba(20, 184, 166, 0.35)"
        strokeWidth="1.2"
        strokeDasharray="3 3"
      />
      <path
        d={returnArcPath}
        fill="none"
        stroke="rgba(20, 184, 166, 0.65)"
        strokeWidth="2"
        strokeDasharray="4 3"
      />
      <text
        x={returnLabelPoint.x}
        y={returnLabelPoint.y}
        fill="rgba(94, 234, 212, 0.85)"
        fontSize="9.5"
        fontWeight="600"
        textAnchor="middle"
      >
        ≤ {ex.returnValue}°
      </text>

      {/* Threshold target arc */}
      <path
        d={thresholdArcPath}
        fill="none"
        stroke={thresholdMet ? '#30d158' : 'rgba(10, 132, 255, 0.55)'}
        strokeWidth={thresholdMet ? '5' : '3.5'}
        strokeLinecap="round"
        filter={thresholdMet ? 'url(#showcase-threshold-glow)' : undefined}
      />

      {/* Glowing 45° threshold ray & angle tag */}
      <line
        x1={CURL_PIVOT_X}
        y1={CURL_PIVOT_Y}
        x2={thresholdPoint.x}
        y2={thresholdPoint.y}
        stroke={thresholdMet ? 'rgba(48, 209, 88, 0.8)' : 'rgba(255, 255, 255, 0.24)'}
        strokeWidth="1.6"
        strokeDasharray="4 4"
      />
      <circle
        cx={thresholdPoint.x}
        cy={thresholdPoint.y}
        r="4.2"
        fill={thresholdMet ? '#30d158' : '#0a84ff'}
        filter={thresholdMet ? 'url(#showcase-threshold-glow)' : undefined}
      />
      <text
        x={thresholdLabelPoint.x}
        y={thresholdLabelPoint.y}
        fill={thresholdMet ? '#6ee794' : 'rgba(255, 255, 255, 0.72)'}
        fontSize="11"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {ex.thresholdValue}°
      </text>

      {/* Vertical upper arm with elbow by side */}
      <line
        x1="92"
        y1="70"
        x2={CURL_PIVOT_X}
        y2={CURL_PIVOT_Y}
        stroke="rgba(255, 255, 255, 0.24)"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <circle cx="92" cy="70" r="6" fill="rgba(255, 255, 255, 0.3)" />

      {/* Rotating forearm hanging straight down at 0°, curling counter-clockwise */}
      <g
        style={{
          transform: `rotate(${-state.value}deg)`,
          transformOrigin: `${CURL_PIVOT_X}px ${CURL_PIVOT_Y}px`,
          transformBox: 'view-box',
          transition: transitionStyle,
        }}
      >
        <line
          x1={CURL_PIVOT_X}
          y1={CURL_PIVOT_Y}
          x2="92"
          y2="224"
          stroke="rgba(255, 255, 255, 0.3)"
          strokeWidth="14"
          strokeLinecap="round"
        />

        {/* Teal wrist strap + MPU6050 just above wrist */}
        <WristSensorModule
          x={92}
          y={204}
          angleDeg={90}
          thresholdMet={thresholdMet}
          ledColor={ledColor}
        />

        {/* Hand + dumbbell */}
        <circle cx="92" cy="225" r="7" fill="rgba(255, 255, 255, 0.28)" />
        <rect x="81" y="222" width="22" height="6" rx="2" fill="#9ca3af" />
        <rect x="76" y="218" width="6" height="14" rx="2" fill="#d1d5db" />
        <rect x="102" y="218" width="6" height="14" rx="2" fill="#d1d5db" />
      </g>

      {/* Elbow pivot cap */}
      <circle
        cx={CURL_PIVOT_X}
        cy={CURL_PIVOT_Y}
        r="10"
        fill="#141821"
        stroke="rgba(255, 255, 255, 0.45)"
        strokeWidth="2"
      />
      <circle cx={CURL_PIVOT_X} cy={CURL_PIVOT_Y} r="3.2" fill="rgba(255, 255, 255, 0.8)" />
    </svg>
  );
}

function ShoulderPressSvg({ ex, state, thresholdMet, ledColor }) {
  const t = Math.max(0, Math.min(1, state.value / ex.maxValue));
  const startY = 112;
  const travelPx = 80;
  const wristX = Number((174 - 16 * t).toFixed(1));
  const wristY = Number((startY - travelPx * t).toFixed(1));
  const elbowX = Number((174 - 22 * t).toFixed(1));
  const elbowY = Number((156 - travelPx * t).toFixed(1));

  const minLiftY = Number((startY - travelPx * (ex.minLiftCm / ex.maxValue)).toFixed(1));
  const trackX = 234;

  const dx = wristX - elbowX;
  const dy = wristY - elbowY;
  const forearmAngleDeg = Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
  const sensorX = Number((wristX - dx * 0.3).toFixed(1));
  const sensorY = Number((wristY - dy * 0.3).toFixed(1));

  return (
    <svg
      className="showcase-arm-svg"
      viewBox="0 0 320 250"
      aria-hidden="true"
    >
      <defs>
        <filter
          id="showcase-press-glow"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Standing torso & head silhouette */}
      <circle cx="104" cy="64" r="15" fill="rgba(255, 255, 255, 0.1)" />
      <path
        d="M 80 92 C 80 82, 134 82, 138 96 L 134 226 L 82 226 Z"
        fill="rgba(255, 255, 255, 0.08)"
      />
      {/* Left resting arm */}
      <line
        x1="82"
        y1="98"
        x2="72"
        y2="178"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth="12"
        strokeLinecap="round"
      />

      {/* Vertical displacement ruler */}
      <line
        x1={trackX}
        y1={startY}
        x2={trackX}
        y2={startY - travelPx}
        stroke="rgba(255, 255, 255, 0.18)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1={trackX}
        y1={startY}
        x2={trackX}
        y2={wristY}
        stroke={thresholdMet ? '#30d158' : '#14b8a6'}
        strokeWidth="3.5"
        strokeLinecap="round"
      />

      {/* 0 START tick */}
      <line
        x1={trackX - 8}
        y1={startY}
        x2={trackX + 8}
        y2={startY}
        stroke="rgba(255, 255, 255, 0.38)"
        strokeWidth="1.5"
      />
      <text
        x={trackX + 13}
        y={startY + 3}
        fill="rgba(255, 255, 255, 0.65)"
        fontSize="9"
        fontWeight="600"
      >
        0 START
      </text>

      {/* 12 cm min line */}
      <line
        x1={wristX - 10}
        y1={minLiftY}
        x2={trackX + 8}
        y2={minLiftY}
        stroke={thresholdMet ? 'rgba(48, 209, 88, 0.7)' : 'rgba(10, 132, 255, 0.5)'}
        strokeWidth="1.4"
        strokeDasharray="4 4"
      />
      <circle
        cx={trackX}
        cy={minLiftY}
        r="4"
        fill={thresholdMet ? '#30d158' : '#0a84ff'}
        filter={thresholdMet ? 'url(#showcase-press-glow)' : undefined}
      />
      <text
        x={trackX + 13}
        y={minLiftY + 3}
        fill={thresholdMet ? '#6ee794' : '#93c5fd'}
        fontSize="9.5"
        fontWeight="700"
      >
        {ex.minLiftCm} cm min
      </text>

      {/* Live height readout marker */}
      <circle cx={trackX} cy={wristY} r="4.5" fill="#f5f5f7" />
      <text
        x={trackX + 13}
        y={wristY - 7}
        fill="#f5f5f7"
        fontSize="10"
        fontWeight="700"
      >
        {state.value} cm
      </text>

      {/* Working arm pressing overhead */}
      <line
        x1="132"
        y1="98"
        x2={elbowX}
        y2={elbowY}
        stroke="rgba(255, 255, 255, 0.24)"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <line
        x1={elbowX}
        y1={elbowY}
        x2={wristX}
        y2={wristY}
        stroke="rgba(255, 255, 255, 0.3)"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <circle cx={elbowX} cy={elbowY} r="7.5" fill="#141821" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1.8" />

      {/* Teal wrist strap + MPU6050 just above wrist */}
      <WristSensorModule
        x={sensorX}
        y={sensorY}
        angleDeg={forearmAngleDeg}
        thresholdMet={thresholdMet}
        ledColor={ledColor}
      />

      {/* Hand + dumbbell */}
      <circle cx={wristX} cy={wristY} r="6.5" fill="rgba(255, 255, 255, 0.3)" />
      <rect x={wristX - 15} y={wristY - 10} width="30" height="5" rx="2" fill="#9ca3af" />
      <rect x={wristX - 20} y={wristY - 14} width="6" height="13" rx="2" fill="#d1d5db" />
      <rect x={wristX + 14} y={wristY - 14} width="6" height="13" rx="2" fill="#d1d5db" />
    </svg>
  );
}

function BackRowSvg({ ex, state, thresholdMet, ledColor }) {
  const t = Math.max(0, Math.min(1, state.value / ex.maxValue));
  const startY = 204;
  const travelPx = 68;
  const wristX = Number((156 - 26 * t).toFixed(1));
  const wristY = Number((startY - travelPx * t).toFixed(1));
  const elbowX = Number((156 - 42 * t).toFixed(1));
  const elbowY = Number((160 - travelPx * t).toFixed(1));

  const minLiftY = Number((startY - travelPx * (ex.minLiftCm / ex.maxValue)).toFixed(1));
  const trackX = 234;

  const dx = wristX - elbowX;
  const dy = wristY - elbowY;
  const forearmAngleDeg = Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
  const sensorX = Number((wristX - dx * 0.3).toFixed(1));
  const sensorY = Number((wristY - dy * 0.3).toFixed(1));

  return (
    <svg
      className="showcase-arm-svg"
      viewBox="0 0 320 250"
      aria-hidden="true"
    >
      <defs>
        <filter
          id="showcase-row-glow"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Floor reference */}
      <line
        x1="24"
        y1="228"
        x2="220"
        y2="228"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth="1.5"
      />

      {/* Side-profile flat gym bench */}
      <rect x="60" y="156" width="8" height="72" rx="2" fill="rgba(255, 255, 255, 0.16)" />
      <rect x="176" y="156" width="8" height="72" rx="2" fill="rgba(255, 255, 255, 0.16)" />
      <rect
        x="46"
        y="146"
        width="152"
        height="12"
        rx="5"
        fill="rgba(255, 255, 255, 0.18)"
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth="1"
      />

      {/* Standing leg + knee braced on bench + near-horizontal torso */}
      <polyline
        points="74,124 58,180 46,226"
        fill="none"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="78,122 104,145 76,147"
        fill="none"
        stroke="rgba(255, 255, 255, 0.18)"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Support arm braced on bench */}
      <line
        x1="164"
        y1="114"
        x2="174"
        y2="146"
        stroke="rgba(255, 255, 255, 0.18)"
        strokeWidth="11"
        strokeLinecap="round"
      />
      {/* Near-horizontal torso */}
      <line
        x1="78"
        y1="120"
        x2="164"
        y2="112"
        stroke="rgba(255, 255, 255, 0.2)"
        strokeWidth="26"
        strokeLinecap="round"
      />
      {/* Head */}
      <circle cx="190" cy="110" r="13.5" fill="rgba(255, 255, 255, 0.14)" />

      {/* Vertical pull track/ruler */}
      <line
        x1={trackX}
        y1={startY}
        x2={trackX}
        y2={startY - travelPx}
        stroke="rgba(255, 255, 255, 0.18)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1={trackX}
        y1={startY}
        x2={trackX}
        y2={wristY}
        stroke={thresholdMet ? '#30d158' : '#14b8a6'}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1={trackX - 8}
        y1={startY}
        x2={trackX + 8}
        y2={startY}
        stroke="rgba(255, 255, 255, 0.38)"
        strokeWidth="1.5"
      />
      <text
        x={trackX + 13}
        y={startY + 3}
        fill="rgba(255, 255, 255, 0.65)"
        fontSize="9"
        fontWeight="600"
      >
        0 START
      </text>

      {/* 10 cm min threshold */}
      <line
        x1={wristX + 12}
        y1={minLiftY}
        x2={trackX + 8}
        y2={minLiftY}
        stroke={thresholdMet ? 'rgba(48, 209, 88, 0.7)' : 'rgba(10, 132, 255, 0.5)'}
        strokeWidth="1.4"
        strokeDasharray="4 4"
      />
      <circle
        cx={trackX}
        cy={minLiftY}
        r="4"
        fill={thresholdMet ? '#30d158' : '#0a84ff'}
        filter={thresholdMet ? 'url(#showcase-row-glow)' : undefined}
      />
      <text
        x={trackX + 13}
        y={minLiftY + 3}
        fill={thresholdMet ? '#6ee794' : '#93c5fd'}
        fontSize="9.5"
        fontWeight="700"
      >
        {ex.minLiftCm} cm min
      </text>

      {/* Live pull height marker */}
      <circle cx={trackX} cy={wristY} r="4.5" fill="#f5f5f7" />
      <text
        x={trackX + 13}
        y={wristY - 7}
        fill="#f5f5f7"
        fontSize="10"
        fontWeight="700"
      >
        {state.value} cm
      </text>

      {/* Working arm hanging straight down at 0 cm, pulling up toward hip */}
      <line
        x1="156"
        y1="116"
        x2={elbowX}
        y2={elbowY}
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <line
        x1={elbowX}
        y1={elbowY}
        x2={wristX}
        y2={wristY}
        stroke="rgba(255, 255, 255, 0.32)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <circle cx={elbowX} cy={elbowY} r="7" fill="#141821" stroke="rgba(255, 255, 255, 0.42)" strokeWidth="1.8" />

      {/* Teal wrist strap + MPU6050 just above wrist */}
      <WristSensorModule
        x={sensorX}
        y={sensorY}
        angleDeg={forearmAngleDeg}
        thresholdMet={thresholdMet}
        ledColor={ledColor}
      />

      {/* Hand + dumbbell */}
      <circle cx={wristX} cy={wristY} r="6.5" fill="rgba(255, 255, 255, 0.3)" />
      <rect x={wristX - 13} y={wristY + 5} width="26" height="5" rx="2" fill="#9ca3af" />
      <rect x={wristX - 18} y={wristY + 1} width="6" height="13" rx="2" fill="#d1d5db" />
      <rect x={wristX + 12} y={wristY + 1} width="6" height="13" rx="2" fill="#d1d5db" />
    </svg>
  );
}

export function InteractiveShowcase() {
  const [state, setState] = useState(() => createSimState('arm_curl'));
  const [isSimulating, setIsSimulating] = useState(false);
  const [holdStill, setHoldStill] = useState(false);
  const [chaptersRef, chaptersInView] = useInView();
  const simRafRef = useRef(null);
  const holdTimerRef = useRef(null);

  const ex = getSimExercise(state.exerciseId);
  const reducedMotion = prefersReducedMotion();

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldStill(false);
  };

  const cancelSim = () => {
    if (simRafRef.current !== null) {
      cancelAnimationFrame(simRafRef.current);
      simRafRef.current = null;
    }
    setIsSimulating(false);
  };

  useEffect(
    () => () => {
      cancelSim();
      clearHoldTimer();
    },
    []
  );

  const handleSelectExercise = (exerciseId) => {
    cancelSim();
    clearHoldTimer();
    const nextEx = getSimExercise(exerciseId);
    setState(createSimState(exerciseId));
    if (nextEx.holdStillRequired && !reducedMotion) {
      setHoldStill(true);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setHoldStill(false);
      }, 750);
    }
  };

  const handleReset = () => {
    cancelSim();
    clearHoldTimer();
    setState(createSimState(state.exerciseId));
  };

  const handleSliderChange = (event) => {
    cancelSim();
    clearHoldTimer();
    const nextValue = Number(event.target.value);
    setState((prev) => stepSimValue(prev, nextValue));
  };

  const runMotionSequence = (peakValue) => {
    cancelSim();
    clearHoldTimer();

    const applyCleanStart = (prev) => ({
      ...prev,
      value: ex.restValue,
      stage: 'ready',
      reachedThreshold: false,
      peakCm: 0,
      combinedCm: 0,
    });

    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setState((prev) => {
        let next = applyCleanStart(prev);
        next = stepSimValue(next, peakValue);
        next = stepSimValue(next, ex.restValue);
        return next;
      });
      return;
    }

    setIsSimulating(true);
    setState((prev) => stepSimValue(applyCleanStart(prev), ex.restValue));

    const totalMs = 950;
    const upShare = 0.54;
    let startTime = null;
    let hitPeak = false;

    const frame = (now) => {
      if (startTime === null) startTime = now;
      const progress = Math.min(1, (now - startTime) / totalMs);

      let val;
      if (progress < upShare) {
        const t = progress / upShare;
        const eased = 1 - Math.pow(1 - t, 3);
        val = ex.restValue + (peakValue - ex.restValue) * eased;
      } else {
        if (!hitPeak) {
          hitPeak = true;
          setState((prev) => stepSimValue(prev, peakValue));
        }
        const t = (progress - upShare) / (1 - upShare);
        const eased = 1 - Math.pow(1 - t, 3);
        val = peakValue + (ex.restValue - peakValue) * eased;
      }

      setState((prev) => stepSimValue(prev, val));

      if (progress < 1) {
        simRafRef.current = requestAnimationFrame(frame);
      } else {
        simRafRef.current = null;
        setState((prev) => stepSimValue(prev, ex.restValue));
        setIsSimulating(false);
      }
    };

    simRafRef.current = requestAnimationFrame(frame);
  };

  const thresholdMet = state.reachedThreshold || state.stage === 'counted';

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

  const transitionStyle =
    isSimulating || reducedMotion ? 'none' : 'transform 140ms var(--ease-out)';

  const sliderLabel =
    ex.id === 'arm_curl'
      ? 'Forearm tilt'
      : ex.id === 'shoulder_press'
        ? 'Vertical lift'
        : 'Vertical pull';

  const oledTargetText =
    ex.mode === 'angle'
      ? `${state.value}° · ${ex.thresholdValue}° target`
      : `${state.value} cm · ${ex.minLiftCm} cm min`;

  const stage1Rule =
    ex.mode === 'angle'
      ? `tilt >= ${ex.liftDetectValue}°`
      : `move >= ${ex.liftDetectValue} cm`;

  const stage2Rule =
    ex.mode === 'angle'
      ? `reach >= ${ex.thresholdValue}°`
      : `lift >= ${ex.minLiftCm} cm`;

  const stage3Rule =
    ex.mode === 'angle'
      ? `return <= ${ex.returnValue}°`
      : `return (≥ ${ex.minCombinedCm} cm)`;

  return (
    <section
      id="interactive-demo"
      className="showcase-section"
      aria-labelledby="showcase-heading"
      tabIndex={-1}
    >
      <div className="showcase-stage">
        <div className="showcase-header">
          <div>
            <p className="showcase-eyebrow">
              <Icon name="pulse" />
              Wearable simulator
            </p>
            <h2 id="showcase-heading">
              How Motion Track counts reps
            </h2>
            <p className="showcase-lead">
              Move the virtual wrist or run a simulated rep to see when the OLED count changes.
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
            {state.exerciseId === 'arm_curl' && (
              <ArmCurlSvg
                ex={ex}
                state={state}
                thresholdMet={thresholdMet}
                ledColor={ledColor}
                transitionStyle={transitionStyle}
              />
            )}
            {state.exerciseId === 'shoulder_press' && (
              <ShoulderPressSvg
                ex={ex}
                state={state}
                thresholdMet={thresholdMet}
                ledColor={ledColor}
              />
            )}
            {state.exerciseId === 'back_row' && (
              <BackRowSvg
                ex={ex}
                state={state}
                thresholdMet={thresholdMet}
                ledColor={ledColor}
              />
            )}

            <div className="showcase-oled">
              <div className="showcase-oled-head">
                <span>Motion Track</span>
                <span>{oledTargetText}</span>
              </div>
              {holdStill && (
                <p className="showcase-oled-hold">Hold wrist still</p>
              )}
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
              <p className="showcase-oled-status" aria-live="polite">
                {state.lastEvent}
              </p>
            </div>

            <div className="showcase-controls">
              <label htmlFor="sim-value-slider">
                <span>{sliderLabel}:</span>
                <strong className="num">
                  {state.value}
                  {ex.unit}
                </strong>
              </label>
              <input
                id="sim-value-slider"
                className="showcase-slider"
                type="range"
                min={ex.minValue}
                max={ex.maxValue}
                step={1}
                value={state.value}
                onChange={handleSliderChange}
              />
              <div className="showcase-btn-row">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => runMotionSequence(ex.fullSimPeak)}
                >
                  Simulate 1 rep
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => runMotionSequence(ex.shallowSimPeak)}
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

            <div className="showcase-guide-note">
              <p>
                <strong>Start:</strong> {ex.startPosition}
              </p>
              <p>
                <strong>Rep rule:</strong> {ex.repRule}
              </p>
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
                <span>{stage1Rule}</span>
              </li>
              <li
                className="showcase-stage-item"
                data-active={stage2Active ? 'true' : 'false'}
                data-done={stage2Done ? 'true' : 'false'}
              >
                <strong>Check range</strong>
                <span>{stage2Rule}</span>
              </li>
              <li
                className="showcase-stage-item"
                data-active={stage3Active ? 'true' : 'false'}
                data-done={stage3Done ? 'true' : 'false'}
              >
                <strong>Count on return</strong>
                <span>{stage3Rule}</span>
              </li>
            </ol>

            <div className="showcase-telemetry-card">
              <div className="showcase-telemetry-head">
                <div>
                  <h3>{ex.name}</h3>
                  <span className="showcase-placement-pill">
                    Snug strap · {ex.placement}
                  </span>
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

              <ul className="showcase-checks" aria-label="Firmware checks">
                {ex.firmwareChecks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>

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
                  className="showcase-ecg-trace"
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
