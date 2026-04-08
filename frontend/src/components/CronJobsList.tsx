import React, { useState, useRef, useEffect } from 'react';
import {
  Card,
  Title,
  Table,
  ScrollArea,
  Badge,
  Text,
  Stack,
  Center,
  Loader,
  Alert,
  Button,
  Group,
  Code,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChevronUp,
  IconChevronDown,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconHelp,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api, type CronJob } from '../services/api';
import { CronJobDetail } from './CronJobDetail';

interface CronJobsListProps {
  refreshTrigger: number;
}

export const CronJobsList: React.FC<CronJobsListProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof CronJob>('total_cost');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showErrors, setShowErrors] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);

  useEffect(() => {
    fetchJobs();
  }, [refreshTrigger]);

  const fetchJobs = async () => {
    const isRefresh = hasLoaded.current;
    try {
      if (!isRefresh) setLoading(true);
      if (!isRefresh) setError(null);
      const data = await api.getCronJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      if (!isRefresh) setError(t('cronJobs.loading'));
      console.error('Error fetching cron jobs:', err);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  };

  const handleSort = (field: keyof CronJob) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedJobs = [...jobs].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;
    
    const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'ok':
        return { color: 'green', icon: IconCheck, label: status };
      case 'error':
        return { color: 'red', icon: IconX, label: status };
      case 'overloaded':
        return { color: 'yellow', icon: IconAlertTriangle, label: status };
      default:
        return { color: 'gray', icon: IconHelp, label: status || t('common.unknown') };
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return t('common.na');
    return new Date(dateString).toLocaleString('de-DE');
  };

  const formatTokens = (t: number) => {
    if (t === 0) return '0';
    return t >= 1e12 ? `${(t / 1e12).toFixed(1)} Bio` : 
           t >= 1e9 ? `${(t / 1e9).toFixed(1)} Mrd` : 
           t >= 1e6 ? `${(t / 1e6).toFixed(1)} Mio` : 
           t >= 1e3 ? `${(t / 1e3).toFixed(0)} Tsd` : 
           t.toLocaleString('de-DE');
  };

  const formatCost = (c: number) => {
    if (c === 0) return '$0';
    return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
  };

  const TableHeader = ({ field, children }: { field: keyof CronJob; children: React.ReactNode }) => {
    const isActive = sortField === field;
    return (
      <Table.Th style={{ whiteSpace: 'nowrap' }}>
        <UnstyledButton onClick={() => handleSort(field)} style={{ width: '100%' }}>
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text fw={500}>{children}</Text>
            {isActive && (
              sortDirection === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />
            )}
          </Group>
        </UnstyledButton>
      </Table.Th>
    );
  };

  if (loading) {
    return (
      <Center p="xl">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text>{t('cronJobs.loading')}</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light">
        <Stack gap="sm">
          <Text>{error}</Text>
          <Button size="xs" onClick={fetchJobs} variant="light" color="red">
            {t('common.retry')}
          </Button>
        </Stack>
      </Alert>
    );
  }

  const errorJobs = jobs.filter(job => job.last_error);

  return (
    <Stack gap="lg">
      <Card withBorder>
        <Group justify="space-between" mb="md">
          <Title order={3}>{t('cronJobs.title')} ({jobs.length})</Title>
          <Text size="sm" c="dimmed" mt={4}>{t('cronJobs.description')}</Text>
          {errorJobs.length > 0 && (
            <Button
              variant="light"
              color="red"
              size="xs"
              onClick={() => setShowErrors(!showErrors)}
            >
              {errorJobs.length} {t('cronJobs.errors')}
            </Button>
          )}
        </Group>

        {jobs.length === 0 ? (
          <Center p="xl">
            <Text c="dimmed">{t('cronJobs.noCronJobs')}</Text>
          </Center>
        ) : (
          <ScrollArea type="auto">
          <Table highlightOnHover verticalSpacing="sm" miw={900}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ whiteSpace: 'nowrap', width: 30 }}></Table.Th>
                <TableHeader field="name">{t('cronJobs.columns.name')}</TableHeader>
                <TableHeader field="schedule">{t('cronJobs.columns.schedule')}</TableHeader>
                <TableHeader field="model">{t('cronJobs.columns.model')}</TableHeader>
                <TableHeader field="last_status">{t('cronJobs.columns.status')}</TableHeader>
                <Table.Th>{t('cronJobs.columns.errors')}</Table.Th>
                <TableHeader field="total_runs">{t('cronJobs.columns.runs')}</TableHeader>
                <TableHeader field="avg_tokens_per_run">{t('cronJobs.columns.tokensPerRun')}</TableHeader>
                <TableHeader field="avg_cost_per_run">{t('cronJobs.columns.costPerRun')}</TableHeader>
                <TableHeader field="total_cost">{t('cronJobs.columns.totalCost')}</TableHeader>
                <TableHeader field="next_run">{t('cronJobs.columns.nextRun')}</TableHeader>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedJobs.map((job) => {
                const statusBadge = getStatusBadge(job.last_status);
                const StatusIcon = statusBadge.icon;
                
                return (
                  <Table.Tr key={job.id} onClick={() => setSelectedJob(job)} style={{ cursor: 'pointer' }}>
                    <Table.Td style={{ width: 30, paddingRight: 0 }}>
                      <div style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: job.enabled === false ? 'var(--mantine-color-gray-4)' : 'var(--mantine-color-green-6)',
                        boxShadow: job.enabled === false ? 'none' : '0 0 4px var(--mantine-color-green-4)',
                      }} />
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} c={job.enabled === false ? 'dimmed' : undefined}>{job.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Code color="dark">{job.schedule}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{job.model}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={statusBadge.color}
                        variant="light"
                        leftSection={<StatusIcon size={12} />}
                      >
                        {statusBadge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {job.consecutive_errors > 0 ? (
                        <Badge color="red" variant="filled" size="sm">
                          {job.consecutive_errors}
                        </Badge>
                      ) : (
                        <Text size="sm" c="dimmed">0</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {job.total_runs || 0}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {job.avg_tokens_per_run > 0 ? formatTokens(job.avg_tokens_per_run) : '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {job.avg_cost_per_run > 0 ? formatCost(job.avg_cost_per_run) : '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text 
                        size="sm" 
                        ff="monospace" 
                        fw={job.total_cost > 0 ? 500 : undefined} 
                        c={job.total_cost > 1 ? 'orange' : job.total_cost > 0 ? 'blue' : 'dimmed'}
                      >
                        {job.total_cost > 0 ? formatCost(job.total_cost) : '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {job.enabled === false ? '—' : formatDate(job.next_run)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          </ScrollArea>
        )}
      </Card>

      {/* Job Detail Overlay */}
      <CronJobDetail
        job={selectedJob}
        opened={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        onToggle={fetchJobs}
      />

      {/* Error Details */}
      {errorJobs.length > 0 && showErrors && (
        <Card withBorder>
          <Title order={4} mb="md">{t('cronJobs.recentErrors')}</Title>
          <Stack gap="sm">
            {errorJobs.map((job) => (
              <Alert key={job.id} color="red" variant="light">
                <Group justify="space-between" align="flex-start">
                  <Stack gap="xs">
                    <Text fw={500}>{job.name}</Text>
                    <Code color="red" style={{ whiteSpace: 'pre-wrap' }}>
                      {job.last_error}
                    </Code>
                  </Stack>
                </Group>
              </Alert>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
};
