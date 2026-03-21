import { useMemo, useRef, useLayoutEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { type TaskPlan, type TaskStepRecord, type StepStatus } from '../../lib/api-client';
import { divisions } from '../../data/agents';

interface TaskFlowViewProps {
  plan: TaskPlan;
  steps: TaskStepRecord[];
}

function getAgentEmoji(agentId: string): string {
  for (const division of divisions) {
    const agent = division.agents.find((a) => a.id === agentId);
    if (agent) return agent.emoji;
  }
  return '🤖';
}

function stepStatusColor(status: StepStatus): {
  bg: string;
  border: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case 'pending':
      return { bg: 'bg-slate-800/60', border: 'border-slate-700/40', text: 'text-slate-400', dot: 'bg-slate-600' };
    case 'running':
      return { bg: 'bg-blue-900/40', border: 'border-blue-400/30', text: 'text-blue-200', dot: 'bg-blue-400' };
    case 'pending_approval':
      return { bg: 'bg-amber-900/30', border: 'border-amber-400/25', text: 'text-amber-200', dot: 'bg-amber-400' };
    case 'completed':
      return { bg: 'bg-emerald-900/30', border: 'border-emerald-400/25', text: 'text-emerald-200', dot: 'bg-emerald-400' };
    case 'failed':
      return { bg: 'bg-red-900/30', border: 'border-red-400/25', text: 'text-red-200', dot: 'bg-red-400' };
    case 'skipped':
      return { bg: 'bg-slate-800/40', border: 'border-slate-700/30', text: 'text-slate-500', dot: 'bg-slate-700' };
    default:
      return { bg: 'bg-slate-800/60', border: 'border-slate-700/40', text: 'text-slate-400', dot: 'bg-slate-600' };
  }
}

interface LayeredStep {
  planStep: TaskPlan['steps'][number];
  record?: TaskStepRecord;
  layer: number;
  indexInLayer: number;
}

function computeLayers(plan: TaskPlan): { layers: LayeredStep[][]; maxLayer: number } {
  const layerMap = new Map<string, number>();

  const computeLayer = (stepId: string, visited = new Set<string>()): number => {
    if (layerMap.has(stepId)) return layerMap.get(stepId)!;
    if (visited.has(stepId)) return 0;

    visited.add(stepId);
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step || step.dependsOn.length === 0) {
      layerMap.set(stepId, 0);
      return 0;
    }

    const maxDepLayer = Math.max(...step.dependsOn.map((depId) => computeLayer(depId, visited)));
    const layer = maxDepLayer + 1;
    layerMap.set(stepId, layer);
    return layer;
  };

  plan.steps.forEach((s) => computeLayer(s.id));

  const maxLayer = Math.max(...Array.from(layerMap.values()), 0);
  const layerBuckets: LayeredStep[][] = Array.from({ length: maxLayer + 1 }, () => []);

  plan.steps.forEach((planStep) => {
    const layer = layerMap.get(planStep.id) ?? 0;
    layerBuckets[layer].push({ planStep, layer, indexInLayer: layerBuckets[layer].length });
  });

  return { layers: layerBuckets, maxLayer };
}

const NODE_W = 168;
const NODE_H = 80;
const H_GAP = 56;
const V_GAP = 16;

interface NodePosition {
  id: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
}

function computePositions(layers: LayeredStep[][]): NodePosition[] {
  const positions: NodePosition[] = [];

  layers.forEach((layer, li) => {
    const x = li * (NODE_W + H_GAP);
    layer.forEach((item, idx) => {
      const y = idx * (NODE_H + V_GAP);
      positions.push({
        id: item.planStep.id,
        x,
        y,
        cx: x + NODE_W / 2,
        cy: y + NODE_H / 2,
      });
    });
  });

  return positions;
}

