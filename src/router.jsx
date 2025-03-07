import { createBrowserRouter, createRoutesFromElements, Route } from 'react-router-dom';
import Home from './pages/Home';
import Sync from './pages/Sync';
import Settings from './pages/Settings';
import About from './pages/About';
import Layout from './components/Layout';

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />}>
      <Route path="/" element={<Home />} />
      <Route path="/sync" element={<Sync />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/about" element={<About />} />
    </Route>
  ),
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
      v7_normalizeFormMethod: true,
      v7_prependBasename: true
    }
  }
);

export default router; 