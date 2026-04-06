import React, { useState } from 'react';
import {
  Center,
  Paper,
  Title,
  Text,
  PasswordInput,
  Button,
  Stack,
  Group,
  ThemeIcon,
  Alert,
  Loader,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

// Custom endoscope icon (SVG)
const EndoscopeIcon = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {/* Flexible tube curving down and right */}
    <path d="M4 4 C4 4, 4 14, 8 16 C12 18, 14 18, 14 14 C14 10, 16 8, 18 8" />
    {/* Camera head / tip with lens */}
    <circle cx="20" cy="8" r="2.5" />
    <circle cx="20" cy="8" r="0.8" fill="currentColor" />
    {/* Light ring at tip */}
    <path d="M18.2 6.2 L17.5 5.5" />
    <path d="M21.8 6.2 L22.5 5.5" />
    {/* Handle grip at top */}
    <rect x="2" y="2" width="4" height="4" rx="1" />
  </svg>
);

interface LoginProps {
  onLogin: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.login(password);
      onLogin();
    } catch (error) {
      setError(t('login.invalidPassword'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center style={{ minHeight: '100vh' }} p="md">
      <Paper shadow="xl" radius="lg" p="xl" w={400} withBorder>
        <Stack gap="lg" align="center">
          {/* Logo */}
          <Group gap="md" align="center">
            <ThemeIcon 
              size={50}
              radius="md"
              variant="gradient"
              gradient={{ from: 'blue', to: 'purple' }}
            >
              <EndoscopeIcon size={30} />
            </ThemeIcon>
            <Stack gap={0}>
              <Title order={2} size="h3">
                Clawscope
              </Title>
              <Text size="sm" c="dimmed">
                {t('login.subtitle')}
              </Text>
            </Stack>
          </Group>

          {/* Login Form */}
          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            <Stack gap="md">
              <PasswordInput
                label={t('login.password')}
                placeholder={t('login.passwordPlaceholder')}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                leftSection={<IconLock size={16} />}
                required
                size="md"
              />

              {error && (
                <Alert color="red" radius="md">
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                size="md"
                fullWidth
                loading={loading}
                leftSection={loading ? <Loader size={16} /> : <IconLock size={16} />}
                variant="gradient"
                gradient={{ from: 'blue', to: 'purple' }}
              >
                {loading ? t('login.signingIn') : t('login.signIn')}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  );
};
