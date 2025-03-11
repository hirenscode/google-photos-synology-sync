import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WebSocketContext = createContext(null);

const WS_URL = process.env.NODE_ENV === 'production' 
  ? `ws://${window.location.host}/ws`
  : 'ws://localhost:3000/ws';

const RECONNECT_DELAY = 2000; // 2 seconds
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 5000; // 5 seconds

export function WebSocketProvider({ children }) {
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [discoveryState, setDiscoveryState] = useState(null);
  const [syncState, setSyncState] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const messageQueueRef = useRef([]);
  const pingTimeoutRef = useRef(null);
  const connectionTimeoutRef = useRef(null);
  const messageHandlersRef = useRef(new Map());

  const resetState = useCallback(() => {
    setDiscoveryState(null);
    setSyncState(null);
  }, []);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingTimeoutRef.current) {
      clearInterval(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const startPingInterval = useCallback(() => {
    if (pingTimeoutRef.current) {
      clearInterval(pingTimeoutRef.current);
    }
    pingTimeoutRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('Error sending ping:', error);
          cleanup();
          initializeWebSocket();
        }
      }
    }, PING_INTERVAL);
  }, []);

  // Initialize default handlers for discovery and sync status
  useEffect(() => {
    const handleDiscoveryProgress = (data) => {
      setDiscoveryState(data);
    };

    const handleSyncStatus = (data) => {
      setSyncState(data);
    };

    const handlePong = () => {
      // Reset reconnect attempts on successful pong
      reconnectAttemptsRef.current = 0;
    };

    messageHandlersRef.current.set('discoveryProgress', [handleDiscoveryProgress]);
    messageHandlersRef.current.set('syncStatus', [handleSyncStatus]);
    messageHandlersRef.current.set('pong', [handlePong]);

    return () => {
      messageHandlersRef.current.clear();
    };
  }, []);

  const processMessageQueue = useCallback(() => {
    while (messageQueueRef.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
      const message = messageQueueRef.current.shift();
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending queued message:', error);
        messageQueueRef.current.unshift(message);
        break;
      }
    }
  }, []);

  const initializeWebSocket = useCallback(() => {
    cleanup();

    try {
      setStatus('connecting');
      setError(null);
      
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('Connection timeout, retrying...');
          cleanup();
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current++;
            initializeWebSocket();
          } else {
            setError('Failed to connect after multiple attempts. Please refresh the page.');
            setStatus('error');
          }
        }
      }, CONNECTION_TIMEOUT);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
        clearTimeout(connectionTimeoutRef.current);
        startPingInterval();
        processMessageQueue();

        // Request initial states
        ws.send(JSON.stringify({ type: 'getSyncStatus' }));
        ws.send(JSON.stringify({ type: 'getDiscoveryProgress' }));
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event);
        cleanup();
        setStatus('disconnected');
        resetState();

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptsRef.current);
          console.log(`Attempting to reconnect in ${delay}ms...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            initializeWebSocket();
          }, delay);
        } else {
          setError('Maximum reconnection attempts reached. Please refresh the page.');
          setStatus('error');
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error. Attempting to reconnect...');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const handlers = messageHandlersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach(handler => handler(message.data));
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      setError('Failed to initialize WebSocket connection');
      setStatus('error');
      cleanup();
    }
  }, [cleanup, processMessageQueue, resetState, startPingInterval]);

  // Initialize WebSocket connection
  useEffect(() => {
    initializeWebSocket();
    return cleanup;
  }, [initializeWebSocket, cleanup]);

  const sendMessage = useCallback((type, data = {}) => {
    const message = { type, data };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message:', error);
        messageQueueRef.current.push(message);
        cleanup();
        initializeWebSocket();
      }
    } else {
      messageQueueRef.current.push(message);
    }
  }, [cleanup, initializeWebSocket]);

  const value = {
    status,
    error,
    discoveryState,
    syncState,
    sendMessage,
    reconnect: initializeWebSocket
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
} 