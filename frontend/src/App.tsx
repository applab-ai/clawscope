import { useState, useEffect } from 'react';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { api } from './services/api';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Try to access a protected endpoint to check if we're authenticated
      await api.getDashboardStats();
      setIsAuthenticated(true);
    } catch (error) {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    setIsAuthenticated(false);
  };

  if (loading) {
    return (
      <Center style={{ minHeight: '100vh' }}>
        <Stack align="center" gap="md">
          <Loader size="md" />
          <Text size="lg">Loading...</Text>
        </Stack>
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

export default App;