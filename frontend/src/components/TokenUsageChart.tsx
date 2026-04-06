import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Title,
  Group,
  Select,
  Stack,
  SimpleGrid,
  ThemeIcon,
  Text,
  Center,
  Loader,
  Alert,
  Button,
} from '@mantine/core';
import {
  LineChart,
  BarChart as MantineBarChart,
} from '@mantine/charts';
import {
  IconTrendingUp,
  IconCoins,
} from '@tabler/icons-react';
import { api, type TokenUsage } from '../services/api';

interface TokenUsageChartProps {
  refreshTrigger: number;
}

export const TokenUsageChart: React.FC<TokenUsageChartProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<TokenUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [timeMode, setTimeMode] = useState<string>('7');
  const [monthFilter, setMonthFilter] = useState<string | null>(null);

  useEffect(() => {
    fetchUsage();
  }, [refreshTrigger, timeMode, monthFilter]);

  const fetchUsage = async () => {
    try {
      if (usage.length === 0) setLoading(true);
      setError(null);
      const fetchDays = timeMode === 'month' ? 90 : Number(timeMode);
      const data = await api.getTokenUsage(fetchDays);
      setUsage(data);
    } catch (err) {
      setError('Failed to load token usage');
      console.error('Error fetching token usage:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get available months from data
  const availableMonths = React.useMemo(() => {
    const months = new Set<string>();
    usage.forEach(item => {
      const month = item.date.substring(0, 7); // "2026-03"
      months.add(month);
    });
    return Array.from(months).sort().reverse().map(m => {
      const [year, mon] = m.split('-');
      const names = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      return { value: m, label: `${names[parseInt(mon)]} ${year}` };
    });
  }, [usage]);

  // Filter data by selected month (only when timeMode is 'month')
  const filteredUsage = React.useMemo(() => {
    if (timeMode !== 'month' || !monthFilter) return usage;
    return usage.filter(item => item.date.startsWith(monthFilter));
  }, [usage, timeMode, monthFilter]);

  // Aggregate data by date
  const aggregateByDate = () => {
    const dateMap = new Map<string, { date: string; total_cost: number; total_tokens: number }>();
    
    filteredUsage.forEach(item => {
      const existing = dateMap.get(item.date);
      if (existing) {
        existing.total_cost += item.cost_total;
        existing.total_tokens += item.tokens_input + item.tokens_output;
      } else {
        dateMap.set(item.date, {
          date: item.date,
          total_cost: item.cost_total,
          total_tokens: item.tokens_input + item.tokens_output
        });
      }
    });
    
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  // Aggregate data by API key
  const aggregateByApiKey = () => {
    const keyMap = new Map<string, { api_key_name: string; total_cost: number; total_tokens: number }>();
    
    filteredUsage.forEach(item => {
      const existing = keyMap.get(item.api_key_name);
      if (existing) {
        existing.total_cost += item.cost_total;
        existing.total_tokens += item.tokens_input + item.tokens_output;
      } else {
        keyMap.set(item.api_key_name, {
          api_key_name: item.api_key_name,
          total_cost: item.cost_total,
          total_tokens: item.tokens_input + item.tokens_output
        });
      }
    });
    
    return Array.from(keyMap.values()).sort((a, b) => b.total_cost - a.total_cost);
  };

  const dailyData = aggregateByDate();
  const apiKeyData = aggregateByApiKey();
  
  const totalCost = filteredUsage.reduce((sum, item) => sum + item.cost_total, 0);
  const totalTokens = filteredUsage.reduce((sum, item) => sum + item.tokens_input + item.tokens_output, 0);

  if (loading) {
    return (
      <Center p="xl">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text>Loading token usage...</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light">
        <Stack gap="sm">
          <Text>{error}</Text>
          <Button size="xs" onClick={fetchUsage} variant="light" color="red">
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      {/* Controls & Summary */}
      <Card withBorder>
        <Group justify="space-between" mb="md">
          <Title order={3}>Token Usage & Costs</Title>
          <Group gap="md">
            <Select
              label={t('costs.filters.period')}
              value={timeMode}
              onChange={(value) => {
                setTimeMode(value || '7');
                if (value !== 'month') setMonthFilter(null);
                else if (!monthFilter && availableMonths.length > 0) setMonthFilter(availableMonths[0].value);
              }}
              data={[
                { value: '7', label: '7 Tage' },
                { value: '14', label: '14 Tage' },
                { value: '30', label: '30 Tage' },
                { value: '90', label: '90 Tage' },
                { value: 'month', label: 'Monat' },
              ]}
              size="sm"
              w={110}
            />
            {timeMode === 'month' && (
              <Select
                label="Monat"
                value={monthFilter}
                onChange={setMonthFilter}
                data={availableMonths}
                size="sm"
                w={130}
              />
            )}
            <Select
              label="Chart Type"
              value={chartType}
              onChange={(value) => setChartType(value as 'line' | 'bar' || 'line')}
              data={[
                { value: 'line', label: 'Line Chart' },
                { value: 'bar', label: 'Bar Chart' },
              ]}
              size="sm"
              w={120}
            />
          </Group>
        </Group>

        {/* Summary Stats */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>Total Cost ({timeMode === 'month' && monthFilter ? availableMonths.find(m => m.value === monthFilter)?.label : `${timeMode} Tage`})</Text>
              <Text size="xl" fw={700} c="blue">${totalCost.toFixed(2)}</Text>
            </Stack>
            <ThemeIcon color="blue" size={50} radius="md" variant="light">
              <IconCoins size={30} />
            </ThemeIcon>
          </Group>

          <Group justify="space-between">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" fw={500}>Total Tokens ({timeMode === 'month' && monthFilter ? availableMonths.find(m => m.value === monthFilter)?.label : `${timeMode} Tage`})</Text>
              <Text size="xl" fw={700} c="green">{(totalTokens / 1000000).toFixed(1)}M</Text>
            </Stack>
            <ThemeIcon color="green" size={50} radius="md" variant="light">
              <IconTrendingUp size={30} />
            </ThemeIcon>
          </Group>
        </SimpleGrid>
      </Card>

      {/* Daily Usage Chart */}
      {dailyData.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="md">Daily Usage Trend</Title>
            {chartType === 'line' ? (
              <LineChart
                h={300}
                data={dailyData}
                dataKey="date"
                series={[
                  { name: 'total_cost', color: 'blue.6', label: 'Cost ($)' },
                ]}
                curveType="monotone"
                withLegend
                withDots
              />
            ) : (
              <MantineBarChart
                h={300}
                data={dailyData}
                dataKey="date"
                series={[
                  { name: 'total_cost', color: 'blue.6', label: 'Cost ($)' },
                ]}
                withLegend
              />
            )}
        </Card>
      )}

      {/* API Key Breakdown */}
      {apiKeyData.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="md">Usage by API Key</Title>
            <MantineBarChart
              h={300}
              data={apiKeyData}
              dataKey="api_key_name"
              series={[
                { name: 'total_cost', color: 'violet.6', label: 'Cost ($)' },
              ]}
              withLegend
            />
        </Card>
      )}
    </Stack>
  );
};