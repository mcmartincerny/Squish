import { useState } from 'react';
import { BenchmarkRunner } from './BenchmarkRunner.tsx';
import { PlaygroundView } from './PlaygroundView.tsx';

type AppMode = 'playground' | 'benchmark';

function App() {
  const [mode, setMode] = useState<AppMode>('playground');

  if (mode === 'benchmark') {
    return <BenchmarkRunner onBackToPlayground={() => setMode('playground')} />;
  }

  return <PlaygroundView onOpenBenchmarkRunner={() => setMode('benchmark')} />;
}

export default App;
