import React, { useState, useEffect } from 'react';
import {
  AppShell,
  Group,
  Title,
  Text,
  Button,
  NavLink,
  Stack,
  Burger,
  SegmentedControl,
  Divider,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartBar,
  IconClock,
  IconActivity,
  IconCurrencyDollar,
  IconLogout,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatsOverview } from './StatsOverview';
import { CronJobsList } from './CronJobsList';
import { SessionsList } from './SessionsList';
import { CostsPage } from './CostsPage';
import { SystemPrompt } from './SystemPrompt';
import { CronHistory } from './CronHistory';
import { PromptHistory } from './PromptHistory';
import { LiveAgents } from './LiveAgents';
import { Settings } from './Settings';

import { PromptVisualizer } from './PromptVisualizer';
import { CollectorStatus } from './CollectorStatus';

interface DashboardProps {
  onLogout: () => void;
}

import { IconFileText, IconHistory, IconRobot, IconSettings, IconHeartRateMonitor } from '@tabler/icons-react';

export const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const { t, i18n } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();

  const NAV_GROUPS = [
    {
      label: 'Overview',
      items: [
        { path: '/overview', label: t('dashboard.nav.overview'), icon: IconChartBar },
        { path: '/costs', label: t('dashboard.nav.costs'), icon: IconCurrencyDollar },
      ],
    },
    {
      label: 'Activity',
      items: [
        { path: '/prompt-history', label: t('dashboard.nav.promptHistory'), icon: IconHistory },
        { path: '/live-agents', label: t('dashboard.nav.liveAgents'), icon: IconRobot },
        { path: '/sessions', label: t('dashboard.nav.sessions'), icon: IconActivity },
      ],
    },
    {
      label: 'Automation',
      items: [
        { path: '/cron-jobs', label: t('dashboard.nav.cronJobs'), icon: IconClock },
        { path: '/cron-history', label: t('dashboard.nav.cronHistory'), icon: IconClock },
      ],
    },
    {
      label: 'Prompt',
      items: [
        { path: '/system-prompt', label: t('dashboard.nav.systemPrompt'), icon: IconFileText },
        { path: '/prompt-visualizer', label: t('dashboard.nav.promptVisualizer'), icon: IconSparkles, highlight: true },
      ],
    },
    {
      label: 'System',
      items: [
        { path: '/collector-status', label: t('dashboard.nav.collectorStatus', 'Collector Status'), icon: IconHeartRateMonitor },
        { path: '/settings', label: t('dashboard.nav.settings'), icon: IconSettings },
      ],
    },
  ];

  // Auto refresh every 30 seconds — only bump trigger, no re-mount
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
      setLastRefresh(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const manualRefresh = async () => {
    try {
      await fetch('/api/refresh', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Refresh failed:', e);
    }
    setRefreshTrigger(prev => prev + 1);
    setLastRefresh(new Date());
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Stack gap={0}>
              <Title order={4}>{t('dashboard.title')}</Title>
              <Text size="xs" c="dimmed" visibleFrom="xs">
                {lastRefresh.toLocaleTimeString('de-DE')}
              </Text>
            </Stack>
          </Group>

          <Group gap="xs">
            <Button
              variant="subtle"
              onClick={manualRefresh}
              color="gray"
              size="compact-sm"
              visibleFrom="xs"
              leftSection={<IconRefresh size={14} />}
            >
              {t('dashboard.refresh')}
            </Button>
            <Button
              variant="subtle"
              onClick={manualRefresh}
              color="gray"
              size="compact-sm"
              hiddenFrom="xs"
              px={6}
            >
              <IconRefresh size={16} />
            </Button>
            <Button
              variant="light"
              color="red"
              size="compact-sm"
              visibleFrom="xs"
              leftSection={<IconLogout size={14} />}
              onClick={onLogout}
            >
              {t('dashboard.logout')}
            </Button>
            <Button
              variant="light"
              color="red"
              size="compact-sm"
              hiddenFrom="xs"
              px={6}
              onClick={onLogout}
            >
              <IconLogout size={16} />
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {NAV_GROUPS.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <Divider my={6} />}
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mb={4}>{group.label}</Text>
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                label={
                  (item as any).highlight
                    ? <Group gap={6}><span>{item.label}</span><Text component="span" size="9px" fw={700} c="white" bg="violet" px={5} py={1} style={{ borderRadius: 4 }}>✦ Clawscope</Text></Group>
                    : item.label
                }
                leftSection={
                  (item as any).highlight
                    ? <item.icon size={18} color="var(--mantine-color-violet-5)" />
                    : <item.icon size={18} />
                }
                active={location.pathname === item.path}
                onClick={() => { navigate(item.path); close(); }}
                variant="light"
                mb={2}
                style={(item as any).highlight && location.pathname !== item.path ? {
                  background: 'rgba(139, 92, 246, 0.08)',
                  borderLeft: '2px solid var(--mantine-color-violet-5)',
                } : undefined}
              />
            ))}
          </React.Fragment>
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/overview" element={<StatsOverview refreshTrigger={refreshTrigger} />} />
          <Route path="/cron-jobs" element={<CronJobsList refreshTrigger={refreshTrigger} />} />
          <Route path="/cron-history" element={<CronHistory refreshTrigger={refreshTrigger} />} />
          <Route path="/sessions" element={<SessionsList refreshTrigger={refreshTrigger} />} />
          <Route path="/costs" element={<CostsPage refreshTrigger={refreshTrigger} />} />
          <Route path="/prompt-history" element={<PromptHistory refreshTrigger={refreshTrigger} />} />
          <Route path="/live-agents" element={<LiveAgents refreshTrigger={refreshTrigger} />} />
          <Route path="/system-prompt" element={<SystemPrompt />} />

          <Route path="/prompt-visualizer" element={<PromptVisualizer />} />
          <Route path="/collector-status" element={<CollectorStatus />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
};
