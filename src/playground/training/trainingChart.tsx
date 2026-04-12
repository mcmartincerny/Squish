import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrainingEpisodeHistoryEntry, TrainingUpdateHistoryEntry } from "./trainingTypes.ts";

interface TrainingChartProps {
  episodeHistory: readonly TrainingEpisodeHistoryEntry[];
  updateHistory: readonly TrainingUpdateHistoryEntry[];
}

export function TrainingChart({ episodeHistory, updateHistory }: TrainingChartProps) {
  const rewardData = episodeHistory.map((entry) => ({
    episodeIndex: entry.episodeIndex,
    totalReward: Number(entry.totalReward.toFixed(3)),
    movingAverageReward: Number(entry.movingAverageReward.toFixed(3)),
    distanceContribution: Number(entry.distanceContribution.toFixed(3)),
    xOscillationContribution: Number(entry.xOscillationContribution.toFixed(3)),
    yOscillationContribution: Number(entry.yOscillationContribution.toFixed(3)),
    uprightContribution: Number(entry.uprightContribution.toFixed(3)),
  }));
  const updateData = updateHistory.map((entry) => ({
    updateIndex: entry.updateIndex,
    policyLoss: Number(entry.policyLoss.toFixed(4)),
    valueLoss: Number(entry.valueLoss.toFixed(4)),
    entropy: Number(entry.entropy.toFixed(4)),
    approxKl: Number(entry.approxKl.toFixed(4)),
  }));

  if (rewardData.length === 0) {
    return <div className="training-chart__empty">Run training to populate the PPO charts.</div>;
  }

  return (
    <div className="training-chart-stack">
      <div className="charts-chart training-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rewardData} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(122, 162, 255, 0.12)" />
            <XAxis dataKey="episodeIndex" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={72} />
            <Tooltip />
            <Legend />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="totalReward" name="Episode reward" stroke="#7aa2ff" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="movingAverageReward" name="Moving average reward" stroke="#7ce38b" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="distanceContribution" name="Distance part" stroke="#ffd866" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="xOscillationContribution" name="X oscillation part" stroke="#ff7a90" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="yOscillationContribution" name="Y oscillation part" stroke="#c792ea" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="uprightContribution" name="Upright part" stroke="#65d4ff" strokeWidth={2} dot={{ r: 1.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="charts-chart training-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={updateData} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(122, 162, 255, 0.12)" />
            <XAxis dataKey="updateIndex" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={72} />
            <Tooltip />
            <Legend />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="policyLoss" name="Policy loss" stroke="#7aa2ff" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="valueLoss" name="Value loss" stroke="#ffb86b" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="entropy" name="Entropy" stroke="#7ce38b" strokeWidth={2} dot={{ r: 1.5 }} />
            <Line type="linear" connectNulls isAnimationActive={false} dataKey="approxKl" name="Approx KL" stroke="#c792ea" strokeWidth={2} dot={{ r: 1.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
