import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Card, Title, SimpleGrid, Table, ScrollArea, Text, Group, Center, Loader,
  Alert, Button, Stack, Select, ThemeIcon, Badge, Paper, Progress,
} from '@mantine/core';
import { PieChart, LineChart, BarChart as MantineBarChart } from '@mantine/charts';
import { IconTrendingUp, IconCoins } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { api, type TokenUsage } from '../services/api';

interface CostsPageProps {
  refreshTrigger: number;
}

const COLORS = ['blue.6', 'green.6', 'orange.6', 'red.6', 'grape.6', 'yellow.6', 'cyan.6', 'lime.6'];

export const CostsPage: React.FC<CostsPageProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [allUsage, setAllUsage] = useState<TokenUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<string>('14');
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'line' | 'bar'>('bar');
  const [apiKeyLabels, setApiKeyLabels] = useState<Record<string, string>>({});
  const [insights, setInsights] = useState<any>(null);

  useEffect(() => {
    fetchData();
    // Fetch API key labels from settings
    api.rawFetch('/api/settings/api-key-labels').then(r => r.json()).then(setApiKeyLabels).catch(() => {});
    const days = timeMode === 'month' ? 365 : Math.max(Number(timeMode), 1);
    api.rawFetch(`/api/cost-insights?days=${days}`).then(r => r.json()).then(setInsights).catch(() => {});
  }, [refreshTrigger, timeMode, monthFilter]);

  const fetchData = async () => {
    const isRefresh = hasLoaded.current;
    try {
      if (!isRefresh) setLoading(true);
      if (!isRefresh) setError(null);
      const days = timeMode === 'month' ? 365 : Math.max(Number(timeMode), 1);
      const data = await api.getTokenUsage(days);
      setAllUsage(data);
      setError(null);
    } catch (err) {
      if (!isRefresh) setError(t('common.error'));
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  };

  // Available months
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    allUsage.forEach(item => months.add(item.date.substring(0, 7)));
    const names = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return Array.from(months).sort().reverse().map(m => {
      const [year, mon] = m.split('-');
      return { value: m, label: `${names[parseInt(mon)]} ${year}` };
    });
  }, [allUsage]);

  // Filtered data
  const filteredUsage = useMemo(() => {
    if (timeMode === 'month' && monthFilter) {
      return allUsage.filter(item => item.date.startsWith(monthFilter));
    }
    if (timeMode === '0') {
      const today = new Date().toISOString().slice(0, 10);
      return allUsage.filter(item => item.date === today);
    }
    if (timeMode === '1') {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      return allUsage.filter(item => item.date === yesterday);
    }
    return allUsage;
  }, [allUsage, timeMode, monthFilter]);

  // Daily Data - gateway data for daily costs (source='gateway', api_key='total')
  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; total_cost: number }>();
    filteredUsage.forEach(item => {
      if (item.source !== 'gateway' || item.api_key !== 'total') return;
      const existing = map.get(item.date);
      if (existing) existing.total_cost += item.cost_total;
      else map.set(item.date, { date: item.date, total_cost: item.cost_total });
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredUsage]);

  // By API Key - nur Transcript-Daten für Agent-Breakdown (source='transcript')
  const byApiKey = useMemo(() => {
    const map = new Map<string, { api_key: string; api_key_name: string; total_cost: number; total_tokens: number }>();
    filteredUsage.forEach(item => {
      if (item.source !== 'transcript') return;
      const existing = map.get(item.api_key);
      const tokens = item.tokens_input + item.tokens_output + (item.tokens_cache_write || 0) + (item.tokens_cache_read || 0);
      if (existing) {
        existing.total_cost += item.cost_total;
        existing.total_tokens += tokens;
      } else {
        map.set(item.api_key, {
          api_key: item.api_key,
          api_key_name: item.api_key_name || apiKeyLabels[item.api_key] || item.api_key,
          total_cost: item.cost_total,
          total_tokens: tokens,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total_cost - a.total_cost);
  }, [filteredUsage]);

  // By Model - nur Transcript-Daten für Model-Breakdown (source='transcript')
  const byModel = useMemo(() => {
    const map = new Map<string, { model: string; total_cost: number; total_tokens: number }>();
    filteredUsage.forEach(item => {
      if (item.source !== 'transcript') return;
      const existing = map.get(item.model);
      const tokens = item.tokens_input + item.tokens_output + (item.tokens_cache_write || 0) + (item.tokens_cache_read || 0);
      if (existing) {
        existing.total_cost += item.cost_total;
        existing.total_tokens += tokens;
      } else {
        map.set(item.model, { model: item.model, total_cost: item.cost_total, total_tokens: tokens });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total_cost - a.total_cost);
  }, [filteredUsage]);

  // Gateway total costs
  const gatewayCost = filteredUsage
    .filter(item => item.source === 'gateway' && item.api_key === 'total')
    .reduce((s, i) => s + i.cost_total, 0);
  // Transcript-Summe (für Prozent-Berechnung in Tabellen)
  const transcriptCost = byApiKey.reduce((s, i) => s + i.total_cost, 0);
  // Fallback: wenn Gateway $0 aber Transcript vorhanden → Transcript nehmen
  const totalCost = gatewayCost > 0 ? gatewayCost : transcriptCost;
  const totalTokens = filteredUsage
    .filter(item => gatewayCost > 0
      ? (item.source === 'gateway' && item.api_key === 'total')
      : (item.source === 'transcript'))
    .reduce((s, i) => s + i.tokens_input + i.tokens_output + (i.tokens_cache_write || 0) + (i.tokens_cache_read || 0), 0);

  const periodLabels: Record<string, string> = {
    '0': t('costs.filters.today'),
    '1': t('costs.filters.yesterday'),
    '7': t('costs.filters.7days'),
    '30': t('costs.filters.30days'),
    '90': t('costs.filters.90days'),
  };
  const periodLabel = timeMode === 'month' && monthFilter
    ? availableMonths.find(m => m.value === monthFilter)?.label || monthFilter
    : periodLabels[timeMode] || `${timeMode} Tage`;

  const formatCost = (c: number) => `$${c.toFixed(2)}`;
  const formatTokens = (t: number) => t >= 1e12 ? `${(t / 1e12).toFixed(1)} Bio` : t >= 1e9 ? `${(t / 1e9).toFixed(1)} Mrd` : t >= 1e6 ? `${(t / 1e6).toFixed(1)} Mio` : t >= 1e3 ? `${(t / 1e3).toFixed(0)} Tsd` : `${t}`;
  const formatPct = (v: number, total: number) => total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0%';
  if (loading) return <Center p="xl"><Loader size="lg" /></Center>;
  if (error) return <Alert color="red"><Text>{error}</Text><Button size="xs" onClick={fetchData} mt="xs">{t('common.retry')}</Button></Alert>;

  return (
    <Stack gap="lg">
      {/* Filter + Summary */}
      <Card withBorder>
        <Group justify="space-between" mb="md" wrap="wrap">
          <Title order={3}>{t('costs.title')}</Title>
          <Text size="sm" c="dimmed" mt={4}>{t('costs.description')}</Text>
          <Group gap="sm">
            <Select label={t('costs.filters.period')} value={timeMode} size="sm" w={110}
              onChange={(v) => {
                setTimeMode(v || '30');
                if (v !== 'month') setMonthFilter(null);
                else if (!monthFilter && availableMonths.length > 0) setMonthFilter(availableMonths[0].value);
              }}
              data={[
                { value: '0', label: t('costs.filters.today') },
                { value: '1', label: t('costs.filters.yesterday') },
                { value: '7', label: t('costs.filters.7days') },
                { value: '14', label: t('costs.filters.14days') },
                { value: '30', label: t('costs.filters.30days') },
                { value: '90', label: t('costs.filters.90days') },
                { value: 'month', label: t('costs.filters.month') },
              ]}
            />
            {timeMode === 'month' && (
              <Select label={t('costs.filters.monthLabel')} value={monthFilter} onChange={setMonthFilter}
                data={availableMonths} size="sm" w={130} />
            )}
            <Select label={t('costs.filters.chart')} value={chartType} size="sm" w={110}
              onChange={(v) => setChartType(v as 'line' | 'bar' || 'bar')}
              data={[
                { value: 'line', label: t('costs.filters.line') },
                { value: 'bar', label: t('costs.filters.bar') },
              ]}
            />
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>{t('costs.summary.costs', { period: periodLabel })}</Text>
              <Text size="xl" fw={700} c="blue">${totalCost.toFixed(2)}</Text>
            </Stack>
            <ThemeIcon color="blue" size={50} radius="md" variant="light"><IconCoins size={30} /></ThemeIcon>
          </Group>
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>{t('costs.summary.tokens', { period: periodLabel })}</Text>
              <Text size="xl" fw={700} c="green">{formatTokens(totalTokens)}</Text>
            </Stack>
            <ThemeIcon color="green" size={50} radius="md" variant="light"><IconTrendingUp size={30} /></ThemeIcon>
          </Group>
        </SimpleGrid>
      </Card>

      {/* Daily Chart */}
      {dailyData.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="md">{t('costs.sections.dailyCosts')}</Title>
          {chartType === 'line' ? (
            <LineChart h={300} data={dailyData} dataKey="date"
              series={[{ name: 'total_cost', color: 'blue.6', label: 'Cost ($)' }]}
              curveType="monotone" withLegend withDots />
          ) : (
            <MantineBarChart h={300} data={dailyData} dataKey="date"
              series={[{ name: 'total_cost', color: 'blue.6', label: 'Cost ($)' }]}
              withLegend />
          )}
        </Card>
      )}

      {/* Costs by Agent */}
      {(() => {
        const byAgent = new Map<string, { agent: string; tokens: number; cost: number }>();
        filteredUsage.filter(item => item.source === 'transcript').forEach(item => {
          const agent = item.api_key_name || item.api_key;
          const tokens = item.tokens_input + item.tokens_output + (item.tokens_cache_write || 0) + (item.tokens_cache_read || 0);
          const existing = byAgent.get(agent);
          if (existing) {
            existing.tokens += tokens;
            existing.cost += item.cost_total;
          } else {
            byAgent.set(agent, { agent, tokens, cost: item.cost_total });
          }
        });
        const agentData = Array.from(byAgent.values()).filter(a => a.cost > 0).sort((a, b) => b.cost - a.cost);
        const totalAgentCost = agentData.reduce((s, a) => s + a.cost, 0);
        if (agentData.length === 0) return null;
        return (
          <Card withBorder>
            <Title order={4} mb="md">{t('costs.sections.byAgent', { period: periodLabel })}</Title>
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
              <Center>
                <PieChart size={220}
                  data={agentData.filter(a => a.cost > 0).map((a, i) => ({
                    name: a.agent, value: parseFloat(a.cost.toFixed(4)), color: COLORS[i % COLORS.length]
                  }))}
                  withLabelsLine labelsPosition="outside" labelsType="percent" withTooltip />
              </Center>
              <ScrollArea type="auto">
              <Table highlightOnHover miw={500} style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('costs.table.agent')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.tokens')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.cost')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.percent')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {agentData.map((a, i) => (
                    <Table.Tr key={a.agent}>
                      <Table.Td>
                        <Group gap="xs">
                          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: `var(--mantine-color-${COLORS[i % COLORS.length].replace('.', '-')})` }} />
                          <Text size="sm" fw={500}>{a.agent}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right"><Text size="sm" ff="monospace">{formatTokens(a.tokens)}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm" ff="monospace">{formatCost(a.cost)}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm">{formatPct(a.cost, totalAgentCost)}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                  <Table.Tr style={{ fontWeight: 600 }}>
                    <Table.Td>{t('costs.table.total')}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{formatTokens(agentData.reduce((s, x) => s + x.tokens, 0))}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{formatCost(totalAgentCost)}</Table.Td>
                    <Table.Td ta="right">100%</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              </ScrollArea>
            </SimpleGrid>
          </Card>
        );
      })()}

      {/* Costs by Channel */}
      {(() => {
        const byChannel = new Map<string, { channel: string; users: Set<string>; tokens: number; cost: number }>();
        filteredUsage.filter(item => item.source === 'transcript').forEach(item => {
          const ch = item.channel || 'system';
          const existing = byChannel.get(ch);
          const tokens = item.tokens_input + item.tokens_output + (item.tokens_cache_write || 0) + (item.tokens_cache_read || 0);
          if (existing) {
            existing.tokens += tokens;
            existing.cost += item.cost_total;
            existing.users.add(item.api_key);
          } else {
            byChannel.set(ch, { channel: ch, users: new Set([item.api_key]), tokens, cost: item.cost_total });
          }
        });
        const channelData = Array.from(byChannel.values()).filter(a => a.cost > 0).sort((a, b) => b.cost - a.cost);
        const totalChannelCost = channelData.reduce((s, a) => s + a.cost, 0);
        if (channelData.length === 0) return null;

        const channelBadge = (ch: string) => {
          const map: Record<string, { color: string; label: string }> = {
            telegram: { color: 'blue', label: 'Telegram' },
            whatsapp: { color: 'green', label: 'WhatsApp' },
            discord: { color: 'violet', label: 'Discord' },
            slack: { color: 'grape', label: 'Slack' },
            signal: { color: 'indigo', label: 'Signal' },
            system: { color: 'gray', label: 'System' },
          };
          const info = map[ch] || { color: 'dark', label: ch };
          return <Badge color={info.color} variant="filled" size="sm">{info.label}</Badge>;
        };

        return (
          <Card withBorder>
            <Title order={4} mb="md">{t('costs.sections.byChannel', { period: periodLabel })}</Title>
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
              <Center>
                <PieChart size={220}
                  data={channelData.map((a, i) => ({
                    name: a.channel, value: parseFloat(a.cost.toFixed(4)), color: COLORS[i % COLORS.length]
                  }))}
                  withLabelsLine labelsPosition="outside" labelsType="percent" withTooltip />
              </Center>
              <ScrollArea type="auto">
              <Table highlightOnHover miw={500} style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('costs.table.channel')}</Table.Th>
                    <Table.Th>{t('costs.table.users')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.tokens')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.cost')}</Table.Th>
                    <Table.Th ta="right">{t('costs.table.percent')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {channelData.map((a, i) => (
                    <Table.Tr key={a.channel}>
                      <Table.Td>
                        <Group gap="xs">
                          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: `var(--mantine-color-${COLORS[i % COLORS.length].replace('.', '-')})` }} />
                          {channelBadge(a.channel)}
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="sm">{Array.from(a.users).join(', ')}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm" ff="monospace">{formatTokens(a.tokens)}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm" ff="monospace">{formatCost(a.cost)}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm">{formatPct(a.cost, totalChannelCost)}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                  <Table.Tr style={{ fontWeight: 600 }}>
                    <Table.Td>{t('costs.table.total')}</Table.Td>
                    <Table.Td></Table.Td>
                    <Table.Td ta="right" ff="monospace">{formatTokens(channelData.reduce((s, x) => s + x.tokens, 0))}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{formatCost(totalChannelCost)}</Table.Td>
                    <Table.Td ta="right">100%</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              </ScrollArea>
            </SimpleGrid>
          </Card>
        );
      })()}

      {/* Cost by Model */}
      <Card withBorder>
        <SimpleGrid cols={1} spacing="xl">
          {/* By Model */}
          <Stack>
            <Title order={4} mb="md">{t('costs.sections.byModel')} ({periodLabel})</Title>
            {byModel.length > 0 && (
              <Center>
                <PieChart size={200}
                  data={byModel.map((item, i) => ({ name: item.model, value: item.total_cost, color: COLORS[i % COLORS.length] }))}
                  withLabelsLine labelsPosition="outside" labelsType="percent" withTooltip />
              </Center>
            )}
            <ScrollArea type="auto">
            <Table highlightOnHover miw={600} style={{ whiteSpace: 'nowrap' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('costs.table.model')}</Table.Th>
                  <Table.Th ta="right">{t('costs.table.tokens')}</Table.Th>
                  <Table.Th ta="right">{t('costs.table.cost')}</Table.Th>
                  <Table.Th ta="right">{t('costs.table.percent')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {byModel.map((item, i) => (
                  <Table.Tr key={item.model}>
                    <Table.Td>
                      <Group gap="xs">
                        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: `var(--mantine-color-${COLORS[i % COLORS.length].replace('.', '-')})` }} />
                        <Text size="sm">{item.model}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right"><Text size="sm" ff="monospace">{formatTokens(item.total_tokens)}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="sm" ff="monospace">{formatCost(item.total_cost)}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="sm">{formatPct(item.total_cost, transcriptCost)}</Text></Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr style={{ borderTop: '2px solid var(--mantine-color-dark-4)' }}>
                  <Table.Td><Text size="sm" fw={700}>{t('costs.table.total')}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm" fw={700} ff="monospace">{formatTokens(byModel.reduce((s, i) => s + i.total_tokens, 0))}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm" fw={700} ff="monospace">{formatCost(transcriptCost)}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm" fw={700}>100%</Text></Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            </ScrollArea>
          </Stack>
        </SimpleGrid>
      </Card>

      {/* Cost Insights */}
      {insights && (
        <>
          {/* 1. Cost per Message */}
          <Card withBorder>
            <Title order={4} mb="md">{t('insights.costPerMessage', { period: periodLabel })}</Title>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              {insights.cost_per_message?.map((item: any) => (
                <Paper key={item.category} p="md" radius="md" withBorder style={{ textAlign: 'center' }}>
                  <Text size="xs" c="dimmed" mb={4}>{item.category}</Text>
                  <Text size="xl" fw={700} c="blue">{formatCost(item.avg_cost)}</Text>
                  <Text size="xs" c="dimmed">{item.turns} Turns · {formatCost(item.total_cost)}</Text>
                </Paper>
              ))}
            </SimpleGrid>
          </Card>

          {/* 2. Cache Savings */}
          {insights.cache_savings && (
            <Card withBorder>
              <Title order={4} mb="md">🛡️ Cache-Ersparnis ({periodLabel})</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Paper p="md" radius="md" style={{ background: 'linear-gradient(135deg, var(--mantine-color-green-9), var(--mantine-color-teal-9))', textAlign: 'center' }}>
                  <Text size="xs" c="green.2" mb={4}>Ersparnis</Text>
                  <Text size="xl" fw={700} c="white">{formatCost(insights.cache_savings.savings)}</Text>
                  <Text size="sm" c="green.2">{insights.cache_savings.savings_pct}% günstiger</Text>
                </Paper>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Ohne Cache:</Text>
                    <Text size="sm" fw={600}>{formatCost(insights.cache_savings.estimated_cost_without_cache)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Mit Cache:</Text>
                    <Text size="sm" fw={600} c="green">{formatCost(insights.cache_savings.actual_cost)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Cache-Tokens gelesen:</Text>
                    <Text size="sm" fw={600}>{formatTokens(insights.cache_savings.total_cache_read_tokens)}</Text>
                  </Group>
                  <Progress value={insights.cache_savings.savings_pct} color="green" size="lg" radius="md" mt="xs" />
                </Stack>
              </SimpleGrid>
            </Card>
          )}

          {/* 3. Cost trend — placeholder for later */}

          {/* 4. Most Expensive Turn */}
          {insights.most_expensive_turn?.cost > 0 && (
            <Card withBorder>
              <Title order={4} mb="md">🔥 Teuerster Turn ({periodLabel})</Title>
              <Paper p="md" radius="md" withBorder style={{ borderLeft: '4px solid var(--mantine-color-red-6)' }}>
                <Group justify="space-between" wrap="wrap">
                  <Group gap="sm">
                    <Text size="xl" fw={700} c="red">{formatCost(insights.most_expensive_turn.cost)}</Text>
                    <Badge color={insights.most_expensive_turn.model.includes('opus') ? 'violet' : 'blue'} variant="filled">
                      {insights.most_expensive_turn.model.replace('claude-', '')}
                    </Badge>
                  </Group>
                  <Group gap="sm">
                    <Text size="sm" c="dimmed">{formatTokens(insights.most_expensive_turn.tokens)} Tokens</Text>
                    <Badge color="gray" variant="light">{insights.most_expensive_turn.category}</Badge>
                  </Group>
                </Group>
              </Paper>
            </Card>
          )}

          {/* 5. Output-Effizienz pro Dollar */}
          <Card withBorder>
            <Title order={4} mb="md">⚡ Output pro Dollar ({periodLabel})</Title>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              {insights.output_efficiency?.map((item: any, i: number) => (
                <Paper key={item.category} p="md" radius="md" withBorder style={{ textAlign: 'center' }}>
                  <Text size="xs" c="dimmed" mb={4}>{item.category}</Text>
                  <Text size="xl" fw={700} c={i === 0 ? 'green' : 'dimmed'}>{(item.output_per_dollar / 1000).toFixed(1)}K</Text>
                  <Text size="xs" c="dimmed">Tokens/$</Text>
                </Paper>
              ))}
            </SimpleGrid>
          </Card>

          {/* 6. Cron ROI */}
          {insights.cron_roi && (
            <Card withBorder>
              <Title order={4} mb="md">{t('insights.cronCosts', { period: periodLabel })}</Title>
              <SimpleGrid cols={{ base: 3 }} spacing="md">
                <Paper p="md" radius="md" withBorder style={{ textAlign: 'center' }}>
                  <Text size="xs" c="dimmed" mb={4}>Runs</Text>
                  <Text size="xl" fw={700}>{insights.cron_roi.total_runs}</Text>
                </Paper>
                <Paper p="md" radius="md" withBorder style={{ textAlign: 'center' }}>
                  <Text size="xs" c="dimmed" mb={4}>{t('insights.total')}</Text>
                  <Text size="xl" fw={700}>{formatCost(insights.cron_roi.total_cost)}</Text>
                </Paper>
                <Paper p="md" radius="md" withBorder style={{ textAlign: 'center' }}>
                  <Text size="xs" c="dimmed" mb={4}>Pro Run</Text>
                  <Text size="xl" fw={700} c="orange">{formatCost(insights.cron_roi.cost_per_run)}</Text>
                </Paper>
              </SimpleGrid>
            </Card>
          )}
        </>
      )}
    </Stack>
  );
};
