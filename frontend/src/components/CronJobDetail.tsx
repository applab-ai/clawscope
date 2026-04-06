import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Title,
  Text,
  Badge,
  Button,
  Stack,
  Group,
  Code,
  Loader,
  Center,
  Table,
  ScrollArea,
  Divider,
  Paper,
  SimpleGrid,
  ThemeIcon,
} from '@mantine/core';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconCoins,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import type { CronJob } from '../services/api';

interface CronJobDetailProps {
  job: CronJob | null;
  opened: boolean;
  onClose: () => void;
  onToggle?: () => void;
}

interface JobRun {
  ts: number;
  action: string;
  status: string;
  summary?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  delivered?: boolean;
  deliveryStatus?: string;
  sessionId?: string;
}

interface JobDetail {
  id: string;
  name: string;
  agentId: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; tz?: string; at?: string; everyMs?: number };
  sessionTarget: string;
  payload: { kind: string; message: string; timeoutSeconds?: number };
  delivery: { mode: string; to?: string; channel?: string };
  state: {
    lastStatus?: string;
    lastError?: string;
    lastRunAtMs?: number;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
  };
}

export const CronJobDetail: React.FC<CronJobDetailProps> = ({ job, opened, onClose, onToggle }) => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (opened && job) {
      fetchRuns(job.name);
      setIsEnabled(job.enabled !== false);
    }
  }, [opened, job]);

  const fetchRuns = async (jobName: string) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/cron-jobs/${encodeURIComponent(jobName)}/runs`, {
        credentials: 'include',
      });
      const data = await resp.json();
      setRuns(data.runs || []);
      setDetail(data.job || null);
    } catch (e) {
      console.error('Failed to fetch runs:', e);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (ms: number) => {
    if (!ms) return 'N/A';
    return new Date(ms).toLocaleString('de-DE');
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rest = Math.floor(s % 60);
    return `${m}m ${rest}s`;
  };

  const formatTokens = (t?: number) => {
    if (!t) return '-';
    return t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}K` : `${t}`;
  };

  if (!job) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="md">
          <Title order={3}>{job.name}</Title>
          <Button
            size="compact-sm"
            variant={isEnabled ? 'light' : 'outline'}
            color={isEnabled ? 'green' : 'gray'}
            leftSection={isEnabled ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
            loading={toggling}
            onClick={async () => {
              setToggling(true);
              try {
                const resp = await fetch(`/api/cron-jobs/${encodeURIComponent(job.name)}/toggle`, {
                  method: 'POST',
                  credentials: 'include',
                });
                if (resp.ok) {
                  const data = await resp.json();
                  setIsEnabled(data.enabled);
                  onToggle?.();
                }
              } catch (err) {
                console.error('Toggle failed:', err);
              } finally {
                setToggling(false);
              }
            }}
          >
            {isEnabled ? 'AN' : 'AUS'}
          </Button>
        </Group>
      }
      fullScreen
      transitionProps={{ transition: 'fade', duration: 200 }}
    >
      <Stack gap="lg">
        {/* Status Overview */}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          <Paper withBorder p="md" radius="md">
            <Group gap="xs">
              <ThemeIcon
                color={job.last_status === 'ok' ? 'green' : job.last_status === 'error' ? 'red' : 'gray'}
                variant="light"
                size="lg"
              >
                {job.last_status === 'ok' ? <IconCheck size={20} /> : <IconX size={20} />}
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">Status</Text>
                <Text fw={600}>{job.last_status || 'Unknown'}</Text>
              </div>
            </Group>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Group gap="xs">
              <ThemeIcon color="blue" variant="light" size="lg">
                <IconPlayerPlay size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">Runs</Text>
                <Text fw={600}>{job.total_runs || 0}</Text>
              </div>
            </Group>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Group gap="xs">
              <ThemeIcon color="orange" variant="light" size="lg">
                <IconCoins size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">{t('costs.table.total')}</Text>
                <Text fw={600}>${job.total_cost?.toFixed(2) || '0'}</Text>
              </div>
            </Group>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Group gap="xs">
              <ThemeIcon color={job.consecutive_errors > 0 ? 'red' : 'green'} variant="light" size="lg">
                <IconAlertTriangle size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">Errors</Text>
                <Text fw={600}>{job.consecutive_errors}</Text>
              </div>
            </Group>
          </Paper>
        </SimpleGrid>

        {/* Job Info */}
        <Paper withBorder p="md">
          <Title order={5} mb="sm">Job Info</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Schedule:</Text><Code>{job.schedule}</Code></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Model:</Text><Badge variant="light">{job.model || 'default'}</Badge></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Agent:</Text><Badge variant="light" color="cyan">{detail?.agentId || '-'}</Badge></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Target:</Text><Text size="sm">{detail?.sessionTarget || '-'}</Text></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Next Run:</Text><Text size="sm">{job.next_run ? new Date(job.next_run).toLocaleString('de-DE') : '-'}</Text></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Ø Tokens/Run:</Text><Text size="sm" ff="monospace">{formatTokens(job.avg_tokens_per_run)}</Text></Group>
            <Group gap="xs"><Text size="sm" c="dimmed" w={120}>Ø $/Run:</Text><Text size="sm" ff="monospace">${job.avg_cost_per_run?.toFixed(3) || '0'}</Text></Group>
          </SimpleGrid>
        </Paper>

        {/* Last Error */}
        {job.last_error && (
          <Paper withBorder p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
            <Title order={5} mb="sm" c="red">Last Error</Title>
            <Code block color="red" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {job.last_error}
            </Code>
          </Paper>
        )}

        {/* Prompt */}
        {detail?.payload?.message && (
          <Paper withBorder p="md">
            <Title order={5} mb="sm">Prompt</Title>
            <Code block style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {detail.payload.message}
            </Code>
          </Paper>
        )}

        <Divider />

        {/* Run History */}
        <Title order={4}>Run History (letzte 20)</Title>

        {loading ? (
          <Center p="xl"><Loader /></Center>
        ) : runs.length === 0 ? (
          <Text c="dimmed">{t('visualizer.noRuns')}</Text>
        ) : (
          <ScrollArea type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={800}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Zeit</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Dauer</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Tokens</Table.Th>
                  <Table.Th>Delivery</Table.Th>
                  <Table.Th>Summary / Error</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.filter(r => r.action === 'finished').map((run, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Text size="sm">{formatDate(run.ts)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={run.status === 'ok' ? 'green' : 'red'}
                        variant="light"
                        size="sm"
                      >
                        {run.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">{formatDuration(run.durationMs)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{run.model || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">{formatTokens(run.usage?.total_tokens)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {run.delivered ? (
                        <Badge color="green" variant="light" size="sm">✓</Badge>
                      ) : run.deliveryStatus === 'not-requested' ? (
                        <Text size="sm" c="dimmed">-</Text>
                      ) : (
                        <Badge color="yellow" variant="light" size="sm">{run.deliveryStatus || '?'}</Badge>
                      )}
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 400 }}>
                      <Text size="xs" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>
                        {run.summary || '-'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
};
