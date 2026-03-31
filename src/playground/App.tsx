import { useState } from 'react';
import { BenchmarkChartsView } from './BenchmarkChartsView.tsx';
import { BenchmarkRunner } from './BenchmarkRunner.tsx';
import { PlaygroundView } from './PlaygroundView.tsx';

type AppMode = 'playground' | 'benchmark' | 'benchmark-charts';

function App() {
  const [mode, setMode] = useState<AppMode>('playground');

  if (mode === 'benchmark') {
    return (
      <BenchmarkRunner
        onBackToPlayground={() => setMode('playground')}
        onOpenBenchmarkCharts={() => setMode('benchmark-charts')}
      />
    );
  }

  if (mode === 'benchmark-charts') {
    return <BenchmarkChartsView onBackToBenchmarkRunner={() => setMode('benchmark')} />;
  }

  return <PlaygroundView onOpenBenchmarkRunner={() => setMode('benchmark')} />;
}

export default App;
