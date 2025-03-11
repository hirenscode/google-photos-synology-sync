import Layout from './components/Layout';
import Home from './pages/Home';
import Sync from './pages/Sync';
import Settings from './pages/Settings';
import About from './pages/About';
import Help from './pages/Help';

export const routes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        path: '/',
        element: <Home />,
      },
      {
        path: '/sync',
        element: <Sync />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
      {
        path: '/about',
        element: <About />,
      },
      {
        path: '/help',
        element: <Help />,
      }
    ],
  },
]; 