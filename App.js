import React, { useEffect } from 'react';
import Navigation from './src/navigation';
import { initAdMob } from './src/admob';

export default function App() {
  useEffect(() => {
    initAdMob();
  }, []);

  return <Navigation />;
}
