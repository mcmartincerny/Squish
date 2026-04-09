import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrainingGenerationSummary } from "./trainingTypes.ts";

interface TrainingChartProps {
  history: readonly TrainingGenerationSummary[];
}

export function TrainingChart({ history }: TrainingChartProps) {
  const data = history.map((entry) => ({
    generation: entry.generation,
    bestReward: Number(entry.bestReward.toFixed(3)),
    averageReward: Number(entry.averageReward.toFixed(3)),
    bestDistanceContribution: Number(entry.bestDistanceContribution.toFixed(3)),
    bestXOscillationContribution: Number(entry.bestXOscillationContribution.toFixed(3)),
    bestYOscillationContribution: Number(entry.bestYOscillationContribution.toFixed(3)),
  }));

  if (data.length === 0) {
    return <div className="training-chart__empty">Run at least one generation to populate the chart.</div>;
  }

  return (
    <div className="charts-chart training-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(122, 162, 255, 0.12)" />
          <XAxis dataKey="generation" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={72} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="bestReward" name="Best reward" stroke="#7aa2ff" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="averageReward" name="Average reward" stroke="#7ce38b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="bestDistanceContribution" name="Best distance part" stroke="#ffd866" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="bestXOscillationContribution" name="Best X oscillation part" stroke="#ff7a90" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="bestYOscillationContribution" name="Best Y oscillation part" stroke="#c792ea" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
