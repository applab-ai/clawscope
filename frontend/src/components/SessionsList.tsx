import React, { useState, useRef, useEffect } from 'react';
import {
  SimpleGrid,
  Card,
  Title,
  Table,
  ScrollArea,
  Badge,
  Text,
  Group,
  ThemeIcon,
  Stack,
  Center,
  Loader,
  Alert,
  Button,
  UnstyledButton,
  Code,
} from '@mantine/core';
import {
  IconActivity,
  IconTarget,
  IconCurrencyDollar,
  IconUser,
  IconClock,
  IconRobot,
  IconHelp,
  IconChevronUp,
  IconChevronDown,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api, type ActiveSession } from '../services/api';

interface SessionsListProps {
  refreshTrigger: number;
}

export const SessionsList: React.FC<SessionsListProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof ActiveSession>('session_key');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchSessions();
  }, [refreshTrigger]);

  const fetchSessions = async () => {
    try {
      if (sessions.length === 0) if (!hasLoaded.current) setLoading(true);
      setError(null);
      const data = await api.getActiveSessions();
      setSessions(data);
    } catch (err) {
      setError(t('sessions.loading'));
      console.error('Error fetching sessions:', err);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  };

  const handleSort = (field: keyof ActiveSession) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedSessions = [...sessions].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;
    
    const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const getSessionTypeBadge = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'direct':
        return { color: 'blue', icon: IconUser, label: 'Direct' };
      case 'cron':
        return { color: 'green', icon: IconClock, label: 'Cron' };
      case 'subagent':
        return { color: 'grape', icon: IconRobot, label: 'Subagent' };
      default:
        return { color: 'gray', icon: IconHelp, label: type || t('common.unknown') };
    }
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const formatRuntime = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  };

  const totalTokens = sessions.reduce((sum, session) => sum + session.tokens_total, 0);
  const totalCost = sessions.reduce((sum, session) => sum + session.estimated_cost, 0);

  const TableHeader = ({ field, children }: { field: keyof ActiveSession; children: React.ReactNode }) => {
    const isActive = sortField === field;
    return (
      <Table.Th>
        <UnstyledButton onClick={() => handleSort(field)} style={{ width: '100%' }}>
          <Group gap="xs" justify="space-between">
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
          <Text>{t('sessions.loading')}</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light">
        <Stack gap="sm">
          <Text>{error}</Text>
          <Button size="xs" onClick={fetchSessions} variant="light" color="red">
            {t('common.retry')}
          </Button>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      {/* Summary Cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        <Card padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>{t('sessions.activeSessions')}</Text>
              <Text size="xl" fw={700}>{sessions.length}</Text>
            </Stack>
            <ThemeIcon color="blue" size={50} radius="md" variant="light">
              <IconActivity size={30} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>{t('sessions.totalTokens')}</Text>
              <Text size="xl" fw={700}>{formatTokens(totalTokens)}</Text>
            </Stack>
            <ThemeIcon color="green" size={50} radius="md" variant="light">
              <IconTarget size={30} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>{t('sessions.estimatedCost')}</Text>
              <Text size="xl" fw={700}>{formatCost(totalCost)}</Text>
            </Stack>
            <ThemeIcon color="orange" size={50} radius="md" variant="light">
              <IconCurrencyDollar size={30} />
            </ThemeIcon>
          </Group>
        </Card>
      </SimpleGrid>

      {/* Sessions Table */}
      <Card withBorder>
        <Title order={3} mb="md">{t('sessions.title')} ({sessions.length})</Title>
        <Text size="sm" c="dimmed" mb="md">{t('sessions.description')}</Text>

        {sessions.length === 0 ? (
          <Center p="xl">
            <Text c="dimmed">{t('sessions.noSessions')}</Text>
          </Center>
        ) : (
          <ScrollArea type="auto">
          <Table highlightOnHover verticalSpacing="sm" miw={900}>
            <Table.Thead>
              <Table.Tr>
                <TableHeader field="session_key">{t('sessions.columns.sessionKey')}</TableHeader>
                <TableHeader field="session_type">{t('sessions.columns.type')}</TableHeader>
                <TableHeader field="model">{t('sessions.columns.model')}</TableHeader>
                <TableHeader field="tokens_total">{t('sessions.columns.tokens')}</TableHeader>
                <TableHeader field="estimated_cost">{t('sessions.columns.cost')}</TableHeader>
                <TableHeader field="runtime_minutes">{t('sessions.columns.runtime')}</TableHeader>
                <Table.Th>{t('sessions.columns.status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedSessions.map((session) => {
                const typeBadge = getSessionTypeBadge(session.session_type);
                const TypeIcon = typeBadge.icon;
                
                return (
                  <Table.Tr key={session.id}>
                    <Table.Td>
                      <Code color="dark" style={{ fontSize: '11px', maxWidth: '200px' }}>
                        {session.session_key.length > 20 
                          ? `${session.session_key.slice(0, 20)}...` 
                          : session.session_key
                        }
                      </Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={typeBadge.color}
                        variant="light"
                        leftSection={<TypeIcon size={12} />}
                      >
                        {typeBadge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{session.model}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm" fw={500}>
                          {formatTokens(session.tokens_total)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          In: {formatTokens(session.tokens_input)} | Out: {formatTokens(session.tokens_output)}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>{formatCost(session.estimated_cost)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatRuntime(session.runtime_minutes)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="outline" size="sm">
                        {session.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          </ScrollArea>
        )}
      </Card>
    </Stack>
  );
};
