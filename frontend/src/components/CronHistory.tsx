import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Title,
  Text,
  Stack,
  Group,
  Badge,
  Table,
  ScrollArea,
  Loader,
  Center,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconPlayerSkipForward,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { CronJobDetail } from './CronJobDetail';
import type { CronJob } from '../services/api';

interface HistoryRun {
  name: string;
  jobId: string;
  agentId: string;
  model: string;
  runAtMs: number;
  status: string;
  durationMs: number;
  error: string;
  consecutiveErrors: number;
  delivered: boolean;
  nextRunAtMs?: number;
  avgTokensPerRun?: number;
  avgCostPerRun?: number;
  totalCost?: number;
  totalRuns?: number;
}

interface CronHistoryProps {
  refreshTrigger: number;
}

const PAGE_SIZE = 50;

export const CronHistory: React.FC<CronHistoryProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    // Reset and reload on refresh
    setRuns([]);
    setHasMore(true);
    fetchHistory(0, true);
  }, [refreshTrigger]);

  const fetchHistory = async (offset: number, isInitial: boolean = false) => {
    try {
      if (isInitial) if (!hasLoaded.current) setLoading(true);
      else setLoadingMore(true);

      const resp = await fetch(`/api/cron-history?offset=${offset}&limit=${PAGE_SIZE}`, {
        credentials: 'include',
      });
      const data = await resp.json();
      const newRuns = data.runs || [];

      if (isInitial) {
        setRuns(newRuns);
      } else {
        setRuns(prev => [...prev, ...newRuns]);
      }
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
    } catch (e) {
      console.error('Failed to fetch cron history:', e);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
      setLoadingMore(false);
    }
  };

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    fetchHistory(runs.length);
  }, [loadingMore, hasMore, runs.length]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  const formatTime = (ms: number) => {
    if (!ms) return '-';
    const d = new Date(ms);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (ms: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(0)}s`;
    const m = Math.floor(s / 60);
    const rest = Math.floor(s % 60);
    return `${m}m ${rest}s`;
  };

  const formatTokens = (t?: number) => {
    if (!t) return '-';
    return t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}K` : `${t}`;
  };

  const formatCost = (c?: number) => {
    if (!c) return '-';
    return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ok': return <IconCheck size={14} color="var(--mantine-color-green-6)" />;
      case 'error': return <IconX size={14} color="var(--mantine-color-red-6)" />;
      case 'skipped': return <IconPlayerSkipForward size={14} color="var(--mantine-color-gray-5)" />;
      default: return <IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />;
    }
  };

  const timeAgo = (ms: number) => {
    const diff = Date.now() - ms;
    if (diff < 60000) return t('cronHistory.justNow');
    if (diff < 3600000) return t('cronHistory.minutesAgo', { m: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('cronHistory.hoursAgo', { h: Math.floor(diff / 3600000) });
    return t('cronHistory.daysAgo', { d: Math.floor(diff / 86400000) });
  };

  if (loading) {
    return <Center p="xl"><Loader size="lg" /></Center>;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t('cronHistory.title')}</Title>
        <Text size="sm" c="dimmed" mt={4}>{t('cronHistory.description')}</Text>
        <Badge variant="light" size="lg">{t('cronHistory.runsOf', { loaded: runs.length, total })}</Badge>
      </Group>

      <Card withBorder>
        <ScrollArea type="auto">
          <Table highlightOnHover verticalSpacing="sm" miw={1000}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.time')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.status')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.job')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.agent')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.duration')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.avgTokens')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.avgCost')}</Table.Th>
                <Table.Th style={{ whiteSpace: 'nowrap' }}>{t('cronHistory.columns.error')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run, i) => (
                <Table.Tr key={`${run.jobId}-${run.runAtMs}-${i}`} onClick={() => setSelectedJob({
                  id: i,
                  name: run.name,
                  schedule: '',
                  model: run.model,
                  last_status: run.status,
                  last_error: run.error || undefined,
                  consecutive_errors: run.consecutiveErrors,
                  total_tokens: 0,
                  total_cost: 0,
                  total_runs: 0,
                  avg_tokens_per_run: run.avgTokensPerRun || 0,
                  avg_cost_per_run: run.avgCostPerRun || 0,
                  updated_at: new Date(run.runAtMs).toISOString(),
                } as CronJob)} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Tooltip label={new Date(run.runAtMs).toLocaleString('de-DE')}>
                      <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
                        {formatTime(run.runAtMs)}
                      </Text>
                    </Tooltip>
                    <Text size="xs" c="dimmed">{timeAgo(run.runAtMs)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={run.status === 'ok' ? 'green' : run.status === 'error' ? 'red' : run.status === 'skipped' ? 'gray' : 'yellow'}
                      variant="light"
                      size="sm"
                      leftSection={getStatusIcon(run.status)}
                    >
                      {run.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{run.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm" color={run.agentId === 'main' ? 'orange' : 'cyan'}>
                      {run.agentId}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{formatDuration(run.durationMs)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{formatTokens(run.avgTokensPerRun)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{formatCost(run.avgCostPerRun)}</Text>
                  </Table.Td>
                  <Table.Td style={{ maxWidth: 250 }}>
                    {run.error ? (
                      <Tooltip label={run.error} multiline w={400}>
                        <Text size="xs" c="red" lineClamp={1}>{run.error}</Text>
                      </Tooltip>
                    ) : (
                      <Text size="xs" c="dimmed">-</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {/* Sentinel row for infinite scroll */}
              <Table.Tr ref={sentinelRef} style={{ height: 1 }}>
                <Table.Td colSpan={8} style={{ padding: 0, border: 'none' }}>
                  {loadingMore && (
                    <Center py="md">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed" ml="sm">{t('cronHistory.loadingMore')}</Text>
                    </Center>
                  )}
                  {!hasMore && runs.length > 0 && (
                    <Center py="sm">
                      <Text size="xs" c="dimmed">{t('cronHistory.allLoaded', { total })}</Text>
                    </Center>
                  )}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <CronJobDetail
        job={selectedJob}
        opened={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        onToggle={() => fetchHistory(0, true)}
      />
    </Stack>
  );
};
