import React, { useState, useEffect } from 'react';
import {
  Card,
  Text,
  Group,
  Stack,
  Badge,
  Table,
  ThemeIcon,
  Code,
  Collapse,
  ActionIcon,
  Tooltip,
  SimpleGrid,
  Paper,
  Loader,
  Center,
} from '@mantine/core';
import {
  IconDatabase,
  IconCircleCheck,
  IconAlertTriangle,
  IconX,
  IconClock,
  IconChevronDown,
  IconChevronUp,
  IconServer,
  IconFile,
  IconRefresh,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface Collector {
  name: string;
  description: string;
  schedule: string;
  last_run: string | null;
  status: string;
  records: number;
  latest_data?: string | null;
  details?: string;
}

interface LaunchAgent {
  label: string;
  pid: string | null;
  exit_code: number | null;
  running: boolean;
}

interface DbFile {
  name: string;
  size_mb: number;
}

interface CollectorStatusData {
  collectors: Collector[];
  launch_agents: LaunchAgent[];
  db_files: DbFile[];
  log_tail: string;
}

export const CollectorStatus: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<CollectorStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);

  const fetchData = async () => {
    try {
      const resp = await api.request('/collector-status');
      setData(resp);
    } catch (e) {
      console.error('Failed to fetch collector status', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok': return <ThemeIcon size={22} radius="xl" color="green" variant="filled"><IconCircleCheck size={14} /></ThemeIcon>;
      case 'error': return <ThemeIcon size={22} radius="xl" color="red" variant="filled"><IconX size={14} /></ThemeIcon>;
      default: return <ThemeIcon size={22} radius="xl" color="gray" variant="filled"><IconClock size={14} /></ThemeIcon>;
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { color: string; label: string }> = {
      ok: { color: 'green', label: 'OK' },
      error: { color: 'red', label: 'Error' },
      never: { color: 'gray', label: 'Never' },
    };
    const s = map[status] || map.never;
    return <Badge color={s.color} variant="filled" size="sm">{s.label}</Badge>;
  };

  if (loading) return <Center p="xl"><Loader size="sm" /></Center>;
  if (!data) return null;

  const totalRecords = data.collectors.reduce((sum, c) => sum + c.records, 0);
  const totalDbSize = data.db_files.reduce((sum, f) => sum + f.size_mb, 0);
  const allOk = data.collectors.every(c => c.status === 'ok');
  const agentsRunning = data.launch_agents.filter(a => a.running).length;

  return (
    <Stack gap="md">
      {/* Summary cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Paper p="sm" radius="md" withBorder>
          <Stack gap={2} align="center">
            <Text size="xs" c="dimmed">{t('collector.collectors', 'Collectors')}</Text>
            <Group gap={4}>
              {allOk
                ? <ThemeIcon size={20} radius="xl" color="green" variant="light"><IconCircleCheck size={14} /></ThemeIcon>
                : <ThemeIcon size={20} radius="xl" color="red" variant="light"><IconAlertTriangle size={14} /></ThemeIcon>}
              <Text fw={700}>{data.collectors.filter(c => c.status === 'ok').length}/{data.collectors.length}</Text>
            </Group>
          </Stack>
        </Paper>
        <Paper p="sm" radius="md" withBorder>
          <Stack gap={2} align="center">
            <Text size="xs" c="dimmed">{t('collector.services', 'Services')}</Text>
            <Group gap={4}>
              <ThemeIcon size={20} radius="xl" color={agentsRunning === data.launch_agents.length ? 'green' : 'yellow'} variant="light"><IconServer size={14} /></ThemeIcon>
              <Text fw={700}>{agentsRunning}/{data.launch_agents.length}</Text>
            </Group>
          </Stack>
        </Paper>
        <Paper p="sm" radius="md" withBorder>
          <Stack gap={2} align="center">
            <Text size="xs" c="dimmed">{t('collector.records', 'Records')}</Text>
            <Text fw={700}>{totalRecords.toLocaleString('de-DE')}</Text>
          </Stack>
        </Paper>
        <Paper p="sm" radius="md" withBorder>
          <Stack gap={2} align="center">
            <Text size="xs" c="dimmed">{t('collector.dbSize', 'DB Size')}</Text>
            <Text fw={700}>{totalDbSize.toFixed(1)} MB</Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Collector cards (mobile-first) */}
      <Card padding="sm" radius="md" withBorder>
        <Group justify="space-between" mb="xs">
          <Text fw={600} size="sm">{t('collector.dataCollectors', 'Data Collectors')}</Text>
          <Tooltip label={t('common.refresh', 'Refresh')}>
            <ActionIcon variant="subtle" size="sm" onClick={fetchData}><IconRefresh size={16} /></ActionIcon>
          </Tooltip>
        </Group>
        <Stack gap="xs">
          {data.collectors.map((c, i) => (
            <Paper key={i} p="sm" radius="sm" withBorder style={{ borderLeft: `3px solid var(--mantine-color-${c.status === 'ok' ? 'green' : c.status === 'error' ? 'red' : 'gray'}-6)` }}>
              <Group justify="space-between" wrap="nowrap" mb={4}>
                <Group gap="xs" wrap="nowrap">
                  {statusIcon(c.status)}
                  <Text size="sm" fw={600}>{c.name}</Text>
                </Group>
                {statusBadge(c.status)}
              </Group>
              <Text size="xs" c="dimmed" mb={6}>{c.description}</Text>
              <Group gap="lg">
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">{t('collector.schedule', 'Schedule')}</Text>
                  <Badge variant="light" size="xs">{c.schedule}</Badge>
                </Stack>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">{t('collector.lastRun', 'Last Run')}</Text>
                  <Text size="xs">{c.last_run || '—'}</Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">{t('collector.records', 'Records')}</Text>
                  <Text size="xs" fw={600}>{c.records.toLocaleString('de-DE')}</Text>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Card>

      {/* Launch Agents + DB files */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Card padding="sm" radius="md" withBorder>
          <Text fw={600} size="sm" mb="xs">{t('collector.launchAgents', 'LaunchAgents')}</Text>
          {data.launch_agents.map((a, i) => (
            <Group key={i} justify="space-between" py={4}>
              <Group gap="xs">
                <IconServer size={14} style={{ opacity: 0.5 }} />
                <Text size="xs" style={{ fontFamily: 'monospace' }}>{a.label.replace('ai.openclaw.', '')}</Text>
              </Group>
              <Badge color={a.running ? 'green' : (a.label.includes('collector') ? 'blue' : 'red')} variant="filled" size="xs">
                {a.running ? `PID ${a.pid}` : (a.label.includes('collector') ? 'interval' : 'stopped')}
              </Badge>
            </Group>
          ))}
        </Card>
        <Card padding="sm" radius="md" withBorder>
          <Text fw={600} size="sm" mb="xs">{t('collector.databases', 'Databases')}</Text>
          {data.db_files.map((f, i) => (
            <Group key={i} justify="space-between" py={4}>
              <Group gap="xs">
                <IconDatabase size={14} style={{ opacity: 0.5 }} />
                <Text size="xs" style={{ fontFamily: 'monospace' }}>{f.name}</Text>
              </Group>
              <Text size="xs" fw={600}>{f.size_mb} MB</Text>
            </Group>
          ))}
        </Card>
      </SimpleGrid>

      {/* Log tail */}
      <Card padding="sm" radius="md" withBorder>
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => setLogOpen(!logOpen)}
        >
          <Group gap="xs">
            <IconFile size={16} style={{ opacity: 0.5 }} />
            <Text fw={600} size="sm">{t('collector.recentLogs', 'Recent Logs')}</Text>
          </Group>
          {logOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </Group>
        <Collapse expanded={logOpen}>
          <Code block mt="xs" style={{ maxHeight: 300, overflow: 'auto', fontSize: '0.75rem' }}>
            {data.log_tail || 'No logs'}
          </Code>
        </Collapse>
      </Card>
    </Stack>
  );
};
