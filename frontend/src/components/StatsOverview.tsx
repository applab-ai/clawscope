import React, { useState, useRef, useEffect } from 'react';
import {
  SimpleGrid,
  Card,
  Text,
  Group,
  ThemeIcon,
  Stack,
  Center,
  Loader,
  Alert,
  Button,
  Badge,
} from '@mantine/core';
import {
  IconClock,
  IconActivity,
  IconChartBar,
  IconCurrencyDollar,
  IconHeart,
  IconAlertTriangle,
  IconX,
  IconHelp,
  IconSparkles,
  IconArrowRight,
  IconDownload,
  IconCheck,
  IconRefresh,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, type DashboardStats } from '../services/api';

interface StatsOverviewProps {
  refreshTrigger: number;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<{
    local: string;
    local_revision: string | null;
    remote: string | null;
    remote_revision: string | null;
    status: 'up_to_date' | 'behind' | 'ahead' | 'diverged' | 'unknown';
    update_available: boolean;
  } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ success: boolean; steps: any[] } | null>(null);

  useEffect(() => {
    fetchStats();
    fetchVersion();
  }, [refreshTrigger]);

  const fetchVersion = async () => {
    try {
      const resp = await api.rawFetch('/api/version');
      const data = await resp.json();
      setVersionInfo(data);
    } catch { /* ignore */ }
  };

  const runUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const resp = await api.rawFetch('/api/update', { method: 'POST' });
      const data = await resp.json();
      setUpdateResult(data);
      if (data.success) {
        // Backend restarts — wait then reload
        setTimeout(() => window.location.reload(), 4000);
      }
    } catch (e) {
      setUpdateResult({ success: false, steps: [{ step: 'request', ok: false, output: String(e) }] });
    } finally {
      setUpdating(false);
    }
  };

  const fetchStats = async () => {
    const isRefresh = hasLoaded.current;
    try {
      if (!isRefresh) setLoading(true);
      if (!isRefresh) setError(null);
      const data = await api.getDashboardStats();
      setStats(data);
      setError(null);
    } catch (err) {
      // Only show error on initial load, silently ignore auto-refresh failures
      if (!isRefresh) {
        setError(t('stats.loadingStats'));
      }
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  };

  const getHealthBadge = (health: string) => {
    switch (health) {
      case 'good':
        return { color: 'green', icon: IconHeart, label: t('stats.health.good') };
      case 'warning':
        return { color: 'yellow', icon: IconAlertTriangle, label: t('stats.health.warning') };
      case 'critical':
        return { color: 'red', icon: IconX, label: t('stats.health.critical') };
      default:
        return { color: 'gray', icon: IconHelp, label: t('stats.health.unknown') };
    }
  };

  if (loading) {
    return (
      <Center p="xl">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text>{t('stats.loadingStats')}</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light">
        <Stack gap="sm">
          <Text>{error}</Text>
          <Button size="xs" onClick={fetchStats} variant="light" color="red">
            {t('common.retry')}
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (!stats) {
    return (
      <Center p="xl">
        <Text>{t('stats.noData')}</Text>
      </Center>
    );
  }

  const healthBadge = getHealthBadge(stats.system_health);
  const HealthIcon = healthBadge.icon;

  const statCards = [
    {
      title: t('stats.cronJobs'),
      value: stats.total_cron_jobs.toString(),
      icon: IconClock,
      color: 'blue',
    },
    {
      title: t('stats.activeSessions'),
      value: stats.active_sessions.toString(),
      icon: IconActivity,
      color: 'green',
    },
    {
      title: t('stats.dailyCosts'),
      value: `$${stats.daily_cost.toFixed(2)}`,
      icon: IconChartBar,
      color: 'orange',
    },
    {
      title: t('stats.monthlyCosts'),
      value: `$${stats.monthly_cost.toFixed(2)}`,
      icon: IconCurrencyDollar,
      color: 'grape',
    },
  ];

  return (
    <Stack gap="xl">
      <Text size="sm" c="dimmed">
        {t('stats.overview.description')}
      </Text>

      {/* Prompt Visualizer CTA */}
      <Card
        padding="lg"
        radius="md"
        withBorder
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(59,130,246,0.08) 100%)',
          borderColor: 'var(--mantine-color-violet-4)',
          borderWidth: 2,
          cursor: 'pointer',
        }}
        onClick={() => navigate('/prompt-visualizer')}
      >
        <Group justify="space-between" align="center">
          <Group gap="md">
            <ThemeIcon size={50} radius="md" variant="gradient" gradient={{ from: 'violet', to: 'blue', deg: 135 }}>
              <IconSparkles size={26} />
            </ThemeIcon>
            <Stack gap={2}>
              <Group gap={8}>
                <Text size="lg" fw={700}>{t('visualizer.title', 'Prompt Visualizer')}</Text>
                <Text component="span" size="10px" fw={700} c="white" px={6} py={2} style={{ borderRadius: 4, background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)' }}>✦ Clawscope</Text>
              </Group>
              <Text size="sm" c="dimmed">{t('stats.visualizerCta', 'See exactly how OpenClaw assembles every prompt — step by step, token by token.')}</Text>
            </Stack>
          </Group>
          <ThemeIcon size={36} radius="xl" variant="light" color="violet">
            <IconArrowRight size={20} />
          </ThemeIcon>
        </Group>
      </Card>

      {/* Version Info */}
      {versionInfo && (
        <Card padding="md" radius="md" withBorder>
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm">
              <Text size="sm" c="dimmed">Clawscope</Text>
              <Badge color="blue" variant="light" size="lg">v{versionInfo.local}</Badge>
              {versionInfo.local_revision && (
                <Badge color="gray" variant="light" size="sm">#{versionInfo.local_revision}</Badge>
              )}
              {versionInfo.status === 'behind' && versionInfo.remote && (
                <Badge color="green" variant="filled" size="sm">v{versionInfo.remote} {t('version.available', 'available')}</Badge>
              )}
              {versionInfo.status === 'behind' && versionInfo.remote_revision && versionInfo.remote_revision !== versionInfo.local_revision && (
                <Badge color="teal" variant="light" size="sm">#{versionInfo.remote_revision} {t('version.revisionAvailable', 'revision available')}</Badge>
              )}
              {versionInfo.status === 'up_to_date' && (
                <Group gap={4}>
                  <IconCheck size={14} color="var(--mantine-color-green-6)" />
                  <Text size="xs" c="green">{t('version.upToDate', 'Up to date')}</Text>
                </Group>
              )}
              {versionInfo.status === 'ahead' && (
                <Badge color="orange" variant="light" size="sm">{t('version.localAhead', 'local ahead')}</Badge>
              )}
              {versionInfo.status === 'diverged' && (
                <Badge color="red" variant="light" size="sm">{t('version.diverged', 'diverged')}</Badge>
              )}
            </Group>
            <Group gap="sm">
              {versionInfo.status === 'behind' && versionInfo.update_available && (
                <Button
                  size="xs"
                  variant="gradient"
                  gradient={{ from: 'green', to: 'teal' }}
                  leftSection={<IconDownload size={14} />}
                  loading={updating}
                  onClick={runUpdate}
                >
                  {t('version.update', 'Update')}
                </Button>
              )}
              <Button size="xs" variant="subtle" color="gray" onClick={fetchVersion} leftSection={<IconRefresh size={14} />}>
                {t('version.check', 'Check')}
              </Button>
            </Group>
          </Group>
          {updateResult && (
            <Stack gap="xs" mt="sm">
              {updateResult.steps.map((s: any, i: number) => (
                <Group key={i} gap="xs">
                  <Badge color={s.ok ? 'green' : 'red'} size="xs" variant="filled">{s.ok ? '✓' : '✗'}</Badge>
                  <Text size="xs" fw={500}>{s.step}</Text>
                  {s.output && <Text size="xs" c="dimmed" lineClamp={1}>{s.output}</Text>}
                </Group>
              ))}
              {updateResult.success && <Text size="xs" c="green">{t('version.restarting', 'Restarting...')}</Text>}
            </Stack>
          )}
        </Card>
      )}

      {/* Stats Cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        {statCards.map((card, index) => (
          <Card key={index} padding="lg" radius="md" withBorder>
            <Group justify="space-between">
              <Stack gap="xs">
                <Text size="sm" c="dimmed" fw={500}>
                  {card.title}
                </Text>
                <Text size="xl" fw={700}>
                  {card.value}
                </Text>
              </Stack>
              <ThemeIcon
                color={card.color}
                size={50}
                radius="md"
                variant="light"
              >
                <card.icon size={30} />
              </ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      {/* System Health */}
      <Card padding="lg" radius="md" withBorder>
        <Group justify="space-between" align="center">
          <Stack gap="xs">
            <Text size="lg" fw={600}>{t('stats.systemHealth')}</Text>
            <Text size="sm" c="dimmed">
              {t('stats.systemHealthDesc')}
            </Text>
          </Stack>
          <Badge
            color={healthBadge.color}
            variant="light"
            size="lg"
            leftSection={<HealthIcon size={14} />}
          >
            {healthBadge.label}
          </Badge>
        </Group>
      </Card>

      {/* Last Updated */}
      <Center>
        <Text size="sm" c="dimmed">
          {t('stats.lastUpdated')} {new Date().toLocaleTimeString('de-DE')}
        </Text>
      </Center>
    </Stack>
  );
};
