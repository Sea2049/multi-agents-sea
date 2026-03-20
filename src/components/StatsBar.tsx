import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Building2, UserCheck, LayoutGrid } from 'lucide-react';

interface StatsBarProps {
  totalAgents: number;
  totalDivisions: number;
  teamCount: number;
  teamDivisionCoverage: number;
}

function AnimatedCounter({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevValue.current = end;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span>{display}</span>;
}

const stats = [
  {
    key: 'totalAgents' as const,
    label: '总 Agents',
    icon: Users,
    color: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
  },
  {
    key: 'totalDivisions' as const,
    label: '部门数',
    icon: Building2,
    color: 'text-purple-400',
    iconBg: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
  },
  {
    key: 'teamCount' as const,
    label: '我的团队',
    icon: UserCheck,
    color: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
  },
  {
    key: 'teamDivisionCoverage' as const,
    label: '技能覆盖',
    icon: LayoutGrid,
    color: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
  },
] as const;

export default function StatsBar({
  totalAgents,
  totalDivisions,
  teamCount,
  teamDivisionCoverage,
}: StatsBarProps) {
  const values: Record<typeof stats[number]['key'], number> = {
    totalAgents,
    totalDivisions,
    teamCount,
    teamDivisionCoverage,
  };

  return (
    <div className="bg-gray-900/50 border-b border-gray-800 px-6 py-3">
      <div className="flex items-center gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.key}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, duration: 0.4 }}
              className={`flex items-center gap-3 flex-1 px-4 py-2.5 rounded-xl border ${stat.borderColor} ${stat.iconBg} backdrop-blur-sm`}
            >
              <div className={`p-2 rounded-lg ${stat.iconBg}`}>
                <Icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <div className={`text-2xl font-bold leading-none ${stat.color} tabular-nums`}>
                  <AnimatedCounter value={values[stat.key]} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">{stat.label}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
