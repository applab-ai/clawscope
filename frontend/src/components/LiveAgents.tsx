import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Title, SimpleGrid, ScrollArea, Text, Group, Center, Loader,
  Stack, Select, Badge, Collapse, ActionIcon, Tooltip,
  Paper, Code, Timeline,
} from '@mantine/core';
import {
  IconRobot, IconChevronDown, IconChevronRight,
  IconTool, IconApi, IconPlayerPlay, IconCheck,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api, type LiveAgentInfo, type AgentDetail, type AgentToolCall } from '../services/api';

interface Props {
  refreshTrigger: number;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'green',
  completed: 'blue',
  archived: 'gray',
  deleted: 'red',
};

const TYPE_COLORS: Record<string, string> = {
  subagent: 'grape',
  cron: 'orange',
  user: 'blue',
  frank: 'green',
  unknown: 'gray',
};

const formatCost = (c: number) => `$${c.toFixed(4)}`;
const formatTokens = (t: number) =>
  t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(1)}K` : `${t}`;
const formatDuration = (ms: number) => {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m ${secs}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
const formatTime = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// Tool call detail view
const ToolCallTimeline: React.FC<{ tools: AgentToolCall[] }> = ({ tools }) => {
  const { t } = useTranslation();
  if (tools.length === 0) return <Text size="xs" c="dimmed">{t('liveAgents.toolCalls')}: 0</Text>;
  
  return (
    <Timeline active={tools.length - 1} bulletSize={20} lineWidth={2}>
      {tools.map((tc, i) => (
        <Timeline.Item
          key={i}
          bullet={<IconTool size={12} />}
          title={
            <Group gap="xs">
              <Badge size="xs" color="grape" variant="light">{tc.name}</Badge>
              <Text size="xs" c="dimmed">{formatTime(tc.timestamp)}</Text>
            </Group>
          }
        >
          {tc.arguments && tc.arguments !== '{}' && (
            <Paper p="xs" radius="sm" withBorder mt={4}>
              <Text size="xs" c="dimmed" fw={600}>Input:</Text>
              <Code block fz="xs" style={{ maxHeight: 100, overflow: 'auto' }}>
                {tc.arguments}
              </Code>
            </Paper>
          )}
          {tc.result_preview && (
            <Paper p="xs" radius="sm" withBorder mt={4}>
              <Text size="xs" c="dimmed" fw={600}>Result:</Text>
              <ScrollArea.Autosize mah={150} type="auto">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{tc.result_preview}</Text>
              </ScrollArea.Autosize>
            </Paper>
          )}
        </Timeline.Item>
      ))}
    </Timeline>
  );
};

// Agent card with expand/collapse
const AgentCard: React.FC<{ agent: LiveAgentInfo }> = ({ agent }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  const isRunning = agent.status === 'running';
  
  const loadDetail = async () => {
    if (detail) return;
    setLoadingDetail(true);
    try {
      const d = await api.getAgentDetail(agent.session_id);
      setDetail(d);
    } catch (err) {
      console.error('Error loading agent detail:', err);
    }
    setLoadingDetail(false);
  };
  
  const handleToggle = () => {
    if (!expanded) loadDetail();
    setExpanded(!expanded);
  };
  
  return (
    <Paper withBorder p="sm" mb="xs" style={isRunning ? { borderColor: 'var(--mantine-color-green-6)', borderWidth: 2 } : undefined}>
      <Group justify="space-between" wrap="nowrap" onClick={handleToggle} style={{ cursor: 'pointer' }}>
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, overflow: 'hidden' }}>
          <ActionIcon variant="subtle" size="sm">
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          
          {/* Status indicator */}
          <Badge
            color={STATUS_COLORS[agent.status] || 'gray'}
            size="sm"
            variant={isRunning ? 'filled' : 'light'}
            leftSection={isRunning ? <IconPlayerPlay size={10} /> : <IconCheck size={10} />}
          >
            {agent.status}
          </Badge>
          
          {/* Type badge */}
          <Badge color={TYPE_COLORS[agent.session_type] || 'gray'} size="sm" variant="light">
            {agent.session_type}
          </Badge>
          
          {/* Task preview */}
          <Text size="sm" truncate style={{ flex: 1 }}>
            {agent.task || `(${t('liveAgents.task').replace(':', '')})`}
          </Text>
        </Group>
        
        <Group gap="xs" wrap="nowrap">
          {/* Model */}
          <Code fz={10}>{agent.model?.replace('claude-', '').replace('-20250514', '') || '?'}</Code>
          
          {/* Tool calls */}
          {agent.tool_calls_count > 0 && (
            <Tooltip label={`${agent.tool_calls_count} ${t('liveAgents.toolCalls')}`}>
              <Badge leftSection={<IconTool size={10} />} size="xs" variant="light" color="grape">
                {agent.tool_calls_count}
              </Badge>
            </Tooltip>
          )}
          
          {/* API calls */}
          <Tooltip label={`${agent.api_calls} API Calls`}>
            <Badge leftSection={<IconApi size={10} />} size="xs" variant="light" color="blue">
              {agent.api_calls}
            </Badge>
          </Tooltip>
          
          {/* Duration */}
          <Text size="xs" c="dimmed" ff="monospace">{formatDuration(agent.duration_ms)}</Text>
          
          {/* Cost */}
          <Text size="xs" fw={600} ff="monospace" c="blue">{formatCost(agent.total_cost)}</Text>
          
          {/* Timestamp */}
          <Text size="xs" c="dimmed">{formatTime(agent.started_at)}</Text>
        </Group>
      </Group>
      
      <Collapse expanded={expanded}>
        <Stack mt="sm" gap="sm">
          {/* Task full text */}
          {agent.task && (
            <Paper p="xs" radius="sm" withBorder>
              <Text size="xs" fw={600} mb={4}>{t('liveAgents.task')}</Text>
              <ScrollArea.Autosize mah={200} type="auto">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{agent.task}</Text>
              </ScrollArea.Autosize>
            </Paper>
          )}
          
          {/* Token breakdown */}
          <Group gap="xs">
            <Badge size="xs" variant="outline">{agent.model}</Badge>
            <Text size="xs" c="dimmed">
              Input: {formatTokens(agent.tokens_input)} · Output: {formatTokens(agent.tokens_output)} · Total: {formatTokens(agent.tokens_total)}
            </Text>
          </Group>
          
          {/* Final response */}
          {agent.final_response && (
            <Paper p="xs" radius="sm" withBorder>
              <Text size="xs" fw={600} mb={4}>{t('liveAgents.result')}</Text>
              <ScrollArea.Autosize mah={300} type="auto">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{agent.final_response}</Text>
              </ScrollArea.Autosize>
            </Paper>
          )}
          
          {/* Tool call timeline (loaded on demand) */}
          {loadingDetail ? (
            <Center p="md"><Loader size="sm" /></Center>
          ) : detail ? (
            <Paper p="xs" radius="sm" withBorder>
              <Text size="xs" fw={600} mb={8}>{t('liveAgents.toolCalls')} ({detail.tool_calls.length}):</Text>
              <ScrollArea.Autosize mah={500} type="auto">
                <ToolCallTimeline tools={detail.tool_calls} />
              </ScrollArea.Autosize>
            </Paper>
          ) : null}
        </Stack>
      </Collapse>
    </Paper>
  );
};

export const LiveAgents: React.FC<Props> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<LiveAgentInfo[]>([]);
  const [stats, setStats] = useState({ total: 0, running: 0, total_cost: 0, total_api_calls: 0, total_tool_calls: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [hours, setHours] = useState('24');
  const hasLoaded = useRef(false);
  
  const fetchData = useCallback(async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      const data = await api.getLiveAgents(
        Number(hours),
        undefined,
        statusFilter || undefined,
      );
      setAgents(data.agents);
      setStats({
        total: data.total,
        running: data.running,
        total_cost: data.total_cost,
        total_api_calls: data.total_api_calls,
        total_tool_calls: data.total_tool_calls,
      });
    } catch (err) {
      console.error('Error loading agents:', err);
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  }, [hours, statusFilter]);
  
  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  
  const running = agents.filter(a => a.status === 'running');
  const completed = agents.filter(a => a.status !== 'running');
  
  return (
    <Stack gap="lg">
      {/* Header + Filters */}
      <Card withBorder>
        <Group justify="space-between" mb="md" wrap="wrap">
          <Title order={3}>
            <IconRobot size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('liveAgents.title')}
            {stats.running > 0 && (
              <Badge ml="sm" color="green" variant="filled" size="lg">{stats.running} {t('liveAgents.running')}</Badge>
            )}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>{t('liveAgents.description')}</Text>
          <Group gap="sm" align="flex-end">
            <Select value={hours} size="xs" w={100}
              onChange={(v) => setHours(v || '24')}
              data={[
                { value: '1', label: t('liveAgents.filters.1h') },
                { value: '6', label: t('liveAgents.filters.6h') },
                { value: '24', label: t('liveAgents.filters.24h') },
                { value: '72', label: t('liveAgents.filters.3days') },
                { value: '168', label: t('liveAgents.filters.7days') },
              ]} />
            <Select value={statusFilter} size="xs" w={120} clearable placeholder={t('liveAgents.filters.allStatus')}
              onChange={(v) => setStatusFilter(v)}
              data={[
                { value: 'running', label: t('liveAgents.running') },
                { value: 'completed', label: t('liveAgents.filters.completed') },
              ]} />
          </Group>
        </Group>
        
        {/* Stats */}
        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
          <Paper p="xs" radius="sm" withBorder ta="center">
            <Text size="xs" c="dimmed">{t('liveAgents.stats.agents')}</Text>
            <Text size="lg" fw={700}>{stats.total}</Text>
          </Paper>
          <Paper p="xs" radius="sm" withBorder ta="center">
            <Text size="xs" c="dimmed">{t('liveAgents.stats.active')}</Text>
            <Text size="lg" fw={700} c="green">{stats.running}</Text>
          </Paper>
          <Paper p="xs" radius="sm" withBorder ta="center">
            <Text size="xs" c="dimmed">{t('liveAgents.stats.apiCalls')}</Text>
            <Text size="lg" fw={700}>{stats.total_api_calls.toLocaleString()}</Text>
          </Paper>
          <Paper p="xs" radius="sm" withBorder ta="center">
            <Text size="xs" c="dimmed">{t('liveAgents.stats.toolCalls')}</Text>
            <Text size="lg" fw={700}>{stats.total_tool_calls.toLocaleString()}</Text>
          </Paper>
          <Paper p="xs" radius="sm" withBorder ta="center">
            <Text size="xs" c="dimmed">{t('liveAgents.stats.costs')}</Text>
            <Text size="lg" fw={700} c="blue">${stats.total_cost.toFixed(2)}</Text>
          </Paper>
        </SimpleGrid>
      </Card>
      
      {/* Running agents first */}
      {running.length > 0 && (
        <Card withBorder p="sm">
          <Title order={5} mb="sm" c="green">
            <IconPlayerPlay size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {t('liveAgents.active')} ({running.length})
          </Title>
          {running.map(a => <AgentCard key={a.session_id} agent={a} />)}
        </Card>
      )}
      
      {/* Content */}
      {loading ? (
        <Center p="xl"><Loader /></Center>
      ) : (
        <Stack gap={0}>
          {completed.length === 0 && running.length === 0 ? (
            <Text c="dimmed" ta="center" p="xl">{t('liveAgents.noAgents')}</Text>
          ) : (
            completed.map(a => <AgentCard key={a.session_id} agent={a} />)
          )}
        </Stack>
      )}
    </Stack>
  );
};