function Arrow({ from, to, status }: { from: NodePosition; to: NodePosition; status: StepStatus }) {
  const x1 = from.x + NODE_W;
  const y1 = from.cy;
  const x2 = to.x;
  const y2 = to.cy;
  const mx = (x1 + x2) / 2;

  const path = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;

  const colors: Record<StepStatus, string> = {
    pending: 'rgba(100,116,139,0.3)',
    running: 'rgba(96,165,250,0.6)',
    pending_approval: 'rgba(251,191,36,0.5)',
    completed: 'rgba(52,211,153,0.5)',
    failed: 'rgba(248,113,113,0.5)',
    skipped: 'rgba(71,85,105,0.3)',
  };

  const color = colors[status] ?? colors.pending;

  return (
    <g>
      <defs>
        <marker id={`arrow-${from.id}-${to.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill={color} />
        </marker>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        markerEnd={`url(#arrow-${from.id}-${to.id})`}
        strokeDasharray={status === 'pending' ? '4 4' : undefined}
      />
    </g>
  );
}

function StepNode({ layeredStep, record, pos }: {
  layeredStep: LayeredStep;
  record?: TaskStepRecord;
  pos: NodePosition;
}) {
  const status: StepStatus = record?.status ?? 'pending';
  const colors = stepStatusColor(status);
  const emoji = getAgentEmoji(layeredStep.planStep.assignee);
  const isRunning = status === 'running';

  return (
    <foreignObject x={pos.x} y={pos.y} width={NODE_W} height={NODE_H}>
      <div
        className={`relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[16px] border p-3 ${colors.bg} ${colors.border}`}
      >
        {isRunning && (
          <motion.div
            className="absolute inset-0 rounded-[16px] border-2 border-blue-400/40"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot} ${isRunning ? 'animate-pulse' : ''}`} />
          <span className="truncate text-[11px] font-medium text-white leading-tight">
            {layeredStep.planStep.title}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-base leading-none">{emoji}</span>
          <span className={`text-[10px] ${colors.text}`}>
            {status === 'pending'
              ? '等待'
              : status === 'running'
                ? '执行中'
                : status === 'pending_approval'
                  ? '待审批'
                  : status === 'completed'
                    ? '完成'
                    : status === 'failed'
                      ? '失败'
                      : '跳过'}
          </span>
        </div>
      </div>
    </foreignObject>
  );
}

export default function TaskFlowView({ plan, steps }: TaskFlowViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(600);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { layers } = useMemo(() => computeLayers(plan), [plan]);
  const positions = useMemo(() => computePositions(layers), [layers]);

  const svgW = layers.length * (NODE_W + H_GAP) - H_GAP + 16;
  const maxLayerSize = Math.max(...layers.map((l) => l.length), 1);
  const svgH = maxLayerSize * (NODE_H + V_GAP) - V_GAP + 16;

  const stepRecordMap = useMemo(
    () => new Map(steps.map((s) => [s.id, s])),
    [steps]
  );

  const edges = useMemo(() => {
    const result: Array<{ from: string; to: string }> = [];
    plan.steps.forEach((step) => {
      step.dependsOn.forEach((depId) => {
        result.push({ from: depId, to: step.id });
      });
    });
    return result;
  }, [plan]);

  if (plan.steps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-center">
        <p className="text-sm text-slate-500">暂无步骤计划</p>
      </div>
    );
  }

  const posMap = new Map(positions.map((p) => [p.id, p]));

  const canScroll = svgW > containerW;

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
        执行流程图 · {plan.steps.length} 个节点
      </p>

      <div
        ref={containerRef}
        className={`max-h-[480px] overflow-auto rounded-[20px] border border-white/[0.06] bg-black/20 p-3 ${canScroll ? 'overflow-x-auto' : ''}`}
      >
        <svg
          width={Math.max(svgW, containerW - 24)}
          height={svgH}
          viewBox={`0 0 ${Math.max(svgW, containerW - 24)} ${svgH}`}
          style={{ display: 'block' }}
        >
          {/* arrows */}
          <g>
            {edges.map(({ from, to }) => {
              const fromPos = posMap.get(from);
              const toPos = posMap.get(to);
              if (!fromPos || !toPos) return null;
              const toRecord = stepRecordMap.get(to);
              return (
                <Arrow
                  key={`${from}->${to}`}
                  from={fromPos}
                  to={toPos}
                  status={toRecord?.status ?? 'pending'}
                />
              );
            })}
          </g>

          {/* nodes */}
          {layers.flat().map((layeredStep) => {
            const pos = posMap.get(layeredStep.planStep.id);
            if (!pos) return null;
            const record = stepRecordMap.get(layeredStep.planStep.id);
            return (
              <StepNode
                key={layeredStep.planStep.id}
                layeredStep={layeredStep}
                record={record}
                pos={pos}
              />
            );
          })}
        </svg>
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {(
          [
            { status: 'pending' as StepStatus, label: '等待' },
            { status: 'running' as StepStatus, label: '执行中' },
            { status: 'completed' as StepStatus, label: '完成' },
            { status: 'failed' as StepStatus, label: '失败' },
          ] as const
        ).map(({ status, label }) => {
          const c = stepStatusColor(status);
          return (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${c.dot}`} />
              <span className={`text-[10px] ${c.text}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
