import { useEffect, useState } from 'react';
import { BenchmarkChartsView } from './BenchmarkChartsView.tsx';
import { BenchmarkRunner } from './BenchmarkRunner.tsx';
import { PlaygroundView } from './PlaygroundView.tsx';

type AppMode = 'playground' | 'benchmark' | 'benchmark-charts';

function App() {
  const [mode, setMode] = useState<AppMode>('playground');
  const [hmrKey, setHmrKey] = useState(0);

  useEffect(() => {
    if (import.meta.hot) {
      import.meta.hot.on('vite:afterUpdate', () => {
        console.log("HMR update detected");
        setTimeout(() => {
          setHmrKey((k) => k + 1);
        }, 50);
      });
    }
  }, [hmrKey]);


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

  return <PlaygroundView key={hmrKey} onOpenBenchmarkRunner={() => setMode('benchmark')} />;
}

export default App;
