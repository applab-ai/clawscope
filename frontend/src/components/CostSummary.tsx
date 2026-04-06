import React, { useState, useEffect } from 'react';
import {
  Card,
  Title,
  SimpleGrid,
  Table,
  Text,
  Group,
  Center,
  Loader,
  Alert,
  Button,
  Stack,
} from '@mantine/core';
import { PieChart } from '@mantine/charts';
import { api, type CostSummary as CostSummaryType } from '../services/api';

interface CostSummaryProps {
  refreshTrigger: number;
}

const COLORS = [
  'blue.6',
  'green.6',
  'orange.6',
  'red.6',
  'grape.6',
  'yellow.6',
  'cyan.6',
  'lime.6',
];

export const CostSummary: React.FC<CostSummaryProps> = ({ refreshTrigger }) => {
  const [costSummary, setCostSummary] = useState<CostSummaryType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCostSummary();
  }, [refreshTrigger]);

  const fetchCostSummary = async () => {
    try {
      if (!costSummary) setLoading(true);
      setError(null);
      const data = await api.getCostSummary();
      setCostSummary(data);
    } catch (err) {
      setError('Failed to load cost summary');
      console.error('Error fetching cost summary:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Center p="xl">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text>Loading cost summary...</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light">
        <Stack gap="sm">
          <Text>{error}</Text>
          <Button size="xs" onClick={fetchCostSummary} variant="light" color="red">
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (!costSummary) {
    return (
      <Center p="xl">
        <Text c="dimmed">No cost data available</Text>
      </Center>
    );
  }

  // Prepare data for pie charts
  const apiKeyChartData = costSummary.api_keys.map((item, index) => ({
    name: item.api_key_name,
    value: item.total_cost,
    color: COLORS[index % COLORS.length],
  }));

  const modelChartData = costSummary.models.map((item, index) => ({
    name: item.model.split('-').pop() || item.model, // Shorten model names
    fullName: item.model,
    value: item.total_cost,
    color: COLORS[index % COLORS.length],
  }));

  const totalApiKeyCost = costSummary.api_keys.reduce((sum, item) => sum + item.total_cost, 0);
  const totalModelCost = costSummary.models.reduce((sum, item) => sum + item.total_cost, 0);

  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;
  const formatPercentage = (value: number, total: number) => `${((value / total) * 100).toFixed(1)}%`;

  return (
    <Card withBorder>
      <Title order={3} mb="lg">Cost Summary (Last 30 Days)</Title>
      
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
        {/* API Keys Breakdown */}
        <Stack>
          <Group justify="center" mb="md">
            <Title order={4}>Cost by API Key</Title>
            <Text size="sm" c="dimmed">
              Total: {formatCost(totalApiKeyCost)}
            </Text>
          </Group>
          
          {apiKeyChartData.length > 0 ? (
            <Stack gap="md">
              <Center>
                <PieChart
                  data={apiKeyChartData}
                  size={200}
                  withLabelsLine
                  labelsPosition="outside"
                  labelsType="percent"
                  withTooltip
                />
              </Center>
              
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>API Key</Table.Th>
                    <Table.Th ta="right">Tokens</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                    <Table.Th ta="right">%</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...costSummary.api_keys].sort((a, b) => b.total_cost - a.total_cost).map((item, index) => (
                    <Table.Tr key={item.api_key}>
                      <Table.Td>
                        <Group gap="xs">
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: `var(--mantine-color-${COLORS[index % COLORS.length].replace('.', '-')})`,
                            }}
                          />
                          <Text size="sm">{item.api_key_name}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" ff="monospace">
                          {((item.total_tokens || 0) / 1000000).toFixed(1)}M
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" ff="monospace">
                          {formatCost(item.total_cost)}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">
                          {formatPercentage(item.total_cost, totalApiKeyCost)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ) : (
            <Center p="xl">
              <Text c="dimmed">No API key data available</Text>
            </Center>
          )}
        </Stack>

        {/* Models Breakdown */}
        <Stack>
          <Group justify="center" mb="md">
            <Title order={4}>Cost by Model</Title>
            <Text size="sm" c="dimmed">
              Total: {formatCost(totalModelCost)}
            </Text>
          </Group>
          
          {modelChartData.length > 0 ? (
            <Stack gap="md">
              <Center>
                <PieChart
                  data={modelChartData}
                  size={200}
                  withLabelsLine
                  labelsPosition="outside"
                  labelsType="percent"
                  withTooltip
                />
              </Center>
              
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Model</Table.Th>
                    <Table.Th ta="right">Tokens</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                    <Table.Th ta="right">%</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...costSummary.models].sort((a, b) => b.total_cost - a.total_cost).map((item, index) => (
                    <Table.Tr key={item.model}>
                      <Table.Td>
                        <Group gap="xs">
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: `var(--mantine-color-${COLORS[index % COLORS.length].replace('.', '-')})`,
                            }}
                          />
                          <Text size="sm">{item.model}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" ff="monospace">
                          {((item.total_tokens || 0) / 1000000).toFixed(1)}M
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" ff="monospace">
                          {formatCost(item.total_cost)}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">
                          {formatPercentage(item.total_cost, totalModelCost)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ) : (
            <Center p="xl">
              <Text c="dimmed">No model data available</Text>
            </Center>
          )}
        </Stack>
      </SimpleGrid>
    </Card>
  );
};