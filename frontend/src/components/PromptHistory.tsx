import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Title, SimpleGrid, Table, ScrollArea, Text, Group, Center, Loader,
  Alert, Stack, Select, Badge, Collapse, ActionIcon, Tooltip,
  SegmentedControl, Paper, Code, Pagination,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import 'dayjs/locale/de';
import {
  IconHistory, IconMessage, IconTool, IconChevronDown,
  IconChevronRight, IconApi,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api, type PromptSessionInfo, type PromptTurnInfo, type PromptApiCallInfo, type PromptStats } from '../services/api';

interface Props {
  refreshTrigger: number;
}

const USER_COLORS: Record<string, string> = {
  user: 'blue',
  frank: 'green',
  crons: 'orange',
  cron: 'orange',
  subagent: 'grape',
  subagents: 'grape',
  unknown: 'gray',
};

const formatCost = (c: number) => `$${c.toFixed(4)}`;
const formatTokens = (t: number) =>
  t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(1)}K` : `${t}`;
const formatDuration = (ms: number) => {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};
const formatTime = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const TurnDetail: React.FC<{ sessionId: string; turnIndex: number }> = ({ sessionId, turnIndex }) => {
  const { t } = useTranslation();
  const [calls, setCalls] = useState<PromptApiCallInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTurnDetail(sessionId, turnIndex).then(data => {
      setCalls(data.calls);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sessionId, turnIndex]);

  if (loading) return <Loader size="sm" />;
  if (!calls.length) return <Text size="sm" c="dimmed">{t('promptHistory.noApiCalls')}</Text>;

  return (
    <Table highlightOnHover withTableBorder style={{ whiteSpace: 'nowrap' }} fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>#</Table.Th>
          <Table.Th>Model</Table.Th>
          <Table.Th>Stop</Table.Th>
          <Table.Th>Tool</Table.Th>
          <Table.Th ta="right">{t('promptHistory.input')}</Table.Th>
          <Table.Th ta="right">{t('promptHistory.output')}</Table.Th>
          <Table.Th ta="right">{t('promptHistory.cacheRead')}</Table.Th>
          <Table.Th ta="right">{t('promptHistory.cacheWrite')}</Table.Th>
          <Table.Th ta="right">{t('promptHistory.stats.cost')}</Table.Th>
          <Table.Th>{t('promptHistory.preview')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {calls.map(c => (
          <Table.Tr key={c.call_index}>
            <Table.Td>{c.call_index + 1}</Table.Td>
            <Table.Td><Code>{c.model?.split('-').slice(0, 2).join('-') || '?'}</Code></Table.Td>
            <Table.Td>
              <Badge size="xs" color={c.stop_reason === 'toolUse' ? 'orange' : 'green'} variant="light">
                {c.stop_reason || '?'}
              </Badge>
            </Table.Td>
            <Table.Td>
              {c.tool_name && <Badge size="xs" color="grape" variant="light">{c.tool_name}</Badge>}
            </Table.Td>
            <Table.Td ta="right" ff="monospace">{formatTokens(c.tokens_input)}</Table.Td>
            <Table.Td ta="right" ff="monospace">{formatTokens(c.tokens_output)}</Table.Td>
            <Table.Td ta="right" ff="monospace">{formatTokens(c.tokens_cache_read)}</Table.Td>
            <Table.Td ta="right" ff="monospace">{formatTokens(c.tokens_cache_write)}</Table.Td>
            <Table.Td ta="right" ff="monospace">{formatCost(c.cost_total)}</Table.Td>
            <Table.Td maw={200} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <Text size="xs" truncate>{c.content_preview || '—'}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

const TurnCard: React.FC<{ turn: PromptTurnInfo }> = ({ turn }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const tools = turn.tool_names?.split(',').filter(Boolean) || [];

  return (
    <Paper withBorder p="sm" mb="xs">
      <Group justify="space-between" wrap="nowrap" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, overflow: 'hidden' }}>
          <ActionIcon variant="subtle" size="sm">
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <Badge color={USER_COLORS[turn.user_category] || 'gray'} size="sm" variant="light">
            {turn.user_category || '?'}
          </Badge>
          <Text size="sm" truncate style={{ flex: 1 }}>
            {turn.user_message || t('promptHistory.noText')}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={`${turn.api_calls} API Calls`}>
            <Badge leftSection={<IconApi size={10} />} size="xs" variant="light" color="blue">
              {turn.api_calls}
            </Badge>
          </Tooltip>
          {turn.tool_calls > 0 && (
            <Tooltip label={`${turn.tool_calls} Tool Calls: ${turn.tool_names}`}>
              <Badge leftSection={<IconTool size={10} />} size="xs" variant="light" color="grape">
                {turn.tool_calls}
              </Badge>
            </Tooltip>
          )}
          <Text size="xs" c="dimmed" ff="monospace">{formatDuration(turn.duration_ms)}</Text>
          <Text size="xs" fw={600} ff="monospace" c="blue">{formatCost(turn.total_cost)}</Text>
          <Text size="xs" c="dimmed">{formatTime(turn.started_at)}</Text>
        </Group>
      </Group>

      <Collapse expanded={expanded}>
        <Stack mt="sm" gap="xs">
          {turn.user_message && (
            <Paper p="xs" radius="sm" withBorder>
              <Text size="xs" fw={600} mb={4}>{t('promptHistory.user')}</Text>
              <ScrollArea.Autosize mah={400} type="auto">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{turn.user_message}</Text>
              </ScrollArea.Autosize>
            </Paper>
          )}
          {turn.assistant_response && (
            <Paper p="xs" radius="sm" withBorder>
              <Text size="xs" fw={600} mb={4}>{t('promptHistory.assistant')}</Text>
              <ScrollArea.Autosize mah={400} type="auto">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{turn.assistant_response}</Text>
              </ScrollArea.Autosize>
            </Paper>
          )}
          <Group gap="xs">
            <Badge size="xs" variant="outline">{turn.model || '?'}</Badge>
            <Text size="xs" c="dimmed">
              {t('promptHistory.input')}: {formatTokens(turn.total_tokens_input)} · {t('promptHistory.output')}: {formatTokens(turn.total_tokens_output)} · {t('promptHistory.cacheRead')}: {formatTokens(turn.total_tokens_cache_read)} · {t('promptHistory.cacheWrite')}: {formatTokens(turn.total_tokens_cache_write)}
            </Text>
          </Group>
          {tools.length > 0 && (
            <Group gap={4}>
              {tools.map((t, i) => <Badge key={i} size="xs" color="grape" variant="dot">{t}</Badge>)}
            </Group>
          )}
          <Text size="xs" fw={600} mt="xs">API Calls:</Text>
          <ScrollArea type="auto">
            <TurnDetail sessionId={turn.session_id} turnIndex={turn.turn_index} />
          </ScrollArea>
        </Stack>
      </Collapse>
    </Paper>
  );
};

const SessionCard: React.FC<{ session: PromptSessionInfo; onSelect: (id: string) => void }> = ({ session, onSelect }) => {
  return (
    <Paper withBorder p="sm" mb="xs" onClick={() => onSelect(session.session_id)} style={{ cursor: 'pointer' }}>
      <Group justify="space-between">
        <Group gap="sm">
          <Badge color={USER_COLORS[session.user_category] || 'gray'} size="sm" variant="light">
            {session.user_category || '?'}
          </Badge>
          <Code fz="xs">{session.session_id.slice(0, 8)}...</Code>
          <Badge size="xs" variant="outline">{session.primary_model || '?'}</Badge>
        </Group>
        <Group gap="xs">
          <Tooltip label="Turns">
            <Badge leftSection={<IconMessage size={10} />} size="xs" variant="light">{session.total_turns}</Badge>
          </Tooltip>
          <Tooltip label="API Calls">
            <Badge leftSection={<IconApi size={10} />} size="xs" variant="light" color="blue">{session.total_api_calls}</Badge>
          </Tooltip>
          <Text size="xs" fw={600} ff="monospace" c="blue">{formatCost(session.total_cost)}</Text>
          <Text size="xs" c="dimmed">{formatTime(session.started_at)}</Text>
        </Group>
      </Group>
    </Paper>
  );
};

export const PromptHistory: React.FC<Props> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [view, setView] = useState<'turns' | 'sessions'>('turns');
  const [timeMode, setTimeMode] = useState('0');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [turns, setTurns] = useState<PromptTurnInfo[]>([]);
  const [sessions, setSessions] = useState<PromptSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<{value: string, label: string}[]>([
    { value: 'crons', label: 'Crons' },
    { value: 'subagents', label: 'Subagents' },
  ]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;
  const hasLoaded = React.useRef(false);

  // Parse date value (Mantine v9 may return Date or string)
  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  // Format date as local YYYY-MM-DD (not UTC)
  const fmtLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Compute date range based on timeMode
  const getDateRange = useCallback((): { days: number; dateFrom?: string; dateTo?: string } => {
    const now = new Date();
    if (timeMode === 'custom') {
      const dfParsed = toDate(dateFrom);
      const dtParsed = toDate(dateTo);
      const from = dfParsed ? fmtLocal(dfParsed) + 'T00:00:00' : undefined;
      const to = dtParsed ? fmtLocal(new Date(dtParsed.getTime() + 86400000)) + 'T00:00:00' : undefined;
      if (!from && !to) return { days: 365 };
      return { days: 0, dateFrom: from, dateTo: to };
    }
    if (timeMode === '0') {
      const todayStr = now.toISOString().slice(0, 10) + 'T00:00:00';
      return { days: 1, dateFrom: todayStr };
    } else if (timeMode === '2') {
      const today = now.toISOString().slice(0, 10) + 'T00:00:00';
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10) + 'T00:00:00';
      return { days: 2, dateFrom: yesterday, dateTo: today };
    }
    return { days: Number(timeMode) };
  }, [timeMode, dateFrom, dateTo]);

  const fetchData = useCallback(async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      const { days, dateFrom, dateTo } = getDateRange();
      const [statsData, turnsData, sessionsData] = await Promise.all([
        api.getPromptStats(days, userFilter || undefined, dateFrom, dateTo),
        view === 'turns' ? api.getPromptHistory(days, userFilter || undefined, selectedSession || undefined, (page - 1) * PAGE_SIZE, PAGE_SIZE, dateFrom, dateTo) : Promise.resolve({ total: 0, turns: [] }),
        view === 'sessions' ? api.getPromptSessions(days, userFilter || undefined, dateFrom, dateTo) : Promise.resolve({ total: 0, sessions: [] }),
      ]);
      setStats(statsData);
      if (view === 'turns') {
        setTurns(turnsData.turns);
        setTotal(turnsData.total);
      } else {
        setSessions(sessionsData.sessions);
        setTotal(sessionsData.total);
      }
    } catch (err) {
      console.error('Error loading prompt history:', err);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  }, [getDateRange, userFilter, view, page, selectedSession, timeMode]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);

  // Load user options from settings
  useEffect(() => {
    api.rawFetch('/api/settings/users').then(r => r.json()).then((users: any[]) => {
      const opts = users.map((u: any) => ({ value: u.name.toLowerCase(), label: u.name }));
      opts.push({ value: 'crons', label: 'Crons' }, { value: 'subagents', label: 'Subagents' });
      setUserOptions(opts);
    }).catch(() => {});
  }, []);
  useEffect(() => { setPage(1); }, [timeMode, userFilter, view, selectedSession, dateFrom, dateTo]);

  return (
    <Stack gap="lg">
      {/* Header + Filters */}
      <Card withBorder>
        <Group justify="space-between" mb="md" wrap="wrap">
          <Title order={3}><IconHistory size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />{t('promptHistory.title')}</Title>
          <Text size="sm" c="dimmed" mt={4}>{t('promptHistory.description')}</Text>
          <Group gap="sm" align="flex-end">
            <SegmentedControl size="xs" value={view} onChange={(v) => { setView(v as 'turns' | 'sessions'); setSelectedSession(null); }}
              data={[
                { value: 'turns', label: t('promptHistory.views.timeline') },
                { value: 'sessions', label: t('promptHistory.views.sessions') },
              ]} />
            <Select value={timeMode} size="xs" w={120}
              onChange={(v) => setTimeMode(v || '7')}
              data={[
                { value: '0', label: t('promptHistory.filters.today') },
                { value: '2', label: t('promptHistory.filters.yesterday') },
                { value: '7', label: t('promptHistory.filters.7days') },
                { value: '30', label: t('promptHistory.filters.30days') },
                { value: 'custom', label: t('promptHistory.filters.custom') },
              ]} />
            {timeMode === 'custom' && (
              <>
                <DatePickerInput
                  size="xs" w={130} locale="de" valueFormat="DD.MM.YYYY"
                  placeholder={t('promptHistory.filters.from')} value={dateFrom}
                  onChange={(v: any) => setDateFrom(v)} maxDate={dateTo || new Date()}
                  clearable
                />
                <DatePickerInput
                  size="xs" w={130} locale="de" valueFormat="DD.MM.YYYY"
                  placeholder={t('promptHistory.filters.to')} value={dateTo}
                  onChange={(v: any) => setDateTo(v)} minDate={dateFrom || undefined} maxDate={new Date()}
                  clearable
                />
              </>
            )}
            <Select value={userFilter} size="xs" w={120} clearable placeholder={t('promptHistory.filters.allUsers')}
              onChange={(v) => setUserFilter(v)}
              data={userOptions} />
          </Group>
        </Group>

        {/* Stats */}
        {stats && (
          <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
            <Paper p="xs" radius="sm" withBorder ta="center">
              <Text size="xs" c="dimmed">{t('promptHistory.stats.sessions')}</Text>
              <Text size="lg" fw={700}>{stats.total_sessions}</Text>
            </Paper>
            <Paper p="xs" radius="sm" withBorder ta="center">
              <Text size="xs" c="dimmed">{t('promptHistory.stats.turns')}</Text>
              <Text size="lg" fw={700}>{stats.total_turns.toLocaleString()}</Text>
            </Paper>
            <Paper p="xs" radius="sm" withBorder ta="center">
              <Text size="xs" c="dimmed">{t('promptHistory.stats.apiCalls')}</Text>
              <Text size="lg" fw={700}>{stats.total_api_calls.toLocaleString()}</Text>
            </Paper>
            <Paper p="xs" radius="sm" withBorder ta="center">
              <Text size="xs" c="dimmed">{t('promptHistory.stats.tokens')}</Text>
              <Text size="lg" fw={700}>{formatTokens(stats.total_tokens)}</Text>
            </Paper>
            <Paper p="xs" radius="sm" withBorder ta="center">
              <Text size="xs" c="dimmed">{t('promptHistory.stats.cost')}</Text>
              <Text size="lg" fw={700} c="blue">${stats.total_cost.toFixed(2)}</Text>
            </Paper>
          </SimpleGrid>
        )}
      </Card>

      {/* Selected Session Header */}
      {selectedSession && (
        <Alert color="blue" withCloseButton onClose={() => setSelectedSession(null)}>
          <Text size="sm">{t('promptHistory.session')} <Code>{selectedSession.slice(0, 12)}...</Code></Text>
        </Alert>
      )}

      {/* Content */}
      {loading ? (
        <Center p="xl"><Loader /></Center>
      ) : view === 'turns' ? (
        <Stack gap={0}>
          {turns.length === 0 ? (
            <Text c="dimmed" ta="center" p="xl">{t('promptHistory.noTurns')}</Text>
          ) : (
            turns.map((t) => <TurnCard key={`${t.session_id}-${t.turn_index}`} turn={t} />)
          )}
          {total > PAGE_SIZE && (
            <Center mt="md">
              <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} />
            </Center>
          )}
        </Stack>
      ) : (
        <Stack gap={0}>
          {sessions.length === 0 ? (
            <Text c="dimmed" ta="center" p="xl">{t('promptHistory.noSessions')}</Text>
          ) : (
            sessions.map(s => (
              <SessionCard key={s.session_id} session={s} onSelect={(id) => { setSelectedSession(id); setView('turns'); }} />
            ))
          )}
        </Stack>
      )}
    </Stack>
  );
};
